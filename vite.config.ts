import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    // 확장 프로그램 빌드: dist-ext / 웹 빌드: dist
    outDir: mode === 'extension' ? 'dist-ext' : 'dist',
  },
}))
