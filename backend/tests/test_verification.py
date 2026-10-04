"""Independent checks of the verification maths against hand-computed values."""
import math

import numpy as np

from app.ml import verification as v


def test_continuous():
    obs = np.array([0.0, 10.0, 20.0, 30.0])
    fc = np.array([2.0, 8.0, 25.0, 30.0])
    assert math.isclose(v.rmse(obs, fc), math.sqrt((4 + 4 + 25 + 0) / 4))
    assert math.isclose(v.mae(obs, fc), (2 + 2 + 5 + 0) / 4)
    assert math.isclose(v.bias(obs, fc), (2 - 2 + 5 + 0) / 4)
    ss_res, ss_tot = 33.0, float(((obs - obs.mean()) ** 2).sum())
    assert math.isclose(v.r2(obs, fc), 1 - ss_res / ss_tot)


def test_contingency_textbook_table():
    # hits=8, misses=2, false alarms=4, correct negatives=86  (N=100)
    obs = np.array([20] * 8 + [20] * 2 + [0] * 4 + [0] * 86, float)
    fc = np.array([20] * 8 + [0] * 2 + [20] * 4 + [0] * 86, float)
    c = v.contingency(obs, fc, 10)
    assert (c["hits"], c["misses"], c["false_alarms"], c["correct_negatives"]) == (8, 2, 4, 86)
    assert math.isclose(c["pod"], 8 / 10)
    assert math.isclose(c["far"], 4 / 12)
    assert math.isclose(c["csi"], 8 / 14)
    hr = (10 * 12) / 100
    assert math.isclose(c["ets"], (8 - hr) / (14 - hr))
    assert math.isclose(c["freq_bias"], 12 / 10)


def test_perfect_forecast_scores():
    obs = np.array([0, 5, 30, 60, 120.0] * 10)
    s = v.score_all(obs, obs.copy(), 25)
    assert s["rmse"] == 0 and s["csi"] == 1 and s["pod"] == 1 and s["far"] == 0 and s["ets"] == 1 and s["r2"] == 1


def test_fss_bounds_and_perfect():
    rng = np.random.default_rng(0)
    lat, lon = rng.uniform(8, 30, 200), rng.uniform(70, 90, 200)
    obs = rng.gamma(1.0, 20.0, 200)
    g = np.zeros(200)
    assert math.isclose(v.fss(obs, obs, 25, lat, lon, g, 150), 1.0)
    fc = rng.gamma(1.0, 20.0, 200)
    s = v.fss(obs, fc, 25, lat, lon, g, 150)
    assert 0.0 <= s < 1.0
    # larger neighbourhood -> never a worse score for an unbiased random forecast
    assert v.fss(obs, fc, 25, lat, lon, g, 600) >= s - 1e-9


def test_no_events_is_undefined_not_zero():
    obs = np.zeros(20)
    c = v.contingency(obs, obs, 10)
    assert math.isnan(c["csi"]) and math.isnan(c["pod"])
