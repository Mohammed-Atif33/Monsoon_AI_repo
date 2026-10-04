# MonsoonAI backend

FastAPI + scikit-learn service. Start it from this folder:

```powershell
python -m venv .venv ; .venv\Scripts\activate ; pip install -r requirements.txt
python train_models.py            # trains, evaluates and saves models (skips if they exist; --force retrains)
python -m uvicorn app.main:app --port 8010
python -m pytest tests -q         # verification-metric unit tests
```

* If `models/` is empty the API trains the models itself on first start (about one minute) and reports progress on
  `/api/health`; requests return `503 models_unavailable` until ready. Models are **not** retrained per request.
* Training data = simulation seeds 101–108 × 6 scenarios × 6 lead times (~181k rows). Validation = seeds 901–903
  (~68k rows). User-facing forecast seeds never overlap either set.
* Saved artefacts: `regime_classifier.joblib`, `correction_models.joblib`, `quantile_models.joblib`,
  `probability_models.joblib`, `universal_model.joblib`, `metadata.json` (metrics, importances, training timestamp).

Module map: see [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
