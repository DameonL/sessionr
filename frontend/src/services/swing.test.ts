import { describe, it, expect } from 'vitest'
import type abcjs from 'abcjs'
import { isCompoundMeter, applyCustomTripletSwing } from './swing'

const EIGHTH = 0.125

/** A track of single notes on a regular grid, the shape abcjs hands to sequenceCallback. */
function track(step: number, count: number, volume = 90): abcjs.NoteMapTrack {
  return Array.from({ length: count }, (_, i) => ({
    start: i * step,
    end: (i + 1) * step,
    pitch: 60 + i,
    volume,
  })) as unknown as abcjs.NoteMapTrack
}

describe('isCompoundMeter', () => {
  it.each([
    [6, 8],
    [9, 8],
    [12, 8],
  ])('treats %i/%i as compound — the beat divides into three', (num, den) => {
    expect(isCompoundMeter({ num, den })).toBe(true)
  })

  it.each([
    [4, 4],
    [2, 4],
    [3, 4],
    [2, 2],
    [6, 4],
    [5, 8], // den 8 but not a multiple of three
    [7, 8],
  ])('leaves %i/%i to abcjs’s own swing', (num, den) => {
    expect(isCompoundMeter({ num, den })).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', {}],
    ['a missing denominator', { num: 6 }],
    ['a missing numerator', { den: 8 }],
    ['a zero numerator', { num: 0, den: 8 }],
    ['a zero denominator', { num: 6, den: 0 }],
    ['non-numeric parts', { num: '6', den: '8' } as unknown as { num: number; den: number }],
  ])('reports false for %s so playback falls back to the native path', (_label, meter) => {
    expect(isCompoundMeter(meter as never)).toBe(false)
  })
})

describe('applyCustomTripletSwing', () => {
  it('does nothing at zero swing', () => {
    const notes = track(EIGHTH, 6)
    const before = notes.map((n) => ({ ...n }))

    applyCustomTripletSwing([notes], 0)

    expect(notes).toEqual(before)
  })

  it('does nothing to a track shorter than one triplet group', () => {
    const notes = track(EIGHTH, 2)
    const before = notes.map((n) => ({ ...n }))

    applyCustomTripletSwing([notes], 100)

    expect(notes).toEqual(before)
  })

  it('mutates the track in place rather than returning a new one', () => {
    // abcjs discards the callback's return value and keeps using its own noteMapTracks,
    // so a version of this that built new arrays would be a silent no-op.
    const notes = track(EIGHTH, 6)

    const returned = applyCustomTripletSwing([notes], 100)

    expect(returned).toBeUndefined()
    expect(notes[1].start).toBeGreaterThan(EIGHTH)
  })

  it('lengthens the first of each three at full swing', () => {
    const notes = track(EIGHTH, 6)

    applyCustomTripletSwing([notes], 100)

    // MAX_LENGTHEN is 0.5, so the first note takes 1.5 eighths...
    expect(notes[0].end - notes[0].start).toBeCloseTo(EIGHTH * 1.5, 10)
    // ...and the two that follow split the remaining 1.5 evenly: a 2:1 ratio.
    expect(notes[1].end - notes[1].start).toBeCloseTo(EIGHTH * 0.75, 10)
    expect(notes[2].end - notes[2].start).toBeCloseTo(EIGHTH * 0.75, 10)
  })

  it('never lengthens a note past the re-strike threshold', () => {
    // Beyond 1.75 eighths every lilted note on a plucked instrument splits in two and
    // double-strikes (subdivideLongNotes' SPLIT_TOLERANCE). MAX_LENGTHEN's 0.5 ceiling
    // caps the first note at 1.5 eighths, which is what keeps it clear of that.
    const notes = track(EIGHTH, 6)

    applyCustomTripletSwing([notes], 100)

    expect(notes[0].end - notes[0].start).toBeLessThan(EIGHTH * 1.75)
  })

  it('keeps each group ending exactly where it did', () => {
    const notes = track(EIGHTH, 6)
    const groupEnd = notes[2].end
    const nextGroupStart = notes[3].start

    applyCustomTripletSwing([notes], 100)

    expect(notes[2].end).toBeCloseTo(groupEnd, 10)
    expect(notes[3].start).toBeCloseTo(nextGroupStart, 10)
  })

  it('leaves no gap or overlap inside a group', () => {
    const notes = track(EIGHTH, 6)

    applyCustomTripletSwing([notes], 100)

    expect(notes[1].start).toBeCloseTo(notes[0].end, 10)
    expect(notes[2].start).toBeCloseTo(notes[1].end, 10)
  })

  it('scales the lilt with the swing percentage', () => {
    const full = track(EIGHTH, 6)
    const half = track(EIGHTH, 6)

    applyCustomTripletSwing([full], 100)
    applyCustomTripletSwing([half], 50)

    const fullFirst = full[0].end - full[0].start
    const halfFirst = half[0].end - half[0].start

    expect(halfFirst).toBeGreaterThan(EIGHTH)
    expect(halfFirst).toBeLessThan(fullFirst)
    expect(halfFirst).toBeCloseTo(EIGHTH * 1.25, 10)
  })

  it('accents the first of each three and softens the followers', () => {
    const notes = track(EIGHTH, 6, 90)

    applyCustomTripletSwing([notes], 100)

    expect(notes[0].volume).toBeGreaterThan(90)
    expect(notes[1].volume).toBeLessThan(90)
    expect(notes[2].volume).toBeLessThan(90)
  })

  it('keeps volumes inside the MIDI range', () => {
    const loud = track(EIGHTH, 6, 127)
    const quiet = track(EIGHTH, 6, 1)

    applyCustomTripletSwing([loud], 100)
    applyCustomTripletSwing([quiet], 100)

    for (const note of [...loud, ...quiet]) {
      expect(note.volume).toBeGreaterThanOrEqual(1)
      expect(note.volume).toBeLessThanOrEqual(127)
    }
  })

  it('lilts every group of a longer phrase', () => {
    const notes = track(EIGHTH, 12)

    applyCustomTripletSwing([notes], 100)

    for (const first of [0, 3, 6, 9]) {
      expect(notes[first].end - notes[first].start).toBeCloseTo(EIGHTH * 1.5, 10)
    }
  })

  it('leaves the accompaniment alone', () => {
    // Chord and bass tracks step in dotted quarters. Three of those also look "near-equal"
    // to the ratio test, so the mean-duration check is what keeps them on the melody's grid.
    const dottedQuarter = EIGHTH * 3
    const chords = track(dottedQuarter, 6)
    const before = chords.map((n) => ({ ...n }))

    applyCustomTripletSwing([chords], 100)

    expect(chords).toEqual(before)
  })

  it('leaves a run of uneven durations alone', () => {
    const uneven = [
      { start: 0, end: 0.25, pitch: 60, volume: 90 },
      { start: 0.25, end: 0.3, pitch: 62, volume: 90 },
      { start: 0.3, end: 0.8, pitch: 64, volume: 90 },
      { start: 0.8, end: 0.9, pitch: 65, volume: 90 },
    ] as unknown as abcjs.NoteMapTrack
    const before = uneven.map((n) => ({ ...n }))

    applyCustomTripletSwing([uneven], 100)

    expect(uneven).toEqual(before)
  })

  it('moves every voice sharing a start time together', () => {
    // Two notes struck together must stay together, or the chord splits.
    const notes = [
      { start: 0, end: EIGHTH, pitch: 60, volume: 90 },
      { start: 0, end: EIGHTH, pitch: 64, volume: 90 },
      { start: EIGHTH, end: EIGHTH * 2, pitch: 62, volume: 90 },
      { start: EIGHTH * 2, end: EIGHTH * 3, pitch: 64, volume: 90 },
      { start: EIGHTH * 3, end: EIGHTH * 4, pitch: 65, volume: 90 },
    ] as unknown as abcjs.NoteMapTrack

    applyCustomTripletSwing([notes], 100)

    expect(notes[0].start).toBeCloseTo(notes[1].start, 10)
    expect(notes[0].end).toBeCloseTo(notes[1].end, 10)
  })

  it('survives an empty track list and empty tracks', () => {
    expect(() => applyCustomTripletSwing([], 100)).not.toThrow()
    expect(() => applyCustomTripletSwing([[] as unknown as abcjs.NoteMapTrack], 100)).not.toThrow()
  })

  it('defaults a missing volume rather than producing NaN', () => {
    const notes = [
      { start: 0, end: EIGHTH, pitch: 60 },
      { start: EIGHTH, end: EIGHTH * 2, pitch: 62 },
      { start: EIGHTH * 2, end: EIGHTH * 3, pitch: 64 },
      { start: EIGHTH * 3, end: EIGHTH * 4, pitch: 65 },
    ] as unknown as abcjs.NoteMapTrack

    applyCustomTripletSwing([notes], 100)

    expect(notes[0].volume).toBeGreaterThan(0)
    expect(Number.isNaN(notes[0].volume)).toBe(false)
  })
})
