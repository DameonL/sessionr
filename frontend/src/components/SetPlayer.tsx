import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import abcjs from 'abcjs'
import {
  INSTRUMENTS,
  loadInstruments,
  saveInstruments,
  synthInstrumentOptions,
} from './instruments'
import { getAbcKeyRoot, playMetronomeClick } from '../services/metronome'
import { fixAbcRepeats } from '../services/abcTools'
import {
  MetronomeControls,
  StaffLine,
  extractLinesFromTimings,
  formatTime,
  getOrCreateCursor,
  scrollToKeepLinesVisible,
  toAbcjsSwing,
  updateCursorPosition,
  useCommitOnChange,
  useMetronomePrefs,
} from './playerControls'

export interface SetPlayerItem {
  userTuneId: string
  title: string
  abc: string
  repetitions: number
}

type PlayerStatus = 'stopped' | 'playing' | 'paused'

interface ExtendedTuneObject extends abcjs.TuneObject {
  setTiming(bpm?: number, measuresOfDelay?: number): abcjs.NoteTimingEvent[];
}

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

export interface SetPlayerProps {
  items: SetPlayerItem[]
  targetBpm?: number | null
  isSingleTune?: boolean
  /** Overrides the per-tune link target (defaults to the personal tune detail page); return null to render plain text. */
  linkHref?: (item: SetPlayerItem) => string | null
}

/**
 * Consolidated player component: renders and plays sheet music for a single tune
 * or a set medley of multiple tunes. Automatically hides set-specific headers
 * for single tunes while offering speed training and section looping.
 */
export function SetPlayer({
  items,
  targetBpm,
  isSingleTune,
  linkHref,
}: SetPlayerProps) {
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([])
  const visualObjsRef = useRef<(ExtendedTuneObject | null)[]>([])
  const durationsRef = useRef<number[]>([])
  const synthsRef = useRef<(abcjs.MidiBuffer | null)[]>([])
  const timerRef = useRef<abcjs.TimingCallbacks | null>(null)
  const highlightedRef = useRef<Element[]>([])
  const isDraggingRef = useRef(false)
  const noteTimingsRef = useRef<abcjs.NoteTimingEvent[][]>([])
  const tuneLinesRef = useRef<StaffLine[][]>([])
  const repeatRef = useRef(false)
  const repeatLimitRef = useRef<number | null>(null)
  const setPassRef = useRef(1)
  const keyRootRef = useRef<number>(72)
  const loopRef = useRef<Loop | null>(null)
  const trainerRef = useRef<Trainer | null>(null)
  const passRef = useRef(1)

  const metronome = useMetronomePrefs()
  const { useMetronome, metronomeSound, useMetronomeRef, metronomeSoundRef } = metronome
  const [status, setStatus] = useState<PlayerStatus>('stopped')
  const [tempoPercent, setTempoPercent] = useState(100)
  const [swingPercent, setSwingPercent] = useState(0)
  const [repeat, setRepeat] = useState(false)
  const [repeatLimit, setRepeatLimit] = useState<number | null>(null)
  const [instruments, setInstruments] = useState(loadInstruments)
  const [positionSec, setPositionSec] = useState(0)
  const [currentTotalSec, setCurrentTotalSec] = useState(0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [activePass, setActivePass] = useState(1)
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
  const isFullscreenRef = useRef(false)

  const isSingle = isSingleTune || items.length === 1

  useEffect(() => {
    const handleFsChange = () => {
      const next = document.fullscreenElement === containerRef.current
      isFullscreenRef.current = next
      setIsFullscreen(next)
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

  const itemsKey = items.map((i) => `${i.userTuneId}:${i.repetitions}:${i.abc}`).join(',')

  useEffect(() => {
    noteTimingsRef.current = []
    tuneLinesRef.current = []
    visualObjsRef.current = items.map((item, index) => {
      const host = sheetRefs.current[index]
      if (!host) return null
      const visualObj = abcjs.renderAbc(host, fixAbcRepeats(item.abc), { responsive: 'resize' })[0] as ExtendedTuneObject
      const timings = visualObj.setTiming(visualObj.getBpm())
      noteTimingsRef.current[index] = timings
      tuneLinesRef.current[index] = extractLinesFromTimings(timings)
      if (targetBpm && index === 0) {
        const naturalBpm = visualObj.getBpm()
        if (naturalBpm > 0) {
          const pct = Math.min(150, Math.max(50, Math.round((targetBpm / naturalBpm) * 100)))
          setTrainer((t) => ({ ...t, targetPct: pct }))
        }
      }
      return visualObj
    })
    return () => stop(false)
  }, [itemsKey, targetBpm])

  function checkAutoScroll(tuneIndex: number, ev: { top?: number }) {
    if (!isFullscreenRef.current || typeof ev.top !== 'number') return
    const lines = tuneLinesRef.current[tuneIndex] || []
    if (lines.length === 0) return

    const host = sheetRefs.current[tuneIndex]
    const svg = host?.querySelector('svg') as SVGSVGElement | null
    if (!svg) return

    const top = ev.top
    const lineIndex = lines.findIndex((l) => Math.abs(l.top - top) < 15)
    if (lineIndex === -1) return

    const currentLine = lines[lineIndex]
    let nextLine: StaffLine | null = null
    let nextSvg: SVGSVGElement | null = null

    if (lineIndex + 1 < lines.length) {
      nextLine = lines[lineIndex + 1]
    } else if (tuneIndex + 1 < items.length) {
      const nextTuneLines = tuneLinesRef.current[tuneIndex + 1] || []
      if (nextTuneLines.length > 0) {
        nextLine = nextTuneLines[0]
        const nextHost = sheetRefs.current[tuneIndex + 1]
        nextSvg = (nextHost?.querySelector('svg') as SVGSVGElement | null) ?? null
      }
    }

    const scrollContainer =
      (containerRef.current?.querySelector('.set-player-tunes-list, .sheet-music') as HTMLElement | null) ??
      containerRef.current
    scrollToKeepLinesVisible(scrollContainer, svg, currentLine, nextLine, nextSvg)
  }

  useEffect(() => {
    if (visualObjsRef.current.length === items.length) {
      const newDurations = items.map((_, index) => {
        const visualObj = visualObjsRef.current[index]
        const naturalTotalSec = visualObj?.getTotalTime() ?? 0
        return naturalTotalSec * (100 / tempoPercent)
      })
      durationsRef.current = newDurations
      setCurrentTotalSec(
        newDurations.reduce((sum, duration, index) => sum + duration * items[index].repetitions, 0)
      )
    }
  }, [itemsKey, tempoPercent])

  function clearHighlights() {
    for (const el of highlightedRef.current) {
      el.classList.remove('highlight')
    }
    highlightedRef.current = []
    for (const host of sheetRefs.current) {
      const svg = host?.querySelector('svg')
      const cursor = svg?.querySelector('.abcjs-cursor')
      if (cursor) {
        cursor.setAttribute('y1', '0')
        cursor.setAttribute('y2', '0')
      }
    }
  }

  function stop(keepPosition = false) {
    for (const synth of synthsRef.current) {
      synth?.stop()
    }
    synthsRef.current = []
    if (timerRef.current) {
      timerRef.current.stop()
      timerRef.current = null
    }
    clearHighlights()
    setActiveIndex(null)
    setActivePass(1)
    if (!keepPosition) {
      setPositionSec(0)
    }
    setStatus('stopped')
    setPassRef.current = 1
    passRef.current = 1
    setPassCount(1)
  }

  function pause() {
    if (activeIndex === null) return
    synthsRef.current[activeIndex]?.pause()
    timerRef.current?.pause()
    setStatus('paused')
  }

  function resume() {
    if (activeIndex === null) return
    synthsRef.current[activeIndex]?.resume()
    timerRef.current?.start()
    setStatus('playing')
  }

  function markLoopPoint() {
    if (!currentTotalSec) return
    const fraction = Math.min(Math.max(positionSec / currentTotalSec, 0), 1)
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

  function seek(seconds: number) {
    if (currentTotalSec <= 0 || durationsRef.current.length !== items.length) {
      return
    }

    const clampedSeconds = Math.min(Math.max(seconds, 0), currentTotalSec)
    let remaining = clampedSeconds
    let targetIndex = 0
    let targetPass = 1

    for (let i = 0; i < items.length; i++) {
      const tuneDuration = durationsRef.current[i]
      const totalTuneDuration = tuneDuration * items[i].repetitions
      if (remaining < totalTuneDuration) {
        targetIndex = i
        targetPass = Math.floor(remaining / tuneDuration) + 1
        remaining = remaining - tuneDuration * (targetPass - 1)
        break
      }
      remaining -= totalTuneDuration
    }

    const startFraction = durationsRef.current[targetIndex] > 0 ? remaining / durationsRef.current[targetIndex] : 0

    if (status === 'stopped') {
      setPositionSec(clampedSeconds)
      setActiveIndex(targetIndex)
      setActivePass(targetPass)
      updateVisualsForTime(clampedSeconds)
      return
    }

    if (timerRef.current) {
      timerRef.current.stop()
      timerRef.current = null
    }
    if (activeIndex !== null) {
      synthsRef.current[activeIndex]?.stop()
    }

    clearHighlights()
    setPositionSec(clampedSeconds)
    setActiveIndex(targetIndex)
    setActivePass(targetPass)

    startTune(targetIndex, tempoPercent, targetPass, startFraction, false)
  }

  async function play(percent = tempoPercent) {
    const keepPosition = positionSec > 0
    const wasStopped = status === 'stopped'
    stop(keepPosition)
    if (wasStopped) {
      setPassRef.current = 1
    }
    setError(null)
    try {
      const newDurations = items.map((_, index) => {
        const visualObj = visualObjsRef.current[index]
        const naturalTotalSec = visualObj?.getTotalTime() ?? 0
        return naturalTotalSec * (100 / percent)
      })
      durationsRef.current = newDurations
      setCurrentTotalSec(
        newDurations.reduce((sum, duration, index) => sum + duration * items[index].repetitions, 0)
      )

      const synths = await Promise.all(
        items.map(async (_, index) => {
          const visualObj = visualObjsRef.current[index]
          if (!visualObj) throw new Error('Visual object not initialized')
          const effectiveBpm = Math.round(visualObj.getBpm() * (percent / 100))
          const synth = new abcjs.synth.CreateSynth()
          await synth.init({
            visualObj,
            millisecondsPerMeasure: visualObj.millisecondsPerMeasure(effectiveBpm),
            options: {
              ...synthInstrumentOptions(instruments),
              swing: toAbcjsSwing(swingPercent),
            },
          })
          await synth.prime()
          return synth
        }),
      )
      synthsRef.current = synths

      let targetIndex = 0
      let targetPass = 1
      let targetFraction = 0

      if (keepPosition) {
        let remaining = positionSec
        for (let i = 0; i < items.length; i++) {
          const tuneDuration = durationsRef.current[i]
          const totalTuneDuration = tuneDuration * items[i].repetitions
          if (remaining < totalTuneDuration) {
            targetIndex = i
            targetPass = Math.floor(remaining / tuneDuration) + 1
            remaining = remaining - tuneDuration * (targetPass - 1)
            break
          }
          remaining -= totalTuneDuration
        }
        targetFraction = durationsRef.current[targetIndex] > 0 ? remaining / durationsRef.current[targetIndex] : 0
      }

      setStatus('playing')
      if (trainer.armed && wasStopped) {
        passRef.current = 1
        setPassCount(1)
        setTempoPercent(trainer.startPct)
        startTune(targetIndex, trainer.startPct, targetPass, loop?.a ?? targetFraction)
      } else {
        startTune(targetIndex, percent, targetPass, loop?.a ?? targetFraction)
      }
    } catch {
      setError('Audio unavailable (soundfont could not be loaded).')
    }
  }

  function startTune(
    index: number,
    percent: number,
    startPass = 1,
    startFraction = 0,
    shouldScroll = true,
  ) {
    const visualObj = visualObjsRef.current[index]
    const synth = synthsRef.current[index]
    if (!visualObj || !synth) return
    const effectiveBpm = Math.round(visualObj.getBpm() * (percent / 100))
    let pass = startPass

    setActiveIndex(index)
    setActivePass(startPass)
    if (shouldScroll) {
      sheetRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }

    const elapsedBeforeTune = durationsRef.current
      .slice(0, index)
      .reduce((sum, duration, i) => sum + duration * items[i].repetitions, 0)
    const tuneDuration = durationsRef.current[index] ?? 0
    
    if (!isDraggingRef.current) {
      setPositionSec(elapsedBeforeTune + tuneDuration * (startPass - 1) + tuneDuration * startFraction)
    }

    keyRootRef.current = getAbcKeyRoot(items[index].abc)

    const timer = new abcjs.TimingCallbacks(visualObj, {
      qpm: effectiveBpm,
      beatCallback: (beatNumber: number) => {
        if (useMetronomeRef.current) {
          const sound = metronomeSoundRef.current
          if (beatNumber === 1) {
            const pitch = sound.instrument === 128 ? 36 : keyRootRef.current
            playMetronomeClick(sound, pitch)
          } else {
            const pitch = sound.instrument === 128 ? undefined : keyRootRef.current - 12
            playMetronomeClick(sound, pitch)
          }
        }
        const activeLoop = loopRef.current
        const totalMsAtTempo = currentTotalSec * 1000
        const ms = timer.currentMillisecond()
        if (activeLoop && totalMsAtTempo > 0 && ms >= activeLoop.b * totalMsAtTempo) {
          synth.seek(activeLoop.a)
          timer.setProgress(activeLoop.a)
        }
      },
      eventCallback: (ev: abcjs.NoteTimingEvent | null) => {
        clearHighlights()
        if (ev) {
          const ms = timer.currentMillisecond()
          const elapsedBeforeTune = durationsRef.current
            .slice(0, index)
            .reduce((sum, duration, i) => sum + duration * items[i].repetitions, 0)
          
          if (!isDraggingRef.current) {
            setPositionSec(elapsedBeforeTune + tuneDuration * (pass - 1) + ms / 1000)
          }
          
          for (const group of ev.elements ?? []) {
            for (const el of group) {
              el.classList.add('highlight')
              highlightedRef.current.push(el)
            }
          }
          const host = sheetRefs.current[index]
          const svg = host?.querySelector('svg') as SVGSVGElement | null
          if (typeof ev.left === 'number' && typeof ev.top === 'number' && typeof ev.height === 'number' && svg) {
            updateCursorPosition(svg, ev.left - 2, ev.top, ev.top + ev.height)
            checkAutoScroll(index, ev)
          }
          return undefined
        }
        // End of one pass through the tune.
        synth.stop()
        timer.stop()
        const host = sheetRefs.current[index]
        const svg = host?.querySelector('svg')
        const cursor = svg?.querySelector('.abcjs-cursor')
        if (cursor) {
          cursor.setAttribute('y1', '0')
          cursor.setAttribute('y2', '0')
        }

        const activeTrainer = trainerRef.current
        if (activeTrainer?.armed) {
          passRef.current++
          setPassCount(passRef.current)
          const nextPct = Math.min(percent + activeTrainer.stepPct, activeTrainer.targetPct)
          play(nextPct)
          return undefined
        }

        if (pass < items[index].repetitions) {
          pass++
          setActivePass(pass)
          synth.seek(0)
          synth.start()
          timer.setProgress(0)
          timer.start(0)
          return 'continue'
        } else if (index + 1 < items.length) {
          startTune(index + 1, percent)
        } else if (repeatRef.current) {
          if (repeatLimitRef.current === null || setPassRef.current < repeatLimitRef.current) {
            setPassRef.current++
            startTune(0, percent)
          } else {
            stop()
          }
        } else {
          stop()
        }
        return undefined
      },
    })
    timerRef.current = timer

    const isPlayerPaused = status === 'paused'
    if (isPlayerPaused) {
      synth.seek(startFraction)
      timer.start(startFraction)
      timer.setProgress(startFraction)
      timer.pause()
    } else {
      if (startFraction > 0) {
        synth.seek(startFraction)
      }
      synth.start()
      timer.start(startFraction)
      if (startFraction > 0) {
        timer.setProgress(startFraction)
      }
    }
  }

  function onTempoInput(e: ChangeEvent<HTMLInputElement>) {
    const percent = Number((e.target as HTMLInputElement).value)
    setTempoPercent(percent)
  }

  function onSwingInput(e: ChangeEvent<HTMLInputElement>) {
    const percent = Number((e.target as HTMLInputElement).value)
    setSwingPercent(percent)
  }

  function restartAtCurrentPosition() {
    if (status !== 'stopped') {
      play(tempoPercent)
    }
  }
  const tempoInputRef = useCommitOnChange(restartAtCurrentPosition)
  const swingInputRef = useCommitOnChange(restartAtCurrentPosition)

  function onInstrumentChange(part: keyof typeof instruments) {
    return (e: ChangeEvent<HTMLSelectElement>) => {
      const next = { ...instruments, [part]: Number((e.target as HTMLSelectElement).value) }
      setInstruments(next)
      saveInstruments(next)
      if (status !== 'stopped') {
        play(tempoPercent)
      }
    }
  }

  const activeVisualObj = visualObjsRef.current[activeIndex ?? 0] ?? null
  const naturalBpm = activeVisualObj?.getBpm() ?? 0
  const effectiveBpm = naturalBpm > 0 ? Math.round(naturalBpm * (tempoPercent / 100)) : 0

  return (
    <div ref={containerRef} className={`player-container ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {isFullscreen && (
        <div className="fullscreen-controls">
          <button
            onClick={() =>
              status === 'playing' ? pause() : status === 'paused' ? resume() : play()
            }
          >
            {status === 'playing' ? '⏸' : '▶'}
          </button>
          <button onClick={() => stop(false)} disabled={status === 'stopped' && positionSec === 0}>
            ■
          </button>
          <button onClick={toggleFullscreen}>
            ✕
          </button>
        </div>
      )}
      <div className="player-controls">
        <button
          onClick={() =>
            status === 'playing' ? pause() : status === 'paused' ? resume() : play()
          }
        >
          {status === 'playing' ? '⏸ Pause' : isSingle ? '▶ Play' : '▶ Play set'}
        </button>
        <button onClick={() => stop(false)} disabled={status === 'stopped' && positionSec === 0}>
          ■ Stop
        </button>
        <button
          className={repeat ? 'toggled' : ''}
          aria-pressed={repeat}
          onClick={() => {
            const next = !repeat
            setRepeat(next)
            repeatRef.current = next
          }}
        >
          {isSingle ? '🔁 Repeat' : '🔁 Repeat set'}
        </button>
        <MetronomeControls {...metronome} />
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
              className="reps-input"
              title="Number of times to repeat (leave empty for infinite)"
            />
          </label>
        )}
        <button onClick={toggleFullscreen}>
          ⛶ Fullscreen
        </button>
        <button
          className={loop || markA !== null ? 'toggled' : ''}
          disabled={status === 'stopped'}
          onClick={markLoopPoint}
          title="Mark loop start, then loop end, at the current position"
        >
          {markA !== null ? 'Set loop end' : loop ? 'New loop' : 'Set loop start'}
        </button>
        {(loop || markA !== null) && <button onClick={clearLoop}>✕ Loop off</button>}
        <label>
          Tempo {effectiveBpm > 0 ? `${effectiveBpm} BPM (${tempoPercent}%)` : `${tempoPercent}%`}
          <input
            ref={tempoInputRef}
            type="range"
            min="50"
            max="150"
            step="5"
            value={tempoPercent}
            onChange={onTempoInput}
          />
        </label>
        <label>
          Swing {swingPercent}%
          <input
            ref={swingInputRef}
            type="range"
            min="0"
            max="100"
            step="1"
            value={swingPercent}
            onChange={onSwingInput}
          />
        </label>
      </div>

      <div className="player-controls">
        <button
          className={trainer.armed ? 'toggled' : ''}
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
                className="trainer-input"
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
                className="trainer-input"
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
                className="trainer-input"
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
              <span className="tune-meta">
                Pass {passCount} · {tempoPercent}% → {trainer.targetPct}%
              </span>
            )}
          </>
        )}
      </div>

      <div className="player-seek">
        <span className="time-label">{formatTime(positionSec)}</span>
        <div className="seek-track">
          <input
            type="range"
            min="0"
            max={currentTotalSec || 1}
            step="0.1"
            value={positionSec}
            disabled={currentTotalSec <= 0}
            aria-label="Position in tune"
            onMouseDown={() => {
              isDraggingRef.current = true
            }}
            onTouchStart={() => {
              isDraggingRef.current = true
            }}
            onChange={(e) => {
              const val = Number((e.target as HTMLInputElement).value)
              setPositionSec(val)
              updateVisualsForTime(val)
            }}
            onMouseUp={(e) => {
              isDraggingRef.current = false
              seek(Number((e.currentTarget as HTMLInputElement).value))
            }}
            onTouchEnd={(e) => {
              isDraggingRef.current = false
              seek(Number((e.currentTarget as HTMLInputElement).value))
            }}
          />
          {markA !== null && (
            <span className="loop-marker" style={{ left: `${markA * 100}%` }} title="Loop start" />
          )}
          {loop && (
            <>
              <span className="loop-marker" style={{ left: `${loop.a * 100}%` }} title="Loop A" />
              <span className="loop-marker" style={{ left: `${loop.b * 100}%` }} title="Loop B" />
            </>
          )}
        </div>
        <span className="time-label">{formatTime(currentTotalSec)}</span>
      </div>

      <div className="player-controls">
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
      {error && <p className="error">{error}</p>}

      <div className={isSingle ? 'sheet-music' : 'set-player-tunes-list'}>
        {items.map((item, index) => {
          const href = linkHref ? linkHref(item) : `/tune/${item.userTuneId}`
          const showHeader = !isSingle && Boolean(item.title)
          return (
            <div
              key={item.userTuneId}
              className={isSingle ? '' : `set-player-tune ${activeIndex === index ? 'active' : ''}`}
            >
              {showHeader && (
                <div className="set-header">
                  <h2>
                    {href ? (
                      <Link className="quiet-link" href={href}>
                        {index + 1}. {item.title}
                      </Link>
                    ) : (
                      <span>{index + 1}. {item.title}</span>
                    )}
                  </h2>
                  <span className="tune-meta">
                    {activeIndex === index
                      ? `pass ${activePass} of ${item.repetitions}`
                      : `× ${item.repetitions}`}
                  </span>
                </div>
              )}
              <div
                className="sheet-music"
                ref={(el) => {
                  sheetRefs.current[index] = el
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )

  function updateVisualsForTime(seconds: number) {
    if (durationsRef.current.length !== items.length || noteTimingsRef.current.length !== items.length) return

    const clampedSeconds = Math.min(Math.max(seconds, 0), currentTotalSec)
    let remaining = clampedSeconds
    let targetIndex = 0

    for (let i = 0; i < items.length; i++) {
      const tuneDuration = durationsRef.current[i]
      const totalTuneDuration = tuneDuration * items[i].repetitions
      if (remaining < totalTuneDuration) {
        targetIndex = i
        remaining = remaining % tuneDuration
        break
      }
      remaining -= totalTuneDuration
    }

    const naturalMs = remaining * tempoPercent * 10
    const timings = noteTimingsRef.current[targetIndex]
    if (!timings || timings.length === 0) return

    let bestEvent = null
    for (const ev of timings) {
      if (ev.type === 'event') {
        if (ev.milliseconds <= naturalMs) {
          bestEvent = ev
        } else {
          break
        }
      }
    }

    clearHighlights()

    items.forEach((_, i) => {
      if (i !== targetIndex) {
        const otherHost = sheetRefs.current[i]
        const otherSvg = otherHost?.querySelector('svg')
        const otherCursor = otherSvg?.querySelector('.abcjs-cursor')
        if (otherCursor) {
          otherCursor.setAttribute('y1', '0')
          otherCursor.setAttribute('y2', '0')
        }
      }
    })

    const host = sheetRefs.current[targetIndex]
    const svg = host?.querySelector('svg') as SVGSVGElement | null

    if (bestEvent && typeof bestEvent.left === 'number' && typeof bestEvent.top === 'number' && typeof bestEvent.height === 'number') {
      for (const group of bestEvent.elements ?? []) {
        for (const el of group) {
          el.classList.add('highlight')
          highlightedRef.current.push(el)
        }
      }

      if (svg) {
        updateCursorPosition(svg, bestEvent.left - 2, bestEvent.top, bestEvent.top + bestEvent.height)
        checkAutoScroll(targetIndex, bestEvent)
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


