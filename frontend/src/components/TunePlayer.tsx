import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import abcjs from 'abcjs'
import {
  INSTRUMENTS,
  loadInstruments,
  saveInstruments,
  synthInstrumentOptions,
  type Instruments,
} from './instruments.ts'
import {
  ALL_METRONOME_SOUNDS,
  BEAT_SOUNDS,
  DEFAULT_METRONOME_SOUND,
  MELODIC_SOUNDS,
  OTHER_PERCUSSION_SOUNDS,
  findMetronomeSound,
  getAbcKeyRoot,
  loadMetronomePrefs,
  playMetronomeClick,
  saveMetronomePrefs,
  type MetronomeSound,
} from '../services/metronome.ts'
import { fixAbcRepeats } from '../services/abcTools.ts'

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
  const processedAbc = useMemo(() => fixAbcRepeats(abc), [abc])
  const sheetRef = useRef<HTMLDivElement>(null)
  const visualObjRef = useRef<any>(null)
  const synthRef = useRef<any>(null)
  const timerRef = useRef<any>(null)
  const highlightedRef = useRef<Element[]>([])
  const repeatRef = useRef(false)
  const loopRef = useRef<Loop | null>(null)
  const trainerRef = useRef<Trainer | null>(null)
  const passRef = useRef(1)
  const isDraggingRef = useRef(false)
  const noteTimingsRef = useRef<any[]>([])
  const repeatLimitRef = useRef<number | null>(null)
  const repeatPassRef = useRef(1)
  const useMetronomeRef = useRef(false)
  const metronomeSoundRef = useRef<MetronomeSound>(DEFAULT_METRONOME_SOUND)
  const keyRootRef = useRef<number>(72)
  const playIdRef = useRef(0)

  // Load persisted metronome prefs once, before first render.
  const _initPrefs = loadMetronomePrefs()
  useMetronomeRef.current = _initPrefs.enabled
  metronomeSoundRef.current = findMetronomeSound(_initPrefs.soundKey)
  const [useMetronome, setUseMetronome] = useState(() => _initPrefs.enabled)
  const [metronomeSound, setMetronomeSound] = useState<MetronomeSound>(
    () => findMetronomeSound(_initPrefs.soundKey),
  )
  const [status, setStatus] = useState<PlayerStatus>('stopped')
  const [tempoPercent, setTempoPercent] = useState(100)
  const [swingPercent, setSwingPercent] = useState(50)
  const [repeat, setRepeat] = useState(false)
  const [repeatLimit, setRepeatLimit] = useState<number | null>(null)
  const [instruments, setInstruments] = useState<Instruments>(loadInstruments)
  const [positionSec, setPositionSec] = useState(0)
  const [baseTotalSec, setBaseTotalSec] = useState(0)
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
      const objs = abcjs.renderAbc(sheetRef.current, processedAbc, { responsive: 'resize' })
      const visualObj = objs[0]
      visualObjRef.current = visualObj
      // Compute the duration at natural tempo so the slider is meaningful
      // before the first play.
      const timings = (visualObj as any).setTiming(visualObj.getBpm()) || []
      noteTimingsRef.current = timings
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
  }, [processedAbc])

  function clearHighlights() {
    for (const el of highlightedRef.current) {
      el.classList.remove('highlight')
    }
    highlightedRef.current = []
    const svg = sheetRef.current?.querySelector('svg')
    const cursor = svg?.querySelector('.abcjs-cursor')
    if (cursor) {
      cursor.setAttribute('y1', '0')
      cursor.setAttribute('y2', '0')
    }
  }

  function stop() {
    synthRef.current?.stop()
    timerRef.current?.stop()
    clearHighlights()
    setPositionSec(0)
    setStatus('stopped')
    passRef.current = 1
    setPassCount(1)
    repeatPassRef.current = 1
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
    if (!totalSec) {
      return
    }
    const clampedSeconds = Math.min(Math.max(seconds, 0), totalSec)
    const percent = clampedSeconds / totalSec

    if (status === 'stopped') {
      setPositionSec(clampedSeconds)
      updateVisualsForTime(clampedSeconds)
      return
    }

    synthRef.current?.seek(percent)
    timerRef.current?.setProgress(percent)
    setPositionSec(clampedSeconds)
  }

  async function play(
    percent = tempoPercent,
    activeInstruments = instruments,
    startFraction = 0,
  ) {
    const playId = ++playIdRef.current
    synthRef.current?.stop()
    timerRef.current?.stop()
    clearHighlights()
    setError(null)
    try {
      if (!sheetRef.current) return
      const objs = abcjs.renderAbc(sheetRef.current, processedAbc, { responsive: 'resize' })
      const visualObj = objs[0]
      visualObjRef.current = visualObj

      const effectiveBpm = Math.round(visualObj.getBpm() * (percent / 100))

      const synth = new abcjs.synth.CreateSynth()
      if (playId !== playIdRef.current) return
      synthRef.current = synth
      await synth.init({
        visualObj,
        millisecondsPerMeasure: visualObj.millisecondsPerMeasure(effectiveBpm),
        options: {
          ...synthInstrumentOptions(activeInstruments),
          swing: swingPercent,
        },
      })
      if (playId !== playIdRef.current) {
        synth.stop()
        return
      }
      await synth.prime()
      if (playId !== playIdRef.current) {
        synth.stop()
        return
      }

      keyRootRef.current = getAbcKeyRoot(processedAbc)

      const timer = new abcjs.TimingCallbacks(visualObj, {
        qpm: effectiveBpm,
        beatCallback: (beatNumber: number) => {
          if (useMetronomeRef.current) {
            const sound = metronomeSoundRef.current
            if (beatNumber === 1) {
              // Downbeat: bass drum (36) for percussion, tonic note for melodic
              const pitch = sound.instrument === 128 ? 36 : keyRootRef.current
              playMetronomeClick(sound, pitch)
            } else {
              // Other beats: configured drum note, or tonic one octave lower for melodic
              const pitch = sound.instrument === 128 ? undefined : keyRootRef.current - 12
              playMetronomeClick(sound, pitch)
            }
          }
          const ms = timer.currentMillisecond()
          if (!isDraggingRef.current) {
            setPositionSec(ms / 1000)
          }
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
          const svg = sheetRef.current?.querySelector('svg') as SVGSVGElement | null
          if (ev.left !== null && svg) {
            updateCursorPosition(svg, ev.left - 2, ev.top, ev.top + ev.height)
          }
        },
      })
      if (playId !== playIdRef.current) {
        synth.stop()
        return
      }
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
          if (tuneEnded) {
            play(percent, activeInstruments, restartFraction)
          } else {
            jumpTo(restartFraction)
          }
          return
        }
        if (loopRef.current) {
          if (tuneEnded) {
            play(percent, activeInstruments, restartFraction)
          } else {
            jumpTo(restartFraction)
          }
          return
        }
        if (repeatRef.current) {
          if (repeatLimitRef.current === null || repeatPassRef.current < repeatLimitRef.current) {
            repeatPassRef.current++
            if (tuneEnded) {
              play(percent, activeInstruments, restartFraction)
            } else {
              jumpTo(restartFraction)
            }
            return
          }
        }
        setPositionSec(0)
        setStatus('stopped')
      }

      const jumpTo = (fraction: number) => {
        synth.seek(fraction)
        timer.setProgress(fraction)
        if (!isDraggingRef.current) {
          setPositionSec((fraction * totalMsAtTempo) / 1000)
        }
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
    repeatPassRef.current = 1
    const startFraction = totalSec > 0 ? positionSec / totalSec : 0
    if (trainer.armed) {
      passRef.current = 1
      setPassCount(1)
      setTempoPercent(trainer.startPct)
      play(trainer.startPct, instruments, loop?.a ?? startFraction)
    } else {
      play(tempoPercent, instruments, loop?.a ?? startFraction)
    }
  }

  function onTempoInput(e: Event) {
    const percent = Number((e.target as HTMLInputElement).value)
    setTempoPercent(percent)
  }

  function onTempoChange(e: Event) {
    const percent = Number((e.target as HTMLInputElement).value)
    setTempoPercent(percent)
    if (status !== 'stopped') {
      const currentFraction = totalSec > 0 ? positionSec / totalSec : 0
      play(percent, instruments, currentFraction)
    }
  }

  function onSwingInput(e: Event) {
    const percent = Number((e.target as HTMLInputElement).value)
    setSwingPercent(percent)
  }

  function onSwingChange(e: Event) {
    const percent = Number((e.target as HTMLInputElement).value)
    setSwingPercent(percent)
    if (status !== 'stopped') {
      const currentFraction = totalSec > 0 ? positionSec / totalSec : 0
      play(tempoPercent, instruments, currentFraction)
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
        <span class="time-label">{formatTime(positionSec)}</span>
        <div class="seek-track">
          <input
            type="range"
            min="0"
            max={totalSec || 1}
            step="0.1"
            value={positionSec}
            disabled={totalSec <= 0}
            aria-label="Position in tune"
            onMouseDown={() => {
              isDraggingRef.current = true
            }}
            onTouchStart={() => {
              isDraggingRef.current = true
            }}
            onInput={(e) => {
              const val = Number((e.target as HTMLInputElement).value)
              setPositionSec(val)
              updateVisualsForTime(val)
            }}
            onChange={(e) => {
              isDraggingRef.current = false
              seek(Number((e.target as HTMLInputElement).value))
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
            const next = !repeat
            repeatRef.current = next
            setRepeat(next)
          }}
        >
          🔁 Repeat
        </button>
        <button
          class={useMetronome ? 'toggled' : ''}
          aria-pressed={useMetronome}
          onClick={() => {
            const next = !useMetronome
            useMetronomeRef.current = next
            setUseMetronome(next)
            saveMetronomePrefs({ enabled: next, soundKey: metronomeSoundRef.current.key })
          }}
        >
          🔊 Metronome
        </button>
        {useMetronome && (
          <label>
            Beat
            <select
              value={metronomeSound.key}
              onChange={(e) => {
                const sound = ALL_METRONOME_SOUNDS.find(
                  (s) => s.key === (e.target as HTMLSelectElement).value,
                ) ?? DEFAULT_METRONOME_SOUND
                setMetronomeSound(sound)
                metronomeSoundRef.current = sound
                saveMetronomePrefs({ enabled: useMetronomeRef.current, soundKey: sound.key })
              }}
            >
              <optgroup label="Beat &amp; Percussion">
                {BEAT_SOUNDS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </optgroup>
              <optgroup label="Other Percussion">
                {OTHER_PERCUSSION_SOUNDS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </optgroup>
              <optgroup label="Melodic Instruments">
                {MELODIC_SOUNDS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </optgroup>
            </select>
          </label>
        )}
        {repeat && (
          <label>
            Times
            <input
              type="number"
              min="1"
              placeholder="∞"
              value={repeatLimit || ''}
              onChange={(e) => {
                const val = (e.target as HTMLInputElement).value
                const num = val ? parseInt(val, 10) : null
                setRepeatLimit(num && num > 0 ? num : null)
                repeatLimitRef.current = num && num > 0 ? num : null
              }}
              class="reps-input"
              title="Number of times to repeat (leave empty for infinite)"
            />
          </label>
        )}
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
            onChange={onTempoChange}
          />
        </label>
        <label>
          Swing {swingPercent}%
          <input
            type="range"
            min="50"
            max="75"
            step="1"
            value={swingPercent}
            onInput={onSwingInput}
            onChange={onSwingChange}
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

  function updateVisualsForTime(seconds: number) {
    const visualObj = visualObjRef.current
    if (!visualObj || !noteTimingsRef.current || noteTimingsRef.current.length === 0) return

    const naturalMs = seconds * tempoPercent * 10
    
    let bestEvent = null
    for (const ev of noteTimingsRef.current) {
      if (ev.type === 'event') {
        if (ev.milliseconds <= naturalMs) {
          bestEvent = ev
        } else {
          break
        }
      }
    }

    clearHighlights()

    const svg = sheetRef.current?.querySelector('svg') as SVGSVGElement | null
    if (bestEvent && bestEvent.left !== null) {
      for (const group of bestEvent.elements ?? []) {
        for (const el of group) {
          el.classList.add('highlight')
          highlightedRef.current.push(el)
        }
      }

      if (svg) {
        updateCursorPosition(svg, bestEvent.left - 2, bestEvent.top, bestEvent.top + bestEvent.height)
      }
    } else {
      const cursor = svg?.querySelector('.abcjs-cursor')
      if (cursor) {
        cursor.setAttribute('y1', '0')
        cursor.setAttribute('y2', '0')
      }
    }
  }
}

function getOrCreateCursor(svg: SVGSVGElement | null): SVGLineElement | null {
  if (!svg) return null
  let cursor = svg.querySelector('.abcjs-cursor') as SVGLineElement
  if (!cursor) {
    cursor = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    cursor.setAttribute('class', 'abcjs-cursor')
    cursor.setAttribute('x1', '0')
    cursor.setAttribute('y1', '0')
    cursor.setAttribute('x2', '0')
    cursor.setAttribute('y2', '0')
    svg.appendChild(cursor)
  }
  return cursor
}

function updateCursorPosition(svg: SVGSVGElement | null, x: number, y1: number, y2: number) {
  const cursor = getOrCreateCursor(svg)
  if (cursor) {
    cursor.setAttribute('x1', String(x))
    cursor.setAttribute('x2', String(x))
    cursor.setAttribute('y1', String(y1))
    cursor.setAttribute('y2', String(y2))
  }
}


