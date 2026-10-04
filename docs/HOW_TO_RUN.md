# MonsoonAI — How to Run (Windows)

## 1. Install once
| Tool | Version | Check |
|---|---|---|
| Python | 3.10 or newer | `python --version` |
| Node.js | 18 or newer (20 recommended) | `node --version` |

An internet connection is needed for the first install and for the map background tiles.

## 2. Start the backend (Terminal 1)
```powershell
cd monsoon-ai\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8010
```
* On the first start the models are not included, so the API trains them automatically (about 1–2 minutes). Progress is shown in the terminal and in the web page. This happens only once; models are saved in `backend\models`.
* Optional: run `python train_models.py --force` to retrain manually.
* Check it works: open http://localhost:8010/api/health — it should say `"status":"ready"`. API docs: http://localhost:8010/docs

## 3. Start the frontend (Terminal 2)
```powershell
cd monsoon-ai\frontend
npm install
npm run dev
```
Open the address printed by Vite (usually **http://localhost:5173**; if that port is busy it prints another, e.g. 5174).

## 4. Using it
1. Pick a **Demo scenario** at the top and click **Generate New Forecast**.
2. Click any point on the map to see raw NWP vs AI-corrected rainfall, probabilities and the detected regime.
3. Explore pages from the left menu: Weather Regimes, AI Post-Processing (with the Correction Lab), Heavy Rainfall, Verification, Data Upload, Model Insights.
4. Jury walkthrough: `docs\DEMO_GUIDE.md`.

## Live weather mode
Pick **"Live weather (real NWP forecast)"** in the *Demo scenario* menu. Real forecasts are downloaded from Open-Meteo (free, no key, needs internet). The first load takes about a minute (the free service limits requests per minute); results are cached for an hour and **Refresh live data** fetches again. If the internet or service is unavailable, the last saved snapshot is shown with a warning. In Live mode the AI correction is unvalidated and there is no observed rainfall, so forecast verification is not available.

## 5. Troubleshooting
| Problem | Fix |
|---|---|
| Page says "Backend unavailable" | Terminal 1 is not running, or is not on port 8010. Restart it. |
| "Port 8010 already in use" | Use another port, e.g. `--port 8020`, and start the frontend with `set MONSOON_BACKEND=http://127.0.0.1:8020` before `npm run dev`. |
| Page says models are training | Wait; it continues automatically. |
| Map background is grey | No internet; data points still display. |
| `python` not found | Reinstall Python and tick "Add to PATH". |
| PowerShell blocks `activate` | Run `Set-ExecutionPolicy -Scope Process Bypass` first. |

## 6. Production build (optional)
`cd frontend` then `npm run build` — checks types and creates `frontend\dist`.

## Note
All data is simulated ("Prototype / Demonstration Data"). Results are not IMD-validated. See `README.md` for details.
