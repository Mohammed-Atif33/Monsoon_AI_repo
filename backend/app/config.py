"""Central configuration and constants for MonsoonAI."""
from __future__ import annotations

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
DATA_DIR = BASE_DIR / "data"

APP_NAME = "MonsoonAI"
APP_TAGLINE = "Regime-Aware Rainfall Forecast Intelligence"
APP_VERSION = "1.0.0"
DATA_MODE = "Prototype Simulation"
DATA_DISCLAIMER = "Prototype / Demonstration Data"
VALIDATION_NOTE = (
    "Prototype validation using simulated/bundled demonstration data. "
    "Not IMD-validated and not operationally verified."
)
FORECAST_CYCLE = "12 UTC"

# --------------------------------------------------------------------------- regimes
REGIMES = [
    "active_monsoon",
    "break_monsoon",
    "depression",
    "coastal",
    "orographic",
    "western_disturbance",
]
REGIME_LABELS = {
    "active_monsoon": "Active Monsoon",
    "break_monsoon": "Break Monsoon",
    "depression": "Monsoon Low / Depression",
    "coastal": "Coastal Rainfall",
    "orographic": "Orographic Rainfall",
    "western_disturbance": "Western Disturbance",
}
REGIME_SHORT = {
    "active_monsoon": "Active Monsoon",
    "break_monsoon": "Break Monsoon",
    "depression": "Depression",
    "coastal": "Coastal",
    "orographic": "Orographic",
    "western_disturbance": "Western Disturbance",
}
REGIME_INDEX = {r: i for i, r in enumerate(REGIMES)}
REGIME_DESCRIPTIONS = {
    "active_monsoon": "Vigorous monsoon trough with deep moist south-westerlies and widespread rain.",
    "break_monsoon": "Trough shifted to the Himalayan foothills; dry, warm, weak winds over most of the plains.",
    "depression": "Low-pressure system with strong cyclonic winds and a rapidly falling barometer.",
    "coastal": "Onshore flow and convergence along the west/east coast producing intense convective bursts.",
    "orographic": "Moist flow forced up the Western Ghats, Himalayan foothills and north-east hills.",
    "western_disturbance": "Extra-tropical westerly trough bringing cooler, drier rain to north India.",
}

# Demo scenarios == the regime a user expects to dominate the domain.
SCENARIOS = {
    "active_monsoon": "Active Monsoon",
    "break_monsoon": "Break Monsoon",
    "depression": "Monsoon Depression",
    "coastal": "Coastal Rainfall",
    "orographic": "Orographic Rainfall",
    "western_disturbance": "Western Disturbance",
}
SCENARIO_NOTES = {
    "active_monsoon": "Monsoon trough over central India; strong south-westerlies feed widespread rain.",
    "break_monsoon": "Trough along the Himalayan foothills; rain confined to the north-east and foothills.",
    "depression": "A monsoon depression organises a large rain shield with strong winds.",
    "coastal": "Offshore trough/vortex drives heavy rain along both coasts.",
    "orographic": "Strong low-level jet forced over the Ghats, Himalayan foothills and north-east hills.",
    "western_disturbance": "Western disturbance interacting with the northern plains and hills.",
}
DEFAULT_SCENARIO = "active_monsoon"
DEFAULT_SEED = 7

# --------------------------------------------------------------------------- time / thresholds
LEADS = [0, 6, 12, 24, 48, 72]
LEAD_LABELS = {0: "Now", 6: "+6 hr", 12: "+12 hr", 24: "+24 hr", 48: "+48 hr", 72: "+72 hr"}
THRESHOLDS = [10, 25, 50, 100]
DEFAULT_HEAVY = 50
DEFAULT_VERY_HEAVY = 100

# IMD 24-hour rainfall categories (lower bound, label)
IMD_CATEGORIES = [
    (204.5, "Extremely Heavy"),
    (115.6, "Very Heavy"),
    (64.5, "Heavy"),
    (15.6, "Moderate"),
    (2.5, "Light"),
    (0.1, "Very Light"),
    (0.0, "No Rain"),
]

# --------------------------------------------------------------------------- features
FEATURES = [
    "nwp_rainfall",
    "prev_rainfall",
    "temperature",
    "humidity",
    "wind_speed",
    "wind_dir_sin",
    "wind_dir_cos",
    "pressure",
    "pressure_tendency",
    "elevation",
    "coast_dist_km",
    "latitude",
    "longitude",
    "spatial_coverage",
    "nwp_nbr_mean",
    "lead_time_hr",
]
CLASSIFIER_FEATURES = [f for f in FEATURES if f != "lead_time_hr"]
FEATURE_LABELS = {
    "nwp_rainfall": "NWP Rainfall",
    "prev_rainfall": "Recent Rainfall (24h)",
    "temperature": "Temperature",
    "humidity": "Humidity",
    "wind_speed": "Wind Speed",
    "wind_dir_sin": "Wind Direction (N-S)",
    "wind_dir_cos": "Wind Direction (E-W)",
    "pressure": "Pressure",
    "pressure_tendency": "Pressure Tendency",
    "elevation": "Elevation",
    "coast_dist_km": "Coastal Proximity",
    "latitude": "Latitude",
    "longitude": "Longitude",
    "spatial_coverage": "Spatial Rainfall Coverage",
    "nwp_nbr_mean": "Neighbourhood NWP Rain",
    "lead_time_hr": "Forecast Lead Time",
}

# --------------------------------------------------------------------------- upload
REQUIRED_COLUMNS = [
    "timestamp", "latitude", "longitude", "district", "state",
    "nwp_rainfall", "observed_rainfall", "temperature", "humidity",
    "wind_speed", "wind_direction", "pressure", "elevation",
]
OPTIONAL_COLUMNS = ["prev_rainfall", "pressure_tendency", "lead_time_hr"]
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_ROWS = 20000
ALLOWED_UPLOAD_EXT = {".csv", ".json"}

# training seeds are disjoint from validation seeds and from user-facing forecast seeds
TRAIN_SEEDS = list(range(101, 109))
VAL_SEEDS = [901, 902, 903]

# --------------------------------------------------------------------------- live mode
LIVE_KEY = "live"
LIVE_LABEL = "Live weather (real NWP forecast)"
LIVE_NOTE = "Real model forecasts from Open-Meteo run through the pipeline. Corrections come from simulation-trained models and are not validated; no observed rainfall is available."
LIVE_TTL_S = 3600
DATA_MODE_LIVE = "Live NWP input"
LIVE_DISCLAIMER = "Live NWP input - unvalidated AI correction"
