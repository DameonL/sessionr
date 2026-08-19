import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'next/link': path.resolve(__dirname, './src/utils/nextCompat.tsx'),
      'next/navigation': path.resolve(__dirname, './src/utils/nextCompat.tsx'),
      'next/dynamic': path.resolve(__dirname, './src/utils/nextCompat.tsx'),
      'next/image': path.resolve(__dirname, './src/utils/nextCompat.tsx'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/public': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/public/, '/api'),
      },
      '/api': {
        target: 'http://localhost:7072',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
