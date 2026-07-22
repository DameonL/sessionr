"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  getTuneDetails,
  addTuneSetting,
  addTuneAlias,
  voteTuneSetting,
  addToRepertoire,
  formatTuneType,
} from '../services/api'
import { currentUserId, useAuthStatus, useSignal } from '../state/appState'

// Dynamically import TunePlayer to prevent abcjs SSR errors
const TunePlayer = dynamic(() => import('../components/TunePlayer').then((m) => m.TunePlayer), { ssr: false })

/** Public, login-agnostic tune page: view every setting, play and practice along, no account needed. */
export function TuneLibraryDetail({ tuneId }: { tuneId?: string }) {
  const id = tuneId ?? ''
  const userId = useSignal(currentUserId)
  const authStatus = useAuthStatus()
  const showSignedInUi = authStatus !== 'anonymous'
  const queryClient = useQueryClient()

  // undefined = no explicit user choice yet (show the first/most-popular setting);
  // null = user explicitly hid the player; string = user explicitly picked that setting.
  const [practicingSettingId, setPracticingSettingId] = useState<string | null | undefined>(undefined)
  const [showNewSettingForm, setShowNewSettingForm] = useState(false)
  const [newSettingKey, setNewSettingKey] = useState('')
  const [newSettingAbc, setNewSettingAbc] = useState('')
  const [newSettingSubmitter, setNewSettingSubmitter] = useState('')
  const [settingError, setSettingError] = useState<string | null>(null)
  const [newAliasName, setNewAliasName] = useState('')
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [addedMessage, setAddedMessage] = useState<string | null>(null)

  const { data: details, isLoading, isError, refetch } = useQuery({
    queryKey: ['tune-details', id, userId],
    queryFn: () => getTuneDetails(id, userId),
  })

  const voteMutation = useMutation({
    mutationFn: ({ settingId, value }: { settingId: string; value: number }) =>
      voteTuneSetting(settingId, value),
    onSuccess: () => refetch(),
  })

  const addSettingMutation = useMutation({
    mutationFn: (newSetting: { key: string; abc: string; submitterName: string }) =>
      addTuneSetting(id, newSetting.key, newSetting.abc, newSetting.submitterName),
    onSuccess: () => {
      refetch()
      setNewSettingKey('')
      setNewSettingAbc('')
      setNewSettingSubmitter('')
      setShowNewSettingForm(false)
      setSettingError(null)
    },
    onError: (err) => setSettingError(err.message || 'Failed to submit setting.'),
  })

  const addAliasMutation = useMutation({
    mutationFn: (name: string) => addTuneAlias(id, name),
    onSuccess: () => {
      refetch()
      setNewAliasName('')
      setAliasError(null)
    },
    onError: (err) => setAliasError(err.message || 'Failed to add alternate name.'),
  })

  const addToRepertoireMutation = useMutation({
    mutationFn: (settingId: string) => addToRepertoire(id, settingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
      setAddedMessage('Added to your repertoire!')
    },
  })

  const handleVote = (settingId: string, currentVote: number, targetVote: number) => {
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
    return <p>Loading…</p>
  }
  if (isError || !details) {
    return (
      <section>
        <p className="error">Could not load this tune.</p>
        <Link href="/tunes">← Back to Tune Library</Link>
      </section>
    )
  }

  return (
    <section>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/tunes">← Tune Library</Link>
      </div>

      <div className="set-header">
        <div>
          <h1 style={{ margin: 0 }}>{details.title}</h1>
          <span className="tune-meta">{formatTuneType(details.tuneType)} · {details.key}</span>
        </div>
      </div>

      {/* Alternate Names */}
      <div className="modal-section alternate-names-section" style={{ marginTop: '1.5rem' }}>
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

      {/* Settings */}
      <div className="modal-section" style={{ marginTop: '1.5rem' }}>
        <h3>Settings</h3>
        <p className="tune-meta italic">
          {showSignedInUi
            ? 'Play a setting to practice along, or add it to your repertoire.'
            : 'Play any setting to practice along. Sign in to vote or add a setting to your own repertoire.'}
        </p>

        {addedMessage && <p className="tune-meta">{addedMessage}</p>}

        <div className="settings-list-container">
          {details.settings.map((s, index) => {
            const isPracticing =
              practicingSettingId === undefined ? index === 0 : practicingSettingId === s.tuneSettingId
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
                    <div className="vote-controls">
                      <button
                        className={`vote-btn upvote-btn ${hasUpvoted ? 'active' : ''}`}
                        onClick={() => handleVote(s.tuneSettingId, s.userVoteValue, 1)}
                        disabled={!showSignedInUi || voteMutation.isPending}
                        title={showSignedInUi ? 'Upvote' : 'Sign in to vote'}
                      >
                        ▲
                      </button>
                      <span className="vote-score">{s.voteScore}</span>
                      <button
                        className={`vote-btn downvote-btn ${hasDownvoted ? 'active' : ''}`}
                        onClick={() => handleVote(s.tuneSettingId, s.userVoteValue, -1)}
                        disabled={!showSignedInUi || voteMutation.isPending}
                        title={showSignedInUi ? 'Downvote' : 'Sign in to vote'}
                      >
                        ▼
                      </button>
                    </div>

                    <button
                      className="preview-btn secondary"
                      onClick={() => setPracticingSettingId(isPracticing ? null : s.tuneSettingId)}
                    >
                      {isPracticing ? 'Hide Player' : '▶ Play & Practice'}
                    </button>

                    {showSignedInUi ? (
                      <button
                        className="add-setting-action"
                        onClick={() => addToRepertoireMutation.mutate(s.tuneSettingId)}
                        disabled={addToRepertoireMutation.isPending}
                      >
                        + Add to Repertoire
                      </button>
                    ) : (
                      <Link href="/login">
                        <button className="secondary" title="Sign in to add this to your repertoire">
                          Sign in to add
                        </button>
                      </Link>
                    )}
                  </div>
                </div>

                {isPracticing && (
                  <div className="setting-sheet-preview">
                    <TunePlayer abc={s.abcText} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Submit a new setting */}
      <div className="modal-section submit-setting-section" style={{ marginTop: '1.5rem' }}>
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
    </section>
  )
}
