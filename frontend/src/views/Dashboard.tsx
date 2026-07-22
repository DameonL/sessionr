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
  })
  const queue = useQuery({
    queryKey: ['practice-queue', userId],
    queryFn: () => getPracticeQueue(),
  })
  const sets = useQuery({ queryKey: ['sets', userId], queryFn: () => getSets() })

  const byStatus = stats.data?.byStatus ?? {}
  const byType = stats.data?.byType ?? {}
  const rustyCount = stats.data?.rustyCount ?? 0

  return (
    <section>
      <h1>Dashboard</h1>

      {stats.isError && (
        <p className="error">Could not reach the API (is the Functions host running?).</p>
      )}

      <div className="stat-grid">
        <Link className="card stat quiet-link" href="/repertoire">
          <strong>{stats.data?.totalCount ?? 0}</strong>
          <span>tunes</span>
        </Link>
        <Link className="card stat quiet-link" href="/repertoire?status=Active">
          <strong>{byStatus['Active'] ?? 0}</strong>
          <span>active</span>
        </Link>
        <Link className="card stat quiet-link" href="/repertoire?status=Learning">
          <strong>{byStatus['Learning'] ?? 0}</strong>
          <span>learning</span>
        </Link>
        <Link className="card stat quiet-link" href="/repertoire?status=Active">
          <strong className={rustyCount > 0 ? 'rusty' : ''}>{rustyCount}</strong>
          <span>going rusty</span>
        </Link>
        <Link className="card stat quiet-link" href="/sets">
          <strong>{(sets.data ?? []).length}</strong>
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
                  <Link href={`/repertoire?type=${type}`}>
                    {count} {formatTuneType(type).toLowerCase()}
                    {count > 1 ? 's' : ''}
                  </Link>
                </span>
              ))}
          </p>
        </>
      )}

      <h2>Today's practice queue</h2>
      {(queue.data ?? []).slice(0, 3).map((item) => (
        <div key={item.userTuneId} className="card">
          <Link className="tune-row" href={`/tune/${item.userTuneId}`}>
            <span className="tune-title">{item.title}</span>
            <span className="tune-meta">{item.reason}</span>
          </Link>
        </div>
      ))}
      {(queue.data ?? []).length > 0 && <Link href="/practice">Open the Practice Room →</Link>}
    </section>
  )
}
