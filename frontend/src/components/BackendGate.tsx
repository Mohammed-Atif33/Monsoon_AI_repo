import { CloudRain, CloudOff, Loader2, RefreshCw, TerminalSquare } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, request } from '../services/api'
import type { Health } from '../types/api'

type Phase = { kind: 'connecting' } | { kind: 'down'; message: string } | { kind: 'preparing'; health: Health } | { kind: 'failed'; health: Health } | { kind: 'ready' }

/** Blocks the app until the backend answers and its models are ready; never shows a blank screen. */
export function BackendGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting' })
  const [tries, setTries] = useState(0)
  const timer = useRef<number>()

  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const h = await request<Health>('/health')
        if (stop) return
        if (h.ready) { setPhase({ kind: 'ready' }); return }
        setPhase(h.status === 'error' ? { kind: 'failed', health: h } : { kind: 'preparing', health: h })
        if (h.status === 'error') return
      } catch (e) {
        if (stop) return
        setPhase({ kind: 'down', message: e instanceof ApiError ? e.message : 'Backend unreachable' })
      }
      timer.current = window.setTimeout(poll, 1500)
    }
    void poll()
    return () => { stop = true; window.clearTimeout(timer.current) }
  }, [tries])

  if (phase.kind === 'ready') return <>{children}</>

  return (
    <div className="min-h-full grid place-items-center bg-navy-950 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-navy-900 p-7 text-white shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-11 h-11 rounded-xl bg-cyan-400/15 text-cyan-300"><CloudRain className="w-6 h-6" /></div>
          <div>
            <div className="text-lg font-semibold tracking-tight">MonsoonAI</div>
            <div className="text-xs text-white/60">Regime-Aware Rainfall Forecast Intelligence</div>
          </div>
        </div>

        {(phase.kind === 'connecting' || phase.kind === 'preparing') && (
          <div className="mt-6" role="status">
            <div className="flex items-center gap-2 text-sm text-cyan-200"><Loader2 className="w-4 h-4 animate-spin" />
              {phase.kind === 'connecting' ? 'Connecting to the forecast engine…' : phase.health.message}
            </div>
            {phase.kind === 'preparing' && (
              <>
                <p className="mt-2 text-xs text-white/60">
                  {phase.health.status === 'training'
                    ? 'First start: the prototype models are being trained on the simulation engine. This happens once (about a minute) and the models are then saved.'
                    : 'Loading models and preparing the held-out validation cache…'}
                </p>
                <pre className="mt-3 max-h-36 overflow-auto rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed text-white/70 font-mono">{phase.health.log.join('\n')}</pre>
              </>
            )}
          </div>
        )}

        {phase.kind === 'down' && (
          <div className="mt-6" role="alert">
            <div className="flex items-center gap-2 text-sm text-amber-300"><CloudOff className="w-4 h-4" /> Backend unavailable</div>
            <p className="mt-1.5 text-xs text-white/70">{phase.message}</p>
            <div className="mt-3 rounded-lg bg-black/30 p-3 text-[12px] font-mono text-white/80 leading-relaxed">
              <div className="flex items-center gap-1.5 text-white/50 mb-1"><TerminalSquare className="w-3.5 h-3.5" /> start the API</div>
              cd backend<br />.venv\Scripts\activate<br />python -m uvicorn app.main:app --port 8010
            </div>
            <button onClick={() => { setPhase({ kind: 'connecting' }); setTries((t) => t + 1) }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-xs font-medium">
              <RefreshCw className="w-3.5 h-3.5" /> Retry now
            </button>
            <p className="mt-2 text-[11px] text-white/40">Retrying automatically…</p>
          </div>
        )}

        {phase.kind === 'failed' && (
          <div className="mt-6" role="alert">
            <div className="text-sm text-red-300 font-medium">Model initialisation failed</div>
            <p className="mt-1.5 text-xs text-white/70">{phase.health.error}</p>
            <p className="mt-2 text-xs text-white/50">Run <code className="font-mono">python train_models.py --force</code> in the backend folder, then restart the API.</p>
          </div>
        )}
      </div>
    </div>
  )
}
