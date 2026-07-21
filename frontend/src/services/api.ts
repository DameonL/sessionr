/**
 * Typed client for the two Functions backends: the Private API (personal data
 * and mutations) and the Public API (anonymous-friendly reads + community
 * contributions). Azure Static Web Apps / the local Next.js dev proxy route
 * "/api/*" to the Public Functions app and everything else in "/api/*"
 * to the Private one (see next.config.ts).
 */
import { getBearerToken } from '../state/appState'

const API_BASE = 'https://sessionr-api-private-bphheph3gcdqgee2.westus3-01.azurewebsites.net/api/'
const PUBLIC_API_BASE = 'https://sessionr-api-public-f7hxfxdwftapd9hf.westus3-01.azurewebsites.net/api/'

async function doFetch<T>(base: string, path: string, init?: RequestInit, isRetry = false): Promise<T> {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const url = `${cleanBase}${cleanPath}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...init?.headers as Record<string, string>,
  }

  try {
    const token = await getBearerToken(isRetry)
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  } catch (err) {
    console.error('Failed to get bearer token', err)
  }

  const res = await fetch(url, {
    headers,
    ...init,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 401 && !isRetry) {
      console.warn('401 Unauthorized or expired token received, attempting token refresh and retry...')
      return doFetch<T>(base, path, init, true)
    }
    throw new Error(detail || `API ${res.status}: ${res.statusText}`)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

/** Calls the Private API (personal data, mutations). */
export const apiFetch = <T>(path: string, init?: RequestInit) => doFetch<T>(API_BASE, path, init)

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

export const TUNE_STATUSES = ['Wishlist', 'Learning', 'Active', 'Rusty', 'Retired'] as const

export const TUNE_TYPES = [
  'Reel', 'Jig', 'SlipJig', 'Hornpipe', 'Polka', 'Slide', 'Waltz',
  'March', 'Strathspey', 'Barndance', 'Mazurka', 'Air', 'Other',
] as const

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

export const addToRepertoire = (tuneId: string, tuneSettingId?: string) =>
  apiFetch<RepertoireItem>('/repertoire', {
    method: 'POST',
    body: JSON.stringify({ tuneId, tuneSettingId }),
  })

export const getTuneDetails = (tuneId: string, userId: string) =>
  apiFetchPublic<TuneDetails>(`/tunes/${tuneId}?userId=${userId}`)

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
  apiFetch<{ userTuneId: string; lastPracticed: string }>(
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
  streak: number
  total30Days: number
  perDay: PracticeDay[]
}

export const getPracticeStats = () => apiFetch<PracticeStats>('/practice/stats')

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

export const getSets = () => apiFetch<TuneSet[]>('/sets')

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
}

export type GroupRole = 'Member' | 'Administrator' | 'Owner'

export interface GroupMember {
  userId: string
  displayName: string
  email: string
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

export interface GroupActivity {
  memberName: string
  tuneTitle: string
  practicedAt: string
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
  recentActivity: GroupActivity[]
  updates: GroupUpdateData[]
  schedules: GroupMeetingScheduleData[]
}

export interface JoinResult {
  status: 'Active' | 'Pending'
}

export const getGroups = (userId: string, search?: string, page = 1, pageSize = 20) => {
  const params = new URLSearchParams()
  if (userId) params.set('userId', userId)
  if (search) params.set('search', search)
  params.set('page', page.toString())
  params.set('pageSize', pageSize.toString())
  return apiFetchPublic<PagedResult<GroupSummary>>(`/groups?${params}`)
}

export const getGroupDetails = (groupId: string, userId: string) =>
  apiFetchPublic<GroupDetails>(`/groups/${groupId}?userId=${userId}`)

export interface CreateGroupParams {
  name: string
  description: string
  city?: string
  isPrivate?: boolean
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
  info: { name: string; description: string; city?: string; isPrivate: boolean },
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

export interface SaveGroupSetItem {
  groupTuneId: string
  repetitions: number
}

export const getGroupSets = (groupId: string, userId: string) =>
  apiFetchPublic<GroupSetData[]>(`/groups/${groupId}/sets?userId=${userId}`)

export const getGroupSet = (groupSetId: string, userId: string) =>
  apiFetchPublic<GroupSetData>(`/groupsets/${groupSetId}?userId=${userId}`)

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
}

export const getGroupSessions = (groupId: string, userId: string) =>
  apiFetchPublic<GroupSessionData[]>(`/groups/${groupId}/sessions?userId=${userId}`)

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

export interface UserProfile {
  userId: string
  displayName: string
  email: string
}

export const loginOrRegisterUser = (email: string, displayName: string, oid?: string) =>
  apiFetch<UserProfile>('/users/login', {
    method: 'POST',
    body: JSON.stringify({ email, displayName, oid }),
  })
