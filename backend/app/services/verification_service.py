"""Verification views: current-forecast scope and held-out validation scope."""
from __future__ import annotations

import threading

import numpy as np
import pandas as pd

from ..config import LEADS, LEAD_LABELS, REGIME_LABELS, REGIME_SHORT, REGIMES, SCENARIOS, THRESHOLDS, VAL_SEEDS
from ..ml import verification as ver
from .state import state

SOURCES = {"nwp": "nwp_rainfall", "global_qm": "global_qm", "universal": "universal", "regime_aware": "corrected"}
SOURCE_LABELS = {"nwp": "Raw NWP", "global_qm": "Global Bias Correction (QM)", "universal": "Universal ML (regime-blind)", "regime_aware": "Regime-Aware AI"}
INTENSITY_BINS = [(0.0, 2.5, "< 2.5"), (2.5, 15.6, "2.5 - 15.6"), (15.6, 64.5, "15.6 - 64.5"), (64.5, 115.6, "64.5 - 115.6"), (115.6, 1e9, ">= 115.6")]

_VAL: pd.DataFrame | None = None
_VAL_LOCK = threading.Lock()
_MEMO: dict = {}


def get_validation_frame() -> pd.DataFrame:
    """Held-out simulated validation set (seeds never used for training) with full pipeline predictions."""
    global _VAL
    with _VAL_LOCK:
        if _VAL is None:
            pipe = state.pipeline
            va = pipe.build_frame(VAL_SEEDS)
            pred = pipe.run(va)
            _VAL = pd.concat([va, pred], axis=1)
    return _VAL


def _frame(scope: str, scenario: str | None, seed: int | None, lead: int | None) -> tuple[pd.DataFrame, np.ndarray, str]:
    if scope == "validation":
        df = get_validation_frame()
        if scenario and scenario != "all":
            df = df[df["scenario"] == scenario]
        groups_all = (df["run"].astype(str) + "|" + df["lead_time_hr"].astype(str)).values
        note = ("Held-out validation set: simulated forecast runs (seeds never used in training) "
                f"covering {len(SCENARIOS) if not scenario or scenario == 'all' else 1} scenario(s) x {len(VAL_SEEDS)} runs x {len(LEADS)} lead times.")
    else:
        from .forecast_service import get_run

        if scenario == "live":
            raise ValueError("Verification of the live forecast is not possible: there is no observed-rainfall feed. Use the held-out validation scope.")
        run = get_run(scenario, seed)
        df = run.full
        groups_all = df["lead_time_hr"].astype(str).values
        note = f"Current simulated forecast run ({SCENARIOS[scenario]}, seed {seed})."
    if lead is not None:
        m = (df["lead_time_hr"] == lead).values
        df, groups_all = df[m], groups_all[m]
    return df, groups_all, note


def _scores(df, groups, thr, radius, mask=None):
    obs = df["observed_rainfall"].values
    out = {}
    for key, col in SOURCES.items():
        out[key] = ver.score_all(obs, df[col].values, thr, df["latitude"].values, df["longitude"].values, groups, radius, mask)
    return out


def _improve(src):
    return {"vs_nwp": ver.improvement(src["nwp"], src["regime_aware"]),
            "vs_global_qm": ver.improvement(src["global_qm"], src["regime_aware"]),
            "vs_universal": ver.improvement(src["universal"], src["regime_aware"])}


def verification(scope: str, scenario: str | None, seed: int | None, lead: int | None, thr: int, radius: float) -> dict:
    if thr not in THRESHOLDS:
        raise ValueError(f"threshold must be one of {THRESHOLDS}")
    key = ("v", scope, scenario, seed, lead, thr, radius)
    if key in _MEMO:
        return _MEMO[key]
    df, groups, note = _frame(scope, scenario, seed, lead)
    df = df.reset_index(drop=True)
    valid = df["observed_rainfall"].notna().values
    src = _scores(df, groups, thr, radius)
    obs = df["observed_rainfall"].values

    by_thr = []
    for t in THRESHOLDS:
        s = _scores(df, groups, t, radius)
        by_thr.append({"threshold": t, **{k: {m: s[k].get(m) for m in ("csi", "pod", "far", "ets", "fss", "freq_bias")} for k in SOURCES}})

    by_lead = []
    for ld in LEADS:
        m = (df["lead_time_hr"] == ld).values & valid
        if m.sum() < 10:
            continue
        row = {"lead": ld, "label": LEAD_LABELS[ld], "n": int(m.sum())}
        for k, col in SOURCES.items():
            row[f"rmse_{k}"] = ver._f(ver.rmse(obs[m], df[col].values[m]))
            row[f"csi_{k}"] = ver._f(ver.contingency(obs[m], df[col].values[m], thr)["csi"])
        by_lead.append(row)

    bands = []
    lat = df["latitude"].values
    for lo in np.arange(8, 36, 2.5):
        m = (lat >= lo) & (lat < lo + 2.5) & valid
        if m.sum() < 5:
            continue
        bands.append({"lat": round(float(lo + 1.25), 2), "n": int(m.sum()), "observed": ver._f(obs[m].mean()),
                      **{k: ver._f(df[col].values[m].mean()) for k, col in SOURCES.items()}})

    edges = np.arange(-100, 101, 10)
    hist = {"edges": [int(e) for e in edges[:-1]], "bin_width": 10}
    for k in ("nwp", "regime_aware"):
        err = np.clip(df[SOURCES[k]].values[valid] - obs[valid], -99.9, 99.9)
        hist[k] = np.histogram(err, bins=edges)[0].tolist()
    rng = np.random.default_rng(3)
    idx = np.flatnonzero(valid)
    idx = rng.choice(idx, min(450, len(idx)), replace=False) if len(idx) else idx
    scatter = [{"obs": ver._f(obs[i]), "nwp": ver._f(df["nwp_rainfall"].values[i]), "ai": ver._f(df["corrected"].values[i])} for i in idx]

    out = {
        "scope": scope, "scenario": scenario, "seed": seed, "lead": lead, "threshold": thr, "radius_km": radius,
        "n": int(valid.sum()), "note": note,
        "validation_statement": "Prototype validation using simulated/bundled demonstration data. Not IMD-validated.",
        "source_labels": SOURCE_LABELS, "sources": src, "improvement": _improve(src),
        "by_threshold": by_thr, "by_lead": by_lead, "lat_bands": bands, "error_hist": hist, "scatter": scatter,
    }
    if len(_MEMO) > 200:
        _MEMO.clear()
    _MEMO[key] = out
    return out


def regime_wise(scope: str, scenario: str | None, seed: int | None, thr: int, radius: float) -> dict:
    if thr not in THRESHOLDS:
        raise ValueError(f"threshold must be one of {THRESHOLDS}")
    key = ("r", scope, scenario, seed, thr, radius)
    if key in _MEMO:
        return _MEMO[key]
    df, groups, note = _frame(scope, scenario, seed, None)
    df = df.reset_index(drop=True)
    obs = df["observed_rainfall"].values
    valid = ~np.isnan(obs)
    rows = []
    for r in REGIMES:
        m = (df["regime"] == r).values & valid
        if m.sum() < 15:
            rows.append({"regime": r, "label": REGIME_LABELS[r], "short": REGIME_SHORT[r], "n": int(m.sum()), "share": 0.0, "insufficient": True})
            continue
        src = _scores(df, groups, thr, radius, mask=m)
        rows.append({
            "regime": r, "label": REGIME_LABELS[r], "short": REGIME_SHORT[r], "n": int(m.sum()), "share": round(float(m.sum() / valid.sum()), 4),
            "mean_obs": ver._f(obs[m].mean()), "sources": src, "improvement": _improve(src),
            "rmse_nwp": src["nwp"]["rmse"], "rmse_ai": src["regime_aware"]["rmse"],
        })
    fingerprint = []
    nwp = df["nwp_rainfall"].values
    for r in REGIMES:
        for lo, hi, label in INTENSITY_BINS:
            m = (df["regime"] == r).values & valid & (nwp >= lo) & (nwp < hi)
            if m.sum() < 10:
                continue
            fingerprint.append({
                "regime": r, "short": REGIME_SHORT[r], "bin": label, "n": int(m.sum()),
                "mean_nwp": ver._f(nwp[m].mean()), "mean_obs": ver._f(obs[m].mean()), "mean_ai": ver._f(df["corrected"].values[m].mean()),
                "bias_nwp": ver._f((nwp[m] - obs[m]).mean()), "bias_ai": ver._f((df["corrected"].values[m] - obs[m]).mean()),
            })
    # interval calibration of the P10-P90 band per regime
    cov = []
    for r in REGIMES:
        m = (df["regime"] == r).values & valid
        if m.sum() >= 15:
            inside = (obs[m] >= df["corrected_p10"].values[m]) & (obs[m] <= df["corrected_p90"].values[m])
            cov.append({"regime": r, "short": REGIME_SHORT[r], "coverage": ver._f(inside.mean()), "mean_width_mm": ver._f((df["corrected_p90"].values[m] - df["corrected_p10"].values[m]).mean())})
    overall = _scores(df, groups, thr, radius)
    out = {
        "scope": scope, "scenario": scenario, "seed": seed, "threshold": thr, "radius_km": radius, "note": note, "n": int(valid.sum()),
        "source_labels": SOURCE_LABELS, "regimes": rows, "overall": overall, "overall_improvement": _improve(overall),
        "bias_fingerprint": fingerprint, "interval_coverage": cov,
        "regimes_improved": int(sum(1 for r in rows if r.get("rmse_ai") is not None and r["rmse_ai"] < r["rmse_nwp"])),
        "regimes_hurt_by_global_qm": int(sum(1 for r in rows if r.get("sources") and r["sources"]["global_qm"]["rmse"] > r["sources"]["nwp"]["rmse"])),
    }
    if len(_MEMO) > 200:
        _MEMO.clear()
    _MEMO[key] = out
    return out
