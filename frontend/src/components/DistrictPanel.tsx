import { ArrowRight, Mountain, Waves, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDistrict } from '../hooks/data'
import { useApp } from '../hooks/useApp'
import type { DistrictDetail, RegimeKey } from '../types/api'
import { classify, PROB_CLASSES, RAIN_CLASSES, REGIME_KEYS, regimeColor, regimeLabel } from '../utils/colors'
import { fmtMm, fmtNum, fmtPct, fmtSigned, shortName } from '../utils/format'
import { DriverBars, ProbBars } from './DriverBars'
import { TimelineChart } from './TimelineChart'
import { Async, AlertBadge, Meter, RegimeBadge, SkeletonBlock, cx } from './ui'

function Val({ label, value, sub, strong, color }: { label: string; value: string; sub?: string; strong?: boolean; color?: string }) {
  return (
    <div className={cx('rounded-lg border px-2.5 py-2', strong ? 'border-accent/40 bg-accent-soft' : 'border-line bg-slate-50/60')}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
        {color && <span className="w-2 h-2 rounded-sm" style={{ background: color }} />}{label}
      </div>
      <div className={cx('num font-semibold text-ink', strong ? 'text-xl' : 'text-lg')}>{value}</div>
      {sub && <div className="text-[11px] text-muted num">{sub}</div>}
    </div>
  )
}

function Body({ d, compact }: { d: DistrictDetail; compact?: boolean }) {
  const { heavy, veryHeavy } = useApp()
  const c = d.current
  const alts = c.regime_probs
    ? REGIME_KEYS.filter((k) => k !== c.regime).map((k) => ({ regime: k as RegimeKey, p: c.regime_probs![k as RegimeKey] })).sort((a, b) => b.p - a.p).slice(0, 3)
    : []
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <RegimeBadge regime={c.regime} />
          <AlertBadge level={d.alert.level} low={d.alert.low_confidence} />
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div>
            <div className="flex items-baseline justify-between text-xs mb-1"><span className="text-muted">Regime confidence</span><span className="num font-semibold text-ink text-sm">{fmtPct(c.confidence)}</span></div>
            <Meter value={c.confidence} color={regimeColor(c.regime)} />
          </div>
        </div>
        {alts.length > 0 && (
          <div className="text-[11px] text-muted">Alternatives: {alts.map((a, i) => <span key={a.regime}>{i > 0 && ' · '}{regimeLabel(a.regime)} <span className="num">{fmtPct(a.p)}</span></span>)}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Val label="Raw NWP" value={fmtMm(c.nwp)} sub={c.category_nwp} color={classify(c.nwp, RAIN_CLASSES)} />
        <Val label="AI corrected" value={fmtMm(c.corrected)} sub={`P10–P90: ${c.q10.toFixed(0)}–${c.q90.toFixed(0)} mm`} strong color={classify(c.corrected, RAIN_CLASSES)} />
        <Val label="Observed" value={fmtMm(c.observed)} sub={c.category_obs ?? 'not available'} color={classify(c.observed, RAIN_CLASSES)} />
        <Val label="Category" value={c.category} sub="IMD class, AI forecast" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-line px-2.5 py-2">
          <div className="text-muted mb-0.5">NWP error</div>
          <div className="num font-semibold text-ink">{fmtSigned(c.error_nwp, 1)} mm</div>
        </div>
        <div className="rounded-lg border border-line px-2.5 py-2">
          <div className="text-muted mb-0.5">AI error</div>
          <div className="num font-semibold text-ink">{fmtSigned(c.error_ai, 1)} mm</div>
        </div>
      </div>

      <div className="space-y-2.5">
        {[{ label: `Heavy rain probability (≥ ${heavy} mm)`, v: c.p_heavy }, { label: `Very heavy probability (≥ ${veryHeavy} mm)`, v: c.p_very }].map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between text-xs mb-1"><span className="text-muted">{r.label}</span><span className="num font-semibold text-ink text-sm">{fmtPct(r.v)}</span></div>
            <Meter value={r.v} color={classify(r.v, PROB_CLASSES.map((x, i) => (i === 0 ? { ...x, color: '#94a3b8' } : x)))} height={7} />
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-navy-900 text-white px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wide text-white/60">Regime-specific model selected</div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-[13px] font-semibold">{d.model_used}</span>
          <span className="num text-xs text-cyan-200">{fmtSigned(d.correction_effect.adjustment_mm, 0)} mm ({fmtSigned(d.correction_effect.adjustment_pct, 0)}%)</span>
        </div>
      </div>

      {!compact && (
        <>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Why this regime?</div>
            <DriverBars drivers={d.explanation.regime} unit="pp" max={6} positiveColor={regimeColor(c.regime)} />
            <p className="text-[10px] text-faint mt-1.5">Occlusion on the Random Forest: change in regime probability when a feature is set to its training median.</p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Forecast horizon</div>
            <TimelineChart timeline={d.timeline} height={190} />
          </div>
        </>
      )}
      {compact && c.regime_probs && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Regime probabilities</div>
          <ProbBars items={REGIME_KEYS.map((k) => ({ label: regimeLabel(k), probability: c.regime_probs![k], color: regimeColor(k) })).sort((a, b) => b.probability - a.probability).slice(0, 4)} />
        </div>
      )}
    </div>
  )
}

export function DistrictPanel({ id, compact, onClose, className }: { id: string | null; compact?: boolean; onClose?: () => void; className?: string }) {
  const s = useDistrict(id)
  if (!id) return null
  return (
    <div className={cx('bg-panel border border-line rounded-xl', className)}>
      <Async state={s} skeleton={<div className="p-4"><SkeletonBlock rows={9} h="h-5" /></div>} compact>
        {(d) => (
          <div className="p-4 mai-in">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-ink leading-snug">{shortName(d.location.district)}</h3>
                <p className="text-xs text-muted num flex items-center gap-2 flex-wrap mt-0.5">
                  <span>{d.location.state}</span>
                  <span>{d.location.lat.toFixed(2)}°N {d.location.lon.toFixed(2)}°E</span>
                  <span className="inline-flex items-center gap-0.5"><Mountain className="w-3 h-3" />{fmtNum(d.location.elevation, 0)} m</span>
                  <span className="inline-flex items-center gap-0.5"><Waves className="w-3 h-3" />{fmtNum(d.location.coast_dist_km, 0)} km to coast</span>
                </p>
              </div>
              {onClose && <button onClick={onClose} aria-label="Close panel" className="p-1 rounded-md text-muted hover:bg-slate-100"><X className="w-4 h-4" /></button>}
            </div>
            <Body d={d} compact={compact} />
            {compact && (
              <Link to="/post-processing" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                See how the AI corrected this forecast <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        )}
      </Async>
    </div>
  )
}
