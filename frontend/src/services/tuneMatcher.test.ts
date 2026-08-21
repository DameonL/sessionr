import { describe, it, expect } from 'vitest'
import { classifyClip, groupNotes, type ClassifiedFrame } from './tuneMatcher'
import { requiredStableFrames, type RawFrame } from './pitchDetector'

/** 440Hz = A4 = MIDI 69, the reference the whole pitch pipeline hangs off. */
const A4_HZ = 440
const B4_HZ = 493.88
const G4_HZ = 392
const FRAME_MS = 20

function frame(overrides: Partial<RawFrame> & { tMs: number }): RawFrame {
  return { rms: 0.2, clarity: 0.9, hz: A4_HZ, ...overrides }
}

/** A run of frames on one steady pitch, long enough to clear the stability threshold. */
function steadyNote(startMs: number, hz: number, count = 20, clarity = 0.9): RawFrame[] {
  return Array.from({ length: count }, (_, i) => frame({ tMs: startMs + i * FRAME_MS, hz, clarity }))
}

function silence(startMs: number, count: number): RawFrame[] {
  return Array.from({ length: count }, (_, i) =>
    frame({ tMs: startMs + i * FRAME_MS, rms: 0.001, clarity: 0, hz: null }),
  )
}

/**
 * Prepends enough quiet frames that the 20th-percentile noise floor lands in the silence
 * rather than in the music — which is what a real recording looks like, since the player
 * is never sounding for the whole 20-second sample. A clip of uniformly loud frames has
 * its own notes as its noise floor and is correctly rejected wholesale, so every fixture
 * here goes through this.
 */
function withNoiseFloor(music: RawFrame[]): { frames: RawFrame[]; offsetMs: number } {
  const padCount = Math.max(4, Math.ceil(music.length * 0.5))
  const offsetMs = padCount * FRAME_MS
  return {
    frames: [...silence(0, padCount), ...music.map((f) => ({ ...f, tMs: f.tMs + offsetMs }))],
    offsetMs,
  }
}

const classify = (music: RawFrame[]) => classifyClip(withNoiseFloor(music).frames)
const group = (music: RawFrame[]) => groupNotes(classify(music))

describe('classifyClip', () => {
  it('returns one classified frame per input frame', () => {
    const { frames } = withNoiseFloor(steadyNote(0, A4_HZ, 5))

    expect(classifyClip(frames)).toHaveLength(frames.length)
  })

  it('handles an empty clip', () => {
    expect(classifyClip([])).toEqual([])
  })

  it('accepts loud, clear, pitched frames', () => {
    const accepted = classify(steadyNote(0, A4_HZ, 10)).filter((f) => f.accepted)

    expect(accepted).toHaveLength(10)
  })

  it('rejects the silence around the notes', () => {
    const classified = classify(steadyNote(0, A4_HZ, 10))

    expect(classified.filter((f) => !f.accepted).every((f) => f.hz === null)).toBe(true)
  })

  it('rejects frames with no detected pitch', () => {
    const classified = classify([frame({ tMs: 0, hz: null })])

    expect(classified.at(-1)!.accepted).toBe(false)
    expect(classified.at(-1)!.midi).toBeNull()
  })

  it('rejects frames quieter than the absolute floor', () => {
    const classified = classify([frame({ tMs: 0, rms: 0.001 })])

    expect(classified.at(-1)!.accepted).toBe(false)
  })

  it('rejects loud but tonally unclear frames — a table bang or chair scrape', () => {
    const classified = classify([frame({ tMs: 0, rms: 0.9, clarity: 0.05 })])

    expect(classified.at(-1)!.accepted).toBe(false)
  })

  it('treats a null clarity as unclear', () => {
    const classified = classify([frame({ tMs: 0, clarity: null })])

    expect(classified.at(-1)!.accepted).toBe(false)
  })

  it('rejects everything in a clip with no quiet frames at all', () => {
    // The noise floor is an order statistic of the clip itself, so a recording that is
    // loud end to end has nothing to distinguish signal from room.
    const wallToWall = classifyClip(steadyNote(0, A4_HZ, 40))

    expect(wallToWall.every((f) => !f.accepted)).toBe(true)
  })

  it('adapts its floor to a noisy room rather than using a fixed gate', () => {
    // The same note at rms 0.2 is clear signal in a quiet room, but sits in the noise
    // in a pub where the floor is already up at 0.3.
    const quietRoom = classifyClip([...silence(0, 20), ...steadyNote(400, A4_HZ, 5)])
    const noisyRoom = classifyClip([
      ...Array.from({ length: 20 }, (_, i) => frame({ tMs: i * FRAME_MS, rms: 0.3, clarity: 0.05, hz: null })),
      ...steadyNote(400, A4_HZ, 5),
    ])

    expect(quietRoom.filter((f) => f.accepted)).toHaveLength(5)
    expect(noisyRoom.filter((f) => f.accepted)).toHaveLength(0)
  })

  it('converts an accepted frame’s frequency to MIDI', () => {
    const classified = classify(steadyNote(0, A4_HZ, 5))

    expect(classified.at(-1)!.midi).toBe(69)
  })

  it('leaves the original frame data intact', () => {
    const classified = classify([frame({ tMs: 0, rms: 0.25, clarity: 0.8, hz: A4_HZ })])
    const last = classified.at(-1)!

    expect(last.rms).toBe(0.25)
    expect(last.clarity).toBe(0.8)
    expect(last.hz).toBe(A4_HZ)
  })
})

describe('groupNotes', () => {
  it('finds nothing in an empty clip', () => {
    expect(groupNotes([])).toEqual([])
  })

  it('finds nothing in silence', () => {
    expect(groupNotes(classifyClip(silence(0, 40)))).toEqual([])
  })

  it('turns one sustained pitch into a single note', () => {
    const notes = group(steadyNote(0, A4_HZ))

    expect(notes).toHaveLength(1)
    expect(notes[0].midi).toBe(69)
  })

  it('reports the note’s start time', () => {
    const { frames, offsetMs } = withNoiseFloor(steadyNote(100, A4_HZ))

    const notes = groupNotes(classifyClip(frames))

    expect(notes[0].atMs).toBe(offsetMs + 100)
  })

  it('separates two different pitches played back to back', () => {
    const notes = group([...steadyNote(0, A4_HZ), ...steadyNote(400, B4_HZ)])

    expect(notes.map((n) => n.midi)).toEqual([69, 71])
  })

  it('keeps the notes in the order they were played', () => {
    const notes = group([
      ...steadyNote(0, A4_HZ),
      ...steadyNote(400, B4_HZ),
      ...steadyNote(800, A4_HZ),
    ])

    expect(notes.map((n) => n.midi)).toEqual([69, 71, 69])
  })

  it('does not split a note on a brief mid-note flicker', () => {
    // A single dropped frame inside a sustained note is a detector hiccup, not a re-attack.
    const notes = group([
      ...steadyNote(0, A4_HZ, 10),
      ...silence(200, 1),
      ...steadyNote(220, A4_HZ, 10),
    ])

    expect(notes).toHaveLength(1)
  })

  it('does split the same pitch recurring after a real gap', () => {
    // Past the re-arm window this is a repeated motif, not one long note — fusing them
    // would silently drop a note from the melody.
    const notes = group([
      ...steadyNote(0, A4_HZ),
      ...silence(400, 30), // 600ms of quiet, well past the 400ms re-arm
      ...steadyNote(1000, A4_HZ),
    ])

    expect(notes).toHaveLength(2)
    expect(notes.map((n) => n.midi)).toEqual([69, 69])
  })

  it('discards a run too short to be a real note', () => {
    expect(group(steadyNote(0, A4_HZ, 1))).toEqual([])
  })

  it('demands more frames of a murky note than a clear one', () => {
    const barelyEnoughForClear = requiredStableFrames(0.95)

    const clear = group(steadyNote(0, A4_HZ, barelyEnoughForClear, 0.95))
    const murky = group(steadyNote(0, A4_HZ, barelyEnoughForClear, 0.2))

    expect(clear).toHaveLength(1)
    expect(murky).toHaveLength(0)
  })

  it('reports how far off the note was, in cents', () => {
    const inTune = group(steadyNote(0, A4_HZ))
    const sharp = group(steadyNote(0, A4_HZ * Math.pow(2, 30 / 1200)))
    const flat = group(steadyNote(0, A4_HZ * Math.pow(2, -30 / 1200)))

    expect(inTune[0].cents).toBe(0)
    expect(sharp[0].midi).toBe(69)
    expect(sharp[0].cents).toBeCloseTo(30, 0)
    expect(flat[0].cents).toBeCloseTo(-30, 0)
  })

  it('snaps to the nearer semitone once a note is more than a quartertone out', () => {
    // 60 cents above A4 is closer to Bb, so it is heard as Bb 40 cents flat.
    const notes = group(steadyNote(0, A4_HZ * Math.pow(2, 60 / 1200)))

    expect(notes[0].midi).toBe(70)
    expect(notes[0].cents).toBeCloseTo(-40, 0)
  })

  it('reports the frequency of the clearest frame in the run', () => {
    const notes = group([
      ...steadyNote(0, A4_HZ, 20, 0.7),
      frame({ tMs: 400, hz: A4_HZ + 0.5, clarity: 0.99 }),
    ])

    expect(notes[0].hz).toBeCloseTo(A4_HZ + 0.5, 5)
  })

  it('ignores rejected frames entirely', () => {
    const classified: ClassifiedFrame[] = classify(steadyNote(0, A4_HZ)).map((f) => ({
      ...f,
      accepted: false,
      midi: null,
    }))

    expect(groupNotes(classified)).toEqual([])
  })

  it('reads a short phrase as the melody that was played', () => {
    const phrase = [B4_HZ, A4_HZ, G4_HZ, A4_HZ]
    const frames = phrase.flatMap((hz, i) => steadyNote(i * 500, hz))

    expect(group(frames).map((n) => n.midi)).toEqual([71, 69, 67, 69])
  })
})
