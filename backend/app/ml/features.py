"""Feature engineering shared by training, inference and uploads."""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import FEATURES
from ..utils.geo import coast_distance, neighbour_lists

COVERAGE_RADIUS_KM = 250.0
WET_MM = 2.5


def add_spatial_features(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """spatial_coverage = share of neighbours (<=250 km) with NWP >= 2.5 mm, nwp_nbr_mean = their mean NWP."""
    cov = np.zeros(len(df))
    nbm = np.zeros(len(df))
    lat_all, lon_all, nwp_all = df["latitude"].values, df["longitude"].values, df["nwp_rainfall"].values
    for _, idx in df.groupby(group_cols, sort=False).indices.items():
        idx = np.asarray(idx)
        flat, starts, counts = neighbour_lists(lat_all[idx], lon_all[idx], COVERAGE_RADIUS_KM)
        v = nwp_all[idx]
        cov[idx] = np.add.reduceat((v[flat] >= WET_MM).astype(float), starts) / counts
        nbm[idx] = np.add.reduceat(v[flat], starts) / counts
    df["spatial_coverage"] = cov
    df["nwp_nbr_mean"] = nbm
    return df


def engineer_features(clean: pd.DataFrame, group_cols: list[str] | None = None) -> pd.DataFrame:
    """Return a copy of `clean` with all model features added."""
    df = clean.copy().reset_index(drop=True)
    if group_cols is None:
        group_cols = [c for c in ["run", "timestamp", "lead_time_hr"] if c in df.columns]
    if not group_cols:
        group_cols = ["timestamp"]
    cd, _ = coast_distance(df["latitude"].values, df["longitude"].values)
    if "coast_dist_km" not in df:
        df["coast_dist_km"] = cd
    rad = np.radians(df["wind_direction"].values)
    df["wind_dir_sin"] = np.sin(rad)
    df["wind_dir_cos"] = np.cos(rad)
    df = add_spatial_features(df, group_cols)
    if "prev_rainfall" not in df:
        df["prev_rainfall"] = df["nwp_nbr_mean"]
    if "pressure_tendency" not in df:
        df["pressure_tendency"] = 0.0
    if "lead_time_hr" not in df:
        df["lead_time_hr"] = 24
    df["prev_rainfall"] = df["prev_rainfall"].fillna(df["nwp_nbr_mean"])
    df["pressure_tendency"] = df["pressure_tendency"].fillna(0.0)
    df["lead_time_hr"] = df["lead_time_hr"].fillna(24)
    return df


def feature_matrix(df: pd.DataFrame, cols: list[str] | None = None) -> np.ndarray:
    return df[cols or FEATURES].values.astype(np.float64)
