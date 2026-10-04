import L from 'leaflet'
import { Locate, WifiOff } from 'lucide-react'
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { ScaleClass } from '../utils/colors'
import { cx } from './ui'

export interface MapPoint { id: string; district: string; state: string; lat: number; lon: number; is_district?: boolean }
export interface LegendSpec { title: string; classes: ScaleClass[]; categorical?: boolean }

const INDIA_BOUNDS = L.latLngBounds([6.0, 67.5], [36.5, 98.0])

export function Legend({ spec, className, horizontal }: { spec: LegendSpec; className?: string; horizontal?: boolean }) {
  return (
    <div className={cx('rounded-lg border border-line bg-white/95 backdrop-blur px-2.5 py-2 shadow-sm', className)} aria-label={`Legend: ${spec.title}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1.5">{spec.title}</div>
      <ul className={cx(horizontal ? 'flex flex-wrap gap-x-3 gap-y-1' : 'space-y-1')}>
        {spec.classes.map((c) => (
          <li key={c.label} className="flex items-center gap-1.5 text-[11px] text-ink leading-none">
            <span className={cx('inline-block h-3 w-3 border border-black/10', spec.categorical ? 'rounded-full' : 'rounded-[3px]')} style={{ background: c.color }} />
            <span className="num">{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) })
  return null
}

function SizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [map])
  return null
}

/** Wheel-zoom only after the map is clicked, so scrolling the page never gets hijacked. */
function WheelGuard() {
  const map = useMap()
  useMapEvents({
    click: () => map.scrollWheelZoom.enable(),
    mouseout: () => map.scrollWheelZoom.disable(),
  })
  useEffect(() => { map.scrollWheelZoom.disable() }, [map])
  return null
}

function ResetView() {
  const map = useMap()
  return (
    <button
      onClick={(e) => { e.stopPropagation(); map.fitBounds(INDIA_BOUNDS, { padding: [8, 8] }) }}
      onDoubleClick={(e) => e.stopPropagation()}
      title="Reset view to India"
      aria-label="Reset map view"
      className="absolute right-2.5 top-[76px] z-[500] grid place-items-center w-[30px] h-[30px] rounded bg-white border border-black/20 text-navy-900 hover:bg-slate-50 shadow-sm"
    >
      <Locate className="w-4 h-4" />
    </button>
  )
}

interface MarkerProps { p: MapPoint; color: string; radius: number; selected: boolean; onSelect?: (id: string) => void; tip: ReactNode }
const Marker = memo(function Marker({ p, color, radius, selected, onSelect, tip }: MarkerProps) {
  const district = p.is_district !== false
  return (
    <CircleMarker
      center={[p.lat, p.lon]} radius={district ? radius : radius * 0.88}
      pathOptions={{ fillColor: color, fillOpacity: 0.88, color: selected ? '#0a2540' : district ? '#ffffff' : color, weight: selected ? 2.5 : district ? 1.2 : 0.4, opacity: 1 }}
      eventHandlers={{ click: () => onSelect?.(p.id) }}
    >
      <Tooltip sticky direction="top" offset={[0, -4]} className="mai-tip">{tip}</Tooltip>
    </CircleMarker>
  )
})

interface MapViewProps<T extends MapPoint> {
  points: T[]
  colorOf: (p: T) => string
  valueLabel: (p: T) => string
  tipExtra?: (p: T) => ReactNode
  legend?: LegendSpec
  selectedId?: string | null
  onSelect?: (id: string) => void
  height?: number | string
  className?: string
  overlay?: ReactNode
}

export function MapView<T extends MapPoint>({ points, colorOf, valueLabel, tipExtra, legend, selectedId, onSelect, height = 480, className, overlay }: MapViewProps<T>) {
  const [zoom, setZoom] = useState(5)
  const [tilesFailed, setTilesFailed] = useState(false)
  const radius = Math.max(3.5, 2.6 + (zoom - 3) * 1.8)
  const selected = useMemo(() => points.find((p) => p.id === selectedId), [points, selectedId])

  return (
    <div className={cx('relative rounded-xl overflow-hidden border border-line bg-[#d9e6ef]', className)} style={{ height }}>
      <MapContainer
        bounds={INDIA_BOUNDS} boundsOptions={{ padding: [8, 8] }} minZoom={4} maxZoom={9} zoomSnap={0.5} preferCanvas
        maxBounds={[[-2, 55], [45, 112]]} style={{ height: '100%', width: '100%' }} attributionControl scrollWheelZoom={false}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution='Tiles &copy; Esri &mdash; basemap only; boundaries shown are the provider&apos;s, not authoritative' maxNativeZoom={9} opacity={0.9} eventHandlers={{ tileerror: () => setTilesFailed(true), tileload: () => setTilesFailed(false) }}
        />
        <ZoomWatcher onZoom={setZoom} />
        <SizeWatcher />
        <WheelGuard />
        <ResetView />
        {points.map((p) => (
          <Marker
            key={p.id} p={p} color={colorOf(p)} radius={radius} selected={p.id === selectedId} onSelect={onSelect}
            tip={<div><div className="font-semibold">{p.district}</div><div className="opacity-70">{p.state}</div><div className="mt-0.5 num">{valueLabel(p)}</div>{tipExtra?.(p)}</div>}
          />
        ))}
        {selected && (
          <CircleMarker center={[selected.lat, selected.lon]} radius={radius + 5} interactive={false} pathOptions={{ color: '#0a2540', weight: 2, fill: false, dashArray: '3 3' }} />
        )}
      </MapContainer>
      {legend && <Legend spec={legend} className="absolute left-2.5 bottom-2.5 z-[500] max-w-[210px] pointer-events-auto" />}
      {tilesFailed && (
        <div className="absolute right-2.5 bottom-7 z-[500] inline-flex items-center gap-1.5 rounded-md bg-white/95 border border-line px-2 py-1 text-[11px] text-muted">
          <WifiOff className="w-3 h-3" /> Basemap tiles offline – data layer still shown
        </div>
      )}
      {overlay}
    </div>
  )
}
