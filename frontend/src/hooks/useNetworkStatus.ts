"use client";

import { useEffect, useState } from 'react'
import { useSignal } from '../state/appState'
import { isApiOffline as isApiOfflineSignal } from '../services/api'
import { pendingCount as pendingCountSignal } from '../services/offlineDb'
import { isSyncing as isSyncingSignal, authRequired as authRequiredSignal, triggerSync } from '../services/syncManager'

export function useNetworkStatus() {
  // Must start `true` (matching what SSR renders, since `navigator` doesn't
  // exist on the server) rather than reading navigator.onLine here — doing
  // that would make the very first client render disagree with the
  // server-rendered markup whenever the page is opened while offline, which
  // is exactly the scenario this hook exists for, and React would throw a
  // hydration-mismatch error over it. The real value is applied post-mount
  // below instead, same as NavBar's own `mounted` gate for auth state.
  const [isBrowserOnline, setIsBrowserOnline] = useState(true)
  const isApiOffline = useSignal(isApiOfflineSignal)

  useEffect(() => {
    setIsBrowserOnline(navigator.onLine)
    const goOnline = () => setIsBrowserOnline(true)
    const goOffline = () => setIsBrowserOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const isOnline = isBrowserOnline && !isApiOffline
  const pendingCount = useSignal(pendingCountSignal)
  const isSyncing = useSignal(isSyncingSignal)
  const authRequired = useSignal(authRequiredSignal)

  return { isOnline, pendingCount, isSyncing, authRequired, triggerSync }
}
