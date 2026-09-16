import { useEffect, useRef, useState } from 'react'
import { playTargetNote, midiToHz } from '../services/earTraining'
import {
  availableSizes,
  generateRound,
  intervalSizeLabel,
  scaleMidis,
  type IntervalQuestion,
  type RoundConfig,
} from '../services/intervalTraining'
import { parseKeySignature } from '../services/abcTools'
import { spellMidiNote } from '../services/noteSpelling'
import { createPitchListener, midiToNoteName, type PitchListener } from '../services/pitchDetector'
import { INSTRUMENTS } from './instruments'

const SETTINGS_KEY = 'sessionapp.interval-training'

/** Pause between app audio ending and the mic listening again. */
const MIC_RESUME_DELAY_MS = 150
/**
 * Mic-off pause after a note is detected, so the player can register the
 * result and stop playing before the next prompt sounds. Without it, a
 * sustained note gets scored against the note that follows it.
 */
const DETECTION_HOLD_MS = 1200
/**
 * How long each prompt note sounds, and the silence between the first note
 * ending and the second starting. The pair has to read as two separate
 * pitches with room to compare them, not as a flourish — so the gap is real
 * silence rather than the notes running together.
 */
const PROMPT_NOTE_MS = 900
const PROMPT_GAP_MS = 400
/** Breath after the second note before answering opens. */
const PROMPT_TAIL_MS = 350
/** How long an answer stays on screen before the next question. */
const REVEAL_MS = 1600

type Phase = 'setup' | 'prompt' | 'listening' | 'choosing' | 'hold' | 'reveal' | 'summary'
type AnswerMode = 'play' | 'name'

interface Settings {
  key: string
  mode: string
  minMidi: number
  maxMidi: number
  questionCount: number
  answerMode: AnswerMode
  instrument: number
}

interface IntervalDebug {
  simulate(midi: number): void
  current(): { root: number; target: number; size: number; direction: string } | null
  phase(): string
}

interface WindowWithIntervalDebug extends Window {
  __intervalDebug?: IntervalDebug
}

const DEFAULT_SETTINGS: Settings = {
  key: 'D',
  mode: 'dor',
  minMidi: 62, // D4
  maxMidi: 86, // D6
  questionCount: 10,
  answerMode: 'name',
  instrument: 110, // Fiddle
}

const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Bb', 'Eb', 'Ab', 'F#', 'C#']

const MODES: { value: string; label: string }[] = [
  { value: 'maj', label: 'Major (Ionian)' },
  { value: 'dor', label: 'Dorian' },
  { value: 'mix', label: 'Mixolydian' },
  { value: 'min', label: 'Minor (Aeolian)' },
  { value: 'lyd', label: 'Lydian' },
  { value: 'phr', label: 'Phrygian' },
]

/** Range presets, low to high, as MIDI note numbers. */
const RANGES: { label: string; min: number; max: number }[] = [
  { label: 'One octave (D4–D5)', min: 62, max: 74 },
  { label: 'Two octaves (D4–D6)', min: 62, max: 86 },
  { label: 'Low (G3–G5)', min: 55, max: 79 },
  { label: 'Wide (G3–D6)', min: 55, max: 86 },
]

const ROUND_LENGTHS = [5, 10, 20]

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // A full or blocked localStorage shouldn't stop a drill.
  }
}

/**
 * Interval ear training. The app sounds two notes of a chosen key and mode,
 * rising or falling at random, and the player either plays them back on their instrument (mic,
 * octave-agnostic) or names the interval's diatonic size. The key fixes each
 * size's quality, so answers are "3rd", not "m3".
 *
 * Mutable drill state lives in refs as well as state because the pitch
 * callback is a long-lived closure created once when the mic starts.
 */
export function IntervalTrainer() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [phase, setPhase] = useState<Phase>('setup')
  const [questions, setQuestions] = useState<IntervalQuestion[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [results, setResults] = useState<{ size: number; correct: boolean }[]>([])
  const [noteIndex, setNoteIndex] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)

  const phaseRef = useRef<Phase>('setup')
  const questionsRef = useRef<IntervalQuestion[]>([])
  const questionIndexRef = useRef(0)
  /** Which of the prompt's two notes the player still owes us (play-back mode). */
  const noteIndexRef = useRef(0)
  const listenerRef = useRef<PitchListener | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const answerModeRef = useRef<AnswerMode>(settings.answerMode)

  const scale = scaleMidis(settings.key, settings.mode, settings.minMidi, settings.maxMidi)
  const sizes = scale ? availableSizes(scale) : []
  const useFlats = (parseKeySignature(settings.key + settings.mode)?.sharps ?? 0) < 0

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next
    setPhase(next)
  }

  function setQuestionIndexBoth(next: number) {
    questionIndexRef.current = next
    setQuestionIndex(next)
  }

  function setNoteIndexBoth(next: number) {
    noteIndexRef.current = next
    setNoteIndex(next)
  }

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      if (patch.answerMode) answerModeRef.current = patch.answerMode
      return next
    })
  }

  useEffect(() => {
    return () => {
      listenerRef.current?.stop()
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
    }
  }, [])

  // Hands-free driver for development: __intervalDebug.simulate(midi) behaves
  // exactly like a stable mic detection.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const win = window as WindowWithIntervalDebug
    win.__intervalDebug = {
      simulate: (midi: number) => handleDetectedNote(midi, midiToHz(midi), 0),
      current: () => {
        const q = currentQuestion()
        return q ? { root: q.rootMidi, target: q.targetMidi, size: q.size, direction: q.direction } : null
      },
      phase: () => phaseRef.current,
    }
    return () => {
      delete win.__intervalDebug
    }
  }, [])

  /** "3rd up", "octave down". */
  function describe(q: IntervalQuestion) {
    return `${intervalSizeLabel(q.size)} ${q.direction}`
  }

  /** "D → F", with the second note's direction marked. */
  function spellPair(q: IntervalQuestion) {
    const arrow = q.direction === 'up' ? '↗' : '↘'
    return `${spellMidiNote(q.rootMidi, useFlats)} ${arrow} ${spellMidiNote(q.targetMidi, useFlats)}`
  }

  function currentQuestion(): IntervalQuestion | undefined {
    return questionsRef.current[questionIndexRef.current]
  }

  /**
   * Stops listening and waits out DETECTION_HOLD_MS before `fn`. The phase
   * guard drops a firing that a skip or unmount has since moved past.
   */
  function holdThen(fn: () => void, delayMs = DETECTION_HOLD_MS) {
    listenerRef.current?.pause()
    setPhaseBoth('hold')
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      if (phaseRef.current !== 'hold') return
      fn()
    }, delayMs)
  }

  const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

  async function playPrompt() {
    const q = currentQuestion()
    if (!q) return
    setPhaseBoth('prompt')
    listenerRef.current?.pause()

    // playTargetNote resolves when the note starts, so each note's length is
    // waited out here. Awaiting it still matters: it covers soundfont load and
    // prime, which is what keeps the gap after the first note from absorbing a
    // cold start.
    await playTargetNote(q.rootMidi, PROMPT_NOTE_MS, settings.instrument)
    await sleep(PROMPT_NOTE_MS + PROMPT_GAP_MS)
    if (phaseRef.current !== 'prompt') return

    await playTargetNote(q.targetMidi, PROMPT_NOTE_MS, settings.instrument)
    await sleep(PROMPT_NOTE_MS + PROMPT_TAIL_MS)
    if (phaseRef.current !== 'prompt') return

    window.setTimeout(() => {
      if (phaseRef.current !== 'prompt') return
      if (answerModeRef.current === 'play') {
        setNoteIndexBoth(0)
        listenerRef.current?.resume()
        setPhaseBoth('listening')
      } else {
        setPhaseBoth('choosing')
      }
    }, MIC_RESUME_DELAY_MS)
  }

  function handleDetectedNote(midi: number, _hz: number, _cents: number) {
    if (phaseRef.current !== 'listening') return
    const q = currentQuestion()
    if (!q) return

    const wanted = noteIndexRef.current === 0 ? q.rootMidi : q.targetMidi
    const played = ((midi % 12) + 12) % 12
    const target = ((wanted % 12) + 12) % 12
    const playedName = midiToNoteName(midi)

    if (played !== target) {
      const diff = ((played - target + 18) % 12) - 6
      setFeedback(`✗ Played ${playedName} — try a bit ${diff < 0 ? 'higher' : 'lower'}`)
      holdThen(playPrompt)
      return
    }

    if (noteIndexRef.current === 0) {
      setNoteIndexBoth(1)
      setFeedback(`✓ ${playedName} — now the second note`)
      // Keep listening; the hold still applies so a sustained root isn't
      // scored again as the interval's upper note.
      holdThen(() => {
        listenerRef.current?.resume()
        setPhaseBoth('listening')
      })
      return
    }

    setFeedback(`✓ ${playedName} — that's a ${describe(q)}!`)
    score(true)
  }

  function chooseSize(size: number) {
    if (phaseRef.current !== 'choosing') return
    const q = currentQuestion()
    if (!q) return
    const correct = size === q.size
    setFeedback(
      correct
        ? `✓ ${describe(q)} — correct!`
        : `✗ That was a ${describe(q)} (${spellPair(q)})`,
    )
    score(correct)
  }

  function score(correct: boolean) {
    const q = currentQuestion()
    if (!q) return
    setResults((prev) => [...prev, { size: q.size, correct }])
    setPhaseBoth('reveal')
    listenerRef.current?.pause()
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      if (phaseRef.current !== 'reveal') return
      nextQuestion()
    }, REVEAL_MS)
  }

  function nextQuestion() {
    const next = questionIndexRef.current + 1
    if (next >= questionsRef.current.length) {
      listenerRef.current?.pause()
      setFeedback(null)
      setPhaseBoth('summary')
      return
    }
    setQuestionIndexBoth(next)
    setNoteIndexBoth(0)
    setFeedback(null)
    playPrompt()
  }

  function skipQuestion() {
    const q = currentQuestion()
    if (!q) return
    setFeedback(
      `The answer: ${describe(q)} — ${spellPair(q)}`,
    )
    score(false)
  }

  async function startRound() {
    if (!scale || scale.length < 2) return
    setMicError(null)
    setResults([])
    setFeedback(null)
    answerModeRef.current = settings.answerMode

    const config: RoundConfig = {
      key: settings.key,
      mode: settings.mode,
      minMidi: settings.minMidi,
      maxMidi: settings.maxMidi,
      questionCount: settings.questionCount,
    }
    const round = generateRound(config)
    if (round.length === 0) return
    questionsRef.current = round
    setQuestions(round)
    setQuestionIndexBoth(0)
    setNoteIndexBoth(0)

    if (settings.answerMode === 'play' && !listenerRef.current) {
      const listener = createPitchListener()
      listenerRef.current = listener
      try {
        await listener.start(handleDetectedNote)
      } catch {
        listenerRef.current = null
        answerModeRef.current = 'name'
        updateSettings({ answerMode: 'name' })
        setMicError(
          'Microphone unavailable — allow mic access and reload to play intervals back. Switched to naming them instead.',
        )
      }
    }

    playPrompt()
  }

  function backToSetup() {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
    listenerRef.current?.pause()
    setFeedback(null)
    setPhaseBoth('setup')
  }

  if (!scale || scale.length < 2) {
    return (
      <div className="card">
        <p className="error">
          That key and range don't make a usable scale — try a wider range.
        </p>
      </div>
    )
  }

  const question = questions[questionIndex]
  const correctCount = results.filter((r) => r.correct).length
  const inDrill = phase !== 'setup' && phase !== 'summary'

  return (
    <div className="card">
      <div className="set-header">
        <h2>Interval Training</h2>
        <span className="tune-meta">
          {phase === 'setup' && `${settings.key} ${MODES.find((m) => m.value === settings.mode)?.label ?? settings.mode}`}
          {inDrill && `Question ${questionIndex + 1} of ${questions.length} · ${correctCount} right`}
          {phase === 'summary' && `${correctCount} of ${results.length} right`}
        </span>
      </div>

      {phase === 'setup' && (
        <div>
          <p className="tune-meta" style={{ marginBottom: '1rem' }}>
            You'll hear two notes of the scale — the second may be higher or lower. Play
            them back on your instrument, or name how far apart they are.
          </p>

          <div className="detail-controls" style={{ marginBottom: '1rem' }}>
            <button
              className={settings.answerMode === 'play' ? 'toggled' : ''}
              onClick={() => updateSettings({ answerMode: 'play' })}
            >
              🎤 Play it back
            </button>
            <button
              className={settings.answerMode === 'name' ? 'toggled' : ''}
              onClick={() => updateSettings({ answerMode: 'name' })}
            >
              🔤 Name it
            </button>
          </div>

          <div className="detail-controls" style={{ marginBottom: '1rem' }}>
            <label>
              Key
              <select value={settings.key} onChange={(e) => updateSettings({ key: e.target.value })}>
                {KEYS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Mode
              <select value={settings.mode} onChange={(e) => updateSettings({ mode: e.target.value })}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
            <label>
              Range
              <select
                value={`${settings.minMidi}-${settings.maxMidi}`}
                onChange={(e) => {
                  const [min, max] = e.target.value.split('-').map(Number)
                  updateSettings({ minMidi: min, maxMidi: max })
                }}
              >
                {RANGES.map((r) => (
                  <option key={r.label} value={`${r.min}-${r.max}`}>{r.label}</option>
                ))}
              </select>
            </label>
            <label>
              Questions
              <select
                value={settings.questionCount}
                onChange={(e) => updateSettings({ questionCount: Number(e.target.value) })}
              >
                {ROUND_LENGTHS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Instrument
              <select
                value={settings.instrument}
                onChange={(e) => updateSettings({ instrument: Number(e.target.value) })}
              >
                {INSTRUMENTS.map((ins) => (
                  <option key={ins.value} value={ins.value}>{ins.label}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="tune-meta" style={{ marginBottom: '1rem' }}>
            Intervals in this key: {sizes.map(intervalSizeLabel).join(', ')}.
          </p>

          <div className="detail-controls">
            <button onClick={startRound}>▶ Start round</button>
          </div>
        </div>
      )}

      {inDrill && question && (
        <div>
          {phase === 'prompt' && <p className="tune-meta">🔊 Listen…</p>}
          {phase === 'listening' && (
            <p className="tune-meta">
              🎤 Play the {noteIndex === 0 ? 'first' : 'second'} note on your instrument…
            </p>
          )}
          {feedback && <p className="badge badge-queue">{feedback}</p>}

          {phase === 'choosing' && (
            <div className="detail-controls" style={{ marginBottom: '1rem' }}>
              {sizes.map((size) => (
                <button key={size} onClick={() => chooseSize(size)}>
                  {intervalSizeLabel(size)}
                </button>
              ))}
            </div>
          )}

          <div className="detail-controls">
            <button onClick={playPrompt} disabled={phase === 'prompt' || phase === 'reveal'}>
              🔊 Hear it again
            </button>
            <button className="danger" onClick={skipQuestion} disabled={phase === 'prompt' || phase === 'reveal'}>
              Skip &amp; reveal
            </button>
            <button onClick={backToSetup}>← Settings</button>
          </div>
        </div>
      )}

      {phase === 'summary' && (
        <div>
          <p className="badge badge-queue">
            🎉 Round complete — {correctCount} of {results.length} right
          </p>
          <ul className="tune-list" style={{ marginBottom: '1rem' }}>
            {sizes
              .map((size) => ({ size, asked: results.filter((r) => r.size === size) }))
              .filter((row) => row.asked.length > 0)
              .map((row) => (
                <li key={row.size} className="tune-meta">
                  {intervalSizeLabel(row.size)}: {row.asked.filter((r) => r.correct).length} of{' '}
                  {row.asked.length}
                </li>
              ))}
          </ul>
          <div className="detail-controls">
            <button onClick={startRound}>↻ Another round</button>
            <button onClick={backToSetup}>← Change settings</button>
          </div>
        </div>
      )}

      {micError && <p className="error">{micError}</p>}
    </div>
  )
}

export default IntervalTrainer
