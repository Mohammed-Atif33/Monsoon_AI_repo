import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { BackendGate } from './components/BackendGate'
import { EmptyState, Spinner } from './components/ui'
import { AppProvider } from './hooks/useApp'
import { AppLayout } from './layouts/AppLayout'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const ForecastMap = lazy(() => import('./pages/ForecastMap'))
const Regimes = lazy(() => import('./pages/Regimes'))
const Districts = lazy(() => import('./pages/Districts'))
const PostProcessing = lazy(() => import('./pages/PostProcessing'))
const HeavyRainfall = lazy(() => import('./pages/HeavyRainfall'))
const Verification = lazy(() => import('./pages/Verification'))
const DataQuality = lazy(() => import('./pages/DataQuality'))
const Upload = lazy(() => import('./pages/Upload'))
const Models = lazy(() => import('./pages/Models'))
const System = lazy(() => import('./pages/System'))

const Loading = () => <div className="grid place-items-center h-64"><Spinner className="w-6 h-6" /></div>

export default function App() {
  return (
    <BackendGate>
      <AppProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="map" element={<ForecastMap />} />
              <Route path="regimes" element={<Regimes />} />
              <Route path="districts" element={<Districts />} />
              <Route path="post-processing" element={<PostProcessing />} />
              <Route path="heavy-rainfall" element={<HeavyRainfall />} />
              <Route path="verification" element={<Verification />} />
              <Route path="data-quality" element={<DataQuality />} />
              <Route path="upload" element={<Upload />} />
              <Route path="models" element={<Models />} />
              <Route path="system" element={<System />} />
              <Route path="*" element={<EmptyState title="Page not found" hint="Use the navigation on the left." />} />
            </Route>
          </Routes>
        </Suspense>
      </AppProvider>
    </BackendGate>
  )
}
