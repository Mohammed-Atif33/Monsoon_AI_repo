# MonsoonAI frontend

React 18 + TypeScript + Vite + Tailwind CSS 4. Charts: Recharts. Map: Leaflet (canvas markers).

```powershell
npm install
npm run dev        # http://localhost:5173 (or the next free port); proxies /api to http://127.0.0.1:8010
npm run build      # tsc type-check + production bundle
```

Set `MONSOON_BACKEND` to point the dev proxy elsewhere.

* `src/hooks/useApp.tsx` – global context (scenario, seed, horizon, thresholds, selected district).
* `src/hooks/useApi.ts` – cached, de-duplicated fetch hook returning `{data, loading, fetching, error, refetch}`.
* `src/components/ui.tsx` – primitives incl. `Async` (loading / error / success wrapper used for every request).
* `src/components/BackendGate.tsx` – shows connection / model-training progress instead of a blank screen.
* `src/types/api.ts` – types mirroring the backend responses.
