/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': a session may be holding queued offline
      // mutations, so the swap is offered by PwaUpdatePrompt instead of happening under it.
      registerType: 'prompt',
      // Registration lives in src/components/PwaUpdatePrompt.tsx via virtual:pwa-register/react,
      // so no separate registerSW.js needs to ship.
      injectRegister: null,
      manifest: {
        name: 'sessionr',
        short_name: 'sessionr',
        description:
          'Mobile-first PWA for traditional musicians: repertoire, practice, and session set management.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Matches the real --bg token in src/index.css, not the old slate-900 value.
        background_color: '#121212',
        theme_color: '#121212',
        icons: [
          { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // 404.html and staticwebapp.config.json are server-side artifacts, not app shell.
        globIgnores: ['**/favicon.svg', '**/404.html', '**/staticwebapp.config.json'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/404\.html$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Shares its cache name with preloadOfflineData() in src/services/offlineWarming.ts,
            // so user-initiated warming and SW lookups hit the same entries. No expiration
            // plugin: these are deliberately long-lived.
            urlPattern: ({ url }) =>
              url.hostname === 'paulrosen.github.io' || url.pathname.includes('-mp3/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sessionapp-soundfont-v1',
              matchOptions: { ignoreSearch: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Intentionally NO route for api-private/api-public.sessionr.org. Workbox only
          // intercepts requests that match a registered route, so API calls fall through to
          // the network untouched. All /api/* offline behaviour lives in the JS layer
          // (services/offlineDb.ts + api.ts + syncManager.ts), and private-API responses are
          // per-user and bearer-authenticated so they must never reach shared Cache Storage.
          // Do not add a NetworkOnly route "for clarity" -- it would wrap api.ts's fetches,
          // which carry their own AbortController timeout, for no benefit.
        ],
      },
      // Keep the SW out of `vite dev`, where the proxy serves the two local Functions apps.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
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
  test: {
    // jsdom rather than node: several of the services under test touch localStorage or window
    // at module scope, so they cannot even be imported in a bare node environment.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
