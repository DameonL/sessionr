import { useEffect, useRef, useState } from 'preact/hooks'
import abcjs from 'abcjs'
import {
  INSTRUMENTS,
  loadInstruments,
  saveInstruments,
  synthInstrumentOptions,
  type Instruments,
} from './instruments.ts'

interface TunePlayerProps {
  abc: string
  targetBpm?: number | null
}

type PlayerStatus = 'stopped' | 'playing' | 'paused'

/** A/B loop bounds as fractions of the tune (tempo-invariant). */
interface Loop {
  a: number
  b: number
}

interface Trainer {
  armed: boolean
  startPct: number
  stepPct: number
  targetPct: number
}

/**
 * Sheet music plus audio playback with tempo adjustment, seeking, repeat,
 * A/B section looping, an incremental speed trainer, instrument selection,
 * and a follow-along note highlight. Rendering, audio, and timing all share
 * the same abcjs visual object and effective BPM so they can't drift apart.
 */
export function TunePlayer({ abc, targetBpm }: TunePlayerProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const visualObjRef = useRef<any>(null)
  const synthRef = useRef<any>(null)
  const timerRef = useRef<any>(null)
  const highlightedRef = useRef<Element[]>([])
  const repeatRef = useRef(false)
  const loopRef = useRef<Loop | null>(null)
  const trainerRef = useRef<Trainer | null>(null)
  const passRef = useRef(1)

  const [status, setStatus] = useState<PlayerStatus>('stopped')
  const [tempoPercent, setTempoPercent] = useState(100)
  const [repeat, setRepeat] = useState(false)
  const [instruments, setInstruments] = useState<Instruments>(loadInstruments)
  const [positionSec, setPositionSec] = useState(0)
  const [baseTotalSec, setBaseTotalSec] = useState(0)
  const [seekingSec, setSeekingSec] = useState<number | null>(null)
  const [loop, setLoop] = useState<Loop | null>(null)
  const [markA, setMarkA] = useState<number | null>(null)
  const [trainer, setTrainer] = useState<Trainer>({
    armed: false,
    startPct: 60,
    stepPct: 5,
    targetPct: 100,
  })
  const [passCount, setPassCount] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  // Total length at the current tempo; the slider and labels use this.
  const totalSec = baseTotalSec * (100 / tempoPercent)

  useEffect(() => {
    if (sheetRef.current) {
      const objs = abcjs.renderAbc(sheetRef.current, abc, { responsive: 'resize' })
      const visualObj = objs[0]
      visualObjRef.current = visualObj
      // Compute the duration at natural tempo so the slider is meaningful
      // before the first play.
      visualObj.setTiming(visualObj.getBpm())
      setBaseTotalSec(visualObj.getTotalTime() ?? 0)
      // Default trainer target: the tune's target BPM relative to its
      // natural tempo, when known.
      if (targetBpm) {
        const naturalBpm = visualObj.getBpm()
        if (naturalBpm > 0) {
          const pct = Math.min(150, Math.max(50, Math.round((targetBpm / naturalBpm) * 100)))
          setTrainer((t) => ({ ...t, targetPct: pct }))
        }
      }
    }
    return stop
  }, [abc])

  function clearHighlights() {
    for (const el of highlightedRef.current) {
      el.classList.remove('highlight')
    }
    highlightedRef.current = []
  }

  function stop() {
    synthRef.current?.stop()
    timerRef.current?.stop()
    clearHighlights()
    setPositionSec(0)
    setStatus('stopped')
    passRef.current = 1
    setPassCount(1)
  }

  function pause() {
    synthRef.current?.pause()
    timerRef.current?.pause()
    setStatus('paused')
  }

  function resume() {
    synthRef.current?.resume()
    timerRef.current?.start()
    setStatus('playing')
  }

  function seek(seconds: number) {
    if (!totalSec || (status !== 'playing' && status !== 'paused')) {
      return
    }
    const percent = Math.min(Math.max(seconds / totalSec, 0), 1)
    synthRef.current?.seek(percent)
    timerRef.current?.setProgress(percent)
    setPositionSec(seconds)
  }

  async function play(
    percent = tempoPercent,
    activeInstruments = instruments,
    startFraction = 0,
  ) {
    synthRef.current?.stop()
    timerRef.current?.stop()
    clearHighlights()
    setError(null)
    try {
      const visualObj = visualObjRef.current
      const effectiveBpm = Math.round(visualObj.getBpm() * (percent / 100))

      const synth = new abcjs.synth.CreateSynth()
      synthRef.current = synth
      await synth.init({
        visualObj,
        millisecondsPerMeasure: visualObj.millisecondsPerMeasure(effectiveBpm),
        options: synthInstrumentOptions(activeInstruments),
      })
      await synth.prime()

      const timer = new abcjs.TimingCallbacks(visualObj, {
        qpm: effectiveBpm,
        beatCallback: () => {
          const ms = timer.currentMillisecond()
          setPositionSec(ms / 1000)
          // Loop wrap: jump both audio and cursor back to A.
          const activeLoop = loopRef.current
          if (activeLoop && totalMsAtTempo > 0 && ms >= activeLoop.b * totalMsAtTempo) {
            onPassComplete(activeLoop.a)
          }
        },
        eventCallback: (ev: any) => {
          clearHighlights()
          if (!ev) {
            onPassComplete(loopRef.current?.a ?? 0, true)
            return
          }
          for (const group of ev.elements ?? []) {
            for (const el of group) {
              el.classList.add('highlight')
              highlightedRef.current.push(el)
            }
          }
        },
      })
      timerRef.current = timer
      // The TimingCallbacks constructor re-times the tune at effectiveBpm,
      // so this is the total at the current tempo.
      const totalMsAtTempo = (visualObj.getTotalTime() ?? 0) * 1000

      const onPassComplete = (restartFraction: number, tuneEnded = false) => {
        const activeTrainer = trainerRef.current
        if (activeTrainer?.armed) {
          passRef.current++
          setPassCount(passRef.current)
          const next = Math.min(percent + activeTrainer.stepPct, activeTrainer.targetPct)
          if (next > percent) {
            setTempoPercent(next)
            play(next, activeInstruments, restartFraction)
            return
          }
          jumpTo(restartFraction, tuneEnded)
          return
        }
        if (loopRef.current || repeatRef.current) {
          jumpTo(restartFraction, tuneEnded)
          return
        }
        setPositionSec(0)
        setStatus('stopped')
      }

      const jumpTo = (fraction: number, restartAudio: boolean) => {
        if (restartAudio) {
          // The buffer played to its end; seek positions the paused pointer,
          // then start resumes from it.
          synth.stop()
          synth.seek(fraction)
          synth.start()
          timer.stop()
          timer.start(fraction)
        } else {
          synth.seek(fraction)
          timer.setProgress(fraction)
        }
        setPositionSec((fraction * totalMsAtTempo) / 1000)
      }

      if (startFraction > 0) {
        synth.seek(startFraction)
      }
      synth.start()
      timer.start(startFraction > 0 ? startFraction : undefined)
      setStatus('playing')
    } catch {
      setError('Audio unavailable (soundfont could not be loaded).')
    }
  }

  function startPlayback() {
    if (trainer.armed) {
      passRef.current = 1
      setPassCount(1)
      setTempoPercent(trainer.startPct)
      play(trainer.startPct, instruments, loop?.a ?? 0)
    } else {
      play(tempoPercent, instruments, loop?.a ?? 0)
    }
  }

  function onTempoInput(e: Event) {
    const percent = Number((e.target as HTMLInputElement).value)
    setTempoPercent(percent)
    if (status !== 'stopped') {
      play(percent, instruments, loopRef.current?.a ?? 0)
    }
  }

  function onInstrumentChange(part: keyof Instruments) {
    return (e: Event) => {
      const next = { ...instruments, [part]: Number((e.target as HTMLSelectElement).value) }
      setInstruments(next)
      saveInstruments(next)
      if (status !== 'stopped') {
        // The audio buffer is baked with the old instruments; rebuild it.
        play(tempoPercent, next, loopRef.current?.a ?? 0)
      }
    }
  }

  function markLoopPoint() {
    if (!totalSec) return
    const fraction = Math.min(Math.max(positionSec / totalSec, 0), 1)
    if (markA === null) {
      setMarkA(fraction)
      loopRef.current = null
      setLoop(null)
    } else {
      const a = Math.min(markA, fraction)
      const b = Math.max(markA, fraction)
      if (b - a > 0.01) {
        const newLoop = { a, b }
        loopRef.current = newLoop
        setLoop(newLoop)
      }
      setMarkA(null)
    }
  }

  function clearLoop() {
    loopRef.current = null
    setLoop(null)
    setMarkA(null)
  }

  function updateTrainer(patch: Partial<Trainer>) {
    setTrainer((t) => {
      const next = { ...t, ...patch }
      trainerRef.current = next
      return next
    })
  }

  const formatTime = (sec: number) => {
    const whole = Math.max(0, Math.round(sec))
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
  }

  const sliderValue = seekingSec ?? positionSec

  return (
    <div ref={containerRef} class={`player-container ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {isFullscreen && (
        <div class="fullscreen-controls">
          <button
            onClick={() =>
              status === 'playing' ? pause() : status === 'paused' ? resume() : startPlayback()
            }
          >
            {status === 'playing' ? '⏸' : '▶'}
          </button>
          <button onClick={stop} disabled={status === 'stopped'}>
            ■
          </button>
          <button onClick={toggleFullscreen}>
            ✕
          </button>
        </div>
      )}
      <div class="sheet-music" ref={sheetRef} />

      <div class="player-seek">
        <span class="time-label">{formatTime(sliderValue)}</span>
        <div class="seek-track">
          <input
            type="range"
            min="0"
            max={totalSec || 1}
            step="0.1"
            value={sliderValue}
            disabled={status === 'stopped'}
            aria-label="Position in tune"
            onInput={(e) => setSeekingSec(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => {
              seek(Number((e.target as HTMLInputElement).value))
              setSeekingSec(null)
            }}
          />
          {markA !== null && (
            <span class="loop-marker" style={{ left: `${markA * 100}%` }} title="Loop start" />
          )}
          {loop && (
            <>
              <span class="loop-marker" style={{ left: `${loop.a * 100}%` }} title="Loop A" />
              <span class="loop-marker" style={{ left: `${loop.b * 100}%` }} title="Loop B" />
            </>
          )}
        </div>
        <span class="time-label">{formatTime(totalSec)}</span>
      </div>

      <div class="player-controls">
        <button onClick={() => (status === 'playing' ? pause() : status === 'paused' ? resume() : startPlayback())}>
          {status === 'playing' ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={stop} disabled={status === 'stopped'}>
          ■ Stop
        </button>
        <button
          class={repeat ? 'toggled' : ''}
          aria-pressed={repeat}
          onClick={() => {
            repeatRef.current = !repeat
            setRepeat(!repeat)
          }}
        >
          🔁 Repeat
        </button>
        <button onClick={toggleFullscreen}>
          ⛶ Fullscreen
        </button>
        <button
          class={loop || markA !== null ? 'toggled' : ''}
          disabled={status === 'stopped'}
          onClick={markLoopPoint}
          title="Mark loop start, then loop end, at the current position"
        >
          {markA !== null ? 'Set loop end' : loop ? 'New loop' : 'Set loop start'}
        </button>
        {(loop || markA !== null) && <button onClick={clearLoop}>✕ Loop off</button>}
        <label>
          Tempo {tempoPercent}%
          <input
            type="range"
            min="50"
            max="150"
            step="5"
            value={tempoPercent}
            onInput={onTempoInput}
          />
        </label>
      </div>

      <div class="player-controls">
        <button
          class={trainer.armed ? 'toggled' : ''}
          aria-pressed={trainer.armed}
          onClick={() => updateTrainer({ armed: !trainer.armed })}
        >
          🎯 Speed trainer
        </button>
        {trainer.armed && (
          <>
            <label>
              Start %
              <input
                class="trainer-input"
                type="number"
                min="50"
                max="150"
                step="5"
                value={trainer.startPct}
                onChange={(e) =>
                  updateTrainer({ startPct: Number((e.target as HTMLInputElement).value) || 60 })
                }
              />
            </label>
            <label>
              Step %
              <input
                class="trainer-input"
                type="number"
                min="1"
                max="20"
                value={trainer.stepPct}
                onChange={(e) =>
                  updateTrainer({ stepPct: Number((e.target as HTMLInputElement).value) || 5 })
                }
              />
            </label>
            <label>
              Target %
              <input
                class="trainer-input"
                type="number"
                min="50"
                max="150"
                step="5"
                value={trainer.targetPct}
                onChange={(e) =>
                  updateTrainer({ targetPct: Number((e.target as HTMLInputElement).value) || 100 })
                }
              />
            </label>
            {status !== 'stopped' && (
              <span class="tune-meta">
                Pass {passCount} · {tempoPercent}% → {trainer.targetPct}%
              </span>
            )}
          </>
        )}
      </div>

      <div class="player-controls">
        {(['melody', 'chords', 'bass'] as const).map((part) => (
          <label key={part}>
            {part[0].toUpperCase() + part.slice(1)}
            <select value={instruments[part]} onChange={onInstrumentChange(part)}>
              {INSTRUMENTS.map((inst) => (
                <option key={inst.value} value={inst.value}>
                  {inst.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {error && <p class="error">{error}</p>}
    </div>
  )
}
