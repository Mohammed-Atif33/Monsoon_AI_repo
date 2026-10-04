import { ArrowRight, FlaskConical, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTip, GRID } from '../components/charts'
import { DriverBars, ProbBars } from '../components/DriverBars'
import { Async, Button, Callout, Card, CardHeader, ErrorState, PageHeader, RegimeBadge, Segmented, Select, Skeleton, SkeletonBlock, cx } from '../components/ui'
import { useDistrict, useForecast, useRegimeWise } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import { post, ApiError } from '../services/api'
import type { CorrectResult, DistrictDetail, PointInput, RegimeKey } from '../types/api'
import { REGIME_KEYS, REGIME_META, regimeColor, regimeLabel, SOURCE_COLORS } from '../utils/colors'
import { fmtMm, fmtPct, fmtSigned, shortName } from '../utils/format'

function Node({ step, title, big, sub, color, active }: { step: number; title: string; big: string; sub: React.ReactNode; color?: string; active?: boolean }) {
  return (
    <div className={cx('flex-1 min-w-[190px] rounded-xl border p-3.5', active ? 'border-accent bg-accent-soft' : 'border-line bg-white')}>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <span className="grid place-items-center w-4 h-4 rounded-full bg-navy-900 text-white text-[9px]">{step}</span>{title}
      </div>
      <div className="mt-1.5 text-xl font-semibold num leading-tight" style={{ color: color ?? '#0f1c2e' }}>{big}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  )
}
const Arrow = () => (
  <div className="hidden lg:grid place-items-center px-1 text-accent">
    <svg width="34" height="14" viewBox="0 0 34 14"><line x1="0" y1="7" x2="26" y2="7" stroke="currentColor" strokeWidth="2" className="mai-flow" /><path d="M24 2l8 5-8 5z" fill="currentColor" /></svg>
  </div>
)

function Flow({ d }: { d: DistrictDetail }) {
  const c = d.current
  const { heavy, veryHeavy } = useApp()
  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row items-stretch gap-2">
        <Node step={1} title="Raw NWP forecast" big={fmtMm(c.nwp)} sub={`${c.category_nwp} · valid ${d.meta.lead_label}`} color="#e07b39" />
        <Arrow />
        <Node step={2} title="Regime detection" big={regimeLabel(c.regime)} sub={<>Random Forest confidence <b className="text-ink">{fmtPct(c.confidence)}</b></>} color={regimeColor(c.regime)} />
        <Arrow />
        <Node step={3} title="Regime-specific model" big={d.model_used.replace(' Correction Model', '')} sub={<>1 of 6 gradient-boosting models · adjusts <b className="text-ink">{fmtSigned(d.correction_effect.adjustment_mm, 0)} mm</b></>} active />
        <Arrow />
        <Node step={4} title="Corrected forecast" big={fmtMm(c.corrected)} sub={<>P10–P90 {c.q10.toFixed(0)}–{c.q90.toFixed(0)} mm · observed {fmtMm(c.observed)}</>} color="#0e7c9a" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-line px-3 py-2 flex justify-between"><span className="text-muted">P(rain ≥ {heavy} mm)</span><b className="num">{fmtPct(c.p_heavy)}</b></div>
        <div className="rounded-lg border border-line px-3 py-2 flex justify-between"><span className="text-muted">P(rain ≥ {veryHeavy} mm)</span><b className="num">{fmtPct(c.p_very)}</b></div>
      </div>
    </div>
  )
}

const PRESETS: Record<RegimeKey, Partial<PointInput>> = {
  active_monsoon: { temperature: 26, humidity: 88, wind_speed: 9, wind_direction: 245, pressure: 1000.5, pressure_tendency: -1, spatial_coverage: 0.85 },
  break_monsoon: { temperature: 33, humidity: 62, wind_speed: 4, wind_direction: 300, pressure: 1005.5, pressure_tendency: 0.9, spatial_coverage: 0.25 },
  depression: { temperature: 25, humidity: 94, wind_speed: 15, wind_direction: 210, pressure: 994, pressure_tendency: -3.2, spatial_coverage: 0.95 },
  coastal: { temperature: 28, humidity: 90, wind_speed: 11, wind_direction: 245, pressure: 1002, pressure_tendency: -0.4, spatial_coverage: 0.8, elevation: 10 },
  orographic: { temperature: 20, humidity: 92, wind_speed: 12.5, wind_direction: 255, pressure: 1001.5, pressure_tendency: -0.6, spatial_coverage: 0.9, elevation: 1100 },
  western_disturbance: { temperature: 21, humidity: 68, wind_speed: 8, wind_direction: 285, pressure: 1005, pressure_tendency: -1.8, spatial_coverage: 0.5, latitude: 31 },
}
const DEFAULT_INPUT: PointInput = { nwp_rainfall: 40, temperature: 27, humidity: 90, wind_speed: 10, wind_direction: 245, pressure: 1001, pressure_tendency: -1, elevation: 100, latitude: 19, longitude: 74, prev_rainfall: 30, spatial_coverage: 0.8 }
const SLIDERS: { k: keyof PointInput; label: string; min: number; max: number; step: number; unit: string }[] = [
  { k: 'nwp_rainfall', label: 'Raw NWP rainfall', min: 0, max: 300, step: 1, unit: 'mm' }, { k: 'prev_rainfall', label: 'Rain, previous 24 h', min: 0, max: 200, step: 1, unit: 'mm' },
  { k: 'humidity', label: 'Humidity', min: 30, max: 100, step: 1, unit: '%' }, { k: 'wind_speed', label: 'Wind speed', min: 0, max: 30, step: 0.5, unit: 'm/s' },
  { k: 'wind_direction', label: 'Wind direction', min: 0, max: 360, step: 5, unit: '°' }, { k: 'pressure', label: 'Pressure (MSLP)', min: 985, max: 1015, step: 0.5, unit: 'hPa' },
  { k: 'pressure_tendency', label: 'Pressure tendency', min: -6, max: 4, step: 0.1, unit: 'hPa/24h' }, { k: 'temperature', label: 'Temperature', min: 5, max: 42, step: 0.5, unit: '°C' },
  { k: 'elevation', label: 'Elevation', min: 0, max: 3000, step: 10, unit: 'm' }, { k: 'spatial_coverage', label: 'Rain coverage nearby', min: 0, max: 1, step: 0.05, unit: '' },
  { k: 'latitude', label: 'Latitude', min: 8, max: 34, step: 0.5, unit: '°N' }, { k: 'longitude', label: 'Longitude', min: 68, max: 96, step: 0.5, unit: '°E' },
]

function Lab({ d }: { d: DistrictDetail | undefined }) {
  const [input, setInput] = useState<PointInput>(DEFAULT_INPUT)
  const [override, setOverride] = useState<RegimeKey | 'auto'>('auto')
  const [res, setRes] = useState<CorrectResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(async () => {
      setBusy(true)
      try {
        setRes(await post<CorrectResult>('/correct-forecast', { ...input, ...(override !== 'auto' ? { regime_override: override } : {}) }))
        setErr(null)
      } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)) } finally { setBusy(false) }
    }, 250)
    return () => window.clearTimeout(t)
  }, [input, override])

  const loadDistrict = () => {
    if (!d) return
    const c = d.current
    setInput({ nwp_rainfall: c.nwp, temperature: c.temperature, humidity: c.humidity, wind_speed: c.wind_speed, wind_direction: c.wind_direction, pressure: c.pressure, pressure_tendency: c.pressure_tendency,
      elevation: c.elevation ?? 0, latitude: c.lat, longitude: c.lon, prev_rainfall: c.prev_rainfall, spatial_coverage: c.spatial_coverage })
    setOverride('auto')
  }
  const set = (k: keyof PointInput, v: number) => setInput((s) => ({ ...s, [k]: v }))

  const bars = useMemo(() => (res?.all_regimes ?? []).map((r) => ({ name: REGIME_META[r.regime].short, regime: r.regime, value: r.corrected, p: r.classifier_probability })), [res])

  return (
    <Card>
      <CardHeader
        icon={<FlaskConical className="w-4 h-4 text-accent" />} title="Correction Lab — what-if on the live models"
        subtitle="Change the weather; the classifier picks the regime and that regime's model corrects the NWP rainfall. Nothing here is pre-computed."
        right={<><Button onClick={loadDistrict} disabled={!d} icon={<RotateCcw className="w-3 h-3" />}>Load selected district</Button></>}
      />
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="text-[11px] text-muted self-center mr-1">Presets:</span>
        {REGIME_KEYS.map((k) => (
          <button key={k} onClick={() => { setInput((s) => ({ ...s, ...PRESETS[k] })); setOverride('auto') }} className="text-[11px] font-medium rounded-md border px-2 py-1 hover:bg-slate-50" style={{ borderColor: REGIME_META[k].color + '66', color: REGIME_META[k].color }}>
            {REGIME_META[k].short}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 content-start">
          {SLIDERS.map((s) => (
            <label key={s.k} className="block text-xs">
              <div className="flex justify-between text-muted"><span>{s.label}</span><span className="num text-ink font-semibold">{Number(input[s.k]).toFixed(s.step < 1 ? (s.step < 0.1 ? 2 : 1) : 0)} {s.unit}</span></div>
              <input type="range" min={s.min} max={s.max} step={s.step} value={input[s.k]} onChange={(e) => set(s.k, Number(e.target.value))} className="w-full accent-[#0e7c9a]" aria-label={s.label} />
            </label>
          ))}
        </div>
        <div className="xl:col-span-7 space-y-4">
          {err && <ErrorState error={{ message: err }} compact />}
          {!res ? <SkeletonBlock rows={7} h="h-5" /> : (
            <div className={cx('space-y-4 transition-opacity', busy && 'opacity-70')}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg border border-line p-2.5"><div className="text-[10px] uppercase font-semibold text-muted">Detected regime</div><div className="mt-1"><RegimeBadge regime={res.classification.regime} short /></div><div className="text-[11px] text-muted num mt-1">{fmtPct(res.classification.confidence)} confidence</div></div>
                <div className="rounded-lg border border-line p-2.5"><div className="text-[10px] uppercase font-semibold text-muted">Raw NWP</div><div className="num text-lg font-semibold text-[#e07b39]">{fmtMm(res.nwp)}</div></div>
                <div className="rounded-lg border border-accent/40 bg-accent-soft p-2.5"><div className="text-[10px] uppercase font-semibold text-muted">Regime-aware AI</div><div className="num text-lg font-semibold text-accent">{fmtMm(res.corrected)}</div><div className="text-[11px] text-muted num">P10–P90 {res.p10.toFixed(0)}–{res.p90.toFixed(0)}</div></div>
                <div className="rounded-lg border border-line p-2.5"><div className="text-[10px] uppercase font-semibold text-muted">Alternatives</div><div className="text-[11px] num text-muted mt-1">Global QM <b className="text-ink">{res.global_qm.toFixed(0)}</b><br />Universal ML <b className="text-ink">{res.universal_ml.toFixed(0)}</b></div></div>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted">Model:</span><b className="text-ink">{res.model_used}</b>
                <Select value={override} onChange={setOverride} label="Force regime" options={[{ value: 'auto', label: 'Auto (classifier)' }, ...REGIME_KEYS.map((k) => ({ value: k, label: regimeLabel(k) }))]} className="ml-auto" />
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Same weather, six regime models (mm)</div>
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={bars} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="name" {...AXIS} tickLine={false} interval={0} />
                    <YAxis {...AXIS} tickLine={false} axisLine={false} width={46} />
                    <Tooltip content={<ChartTip unit=" mm" />} cursor={{ fill: '#eef3f8' }} />
                    <Bar dataKey="value" name="Corrected rainfall" radius={[4, 4, 0, 0]}>
                      {bars.map((b) => <Cell key={b.regime} fill={REGIME_META[b.regime].color} fillOpacity={b.regime === res.regime_used ? 1 : 0.35} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-muted">Solid bar = model actually used. Different regimes correct identical inputs differently — that is the regime-specific error signature the classifier routes to.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Exceedance probability</div>
                  <ProbBars items={Object.entries(res.probabilities).map(([t, p]) => ({ label: `P(rain ≥ ${t} mm)`, probability: p }))} color="#c62828" />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">What drove the correction</div>
                  <DriverBars drivers={res.explanation} unit="mm" max={6} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function Fingerprint() {
  const [regime, setRegime] = useState<RegimeKey>('active_monsoon')
  const s = useRegimeWise('validation', 25)
  return (
    <Card>
      <CardHeader title="Regime error fingerprint" subtitle="Why one universal correction cannot work: each regime's NWP is biased in its own way (held-out validation data)"
        right={<Select value={regime} onChange={setRegime} options={REGIME_KEYS.map((k) => ({ value: k, label: regimeLabel(k) }))} />} />
      <Async state={s} skeleton={<Skeleton className="h-60" />}>
        {(d) => {
          const rows = d.bias_fingerprint.filter((r) => r.regime === regime)
          const cov = d.regimes.find((r) => r.regime === regime)
          return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={rows} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="bin" {...AXIS} tickLine={false} label={{ value: 'raw NWP intensity bin (mm)', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#8b98a9' }} height={40} />
                    <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<ChartTip unit=" mm" />} cursor={{ fill: '#eef3f8' }} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                    <Bar dataKey="mean_nwp" name="Mean NWP" fill={SOURCE_COLORS.nwp} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="mean_obs" name="Mean observed" fill={SOURCE_COLORS.observed} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="mean_ai" name="Mean AI corrected" fill={SOURCE_COLORS.regime_aware} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 text-xs">
                {rows.map((r) => (
                  <div key={r.bin} className="flex justify-between border-b border-line/70 pb-1"><span className="text-muted">NWP {r.bin} mm <span className="text-faint">(n={r.n})</span></span>
                    <span className="num">bias <b className={r.bias_nwp > 0 ? 'text-[#c2410c]' : 'text-[#1d4ed8]'}>{fmtSigned(r.bias_nwp, 1)}</b> → <b className="text-accent">{fmtSigned(r.bias_ai, 1)}</b></span></div>
                ))}
                {cov && !cov.insufficient && <Callout tone="info">In {REGIME_META[regime].short}, AI cuts RMSE from <b>{cov.rmse_nwp?.toFixed(1)}</b> to <b>{cov.rmse_ai?.toFixed(1)}</b> mm.</Callout>}
              </div>
            </div>
          )
        }}
      </Async>
    </Card>
  )
}

export default function PostProcessing() {
  const fc = useForecast()
  const { selectedId, select } = useApp()
  const named = useMemo(() => (fc.data?.items ?? []).filter((p) => p.is_district).sort((a, b) => a.district.localeCompare(b.district)), [fc.data])
  const topRisk = useMemo(() => [...(fc.data?.items ?? [])].sort((a, b) => b.risk_score - a.risk_score)[0]?.id ?? null, [fc.data])
  const id = selectedId ?? topRisk
  const detail = useDistrict(id)

  const cmp = detail.data && [
    { name: 'Raw NWP', v: detail.data.current.nwp, c: SOURCE_COLORS.nwp },
    { name: 'Global correction', v: detail.data.current.global_qm, c: SOURCE_COLORS.global_qm },
    { name: 'Universal ML', v: detail.data.current.universal, c: SOURCE_COLORS.universal },
    { name: 'Regime-aware AI', v: detail.data.current.corrected, c: SOURCE_COLORS.regime_aware },
    ...(detail.data.current.observed !== null ? [{ name: 'Observed', v: detail.data.current.observed, c: SOURCE_COLORS.observed }] : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Post-Processing"
        subtitle="How a raw NWP forecast becomes a regime-aware corrected forecast — for the selected location, live."
        actions={
          <Select value={id ?? ''} onChange={select} label="Location" options={[...(id && !named.some((n) => n.id === id) ? [{ value: id, label: shortName(fc.data?.items.find((p) => p.id === id)?.district ?? id) }] : []), ...named.map((p) => ({ value: p.id, label: `${p.district}, ${p.state}` }))]} />
        }
      />
      <Card>
        <CardHeader title={detail.data ? `${shortName(detail.data.location.district)} · ${detail.data.location.state}` : 'Pipeline'} subtitle="NWP → regime detection → regime-specific model → corrected forecast → probability" />
        <Async state={detail} skeleton={<Skeleton className="h-28" />}>{(d) => <Flow d={d} />}</Async>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Same location, four forecasts" subtitle="Raw NWP vs a single global bias correction vs regime-blind ML vs regime-aware AI (mm)" />
          <Async state={detail} skeleton={<Skeleton className="h-48" />}>
            {() => (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={cmp ?? []} layout="vertical" margin={{ top: 4, right: 30, left: 30, bottom: 0 }}>
                  <CartesianGrid {...GRID} horizontal={false} />
                  <XAxis type="number" {...AXIS} tickLine={false} unit=" mm" />
                  <YAxis type="category" dataKey="name" {...AXIS} tickLine={false} width={110} />
                  <Tooltip content={<ChartTip unit=" mm" />} cursor={{ fill: '#eef3f8' }} />
                  <Bar dataKey="v" name="Rainfall" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#0f1c2e', formatter: (v: number) => v.toFixed(0) }}>
                    {(cmp ?? []).map((r) => <Cell key={r.name} fill={r.c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Async>
        </Card>
        <Card>
          <CardHeader title="Prediction drivers" subtitle="Which inputs moved this regime model's output (occlusion vs the regime's typical value)" />
          <Async state={detail} skeleton={<SkeletonBlock rows={7} h="h-5" />}>
            {(d) => (
              <>
                <DriverBars drivers={d.explanation.correction} unit="mm" max={8} />
                <div className="mt-3 flex items-center gap-1 text-xs text-muted"><ArrowRight className="w-3 h-3" /> Bars right push the corrected rainfall up; bars left push it down.</div>
              </>
            )}
          </Async>
        </Card>
      </div>

      <Lab d={detail.data} />
      <Fingerprint />
    </div>
  )
}
