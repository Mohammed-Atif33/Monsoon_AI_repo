import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react'
import { PipelineStrip } from '../components/PipelineStrip'
import { Async, Callout, Card, CardHeader, Kpi, Meter, PageHeader, Skeleton, Td, Th } from '../components/ui'
import { useDataQuality } from '../hooks/data'
import type { QCReport } from '../types/api'
import { fmtNum } from '../utils/format'

export function QualityScore({ q }: { q: QCReport }) {
  const color = q.quality_score >= 97 ? '#2f8f5b' : q.quality_score >= 92 ? '#5b9a3c' : q.quality_score >= 80 ? '#d4a017' : '#c62828'
  const c = q.score_components
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-5 items-center">
      <div className="grid place-items-center">
        <div className="relative w-36 h-36">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90"><circle cx="60" cy="60" r="52" stroke="#e8edf3" strokeWidth="10" fill="none" />
            <circle cx="60" cy="60" r="52" stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={`${(q.quality_score / 100) * 326.7} 326.7`} className="transition-all duration-700" /></svg>
          <div className="absolute inset-0 grid place-items-center text-center"><div><div className="num text-3xl font-semibold text-ink">{q.quality_score.toFixed(1)}</div><div className="text-[11px] text-muted">{q.grade}</div></div></div>
        </div>
      </div>
      <div className="space-y-2.5">
        {([['Row validity (no defect at ingest)', c.row_validity, '40%'], ['Completeness (non-missing cells)', c.completeness, '30%'], ['Value validity (in physical range)', c.validity, '20%'], ['Uniqueness (no duplicates)', c.uniqueness, '10%']] as const).map(([l, v, w]) => (
          <div key={l}><div className="flex justify-between text-xs"><span className="text-ink">{l} <span className="text-faint">· weight {w}</span></span><span className="num font-semibold">{v.toFixed(2)}%</span></div><Meter value={v / 100} color={color} height={5} /></div>
        ))}
        <p className="text-[11px] text-muted">Score = {q.score_formula}</p>
      </div>
    </div>
  )
}

const ICON = { pass: <CheckCircle2 className="w-4 h-4 text-emerald-600" />, warn: <CircleAlert className="w-4 h-4 text-amber-600" />, fail: <XCircle className="w-4 h-4 text-red-600" /> }

export function ChecksTable({ q }: { q: QCReport }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead><tr><Th className="w-8" /><Th>Check</Th><Th right>Affected</Th><Th right>Rate</Th><Th>Action taken</Th></tr></thead>
        <tbody>
          {q.checks.map((c) => (
            <tr key={c.id}>
              <Td>{ICON[c.status]}</Td>
              <Td><div className="font-medium text-ink">{c.name}</div><div className="text-[11px] text-muted">{c.description}</div></Td>
              <Td right className="font-semibold">{c.affected.toLocaleString()}</Td>
              <Td right>{c.rate_pct.toFixed(2)}%</Td>
              <Td className="text-xs text-muted">{c.action}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DataQuality() {
  const s = useDataQuality()
  return (
    <div className="space-y-4">
      <PageHeader title="Data Quality" subtitle="Every forecast feed is validated and repaired before it reaches the models. All figures below are computed from the records of the current run." />
      <Async state={s} skeleton={<Skeleton className="h-96" />}>
        {(d) => {
          const q = d.report
          const inj = q.injected_defects
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Kpi label="Records processed" value={q.records_processed.toLocaleString()} sub={`${q.records_retained.toLocaleString()} retained after QC`} color="#184670" />
                <Kpi label="Valid records" value={q.valid_records.toLocaleString()} sub={`${fmtNum((100 * q.valid_records) / q.records_processed, 1)}% defect-free at ingest`} color="#2f8f5b" />
                <Kpi label="Missing values" value={q.missing_values.toLocaleString()} sub={`${q.imputed_cells} cells imputed`} color="#d4a017" />
                <Kpi label="Outliers" value={q.outliers.toLocaleString()} sub={`${q.invalid_values} invalid · ${q.statistical_outliers} statistical`} color="#ea7317" />
                <Kpi label="Quality score" value={`${q.quality_score.toFixed(1)}`} sub={q.grade} color="#0e7c9a" />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <Card className="xl:col-span-7"><CardHeader title="Quality score" subtitle="Transparent formula — no hard-coded value" /><QualityScore q={q} /></Card>
                <Card className="xl:col-span-5">
                  <CardHeader title="Column completeness" />
                  <ul className="space-y-1.5">
                    {q.column_completeness.map((c) => (
                      <li key={c.column} className="grid grid-cols-[130px_1fr_58px] items-center gap-2 text-xs"><span className="text-muted truncate">{c.column}</span><Meter value={c.completeness_pct / 100} color="#0e7c9a" height={5} /><span className="num text-right">{c.completeness_pct.toFixed(1)}%</span></li>
                    ))}
                  </ul>
                </Card>
              </div>
              <Card pad={false}>
                <div className="p-4 pb-2"><CardHeader title="Validation checks" subtitle={`${q.duplicates} duplicates · ${q.invalid_coordinates} invalid coordinates (${q.coordinates_repaired ?? 0} repaired) · ${q.missing_timestamps} missing timestamps · ${q.units_converted} unit conversions`} /></div>
                <ChecksTable q={q} />
              </Card>
              {inj && (
                <Callout tone="info">
                  <b>Simulation transparency:</b> {q.injected_note} Injected: {Object.entries(inj).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ')}. The detection counts above come from running the checks on the data, not from this list.
                </Callout>
              )}
              <Card>
                <CardHeader title="Feature engineering" subtitle={d.feature_note} />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead><tr><Th>Model feature</Th><Th right>Mean</Th><Th right>Min</Th><Th right>Max</Th><Th right>Std</Th></tr></thead>
                    <tbody>{d.features.map((f) => <tr key={f.feature}><Td><span className="font-medium text-ink">{f.label}</span> <span className="text-[11px] text-faint font-mono">{f.feature}</span></Td><Td right>{fmtNum(f.mean, 2)}</Td><Td right>{fmtNum(f.min, 2)}</Td><Td right>{fmtNum(f.max, 2)}</Td><Td right>{fmtNum(f.std, 2)}</Td></tr>)}</tbody>
                  </table>
                </div>
              </Card>
              <Card><CardHeader title="Pipeline stages executed" /><PipelineStrip steps={d.pipeline} /></Card>
            </div>
          )
        }}
      </Async>
    </div>
  )
}
