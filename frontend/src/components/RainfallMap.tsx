import { useEffect, useMemo } from 'react'
import { useApp } from '../hooks/useApp'
import type { Point } from '../types/api'
import { REGIME_KEYS, REGIME_META } from '../utils/colors'
import { fmtMm, fmtPct } from '../utils/format'
import { LAYER_ORDER, makeLayers, type LayerId } from '../utils/layers'
import { MapView } from './MapView'
import { Select, Segmented } from './ui'

export function useLayers() {
  const { heavy, veryHeavy } = useApp()
  return useMemo(() => makeLayers(heavy, veryHeavy), [heavy, veryHeavy])
}

const NEEDS_OBS: LayerId[] = ['observed', 'error_nwp', 'error_ai']

export function LayerPicker({ value, onChange, compact }: { value: LayerId; onChange: (l: LayerId) => void; compact?: boolean }) {
  const layers = useLayers()
  const { isLive } = useApp()
  const order = LAYER_ORDER.filter((l) => !(isLive && NEEDS_OBS.includes(l)))
  useEffect(() => { if (isLive && NEEDS_OBS.includes(value)) onChange('corrected') }, [isLive, value, onChange])
  if (compact) return <Select label="Layer" value={value} onChange={onChange} options={order.map((l) => ({ value: l, label: layers[l].label }))} />
  return (
    <Segmented
      size="sm" label="Map layer" value={value} onChange={onChange}
      options={order.map((l) => ({ value: l, label: layers[l].short, title: layers[l].description }))}
    />
  )
}

export function RainfallMap({ points, layer, selectedId, onSelect, height = 520, className }: {
  points: Point[]; layer: LayerId; selectedId?: string | null; onSelect?: (id: string) => void; height?: number | string; className?: string
}) {
  const layers = useLayers()
  const { isLive } = useApp()
  const def = layers[isLive && NEEDS_OBS.includes(layer) ? 'corrected' : layer]
  const legend = useMemo(() => ({ title: def.legendTitle, classes: def.classes ?? [], categorical: layer === 'regime' }), [def, layer])
  return (
    <MapView
      points={points} height={height} className={className} legend={legend} selectedId={selectedId} onSelect={onSelect}
      colorOf={def.color} valueLabel={(p) => `${def.short}: ${def.format(p)}`}
      tipExtra={(p) => (
        <div className="mt-1 pt-1 border-t border-white/15 opacity-90 num">
          <div>{REGIME_META[p.regime].short} · {fmtPct(p.confidence)} conf.</div>
          <div>NWP {fmtMm(p.nwp)} → AI {fmtMm(p.corrected)}{p.observed !== null ? ` · Obs ${fmtMm(p.observed)}` : ''}</div>
        </div>
      )}
    />
  )
}

export { REGIME_KEYS }
