"""Pydantic request / response schemas for the MonsoonAI API."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..config import LIVE_KEY, REGIMES, SCENARIOS


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")


# ------------------------------------------------------------------ requests
class GenerateRequest(BaseModel):
    scenario: str = Field("active_monsoon", description="Demo scenario key")
    seed: Optional[int] = Field(None, ge=0, le=2_000_000_000, description="Omit to draw a fresh random seed (ignored for live)")
    refresh: bool = Field(False, description="Live mode only: fetch fresh data instead of using the cache")

    @field_validator("scenario")
    @classmethod
    def _scenario(cls, v: str) -> str:
        if v not in SCENARIOS and v != LIVE_KEY:
            raise ValueError(f"scenario must be one of {list(SCENARIOS) + [LIVE_KEY]}")
        return v


class PointInput(BaseModel):
    """A single hypothetical grid point (used by the classify / correct endpoints)."""

    nwp_rainfall: float = Field(..., ge=0, le=1000, description="Raw NWP 24h rainfall (mm)")
    temperature: float = Field(..., ge=-45, le=55, description="Air temperature (C)")
    humidity: float = Field(..., ge=0, le=100, description="Relative humidity (%)")
    wind_speed: float = Field(..., ge=0, le=75, description="Wind speed (m/s)")
    wind_direction: float = Field(..., ge=0, le=360, description="Wind direction (deg)")
    pressure: float = Field(..., ge=850, le=1100, description="Mean sea-level pressure (hPa)")
    elevation: float = Field(..., ge=-50, le=8900, description="Elevation (m)")
    latitude: float = Field(..., ge=6, le=38)
    longitude: float = Field(..., ge=67, le=98)
    prev_rainfall: Optional[float] = Field(None, ge=0, le=1000, description="Observed rainfall in the previous 24h (mm); defaults to NWP")
    pressure_tendency: Optional[float] = Field(None, ge=-15, le=15, description="24h pressure change (hPa); defaults to 0")
    spatial_coverage: Optional[float] = Field(None, ge=0, le=1, description="Share of neighbours (<=250 km) with NWP >= 2.5 mm")
    nwp_nbr_mean: Optional[float] = Field(None, ge=0, le=1000)
    lead_time_hr: Optional[float] = Field(24, ge=0, le=240)


class ClassifyRequest(PointInput):
    pass


class CorrectRequest(PointInput):
    regime_override: Optional[str] = Field(None, description="Force a regime instead of using the classifier")

    @field_validator("regime_override")
    @classmethod
    def _regime(cls, v):
        if v is not None and v not in REGIMES:
            raise ValueError(f"regime_override must be one of {REGIMES}")
        return v


# ------------------------------------------------------------------ responses
class HealthResponse(BaseModel):
    status: str
    ready: bool
    message: str
    models_loaded: bool
    data_mode: str
    version: str
    log: list[str] = []
    error: Optional[str] = None


class ForecastPoint(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    district: str
    state: str
    lat: float
    lon: float
    elevation: Optional[float] = None
    lead: int
    regime: str
    confidence: float
    nwp: float
    corrected: float
    q10: float
    q90: float
    observed: Optional[float] = None
    error_nwp: Optional[float] = None
    error_ai: Optional[float] = None
    p_heavy: float
    p_very: float
    prob_10: float
    prob_25: float
    prob_50: float
    prob_100: float
    category: str
    alert: str
    low_confidence: bool
    risk_score: float
    is_district: bool
    regime_probs: Optional[dict[str, float]] = None


class ForecastListResponse(_Open):
    meta: dict[str, Any]
    total: int
    page: int
    page_size: int
    pages: int
    items: list[ForecastPoint]


class GenerateResponse(_Open):
    scenario: str
    scenario_label: str
    seed: int
    generated_at: str
    pipeline: list[dict[str, Any]]
    regime: dict[str, Any]
    cached: bool


class DashboardResponse(_Open):
    meta: dict[str, Any]
    kpis: dict[str, Any]
    regime_mix: list[dict[str, Any]]
    alert_counts: dict[str, int]
    top_risk: list[dict[str, Any]]
    horizon: list[dict[str, Any]]
    pipeline: list[dict[str, Any]]
    quality: dict[str, Any]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any = None


class ErrorResponse(BaseModel):
    error: ErrorBody
