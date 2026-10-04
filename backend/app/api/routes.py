"""HTTP API. Thin layer: validation + error mapping; all logic lives in services / ml."""
from __future__ import annotations

import platform
import secrets
import sys
from datetime import datetime, timezone
from typing import Optional

import fastapi
import pandas as pd
import sklearn
from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile

from ..config import (APP_NAME, APP_TAGLINE, APP_VERSION, DATA_DISCLAIMER, DATA_MODE, DEFAULT_HEAVY, DEFAULT_SCENARIO, DEFAULT_SEED,
                      DEFAULT_VERY_HEAVY, FEATURE_LABELS, FEATURES, FORECAST_CYCLE, LEADS, MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS, OPTIONAL_COLUMNS,
                      LIVE_KEY, LIVE_LABEL, LIVE_NOTE, REGIME_DESCRIPTIONS, REGIME_LABELS, REQUIRED_COLUMNS, SCENARIO_NOTES, SCENARIOS, THRESHOLDS, VALIDATION_NOTE)
from ..ml.catalog import get_catalog
from ..schemas.models import (ClassifyRequest, CorrectRequest, DashboardResponse, ForecastListResponse, GenerateRequest, GenerateResponse,
                              HealthResponse)
from ..services import alerts as al
from ..services import forecast_service as fs
from ..services import insights as ins
from ..services import upload_service as up
from ..services import verification_service as vs
from ..services.state import state

router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ dependencies
def require_ready() -> None:
    if not state.ready:
        raise RuntimeError(f"Models are not ready yet ({state.status}: {state.message})")


class Ctx:
    """Common query context: which simulated forecast run, lead time and alert thresholds."""

    def __init__(
        self,
        scenario: str = Query(DEFAULT_SCENARIO, description="Demo scenario key"),
        seed: int = Query(DEFAULT_SEED, ge=0, le=2_000_000_000),
        lead: int = Query(0, description=f"Forecast lead time in hours {LEADS}"),
        heavy: int = Query(DEFAULT_HEAVY, description=f"Heavy-rain threshold mm {THRESHOLDS}"),
        very_heavy: int = Query(DEFAULT_VERY_HEAVY, description=f"Very-heavy threshold mm {THRESHOLDS}"),
        watch_p: Optional[float] = Query(None, ge=0, le=1),
        warning_p: Optional[float] = Query(None, ge=0, le=1),
        severe_p: Optional[float] = Query(None, ge=0, le=1),
        min_conf: Optional[float] = Query(None, ge=0, le=1),
        _ready: None = Depends(require_ready),
    ):
        if scenario not in SCENARIOS and scenario != LIVE_KEY:
            raise ValueError(f"scenario must be one of {list(SCENARIOS) + [LIVE_KEY]}")
        if lead not in LEADS:
            raise ValueError(f"lead must be one of {LEADS}")
        self.cfg = fs.make_config(heavy, very_heavy, watch_p=watch_p, warning_p=warning_p, severe_p=severe_p, min_conf=min_conf)
        self.scenario, self.seed, self.lead = scenario, seed, lead
        self.run = fs.get_run(scenario, seed)


# ------------------------------------------------------------------ health / meta
@router.get("/health", response_model=HealthResponse, tags=["system"])
def health():
    return HealthResponse(status=state.status, ready=state.ready, message=state.message, models_loaded=state.pipeline.ready, data_mode=DATA_MODE,
                          version=APP_VERSION, log=state.log[-8:], error=state.error)


@router.get("/scenarios", tags=["forecast"])
def scenarios():
    return {"default": DEFAULT_SCENARIO, "default_seed": DEFAULT_SEED, "leads": LEADS, "thresholds": THRESHOLDS,
            "items": [{"key": k, "label": v, "note": SCENARIO_NOTES[k]} for k, v in SCENARIOS.items()] + [{"key": LIVE_KEY, "label": LIVE_LABEL, "note": LIVE_NOTE}]}


@router.post("/generate", response_model=GenerateResponse, tags=["forecast"])
def generate(body: GenerateRequest, _r: None = Depends(require_ready)):
    """Generate a new simulated forecast and run the full pipeline (data quality -> regime -> correction -> probability)."""
    if body.scenario == LIVE_KEY:
        seed = 0
        cached = (LIVE_KEY, 0) in fs._CACHE and not body.refresh
        run = fs.get_run(LIVE_KEY, 0, refresh=body.refresh)
    else:
        seed = body.seed if body.seed is not None else 10_000 + secrets.randbelow(900_000_000)
        cached = (body.scenario, seed) in fs._CACHE
        run = fs.get_run(body.scenario, seed)
    dom = fs.dominant(run.at(0))
    return GenerateResponse(scenario=body.scenario, scenario_label=run.meta["scenario_label"], seed=seed, generated_at=run.generated_at.isoformat(),
                            pipeline=run.trace, regime=dom, cached=cached)


# ------------------------------------------------------------------ forecast
@router.get("/dashboard", response_model=DashboardResponse, tags=["forecast"])
def dashboard(c: Ctx = Depends()):
    return ins.dashboard(c.run, c.lead, c.cfg)


@router.get("/forecast", response_model=ForecastListResponse, tags=["forecast"])
def forecast(c: Ctx = Depends(), page: int = Query(1, ge=1), page_size: int = Query(0, ge=0, le=1000, description="0 = all records"),
             search: Optional[str] = Query(None, max_length=60), regime: Optional[str] = None, alert: Optional[str] = Query(None, pattern="^(Normal|Watch|Warning|Severe)$"),
             sort: str = "risk_score", order: str = Query("desc", pattern="^(asc|desc)$")):
    return ins.forecast_list(c.run, c.lead, c.cfg, page, page_size, search, regime, alert, sort, order)


@router.get("/forecast/{district}", tags=["forecast"])
def forecast_district(district: str, c: Ctx = Depends()):
    return ins.district_detail(c.run, district, c.lead, c.cfg)


@router.get("/bulletin", tags=["forecast"])
def bulletin(c: Ctx = Depends()):
    return ins.bulletin(c.run, c.lead, c.cfg)


# ------------------------------------------------------------------ regimes
@router.get("/regimes", tags=["regimes"])
def regimes(c: Ctx = Depends()):
    return ins.regimes_view(c.run, c.lead, c.cfg)


@router.get("/regimes/{district}", tags=["regimes"])
def regime_district(district: str, c: Ctx = Depends()):
    return ins.regime_detail(c.run, district, c.lead, c.cfg)


@router.post("/classify-regime", tags=["regimes"])
def classify_regime(body: ClassifyRequest, _r: None = Depends(require_ready)):
    return ins.classify_custom(body.model_dump())


@router.post("/correct-forecast", tags=["forecast"])
def correct_forecast(body: CorrectRequest, _r: None = Depends(require_ready)):
    return ins.correct_custom(body.model_dump())


# ------------------------------------------------------------------ heavy rain
@router.get("/heavy-rainfall", tags=["forecast"])
def heavy_rainfall(c: Ctx = Depends()):
    return ins.heavy_rainfall(c.run, c.lead, c.cfg)


# ------------------------------------------------------------------ verification
@router.get("/verification", tags=["verification"])
def verification(c: Ctx = Depends(), scope: str = Query("scenario", pattern="^(scenario|validation)$"),
                 threshold: int = Query(25), radius_km: float = Query(150.0, ge=25, le=600),
                 all_leads: bool = Query(False, description="Verify all lead times together instead of the selected one")):
    if threshold not in THRESHOLDS:
        raise ValueError(f"threshold must be one of {THRESHOLDS}")
    lead = None if all_leads else c.lead
    if scope == "validation":
        return vs.verification("validation", None, None, lead, threshold, radius_km)
    return vs.verification("scenario", c.scenario, c.seed, lead, threshold, radius_km)


@router.get("/verification/regime-wise", tags=["verification"])
def verification_regime_wise(scenario: Optional[str] = Query(None, description="Scenario key; omit for all scenarios (validation scope)"), seed: int = Query(DEFAULT_SEED, ge=0, le=2_000_000_000),
                             scope: str = Query("validation", pattern="^(scenario|validation)$"), threshold: int = Query(25),
                             radius_km: float = Query(150.0, ge=25, le=600), _r: None = Depends(require_ready)):
    if threshold not in THRESHOLDS:
        raise ValueError(f"threshold must be one of {THRESHOLDS}")
    if scenario is not None and scenario not in SCENARIOS:
        raise ValueError(f"scenario must be one of {list(SCENARIOS)}")
    if scope == "scenario":
        return vs.regime_wise("scenario", scenario or DEFAULT_SCENARIO, seed, threshold, radius_km)
    return vs.regime_wise("validation", scenario, None, threshold, radius_km)


# ------------------------------------------------------------------ data quality / upload
@router.get("/data-quality", tags=["data"])
def data_quality(c: Ctx = Depends()):
    d = c.run.at(c.lead)
    feats = []
    for f in FEATURES:
        s = d[f]
        feats.append({"feature": f, "label": FEATURE_LABELS[f], "mean": round(float(s.mean()), 3), "min": round(float(s.min()), 3), "max": round(float(s.max()), 3), "std": round(float(s.std()), 3)})
    return {"meta": {**c.run.meta, "lead": c.lead}, "report": c.run.qc, "features": feats, "pipeline": c.run.trace[:3],
            "feature_note": "Features are computed from the cleaned feed. spatial_coverage and nwp_nbr_mean use a 250 km neighbourhood."}


@router.post("/upload", tags=["data"])
async def upload(file: UploadFile = File(...), _r: None = Depends(require_ready)):
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    df = up.parse_upload(file.filename, content)
    return up.process_upload(file.filename, df)


@router.get("/upload/{upload_id}/download", tags=["data"])
def upload_download(upload_id: str):
    data, name = up.results_csv(upload_id)
    return Response(content=data, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/sample-dataset", tags=["data"])
def sample_dataset(format: str = Query("csv", pattern="^(csv|json)$"), scenario: str = Query("orographic")):
    data, media, name = up.sample_dataset(format, scenario)
    return Response(content=data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/upload-spec", tags=["data"])
def upload_spec():
    return {"required_columns": REQUIRED_COLUMNS, "optional_columns": OPTIONAL_COLUMNS, "max_bytes": MAX_UPLOAD_BYTES, "max_rows": MAX_UPLOAD_ROWS, "formats": ["csv", "json"],
            "units": {"nwp_rainfall": "mm/24h", "observed_rainfall": "mm/24h", "temperature": "degC", "humidity": "%", "wind_speed": "m/s", "wind_direction": "deg",
                      "pressure": "hPa (MSLP)", "elevation": "m", "timestamp": "ISO-8601"}}


# ------------------------------------------------------------------ models / system
_MODEL_CARDS = [
    {"id": "classifier", "name": "Model 1 - Weather Regime Classifier", "algorithm": "Random Forest (140 trees)", "input": "Meteorological + spatial features (15)",
     "output": "Weather regime + class probabilities (confidence)",
     "purpose": "Decides which of six regimes the atmosphere is in at every grid point so the right correction model can be selected."},
    {"id": "correction", "name": "Model 2 - Regime-Specific Bias Correction", "algorithm": "6 x HistGradientBoosting regressors (+ P10 / P90 quantile models)",
     "input": "NWP + weather + spatial features (16)", "output": "Corrected rainfall (mm) + P10-P90 range",
     "purpose": "One model per regime learns that regime's own NWP error signature instead of applying a single universal correction."},
    {"id": "probability", "name": "Model 3 - Heavy Rainfall Probability", "algorithm": "4 x HistGradientBoosting classifiers (10 / 25 / 50 / 100 mm)",
     "input": "Forecast + weather + corrected rainfall + regime", "output": "Threshold-exceedance probabilities",
     "purpose": "Estimates P(rainfall >= threshold); probabilities are forced to be non-increasing with threshold."},
]


@router.get("/model-info", tags=["system"])
def model_info(_r: None = Depends(require_ready)):
    m = state.pipeline.meta
    return {"trained_at": m["trained_at"], "training_seconds": m.get("training_seconds"), "data_mode": DATA_DISCLAIMER, "validation_note": VALIDATION_NOTE,
            "cards": _MODEL_CARDS, "train_rows": m["train_rows"], "val_rows": m["val_rows"], "features": [{"key": f, "label": FEATURE_LABELS[f]} for f in FEATURES],
            "classifier_features": m["classifier_features"], "library_versions": m["library_versions"], "regime_train_rows": m["regime_train_rows"],
            "classifier": m["classifier"], "correctors": list(m["correctors"].values()), "probability": m["probability"], "correction_params": m["correction_params"],
            "overall_validation": m["overall_validation"], "end_to_end_by_predicted_regime": m["end_to_end_by_predicted_regime"],
            "train_seeds": m["train_seeds"], "val_seeds": m["val_seeds"], "regimes": [{"key": k, "label": v, "description": REGIME_DESCRIPTIONS[k]} for k, v in REGIME_LABELS.items()]}


@router.get("/system-info", tags=["system"])
def system_info(request: Request):
    cat = get_catalog()
    now = datetime.now(timezone.utc)
    ep = sorted({(m, r.path, (r.summary or r.name or "").replace("_", " ")) for r in request.app.routes if hasattr(r, "methods") and r.path.startswith("/api")
                 for m in r.methods if m in ("GET", "POST")}, key=lambda x: (x[1], x[0]))
    return {
        "app": {"name": APP_NAME, "tagline": APP_TAGLINE, "version": APP_VERSION}, "data_mode": DATA_MODE, "disclaimer": DATA_DISCLAIMER, "validation_note": VALIDATION_NOTE,
        "forecast_cycle": FORECAST_CYCLE,
        "status": {"state": state.status, "message": state.message, "ready": state.ready, "started_at": state.started_at.isoformat(),
                   "ready_at": state.ready_at.isoformat() if state.ready_at else None, "uptime_s": round((now - state.started_at).total_seconds()),
                   "cached_runs": len(fs._CACHE)},
        "environment": {"python": platform.python_version(), "platform": platform.platform(), "fastapi": fastapi.__version__, "scikit_learn": sklearn.__version__, "pandas": pd.__version__},
        "catalog": {"locations": int(len(cat)), "named_districts": int(cat["is_district"].sum()), "grid_cells": int((~cat["is_district"]).sum()),
                    "states": int(cat["state"].nunique()), "grid_spacing_deg": 0.62},
        "limits": {"max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024), "max_upload_rows": MAX_UPLOAD_ROWS, "leads_hr": LEADS, "thresholds_mm": THRESHOLDS},
        "endpoints": [{"method": m, "path": p, "summary": s} for m, p, s in ep],
        "alert_rules": al.RULES, "alert_defaults": al.AlertConfig().as_dict(),
        "limitations": [
            "Live mode uses real Open-Meteo NWP forecasts as input, but the ML models are trained on simulated data, so live corrections are unvalidated and there is no observed-rainfall feed to verify them.",
            "All meteorological data outside Live mode is simulated (Prototype / Demonstration Data); no real NWP or observations are ingested.",
            "Models are trained and validated only on the simulator, whose regime-specific error structure is designed by the authors - measured improvements demonstrate the method, not real-world skill.",
            "No IMD validation, operational verification or deployment readiness is claimed.",
            "District values are point/grid-cell estimates; grid cells inherit the state of the nearest named district and are approximate.",
            "A regime-blind machine-learning baseline performs about as well as the regime-specific models on simulated data; the clear gain is versus raw NWP and versus a single global bias correction.",
        ],
        "future": ["IMD gridded / station datasets", "Satellite (GPM) and radar rainfall", "ERA5 reanalysis", "Higher-resolution NWP and ensembles", "ConvLSTM / Transformer post-processing", "Real-time alert dissemination", "Cloud deployment"],
    }
