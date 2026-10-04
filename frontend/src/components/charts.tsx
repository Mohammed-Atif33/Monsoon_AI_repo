import type { ReactNode } from 'react'

export const AXIS = { stroke: '#8b98a9', tick: { fontSize: 11, fill: '#5b6b80' } } as const
export const GRID = { stroke: '#e8edf3', strokeDasharray: '3 3' } as const

interface TipProps { active?: boolean; label?: string | number; payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[]; unit?: string; labelFormat?: (l: string | number) => string; digits?: number }

/** Compact tooltip used by every Recharts chart. */
export function ChartTip({ active, payload, label, unit = '', labelFormat, digits = 1 }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-white px-2.5 py-2 shadow-md text-xs">
      {label !== undefined && <div className="font-semibold text-ink mb-1">{labelFormat ? labelFormat(label) : label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-muted">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-medium text-ink num">{typeof p.value === 'number' ? p.value.toFixed(digits) : p.value}{unit}</span>
        </div>
      ))}
    </div>
  )
}

export function LegendDots({ items }: { items: { label: ReactNode; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {items.map((i, k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 rounded" style={{ background: i.dashed ? 'transparent' : i.color, borderTop: i.dashed ? `2px dashed ${i.color}` : undefined, height: i.dashed ? 0 : 3 }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}
