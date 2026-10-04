"""Rainfall alert engine - levels are derived purely from model outputs and configurable thresholds."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

LEVELS = ["Normal", "Watch", "Warning", "Severe"]


@dataclass(frozen=True)
class AlertConfig:
    heavy: int = 50            # mm / 24 h  ("heavy" threshold)
    very_heavy: int = 100      # mm / 24 h  ("very heavy" threshold)
    watch_p: float = 0.40      # Watch   : P(>= heavy) at least this
    warning_p: float = 0.25    # Warning : P(>= very heavy) at least this  (or P(>= heavy) >= 0.75)
    severe_p: float = 0.50     # Severe  : P(>= very heavy) at least this  (and corrected >= 60% of very-heavy threshold)
    min_conf: float = 0.45     # regime confidence below this downgrades the alert one level

    def as_dict(self) -> dict:
        return {"heavy_threshold": self.heavy, "very_heavy_threshold": self.very_heavy, "watch_p": self.watch_p,
                "warning_p": self.warning_p, "severe_p": self.severe_p, "min_regime_confidence": self.min_conf}


RULES = [
    "Severe: P(rain >= very-heavy) >= severe_p AND AI-corrected rainfall >= 60% of the very-heavy threshold.",
    "Warning: P(rain >= very-heavy) >= warning_p, OR P(rain >= heavy) >= 75% with corrected rainfall >= 70% of the heavy threshold.",
    "Watch: P(rain >= heavy) >= watch_p, OR P(rain >= very-heavy) >= 10%.",
    "Regime confidence below min_regime_confidence downgrades the level by one step and flags the alert.",
]


def evaluate(df: pd.DataFrame, cfg: AlertConfig):
    """Return (level_index array, low_confidence flags, risk score) for a frame with the required columns."""
    ph = df[f"p_ge_{cfg.heavy}"].values
    pv = df[f"p_ge_{cfg.very_heavy}"].values
    c = df["corrected"].values
    conf = df["regime_conf"].values
    lvl = np.zeros(len(df), int)
    lvl[(ph >= cfg.watch_p) | (pv >= 0.10)] = 1
    lvl[(pv >= cfg.warning_p) | ((ph >= 0.75) & (c >= 0.7 * cfg.heavy))] = 2
    lvl[(pv >= cfg.severe_p) & (c >= 0.6 * cfg.very_heavy)] = 3
    low = (conf < cfg.min_conf) & (lvl > 0)
    lvl = np.where(low, lvl - 1, lvl)
    score = 0.6 * pv + 0.4 * ph
    return lvl, low, score


def reason(row: dict, cfg: AlertConfig) -> str:
    return (f"P(>={cfg.very_heavy} mm) = {100 * row['p_very']:.0f}%, P(>={cfg.heavy} mm) = {100 * row['p_heavy']:.0f}%, "
            f"AI-corrected {row['corrected']:.0f} mm, regime confidence {100 * row['confidence']:.0f}%")
