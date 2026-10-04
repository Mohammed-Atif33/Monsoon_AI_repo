import { Activity, BadgeCheck, CloudLightning, Compass, MapPinned, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTip, GRID } from '../components/charts'
import { DistrictPanel } from '../components/DistrictPanel'
import { PipelineStrip } from '../components/PipelineStrip'
import { LayerPicker, RainfallMap } from '../components/RainfallMap'
import { AlertBadge, Async, Card, CardHeader, Kpi, Meter, PageHeader, RegimeBadge, SkeletonBlock, Skeleton } from '../components/ui'
import { useDashboard, useForecast } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import { ALERT_META, regimeColor, regimeShort, SOURCE_COLORS } from '../utils/colors'
import { fmtNum, fmtPct, shortName } from '../utils/format'
import type { LayerId } from '../utils/layers'
import type { Dashboard as Dash } from '../types/api'

function RegimeSummary({ d, onPick }: { d: Dash; onPick: (id: string) => void }) {
  const { heavy, veryHeavy } = useApp()
  const k = d.kpis
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1.5">Current regime</div>
        <div className="flex items-center gap-2"><RegimeBadge regime={k.current_regime} /><span className="text-xs text-muted num">{fmtPct(k.regime_area_share)} of locations</span></div>
        <div className="mt-2.5 flex items-baseline justify-between text-xs"><span className="text-muted">Confidence</span><span className="num text-lg font-semibold text-ink">{fmtPct(k.regime_confidence)}</span></div>
        <Meter value={k.regime_confidence ?? 0} color={regimeColor(k.current_regime)} height={7} />
        <div className="mt-2 text-[11px] text-muted">Correction model in use: <span className="font-semibold text-ink">{k.regime_model}</span></div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Heavy rain ≥ {heavy} mm</div>
          <div className="num text-xl font-semibold text-ink">{fmtPct(k.max_p_heavy)}</div>
          <div className="text-[11px] text-muted truncate" title={k.max_p_heavy_district}>peak · {shortName(k.max_p_heavy_district)}</div>
          <div className="text-[11px] text-faint num">{k.n_p_heavy_over_50} locations ≥ 50%</div>
        </div>
        <div className="rounded-lg border border-line p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Very heavy ≥ {veryHeavy} mm</div>
          <div className="num text-xl font-semibold text-ink">{fmtPct(k.max_p_very)}</div>
          <div className="text-[11px] text-muted truncate" title={k.max_p_very_district}>peak · {shortName(k.max_p_very_district)}</div>
          <div className="text-[11px] text-faint num">{k.n_p_very_over_50} locations ≥ 50%</div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">High-risk locations</div>
          <div className="text-[11px] text-muted num">{d.alert_counts.Severe} severe · {d.alert_counts.Warning} warning · {d.alert_counts.Watch} watch</div>
        </div>
        <ul className="divide-y divide-line/70">
          {d.top_risk.slice(0, 6).map((p) => (
            <li key={p.id}>
              <button onClick={() => onPick(p.id)} className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-slate-50 rounded-md px-1 -mx-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink truncate">{shortName(p.district)}</div>
                  <div className="text-[11px] text-muted num truncate">{regimeShort(p.regime)} · AI {fmtNum(p.corrected, 0)} mm · P(≥{veryHeavy}) {fmtPct(p.p_very)}</div>
                </div>
                <AlertBadge level={p.alert} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-faint flex items-center gap-1.5"><MapPinned className="w-3 h-3" /> Click any point on the map for its full forecast.</p>
    </div>
  )
}

export default function Dashboard() {
  const dash = useDashboard()
  const fc = useForecast()
  const { selectedId, select, isLive } = useApp()
  const [layer, setLayer] = useState<LayerId>('corrected')
  const d = dash.data

  const topBars = useMemo(
    () => (d?.top_risk ?? []).slice(0, 8).map((p) => ({ name: shortName(p.district).replace(/ grid \(.*\)/, ' grid'), nwp: p.nwp, ai: p.corrected, obs: p.observed })),
    [d],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rainfall Forecast Dashboard"
        subtitle={d ? `${d.meta.scenario_label} scenario · valid ${d.meta.lead_label} · every value below is computed by the regime classifier, six regime-specific correction models and the probability models.` : 'Loading forecast…'}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {d ? (
          <>
            <Kpi label="Current regime" value={<span style={{ color: regimeColor(d.kpis.current_regime) }}>{regimeShort(d.kpis.current_regime)}</span>} sub={`covers ${fmtPct(d.kpis.regime_area_share)} of locations`} icon={<Compass className="w-4 h-4" />} color={regimeColor(d.kpis.current_regime)} />
            <Kpi label="Regime confidence" value={fmtPct(d.kpis.regime_confidence)} sub="mean classifier probability" icon={<BadgeCheck className="w-4 h-4" />} color="#0e7c9a" />
            <Kpi label="Districts monitored" value={d.kpis.districts_monitored.toLocaleString()} sub={`${d.kpis.named_districts} named · ${d.kpis.districts_monitored - d.kpis.named_districts} grid cells`} icon={<MapPinned className="w-4 h-4" />} color="#184670" />
            <Kpi label="High-risk districts" value={d.kpis.high_risk_districts} sub={`+ ${d.kpis.watch_districts} on watch`} icon={<ShieldAlert className="w-4 h-4" />} color={ALERT_META[d.kpis.high_risk_districts > 0 ? 'Warning' : 'Normal'].color} />
            {isLive
              ? <Kpi label="Validation RMSE gain" value={`${fmtNum(d.kpis.validation_rmse_improvement_pct, 1)}%`} sub="held-out simulated data only" icon={<Activity className="w-4 h-4" />} color="#8b98a9" />
              : <Kpi label="RMSE improvement" value={`${fmtNum(d.kpis.rmse_improvement_pct, 1)}%`} sub={`NWP ${fmtNum(d.kpis.rmse_nwp, 1)} → AI ${fmtNum(d.kpis.rmse_ai, 1)} mm`} icon={<Activity className="w-4 h-4" />} color="#3a9a4c" />}
          </>
        ) : Array.from({ length: 5 }, (_, i) => <Card key={i}><Skeleton className="h-3 w-24 mb-2" /><Skeleton className="h-7 w-20 mb-1" /><Skeleton className="h-3 w-32" /></Card>)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-8" pad={false}>
          <div className="p-3 flex flex-wrap items-center justify-between gap-2 border-b border-line">
            <div>
              <h3 className="text-[13px] font-semibold text-ink">India rainfall map</h3>
              <p className="text-xs text-muted">Default layer: AI-corrected rainfall · hover for values, click a point to inspect</p>
            </div>
            <div className="overflow-x-auto max-w-full"><LayerPicker value={layer} onChange={setLayer} /></div>
          </div>
          <div className="p-3">
            <Async state={fc} skeleton={<Skeleton className="h-[520px] w-full" />}>
              {(f) => <RainfallMap points={f.items} layer={layer} selectedId={selectedId} onSelect={select} height={540} />}
            </Async>
          </div>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader
            title={selectedId ? 'Selected location' : 'Situation summary'}
            subtitle={selectedId ? undefined : 'Domain-wide regime, probability and risk'}
            right={selectedId ? <button onClick={() => select(null)} className="text-xs font-medium text-accent hover:underline">Back to summary</button> : undefined}
            icon={<CloudLightning className="w-4 h-4 text-accent" />}
          />
          {selectedId ? <DistrictPanel id={selectedId} compact className="border-0 -m-4 !bg-transparent" /> : (
            <Async state={dash} skeleton={<SkeletonBlock rows={9} h="h-5" />}>{(x) => <RegimeSummary d={x} onPick={select} />}</Async>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-5">
          <CardHeader title="Raw NWP vs AI corrected" subtitle="Highest-risk locations, 24-h rainfall (mm)" />
          <Async state={dash} skeleton={<Skeleton className="h-64" />}>
            {() => (
              <ResponsiveContainer width="100%" height={264}>
                <BarChart data={topBars} margin={{ top: 4, right: 4, left: -6, bottom: 34 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="name" {...AXIS} tickLine={false} interval={0} angle={-30} textAnchor="end" height={56} />
                  <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<ChartTip unit=" mm" />} cursor={{ fill: '#eef3f8' }} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                  <Bar dataKey="nwp" name="Raw NWP" fill={SOURCE_COLORS.nwp} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="ai" name="AI corrected" fill={SOURCE_COLORS.regime_aware} radius={[3, 3, 0, 0]} />
                  {!isLive && <Bar dataKey="obs" name="Observed" fill={SOURCE_COLORS.observed} radius={[3, 3, 0, 0]} />}
                </BarChart>
              </ResponsiveContainer>
            )}
          </Async>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader title="Forecast horizon" subtitle="Domain-mean rainfall and detected regime per lead time" />
          <Async state={dash} skeleton={<Skeleton className="h-64" />}>
            {(x) => (
              <>
                <ResponsiveContainer width="100%" height={210}>
                  <ComposedChart data={x.horizon} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="label" {...AXIS} tickLine={false} />
                    <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<ChartTip unit=" mm" />} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={22} />
                    <Line dataKey="nwp_mean" name="Raw NWP" stroke={SOURCE_COLORS.nwp} strokeWidth={2} dot={{ r: 3 }} />
                    <Line dataKey="corrected_mean" name="AI corrected" stroke={SOURCE_COLORS.regime_aware} strokeWidth={2.4} dot={{ r: 3 }} />
                    {!isLive && <Line dataKey="observed_mean" name="Observed" stroke={SOURCE_COLORS.observed} strokeDasharray="4 3" strokeWidth={1.6} dot={{ r: 2.5 }} />}
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="mt-2 grid grid-cols-6 gap-1">
                  {x.horizon.map((h) => (
                    <div key={h.lead} className="text-center" title={`${h.regime_label} · ${fmtPct(h.confidence)}`}>
                      <div className="h-1.5 rounded-full" style={{ background: regimeColor(h.regime) }} />
                      <div className="text-[9.5px] text-muted mt-0.5 leading-tight">{regimeShort(h.regime)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Async>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title="Regime mix" subtitle="Share of monitored locations" />
          <Async state={dash} skeleton={<SkeletonBlock rows={6} />}>
            {(x) => (
              <ul className="space-y-2">
                {[...x.regime_mix].sort((a, b) => b.share - a.share).map((r) => (
                  <li key={r.regime}>
                    <div className="flex items-baseline justify-between text-xs"><span className="text-ink">{r.short}</span><span className="num text-muted">{fmtPct(r.share)}</span></div>
                    <Meter value={r.share} color={regimeColor(r.regime)} height={5} />
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Card>
      </div>

      <Card>
        <CardHeader title="Pipeline executed for this forecast" subtitle="NWP → data quality → features → regime → regime-specific correction → probability (measured on this run)" />
        <Async state={dash} skeleton={<Skeleton className="h-16" />}>{(x) => <PipelineStrip steps={x.pipeline} />}</Async>
      </Card>
    </div>
  )
}
