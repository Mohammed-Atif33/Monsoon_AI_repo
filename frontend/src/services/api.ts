import type { ApiErrorBody } from '../types/api'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
  get isNetwork() { return this.status === 0 }
  get isUnavailable() { return this.status === 503 || this.status === 0 }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>
    if (body?.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details)
  } catch { /* fall through */ }
  return new ApiError(res.status, 'http_error', `Request failed (${res.status} ${res.statusText})`)
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, init)
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the MonsoonAI backend. Is it running on port 8010?')
  }
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  return request<T>(path, { method: 'POST', body: fd })
}
