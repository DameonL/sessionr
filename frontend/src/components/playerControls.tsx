"use client";

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ALL_METRONOME_SOUNDS,
  BEAT_SOUNDS,
  DEFAULT_METRONOME_SOUND,
  MELODIC_SOUNDS,
  OTHER_PERCUSSION_SOUNDS,
  findMetronomeSound,
  loadMetronomePrefs,
  saveMetronomePrefs,
  type MetronomeSound,
} from '../services/metronome'

/** mm:ss formatting for playback position/duration labels. */
export function formatTime(sec: number): string {
  const whole = Math.max(0, Math.round(sec))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Maps the UI's 0-100 "how much swing" dial onto abcjs's own swing parameter,
 * which only has a real effect in the 50-75 range (<=50 is a no-op/no swing,
 * >75 clamps to 75/max swing) — so 0 on the UI dial lands at abcjs's no-swing
 * floor, and 100 lands at its max.
 */
export function toAbcjsSwing(uiPercent: number): number {
  return Math.round(50 + (uiPercent / 100) * 25)
}

export function getOrCreateCursor(svg: SVGSVGElement | null): SVGLineElement | null {
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

export function updateCursorPosition(svg: SVGSVGElement | null, x: number, y1: number, y2: number) {
  const cursor = getOrCreateCursor(svg)
  if (cursor) {
    cursor.setAttribute('x1', String(x))
    cursor.setAttribute('x2', String(x))
    cursor.setAttribute('y1', String(y1))
    cursor.setAttribute('y2', String(y2))
  }
}

/**
 * Wires a <input type="range"> to fire `onCommit` once per "commit" — mouse
 * release, touch release, or a keyboard-driven change — via the input's
 * native 'change' event (unlike React's onChange, which fires on every tick
 * like the native 'input' event). Playback params like tempo and swing are
 * baked into the synth buffer and need a full resync to take effect, so we
 * want that resync to happen once the user settles on a value, not on every
 * tick of a drag.
 */
export function useCommitOnChange(onCommit: () => void) {
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const detach = useRef<(() => void) | null>(null)

  /*
   * A callback ref rather than an effect over a ref object. These sliders live inside the Advanced
   * Controls panel, which is collapsed when the player mounts, so an effect with no dependencies
   * ran while there was no element to listen to and never ran again — and tempo, swing and emphasis
   * then never committed at all. The panel could be opened mid-tune and the tempo dragged the whole
   * way across, and playback would carry on at the tempo it started at.
   */
  return useCallback((el: HTMLInputElement | null) => {
    detach.current?.()
    detach.current = null
    if (!el) return
    const handleChange = () => commitRef.current()
    el.addEventListener('change', handleChange)
    detach.current = () => el.removeEventListener('change', handleChange)
  }, [])
}

export interface MetronomePrefsState {
  useMetronome: boolean
  metronomeSound: MetronomeSound
  useMetronomeRef: React.RefObject<boolean>
  metronomeSoundRef: React.RefObject<MetronomeSound>
  toggleMetronome: () => void
  setSound: (sound: MetronomeSound) => void
}

/** Loads/persists the metronome on/off + sound choice, shared by TunePlayer and SetPlayer. */
export function useMetronomePrefs(): MetronomePrefsState {
  const initPrefs = loadMetronomePrefs()
  const useMetronomeRef = useRef(false)
  const metronomeSoundRef = useRef<MetronomeSound>(DEFAULT_METRONOME_SOUND)
  useMetronomeRef.current = initPrefs.enabled
  metronomeSoundRef.current = findMetronomeSound(initPrefs.soundKey)
  const [useMetronome, setUseMetronome] = useState(() => initPrefs.enabled)
  const [metronomeSound, setMetronomeSound] = useState<MetronomeSound>(
    () => findMetronomeSound(initPrefs.soundKey),
  )

  function toggleMetronome() {
    const next = !useMetronome
    useMetronomeRef.current = next
    setUseMetronome(next)
    saveMetronomePrefs({ enabled: next, soundKey: metronomeSoundRef.current.key })
  }

  function setSound(sound: MetronomeSound) {
    setMetronomeSound(sound)
    metronomeSoundRef.current = sound
    saveMetronomePrefs({ enabled: useMetronomeRef.current, soundKey: sound.key })
  }

  return { useMetronome, metronomeSound, useMetronomeRef, metronomeSoundRef, toggleMetronome, setSound }
}

/** The metronome toggle button + beat/sound picker, shared by TunePlayer and SetPlayer. */
export function MetronomeControls({ useMetronome, metronomeSound, toggleMetronome, setSound }: MetronomePrefsState) {
  return (
    <>
      <button className={useMetronome ? 'toggled' : ''} aria-pressed={useMetronome} onClick={toggleMetronome}>
        🔊 Metronome
      </button>
      {useMetronome && (
        <label>
          Beat
          <select
            value={metronomeSound.key}
            onChange={(e) => {
              const sound =
                ALL_METRONOME_SOUNDS.find((s) => s.key === (e.target as HTMLSelectElement).value) ??
                DEFAULT_METRONOME_SOUND
              setSound(sound)
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
    </>
  )
}

export interface StaffLine {
  top: number
  height: number
  bottom: number
}

/**
 * Extracts distinct staff lines from abcjs NoteTimingEvent list by grouping events with similar Y coordinates.
 */
export function extractLinesFromTimings(timings: Array<{ top?: number; height?: number }>): StaffLine[] {
  if (!timings || timings.length === 0) return []
  const lines: StaffLine[] = []
  for (const ev of timings) {
    if (typeof ev.top !== 'number' || typeof ev.height !== 'number') continue
    const top = ev.top
    const height = ev.height
    const existing = lines.find((l) => Math.abs(l.top - top) < 15)
    if (!existing) {
      lines.push({ top, height, bottom: top + height })
    } else {
      existing.height = Math.max(existing.height, height)
      existing.bottom = existing.top + existing.height
    }
  }
  lines.sort((a, b) => a.top - b.top)
  return lines
}

/**
 * Scrolls `scrollContainer` in fullscreen mode to keep both `currentLine` and `nextLine` visible.
 */
export function scrollToKeepLinesVisible(
  scrollContainer: HTMLElement | null,
  svg: SVGSVGElement | null,
  currentLine: StaffLine,
  nextLine: StaffLine | null,
  nextSvg?: SVGSVGElement | null,
) {
  if (!scrollContainer || !svg) return

  const containerRect = scrollContainer.getBoundingClientRect()
  const svgRect = svg.getBoundingClientRect()

  const viewBox = svg.viewBox.baseVal
  const viewBoxY = viewBox && viewBox.height > 0 ? viewBox.y : 0
  const viewBoxHeight = viewBox && viewBox.height > 0 ? viewBox.height : (svg.getBBox ? svg.getBBox().height || 1 : 1)
  const scaleY = svgRect.height / viewBoxHeight

  const svgTopInContainerContent = svgRect.top - containerRect.top + scrollContainer.scrollTop
  const currentLineTopContent = svgTopInContainerContent + (currentLine.top - viewBoxY) * scaleY

  let nextLineBottomContent: number
  if (nextLine && !nextSvg) {
    nextLineBottomContent = svgTopInContainerContent + (nextLine.bottom - viewBoxY) * scaleY
  } else if (nextLine && nextSvg) {
    const nextSvgRect = nextSvg.getBoundingClientRect()
    const nextViewBox = nextSvg.viewBox.baseVal
    const nextViewBoxY = nextViewBox && nextViewBox.height > 0 ? nextViewBox.y : 0
    const nextViewBoxHeight = nextViewBox && nextViewBox.height > 0 ? nextViewBox.height : (nextSvg.getBBox ? nextSvg.getBBox().height || 1 : 1)
    const nextScaleY = nextSvgRect.height / nextViewBoxHeight
    const nextSvgTopInContainerContent = nextSvgRect.top - containerRect.top + scrollContainer.scrollTop
    nextLineBottomContent = nextSvgTopInContainerContent + (nextLine.bottom - nextViewBoxY) * nextScaleY
  } else {
    nextLineBottomContent = svgTopInContainerContent + (currentLine.bottom - viewBoxY) * scaleY + 20
  }

  const viewportTop = scrollContainer.scrollTop
  const viewportBottom = scrollContainer.scrollTop + scrollContainer.clientHeight

  const margin = 24
  const isCurrentTopVisible = currentLineTopContent >= viewportTop && currentLineTopContent <= viewportBottom - 40
  const isNextBottomVisible = nextLineBottomContent <= viewportBottom && nextLineBottomContent >= viewportTop

  if (!isCurrentTopVisible || !isNextBottomVisible) {
    const targetScrollTop = Math.max(0, currentLineTopContent - margin)
    if (Math.abs(scrollContainer.scrollTop - targetScrollTop) > 5) {
      scrollContainer.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      })
    }
  }
}

