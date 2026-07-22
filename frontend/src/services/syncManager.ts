/**
 * Replays queued offline mutations once connectivity (and a valid auth
 * token) is available again. Triggered by the browser 'online' event, a
 * manual "Sync Now" click, or a 60s periodic timer — the periodic timer is
 * the backstop for a 5xx/network error that isn't accompanied by an actual
 * connectivity transition, since 'online' won't fire again in that case.
 */
import { Signal, authStatus, getBearerToken, showToast } from '../state/appState'
import { queryClient } from './queryClient'
import {
  deletePendingMutation,
  getPendingMutations,
  moveToFailedMutation,
  type PendingMutation,
} from './offlineDb'

const RETRY_DELAYS_MS = [5000, 15000, 30000]
const PERIODIC_INTERVAL_MS = 60000

export const isSyncing = new Signal(false)
export const authRequired = new Signal(false)

let initialized = false
let syncRunning = false

export function initSyncManager(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  window.addEventListener('online', () => {
    void runSync()
  })

  setInterval(() => {
    if (navigator.onLine) void runSync()
  }, PERIODIC_INTERVAL_MS)

  // Don't attempt the first sync until AuthProvider's own MSAL bootstrap has
  // settled. Firing getBearerToken concurrently with the app's own initial
  // acquireTokenSilent call (which happens on every cold load) makes MSAL
  // throw block_iframe_reload — it only allows one hidden-iframe silent
  // renewal in flight at a time.
  const attemptInitialSync = () => {
    if (navigator.onLine) void runSync()
  }
  if (authStatus.value !== 'pending') {
    attemptInitialSync()
  } else {
    const unsubscribe = authStatus.subscribe((status) => {
      if (status === 'pending') return
      unsubscribe()
      attemptInitialSync()
    })
  }
}

export async function triggerSync(): Promise<void> {
  await runSync()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runSync(): Promise<void> {
  if (syncRunning) return
  syncRunning = true
  isSyncing.value = true
  try {
    const mutations = await getPendingMutations()
    if (mutations.length === 0) {
      return
    }

    // Non-forcing: the shared helper already checks the cached token's
    // expiry and only falls through to a live acquireTokenSilent call (with
    // its own internal forceRefresh escalation) when actually needed —
    // forcing unconditionally here is what caused the concurrent-iframe
    // collision above.
    const token = await getBearerToken(false)
    if (!token) {
      authRequired.value = true
      showToast(
        `Signed out — sign in to sync ${mutations.length} offline change${mutations.length === 1 ? '' : 's'}.`,
        'info',
      )
      return
    }
    authRequired.value = false

    const ordered = mutations.slice().sort((a, b) => a.timestamp - b.timestamp)
    let succeeded = 0
    for (const mutation of ordered) {
      if (await replayMutation(mutation, token)) succeeded++
    }

    if (succeeded > 0) {
      queryClient.invalidateQueries()
      showToast(`Synced ${succeeded} offline change${succeeded === 1 ? '' : 's'}.`, 'success')
    }
  } finally {
    isSyncing.value = false
    syncRunning = false
  }
}

/**
 * Replays a single mutation, retrying 5xx/network failures with backoff.
 * A mutation that keeps failing only gives up on itself for this cycle —
 * it does NOT block the rest of the queue — so one stuck item can't strand
 * unrelated pending changes behind it.
 */
async function replayMutation(mutation: PendingMutation, token: string): Promise<boolean> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(mutation.url, {
        method: mutation.method,
        headers: {
          ...(mutation.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
        },
        body: mutation.body,
      })

      if (res.ok) {
        await deletePendingMutation(mutation.id)
        return true
      }

      if (res.status >= 400 && res.status < 500) {
        const detail = await res.text().catch(() => '')
        await moveToFailedMutation(mutation, res.status, detail || res.statusText)
        showToast(`"${mutation.description}" couldn't be applied (${res.status}) and was skipped.`, 'error')
        return false
      }

      // 5xx — worth retrying within this cycle before giving up on it.
      if (attempt < RETRY_DELAYS_MS.length) {
        await delay(RETRY_DELAYS_MS[attempt])
        continue
      }
      return false
    } catch {
      // Network dropped mid-replay. Stop retrying this mutation for this
      // cycle; the next online event, periodic tick, or manual sync will
      // pick the whole queue back up, this item included.
      return false
    }
  }
  return false
}
