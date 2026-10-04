import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DistrictPanel } from '../components/DistrictPanel'
import { AlertBadge, Async, Button, Card, EmptyState, PageHeader, RegimeBadge, Select, Skeleton, Td, Th } from '../components/ui'
import { useForecast } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import type { AlertLevel, Point, RegimeKey } from '../types/api'
import { REGIME_KEYS, regimeLabel } from '../utils/colors'
import { fmtNum, fmtPct, fmtSigned, shortName } from '../utils/format'

type SortKey = keyof Pick<Point, 'district' | 'state' | 'regime' | 'confidence' | 'nwp' | 'corrected' | 'observed' | 'error_ai' | 'p_heavy' | 'p_very' | 'risk_score'>
const PAGE = 20

export default function Districts() {
  const fc = useForecast()
  const { selectedId, select, heavy, veryHeavy } = useApp()
  const [search, setSearch] = useState('')
  const [regime, setRegime] = useState<RegimeKey | 'all'>('all')
  const [alert, setAlert] = useState<AlertLevel | 'all'>('all')
  const [onlyNamed, setOnlyNamed] = useState(false)
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'risk_score', dir: -1 })
  const [page, setPage] = useState(1)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    let r = (fc.data?.items ?? []).filter((p) => (regime === 'all' || p.regime === regime) && (alert === 'all' || p.alert === alert) && (!onlyNamed || p.is_district)
      && (!s || p.district.toLowerCase().includes(s) || p.state.toLowerCase().includes(s)))
    r = [...r].sort((a, b) => {
      const x = a[sort.k], y = b[sort.k]
      if (x === null) return 1
      if (y === null) return -1
      return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir
    })
    return r
  }, [fc.data, search, regime, alert, onlyNamed, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pages)
  const slice = rows.slice((cur - 1) * PAGE, cur * PAGE)
  const head = (k: SortKey, label: string, right = true) => (
    <Th right={right}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => { setSort((s) => (s.k === k ? { k, dir: (-s.dir) as 1 | -1 } : { k, dir: -1 })); setPage(1) }}>
        {label}{sort.k === k && (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </Th>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="District Forecast" subtitle="Every value is produced by the pipeline: regime classifier → regime-specific correction → exceedance probability. Click a row for the full breakdown." />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-8" pad={false}>
          <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search district or state" aria-label="Search"
                className="pl-8 pr-2 py-1.5 text-xs border border-line-strong rounded-md w-52 focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </label>
            <Select value={regime} onChange={(v) => { setRegime(v); setPage(1) }} options={[{ value: 'all', label: 'All regimes' }, ...REGIME_KEYS.map((k) => ({ value: k, label: regimeLabel(k) }))]} />
            <Select value={alert} onChange={(v) => { setAlert(v); setPage(1) }} options={[{ value: 'all', label: 'All alert levels' }, ...(['Severe', 'Warning', 'Watch', 'Normal'] as const).map((k) => ({ value: k, label: k }))]} />
            <label className="inline-flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={onlyNamed} onChange={(e) => { setOnlyNamed(e.target.checked); setPage(1) }} /> Named districts only</label>
            <span className="ml-auto text-xs text-muted num">{rows.length} of {fc.data?.total ?? 0} locations</span>
          </div>
          <Async state={fc} skeleton={<div className="p-4"><Skeleton className="h-96" /></div>}>
            {() => rows.length === 0 ? <EmptyState title="No locations match" hint="Clear the search or filters." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px]">
                  <thead><tr>{head('district', 'District', false)}{head('regime', 'Regime', false)}{head('confidence', 'Conf.')}{head('nwp', 'NWP mm')}{head('corrected', 'AI mm')}{head('observed', 'Obs mm')}{head('error_ai', 'AI err')}{head('p_heavy', `P≥${heavy}`)}{head('p_very', `P≥${veryHeavy}`)}<Th>Alert</Th></tr></thead>
                  <tbody>
                    {slice.map((p) => (
                      <tr key={p.id} onClick={() => select(p.id)} className={`cursor-pointer hover:bg-slate-50 ${p.id === selectedId ? 'bg-accent-soft/60' : ''}`}>
                        <Td><div className="font-medium text-ink">{shortName(p.district)}</div><div className="text-[11px] text-muted">{p.state}</div></Td>
                        <Td><RegimeBadge regime={p.regime} short /></Td>
                        <Td right>{fmtPct(p.confidence)}</Td>
                        <Td right>{fmtNum(p.nwp, 0)}</Td>
                        <Td right className="font-semibold text-ink">{fmtNum(p.corrected, 0)}</Td>
                        <Td right>{fmtNum(p.observed, 0)}</Td>
                        <Td right>{fmtSigned(p.error_ai, 0)}</Td>
                        <Td right>{fmtPct(p.p_heavy)}</Td>
                        <Td right>{fmtPct(p.p_very)}</Td>
                        <Td><AlertBadge level={p.alert} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Async>
          <div className="p-3 flex items-center justify-between border-t border-line">
            <span className="text-xs text-muted num">Page {cur} of {pages}</span>
            <div className="flex gap-2"><Button onClick={() => setPage(Math.max(1, cur - 1))} disabled={cur <= 1}>Previous</Button><Button onClick={() => setPage(Math.min(pages, cur + 1))} disabled={cur >= pages}>Next</Button></div>
          </div>
        </Card>
        <div className="xl:col-span-4">
          {selectedId ? <DistrictPanel id={selectedId} onClose={() => select(null)} /> : <Card><EmptyState title="Select a district" hint="Its regime, corrected rainfall, probabilities and horizon chart will appear here." /></Card>}
        </div>
      </div>
    </div>
  )
}
