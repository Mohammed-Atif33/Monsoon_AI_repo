import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTip, GRID } from '../components/charts'
import { DriverBars, ProbBars } from '../components/DriverBars'
import { MapView } from '../components/MapView'
import { Async, Badge, Callout, Card, CardHeader, Meter, PageHeader, RegimeBadge, Skeleton, SkeletonBlock } from '../components/ui'
import { useRegimeDetail, useRegimes } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import { REGIME_KEYS, REGIME_META, regimeColor, regimeLabel } from '../utils/colors'
import { fmtNum, fmtPct, leadLabel, shortName } from '../utils/format'

const LEGEND = { title: 'Weather regime', categorical: true, classes: REGIME_KEYS.map((k) => ({ min: 0, max: 0, color: REGIME_META[k].color, label: REGIME_META[k].label })) }

function Why({ id }: { id: string }) {
  const s = useRegimeDetail(id)
  return (
    <Async state={s} skeleton={<SkeletonBlock rows={8} h="h-5" />} compact>
      {(d) => (
        <div className="space-y-4 mai-in">
          <div>
            <div className="text-[15px] font-semibold text-ink">{shortName(d.location.district)}</div>
            <div className="text-xs text-muted">{d.location.state} · {d.location.lat.toFixed(2)}°N {d.location.lon.toFixed(2)}°E</div>
            <div className="mt-2 flex items-center gap-2"><RegimeBadge regime={d.regime} /><span className="num text-sm font-semibold">{fmtPct(d.confidence)}</span></div>
            <p className="text-xs text-muted mt-1.5">{d.description}</p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Regime probabilities</div>
            <ProbBars items={d.probabilities.map((p) => ({ label: p.label, probability: p.probability, color: regimeColor(p.regime) }))} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Why was this regime detected?</div>
            <DriverBars drivers={d.explanation} unit="pp" max={8} positiveColor={regimeColor(d.regime)} />
            <p className="text-[10px] text-faint mt-1.5">{d.method}</p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Observed vs typical for this regime</div>
            <table className="w-full text-xs">
              <tbody>
                {d.signature.map((r) => (
                  <tr key={r.feature} className="border-b border-line/70 last:border-0">
                    <td className="py-1 text-muted">{r.feature}</td>
                    <td className="py-1 text-right num font-semibold text-ink">{fmtNum(r.value, 1)} {r.unit}</td>
                    <td className="py-1 text-right num text-faint">typ. {fmtNum(r.typical, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Regime along the forecast horizon</div>
            <div className="grid grid-cols-6 gap-1">
              {d.sequence.map((q) => (
                <div key={q.lead} className="text-center" title={`${regimeLabel(q.regime)} · ${fmtPct(q.confidence)}`}>
                  <div className="h-2 rounded-full" style={{ background: regimeColor(q.regime) }} />
                  <div className="text-[10px] text-muted mt-0.5">{leadLabel(q.lead)}</div>
                  <div className="text-[9.5px] text-faint num">{fmtPct(q.confidence)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Async>
  )
}

export default function Regimes() {
  const s = useRegimes()
  const { selectedId, select } = useApp()
  const pts = s.data?.points ?? []
  const byId = useMemo(() => new Map(pts.map((p) => [p.id, p])), [pts])

  return (
    <div className="space-y-4">
      <PageHeader title="Weather Regimes" subtitle="Every location is classified into one of six regimes by a Random Forest; the regime decides which correction model is applied." />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <Card pad={false}>
            <div className="p-3">
              <Async state={s} skeleton={<Skeleton className="h-[500px]" />}>
                {(d) => (
                  <MapView
                    points={d.points} height={500} legend={LEGEND} selectedId={selectedId} onSelect={select}
                    colorOf={(p) => regimeColor(p.regime)} valueLabel={(p) => `${REGIME_META[p.regime].label} · ${fmtPct(p.confidence)}`}
                  />
                )}
              </Async>
            </div>
          </Card>
          <Async state={s} skeleton={<Skeleton className="h-48" />}>
            {(d) => (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {d.models.map((m) => (
                  <Card key={m.regime} className="!p-3">
                    <div className="flex items-center justify-between mb-1"><RegimeBadge regime={m.regime} /><span className="num text-xs text-muted">{fmtPct(m.share)} · {m.count} pts</span></div>
                    <p className="text-[11px] text-muted leading-snug min-h-[46px]">{m.description}</p>
                    <div className="mt-1.5 rounded-md bg-slate-50 border border-line px-2 py-1 text-[11px] text-ink font-medium">→ {m.model}</div>
                    {m.count > 0 ? (
                      <dl className="mt-2 grid grid-cols-3 gap-1 text-[10.5px] num">
                        <div><dt className="text-faint">Humidity</dt><dd className="font-semibold text-ink">{fmtNum(m.signature.humidity, 0)}%</dd></div>
                        <div><dt className="text-faint">Wind</dt><dd className="font-semibold text-ink">{fmtNum(m.signature.wind_speed, 1)} m/s</dd></div>
                        <div><dt className="text-faint">Pressure</dt><dd className="font-semibold text-ink">{fmtNum(m.signature.pressure, 0)} hPa</dd></div>
                      </dl>
                    ) : <p className="mt-2 text-[11px] text-faint">Not present in this forecast.</p>}
                    {m.mean_confidence !== null && <div className="mt-2"><Meter value={m.mean_confidence} color={regimeColor(m.regime)} height={4} /></div>}
                  </Card>
                ))}
              </div>
            )}
          </Async>
          <Card>
            <CardHeader title="Regime evolution" subtitle="Share of locations per regime at each lead time" />
            <Async state={s} skeleton={<Skeleton className="h-52" />}>
              {(d) => (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={d.mix_by_lead} stackOffset="expand" margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="label" {...AXIS} tickLine={false} />
                    <YAxis {...AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} />
                    <Tooltip content={<ChartTip digits={2} />} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                    {REGIME_KEYS.map((k) => <Area key={k} type="monotone" dataKey={k} name={REGIME_META[k].short} stackId="1" stroke={REGIME_META[k].color} fill={REGIME_META[k].color} fillOpacity={0.8} />)}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Async>
            {s.data && <p className="text-[11px] text-muted mt-1">Locations changing regime between consecutive leads: {s.data.stability.map((x) => `${leadLabel(x.from)}→${leadLabel(x.to)} ${fmtPct(x.changed_share)}`).join(' · ')}</p>}
          </Card>
        </div>
        <Card className="xl:col-span-4 self-start xl:sticky xl:top-0">
          <CardHeader title="Regime explanation" right={s.data && <Badge color={regimeColor(s.data.dominant.regime)}>Dominant: {REGIME_META[s.data.dominant.regime].short}</Badge>} />
          {selectedId && byId.has(selectedId) ? <Why id={selectedId} /> : <Callout>Select a location on the map to see why the classifier chose its regime, the alternatives, and how it compares with the typical signature.</Callout>}
        </Card>
      </div>
    </div>
  )
}
