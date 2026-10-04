# SIH jury demo guide (3–5 minutes)

**Before you start:** backend running on :8010, frontend open on the Dashboard, scenario *Active Monsoon*.
Say once, up front: *"All data is simulated and labelled Prototype / Demonstration Data; we show the method, not IMD-validated skill."*

| Time | Screen | What to do / say |
|---|---|---|
| 0:00 | **Dashboard** | "Raw NWP is wrong in regime-dependent ways. MonsoonAI first asks *what regime are we in?*" Point at KPIs: current regime + confidence, districts monitored, high-risk districts, RMSE improvement. Show the map (AI-corrected layer) and the pipeline strip (measured timings). |
| 0:40 | **Scenario switch** | Change *Demo scenario* to **Monsoon Depression**. The overlay shows the real stages; the regime, map, risk list and KPIs all change. Click **Generate New Forecast** to draw a fresh seed. |
| 1:10 | **Select a district** | Click a red point. Side panel: Raw NWP vs AI corrected vs Observed, heavy / very-heavy probability, confidence, and *"Regime-specific model selected"*. |
| 1:40 | **Weather Regimes** | "Why was this regime detected?" — attribution bars from the Random Forest, alternative probabilities, observed vs typical signature. |
| 2:10 | **AI Post-Processing** | The animated flow: NWP → regime → regime-specific model → corrected forecast. Move the Correction Lab sliders or press a preset: *same weather, six different regime models*. Mention the error fingerprint chart at the bottom. |
| 2:50 | **Heavy Rainfall** | Probability maps, alert cards (Watch / Warning / Severe from explicit rules), adjustable thresholds, reliability diagram, and the auto-generated advisory bulletin. |
| 3:20 | **Verification** | Held-out validation: RMSE ↓, CSI ↑, POD ↑, FSS ↑ vs NWP (FAR: be candid if it is slightly higher). Note the four-way comparison including a *single global bias correction*. |
| 4:00 | **Verification → Regime-wise** | The key slide: "Regime vs forecast skill". Error differs by regime; regime-aware correction improves all six while a global correction worsens most. Be candid that a regime-blind ML model is about as accurate overall — the value is routing, interpretability, per-regime uncertainty and diagnostics. |
| 4:30 | **Data Upload** (optional) | Download the sample, upload it, show the pipeline run and results. |

## Tips
* If asked "is this real data?" — no; it is a scientifically structured simulation (see *System Information → Limitations*).
* "Is the ML real?" — yes: Model Insights lists algorithms, sizes, held-out metrics and the training timestamp; every number is computed.
* Keep the horizon at **Now** unless you want to show regime evolution (+24 h, +48 h) on the Weather Regimes page.
* Offline venue: map tiles need internet; without it the data layer still renders on a plain background.
* Reset: `Generate New Forecast` for a new random run; selecting a scenario resets to the reproducible baseline seed 7.
