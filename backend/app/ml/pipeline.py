"""MonsoonAI ML pipeline: regime classifier -> regime-specific correction -> exceedance probability.

Models (all scikit-learn, persisted with joblib):
  1. RandomForestClassifier            weather-regime classifier (+ class probabilities)
  2. 6 x HistGradientBoostingRegressor regime-specific rainfall correction (+ P10 / P90 quantile models)
  3. 4 x HistGradientBoostingClassifier P(rainfall >= 10 / 25 / 50 / 100 mm)
  +  1 universal HistGradientBoostingRegressor (regime-blind baseline used only for the ablation)
"""
from __future__ import annotations

import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, brier_score_loss, confusion_matrix, precision_recall_fscore_support,
                             roc_auc_score)
from sklearn.model_selection import GroupKFold

from ..config import (CLASSIFIER_FEATURES, FEATURE_LABELS, FEATURES, MODELS_DIR, REGIME_INDEX, REGIME_LABELS, REGIMES,
                      SCENARIOS, THRESHOLDS, TRAIN_SEEDS, VAL_SEEDS)
from . import verification as ver
from .features import engineer_features
from .quality import run_quality
from .simulation import simulate_many

# groups of features that are perturbed together when explaining a prediction
DRIVER_GROUPS = {
    "Wind Direction": ["wind_dir_sin", "wind_dir_cos"],
}
PROB_FEATURES = FEATURES + ["corrected_rain", "regime_code"]
PROB_CAT_IDX = [len(PROB_FEATURES) - 1]
FILES = {
    "classifier": "regime_classifier.joblib",
    "correctors": "correction_models.joblib",
    "quantiles": "quantile_models.joblib",
    "probability": "probability_models.joblib",
    "universal": "universal_model.joblib",
    "meta": "metadata.json",
}


def _driver_groups(features: list[str]) -> dict[str, list[str]]:
    used = {f for g in DRIVER_GROUPS.values() for f in g}
    out = {FEATURE_LABELS[f]: [f] for f in features if f not in used}
    for name, cols in DRIVER_GROUPS.items():
        if all(c in features for c in cols):
            out[name] = cols
    return out


def _reg(**kw) -> HistGradientBoostingRegressor:
    params = dict(max_iter=260, learning_rate=0.06, max_depth=6, min_samples_leaf=30, l2_regularization=1.0, random_state=0)
    params.update(kw)
    return HistGradientBoostingRegressor(**params)


class MonsoonPipeline:
    def __init__(self, models_dir: Path = MODELS_DIR):
        self.dir = Path(models_dir)
        self.classifier: RandomForestClassifier | None = None
        self.correctors: dict[str, HistGradientBoostingRegressor] = {}
        self.quantiles: dict[str, dict[str, HistGradientBoostingRegressor]] = {}
        self.probability: dict[int, HistGradientBoostingClassifier] = {}
        self.universal: HistGradientBoostingRegressor | None = None
        self.meta: dict = {}

    # ------------------------------------------------------------------ persistence
    @property
    def ready(self) -> bool:
        return self.classifier is not None and len(self.correctors) == len(REGIMES) and len(self.probability) == len(THRESHOLDS)

    def artefacts_exist(self) -> bool:
        return all((self.dir / f).exists() for f in FILES.values())

    def save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.classifier, self.dir / FILES["classifier"], compress=3)
        joblib.dump(self.correctors, self.dir / FILES["correctors"], compress=3)
        joblib.dump(self.quantiles, self.dir / FILES["quantiles"], compress=3)
        joblib.dump(self.probability, self.dir / FILES["probability"], compress=3)
        joblib.dump(self.universal, self.dir / FILES["universal"], compress=3)
        (self.dir / FILES["meta"]).write_text(json.dumps(self.meta, indent=2))

    def load(self) -> bool:
        if not self.artefacts_exist():
            return False
        self.classifier = joblib.load(self.dir / FILES["classifier"])
        self.correctors = joblib.load(self.dir / FILES["correctors"])
        self.quantiles = joblib.load(self.dir / FILES["quantiles"])
        self.probability = joblib.load(self.dir / FILES["probability"])
        self.universal = joblib.load(self.dir / FILES["universal"])
        self.meta = json.loads((self.dir / FILES["meta"]).read_text())
        return self.ready

    # ------------------------------------------------------------------ training
    @staticmethod
    def build_frame(seeds, scenarios=None) -> pd.DataFrame:
        raw = simulate_many(list(scenarios or SCENARIOS), seeds)
        clean, _ = run_quality(raw)
        clean = clean[clean["observed_rainfall"].notna()]  # rows without a verifying observation cannot be used for supervised training
        return engineer_features(clean, group_cols=["run", "timestamp", "lead_time_hr"])

    def train(self, progress: Callable[[str], None] | None = None) -> dict:
        say = progress or (lambda m: None)
        t0 = time.perf_counter()
        say("Generating training data (simulation engine)")
        tr = self.build_frame(TRAIN_SEEDS)
        say("Generating held-out validation data")
        va = self.build_frame(VAL_SEEDS)
        tr["y_regime"] = tr["true_regime"].map(REGIME_INDEX)
        va["y_regime"] = va["true_regime"].map(REGIME_INDEX)

        meta: dict = {
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "data_mode": "Prototype Simulation",
            "train_rows": int(len(tr)), "val_rows": int(len(va)),
            "train_seeds": TRAIN_SEEDS, "val_seeds": VAL_SEEDS,
            "scenarios": list(SCENARIOS),
            "features": FEATURES, "classifier_features": CLASSIFIER_FEATURES,
            "feature_labels": FEATURE_LABELS,
            "library_versions": {"scikit-learn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "python": platform.python_version()},
            "feature_ranges": {f: [float(tr[f].quantile(0.005)), float(tr[f].quantile(0.995))] for f in FEATURES},
            "regime_train_rows": {r: int((tr["true_regime"] == r).sum()) for r in REGIMES},
        }

        # ---- Model 1: regime classifier
        say("Training regime classifier (Random Forest)")
        self.classifier = RandomForestClassifier(
            n_estimators=140, max_depth=18, min_samples_leaf=6, max_features="sqrt", max_samples=0.5,
            class_weight="balanced_subsample", n_jobs=-1, random_state=0)
        self.classifier.fit(tr[CLASSIFIER_FEATURES].values, tr["y_regime"].values)
        pv = self.classifier.predict_proba(va[CLASSIFIER_FEATURES].values)
        yv = va["y_regime"].values
        pred = pv.argmax(1)
        prec, rec, f1, sup = precision_recall_fscore_support(yv, pred, labels=range(6), zero_division=0)
        wp, wr, wf, _ = precision_recall_fscore_support(yv, pred, average="weighted", zero_division=0)
        mp, mr, mf, _ = precision_recall_fscore_support(yv, pred, average="macro", zero_division=0)
        meta["classifier"] = {
            "algorithm": "RandomForestClassifier",
            "params": {"n_estimators": 140, "max_depth": 18, "min_samples_leaf": 6, "max_features": "sqrt", "class_weight": "balanced_subsample"},
            "metrics": {
                "accuracy": float(accuracy_score(yv, pred)),
                "precision_macro": float(mp), "recall_macro": float(mr), "f1_macro": float(mf),
                "precision_weighted": float(wp), "recall_weighted": float(wr), "f1_weighted": float(wf),
                "mean_confidence": float(pv.max(1).mean()),
                "per_class": [{"regime": REGIMES[i], "label": REGIME_LABELS[REGIMES[i]], "precision": float(prec[i]), "recall": float(rec[i]), "f1": float(f1[i]), "support": int(sup[i])} for i in range(6)],
                "confusion_matrix": confusion_matrix(yv, pred, labels=range(6)).tolist(),
                "confusion_labels": [REGIME_LABELS[r] for r in REGIMES],
            },
            "feature_importance": sorted(
                [{"feature": f, "label": FEATURE_LABELS[f], "importance": float(v)} for f, v in zip(CLASSIFIER_FEATURES, self.classifier.feature_importances_)],
                key=lambda d: -d["importance"]),
        }
        meta["background_classifier"] = {f: float(tr[f].median()) for f in CLASSIFIER_FEATURES}

        # ---- Model 2: regime-specific correction (+ quantiles), universal baseline
        say("Fitting global quantile-mapping baseline")
        levels = np.concatenate([np.linspace(0, 0.9, 200, endpoint=False), np.linspace(0.9, 0.999, 300), [0.9995, 0.9999, 1.0]])
        meta["quantile_mapping"] = {
            "nwp_q": np.quantile(tr["nwp_rainfall"].values, levels).round(3).tolist(),
            "obs_q": np.quantile(tr["observed_rainfall"].values, levels).round(3).tolist(),
        }
        self.meta = meta
        say("Training universal baseline model")
        self.universal = _reg().fit(tr[FEATURES].values, tr["observed_rainfall"].values)
        self.correctors, self.quantiles = {}, {}
        meta["correctors"], meta["background_correctors"] = {}, {}
        oof = np.zeros(len(tr))
        groups = tr["run"].values
        for r in REGIMES:
            say(f"Training {REGIME_LABELS[r]} correction model")
            m = (tr["true_regime"] == r).values
            X, y = tr.loc[m, FEATURES].values, tr.loc[m, "observed_rainfall"].values
            model = _reg().fit(X, y)
            self.correctors[r] = model
            self.quantiles[r] = {
                "p10": _reg(loss="quantile", quantile=0.10, max_iter=160).fit(X, y),
                "p90": _reg(loss="quantile", quantile=0.90, max_iter=160).fit(X, y),
            }
            # out-of-fold corrected rainfall -> honest input for the probability models
            idx = np.flatnonzero(m)
            n_split = min(3, len(np.unique(groups[idx])))
            for a, b in GroupKFold(n_splits=n_split).split(X, y, groups[idx]):
                fold = _reg().fit(X[a], y[a])
                oof[idx[b]] = fold.predict(X[b])
            # held-out metrics on validation rows whose true regime is r
            mv = (va["true_regime"] == r).values
            Xv, yv_r = va.loc[mv, FEATURES].values, va.loc[mv, "observed_rainfall"].values
            corr = np.clip(model.predict(Xv), 0, None)
            uni = np.clip(self.universal.predict(Xv), 0, None)
            nwp = va.loc[mv, "nwp_rainfall"].values
            qm = self.quantile_map(nwp)
            lo = np.minimum(self.quantiles[r]["p10"].predict(Xv), corr)
            hi = np.maximum(self.quantiles[r]["p90"].predict(Xv), corr)
            sub = np.random.default_rng(0).choice(len(Xv), min(2500, len(Xv)), replace=False)
            pi = permutation_importance(model, Xv[sub], yv_r[sub], n_repeats=2, random_state=0, scoring="neg_root_mean_squared_error")
            meta["correctors"][r] = {
                "regime": r, "label": REGIME_LABELS[r], "algorithm": "HistGradientBoostingRegressor",
                "train_rows": int(m.sum()), "val_rows": int(mv.sum()),
                "metrics": {
                    "nwp": _cont(yv_r, nwp), "global_qm": _cont(yv_r, qm), "universal": _cont(yv_r, uni), "regime_model": _cont(yv_r, corr),
                    "interval_coverage_p10_p90": float(np.mean((yv_r >= lo) & (yv_r <= hi))),
                },
                "feature_importance": sorted(
                    [{"feature": f, "label": FEATURE_LABELS[f], "importance": float(max(v, 0))} for f, v in zip(FEATURES, pi.importances_mean)],
                    key=lambda d: -d["importance"]),
            }
            meta["background_correctors"][r] = {f: float(tr.loc[m, f].median()) for f in FEATURES}
        meta["correction_params"] = {"max_iter": 260, "learning_rate": 0.06, "max_depth": 6, "min_samples_leaf": 30, "l2_regularization": 1.0}

        # ---- Model 3: exceedance probabilities
        say("Training heavy-rainfall probability models")
        tr["corrected_rain"] = np.clip(oof, 0, None)
        tr["regime_code"] = tr["y_regime"].values
        self.probability = {}
        meta["probability"] = {}
        Xp = tr[PROB_FEATURES].values
        for thr in THRESHOLDS:
            clf = HistGradientBoostingClassifier(max_iter=220, learning_rate=0.06, max_depth=5, min_samples_leaf=40, l2_regularization=1.0,
                                                 categorical_features=PROB_CAT_IDX, random_state=0)
            self.probability[thr] = clf.fit(Xp, (tr["observed_rainfall"].values >= thr).astype(int))
        say("Evaluating the full pipeline on held-out validation data")
        res = self.run(va)
        meta["background_probability"] = {f: float(tr[f].median()) for f in PROB_FEATURES}
        for thr in THRESHOLDS:
            y = (va["observed_rainfall"].values >= thr).astype(int)
            p = res[f"p_ge_{thr}"].values
            meta["probability"][str(thr)] = _prob_metrics(y, p, thr)
            sub = np.random.default_rng(1).choice(len(va), 4000, replace=False)
            Xv = self._prob_matrix(va, res)[sub]
            pi = permutation_importance(self.probability[thr], Xv, y[sub], n_repeats=2, random_state=0, scoring="roc_auc") if 0 < y[sub].sum() < len(sub) else None
            meta["probability"][str(thr)]["feature_importance"] = sorted(
                [{"feature": f, "label": FEATURE_LABELS.get(f, "Corrected Rainfall" if f == "corrected_rain" else "Weather Regime"), "importance": float(max(v, 0))}
                 for f, v in zip(PROB_FEATURES, pi.importances_mean)], key=lambda d: -d["importance"]) if pi is not None else []
        # end-to-end routing metrics (predicted regime) for the correction stage
        e2e = {}
        for r in REGIMES:
            m = (res["regime"] == r).values
            if m.sum() > 20:
                e2e[r] = {"n": int(m.sum()), "nwp_rmse": ver.rmse(va["observed_rainfall"].values[m], va["nwp_rainfall"].values[m]),
                          "ai_rmse": ver.rmse(va["observed_rainfall"].values[m], res["corrected"].values[m])}
        meta["end_to_end_by_predicted_regime"] = e2e
        meta["overall_validation"] = {
            "nwp": _cont(va["observed_rainfall"].values, va["nwp_rainfall"].values),
            "global_qm": _cont(va["observed_rainfall"].values, res["global_qm"].values),
            "universal": _cont(va["observed_rainfall"].values, res["universal"].values),
            "regime_aware": _cont(va["observed_rainfall"].values, res["corrected"].values),
        }
        meta["training_seconds"] = round(time.perf_counter() - t0, 1)
        self.meta = meta
        say("Saving models")
        self.save()
        return meta

    # ------------------------------------------------------------------ inference
    def _prob_matrix(self, df: pd.DataFrame, res: pd.DataFrame) -> np.ndarray:
        X = df[FEATURES].copy()
        X["corrected_rain"] = res["corrected"].values
        X["regime_code"] = res["regime_code"].values
        return X[PROB_FEATURES].values.astype(np.float64)

    def quantile_map(self, nwp: np.ndarray) -> np.ndarray:
        """Regime-blind empirical quantile mapping: the classic single global bias correction."""
        qm = self.meta["quantile_mapping"]
        return np.clip(np.interp(np.asarray(nwp, float), qm["nwp_q"], qm["obs_q"]), 0, None)

    def out_of_range_share(self, df: pd.DataFrame) -> float:
        """Share of rows with at least one core feature outside the training 0.5-99.5 percentile range."""
        rng = self.meta.get("feature_ranges", {})
        core = ["temperature", "humidity", "wind_speed", "pressure", "elevation", "latitude", "longitude"]
        bad = np.zeros(len(df), bool)
        for f in core:
            if f in rng:
                lo, hi = rng[f]
                bad |= (df[f].values < lo) | (df[f].values > hi)
        return float(bad.mean()) if len(df) else 0.0

    def classify(self, df: pd.DataFrame) -> np.ndarray:
        return self.classifier.predict_proba(df[CLASSIFIER_FEATURES].values.astype(np.float64))

    def correct(self, df: pd.DataFrame, regimes: np.ndarray):
        """Route every row to its regime's model. Returns (corrected, p10, p90)."""
        X = df[FEATURES].values.astype(np.float64)
        n = len(df)
        corr, lo, hi = np.zeros(n), np.zeros(n), np.zeros(n)
        for r in REGIMES:
            m = regimes == r
            if not m.any():
                continue
            c = np.clip(self.correctors[r].predict(X[m]), 0, None)
            corr[m] = c
            lo[m] = np.minimum(np.clip(self.quantiles[r]["p10"].predict(X[m]), 0, None), c)
            hi[m] = np.maximum(self.quantiles[r]["p90"].predict(X[m]), c)
        return corr, lo, hi

    def run(self, df: pd.DataFrame, timings: dict | None = None) -> pd.DataFrame:
        """Full pipeline on an engineered-feature frame. Returns per-row predictions."""
        if not self.ready:
            raise RuntimeError("Models are not loaded")
        t = time.perf_counter()
        proba = self.classify(df)
        # map columns via classes_ so the order is always REGIMES
        full = np.zeros((len(df), 6))
        full[:, self.classifier.classes_.astype(int)] = proba
        idx = full.argmax(1)
        regimes = np.array(REGIMES)[idx]
        if timings is not None:
            timings["regime_ms"] = round(1000 * (time.perf_counter() - t), 1)
            t = time.perf_counter()
        corr, lo, hi = self.correct(df, regimes)
        out = pd.DataFrame({"regime": regimes, "regime_code": idx, "regime_conf": full.max(1), "corrected": corr, "corrected_p10": lo, "corrected_p90": hi})
        for i, r in enumerate(REGIMES):
            out[f"prob_{r}"] = full[:, i]
        out["universal"] = np.clip(self.universal.predict(df[FEATURES].values.astype(np.float64)), 0, None)
        out["global_qm"] = self.quantile_map(df["nwp_rainfall"].values)
        if timings is not None:
            timings["correction_ms"] = round(1000 * (time.perf_counter() - t), 1)
            t = time.perf_counter()
        Xp = self._prob_matrix(df, out)
        probs = np.column_stack([self.probability[t].predict_proba(Xp)[:, 1] for t in THRESHOLDS])
        probs = np.minimum.accumulate(probs, axis=1)  # P(>=100) can never exceed P(>=50)
        for j, thr in enumerate(THRESHOLDS):
            out[f"p_ge_{thr}"] = probs[:, j]
        if timings is not None:
            timings["probability_ms"] = round(1000 * (time.perf_counter() - t), 1)
        out.index = df.index
        return out

    # ------------------------------------------------------------------ explainability
    def explain_regime(self, row: pd.DataFrame, top: int = 8) -> list[dict]:
        """Occlusion attribution for the predicted regime: drop in P(regime) when a feature is set to its training median."""
        bg = self.meta["background_classifier"]
        x = row[CLASSIFIER_FEATURES].values.astype(np.float64)
        base = self.classifier.predict_proba(x)[0]
        k = int(base.argmax())
        out = []
        for name, cols in _driver_groups(CLASSIFIER_FEATURES).items():
            x2 = x.copy()
            for c in cols:
                x2[0, CLASSIFIER_FEATURES.index(c)] = bg[c]
            p2 = self.classifier.predict_proba(x2)[0][k]
            out.append({"feature": name, "value": _disp(row, cols), "contribution": float(base[k] - p2), "cols": cols})
        out.sort(key=lambda d: -abs(d["contribution"]))
        return out[:top]

    def explain_correction(self, row: pd.DataFrame, regime: str, top: int = 8) -> list[dict]:
        """Occlusion attribution for the regime-specific corrected rainfall (mm)."""
        bg = self.meta["background_correctors"][regime]
        model = self.correctors[regime]
        x = row[FEATURES].values.astype(np.float64)
        base = float(model.predict(x)[0])
        out = []
        for name, cols in _driver_groups(FEATURES).items():
            x2 = x.copy()
            for c in cols:
                x2[0, FEATURES.index(c)] = bg[c]
            out.append({"feature": name, "value": _disp(row, cols), "contribution": base - float(model.predict(x2)[0]), "cols": cols})
        out.sort(key=lambda d: -abs(d["contribution"]))
        return out[:top]


def _disp(row: pd.DataFrame, cols: list[str]):
    if cols == ["wind_dir_sin", "wind_dir_cos"]:
        return round(float(np.degrees(np.arctan2(row["wind_dir_sin"].iloc[0], row["wind_dir_cos"].iloc[0])) % 360), 0)
    v = float(row[cols[0]].iloc[0])
    return round(v, 2)


def _cont(obs, fc) -> dict:
    return {"rmse": ver._f(ver.rmse(obs, fc)), "mae": ver._f(ver.mae(obs, fc)), "bias": ver._f(ver.bias(obs, fc)), "r2": ver._f(ver.r2(obs, fc))}


def _prob_metrics(y: np.ndarray, p: np.ndarray, thr: int) -> dict:
    out = {"threshold_mm": thr, "prevalence": float(y.mean()), "n_events": int(y.sum())}
    if 0 < y.sum() < len(y):
        pred = p >= 0.5
        tp, fp, fn = int(np.sum(pred & (y == 1))), int(np.sum(pred & (y == 0))), int(np.sum(~pred & (y == 1)))
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        best = (0.0, 0.5)
        for t in np.linspace(0.05, 0.95, 19):
            pr = p >= t
            a = int(np.sum(pr & (y == 1)))
            pp = a / max(int(pr.sum()), 1)
            rr = a / max(int(y.sum()), 1)
            ff = 2 * pp * rr / (pp + rr) if pp + rr else 0.0
            if ff > best[0]:
                best = (ff, float(t))
        out.update({"precision": prec, "recall": rec, "f1": f1, "roc_auc": float(roc_auc_score(y, p)), "brier": float(brier_score_loss(y, p)),
                    "best_f1": best[0], "best_f1_threshold": best[1]})
        bins = np.linspace(0, 1, 11)
        ids = np.clip(np.digitize(p, bins) - 1, 0, 9)
        out["reliability"] = [
            {"bin": f"{bins[i]:.1f}-{bins[i + 1]:.1f}", "mean_pred": float(p[ids == i].mean()), "observed_freq": float(y[ids == i].mean()), "n": int((ids == i).sum())}
            for i in range(10) if (ids == i).sum() >= 20
        ]
    return out
