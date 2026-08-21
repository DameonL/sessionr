import { describe, it, expect } from 'vitest'
import type abcjs from 'abcjs'
import { strumChords } from './strum'

/** Seconds per whole note — the unit note starts are expressed in. */
const TEMPO_SEC = 2
const GUITAR = 25 // a plucked instrument, so it strums
const FIDDLE = 40 // bowed, so it must not

/** Mid-range randomness, so the jitter contributes nothing and the spread is predictable. */
const noJitter = () => 0.5

function note(pitch: number, instrument = GUITAR, start = 0, duration = 0.25, volume = 90) {
  return { start, end: start + duration, pitch, instrument, volume }
}

function track(...notes: ReturnType<typeof note>[]): abcjs.NoteMapTrack {
  return notes as unknown as abcjs.NoteMapTrack
}

describe('strumChords', () => {
  it('does nothing to an empty track', () => {
    expect(() => strumChords(track(), TEMPO_SEC, noJitter)).not.toThrow()
  })

  it.each([0, -1, NaN])('does nothing for the invalid tempo multiplier %s', (tempo) => {
    const notes = track(note(60), note(64), note(67))
    const before = notes.map((n) => ({ ...n }))

    strumChords(notes, tempo, noJitter)

    expect(notes).toEqual(before)
  })

  it('mutates the track in place rather than returning a new one', () => {
    // abcjs discards the callback's return value and keeps using its own noteMapTracks.
    const notes = track(note(60), note(64), note(67))

    const returned = strumChords(notes, TEMPO_SEC, noJitter)

    expect(returned).toBeUndefined()
    expect(notes[1].start).toBeGreaterThan(0)
  })

  it('leaves a single-note melody untouched', () => {
    const notes = track(note(60, GUITAR, 0), note(62, GUITAR, 0.25), note(64, GUITAR, 0.5))
    const before = notes.map((n) => ({ ...n }))

    strumChords(notes, TEMPO_SEC, noJitter)

    expect(notes).toEqual(before)
  })

  it('leaves the first note of the chord exactly on the beat', () => {
    const notes = track(note(60), note(64), note(67))

    strumChords(notes, TEMPO_SEC, noJitter)

    expect(Math.min(...notes.map((n) => n.start))).toBe(0)
  })

  it('spreads a chord low to high on the first strike', () => {
    const notes = track(note(67), note(60), note(64)) // written out of order

    strumChords(notes, TEMPO_SEC, noJitter)

    const byPitch = [...notes].sort((a, b) => a.pitch - b.pitch)
    expect(byPitch[0].start).toBeLessThan(byPitch[1].start)
    expect(byPitch[1].start).toBeLessThan(byPitch[2].start)
  })

  it('alternates down and up strokes between chords, the way a hand moves', () => {
    const notes = track(
      note(60, GUITAR, 0), note(64, GUITAR, 0), note(67, GUITAR, 0),
      note(60, GUITAR, 0.5), note(64, GUITAR, 0.5), note(67, GUITAR, 0.5),
    )

    strumChords(notes, TEMPO_SEC, noJitter)

    const first = notes.slice(0, 3)
    const second = notes.slice(3)
    // Downstroke: lowest first. Upstroke: highest first.
    expect(first[0].start).toBeLessThan(first[2].start)
    expect(second[0].start).toBeGreaterThan(second[2].start)
  })

  it('keeps the whole roll short enough to read as one chord', () => {
    const notes = track(note(60), note(64), note(67))

    strumChords(notes, TEMPO_SEC, noJitter)

    // 25ms at 2s per whole note is 0.0125 note units across the whole voicing.
    const spread = Math.max(...notes.map((n) => n.start)) - Math.min(...notes.map((n) => n.start))
    expect(spread).toBeCloseTo(0.0125, 6)
  })

  it('caps the roll against the shortest note in the chord', () => {
    // At a fast tempo a fixed 25ms would swallow the short re-strikes
    // subdivideLongNotes produces, so the spread is capped at a fraction of them.
    const short = 0.01
    const notes = track(
      note(60, GUITAR, 0, short),
      note(64, GUITAR, 0, short),
      note(67, GUITAR, 0, short),
    )

    strumChords(notes, TEMPO_SEC, noJitter)

    const spread = Math.max(...notes.map((n) => n.start)) - Math.min(...notes.map((n) => n.start))
    expect(spread).toBeLessThanOrEqual(short * 0.4 + 1e-9)
  })

  it('varies the spread between repeated chords', () => {
    const spreads = [0, 0.25, 0.75, 1].map((r) => {
      const notes = track(note(60), note(64), note(67))
      strumChords(notes, TEMPO_SEC, () => r)
      return Math.max(...notes.map((n) => n.start))
    })

    expect(new Set(spreads).size).toBeGreaterThan(1)
  })

  it('ramps the volume so the last note struck is the loudest', () => {
    const notes = track(note(60), note(64), note(67))

    strumChords(notes, TEMPO_SEC, noJitter)

    const byStart = [...notes].sort((a, b) => a.start - b.start)
    expect(byStart[0].volume).toBeLessThan(byStart[2].volume)
    expect(byStart[2].volume).toBe(90) // the last is left at its notated velocity
  })

  it('keeps volumes inside the MIDI range', () => {
    const notes = track(note(60, GUITAR, 0, 0.25, 127), note(64, GUITAR, 0, 0.25, 1), note(67))

    strumChords(notes, TEMPO_SEC, noJitter)

    for (const n of notes) {
      expect(n.volume).toBeGreaterThanOrEqual(1)
      expect(n.volume).toBeLessThanOrEqual(127)
    }
  })

  it('leaves bowed instruments unstrummed', () => {
    const notes = track(note(60, FIDDLE), note(64, FIDDLE), note(67, FIDDLE))
    const before = notes.map((n) => ({ ...n }))

    strumChords(notes, TEMPO_SEC, noJitter)

    expect(notes).toEqual(before)
  })

  it('leaves a mixed voicing alone rather than strumming half of it', () => {
    const notes = track(note(60, GUITAR), note(64, FIDDLE), note(67, GUITAR))
    const before = notes.map((n) => ({ ...n }))

    strumChords(notes, TEMPO_SEC, noJitter)

    expect(notes).toEqual(before)
  })

  it('groups by start time, not by track, so bass notes are left alone', () => {
    // The chord track interleaves bass and chord notes; a bass note alone on its
    // beat is a group of one and falls straight through.
    const notes = track(
      note(36, GUITAR, 0),                     // bass, on its own
      note(60, GUITAR, 0.5), note(64, GUITAR, 0.5), note(67, GUITAR, 0.5),
    )

    strumChords(notes, TEMPO_SEC, noJitter)

    expect(notes[0].start).toBe(0)
    expect(notes[3].start).toBeGreaterThan(0.5)
  })

  it('defaults a missing volume rather than producing NaN', () => {
    const notes = [
      { start: 0, end: 0.25, pitch: 60, instrument: GUITAR },
      { start: 0, end: 0.25, pitch: 64, instrument: GUITAR },
    ] as unknown as abcjs.NoteMapTrack

    strumChords(notes, TEMPO_SEC, noJitter)

    expect(Number.isNaN(notes[0].volume)).toBe(false)
    expect(notes[0].volume).toBeGreaterThan(0)
  })
})
