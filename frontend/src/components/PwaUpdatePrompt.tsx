"use client";

import { useRegisterSW } from 'virtual:pwa-register/react'

// Caches written by the old hand-rolled public/sw.js, which bumped this name by hand
// ('sessionapp-cache-v1' ... '-v4'). Workbox's cleanupOutdatedCaches only removes its own
// 'workbox-precache-*' entries, so without this these would linger forever. The soundfont
// cache is deliberately NOT matched — it is still in use, see the runtimeCaching route in
// vite.config.ts and preloadOfflineData() in services/offlineWarming.ts.
const LEGACY_CACHE_PREFIX = 'sessionapp-cache-'

async function deleteLegacyCaches() {
  if (!('caches' in window)) return
  try {
    const names = await caches.keys()
    await Promise.all(
      names.filter((n) => n.startsWith(LEGACY_CACHE_PREFIX)).map((n) => caches.delete(n))
    )
  } catch {
    // Best effort — a failure here only costs disk, never correctness.
  }
}

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Only reclaim the old caches once the new worker is the one in control. While a
      // worker is waiting, the previous sw.js is still serving the page's assets out of
      // sessionapp-cache-vN, and pulling that out from under a live session would break it.
      if (registration?.active && !registration.waiting && navigator.serviceWorker.controller) {
        void deleteLegacyCaches()
      }
    },
    onRegisterError(err) {
      console.error('PWA service worker registration failed:', err)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="pwa-update-prompt" role="status">
      <span className="pwa-update-text">A new version of sessionr is available.</span>
      <button className="btn-sm" onClick={() => { void updateServiceWorker(true) }}>
        Reload
      </button>
      <button className="secondary btn-sm" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  )
}
