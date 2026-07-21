"use client";

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  formatTuneType,
  getPracticeQueue,
  getRepertoireStats,
  getSets,
  migrateLegacyData,
} from '../services/api'
import { currentUserId, useSignal } from '../state/appState'

export function Dashboard() {
  const userId = useSignal(currentUserId)
  const [migrationStatus, setMigrationStatus] = useState<string | null>(null)
  const [migrating, setMigrating] = useState(false)

  const handleMigrateLegacyData = async () => {
    setMigrating(true)
    setMigrationStatus(null)
    try {
      const result = await migrateLegacyData()
      setMigrationStatus(
        result.migrated
          ? `Migrated data from ${result.legacyEmail}: ${result.userTunesMigrated} tunes, ${result.setsMigrated} sets, ${result.groupMembershipsMigrated} group memberships, ${result.sessionRsvpsMigrated} RSVPs, ${result.tuneSettingVotesMigrated} votes.`
          : 'No legacy account found for this email — nothing to migrate.',
      )
    } catch (err) {
      setMigrationStatus(err instanceof Error ? err.message : 'Migration failed.')
    } finally {
      setMigrating(false)
    }
  }

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

      {/* Throwaway: one-time MSAL identity migration. Remove this block, the
          migrateLegacyData call in services/api.ts, and the MigrateLegacyData
          endpoint once the migration has been run. */}
      <div className="card">
        <button type="button" onClick={handleMigrateLegacyData} disabled={migrating}>
          {migrating ? 'Migrating…' : 'Migrate legacy account data'}
        </button>
        {migrationStatus && <p className="tune-meta">{migrationStatus}</p>}
      </div>

      {stats.isError && (
        <p className="error">Could not reach the API (is the Functions host running?).</p>
      )}

      <div className="stat-grid">
        <div className="card stat">
          <strong>{stats.data?.totalCount ?? 0}</strong>
          <span>tunes</span>
        </div>
        <div className="card stat">
          <strong>{byStatus['Active'] ?? 0}</strong>
          <span>active</span>
        </div>
        <div className="card stat">
          <strong>{byStatus['Learning'] ?? 0}</strong>
          <span>learning</span>
        </div>
        <div className="card stat">
          <strong className={rustyCount > 0 ? 'rusty' : ''}>{rustyCount}</strong>
          <span>going rusty</span>
        </div>
        <div className="card stat">
          <strong>{(sets.data ?? []).length}</strong>
          <span>sets</span>
        </div>
      </div>

      {Object.keys(byType).length > 0 && (
        <>
          <h2>By type</h2>
          <p className="tune-meta">
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([type, count]) =>
                  `${count} ${formatTuneType(type).toLowerCase()}${count > 1 ? 's' : ''}`,
              )
              .join(' · ')}
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
