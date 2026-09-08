"use client";

import { Suspense, lazy, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import {
  addToRepertoire,
  clearUserTuneSetting,
  getMyTuneVotes,
  getTuneDetails,
  moderatorDeleteTuneSetting,
  updateUserTune,
  voteTuneSetting,
  type TuneDetails,
} from '../services/api'
import { currentUserId, currentUserProfile, useAuthStatus, useSignal, showToast } from '../state/appState'
import { Spinner } from './Spinner'
import { NewSettingForm } from './NewSettingForm'
import { AddAliasButton, TuneAliases } from './TuneAliases'

// Dynamically imported to prevent abcjs SSR errors.
const SheetMusic = lazy(() => import('./SheetMusic').then((m) => ({ default: m.SheetMusic })))
const TunePlayer = lazy(() => import('./TunePlayer').then((m) => ({ default: m.TunePlayer })))

/**
 * 'page' is the public Tune Library page; 'modal' is the settings dialog opened from a repertoire
 * or group list. Everything that differs between them is written out at the point it differs, so
 * the two readings of a section sit next to each other rather than in two files.
 */
export type TuneViewVariant = 'page' | 'modal'

export interface TuneViewProps {
  tuneId: string
  variant: TuneViewVariant
  /** Rendered above everything once the tune has loaded: the page's title block, the modal's meta. */
  header?: (details: TuneDetails) => ReactNode
  /** The user's copy of this tune, when they have one; enables switching and un-pinning. */
  userTuneId?: string
  /** The setting currently in effect, so it can be marked and previewed first. */
  currentTuneSettingId?: string | null
  /** False when currentTuneSettingId was resolved from votes rather than chosen by the user. */
  isPinnedSetting?: boolean
  /** Overrides the default repertoire add/switch action (e.g. for a group's master tune list). */
  onSelectSetting?: (settingId: string) => Promise<unknown>
  /** Label for the per-setting action button; defaults based on userTuneId/onSelectSetting. */
  actionLabel?: string
  /** A setting was applied — the modal takes this as its cue to close. */
  onApplied?: () => void
}

/**
 * The tune screen itself — settings, votes, alternate names and the two ways of contributing —
 * shared by the Tune Library page and the settings modal.
 *
 * The two were separate copies of the same screen and drifted: TuneAliases and NewSettingForm were
 * already pulled out of them one at a time, and the library page went on showing its own add-a-name
 * button after the modal's moved beside the alternate-setting one. One component means a change to
 * any of it reaches both by construction.
 */
export function TuneView({
  tuneId,
  variant,
  header,
  userTuneId,
  currentTuneSettingId,
  isPinnedSetting,
  onSelectSetting,
  actionLabel,
  onApplied,
}: TuneViewProps) {
  const isPage = variant === 'page'
  const authStatus = useAuthStatus()
  // Anonymous visitors can browse and play settings; every write here needs an account, and the 401
  // that used to follow was invisible.
  const isAnonymous = authStatus === 'anonymous'
  const profile = useSignal(currentUserProfile)
  const isModerator = !!profile?.isModerator
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()

  /**
   * Which setting is expanded: undefined = no choice made yet, so the one in effect (else the
   * first) is shown; null = they collapsed them all; a string = the one they opened.
   */
  const [expandedSettingId, setExpandedSettingId] = useState<string | null | undefined>(undefined)
  /** The page stays put after adding a setting, so it says so; the modal closes instead. */
  const [addedMessage, setAddedMessage] = useState<string | null>(null)

  const { data: details, isPending, isError, refetch } = useQuery({
    queryKey: ['tune-details', tuneId],
    queryFn: () => getTuneDetails(tuneId),
    enabled: authStatus !== 'pending',
  })

  const { data: myVotes, refetch: refetchMyVotes } = useQuery({
    queryKey: ['tune-my-votes', tuneId],
    queryFn: () => getMyTuneVotes(tuneId),
    enabled: authStatus !== 'pending' && !isAnonymous && !!tuneId,
  })

  const deleteSettingMutation = useMutation({
    mutationFn: (settingId: string) => moderatorDeleteTuneSetting(settingId),
    onSuccess: () => {
      refetch()
      showToast('Setting deleted.', 'info')
    },
    onError: (err: Error) => showToast(err.message || 'Failed to delete setting.', 'error'),
  })

  const actionMutation = useMutation({
    mutationFn: (settingId: string) => {
      if (onSelectSetting) return onSelectSetting(settingId)
      if (userTuneId !== undefined) return updateUserTune(userTuneId, { tuneSettingId: settingId })
      return addToRepertoire(tuneId, settingId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
      if (isPage) setAddedMessage('Added to your repertoire!')
      onApplied?.()
    },
    // The modal's primary action closes it on success, so on failure it has to say so — otherwise
    // nothing moves and the only feedback is that clicking again does nothing either.
    onError: (err: Error) => showToast(err.message || 'Could not apply that setting.', 'error'),
  })

  // Un-pin: fall back to whatever setting the community has voted to the top.
  const useDefaultMutation = useMutation({
    mutationFn: () => clearUserTuneSetting(userTuneId!),
    onSuccess: () => onApplied?.(),
  })

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
    // Clicking the vote already cast toggles it off.
    const activeVote = myVotes?.[settingId] ?? currentVote
    voteMutation.mutate({ settingId, value: activeVote === targetVote ? 0 : targetVote })
  }

  if (isPending) {
    return <div className="spinner-row"><Spinner /></div>
  }
  if (isError || !details) {
    return <p className="error">Could not load this tune.</p>
  }

  const aliasesSection = (
    <TuneAliases aliases={details.aliases} style={isPage ? { marginTop: '1.5rem' } : undefined} />
  )

  return (
    <>
      {header?.(details)}

      {/* The page lists the names with the title they belong to; the modal keeps its settings first. */}
      {isPage && aliasesSection}

      <div className="modal-section" style={isPage ? { marginTop: '1.5rem' } : undefined}>
        <h3>{isPage ? 'Settings' : 'Select a Setting to Add'}</h3>
        {isPage && (
          <p className="tune-meta italic">
            {isAnonymous
              ? 'Play any setting to practice along. Sign in to vote or add a setting to your own repertoire.'
              : 'Play a setting to practice along, or add it to your repertoire.'}
          </p>
        )}
        {addedMessage && <p className="tune-meta">{addedMessage}</p>}

        <div className="settings-list-container">
          {details.settings.map((s, index) => {
            const isCurrent = currentTuneSettingId === s.tuneSettingId
            const defaultExpanded = currentTuneSettingId ? isCurrent : index === 0
            const isExpanded =
              expandedSettingId === undefined ? defaultExpanded : expandedSettingId === s.tuneSettingId
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
                    {/* The page plays a setting where the modal, which is choosing one, shows it. */}
                    <button
                      className="preview-btn secondary"
                      onClick={() => setExpandedSettingId(isExpanded ? null : s.tuneSettingId)}
                    >
                      {isPage
                        ? isExpanded ? 'Hide Player' : '▶ Play & Practice'
                        : isExpanded ? 'Hide Sheet' : 'Preview'}
                    </button>

                    {isPage && isAnonymous ? (
                      <Link href="/login" prefetch={false}>
                        <button className="secondary" title="Sign in to add this to your repertoire">
                          Sign in to add
                        </button>
                      </Link>
                    ) : (
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
                          : actionLabel ??
                            (userTuneId !== undefined ? 'Switch to this setting' : '+ Add to Repertoire')}
                      </button>
                    )}

                    {isModerator && (
                      <button
                        className="secondary danger-hover"
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete this setting (Key: ${s.key}, by ${s.submitterName})?`)) {
                            deleteSettingMutation.mutate(s.tuneSettingId)
                          }
                        }}
                        disabled={deleteSettingMutation.isPending}
                        title="Delete this setting"
                      >
                        🗑️ Delete Setting
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="setting-sheet-preview">
                    <Suspense fallback={<div className="spinner-row"><Spinner /></div>}>
                      {isPage ? (
                        <TunePlayer abc={s.abcText} tuneId={s.tuneSettingId} tuneType={details.tuneType} />
                      ) : (
                        <>
                          <SheetMusic abcString={s.abcText} />
                          <pre className="abc-code-block">{s.abcText}</pre>
                        </>
                      )}
                    </Suspense>
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

      {!isPage && aliasesSection}

      {isAnonymous ? (
        <p className="tune-meta">Sign in to add this tune, vote on settings, or submit your own.</p>
      ) : (
        // The two ways of adding to a tune, side by side. The setting form opens in place and takes
        // the row below it; the name is a small enough thing to ask for in a dialog.
        <div
          className="modal-section submit-setting-section contribute-actions"
          style={isPage ? { marginTop: '1.5rem' } : undefined}
        >
          <AddAliasButton
            tuneId={tuneId}
            aliases={details.aliases}
            onAdded={refetch}
            className="secondary"
          />
          <NewSettingForm tuneId={tuneId} fallbackKey={details.key} onSubmitted={refetch} />
        </div>
      )}
    </>
  )
}
