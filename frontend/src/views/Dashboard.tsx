"use client";

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  formatTuneType,
  getPracticeQueue,
  getRepertoireStats,
  getSets,
  getUpcomingMeetings,
} from '../services/api'
import { currentUserId, useSignal } from '../state/appState'

export function Dashboard() {
  const userId = useSignal(currentUserId)

  const stats = useQuery({
    queryKey: ['repertoire-stats', userId],
    queryFn: () => getRepertoireStats(),
    enabled: !!userId,
  })
  const queue = useQuery({
    queryKey: ['practice-queue', userId],
    queryFn: () => getPracticeQueue(),
    enabled: !!userId,
  })
  const sets = useQuery({ queryKey: ['sets', userId], queryFn: () => getSets(), enabled: !!userId })
  const upcomingMeetings = useQuery({
    queryKey: ['upcoming-meetings', userId],
    queryFn: () => getUpcomingMeetings(),
    enabled: !!userId,
  })

  const byStatus = stats.data?.byStatus ?? {}
  const byType = stats.data?.byType ?? {}
  const rustyCount = stats.data?.rustyCount ?? 0

  // Queries are gated behind auth resolving (enabled: !!userId), so `isLoading` (which is
  // false while a query is disabled-and-not-yet-fetching) isn't enough to catch that window —
  // `isPending` is true any time there's no data yet, whether disabled or actively fetching.
  const statValue = (value: number | undefined, isPending: boolean) => (isPending ? '–' : value ?? 0)

  return (
    <section>
      <h1>Dashboard</h1>

      {stats.isError && (
        <p className="error">Could not reach the API (is the Functions host running?).</p>
      )}

      <div className="stat-grid">
        <Link className="card stat quiet-link" href="/repertoire" prefetch={false}>
          <strong>{statValue(stats.data?.totalCount, stats.isPending)}</strong>
          <span>tunes</span>
        </Link>
        <Link className="card stat quiet-link" href="/repertoire?status=Active" prefetch={false}>
          <strong>{statValue(byStatus['Active'], stats.isPending)}</strong>
          <span>active</span>
        </Link>
        <Link className="card stat quiet-link" href="/repertoire?status=Learning" prefetch={false}>
          <strong>{statValue(byStatus['Learning'], stats.isPending)}</strong>
          <span>learning</span>
        </Link>
        <Link className="card stat quiet-link" href="/repertoire?status=Active" prefetch={false}>
          <strong className={rustyCount > 0 ? 'rusty' : ''}>{statValue(rustyCount, stats.isPending)}</strong>
          <span>going rusty</span>
        </Link>
        <Link className="card stat quiet-link" href="/sets" prefetch={false}>
          <strong>{statValue(sets.data?.length, sets.isPending)}</strong>
          <span>sets</span>
        </Link>
      </div>

      {Object.keys(byType).length > 0 && (
        <>
          <h2>By type</h2>
          <p className="tune-meta">
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count], index) => (
                <span key={type}>
                  {index > 0 && ' · '}
                  <Link href={`/repertoire?type=${type}`} prefetch={false}>
                    {count} {formatTuneType(type).toLowerCase()}
                    {count > 1 ? 's' : ''}
                  </Link>
                </span>
              ))}
          </p>
        </>
      )}

      <h2>📅 Upcoming Group Meetings (Next 7 Days)</h2>
      {upcomingMeetings.isPending && <p>Loading upcoming meetings…</p>}
      {!upcomingMeetings.isPending && (upcomingMeetings.data ?? []).length === 0 && (
        <p className="tune-meta italic">No group meetings scheduled in the next 7 days.</p>
      )}
      {(upcomingMeetings.data ?? []).map((m, idx) => {
        const meetingDate = new Date(m.startsAt)
        return (
          <div key={m.groupSessionId || `${m.groupId}-${m.startsAt}-${idx}`} className="card" style={{ padding: '0.85rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <Link href={`/group/${m.groupId}`} prefetch={false} style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--accent)', textDecoration: 'none' }}>
                  👥 {m.groupName}
                </Link>
                <div style={{ marginTop: '0.2rem', fontWeight: 600 }}>
                  {m.title} {m.location ? `· ${m.location}` : ''}
                </div>
                <div className="tune-meta" style={{ fontSize: '0.8rem', marginTop: '0.15rem' }}>
                  🕒 {meetingDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at {meetingDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div>
                {m.viewerRsvpStatus && (
                  <span className="tune-meta" style={{ padding: '0.25rem 0.5rem', background: 'var(--surface-3)', borderRadius: '4px', fontSize: '0.8rem' }}>
                    RSVP: <strong>{m.viewerRsvpStatus}</strong>
                  </span>
                )}
                {m.goingCount > 0 && (
                  <span className="tune-meta" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                    ✅ {m.goingCount} going
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <h2>Today's practice queue</h2>
      {queue.isPending && <p>Loading…</p>}
      {(queue.data ?? []).slice(0, 3).map((item) => (
        <div key={item.userTuneId} className="card">
          <Link className="tune-row" href={`/tune/${item.userTuneId}`} prefetch={false}>
            <span className="tune-title">{item.title}</span>
            <span className="tune-meta">{item.reason}</span>
          </Link>
        </div>
      ))}
      {(queue.data ?? []).length > 0 && <Link href="/practice" prefetch={false}>Open the Practice Room →</Link>}
    </section>
  )
}
