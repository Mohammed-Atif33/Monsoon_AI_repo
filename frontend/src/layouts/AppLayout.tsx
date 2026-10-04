import {
  BrainCircuit, CloudLightning, CloudRain, Compass, Database, FlaskConical, LayoutDashboard, Loader2, Map as MapIcon, MapPin, Menu, ServerCog, ShieldCheck, Sparkles, Target, Upload, X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { GenerationOverlay } from '../components/GenerationOverlay'
import { Segmented, Select, Button, cx } from '../components/ui'
import { useDashboard } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import { fmtClock, fmtDateTime } from '../utils/format'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/map', label: 'Forecast Map', icon: MapIcon },
  { to: '/regimes', label: 'Weather Regimes', icon: Compass },
  { to: '/districts', label: 'District Forecast', icon: MapPin },
  { to: '/post-processing', label: 'AI Post-Processing', icon: BrainCircuit },
  { to: '/heavy-rainfall', label: 'Heavy Rainfall', icon: CloudLightning },
  { to: '/verification', label: 'Verification', icon: Target },
  { to: '/data-quality', label: 'Data Quality', icon: ShieldCheck },
  { to: '/upload', label: 'Data Upload', icon: Upload },
  { to: '/models', label: 'Model Insights', icon: FlaskConical },
  { to: '/system', label: 'System Information', icon: ServerCog },
]

const LEADS = [0, 6, 12, 24, 48, 72]
const THR = [10, 25, 50, 100]

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { isLive } = useApp()
  return (
    <div className="h-full flex flex-col bg-navy-900 text-white">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-300/20"><CloudRain className="w-5 h-5" /></div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-wide">MONSOON<span className="text-cyan-300">AI</span></div>
          <div className="text-[10px] text-white/55 leading-snug">Regime-Aware Rainfall<br />Forecast Intelligence</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5" aria-label="Main navigation">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to} to={to} end={to === '/'} onClick={onNavigate}
            className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
              isActive ? 'bg-white/12 text-white ring-1 ring-white/10' : 'text-white/65 hover:text-white hover:bg-white/6')}
          >
            {({ isActive }) => (<><Icon className={cx('w-4 h-4', isActive ? 'text-cyan-300' : 'text-white/50')} />{label}</>)}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 text-[10px] text-white/45 border-t border-white/10 leading-relaxed">
        <div className="flex items-center gap-1.5 text-white/70 font-medium"><Database className="w-3 h-3" /> {isLive ? 'Live NWP input' : 'Prototype Simulation'}</div>
        {isLive ? 'Real forecasts, unvalidated AI correction.' : 'Simulated NWP & observations. Not IMD-validated.'}
      </div>
    </div>
  )
}

function ContextBar() {
  const { scenario, scenarios, setScenario, generateNew, generation, lead, setLead, heavy, veryHeavy, setThresholds, seed, isLive } = useApp()
  const running = generation.status === 'running'
  const note = scenarios.find((s) => s.key === scenario)?.note
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-t border-line bg-white/80">
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide font-semibold text-muted" htmlFor="scenario">Demo scenario</label>
        <select
          id="scenario" value={scenario} disabled={running} onChange={(e) => setScenario(e.target.value as typeof scenario)} title={note}
          className="bg-white border border-line-strong rounded-lg py-1.5 pl-2.5 pr-7 text-[13px] font-semibold text-navy-900 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
        >
          {(scenarios.length ? scenarios : [{ key: scenario, label: scenario, note: '' }]).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <Button variant="primary" onClick={generateNew} disabled={running} icon={running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}>
          {isLive ? 'Refresh live data' : 'Generate New Forecast'}
        </Button>
        {isLive ? <span className="hidden xl:inline-flex items-center gap-1 text-[11px] font-semibold text-red-700"><span className="w-1.5 h-1.5 rounded-full bg-red-600 mai-pulse" />LIVE</span> : <span className="hidden xl:inline text-[11px] text-muted num" title="Deterministic simulation seed">run #{seed}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-muted">Horizon</span>
        <Segmented size="sm" label="Forecast horizon" value={lead} onChange={setLead} options={LEADS.map((l) => ({ value: l, label: l === 0 ? 'Now' : `+${l}h` }))} />
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <Select label="Heavy ≥" value={heavy} onChange={(v) => setThresholds(v, veryHeavy)} options={THR.map((t) => ({ value: t, label: `${t} mm` }))} />
        <Select label="Very heavy ≥" value={veryHeavy} onChange={(v) => setThresholds(heavy, v)} options={THR.filter((t) => t >= heavy).map((t) => ({ value: t, label: `${t} mm` }))} />
      </div>
    </div>
  )
}

export function AppLayout() {
  const [open, setOpen] = useState(false)
  const dash = useDashboard()
  const loc = useLocation()
  const m = dash.data?.meta

  return (
    <div className="h-full flex bg-canvas">
      <aside className="hidden lg:block w-[228px] shrink-0 h-full"><Sidebar /></aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-[3000] flex">
          <div className="w-[240px] h-full shadow-2xl"><Sidebar onNavigate={() => setOpen(false)} /></div>
          <button className="flex-1 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)}><X className="w-5 h-5 text-white m-3" /></button>
        </div>
      )}
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <header className="mai-top bg-white border-b border-line shrink-0 z-[1000]">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button className="lg:hidden p-1.5 -ml-1 rounded-md hover:bg-slate-100" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="w-5 h-5" /></button>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-tight text-navy-900 leading-tight">MONSOON<span className="text-accent">AI</span></div>
              <div className="text-[11px] text-muted leading-tight truncate">Regime-Aware Rainfall Forecast Intelligence</div>
            </div>
            <div className="ml-auto hidden md:flex items-center gap-4 text-[11px] text-muted">
              <span><span className="uppercase tracking-wide font-semibold">Data mode</span> <span className="text-ink font-semibold">{m?.data_mode ?? 'Prototype Simulation'}</span></span>
              <span><span className="uppercase tracking-wide font-semibold">Forecast cycle</span> <span className="text-ink font-semibold num">{m?.forecast_cycle ?? '12 UTC'}</span></span>
              <span><span className="uppercase tracking-wide font-semibold">Last updated</span> <span className="text-ink font-semibold num">{fmtClock(m?.last_updated)}</span></span>
            </div>
          </div>
          <ContextBar />
          {m?.is_live ? (
            <>
              <div className="px-4 py-1 bg-red-50 border-t border-red-200 text-[11px] text-red-900 flex items-center gap-2 flex-wrap" role="note">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-600" />
                <strong className="font-semibold">LIVE NWP input</strong>
                <span className="text-red-800/90">— real forecasts from {m.live?.source ?? 'Open-Meteo'}, fetched {fmtDateTime(m.live?.fetched_at)}. The AI correction is <b>unvalidated</b> (models trained on simulated data) and there is no observed rainfall to verify against.</span>
              </div>
              {m.live?.warning && <div className="px-4 py-1 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-900" role="alert">{m.live.warning}</div>}
            </>
          ) : (
            <div className="px-4 py-1 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-900 flex items-center gap-2" role="note">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
              <strong className="font-semibold">Prototype / Demonstration Data</strong>
              <span className="hidden sm:inline text-amber-800/80">— all meteorological inputs are simulated; results are not IMD-validated or operational.</span>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-y-auto" id="main">
          <div key={loc.pathname} className="p-4 md:p-5 max-w-[1680px] mx-auto mai-in">
            <Outlet />
          </div>
        </main>
      </div>
      <GenerationOverlay />
    </div>
  )
}
