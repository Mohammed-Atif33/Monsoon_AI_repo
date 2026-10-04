import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The FastAPI backend runs on :8010 (port 8000 is commonly taken on dev machines).
const BACKEND = process.env.MONSOON_BACKEND ?? 'http://127.0.0.1:8010'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': { target: BACKEND, changeOrigin: true } } },
  preview: { port: 4173, proxy: { '/api': { target: BACKEND, changeOrigin: true } } },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'], map: ['leaflet', 'react-leaflet'] } } },
  },
})
