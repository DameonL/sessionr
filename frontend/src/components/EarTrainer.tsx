import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import abcjs from 'abcjs'
import {
  getEarTrainingProgress,
  logPractice,
  saveEarTrainingProgress,
  type RepertoireItem,
} from '../services/api'
import { buildEarTrainingTune, playTargetNote, midiToHz } from '../services/earTraining'
import { createPitchListener, midiToNoteName, type PitchListener } from '../services/pitchDetector'
import { INSTRUMENTS, loadInstruments, synthInstrumentOptions } from './instruments'
import { currentUserId, useSignal } from '../state/appState'
import { showBadgeToasts } from '../services/badges'

const EAR_INSTRUMENT_KEY = 'sessionapp.ear-instrument'

interface EarTrainerProps {
  item: RepertoireItem
}

interface ExtendedTuneObject extends abcjs.TuneObject {
  setTiming(bpm?: number, measuresOfDelay?: number): abcjs.NoteTimingEvent[];
}

interface EarDebug {
  simulate(midi: number, cents?: number): void;
  current(): number | null;
  phase(): string;
}

interface WindowWithEarDebug extends Window {
  __earDebug?: EarDebug;
}

type Phase = 'idle' | 'target' | 'listening' | 'phrase-playback' | 'complete'

/** Phrase reward playback runs slow so the just-learned notes are followable. */
const PHRASE_TEMPO_PERCENT = 70
/** Pause between app audio ending and the mic listening again. */
const MIC_RESUME_DELAY_MS = 150

const MISSED_COLOR = '#d97706'

/**
 * Note-by-note call-and-response ear training. The app sounds a target
 * pitch, listens on the microphone, and reveals the phrase's notation one
 * note at a time as the player finds each pitch on their instrument.
 * Matching is octave-agnostic (pitch class), so any octave — or humming —
 * counts. Progress is saved per phrase and resumable.
 *
 * Mutable exercise state lives in refs because the pitch callback is a
 * long-lived closure created once when the mic starts.
 */
export function EarTrainer({ item }: EarTrainerProps) {
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()

  // The server resolves custom ABC -> the entry's setting -> the tune's master ABC.
  const abcText = item.abcText ?? item.abc ?? ''

  const tune = useMemo(() => buildEarTrainingTune(abcText), [abcText])

  const sheetRef = useRef<HTMLDivElement>(null)
  const visualObjRef = useRef<ExtendedTuneObject | null>(null)
  const noteElsRef = useRef<SVGElement[]>([])
  const alignmentOkRef = useRef(true)
  const listenerRef = useRef<PitchListener | null>(null)
  const synthRef = useRef<abcjs.MidiBuffer | null>(null)
  const timerRef = useRef<abcjs.TimingCallbacks | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const phraseIndexRef = useRef(0)
  const noteIndexRef = useRef(0)
  const revealedCountRef = useRef(0)
  const initializedRef = useRef(false)

  const [phase, setPhase] = useState<Phase>('idle')
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [noteIndex, setNoteIndex] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [earInstrument, setEarInstrument] = useState<number>(() => {
    const stored = localStorage.getItem(EAR_INSTRUMENT_KEY)
    return stored !== null ? Number(stored) : 110 // default: Fiddle
  })

  const progressQuery = useQuery({
    queryKey: ['ear-training', item.userTuneId],
    queryFn: () => getEarTrainingProgress(item.userTuneId),
  })

  const saveMutation = useMutation({
    mutationFn: (body: { phraseIndex: number; notesRevealed: number; completed: boolean }) =>
      saveEarTrainingProgress(item.userTuneId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ear-training', item.userTuneId] })
    },
  })

  const practiceMutation = useMutation({
    mutationFn: () => logPractice(item.userTuneId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
      showBadgeToasts(data.newBadges)
    },
  })

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next
    setPhase(next)
  }

  function setNoteIndexBoth(next: number) {
    noteIndexRef.current = next
    setNoteIndex(next)
  }

  function setPhraseIndexBoth(next: number) {
    phraseIndexRef.current = next
    setPhraseIndex(next)
  }

  // Resume from saved progress once, when both the parsed tune and the
  // saved state are available.
  useEffect(() => {
    if (initializedRef.current || !tune || !progressQuery.data) return
    initializedRef.current = true
    revealedCountRef.current = progressQuery.data.notesRevealed
    if (progressQuery.data.completedAt) {
      setPhraseIndexBoth(tune.phrases.length)
      setPhaseBoth('complete')
      return
    }
    setPhraseIndexBoth(Math.min(progressQuery.data.phraseIndex, tune.phrases.length - 1))
  }, [tune, progressQuery.data])

  // Render the current phrase with every note hidden; reveals happen
  // imperatively as the player finds each pitch. Feedback re-renders don't
  // touch this effect, so revealed notes persist.
  useEffect(() => {
    const host = sheetRef.current
    if (!host || !tune) return
    if (phraseIndex >= tune.phrases.length) {
      host.innerHTML = ''
      return
    }
    const phrase = tune.phrases[phraseIndex]
    const objs = abcjs.renderAbc(host, phrase.excerptAbc, {
      responsive: 'resize',
      add_classes: true,
    })
    visualObjRef.current = objs[0] as ExtendedTuneObject

    const noteEls = Array.from(
      host.querySelectorAll<SVGElement>('.abcjs-note:not(.abcjs-rest)'),
    )
    noteElsRef.current = noteEls
    alignmentOkRef.current = noteEls.length === phrase.notes.length
    if (!alignmentOkRef.current) {
      console.warn(
        `Ear trainer: rendered ${noteEls.length} notes but extracted ${phrase.notes.length}; showing full notation.`,
      )
      return
    }
    for (const el of noteEls) {
      el.style.visibility = 'hidden'
    }
    // Beams, slurs, and triplet marks span several notes; keep them hidden
    // until the phrase is done rather than revealing them piecemeal.
    for (const el of host.querySelectorAll<SVGElement>(
      '.abcjs-beam-elem, .abcjs-slur, .abcjs-tie, .abcjs-triplet',
    )) {
      el.style.visibility = 'hidden'
    }
  }, [tune, phraseIndex])

  useEffect(() => {
    return () => {
      listenerRef.current?.stop()
      synthRef.current?.stop()
      timerRef.current?.stop()
    }
  }, [])

  // Hands-free driver for development: __earDebug.simulate(midi) behaves
  // exactly like a stable mic detection.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const win = window as WindowWithEarDebug
    win.__earDebug = {
      simulate: (midi: number, cents = 0) => handleDetectedNote(midi, midiToHz(midi), cents),
      current: () => currentNote()?.midi ?? null,
      phase: () => phaseRef.current,
    }
    return () => {
      delete win.__earDebug
    }
  }, [])

  function currentPhrase() {
    return tune?.phrases[phraseIndexRef.current]
  }

  function currentNote() {
    return currentPhrase()?.notes[noteIndexRef.current]
  }

  function revealNote(idx: number, missed: boolean) {
    if (!alignmentOkRef.current) return
    const el = noteElsRef.current[idx]
    if (!el) return
    el.style.visibility = 'visible'
    if (missed) {
      el.style.fill = MISSED_COLOR
      el.style.stroke = MISSED_COLOR
    }
  }

  function revealSpanningMarks() {
    const host = sheetRef.current
    if (!host) return
    for (const el of host.querySelectorAll<SVGElement>(
      '.abcjs-beam-elem, .abcjs-slur, .abcjs-tie, .abcjs-triplet',
    )) {
      el.style.visibility = 'visible'
    }
  }

  function handleDetectedNote(midi: number, _hz: number, cents: number) {
    if (phaseRef.current !== 'listening') return
    const note = currentNote()
    if (!note) return
    const played = ((midi % 12) + 12) % 12

    const playedName = midiToNoteName(midi)
    let tuningInfo = ''
    if (Math.abs(cents) <= 5) {
      tuningInfo = 'in tune'
    } else if (cents > 0) {
      tuningInfo = `${cents} cents sharp`
    } else {
      tuningInfo = `${Math.abs(cents)} cents flat`
    }

    if (played === note.pitchClass) {
      revealNote(noteIndexRef.current, false)
      setFeedback(`✓ Played ${playedName} (${tuningInfo}) — Got it!`)
      advance()
    } else {
      const diff = ((played - note.pitchClass + 18) % 12) - 6
      setFeedback(`✗ Played ${playedName} (${tuningInfo}) — try a bit ${diff < 0 ? 'higher' : 'lower'}`)
      playCurrentTarget()
    }
  }

  async function playCurrentTarget() {
    const note = currentNote()
    if (!note) return
    setPhaseBoth('target')
    listenerRef.current?.pause()

    let durationMs = 600
    const visualObj = visualObjRef.current
    if (visualObj && tune) {
      const timings = (visualObj as ExtendedTuneObject).setTiming(visualObj.getBpm()) || []
      const phrase = tune.phrases[phraseIndex]
      if (phrase) {
        const noteEvents = timings.filter((t: abcjs.NoteTimingEvent) => {
          if (t.type !== 'event') return false
          const token = phrase.excerptAbc.substring(t.startChar ?? 0, t.endChar ?? 0).trim()
          return /^[\^=_A-Ga-g]/.test(token)
        })
        const targetNoteEvent = noteEvents[noteIndexRef.current]
        if (targetNoteEvent) {
          const fullIdx = timings.indexOf(targetNoteEvent)
          if (fullIdx !== -1 && fullIdx + 1 < timings.length) {
            const naturalDuration = timings[fullIdx + 1].milliseconds - targetNoteEvent.milliseconds
            durationMs = Math.round(naturalDuration * (100 / PHRASE_TEMPO_PERCENT))
          }
        }
      }
    }

    await playTargetNote(note.midi, durationMs, earInstrument)
    window.setTimeout(() => {
      if (phaseRef.current !== 'target') return
      listenerRef.current?.resume()
      setPhaseBoth('listening')
    }, MIC_RESUME_DELAY_MS)
  }

  function advance() {
    const phrase = currentPhrase()
    if (!phrase) return
    let idx = noteIndexRef.current + 1
    while (idx < phrase.notes.length && phrase.notes[idx].isTieContinuation) {
      revealNote(idx, false)
      idx++
    }
    if (idx >= phrase.notes.length) {
      completePhrase()
      return
    }
    setNoteIndexBoth(idx)
    window.setTimeout(() => playCurrentTarget(), 700)
  }

  function startCurrentPhrase() {
    const phrase = currentPhrase()
    if (!phrase) return
    let idx = 0
    while (idx < phrase.notes.length && phrase.notes[idx].isTieContinuation) {
      revealNote(idx, false)
      idx++
    }
    if (idx >= phrase.notes.length) {
      completePhrase()
      return
    }
    setNoteIndexBoth(idx)
    playCurrentTarget()
  }

  async function completePhrase() {
    if (!tune) return
    setPhaseBoth('phrase-playback')
    setFeedback('✓ Phrase complete — listen back!')
    listenerRef.current?.pause()
    revealSpanningMarks()
    for (let i = 0; i < (currentPhrase()?.notes.length ?? 0); i++) {
      revealNote(i, false)
    }
    await playPhraseAudio()

    const next = phraseIndexRef.current + 1
    const done = next >= tune.phrases.length
    saveMutation.mutate({
      phraseIndex: next,
      notesRevealed: revealedCountRef.current,
      completed: done,
    })
    if (done) {
      setPhaseBoth('complete')
      setFeedback(null)
      return
    }
    setPhraseIndexBoth(next)
    setNoteIndexBoth(0)
    window.setTimeout(() => {
      setFeedback(null)
      startCurrentPhrase()
    }, 800)
  }

  /** Plays the current phrase excerpt; resolves when it ends (or fails). */
  function playPhraseAudio(): Promise<void> {
    return new Promise((resolve) => {
      const visualObj = visualObjRef.current
      if (!visualObj) {
        resolve()
        return
      }
      ;(async () => {
        try {
          const bpm = Math.round(visualObj.getBpm() * (PHRASE_TEMPO_PERCENT / 100))
          const synth = new abcjs.synth.CreateSynth()
          synthRef.current = synth
          await synth.init({
            visualObj,
            millisecondsPerMeasure: visualObj.millisecondsPerMeasure(bpm),
            options: { ...synthInstrumentOptions(loadInstruments()), program: earInstrument },
          })
          await synth.prime()
          const timer = new abcjs.TimingCallbacks(visualObj, {
            qpm: bpm,
            eventCallback: (ev: abcjs.NoteTimingEvent | null) => {
              if (!ev) {
                timer.stop()
                window.setTimeout(resolve, MIC_RESUME_DELAY_MS)
              }
              return undefined
            },
          })
          timerRef.current = timer
          synth.start()
          timer.start()
        } catch {
          setAudioError('Audio unavailable (soundfont could not be loaded).')
          resolve()
        }
      })()
    })
  }

  async function begin() {
    setMicError(null)
    if (!listenerRef.current) {
      const listener = createPitchListener()
      listenerRef.current = listener
      try {
        await listener.start(handleDetectedNote)
      } catch {
        setMicError(
          'Microphone unavailable — allow mic access and reload to play along, or step through with "Reveal note".',
        )
      }
    }
    startCurrentPhrase()
  }

  function revealCurrent() {
    if (phaseRef.current !== 'listening' && phaseRef.current !== 'target') return
    revealNote(noteIndexRef.current, true)
    revealedCountRef.current++
    setFeedback('Revealed — on to the next note')
    setPhaseBoth('listening')
    advance()
  }

  async function hearPhrase() {
    if (phaseRef.current === 'phrase-playback' || phaseRef.current === 'target') return
    const wasIdle = phaseRef.current === 'idle'
    setPhaseBoth('phrase-playback')
    listenerRef.current?.pause()
    await playPhraseAudio()
    window.setTimeout(() => {
      if (wasIdle) {
        setPhaseBoth('idle')
      } else {
        listenerRef.current?.resume()
        setPhaseBoth('listening')
      }
    }, MIC_RESUME_DELAY_MS)
  }

  function startOver() {
    if (!tune) return
    revealedCountRef.current = 0
    saveMutation.mutate({ phraseIndex: 0, notesRevealed: 0, completed: false })
    setPhraseIndexBoth(0)
    setNoteIndexBoth(0)
    setFeedback(null)
    setPhaseBoth('idle')
  }

  if (!tune) {
    return (
      <div className="card">
        <p className="error">
          This tune's notation can't be used for ear training yet (unsupported ABC).
        </p>
      </div>
    )
  }

  const phrase = tune.phrases[phraseIndex]
  const targetsInPhrase = phrase?.notes.filter((n) => !n.isTieContinuation).length ?? 0
  const noteNumber = phrase
    ? phrase.notes.slice(0, noteIndex + 1).filter((n) => !n.isTieContinuation).length
    : 0

  return (
    <div className="card">
      <div className="set-header">
        <h2>{item.title}</h2>
        <span className="tune-meta">
          {phase === 'complete'
            ? `${tune.phrases.length} phrases learned`
            : `Phrase ${Math.min(phraseIndex + 1, tune.phrases.length)} of ${tune.phrases.length}` +
              (phase === 'idle' ? '' : ` · note ${noteNumber} of ${targetsInPhrase}`)}
        </span>
      </div>

      {phase !== 'complete' && <div className="sheet-music" ref={sheetRef} />}

      {feedback && <p className="badge badge-queue">{feedback}</p>}
      {phase === 'listening' && <p className="tune-meta">🎤 Listening — play the note on your instrument…</p>}
      {phase === 'target' && <p className="tune-meta">🔊 Listen…</p>}
      {phase === 'phrase-playback' && <p className="tune-meta">🎵 Playing the phrase…</p>}

      {phase === 'idle' && (
        <div className="detail-controls">
          <button onClick={begin}>▶ Start ear training</button>
          <button onClick={hearPhrase}>🎵 Hear the phrase first</button>
          <label>
            Instrument
            <select
              value={earInstrument}
              onChange={(e) => {
                const val = Number((e.target as HTMLSelectElement).value)
                setEarInstrument(val)
                localStorage.setItem(EAR_INSTRUMENT_KEY, String(val))
              }}
            >
              {INSTRUMENTS.map((ins) => (
                <option key={ins.value} value={ins.value}>{ins.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {(phase === 'listening' || phase === 'target') && (
        <div className="detail-controls">
          <button onClick={playCurrentTarget} disabled={phase === 'target'}>
            🔊 Hear note again
          </button>
          <button onClick={hearPhrase} disabled={phase === 'target'}>
            🎵 Hear phrase
          </button>
          <button className="danger" onClick={revealCurrent}>
            Reveal note
          </button>
        </div>
      )}

      {phase === 'complete' && (
        <div>
          <p className="badge badge-queue">🎉 You've learned "{item.title}" by ear!</p>
          <div className="detail-controls">
            <button disabled={practiceMutation.isPending} onClick={() => practiceMutation.mutate()}>
              ✓ Log practice
            </button>
            <button onClick={startOver}>↻ Start over</button>
          </div>
          {practiceMutation.isSuccess && <p className="tune-meta">Practice logged.</p>}
        </div>
      )}

      {micError && <p className="error">{micError}</p>}
      {audioError && <p className="error">{audioError}</p>}
    </div>
  )
}
