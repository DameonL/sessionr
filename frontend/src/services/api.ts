/**
 * Typed client for the two Functions backends: the Private API (personal data
 * and mutations) and the Public API (anonymous-friendly reads + community
 * contributions). Azure Static Web Apps / the local Next.js dev proxy route
 * "/api/*" to the Public Functions app and everything else in "/api/*"
 * to the Private one (see next.config.ts).
 */
import { Signal, getBearerToken, showToast } from '../state/appState'
import {
  cachePutResponse,
  getCachedResponse,
  patchCachedRepertoireItem,
  queuePendingMutation,
  type PendingMutation,
} from './offlineDb'
import { triggerSync } from './syncManager'

const API_BASE = 'https://api-private.sessionr.org/api/'
const PUBLIC_API_BASE = 'https://api-public.sessionr.org/api/'

// Hard ceiling on any single request. Without it a stalled connection (e.g. a
// slow /users/me) leaves callers — including the "Completing sign-in" modal —
// hanging indefinitely. A timed-out request is routed through the same
// unreachable/offline path as a dropped connection.
const REQUEST_TIMEOUT_MS = 20000

export const isApiOffline = new Signal(false)

let usersMeRetryTimer: ReturnType<typeof setInterval> | null = null

export async function checkUsersMeHealth(): Promise<boolean> {
  try {
    const token = await getBearerToken(false)
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const cleanBase = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const res = await fetch(`${cleanBase}/users/me`, {
      method: 'GET',
      headers,
    })

    if (res.ok) {
      if (isApiOffline.value) {
        isApiOffline.value = false
        if (usersMeRetryTimer) {
          clearInterval(usersMeRetryTimer)
          usersMeRetryTimer = null
        }
        void triggerSync()
      } else if (usersMeRetryTimer) {
        clearInterval(usersMeRetryTimer)
        usersMeRetryTimer = null
      }
      return true
    } else {
      markApiOfflineAndScheduleRetry()
      return false
    }
  } catch {
    markApiOfflineAndScheduleRetry()
    return false
  }
}

function markApiOfflineAndScheduleRetry(): void {
  isApiOffline.value = true
  if (!usersMeRetryTimer) {
    usersMeRetryTimer = setInterval(() => {
      void checkUsersMeHealth()
    }, 2 * 60 * 1000)
  }
}

async function doFetch<T>(base: string, path: string, init?: RequestInit, isRetry = false, opts?: { skipOfflineQueue?: boolean }): Promise<T> {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const url = `${cleanBase}${cleanPath}`
  const method = (init?.method ?? 'GET').toUpperCase()

  const isPrivateApi = cleanBase === (API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE)
  const isUsersMeCheck = isPrivateApi && (cleanPath === '/users/me' || cleanPath === 'users/me') && method === 'GET'

  // Content-Type: application/json isn't a CORS-safelisted header, so sending it
  // unconditionally forces a preflight (OPTIONS) round trip on every single cross-origin
  // call, even bodiless GETs. Only set it when there's actually a JSON body to describe —
  // anonymous/public GETs with no Authorization header then qualify as CORS-simple requests
  // and skip preflight entirely.
  const headers: Record<string, string> = {
    'X-Timezone-Offset': String(new Date().getTimezoneOffset()),
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...init?.headers as Record<string, string>,
  }

  let token: string | null = null
  try {
    token = await getBearerToken(isRetry)
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  } catch (err) {
    console.error('Failed to get bearer token', err)
  }

  // Private API endpoints require a verified token. If no token is available,
  // do not fire an unauthenticated request to the private backend (which will
  // return 401 and trigger false offline checks).
  if (isPrivateApi && !token) {
    if (isUsersMeCheck) {
      return null as unknown as T
    }
    throw new UnauthenticatedError('Sign in required for this action.')
  }

  // Skip straight to the offline path rather than waiting on a fetch that's
  // certain to fail — navigator.onLine is false only when the browser is
  // confident there's no connectivity at all. Also check isApiOffline.
  const knownOffline = typeof navigator !== 'undefined' && !navigator.onLine
  const isOffline = knownOffline || (isApiOffline.value && !isUsersMeCheck)

  let res: Response
  if (!isOffline) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      res = await fetch(url, { headers, ...init, signal: controller.signal })
    } catch (err) {
      // A thrown fetch means the request never reached a server (DNS/CORS/
      // dropped connection) — as opposed to an HTTP error status below,
      // which the backend actually responded to and shouldn't be treated
      // as "offline". An AbortError is our own timeout firing: treat a stalled
      // request the same as unreachable so callers can't hang forever.
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      if (!isTimeout && !(err instanceof TypeError)) throw err
      if (isPrivateApi) {
        void checkUsersMeHealth()
      }
      return handleUnreachable<T>(method, url, path, init)
    } finally {
      clearTimeout(timer)
    }
  } else {
    return handleUnreachable<T>(method, url, path, init)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 401 && !isRetry) {
      console.warn('401 Unauthorized or expired token received, attempting token refresh and retry...')
      return doFetch<T>(base, path, init, true, opts)
    }

    if (isPrivateApi && method !== 'GET' && !opts?.skipOfflineQueue) {
      void checkUsersMeHealth()
      return queueOfflineMutation<T>(method, url, path, init)
    }

    throw new Error(detail || `API ${res.status}: ${res.statusText}`)
  }

  let data: T
  if (res.status === 204) {
    data = undefined as T
  } else {
    const text = await res.text()
    data = (!text || !text.trim()) ? (undefined as T) : (JSON.parse(text) as T)
  }

  if (method === 'GET') {
    void cachePutResponse(url, data)
  }
  return data
}

async function handleUnreachable<T>(method: string, url: string, path: string, init?: RequestInit): Promise<T> {
  if (method === 'GET') {
    const cached = await getCachedResponse<T>(url)
    if (cached !== undefined) return cached
    throw new Error('You appear to be offline, and no cached data is available for this yet.')
  }
  return queueOfflineMutation<T>(method, url, path, init)
}

function classifyMutation(method: string, path: string): { mutationType: PendingMutation['mutationType']; description: string } {
  if (method === 'POST' && /\/repertoire\/items\/[^/]+\/practiced$/.test(path)) {
    return { mutationType: 'practice_log', description: 'Practice log' }
  }
  if ((method === 'PATCH' || method === 'DELETE') && /\/repertoire\/items\/[^/]+$/.test(path)) {
    return { mutationType: 'repertoire_patch', description: method === 'DELETE' ? 'Repertoire removal' : 'Repertoire update' }
  }
  if (path.startsWith('/sets')) {
    return { mutationType: 'set_mutation', description: 'Set change' }
  }
  return { mutationType: 'other', description: `${method} ${path}` }
}

export class UnauthenticatedError extends Error {
  unauthenticated = true
  constructor(message = 'Sign in required for this action.') {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}

/** Marks a mutation as caught by the offline queue rather than genuinely failed. */
export class OfflineQueuedError extends Error {
  offlineQueued = true
  constructor(description: string) {
    super(`${description} — queued offline, will sync when back online.`)
    this.name = 'OfflineQueuedError'
  }
}

async function queueOfflineMutation<T>(method: string, url: string, path: string, init?: RequestInit): Promise<T> {
  const { mutationType, description } = classifyMutation(method, path)
  const mutation: PendingMutation = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    url,
    method: method as PendingMutation['method'],
    body: typeof init?.body === 'string' ? init.body : undefined,
    description,
    mutationType,
  }
  await queuePendingMutation(mutation)

  // Practice logs and repertoire patches are the two flows with a defined
  // optimistic-success shape, so those return real data instead of erroring —
  // everything else (sets, groups, tune contributions, ...) is still safely
  // queued for replay, but doFetch can't fabricate a type-correct response
  // for every endpoint shape, so those surface as a catchable OfflineQueuedError.
  if (mutationType === 'practice_log') {
    const userTuneId = /\/repertoire\/items\/([^/]+)\/practiced$/.exec(path)?.[1]
    if (userTuneId) {
      const lastPracticed = new Date().toISOString()
      const itemUrl = url.replace(/\/practiced$/, '')
      await patchCachedRepertoireItem(itemUrl, userTuneId, { lastPracticed })
      showToast('Practice logged offline. Will sync when back online.', 'info')
      return { userTuneId, lastPracticed } as unknown as T
    }
  }

  if (mutationType === 'repertoire_patch' && method === 'PATCH') {
    const userTuneId = /\/repertoire\/items\/([^/]+)$/.exec(path)?.[1]
    if (userTuneId && typeof init?.body === 'string') {
      const patch = JSON.parse(init.body) as Record<string, unknown>
      const merged = await patchCachedRepertoireItem(url, userTuneId, patch)
      if (merged) {
        showToast('Change saved offline. Will sync when back online.', 'info')
        return merged as unknown as T
      }
    }
  }

  showToast(`${description} queued offline. Will sync when back online.`, 'info')
  throw new OfflineQueuedError(description)
}

/** Calls the Private API (personal data, mutations). */
export const apiFetch = <T>(path: string, init?: RequestInit, opts?: { skipOfflineQueue?: boolean }) =>
  doFetch<T>(API_BASE, path, init, false, opts)

/** Calls the Public API (anonymous-friendly reads + community contributions). */
export const apiFetchPublic = <T>(path: string, init?: RequestInit) => doFetch<T>(PUBLIC_API_BASE, path, init)

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
// IDs are UUID strings, except thesession.org's own numeric IDs (TheSessionResult,
// importFromTheSession, tunebook member IDs), which are that external system's IDs.

export interface TuneSummary {
  tuneId: string
  title: string
  tuneType: string
  key: string
}

export interface TuneSetting {
  tuneSettingId: string
  key: string
  abcText: string
  submitterName: string
  voteScore: number
  userVoteValue: number // -1, 0, or 1
}

export interface TuneDetails {
  tuneId: string
  title: string
  tuneType: string
  key: string
  aliases: string[]
  settings: TuneSetting[]
}

export interface RepertoireItem {
  userTuneId: string
  tuneId: string
  title: string
  tuneType: string
  key: string
  status: string
  lastPracticed: string | null
  targetBpm: number | null
  abc: string
  abcText?: string
  hasCustomAbc: boolean
}

/** Lightweight repertoire row for the scrolling list — no ABC. Fetch getRepertoireItem for that. */
export interface RepertoireListItem {
  userTuneId: string
  tuneId: string
  title: string
  tuneType: string
  key: string
  status: string
  lastPracticed: string | null
  targetBpm: number | null
}

export interface PracticeQueueItem {
  userTuneId: string
  title: string
  tuneType: string
  key: string
  status: string
  lastPracticed: string | null
  targetBpm: number | null
  abc: string
  abcText?: string
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
  userTuneId: string
  sequenceNumber: number
  repetitions: number
  title: string
  tuneType: string
  key: string
  abc: string
}

export interface SaveSetItem {
  userTuneId: string
  repetitions: number
}

export interface TuneSet {
  setId: string
  title: string
  items: SetItem[]
  analysis: SetAnalysis
}

// Lightweight set row for the list view — no ABC payload. Fetch the singular set (getSet) for that.
export interface SetItemSummary {
  userTuneId: string
  sequenceNumber: number
  repetitions: number
  title: string
  tuneType: string
  key: string
}

export interface TuneSetSummary {
  setId: string
  title: string
  items: SetItemSummary[]
  analysis: SetAnalysis
}

export const TUNE_STATUSES = ['Wishlist', 'Learning', 'Active', 'Rusty', 'Retired'] as const

export const TUNE_TYPES = [
  'Reel', 'Jig', 'SlipJig', 'Hornpipe', 'Polka', 'Slide', 'Waltz',
  'March', 'Strathspey', 'Barndance', 'Mazurka', 'Air', 'Other',
] as const

export function getDefaultTargetBpm(tuneType: string): number {
  switch (tuneType) {
    case 'Reel':
    case 'Jig':
    case 'SlipJig':
    case 'Waltz':
    case 'Mazurka':
    case 'Other':
    default:
      return 110
    case 'Hornpipe':
    case 'March':
      return 90
    case 'Polka':
      return 115
    case 'Slide':
      return 120
    case 'Strathspey':
      return 80
    case 'Barndance':
      return 95
    case 'Air':
      return 60
  }
}

// --- Endpoints ---

export interface PagedResult<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}

export const searchTunes = (search: string, type?: string, page = 1, pageSize = 20) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (type) params.set('type', type)
  params.set('page', page.toString())
  params.set('pageSize', pageSize.toString())
  return apiFetchPublic<PagedResult<TuneSummary>>(`/tunes?${params}`)
}

export const createTune = (tune: { title: string; tuneType: string; key: string; abc: string }) =>
  apiFetch<TuneSummary>('/tunes', { method: 'POST', body: JSON.stringify(tune) })

/** thesession.org's own numeric tune ID — not one of our UUIDs. */
export interface TheSessionResult {
  theSessionId: number
  name: string
  type: string
}

export const searchTheSession = (q: string) =>
  apiFetchPublic<TheSessionResult[]>(`/import/thesession/search?q=${encodeURIComponent(q)}`)

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

export const importTunebook = (memberId: string) =>
  apiFetch<TunebookImportResult>('/import/thesession/tunebook', {
    method: 'POST',
    body: JSON.stringify({ memberId: Number(memberId) }),
  })

export const getRepertoire = (search?: string, type?: string, status?: string, page = 1, pageSize = 20) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (type) params.set('type', type)
  if (status) params.set('status', status)
  params.set('page', page.toString())
  params.set('pageSize', pageSize.toString())
  return apiFetch<PagedResult<RepertoireItem>>(`/repertoire?${params}`)
}

/** Lightweight rows (no ABC) for the scrolling Repertoire list — call getRepertoireItem for detail. */
export const getRepertoireList = (search?: string, type?: string, status?: string, page = 1, pageSize = 20) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (type) params.set('type', type)
  if (status) params.set('status', status)
  params.set('page', page.toString())
  params.set('pageSize', pageSize.toString())
  params.set('summary', 'true')
  return apiFetch<PagedResult<RepertoireListItem>>(`/repertoire?${params}`)
}

export const getRepertoireItem = (userTuneId: string) =>
  apiFetch<RepertoireItem>(`/repertoire/items/${userTuneId}`)

/** Full repertoire (with ABC), all pages — for bulk operations like CSV/JSON backup export. */
export const getFullRepertoire = async (): Promise<RepertoireItem[]> => {
  const items: RepertoireItem[] = []
  let page = 1
  for (;;) {
    const result = await getRepertoire(undefined, undefined, undefined, page, 100)
    items.push(...result.items)
    if (!result.hasMore) break
    page += 1
  }
  return items
}

/** Lightweight full repertoire (no ABC), all pages — for ID/membership-only checks. */
export const getFullRepertoireList = async (): Promise<RepertoireListItem[]> => {
  const items: RepertoireListItem[] = []
  let page = 1
  for (;;) {
    const result = await getRepertoireList(undefined, undefined, undefined, page, 100)
    items.push(...result.items)
    if (!result.hasMore) break
    page += 1
  }
  return items
}

export interface RepertoireStats {
  totalCount: number
  byStatus: Record<string, number>
  byType: Record<string, number>
  rustyCount: number
}

/** Aggregate repertoire counts for the dashboard — avoids fetching every row. */
export const getRepertoireStats = () => apiFetch<RepertoireStats>('/repertoire/stats')

export const addToRepertoire = (tuneId: string, tuneSettingId?: string) =>
  apiFetch<RepertoireItem>('/repertoire', {
    method: 'POST',
    body: JSON.stringify({ tuneId, tuneSettingId }),
  })

export const getTuneDetails = (tuneId: string, userId: string) =>
  userId ? apiFetch<TuneDetails>(`/tunes/${tuneId}`) : apiFetchPublic<TuneDetails>(`/tunes/${tuneId}`)

export const addTuneSetting = (tuneId: string, key: string, abc: string, submitterName: string) =>
  apiFetch<TuneSetting>(`/tunes/${tuneId}/settings`, {
    method: 'POST',
    body: JSON.stringify({ key, abc, submitterName }),
  })

export const addTuneAlias = (tuneId: string, name: string) =>
  apiFetch<{ name: string }>(`/tunes/${tuneId}/aliases`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })

export const voteTuneSetting = (settingId: string, value: number) =>
  apiFetch<{ voteScore: number }>(`/tunes/settings/${settingId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })

export const updateUserTune = (
  userTuneId: string,
  patch: { status?: string; targetBpm?: number; customAbcText?: string; tuneSettingId?: string },
) =>
  apiFetch<RepertoireItem>(`/repertoire/items/${userTuneId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const logPractice = (userTuneId: string) =>
  apiFetch<{ userTuneId: string; lastPracticed: string; newBadges: string[] }>(
    `/repertoire/items/${userTuneId}/practiced`,
    { method: 'POST' },
  )

export interface EarTrainingProgress {
  userTuneId: string
  phraseIndex: number
  notesRevealed: number
  completedAt: string | null
}

export const getEarTrainingProgress = (userTuneId: string) =>
  apiFetch<EarTrainingProgress>(`/repertoire/items/${userTuneId}/ear-training`)

export const saveEarTrainingProgress = (
  userTuneId: string,
  body: { phraseIndex: number; notesRevealed: number; completed: boolean },
) =>
  apiFetch<EarTrainingProgress>(`/repertoire/items/${userTuneId}/ear-training`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })

export const removeFromRepertoire = (userTuneId: string) =>
  apiFetch<void>(`/repertoire/items/${userTuneId}`, { method: 'DELETE' })

export interface PracticeDay {
  date: string
  count: number
}

export interface PracticeStats {
  currentStreakDays: number
  totalLast30: number
  perDay: PracticeDay[]
}

export const getPracticeStats = () => apiFetch<PracticeStats>('/practice/stats')

export interface UserBadge {
  badgeKey: string
  earnedAt: string
}

export interface GamificationSummary {
  totalPoints: number
  badges: UserBadge[]
}

export const getMyGamificationSummary = () => apiFetch<GamificationSummary>('/users/me/gamification')

export const getPublicGamificationSummary = (userId: string) =>
  apiFetchPublic<GamificationSummary>(`/users/${userId}/gamification`)

export const getPracticeQueue = () =>
  apiFetch<PracticeQueueItem[]>('/practice/queue')

export interface NextTuneSuggestion {
  userTuneId: string
  title: string
  tuneType: string
  key: string
  status: string
  score: number
  reason: string
}

export const suggestNextTune = (userTuneIds: string[]) =>
  apiFetch<NextTuneSuggestion[]>('/sets/suggest', {
    method: 'POST',
    body: JSON.stringify({ userTuneIds }),
  })

export const getSets = () => apiFetch<TuneSetSummary[]>('/sets')

export const getSet = (setId: string) => apiFetchPublic<TuneSet>(`/sets/${setId}`)

export const createSet = (title: string, items: SaveSetItem[]) =>
  apiFetch<TuneSet>('/sets', {
    method: 'POST',
    body: JSON.stringify({ title, items }),
  })

export const updateSet = (setId: string, title: string, items: SaveSetItem[]) =>
  apiFetch<TuneSet>(`/sets/${setId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, items }),
  })

export const deleteSet = (setId: string) =>
  apiFetch<void>(`/sets/${setId}`, { method: 'DELETE' })

// --- Groups Types & Functions ---
export type RecurrencePattern = 'None' | 'Weekly' | 'Biweekly' | 'MonthlyNthDay' | 'SpecificDate'

export interface GroupScheduleExceptionData {
  groupScheduleExceptionId: string
  groupMeetingScheduleId: string
  exceptionDate: string
}

export interface GroupMeetingScheduleData {
  groupMeetingScheduleId: string
  groupId: string
  recurrencePattern: RecurrencePattern
  recurrenceDayOfWeek: number | null
  recurrenceWeekOfMonth: number | null
  startDate: string | null
  meetingTime: string | null
  meetingScheduleText: string | null
  meetingDescription: string | null
  exceptions: GroupScheduleExceptionData[]
}

export interface GroupUpdateData {
  groupUpdateId: string
  groupId: string
  title: string
  content: string
  createdByUserId: string
  createdByDisplayName: string
  createdAt: string
}

export interface GroupSummary {
  groupId: string
  name: string
  description: string | null
  city: string | null
  memberCount: number
  isMember: boolean
  isPrivate: boolean
  isPending: boolean
  timeZone?: string | null
}

export type GroupRole = 'Member' | 'Administrator' | 'Owner'

export interface GroupMember {
  userId: string
  displayName: string
  role: GroupRole
}

export interface GroupCommonTune {
  tuneId: string
  title: string
  tuneType: string
  key: string
  memberCount: number
  totalMembersInGroup: number
}

export type GroupFeedEventType = 'TuneLearned' | 'MemberJoined'

export interface GroupFeedEventData {
  memberName: string
  eventType: GroupFeedEventType
  tuneTitles: string[]
  createdAt: string
}

export interface GroupTuneListItem {
  groupTuneId: string
  tuneId: string
  title: string
  tuneType: string
  key: string
  tuneSettingId: string | null
  settingSubmitterName: string | null
  addedByDisplayName: string
}

export interface GroupDetails {
  groupId: string
  name: string
  description: string | null
  city: string | null
  isPrivate: boolean
  inviteCode: string | null
  viewerStatus: 'Active' | 'Pending' | null
  members: GroupMember[]
  pendingMembers: GroupMember[]
  masterTunes: GroupTuneListItem[]
  commonTunes: GroupCommonTune[]
  feed: GroupFeedEventData[]
  updates: GroupUpdateData[]
  schedules: GroupMeetingScheduleData[]
  timeZone?: string | null
}

export interface JoinResult {
  status: 'Active' | 'Pending'
}

export const getGroups = (userId: string, search?: string, page = 1, pageSize = 20) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  params.set('page', page.toString())
  params.set('pageSize', pageSize.toString())
  return userId
    ? apiFetch<PagedResult<GroupSummary>>(`/groups?${params}`)
    : apiFetchPublic<PagedResult<GroupSummary>>(`/groups?${params}`)
}

export const getGroupDetails = (groupId: string, userId: string) =>
  userId ? apiFetch<GroupDetails>(`/groups/${groupId}`) : apiFetchPublic<GroupDetails>(`/groups/${groupId}`)

export interface CreateGroupParams {
  name: string
  description: string
  city?: string
  isPrivate?: boolean
  timeZone?: string
  recurrencePattern?: RecurrencePattern
  recurrenceDayOfWeek?: number | null
  recurrenceWeekOfMonth?: number | null
  startDate?: string | null
  meetingTime?: string
  meetingScheduleText?: string
  meetingDescription?: string
  schedules?: Array<{
    recurrencePattern: RecurrencePattern
    recurrenceDayOfWeek?: number | null
    recurrenceWeekOfMonth?: number | null
    startDate?: string | null
    meetingTime?: string
    meetingScheduleText?: string
    meetingDescription?: string
  }>
}

export const createGroup = (params: CreateGroupParams) =>
  apiFetch<GroupSummary>('/groups', {
    method: 'POST',
    body: JSON.stringify(params),
  })

export const updateGroupInfo = (
  groupId: string,
  info: { name: string; description: string; city?: string; isPrivate: boolean; timeZone?: string },
) =>
  apiFetch<void>(`/groups/${groupId}/info`, {
    method: 'POST',
    body: JSON.stringify(info),
  })

export const replaceGroupSchedules = (
  groupId: string,
  schedules: Array<{
    recurrencePattern: RecurrencePattern
    recurrenceDayOfWeek?: number | null
    recurrenceWeekOfMonth?: number | null
    startDate?: string | null
    meetingTime?: string
    meetingScheduleText?: string
    meetingDescription?: string
  }>,
) =>
  apiFetch<void>(`/groups/${groupId}/schedules/replace`, {
    method: 'POST',
    body: JSON.stringify({ schedules }),
  })

export const createGroupUpdate = (groupId: string, title: string, content: string) =>
  apiFetch<GroupUpdateData>(`/groups/${groupId}/updates`, {
    method: 'POST',
    body: JSON.stringify({ title, content }),
  })

export const deleteGroupUpdate = (groupId: string, updateId: string) =>
  apiFetch<void>(`/groups/${groupId}/updates/${updateId}`, {
    method: 'DELETE',
  })

export const updateGroupSchedule = (
  groupId: string,
  scheduleConfig: {
    recurrencePattern: RecurrencePattern
    recurrenceDayOfWeek?: number | null
    recurrenceWeekOfMonth?: number | null
    startDate?: string | null
    meetingTime?: string
    meetingScheduleText?: string
    meetingDescription?: string
  },
) =>
  apiFetch<void>(`/groups/${groupId}/schedule`, {
    method: 'POST',
    body: JSON.stringify(scheduleConfig),
  })

export const addGroupSchedule = (
  groupId: string,
  scheduleConfig: {
    recurrencePattern: RecurrencePattern
    recurrenceDayOfWeek?: number | null
    recurrenceWeekOfMonth?: number | null
    startDate?: string | null
    meetingTime?: string
    meetingScheduleText?: string
    meetingDescription?: string
  },
) =>
  apiFetch<GroupMeetingScheduleData>(`/groups/${groupId}/schedules`, {
    method: 'POST',
    body: JSON.stringify(scheduleConfig),
  })

export const deleteGroupSchedule = (groupId: string, scheduleId: string) =>
  apiFetch<void>(`/groups/${groupId}/schedules/${scheduleId}`, {
    method: 'DELETE',
  })

export const addGroupScheduleException = (groupId: string, scheduleId: string, exceptionDate: string) =>
  apiFetch<GroupScheduleExceptionData>(`/groups/${groupId}/schedules/${scheduleId}/exceptions`, {
    method: 'POST',
    body: JSON.stringify({ exceptionDate }),
  })

export const deleteGroupScheduleException = (groupId: string, scheduleId: string, exceptionId: string) =>
  apiFetch<void>(`/groups/${groupId}/schedules/${scheduleId}/exceptions/${exceptionId}`, {
    method: 'DELETE',
  })

export const joinGroup = (groupId: string, inviteCode?: string) =>
  apiFetch<JoinResult>(`/groups/${groupId}/join`, {
    method: 'POST',
    body: JSON.stringify({ inviteCode }),
  })

export const updateGroupPrivacy = (groupId: string, isPrivate: boolean) =>
  apiFetch<void>(`/groups/${groupId}/privacy`, {
    method: 'PATCH',
    body: JSON.stringify({ isPrivate }),
  })

export const regenerateGroupInviteCode = (groupId: string) =>
  apiFetch<{ inviteCode: string }>(`/groups/${groupId}/invite-code`, {
    method: 'POST',
  })

export const approveGroupMember = (groupId: string, targetUserId: string) =>
  apiFetch<void>(`/groups/${groupId}/members/${targetUserId}/approve`, {
    method: 'POST',
  })

export const rejectGroupMember = (groupId: string, targetUserId: string) =>
  apiFetch<void>(`/groups/${groupId}/members/${targetUserId}/reject`, {
    method: 'POST',
  })

export const leaveGroup = (groupId: string) =>
  apiFetch<void>(`/groups/${groupId}/leave`, {
    method: 'POST',
  })

export const removeGroupMember = (groupId: string, targetUserId: string) =>
  apiFetch<void>(`/groups/${groupId}/members/${targetUserId}`, {
    method: 'DELETE',
  })

export const deleteGroup = (groupId: string) =>
  apiFetch<void>(`/groups/${groupId}`, {
    method: 'DELETE',
  })


export const grantGroupAdministrator = (groupId: string, targetUserId: string) =>
  apiFetch<void>(`/groups/${groupId}/members/${targetUserId}/promote`, {
    method: 'POST',
  })

export const revokeGroupAdministrator = (groupId: string, targetUserId: string) =>
  apiFetch<void>(`/groups/${groupId}/members/${targetUserId}/demote`, {
    method: 'POST',
  })

export const transferGroupOwnership = (groupId: string, newOwnerUserId: string) =>
  apiFetch<void>(`/groups/${groupId}/transfer-ownership`, {
    method: 'POST',
    body: JSON.stringify({ newOwnerUserId }),
  })

export const addGroupTune = (groupId: string, tuneId: string, tuneSettingId?: string) =>
  apiFetch<GroupTuneListItem>(`/groups/${groupId}/tunes`, {
    method: 'POST',
    body: JSON.stringify({ tuneId, tuneSettingId }),
  })

export const updateGroupTune = (groupId: string, groupTuneId: string, tuneSettingId?: string) =>
  apiFetch<GroupTuneListItem>(`/groups/${groupId}/tunes/${groupTuneId}`, {
    method: 'PATCH',
    body: JSON.stringify({ tuneSettingId }),
  })

export const removeGroupTune = (groupId: string, groupTuneId: string) =>
  apiFetch<void>(`/groups/${groupId}/tunes/${groupTuneId}`, {
    method: 'DELETE',
  })

// --- Group Set Lists ---

export interface GroupSetItemData {
  groupTuneId: string
  sequenceNumber: number
  repetitions: number
  title: string
  tuneType: string
  key: string
  abc: string
}

export interface GroupSetData {
  groupSetId: string
  groupId: string
  title: string
  items: GroupSetItemData[]
  analysis: SetAnalysis
}

// Lightweight group-set row for the list view — no ABC payload. Fetch the singular set (getGroupSet) for that.
export interface GroupSetItemSummaryData {
  groupTuneId: string
  sequenceNumber: number
  repetitions: number
  title: string
  tuneType: string
  key: string
}

export interface GroupSetSummaryData {
  groupSetId: string
  groupId: string
  title: string
  items: GroupSetItemSummaryData[]
  analysis: SetAnalysis
}

export interface SaveGroupSetItem {
  groupTuneId: string
  repetitions: number
}

export const getGroupSets = (groupId: string, userId: string) =>
  userId
    ? apiFetch<GroupSetSummaryData[]>(`/groups/${groupId}/sets`)
    : apiFetchPublic<GroupSetSummaryData[]>(`/groups/${groupId}/sets`)

export const getGroupSet = (groupSetId: string, userId: string) =>
  userId ? apiFetch<GroupSetData>(`/groupsets/${groupSetId}`) : apiFetchPublic<GroupSetData>(`/groupsets/${groupSetId}`)

export const createGroupSet = (groupId: string, title: string, items: SaveGroupSetItem[]) =>
  apiFetch<GroupSetData>(`/groups/${groupId}/sets`, {
    method: 'POST',
    body: JSON.stringify({ title, items }),
  })

export const updateGroupSet = (groupSetId: string, title: string, items: SaveGroupSetItem[]) =>
  apiFetch<GroupSetData>(`/groupsets/${groupSetId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, items }),
  })

export const deleteGroupSet = (groupSetId: string) =>
  apiFetch<void>(`/groupsets/${groupSetId}`, { method: 'DELETE' })

// --- Scheduled Sessions ---

export type RsvpStatus = 'Going' | 'Maybe' | 'NotGoing'

export interface RsvpAttendee {
  userId: string
  displayName: string
  status: RsvpStatus
}

export interface GroupSessionData {
  groupSessionId: string
  title: string
  location: string | null
  startsAt: string
  notes: string | null
  isCancelled: boolean
  createdByDisplayName: string
  goingCount: number
  maybeCount: number
  notGoingCount: number
  viewerRsvpStatus: RsvpStatus | null
  attendees?: RsvpAttendee[]
}

export const getGroupSessions = (groupId: string, userId: string) =>
  userId
    ? apiFetch<GroupSessionData[]>(`/groups/${groupId}/sessions`)
    : apiFetchPublic<GroupSessionData[]>(`/groups/${groupId}/sessions`)

export const createGroupSession = (
  groupId: string,
  fields: { title: string; location?: string; startsAt: string; notes?: string; repeatWeeks: number },
) =>
  apiFetch<GroupSessionData[]>(`/groups/${groupId}/sessions`, {
    method: 'POST',
    body: JSON.stringify(fields),
  })

export const updateGroupSession = (
  groupId: string,
  sessionId: string,
  patch: { title?: string; location?: string; startsAt?: string; notes?: string; isCancelled?: boolean },
) =>
  apiFetch<GroupSessionData>(`/groups/${groupId}/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteGroupSession = (groupId: string, sessionId: string) =>
  apiFetch<void>(`/groups/${groupId}/sessions/${sessionId}`, { method: 'DELETE' })

export const rsvpToGroupSession = (groupId: string, sessionId: string, status: RsvpStatus) =>
  apiFetch<GroupSessionData>(`/groups/${groupId}/sessions/${sessionId}/rsvp`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })

export const rsvpToGroupScheduleDate = (groupId: string, scheduleId: string, date: string, status: RsvpStatus) =>
  apiFetch<GroupSessionData>(`/groups/${groupId}/schedules/${scheduleId}/rsvp`, {
    method: 'POST',
    body: JSON.stringify({ date, status }),
  })

export interface UpcomingMeetingData {
  groupId: string
  groupName: string
  groupSessionId: string | null
  groupMeetingScheduleId: string | null
  title: string
  location: string | null
  startsAt: string
  isCancelled: boolean
  viewerRsvpStatus: RsvpStatus | null
  goingCount: number
  maybeCount: number
}

export const getUpcomingMeetings = () => apiFetch<UpcomingMeetingData[]>('/me/upcoming-meetings')

export interface DashboardActivityFeedItem {
  groupFeedEventId: string
  groupId: string
  groupName: string
  eventType: string
  summaryText: string
  createdAt: string
}

export interface DashboardRustyTune {
  userTuneId: string
  title: string
  tuneType: string
  lastPracticed: string | null
}

export interface DashboardPendingRequest {
  groupId: string
  groupName: string
  pendingCount: number
}

export interface DashboardSummaryData {
  currentStreakDays: number
  recentActivity: DashboardActivityFeedItem[]
  topRustyTunes: DashboardRustyTune[]
  pendingGroupRequests: DashboardPendingRequest[]
}

export const getDashboardSummary = () => apiFetch<DashboardSummaryData>('/me/dashboard-summary')

export interface UserProfile {
  userId: string
  displayName: string
  username: string | null
  email: string
  bio: string | null
  location: string | null
  instruments: string | null
  isModerator: boolean
}

export const getCurrentUser = () => apiFetch<UserProfile>('/users/me')

export const updateCurrentUser = (patch: { displayName?: string; bio?: string; location?: string; instruments?: string; username?: string }) =>
  apiFetch<UserProfile>('/users/me', { method: 'PATCH', body: JSON.stringify(patch) }, { skipOfflineQueue: true })

export interface UsernameAvailability {
  username: string
  available: boolean
  reason: string | null
}

export const checkUsernameAvailable = (username: string) =>
  apiFetchPublic<UsernameAvailability>(`/users/username-available/${encodeURIComponent(username)}`)

export interface PublicUserProfile {
  userId: string
  displayName: string
  username: string
  bio: string | null
  location: string | null
  instruments: string | null
}

export const getPublicUserProfile = (username: string) =>
  apiFetchPublic<PublicUserProfile>(`/users/by-username/${encodeURIComponent(username)}/profile`)

export interface PublicActiveTune {
  tuneId: string
  title: string
  tuneType: string
  key: string
}

export const getPublicActiveTunes = (userId: string) =>
  apiFetchPublic<PublicActiveTune[]>(`/users/${userId}/active-tunes`)

// Moderator Interfaces and API Methods
export interface ModeratorTuneData {
  tuneId: string
  title: string
  tuneType: string
  key: string
  masterAbcText: string
  isReviewed: boolean
  reviewedAt: string | null
  reviewedBy: string | null
  createdAt: string
}

export interface ModeratorGroupData {
  groupId: string
  name: string
  description: string
  city: string | null
  isPrivate: boolean
  inviteCode: string | null
  isReviewed: boolean
  reviewedAt: string | null
  reviewedBy: string | null
  createdAt: string
  memberCount: number
}

export interface ModeratorUserDetails {
  userId: string
  displayName: string
  username: string | null
  email: string
  bio: string | null
  location: string | null
  instruments: string | null
  isModerator: boolean
  groupCount: number
  tuneCount: number
}

export const getUnreviewedTunes = () =>
  apiFetch<ModeratorTuneData[]>('/moderator/unreviewed-tunes')

export const getUnreviewedGroups = () =>
  apiFetch<ModeratorGroupData[]>('/moderator/unreviewed-groups')

export const approveTune = (tuneId: string) =>
  apiFetch<ModeratorTuneData>(`/moderator/tunes/${tuneId}/approve`, { method: 'POST' })

export const approveGroup = (groupId: string) =>
  apiFetch<ModeratorGroupData>(`/moderator/groups/${groupId}/approve`, { method: 'POST' })

export const moderatorUpdateTune = (tuneId: string, payload: { title: string; tuneType: string; key: string; masterAbcText: string }) =>
  apiFetch<ModeratorTuneData>(`/moderator/tunes/${tuneId}`, { method: 'PUT', body: JSON.stringify(payload) })

export const moderatorDeleteTune = (tuneId: string) =>
  apiFetch<void>(`/moderator/tunes/${tuneId}`, { method: 'DELETE' })

export const moderatorDeleteTuneSetting = (settingId: string) =>
  apiFetch<void>(`/moderator/tunes/settings/${settingId}`, { method: 'DELETE' })

export const moderatorDeleteTuneAlias = (aliasId: string) =>
  apiFetch<void>(`/moderator/tunes/aliases/${aliasId}`, { method: 'DELETE' })

export const getModeratorGroups = () =>
  apiFetch<ModeratorGroupData[]>('/moderator/groups')

export const getModeratorUserDetails = (userId: string) =>
  apiFetch<ModeratorUserDetails>(`/moderator/users/${userId}`)

export const sanitizeUserProfile = (userId: string, payload: { displayName?: string; bio?: string; location?: string; instruments?: string }) =>
  apiFetch<{ success: boolean; userId: string; displayName: string }>(`/moderator/users/${userId}/sanitize`, { method: 'POST', body: JSON.stringify(payload) })

