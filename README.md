# MonsoonAI — Regime-Aware Rainfall Forecast Intelligence

> **Prototype / Demonstration Data.** All meteorological inputs are produced by a deterministic simulation engine.
> Results demonstrate the *method*; they are **not** IMD-validated, operationally verified or deployment-ready.

Smart India Hackathon prototype for **"Regime-Aware AI Post-Processing of Monsoon Rainfall Forecasts"**.

## The problem
NWP rainfall errors in India depend on the weather regime: models are too dry in an active monsoon, drizzle-happy in a
break, terrain-blind over the Ghats, and compress extremes on the coast. A single universal bias correction cannot fix
all of these at once — it can even make some regimes worse.

## The solution
```
NWP forecast → data quality → feature engineering → regime classifier (Random Forest)
   → regime-specific ML correction (1 of 6 models) → P10–P90 range
   → P(rain ≥ 10 / 25 / 50 / 100 mm) → district / grid forecast → GIS map
   → verification (RMSE, MAE, Bias, R², CSI, POD, FAR, FSS, ETS) → alerts & advisory bulletin
```
Everything on screen is computed live by the Python backend from the data. Nothing is hard-coded.

### What makes this prototype different
| Feature | Why it matters |
|---|---|
| **Four-way comparison**: raw NWP vs *global* bias correction vs *regime-blind ML* vs *regime-aware AI* | Tests the core claim honestly instead of comparing only against raw NWP. In the bundled validation the single global correction makes most regimes **worse**; regime-aware correction improves all six. A flexible regime-blind ML baseline is about as accurate overall — the UI says so plainly. |
| **Regime error fingerprint** | Shows each regime's own NWP bias by intensity bin — the visual reason one correction cannot fit all. |
| **Correction Lab** | What-if sliders on the *live* models: the same weather is pushed through all six regime models side by side. |
| **Explainability from the real models** | Occlusion attributions for "why this regime?" and "what drove the correction"; permutation importance per model. |
| **P10–P90 uncertainty bands** | Quantile models with measured coverage (calibration table on the Verification page). |
| **Configurable alert engine + auto advisory bulletin** | Watch / Warning / Severe rules are explicit and adjustable; the bulletin text is generated from actual outputs. |
| **Data-quality stage with injected defects** | The simulated feed contains realistic defects; QC detects them (the page compares detected vs injected counts). |
| **Upload any CSV/JSON** | Full pipeline on your own file, with in-memory parsing, validation and results download. |

## Live mode (real weather)
Choose **"Live weather (real NWP forecast)"** in the scenario menu. The backend fetches real model forecasts
(rain, temperature, humidity, wind, pressure) from [Open-Meteo](https://open-meteo.com) — free, no API key — for every
grid point and runs them through the same pipeline (QC → features → regime → correction → probability → alerts).
* 24-h rainfall at each lead time = sum of hourly model rainfall over the 24 h ending at that time; "Now" = the last 24 h.
* **The correction is unvalidated:** the models were trained on simulated data, and live mode has **no observed rainfall**,
  so verification of the live forecast is disabled (the Verification page shows the held-out *simulated* scores, clearly labelled).
* Needs internet. Data is cached for 1 hour; **Refresh live data** fetches again. A full fetch (629 points) takes about
  1 minute because the free tier allows ~600 location-calls per minute; the app paces itself and waits out per-minute limits.
* The last successful fetch is saved to `backend/data/live_snapshot.npz`; if the service is unreachable (or rate-limited)
  the app falls back to that snapshot and says so in a banner.
* Open-Meteo's free tier is for non-commercial use with limits (about 10,000 calls/day); see their terms.

## Technology
Frontend: React 18, TypeScript, Vite, Tailwind CSS 4, Recharts, Leaflet (react-leaflet), Lucide.
Backend: Python, FastAPI, Pydantic, NumPy, pandas, scikit-learn, joblib. No database, Docker or cloud services.

## Folder structure
```
monsoon-ai/
├── backend/
│   ├── app/
│   │   ├── api/routes.py          HTTP endpoints
│   │   ├── ml/                    catalog, simulation, quality, features, pipeline (models), verification
│   │   ├── services/              forecast runs, insights, verification views, alerts, upload, app state
│   │   ├── schemas/models.py      Pydantic request/response models
│   │   └── utils/geo.py           distances, land mask, coastline, neighbourhoods
│   ├── models/                    trained joblib models + metadata.json (auto-created)
│   ├── tests/                     verification-metric unit tests
│   ├── train_models.py            train + evaluate + persist
│   └── requirements.txt
├── frontend/src/                  components, pages, layouts, services, hooks, types, utils
└── docs/                          ARCHITECTURE.md, DEMO_GUIDE.md
```

## Installation and run (Windows / VS Code)
Requirements: Python 3.10+ and Node 18+ (tested with Python 3.14 and Node 20).

**1. Backend** (terminal 1)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python train_models.py            # optional: ~1 minute, otherwise trained automatically on first start
python -m uvicorn app.main:app --port 8010
```
The API listens on **http://localhost:8010** (interactive docs at `/docs`). Port 8010 is used because 8000 is often taken;
change it in `frontend/vite.config.ts` (`MONSOON_BACKEND`) if you use another.

**2. Frontend** (terminal 2)
```powershell
cd frontend
npm install
npm run dev
```
Open the URL Vite prints (normally http://localhost:5173; it moves to the next free port if that is busy).
If the backend is still training, the app shows a progress screen and continues automatically.

Production build: `npm run build` (type-checks then bundles to `frontend/dist`).

## Demo
See [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) for the 3–5 minute jury script.

## API summary
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | readiness / model status |
| GET | `/api/scenarios`, POST `/api/generate` | scenario list; generate a run (returns measured pipeline timings) |
| GET | `/api/dashboard` | KPIs, regime mix, top risk, horizon summary |
| GET | `/api/forecast`, `/api/forecast/{district}` | all points (paginate with `page`, `page_size`, `search`, `regime`, `alert`, `sort`) / one district with timeline + explanations |
| GET | `/api/regimes`, `/api/regimes/{district}` | regime map + model routing / regime probabilities + attributions |
| POST | `/api/classify-regime`, `/api/correct-forecast` | classify / correct a hypothetical point (Correction Lab) |
| GET | `/api/heavy-rainfall`, `/api/bulletin` | exceedance probabilities, alerts, reliability; advisory text |
| GET | `/api/verification`, `/api/verification/regime-wise` | scores per source; per-regime scores and bias fingerprint |
| GET | `/api/data-quality` | QC report for the current run |
| POST | `/api/upload`, GET `/api/upload/{id}/download`, `/api/sample-dataset`, `/api/upload-spec` | upload pipeline |
| GET | `/api/model-info`, `/api/system-info` | model cards + metrics; runtime, limitations, endpoints |

Common query parameters: `scenario`, `seed`, `lead` (0/6/12/24/48/72), `heavy`, `very_heavy` (10/25/50/100),
and alert options `watch_p`, `warning_p`, `severe_p`, `min_conf`. Errors return `{"error": {"code", "message", "details"}}`.

## Sample upload format
CSV or JSON (list of records or `{"records": [...]}`), up to 5 MB / 20,000 rows. Download a ready-made file from the
Data Upload page or `/api/sample-dataset`.
```
timestamp,latitude,longitude,district,state,nwp_rainfall,observed_rainfall,temperature,humidity,wind_speed,wind_direction,pressure,elevation
2026-07-15T12:00:00Z,18.52,73.86,Pune,Maharashtra,16.2,24.0,23.6,91.5,14.7,273,1003.5,560
```
Units: rainfall mm/24 h, °C, %, m/s, degrees, hPa (MSLP), metres. Optional: `prev_rainfall`, `pressure_tendency`, `lead_time_hr`
(derived from repeated timestamps when absent).

## Limitations (please read)
* Data are simulated (except in Live mode, where the NWP input is real but the correction is unvalidated and unverifiable). The simulator's regime-specific error structure was designed by the authors, so measured
  improvements show that the method *can* work, not that it does on real forecasts.
* No IMD validation, operational verification or deployment readiness is claimed.
* A regime-blind ML model performs about as well as the regime-specific models on this data; the clear gains are versus
  raw NWP and versus a single global bias correction.
* District values are point / grid-cell estimates; grid cells inherit the state of the nearest named district.
* Basemap tiles come from a third party (Esri); boundaries shown are theirs and non-authoritative. The app draws none.
* Rare-event (≥ 100 mm) classification has low precision/recall at a 0.5 cut-off; use ROC-AUC, Brier and the reliability diagram.

## Future improvements
IMD gridded/station data, GPM and radar rainfall, ERA5, higher-resolution NWP and ensembles, ConvLSTM/Transformer
post-processing, real-time alert dissemination, cloud deployment. Simulation code lives in `backend/app/ml/simulation.py`
and `catalog.py`, behind the same DataFrame schema as the upload interface, so real feeds can replace it.
