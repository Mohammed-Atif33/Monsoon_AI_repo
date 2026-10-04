import type { AlertLevel, RegimeKey, SourceKey } from '../types/api'

export const REGIME_KEYS: RegimeKey[] = ['active_monsoon', 'break_monsoon', 'depression', 'coastal', 'orographic', 'western_disturbance']

export const REGIME_META: Record<RegimeKey, { label: string; short: string; color: string; soft: string }> = {
  active_monsoon: { label: 'Active Monsoon', short: 'Active', color: '#1f7ad6', soft: '#e3effb' },
  break_monsoon: { label: 'Break Monsoon', short: 'Break', color: '#d68b1f', soft: '#fbf0dc' },
  depression: { label: 'Monsoon Low / Depression', short: 'Depression', color: '#7b3fb0', soft: '#efe6f7' },
  coastal: { label: 'Coastal Rainfall', short: 'Coastal', color: '#0f9d9a', soft: '#dcf3f2' },
  orographic: { label: 'Orographic Rainfall', short: 'Orographic', color: '#3a9a4c', soft: '#e1f2e4' },
  western_disturbance: { label: 'Western Disturbance', short: 'W. Disturbance', color: '#d64b7c', soft: '#fae3ec' },
}
export const regimeColor = (r: RegimeKey | string): string => REGIME_META[r as RegimeKey]?.color ?? '#64748b'
export const regimeLabel = (r: RegimeKey | string): string => REGIME_META[r as RegimeKey]?.label ?? String(r)
export const regimeShort = (r: RegimeKey | string): string => REGIME_META[r as RegimeKey]?.short ?? String(r)

export const ALERT_META: Record<AlertLevel, { color: string; soft: string; text: string; rank: number }> = {
  Normal: { color: '#4d8f6a', soft: '#e4f1ea', text: '#2f6a4b', rank: 0 },
  Watch: { color: '#d4a017', soft: '#fbf3d6', text: '#7a5b00', rank: 1 },
  Warning: { color: '#ea7317', soft: '#fdebd9', text: '#9a4a06', rank: 2 },
  Severe: { color: '#c62828', soft: '#fbe0e0', text: '#8f1414', rank: 3 },
}

export const SOURCE_COLORS: Record<SourceKey | 'observed', string> = {
  observed: '#0f1c2e',
  nwp: '#e07b39',
  global_qm: '#8b98a9',
  universal: '#7b3fb0',
  regime_aware: '#0e7c9a',
}
export const SOURCE_NAMES: Record<SourceKey | 'observed', string> = {
  observed: 'Observed',
  nwp: 'Raw NWP',
  global_qm: 'Global bias correction',
  universal: 'Universal ML (regime-blind)',
  regime_aware: 'Regime-aware AI',
}

// ---------------------------------------------------------------- scales
export interface ScaleClass { min: number; max: number; color: string; label: string }

/** IMD-style 24 h rainfall classes (mm). */
export const RAIN_CLASSES: ScaleClass[] = [
  { min: -Infinity, max: 0.1, color: '#e9eff5', label: 'No rain' },
  { min: 0.1, max: 2.5, color: '#cfe6f6', label: '0.1 – 2.5' },
  { min: 2.5, max: 15.6, color: '#9fd0ee', label: '2.5 – 15.6' },
  { min: 15.6, max: 35, color: '#5bb0e4', label: '15.6 – 35' },
  { min: 35, max: 64.5, color: '#2b7bc2', label: '35 – 64.5' },
  { min: 64.5, max: 115.6, color: '#f2b705', label: '64.5 – 115.6 (heavy)' },
  { min: 115.6, max: 204.5, color: '#e5570f', label: '115.6 – 204.4 (very heavy)' },
  { min: 204.5, max: Infinity, color: '#8e1b7e', label: '≥ 204.5 (extreme)' },
]
export const PROB_CLASSES: ScaleClass[] = [
  { min: -Infinity, max: 0.1, color: '#eef2f6', label: '< 10%' },
  { min: 0.1, max: 0.25, color: '#fde68a', label: '10 – 25%' },
  { min: 0.25, max: 0.4, color: '#fbbf24', label: '25 – 40%' },
  { min: 0.4, max: 0.6, color: '#f97316', label: '40 – 60%' },
  { min: 0.6, max: 0.8, color: '#dc2626', label: '60 – 80%' },
  { min: 0.8, max: Infinity, color: '#7f1d1d', label: '≥ 80%' },
]
/** Signed error (forecast − observed): blue = under-forecast, orange/red = over-forecast. */
export const ERROR_CLASSES: ScaleClass[] = [
  { min: -Infinity, max: -60, color: '#1e40af', label: '< −60' },
  { min: -60, max: -30, color: '#3b82f6', label: '−60 – −30' },
  { min: -30, max: -10, color: '#93c5fd', label: '−30 – −10' },
  { min: -10, max: 10, color: '#eef2f6', label: '−10 – +10' },
  { min: 10, max: 30, color: '#fdba74', label: '+10 – +30' },
  { min: 30, max: 60, color: '#f97316', label: '+30 – +60' },
  { min: 60, max: Infinity, color: '#b91c1c', label: '> +60' },
]

export function classify(v: number | null | undefined, classes: ScaleClass[], missing = '#cbd5e1'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return missing
  for (const c of classes) if (v >= c.min && v < c.max) return c.color
  return classes[classes.length - 1].color
}
