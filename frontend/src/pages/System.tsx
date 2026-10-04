import { AlertTriangle, Rocket } from 'lucide-react'
import { Async, Badge, Callout, Card, CardHeader, KV, PageHeader, Skeleton, Td, Th } from '../components/ui'
import { useSystemInfo } from '../hooks/data'
import { fmtDateTime, fmtDuration } from '../utils/format'

export default function System() {
  const s = useSystemInfo()
  return (
    <div className="space-y-4">
      <PageHeader title="System Information" subtitle="Data provenance, honest limitations, runtime status and the API surface." />
      <Async state={s} skeleton={<Skeleton className="h-96" />}>
        {(d) => (
          <div className="space-y-4">
            <Callout tone="warn"><b>{d.disclaimer}.</b> {d.validation_note}</Callout>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader title="Runtime" right={<Badge color={d.status.ready ? '#2f8f5b' : '#d4a017'}>{d.status.state}</Badge>} />
                <KV k="Application" v={`${d.app.name} ${d.app.version}`} /><KV k="Data mode" v={d.data_mode} /><KV k="Forecast cycle" v={d.forecast_cycle} />
                <KV k="Started" v={fmtDateTime(d.status.started_at)} /><KV k="Uptime" v={fmtDuration(d.status.uptime_s)} /><KV k="Cached forecast runs" v={d.status.cached_runs} />
                {Object.entries(d.environment).map(([k, v]) => <KV key={k} k={k.replace('_', ' ')} v={v} />)}
              </Card>
              <Card>
                <CardHeader title="Simulation domain" />
                <KV k="Locations" v={d.catalog.locations} /><KV k="Named districts" v={d.catalog.named_districts} /><KV k="Grid cells" v={`${d.catalog.grid_cells} (${d.catalog.grid_spacing_deg}° spacing)`} /><KV k="States / UTs" v={d.catalog.states} />
                <KV k="Lead times" v={d.limits.leads_hr.map((l) => (l === 0 ? 'Now' : `+${l}h`)).join(' · ')} /><KV k="Thresholds" v={d.limits.thresholds_mm.join(' / ') + ' mm'} />
                <KV k="Upload limit" v={`${d.limits.max_upload_mb} MB · ${d.limits.max_upload_rows.toLocaleString()} rows`} />
                <p className="text-[11px] text-muted mt-2">Basemap tiles are supplied by a third party; boundaries shown on the basemap are the provider's and not authoritative. MonsoonAI draws no borders of its own.</p>
              </Card>
              <Card>
                <CardHeader title="Alert rules" subtitle="Defaults (configurable on the Heavy Rainfall page)" />
                <ul className="text-xs text-muted list-disc pl-4 space-y-1">{d.alert_rules.map((r) => <li key={r}>{r}</li>)}</ul>
                <div className="mt-2 text-[11px] text-faint num">{Object.entries(d.alert_defaults).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</div>
              </Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Limitations" icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} />
                <ul className="text-[13px] text-ink list-disc pl-4 space-y-1.5">{d.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
              </Card>
              <Card>
                <CardHeader title="Future integrations" icon={<Rocket className="w-4 h-4 text-accent" />} subtitle="Interfaces are kept separate so real data can replace the simulator" />
                <div className="flex flex-wrap gap-1.5">{d.future.map((f) => <span key={f} className="rounded-md border border-line bg-slate-50 px-2 py-1 text-xs text-ink">{f}</span>)}</div>
              </Card>
            </div>
            <Card pad={false}>
              <div className="p-4 pb-2"><CardHeader title="API endpoints" subtitle="Interactive docs: /docs (Swagger) on the backend" /></div>
              <div className="overflow-x-auto"><table className="w-full"><thead><tr><Th>Method</Th><Th>Path</Th><Th>Handler</Th></tr></thead>
                <tbody>{d.endpoints.map((e) => <tr key={e.method + e.path}><Td><Badge color={e.method === 'GET' ? '#0e7c9a' : '#7b3fb0'}>{e.method}</Badge></Td><Td className="font-mono text-xs">{e.path}</Td><Td className="text-xs text-muted capitalize">{e.summary}</Td></tr>)}</tbody></table></div>
            </Card>
          </div>
        )}
      </Async>
    </div>
  )
}
