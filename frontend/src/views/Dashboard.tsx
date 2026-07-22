"use client";

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  formatTuneType,
  getPracticeQueue,
  getRepertoireStats,
  getSets,
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
