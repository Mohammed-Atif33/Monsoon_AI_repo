# MonsoonAI architecture

```
                 NWP DATA (simulated feed / uploaded file)
                    │
                    ▼
             DATA QUALITY  (validate, convert units, repair, score)
                    │
                    ▼
          FEATURE ENGINEERING  (16 features)
                    │
                    ▼
         WEATHER REGIME CLASSIFIER  (Random Forest, 6 classes + probabilities)
                    │  routes each point by its detected regime
        ┌───────────┼───────────┬───────────┬───────────┬───────────┐
        ▼           ▼           ▼           ▼           ▼           ▼
     Active       Break     Depression   Coastal   Orographic     WD
      model       model       model       model       model      model      (HistGradientBoosting, + P10/P90)
        └───────────┴───────────┴─────┬─────┴───────────┴───────────┘
                                      ▼
                             CORRECTED FORECAST
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        HEAVY-RAINFALL PROBABILITY            DISTRICT / GRID FORECAST
        P(≥10/25/50/100 mm), 4 classifiers            │
                    └─────────────────┬─────────────────┘
                                      ▼
                                   GIS MAP
                                      ▼
                    VERIFICATION (RMSE MAE Bias R² CSI POD FAR FSS ETS)
                                      ▼
                        DECISION SUPPORT (alerts, advisory bulletin)
```

## Backend
* **`ml/catalog.py`** – ~630 locations: 156 named district anchors (approximate HQ coordinates/elevation) plus a
  0.62° land-masked grid. Derives static geography: elevation, coastal distance, orographic zone, rain-shadow, NW-dry, NE, WD zone.
* **`ml/simulation.py`** – deterministic scenario generator. Per scenario, regime affinity scores over geography
  (+ smooth noise, + a moving storm for depressions) give a regime map. Regime "signatures" (humidity, MSLP, 24 h
  tendency, wind, temperature) generate features; observed rainfall is a zero-inflated log-normal whose mean depends on
  regime *and* features. The NWP forecast is a regime-specific distortion of the same latent rain (Active: dry bias
  depending on humidity/wind; Break: wet bias + drizzle false alarms; Depression: strong under-forecast + large noise;
  Coastal: compression of extremes; Orographic: terrain smoothing ∝ elevation; WD: wet bias). Error grows with lead time.
  `inject_defects` adds realistic feed defects (missing values, sentinels, duplicates, bad coordinates …).
* **`ml/quality.py`** – nine checks; repairs by spatial-neighbour median, unit conversion, coordinate restoration from
  station metadata; drops rows without timestamp/coordinates or duplicates. Score = 0.40 row validity + 0.30 completeness
  + 0.20 value validity + 0.10 uniqueness, all computed from the data.
* **`ml/features.py`** – wind vectors, coastal distance, `spatial_coverage` (share of neighbours ≤ 250 km with NWP ≥ 2.5 mm),
  `nwp_nbr_mean`, plus passthrough features. Used identically for training, forecasting and uploads.
* **`ml/pipeline.py`** – `MonsoonPipeline`: train / save / load / `run`. Also a global quantile-mapping baseline and a
  regime-blind gradient-boosting baseline (ablations only). Probability models are trained on **out-of-fold** corrected
  rainfall (GroupKFold by run) to avoid optimistic inputs, and probabilities are forced non-increasing across thresholds.
  Explanations: `explain_regime`, `explain_correction` (occlusion vs training medians).
* **`ml/verification.py`** – metrics from first principles (NumPy). FSS uses a circular neighbourhood (default 150 km) per
  forecast field. Undefined scores (no events) are `null`, never 0. Unit tests in `tests/`.
* **`services/`** – `forecast_service` builds/caches runs (LRU 10) and measures each pipeline stage; `insights` builds view
  payloads; `verification_service` caches the held-out validation frame and metric views; `alerts` holds the rule engine;
  `upload_service` does safe in-memory parsing; `state` manages the model lifecycle in a background thread.
* **`api/routes.py`, `main.py`** – thin HTTP layer, Pydantic validation, uniform error JSON, gzip, CORS for the dev server.

## Live mode
`services/live_service.py` fetches hourly Open-Meteo data (batches of 80 points, paced to ≤ 400 location-calls/minute,
3 worker threads, per-minute 429 waits) and converts it to the simulator's raw-record schema (`payload_to_raw`); the rest of
the pipeline is unchanged. `scenario=live` is a pseudo-scenario: `forecast_service.get_run` caches it for `LIVE_TTL_S`
(1 h), refreshes on demand (`POST /api/generate {"scenario":"live","refresh":true}`), serves the previous run if a refresh
fails, and falls back to `data/live_snapshot.npz` when offline. `observed_rainfall` is NaN, so error layers,
the bulletin's skill paragraph and `/api/verification?scope=scenario` are disabled/adapted for live runs (HTTP 422 with a clear message).

## Data flow (one request)
`GET /api/dashboard?scenario=depression&seed=7&lead=0` → `Ctx` validates parameters → `get_run` (cache or
simulate → QC → features → `pipeline.run`) → `insights.dashboard` reads the cached run + validation frame → JSON.
`POST /api/generate` warms the cache and returns measured stage timings; the UI overlay displays them.

## Frontend
Route pages under `src/pages`, one shared context (scenario/seed/horizon/thresholds/selection) and one fetch hook.
Every request is wrapped in `Async` (skeleton → error with retry → content). `BackendGate` handles an unavailable or
still-training backend. Map layers are defined once in `utils/layers.ts` and reused by the Leaflet map and canvas mini-maps.

## Verification design
Held-out validation: seeds unseen in training, all six scenarios and lead times. Scores use the *detected* regime for
routing, i.e. what the pipeline actually does. Sources compared: raw NWP, global quantile mapping, regime-blind ML,
regime-aware AI.

## Extending to real data
Replace `simulation.simulate_forecast` with a loader that returns the same columns as the upload schema; retrain with
`train_models.py`; the rest of the stack (QC → features → models → verification) is unchanged.
