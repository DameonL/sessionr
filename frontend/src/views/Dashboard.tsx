"use client";

import { useState } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { useMsal } from '@azure/msal-react'
import Link from '@/utils/routerCompat'
import {
  formatTuneType,
  getActivityFeed,
  getDashboardSummary,
  getPracticeQueue,
  getRepertoireStats,
  getSets,
  getUpcomingMeetings,
  isUnauthenticatedError,
  type DashboardActivityItemData,
} from '../services/api'
import { loginRequest } from '../services/authConfig'
import { rememberReturnUrl } from '../services/returnUrl'
import { currentUserId, showToast, useSignal } from '../state/appState'
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel'
import { Spinner } from '../components/Spinner'

export function Dashboard() {
  const userId = useSignal(currentUserId)
  const { instance } = useMsal()
  const [filter, setFilter] = useState<'all' | 'groups' | 'friends'>('all')

  const stats = useQuery({
    queryKey: ['repertoire-stats', userId],
    queryFn: () => getRepertoireStats(),
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

  const activityFeedQuery = useInfiniteQuery({
    queryKey: ['dashboard-activity-feed', userId, filter],
    queryFn: ({ pageParam = 1 }) => getActivityFeed(filter, pageParam as number, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: !!userId,
  })

  const byStatus = stats.data?.byStatus ?? {}
  const byType = stats.data?.byType ?? {}
  const rustyCount = stats.data?.rustyCount ?? 0

  const statValue = (value: number | undefined, isPending: boolean) => (isPending ? '–' : value ?? 0)

  const streakDays = summary.data?.currentStreakDays ?? 0
  const pendingRequests = summary.data?.pendingGroupRequests ?? []

  const allActivities = activityFeedQuery.data?.pages.flatMap((p) => p.items) ?? []

  const getActivityIcon = (act: DashboardActivityItemData) => {
    if (act.source === 'Group') return '👥'
    switch (act.activityType) {
      case 'SessionRsvp': return '📅'
      case 'TuneLearned': return '🎻'
      case 'BadgeEarned': return '🏆'
      case 'NewFriend': return '🤝'
      default: return '📢'
    }
  }

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
          background: 'linear-gradient(135deg, var(--accent-soft), var(--brand-2-soft))',
          borderLeft: '4px solid var(--accent)',
          borderRadius: '8px',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🔥</span>
            <span>{summary.isPending ? '...' : streakDays > 0 ? `${streakDays} Day Practice Streak` : 'Start Your Practice Streak'}</span>
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
            background: 'var(--rust-soft)',
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
        isUnauthenticatedError(stats.error) ? (
          // Distinguishing these matters: an expired session used to render the
          // connectivity message below, sending users to check a backend that
          // was never down.
          <p className="error">
            Your session has expired.{' '}
            <button
              className="secondary btn-sm"
              onClick={() => {
                // Same call as NetworkStatusBanner's "Sign In to Sync": redirect,
                // not popup, and the current page recorded first so AuthProvider
                // can put the user back on it after the round trip.
                rememberReturnUrl()
                instance.loginRedirect(loginRequest).catch((err) => {
                  console.error('Sign-in failed:', err)
                  showToast('Sign-in failed. Please try again.', 'error')
                })
              }}
            >
              Sign in again
            </button>
          </p>
        ) : (
          <p className="error">Could not reach the API (is the Functions host running?).</p>
        )
      )}

      {/* Quick Repertoire & Sets Summary Bar */}
      <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
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

      {/* Upcoming Group Meetings */}
      {(upcomingMeetings.data ?? []).length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2>📅 Upcoming Group Meetings</h2>
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
        </div>
      )}

      {/* Unified Lazy-Loaded Activity Feed */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>⚡ Activity Feed</h2>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['all', 'groups', 'friends'] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? '' : 'secondary'}
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', textTransform: 'capitalize' }}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All Activity' : f === 'groups' ? '👥 Groups' : '🤝 Friends'}
              </button>
            ))}
          </div>
        </div>

        {activityFeedQuery.isPending && (
          <div className="spinner-row" style={{ padding: '2rem' }}>
            <Spinner size={28} />
          </div>
        )}

        {!activityFeedQuery.isPending && allActivities.length === 0 && (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="tune-meta italic" style={{ margin: 0, fontSize: '0.95rem' }}>
              No recent activity yet. Join groups or add friends to see your feed update!
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {allActivities.map((act) => (
            <div key={act.activityId} className="card" style={{ padding: '0.85rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <span style={{ fontSize: '1rem' }}>{getActivityIcon(act)}</span>
                  {act.source === 'Group' && act.groupId ? (
                    <Link href={`/group/${act.groupId}`} prefetch={false} style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--accent)', textDecoration: 'none' }}>
                      {act.groupName || 'Group'}
                    </Link>
                  ) : act.authorUsername ? (
                    <Link href={`/profile/${act.authorUsername}`} prefetch={false} style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--accent)', textDecoration: 'none' }}>
                      {act.authorDisplayName || act.authorUsername}
                    </Link>
                  ) : (
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{act.authorDisplayName || 'Friend'}</span>
                  )}
                </div>
                <span className="tune-meta" style={{ fontSize: '0.75rem' }}>
                  {new Date(act.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', lineHeight: 1.4 }}>
                {act.targetUrl ? (
                  <Link href={act.targetUrl} prefetch={false} className="quiet-link">
                    {act.summaryText}
                  </Link>
                ) : (
                  act.summaryText
                )}
              </p>
            </div>
          ))}
        </div>

        {/* Infinite Scroll Sentinel */}
        <InfiniteScrollSentinel
          hasMore={activityFeedQuery.hasNextPage}
          isLoadingMore={activityFeedQuery.isFetchingNextPage}
          onLoadMore={() => activityFeedQuery.fetchNextPage()}
        />
      </div>
    </section>
  )
}
