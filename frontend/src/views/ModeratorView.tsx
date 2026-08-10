"use client";

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  getUnreviewedTunes,
  getUnreviewedGroups,
  getModeratorGroups,
  approveTune,
  approveGroup,
  moderatorUpdateTune,
  moderatorDeleteTune,
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
  const [activeTab, setActiveTab] = useState<'tunes' | 'groups' | 'all-groups'>('tunes')

  // Edit Tune Modal State
  const [editingTune, setEditingTune] = useState<ModeratorTuneData | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState('')
  const [editKey, setEditKey] = useState('')
  const [editAbc, setEditAbc] = useState('')

  const unreviewedTunes = useQuery({
    queryKey: ['moderator-unreviewed-tunes'],
    queryFn: getUnreviewedTunes,
    enabled: !!profile?.isModerator,
  })

  const unreviewedGroups = useQuery({
    queryKey: ['moderator-unreviewed-groups'],
    queryFn: getUnreviewedGroups,
    enabled: !!profile?.isModerator,
  })

  const allGroups = useQuery({
    queryKey: ['moderator-all-groups'],
    queryFn: getModeratorGroups,
    enabled: !!profile?.isModerator && activeTab === 'all-groups',
  })

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
        <h2 style={{ color: '#ef6461' }}>🛡️ Access Restricted</h2>
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
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)',
          border: '1px solid rgba(77, 208, 165, 0.3)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🛡️ Moderator Command Center</span>
            </h1>
            <p style={{ margin: '0.5rem 0 0 0', color: '#94a3b8', fontSize: '0.95rem' }}>
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
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.5rem' }}>
        <button
          className={`nav-pill ${activeTab === 'tunes' ? 'active' : ''}`}
          onClick={() => setActiveTab('tunes')}
          style={{ cursor: 'pointer' }}
        >
          🎵 Unreviewed Tunes ({unreviewedTunes.data?.length ?? 0})
        </button>
        <button
          className={`nav-pill ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
          style={{ cursor: 'pointer' }}
        >
          👥 Unreviewed Groups ({unreviewedGroups.data?.length ?? 0})
        </button>
        <button
          className={`nav-pill ${activeTab === 'all-groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('all-groups')}
          style={{ cursor: 'pointer' }}
        >
          🌐 All & Private Groups Directory
        </button>
      </div>

      {/* TAB 1: UNREVIEWED TUNES */}
      {activeTab === 'tunes' && (
        <div>
          {unreviewedTunes.isLoading ? (
            <div className="spinner-row"><Spinner /></div>
          ) : unreviewedTunes.isError ? (
            <p className="error">Failed to load unreviewed tunes.</p>
          ) : unreviewedTunes.data?.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              <p style={{ fontSize: '1.1rem', margin: 0 }}>🎉 All submitted tunes have been reviewed!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {unreviewedTunes.data?.map((tune) => (
                <div key={tune.tuneId} className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #f59e0b' }}>
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

                  <div style={{ marginTop: '1rem', background: '#090d16', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
                    {tune.masterAbcText}
                  </div>
                </div>
              ))}
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
          ) : unreviewedGroups.data?.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              <p style={{ fontSize: '1.1rem', margin: 0 }}>🎉 All newly created groups have been reviewed!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {unreviewedGroups.data?.map((group) => (
                <div key={group.groupId} className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #3b82f6' }}>
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
                    <p style={{ marginTop: '0.75rem', marginBottom: 0, color: '#cbd5e1', fontSize: '0.9rem' }}>
                      {group.description}
                    </p>
                  )}
                </div>
              ))}
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
              {allGroups.data?.map((group) => (
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
            </div>
          )}
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
