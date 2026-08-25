import { describe, it, expect } from 'vitest'
import type abcjs from 'abcjs'
import { getMeterPulse } from './meterPulse'
import { applyMeterEmphasis, strengthAtPosition } from './meterEmphasis'

const REEL = getMeterPulse({ num: 4, den: 4 })
const JIG = getMeterPulse({ num: 6, den: 8 })

/** A track of eighth notes on a plain grid, all at the same starting volume. */
function eighths(count: number, volume = 90, from = 0): abcjs.NoteMapTrack {
  return Array.from({ length: count }, (_, i) => ({
    start: from + i * 0.125,
    end: from + (i + 1) * 0.125,
    pitch: 72,
    volume,
    instrument: 'fiddle',
    startChar: 0,
    endChar: 0,
  })) as abcjs.NoteMapTrack
}

const volumes = (track: abcjs.NoteMapTrack) => track.map((n) => n.volume)

describe('strengthAtPosition', () => {
  it('reads the weight straight off the bar', () => {
    expect(strengthAtPosition(REEL, 0)).toBe('strong')
    expect(strengthAtPosition(REEL, 0.5)).toBe('medium')
    expect(strengthAtPosition(REEL, 0.25)).toBe('light')
    expect(strengthAtPosition(REEL, 0.125)).toBe('off')
  })

  it('wraps into later bars', () => {
    expect(strengthAtPosition(REEL, 3)).toBe('strong')
    expect(strengthAtPosition(REEL, 3.5)).toBe('medium')
    expect(strengthAtPosition(JIG, 0.75)).toBe('strong')
    expect(strengthAtPosition(JIG, 1.125)).toBe('medium')
  })

  it('absorbs the rounding abcjs leaves on note starts', () => {
    expect(strengthAtPosition(REEL, 0.499999)).toBe('medium')
    expect(strengthAtPosition(REEL, 1.000001)).toBe('strong')
    // A hair before the barline still belongs to the downbeat rather than to nothing.
    expect(strengthAtPosition(REEL, 0.9999)).toBe('strong')
  })

  it('does not mistake a genuine off-beat for a beat', () => {
    expect(strengthAtPosition(REEL, 0.45)).toBe('off')
    expect(strengthAtPosition(REEL, 0.0625)).toBe('off')
  })
})

describe('applyMeterEmphasis', () => {
  it('leans on 1 and 3, and lightens the off-beats', () => {
    const track = eighths(8)
    applyMeterEmphasis([track], REEL, 0, 100)
    // strong, off, light, off, medium, off, light, off — snapped to multiples of 4.
    expect(volumes(track)).toEqual([104, 40, 64, 40, 80, 40, 64, 40])
  })

  it('gives a jig its two groups', () => {
    const track = eighths(6)
    applyMeterEmphasis([track], JIG, 0, 100)
    expect(volumes(track)).toEqual([104, 40, 40, 80, 40, 40])
  })

  it('scales with the slider', () => {
    const half = eighths(8)
    applyMeterEmphasis([half], REEL, 0, 50)
    // Every note sits between its unemphasised and fully emphasised value.
    expect(half[0].volume).toBeGreaterThan(90)
    expect(half[0].volume).toBeLessThan(104)
    expect(half[1].volume).toBeLessThan(90)
    expect(half[1].volume).toBeGreaterThan(40)
  })

  it('is an exact no-op at 0%', () => {
    const track = eighths(8, 93)
    applyMeterEmphasis([track], REEL, 0, 0)
    expect(volumes(track)).toEqual(Array(8).fill(93))
  })

  it('shifts the grid for a pickup, so the accent lands after the anacrusis', () => {
    // One eighth of pickup: the tune's first note is an upbeat, the second starts bar 1.
    const track = eighths(4)
    applyMeterEmphasis([track], REEL, 0.125, 100)
    expect(volumes(track)).toEqual([40, 104, 40, 64])
  })

  it('handles a pickup longer than a beat', () => {
    const track = eighths(4)
    applyMeterEmphasis([track], REEL, 0.375, 100)
    expect(track[3].volume).toBeGreaterThan(track[2].volume)
  })

  it('quantizes volumes so priming does not have to render a buffer per note', () => {
    const track = eighths(8, 97)
    applyMeterEmphasis([track], REEL, 0, 70)
    expect(new Set(volumes(track)).size).toBeLessThanOrEqual(4)
    for (const v of volumes(track)) expect(v % 4).toBe(0)
  })

  it('never pushes a note into the ceiling, where the accent would flatten out', () => {
    // abcjs hands us 105 on a downbeat against a limit of 127; anything that clips there is an
    // accent the listener cannot hear.
    const track = eighths(8, 105)
    applyMeterEmphasis([track], REEL, 0, 100)
    expect(Math.max(...volumes(track))).toBeLessThan(127)
  })

  it('spans enough range to actually be heard', () => {
    const track = eighths(8, 95)
    applyMeterEmphasis([track], REEL, 0, 100)
    const db = 20 * Math.log10(Math.max(...volumes(track)) / Math.min(...volumes(track)))
    expect(db).toBeGreaterThan(5)
  })

  it('keeps volumes inside MIDI range', () => {
    const loud = eighths(8, 127)
    applyMeterEmphasis([loud], REEL, 0, 100)
    expect(Math.max(...volumes(loud))).toBeLessThanOrEqual(127)
    const quiet = eighths(8, 1)
    applyMeterEmphasis([quiet], REEL, 0, 100)
    expect(Math.min(...volumes(quiet))).toBeGreaterThanOrEqual(1)
  })

  it('treats a missing volume as abcjs would', () => {
    const track = [{ start: 0, end: 0.125, pitch: 72, instrument: 'fiddle', startChar: 0, endChar: 0 }] as unknown as abcjs.NoteMapTrack
    applyMeterEmphasis([track], REEL, 0, 100)
    expect(track[0].volume).toBe(104) // 90 * 1.15, snapped
  })

  it('applies to every track, not just the melody', () => {
    const melody = eighths(2)
    const chords = eighths(2)
    applyMeterEmphasis([melody, chords], REEL, 0, 100)
    expect(volumes(melody)).toEqual(volumes(chords))
    expect(melody[0].volume).toBe(104)
  })

  it('leaves a degenerate bar alone rather than dividing by zero', () => {
    const track = eighths(4)
    applyMeterEmphasis([track], { barLengthWholeNotes: 0, beats: [] }, 0, 100)
    expect(volumes(track)).toEqual(Array(4).fill(90))
  })
})
