import { ArrowRight, Boxes, Brain, CloudRain, Gauge, ScanSearch, ShieldCheck } from 'lucide-react'
import type { PipelineStep } from '../types/api'
import { cx } from './ui'

const ICONS: Record<string, typeof CloudRain> = { ingest: CloudRain, quality: ShieldCheck, features: Boxes, regime: ScanSearch, correction: Brain, probability: Gauge }

/** The executed pipeline for the current forecast run - every count and timing is measured, not decorative. */
export function PipelineStrip({ steps, className }: { steps: PipelineStep[]; className?: string }) {
  return (
    <ol className={cx('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-2', className)} aria-label="Forecast pipeline">
      {steps.map((s, i) => {
        const Icon = ICONS[s.id] ?? Boxes
        return (
          <li key={s.id} className="relative rounded-lg border border-line bg-white px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-navy-900">
              <span className="grid place-items-center w-4 h-4 rounded-full bg-navy-900 text-white text-[9px]">{i + 1}</span><Icon className="w-3.5 h-3.5 text-accent" />{s.name}
            </div>
            <div className="mt-0.5 text-[11px] text-muted leading-snug">{s.detail}</div>
            <div className="mt-1 text-[10px] text-faint num">{s.records.toLocaleString()} records{s.ms != null ? ` · ${s.ms.toFixed(0)} ms` : ''}</div>
            {i < steps.length - 1 && <ArrowRight className="hidden 2xl:block absolute -right-[11px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint bg-white z-10 rounded-full" />}
          </li>
        )
      })}
    </ol>
  )
}
