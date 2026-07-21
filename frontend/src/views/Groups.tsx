"use client";

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { getGroups, createGroup, joinGroup, leaveGroup, GroupSummary, type RecurrencePattern } from '../services/api'
import { currentUserId, useSignal } from '../state/appState'

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKS_OF_MONTH = [
  { val: 1, label: '1st' },
  { val: 2, label: '2nd' },
  { val: 3, label: '3rd' },
  { val: 4, label: '4th' },
  { val: 5, label: '5th / Last' },
]

export function Groups() {
  const userId = useSignal(currentUserId)
  const isSignedIn = !!userId
  const queryClient = useQueryClient()

  // Form fields
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [newGroupCity, setNewGroupCity] = useState('')
  const [newGroupPrivate, setNewGroupPrivate] = useState(false)
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>('None')
  const [recurrenceDayOfWeek, setRecurrenceDayOfWeek] = useState<number>(3) // Wednesday
  const [recurrenceWeekOfMonth, setRecurrenceWeekOfMonth] = useState<number>(1) // 1st
  const [startDate, setStartDate] = useState<string>('')
  const [meetingTime, setMeetingTime] = useState('19:30')
  const [meetingDescription, setMeetingDescription] = useState('')

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Fetch groups
  const groupsQuery = useQuery({
    queryKey: ['groups', userId],
    queryFn: () => getGroups(userId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['groups', userId] })
  }

  // Join group mutation
  const joinMutation = useMutation({
    mutationFn: (groupId: string) => joinGroup(groupId, userId),
    onSuccess: invalidate,
  })

  // Leave group mutation
  const leaveMutation = useMutation({
    mutationFn: (groupId: string) => leaveGroup(groupId, userId),
    onSuccess: invalidate,
  })

  // Compute text summary of recurring schedule
  const computeScheduleText = (): string | undefined => {
    if (recurrencePattern === 'None') return undefined
    const dayName = DAYS_OF_WEEK[recurrenceDayOfWeek]
    const timePart = meetingTime ? ` at ${meetingTime}` : ''
    const startPart = startDate ? ` starting ${startDate}` : ''
    if (recurrencePattern === 'Weekly') {
      return `Every ${dayName}${timePart}`
    }
    if (recurrencePattern === 'Biweekly') {
      return `Every other ${dayName}${startPart}${timePart}`
    }
    if (recurrencePattern === 'MonthlyNthDay') {
      const weekLabel = WEEKS_OF_MONTH.find((w) => w.val === recurrenceWeekOfMonth)?.label || '1st'
      return `${weekLabel} ${dayName} every month${timePart}`
    }
    if (recurrencePattern === 'SpecificDate') {
      return `Meeting on ${startDate || 'specific date'}${timePart}`
    }
    return undefined
  }

  // Create group mutation
  const createMutation = useMutation({
    mutationFn: () => {
      const scheduleText = computeScheduleText()
      return createGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim(),
        userId,
        city: newGroupCity.trim() || undefined,
        isPrivate: newGroupPrivate,
        recurrencePattern,
        recurrenceDayOfWeek: recurrencePattern !== 'None' && recurrencePattern !== 'SpecificDate' ? recurrenceDayOfWeek : undefined,
        recurrenceWeekOfMonth: recurrencePattern === 'MonthlyNthDay' ? recurrenceWeekOfMonth : undefined,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        meetingTime: recurrencePattern !== 'None' ? meetingTime : undefined,
        meetingScheduleText: scheduleText,
        meetingDescription: meetingDescription.trim() || undefined,
      })
    },
    onSuccess: () => {
      invalidate()
      setNewGroupName('')
      setNewGroupDescription('')
      setNewGroupCity('')
      setNewGroupPrivate(false)
      setRecurrencePattern('None')
      setStartDate('')
      setMeetingDescription('')
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

  if (groupsQuery.isLoading) {
    return <section><p>Loading groups…</p></section>
  }

  if (groupsQuery.isError) {
    return <section><p className="error">Could not load groups.</p></section>
  }

  const allGroups = groupsQuery.data ?? []
  const myGroups = allGroups.filter((g) => g.isMember || g.isPending)
  const otherGroups = allGroups.filter((g) => !g.isMember && !g.isPending)

  return (
    <section>
      <div className="set-header">
        <h1>Groups</h1>
        {isSignedIn ? (
          !showCreateForm && <button onClick={() => setShowCreateForm(true)}>+ Create Group</button>
        ) : (
          <Link href="/login"><button className="secondary">Sign in to create a group</button></Link>
        )}
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateSubmit} className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
          <h3 style={{ marginTop: 0 }}>Create a New Group</h3>
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

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
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

              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Meeting Schedule Type</label>
                <select
                  value={recurrencePattern}
                  onChange={(e) => setRecurrencePattern(e.target.value as RecurrencePattern)}
                  disabled={createMutation.isPending}
                  style={{ width: '100%' }}
                >
                  <option value="None">None (Ad-hoc sessions only)</option>
                  <option value="Weekly">Every week on a specific day</option>
                  <option value="Biweekly">Every other week on a specific day</option>
                  <option value="MonthlyNthDay">Monthly on a specific week & day</option>
                  <option value="SpecificDate">Non-recurring specific meeting date</option>
                </select>
              </div>
            </div>

            {recurrencePattern !== 'None' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'var(--surface-3)', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {recurrencePattern === 'MonthlyNthDay' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Week of Month</label>
                      <select
                        value={recurrenceWeekOfMonth}
                        onChange={(e) => setRecurrenceWeekOfMonth(parseInt(e.target.value))}
                        disabled={createMutation.isPending}
                      >
                        {WEEKS_OF_MONTH.map((w) => (
                          <option key={w.val} value={w.val}>{w.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {recurrencePattern !== 'SpecificDate' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Day of Week</label>
                      <select
                        value={recurrenceDayOfWeek}
                        onChange={(e) => setRecurrenceDayOfWeek(parseInt(e.target.value))}
                        disabled={createMutation.isPending}
                      >
                        {DAYS_OF_WEEK.map((d, i) => (
                          <option key={d} value={i}>{d}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(recurrencePattern === 'Biweekly' || recurrencePattern === 'SpecificDate') && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        {recurrencePattern === 'SpecificDate' ? 'Meeting Date' : 'Start Date (Anchor Week)'}
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        disabled={createMutation.isPending}
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Meeting Time</label>
                    <input
                      type="time"
                      value={meetingTime}
                      onChange={(e) => setMeetingTime(e.target.value)}
                      disabled={createMutation.isPending}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Meeting Description / Notes</label>
                  <input
                    type="text"
                    placeholder="e.g. Slow session for beginners in back room of pub"
                    value={meetingDescription}
                    onChange={(e) => setMeetingDescription(e.target.value)}
                    disabled={createMutation.isPending}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
              <input
                type="checkbox"
                checked={newGroupPrivate}
                onChange={(e) => setNewGroupPrivate(e.target.checked)}
                disabled={createMutation.isPending}
              />
              Private group (new members must be approved or use an invite code)
            </label>

            {createError && <p className="error" style={{ margin: 0 }}>{createError}</p>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setShowCreateForm(false)}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !newGroupName.trim() || !newGroupDescription.trim()}
              >
                {createMutation.isPending ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </div>
        </form>
      )}

      {isSignedIn ? (
        <>
          <h2>My Groups</h2>
          {myGroups.length === 0 ? (
            <p className="tune-meta italic">You haven't joined any groups yet. Discover one below!</p>
          ) : (
            <ul className="tune-list">
              {myGroups.map((g) => (
                <li key={g.groupId} className="card tune-row" style={{ alignItems: 'flex-start' }}>
                  <Link href={`/group/${g.groupId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
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
          <Link href="/login">Sign in</Link> to see and join your own groups.
        </p>
      )}

      <h2 style={{ marginTop: '2rem' }}>Discover Groups</h2>
      {otherGroups.length === 0 ? (
        <p className="tune-meta italic">No other public groups found.</p>
      ) : (
        <ul className="tune-list">
          {otherGroups.map((g) => (
            <li key={g.groupId} className="card tune-row" style={{ alignItems: 'flex-start' }}>
              <Link href={`/group/${g.groupId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
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
              {isSignedIn ? (
                <button
                  onClick={() => joinMutation.mutate(g.groupId)}
                  disabled={joinMutation.isPending}
                >
                  Join
                </button>
              ) : (
                <Link href="/login"><button className="secondary">Sign in to join</button></Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

