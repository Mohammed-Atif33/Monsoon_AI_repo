"""View builders for the dashboard, district forecast, regimes, heavy rainfall, bulletin and the what-if Lab."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ..config import (DATA_DISCLAIMER, DATA_MODE, FEATURE_LABELS, FEATURES, FORECAST_CYCLE, LEAD_LABELS, LEADS, REGIME_DESCRIPTIONS,
                      REGIME_LABELS, REGIME_SHORT, REGIMES, SCENARIOS, THRESHOLDS, VALIDATION_NOTE)
from ..ml import verification as ver
from ..ml.catalog import get_catalog
from ..ml.features import WET_MM
from ..utils.geo import coast_distance
from . import alerts as al
from . import forecast_service as fs
from . import verification_service as vs
from .state import state

SORT_KEYS = {"district", "state", "regime", "confidence", "nwp", "corrected", "observed", "error_ai", "error_nwp", "p_heavy", "p_very", "risk_score", "category"}


def _meta(run: fs.ForecastRun, lead: int, cfg: al.AlertConfig) -> dict:
    valid = run.init_time.timestamp() + lead * 3600
    return {**run.meta, "lead": lead, "lead_label": LEAD_LABELS[lead],
            "valid_time": datetime.fromtimestamp(valid, tz=timezone.utc).isoformat(), "alert_config": cfg.as_dict(),
            "thresholds": THRESHOLDS, "leads": [{"lead": l, "label": LEAD_LABELS[l]} for l in LEADS]}


def _check_lead(lead: int) -> int:
    if lead not in LEADS:
        raise ValueError(f"lead must be one of {LEADS}")
    return lead


def _rmse(d: pd.DataFrame, col: str):
    v = d["observed_rainfall"].notna()
    return ver.rmse(d.loc[v, "observed_rainfall"].values, d.loc[v, col].values)


# ------------------------------------------------------------------ dashboard
def dashboard(run: fs.ForecastRun, lead: int, cfg: al.AlertConfig) -> dict:
    _check_lead(lead)
    d = run.at(lead)
    if d.empty:
        raise LookupError("No forecast records for the requested lead time")
    recs = fs.records(d, cfg)
    df = pd.DataFrame(recs)
    dom = fs.dominant(d)
    lvl_counts = df["alert"].value_counts().to_dict()
    rn, ra = _rmse(d, "nwp_rainfall"), _rmse(d, "corrected")
    if d["observed_rainfall"].notna().sum() == 0:
        rn = ra = float("nan")
    val = vs.get_validation_frame()
    vn, va_ = ver.rmse(val["observed_rainfall"].values, val["nwp_rainfall"].values), ver.rmse(val["observed_rainfall"].values, val["corrected"].values)
    top = df.sort_values(["risk_score", "corrected"], ascending=False).head(10)
    peak_h, peak_v = df.loc[df["p_heavy"].idxmax()], df.loc[df["p_very"].idxmax()]
    return {
        "meta": _meta(run, lead, cfg),
        "kpis": {
            "current_regime": dom["regime"], "current_regime_label": dom["label"], "regime_confidence": dom["confidence"], "regime_area_share": dom["share"],
            "regime_model": dom["model"],
            "districts_monitored": int(len(d)), "named_districts": int(d["is_district"].fillna(False).sum()),
            "high_risk_districts": int((df["alert"].isin(["Warning", "Severe"])).sum()),
            "watch_districts": int((df["alert"] == "Watch").sum()),
            "rmse_nwp": ver._f(rn), "rmse_ai": ver._f(ra), "rmse_improvement_pct": ver._f(100 * (rn - ra) / rn) if rn else None,
            "validation_rmse_improvement_pct": ver._f(100 * (vn - va_) / vn),
            "mean_p_heavy": ver._f(df["p_heavy"].mean()), "mean_p_very": ver._f(df["p_very"].mean()),
            "max_p_heavy": ver._f(peak_h["p_heavy"]), "max_p_heavy_district": peak_h["district"],
            "max_p_very": ver._f(peak_v["p_very"]), "max_p_very_district": peak_v["district"],
            "n_p_heavy_over_50": int((df["p_heavy"] >= 0.5).sum()), "n_p_very_over_50": int((df["p_very"] >= 0.5).sum()),
            "mean_nwp": ver._f(d["nwp_rainfall"].mean()), "mean_corrected": ver._f(d["corrected"].mean()), "mean_observed": ver._f(d["observed_rainfall"].mean()),
        },
        "regime_mix": fs.regime_mix(d),
        "alert_counts": {k: int(lvl_counts.get(k, 0)) for k in al.LEVELS},
        "top_risk": top.astype(object).where(top.notna(), None).to_dict("records"),
        "horizon": fs.horizon_summary(run, cfg),
        "pipeline": run.trace,
        "quality": {"score": run.qc["quality_score"], "grade": run.qc["grade"], "records": run.qc["records_processed"], "valid": run.qc["valid_records"]},
        "validation_note": VALIDATION_NOTE,
    }


# ------------------------------------------------------------------ forecast list
def forecast_list(run, lead, cfg, page=1, page_size=0, search=None, regime=None, alert=None, sort="risk_score", order="desc") -> dict:
    _check_lead(lead)
    if sort not in SORT_KEYS:
        raise ValueError(f"sort must be one of {sorted(SORT_KEYS)}")
    d = run.at(lead)
    recs = fs.records(d, cfg)
    df = pd.DataFrame(recs)
    if search:
        s = search.strip().lower()
        df = df[df["district"].str.lower().str.contains(s, regex=False) | df["state"].str.lower().str.contains(s, regex=False)]
    if regime:
        if regime not in REGIMES:
            raise ValueError(f"unknown regime '{regime}'")
        df = df[df["regime"] == regime]
    if alert:
        df = df[df["alert"] == alert]
    df = df.sort_values(sort, ascending=(order == "asc"), na_position="last")
    total = int(len(df))
    if page_size and page_size > 0:
        pages = max(1, -(-total // page_size))
        page = min(max(1, page), pages)
        df = df.iloc[(page - 1) * page_size: page * page_size]
    else:
        pages, page = 1, 1
    items = df.astype(object).where(df.notna(), None).to_dict("records")
    return {"meta": _meta(run, lead, cfg), "total": total, "page": page, "page_size": page_size, "pages": pages, "items": items}


# ------------------------------------------------------------------ district
def find_location(run: fs.ForecastRun, key: str) -> str:
    ids = run.full["id"].unique()
    k = key.strip().lower()
    if k in ids:
        return k
    names = run.full.drop_duplicates("id").set_index(run.full.drop_duplicates("id")["district"].str.lower())["id"]
    if k in names.index:
        return names[k]
    slug = "".join(c if c.isalnum() else "-" for c in k).strip("-")
    if slug in ids:
        return slug
    raise LookupError(f"District / grid cell '{key}' not found")


def _row_frame(run: fs.ForecastRun, loc_id: str, lead: int) -> pd.DataFrame:
    r = run.full[(run.full["id"] == loc_id) & (run.full["lead_time_hr"] == lead)]
    if r.empty:
        raise LookupError("No forecast for this location at the requested lead time (record removed by data-quality control)")
    return r.iloc[[0]]


def district_detail(run, key, lead, cfg) -> dict:
    _check_lead(lead)
    loc = find_location(run, key)
    rows = run.full[run.full["id"] == loc].sort_values("lead_time_hr")
    timeline = fs.records(rows, cfg, full_detail=True)
    cur = next((t for t in timeline if t["lead"] == lead), None)
    if cur is None:
        raise LookupError("No forecast for this location at the requested lead time (record removed by data-quality control)")
    row = _row_frame(run, loc, lead)
    pipe = state.pipeline
    reg = cur["regime"]
    cat = get_catalog().set_index("id").loc[loc]
    reason = al.reason(cur, cfg) if cur["alert"] != "Normal" else "No threshold exceeded"
    return {
        "meta": _meta(run, lead, cfg),
        "location": {"id": loc, "district": cur["district"], "state": cur["state"], "lat": cur["lat"], "lon": cur["lon"], "elevation": cur["elevation"],
                     "coast_dist_km": float(cat["coast_dist_km"]), "is_district": bool(cat["is_district"]), "near": cat["near"]},
        "current": cur,
        "timeline": timeline,
        "model_used": f"{REGIME_LABELS[reg]} Correction Model",
        "regime_description": REGIME_DESCRIPTIONS[reg],
        "explanation": {
            "regime": pipe.explain_regime(row),
            "correction": pipe.explain_correction(row, reg),
        },
        "alert": {"level": cur["alert"], "reason": reason, "low_confidence": cur["low_confidence"]},
        "regime_sequence": [{"lead": t["lead"], "regime": t["regime"], "confidence": t["confidence"]} for t in timeline],
        "correction_effect": {
            "adjustment_mm": round(cur["corrected"] - cur["nwp"], 1),
            "adjustment_pct": round(100 * (cur["corrected"] - cur["nwp"]) / max(cur["nwp"], 1.0), 1),
        },
    }


# ------------------------------------------------------------------ regimes
def regimes_view(run, lead, cfg) -> dict:
    _check_lead(lead)
    d = run.at(lead)
    recs = fs.records(d, cfg)
    pts = [{k: r[k] for k in ("id", "district", "state", "lat", "lon", "regime", "confidence", "corrected", "is_district")} for r in recs]
    mix = fs.regime_mix(d)
    sig_cols = ["humidity", "wind_speed", "pressure", "pressure_tendency", "temperature", "spatial_coverage", "prev_rainfall"]
    models = []
    for r in REGIMES:
        m = d["regime"] == r
        sig = {c: (round(float(d.loc[m, c].mean()), 2) if m.any() else None) for c in sig_cols}
        info = next(x for x in mix if x["regime"] == r)
        models.append({"regime": r, "label": REGIME_LABELS[r], "short": REGIME_SHORT[r], "model": f"{REGIME_LABELS[r]} Correction Model",
                       "description": REGIME_DESCRIPTIONS[r], "count": info["count"], "share": info["share"], "mean_confidence": info["mean_confidence"],
                       "signature": sig,
                       "mean_nwp": ver._f(d.loc[m, "nwp_rainfall"].mean()) if m.any() else None,
                       "mean_corrected": ver._f(d.loc[m, "corrected"].mean()) if m.any() else None})
    by_lead, stability = [], []
    prev = None
    for ld in LEADS:
        x = run.at(ld)
        by_lead.append({"lead": ld, "label": LEAD_LABELS[ld], **{m["regime"]: m["share"] for m in fs.regime_mix(x)}})
        cur = x.set_index("id")["regime"]
        if prev is not None:
            common = cur.index.intersection(prev[1].index)
            stability.append({"from": prev[0], "to": ld, "changed_share": round(float((cur[common] != prev[1][common]).mean()), 4)})
        prev = (ld, cur)
    return {"meta": _meta(run, lead, cfg), "dominant": fs.dominant(d), "mix": mix, "points": pts, "models": models, "mix_by_lead": by_lead, "stability": stability}


def regime_detail(run, key, lead, cfg) -> dict:
    _check_lead(lead)
    loc = find_location(run, key)
    row = _row_frame(run, loc, lead)
    pipe = state.pipeline
    r = row.iloc[0]
    probs = sorted(({"regime": g, "label": REGIME_LABELS[g], "probability": round(float(r[f"prob_{g}"]), 4)} for g in REGIMES), key=lambda x: -x["probability"])
    reg = r["regime"]
    bg = pipe.meta["background_correctors"][reg]
    sig_cols = [("humidity", "%"), ("wind_speed", "m/s"), ("pressure", "hPa"), ("pressure_tendency", "hPa/24h"), ("temperature", "C"), ("spatial_coverage", "")]
    signature = [{"feature": FEATURE_LABELS[c], "unit": u, "value": round(float(r[c]), 2), "typical": round(bg[c], 2)} for c, u in sig_cols]
    rows = run.full[run.full["id"] == loc].sort_values("lead_time_hr")
    seq = [{"lead": int(x.lead_time_hr), "label": LEAD_LABELS[int(x.lead_time_hr)], "regime": x.regime, "confidence": round(float(x.regime_conf), 3)} for x in rows.itertuples()]
    return {
        "meta": _meta(run, lead, cfg),
        "location": {"id": loc, "district": r["district"], "state": r["state"], "lat": round(float(r["latitude"]), 3), "lon": round(float(r["longitude"]), 3)},
        "regime": reg, "label": REGIME_LABELS[reg], "confidence": round(float(r["regime_conf"]), 4), "description": REGIME_DESCRIPTIONS[reg],
        "probabilities": probs, "explanation": pipe.explain_regime(row, top=10), "signature": signature, "sequence": seq,
        "method": "Occlusion attribution: change in P(detected regime) when a feature is replaced by its training median. Positive = supports the regime.",
    }


# ------------------------------------------------------------------ heavy rainfall + alerts
_HEAD = {"Severe": "HIGH RAINFALL RISK", "Warning": "RAINFALL WARNING", "Watch": "RAINFALL WATCH"}


def heavy_rainfall(run, lead, cfg) -> dict:
    _check_lead(lead)
    d = run.at(lead)
    recs = fs.records(d, cfg)
    df = pd.DataFrame(recs)
    rank = df.sort_values(["risk_score", "corrected"], ascending=False)
    cards = []
    for r in rank[rank["alert"] != "Normal"].head(15).to_dict("records"):
        r = {k: fs.jsonable(v) for k, v in r.items()}
        cards.append({"level": r["alert"], "headline": _HEAD[r["alert"]], "district": r["district"], "state": r["state"], "id": r["id"],
                      "p_very": r["p_very"], "p_heavy": r["p_heavy"], "corrected": r["corrected"], "nwp": r["nwp"], "regime": r["regime"],
                      "regime_label": REGIME_LABELS[r["regime"]], "confidence": r["confidence"], "low_confidence": r["low_confidence"], "reason": al.reason(r, cfg)})
    bins = np.linspace(0, 1, 11)
    hist = []
    for i in range(10):
        lo, hi = bins[i], bins[i + 1]
        last = i == 9
        hist.append({"bin": f"{int(lo * 100)}-{int(hi * 100)}%",
                     "heavy": int(((df["p_heavy"] >= lo) & ((df["p_heavy"] <= hi) if last else (df["p_heavy"] < hi))).sum()),
                     "very": int(((df["p_very"] >= lo) & ((df["p_very"] <= hi) if last else (df["p_very"] < hi))).sum())})
    by_state = []
    for st, g in df.groupby("state"):
        by_state.append({"state": st, "n": int(len(g)), "max_p_very": ver._f(g["p_very"].max()), "max_p_heavy": ver._f(g["p_heavy"].max()),
                         "alerts": int((g["alert"].isin(["Warning", "Severe"])).sum()), "mean_corrected": ver._f(g["corrected"].mean())})
    by_state.sort(key=lambda x: (-(x["alerts"]), -(x["max_p_very"] or 0)))
    meta = state.pipeline.meta.get("probability", {})
    return {
        "meta": _meta(run, lead, cfg), "rules": al.RULES,
        "summary": {"n": int(len(df)), "counts": {k: int((df["alert"] == k).sum()) for k in al.LEVELS},
                    "mean_p_heavy": ver._f(df["p_heavy"].mean()), "mean_p_very": ver._f(df["p_very"].mean()),
                    "n_p_heavy_over_50": int((df["p_heavy"] >= 0.5).sum()), "n_p_very_over_50": int((df["p_very"] >= 0.5).sum())},
        "ranking": rank.head(25).astype(object).where(rank.head(25).notna(), None).to_dict("records"),
        "alerts": cards, "histogram": hist, "by_state": by_state[:15],
        "reliability": {"heavy": meta.get(str(cfg.heavy), {}).get("reliability", []), "very": meta.get(str(cfg.very_heavy), {}).get("reliability", [])},
        "model_skill": {"heavy": {k: meta.get(str(cfg.heavy), {}).get(k) for k in ("roc_auc", "brier", "precision", "recall", "f1", "prevalence")},
                        "very": {k: meta.get(str(cfg.very_heavy), {}).get(k) for k in ("roc_auc", "brier", "precision", "recall", "f1", "prevalence")}},
    }


# ------------------------------------------------------------------ advisory bulletin
def bulletin(run, lead, cfg) -> dict:
    _check_lead(lead)
    d = run.at(lead)
    df = pd.DataFrame(fs.records(d, cfg))
    dom = fs.dominant(d)
    rank = df.sort_values(["risk_score", "corrected"], ascending=False)
    counts = {k: int((df["alert"] == k).sum()) for k in al.LEVELS}
    peak = df.loc[df["corrected"].idxmax()]
    is_live = run.scenario == "live"
    rn, ra = (float("nan"), float("nan")) if is_live else (_rmse(d, "nwp_rainfall"), _rmse(d, "corrected"))
    valid_t = datetime.fromtimestamp(run.init_time.timestamp() + lead * 3600, tz=timezone.utc)
    sections = [
        {"heading": "Synoptic situation",
         "text": f"{dom['label']} is the dominant weather regime ({100 * dom['share']:.0f}% of {len(df)} monitored locations, mean regime confidence "
                 f"{100 * (dom['confidence'] or 0):.0f}%). Rainfall has been post-processed with the regime-specific model set; the {dom['model']} handles the dominant regime."},
        {"heading": f"Forecast valid {valid_t.strftime('%d %b %H:%M')} UTC ({LEAD_LABELS[lead]})",
         "text": f"Domain-mean 24-h rainfall: raw NWP {d['nwp_rainfall'].mean():.1f} mm, AI-corrected {d['corrected'].mean():.1f} mm. "
                 f"Highest AI-corrected rainfall {peak['corrected']:.0f} mm at {peak['district']}, {peak['state']} "
                 f"(P10-P90 {peak['q10']:.0f}-{peak['q90']:.0f} mm, regime {REGIME_SHORT[peak['regime']]})."},
        {"heading": "Risk summary",
         "text": f"{counts['Severe']} location(s) at SEVERE, {counts['Warning']} at WARNING and {counts['Watch']} at WATCH level "
                 f"(heavy >= {cfg.heavy} mm, very heavy >= {cfg.very_heavy} mm). Highest P(>= {cfg.very_heavy} mm) is "
                 f"{100 * df['p_very'].max():.0f}% at {df.loc[df['p_very'].idxmax(), 'district']}."},
    ]
    lines = []
    for r in rank[rank["alert"] != "Normal"].head(8).to_dict("records"):
        lines.append(f"{r['alert'].upper()}  {r['district']}, {r['state']}: AI {r['corrected']:.0f} mm (NWP {r['nwp']:.0f} mm), "
                     f"P(>={cfg.heavy}) {100 * r['p_heavy']:.0f}%, P(>={cfg.very_heavy}) {100 * r['p_very']:.0f}%, {REGIME_SHORT[r['regime']]} ({100 * r['confidence']:.0f}%)")
    sections.append({"heading": "Priority locations", "text": "\n".join(lines) if lines else "No location reaches Watch level for the selected thresholds."})
    st = (df[df["alert"].isin(["Warning", "Severe"])].groupby("state").size().sort_values(ascending=False).head(5))
    if len(st):
        sections.append({"heading": "Regions of concern", "text": "; ".join(f"{k} ({v} locations)" for k, v in st.items()) + "."})
    if is_live:
        val = vs.get_validation_frame()
        vn, va_ = ver.rmse(val["observed_rainfall"].values, val["nwp_rainfall"].values), ver.rmse(val["observed_rainfall"].values, val["corrected"].values)
        sections.append({"heading": "Forecast skill",
                         "text": f"No observed rainfall is available for this live forecast, so it cannot be verified. On held-out SIMULATED data the correction lowered RMSE by "
                                 f"{100 * (vn - va_) / vn:.0f}%; this is not evidence of skill on real forecasts."})
        sections.append({"heading": "Notice", "text": "Live NWP input from Open-Meteo, corrected by models trained on simulated data (unvalidated). Demonstration only; not an official IMD product."})
    else:
        sections.append({"heading": "Forecast skill in this run",
                         "text": f"Against simulated verifying observations, domain RMSE fell from {rn:.1f} mm (raw NWP) to {ra:.1f} mm (AI-corrected), "
                                 f"{100 * (rn - ra) / rn:.0f}% lower. {VALIDATION_NOTE}"})
        sections.append({"heading": "Notice", "text": f"{DATA_DISCLAIMER}. This bulletin is generated automatically from model outputs for demonstration only and is not an official IMD product."})
    issued = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    text = f"MONSOONAI RAINFALL ADVISORY - {run.meta['disclaimer'].upper()}\nIssued {issued} | Cycle {run.meta['forecast_cycle']} | Source: {run.meta['scenario_label']}\n\n" + "\n\n".join(f"{s['heading'].upper()}\n{s['text']}" for s in sections)
    return {"title": "MonsoonAI Rainfall Advisory", "issued": issued, "sections": sections, "text": text, "meta": _meta(run, lead, cfg)}


# ------------------------------------------------------------------ what-if Lab
def _custom_frame(body: dict) -> pd.DataFrame:
    lat, lon = float(body["latitude"]), float(body["longitude"])
    cd, _ = coast_distance(np.array([lat]), np.array([lon]))
    nwp = float(body["nwp_rainfall"])
    rad = np.radians(float(body["wind_direction"]))
    row = {
        "nwp_rainfall": nwp,
        "prev_rainfall": float(body.get("prev_rainfall") if body.get("prev_rainfall") is not None else nwp),
        "temperature": float(body["temperature"]), "humidity": float(body["humidity"]), "wind_speed": float(body["wind_speed"]),
        "wind_dir_sin": float(np.sin(rad)), "wind_dir_cos": float(np.cos(rad)), "pressure": float(body["pressure"]),
        "pressure_tendency": float(body.get("pressure_tendency") or 0.0), "elevation": float(body["elevation"]),
        "coast_dist_km": float(cd[0]), "latitude": lat, "longitude": lon,
        "spatial_coverage": float(body["spatial_coverage"]) if body.get("spatial_coverage") is not None else (0.6 if nwp >= WET_MM else 0.2),
        "nwp_nbr_mean": float(body["nwp_nbr_mean"]) if body.get("nwp_nbr_mean") is not None else nwp,
        "lead_time_hr": float(body.get("lead_time_hr") or 24),
    }
    return pd.DataFrame([row])[FEATURES]


def classify_custom(body: dict) -> dict:
    pipe = state.pipeline
    df = _custom_frame(body)
    proba = pipe.classify(df)[0]
    full = np.zeros(6)
    full[pipe.classifier.classes_.astype(int)] = proba
    k = int(full.argmax())
    probs = sorted(({"regime": g, "label": REGIME_LABELS[g], "probability": round(float(full[i]), 4)} for i, g in enumerate(REGIMES)), key=lambda x: -x["probability"])
    return {"regime": REGIMES[k], "label": REGIME_LABELS[REGIMES[k]], "confidence": round(float(full[k]), 4), "probabilities": probs,
            "explanation": pipe.explain_regime(df, top=10), "model": f"{REGIME_LABELS[REGIMES[k]]} Correction Model",
            "coast_dist_km": round(float(df["coast_dist_km"].iloc[0]), 1)}


def correct_custom(body: dict) -> dict:
    pipe = state.pipeline
    df = _custom_frame(body)
    cls = classify_custom(body)
    override = body.get("regime_override")
    reg = override if override else cls["regime"]
    if reg not in REGIMES:
        raise ValueError(f"unknown regime '{reg}'")
    regimes = np.array([reg])
    corr, lo, hi = pipe.correct(df, regimes)
    Xp = df.copy()
    Xp["corrected_rain"] = corr
    Xp["regime_code"] = REGIMES.index(reg)
    from ..ml.pipeline import PROB_FEATURES

    probs = np.array([pipe.probability[t].predict_proba(Xp[PROB_FEATURES].values.astype(float))[0, 1] for t in THRESHOLDS])
    probs = np.minimum.accumulate(probs)
    cat = fs.category_of(corr)[0]
    uni = float(np.clip(pipe.universal.predict(df[FEATURES].values.astype(float))[0], 0, None))
    qm = float(pipe.quantile_map(df["nwp_rainfall"].values)[0])
    all_regimes = []
    for g in REGIMES:
        c_g, lo_g, hi_g = pipe.correct(df, np.array([g]))
        all_regimes.append({"regime": g, "label": REGIME_LABELS[g], "corrected": round(float(c_g[0]), 1), "p10": round(float(lo_g[0]), 1), "p90": round(float(hi_g[0]), 1),
                            "classifier_probability": next(x["probability"] for x in cls["probabilities"] if x["regime"] == g)})
    return {
        "all_regimes": all_regimes, "classification": cls, "regime_used": reg, "regime_overridden": bool(override),
        "model_used": f"{REGIME_LABELS[reg]} Correction Model",
        "nwp": round(float(df["nwp_rainfall"].iloc[0]), 1), "corrected": round(float(corr[0]), 1), "p10": round(float(lo[0]), 1), "p90": round(float(hi[0]), 1),
        "universal_ml": round(uni, 1), "global_qm": round(qm, 1), "category": str(cat),
        "probabilities": {str(t): round(float(p), 4) for t, p in zip(THRESHOLDS, probs)},
        "explanation": pipe.explain_correction(df, reg, top=10),
        "note": "Values come from the trained models; the Lab uses your inputs as a single hypothetical grid point.",
    }
