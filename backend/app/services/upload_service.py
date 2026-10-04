"""Safe CSV/JSON upload handling.

Security posture: uploaded bytes are parsed in memory with pandas / json only. Nothing is written to disk,
evaluated, imported or executed; file names are sanitised and used for display only.
"""
from __future__ import annotations

import io
import json
import re
import secrets
import time
from collections import OrderedDict
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ..config import ALLOWED_UPLOAD_EXT, MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS, OPTIONAL_COLUMNS, REGIME_LABELS, REQUIRED_COLUMNS, SCENARIOS
from ..ml import verification as ver
from ..ml.features import engineer_features
from ..ml.quality import run_quality
from ..ml.simulation import simulate_forecast
from . import alerts as al
from . import forecast_service as fs
from .state import state

_UPLOADS: "OrderedDict[str, dict]" = OrderedDict()
ALIASES = {"lat": "latitude", "lon": "longitude", "lng": "longitude", "long": "longitude", "time": "timestamp", "datetime": "timestamp", "date": "timestamp",
           "rain_nwp": "nwp_rainfall", "nwp_rain": "nwp_rainfall", "forecast_rainfall": "nwp_rainfall", "obs_rainfall": "observed_rainfall",
           "rain_obs": "observed_rainfall", "temp": "temperature", "rh": "humidity", "wind_dir": "wind_direction", "wdir": "wind_direction",
           "wspd": "wind_speed", "mslp": "pressure", "elev": "elevation", "lead_time": "lead_time_hr"}


class UploadError(Exception):
    def __init__(self, status: int, code: str, message: str, details: list | dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details


def sanitize_filename(name: str | None) -> str:
    base = re.split(r"[\\/]", name or "upload")[-1]
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .")[:80]
    return base or "upload"


def _csv_safe(v):
    """Neutralise spreadsheet formula injection in text cells written back out."""
    return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v


def parse_upload(filename: str | None, content: bytes) -> pd.DataFrame:
    name = sanitize_filename(filename)
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_UPLOAD_EXT:
        raise UploadError(415, "unsupported_file_type", f"Only CSV and JSON files are accepted (got '{ext or 'no extension'}').")
    if len(content) == 0:
        raise UploadError(422, "empty_file", "The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise UploadError(413, "file_too_large", f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.")
    if b"\x00" in content[:4096]:
        raise UploadError(422, "binary_content", "The file appears to be binary, not text.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    try:
        if ext == ".json":
            data = json.loads(text)
            if isinstance(data, dict):
                data = next((data[k] for k in ("records", "data", "rows") if isinstance(data.get(k), list)), None)
            if not isinstance(data, list) or not data or not all(isinstance(r, dict) for r in data[:50]):
                raise UploadError(422, "malformed_json", "JSON must be a non-empty list of record objects (or {\"records\": [...]}).")
            df = pd.DataFrame(data)
        else:
            df = pd.read_csv(io.StringIO(text), nrows=MAX_UPLOAD_ROWS + 1, skipinitialspace=True)
    except UploadError:
        raise
    except (json.JSONDecodeError, pd.errors.ParserError, pd.errors.EmptyDataError, ValueError) as exc:
        raise UploadError(422, "malformed_file", f"Could not parse the file: {str(exc)[:200]}") from exc
    if df.shape[1] > 60:
        raise UploadError(422, "too_many_columns", "Too many columns (limit 60).")
    if len(df) > MAX_UPLOAD_ROWS:
        raise UploadError(413, "too_many_rows", f"Row limit exceeded ({MAX_UPLOAD_ROWS:,} rows max).")
    if len(df) == 0:
        raise UploadError(422, "empty_dataset", "The file contains a header but no data rows.")
    df.columns = [ALIASES.get(re.sub(r"[^a-z0-9]+", "_", str(c).strip().lower()).strip("_"), re.sub(r"[^a-z0-9]+", "_", str(c).strip().lower()).strip("_")) for c in df.columns]
    df = df.loc[:, ~df.columns.duplicated()]
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise UploadError(422, "missing_columns", f"Missing required column(s): {', '.join(missing)}",
                          {"missing": missing, "found": list(df.columns), "required": REQUIRED_COLUMNS})
    return df


def sample_dataset(fmt: str = "csv", scenario: str = "orographic", seed: int = 2024) -> tuple[bytes, str, str]:
    if scenario not in SCENARIOS:
        raise ValueError(f"unknown scenario '{scenario}'")
    raw = simulate_forecast(scenario, seed, leads=[0, 24])
    df = raw[REQUIRED_COLUMNS].copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True).dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    if fmt == "json":
        return json.dumps({"records": json.loads(df.to_json(orient="records"))}, indent=1).encode(), "application/json", "monsoonai_sample_dataset.json"
    return df.to_csv(index=False).encode(), "text/csv", "monsoonai_sample_dataset.csv"


def _derive_optional(df: pd.DataFrame, notes: list[str]) -> pd.DataFrame:
    df = df.copy()
    df["_ts"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
    key = df["latitude"].round(3).astype(str) + "|" + df["longitude"].round(3).astype(str)
    df = df.assign(_key=key).sort_values(["_key", "_ts"])
    multi = df.groupby("_key")["_ts"].transform("nunique") > 1
    if "prev_rainfall" not in df:
        df["prev_rainfall"] = df.groupby("_key")["observed_rainfall"].shift(1)
        notes.append("prev_rainfall derived from the previous timestamp's observed rainfall at the same location"
                     + ("" if multi.any() else " (single timestamp: neighbourhood NWP mean used as a proxy)"))
    if "pressure_tendency" not in df:
        df["pressure_tendency"] = df.groupby("_key")["pressure"].diff()
        notes.append("pressure_tendency derived from successive pressure values" + ("" if multi.any() else " (single timestamp: set to 0 - regime detection is less reliable)"))
    if "lead_time_hr" not in df:
        df["lead_time_hr"] = 24
        notes.append("lead_time_hr not supplied: assumed 24 h")
    return df.drop(columns=["_key", "_ts"]).sort_index()


def process_upload(filename: str | None, df_in: pd.DataFrame) -> dict:
    pipe = state.pipeline
    if not pipe.ready:
        raise RuntimeError("Models are not ready")
    steps: list[dict] = []
    notes: list[str] = []
    name = sanitize_filename(filename)

    def step(sid, label, t0, detail, ms=None):
        steps.append({"id": sid, "name": label, "status": "done", "ms": ms if ms is not None else round(1000 * (time.perf_counter() - t0), 1), "detail": detail})

    t = time.perf_counter()
    step("upload", "Upload & parse", t, f"{len(df_in):,} rows x {df_in.shape[1]} columns read in memory (never executed)")
    t = time.perf_counter()
    raw = _derive_optional(df_in, notes)
    for c in OPTIONAL_COLUMNS:
        if c in raw:
            raw[c] = pd.to_numeric(raw[c], errors="coerce")
    try:
        clean, qc = run_quality(raw)
    except ValueError as exc:
        raise UploadError(422, "no_valid_records", str(exc)) from exc
    step("quality", "Validate & quality check", t, f"score {qc['quality_score']:.1f}/100, {qc['records_retained']:,} of {qc['records_processed']:,} rows usable")
    t = time.perf_counter()
    feat = engineer_features(clean, group_cols=["timestamp", "lead_time_hr"])
    step("features", "Feature engineering", t, "16 model features derived (coastal proximity, wind vectors, spatial coverage ...)")
    tm: dict = {}
    pred = pipe.run(feat, tm)
    full = pd.concat([feat, pred], axis=1)
    step("regime", "Regime classification", t, f"{full['regime'].nunique()} regime(s) detected", tm["regime_ms"])
    step("correction", "Bias correction", t, "regime-specific models routed per record", tm["correction_ms"])
    step("probability", "Probability prediction", t, "P(rain >= 10 / 25 / 50 / 100 mm)", tm["probability_ms"])

    full["error_nwp"] = full["nwp_rainfall"] - full["observed_rainfall"]
    full["error_ai"] = full["corrected"] - full["observed_rainfall"]
    full["category"] = fs.category_of(full["corrected"])
    cfg = al.AlertConfig()
    lvl, low, score = al.evaluate(full, cfg)
    full["alert"] = np.array(al.LEVELS)[lvl]

    ood = pipe.out_of_range_share(full)
    warnings = list(notes)
    if ood > 0.10:
        warnings.append(f"{100 * ood:.0f}% of rows fall outside the value ranges the models were trained on - treat results as a pipeline demonstration only.")
    warnings.append("Models were trained on simulated data; results on other datasets are not validated.")

    verification = None
    if full["observed_rainfall"].notna().sum() >= 20:
        groups = (full["timestamp"].astype(str) + "|" + full["lead_time_hr"].astype(str)).values
        verification = {"threshold": 25, "n": int(full["observed_rainfall"].notna().sum()), "sources": {}}
        for key, col in [("nwp", "nwp_rainfall"), ("global_qm", "global_qm"), ("universal", "universal"), ("regime_aware", "corrected")]:
            verification["sources"][key] = ver.score_all(full["observed_rainfall"].values, full[col].values, 25, full["latitude"].values, full["longitude"].values, groups, 150.0)
        verification["improvement"] = ver.improvement(verification["sources"]["nwp"], verification["sources"]["regime_aware"])

    mix = fs.regime_mix(full)
    cols = {"district": "district", "state": "state", "latitude": "lat", "longitude": "lon", "timestamp": "timestamp", "regime": "regime", "regime_conf": "confidence",
            "nwp_rainfall": "nwp", "corrected": "corrected", "corrected_p10": "q10", "corrected_p90": "q90", "observed_rainfall": "observed", "error_ai": "error_ai",
            "error_nwp": "error_nwp", f"p_ge_{cfg.heavy}": "p_heavy", f"p_ge_{cfg.very_heavy}": "p_very", "category": "category", "alert": "alert"}
    out = full[list(cols)].rename(columns=cols).copy()
    for c in out.select_dtypes("number").columns:
        out[c] = out[c].round(3 if c in ("confidence", "p_heavy", "p_very") else 2)
    out["district"] = out["district"].astype(str).str.slice(0, 80)
    out["state"] = out["state"].astype(str).str.slice(0, 60)
    out["regime_label"] = out["regime"].map(REGIME_LABELS)
    out["risk_score"] = np.round(score, 4)
    out = out.sort_values("risk_score", ascending=False).reset_index(drop=True)
    uid = secrets.token_urlsafe(9)
    _UPLOADS[uid] = {"df": out, "filename": name, "created": datetime.now(timezone.utc)}
    while len(_UPLOADS) > 6:
        _UPLOADS.popitem(last=False)
    limit = 400
    rows = out.head(limit).astype(object).where(out.head(limit).notna(), None).to_dict("records")
    return {
        "upload_id": uid, "filename": name, "rows_in": int(len(df_in)), "rows_used": int(len(full)),
        "derived": notes, "warnings": warnings, "steps": steps, "quality": qc,
        "regime_mix": mix, "dominant": fs.dominant(full), "alert_counts": {k: int((full["alert"] == k).sum()) for k in al.LEVELS},
        "out_of_range_share": round(ood, 4), "verification": verification,
        "rows": rows, "truncated": bool(len(out) > limit), "download_url": f"/api/upload/{uid}/download",
        "mean": {"nwp": ver._f(full["nwp_rainfall"].mean()), "corrected": ver._f(full["corrected"].mean()), "observed": ver._f(full["observed_rainfall"].mean())},
    }


def results_csv(uid: str) -> tuple[bytes, str]:
    item = _UPLOADS.get(uid)
    if item is None:
        raise LookupError("Upload result not found (results are kept in memory for this session only)")
    df = item["df"].copy()
    for c in df.select_dtypes(include=["object", "string"]).columns:
        df[c] = df[c].map(_csv_safe)
    return df.to_csv(index=False).encode(), f"monsoonai_results_{sanitize_filename(item['filename']).rsplit('.', 1)[0]}.csv"
