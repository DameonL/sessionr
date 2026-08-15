"use client";

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { addToRepertoire, formatTuneType, matchTune, type TuneMatchCandidate } from '../services/api'
import { classifyClip, createTuneSample, groupNotes, SAMPLE_DURATION_MS, type TuneSample } from '../services/tuneMatcher'
import type { RawFrame } from '../services/pitchDetector'
import { currentUserId, useSignal } from '../state/appState'
import { Spinner } from '../components/Spinner'

type Phase = 'idle' | 'listening' | 'matching' | 'results'

// Purely informational — a low capture count just yields a lower-confidence
// server result (already handled by the "no confident match" messaging), so
// this never blocks submission, only adds a hint on the results screen.
const MIN_NOTES_ADVISORY = 4

// Recording can be stopped early once this much has elapsed, rather than
// always waiting the full sample duration.
const EARLY_STOP_MIN_MS = 5000

interface TuneIdDebug {
  simulate(midis: number[], opts?: { autoSubmit?: boolean }): void
  simulateRawFrames(frames: RawFrame[], opts?: { autoSubmit?: boolean }): void
  notes(): number[]
  phase(): string
}

interface WindowWithTuneIdDebug extends Window {
  __tuneIdDebug?: TuneIdDebug
}

function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 70) return 'badge badge-active'
  if (confidence >= 40) return 'badge badge-rusty'
  return 'badge badge-wishlist'
}

/**
 * "What's that tune?" — records a fixed ~20s sample from the mic, then
 * processes the whole clip at once to identify likely matches from the full
 * tune library, with a confidence score per candidate. No audio is recorded
 * or uploaded: only the ordered sequence of notes extracted from the sample
 * (via tuneMatcher.ts's batch classify/group pass over pitchDetector.ts's
 * raw frame capture) is sent to the server for matching.
 *
 * Detection is deliberately deferred to the end of the sample rather than
 * done live, frame by frame: a robust noise floor can only be estimated from
 * the statistics of a whole clip (see tuneMatcher.ts's header comment) — a
 * live per-frame guess has no way to tell a real note's attack transient
 * from actual background noise, and got that wrong badly enough in an
 * earlier version to reject real playing almost immediately.
 */
export function TuneIdentifier() {
  const userId = useSignal(currentUserId)

  const sampleRef = useRef<TuneSample | null>(null)
  const finishTimerRef = useRef<number | null>(null)
  const phaseRef = useRef<Phase>('idle')

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [capturedCount, setCapturedCount] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
  const [addedTuneId, setAddedTuneId] = useState<string | null>(null)

  const matchMutation = useMutation({
    mutationFn: (notes: number[]) => matchTune(notes),
  })

  const addMutation = useMutation({
    mutationFn: (tuneId: string) => addToRepertoire(tuneId),
    onSuccess: (_, tuneId) => setAddedTuneId(tuneId),
  })

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next
    setPhase(next)
  }

  function clearFinishTimer() {
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current)
      finishTimerRef.current = null
    }
  }

  function runMatch(notes: number[]) {
    setCapturedCount(notes.length)
    setPhaseBoth('matching')
    matchMutation.mutate(notes, {
      onSettled: () => setPhaseBoth('results'),
    })
  }

  function finishRecording() {
    clearFinishTimer()
    const sample = sampleRef.current
    if (!sample) return
    sample.stop()
    runMatch(sample.analyze())
  }

  async function startListening() {
    setMicError(null)
    matchMutation.reset()
    setAddedTuneId(null)
    setElapsedMs(0)
    setLevel(0)
    const sample = createTuneSample()
    sampleRef.current = sample
    try {
      await sample.start((elapsed, rms) => {
        setElapsedMs(elapsed)
        setLevel(rms)
      })
      setPhaseBoth('listening')
      finishTimerRef.current = window.setTimeout(finishRecording, SAMPLE_DURATION_MS)
    } catch {
      setMicError('Microphone unavailable — allow mic access and try again.')
    }
  }

  function reset() {
    clearFinishTimer()
    sampleRef.current?.stop()
    sampleRef.current = null
    setElapsedMs(0)
    setLevel(0)
    setMicError(null)
    matchMutation.reset()
    setAddedTuneId(null)
    setPhaseBoth('idle')
  }

  useEffect(() => {
    return () => {
      clearFinishTimer()
      sampleRef.current?.stop()
    }
  }, [])

  // Hands-free driver for development: __tuneIdDebug.simulate(midis) skips
  // the mic entirely and runs the same match path a completed recording
  // would. simulateRawFrames drives the real classifyClip/groupNotes batch
  // pipeline from synthetic frame data, for exercising the actual
  // classification logic without a microphone.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const win = window as WindowWithTuneIdDebug
    let lastNotes: number[] = []
    win.__tuneIdDebug = {
      simulate: (midis, opts) => {
        lastNotes = midis
        setPhaseBoth('listening')
        if (opts?.autoSubmit !== false) runMatch(midis)
      },
      simulateRawFrames: (frames, opts) => {
        const notes = groupNotes(classifyClip(frames)).map((n) => n.midi)
        lastNotes = notes
        setPhaseBoth('listening')
        if (opts?.autoSubmit !== false) runMatch(notes)
      },
      notes: () => [...lastNotes],
      phase: () => phaseRef.current,
    }
    return () => {
      delete win.__tuneIdDebug
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const candidates: TuneMatchCandidate[] = matchMutation.data?.candidates ?? []
  const hasConfidentMatch = matchMutation.data?.hasConfidentMatch ?? false
  const remainingSeconds = Math.max(0, Math.ceil((SAMPLE_DURATION_MS - elapsedMs) / 1000))
  const canStopEarly = elapsedMs >= EARLY_STOP_MIN_MS

  return (
    <section>
      <h1>What&apos;s That Tune?</h1>
      <p className="tune-meta" style={{ marginBottom: '1rem' }}>
        Play a bit of the tune on your instrument — we&apos;ll record a 20 second sample
        and try to identify it from the tune library, with a confidence score for each
        possible match.
      </p>

      {phase === 'idle' && (
        <div className="card">
          <div className="detail-controls">
            <button onClick={startListening}>🎤 Start listening</button>
          </div>
          {micError && <p className="error">{micError}</p>}
        </div>
      )}

      {phase === 'listening' && (
        <div className="card">
          <p className="tune-meta">🎤 Recording — play a phrase or two. {remainingSeconds}s remaining.</p>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${Math.min(100, (elapsedMs / SAMPLE_DURATION_MS) * 100)}%` }}
            />
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${Math.min(100, level * 300)}%` }} />
          </div>
          <div className="detail-controls">
            <button onClick={finishRecording} disabled={!canStopEarly}>
              🔍 Stop and identify now
            </button>
            <button className="secondary" onClick={reset}>✕ Cancel</button>
          </div>
        </div>
      )}

      {phase === 'matching' && (
        <div className="card spinner-row">
          <Spinner />
          <p className="tune-meta">Matching against the tune library…</p>
        </div>
      )}

      {phase === 'results' && (
        <div>
          <p className="tune-meta" style={{ marginBottom: '1rem' }}>
            Captured {capturedCount} note{capturedCount === 1 ? '' : 's'} from a 20 second sample.
          </p>

          {matchMutation.isError && (
            <p className="error">Couldn&apos;t reach the tune library — try again.</p>
          )}

          {!matchMutation.isError && capturedCount < MIN_NOTES_ADVISORY && (
            <p className="tune-meta">
              Very few clear notes detected — try recording in a quieter spot or playing
              closer to the mic.
            </p>
          )}

          {!matchMutation.isError && !hasConfidentMatch && (
            <p className="badge badge-queue">
              Couldn&apos;t find a confident match — try playing a longer or cleaner excerpt.
            </p>
          )}

          {candidates.length > 0 && (
            <ul className="tune-list">
              {candidates.map((c) => (
                <li key={c.tuneId} className="card">
                  <div className="tune-row">
                    <span className="tune-title">
                      <Link href={`/tunes/${c.tuneId}`} className="quiet-link">{c.title}</Link>
                    </span>
                    <span className={confidenceBadgeClass(c.confidence)}>{Math.round(c.confidence)}%</span>
                  </div>
                  <p className="tune-meta">{formatTuneType(c.tuneType)} · {c.key}</p>
                  <div className="detail-controls">
                    <Link href={`/tunes/${c.tuneId}`}>View tune</Link>
                    {userId ? (
                      addedTuneId === c.tuneId ? (
                        <span className="tune-meta">✓ Added to repertoire</span>
                      ) : (
                        <button
                          className="secondary"
                          disabled={addMutation.isPending}
                          onClick={() => addMutation.mutate(c.tuneId)}
                        >
                          + Add to repertoire
                        </button>
                      )
                    ) : (
                      <Link href="/login">Sign in to add</Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="detail-controls">
            <button onClick={reset}>🔁 Try another snippet</button>
          </div>
        </div>
      )}
    </section>
  )
}
