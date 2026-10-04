import { useMemo, useState } from 'react'
import { DistrictPanel } from '../components/DistrictPanel'
import { LayerPicker, RainfallMap, useLayers } from '../components/RainfallMap'
import { Async, Callout, Card, PageHeader, Skeleton } from '../components/ui'
import { useForecast } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import type { LayerId } from '../utils/layers'
import { fmtNum } from '../utils/format'

export default function ForecastMap() {
  const fc = useForecast()
  const { selectedId, select } = useApp()
  const [layer, setLayer] = useState<LayerId>('corrected')
  const layers = useLayers()
  const def = layers[layer]

  const stats = useMemo(() => {
    const v = (fc.data?.items ?? []).map((p) => def.value(p)).filter((x): x is number => x !== null)
    if (!v.length) return null
    return { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length }
  }, [fc.data, def])

  return (
    <div className="space-y-4">
      <PageHeader title="Forecast Map" subtitle="Switch layers to compare raw NWP, the AI-corrected forecast, observations, exceedance probabilities, forecast error and the weather regime." />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-8" pad={false}>
          <div className="p-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <div className="overflow-x-auto max-w-full"><LayerPicker value={layer} onChange={setLayer} /></div>
            {stats && layer !== 'regime' && (
              <div className="text-xs text-muted num">{def.short}: min <b className="text-ink">{fmtNum(stats.min, layer.startsWith('p_') ? 2 : 0)}</b> · mean <b className="text-ink">{fmtNum(stats.mean, layer.startsWith('p_') ? 2 : 1)}</b> · max <b className="text-ink">{fmtNum(stats.max, layer.startsWith('p_') ? 2 : 0)}</b> {layer.startsWith('p_') ? '' : 'mm'}</div>
            )}
          </div>
          <div className="p-3">
            <Async state={fc} skeleton={<Skeleton className="h-[640px]" />}>
              {(f) => <RainfallMap points={f.items} layer={layer} selectedId={selectedId} onSelect={select} height="calc(100vh - 340px)" className="min-h-[460px]" />}
            </Async>
            <p className="text-[11px] text-faint mt-2">{def.description}. Circles are named districts (white outline) and grid cells.</p>
          </div>
        </Card>
        <div className="xl:col-span-4 space-y-3">
          {selectedId ? <DistrictPanel id={selectedId} onClose={() => select(null)} /> : <Callout>Click a district or grid cell on the map to open its forecast, regime explanation and horizon chart.</Callout>}
        </div>
      </div>
    </div>
  )
}
