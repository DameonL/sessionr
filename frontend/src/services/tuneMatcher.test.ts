import { describe, it, expect } from 'vitest'
import { classifyClip, groupNotes, smoothPitchTrack, type ClassifiedFrame } from './tuneMatcher'
import { type RawFrame } from './pitchDetector'

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
 * Prepends quiet frames ahead of the music. The classifier no longer derives any
 * threshold from the clip's own loudness distribution, so this is no longer load-bearing
 * for acceptance — it just keeps the fixtures shaped like a real recording, where the
 * player isn't sounding for the whole sample.
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

  it('accepts a clip that is loud from end to end', () => {
    // The regression this whole gating rewrite exists for. A pub session has no quiet
    // frames at all, and the previous whole-clip-percentile floor rejected such a
    // recording wholesale — 3 notes survived out of 1248 frames of real playing.
    const wallToWall = classifyClip(steadyNote(0, A4_HZ, 40))

    expect(wallToWall.every((f) => f.accepted)).toBe(true)
  })

  it('separates signal from noise by clarity, not by loudness', () => {
    // A quiet but clearly pitched note is signal; a loud but aperiodic frame is not.
    // Loudness alone cannot tell these apart, which is why clarity is the discriminator.
    const quietButClear = classifyClip([frame({ tMs: 0, rms: 0.01, clarity: 0.9 })])
    const loudButNoisy = classifyClip([frame({ tMs: 0, rms: 0.9, clarity: 0.1 })])

    expect(quietButClear[0].accepted).toBe(true)
    expect(loudButNoisy[0].accepted).toBe(false)
  })

  it('accepts the same note whether the room around it is quiet or loud', () => {
    // The old floor adapted to the clip's own loudness, so identical playing was
    // accepted in a quiet room and rejected in a loud one. Clarity is unaffected by
    // how loud the room behind the note is.
    const quietRoom = classifyClip([...silence(0, 20), ...steadyNote(400, A4_HZ, 5)])
    const noisyRoom = classifyClip([
      ...Array.from({ length: 20 }, (_, i) => frame({ tMs: i * FRAME_MS, rms: 0.3, clarity: 0.05, hz: null })),
      ...steadyNote(400, A4_HZ, 5),
    ])

    expect(quietRoom.filter((f) => f.accepted)).toHaveLength(5)
    expect(noisyRoom.filter((f) => f.accepted)).toHaveLength(5)
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

  it('keeps a run that lasts long enough to be a played note', () => {
    // Four frames 20ms apart span 60ms, clear of the 45ms floor.
    expect(group(steadyNote(0, A4_HZ, 4))).toHaveLength(1)
  })

  it('discards a run too brief to be a played note', () => {
    // Three frames span only 40ms.
    expect(group(steadyNote(0, A4_HZ, 3))).toHaveLength(0)
  })

  it('measures a note by its duration, not by how many frames it happens to span', () => {
    // The same three frames spread over a wider span is a real note. The threshold
    // has to follow the clock, otherwise it silently means different things at
    // different analysis rates — which is exactly how a frame-count threshold
    // calibrated for the display refresh rate let 17ms fragments through once the
    // identify path moved to a dense fixed hop.
    const sparse = [frame({ tMs: 0 }), frame({ tMs: 40 }), frame({ tMs: 80 })]

    expect(groupNotes(classifyClip(sparse))).toHaveLength(1)
    expect(group(steadyNote(0, A4_HZ, 3))).toHaveLength(0)
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

describe('smoothPitchTrack', () => {
  const classifyRaw = (frames: RawFrame[]) => classifyClip(frames)

  it('leaves a steady run untouched', () => {
    const smoothed = smoothPitchTrack(classifyRaw(steadyNote(0, A4_HZ, 20)))

    expect(smoothed.every((f) => f.accepted && f.midi === 69)).toBe(true)
  })

  it('corrects a single stray frame in the middle of a note', () => {
    // One frame of a 20-frame A4 run reads as B4 — an isolated detector slip, not a
    // real note change. Left alone it would split one note into three runs.
    const frames = steadyNote(0, A4_HZ, 20)
    frames[10] = frame({ tMs: 10 * FRAME_MS, hz: B4_HZ })
    const smoothed = smoothPitchTrack(classifyRaw(frames))

    expect(smoothed[10].midi).toBe(69)
    expect(smoothed.every((f) => f.midi === 69)).toBe(true)
  })

  it('drops a lone accepted frame with nothing around it to corroborate it', () => {
    const frames = [...silence(0, 10), frame({ tMs: 200 }), ...silence(220, 10)]
    const smoothed = smoothPitchTrack(classifyRaw(frames))

    expect(smoothed.every((f) => !f.accepted)).toBe(true)
  })

  it('never turns a rejected frame back into signal', () => {
    const smoothed = smoothPitchTrack(classifyRaw(silence(0, 20)))

    expect(smoothed.every((f) => !f.accepted && f.midi === null)).toBe(true)
  })

  it('preserves a genuine note change rather than smearing across it', () => {
    // A real change is corroborated by its own neighbours on both sides, so the
    // median follows it instead of averaging it away.
    const frames = [...steadyNote(0, A4_HZ, 15), ...steadyNote(300, B4_HZ, 15)]
    const smoothed = smoothPitchTrack(classifyRaw(frames))

    expect(smoothed[2].midi).toBe(69)
    expect(smoothed.at(-3)!.midi).toBe(71)
  })
})
