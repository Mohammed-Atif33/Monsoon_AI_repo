"""Live NWP input from Open-Meteo (free, no API key).

The live feed replaces only the *simulated NWP feed*: real model forecasts (rain, temperature, humidity, wind,
pressure) for every catalogue location are turned into the same raw-record schema the simulator produces, then
run through the unchanged QC -> features -> regime -> correction -> probability pipeline.

Honest limits: there is no live observed-rainfall feed, and the ML models were trained on simulated data, so the
corrections applied to real forecasts are NOT validated.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from ..config import DATA_DIR, LEADS
from ..ml.catalog import get_catalog

API_URL = "https://api.open-meteo.com/v1/forecast"
SOURCE = "Open-Meteo (multi-model NWP, best match)"
HOURLY_VARS = ["precipitation", "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m", "pressure_msl"]
KEYS = ["precip", "temp", "rh", "ws", "wd", "pres"]
BATCH = 80
CALLS_PER_MINUTE = 400  # free tier allows 600 location-calls per minute; stay well below
PAST_DAYS, FORECAST_DAYS = 2, 4
SNAPSHOT = DATA_DIR / "live_snapshot.npz"


class LiveDataError(Exception):
    """Live weather could not be obtained (network, rate limit, bad response) and no snapshot exists."""


def _reason(exc: urllib.error.HTTPError) -> str:
    try:
        body = json.loads(exc.read().decode())
        return str(body.get("reason", ""))[:200]
    except Exception:  # noqa: BLE001
        return ""


def _get_json(url: str) -> object:
    """GET with retries. A per-minute rate limit (HTTP 429) is waited out; hourly/daily limits are reported."""
    last: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MonsoonAI-prototype/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as exc:
            reason = _reason(exc)
            if exc.code == 429:
                if "minutely" in reason.lower() and attempt < 3:
                    time.sleep(20 + 10 * attempt)
                    continue
                raise LiveDataError(f"The free weather service rate limit was reached ({reason or 'try again later'}).") from exc
            if exc.code < 500:
                raise LiveDataError(f"Weather service rejected the request ({exc.code}): {reason}") from exc
            last = exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last = exc
        time.sleep(1.5 * (attempt + 1))
    raise LiveDataError(f"Could not reach the weather service ({type(last).__name__}). Check the internet connection.") from last


def _fetch_batch(lats: np.ndarray, lons: np.ndarray) -> list[dict]:
    q = urllib.parse.urlencode({
        "latitude": ",".join(f"{x:.3f}" for x in lats), "longitude": ",".join(f"{x:.3f}" for x in lons),
        "hourly": ",".join(HOURLY_VARS), "wind_speed_unit": "ms", "past_days": PAST_DAYS, "forecast_days": FORECAST_DAYS, "timezone": "UTC",
    })
    data = _get_json(f"{API_URL}?{q}")
    if isinstance(data, dict):
        if data.get("error"):
            raise LiveDataError(f"Weather service error: {data.get('reason', 'unknown')}")
        data = [data]
    if not isinstance(data, list) or len(data) != len(lats):
        raise LiveDataError("Unexpected response from the weather service.")
    return data


def fetch_live() -> dict:
    """Download hourly data for all catalogue points. Returns the payload dict (also saved as an offline snapshot)."""
    cat = get_catalog()
    lat, lon = cat["latitude"].values, cat["longitude"].values
    chunks = [(lat[i:i + BATCH], lon[i:i + BATCH]) for i in range(0, len(cat), BATCH)]
    results: list[list[dict]] = []
    per_window = max(1, CALLS_PER_MINUTE // BATCH)
    for g in range(0, len(chunks), per_window):
        started = time.time()
        with ThreadPoolExecutor(max_workers=3) as ex:
            results += list(ex.map(lambda c: _fetch_batch(*c), chunks[g:g + per_window]))
        if g + per_window < len(chunks):  # stay under the free tier's per-minute quota
            time.sleep(max(0.0, 61.0 - (time.time() - started)))
    items = [x for r in results for x in r]
    times = items[0]["hourly"]["time"]
    n, t = len(items), len(times)
    arr = {k: np.full((n, t), np.nan, dtype=np.float32) for k in KEYS}
    for i, it in enumerate(items):
        h = it["hourly"]
        if len(h["time"]) != t:
            raise LiveDataError("Inconsistent time axis in the weather service response.")
        for k, name in zip(KEYS, HOURLY_VARS):
            arr[k][i] = np.array([np.nan if v is None else v for v in h[name]], dtype=np.float32)
    elev = np.array([it.get("elevation", np.nan) for it in items], dtype=np.float32)
    payload = {"times": times, "ids": cat["id"].tolist(), "elevation": elev, "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **arr, "snapshot": False}
    _save_snapshot(payload)
    return payload


def _save_snapshot(p: dict) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(SNAPSHOT, times=np.array(p["times"]), ids=np.array(p["ids"]), elevation=p["elevation"], fetched_at=np.array(p["fetched_at"]),
                            **{k: p[k] for k in KEYS})
    except OSError:
        pass  # snapshot is a convenience only


def load_snapshot() -> dict | None:
    if not SNAPSHOT.exists():
        return None
    try:
        z = np.load(SNAPSHOT, allow_pickle=False)
        p = {"times": [str(x) for x in z["times"]], "ids": [str(x) for x in z["ids"]], "elevation": z["elevation"], "fetched_at": str(z["fetched_at"]),
             **{k: z[k] for k in KEYS}, "snapshot": True}
        if p["ids"] != get_catalog()["id"].tolist():
            return None
        return p
    except Exception:  # noqa: BLE001 - a corrupt snapshot is simply ignored
        return None


def get_payload(force_snapshot_only: bool = False) -> dict:
    """Live data if reachable, otherwise the last saved snapshot (flagged), otherwise LiveDataError."""
    if not force_snapshot_only:
        try:
            return fetch_live()
        except LiveDataError as exc:
            snap = load_snapshot()
            if snap is None:
                raise
            snap["fallback_reason"] = exc.args[0]
            return snap
    snap = load_snapshot()
    if snap is None:
        raise LiveDataError("No saved live snapshot exists yet.")
    return snap


def payload_to_raw(p: dict, leads=LEADS) -> tuple[pd.DataFrame, datetime]:
    """Convert hourly arrays into the simulator's raw-record schema. Returns (frame, init_time).

    * init_time = the hour the data was fetched ("Now").
    * nwp_rainfall at lead L = model rainfall accumulated over the 24 h ending at now+L.
    * prev_rainfall = model rainfall over the 24 h ending now (a proxy: no observed feed exists).
    * pressure_tendency = MSLP(valid) - MSLP(valid - 24 h). observed_rainfall is NaN (unavailable).
    """
    cat = get_catalog()
    fetched = datetime.fromisoformat(p["fetched_at"])
    init = fetched.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    key = init.strftime("%Y-%m-%dT%H:00")
    times = list(p["times"])
    if key not in times:
        raise LiveDataError("Saved weather data does not cover the current hour.")
    i0 = times.index(key)
    rain = np.nan_to_num(p["precip"].astype(float), nan=0.0)
    cs = np.concatenate([np.zeros((rain.shape[0], 1)), np.cumsum(rain, axis=1)], axis=1)
    prev = cs[:, i0 + 1] - cs[:, i0 - 23]
    frames = []
    for lead in leads:
        v = i0 + lead
        if v >= len(times) or v - 24 < 0:
            continue
        acc = cs[:, v + 1] - cs[:, v - 23]
        elev = np.where(np.isnan(p["elevation"]), cat["elevation"].values, p["elevation"])
        frames.append(pd.DataFrame({
            "location_id": cat["id"].values, "loc_idx": cat["loc_idx"].values,
            "timestamp": (init + timedelta(hours=lead)).isoformat(),
            "latitude": cat["latitude"].values, "longitude": cat["longitude"].values, "district": cat["district"].values, "state": cat["state"].values,
            "nwp_rainfall": np.round(acc, 1), "observed_rainfall": np.nan,
            "temperature": np.round(p["temp"][:, v].astype(float), 1), "humidity": np.round(p["rh"][:, v].astype(float), 1),
            "wind_speed": np.round(p["ws"][:, v].astype(float), 1), "wind_direction": np.round(p["wd"][:, v].astype(float), 0),
            "pressure": np.round(p["pres"][:, v].astype(float), 1), "elevation": np.round(elev.astype(float)),
            "prev_rainfall": np.round(prev, 1),
            "pressure_tendency": np.round(p["pres"][:, v].astype(float) - p["pres"][:, v - 24].astype(float), 2),
            "lead_time_hr": lead,
        }))
    if not frames:
        raise LiveDataError("No usable lead times in the weather data.")
    return pd.concat(frames, ignore_index=True), init
