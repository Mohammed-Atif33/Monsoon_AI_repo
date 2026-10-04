"""Forecast verification engine - all scores implemented from first principles with NumPy.

Continuous:   RMSE, MAE, Bias (mean error), R^2
Categorical:  POD, FAR, CSI, ETS, frequency bias  (event: rainfall >= threshold)
Spatial:      FSS  (Fractions Skill Score, Roberts & Lean 2008) using a circular
              neighbourhood of `radius_km` around every point, evaluated per forecast field.
"""
from __future__ import annotations

import math

import numpy as np

from ..utils.geo import neighbour_lists

EPS = 1e-12


def _f(x):
    """JSON-safe float (NaN -> None)."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(x) or math.isinf(x)) else round(x, 4)


# ------------------------------------------------------------------ continuous
def rmse(obs, fc) -> float:
    return float(np.sqrt(np.mean((fc - obs) ** 2))) if len(obs) else float("nan")


def mae(obs, fc) -> float:
    return float(np.mean(np.abs(fc - obs))) if len(obs) else float("nan")


def bias(obs, fc) -> float:
    return float(np.mean(fc - obs)) if len(obs) else float("nan")


def r2(obs, fc) -> float:
    if len(obs) < 2:
        return float("nan")
    ss_res = float(np.sum((obs - fc) ** 2))
    ss_tot = float(np.sum((obs - obs.mean()) ** 2))
    return 1 - ss_res / ss_tot if ss_tot > EPS else float("nan")


# ------------------------------------------------------------------ categorical
def contingency(obs, fc, thr: float) -> dict:
    o = obs >= thr
    f = fc >= thr
    h = int(np.sum(o & f))
    m = int(np.sum(o & ~f))
    fa = int(np.sum(~o & f))
    cn = int(np.sum(~o & ~f))
    n = h + m + fa + cn
    pod = h / (h + m) if (h + m) else float("nan")
    far = fa / (h + fa) if (h + fa) else float("nan")
    csi = h / (h + m + fa) if (h + m + fa) else float("nan")
    hits_random = (h + m) * (h + fa) / n if n else float("nan")
    denom = h + m + fa - hits_random
    ets = (h - hits_random) / denom if (n and denom > EPS) else float("nan")
    fbias = (h + fa) / (h + m) if (h + m) else float("nan")
    return {"hits": h, "misses": m, "false_alarms": fa, "correct_negatives": cn,
            "pod": pod, "far": far, "csi": csi, "ets": ets, "freq_bias": fbias}


def fss(obs, fc, thr: float, lat, lon, groups, radius_km: float = 150.0, mask=None) -> float:
    """Fractions Skill Score. `groups` labels independent forecast fields (e.g. run+lead).

    Fractions are always computed from the complete field; `mask` (optional) restricts which
    points contribute to the score (used for regime-wise FSS)."""
    obs, fc = np.asarray(obs, float), np.asarray(fc, float)
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    groups = np.asarray(groups)
    num = den = 0.0
    order = np.argsort(groups, kind="stable")
    g_sorted = groups[order]
    bounds = np.flatnonzero(np.concatenate([[True], g_sorted[1:] != g_sorted[:-1], [True]]))
    for a, b in zip(bounds[:-1], bounds[1:]):
        idx = order[a:b]
        valid = ~np.isnan(obs[idx])
        idx = idx[valid]
        if len(idx) == 0:
            continue
        flat, starts, counts = neighbour_lists(lat[idx], lon[idx], radius_km)
        po = np.add.reduceat((obs[idx][flat] >= thr).astype(float), starts) / counts
        pf = np.add.reduceat((fc[idx][flat] >= thr).astype(float), starts) / counts
        if mask is not None:
            keep = np.asarray(mask)[idx]
            pf, po = pf[keep], po[keep]
        num += float(np.sum((pf - po) ** 2))
        den += float(np.sum(pf ** 2 + po ** 2))
    return 1 - num / den if den > EPS else float("nan")


# ------------------------------------------------------------------ bundles
def score_all(obs, fc, thr: float, lat=None, lon=None, groups=None, radius_km: float = 150.0, mask=None) -> dict:
    """All nine headline scores for one forecast source. Ignores NaN observations.

    `mask` restricts scoring to a subset (e.g. one regime) while FSS neighbourhoods still use the full field."""
    obs = np.asarray(obs, float)
    fc = np.asarray(fc, float)
    valid = ~np.isnan(obs) & ~np.isnan(fc)
    ok = valid if mask is None else valid & np.asarray(mask)
    out = {"n": int(ok.sum())}
    if out["n"] == 0:
        return out
    o, f = obs[ok], fc[ok]
    out.update({"rmse": rmse(o, f), "mae": mae(o, f), "bias": bias(o, f), "r2": r2(o, f)})
    c = contingency(o, f, thr)
    out.update({k: c[k] for k in ("pod", "far", "csi", "ets", "freq_bias", "hits", "misses", "false_alarms")})
    if lat is not None:
        sel = valid
        sub_mask = None if mask is None else np.asarray(mask)[sel]
        out["fss"] = fss(obs[sel], fc[sel], thr, np.asarray(lat)[sel], np.asarray(lon)[sel], np.asarray(groups)[sel], radius_km, sub_mask)
    else:
        out["fss"] = float("nan")
    out["mean_obs"] = float(o.mean())
    out["mean_fc"] = float(f.mean())
    return {k: (_f(v) if isinstance(v, float) else v) for k, v in out.items()}


def improvement(base: dict, new: dict) -> dict:
    """Skill change of `new` relative to `base` (lower-is-better metrics -> % reduction)."""
    out = {}
    for k in ("rmse", "mae"):
        if base.get(k) and new.get(k) is not None:
            out[f"{k}_pct"] = _f(100 * (base[k] - new[k]) / base[k])
    if base.get("bias") is not None and new.get("bias") is not None:
        out["abs_bias_pct"] = _f(100 * (abs(base["bias"]) - abs(new["bias"])) / max(abs(base["bias"]), EPS))
    for k in ("csi", "pod", "ets", "fss", "r2"):
        if base.get(k) is not None and new.get(k) is not None:
            out[f"{k}_delta"] = _f(new[k] - base[k])
    if base.get("far") is not None and new.get("far") is not None:
        out["far_delta"] = _f(new["far"] - base["far"])
    return out


def bin_counts(values, edges):
    return np.histogram(values, bins=edges)[0].tolist()
