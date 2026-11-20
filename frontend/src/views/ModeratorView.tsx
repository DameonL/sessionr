"use client";

import { useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import {
  getUnreviewedTunes,
  getUnreviewedGroups,
  getModeratorGroups,
  approveTune,
  approveGroup,
  moderatorUpdateTune,
  moderatorDeleteTune,
  moderatorRecomputeHeuristics,
  moderatorRefreshMatchIndex,
  moderatorMigrateTheSession,
  formatTuneType,
  type ModeratorTuneData,
  type ModeratorGroupData,
} from '../services/api'
import { currentUserProfile, useSignal, showToast } from '../state/appState'
import { validateAbc } from '../services/abcTools'
import { Spinner } from '../components/Spinner'

export function ModeratorView() {
  const profile = useSignal(currentUserProfile)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'tunes' | 'groups' | 'all-groups' | 'maintenance'>('tunes')

  // Edit Tune Modal State
  const [editingTune, setEditingTune] = useState<ModeratorTuneData | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState('')
  const [editKey, setEditKey] = useState('')
  const [editAbc, setEditAbc] = useState('')

  const unreviewedTunes = useInfiniteQuery({
    queryKey: ['moderator-unreviewed-tunes'],
    queryFn: ({ pageParam = 1 }) => getUnreviewedTunes(pageParam, 25),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: !!profile?.isModerator,
  })

  const unreviewedGroups = useInfiniteQuery({
    queryKey: ['moderator-unreviewed-groups'],
    queryFn: ({ pageParam = 1 }) => getUnreviewedGroups(pageParam, 50),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: !!profile?.isModerator,
  })

  const allGroups = useInfiniteQuery({
    queryKey: ['moderator-all-groups'],
    queryFn: ({ pageParam = 1 }) => getModeratorGroups(pageParam, 50),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: !!profile?.isModerator && activeTab === 'all-groups',
  })

  const unreviewedTuneItems = unreviewedTunes.data?.pages.flatMap((p) => p.items) ?? []
  const unreviewedTunesTotal = unreviewedTunes.data?.pages[0]?.totalCount ?? 0
  const unreviewedGroupItems = unreviewedGroups.data?.pages.flatMap((p) => p.items) ?? []
  const unreviewedGroupsTotal = unreviewedGroups.data?.pages[0]?.totalCount ?? 0
  const allGroupItems = allGroups.data?.pages.flatMap((p) => p.items) ?? []

  const approveTuneMutation = useMutation({
    mutationFn: (tuneId: string) => approveTune(tuneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderator-unreviewed-tunes'] })
      showToast('Tune approved and published!', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to approve tune.', 'error'),
  })

  const approveGroupMutation = useMutation({
    mutationFn: (groupId: string) => approveGroup(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderator-unreviewed-groups'] })
      queryClient.invalidateQueries({ queryKey: ['moderator-all-groups'] })
      showToast('Group approved!', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to approve group.', 'error'),
  })

  const deleteTuneMutation = useMutation({
    mutationFn: (tuneId: string) => moderatorDeleteTune(tuneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderator-unreviewed-tunes'] })
      showToast('Tune deleted permanently.', 'info')
    },
    onError: (err: any) => showToast(err.message || 'Failed to delete tune.', 'error'),
  })

  const updateTuneMutation = useMutation({
    mutationFn: () => {
      if (!editingTune) throw new Error('No tune selected')
      const validation = validateAbc(editAbc)
      if (!validation.isValid) {
        throw new Error(validation.error || 'Invalid ABC notation.')
      }
      return moderatorUpdateTune(editingTune.tuneId, {
        title: editTitle.trim(),
        tuneType: editType.trim(),
        key: editKey.trim(),
        masterAbcText: validation.trimmedAbc,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderator-unreviewed-tunes'] })
      setEditingTune(null)
      showToast('Tune details updated.', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to update tune.', 'error'),
  })

  // Maintenance jobs report progress step by step: the backfill is a two-call sequence that can
  // run for minutes, so a bare spinner would leave the moderator unable to tell how far it got
  // if the second call fails.
  const [maintenanceLog, setMaintenanceLog] = useState<string[]>([])
  const appendLog = (line: string) => setMaintenanceLog((log) => [...log, line])

  const backfillMutation = useMutation({
    mutationFn: async () => {
      setMaintenanceLog(['Recomputing heuristics and match fingerprints across the library…'])
      const result = await moderatorRecomputeHeuristics()
      appendLog(`Recomputed ${result.tunesUpdated} tunes and ${result.settingsUpdated} settings.`)
      appendLog('Refreshing the in-memory match index…')
      await moderatorRefreshMatchIndex()
      appendLog('Match index refreshed. Newly fingerprinted tunes are now identifiable.')
      return result
    },
    onSuccess: (result) =>
      showToast(`Backfill complete: ${result.tunesUpdated} tunes, ${result.settingsUpdated} settings.`, 'success'),
    onError: (err: any) => {
      appendLog(`Failed: ${err?.message || 'Unknown error.'}`)
      showToast(err?.message || 'Backfill failed.', 'error')
    },
  })

  const refreshIndexMutation = useMutation({
    mutationFn: async () => {
      setMaintenanceLog(['Refreshing the in-memory match index…'])
      await moderatorRefreshMatchIndex()
      appendLog('Match index refreshed.')
    },
    onError: (err: any) => {
      appendLog(`Failed: ${err?.message || 'Unknown error.'}`)
      showToast(err?.message || 'Refresh failed.', 'error')
    },
    onSuccess: () => showToast('Match index refreshed.', 'success'),
  })

  const maintenanceBusy = backfillMutation.isPending || refreshIndexMutation.isPending

  // Bulk thesession.org migration state
  const [migrationRunning, setMigrationRunning] = useState(false)
  const [migrationDryRun, setMigrationDryRun] = useState(false)
  const [afterTuneId, setAfterTuneId] = useState(0)
  const [includeMissingSettings, setIncludeMissingSettings] = useState(true)
  const [migrationTotals, setMigrationTotals] = useState({
    totalInSource: 0,
    processed: 0,
    tunesCreated: 0,
    tunesSkipped: 0,
    tunesBackfilled: 0,
    settingsCreated: 0,
    settingsSkipped: 0,
  })
  const [migrationLog, setMigrationLog] = useState<string[]>([])
  const migrationStopRef = useRef(false)

  const appendMigrationLog = (line: string) =>
    setMigrationLog((prev) => [...prev.slice(-99), line])

  const runMigration = async (dryRun: boolean) => {
    if (migrationRunning || maintenanceBusy) return
    migrationStopRef.current = false
    setMigrationRunning(true)
    setMigrationDryRun(dryRun)

    let cursor = Math.max(0, Math.floor(afterTuneId) || 0)
    let isFirstBatch = cursor === 0
    const totals = {
      totalInSource: 0,
      processed: 0,
      tunesCreated: 0,
      tunesSkipped: 0,
      tunesBackfilled: 0,
      settingsCreated: 0,
      settingsSkipped: 0,
    }
    setMigrationTotals(totals)
    setMigrationLog([
      dryRun
        ? `Starting dry-run preview after TheSessionId ${cursor}…`
        : `Starting bulk migration after TheSessionId ${cursor}…`,
    ])

    try {
      while (!migrationStopRef.current) {
        const batch = await moderatorMigrateTheSession({
          afterTuneId: cursor,
          batchSize: 50,
          dryRun,
          refreshDataset: isFirstBatch,
          includeMissingSettingsForExistingTunes: includeMissingSettings,
        })
        isFirstBatch = false

        totals.totalInSource = batch.totalTunesInSource
        totals.processed += batch.processedInBatch
        totals.tunesCreated += batch.tunesCreated
        totals.tunesSkipped += batch.tunesSkippedExisting
        totals.tunesBackfilled += batch.tunesBackfilledId
        totals.settingsCreated += batch.settingsCreated
        totals.settingsSkipped += batch.settingsSkipped
        setMigrationTotals({ ...totals })

        cursor = batch.nextAfterTuneId
        setAfterTuneId(cursor)

        appendMigrationLog(
          `Batch through #${cursor}: +${batch.tunesCreated} tunes (${batch.tunesSkippedExisting} skipped, ${batch.tunesBackfilledId} IDs backfilled), +${batch.settingsCreated} settings (${batch.settingsSkipped} skipped). Remaining: ${batch.remainingTunes}`,
        )

        if (!batch.hasMore || batch.processedInBatch === 0) {
          if (!dryRun && (totals.tunesCreated > 0 || totals.settingsCreated > 0)) {
            appendMigrationLog('Refreshing the in-memory match index…')
            await moderatorRefreshMatchIndex()
            appendMigrationLog('Match index refreshed.')
            queryClient.invalidateQueries({ queryKey: ['tunes'] })
          }
          appendMigrationLog(dryRun ? 'Dry-run preview complete.' : 'Bulk migration complete!')
          showToast(
            dryRun
              ? `Dry run complete: ${totals.tunesCreated} new tunes, ${totals.settingsCreated} new settings.`
              : `Migration complete: ${totals.tunesCreated} tunes, ${totals.settingsCreated} settings added.`,
            'success',
          )
          break
        }
      }

      if (migrationStopRef.current) {
        appendMigrationLog(`Paused after TheSessionId ${cursor}. You can resume from this ID anytime.`)
        showToast(`Migration paused at TheSessionId ${cursor}.`, 'info')
      }
    } catch (err: any) {
      const msg = err?.message || 'Unknown error.'
      appendMigrationLog(`Failed at TheSessionId ${cursor}: ${msg}`)
      showToast(`Migration failed: ${msg}`, 'error')
    } finally {
      setMigrationRunning(false)
    }
  }

  const handleOpenEdit = (tune: ModeratorTuneData) => {
    setEditingTune(tune)
    setEditTitle(tune.title)
    setEditType(tune.tuneType)
    setEditKey(tune.key)
    setEditAbc(tune.masterAbcText)
  }

  if (!profile?.isModerator) {
    return (
      <section className="card" style={{ padding: '2rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}>
        <h2 style={{ color: 'var(--danger)' }}>🛡️ Access Restricted</h2>
        <p>You must be an authenticated Moderator (Azure Entra ID Group member) to view this dashboard.</p>
        <Link href="/" className="nav-pill" style={{ display: 'inline-block', marginTop: '1rem' }}>
          Back to Dashboard
        </Link>
      </section>
    )
  }

  return (
    <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '1rem 0' }}>
      {/* Header Banner */}
      <div
        className="card"
        style={{
          padding: '1.75rem',
          marginBottom: '1.5rem',
          background: 'var(--auth-panel-bg)',
          border: '1px solid var(--accent)',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🛡️ Moderator Command Center</span>
            </h1>
            <p style={{ margin: '0.5rem 0 0 0', color: 'var(--muted)', fontSize: '0.95rem' }}>
              Review recent user submissions, approve pending tunes and groups, inspect private groups, and moderate content.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span className="badge badge-active" style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>
              Verified Moderator
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        <button
          className={`nav-pill ${activeTab === 'tunes' ? 'active' : ''}`}
          onClick={() => setActiveTab('tunes')}
          style={{ cursor: 'pointer' }}
        >
          🎵 Unreviewed Tunes ({unreviewedTunesTotal})
        </button>
        <button
          className={`nav-pill ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
          style={{ cursor: 'pointer' }}
        >
          👥 Unreviewed Groups ({unreviewedGroupsTotal})
        </button>
        <button
          className={`nav-pill ${activeTab === 'all-groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('all-groups')}
          style={{ cursor: 'pointer' }}
        >
          🌐 All & Private Groups Directory
        </button>
        <button
          className={`nav-pill ${activeTab === 'maintenance' ? 'active' : ''}`}
          onClick={() => setActiveTab('maintenance')}
          style={{ cursor: 'pointer' }}
        >
          🛠️ Maintenance
        </button>
      </div>

      {/* TAB 1: UNREVIEWED TUNES */}
      {activeTab === 'tunes' && (
        <div>
          {unreviewedTunes.isLoading ? (
            <div className="spinner-row"><Spinner /></div>
          ) : unreviewedTunes.isError ? (
            <p className="error">Failed to load unreviewed tunes.</p>
          ) : unreviewedTuneItems.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
              <p style={{ fontSize: '1.1rem', margin: 0 }}>🎉 All submitted tunes have been reviewed!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {unreviewedTuneItems.map((tune) => (
                <div key={tune.tuneId} className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--rust)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <h3 style={{ margin: '0 0 0.25rem 0' }}>
                        <Link href={`/tunes/${tune.tuneId}`} prefetch={false} className="quiet-link">
                          {tune.title}
                        </Link>
                      </h3>
                      <span className="tune-meta">
                        {formatTuneType(tune.tuneType)} · Key: {tune.key} · Submitted {new Date(tune.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="primary"
                        onClick={() => approveTuneMutation.mutate(tune.tuneId)}
                        disabled={approveTuneMutation.isPending}
                      >
                        ✓ Approve & Publish
                      </button>
                      <button
                        className="secondary"
                        onClick={() => handleOpenEdit(tune)}
                      >
                        ✏️ Edit Master ABC
                      </button>
                      <button
                        className="secondary danger-hover"
                        onClick={() => {
                          if (confirm(`Are you sure you want to permanently delete "${tune.title}"?`)) {
                            deleteTuneMutation.mutate(tune.tuneId)
                          }
                        }}
                        disabled={deleteTuneMutation.isPending}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: '1rem', background: 'var(--sunken-bg)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
                    {tune.masterAbcText}
                  </div>
                </div>
              ))}
              {unreviewedTunes.hasNextPage && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => unreviewedTunes.fetchNextPage()}
                  disabled={unreviewedTunes.isFetchingNextPage}
                >
                  {unreviewedTunes.isFetchingNextPage ? 'Loading more…' : 'Load more unreviewed tunes'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: UNREVIEWED GROUPS */}
      {activeTab === 'groups' && (
        <div>
          {unreviewedGroups.isLoading ? (
            <div className="spinner-row"><Spinner /></div>
          ) : unreviewedGroups.isError ? (
            <p className="error">Failed to load unreviewed groups.</p>
          ) : unreviewedGroupItems.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
              <p style={{ fontSize: '1.1rem', margin: 0 }}>🎉 All newly created groups have been reviewed!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {unreviewedGroupItems.map((group) => (
                <div key={group.groupId} className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--brand-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <h3 style={{ margin: '0 0 0.25rem 0' }}>
                        <Link href={`/group/${group.groupId}`} prefetch={false} className="quiet-link">
                          {group.isPrivate ? '🔒 ' : ''}{group.name}
                        </Link>
                      </h3>
                      <span className="tune-meta">
                        📍 {group.city ?? 'No location'} · {group.isPrivate ? 'Private' : 'Public'} · {group.memberCount} members · Created {new Date(group.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="primary"
                        onClick={() => approveGroupMutation.mutate(group.groupId)}
                        disabled={approveGroupMutation.isPending}
                      >
                        ✓ Mark Reviewed & Approved
                      </button>
                      <Link href={`/group/${group.groupId}`} className="secondary" prefetch={false}>
                        🔍 Inspect Group
                      </Link>
                    </div>
                  </div>

                  {group.description && (
                    <p style={{ marginTop: '0.75rem', marginBottom: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
                      {group.description}
                    </p>
                  )}
                </div>
              ))}
              {unreviewedGroups.hasNextPage && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => unreviewedGroups.fetchNextPage()}
                  disabled={unreviewedGroups.isFetchingNextPage}
                >
                  {unreviewedGroups.isFetchingNextPage ? 'Loading more…' : 'Load more unreviewed groups'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ALL & PRIVATE GROUPS DIRECTORY */}
      {activeTab === 'all-groups' && (
        <div>
          {allGroups.isLoading ? (
            <div className="spinner-row"><Spinner /></div>
          ) : allGroups.isError ? (
            <p className="error">Failed to load groups directory.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {allGroupItems.map((group) => (
                <div key={group.groupId} className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <h3 style={{ margin: '0 0 0.25rem 0' }}>
                        <Link href={`/group/${group.groupId}`} prefetch={false} className="quiet-link">
                          {group.isPrivate ? '🔒 ' : ''}{group.name}
                        </Link>
                      </h3>
                      <span className="tune-meta">
                        📍 {group.city ?? 'No location'} · {group.isPrivate ? 'Private Group' : 'Public Group'} · {group.memberCount} members · Status: {group.isReviewed ? '✅ Reviewed' : '⏳ Pending Review'}
                      </span>
                    </div>

                    <Link href={`/group/${group.groupId}`} className="secondary" prefetch={false}>
                      Inspect Group
                    </Link>
                  </div>
                </div>
              ))}
              {allGroups.hasNextPage && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => allGroups.fetchNextPage()}
                  disabled={allGroups.isFetchingNextPage}
                >
                  {allGroups.isFetchingNextPage ? 'Loading more…' : 'Load more groups'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: MAINTENANCE */}
      {activeTab === 'maintenance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ margin: '0 0 0.5rem 0' }}>🎯 Tune identification backfill</h3>
            <p style={{ margin: '0 0 0.75rem 0', color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Recomputes the melodic heuristics and match fingerprint for every tune and setting from its
              ABC, then rebuilds the in-memory match index. Every write path already does this for new
              tunes, so this is only needed for rows written before a fingerprint was stored at all, or
              after a release changes how fingerprints are built — a tune keeps whatever was stored when
              it was last written, and a stale fingerprint quietly stops matching.
            </p>
            <p style={{ margin: '0 0 1rem 0', color: 'var(--muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
              Safe to re-run — it recomputes from each tune&apos;s existing ABC rather than changing it. It
              rewrites the whole library though, so it can take several minutes on a large one. The
              backfill marks the library as changed, so every server instance rebuilds its index within
              about fifteen seconds either way; the refresh below just makes it immediate on the instance
              that handles the request.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="primary"
                disabled={maintenanceBusy}
                onClick={() => {
                  if (confirm('Recompute heuristics and fingerprints for every tune and setting? This can take several minutes.')) {
                    backfillMutation.mutate()
                  }
                }}
              >
                {backfillMutation.isPending ? 'Running…' : '▶ Run backfill & refresh index'}
              </button>
              <button
                className="secondary"
                disabled={maintenanceBusy}
                onClick={() => refreshIndexMutation.mutate()}
              >
                {refreshIndexMutation.isPending ? 'Refreshing…' : '🔄 Refresh match index only'}
              </button>
            </div>

            {maintenanceLog.length > 0 && (
              <div
                style={{
                  marginTop: '1rem',
                  background: 'var(--sunken-bg)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                {maintenanceLog.map((line, i) => (
                  <div key={i} style={{ color: line.startsWith('Failed:') ? 'var(--danger)' : 'var(--muted)' }}>
                    {line}
                  </div>
                ))}
                {maintenanceBusy && (
                  <div className="spinner-row" style={{ justifyContent: 'flex-start', marginTop: '0.25rem' }}>
                    <Spinner />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--brand-2)' }}>
            <h3 style={{ margin: '0 0 0.5rem 0' }}>📥 Migrate thesession.org Tune Library</h3>
            <p style={{ margin: '0 0 0.75rem 0', color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Imports all tunes and alternate settings from <code>adactio/TheSession-data/json/tunes.json</code> in
              resumable batches, normalizing titles (&ldquo;Name, The&rdquo; → &ldquo;The Name&rdquo;), keys, ABC
              headers, and melodic fingerprints while preserving existing tunes and settings.
            </p>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                Resume after Tune ID:
                <input
                  type="number"
                  min={0}
                  value={afterTuneId}
                  disabled={migrationRunning}
                  onChange={(e) => setAfterTuneId(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: '110px' }}
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={includeMissingSettings}
                  disabled={migrationRunning}
                  onChange={(e) => setIncludeMissingSettings(e.target.checked)}
                />
                Add missing alternate settings to existing tunes
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="secondary"
                disabled={migrationRunning || maintenanceBusy}
                onClick={() => runMigration(true)}
              >
                {migrationRunning && migrationDryRun ? 'Running dry run…' : '🔍 Dry Run Preview'}
              </button>
              <button
                className="primary"
                disabled={migrationRunning || maintenanceBusy}
                onClick={() => {
                  if (confirm(`Start bulk migration from TheSessionId > ${afterTuneId}?`)) {
                    runMigration(false)
                  }
                }}
              >
                {migrationRunning && !migrationDryRun ? 'Migrating…' : '▶ Run Bulk Migration'}
              </button>
              {migrationRunning && (
                <button
                  className="secondary danger-hover"
                  onClick={() => {
                    migrationStopRef.current = true
                  }}
                >
                  ⏸ Pause after current batch
                </button>
              )}
            </div>

            {migrationTotals.totalInSource > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>
                  <span>
                    Processed {migrationTotals.processed.toLocaleString()} / {migrationTotals.totalInSource.toLocaleString()} source tunes
                  </span>
                  <span>
                    +{migrationTotals.tunesCreated.toLocaleString()} tunes ({migrationTotals.tunesSkipped.toLocaleString()} existing, {migrationTotals.tunesBackfilled.toLocaleString()} backfilled) · +{migrationTotals.settingsCreated.toLocaleString()} settings ({migrationTotals.settingsSkipped.toLocaleString()} skipped)
                  </span>
                </div>
                <progress
                  value={migrationTotals.processed}
                  max={migrationTotals.totalInSource}
                  style={{ width: '100%', height: '8px' }}
                />
              </div>
            )}

            {migrationLog.length > 0 && (
              <div
                style={{
                  marginTop: '1rem',
                  background: 'var(--sunken-bg)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  maxHeight: '240px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                {migrationLog.map((line, i) => (
                  <div key={i} style={{ color: line.startsWith('Failed') ? 'var(--danger)' : 'var(--muted)' }}>
                    {line}
                  </div>
                ))}
                {migrationRunning && (
                  <div className="spinner-row" style={{ justifyContent: 'flex-start', marginTop: '0.25rem' }}>
                    <Spinner />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT TUNE MODAL */}
      {editingTune && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-card" style={{ maxWidth: '650px', width: '100%', padding: '1.75rem' }}>
            <h2 style={{ marginTop: 0 }}>Edit Master Tune: {editingTune.title}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Title</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Tune Type</label>
                  <input type="text" value={editType} onChange={(e) => setEditType(e.target.value)} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Key</label>
                  <input type="text" value={editKey} onChange={(e) => setEditKey(e.target.value)} required />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Master ABC Notation</label>
                <textarea
                  rows={8}
                  value={editAbc}
                  onChange={(e) => setEditAbc(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical' }}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="secondary" onClick={() => setEditingTune(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => updateTuneMutation.mutate()}
                  disabled={updateTuneMutation.isPending || !editTitle.trim() || !editAbc.trim()}
                >
                  {updateTuneMutation.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
