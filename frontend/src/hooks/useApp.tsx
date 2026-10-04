import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, post, qs, request } from '../services/api'
import type { GenerateResponse, ScenarioInfo, ScenarioKey, ScenariosResponse } from '../types/api'

export interface Generation {
  status: 'idle' | 'running' | 'done' | 'error'
  label: string
  res?: GenerateResponse
  error?: string
}

interface AppCtx {
  scenario: ScenarioKey
  seed: number
  lead: number
  heavy: number
  veryHeavy: number
  selectedId: string | null
  scenarios: ScenarioInfo[]
  defaultSeed: number
  generation: Generation
  isLive: boolean
  /** query string for the context endpoints (scenario, seed, lead, thresholds) */
  q: string
  qNoLead: string
  setScenario: (s: ScenarioKey) => void
  generateNew: () => void
  setLead: (l: number) => void
  setThresholds: (heavy: number, veryHeavy: number) => void
  select: (id: string | null) => void
  dismissGeneration: () => void
}

const Ctx = createContext<AppCtx | null>(null)
const STORE = 'monsoonai.ctx.v1'

function load(): Partial<{ scenario: ScenarioKey; seed: number; lead: number; heavy: number; veryHeavy: number; selectedId: string | null }> {
  try {
    const raw = localStorage.getItem(STORE)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const stored = useMemo(load, [])
  const [scenario, setScenarioState] = useState<ScenarioKey>(stored.scenario ?? 'active_monsoon')
  const [seed, setSeed] = useState<number>(stored.seed ?? 7)
  const [lead, setLeadState] = useState<number>(stored.lead ?? 0)
  const [heavy, setHeavy] = useState<number>(stored.heavy ?? 50)
  const [veryHeavy, setVeryHeavy] = useState<number>(stored.veryHeavy ?? 100)
  const [selectedId, setSelected] = useState<string | null>(stored.selectedId ?? null)
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([])
  const [defaultSeed, setDefaultSeed] = useState(7)
  const [generation, setGeneration] = useState<Generation>({ status: 'idle', label: '' })

  useEffect(() => {
    request<ScenariosResponse>('/scenarios').then((r) => { setScenarios(r.items); setDefaultSeed(r.default_seed) }).catch(() => undefined)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ scenario, seed, lead, heavy, veryHeavy, selectedId })) } catch { /* storage unavailable */ }
  }, [scenario, seed, lead, heavy, veryHeavy, selectedId])

  const run = useCallback(async (sc: ScenarioKey, sd: number | null, label: string, refresh = false) => {
    setGeneration({ status: 'running', label })
    try {
      const body = sc === 'live' ? { scenario: sc, refresh } : sd === null ? { scenario: sc } : { scenario: sc, seed: sd }
      const res = await post<GenerateResponse>('/generate', body)
      setScenarioState(res.scenario)
      setSeed(res.seed)
      setGeneration({ status: 'done', label, res })
    } catch (e) {
      setGeneration({ status: 'error', label, error: e instanceof ApiError ? e.message : String(e) })
    }
  }, [])

  const setScenario = useCallback((s: ScenarioKey) => { void run(s, defaultSeed, s === 'live' ? 'Fetching real forecast (first load can take about a minute)' : `Loading ${s.replace('_', ' ')} scenario`) }, [run, defaultSeed])
  const generateNew = useCallback(() => { void run(scenario, null, scenario === 'live' ? 'Refreshing live weather (can take about a minute)' : 'Generating new forecast', true) }, [run, scenario])
  const setLead = useCallback((l: number) => setLeadState(l), [])
  const setThresholds = useCallback((h: number, v: number) => { setHeavy(h); setVeryHeavy(Math.max(v, h)) }, [])
  const select = useCallback((id: string | null) => setSelected(id), [])
  const dismissGeneration = useCallback(() => setGeneration((g) => (g.status === 'running' ? g : { status: 'idle', label: '' })), [])

  const q = useMemo(() => qs({ scenario, seed, lead, heavy, very_heavy: veryHeavy }), [scenario, seed, lead, heavy, veryHeavy])
  const qNoLead = useMemo(() => qs({ scenario, seed, heavy, very_heavy: veryHeavy }), [scenario, seed, heavy, veryHeavy])

  const value: AppCtx = { isLive: scenario === 'live', scenario, seed, lead, heavy, veryHeavy, selectedId, scenarios, defaultSeed, generation, q, qNoLead, setScenario, generateNew, setLead, setThresholds, select, dismissGeneration }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp must be used inside <AppProvider>')
  return c
}
