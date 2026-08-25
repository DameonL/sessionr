import { createSampleRecorder, hzToMidi, type RawFrame, type SampleRecorder } from './pitchDetector'

/**
 * Batch "record then process" policy for tune identification: capture a
 * fixed-length clip of raw audio, analyze it offline into pitch frames (see
 * pitchDetector.ts's `analyzeClipFrames`), then classify and group those
 * frames into an ordered note sequence.
 *
 * Signal-vs-noise here is decided by **clarity** (how periodic a frame is),
 * not loudness. Two earlier designs got this wrong in opposite directions:
 *
 *  - A *live adaptive* loudness floor was a trap: a note's own attack
 *    transient is briefly low-clarity despite being real, loud signal, so an
 *    online estimator got taught by the player's own playing and ratcheted
 *    upward until it rejected real notes too. (See pitchDetector.ts's header.)
 *  - A *whole-clip percentile* of loudness then replaced it, on the reasoning
 *    that even continuous playing leaves enough natural quiet moments that a
 *    low percentile reflects the room rather than the player. That holds for a
 *    close-mic'd solo recording and fails completely at an actual session,
 *    where the background is loud and unbroken: measured on a real pub
 *    recording, frame RMS ran 0.111 (p5) to 0.229 (p95) — a 2.1x spread, versus
 *    19.8x for a solo whistle — so the 20th percentile landed *inside* the
 *    noise, the threshold came out nearly as high as the music, and 1128 of
 *    1248 frames were rejected. Three notes survived grouping.
 *
 * Clarity does not have that failure mode: on the same recording it accepted
 * 1238 of 1248 frames, because periodicity distinguishes a sounding note from
 * room noise regardless of how loud the room is. Loudness is now used only as
 * a digital-silence guard. Do not reintroduce a loudness-derived threshold as
 * the primary discriminator, adaptive or not.
 */

/** User-facing sample length: "take a 20 second sample and process it." */
export const SAMPLE_DURATION_MS = 20000

/**
 * Primary signal/noise discriminator: how periodic the frame is. Validated at
 * 0.3 across three real recordings (one solo, two sessions); every one of them
 * ranked its own tune first. Raising it starts discarding real notes in the
 * noisier recordings, lowering it lets in non-tonal frames.
 */
const MIN_CLARITY = 0.3
/**
 * Digital-silence guard only — a muted mic or an all-zero buffer, not a
 * perceptual gate. Deliberately far below any real playing level.
 */
const ABSOLUTE_RMS_FLOOR = 0.002
/**
 * Width of the median filter over the MIDI track (in frames, so ~29ms at the
 * analysis hop). At the fixed dense hop each note spans plenty of frames, and
 * this removes isolated single-frame pitch errors before they can either
 * fragment a real note's run or form a spurious run of their own.
 */
const MEDIAN_FILTER_FRAMES = 5
/**
 * Shortest run of one steady pitch that counts as a played note. Ornaments
 * (cuts, taps) in Irish playing are genuinely brief, so this has to stay low,
 * but below roughly this length a run is a detector artefact rather than
 * anything a player did. Validated at this value across three real recordings.
 */
const MIN_NOTE_MS = 45

/** Reproduces the live loop's re-arm window: a brief flicker mid-note
 *  shouldn't split one sustained note into two. */
const SILENCE_REARM_MS = 400

export interface ClassifiedFrame extends RawFrame {
  accepted: boolean
  midi: number | null
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Phase B, step 1: per-frame accept/reject. Pure function — no mic/UI
 * plumbing — so it's directly testable with synthetic fixtures.
 */
export function classifyClip(frames: RawFrame[]): ClassifiedFrame[] {
  return frames.map((f) => {
    const accepted = f.hz !== null && f.rms >= ABSOLUTE_RMS_FLOOR && (f.clarity ?? 0) >= MIN_CLARITY
    return { ...f, accepted, midi: accepted && f.hz !== null ? hzToMidi(f.hz) : null }
  })
}

/**
 * Phase B, step 2: replaces each accepted frame's MIDI value with the median
 * of its neighbourhood, so one stray frame can't fragment a real note's run or
 * start a run of its own, and drops frames too isolated to corroborate.
 * Smooths pitch — it never resurrects silence.
 */
export function smoothPitchTrack(frames: ClassifiedFrame[]): ClassifiedFrame[] {
  const half = MEDIAN_FILTER_FRAMES >> 1
  return frames.map((f, i) => {
    if (!f.accepted) return f
    const window: number[] = []
    for (let j = Math.max(0, i - half); j <= Math.min(frames.length - 1, i + half); j++) {
      const m = frames[j].midi
      if (frames[j].accepted && m !== null) window.push(m)
    }
    if (window.length <= half) return { ...f, accepted: false, midi: null }
    // Rounded: an even-length window averages its two middle values, and a
    // MIDI note number has to stay integral for run-grouping to compare them.
    return { ...f, midi: Math.round(median(window)) }
  })
}

export interface NoteEvent {
  midi: number
  hz: number
  cents: number
  atMs: number
}

interface Run {
  midi: number
  frames: ClassifiedFrame[]
}

/**
 * Phase B, step 3: turns accepted frames into an ordered note sequence.
 * Pure function. A forward pass over run tracking + silence re-arm, then a
 * minimum-duration test on each candidate run.
 *
 * Duration is measured in milliseconds off the frames' own timestamps, not as
 * a frame count. A frame count would silently mean different things at
 * different analysis rates — the pre-existing clarity-scaled frame threshold
 * (`requiredStableFrames`, 3-8 frames) was calibrated when frames arrived at
 * the display refresh rate (~16.7ms, so 50-134ms of audio); at the identify
 * path's fixed 5.8ms hop the same 3 frames is 17ms, which is not a note, and
 * it let through enough sub-note fragments to double the note count on a
 * clean recording. `requiredStableFrames` still governs the live EarTrainer
 * loop, which really does decide per frame.
 */
export function groupNotes(frames: ClassifiedFrame[]): NoteEvent[] {
  // The gap check has to happen in this same pass, not a later "merge
  // adjacent runs" pass: a bare skip-on-reject here (with no gap awareness)
  // would let two temporally distant occurrences of the same pitch — a
  // sustained note, then unrelated noise, then the same pitch recurring
  // much later, e.g. a repeated motif — silently fuse into one run before
  // any later pass gets a chance to keep them separate.
  const runs: Run[] = []
  for (const f of frames) {
    if (!f.accepted || f.midi === null) continue
    const last = runs[runs.length - 1]
    const lastFrame = last?.frames[last.frames.length - 1]
    const gap = lastFrame ? f.tMs - lastFrame.tMs : Infinity
    if (last && last.midi === f.midi && gap < SILENCE_REARM_MS) {
      last.frames.push(f)
    } else {
      runs.push({ midi: f.midi, frames: [f] })
    }
  }

  const notes: NoteEvent[] = []
  for (const run of runs) {
    const spanMs = run.frames.at(-1)!.tMs - run.frames[0].tMs
    if (spanMs < MIN_NOTE_MS) continue

    const best = run.frames.reduce((a, b) => ((b.clarity ?? 0) > (a.clarity ?? 0) ? b : a))
    const hz = best.hz as number
    const exactMidi = 69 + 12 * Math.log2(hz / 440)
    const cents = Math.round((exactMidi - run.midi) * 100)
    notes.push({ midi: run.midi, hz, cents, atMs: run.frames[0].tMs })
  }
  return notes
}

export interface TuneSample {
  /** Starts the mic; records for durationMs. Rejects if mic access is denied. */
  start(onProgress?: (elapsedMs: number, rms: number, durationMs: number) => void): Promise<void>
  isDone(): boolean
  /** Stops early; frames captured so far are kept. */
  stop(): void
  /** Runs the classify/smooth/group passes once and returns the ordered MIDI sequence for matchTune. */
  analyze(): number[]
}

export function createTuneSample(durationMs = SAMPLE_DURATION_MS): TuneSample {
  const recorder: SampleRecorder = createSampleRecorder(durationMs)

  return {
    start(onProgress) {
      return recorder.start(onProgress)
    },
    isDone() {
      return recorder.isDone()
    },
    stop() {
      recorder.stop()
    },
    analyze() {
      return groupNotes(smoothPitchTrack(classifyClip(recorder.frames()))).map((n) => n.midi)
    },
  }
}
