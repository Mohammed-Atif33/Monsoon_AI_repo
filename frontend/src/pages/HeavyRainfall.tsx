import { Check, ClipboardCopy, Printer, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTip, GRID } from '../components/charts'
import { Legend as MapLegend } from '../components/MapView'
import { RainMiniMap } from '../components/RainMiniMap'
import { AlertBadge, Async, Button, Card, CardHeader, Kpi, PageHeader, RegimeBadge, Skeleton, SkeletonBlock } from '../components/ui'
import { useForecast, withQ } from '../hooks/data'
import { useApi } from '../hooks/useApi'
import { useApp } from '../hooks/useApp'
import type { Bulletin, HeavyRainfall } from '../types/api'
import { ALERT_META, classify, PROB_CLASSES } from '../utils/colors'
import { fmtNum, fmtPct, shortName } from '../utils/format'
import { useNavigate } from 'react-router-dom'

const LEVELS = ['Severe', 'Warning', 'Watch', 'Normal'] as const

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="block text-xs">
      <div className="flex justify-between text-muted"><span>{label}</span><b className="num text-ink">{Math.round(value * 100)}%</b></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#0e7c9a]" aria-label={label} />
    </label>
  )
}

function BulletinCard({ extra }: { extra: Record<string, number> }) {
  const { q } = useApp()
  const s = useApi<Bulletin>(`/bulletin${withQ(q, extra)}`)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!s.data) return
    try { await navigator.clipboard.writeText(s.data.text); setCopied(true); window.setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ }
  }
  return (
    <Card>
      <CardHeader title="Advisory bulletin (auto-generated)" subtitle="Plain-language decision-support text assembled from the actual model outputs — no templates with fixed numbers"
        right={<><Button onClick={copy} disabled={!s.data} icon={copied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}>{copied ? 'Copied' : 'Copy'}</Button><Button onClick={() => window.print()} icon={<Printer className="w-3.5 h-3.5" />}>Print</Button></>} />
      <Async state={s} skeleton={<SkeletonBlock rows={8} />}>
        {(b) => (
          <article className="rounded-lg border border-line bg-slate-50/60 p-4 space-y-3 max-w-4xl">
            <div className="border-b border-line pb-2"><div className="text-sm font-semibold text-navy-900">{b.title} · {b.meta.disclaimer}</div><div className="text-[11px] text-muted">Issued {b.issued}</div></div>
            {b.sections.map((sec) => (
              <section key={sec.heading}><h4 className="text-[11px] font-semibold uppercase tracking-wide text-accent">{sec.heading}</h4><p className="text-[13px] text-ink whitespace-pre-line leading-relaxed">{sec.text}</p></section>
            ))}
          </article>
        )}
      </Async>
    </Card>
  )
}

export default function HeavyRainfall() {
  const { q, heavy, veryHeavy, select } = useApp()
  const nav = useNavigate()
  const fc = useForecast()
  const [watch, setWatch] = useState(0.4)
  const [warning, setWarning] = useState(0.25)
  const [severe, setSevere] = useState(0.5)
  const [minConf, setMinConf] = useState(0.45)
  const extra = { watch_p: watch, warning_p: warning, severe_p: severe, min_conf: minConf }
  const s = useApi<HeavyRainfall>(`/heavy-rainfall${withQ(q, extra)}`)
  const d = s.data

  const ranking = useMemo(() => (d?.ranking ?? []).slice(0, 12).map((p) => ({ name: shortName(p.district).replace(/ grid \(.*\)/, ' grid'), heavy: Math.round(p.p_heavy * 100), very: Math.round(p.p_very * 100) })), [d])
  const rel = useMemo(() => {
    const merge = new Map<number, { x: number; heavy?: number; very?: number }>()
    for (const [key, arr] of [['heavy', d?.reliability.heavy ?? []], ['very', d?.reliability.very ?? []]] as const)
      for (const r of arr) { const x = Math.round(r.mean_pred * 100); const e = merge.get(x) ?? { x }; e[key] = Math.round(r.observed_freq * 100); merge.set(x, e) }
    return [...merge.values()].sort((a, b) => a.x - b.x)
  }, [d])
  const pts = fc.data?.items ?? []
  const goto = (id: string) => { select(id); nav('/post-processing') }

  return (
    <div className="space-y-4">
      <PageHeader title="Heavy Rainfall Intelligence" subtitle={`Model probabilities of exceeding ${heavy} mm (heavy) and ${veryHeavy} mm (very heavy) in 24 h, converted to Watch / Warning / Severe alerts by transparent, configurable rules.`} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {d ? (<>
          {LEVELS.map((l) => <Kpi key={l} label={`${l} alerts`} value={d.summary.counts[l]} sub={l === 'Normal' ? 'no threshold exceeded' : 'locations'} color={ALERT_META[l].color} icon={l === 'Severe' ? <ShieldAlert className="w-4 h-4" /> : undefined} />)}
          <Kpi label="Mean P(≥ heavy)" value={fmtPct(d.summary.mean_p_heavy, 1)} sub={`${d.summary.n_p_heavy_over_50} locations ≥ 50%`} color="#184670" />
        </>) : Array.from({ length: 5 }, (_, i) => <Card key={i}><Skeleton className="h-16" /></Card>)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-7">
          <CardHeader title="Exceedance probability maps" subtitle="Probability that 24-h rainfall reaches each threshold" right={<MapLegend spec={{ title: 'Probability', classes: PROB_CLASSES }} horizontal className="!py-1" />} />
          <Async state={fc} skeleton={<Skeleton className="h-64" />}>
            {() => (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RainMiniMap title={`P(rain ≥ ${heavy} mm)`} points={pts} colorOf={(p) => classify(p.p_heavy, PROB_CLASSES)} valueLabel={(p) => `P heavy ${fmtPct(p.p_heavy)}`} onSelect={goto} />
                <RainMiniMap title={`P(rain ≥ ${veryHeavy} mm)`} points={pts} colorOf={(p) => classify(p.p_very, PROB_CLASSES)} valueLabel={(p) => `P very heavy ${fmtPct(p.p_very)}`} onSelect={goto} />
              </div>
            )}
          </Async>
        </Card>
        <Card className="xl:col-span-5">
          <CardHeader title="Highest-risk locations" subtitle="P(heavy) and P(very heavy), %" />
          <Async state={s} skeleton={<Skeleton className="h-64" />}>
            {() => (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={ranking} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid {...GRID} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} {...AXIS} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="name" {...AXIS} tickLine={false} width={116} interval={0} />
                  <Tooltip content={<ChartTip unit="%" digits={0} />} cursor={{ fill: '#eef3f8' }} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                  <Bar dataKey="heavy" name={`P ≥ ${heavy} mm`} fill="#f59e0b" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="very" name={`P ≥ ${veryHeavy} mm`} fill="#c62828" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Async>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-8">
          <CardHeader title="Active alerts" subtitle="Generated from AI-corrected rainfall, exceedance probabilities and regime confidence" />
          <Async state={s} skeleton={<SkeletonBlock rows={6} h="h-14" />}>
            {(x) => x.alerts.length === 0 ? <p className="text-sm text-muted py-6 text-center">No location reaches Watch level with the current thresholds.</p> : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {x.alerts.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => goto(a.id)} className="w-full text-left rounded-xl border p-3 hover:shadow-sm transition-shadow" style={{ borderColor: ALERT_META[a.level].color + '55', background: ALERT_META[a.level].soft + '80' }}>
                      <div className="flex items-center justify-between gap-2"><span className="text-[10.5px] font-bold tracking-wider" style={{ color: ALERT_META[a.level].text }}>{a.headline}</span><AlertBadge level={a.level} low={a.low_confidence} /></div>
                      <div className="mt-1 text-[15px] font-semibold text-ink">{shortName(a.district)}<span className="text-xs font-normal text-muted"> · {a.state}</span></div>
                      <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs num">
                        <div><div className="text-[10px] uppercase text-muted">P ≥ {veryHeavy}</div><b className="text-base">{fmtPct(a.p_very)}</b></div>
                        <div><div className="text-[10px] uppercase text-muted">AI rain</div><b className="text-base">{fmtNum(a.corrected, 0)} mm</b></div>
                        <div><div className="text-[10px] uppercase text-muted">NWP</div><b className="text-base text-muted">{fmtNum(a.nwp, 0)} mm</b></div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2"><RegimeBadge regime={a.regime} short /><span className="text-[11px] text-muted num">{fmtPct(a.confidence)} conf.</span></div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Card>
        <div className="xl:col-span-4 space-y-4">
          <Card>
            <CardHeader title="Alert thresholds" icon={<SlidersHorizontal className="w-4 h-4 text-accent" />} subtitle={`Heavy / very-heavy rainfall thresholds are set in the top bar (${heavy} / ${veryHeavy} mm).`} />
            <div className="space-y-2.5">
              <Slider label={`Watch: P(≥ ${heavy} mm) at least`} value={watch} onChange={setWatch} />
              <Slider label={`Warning: P(≥ ${veryHeavy} mm) at least`} value={warning} onChange={setWarning} />
              <Slider label={`Severe: P(≥ ${veryHeavy} mm) at least`} value={severe} onChange={setSevere} />
              <Slider label="Downgrade if regime confidence below" value={minConf} onChange={setMinConf} />
            </div>
            <ul className="mt-3 space-y-1 text-[11px] text-muted list-disc pl-4">{d?.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Probability model skill" subtitle="Held-out validation, all scenarios" />
            {d ? (
              <table className="w-full text-xs num">
                <thead><tr className="text-muted"><th className="text-left font-medium pb-1">Threshold</th><th className="text-right font-medium">ROC-AUC</th><th className="text-right font-medium">Brier</th><th className="text-right font-medium">Base rate</th></tr></thead>
                <tbody>
                  {([['heavy', heavy], ['very', veryHeavy]] as const).map(([k, t]) => (
                    <tr key={k} className="border-t border-line/70"><td className="py-1">≥ {t} mm</td><td className="text-right font-semibold">{fmtNum(d.model_skill[k].roc_auc, 3)}</td><td className="text-right">{fmtNum(d.model_skill[k].brier, 3)}</td><td className="text-right">{fmtPct(d.model_skill[k].prevalence, 1)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <Skeleton className="h-16" />}
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Reliability diagram" subtitle="When the model says X%, how often did heavy rain actually occur? (held-out validation) — closer to the diagonal is better" />
          <Async state={s} skeleton={<Skeleton className="h-60" />}>
            {() => (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={rel} margin={{ top: 6, right: 12, left: -4, bottom: 14 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="x" domain={[0, 100]} {...AXIS} tickLine={false} unit="%" label={{ value: 'forecast probability', position: 'insideBottom', offset: -8, fontSize: 10, fill: '#8b98a9' }} />
                  <YAxis domain={[0, 100]} {...AXIS} tickLine={false} axisLine={false} unit="%" width={46} />
                  <Tooltip content={<ChartTip unit="%" digits={0} />} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#8b98a9" strokeDasharray="4 4" />
                  <Line dataKey="heavy" name={`≥ ${heavy} mm`} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line dataKey="very" name={`≥ ${veryHeavy} mm`} stroke="#c62828" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Async>
        </Card>
        <Card>
          <CardHeader title="Probability distribution" subtitle="Number of locations per probability bin" />
          <Async state={s} skeleton={<Skeleton className="h-60" />}>
            {(x) => (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={x.histogram} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="bin" {...AXIS} tickLine={false} interval={0} fontSize={9} />
                  <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<ChartTip digits={0} />} cursor={{ fill: '#eef3f8' }} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                  <Bar dataKey="heavy" name={`P ≥ ${heavy} mm`} fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="very" name={`P ≥ ${veryHeavy} mm`} fill="#c62828" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Async>
        </Card>
      </div>

      <BulletinCard extra={extra} />
    </div>
  )
}
