// Types mirroring the FastAPI schemas. Keep in sync with backend/app/schemas + services.

export type RegimeKey = 'active_monsoon' | 'break_monsoon' | 'depression' | 'coastal' | 'orographic' | 'western_disturbance'
export type AlertLevel = 'Normal' | 'Watch' | 'Warning' | 'Severe'
export type ScenarioKey = RegimeKey | 'live'
export type Lead = 0 | 6 | 12 | 24 | 48 | 72

export interface Health { status: string; ready: boolean; message: string; models_loaded: boolean; data_mode: string; version: string; log: string[]; error: string | null }

export interface ScenarioInfo { key: ScenarioKey; label: string; note: string }
export interface ScenariosResponse { default: ScenarioKey; default_seed: number; leads: number[]; thresholds: number[]; items: ScenarioInfo[] }

export interface AlertConfig { heavy_threshold: number; very_heavy_threshold: number; watch_p: number; warning_p: number; severe_p: number; min_regime_confidence: number }

export interface Meta {
  scenario: ScenarioKey; scenario_label: string; seed: number; data_mode: string; disclaimer: string; forecast_cycle: string
  init_time: string; generated_at: string; last_updated: string
  is_live?: boolean; live?: { source: string; fetched_at: string; snapshot: boolean; note: string; warning?: string | null } | null
  lead?: number; lead_label?: string; valid_time?: string; alert_config?: AlertConfig; thresholds?: number[]
}

export interface PipelineStep { id: string; name: string; records: number; ms: number | null; detail: string }

export interface GenerateResponse { scenario: ScenarioKey; scenario_label: string; seed: number; generated_at: string; pipeline: PipelineStep[]; regime: DominantRegime; cached: boolean }

export interface DominantRegime { regime: RegimeKey; label: string; share: number; confidence: number | null; model: string }

export interface Point {
  id: string; district: string; state: string; lat: number; lon: number; elevation: number | null; lead: number
  regime: RegimeKey; confidence: number
  nwp: number; corrected: number; q10: number; q90: number; observed: number | null
  error_nwp: number | null; error_ai: number | null
  p_heavy: number; p_very: number; prob_10: number; prob_25: number; prob_50: number; prob_100: number
  category: string; alert: AlertLevel; low_confidence: boolean; risk_score: number; is_district: boolean
  regime_probs?: Record<RegimeKey, number>
}
export interface PointDetail extends Point {
  universal: number; global_qm: number; temperature: number; humidity: number; wind_speed: number; wind_direction: number; pressure: number
  pressure_tendency: number; prev_rainfall: number; spatial_coverage: number; coast_dist_km: number; category_nwp: string; category_obs: string | null; valid_time: string
}

export interface ForecastList { meta: Meta; total: number; page: number; page_size: number; pages: number; items: Point[] }

export interface RegimeMix { regime: RegimeKey; label: string; short: string; count: number; share: number; mean_confidence: number | null; mean_probability: number }

export interface HorizonRow {
  lead: number; label: string; regime: RegimeKey; regime_label: string; confidence: number | null
  nwp_mean: number; corrected_mean: number; observed_mean: number | null; nwp_p95: number; corrected_p95: number
  p_heavy_max: number; p_very_max: number; p_heavy_mean: number; p_very_mean: number; high_risk: number
}

export interface Dashboard {
  meta: Meta
  kpis: {
    current_regime: RegimeKey; current_regime_label: string; regime_confidence: number | null; regime_area_share: number; regime_model: string
    districts_monitored: number; named_districts: number; high_risk_districts: number; watch_districts: number
    rmse_nwp: number | null; rmse_ai: number | null; rmse_improvement_pct: number | null; validation_rmse_improvement_pct: number | null
    mean_p_heavy: number; mean_p_very: number; max_p_heavy: number; max_p_heavy_district: string; max_p_very: number; max_p_very_district: string
    n_p_heavy_over_50: number; n_p_very_over_50: number; mean_nwp: number; mean_corrected: number; mean_observed: number | null
  }
  regime_mix: RegimeMix[]
  alert_counts: Record<AlertLevel, number>
  top_risk: Point[]
  horizon: HorizonRow[]
  pipeline: PipelineStep[]
  quality: { score: number; grade: string; records: number; valid: number }
  validation_note: string
}

export interface Driver { feature: string; value: number; contribution: number; cols: string[] }

export interface DistrictDetail {
  meta: Meta
  location: { id: string; district: string; state: string; lat: number; lon: number; elevation: number; coast_dist_km: number; is_district: boolean; near: string }
  current: PointDetail
  timeline: PointDetail[]
  model_used: string
  regime_description: string
  explanation: { regime: Driver[]; correction: Driver[] }
  alert: { level: AlertLevel; reason: string; low_confidence: boolean }
  regime_sequence: { lead: number; regime: RegimeKey; confidence: number }[]
  correction_effect: { adjustment_mm: number; adjustment_pct: number }
}

export interface RegimeModelCard {
  regime: RegimeKey; label: string; short: string; model: string; description: string; count: number; share: number; mean_confidence: number | null
  signature: Record<string, number | null>; mean_nwp: number | null; mean_corrected: number | null
}
export interface RegimesView {
  meta: Meta; dominant: DominantRegime; mix: RegimeMix[]
  points: Pick<Point, 'id' | 'district' | 'state' | 'lat' | 'lon' | 'regime' | 'confidence' | 'corrected' | 'is_district'>[]
  models: RegimeModelCard[]
  mix_by_lead: ({ lead: number; label: string } & Record<RegimeKey, number>)[]
  stability: { from: number; to: number; changed_share: number }[]
}
export interface RegimeDetail {
  meta: Meta; location: { id: string; district: string; state: string; lat: number; lon: number }
  regime: RegimeKey; label: string; confidence: number; description: string
  probabilities: { regime: RegimeKey; label: string; probability: number }[]
  explanation: Driver[]
  signature: { feature: string; unit: string; value: number; typical: number }[]
  sequence: { lead: number; label: string; regime: RegimeKey; confidence: number }[]
  method: string
}

export interface AlertCard {
  level: AlertLevel; headline: string; district: string; state: string; id: string; p_very: number; p_heavy: number; corrected: number; nwp: number
  regime: RegimeKey; regime_label: string; confidence: number; low_confidence: boolean; reason: string
}
export interface ProbMetrics { roc_auc?: number; brier?: number; precision?: number; recall?: number; f1?: number; prevalence?: number }
export interface HeavyRainfall {
  meta: Meta; rules: string[]
  summary: { n: number; counts: Record<AlertLevel, number>; mean_p_heavy: number; mean_p_very: number; n_p_heavy_over_50: number; n_p_very_over_50: number }
  ranking: Point[]; alerts: AlertCard[]
  histogram: { bin: string; heavy: number; very: number }[]
  by_state: { state: string; n: number; max_p_very: number; max_p_heavy: number; alerts: number; mean_corrected: number }[]
  reliability: { heavy: Reliability[]; very: Reliability[] }
  model_skill: { heavy: ProbMetrics; very: ProbMetrics }
}
export interface Reliability { bin: string; mean_pred: number; observed_freq: number; n: number }

export interface Bulletin { title: string; issued: string; sections: { heading: string; text: string }[]; text: string; meta: Meta }

// ---------------- verification
export type SourceKey = 'nwp' | 'global_qm' | 'universal' | 'regime_aware'
export interface Scores {
  n: number; rmse: number | null; mae: number | null; bias: number | null; r2: number | null; pod: number | null; far: number | null; csi: number | null
  ets: number | null; fss: number | null; freq_bias: number | null; hits: number; misses: number; false_alarms: number; mean_obs: number | null; mean_fc: number | null
}
export type SourceScores = Record<SourceKey, Scores>
export interface Improvement { rmse_pct?: number; mae_pct?: number; abs_bias_pct?: number; csi_delta?: number; pod_delta?: number; ets_delta?: number; fss_delta?: number; r2_delta?: number; far_delta?: number }
export interface Verification {
  scope: string; scenario: string | null; seed: number | null; lead: number | null; threshold: number; radius_km: number; n: number; note: string; validation_statement: string
  source_labels: Record<SourceKey, string>; sources: SourceScores
  improvement: { vs_nwp: Improvement; vs_global_qm: Improvement; vs_universal: Improvement }
  by_threshold: ({ threshold: number } & Record<SourceKey, Partial<Scores>>)[]
  by_lead: ({ lead: number; label: string; n: number } & Record<string, number | string | null>)[]
  lat_bands: ({ lat: number; n: number; observed: number } & Record<SourceKey, number>)[]
  error_hist: { edges: number[]; bin_width: number; nwp: number[]; regime_aware: number[] }
  scatter: { obs: number; nwp: number; ai: number }[]
}
export interface RegimeWiseRow {
  regime: RegimeKey; label: string; short: string; n: number; share: number; insufficient?: boolean
  mean_obs?: number; sources?: SourceScores; improvement?: Verification['improvement']; rmse_nwp?: number; rmse_ai?: number
}
export interface RegimeWise {
  scope: string; scenario: string | null; threshold: number; radius_km: number; note: string; n: number
  source_labels: Record<SourceKey, string>; regimes: RegimeWiseRow[]; overall: SourceScores; overall_improvement: Verification['improvement']
  bias_fingerprint: { regime: RegimeKey; short: string; bin: string; n: number; mean_nwp: number; mean_obs: number; mean_ai: number; bias_nwp: number; bias_ai: number }[]
  interval_coverage: { regime: RegimeKey; short: string; coverage: number; mean_width_mm: number }[]
  regimes_improved: number; regimes_hurt_by_global_qm: number
}

// ---------------- data quality / upload
export interface QCCheck { id: string; name: string; description: string; affected: number; rate_pct: number; unit: string; action: string; status: 'pass' | 'warn' | 'fail' }
export interface QCReport {
  records_processed: number; records_retained: number; records_dropped: number; valid_records: number; missing_values: number; outliers: number; invalid_values: number
  statistical_outliers: number; duplicates: number; invalid_coordinates: number; coordinates_repaired?: number; missing_timestamps: number; imputed_cells: number
  observed_excluded: number; units_converted: number; quality_score: number; grade: string
  score_components: { row_validity: number; completeness: number; validity: number; uniqueness: number }; score_formula: string
  checks: QCCheck[]; column_completeness: { column: string; missing: number; completeness_pct: number }[]
  injected_defects?: Record<string, number>; injected_note?: string
}
export interface DataQuality {
  meta: Meta; report: QCReport; pipeline: PipelineStep[]; feature_note: string
  features: { feature: string; label: string; mean: number; min: number; max: number; std: number }[]
}
export interface UploadRow {
  district: string; state: string; lat: number; lon: number; timestamp: string; regime: RegimeKey; regime_label: string; confidence: number
  nwp: number; corrected: number; q10: number; q90: number; observed: number | null; error_ai: number | null; error_nwp: number | null
  p_heavy: number; p_very: number; category: string; alert: AlertLevel; risk_score: number
}
export interface UploadResult {
  upload_id: string; filename: string; rows_in: number; rows_used: number; derived: string[]; warnings: string[]
  steps: { id: string; name: string; status: string; ms: number; detail: string }[]
  quality: QCReport; regime_mix: RegimeMix[]; dominant: DominantRegime; alert_counts: Record<AlertLevel, number>; out_of_range_share: number
  verification: { threshold: number; n: number; sources: SourceScores; improvement: Improvement } | null
  rows: UploadRow[]; truncated: boolean; download_url: string; mean: { nwp: number; corrected: number; observed: number | null }
}
export interface UploadSpec { required_columns: string[]; optional_columns: string[]; max_bytes: number; max_rows: number; formats: string[]; units: Record<string, string> }

// ---------------- model + system
export interface FeatureImportance { feature: string; label: string; importance: number }
export interface Cont { rmse: number | null; mae: number | null; bias: number | null; r2: number | null }
export interface ModelInfo {
  trained_at: string; training_seconds: number; data_mode: string; validation_note: string
  cards: { id: string; name: string; algorithm: string; input: string; output: string; purpose: string }[]
  train_rows: number; val_rows: number; features: { key: string; label: string }[]; classifier_features: string[]
  library_versions: Record<string, string>; regime_train_rows: Record<RegimeKey, number>
  classifier: {
    algorithm: string; params: Record<string, string | number>
    metrics: {
      accuracy: number; precision_macro: number; recall_macro: number; f1_macro: number; precision_weighted: number; recall_weighted: number; f1_weighted: number; mean_confidence: number
      per_class: { regime: RegimeKey; label: string; precision: number; recall: number; f1: number; support: number }[]
      confusion_matrix: number[][]; confusion_labels: string[]
    }
    feature_importance: FeatureImportance[]
  }
  correctors: {
    regime: RegimeKey; label: string; algorithm: string; train_rows: number; val_rows: number
    metrics: { nwp: Cont; global_qm: Cont; universal: Cont; regime_model: Cont; interval_coverage_p10_p90: number }
    feature_importance: FeatureImportance[]
  }[]
  probability: Record<string, ProbMetrics & { threshold_mm: number; n_events: number; best_f1?: number; best_f1_threshold?: number; reliability?: Reliability[]; feature_importance?: FeatureImportance[] }>
  correction_params: Record<string, number>
  overall_validation: Record<'nwp' | 'global_qm' | 'universal' | 'regime_aware', Cont>
  end_to_end_by_predicted_regime: Record<string, { n: number; nwp_rmse: number; ai_rmse: number }>
  train_seeds: number[]; val_seeds: number[]
  regimes: { key: RegimeKey; label: string; description: string }[]
}
export interface SystemInfo {
  app: { name: string; tagline: string; version: string }; data_mode: string; disclaimer: string; validation_note: string; forecast_cycle: string
  status: { state: string; message: string; ready: boolean; started_at: string; ready_at: string | null; uptime_s: number; cached_runs: number }
  environment: Record<string, string>
  catalog: { locations: number; named_districts: number; grid_cells: number; states: number; grid_spacing_deg: number }
  limits: { max_upload_mb: number; max_upload_rows: number; leads_hr: number[]; thresholds_mm: number[] }
  endpoints: { method: string; path: string; summary: string }[]
  alert_rules: string[]; alert_defaults: AlertConfig; limitations: string[]; future: string[]
}

// ---------------- lab
export interface PointInput {
  nwp_rainfall: number; temperature: number; humidity: number; wind_speed: number; wind_direction: number; pressure: number; pressure_tendency: number
  elevation: number; latitude: number; longitude: number; prev_rainfall: number; spatial_coverage: number
}
export interface ClassifyResult {
  regime: RegimeKey; label: string; confidence: number; probabilities: { regime: RegimeKey; label: string; probability: number }[]; explanation: Driver[]; model: string; coast_dist_km: number
}
export interface CorrectResult {
  all_regimes: { regime: RegimeKey; label: string; corrected: number; p10: number; p90: number; classifier_probability: number }[]
  classification: ClassifyResult; regime_used: RegimeKey; regime_overridden: boolean; model_used: string; nwp: number; corrected: number; p10: number; p90: number
  universal_ml: number; global_qm: number; category: string; probabilities: Record<string, number>; explanation: Driver[]; note: string
}

export interface ApiErrorBody { error: { code: string; message: string; details?: unknown } }
