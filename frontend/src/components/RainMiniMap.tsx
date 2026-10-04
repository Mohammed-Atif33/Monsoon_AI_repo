import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapPoint } from './MapView'

const LAT0 = 6, LAT1 = 37.5, LON0 = 67.5, LON1 = 98.5
const ASPECT = ((LON1 - LON0) * Math.cos((21 * Math.PI) / 180)) / (LAT1 - LAT0)

interface Props<T extends MapPoint> {
  points: T[]
  colorOf: (p: T) => string
  valueLabel: (p: T) => string
  title?: string
  className?: string
  onSelect?: (id: string) => void
  selectedId?: string | null
}

/** Lightweight canvas map (no tiles): each district/grid point drawn on an equirectangular projection. */
export function RainMiniMap<T extends MapPoint>({ points, colorOf, valueLabel, title, className, onSelect, selectedId }: Props<T>) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 300, h: 300 / ASPECT })
  const [hover, setHover] = useState<{ x: number; y: number; p: T } | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => { const w = el.clientWidth; if (w > 0) setSize({ w, h: Math.round(w / ASPECT) }) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const project = useCallback((lat: number, lon: number) => ({ x: ((lon - LON0) / (LON1 - LON0)) * size.w, y: ((LAT1 - lat) / (LAT1 - LAT0)) * size.h }), [size])
  const projected = useMemo(() => points.map((p) => ({ p, ...project(p.lat, p.lon) })), [points, project])

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = size.w * dpr
    c.height = size.h * dpr
    const g = c.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.fillStyle = '#e4edf4'
    g.fillRect(0, 0, size.w, size.h)
    g.strokeStyle = 'rgba(15,28,46,0.07)'
    g.lineWidth = 1
    for (let lon = 70; lon <= 95; lon += 5) { const { x } = project(0, lon); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size.h); g.stroke() }
    for (let lat = 10; lat <= 35; lat += 5) { const { y } = project(lat, 0); g.beginPath(); g.moveTo(0, y); g.lineTo(size.w, y); g.stroke() }
    const r = Math.max(2.4, size.w / 95)
    for (const { p, x, y } of projected) {
      g.fillStyle = colorOf(p)
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
      if (p.id === selectedId) { g.strokeStyle = '#0a2540'; g.lineWidth = 2; g.stroke() }
    }
  }, [projected, size, colorOf, project, selectedId])

  const onMove = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    let best: { d: number; x: number; y: number; p: T } | null = null
    for (const q of projected) { const d = (q.x - mx) ** 2 + (q.y - my) ** 2; if (!best || d < best.d) best = { d, ...q } }
    setHover(best && best.d < 100 ? { x: best.x, y: best.y, p: best.p } : null)
  }

  return (
    <div className={className}>
      {title && <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">{title}</div>}
      <div ref={wrap} className="relative w-full rounded-lg overflow-hidden border border-line">
        <canvas
          ref={ref} style={{ width: size.w, height: size.h, display: 'block', cursor: onSelect ? 'pointer' : 'default' }}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover && onSelect?.(hover.p.id)}
          role="img" aria-label={title ?? 'Rainfall map'}
        />
        {hover && (
          <div className="pointer-events-none absolute z-10 rounded bg-navy-900 text-white text-[11px] px-2 py-1 whitespace-nowrap shadow" style={{ left: Math.min(hover.x + 8, size.w - 130), top: Math.max(hover.y - 34, 2) }}>
            <div className="font-semibold">{hover.p.district}</div>
            <div className="num opacity-80">{valueLabel(hover.p)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
