import { createSampleRecorder, hzToMidi, requiredStableFrames, type RawFrame, type SampleRecorder } from './pitchDetector'

/**
 * Batch "record then process" policy for tune identification: capture a
 * fixed-length sample (pitchDetector.ts's createSampleRecorder buffers every
 * analyzed frame with no accept/reject decision), then classify and group it
 * into an ordered note sequence using statistics from the *whole clip*
 * rather than a live, causally-adapting per-frame guess.
 *
 * This split exists because a live adaptive noise floor is a trap: a note's
 * own attack transient is briefly low-clarity despite being real, loud
 * signal, so an online estimator gets taught by the player's own playing and
 * ratchets upward until it rejects real notes too (see pitchDetector.ts's
 * header comment for the full story). A statistic computed once over an
 * entire ~20s clip doesn't have that problem: a low percentile of the clip's
 * loudness can't be dragged up by "more transients happened," because normal
 * playing — even a continuous reel — still has enough natural quiet moments
 * (attack ramps, phrase breaks, breaths, the lead-in before playing starts)
 * that the low end of the distribution reliably reflects the room, not the
 * player. The same statistic legitimately rises in a genuinely loud room, so
 * this adapts correctly to a noisy pub without ever having been poisoned by
 * the player's own notes.
 */

/** User-facing sample length: "take a 20 second sample and process it." */
export const SAMPLE_DURATION_MS = 20000

// Defaults below are untuned against real hardware/room recordings — this
// dev environment can't produce one. Loosened once already after a field
// report of real solo playing (two repeats of an 8-bar part) still yielding
// too few accepted notes to match: actual mic RMS/clarity levels off typical
// device hardware run lower than the values these were first guessed
// against. Treat as a starting point pending a proper real-mic quiet-room +
// noisy-pub validation pass, not final numbers — if under-capture keeps
// showing up, loosen further; the matcher tolerates extra wrong notes far
// better than it tolerates missing real ones.

/** Percentile of whole-clip RMS used as the ambient noise-floor estimate. */
const NOISE_PERCENTILE = 0.2
/** Accept threshold = max(ABSOLUTE_RMS_FLOOR, floor * RMS_MARGIN). Lower
 *  than a live gate's margin would need: a percentile is a stable order
 *  statistic with nothing to poison, and a missed note costs far more here
 *  (the matcher tolerates a few wrong notes far better than total silence). */
const RMS_MARGIN = 1.5
const ABSOLUTE_RMS_FLOOR = 0.005
/** Low, static backstop against clearly non-tonal loud events (a table bang,
 *  chair scrape) — deliberately not adaptive to the clip's own distribution,
 *  so it can't reproduce the earlier feedback-loop bug in miniature. The
 *  RMS-vs-floor threshold above is the primary signal/noise discriminator. */
const MIN_CLARITY = 0.15

/** Reproduces the live loop's re-arm window: a brief flicker mid-note
 *  shouldn't split one sustained note into two. */
const SILENCE_REARM_MS = 400

export interface ClassifiedFrame extends RawFrame {
  accepted: boolean
  midi: number | null
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))
  return sorted[idx]
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Phase B, step 1: per-frame accept/reject from whole-clip statistics.
 * Pure function — no mic/UI plumbing — so it's directly testable with
 * synthetic fixtures.
 */
export function classifyClip(frames: RawFrame[]): ClassifiedFrame[] {
  const floor = percentile(frames.map((f) => f.rms), NOISE_PERCENTILE)
  const threshold = Math.max(ABSOLUTE_RMS_FLOOR, floor * RMS_MARGIN)

  return frames.map((f) => {
    const accepted = f.hz !== null && f.rms >= threshold && (f.clarity ?? 0) >= MIN_CLARITY
    return { ...f, accepted, midi: accepted && f.hz !== null ? hzToMidi(f.hz) : null }
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
 * Phase B, step 2: turns accepted frames into an ordered note sequence.
 * Pure function. A forward pass over the same conceptual state machine the
 * live loop uses (run tracking + stability threshold + silence re-arm), with
 * one upgrade lookahead enables: the stability threshold is scaled by the
 * *median* clarity across each candidate run instead of a causal running
 * minimum, since a batch pass has already seen the whole note by the time it
 * decides and isn't stuck being pessimistic about a rocky attack.
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
    const clarities = run.frames.map((f) => f.clarity ?? 0)
    const needed = requiredStableFrames(median(clarities))
    if (run.frames.length < needed) continue

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
  /** Runs classifyClip + groupNotes once and returns the ordered MIDI sequence for matchTune. */
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
      return groupNotes(classifyClip(recorder.frames())).map((n) => n.midi)
    },
  }
}
