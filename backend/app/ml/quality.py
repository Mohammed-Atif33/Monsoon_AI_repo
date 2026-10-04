"""Data-quality checks + cleaning. Every number in the report is computed from the data."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from ..config import REQUIRED_COLUMNS

NUM_FIELDS = ["nwp_rainfall", "observed_rainfall", "temperature", "humidity", "wind_speed", "wind_direction", "pressure", "elevation"]
WEATHER_FIELDS = ["temperature", "humidity", "wind_speed", "wind_direction", "pressure", "elevation", "nwp_rainfall"]
# physical plausibility ranges (inclusive)
RANGES = {
    "nwp_rainfall": (0.0, 1000.0),
    "observed_rainfall": (0.0, 1000.0),
    "temperature": (-45.0, 55.0),
    "humidity": (0.0, 100.0),
    "wind_speed": (0.0, 75.0),
    "wind_direction": (0.0, 360.0),
    "pressure": (850.0, 1100.0),
    "elevation": (-50.0, 8900.0),
}
INDIA_BBOX = (6.0, 38.0, 67.0, 98.0)  # lat_min, lat_max, lon_min, lon_max


def _impute_spatial(df: pd.DataFrame, col: str, mask: np.ndarray, k: int = 5) -> int:
    """Fill df.loc[mask, col] with the median of the k nearest valid points (same timestamp)."""
    filled = 0
    fallback = float(pd.to_numeric(df.loc[~mask, col], errors="coerce").median())
    if np.isnan(fallback):
        fallback = 0.0
    idxs = np.flatnonzero(mask)
    if idxs.size == 0:
        return 0
    key = df["timestamp"].astype(str).values if "timestamp" in df else np.zeros(len(df))
    for ts in np.unique(key[idxs]):
        grp = np.flatnonzero(key == ts)
        bad = grp[mask[grp]]
        good = grp[~mask[grp]]
        if len(good) == 0:
            df.iloc[bad, df.columns.get_loc(col)] = fallback
            filled += len(bad)
            continue
        tree = BallTree(np.radians(df[["latitude", "longitude"]].values[good]), metric="haversine")
        kk = min(k, len(good))
        _, nn = tree.query(np.radians(df[["latitude", "longitude"]].values[bad]), k=kk)
        vals = df[col].values[good][nn]
        df.iloc[bad, df.columns.get_loc(col)] = np.median(vals, axis=1)
        filled += len(bad)
    return filled


def run_quality(raw: pd.DataFrame, injected: dict | None = None, reference: pd.DataFrame | None = None):
    """Validate + clean a raw feed. Returns (clean_df, report)."""
    df = raw.copy().reset_index(drop=True)
    n_in = len(df)
    report: dict = {"records_processed": int(n_in)}
    if n_in == 0:
        raise ValueError("Empty dataset - nothing to process")
    for c in NUM_FIELDS + ["latitude", "longitude"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    flags = np.zeros(n_in, bool)  # any defect at ingest
    checks = []

    def add(cid, name, desc, affected, action, unit="records", severity="warn"):
        rate = affected / max(n_in, 1)
        checks.append({
            "id": cid, "name": name, "description": desc, "affected": int(affected),
            "rate_pct": round(100 * rate, 3), "unit": unit, "action": action,
            "status": "pass" if affected == 0 else severity,
        })

    # -- 1. timestamps
    ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
    bad_ts = ts.isna().values
    add("timestamp", "Missing / unparseable timestamps", "Every record needs a valid ISO-8601 timestamp.", bad_ts.sum(), "Row dropped", severity="fail")
    flags |= bad_ts
    df["timestamp"] = ts.dt.strftime("%Y-%m-%dT%H:%M:%S%z").fillna("")

    # -- 2. coordinates
    la0, la1, lo0, lo1 = INDIA_BBOX
    bad_xy = (~df["latitude"].between(la0, la1)) | (~df["longitude"].between(lo0, lo1)) | df["latitude"].isna() | df["longitude"].isna()
    bad_xy = bad_xy.values
    bad_xy_orig = bad_xy.copy()
    n_bad_xy = int(bad_xy.sum())
    repaired_xy = 0
    if reference is not None and "location_id" in df and n_bad_xy:
        ref = reference.set_index("id")[["latitude", "longitude"]]
        known = df["location_id"].isin(ref.index).values & bad_xy
        if known.any():
            df.loc[known, "latitude"] = ref.loc[df.loc[known, "location_id"], "latitude"].values
            df.loc[known, "longitude"] = ref.loc[df.loc[known, "location_id"], "longitude"].values
            repaired_xy = int(known.sum())
            bad_xy = bad_xy & ~known
    add("coordinates", "Invalid coordinates", f"Latitude {la0}-{la1}N, longitude {lo0}-{lo1}E (India domain).", n_bad_xy,
        f"{repaired_xy} repaired from station metadata, {int(bad_xy.sum())} dropped" if repaired_xy else "Row dropped", severity="fail")
    flags |= bad_xy_orig

    # -- 3. duplicates
    key_cols = ["timestamp", "latitude", "longitude"] + [c for c in ("lead_time_hr", "run") if c in df]
    dup = df.duplicated(subset=key_cols, keep="first").values
    add("duplicates", "Duplicate records", "Same timestamp + location (+ lead time) appearing more than once.", dup.sum(), "Duplicate removed", severity="fail")
    flags |= dup

    # -- 4. unit consistency (column level, checked on rows that pass the hard checks)
    ok_rows = ~(bad_ts | bad_xy | dup)
    units_converted = 0
    unit_rows = 0
    t = df.loc[ok_rows, "temperature"]
    if t.notna().any() and t.median() > 150:
        df["temperature"] = df["temperature"] - 273.15
        units_converted += 1
        unit_rows += int(ok_rows.sum())
    p = df.loc[ok_rows, "pressure"]
    if p.notna().any() and p.median() > 5000:
        df["pressure"] = df["pressure"] / 100.0
        units_converted += 1
        unit_rows += int(ok_rows.sum())
    h = df.loc[ok_rows, "humidity"]
    if h.notna().any() and h.max() <= 1.5 and h.median() > 0:
        df["humidity"] = df["humidity"] * 100.0
        units_converted += 1
        unit_rows += int(ok_rows.sum())
    add("units", "Inconsistent units", "Temperature in K, pressure in Pa or humidity as a fraction are detected and converted.", unit_rows, f"{units_converted} column(s) converted", unit="cells", severity="warn")

    # -- 5. missing values
    miss_cells = 0
    miss_rows = np.zeros(n_in, bool)
    per_col_missing = {}
    for c in NUM_FIELDS:
        m = df[c].isna().values
        per_col_missing[c] = int(m.sum())
        miss_cells += int(m.sum())
        if c != "observed_rainfall":
            miss_rows |= m
    add("missing", "Missing values", "Blank / NaN weather fields (excluding observed rainfall, which is only needed for verification).", int(miss_rows.sum()), "Imputed from nearest valid neighbours", severity="warn")
    flags |= miss_rows

    # -- 6/7/8. range checks
    invalid_cells = 0
    range_masks = {}
    for c, (lo, hi) in RANGES.items():
        m = (df[c] < lo) | (df[c] > hi)
        m = m.fillna(False).values
        range_masks[c] = m
        invalid_cells += int(m.sum())
    rain_bad = range_masks["nwp_rainfall"] | range_masks["observed_rainfall"]
    add("rainfall", "Invalid rainfall", "Rainfall must lie in 0-1000 mm / 24h (sentinel values like -999 are rejected).", rain_bad.sum(), "NWP imputed; observed excluded from verification", severity="warn")
    add("temperature", "Unrealistic temperature", "Air temperature outside -45 to 55 C.", range_masks["temperature"].sum(), "Imputed from nearest valid neighbours")
    other = range_masks["humidity"] | range_masks["wind_speed"] | range_masks["wind_direction"] | range_masks["pressure"] | range_masks["elevation"]
    add("ranges", "Other out-of-range values", "Humidity 0-100 %, wind 0-75 m/s, direction 0-360, pressure 850-1100 hPa, elevation -50-8900 m.", other.sum(), "Imputed from nearest valid neighbours")
    flags |= rain_bad | range_masks["temperature"] | other

    # invalid -> NaN, then repair
    for c, m in range_masks.items():
        df.loc[m, c] = np.nan
    valid_geo = ~(bad_ts | bad_xy | dup)
    clean = df[valid_geo].reset_index(drop=True)
    dropped = int(n_in - len(clean))
    if len(clean) == 0:
        raise ValueError("No valid records remain after quality control")

    imputed = 0
    for c in WEATHER_FIELDS:
        m = clean[c].isna().values
        if m.any():
            imputed += _impute_spatial(clean, c, m)
    obs_excluded = int(clean["observed_rainfall"].isna().sum())

    # -- 9. statistical outliers (flag only; heavy-tailed rainfall is not tested)
    stat_out = np.zeros(len(clean), bool)
    for c in ["temperature", "humidity", "wind_speed", "pressure"]:
        x = clean[c].values
        med = np.nanmedian(x)
        mad = np.nanmedian(np.abs(x - med)) * 1.4826
        if mad > 1e-6:
            stat_out |= np.abs(x - med) / mad > 8.0
    add("outliers", "Statistical outliers", "Robust z-score > 8 on temperature, humidity, wind speed or pressure.", stat_out.sum(), "Retained and flagged", severity="warn")

    n_valid_clean = int((~flags).sum())
    completeness = 1 - miss_cells / (n_in * len(NUM_FIELDS))
    validity = 1 - invalid_cells / (n_in * len(NUM_FIELDS))
    uniqueness = 1 - dup.sum() / n_in
    row_validity = n_valid_clean / n_in
    score = 100 * (0.40 * row_validity + 0.30 * completeness + 0.20 * validity + 0.10 * uniqueness)

    report.update({
        "records_retained": int(len(clean)),
        "records_dropped": dropped,
        "valid_records": n_valid_clean,
        "missing_values": int(miss_cells),
        "outliers": int(invalid_cells + stat_out.sum()),
        "invalid_values": int(invalid_cells),
        "statistical_outliers": int(stat_out.sum()),
        "duplicates": int(dup.sum()),
        "invalid_coordinates": int(n_bad_xy),
        "coordinates_repaired": int(repaired_xy),
        "missing_timestamps": int(bad_ts.sum()),
        "imputed_cells": int(imputed),
        "observed_excluded": obs_excluded,
        "units_converted": int(units_converted),
        "quality_score": round(float(score), 2),
        "score_components": {
            "row_validity": round(100 * row_validity, 2),
            "completeness": round(100 * completeness, 2),
            "validity": round(100 * validity, 2),
            "uniqueness": round(100 * uniqueness, 2),
        },
        "score_formula": "100 x (0.40 row validity + 0.30 completeness + 0.20 value validity + 0.10 uniqueness)",
        "checks": checks,
        "column_completeness": [
            {"column": c, "missing": per_col_missing[c], "completeness_pct": round(100 * (1 - per_col_missing[c] / n_in), 2)}
            for c in NUM_FIELDS
        ],
        "grade": "Excellent" if score >= 97 else "Good" if score >= 92 else "Fair" if score >= 80 else "Poor",
    })
    if injected is not None:
        report["injected_defects"] = injected
        report["injected_note"] = "Synthetic defects were injected into the simulated feed to demonstrate the QC stage."
    return clean, report


def missing_required_columns(cols) -> list[str]:
    return [c for c in REQUIRED_COLUMNS if c not in set(cols)]
