/**
 * Typed client for the Functions backend.
 * Azure Static Web Apps automatically proxies /api to the linked Functions app;
 * in local dev the Vite proxy (see vite.config.ts) forwards it to port 7071.
 */
const API_BASE = '/api'

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(detail || `API ${res.status}: ${res.statusText}`)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

/**
 * Server timestamps are UTC but don't always carry the Z suffix (depends on
 * how the value round-tripped through the database), so normalize on parse.
 */
export function parseServerDate(value: string): Date {
  const hasZone = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)
  return new Date(hasZone ? value : `${value}Z`)
}

/** Display form of a TuneType enum name: "SlipJig" -> "Slip Jig". */
export function formatTuneType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function isToday(value: string): boolean {
  return parseServerDate(value).toDateString() === new Date().toDateString()
}

// --- Types (mirror the backend DTOs) ---

export interface TuneSummary {
  tuneId: number
  title: string
  tuneType: string
  key: string
}

export interface RepertoireItem {
  userTuneId: number
  tuneId: number
  title: string
  tuneType: string
  key: string
  status: string
  lastPracticed: string | null
  targetBpm: number | null
  abc: string
  hasCustomAbc: boolean
}

export interface PracticeQueueItem {
  userTuneId: number
  title: string
  tuneType: string
  key: string
  status: string
  lastPracticed: string | null
  targetBpm: number | null
  abc: string
  reason: string
}

export interface KeyTransition {
  fromTitle: string
  toTitle: string
  fromKey: string
  toKey: string
  fifthsApart: number
  label: string
}

export interface SetAnalysis {
  totalSeconds: number
  totalPlaytime: string
  transitions: KeyTransition[]
}

export interface SetItem {
  userTuneId: number
  sequenceNumber: number
  repetitions: number
  title: string
  tuneType: string
  key: string
  abc: string
}

export interface SaveSetItem {
  userTuneId: number
  repetitions: number
}

export interface TuneSet {
  setId: number
  title: string
  items: SetItem[]
  analysis: SetAnalysis
}

export const TUNE_STATUSES = ['Wishlist', 'Learning', 'Active', 'Rusty', 'Retired'] as const

export const TUNE_TYPES = [
  'Reel', 'Jig', 'SlipJig', 'Hornpipe', 'Polka', 'Slide', 'Waltz',
  'March', 'Strathspey', 'Barndance', 'Mazurka', 'Air', 'Other',
] as const

// --- Endpoints ---

export const searchTunes = (search: string, type?: string) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (type) params.set('type', type)
  return apiFetch<TuneSummary[]>(`/tunes?${params}`)
}

export const createTune = (tune: { title: string; tuneType: string; key: string; abc: string }) =>
  apiFetch<TuneSummary>('/tunes', { method: 'POST', body: JSON.stringify(tune) })

export interface TheSessionResult {
  theSessionId: number
  name: string
  type: string
}

export const searchTheSession = (q: string) =>
  apiFetch<TheSessionResult[]>(`/import/thesession/search?q=${encodeURIComponent(q)}`)

export const importFromTheSession = (theSessionId: number) =>
  apiFetch<TuneSummary>('/import/thesession', {
    method: 'POST',
    body: JSON.stringify({ theSessionId }),
  })

export interface TunebookImportResult {
  totalFound: number
  imported: number
  addedToRepertoire: number
  alreadyInRepertoire: number
  failures: string[]
}

export const importTunebook = (userId: number, memberId: string) =>
  apiFetch<TunebookImportResult>('/import/thesession/tunebook', {
    method: 'POST',
    body: JSON.stringify({ userId, memberId: Number(memberId) }),
  })

export const getRepertoire = (userId: number) =>
  apiFetch<RepertoireItem[]>(`/repertoire/${userId}`)

export const addToRepertoire = (userId: number, tuneId: number) =>
  apiFetch<RepertoireItem>(`/repertoire/${userId}`, {
    method: 'POST',
    body: JSON.stringify({ tuneId }),
  })

export const updateUserTune = (
  userTuneId: number,
  patch: { status?: string; targetBpm?: number; customAbcText?: string },
) =>
  apiFetch<RepertoireItem>(`/repertoire/items/${userTuneId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const logPractice = (userTuneId: number) =>
  apiFetch<{ userTuneId: number; lastPracticed: string }>(
    `/repertoire/items/${userTuneId}/practiced`,
    { method: 'POST' },
  )

export const removeFromRepertoire = (userTuneId: number) =>
  apiFetch<void>(`/repertoire/items/${userTuneId}`, { method: 'DELETE' })

export const getPracticeQueue = (userId: number) =>
  apiFetch<PracticeQueueItem[]>(`/practice/${userId}/queue`)

export interface NextTuneSuggestion {
  userTuneId: number
  title: string
  tuneType: string
  key: string
  status: string
  score: number
  reason: string
}

export const suggestNextTune = (userId: number, userTuneIds: number[]) =>
  apiFetch<NextTuneSuggestion[]>(`/users/${userId}/sets/suggest`, {
    method: 'POST',
    body: JSON.stringify({ userTuneIds }),
  })

export const getSets = (userId: number) => apiFetch<TuneSet[]>(`/users/${userId}/sets`)

export const getSet = (setId: number) => apiFetch<TuneSet>(`/sets/${setId}`)

export const createSet = (userId: number, title: string, items: SaveSetItem[]) =>
  apiFetch<TuneSet>(`/users/${userId}/sets`, {
    method: 'POST',
    body: JSON.stringify({ title, items }),
  })

export const updateSet = (setId: number, title: string, items: SaveSetItem[]) =>
  apiFetch<TuneSet>(`/sets/${setId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, items }),
  })

export const deleteSet = (setId: number) =>
  apiFetch<void>(`/sets/${setId}`, { method: 'DELETE' })
