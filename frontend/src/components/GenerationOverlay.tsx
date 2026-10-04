import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../hooks/useApp'
import { regimeLabel } from '../utils/colors'

const STAGES = ['NWP Forecast Ingest', 'Data Quality Check', 'Feature Engineering', 'Regime Classification', 'Regime-Specific Correction', 'Exceedance Probability']

/** Shows the real pipeline stages (with measured timings) each time a scenario is loaded / a new forecast generated. */
export function GenerationOverlay() {
  const { generation, dismissGeneration, generateNew } = useApp()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (generation.status === 'running') { setShown(0); return }
    if (generation.status === 'done') {
      setShown(0)
      const t = window.setInterval(() => setShown((n) => (n < 6 ? n + 1 : n)), 110)
      const hide = window.setTimeout(dismissGeneration, 2600)
      return () => { window.clearInterval(t); window.clearTimeout(hide) }
    }
  }, [generation.status, generation.res, dismissGeneration])

  if (generation.status === 'idle') return null
  const steps = generation.res?.pipeline
  const names = steps ? steps.map((x) => x.name) : STAGES

  return (
    <div className="fixed z-[2000] top-[72px] right-4 w-[340px] rounded-xl border border-line bg-white shadow-xl mai-in no-print" role="status" aria-live="polite">
      <div className="flex items-center justify-between px-3.5 pt-3">
        <div className="text-[13px] font-semibold text-ink flex items-center gap-2">
          {generation.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-accent" />}
          {generation.status === 'done' && <Check className="w-4 h-4 text-emerald-600" />}
          {generation.status === 'error' && <AlertTriangle className="w-4 h-4 text-red-600" />}
          {generation.status === 'running' ? generation.label : generation.status === 'done' ? 'Forecast ready' : 'Generation failed'}
        </div>
        {generation.status !== 'running' && <button onClick={dismissGeneration} aria-label="Dismiss" className="p-1 text-muted hover:text-ink"><X className="w-3.5 h-3.5" /></button>}
      </div>
      <ol className="px-3.5 py-2.5 space-y-1.5">
        {names.map((name, i) => {
          const done = generation.status === 'done' && i < shown
          const step = steps?.[i]
          return (
            <li key={name} className="flex items-center gap-2 text-xs">
              <span className={`grid place-items-center w-4 h-4 rounded-full border ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-line-strong text-transparent'}`}>
                {done ? <Check className="w-2.5 h-2.5" /> : generation.status === 'running' && i === 0 ? <Loader2 className="w-2.5 h-2.5 animate-spin text-accent" /> : null}
              </span>
              <span className={done ? 'text-ink' : 'text-muted'}>{name}</span>
              <span className="ml-auto num text-[11px] text-faint">{done && step?.ms != null ? `${step.ms.toFixed(0)} ms` : ''}</span>
            </li>
          )
        })}
      </ol>
      {generation.status === 'done' && generation.res && (
        <div className="px-3.5 pb-3 text-[11px] text-muted border-t border-line pt-2">
          Detected <span className="font-semibold text-ink">{regimeLabel(generation.res.regime.regime)}</span> ({((generation.res.regime.confidence ?? 0) * 100).toFixed(0)}% confidence) · run #{generation.res.seed}
        </div>
      )}
      {generation.status === 'error' && (
        <div className="px-3.5 pb-3 text-xs text-red-800">
          {generation.error}
          <button onClick={generateNew} className="ml-2 underline font-medium">Retry</button>
        </div>
      )}
    </div>
  )
}
