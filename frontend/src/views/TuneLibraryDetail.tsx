"use client";

import { lazy, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import dynamic from '@/utils/routerCompat'
import {
  getTuneDetails,
  getMyTuneVotes,
  voteTuneSetting,
  addToRepertoire,
  formatTuneType,
  moderatorDeleteTune,
  moderatorUpdateTune,
  moderatorDeleteTuneSetting,
  moderatorDeleteTuneAlias,
} from '../services/api'
import { currentUserId, currentUserProfile, useAuthStatus, useSignal, showToast } from '../state/appState'
import { useRouter } from '@/utils/routerCompat'
import { Spinner } from '../components/Spinner'
import { Dialog } from '../components/Dialog'
import { NewSettingForm } from '../components/NewSettingForm'
import { TuneAliases } from '../components/TuneAliases'


// Dynamically import TunePlayer to prevent abcjs SSR errors
const TunePlayer = lazy(() => import('../components/TunePlayer').then((m) => ({ default: m.TunePlayer })))

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
  const [newSettingKey, setNewSettingKey] = useState('')
  const [newSettingSubmitter, setNewSettingSubmitter] = useState('')
  const [addedMessage, setAddedMessage] = useState<string | null>(null)

  const profile = useSignal(currentUserProfile)
  const isModerator = !!profile?.isModerator
  const router = useRouter()

  const [showEditModal, setShowEditModal] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState('')
  const [editKey, setEditKey] = useState('')
  const [editAbc, setEditAbc] = useState('')

  const { data: details, isPending, isError, refetch } = useQuery({
    queryKey: ['tune-details', id],
    queryFn: () => getTuneDetails(id),
    enabled: authStatus !== 'pending',
  })

  const { data: myVotes, refetch: refetchMyVotes } = useQuery({
    queryKey: ['tune-my-votes', id],
    queryFn: () => getMyTuneVotes(id),
    enabled: showSignedInUi && !!id,
  })

  const deleteTuneMutation = useMutation({
    mutationFn: () => moderatorDeleteTune(id),
    onSuccess: () => {
      showToast('Tune deleted permanently.', 'info')
      router.push('/tunes')
    },
    onError: (err: any) => showToast(err.message || 'Failed to delete tune.', 'error'),
  })

  const deleteSettingMutation = useMutation({
    mutationFn: (settingId: string) => moderatorDeleteTuneSetting(settingId),
    onSuccess: () => {
      refetch()
      showToast('Setting deleted.', 'info')
    },
    onError: (err: any) => showToast(err.message || 'Failed to delete setting.', 'error'),
  })

  const updateTuneMutation = useMutation({
    mutationFn: () => moderatorUpdateTune(id, { title: editTitle.trim(), tuneType: editType.trim(), key: editKey.trim(), masterAbcText: editAbc }),
    onSuccess: () => {
      refetch()
      setShowEditModal(false)
      showToast('Master tune updated.', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to update tune.', 'error'),
  })

  const voteMutation = useMutation({
    mutationFn: ({ settingId, value }: { settingId: string; value: number }) =>
      voteTuneSetting(settingId, value),
    onSuccess: () => {
      refetch()
      refetchMyVotes()
    },
  })

  const addToRepertoireMutation = useMutation({
    mutationFn: (settingId: string) => addToRepertoire(id, settingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
      setAddedMessage('Added to your repertoire!')
    },
  })

  const handleVote = (settingId: string, currentVote: number, targetVote: number) => {
    const activeVote = myVotes?.[settingId] ?? currentVote
    const nextVoteValue = activeVote === targetVote ? 0 : targetVote
    voteMutation.mutate({ settingId, value: nextVoteValue })
  }

  if (isPending) {
    return <div className="spinner-row"><Spinner /></div>
  }
  if (isError || !details) {
    return (
      <section>
        <p className="error">Could not load this tune.</p>
        <Link href="/tunes" prefetch={false}>← Back to Tune Library</Link>
      </section>
    )
  }

  return (
    <section>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/tunes" prefetch={false}>← Tune Library</Link>
      </div>

      <div className="set-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>{details.title}</h1>
          <span className="tune-meta">{formatTuneType(details.tuneType)} · {details.key}</span>
        </div>

        {isModerator && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="secondary"
              onClick={() => {
                setEditTitle(details.title)
                setEditType(details.tuneType)
                setEditKey(details.key)
                setEditAbc(details.settings[0]?.abcText ?? '')
                setShowEditModal(true)
              }}
            >
              ✏️ Edit Master Tune
            </button>
            <button
              className="secondary danger-hover"
              onClick={() => {
                if (confirm(`Are you sure you want to permanently delete "${details.title}"?`)) {
                  deleteTuneMutation.mutate()
                }
              }}
              disabled={deleteTuneMutation.isPending}
            >
              🗑️ Delete Tune
            </button>
          </div>
        )}
      </div>

      <Dialog
        isOpen={showEditModal}
        title={`Edit Master Tune: ${details.title}`}
        onClose={() => setShowEditModal(false)}
        maxWidth="650px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label>
            Title
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              Tune Type
              <input type="text" value={editType} onChange={(e) => setEditType(e.target.value)} required />
            </label>
            <label>
              Key
              <input type="text" value={editKey} onChange={(e) => setEditKey(e.target.value)} required />
            </label>
          </div>
          <label>
            Master ABC Notation
            <textarea
              className="abc-textarea"
              rows={8}
              value={editAbc}
              onChange={(e) => setEditAbc(e.target.value)}
              required
            />
          </label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setShowEditModal(false)}>
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
      </Dialog>

      <TuneAliases
        tuneId={id}
        aliases={details.aliases}
        onAdded={refetch}
        style={{ marginTop: '1.5rem' }}
      />

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
            const userVoteValue = myVotes?.[s.tuneSettingId] ?? s.userVoteValue ?? 0
            const hasUpvoted = userVoteValue === 1
            const hasDownvoted = userVoteValue === -1

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
                        onClick={() => handleVote(s.tuneSettingId, userVoteValue, 1)}
                        disabled={!showSignedInUi || voteMutation.isPending}
                        title={showSignedInUi ? 'Upvote' : 'Sign in to vote'}
                      >
                        ▲
                      </button>
                      <span className="vote-score">{s.voteScore}</span>
                      <button
                        className={`vote-btn downvote-btn ${hasDownvoted ? 'active' : ''}`}
                        onClick={() => handleVote(s.tuneSettingId, userVoteValue, -1)}
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
                      <Link href="/login" prefetch={false}>
                        <button className="secondary" title="Sign in to add this to your repertoire">
                          Sign in to add
                        </button>
                      </Link>
                    )}
                  </div>
                </div>

                {isPracticing && (
                  <div className="setting-sheet-preview">
                    <TunePlayer abc={s.abcText} tuneId={s.tuneSettingId} tuneType={details.tuneType} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="modal-section submit-setting-section" style={{ marginTop: '1.5rem' }}>
        <NewSettingForm tuneId={id} fallbackKey={details.key} onSubmitted={refetch} />
      </div>
    </section>
  )
}
