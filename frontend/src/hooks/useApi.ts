import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, request } from '../services/api'

interface Entry { data: unknown; at: number }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()
const MAX_ENTRIES = 80
const TTL_MS = 5 * 60 * 1000

function fetchCached<T>(url: string, force = false): Promise<T> {
  const hit = cache.get(url)
  if (!force && hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data as T)
  const running = inflight.get(url)
  if (running) return running as Promise<T>
  const p = request<T>(url)
    .then((data) => {
      cache.set(url, { data, at: Date.now() })
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
      return data
    })
    .finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}

export function clearApiCache() { cache.clear() }

export interface ApiState<T> {
  data: T | undefined
  error: ApiError | null
  /** true only while nothing (not even stale data) can be shown */
  loading: boolean
  /** true while a request for the current URL is in flight (data may be stale from the previous URL) */
  fetching: boolean
  refetch: () => void
}

/** GET `url` (null = disabled). Serves cached data instantly, keeps the previous result while a new URL loads. */
export function useApi<T>(url: string | null): ApiState<T> {
  const [data, setData] = useState<T | undefined>(() => (url ? (cache.get(url)?.data as T | undefined) : undefined))
  const [error, setError] = useState<ApiError | null>(null)
  const [fetching, setFetching] = useState<boolean>(!!url && !cache.has(url))
  const [nonce, setNonce] = useState(0)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!url) { setFetching(false); return }
    let cancelled = false
    const cached = cache.get(url)
    if (cached && nonce === 0) {
      setData(cached.data as T)
      setError(null)
      setFetching(false)
      return
    }
    setFetching(true)
    setError(null)
    fetchCached<T>(url, nonce > 0)
      .then((d) => { if (!cancelled) { setData(d); setFetching(false) } })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)))
        setFetching(false)
      })
    return () => { cancelled = true }
  }, [url, nonce])

  const refetch = useCallback(() => { cache.delete(url ?? ''); setNonce((n) => n + 1) }, [url])
  return { data, error, loading: fetching && data === undefined, fetching, refetch }
}
