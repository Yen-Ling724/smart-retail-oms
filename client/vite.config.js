import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 開發時把 /api 開頭的請求轉給本機後端（server/，預設 port 3001；API_PROXY 可改成別的，例如測試用後端）
    proxy: {
      '/api': process.env.API_PROXY || 'http://localhost:3001',
    },
  },
})
