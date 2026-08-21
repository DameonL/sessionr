"use client";

import { lazy, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import dynamic from '@/utils/routerCompat'
import {
  getTuneDetails,
  getMyTuneVotes,
  voteTuneSetting,
  addToRepertoire,
  updateUserTune,
  clearUserTuneSetting,
  formatTuneType,
} from '../services/api'
import { useAuthStatus, showToast } from '../state/appState'
import { Spinner } from './Spinner'
import { Dialog } from './Dialog'
import { NewSettingForm } from './NewSettingForm'
import { TuneAliases } from './TuneAliases'

// Dynamically import SheetMusic to prevent abcjs SSR errors
const SheetMusic = lazy(() => import('./SheetMusic').then((m) => ({ default: m.SheetMusic })))

interface TuneSettingsModalProps {
  tuneId: string
  userId: string
  onClose: () => void
  onAdded: () => void
  userTuneId?: string
  /** The setting currently in effect, so it can be marked and previewed first. */
  currentTuneSettingId?: string | null
  /** False when currentTuneSettingId was resolved from votes rather than chosen by the user. */
  isPinnedSetting?: boolean
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
  currentTuneSettingId,
  isPinnedSetting,
  onSelectSetting,
  actionLabel,
}: TuneSettingsModalProps) {
  const authStatus = useAuthStatus()
  // Anonymous visitors can browse and preview settings; every write here needs an account, and
  // the 401 that used to follow was invisible.
  const isAnonymous = authStatus === 'anonymous'

  // undefined = no explicit user choice yet (show the setting currently in effect, falling back to
  // the first/most-popular one); null = user explicitly collapsed everything; string = user
  // explicitly expanded that setting.
  const [previewSettingId, setPreviewSettingId] = useState<string | null | undefined>(undefined)

  // Fetch full details of the tune
  const { data: details, isPending, isError, refetch } = useQuery({
    queryKey: ['tune-details', tuneId],
    queryFn: () => getTuneDetails(tuneId),
    enabled: authStatus !== 'pending',
  })

  // Fetch caller's personal votes for settings
  const { data: myVotes, refetch: refetchMyVotes } = useQuery({
    queryKey: ['tune-my-votes', tuneId],
    queryFn: () => getMyTuneVotes(tuneId),
    enabled: authStatus !== 'pending' && authStatus !== 'anonymous' && !!tuneId,
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
    // The modal's primary action. It closes itself on success, so on failure it has to say so —
    // otherwise nothing moves and the only feedback is that clicking again does nothing either.
    onError: (err: Error) => showToast(err.message || 'Could not apply that setting.', 'error'),
  })

  // Un-pin: fall back to whatever setting the community has voted to the top
  const useDefaultMutation = useMutation({
    mutationFn: () => clearUserTuneSetting(userTuneId!),
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
      refetchMyVotes()
    },
    onError: (err: Error) => showToast(err.message || 'Could not record your vote.', 'error'),
  })

  const handleVote = (settingId: string, currentVote: number, targetVote: number) => {
    // If clicking same vote, toggle it off (value = 0)
    const activeVote = myVotes?.[settingId] ?? currentVote
    const nextVoteValue = activeVote === targetVote ? 0 : targetVote
    voteMutation.mutate({ settingId, value: nextVoteValue })
  }

  if (isPending) {
    return (
      <Dialog isOpen title="Loading tune…" onClose={onClose}>
        <div className="spinner-row"><Spinner /></div>
      </Dialog>
    )
  }

  if (isError || !details) {
    return (
      <Dialog isOpen title="Tune settings" onClose={onClose}>
        <p className="error">Could not load tune details.</p>
        <button onClick={onClose}>Close</button>
      </Dialog>
    )
  }

  return (
    <Dialog
      isOpen
      title={details.title}
      onClose={onClose}
      className="tune-settings-modal"
      maxWidth="680px"
    >
      <p className="tune-meta" style={{ marginTop: 0 }}>{formatTuneType(details.tuneType)}</p>

      {/* Settings List */}
      <div className="modal-section">
        <h3>Select a Setting to Add</h3>
        <div className="settings-list-container">
          {details.settings.map((s, index) => {
            const isCurrent = currentTuneSettingId === s.tuneSettingId
            const defaultPreviewed = currentTuneSettingId ? isCurrent : index === 0
            const isPreviewed =
              previewSettingId === undefined ? defaultPreviewed : previewSettingId === s.tuneSettingId
            const userVoteValue = myVotes?.[s.tuneSettingId] ?? s.userVoteValue ?? 0
            const hasUpvoted = userVoteValue === 1
            const hasDownvoted = userVoteValue === -1

            return (
              <div key={s.tuneSettingId} className={`setting-card${isCurrent ? ' is-current' : ''}`}>
                <div className="setting-card-header">
                  <div className="setting-card-meta">
                    <span className="setting-key-badge">Key: {s.key}</span>
                    <span className="setting-submitter text-muted">by {s.submitterName}</span>
                    {isCurrent && (
                      <span className="badge badge-active current-setting-badge">
                        {isPinnedSetting === false ? 'Community default' : 'Current setting'}
                      </span>
                    )}
                    <div className="vote-controls">
                      <button
                        className={`vote-btn upvote-btn ${hasUpvoted ? 'active' : ''}`}
                        onClick={() => handleVote(s.tuneSettingId, userVoteValue, 1)}
                        disabled={isAnonymous || voteMutation.isPending}
                        title={isAnonymous ? 'Sign in to vote' : 'Upvote'}
                        aria-label={`Upvote the setting by ${s.submitterName}`}
                        aria-pressed={hasUpvoted}
                      >
                        ▲
                      </button>
                      <span className="vote-score">{s.voteScore}</span>
                      <button
                        className={`vote-btn downvote-btn ${hasDownvoted ? 'active' : ''}`}
                        onClick={() => handleVote(s.tuneSettingId, userVoteValue, -1)}
                        disabled={isAnonymous || voteMutation.isPending}
                        title={isAnonymous ? 'Sign in to vote' : 'Downvote'}
                        aria-label={`Downvote the setting by ${s.submitterName}`}
                        aria-pressed={hasDownvoted}
                      >
                        ▼
                      </button>
                    </div>
                  </div>

                  <div className="setting-actions">
                    <button
                      className="preview-btn secondary"
                      onClick={() => setPreviewSettingId(isPreviewed ? null : s.tuneSettingId)}
                    >
                      {isPreviewed ? 'Hide Sheet' : 'Preview'}
                    </button>

                    <button
                      className="add-setting-action"
                      onClick={() => actionMutation.mutate(s.tuneSettingId)}
                      disabled={
                        isAnonymous || actionMutation.isPending || (isCurrent && isPinnedSetting !== false)
                      }
                      title={isAnonymous ? 'Sign in to add this tune' : undefined}
                    >
                      {isCurrent && isPinnedSetting !== false
                        ? 'In use'
                        : actionLabel ?? (userTuneId !== undefined ? 'Switch to this setting' : '+ Add this setting')}
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

        {userTuneId !== undefined && !onSelectSetting && isPinnedSetting && (
          <div className="settings-list-footer">
            <button
              className="secondary w-full"
              onClick={() => useDefaultMutation.mutate()}
              disabled={useDefaultMutation.isPending}
            >
              Use the community default setting
            </button>
            <p className="tune-meta" style={{ marginTop: '0.35rem', fontSize: '0.8rem' }}>
              Un-pins this tune so it follows whichever setting is voted highest.
            </p>
            {useDefaultMutation.isError && (
              <p className="error">{(useDefaultMutation.error as Error).message}</p>
            )}
          </div>
        )}
      </div>

      <TuneAliases tuneId={tuneId} aliases={details.aliases} onAdded={refetch} />

      {isAnonymous ? (
        <p className="tune-meta">Sign in to add this tune, vote on settings, or submit your own.</p>
      ) : (
        <div className="modal-section submit-setting-section">
          <NewSettingForm tuneId={tuneId} fallbackKey={details.key} onSubmitted={refetch} />
        </div>
      )}
    </Dialog>
  )
}
