/**
 * Native IndexedDB store backing offline mode: a generic URL-keyed cache of
 * GET responses (repertoire, sets, practice queue, tunes all flow through
 * this — doFetch doesn't need per-domain routing to cache them), plus the
 * pending/failed mutation queues.
 */
import { Signal } from '../state/appState'

const DB_NAME = 'sessionapp_offline_db'
const DB_VERSION = 1
const HTTP_CACHE_STORE = 'httpCache'
const PENDING_STORE = 'pendingMutations'
const FAILED_STORE = 'failedMutations'

export interface PendingMutation {
  id: string
  timestamp: number
  url: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: string
  description: string
  mutationType: 'practice_log' | 'repertoire_patch' | 'set_mutation' | 'other'
}

export interface FailedMutation extends PendingMutation {
  failedAt: number
  statusCode: number
  errorDetail: string
}

/** Live count of queued-but-not-yet-synced mutations, for the status banner. */
export const pendingCount = new Signal(0)

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(HTTP_CACHE_STORE)) {
          db.createObjectStore(HTTP_CACHE_STORE, { keyPath: 'url' })
        }
        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          db.createObjectStore(PENDING_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(FAILED_STORE)) {
          db.createObjectStore(FAILED_STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function refreshPendingCount(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(PENDING_STORE, 'readonly')
    const count = await reqToPromise(tx.objectStore(PENDING_STORE).count())
    pendingCount.value = count
  } catch {
    // IndexedDB unavailable — leave the last-known count as-is.
  }
}
void refreshPendingCount()

// --- GET response cache ---

export async function getCachedResponse<T>(url: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    const tx = db.transaction(HTTP_CACHE_STORE, 'readonly')
    const entry = await reqToPromise(tx.objectStore(HTTP_CACHE_STORE).get(url)) as
      | { url: string; body: T; cachedAt: number }
      | undefined
    return entry?.body
  } catch {
    return undefined
  }
}

export async function cachePutResponse(url: string, body: unknown): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(HTTP_CACHE_STORE, 'readwrite')
    tx.objectStore(HTTP_CACHE_STORE).put({ url, body, cachedAt: Date.now() })
    await txDone(tx)
  } catch {
    // Best-effort — a failed cache write shouldn't break the live request.
  }
}

/**
 * Merges `patch` into any cached GET response that represents this
 * repertoire item — the singular item cache entry, any paged repertoire
 * list, and the practice queue array — so offline views reflect the change
 * immediately without a round trip. Returns the merged singular item, if one
 * was cached, for use as the mutation's optimistic return value.
 */
export async function patchCachedRepertoireItem(
  itemUrl: string,
  userTuneId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  try {
    const db = await openDb()
    const tx = db.transaction(HTTP_CACHE_STORE, 'readwrite')
    const store = tx.objectStore(HTTP_CACHE_STORE)
    let mergedItem: Record<string, unknown> | undefined

    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) {
          resolve()
          return
        }
        const entry = cursor.value as { url: string; body: unknown; cachedAt: number }
        let body = entry.body
        let changed = false

        if (entry.url === itemUrl && body && typeof body === 'object' && !Array.isArray(body)) {
          body = { ...(body as Record<string, unknown>), ...patch }
          mergedItem = body as Record<string, unknown>
          changed = true
        } else if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
          const items = (body as { items: Array<Record<string, unknown>> }).items
          const idx = items.findIndex((it) => it.userTuneId === userTuneId)
          if (idx !== -1) {
            const newItems = items.slice()
            newItems[idx] = { ...newItems[idx], ...patch }
            body = { ...(body as Record<string, unknown>), items: newItems }
            changed = true
          }
        } else if (Array.isArray(body)) {
          const arr = body as Array<Record<string, unknown>>
          const idx = arr.findIndex((it) => it.userTuneId === userTuneId)
          if (idx !== -1) {
            const newArr = arr.slice()
            newArr[idx] = { ...newArr[idx], ...patch }
            body = newArr
            changed = true
          }
        }

        if (changed) {
          cursor.update({ ...entry, body })
        }
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })

    await txDone(tx)
    return mergedItem
  } catch {
    return undefined
  }
}

// --- Mutation queue ---

export async function queuePendingMutation(mutation: PendingMutation): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(PENDING_STORE, 'readwrite')
  tx.objectStore(PENDING_STORE).put(mutation)
  await txDone(tx)
  await refreshPendingCount()
}

export async function getPendingMutations(): Promise<PendingMutation[]> {
  try {
    const db = await openDb()
    const tx = db.transaction(PENDING_STORE, 'readonly')
    const all = await reqToPromise(tx.objectStore(PENDING_STORE).getAll())
    return all as PendingMutation[]
  } catch {
    return []
  }
}

export async function deletePendingMutation(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(PENDING_STORE, 'readwrite')
  tx.objectStore(PENDING_STORE).delete(id)
  await txDone(tx)
  await refreshPendingCount()
}

export async function moveToFailedMutation(
  mutation: PendingMutation,
  statusCode: number,
  errorDetail: string,
): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([PENDING_STORE, FAILED_STORE], 'readwrite')
  tx.objectStore(PENDING_STORE).delete(mutation.id)
  tx.objectStore(FAILED_STORE).put({ ...mutation, failedAt: Date.now(), statusCode, errorDetail } satisfies FailedMutation)
  await txDone(tx)
  await refreshPendingCount()
}

export async function getFailedMutations(): Promise<FailedMutation[]> {
  try {
    const db = await openDb()
    const tx = db.transaction(FAILED_STORE, 'readonly')
    const all = await reqToPromise(tx.objectStore(FAILED_STORE).getAll())
    return all as FailedMutation[]
  } catch {
    return []
  }
}
