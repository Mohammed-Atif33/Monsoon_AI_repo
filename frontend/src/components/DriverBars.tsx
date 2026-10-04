import type { Driver } from '../types/api'
import { fmtNum } from '../utils/format'

/** Signed feature attributions (occlusion): bars grow right when the feature pushes the output up. */
export function DriverBars({ drivers, unit, positiveColor = '#0e7c9a', negativeColor = '#e07b39', max = 8, valueUnits }: {
  drivers: Driver[]; unit: 'mm' | 'pp'; positiveColor?: string; negativeColor?: string; max?: number; valueUnits?: Record<string, string>
}) {
  const rows = drivers.slice(0, max)
  const peak = Math.max(...rows.map((d) => Math.abs(d.contribution)), 1e-9)
  const fmt = (c: number) => (unit === 'mm' ? `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c).toFixed(1)} mm` : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c * 100).toFixed(1)} pp`)
  return (
    <ul className="space-y-1.5" aria-label="Feature contributions">
      {rows.map((d) => {
        const w = (Math.abs(d.contribution) / peak) * 50
        const pos = d.contribution >= 0
        return (
          <li key={d.feature} className="grid grid-cols-[132px_1fr_74px] items-center gap-2 text-xs">
            <div className="truncate text-ink" title={d.feature}>
              {d.feature}
              <span className="ml-1 text-faint num">{fmtNum(d.value, Math.abs(d.value) >= 100 ? 0 : 1)}{valueUnits?.[d.feature] ?? ''}</span>
            </div>
            <div className="relative h-3.5 rounded bg-slate-50">
              <span className="absolute top-0 bottom-0 left-1/2 w-px bg-line-strong" />
              <span
                className="absolute top-0.5 bottom-0.5 rounded-sm transition-all duration-500"
                style={{ background: pos ? positiveColor : negativeColor, width: `${w}%`, left: pos ? '50%' : `${50 - w}%` }}
              />
            </div>
            <div className="text-right num text-[11px] text-muted">{fmt(d.contribution)}</div>
          </li>
        )
      })}
    </ul>
  )
}

export function ProbBars({ items, color }: { items: { label: string; probability: number; color?: string }[]; color?: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[132px_1fr_40px] items-center gap-2 text-xs">
          <span className="truncate text-ink">{it.label}</span>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(it.probability * 100, 0.5)}%`, background: it.color ?? color ?? '#0e7c9a' }} />
          </div>
          <span className="text-right num text-muted">{(it.probability * 100).toFixed(0)}%</span>
        </li>
      ))}
    </ul>
  )
}
