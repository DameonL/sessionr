"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { getFullRepertoire, logPractice } from '../../../services/api'
import { generateVirtualSession, type SessionTune, type VirtualSession } from '../../../services/virtualSession'
import { currentUserId, showToast, useSignal } from '../../../state/appState'
import { showBadgeToasts } from '../../../services/badges'

// Dynamically import VirtualSessionPlayer to prevent abcjs SSR errors
const VirtualSessionPlayer = dynamic(
  () => import('../../../components/VirtualSessionPlayer').then((m) => m.VirtualSessionPlayer),
  { ssr: false },
)

type Phase = 'idle' | 'playing' | 'summary'

export default function VirtualSessionPage() {
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()

  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: getFullRepertoire,
  })

  const [session, setSession] = useState<VirtualSession | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [currentSetIndex, setCurrentSetIndex] = useState(0)
  const [currentTuneIndex, setCurrentTuneIndex] = useState(0)
  const [revealedTuneIds, setRevealedTuneIds] = useState<Set<string>>(new Set())
  const [playedTuneIds, setPlayedTuneIds] = useState<Set<string>>(new Set())

  const logSessionMutation = useMutation({
    mutationFn: async (tuneIds: string[]) => {
      const allNewBadges: string[] = []
      for (const id of tuneIds) {
        const result = await logPractice(id)
        allNewBadges.push(...result.newBadges)
      }
      return allNewBadges
    },
    onSuccess: (allNewBadges) => {
      queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
      showToast(`Logged practice for ${playedTuneIds.size} tune(s)!`, 'success')
      showBadgeToasts(allNewBadges)
      resetToIdle()
    },
    onError: (err: Error) => {
      showToast(`Failed logging practice: ${err.message}`, 'error')
    },
  })

  function resetToIdle() {
    setPhase('idle')
    setSession(null)
    setCurrentSetIndex(0)
    setCurrentTuneIndex(0)
    setRevealedTuneIds(new Set())
    setPlayedTuneIds(new Set())
  }

  function handleStart() {
    const generated = generateVirtualSession(repertoire.data ?? [])
    if (!generated) {
      showToast('Not enough Active tunes to build a Virtual Session — mark a few more as Active in your repertoire.', 'error')
      return
    }
    setSession(generated)
    setCurrentSetIndex(0)
    setCurrentTuneIndex(0)
    setRevealedTuneIds(new Set())
    setPlayedTuneIds(new Set())
    setPhase('playing')
  }

  function handleTuneRevealed(userTuneId: string) {
    setRevealedTuneIds((prev) => new Set(prev).add(userTuneId))
  }

  function handleTuneComplete(userTuneId: string) {
    setPlayedTuneIds((prev) => new Set(prev).add(userTuneId))
    advance()
  }

  function advance() {
    if (!session) return
    const set = session.sets[currentSetIndex]
    if (currentTuneIndex + 1 < set.tunes.length) {
      setCurrentTuneIndex(currentTuneIndex + 1)
    } else if (currentSetIndex + 1 < session.sets.length) {
      setCurrentSetIndex(currentSetIndex + 1)
      setCurrentTuneIndex(0)
    } else {
      setPhase('summary')
    }
  }

  function handleSkipTune() {
    advance()
  }

  function handleEndSession() {
    setPhase('summary')
  }

  const allTunes: SessionTune[] = session ? session.sets.flatMap((s) => s.tunes) : []

  if (phase === 'idle') {
    const activeCount = (repertoire.data ?? []).filter((r) => r.status.toLowerCase() === 'active').length
    return (
      <div className="card">
        <h2>🎻 Virtual Session</h2>
        <p className="tune-meta">
          Simulates a live session: a 4-piece virtual band plays 3 sets of 2-3 tunes from your Active repertoire.
          Each tune's notation stays hidden until the band plays it — sight-unseen, the first time through.
        </p>
        {repertoire.isLoading && <p className="tune-meta">Loading your repertoire…</p>}
        {!repertoire.isLoading && activeCount < 2 && (
          <p className="error">
            You need at least 2 tunes marked "Active" in your repertoire to start a Virtual Session.
          </p>
        )}
        {!repertoire.isLoading && activeCount >= 2 && (
          <button onClick={handleStart}>▶ Start Virtual Session</button>
        )}
      </div>
    )
  }

  if (phase === 'summary') {
    return (
      <div className="card">
        <h2>Session complete!</h2>
        <p className="badge badge-queue">
          {playedTuneIds.size} of {allTunes.length} tune{allTunes.length === 1 ? '' : 's'} played across{' '}
          {session?.sets.length} set{session?.sets.length === 1 ? '' : 's'}.
        </p>
        <ul className="tune-list">
          {allTunes
            .filter((t) => playedTuneIds.has(t.userTuneId))
            .map((t) => (
              <li key={t.userTuneId} className="card tune-row">
                <span className="tune-title">{t.title}</span>
              </li>
            ))}
        </ul>
        <div className="detail-controls">
          <button
            disabled={logSessionMutation.isPending || playedTuneIds.size === 0}
            onClick={() => logSessionMutation.mutate(Array.from(playedTuneIds))}
          >
            ✓ Log practice for all tunes played
          </button>
          <button className="danger" onClick={resetToIdle}>
            Discard
          </button>
        </div>
      </div>
    )
  }

  const currentSet = session!.sets[currentSetIndex]
  const currentTune = currentSet.tunes[currentTuneIndex]

  return (
    <div>
      <div className="tune-meta" style={{ marginBottom: '0.5rem' }}>
        Set {currentSetIndex + 1} of {session!.sets.length} · Tune {currentTuneIndex + 1} of {currentSet.tunes.length}
      </div>
      <VirtualSessionPlayer
        key={`${session!.generatedAt}:${currentTune.userTuneId}`}
        tune={currentTune}
        bandVoices={session!.bandVoices}
        alreadyRevealed={revealedTuneIds.has(currentTune.userTuneId)}
        onTuneRevealed={handleTuneRevealed}
        onTuneComplete={handleTuneComplete}
      />
      <div className="detail-controls">
        <button onClick={handleSkipTune}>⏭ Skip tune</button>
        <button className="danger" onClick={handleStart}>
          🔀 Regenerate session
        </button>
        <button className="danger" onClick={handleEndSession}>
          ⏹ End session
        </button>
      </div>
    </div>
  )
}
