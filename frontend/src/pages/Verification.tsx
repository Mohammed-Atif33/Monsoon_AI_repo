import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { AXIS, ChartTip, GRID } from '../components/charts'
import { Legend as MapLegend } from '../components/MapView'
import { RainMiniMap } from '../components/RainMiniMap'
import { Async, Callout, Card, CardHeader, PageHeader, Segmented, Select, Skeleton, SkeletonBlock, Td, Th, cx } from '../components/ui'
import { useForecast, useRegimeWise, useVerification } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import type { Scores, SourceKey } from '../types/api'
import { classify, ERROR_CLASSES, RAIN_CLASSES, REGIME_KEYS, regimeColor, SOURCE_COLORS, SOURCE_NAMES } from '../utils/colors'
import { fmtNum, fmtSigned } from '../utils/format'

const SRC: SourceKey[] = ['nwp', 'global_qm', 'universal', 'regime_aware']
type MetricKey = 'rmse' | 'mae' | 'bias' | 'r2' | 'csi' | 'pod' | 'far' | 'fss' | 'ets'
const METRICS: { k: MetricKey; label: string; better: 'low' | 'high' | 'zero'; digits: number; hint: string }[] = [
  { k: 'rmse', label: 'RMSE (mm)', better: 'low', digits: 2, hint: 'Root-mean-square error' },
  { k: 'mae', label: 'MAE (mm)', better: 'low', digits: 2, hint: 'Mean absolute error' },
  { k: 'bias', label: 'Bias (mm)', better: 'zero', digits: 2, hint: 'Mean forecast − observed' },
  { k: 'r2', label: 'R²', better: 'high', digits: 3, hint: 'Coefficient of determination' },
  { k: 'csi', label: 'CSI', better: 'high', digits: 3, hint: 'Critical success index (threat score)' },
  { k: 'pod', label: 'POD', better: 'high', digits: 3, hint: 'Probability of detection' },
  { k: 'far', label: 'FAR', better: 'low', digits: 3, hint: 'False alarm ratio' },
  { k: 'fss', label: 'FSS', better: 'high', digits: 3, hint: 'Fractions skill score (150 km neighbourhood)' },
  { k: 'ets', label: 'ETS', better: 'high', digits: 3, hint: 'Equitable threat score' },
]

function bestOf(vals: (number | null)[], better: 'low' | 'high' | 'zero'): number {
  let bi = -1, bv = Infinity
  vals.forEach((v, i) => { if (v === null) return; const s = better === 'low' ? v : better === 'high' ? -v : Math.abs(v); if (s < bv) { bv = s; bi = i } })
  return bi
}

function Delta({ base, cur, better }: { base: number | null; cur: number | null; better: 'low' | 'high' | 'zero' }) {
  if (base === null || cur === null) return <Minus className="w-3 h-3 text-faint" />
  const diff = better === 'zero' ? Math.abs(cur) - Math.abs(base) : cur - base
  const good = better === 'high' ? diff > 0 : diff < 0
  if (Math.abs(diff) < 1e-9) return <Minus className="w-3 h-3 text-faint" />
  const Icon = diff > 0 ? ArrowUp : ArrowDown
  return <Icon className={cx('w-3.5 h-3.5', good ? 'text-emerald-600' : 'text-red-600')} aria-label={good ? 'improved' : 'worse'} />
}

function Controls({ scope, setScope, thr, setThr, allLeads, setAllLeads, live }: { live?: boolean; scope: 'scenario' | 'validation'; setScope: (s: 'scenario' | 'validation') => void; thr: number; setThr: (n: number) => void; allLeads: boolean; setAllLeads: (b: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {!live && <Segmented label="Verification scope" value={scope} onChange={setScope} options={[{ value: 'scenario', label: 'Current forecast', title: 'This run only (small sample, changes with every scenario / seed)' }, { value: 'validation', label: 'Held-out validation', title: '68k simulated points, 6 scenarios × 3 unseen runs × 6 lead times' }]} />}
      <Select label="Rain threshold ≥" value={thr} onChange={setThr} options={[10, 25, 50, 100].map((t) => ({ value: t, label: `${t} mm` }))} />
      {scope === 'scenario' && <label className="inline-flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={allLeads} onChange={(e) => setAllLeads(e.target.checked)} /> All lead times</label>}
    </div>
  )
}

function Overview({ scope, thr, allLeads }: { scope: 'scenario' | 'validation'; thr: number; allLeads: boolean }) {
  const v = useVerification(scope, thr, scope === 'validation' ? true : allLeads)
  return (
    <Async state={v} skeleton={<Skeleton className="h-96" />}>
      {(d) => {
        const s = d.sources
        const imp = d.improvement.vs_nwp
        const head = [
          { l: 'RMSE', t: `${fmtNum(imp.rmse_pct, 1)}% lower`, good: (imp.rmse_pct ?? 0) > 0, up: false },
          { l: 'CSI', t: `${fmtSigned(imp.csi_delta, 3)}`, good: (imp.csi_delta ?? 0) > 0, up: true },
          { l: 'POD', t: `${fmtSigned(imp.pod_delta, 3)}`, good: (imp.pod_delta ?? 0) > 0, up: true },
          { l: 'FAR', t: `${fmtSigned(imp.far_delta, 3)}`, good: (imp.far_delta ?? 0) < 0, up: false },
          { l: 'FSS', t: `${fmtSigned(imp.fss_delta, 3)}`, good: (imp.fss_delta ?? 0) > 0, up: true },
        ]
        return (
          <div className="space-y-4">
            <Callout tone="warn">{d.validation_statement} {d.note} Sample: <b>{d.n.toLocaleString()}</b> points, event = rainfall ≥ {d.threshold} mm.</Callout>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {head.map((h) => (
                <div key={h.l} className="bg-panel border border-line rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wide font-medium text-muted">{h.l} {h.up ? '↑' : '↓'} <span className="normal-case text-faint">AI vs NWP</span></div>
                  <div className={cx('text-xl font-semibold num', h.good ? 'text-emerald-700' : 'text-red-700')}>{h.t}</div>
                </div>
              ))}
            </div>
            <Card pad={false}>
              <div className="p-4 pb-2"><CardHeader title="Skill scores" subtitle="Green ▲▼ = better than raw NWP. Bold = best in row." /></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead><tr><Th>Metric</Th>{SRC.map((k) => <Th key={k} right><span style={{ color: SOURCE_COLORS[k] }}>●</span> {SOURCE_NAMES[k]}</Th>)}</tr></thead>
                  <tbody>
                    {METRICS.map((m) => {
                      const vals = SRC.map((k) => s[k][m.k as keyof Scores] as number | null)
                      const best = bestOf(vals, m.better)
                      return (
                        <tr key={m.k}>
                          <Td><span title={m.hint} className="font-medium text-ink">{m.label}</span></Td>
                          {SRC.map((k, i) => (
                            <Td key={k} right className={i === best ? 'font-bold text-ink bg-accent-soft/50' : ''}>
                              <span className="inline-flex items-center gap-1.5 justify-end">{k !== 'nwp' && <Delta base={vals[0]} cur={vals[i]} better={m.better} />}{vals[i] === null ? 'n/a' : fmtNum(vals[i], m.digits)}</span>
                            </Td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-[11px] text-muted">n/a = undefined (no events at this threshold). Regime-blind “Universal ML” is a strong baseline: on simulated data it performs about as well as the regime-specific models overall, while the single global bias correction is clearly weaker.</p>
            </Card>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Skill by rainfall threshold" subtitle="CSI — higher is better" />
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.by_threshold.map((t) => ({ name: `≥ ${t.threshold} mm`, ...Object.fromEntries(SRC.map((k) => [k, t[k].csi ?? 0])) }))} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} /><XAxis dataKey="name" {...AXIS} tickLine={false} /><YAxis {...AXIS} tickLine={false} axisLine={false} width={40} domain={[0, 1]} />
                    <Tooltip content={<ChartTip digits={3} />} cursor={{ fill: '#eef3f8' }} /><Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                    {SRC.map((k) => <Bar key={k} dataKey={k} name={SOURCE_NAMES[k]} fill={SOURCE_COLORS[k]} radius={[3, 3, 0, 0]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <CardHeader title="RMSE by lead time" subtitle="Forecast error grows with lead time; the correction keeps its advantage" />
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.by_lead} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} /><XAxis dataKey="label" {...AXIS} tickLine={false} /><YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<ChartTip unit=" mm" />} cursor={{ fill: '#eef3f8' }} /><Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                    {SRC.map((k) => <Bar key={k} dataKey={`rmse_${k}`} name={SOURCE_NAMES[k]} fill={SOURCE_COLORS[k]} radius={[3, 3, 0, 0]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </div>
        )
      }}
    </Async>
  )
}

function Scatter2({ data, ykey, color, title }: { data: { obs: number; nwp: number; ai: number }[]; ykey: 'nwp' | 'ai'; color: string; title: string }) {
  const max = 250
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{title}</div>
      <ResponsiveContainer width="100%" height={230}>
        <ScatterChart margin={{ top: 6, right: 10, left: -4, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="obs" domain={[0, max]} {...AXIS} tickLine={false} name="Observed" unit=" mm" label={{ value: 'observed', position: 'insideBottom', offset: -8, fontSize: 10, fill: '#8b98a9' }} />
          <YAxis type="number" dataKey={ykey} domain={[0, max]} {...AXIS} tickLine={false} axisLine={false} name="Forecast" width={40} />
          <ZAxis range={[14, 14]} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="#8b98a9" strokeDasharray="4 4" />
          <Tooltip content={<ChartTip unit=" mm" />} />
          <Scatter data={data} fill={color} fillOpacity={0.5} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

function Comparison({ scope, thr, allLeads }: { scope: 'scenario' | 'validation'; thr: number; allLeads: boolean }) {
  const { isLive } = useApp()
  const v = useVerification(scope, thr, scope === 'validation' ? true : allLeads)
  const fc = useForecast()
  const pts = fc.data?.items ?? []
  const bands = useMemo(() => v.data?.lat_bands ?? [], [v.data])
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Observed vs Raw NWP vs AI corrected — spatial maps" subtitle="Current forecast, selected lead time · rainfall classes follow IMD categories; error maps show forecast − observed" right={<MapLegend spec={{ title: 'Rainfall (mm)', classes: RAIN_CLASSES.slice(1) }} horizontal className="!py-1" />} />
        <Async state={fc} skeleton={<Skeleton className="h-56" />}>
          {() => (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {!isLive && <RainMiniMap title="Observed" points={pts} colorOf={(p) => classify(p.observed, RAIN_CLASSES)} valueLabel={(p) => `Obs ${fmtNum(p.observed, 0)} mm`} />}
                <RainMiniMap title="Raw NWP" points={pts} colorOf={(p) => classify(p.nwp, RAIN_CLASSES)} valueLabel={(p) => `NWP ${fmtNum(p.nwp, 0)} mm`} />
                <RainMiniMap title="AI corrected" points={pts} colorOf={(p) => classify(p.corrected, RAIN_CLASSES)} valueLabel={(p) => `AI ${fmtNum(p.corrected, 0)} mm`} />
              </div>
              {!isLive && <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <RainMiniMap title="NWP error (forecast − observed)" points={pts} colorOf={(p) => classify(p.error_nwp, ERROR_CLASSES)} valueLabel={(p) => `NWP err ${fmtSigned(p.error_nwp, 0)} mm`} />
                <RainMiniMap title="AI error (forecast − observed)" points={pts} colorOf={(p) => classify(p.error_ai, ERROR_CLASSES)} valueLabel={(p) => `AI err ${fmtSigned(p.error_ai, 0)} mm`} />
                <div className="self-center"><MapLegend spec={{ title: 'Error (mm): blue = under-forecast, orange/red = over-forecast', classes: ERROR_CLASSES }} /></div>
              </div>}
            </div>
          )}
        </Async>
      </Card>

      <Async state={v} skeleton={<Skeleton className="h-64" />}>
        {(d) => (
          <>
            <Card>
              <CardHeader title="Rainfall along the latitude gradient" subtitle="Mean 24-h rainfall in 2.5° latitude bands — observed vs NWP vs AI" />
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={bands} margin={{ top: 6, right: 10, left: -4, bottom: 14 }}>
                  <CartesianGrid {...GRID} vertical={false} /><XAxis dataKey="lat" {...AXIS} tickLine={false} unit="°N" label={{ value: 'latitude band centre', position: 'insideBottom', offset: -8, fontSize: 10, fill: '#8b98a9' }} />
                  <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} /><Tooltip content={<ChartTip unit=" mm" />} /><Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                  <Area dataKey="observed" name="Observed" fill={SOURCE_COLORS.observed} stroke={SOURCE_COLORS.observed} fillOpacity={0.1} strokeWidth={2} />
                  <Line dataKey="nwp" name="Raw NWP" stroke={SOURCE_COLORS.nwp} strokeWidth={2} dot={{ r: 2.5 }} />
                  <Line dataKey="regime_aware" name="AI corrected" stroke={SOURCE_COLORS.regime_aware} strokeWidth={2.4} dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Error distribution" subtitle="Forecast − observed (mm); clipped at ±100 mm" />
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.error_hist.edges.map((e, i) => ({ e: e + 5, nwp: d.error_hist.nwp[i], ai: d.error_hist.regime_aware[i] }))} margin={{ top: 6, right: 6, left: -4, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} /><XAxis dataKey="e" {...AXIS} tickLine={false} interval={1} /><YAxis {...AXIS} tickLine={false} axisLine={false} width={44} />
                    <ReferenceLine x={5} stroke="#0f1c2e" /><Tooltip content={<ChartTip digits={0} labelFormat={(l) => `error ≈ ${l} mm`} />} cursor={{ fill: '#eef3f8' }} /><Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                    <Bar dataKey="nwp" name="Raw NWP" fill={SOURCE_COLORS.nwp} fillOpacity={0.85} /><Bar dataKey="ai" name="AI corrected" fill={SOURCE_COLORS.regime_aware} fillOpacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <CardHeader title="Forecast vs observed" subtitle="Sampled points; dashed line = perfect forecast" />
                <div className="grid grid-cols-2 gap-2">
                  <Scatter2 data={d.scatter} ykey="nwp" color={SOURCE_COLORS.nwp} title="Raw NWP" />
                  <Scatter2 data={d.scatter} ykey="ai" color={SOURCE_COLORS.regime_aware} title="AI corrected" />
                </div>
              </Card>
            </div>
          </>
        )}
      </Async>
    </div>
  )
}

function RegimeWise({ scope, thr }: { scope: 'scenario' | 'validation'; thr: number }) {
  const s = useRegimeWise(scope, thr)
  const [metric, setMetric] = useState<'rmse' | 'csi' | 'fss' | 'bias'>('rmse')
  return (
    <Async state={s} skeleton={<Skeleton className="h-96" />}>
      {(d) => {
        const rows = d.regimes.filter((r) => !r.insufficient && r.sources)
        const chart = rows.map((r) => ({ name: r.short, ...Object.fromEntries(SRC.map((k) => [k, (r.sources![k][metric] as number | null) ?? 0])) }))
        const skipped = d.regimes.filter((r) => r.insufficient)
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Callout tone="good"><b>{d.regimes_improved}</b> of {rows.length} regimes have lower RMSE with the regime-aware correction than raw NWP.</Callout>
              <Callout tone="warn"><b>{d.regimes_hurt_by_global_qm}</b> regime(s) get <i>worse</i> under a single global bias correction — the core motivation for regime-specific post-processing.</Callout>
              <Callout>{d.note}</Callout>
            </div>
            <Card>
              <CardHeader title="Regime vs forecast skill" subtitle="Raw NWP vs global correction vs universal ML vs regime-aware AI, computed separately for each detected regime"
                right={<Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'rmse', label: 'RMSE ↓' }, { value: 'bias', label: 'Bias' }, { value: 'csi', label: 'CSI ↑' }, { value: 'fss', label: 'FSS ↑' }]} />} />
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chart} margin={{ top: 6, right: 8, left: -4, bottom: 0 }}>
                  <CartesianGrid {...GRID} vertical={false} /><XAxis dataKey="name" {...AXIS} tickLine={false} interval={0} /><YAxis {...AXIS} tickLine={false} axisLine={false} width={46} />
                  <ReferenceLine y={0} stroke="#0f1c2e" /><Tooltip content={<ChartTip digits={metric === 'rmse' || metric === 'bias' ? 1 : 3} />} cursor={{ fill: '#eef3f8' }} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={24} />
                  {SRC.map((k) => <Bar key={k} dataKey={k} name={SOURCE_NAMES[k]} fill={SOURCE_COLORS[k]} radius={[3, 3, 0, 0]} />)}
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card pad={false}>
              <div className="p-4 pb-2"><CardHeader title="Regime-wise verification table" subtitle={`Event threshold ≥ ${d.threshold} mm · RMSE in mm`} /></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead><tr><Th>Regime</Th><Th right>n</Th><Th right>NWP RMSE</Th><Th right>Global RMSE</Th><Th right>Universal RMSE</Th><Th right>AI RMSE</Th><Th right>AI vs NWP</Th><Th right>CSI NWP→AI</Th><Th right>POD NWP→AI</Th><Th right>FAR NWP→AI</Th><Th right>FSS NWP→AI</Th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const s2 = r.sources!
                      const pair = (m: 'csi' | 'pod' | 'far' | 'fss') => `${s2.nwp[m] === null ? 'n/a' : fmtNum(s2.nwp[m], 2)} → ${s2.regime_aware[m] === null ? 'n/a' : fmtNum(s2.regime_aware[m], 2)}`
                      return (
                        <tr key={r.regime}>
                          <Td><span className="inline-flex items-center gap-2 font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ background: regimeColor(r.regime) }} />{r.label}</span></Td>
                          <Td right>{r.n.toLocaleString()}</Td><Td right>{fmtNum(s2.nwp.rmse, 1)}</Td>
                          <Td right className={(s2.global_qm.rmse ?? 0) > (s2.nwp.rmse ?? 0) ? 'text-red-700' : ''}>{fmtNum(s2.global_qm.rmse, 1)}</Td>
                          <Td right>{fmtNum(s2.universal.rmse, 1)}</Td><Td right className="font-bold text-accent">{fmtNum(s2.regime_aware.rmse, 1)}</Td>
                          <Td right className="text-emerald-700 font-semibold">{fmtNum(r.improvement?.vs_nwp.rmse_pct, 0)}% ↓</Td>
                          <Td right>{pair('csi')}</Td><Td right>{pair('pod')}</Td><Td right>{pair('far')}</Td><Td right>{pair('fss')}</Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {skipped.length > 0 && <p className="px-4 py-2 text-[11px] text-muted">Not enough samples in this sample to verify: {skipped.map((r) => `${r.label} (n=${r.n})`).join(', ')}. Use “Held-out validation” for all six regimes.</p>}
              <p className="px-4 pb-3 text-[11px] text-muted">Red = global correction increased error relative to raw NWP. Regimes are the classifier's detected regimes, i.e. the routing actually used.</p>
            </Card>
            <Card>
              <CardHeader title="Uncertainty calibration" subtitle="Share of observations falling inside the AI P10–P90 band (ideal ≈ 80%)" />
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                {d.interval_coverage.map((c) => (
                  <div key={c.regime} className="rounded-lg border border-line p-2.5"><div className="text-[11px] text-muted">{c.short}</div><div className="num text-lg font-semibold">{fmtNum((c.coverage ?? 0) * 100, 0)}%</div><div className="text-[10.5px] text-faint num">width {fmtNum(c.mean_width_mm, 0)} mm</div></div>
                ))}
              </div>
            </Card>
          </div>
        )
      }}
    </Async>
  )
}

export default function Verification() {
  const { scenario, isLive } = useApp()
  const [tab, setTab] = useState<'overview' | 'comparison' | 'regime'>('overview')
  const [scopeState, setScope] = useState<'scenario' | 'validation'>('validation')
  const scope = isLive ? 'validation' : scopeState
  const [thr, setThr] = useState(25)
  const [allLeads, setAllLeads] = useState(false)
  const tabs: { value: typeof tab; label: ReactNode }[] = [{ value: 'overview', label: 'Skill overview' }, { value: 'comparison', label: 'Comparison' }, { value: 'regime', label: 'Regime-wise' }]
  return (
    <div className="space-y-4">
      <PageHeader title="Forecast Verification" subtitle={`All scores are computed in Python from the data (no stored values). Prototype validation on simulated data — scenario: ${scenario.replace('_', ' ')}.`} actions={<Controls {...{ scope, setScope, thr, setThr, allLeads, setAllLeads }} live={isLive} />} />
      {isLive && <Callout tone="warn">Live mode has no observed-rainfall feed, so the live forecast cannot be verified. The scores below are from the held-out <b>simulated</b> validation set and describe the models, not today's live forecast.</Callout>}
      <Segmented label="Verification view" value={tab} onChange={setTab} options={tabs} />
      {tab === 'overview' && <Overview scope={scope} thr={thr} allLeads={allLeads} />}
      {tab === 'comparison' && <Comparison scope={scope} thr={thr} allLeads={allLeads} />}
      {tab === 'regime' && <RegimeWise scope={scope} thr={thr} />}
    </div>
  )
}
