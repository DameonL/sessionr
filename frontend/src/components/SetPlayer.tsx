import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import abcjs from 'abcjs'
import {
  INSTRUMENTS,
  loadInstruments,
  saveInstruments,
  synthInstrumentOptions,
} from './instruments'
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
} from '../services/metronome'
import { fixAbcRepeats } from '../services/abcTools'

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

/**
 * Renders every tune in a set and plays the whole medley: each tune its
 * configured number of times, then straight into the next, with the current
 * note highlighted and the active tune scrolled into view.
 */
export function SetPlayer({
  items,
  linkHref,
}: {
  items: SetPlayerItem[]
  /** Overrides the per-tune link target (defaults to the personal tune detail page); return null to render plain text. */
  linkHref?: (item: SetPlayerItem) => string | null
}) {
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([])
  const visualObjsRef = useRef<(ExtendedTuneObject | null)[]>([])
  const durationsRef = useRef<number[]>([])
  const synthsRef = useRef<(abcjs.MidiBuffer | null)[]>([])
  const timerRef = useRef<abcjs.TimingCallbacks | null>(null)
  const highlightedRef = useRef<Element[]>([])
  const isDraggingRef = useRef(false)
  const noteTimingsRef = useRef<abcjs.NoteTimingEvent[][]>([])
  const repeatRef = useRef(false)
  const repeatLimitRef = useRef<number | null>(null)
  const setPassRef = useRef(1)
  const useMetronomeRef = useRef(false)
  const metronomeSoundRef = useRef<MetronomeSound>(DEFAULT_METRONOME_SOUND)
  const keyRootRef = useRef<number>(72)

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
  const [instruments, setInstruments] = useState(loadInstruments)
  const [positionSec, setPositionSec] = useState(0)
  const [currentTotalSec, setCurrentTotalSec] = useState(0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [activePass, setActivePass] = useState(1)
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

  const itemsKey = items.map((i) => `${i.userTuneId}:${i.repetitions}`).join(',')

  useEffect(() => {
    noteTimingsRef.current = []
    visualObjsRef.current = items.map((item, index) => {
      const host = sheetRefs.current[index]
      if (!host) return null
      const visualObj = abcjs.renderAbc(host, fixAbcRepeats(item.abc), { responsive: 'resize' })[0] as ExtendedTuneObject
      const timings = visualObj.setTiming(visualObj.getBpm())
      noteTimingsRef.current[index] = timings
      return visualObj
    })
    return () => stop(false)
  }, [itemsKey])

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
              swing: swingPercent,
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
      startTune(targetIndex, percent, targetPass, targetFraction)
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
      },
      eventCallback: (ev: abcjs.NoteTimingEvent | null) => {
        clearHighlights()
        if (ev) {
          const ms = timer.currentMillisecond()
          const elapsedBeforeTune = durationsRef.current
            .slice(0, index)
            .reduce((sum, duration, i) => sum + duration * items[i].repetitions, 0)
          
          if (!isDraggingRef.current) {
            setPositionSec(elapsedBeforeTune + ms / 1000)
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
    if (status !== 'stopped') {
      // Audio buffers are baked at a fixed tempo; rebuild and restart.
      play(percent)
    }
  }

  function onSwingInput(e: ChangeEvent<HTMLInputElement>) {
    const percent = Number((e.target as HTMLInputElement).value)
    setSwingPercent(percent)
  }

  function onSwingChange(e: ChangeEvent<HTMLInputElement>) {
    const percent = Number((e.target as HTMLInputElement).value)
    setSwingPercent(percent)
    if (status !== 'stopped') {
      play(tempoPercent)
    }
  }

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

  const formatTime = (sec: number) => {
    const whole = Math.max(0, Math.round(sec))
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
  }

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
          {status === 'playing' ? '⏸ Pause' : '▶ Play set'}
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
          🔁 Repeat set
        </button>
        <button
          className={useMetronome ? 'toggled' : ''}
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
            Sound
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
              className="reps-input"
              title="Number of times to repeat the set (leave empty for infinite)"
            />
          </label>
        )}
        <button onClick={toggleFullscreen}>
          ⛶ Fullscreen
        </button>
        <label>
          Tempo {tempoPercent}%
          <input
            type="range"
            min="50"
            max="130"
            step="5"
            value={tempoPercent}
            onChange={onTempoInput}
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
            onChange={onSwingInput}
            onMouseUp={() => {
              if (status !== 'stopped') {
                play(tempoPercent)
              }
            }}
            onTouchEnd={() => {
              if (status !== 'stopped') {
                play(tempoPercent)
              }
            }}
          />
        </label>
      </div>
      <div className="player-seek">
        <span className="time-label">{formatTime(positionSec)}</span>
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

      <div className="set-player-tunes-list">
        {items.map((item, index) => {
          const href = linkHref ? linkHref(item) : `/tune/${item.userTuneId}`
          return (
          <div
            key={item.userTuneId}
            className={`set-player-tune ${activeIndex === index ? 'active' : ''}`}
          >
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


