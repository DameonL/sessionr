"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  createGroupSession,
  deleteGroupSession,
  parseServerDate,
  rsvpToGroupSession,
  updateGroupSession,
  getGroupSessions,
  type GroupSessionData,
  type RsvpStatus,
} from '../services/api'
import { useAuthStatus, showToast } from '../state/appState'

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface FormState {
  sessionId: string | null
  title: string
  location: string
  startsAtLocal: string
  notes: string
  repeatWeeks: number
}

const RSVP_LABELS: Record<RsvpStatus, string> = { Going: 'Going', Maybe: 'Maybe', NotGoing: "Can't Go" }

export function GroupSessions({
  groupId,
  userId,
  isAdmin,
  isMember,
}: {
  groupId: string
  userId: string
  isAdmin: boolean
  isMember: boolean
}) {
  const queryClient = useQueryClient()
  const authStatus = useAuthStatus()
  const [form, setForm] = useState<FormState | null>(null)
  const [showPast, setShowPast] = useState(false)

  const sessions = useQuery({
    queryKey: ['group-sessions', groupId, userId],
    queryFn: () => getGroupSessions(groupId, userId),
    enabled: authStatus !== 'pending',
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['group-sessions', groupId, userId] })

  const saveMutation = useMutation({
    mutationFn: (f: FormState) => {
      const startsAt = new Date(f.startsAtLocal).toISOString()
      return f.sessionId === null
        ? createGroupSession(groupId, {
            title: f.title.trim(),
            location: f.location.trim() || undefined,
            startsAt,
            notes: f.notes.trim() || undefined,
            repeatWeeks: f.repeatWeeks,
          })
        : updateGroupSession(groupId, f.sessionId, {
            title: f.title.trim(),
            location: f.location.trim(),
            startsAt,
            notes: f.notes.trim(),
          }).then((updated) => [updated])
    },
    onSuccess: () => {
      invalidate()
      setForm(null)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (sessionId: string) => updateGroupSession(groupId, sessionId, { isCancelled: true }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteGroupSession(groupId, sessionId),
    onSuccess: invalidate,
  })

  const rsvpMutation = useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: string; status: RsvpStatus }) =>
      rsvpToGroupSession(groupId, sessionId, status),
    onSuccess: invalidate,
    onError: (err) => {
      showToast((err as Error).message || 'Failed to update RSVP status.', 'error')
    },
  })

  const startEdit = (s: GroupSessionData) =>
    setForm({
      sessionId: s.groupSessionId,
      title: s.title,
      location: s.location ?? '',
      startsAtLocal: toDatetimeLocalValue(parseServerDate(s.startsAt)),
      notes: s.notes ?? '',
      repeatWeeks: 1,
    })

  const startCreate = () =>
    setForm({ sessionId: null, title: '', location: '', startsAtLocal: '', notes: '', repeatWeeks: 1 })

  const now = new Date()
  const all = sessions.data ?? []
  const upcoming = all.filter((s) => parseServerDate(s.startsAt) >= now)
  const past = all.filter((s) => parseServerDate(s.startsAt) < now)

  return (
    <div>
      <h2>Scheduled Sessions</h2>
      <p className="tune-meta italic">When and where this group meets in person.</p>

      {isAdmin && !form && <button onClick={startCreate}>+ Schedule Session</button>}

      {form && (
        <form
          className="card"
          style={{ padding: '1rem', marginTop: '1rem' }}
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate(form)
          }}
        >
          <h3 style={{ marginTop: 0 }}>{form.sessionId === null ? 'Schedule a Session' : 'Edit Session'}</h3>
          <label>
            Title
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Weekly Session"
              required
              style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
            />
          </label>
          <label style={{ display: 'block', marginTop: '0.75rem' }}>
            Location
            <input
              type="text"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. O'Sullivan's Pub"
              style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
            />
          </label>
          <label style={{ display: 'block', marginTop: '0.75rem' }}>
            Date &amp; time
            <input
              type="datetime-local"
              value={form.startsAtLocal}
              onChange={(e) => setForm({ ...form, startsAtLocal: e.target.value })}
              required
              style={{ display: 'block', marginTop: '0.25rem' }}
            />
          </label>
          <label style={{ display: 'block', marginTop: '0.75rem' }}>
            Meeting Description / Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Brief description of this meeting/session..."
              rows={2}
              style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
            />
          </label>
          {form.sessionId === null && (
            <label style={{ display: 'block', marginTop: '0.75rem' }}>
              Repeats weekly, for
              <input
                type="number"
                min={1}
                max={52}
                value={form.repeatWeeks}
                onChange={(e) => setForm({ ...form, repeatWeeks: Math.max(1, Number(e.target.value) || 1) })}
                style={{ width: '5rem', marginLeft: '0.5rem' }}
              />
              week(s)
            </label>
          )}

          {saveMutation.isError && (
            <p className="error">{(saveMutation.error as Error).message || 'Could not save session.'}</p>
          )}

          <div className="form-actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="secondary" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button type="submit" disabled={saveMutation.isPending || !form.title.trim() || !form.startsAtLocal}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: '1.5rem' }}>
        {sessions.isPending && <p>Loading…</p>}
        {upcoming.length === 0 && !sessions.isPending && (
          <p className="tune-meta italic">No upcoming sessions scheduled.</p>
        )}
        {upcoming.map((s) => (
          <SessionCard
            key={s.groupSessionId}
            session={s}
            isAdmin={isAdmin}
            isMember={isMember}
            onEdit={() => startEdit(s)}
            onCancel={() => cancelMutation.mutate(s.groupSessionId)}
            onDelete={() => deleteMutation.mutate(s.groupSessionId)}
            onRsvp={(status) => rsvpMutation.mutate({ sessionId: s.groupSessionId, status })}
            rsvpPending={rsvpMutation.isPending}
          />
        ))}
      </div>

      {past.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <button className="secondary" onClick={() => setShowPast(!showPast)}>
            {showPast ? 'Hide' : 'Show'} past sessions ({past.length})
          </button>
          {showPast && (
            <div style={{ marginTop: '1rem', opacity: 0.75 }}>
              {past.map((s) => (
                <SessionCard
                  key={s.groupSessionId}
                  session={s}
                  isAdmin={isAdmin}
                  isMember={isMember}
                  onEdit={() => startEdit(s)}
                  onCancel={() => cancelMutation.mutate(s.groupSessionId)}
                  onDelete={() => deleteMutation.mutate(s.groupSessionId)}
                  onRsvp={(status) => rsvpMutation.mutate({ sessionId: s.groupSessionId, status })}
                  rsvpPending={rsvpMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SessionCard({
  session,
  isAdmin,
  isMember,
  onEdit,
  onCancel,
  onDelete,
  onRsvp,
  rsvpPending,
}: {
  session: GroupSessionData
  isAdmin: boolean
  isMember: boolean
  onEdit: () => void
  onCancel: () => void
  onDelete: () => void
  onRsvp: (status: RsvpStatus) => void
  rsvpPending: boolean
}) {
  const goingAttendees = (session.attendees ?? []).filter((a) => a.status === 'Going')
  const maybeAttendees = (session.attendees ?? []).filter((a) => a.status === 'Maybe')

  return (
    <div className="card" style={{ padding: '1rem', marginTop: '0.75rem' }}>
      <div className="set-header">
        <div>
          <strong style={{ fontSize: '1.05rem' }}>
            {session.isCancelled && '❌ '}
            {session.title}
          </strong>
          <span className="tune-meta" style={{ display: 'block', marginTop: '0.15rem' }}>
            {parseServerDate(session.startsAt).toLocaleString()}
            {session.location ? ` · ${session.location}` : ''}
          </span>
        </div>
      </div>

      {session.notes && <p className="tune-meta" style={{ marginTop: '0.5rem' }}>{session.notes}</p>}

      <p className="tune-meta" style={{ marginTop: '0.5rem' }}>
        {session.goingCount} going · {session.maybeCount} maybe · {session.notGoingCount} can&apos;t go
      </p>

      {(goingAttendees.length > 0 || maybeAttendees.length > 0) && (
        <div style={{ marginTop: '0.65rem', padding: '0.5rem 0.75rem', background: 'var(--surface-2)', borderRadius: '6px', fontSize: '0.85rem' }}>
          {goingAttendees.length > 0 && (
            <div style={{ marginBottom: maybeAttendees.length > 0 ? '0.35rem' : 0 }}>
              <strong style={{ color: 'var(--accent)' }}>✅ Going ({goingAttendees.length}):</strong>{' '}
              <span>{goingAttendees.map((a) => a.displayName).join(', ')}</span>
            </div>
          )}
          {maybeAttendees.length > 0 && (
            <div>
              <strong style={{ color: 'var(--learning)' }}>❓ Maybe ({maybeAttendees.length}):</strong>{' '}
              <span>{maybeAttendees.map((a) => a.displayName).join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {!session.isCancelled && (
        isMember ? (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
            {(['Going', 'Maybe', 'NotGoing'] as RsvpStatus[]).map((status) => (
              <button
                key={status}
                className={session.viewerRsvpStatus === status ? '' : 'secondary'}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}
                onClick={() => onRsvp(status)}
                disabled={rsvpPending}
              >
                {RSVP_LABELS[status]}
              </button>
            ))}
          </div>
        ) : (
          <p className="tune-meta" style={{ marginTop: '0.5rem' }}>
            <Link href="/login" prefetch={false}>Sign in</Link> and join the group to RSVP.
          </p>
        )
      )}

      {isAdmin && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button className="secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem' }} onClick={onEdit}>
            Edit
          </button>
          {!session.isCancelled && (
            <button className="secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem' }} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="secondary danger-hover" style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem' }} onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
