"""Live-mode conversion tests (no network): hourly arrays -> raw records used by the pipeline."""
from datetime import datetime, timedelta, timezone

import numpy as np

from app.ml.catalog import get_catalog
from app.services import live_service as live


def _payload(now: datetime, precip_fn):
    cat = get_catalog()
    start = (now - timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)
    t = 6 * 24
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(t)]
    n = len(cat)
    hours = np.arange(t, dtype=np.float32)
    return {
        "times": times, "ids": cat["id"].tolist(), "elevation": np.full(n, 100.0, np.float32), "fetched_at": now.isoformat(), "snapshot": False,
        "precip": np.tile(precip_fn(hours), (n, 1)).astype(np.float32),
        "temp": np.full((n, t), 27.0, np.float32), "rh": np.full((n, t), 80.0, np.float32),
        "ws": np.full((n, t), 5.0, np.float32), "wd": np.full((n, t), 240.0, np.float32),
        "pres": np.tile(1000.0 + 0.1 * hours, (n, 1)).astype(np.float32),
    }


def test_accumulation_windows_and_tendency():
    now = datetime(2026, 7, 15, 12, 30, tzinfo=timezone.utc)
    p = _payload(now, lambda h: np.ones_like(h))  # 1 mm every hour
    raw, init = live.payload_to_raw(p)
    assert init == now.replace(minute=0)
    assert set(raw["lead_time_hr"]) == {0, 6, 12, 24, 48, 72}
    assert (raw["nwp_rainfall"] == 24.0).all()          # 24 h ending at every valid time
    assert (raw["prev_rainfall"] == 24.0).all()
    assert np.allclose(raw["pressure_tendency"], 2.4)    # +0.1 hPa/h over 24 h
    assert raw["observed_rainfall"].isna().all()         # no observation feed in live mode
    assert len(raw) == 6 * len(get_catalog())


def test_forecast_window_uses_only_its_own_hours():
    now = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
    i0 = 48 + 12
    # rain only in the 3 hours just after 'now'
    p = _payload(now, lambda h: ((h > i0) & (h <= i0 + 3)).astype(np.float32) * 10)
    raw, _ = live.payload_to_raw(p)
    lead0 = raw[raw.lead_time_hr == 0]["nwp_rainfall"].iloc[0]
    lead6 = raw[raw.lead_time_hr == 6]["nwp_rainfall"].iloc[0]
    assert lead0 == 0.0 and lead6 == 30.0


def test_missing_values_become_zero_rain_not_nan_and_snapshot_roundtrip(tmp_path, monkeypatch):
    now = datetime(2026, 7, 15, 6, 0, tzinfo=timezone.utc)
    p = _payload(now, lambda h: np.ones_like(h))
    p["precip"][0, 60] = np.nan
    raw, _ = live.payload_to_raw(p)
    assert raw["nwp_rainfall"].notna().all()
    monkeypatch.setattr(live, "SNAPSHOT", tmp_path / "snap.npz")
    monkeypatch.setattr(live, "DATA_DIR", tmp_path)
    live._save_snapshot(p)
    back = live.load_snapshot()
    assert back is not None and back["snapshot"] and back["fetched_at"] == p["fetched_at"]
    assert np.allclose(back["temp"], p["temp"])


def test_network_failure_falls_back_to_snapshot_then_errors_without_one(tmp_path, monkeypatch):
    import pytest

    now = datetime(2026, 7, 15, 6, 0, tzinfo=timezone.utc)
    p = _payload(now, lambda h: np.ones_like(h))
    monkeypatch.setattr(live, "SNAPSHOT", tmp_path / "snap.npz")
    monkeypatch.setattr(live, "DATA_DIR", tmp_path)

    def down():
        raise live.LiveDataError("offline")

    monkeypatch.setattr(live, "fetch_live", down)
    with pytest.raises(live.LiveDataError):          # no snapshot yet -> clear error
        live.get_payload()
    live._save_snapshot(p)
    got = live.get_payload()                          # snapshot exists -> served, flagged
    assert got["snapshot"] is True and got["fallback_reason"] == "offline"
