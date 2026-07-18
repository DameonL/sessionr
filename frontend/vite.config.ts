import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    // In production, Azure Static Web Apps proxies /api to the Functions app.
    // Locally, forward /api to the Functions host started with `func start`.
    proxy: {
      '/api': 'http://localhost:7071',
    },
  },
})
