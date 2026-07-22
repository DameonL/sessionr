"use client";

import { useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { getGroups, createGroup, joinGroup, leaveGroup, GroupSummary } from '../services/api'
import { currentUserId, useAuthStatus, useSignal } from '../state/appState'
import { GroupScheduleBuilder, ScheduleDraft, generateScheduleText } from '../components/GroupScheduleBuilder'
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel'

export function Groups() {
  const userId = useSignal(currentUserId)
  const status = useAuthStatus()
  const showSignedInUi = status !== 'anonymous'
  const queryClient = useQueryClient()

  // Form fields
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [newGroupCity, setNewGroupCity] = useState('')
  const [newGroupPrivate, setNewGroupPrivate] = useState(false)
  const [schedules, setSchedules] = useState<ScheduleDraft[]>([])

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Fetch groups
  const groupsQuery = useInfiniteQuery({
    queryKey: ['groups', userId],
    queryFn: ({ pageParam = 1 }) => getGroups(userId, undefined, pageParam, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: status !== 'pending',
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['groups', userId] })
  }

  // Join group mutation
  const joinMutation = useMutation({
    mutationFn: (groupId: string) => joinGroup(groupId),
    onSuccess: invalidate,
  })

  // Leave group mutation
  const leaveMutation = useMutation({
    mutationFn: (groupId: string) => leaveGroup(groupId),
    onSuccess: invalidate,
  })

  // Create group mutation
  const createMutation = useMutation({
    mutationFn: () => {
      const formattedSchedules = schedules.map((s) => ({
        recurrencePattern: s.recurrencePattern,
        recurrenceDayOfWeek: s.recurrencePattern !== 'SpecificDate' ? s.recurrenceDayOfWeek : undefined,
        recurrenceWeekOfMonth: s.recurrencePattern === 'MonthlyNthDay' ? s.recurrenceWeekOfMonth : undefined,
        startDate: s.startDate ? new Date(s.startDate).toISOString() : undefined,
        meetingTime: s.meetingTime || undefined,
        meetingScheduleText: generateScheduleText(s),
        meetingDescription: s.meetingDescription.trim() || undefined,
      }))

      return createGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim(),
        city: newGroupCity.trim() || undefined,
        isPrivate: newGroupPrivate,
        schedules: formattedSchedules,
      })
    },
    onSuccess: () => {
      invalidate()
      setNewGroupName('')
      setNewGroupDescription('')
      setNewGroupCity('')
      setNewGroupPrivate(false)
      setSchedules([])
      setShowCreateForm(false)
      setCreateError(null)
    },
    onError: (err: any) => {
      setCreateError(err.message || 'Failed to create group.')
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim() || !newGroupDescription.trim()) return
    createMutation.mutate()
  }

  if (groupsQuery.isPending) {
    return <section><p>Loading groups…</p></section>
  }

  if (groupsQuery.isError) {
    return <section><p className="error">Could not load groups.</p></section>
  }

  const allGroups = groupsQuery.data?.pages.flatMap((p) => p.items) ?? []
  const myGroups = allGroups.filter((g) => g.isMember || g.isPending)
  const publicGroups = allGroups.filter((g) => !g.isMember && !g.isPending && !g.isPrivate)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>👥 Session Groups</h1>
          <p className="tune-meta" style={{ marginTop: '0.2rem' }}>
            Find traditional music sessions, view meeting calendars, and connect with local musicians.
          </p>
        </div>
        {showSignedInUi && (
          <button
            onClick={() => {
              setShowCreateForm(!showCreateForm)
              setCreateError(null)
            }}
          >
            {showCreateForm ? 'Close Form' : '+ Create Group'}
          </button>
        )}
      </div>

      {/* Group Creation Form */}
      {showCreateForm && (
        <form className="card" onSubmit={handleCreateSubmit} style={{ padding: '1.5rem', background: 'var(--surface-2)' }}>
          <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Create a New Session Group</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Group Name *</label>
              <input
                type="text"
                placeholder="e.g. Traditional Session Dublin"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                required
                style={{ width: '100%' }}
                disabled={createMutation.isPending}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                Group Description * {newGroupPrivate && <span className="tune-meta">(Hidden for non-members on private groups)</span>}
              </label>
              <textarea
                placeholder="Describe your session group, tunes played, skill level, or pub location details..."
                rows={3}
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                required
                style={{ width: '100%', resize: 'vertical' }}
                disabled={createMutation.isPending}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>City / Location</label>
              <input
                type="text"
                placeholder="e.g. Dublin, Ireland or Boston, MA"
                value={newGroupCity}
                onChange={(e) => setNewGroupCity(e.target.value)}
                style={{ width: '100%' }}
                disabled={createMutation.isPending}
              />
            </div>

            {/* Multi-Schedule Builder */}
            <GroupScheduleBuilder
              schedules={schedules}
              onChange={setSchedules}
              disabled={createMutation.isPending}
            />

            {/* Private Group Checkbox with aligned label */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none', marginTop: '0.5rem' }}>
              <input
                type="checkbox"
                checked={newGroupPrivate}
                onChange={(e) => setNewGroupPrivate(e.target.checked)}
                disabled={createMutation.isPending}
                style={{ margin: 0, width: '1.1rem', height: '1.1rem', cursor: 'pointer', flexShrink: 0 }}
              />
              <span>Private group (new members must be approved or use an invite code)</span>
            </label>

            {createError && <p className="error" style={{ margin: 0 }}>{createError}</p>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setShowCreateForm(false)}>
                Cancel
              </button>
              <button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </div>
        </form>
      )}

      {showSignedInUi ? (
        <>
          <h2>My Groups</h2>
          {myGroups.length === 0 ? (
            <p className="tune-meta italic">You haven't joined any groups yet. Discover one below!</p>
          ) : (
            <ul className="tune-list">
              {myGroups.map((g) => (
                <li key={g.groupId} className="card tune-row" style={{ alignItems: 'flex-start' }}>
                  <Link href={`/group/${g.groupId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }} prefetch={false}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span className="tune-title">{g.isPrivate ? '🔒 ' : ''}{g.name}</span>
                      {g.city && <span style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>📍 {g.city}</span>}
                    </div>
                    {g.description && (
                      <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                        {g.description}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
                      <span>
                        {g.isPending
                          ? 'Request pending approval'
                          : `${g.memberCount} ${g.memberCount === 1 ? 'member' : 'members'}`}
                      </span>
                    </div>
                  </Link>
                  <button
                    className="secondary danger-hover"
                    onClick={() => leaveMutation.mutate(g.groupId)}
                    disabled={leaveMutation.isPending}
                  >
                    {g.isPending ? 'Withdraw Request' : 'Leave'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="tune-meta italic">
          <Link href="/login" prefetch={false}>Sign in</Link> to see and join your own groups.
        </p>
      )}

      <h2 style={{ marginTop: '2rem' }}>Discover Groups</h2>
      {publicGroups.length === 0 ? (
        <p className="tune-meta italic">No other public groups found.</p>
      ) : (
        <ul className="tune-list">
          {publicGroups.map((g) => (
            <li key={g.groupId} className="card tune-row" style={{ alignItems: 'flex-start' }}>
              <Link href={`/group/${g.groupId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }} prefetch={false}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className="tune-title">{g.name}</span>
                  {g.city && <span style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>📍 {g.city}</span>}
                </div>
                {g.description && (
                  <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                    {g.description}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
                  <span>{g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}</span>
                </div>
              </Link>
              {showSignedInUi ? (
                <button
                  onClick={() => joinMutation.mutate(g.groupId)}
                  disabled={joinMutation.isPending}
                >
                  Join
                </button>
              ) : (
                <Link href="/login" prefetch={false}><button className="secondary">Sign in to join</button></Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <InfiniteScrollSentinel
        hasMore={groupsQuery.hasNextPage}
        isLoadingMore={groupsQuery.isFetchingNextPage}
        onLoadMore={() => groupsQuery.fetchNextPage()}
      />
    </div>
  )
}
