import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { recordIntervalRound, type IntervalRoundResult } from '../services/api'
import { showBadgeToasts } from '../services/badges'
import { rememberReturnUrl } from '../services/returnUrl'
import { currentUserId, useSignal } from '../state/appState'
import { playNoteSequence, midiToHz, type NoteStep, type SequencePlayback } from '../services/earTraining'
import {
  availableSizes,
  generateRound,
  intervalSizeLabel,
  scaleMidis,
  tonicMidiInScale,
  weightsFromHistory,
  type DirectionMode,
  type IntervalQuestion,
  type IntervalHistory,
  type RoundConfig,
} from '../services/intervalTraining'
import { parseKeySignature } from '../services/abcTools'
import { spellMidiNote } from '../services/noteSpelling'
import { createPitchListener, midiToNoteName, type PitchListener } from '../services/pitchDetector'
import { INSTRUMENTS } from './instruments'

const SETTINGS_KEY = 'sessionapp.interval-training'
/**
 * Lifetime accuracy per size, kept apart from the settings so clearing the
 * record doesn't disturb a player's setup, or the other way round.
 */
const HISTORY_KEY = 'sessionapp.interval-history'

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
  directionMode: DirectionMode
  /** Sizes to drill; null means every size the scale allows. */
  sizes: number[] | null
  /** Bias the draw toward the sizes this player misses. */
  focusWeak: boolean
  /** Sound the tonic before each pair, so the interval is heard in its mode. */
  tonicReference: boolean
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
  directionMode: 'mixed',
  sizes: null,
  focusWeak: true,
  tonicReference: false,
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

const DIRECTIONS: { value: DirectionMode; label: string; blurb: string }[] = [
  { value: 'mixed', label: 'Both ways', blurb: 'the second may be higher or lower' },
  { value: 'up', label: 'Ascending only', blurb: 'the second is always higher' },
  { value: 'down', label: 'Descending only', blurb: 'the second is always lower' },
]

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

function loadHistory(): IntervalHistory {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as IntervalHistory) : {}
  } catch {
    return {}
  }
}

function saveHistory(history: IntervalHistory) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
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
  /** Set when a prompt couldn't be sounded at all, so silence doesn't read as a missing question. */
  const [audioError, setAudioError] = useState<string | null>(null)
  const [history, setHistory] = useState<IntervalHistory>(loadHistory)
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()
  /** What the server made of the last finished round; null until it answers, or when signed out. */
  const [roundReward, setRoundReward] = useState<IntervalRoundResult | null>(null)

  const phaseRef = useRef<Phase>('setup')
  const questionsRef = useRef<IntervalQuestion[]>([])
  const questionIndexRef = useRef(0)
  /** Which of the prompt's two notes the player still owes us (play-back mode). */
  const noteIndexRef = useRef(0)
  const listenerRef = useRef<PitchListener | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  /** The prompt currently sounding, so anything that moves on can silence it. */
  const playbackRef = useRef<SequencePlayback | null>(null)
  /**
   * Bumped by everything that abandons a prompt. A prompt only acts on what it finds after an
   * await if its own number is still the current one, so a second prompt can never play over a
   * first that was slow to load its soundfont.
   */
  const promptGenRef = useRef(0)
  const answerModeRef = useRef<AnswerMode>(settings.answerMode)
  /** Fresh per round, so a retried award can't score the same round twice. */
  const roundIdRef = useRef('')
  /** Right answers so far this round; `results` state lags a render behind when the round ends. */
  const correctCountRef = useRef(0)
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  const rewardMutation = useMutation({
    mutationFn: recordIntervalRound,
    onSuccess: (data) => {
      setRoundReward(data)
      showBadgeToasts(data.newBadges)
      queryClient.invalidateQueries({ queryKey: ['my-gamification'] })
    },
  })

  const scale = scaleMidis(settings.key, settings.mode, settings.minMidi, settings.maxMidi)
  const allSizes = scale ? availableSizes(scale) : []
  /** The sizes a round will actually ask for — what the answer buttons offer. */
  const sizes = settings.sizes ? allSizes.filter((s) => settings.sizes!.includes(s)) : allSizes
  const useFlats = (parseKeySignature(settings.key + settings.mode)?.sharps ?? 0) < 0

  /** The mode's home note, taken low in the range so it stays put between questions. */
  const tonicMidi = scale ? tonicMidiInScale(settings.key, settings.mode, scale) : null

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next
    setPhase(next)
  }

  function setQuestionIndexBoth(next: number) {
    questionIndexRef.current = next
    setQuestionIndex(next)
  }

  /** Adds one answer to the lifetime record for its size. */
  function recordResult(size: number, correct: boolean) {
    setHistory((prev) => {
      const stat = prev[size] ?? { asked: 0, correct: 0 }
      const next = {
        ...prev,
        [size]: { asked: stat.asked + 1, correct: stat.correct + (correct ? 1 : 0) },
      }
      saveHistory(next)
      return next
    })
  }

  function resetHistory() {
    saveHistory({})
    setHistory({})
  }

  /** Toggles a size in the drill selection; the last one left can't be removed. */
  function toggleSize(size: number) {
    const current = settings.sizes ?? allSizes
    const next = current.includes(size) ? current.filter((s) => s !== size) : [...current, size]
    if (next.length === 0) return
    updateSettings({ sizes: next.length === allSizes.length ? null : next.sort((a, b) => a - b) })
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
      promptGenRef.current++
      playbackRef.current?.stop()
      playbackRef.current = null
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

  /** Abandons whatever prompt is sounding, and voids any still waiting on its soundfont. */
  function cancelPrompt() {
    promptGenRef.current++
    playbackRef.current?.stop()
    playbackRef.current = null
  }

  async function playPrompt() {
    const q = currentQuestion()
    if (!q) return
    cancelPrompt()
    const gen = promptGenRef.current
    setPhaseBoth('prompt')
    listenerRef.current?.pause()

    // One buffer for the whole prompt, gaps and all: see playNoteSequence for why the notes can't
    // be three separate sounds spaced by timers. PROMPT_NOTE_MS and PROMPT_GAP_MS are offsets
    // within the rendered audio now, so nothing the device does can close the gap between them.
    const steps: NoteStep[] = []
    if (settings.tonicReference && tonicMidi !== null) {
      steps.push({ midi: tonicMidi, durationMs: PROMPT_NOTE_MS, gapMs: PROMPT_GAP_MS })
    }
    steps.push({ midi: q.rootMidi, durationMs: PROMPT_NOTE_MS, gapMs: PROMPT_GAP_MS })
    steps.push({ midi: q.targetMidi, durationMs: PROMPT_NOTE_MS })

    let playedMs = steps.reduce((total, s) => total + s.durationMs + (s.gapMs ?? 0), 0)
    try {
      const playback = await playNoteSequence(steps, settings.instrument)
      // The soundfont load can outlast the question it was for.
      if (gen !== promptGenRef.current) {
        playback.stop()
        return
      }
      playbackRef.current = playback
      playedMs = playback.durationMs
      setAudioError(null)
    } catch {
      // Answering still opens: a dead soundfont shouldn't strand the player mid-round, and in
      // naming mode the question is still answerable from the notation.
      setAudioError('Audio unavailable (soundfont could not be loaded).')
      playedMs = 0
    }

    await sleep(playedMs + PROMPT_TAIL_MS)
    if (gen !== promptGenRef.current || phaseRef.current !== 'prompt') return

    window.setTimeout(() => {
      if (gen !== promptGenRef.current || phaseRef.current !== 'prompt') return
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
    if (correct) correctCountRef.current++
    recordResult(q.size, correct)
    setPhaseBoth('reveal')
    // An answer given over a still-sounding prompt (a skip, or naming it before it finishes) ends
    // the prompt with it, rather than letting it run under the reveal and into the next question.
    cancelPrompt()
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
      // Only a finished round is sent; leaving through Settings mid-round earns nothing.
      if (userIdRef.current) {
        rewardMutation.mutate({
          roundId: roundIdRef.current,
          questionCount: questionsRef.current.length,
          correctCount: correctCountRef.current,
          // The mode actually used: a failed mic falls back to naming mid-setup.
          answerMode: answerModeRef.current,
        })
      }
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
    setAudioError(null)
    setResults([])
    setFeedback(null)
    setRoundReward(null)
    answerModeRef.current = settings.answerMode
    roundIdRef.current = crypto.randomUUID()
    correctCountRef.current = 0

    const config: RoundConfig = {
      key: settings.key,
      mode: settings.mode,
      minMidi: settings.minMidi,
      maxMidi: settings.maxMidi,
      questionCount: settings.questionCount,
      directionMode: settings.directionMode,
      sizes: settings.sizes ?? undefined,
      weights: settings.focusWeak ? weightsFromHistory(history, sizes) : undefined,
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
    cancelPrompt()
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

  const hasHistory = Object.keys(history).length > 0
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
            You'll hear two notes of the scale —{' '}
            {DIRECTIONS.find((d) => d.value === settings.directionMode)?.blurb ??
              'the second may be higher or lower'}
            . Play them back on your instrument, or name how far apart they are.
            {settings.tonicReference && tonicMidi !== null &&
              ` Each pair is introduced by the tonic, ${spellMidiNote(tonicMidi, useFlats)}.`}
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
              Direction
              <select
                value={settings.directionMode}
                onChange={(e) => updateSettings({ directionMode: e.target.value as DirectionMode })}
              >
                {DIRECTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
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

          <p className="tune-meta" style={{ marginBottom: '0.5rem' }}>
            Intervals to drill:
          </p>
          <div className="detail-controls" style={{ marginBottom: '1rem' }}>
            {allSizes.map((size) => (
              <button
                key={size}
                className={sizes.includes(size) ? 'toggled' : ''}
                onClick={() => toggleSize(size)}
              >
                {intervalSizeLabel(size)}
                {history[size]?.asked ? ` (${history[size].correct}/${history[size].asked})` : ''}
              </button>
            ))}
            {settings.sizes && <button onClick={() => updateSettings({ sizes: null })}>All</button>}
            {hasHistory && (
              <button className="danger" onClick={resetHistory}>
                Reset record
              </button>
            )}
          </div>

          <div className="detail-controls" style={{ marginBottom: '1rem' }}>
            <button
              className={settings.focusWeak ? 'toggled' : ''}
              onClick={() => updateSettings({ focusWeak: !settings.focusWeak })}
            >
              Focus on weak intervals
            </button>
            <button
              className={settings.tonicReference ? 'toggled' : ''}
              onClick={() => updateSettings({ tonicReference: !settings.tonicReference })}
            >
              Tonic reference note
            </button>
          </div>

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
          {userId && roundReward && (
            <p className="tune-meta" style={{ marginBottom: '1rem' }}>
              {roundReward.pointsAwarded > 0
                ? `+${roundReward.pointsAwarded} points`
                : "You've had today's points for intervals — rounds still count toward badges."}
            </p>
          )}
          {userId && rewardMutation.isError && (
            <p className="error">Couldn't record this round for points.</p>
          )}
          {!userId && (
            <p className="tune-meta" style={{ marginBottom: '1rem' }}>
              <Link href="/login" prefetch={false} onClick={() => rememberReturnUrl()}>
                Sign in
              </Link>{' '}
              to earn points and badges for your rounds.
            </p>
          )}
          <ul className="tune-list" style={{ marginBottom: '1rem' }}>
            {allSizes
              .map((size) => ({ size, asked: results.filter((r) => r.size === size) }))
              .filter((row) => row.asked.length > 0)
              .map((row) => (
                <li key={row.size} className="tune-meta">
                  {intervalSizeLabel(row.size)}: {row.asked.filter((r) => r.correct).length} of{' '}
                  {row.asked.length}
                  {history[row.size] &&
                    ` · ${history[row.size].correct} of ${history[row.size].asked} all told`}
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
      {audioError && <p className="error">{audioError}</p>}
    </div>
  )
}

export default IntervalTrainer
