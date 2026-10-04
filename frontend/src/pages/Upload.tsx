import { CheckCircle2, Download, FileUp, Loader2, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import { ChecksTable, QualityScore } from './DataQuality'
import { RainMiniMap } from '../components/RainMiniMap'
import { AlertBadge, Button, Callout, Card, CardHeader, ErrorState, Kpi, Meter, PageHeader, RegimeBadge, Td, Th, cx } from '../components/ui'
import { useUploadSpec } from '../hooks/data'
import { ApiError, uploadFile } from '../services/api'
import type { UploadResult } from '../types/api'
import { classify, RAIN_CLASSES, regimeColor, SOURCE_NAMES } from '../utils/colors'
import { fmtNum, fmtPct } from '../utils/format'

const FLOW = ['Upload', 'Validate', 'Quality check', 'Feature engineering', 'Regime classification', 'Bias correction', 'Probability prediction', 'Forecast']

export default function Upload() {
  const spec = useUploadSpec()
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ message: string; details?: unknown } | null>(null)
  const [res, setRes] = useState<UploadResult | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const pick = (f: File | undefined | null) => {
    setErr(null)
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop()
    if (ext !== 'csv' && ext !== 'json') { setErr({ message: 'Only .csv and .json files are supported.' }); return }
    const max = spec.data?.max_bytes ?? 5 * 1024 * 1024
    if (f.size > max) { setErr({ message: `File is ${(f.size / 1048576).toFixed(1)} MB — the limit is ${(max / 1048576).toFixed(0)} MB.` }); return }
    setFile(f)
  }

  const run = async () => {
    if (!file) return
    setBusy(true); setErr(null); setRes(null)
    try { setRes(await uploadFile<UploadResult>('/upload', file)) }
    catch (e) { setErr(e instanceof ApiError ? { message: e.message, details: e.details } : { message: String(e) }) }
    finally { setBusy(false) }
  }

  const pts = (res?.rows ?? []).map((r, i) => ({ ...r, id: String(i) }))

  return (
    <div className="space-y-4">
      <PageHeader title="Data Upload" subtitle="Run your own dataset through the complete pipeline. Files are parsed in memory only — never saved or executed." actions={<>
        <a href="/api/sample-dataset?format=csv" download><Button icon={<Download className="w-3.5 h-3.5" />}>Sample CSV</Button></a>
        <a href="/api/sample-dataset?format=json" download><Button icon={<Download className="w-3.5 h-3.5" />}>Sample JSON</Button></a></>} />

      <Card>
        <ol className="flex flex-wrap gap-y-2 items-center text-[11px] font-medium text-muted">
          {FLOW.map((f, i) => <li key={f} className="flex items-center"><span className={cx('px-2 py-1 rounded-md border', res ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-line bg-slate-50')}>{f}</span>{i < FLOW.length - 1 && <span className="px-1.5 text-faint">→</span>}</li>)}
        </ol>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-7">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) }}
            className={cx('rounded-xl border-2 border-dashed p-8 text-center transition-colors', drag ? 'border-accent bg-accent-soft' : 'border-line-strong bg-slate-50/50')}
          >
            <UploadCloud className="w-9 h-9 mx-auto text-accent" />
            <p className="mt-2 text-sm font-medium text-ink">{file ? file.name : 'Drag a CSV or JSON file here'}</p>
            <p className="text-xs text-muted">{file ? `${(file.size / 1024).toFixed(0)} KB` : `up to ${spec.data ? spec.data.max_bytes / 1048576 : 5} MB · ${spec.data?.max_rows.toLocaleString() ?? '20,000'} rows`}</p>
            <input ref={input} type="file" accept=".csv,.json,application/json,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose file" />
            <div className="mt-3 flex justify-center gap-2">
              <Button onClick={() => input.current?.click()} icon={<FileUp className="w-3.5 h-3.5" />}>Choose file</Button>
              <Button variant="primary" onClick={run} disabled={!file || busy} icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>{busy ? 'Running pipeline…' : 'Run pipeline'}</Button>
            </div>
          </div>
          {err && <div className="mt-3"><ErrorState error={err} compact />{err.details ? <pre className="mt-2 text-[11px] bg-slate-50 border border-line rounded p-2 overflow-auto max-h-32">{JSON.stringify(err.details, null, 1)}</pre> : null}</div>}
        </Card>
        <Card className="xl:col-span-5">
          <CardHeader title="Expected columns" subtitle="Header names are case-insensitive; common aliases (lat, lon, rh …) are accepted" />
          {spec.data && (
            <>
              <div className="flex flex-wrap gap-1.5">{spec.data.required_columns.map((c) => <span key={c} className="font-mono text-[11px] rounded bg-slate-100 border border-line px-1.5 py-0.5" title={spec.data!.units[c]}>{c}</span>)}</div>
              <p className="text-[11px] text-muted mt-2">Optional: {spec.data.optional_columns.map((c) => <code key={c} className="font-mono mr-1.5">{c}</code>)} — derived from repeated timestamps when absent.</p>
              <p className="text-[11px] text-muted mt-1">Units: rainfall mm/24 h · temperature °C · humidity % · wind m/s, ° · pressure hPa · elevation m · timestamp ISO-8601.</p>
            </>
          )}
        </Card>
      </div>

      {res && (
        <div className="space-y-4 mai-in">
          {res.warnings.map((w) => <Callout key={w} tone="warn">{w}</Callout>)}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Rows read" value={res.rows_in.toLocaleString()} sub={`${res.rows_used.toLocaleString()} usable after QC`} color="#184670" />
            <Kpi label="Quality score" value={res.quality.quality_score.toFixed(1)} sub={res.quality.grade} color="#2f8f5b" />
            <Kpi label="Dominant regime" value={<span style={{ color: regimeColor(res.dominant.regime) }}>{res.dominant.label.split(' / ')[0]}</span>} sub={`${fmtPct(res.dominant.share)} of records`} color={regimeColor(res.dominant.regime)} />
            <Kpi label="Warning / Severe" value={res.alert_counts.Warning + res.alert_counts.Severe} sub={`${res.alert_counts.Watch} on watch`} color="#ea7317" />
            <Kpi label="Mean rain NWP → AI" value={`${fmtNum(res.mean.nwp, 1)} → ${fmtNum(res.mean.corrected, 1)}`} sub="mm / 24 h" color="#0e7c9a" />
          </div>
          <Card>
            <CardHeader title="Pipeline run" subtitle={`Measured for ${res.filename}`} />
            <ol className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {res.steps.map((s) => <li key={s.id} className="rounded-lg border border-line p-2.5"><div className="flex items-center gap-1.5 text-xs font-semibold text-ink"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />{s.name}</div><div className="text-[11px] text-muted mt-0.5 leading-snug">{s.detail}</div><div className="text-[10px] text-faint num mt-1">{s.ms.toFixed(0)} ms</div></li>)}
            </ol>
            {res.derived.length > 0 && <ul className="mt-2 text-[11px] text-muted list-disc pl-4">{res.derived.map((d) => <li key={d}>{d}</li>)}</ul>}
          </Card>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <Card className="xl:col-span-5"><CardHeader title="Data quality" /><QualityScore q={res.quality} /></Card>
            <Card className="xl:col-span-7"><CardHeader title="Detected regimes" />
              <ul className="space-y-1.5">{res.regime_mix.filter((r) => r.count > 0).map((r) => <li key={r.regime}><div className="flex justify-between text-xs"><RegimeBadge regime={r.regime} short /><span className="num text-muted">{r.count.toLocaleString()} · {fmtPct(r.share)}</span></div><Meter value={r.share} color={regimeColor(r.regime)} height={5} /></li>)}</ul>
              <div className="mt-3 max-w-md"><RainMiniMap title="AI-corrected rainfall (top 400 by risk)" points={pts} colorOf={(p) => classify(p.corrected, RAIN_CLASSES)} valueLabel={(p) => `AI ${fmtNum(p.corrected, 0)} mm · ${p.regime_label}`} /></div>
            </Card>
          </div>
          {res.verification && (
            <Card>
              <CardHeader title="Verification against your observed rainfall" subtitle={`n = ${res.verification.n.toLocaleString()} · event ≥ ${res.verification.threshold} mm`} />
              <div className="overflow-x-auto"><table className="w-full min-w-[520px]"><thead><tr><Th>Forecast</Th><Th right>RMSE</Th><Th right>MAE</Th><Th right>Bias</Th><Th right>CSI</Th><Th right>POD</Th><Th right>FAR</Th><Th right>FSS</Th></tr></thead>
                <tbody>{(['nwp', 'global_qm', 'universal', 'regime_aware'] as const).map((k) => { const s = res.verification!.sources[k]; return <tr key={k}><Td className="font-medium">{SOURCE_NAMES[k]}</Td>{([s.rmse, s.mae, s.bias, s.csi, s.pod, s.far, s.fss] as (number | null)[]).map((v, i) => <Td key={i} right>{v === null ? 'n/a' : fmtNum(v, i < 3 ? 2 : 3)}</Td>)}</tr> })}</tbody></table></div>
            </Card>
          )}
          <Card pad={false}>
            <div className="p-4 pb-2 flex items-center justify-between"><CardHeader title="Forecast results" subtitle={res.truncated ? 'Top 400 records by risk — download for all rows' : `${res.rows.length} records`} /><a href={res.download_url} download><Button icon={<Download className="w-3.5 h-3.5" />}>Download results CSV</Button></a></div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full min-w-[820px]"><thead className="sticky top-0"><tr><Th>Location</Th><Th>Regime</Th><Th right>Conf.</Th><Th right>NWP</Th><Th right>AI</Th><Th right>Observed</Th><Th right>P≥50</Th><Th right>P≥100</Th><Th>Alert</Th></tr></thead>
                <tbody>{res.rows.map((r, i) => <tr key={i}><Td><div className="font-medium text-ink">{r.district}</div><div className="text-[11px] text-muted">{r.state}</div></Td><Td><RegimeBadge regime={r.regime} short /></Td><Td right>{fmtPct(r.confidence)}</Td><Td right>{fmtNum(r.nwp, 0)}</Td><Td right className="font-semibold">{fmtNum(r.corrected, 0)}</Td><Td right>{fmtNum(r.observed, 0)}</Td><Td right>{fmtPct(r.p_heavy)}</Td><Td right>{fmtPct(r.p_very)}</Td><Td><AlertBadge level={r.alert} /></Td></tr>)}</tbody></table>
            </div>
          </Card>
          <Card pad={false}><div className="p-4 pb-2"><CardHeader title="Validation checks" /></div><ChecksTable q={res.quality} /></Card>
        </div>
      )}
    </div>
  )
}
