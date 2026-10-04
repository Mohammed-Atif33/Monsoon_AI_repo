import { qs } from '../services/api'
import type {
  Bulletin, DataQuality, Dashboard, DistrictDetail, ForecastList, HeavyRainfall, ModelInfo, RegimeDetail, RegimesView, RegimeWise, SystemInfo, UploadSpec, Verification,
} from '../types/api'
import { useApi } from './useApi'
import { useApp } from './useApp'

/** Append extra params to a context query string ("?a=1" or ""). */
export const withQ = (q: string, extra: Record<string, string | number | boolean | null | undefined>): string => {
  const add = qs(extra).replace(/^\?/, '')
  return add ? `${q}${q ? '&' : '?'}${add}` : q
}

export const useDashboard = () => useApi<Dashboard>(`/dashboard${useApp().q}`)
export const useForecast = () => useApi<ForecastList>(`/forecast${useApp().q}`)
export function useDistrict(id: string | null) {
  const { q } = useApp()
  return useApi<DistrictDetail>(id ? `/forecast/${encodeURIComponent(id)}${q}` : null)
}
export const useRegimes = () => useApi<RegimesView>(`/regimes${useApp().q}`)
export function useRegimeDetail(id: string | null) {
  const { q } = useApp()
  return useApi<RegimeDetail>(id ? `/regimes/${encodeURIComponent(id)}${q}` : null)
}
export const useHeavy = () => useApi<HeavyRainfall>(`/heavy-rainfall${useApp().q}`)
export const useBulletin = () => useApi<Bulletin>(`/bulletin${useApp().q}`)
export const useDataQuality = () => useApi<DataQuality>(`/data-quality${useApp().q}`)
export const useModelInfo = () => useApi<ModelInfo>('/model-info')
export const useSystemInfo = () => useApi<SystemInfo>('/system-info')
export const useUploadSpec = () => useApi<UploadSpec>('/upload-spec')

export function useVerification(scope: 'scenario' | 'validation', threshold: number, allLeads: boolean) {
  const { q } = useApp()
  return useApi<Verification>(`/verification${withQ(q, { scope, threshold, all_leads: allLeads })}`)
}
export function useRegimeWise(scope: 'scenario' | 'validation', threshold: number) {
  const { scenario, seed } = useApp()
  return useApi<RegimeWise>(`/verification/regime-wise${qs({ scope, threshold, scenario: scope === 'scenario' ? scenario : undefined, seed })}`)
}
