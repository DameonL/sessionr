"use client";

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  formatTuneType,
  getDashboardSummary,
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
  const summary = useQuery({
    queryKey: ['dashboard-summary', userId],
    queryFn: () => getDashboardSummary(),
    enabled: !!userId,
  })

  const byStatus = stats.data?.byStatus ?? {}
  const byType = stats.data?.byType ?? {}
  const rustyCount = stats.data?.rustyCount ?? 0

  const statValue = (value: number | undefined, isPending: boolean) => (isPending ? '–' : value ?? 0)

  const streakDays = summary.data?.currentStreakDays ?? 0
  const pendingRequests = summary.data?.pendingGroupRequests ?? []
  const recentActivity = summary.data?.recentActivity ?? []
  const topRustyTunes = summary.data?.topRustyTunes ?? []

  return (
    <section>
      {/* Practice Streak & Quick Start Banner */}
      <div
        className="card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 1.25rem',
          marginBottom: '1.25rem',
          background: 'linear-gradient(135deg, rgba(77, 208, 165, 0.15), rgba(59, 130, 246, 0.15))',
          borderLeft: '4px solid var(--accent)',
          borderRadius: '8px',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🔥</span>
            <span>{summary.isPending ? '...' : `${streakDays} Day Practice Streak`}</span>
          </div>
          <span className="tune-meta" style={{ fontSize: '0.85rem' }}>
            {streakDays > 0 ? 'Keep the momentum going today!' : 'Start a practice session to build your streak!'}
          </span>
        </div>
        <Link href="/practice" prefetch={false} className="primary" style={{ textDecoration: 'none', padding: '0.4rem 0.9rem', fontSize: '0.9rem' }}>
          ⚡ Open Practice Room
        </Link>
      </div>

      {/* Pending Group Join Requests Alert */}
      {pendingRequests.length > 0 && (
        <div
          className="card"
          style={{
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            background: 'rgba(234, 179, 8, 0.15)',
            borderLeft: '4px solid var(--learning)',
            borderRadius: '8px',
          }}
        >
          <strong style={{ fontSize: '0.95rem' }}>🔔 Pending Group Join Requests:</strong>
          <ul style={{ margin: '0.35rem 0 0 0', paddingLeft: '1.25rem', fontSize: '0.85rem' }}>
            {pendingRequests.map((req) => (
              <li key={req.groupId}>
                <Link href={`/group/${req.groupId}`} prefetch={false} style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {req.groupName}
                </Link>{' '}
                has <strong>{req.pendingCount}</strong> membership request{req.pendingCount > 1 ? 's' : ''} awaiting approval.
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {/* Upcoming Group Meetings */}
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

      {/* Grid for Recent Group Activity & Top Rusty Tunes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
        {/* Recent Group Activity Feed */}
        <div>
          <h2>📢 Recent Group Activity</h2>
          {summary.isPending && <p>Loading activity…</p>}
          {!summary.isPending && recentActivity.length === 0 && (
            <p className="tune-meta italic">No recent activity in your groups.</p>
          )}
          {recentActivity.map((act) => (
            <div key={act.groupFeedEventId} className="card" style={{ padding: '0.75rem', marginBottom: '0.5rem' }}>
              <Link href={`/group/${act.groupId}`} prefetch={false} style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' }}>
                {act.groupName}
              </Link>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', lineHeight: 1.3 }}>{act.summaryText}</p>
              <span className="tune-meta" style={{ fontSize: '0.75rem', marginTop: '0.2rem', display: 'block' }}>
                {new Date(act.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>

        {/* Top Rusty Tunes */}
        <div>
          <h2>⚠️ Tunes Needing Practice</h2>
          {summary.isPending && <p>Loading tunes…</p>}
          {!summary.isPending && topRustyTunes.length === 0 && (
            <p className="tune-meta italic">Great job! No tunes are currently going rusty.</p>
          )}
          {topRustyTunes.map((tune) => (
            <div key={tune.userTuneId} className="card" style={{ padding: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link href={`/tune/${tune.userTuneId}`} prefetch={false} style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--text)' }}>
                  {tune.title} <span className="tune-meta" style={{ fontSize: '0.75rem' }}>({formatTuneType(tune.tuneType)})</span>
                </Link>
              </div>
              <span className="tune-meta" style={{ fontSize: '0.75rem', display: 'block', marginTop: '0.2rem' }}>
                Last practiced: {tune.lastPracticed ? new Date(tune.lastPracticed).toLocaleDateString() : 'Never'}
              </span>
            </div>
          ))}
          {topRustyTunes.length > 0 && (
            <Link href="/repertoire?status=Active" prefetch={false} style={{ fontSize: '0.85rem', display: 'inline-block', marginTop: '0.25rem' }}>
              View all rusty tunes →
            </Link>
          )}
        </div>
      </div>

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
