import { useEffect, useRef, useState } from 'preact/hooks'
import abcjs from 'abcjs'
import {
  INSTRUMENTS,
  loadInstruments,
  saveInstruments,
  synthInstrumentOptions,
} from './instruments.ts'

export interface SetPlayerItem {
  userTuneId: number
  title: string
  abc: string
  repetitions: number
}

type PlayerStatus = 'stopped' | 'playing' | 'paused'

/**
 * Renders every tune in a set and plays the whole medley: each tune its
 * configured number of times, then straight into the next, with the current
 * note highlighted and the active tune scrolled into view.
 */
export function SetPlayer({ items }: { items: SetPlayerItem[] }) {
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([])
  const visualObjsRef = useRef<any[]>([])
  const durationsRef = useRef<number[]>([])
  const synthsRef = useRef<any[]>([])
  const timerRef = useRef<any>(null)
  const highlightedRef = useRef<Element[]>([])
  const isDraggingRef = useRef(false)

  const [status, setStatus] = useState<PlayerStatus>('stopped')
  const [tempoPercent, setTempoPercent] = useState(100)
  const [repeat, setRepeat] = useState(false)
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
    visualObjsRef.current = items.map((item, index) => {
      const host = sheetRefs.current[index]
      if (!host) return null
      const visualObj = abcjs.renderAbc(host, item.abc, { responsive: 'resize' })[0]
      visualObj.setTiming(visualObj.getBpm())
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
    stop(keepPosition)
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
          const effectiveBpm = Math.round(visualObj.getBpm() * (percent / 100))
          const synth = new abcjs.synth.CreateSynth()
          await synth.init({
            visualObj,
            millisecondsPerMeasure: visualObj.millisecondsPerMeasure(effectiveBpm),
            options: synthInstrumentOptions(instruments),
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

    const timer = new abcjs.TimingCallbacks(visualObj, {
      qpm: effectiveBpm,
      eventCallback: (ev: any) => {
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
          return
        }
        // End of one pass through the tune.
        synth.stop()
        timer.stop()
        if (pass < items[index].repetitions) {
          pass++
          setActivePass(pass)
          synth.start()
          timer.start()
        } else if (index + 1 < items.length) {
          startTune(index + 1, percent)
        } else if (repeat) {
          startTune(0, percent)
        } else {
          stop()
        }
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

  function onTempoInput(e: Event) {
    const percent = Number((e.target as HTMLInputElement).value)
    setTempoPercent(percent)
    if (status !== 'stopped') {
      // Audio buffers are baked at a fixed tempo; rebuild and restart.
      play(percent)
    }
  }

  function onInstrumentChange(part: keyof typeof instruments) {
    return (e: Event) => {
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
    <div ref={containerRef} class={`player-container ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {isFullscreen && (
        <div class="fullscreen-controls">
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
      <div class="player-controls">
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
          class={repeat ? 'toggled' : ''}
          aria-pressed={repeat}
          onClick={() => setRepeat(!repeat)}
        >
          🔁 Repeat set
        </button>
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
            onInput={onTempoInput}
          />
        </label>
      </div>
      <div class="player-seek">
        <span class="time-label">{formatTime(positionSec)}</span>
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
          onInput={(e) => setPositionSec(Number((e.target as HTMLInputElement).value))}
          onChange={(e) => {
            isDraggingRef.current = false
            seek(Number((e.target as HTMLInputElement).value))
          }}
        />
        <span class="time-label">{formatTime(currentTotalSec)}</span>
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

      <div class="set-player-tunes-list">
        {items.map((item, index) => (
          <div
            key={item.userTuneId}
            class={`set-player-tune ${activeIndex === index ? 'active' : ''}`}
          >
            <div class="set-header">
              <h2>
                <a class="quiet-link" href={`/tune/${item.userTuneId}`}>
                  {index + 1}. {item.title}
                </a>
              </h2>
              <span class="tune-meta">
                {activeIndex === index
                  ? `pass ${activePass} of ${item.repetitions}`
                  : `× ${item.repetitions}`}
              </span>
            </div>
            <div
              class="sheet-music"
              ref={(el) => {
                sheetRefs.current[index] = el
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
