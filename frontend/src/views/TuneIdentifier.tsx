"use client";

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { addToRepertoire, formatTuneType, matchTune, type TuneMatchCandidate } from '../services/api'
import { createSnippetCapture, type SnippetCapture } from '../services/tuneMatcher'
import type { QualityFrame } from '../services/pitchDetector'
import { currentUserId, useSignal } from '../state/appState'
import { Spinner } from '../components/Spinner'

type Phase = 'idle' | 'listening' | 'matching' | 'results'

// Raised from 6: a noisier room needs more real signal for the matcher to
// anchor on against burst noise (see MelodyFingerprint.cs's affine gap costs).
const MIN_NOTES = 8

// Rolling accept-rate tracking for the "too noisy" hint. Starts optimistic
// (no warning before there's real data) and only judges after enough frames.
const QUALITY_EMA_RATE = 0.1
const QUALITY_WARN_THRESHOLD = 0.15
const QUALITY_MIN_SAMPLES = 30

interface TuneIdDebug {
  simulate(midis: number[], opts?: { autoSubmit?: boolean }): void
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
 * "What's that tune?" — listens on the mic while the user plays, then identifies
 * likely matches from the full tune library with a confidence score per candidate.
 * No audio is recorded or uploaded: only the ordered sequence of stable notes
 * detected (via pitchDetector.ts, the same mic listener EarTrainer uses) is sent
 * to the server for matching.
 */
export function TuneIdentifier() {
  const userId = useSignal(currentUserId)

  const captureRef = useRef<SnippetCapture | null>(null)
  // Single source of truth for captured notes — both the real mic callback and
  // the dev __tuneIdDebug.simulate hook append to this same array, so `identify`
  // doesn't need to know which one is driving it.
  const notesRef = useRef<number[]>([])
  const phaseRef = useRef<Phase>('idle')
  // Rolling accept-rate over recent mic frames (real mic only — the dev
  // simulate hook bypasses onQuality entirely, which is fine, it's advisory).
  const qualityRef = useRef({ ema: 1, samples: 0 })

  const [phase, setPhase] = useState<Phase>('idle')
  const [noteCount, setNoteCount] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
  const [addedTuneId, setAddedTuneId] = useState<string | null>(null)
  const [tooNoisy, setTooNoisy] = useState(false)

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

  function appendNote(midi: number) {
    notesRef.current.push(midi)
    setNoteCount(notesRef.current.length)
  }

  function handleQuality(q: QualityFrame) {
    const quality = qualityRef.current
    quality.samples++
    quality.ema = quality.ema * (1 - QUALITY_EMA_RATE) + (q.accepted ? 1 : 0) * QUALITY_EMA_RATE
    if (quality.samples >= QUALITY_MIN_SAMPLES) {
      setTooNoisy(quality.ema < QUALITY_WARN_THRESHOLD)
    }
  }

  async function startListening() {
    setMicError(null)
    matchMutation.reset()
    setAddedTuneId(null)
    notesRef.current = []
    setNoteCount(0)
    qualityRef.current = { ema: 1, samples: 0 }
    setTooNoisy(false)
    const capture = createSnippetCapture()
    captureRef.current = capture
    try {
      await capture.start((midi) => appendNote(midi), handleQuality)
      setPhaseBoth('listening')
    } catch {
      setMicError('Microphone unavailable — allow mic access and try again.')
    }
  }

  function identify() {
    if (notesRef.current.length < MIN_NOTES) return
    setPhaseBoth('matching')
    matchMutation.mutate([...notesRef.current], {
      onSettled: () => setPhaseBoth('results'),
    })
  }

  function reset() {
    captureRef.current?.stop()
    captureRef.current = null
    notesRef.current = []
    setNoteCount(0)
    qualityRef.current = { ema: 1, samples: 0 }
    setTooNoisy(false)
    setMicError(null)
    matchMutation.reset()
    setAddedTuneId(null)
    setPhaseBoth('idle')
  }

  useEffect(() => {
    return () => {
      captureRef.current?.stop()
    }
  }, [])

  // Hands-free driver for development: __tuneIdDebug.simulate(midis) feeds a
  // known note sequence through the same appendNote path a real mic detection
  // would, so the idle -> listening -> matching -> results flow can be
  // exercised end-to-end without a microphone.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const win = window as WindowWithTuneIdDebug
    win.__tuneIdDebug = {
      simulate: (midis, opts) => {
        setPhaseBoth('listening')
        for (const midi of midis) appendNote(midi)
        if (opts?.autoSubmit !== false) identify()
      },
      notes: () => [...notesRef.current],
      phase: () => phaseRef.current,
    }
    return () => {
      delete win.__tuneIdDebug
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const candidates: TuneMatchCandidate[] = matchMutation.data?.candidates ?? []
  const hasConfidentMatch = matchMutation.data?.hasConfidentMatch ?? false

  return (
    <section>
      <h1>What&apos;s That Tune?</h1>
      <p className="tune-meta" style={{ marginBottom: '1rem' }}>
        Play a bit of the tune on your instrument and we&apos;ll try to identify it
        from the tune library, with a confidence score for each possible match.
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
          <p className="tune-meta">🎤 Listening — play a phrase or two, then tap Identify.</p>
          <p>{noteCount} note{noteCount === 1 ? '' : 's'} captured</p>
          <div className="detail-controls">
            <button onClick={identify} disabled={noteCount < MIN_NOTES}>
              🔍 Identify tune
            </button>
            <button className="secondary" onClick={reset}>↻ Reset</button>
          </div>
          {noteCount < MIN_NOTES && (
            <p className="tune-meta">Play at least {MIN_NOTES} notes before identifying.</p>
          )}
          {tooNoisy && (
            <p className="tune-meta">🔊 Too noisy to hear clearly — try moving closer to your instrument.</p>
          )}
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
          {matchMutation.isError && (
            <p className="error">Couldn&apos;t reach the tune library — try again.</p>
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
