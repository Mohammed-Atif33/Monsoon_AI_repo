import { AlertTriangle, CloudOff, Inbox, Loader2, RefreshCw, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ApiState } from '../hooks/useApi'
import type { AlertLevel, RegimeKey } from '../types/api'
import { ALERT_META, REGIME_META } from '../utils/colors'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Card({ className, children, pad = true }: { className?: string; children: ReactNode; pad?: boolean }) {
  return <section className={cx('bg-panel border border-line rounded-xl', pad && 'p-4', className)}>{children}</section>
}

export function CardHeader({ title, subtitle, right, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink tracking-tight">{icon}{title}</h3>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted mt-0.5 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export function Kpi({ label, value, sub, icon, color, className }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; color?: string; className?: string }) {
  return (
    <div className={cx('bg-panel border border-line rounded-xl p-3.5 min-w-0 relative overflow-hidden', className)}>
      {color && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />}
      <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide font-medium text-muted">
        <span className="truncate">{label}</span>
        {icon && <span className="text-faint shrink-0">{icon}</span>}
      </div>
      <div className="mt-1 text-[22px] leading-tight font-semibold text-ink num truncate">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted truncate">{sub}</div>}
    </div>
  )
}

export function Badge({ children, color, soft, className }: { children: ReactNode; color: string; soft?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', className)} style={{ color, background: soft ?? `${color}18` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  )
}

export function RegimeBadge({ regime, short }: { regime: RegimeKey; short?: boolean }) {
  const m = REGIME_META[regime]
  return <Badge color={m.color} soft={m.soft}>{short ? m.short : m.label}</Badge>
}

export function AlertBadge({ level, low }: { level: AlertLevel; low?: boolean }) {
  const m = ALERT_META[level]
  return <Badge color={m.color} soft={m.soft} className="uppercase tracking-wide">{level}{low ? ' · low conf.' : ''}</Badge>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-accent', className ?? 'w-4 h-4')} aria-label="Loading" />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('mai-skel', className ?? 'h-4 w-full')} aria-hidden />
}

export function SkeletonBlock({ rows = 4, h = 'h-4' }: { rows?: number; h?: string }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={cx(h, i % 3 === 2 ? 'w-2/3' : 'w-full')} />)}
    </div>
  )
}

export function ErrorState({ error, onRetry, compact }: { error: { message: string; isUnavailable?: boolean; code?: string }; onRetry?: () => void; compact?: boolean }) {
  const Icon = error.isUnavailable ? CloudOff : AlertTriangle
  return (
    <div role="alert" className={cx('flex flex-col items-center justify-center text-center rounded-lg border border-red-200 bg-red-50/60', compact ? 'p-4 gap-1.5' : 'p-8 gap-2')}>
      <Icon className="w-6 h-6 text-red-600" />
      <p className="text-sm font-medium text-red-900">{error.isUnavailable ? 'Backend unavailable' : 'Something went wrong'}</p>
      <p className="text-xs text-red-800/80 max-w-md">{error.message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-red-900 border border-red-300 rounded-md px-2.5 py-1 hover:bg-red-100">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 gap-1.5 text-muted">
      {icon ?? <Inbox className="w-6 h-6 text-faint" />}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="text-xs max-w-sm">{hint}</p>}
    </div>
  )
}

/** Loading / error / empty / success wrapper for any useApi state. */
export function Async<T>({ state, children, skeleton, compact }: { state: ApiState<T>; children: (d: T) => ReactNode; skeleton?: ReactNode; compact?: boolean }) {
  if (state.error && state.data === undefined) return <ErrorState error={state.error} onRetry={state.refetch} compact={compact} />
  if (state.data === undefined) return <>{skeleton ?? <SkeletonBlock rows={5} />}</>
  return (
    <div className={cx('relative', state.fetching && 'opacity-90 transition-opacity')}>
      {state.fetching && <span className="absolute right-0 -top-1 z-10"><Spinner className="w-3.5 h-3.5" /></span>}
      {state.error && <div className="mb-2"><ErrorState error={state.error} onRetry={state.refetch} compact /></div>}
      {children(state.data)}
    </div>
  )
}

export function Segmented<T extends string | number>({ options, value, onChange, size = 'md', label }: {
  options: { value: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md'; label?: string
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-line">
      {options.map((o) => (
        <button
          key={String(o.value)} role="tab" aria-selected={o.value === value} title={o.title} onClick={() => onChange(o.value)}
          className={cx('rounded-md font-medium transition-colors whitespace-nowrap', size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
            o.value === value ? 'bg-white text-navy-900 shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string | number>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string; className?: string
}) {
  return (
    <label className={cx('inline-flex items-center gap-1.5 text-xs text-muted', className)}>
      {label && <span className="whitespace-nowrap">{label}</span>}
      <select
        value={String(value)}
        onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value) }}
        className="bg-white border border-line-strong rounded-md py-1.5 pl-2 pr-6 text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Button({ children, onClick, variant = 'secondary', disabled, icon, className, type = 'button', title }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost'; disabled?: boolean; icon?: ReactNode; className?: string; type?: 'button' | 'submit'; title?: string
}) {
  return (
    <button
      type={type} onClick={onClick} disabled={disabled} title={title}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        variant === 'primary' && 'bg-accent text-white hover:bg-[#0b6a85]',
        variant === 'secondary' && 'bg-white text-ink border border-line-strong hover:bg-slate-50',
        variant === 'ghost' && 'text-muted hover:text-ink hover:bg-slate-100', className)}
    >
      {icon}{children}
    </button>
  )
}

export function Meter({ value, color = '#0e7c9a', height = 6 }: { value: number; color?: string; height?: number }) {
  return (
    <div className="w-full rounded-full bg-slate-100 overflow-hidden" style={{ height }} role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  )
}

export function Callout({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warn' | 'good'; icon?: ReactNode }) {
  const t = { info: 'bg-accent-soft text-[#0b4e63] border-[#bfe1ec]', warn: 'bg-amber-50 text-amber-900 border-amber-200', good: 'bg-emerald-50 text-emerald-900 border-emerald-200' }[tone]
  return (
    <div className={cx('flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed', t)}>
      <span className="mt-0.5 shrink-0">{icon ?? <Info className="w-3.5 h-3.5" />}</span>
      <div>{children}</div>
    </div>
  )
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs border-b border-line/70 last:border-0">
      <span className="text-muted">{k}</span>
      <span className={cx('text-ink font-medium text-right num', mono && 'font-mono text-[11px]')}>{v}</span>
    </div>
  )
}

export const Th = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <th className={cx('px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted bg-slate-50 border-b border-line whitespace-nowrap', right ? 'text-right' : 'text-left', className)}>{children}</th>
)
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cx('px-3 py-2 text-[13px] border-b border-line/70 num', right && 'text-right', className)}>{children}</td>
)
