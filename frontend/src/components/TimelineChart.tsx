import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PointDetail } from '../types/api'
import { SOURCE_COLORS } from '../utils/colors'
import { leadLabel } from '../utils/format'
import { AXIS, ChartTip, GRID } from './charts'

/** NWP vs AI-corrected (+ P10–P90 band) vs observed across the forecast horizons. */
export function TimelineChart({ timeline, height = 220 }: { timeline: PointDetail[]; height?: number }) {
  const data = timeline.map((t) => ({
    label: leadLabel(t.lead), nwp: t.nwp, ai: t.corrected, obs: t.observed, base: t.q10, band: Math.max(t.q90 - t.q10, 0),
  }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} tickLine={false} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
        <Tooltip content={<ChartTip unit=" mm" />} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 4 }} formatter={(v) => (v === 'base' ? '' : v)} />
        <Area dataKey="base" stackId="b" stroke="none" fill="transparent" legendType="none" name="base" isAnimationActive={false} tooltipType="none" />
        <Area dataKey="band" stackId="b" stroke="none" fill={SOURCE_COLORS.regime_aware} fillOpacity={0.14} name="AI P10–P90" isAnimationActive={false} />
        <Line dataKey="nwp" name="Raw NWP" stroke={SOURCE_COLORS.nwp} strokeWidth={2} dot={{ r: 3 }} />
        <Line dataKey="ai" name="AI corrected" stroke={SOURCE_COLORS.regime_aware} strokeWidth={2.4} dot={{ r: 3 }} />
        <Line dataKey="obs" name="Observed" stroke={SOURCE_COLORS.observed} strokeWidth={1.6} strokeDasharray="4 3" dot={{ r: 2.5 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
