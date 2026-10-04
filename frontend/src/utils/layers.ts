import type { Point } from '../types/api'
import { classify, ERROR_CLASSES, PROB_CLASSES, RAIN_CLASSES, regimeColor, REGIME_KEYS, REGIME_META, type ScaleClass } from './colors'
import { fmtMm, fmtPct, fmtSigned } from './format'

export type LayerId = 'nwp' | 'corrected' | 'observed' | 'p_heavy' | 'p_very' | 'error_nwp' | 'error_ai' | 'regime'

export interface LayerDef {
  id: LayerId
  label: string
  short: string
  unit: string
  description: string
  /** numeric value (undefined for the categorical regime layer) */
  value: (p: Point) => number | null
  color: (p: Point) => string
  format: (p: Point) => string
  classes?: ScaleClass[]
  legendTitle: string
}

export function makeLayers(heavy: number, veryHeavy: number): Record<LayerId, LayerDef> {
  return {
    corrected: {
      id: 'corrected', label: 'AI Corrected Rainfall', short: 'AI corrected', unit: 'mm / 24 h', description: 'Regime-specific ML post-processed rainfall',
      value: (p) => p.corrected, color: (p) => classify(p.corrected, RAIN_CLASSES), format: (p) => fmtMm(p.corrected), classes: RAIN_CLASSES, legendTitle: 'AI-corrected rainfall (mm / 24 h)',
    },
    nwp: {
      id: 'nwp', label: 'Raw NWP Rainfall', short: 'Raw NWP', unit: 'mm / 24 h', description: 'Uncorrected numerical model rainfall',
      value: (p) => p.nwp, color: (p) => classify(p.nwp, RAIN_CLASSES), format: (p) => fmtMm(p.nwp), classes: RAIN_CLASSES, legendTitle: 'Raw NWP rainfall (mm / 24 h)',
    },
    observed: {
      id: 'observed', label: 'Observed Rainfall', short: 'Observed', unit: 'mm / 24 h', description: 'Verifying observation (simulated)',
      value: (p) => p.observed, color: (p) => classify(p.observed, RAIN_CLASSES), format: (p) => fmtMm(p.observed), classes: RAIN_CLASSES, legendTitle: 'Observed rainfall (mm / 24 h, simulated)',
    },
    p_heavy: {
      id: 'p_heavy', label: `Heavy Rain Probability (≥ ${heavy} mm)`, short: `P(≥ ${heavy} mm)`, unit: '%', description: 'Model probability of exceeding the heavy-rain threshold',
      value: (p) => p.p_heavy, color: (p) => classify(p.p_heavy, PROB_CLASSES), format: (p) => fmtPct(p.p_heavy), classes: PROB_CLASSES, legendTitle: `P(rain ≥ ${heavy} mm)`,
    },
    p_very: {
      id: 'p_very', label: `Very Heavy Rain Probability (≥ ${veryHeavy} mm)`, short: `P(≥ ${veryHeavy} mm)`, unit: '%', description: 'Model probability of exceeding the very-heavy threshold',
      value: (p) => p.p_very, color: (p) => classify(p.p_very, PROB_CLASSES), format: (p) => fmtPct(p.p_very), classes: PROB_CLASSES, legendTitle: `P(rain ≥ ${veryHeavy} mm)`,
    },
    error_nwp: {
      id: 'error_nwp', label: 'Forecast Error – Raw NWP', short: 'NWP error', unit: 'mm', description: 'Raw NWP minus observed (blue = under-forecast)',
      value: (p) => p.error_nwp, color: (p) => classify(p.error_nwp, ERROR_CLASSES), format: (p) => `${fmtSigned(p.error_nwp, 0)} mm`, classes: ERROR_CLASSES, legendTitle: 'NWP − observed (mm)',
    },
    error_ai: {
      id: 'error_ai', label: 'Forecast Error – AI Corrected', short: 'AI error', unit: 'mm', description: 'AI corrected minus observed (blue = under-forecast)',
      value: (p) => p.error_ai, color: (p) => classify(p.error_ai, ERROR_CLASSES), format: (p) => `${fmtSigned(p.error_ai, 0)} mm`, classes: ERROR_CLASSES, legendTitle: 'AI corrected − observed (mm)',
    },
    regime: {
      id: 'regime', label: 'Weather Regime', short: 'Regime', unit: '', description: 'Classifier-detected regime at each point',
      value: () => null, color: (p) => regimeColor(p.regime), format: (p) => REGIME_META[p.regime].short,
      classes: REGIME_KEYS.map((k) => ({ min: 0, max: 0, color: REGIME_META[k].color, label: REGIME_META[k].label })), legendTitle: 'Weather regime',
    },
  }
}

export const LAYER_ORDER: LayerId[] = ['corrected', 'nwp', 'observed', 'p_heavy', 'p_very', 'error_nwp', 'error_ai', 'regime']
