"""Builds and caches forecast runs: simulate feed -> QC -> features -> regime -> correction -> probability."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from ..config import (DATA_DISCLAIMER, DATA_MODE, DATA_MODE_LIVE, FORECAST_CYCLE, LIVE_DISCLAIMER, LIVE_KEY, LIVE_LABEL, LIVE_NOTE, LIVE_TTL_S, IMD_CATEGORIES, LEAD_LABELS, LEADS, REGIME_LABELS, REGIME_SHORT,
                      REGIMES, SCENARIOS, THRESHOLDS)
from ..ml.catalog import get_catalog
from ..ml.features import engineer_features
from ..ml.quality import run_quality
from ..ml.simulation import inject_defects, simulate_forecast
from . import alerts as al
from . import live_service as live
from .state import state

_CACHE: "OrderedDict[tuple, ForecastRun]" = OrderedDict()
_LOCK = threading.Lock()
_MAX_RUNS = 10


def jsonable(v):
    """NaN/inf -> None, numpy scalars -> python."""
    if isinstance(v, (np.floating, float)):
        return None if (np.isnan(v) or np.isinf(v)) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def category_of(values) -> np.ndarray:
    values = np.asarray(values, float)
    out = np.full(values.shape, "No Rain", dtype=object)
    for low, label in reversed(IMD_CATEGORIES):
        out[values >= low] = label
    return out


def latest_cycle(now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    cyc = now.replace(hour=12, minute=0, second=0, microsecond=0)
    return cyc if now >= cyc else cyc - timedelta(days=1)


@dataclass
class ForecastRun:
    scenario: str
    seed: int
    full: pd.DataFrame
    qc: dict
    trace: list[dict]
    init_time: datetime
    generated_at: datetime
    timings: dict = field(default_factory=dict)
    live: dict | None = None

    @property
    def meta(self) -> dict:
        is_live = self.scenario == LIVE_KEY
        return {
            "scenario": self.scenario, "scenario_label": LIVE_LABEL if is_live else SCENARIOS[self.scenario], "seed": self.seed,
            "data_mode": DATA_MODE_LIVE if is_live else DATA_MODE, "disclaimer": LIVE_DISCLAIMER if is_live else DATA_DISCLAIMER,
            "forecast_cycle": "hourly" if is_live else FORECAST_CYCLE, "is_live": is_live, "live": self.live,
            "init_time": self.init_time.isoformat(), "generated_at": self.generated_at.isoformat(),
            "last_updated": self.generated_at.isoformat(),
        }

    def at(self, lead: int) -> pd.DataFrame:
        return self.full[self.full["lead_time_hr"] == lead]


def get_run(scenario: str, seed: int, refresh: bool = False) -> ForecastRun:
    if scenario == LIVE_KEY:
        return _get_live(refresh)
    if scenario not in SCENARIOS:
        raise KeyError(f"Unknown scenario '{scenario}'")
    key = (scenario, int(seed))
    with _LOCK:
        run = _CACHE.get(key)
        if run is not None:
            _CACHE.move_to_end(key)
            return run
        run = _build(scenario, int(seed))
        _CACHE[key] = run
        while len(_CACHE) > _MAX_RUNS:
            _CACHE.popitem(last=False)
        return run


def _get_live(refresh: bool) -> ForecastRun:
    """Live run cached for LIVE_TTL_S; if a refresh fails the previous run (or a saved snapshot) is served with a warning."""
    key = (LIVE_KEY, 0)
    with _LOCK:
        run = _CACHE.get(key)
        fresh = run is not None and (datetime.now(timezone.utc) - run.generated_at).total_seconds() < LIVE_TTL_S
        if run is not None and fresh and not refresh:
            return run
        try:
            new = _build_live()
        except live.LiveDataError:
            if run is not None:
                run.live = {**(run.live or {}), "warning": "Live refresh failed; showing the previous live data."}
                return run
            raise
        _CACHE[key] = new
        return new


def _pipeline_run(scenario, seed, raw, manifest, init, tm, ingest, live_info=None) -> ForecastRun:
    pipe = state.pipeline
    t = time.perf_counter()
    clean, qc = run_quality(raw, manifest, reference=get_catalog())
    tm["quality_ms"] = round(1000 * (time.perf_counter() - t), 1)
    t = time.perf_counter()
    feat = engineer_features(clean, group_cols=["timestamp", "lead_time_hr"])
    tm["features_ms"] = round(1000 * (time.perf_counter() - t), 1)
    pred = pipe.run(feat, tm)
    full = pd.concat([feat, pred], axis=1)
    full["id"] = full["location_id"]
    full["error_nwp"] = full["nwp_rainfall"] - full["observed_rainfall"]
    full["error_ai"] = full["corrected"] - full["observed_rainfall"]
    full["category"] = category_of(full["corrected"])
    full["category_nwp"] = category_of(full["nwp_rainfall"])
    full["category_obs"] = category_of(full["observed_rainfall"].fillna(0))
    full.loc[full["observed_rainfall"].isna(), "category_obs"] = None
    full["is_district"] = full["id"].map(get_catalog().set_index("id")["is_district"])

    lead0 = full[full["lead_time_hr"] == 0]
    counts = lead0["regime"].value_counts()
    dom = counts.index[0]
    trace = [
        {"id": "ingest", "name": ingest["name"], "records": int(len(raw)), "ms": tm["ingest_ms"], "detail": ingest["detail"]},
        {"id": "quality", "name": "Data Quality Check", "records": int(qc["records_retained"]), "ms": tm["quality_ms"], "detail": f"quality score {qc['quality_score']:.1f}/100, {qc['imputed_cells']} cells repaired"},
        {"id": "features", "name": "Feature Engineering", "records": int(len(feat)), "ms": tm["features_ms"], "detail": "16 features incl. spatial rainfall coverage and coastal proximity"},
        {"id": "regime", "name": "Regime Classification", "records": int(len(feat)), "ms": tm.get("regime_ms"), "detail": f"{REGIME_SHORT[dom]} dominant ({100 * counts.iloc[0] / len(lead0):.0f}% of locations)"},
        {"id": "correction", "name": "Regime-Specific Correction", "records": int(len(feat)), "ms": tm.get("correction_ms"), "detail": f"{full['regime'].nunique()} regime models applied, P10-P90 intervals"},
        {"id": "probability", "name": "Exceedance Probability", "records": int(len(feat)), "ms": tm.get("probability_ms"), "detail": "P(rain >= 10 / 25 / 50 / 100 mm)"},
    ]
    return ForecastRun(scenario, seed, full, qc, trace, init, datetime.now(timezone.utc), tm, live_info)


def _build(scenario: str, seed: int) -> ForecastRun:
    if not state.pipeline.ready:
        raise RuntimeError("Models are not ready")
    tm: dict = {}
    t = time.perf_counter()
    init = latest_cycle()
    raw = simulate_forecast(scenario, seed, init_time=init)
    raw, manifest = inject_defects(raw, seed)
    tm["ingest_ms"] = round(1000 * (time.perf_counter() - t), 1)
    ingest = {"name": "NWP Forecast Ingest", "detail": f"{len(raw):,} raw records, {len(LEADS)} lead times"}
    return _pipeline_run(scenario, seed, raw, manifest, init, tm, ingest)


def _build_live() -> ForecastRun:
    if not state.pipeline.ready:
        raise RuntimeError("Models are not ready")
    tm: dict = {}
    t = time.perf_counter()
    payload = live.get_payload()
    raw, init = live.payload_to_raw(payload)
    tm["ingest_ms"] = round(1000 * (time.perf_counter() - t), 1)
    snap = bool(payload.get("snapshot"))
    info = {"source": live.SOURCE, "fetched_at": payload["fetched_at"], "snapshot": snap, "note": LIVE_NOTE,
            "warning": (f"Live service unreachable ({payload.get('fallback_reason')}). Showing the saved snapshot from {payload['fetched_at']}." if snap else None)}
    ingest = {"name": "Live NWP Fetch (Open-Meteo)", "detail": f"{len(raw):,} records, {len(get_catalog()):,} points" + (" - saved snapshot" if snap else " - real forecast")}
    return _pipeline_run(LIVE_KEY, 0, raw, None, init, tm, ingest, info)


# ------------------------------------------------------------------ record builders
def make_config(heavy: int, very: int, **kw) -> al.AlertConfig:
    if heavy not in THRESHOLDS or very not in THRESHOLDS:
        raise ValueError(f"Thresholds must be one of {THRESHOLDS}")
    if very < heavy:
        raise ValueError("very_heavy threshold must be >= heavy threshold")
    return al.AlertConfig(heavy=heavy, very_heavy=very, **{k: v for k, v in kw.items() if v is not None})


def records(df: pd.DataFrame, cfg: al.AlertConfig, full_detail: bool = False, with_probs: bool = False) -> list[dict]:
    """Convert a slice of run.full into API point dictionaries (with alert levels)."""
    if df.empty:
        return []
    lvl, low, score = al.evaluate(df, cfg)
    o = pd.DataFrame({
        "id": df["id"].values, "district": df["district"].values, "state": df["state"].values,
        "lat": df["latitude"].round(3).values, "lon": df["longitude"].round(3).values,
        "elevation": df["elevation"].round(0).values, "lead": df["lead_time_hr"].astype(int).values,
        "regime": df["regime"].values, "confidence": df["regime_conf"].round(3).values,
        "nwp": df["nwp_rainfall"].round(1).values, "corrected": df["corrected"].round(1).values,
        "q10": df["corrected_p10"].round(1).values, "q90": df["corrected_p90"].round(1).values,
        "observed": df["observed_rainfall"].round(1).values,
        "error_nwp": df["error_nwp"].round(1).values, "error_ai": df["error_ai"].round(1).values,
        "p_heavy": df[f"p_ge_{cfg.heavy}"].round(3).values, "p_very": df[f"p_ge_{cfg.very_heavy}"].round(3).values,
        "prob_10": df["p_ge_10"].round(3).values, "prob_25": df["p_ge_25"].round(3).values,
        "prob_50": df["p_ge_50"].round(3).values, "prob_100": df["p_ge_100"].round(3).values,
        "category": df["category"].values, "alert": np.array(al.LEVELS)[lvl], "low_confidence": low,
        "risk_score": np.round(score, 4), "is_district": df["is_district"].fillna(False).astype(bool).values,
    })
    if full_detail:
        o["universal"] = df["universal"].round(1).values
        o["global_qm"] = df["global_qm"].round(1).values
        for k in ["temperature", "humidity", "wind_speed", "wind_direction", "pressure", "pressure_tendency", "prev_rainfall", "spatial_coverage", "coast_dist_km"]:
            o[k] = df[k].round(2).values
        o["category_nwp"] = df["category_nwp"].values
        o["category_obs"] = df["category_obs"].values
        o["valid_time"] = df["timestamp"].values
    if with_probs or full_detail:
        probs = {r: df[f"prob_{r}"].round(3).values for r in REGIMES}
        o["regime_probs"] = [{r: float(probs[r][i]) for r in REGIMES} for i in range(len(o))]
    o = o.astype(object).where(o.notna(), None)
    out = o.to_dict("records")
    for rec in out:
        for k, v in rec.items():
            rec[k] = jsonable(v)
    return out


def regime_mix(df: pd.DataFrame) -> list[dict]:
    n = max(len(df), 1)
    out = []
    for r in REGIMES:
        m = df["regime"] == r
        out.append({"regime": r, "label": REGIME_LABELS[r], "short": REGIME_SHORT[r], "count": int(m.sum()), "share": round(float(m.sum()) / n, 4),
                    "mean_confidence": round(float(df.loc[m, "regime_conf"].mean()), 3) if m.any() else None,
                    "mean_probability": round(float(df[f"prob_{r}"].mean()), 4)})
    return out


def dominant(df: pd.DataFrame) -> dict:
    mix = regime_mix(df)
    top = max(mix, key=lambda d: d["count"])
    return {"regime": top["regime"], "label": top["label"], "share": top["share"], "confidence": top["mean_confidence"],
            "model": f"{top['label']} Correction Model"}


def horizon_summary(run: ForecastRun, cfg: al.AlertConfig) -> list[dict]:
    rows = []
    for lead in LEADS:
        d = run.at(lead)
        if d.empty:
            continue
        dom = dominant(d)
        lvl, _, _ = al.evaluate(d, cfg)
        rows.append({
            "lead": lead, "label": LEAD_LABELS[lead], "regime": dom["regime"], "regime_label": dom["label"], "confidence": dom["confidence"],
            "nwp_mean": round(float(d["nwp_rainfall"].mean()), 2), "corrected_mean": round(float(d["corrected"].mean()), 2),
            "observed_mean": jsonable(round(float(d["observed_rainfall"].mean()), 2)),
            "nwp_p95": round(float(d["nwp_rainfall"].quantile(0.95)), 1), "corrected_p95": round(float(d["corrected"].quantile(0.95)), 1),
            "p_heavy_max": round(float(d[f"p_ge_{cfg.heavy}"].max()), 3), "p_very_max": round(float(d[f"p_ge_{cfg.very_heavy}"].max()), 3),
            "p_heavy_mean": round(float(d[f"p_ge_{cfg.heavy}"].mean()), 3), "p_very_mean": round(float(d[f"p_ge_{cfg.very_heavy}"].mean()), 3),
            "high_risk": int((lvl >= 2).sum()),
        })
    return rows
