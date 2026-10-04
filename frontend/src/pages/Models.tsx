import { Brain, CloudLightning, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTip, GRID } from '../components/charts'
import { Async, Callout, Card, CardHeader, KV, Kpi, PageHeader, Select, Skeleton, Td, Th } from '../components/ui'
import { useModelInfo } from '../hooks/data'
import type { FeatureImportance, ModelInfo, RegimeKey } from '../types/api'
import { REGIME_KEYS, regimeColor, regimeLabel, regimeShort } from '../utils/colors'
import { fmtDateTime, fmtNum, fmtPct } from '../utils/format'

function Importance({ items, color = '#0e7c9a', max = 8 }: { items: FeatureImportance[]; color?: string; max?: number }) {
  const rows = items.slice(0, max)
  const peak = Math.max(...rows.map((r) => r.importance), 1e-9)
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.feature} className="grid grid-cols-[150px_1fr_46px] items-center gap-2 text-xs">
          <span className="truncate text-ink">{r.label}</span>
          <div className="h-2.5 rounded bg-slate-100 overflow-hidden"><div className="h-full rounded" style={{ width: `${(r.importance / peak) * 100}%`, background: color }} /></div>
          <span className="num text-right text-muted">{r.importance.toFixed(3)}</span>
        </li>
      ))}
    </ul>
  )
}

function Confusion({ m }: { m: ModelInfo['classifier']['metrics'] }) {
  const max = Math.max(...m.confusion_matrix.flat(), 1)
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-separate border-spacing-0.5">
        <thead><tr><th className="p-1" /><th colSpan={6} className="text-muted font-medium pb-1">Predicted →</th></tr>
          <tr><th className="p-1 text-muted font-medium text-right">True ↓</th>{REGIME_KEYS.map((k) => <th key={k} className="p-1 font-medium" style={{ color: regimeColor(k) }}>{regimeShort(k)}</th>)}</tr></thead>
        <tbody>
          {m.confusion_matrix.map((row, i) => {
            const tot = row.reduce((a, b) => a + b, 0) || 1
            return (
              <tr key={i}>
                <th className="pr-2 text-right font-medium whitespace-nowrap" style={{ color: regimeColor(REGIME_KEYS[i]) }}>{regimeShort(REGIME_KEYS[i])}</th>
                {row.map((v, j) => <td key={j} title={`${v} of ${tot}`} className="w-14 h-9 text-center num rounded" style={{ background: `rgba(14,124,154,${(v / max) * 0.9 + (v ? 0.06 : 0)})`, color: v / max > 0.45 ? '#fff' : '#0f1c2e' }}>{v ? `${Math.round((100 * v) / tot)}%` : ''}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-faint mt-1">Row-normalised share of true-regime samples (held-out validation).</p>
    </div>
  )
}

function Content({ m }: { m: ModelInfo }) {
  const [reg, setReg] = useState<RegimeKey>('active_monsoon')
  const [thr, setThr] = useState('50')
  const cor = m.correctors.find((c) => c.regime === reg)!
  const c = m.classifier.metrics
  const p = m.probability[thr]
  return (
    <div className="space-y-5">
      <Callout tone="warn">{m.validation_note} Metrics below are on <b>{m.val_rows.toLocaleString()}</b> held-out simulated rows (runs never seen in training).</Callout>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Training rows" value={m.train_rows.toLocaleString()} sub={`${m.train_seeds.length} seeds × 6 scenarios × 6 leads`} color="#184670" />
        <Kpi label="Validation rows" value={m.val_rows.toLocaleString()} sub={`${m.val_seeds.length} held-out seeds`} color="#0e7c9a" />
        <Kpi label="Trained at" value={<span className="text-base">{fmtDateTime(m.trained_at)}</span>} sub={`took ${m.training_seconds}s`} color="#3a9a4c" />
        <Kpi label="Library" value={<span className="text-base">scikit-learn {m.library_versions['scikit-learn']}</span>} sub={`Python ${m.library_versions.python}`} color="#7b3fb0" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {m.cards.map((k, i) => {
          const Icon = [ScanSearch, Brain, CloudLightning][i]
          return (
            <Card key={k.id}>
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Icon className="w-4 h-4 text-accent" />{k.name}</div>
              <p className="text-xs text-muted mt-1">{k.purpose}</p>
              <div className="mt-2 rounded-lg bg-slate-50 border border-line p-2.5 text-xs space-y-1">
                <div><span className="text-faint">Input</span> <span className="text-ink font-medium">{k.input}</span></div>
                <div><span className="text-faint">Output</span> <span className="text-ink font-medium">{k.output}</span></div>
                <div><span className="text-faint">Algorithm</span> <span className="text-ink font-medium">{k.algorithm}</span></div>
              </div>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader title="Model 1 — Weather regime classifier" subtitle={`${m.classifier.algorithm} · ${m.classifier.metrics.per_class.reduce((a, r) => a + r.support, 0).toLocaleString()} validation samples`} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          {[['Accuracy', c.accuracy], ['Precision (macro)', c.precision_macro], ['Recall (macro)', c.recall_macro], ['F1 (macro)', c.f1_macro], ['Mean confidence', c.mean_confidence]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border border-line p-2.5"><div className="text-[10.5px] uppercase tracking-wide text-muted font-medium">{l}</div><div className="num text-xl font-semibold">{fmtPct(v as number, 1)}</div></div>
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Confusion m={c} />
          <div className="overflow-x-auto">
            <table className="w-full"><thead><tr><Th>Regime</Th><Th right>Prec.</Th><Th right>Recall</Th><Th right>F1</Th><Th right>n</Th></tr></thead>
              <tbody>{c.per_class.map((r) => <tr key={r.regime}><Td><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: regimeColor(r.regime) }} />{r.label}</span></Td><Td right>{fmtNum(r.precision, 3)}</Td><Td right>{fmtNum(r.recall, 3)}</Td><Td right>{fmtNum(r.f1, 3)}</Td><Td right>{r.support.toLocaleString()}</Td></tr>)}</tbody></table>
          </div>
          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Feature importance (Gini)</div><Importance items={m.classifier.feature_importance} max={9} /></div>
        </div>
        <div className="mt-3 text-[11px] text-muted">Features: {m.classifier_features.join(', ')}</div>
      </Card>

      <Card>
        <CardHeader title="Model 2 — Regime-specific bias correction" subtitle="Six HistGradientBoosting regressors (+ P10/P90 quantile models); held-out rows of each true regime" right={<Select value={reg} onChange={setReg} options={REGIME_KEYS.map((k) => ({ value: k, label: regimeLabel(k) }))} />} />
        <div className="overflow-x-auto mb-4">
          <table className="w-full min-w-[820px]">
            <thead><tr><Th>Regime</Th><Th right>Train rows</Th><Th right>NWP RMSE</Th><Th right>Global QM</Th><Th right>Universal ML</Th><Th right>Regime model</Th><Th right>MAE</Th><Th right>Bias</Th><Th right>R²</Th><Th right>P10–P90 cover</Th></tr></thead>
            <tbody>
              {m.correctors.map((r) => (
                <tr key={r.regime} className={r.regime === reg ? 'bg-accent-soft/50' : ''}>
                  <Td><span className="inline-flex items-center gap-1.5 font-medium"><span className="w-2 h-2 rounded-full" style={{ background: regimeColor(r.regime) }} />{r.label}</span></Td>
                  <Td right>{r.train_rows.toLocaleString()}</Td><Td right>{fmtNum(r.metrics.nwp.rmse, 1)}</Td>
                  <Td right className={(r.metrics.global_qm.rmse ?? 0) > (r.metrics.nwp.rmse ?? 0) ? 'text-red-700' : ''}>{fmtNum(r.metrics.global_qm.rmse, 1)}</Td>
                  <Td right>{fmtNum(r.metrics.universal.rmse, 1)}</Td><Td right className="font-bold text-accent">{fmtNum(r.metrics.regime_model.rmse, 1)}</Td>
                  <Td right>{fmtNum(r.metrics.regime_model.mae, 1)}</Td><Td right>{fmtNum(r.metrics.regime_model.bias, 2)}</Td><Td right>{fmtNum(r.metrics.regime_model.r2, 3)}</Td><Td right>{fmtPct(r.metrics.interval_coverage_p10_p90)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Permutation importance — {regimeLabel(reg)} model (ΔRMSE, mm)</div><Importance items={cor.feature_importance} color={regimeColor(reg)} max={9} /></div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">RMSE by regime (mm)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={m.correctors.map((r) => ({ name: regimeShort(r.regime), nwp: r.metrics.nwp.rmse, ai: r.metrics.regime_model.rmse, regime: r.regime }))} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
                <CartesianGrid {...GRID} vertical={false} /><XAxis dataKey="name" {...AXIS} tickLine={false} interval={0} fontSize={10} /><YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                <Tooltip content={<ChartTip unit=" mm" />} cursor={{ fill: '#eef3f8' }} />
                <Bar dataKey="nwp" name="Raw NWP" fill="#e07b39" radius={[3, 3, 0, 0]} /><Bar dataKey="ai" name="Regime model" radius={[3, 3, 0, 0]}>{m.correctors.map((r) => <Cell key={r.regime} fill={regimeColor(r.regime)} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-3 text-[11px] text-muted">Hyper-parameters: {Object.entries(m.correction_params).map(([k, v]) => `${k}=${v}`).join(', ')} · Features: {m.features.map((f) => f.key).join(', ')}</div>
      </Card>

      <Card>
        <CardHeader title="Model 3 — Heavy rainfall probability" subtitle="HistGradientBoosting classifiers per threshold; evaluated end-to-end (predicted regime → corrected rainfall → probability)" right={<Select value={thr} onChange={setThr} options={Object.keys(m.probability).map((t) => ({ value: t, label: `≥ ${t} mm` }))} />} />
        <div className="overflow-x-auto mb-4">
          <table className="w-full min-w-[640px]">
            <thead><tr><Th>Threshold</Th><Th right>Base rate</Th><Th right>ROC-AUC</Th><Th right>Precision@0.5</Th><Th right>Recall@0.5</Th><Th right>F1@0.5</Th><Th right>Best F1</Th><Th right>@ p</Th><Th right>Brier</Th></tr></thead>
            <tbody>{Object.entries(m.probability).map(([t, r]) => <tr key={t} className={t === thr ? 'bg-accent-soft/50' : ''}><Td className="font-medium">≥ {t} mm</Td><Td right>{fmtPct(r.prevalence, 1)}</Td><Td right className="font-semibold">{fmtNum(r.roc_auc, 3)}</Td><Td right>{fmtNum(r.precision, 3)}</Td><Td right>{fmtNum(r.recall, 3)}</Td><Td right>{fmtNum(r.f1, 3)}</Td><Td right>{fmtNum(r.best_f1, 3)}</Td><Td right>{fmtNum(r.best_f1_threshold, 2)}</Td><Td right>{fmtNum(r.brier, 4)}</Td></tr>)}</tbody>
          </table>
        </div>
        {p?.feature_importance && p.feature_importance.length > 0 && <div><div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Permutation importance for P(≥ {thr} mm) (ΔROC-AUC)</div><Importance items={p.feature_importance} color="#c62828" max={9} /></div>}
        <p className="text-[11px] text-muted mt-2">Rare events (≥ 100 mm) have low precision/recall at a 0.5 cut-off by construction; ROC-AUC, Brier score and the reliability diagram (Heavy Rainfall page) describe probability quality better.</p>
      </Card>
      <Card>
        <CardHeader title="Training set composition" />
        <div className="grid grid-cols-2 md:grid-cols-6 gap-x-6">{REGIME_KEYS.map((k) => <KV key={k} k={regimeShort(k)} v={m.regime_train_rows[k].toLocaleString()} />)}</div>
      </Card>
    </div>
  )
}

export default function Models() {
  const s = useModelInfo()
  return (
    <div className="space-y-4">
      <PageHeader title="Model Insights" subtitle="Three transparent models, their inputs, algorithms and held-out metrics — everything on this page is read from the saved training run." />
      <Async state={s} skeleton={<Skeleton className="h-[600px]" />}>{(m) => <Content m={m} />}</Async>
    </div>
  )
}
