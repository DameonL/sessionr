"use client";

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import {
  getTuneDetails,
  addTuneSetting,
  addTuneAlias,
  voteTuneSetting,
  addToRepertoire,
  updateUserTune,
  formatTuneType,
} from '../services/api'

// Dynamically import SheetMusic to prevent abcjs SSR errors
const SheetMusic = dynamic(() => import('./SheetMusic').then((m) => m.SheetMusic), { ssr: false })

interface TuneSettingsModalProps {
  tuneId: string
  userId: string
  onClose: () => void
  onAdded: () => void
  userTuneId?: string
  /** Overrides the default repertoire add/switch action (e.g. for a group's master tune list). */
  onSelectSetting?: (settingId: string) => Promise<unknown>
  /** Label for the per-setting action button; defaults based on userTuneId/onSelectSetting. */
  actionLabel?: string
}

export function TuneSettingsModal({
  tuneId,
  userId,
  onClose,
  onAdded,
  userTuneId,
  onSelectSetting,
  actionLabel,
}: TuneSettingsModalProps) {
  const queryClient = useQueryClient()
  // undefined = no explicit user choice yet (show the first/most-popular setting);
  // null = user explicitly collapsed everything; string = user explicitly expanded that setting.
  const [previewSettingId, setPreviewSettingId] = useState<string | null | undefined>(undefined)
  
  // Submit new setting states
  const [showNewSettingForm, setShowNewSettingForm] = useState(false)
  const [newSettingKey, setNewSettingKey] = useState('')
  const [newSettingAbc, setNewSettingAbc] = useState('')
  const [newSettingSubmitter, setNewSettingSubmitter] = useState('')
  const [settingError, setSettingError] = useState<string | null>(null)

  // Submit new alias states
  const [newAliasName, setNewAliasName] = useState('')
  const [aliasError, setAliasError] = useState<string | null>(null)

  // Fetch full details of the tune
  const { data: details, isLoading, isError, refetch } = useQuery({
    queryKey: ['tune-details', tuneId, userId],
    queryFn: () => getTuneDetails(tuneId, userId),
  })

  // Add or switch setting mutation
  const actionMutation = useMutation({
    mutationFn: (settingId: string) => {
      if (onSelectSetting) {
        return onSelectSetting(settingId)
      } else if (userTuneId !== undefined) {
        return updateUserTune(userTuneId, { tuneSettingId: settingId })
      } else {
        return addToRepertoire(tuneId, settingId)
      }
    },
    onSuccess: () => {
      onAdded()
      onClose()
    },
  })

  // Vote setting mutation
  const voteMutation = useMutation({
    mutationFn: ({ settingId, value }: { settingId: string; value: number }) =>
      voteTuneSetting(settingId, value),
    onSuccess: () => {
      refetch()
    },
  })

  // Add setting mutation
  const addSettingMutation = useMutation({
    mutationFn: (newSetting: { key: string; abc: string; submitterName: string }) =>
      addTuneSetting(tuneId, newSetting.key, newSetting.abc, newSetting.submitterName),
    onSuccess: () => {
      refetch()
      setNewSettingKey('')
      setNewSettingAbc('')
      setNewSettingSubmitter('')
      setShowNewSettingForm(false)
      setSettingError(null)
    },
    onError: (err) => {
      setSettingError(err.message || 'Failed to submit setting.')
    },
  })

  // Add alias mutation
  const addAliasMutation = useMutation({
    mutationFn: (name: string) => addTuneAlias(tuneId, name),
    onSuccess: () => {
      refetch()
      setNewAliasName('')
      setAliasError(null)
    },
    onError: (err) => {
      setAliasError(err.message || 'Failed to add alternate name.')
    },
  })

  const handleVote = (settingId: string, currentVote: number, targetVote: number) => {
    // If clicking same vote, toggle it off (value = 0)
    const nextVoteValue = currentVote === targetVote ? 0 : targetVote
    voteMutation.mutate({ settingId, value: nextVoteValue })
  }

  const handleSettingSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSettingKey.trim() || !newSettingAbc.trim()) {
      setSettingError('Key and ABC notation text are required.')
      return
    }
    addSettingMutation.mutate({
      key: newSettingKey.trim(),
      abc: newSettingAbc,
      submitterName: newSettingSubmitter.trim() || 'Anonymous',
    })
  }

  const handleAliasSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAliasName.trim()) return
    addAliasMutation.mutate(newAliasName.trim())
  }

  if (isLoading) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-content card" onClick={(e) => e.stopPropagation()}>
          <p>Loading tune details…</p>
        </div>
      </div>
    )
  }

  if (isError || !details) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-content card" onClick={(e) => e.stopPropagation()}>
          <p className="error">Could not load tune details.</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content card tune-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h1 style={{ margin: 0 }}>{details.title}</h1>
            <span className="tune-meta">{formatTuneType(details.tuneType)}</span>
          </div>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        {/* Alternate Names Section */}
        <div className="modal-section alternate-names-section">
          <h3>Alternate Names</h3>
          <div className="alias-container">
            {details.aliases.length === 0 ? (
              <span className="tune-meta italic">No alternate names registered yet.</span>
            ) : (
              details.aliases.map((alias, i) => (
                <span key={i} className="badge badge-learning alias-badge">{alias}</span>
              ))
            )}
          </div>

          <form onSubmit={handleAliasSubmit} className="add-alias-form" style={{ marginTop: '0.75rem' }}>
            <input
              type="text"
              placeholder="Add alternate name..."
              value={newAliasName}
              onChange={(e) => setNewAliasName(e.target.value)}
              disabled={addAliasMutation.isPending}
              style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
            />
            <button type="submit" disabled={addAliasMutation.isPending || !newAliasName.trim()}>
              + Add Name
            </button>
          </form>
          {aliasError && <p className="error" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{aliasError}</p>}
        </div>

        {/* Settings List */}
        <div className="modal-section">
          <h3>Select a Setting to Add</h3>
          <div className="settings-list-container">
            {details.settings.map((s, index) => {
              const isPreviewed =
                previewSettingId === undefined ? index === 0 : previewSettingId === s.tuneSettingId
              const hasUpvoted = s.userVoteValue === 1
              const hasDownvoted = s.userVoteValue === -1

              return (
                <div key={s.tuneSettingId} className="setting-card">
                  <div className="setting-card-header">
                    <div>
                      <span className="setting-key-badge">Key: {s.key}</span>
                      <span className="setting-submitter text-muted">by {s.submitterName}</span>
                    </div>

                    <div className="setting-actions">
                      {/* Voting buttons */}
                      <div className="vote-controls">
                        <button
                          className={`vote-btn upvote-btn ${hasUpvoted ? 'active' : ''}`}
                          onClick={() => handleVote(s.tuneSettingId, s.userVoteValue, 1)}
                          title="Upvote"
                        >
                          ▲
                        </button>
                        <span className="vote-score">{s.voteScore}</span>
                        <button
                          className={`vote-btn downvote-btn ${hasDownvoted ? 'active' : ''}`}
                          onClick={() => handleVote(s.tuneSettingId, s.userVoteValue, -1)}
                          title="Downvote"
                        >
                          ▼
                        </button>
                      </div>

                      <button
                        className="preview-btn secondary"
                        onClick={() => setPreviewSettingId(isPreviewed ? null : s.tuneSettingId)}
                      >
                        {isPreviewed ? 'Hide Sheet' : 'Preview'}
                      </button>

                      <button
                        className="add-setting-action"
                        onClick={() => actionMutation.mutate(s.tuneSettingId)}
                        disabled={actionMutation.isPending}
                      >
                        {actionLabel ?? (userTuneId !== undefined ? 'Switch to this setting' : '+ Add this setting')}
                      </button>
                    </div>
                  </div>

                  {/* Sheet Music Preview */}
                  {isPreviewed && (
                    <div className="setting-sheet-preview">
                      <SheetMusic abcString={s.abcText} />
                      <pre className="abc-code-block">{s.abcText}</pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Submit Setting Section */}
        <div className="modal-section submit-setting-section">
          {!showNewSettingForm ? (
            <button className="secondary w-full" onClick={() => setShowNewSettingForm(true)}>
              + Submit an Alternate Setting
            </button>
          ) : (
            <form onSubmit={handleSettingSubmit} className="new-setting-form">
              <h4>Submit alternate setting</h4>
              <div className="form-row">
                <label>
                  Key
                  <input
                    type="text"
                    placeholder="e.g. G"
                    value={newSettingKey}
                    onChange={(e) => setNewSettingKey(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Submitter Name
                  <input
                    type="text"
                    placeholder="e.g. Seamus"
                    value={newSettingSubmitter}
                    onChange={(e) => setNewSettingSubmitter(e.target.value)}
                  />
                </label>
              </div>
              <label>
                ABC Notation
                <textarea
                  placeholder="Paste ABC text here..."
                  value={newSettingAbc}
                  onChange={(e) => setNewSettingAbc(e.target.value)}
                  rows={6}
                  required
                />
              </label>

              {settingError && <p className="error">{settingError}</p>}

              <div className="form-actions">
                <button type="button" className="secondary" onClick={() => setShowNewSettingForm(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={addSettingMutation.isPending}>
                  Submit Setting
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
