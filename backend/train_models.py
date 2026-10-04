"""Train and persist all MonsoonAI models.

    python train_models.py            # train (skips if models already exist)
    python train_models.py --force    # retrain from scratch

Steps: generate simulated training data -> clean (QC) -> feature engineering ->
regime classifier -> six regime-specific correction models (+P10/P90) ->
heavy-rainfall probability models -> held-out evaluation -> joblib persistence.
"""
import argparse
import sys
import time

from app.ml.pipeline import MonsoonPipeline


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="retrain even if models exist")
    args = ap.parse_args()
    pipe = MonsoonPipeline()
    if pipe.artefacts_exist() and not args.force:
        print(f"Models already exist in {pipe.dir}. Use --force to retrain.")
        return 0
    t0 = time.perf_counter()
    meta = pipe.train(progress=lambda m: print(f"[{time.perf_counter() - t0:6.1f}s] {m}", flush=True))
    c = meta["classifier"]["metrics"]
    print("\n=== Regime classifier (held-out) ===")
    print(f"accuracy {c['accuracy']:.3f} | macro-F1 {c['f1_macro']:.3f} | mean confidence {c['mean_confidence']:.3f}")
    print("\n=== Regime-specific correction (held-out, true-regime rows) ===")
    print(f"{'regime':22s} {'NWP RMSE':>9s} {'GlobQM':>8s} {'UnivML':>8s} {'RegimeML':>9s} {'P10-P90':>8s}")
    for r, m in meta["correctors"].items():
        mm = m["metrics"]
        print(f"{r:22s} {mm['nwp']['rmse']:9.2f} {mm['global_qm']['rmse']:8.2f} {mm['universal']['rmse']:8.2f} {mm['regime_model']['rmse']:9.2f} {mm['interval_coverage_p10_p90']:8.2f}")
    print("\n=== Exceedance probability models (end-to-end) ===")
    for t, m in meta["probability"].items():
        print(f"P(>= {t:>3s} mm): AUC {m.get('roc_auc', float('nan')):.3f} | F1@0.5 {m.get('f1', 0):.3f} | Brier {m.get('brier', float('nan')):.4f} | prevalence {m['prevalence']:.3f}")
    print(f"\nSaved to {pipe.dir}  ({meta['training_seconds']} s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
