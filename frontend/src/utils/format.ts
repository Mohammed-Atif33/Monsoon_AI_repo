export const fmtNum = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d))
export const fmtMm = (v: number | null | undefined, d = 0): string => (v === null || v === undefined ? '–' : `${v.toFixed(d)} mm`)
export const fmtPct = (v: number | null | undefined, d = 0): string => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(d)}%`)
export const fmtSigned = (v: number | null | undefined, d = 1): string => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`)
export const fmtSignedPct = (v: number | null | undefined, d = 0): string => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`)

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC'
}
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}
export function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
export const leadLabel = (l: number): string => (l === 0 ? 'Now' : `+${l} hr`)
export const compass = (deg: number): string => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]

/** Trim a "Grid 19.5N 73.0E (near Pune)" name to something compact for tight spaces. */
export function shortName(name: string): string {
  const m = /^Grid ([\d.]+N [\d.]+E) \(near (.+)\)$/.exec(name)
  return m ? `${m[2]} grid (${m[1]})` : name
}
export const isGrid = (name: string): boolean => name.startsWith('Grid ')
