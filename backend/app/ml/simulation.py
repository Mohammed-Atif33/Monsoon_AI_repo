"""Deterministic simulation engine ("Prototype / Demonstration Data").

Real NWP + observation feeds are not bundled, so this module generates a
scientifically *plausible* stand-in. It is intentionally NOT random noise:

* the weather regime map follows geography (Ghats -> orographic, coasts ->
  coastal, NW India dry, NE India wet, storm centres for depressions ...);
* meteorological features follow regime "signatures" (humidity, pressure,
  pressure tendency, wind, temperature) with elevation lapse rates;
* observed rainfall is a zero-inflated log-normal whose mean depends on the
  regime AND on the features (so features carry real predictive information);
* the NWP forecast is a *regime-specific distortion* of the same latent rain
  (dry bias in active monsoon, drizzle false alarms in breaks, extreme
  compression on the coast, terrain smoothing over hills, wet bias in WDs ...).

Everything is seeded, so the same (scenario, seed) always gives the same data.
Training seeds, validation seeds and user-facing forecast seeds are disjoint.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from ..config import LEADS, REGIME_INDEX, REGIMES
from ..utils.geo import haversine_km
from .catalog import get_catalog

ACT, BRK, DEP, COA, ORO, WD = range(6)

# ------------------------------------------------------------------ regime affinity per scenario
# regime -> (base, {field: coefficient}).  Fields come from the catalogue (+ "storm").
_SCORES = {
    "active_monsoon": {
        "active_monsoon": (0.90, dict(coast_idx=-0.3, orog_idx=-1.0, north_idx=-0.6, nw_dry_idx=-0.7)),
        "break_monsoon": (-0.40, dict(nw_dry_idx=1.1, north_idx=0.5)),
        "depression": (-4.0, {}),
        "coastal": (-0.30, dict(coast_idx=1.9)),
        "orographic": (-0.30, dict(orog_idx=2.4)),
        "western_disturbance": (-1.4, dict(north_idx=1.4)),
    },
    "break_monsoon": {
        "active_monsoon": (-0.20, dict(ne_idx=1.6)),
        "break_monsoon": (1.00, dict(ne_idx=-1.6, orog_idx=-0.6, coast_idx=-0.2)),
        "depression": (-4.0, {}),
        "coastal": (-0.60, dict(coast_idx=1.4)),
        "orographic": (-0.40, dict(orog_idx=2.2)),
        "western_disturbance": (-1.5, dict(north_idx=1.2)),
    },
    "depression": {
        "active_monsoon": (0.75, dict(storm=-0.4, coast_idx=-0.2, orog_idx=-0.9, north_idx=-0.5, nw_dry_idx=-0.5)),
        "break_monsoon": (-0.50, dict(nw_dry_idx=0.9)),
        "depression": (-3.0, dict(storm=9.0)),
        "coastal": (-0.20, dict(coast_idx=1.7)),
        "orographic": (-0.30, dict(orog_idx=2.3)),
        "western_disturbance": (-2.0, dict(north_idx=0.8)),
    },
    "coastal": {
        "active_monsoon": (0.20, dict(ne_idx=1.0, coast_wide=-0.3)),
        "break_monsoon": (0.40, dict(nw_dry_idx=0.4, north_idx=0.3, coast_wide=-1.0)),
        "depression": (-4.0, {}),
        "coastal": (-0.30, dict(coast_wide=3.0)),
        "orographic": (-0.50, dict(orog_idx=2.0)),
        "western_disturbance": (-1.5, dict(north_idx=1.3)),
    },
    "orographic": {
        "active_monsoon": (0.10, dict(coast_idx=-0.3, north_idx=-0.5, nw_dry_idx=-0.6, ne_idx=0.3, oro_wide=-1.0)),
        "break_monsoon": (-0.55, dict(nw_dry_idx=0.9, north_idx=0.5, lee_idx=1.0)),
        "depression": (-4.0, {}),
        "coastal": (-0.30, dict(coast_idx=1.5)),
        "orographic": (-0.30, dict(oro_wide=3.2)),
        "western_disturbance": (-1.5, dict(north_idx=0.8)),
    },
    "western_disturbance": {
        "active_monsoon": (-0.60, dict(ne_idx=1.2)),
        "break_monsoon": (0.55, dict(wd_wide=-0.8, coast_idx=-0.2)),
        "depression": (-4.0, {}),
        "coastal": (-0.40, dict(coast_idx=1.3)),
        "orographic": (-0.40, dict(orog_idx=2.0)),
        "western_disturbance": (-0.50, dict(wd_wide=2.7)),
    },
}
_SCEN_IDX = {s: i for i, s in enumerate(_SCORES)}
_STORM_CENTRES = [(20.8, 85.0), (22.5, 78.0), (17.8, 82.5), (23.5, 82.0)]

# ------------------------------------------------------------------ regime signatures
#            p_mu p_sd  tend_mu tend_sd  rh_mu rh_sd  t_mu t_sd  ws_mu ws_sd  wd_mu wd_sd
_SIG = np.array([
    [1000.5, 2.0, -1.0, 1.0, 88, 4.0, 28.0, 1.6, 9.0, 2.5, 245, 20],   # active
    [1005.5, 2.0, 0.9, 1.0, 62, 9.0, 33.5, 2.2, 4.0, 2.0, 300, 70],    # break
    [994.0, 3.0, -3.2, 1.3, 94, 2.5, 26.5, 1.2, 15.5, 4.0, 210, 55],   # depression
    [1002.0, 2.0, -0.4, 1.0, 90, 3.5, 28.5, 1.4, 11.5, 3.0, 245, 18],  # coastal
    [1001.5, 2.2, -0.6, 1.0, 92, 3.0, 27.0, 1.5, 12.5, 3.0, 255, 15],  # orographic
    [1005.0, 3.0, -1.8, 1.1, 68, 10.0, 23.0, 4.0, 8.0, 3.0, 285, 22],  # WD
])
# rain: wet-conditional mean (mm/24h), wet probability, obs log-sd
_MU_SCALE = np.array([24.0, 6.0, 50.0, 34.0, 30.0, 11.0])
_P_WET = np.array([0.86, 0.35, 0.97, 0.86, 0.93, 0.60])
_SIG_OBS = np.array([0.65, 0.90, 0.55, 0.80, 0.60, 0.80])
# NWP error model: log-sd, correlation with obs noise, P(miss), P(false alarm)
_SIG_NWP = np.array([0.35, 0.50, 0.55, 0.40, 0.38, 0.50])
_RHO_NWP = np.array([0.50, 0.40, 0.35, 0.50, 0.50, 0.40])
_P_MISS = np.array([0.04, 0.10, 0.01, 0.06, 0.05, 0.10])
_P_FA = np.array([0.10, 0.55, 0.30, 0.20, 0.15, 0.35])

BASE_INIT = datetime(2026, 7, 15, 12, tzinfo=timezone.utc)


def _smooth_noise(lat, lon, rng_params, lead):
    """(6, N) low-frequency spatial noise; slowly evolves with lead time."""
    kx, ky, ph, om = rng_params
    arg = kx[:, :, None] * lon[None, None, :] + ky[:, :, None] * lat[None, None, :] + ph[:, :, None] + om[:, :, None] * lead
    return 0.32 * np.sin(arg).sum(1) * np.sqrt(2.0 / kx.shape[1])


def _noise_params(rng, k=3):
    wl = rng.uniform(5, 14, (6, k))
    return (2 * np.pi / wl * 1.0, 2 * np.pi / rng.uniform(5, 14, (6, k)), rng.uniform(0, 2 * np.pi, (6, k)), rng.uniform(-0.03, 0.03, (6, k)))


def _storm_profile(cat_lat, cat_lon, seed, lead):
    lat0, lon0 = _STORM_CENTRES[seed % len(_STORM_CENTRES)]
    jit = np.random.default_rng([seed, 77]).normal(0, 0.8, 2)
    lat_c = lat0 + jit[0] + 0.6 * lead / 24
    lon_c = lon0 + jit[1] - 1.0 * lead / 24
    radius = 1050 + 150 * np.sin(np.pi * lead / 72)
    d = haversine_km(cat_lat, cat_lon, lat_c, lon_c)
    return np.exp(-(d / radius) ** 2), (lat_c, lon_c)


def regime_scores(scenario: str, seed: int, lead: int, cat: pd.DataFrame | None = None):
    cat = get_catalog() if cat is None else cat
    lat, lon = cat["latitude"].values, cat["longitude"].values
    rng = np.random.default_rng([seed, _SCEN_IDX[scenario], 11])
    noise = _smooth_noise(lat, lon, _noise_params(rng), lead)
    storm, centre = _storm_profile(lat, lon, seed, lead)
    fields = {c: cat[c].values for c in ["coast_idx", "coast_wide", "orog_idx", "north_idx", "nw_dry_idx", "ne_idx", "wd_wide", "lee_idx", "oro_wide"]}
    fields["storm"] = storm
    scores = np.zeros((6, len(cat)))
    for reg, (base, coefs) in _SCORES[scenario].items():
        i = REGIME_INDEX[reg]
        s = np.full(len(cat), base)
        for f, c in coefs.items():
            s = s + c * fields[f]
        scores[i] = s + noise[i]
    return scores, centre


def _clip_norm(rng, mu, sd, n):
    return mu + sd * rng.standard_normal(n)


def simulate_lead(scenario: str, seed: int, lead: int, prev_state: dict | None = None, cat: pd.DataFrame | None = None):
    """Simulate one forecast lead. Returns (DataFrame, state) - state carries prev_rainfall."""
    cat = get_catalog() if cat is None else cat
    n = len(cat)
    rng = np.random.default_rng([seed, _SCEN_IDX[scenario], lead, 1])
    scores, centre = regime_scores(scenario, seed, lead, cat)
    reg = scores.argmax(0)
    lat, lon, elev = cat["latitude"].values, cat["longitude"].values, cat["elevation"].values.astype(float)

    sg = _SIG[reg]
    pres = _clip_norm(rng, sg[:, 0], sg[:, 1], n)
    tend = _clip_norm(rng, sg[:, 2], sg[:, 3], n)
    rh = np.clip(_clip_norm(rng, sg[:, 4], sg[:, 5], n), 25, 100)
    ws = np.clip(_clip_norm(rng, sg[:, 8], sg[:, 9], n), 0.3, 40)
    wd_mu = sg[:, 10].copy()
    wd_mu = np.where(reg == COA, np.where(cat["coast_side"].values < 0, 245.0, 165.0), wd_mu)
    wd_mu = np.where(reg == ORO, cat["orog_wind_dir"].values, wd_mu)
    wdir = np.mod(wd_mu + sg[:, 11] * rng.standard_normal(n), 360.0)
    t_lat = np.where(reg == WD, -0.55 * (lat - 30.0), -0.12 * (lat - 20.0))
    temp = _clip_norm(rng, sg[:, 6], sg[:, 7], n) + t_lat - 6.5 * elev / 1000.0

    # --------------- latent rainfall
    z_rh = (rh - sg[:, 4]) / 10.0
    z_ws = (ws - sg[:, 8]) / 4.0
    z_p = (sg[:, 0] - pres) / 3.0
    orog = cat["orog_idx"].values
    clim = 1 + 0.5 * cat["ne_idx"].values
    monsoonal = np.isin(reg, [ACT, BRK])
    clim = clim * np.where(monsoonal, 1 - 0.45 * cat["nw_dry_idx"].values, 1.0)
    clim = clim * np.where(reg == WD, 1.0, np.where(reg == DEP, 1.0, 1 - 0.40 * cat["lee_idx"].values))
    gain = 1 + np.where(reg == ORO, 0.8, 0.25) * orog + np.where(reg == COA, 0.4 * cat["coast_idx"].values, 0.0)
    storm, _ = _storm_profile(lat, lon, seed, lead)
    storm_gain = np.where(reg == DEP, 0.7 + 0.6 * storm, 1.0)
    phase0 = np.random.default_rng([seed, _SCEN_IDX[scenario], 5]).uniform(0, 2 * np.pi)
    intensity = 1 + 0.18 * np.sin(np.pi * lead / 72 + phase0)
    mu = _MU_SCALE[reg] * clim * gain * storm_gain * intensity * np.exp(0.35 * z_rh + 0.25 * z_ws + 0.20 * z_p)

    p_wet = np.clip(_P_WET[reg] + 0.008 * (rh - sg[:, 4]), 0.05, 0.995)
    wet = rng.random(n) < p_wet
    z_o = rng.standard_normal(n)
    s_o = _SIG_OBS[reg]
    obs = np.minimum(np.where(wet, mu * np.exp(s_o * z_o - s_o ** 2 / 2), 0.0), 650.0)

    # --------------- NWP: regime-specific distortion of the same latent rain
    elev_c = np.clip(elev, 0, 3000)
    mu_n = np.empty(n)
    mu_n[reg == ACT] = (mu * np.clip(0.66 - 0.010 * (rh - 88) + 0.012 * (9 - ws), 0.30, 0.95))[reg == ACT]
    mu_n[reg == BRK] = (mu * 1.35)[reg == BRK]
    mu_n[reg == DEP] = (mu * (0.58 + 0.01 * (15.5 - ws)))[reg == DEP]
    mu_n[reg == COA] = (30.0 * (mu / 30.0) ** 0.70)[reg == COA]
    mu_n[reg == ORO] = (mu / (1 + elev_c / 900.0))[reg == ORO]
    mu_n[reg == WD] = (mu * 1.45)[reg == WD]
    mu_n = mu_n * (1 - 0.0012 * lead)
    lead_infl = 1 + lead / 60.0
    s_n = _SIG_NWP[reg] * lead_infl
    rho = _RHO_NWP[reg] * (1 - lead / 200.0)
    z_n = rho * z_o + np.sqrt(1 - rho ** 2) * rng.standard_normal(n)
    miss = rng.random(n) < _P_MISS[reg]
    fa = rng.random(n) < _P_FA[reg]
    nwp_wet = np.where(wet, ~miss, fa)
    amount = np.where(wet, mu_n, 0.35 * mu_n)
    nwp = np.minimum(np.where(nwp_wet, amount * np.exp(s_n * z_n - s_n ** 2 / 2), 0.0), 650.0)

    # --------------- antecedent rainfall: observed over the 24h before initialisation
    if prev_state is None:
        rp = np.random.default_rng([seed, _SCEN_IDX[scenario], 3])
        pw = np.clip(p_wet + 0.05, 0, 0.99)
        prev = np.where(rp.random(n) < pw, 0.9 * mu * np.exp(0.7 * rp.standard_normal(n) - 0.245), 0.0)
        prev_state = {"prev": prev}
    prev = prev_state["prev"]

    ts = BASE_INIT + timedelta(hours=lead)
    df = pd.DataFrame({
        "location_id": cat["id"].values,
        "loc_idx": cat["loc_idx"].values,
        "timestamp": ts.isoformat(),
        "latitude": lat, "longitude": lon,
        "district": cat["district"].values, "state": cat["state"].values,
        "nwp_rainfall": np.round(nwp, 1),
        "observed_rainfall": np.round(obs, 1),
        "temperature": np.round(temp, 1),
        "humidity": np.round(rh, 1),
        "wind_speed": np.round(ws, 1),
        "wind_direction": np.round(wdir, 0),
        "pressure": np.round(pres, 1),
        "elevation": elev,
        "prev_rainfall": np.round(prev, 1),
        "pressure_tendency": np.round(tend, 2),
        "lead_time_hr": lead,
        "true_regime": [REGIMES[i] for i in reg],
    })
    prev_state["storm_centre"] = centre
    return df, prev_state


def simulate_forecast(scenario: str, seed: int, leads=LEADS, init_time: datetime | None = None) -> pd.DataFrame:
    """All leads for one (scenario, seed) forecast run - a clean feed (no injected defects)."""
    frames, state = [], None
    init_time = init_time or BASE_INIT
    for lead in leads:
        df, state = simulate_lead(scenario, seed, lead, state)
        df["timestamp"] = (init_time + timedelta(hours=lead)).isoformat()
        frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    out["scenario"] = scenario
    out["seed"] = seed
    return out


def simulate_many(scenarios, seeds, leads=LEADS) -> pd.DataFrame:
    frames = [simulate_forecast(sc, sd, leads) for sc in scenarios for sd in seeds]
    df = pd.concat(frames, ignore_index=True)
    df["run"] = df["scenario"] + ":" + df["seed"].astype(str)
    return df


def inject_defects(df: pd.DataFrame, seed: int):
    """Add realistic feed defects so the data-quality stage has real work to do.

    Returns (defective_df, manifest). The manifest is simulation ground truth and is
    used only to show detection rate; it is never used by the ML pipeline.
    """
    rng = np.random.default_rng([seed, 991])
    d = df.copy()
    n = len(d)
    man = {}

    def pick(rate):
        return rng.random(n) < rate

    for col, rate in [("humidity", 0.012), ("pressure", 0.008), ("wind_speed", 0.006), ("temperature", 0.004)]:
        m = pick(rate)
        d.loc[m, col] = np.nan
        man[f"missing_{col}"] = int(m.sum())
    m = pick(0.006)
    d.loc[m, "nwp_rainfall"] = rng.choice([-999.0, -5.0, 4500.0], m.sum())
    man["invalid_nwp_rainfall"] = int(m.sum())
    m = pick(0.004)
    d.loc[m, "observed_rainfall"] = -999.0
    man["invalid_observed_rainfall"] = int(m.sum())
    m = pick(0.005)
    d.loc[m, "temperature"] = rng.choice([99.0, -60.0, 305.0], m.sum())
    man["unrealistic_temperature"] = int(m.sum())
    m = pick(0.002)
    d.loc[m, "latitude"] = rng.choice([0.0, -999.0, 91.0], m.sum())
    man["invalid_coordinates"] = int(m.sum())
    m = pick(0.002)
    d.loc[m, "timestamp"] = None
    man["missing_timestamp"] = int(m.sum())
    m = pick(0.004)
    d.loc[m, "wind_direction"] = 400.0
    man["invalid_wind_direction"] = int(m.sum())
    dup = d.sample(frac=0.004, random_state=int(seed) % (2 ** 31))
    man["duplicate_records"] = int(len(dup))
    d = pd.concat([d, dup], ignore_index=True)
    return d, man
