"use client";

import { useEffect, useRef, useState } from 'react'
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
  const inputRef = useRef<HTMLInputElement>(null)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const handleChange = () => commitRef.current()
    el.addEventListener('change', handleChange)
    return () => el.removeEventListener('change', handleChange)
  }, [])

  return inputRef
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
