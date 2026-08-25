import abcjs from 'abcjs'

/**
 * Keeps the sheet-music cursor honest by treating the audio as the only real clock.
 *
 * abcjs runs playback and the moving cursor on two unrelated clocks. The synth's zero is an
 * AudioContext timestamp captured inside synth.start(); the cursor's zero is a performance.now()
 * timestamp captured on the first animation frame after timer.start(). Anything that happens
 * between those two moments — a React commit, a smooth scroll, SVG layout — lands entirely in the
 * gap, and because neither clock is ever reconciled against the other afterwards, that gap becomes
 * a fixed offset for the rest of the tune.
 *
 * The fix is to derive the cursor's zero from the audio instead of from whenever the first frame
 * happens to arrive. The synth records startTimeSec (the AudioContext time of musical zero, already
 * offset for a seek), so the true musical position is always ctx.currentTime - synth.startTimeSec.
 * Rewriting timer.startTime to agree with that is exactly what abcjs's own setProgress does
 * internally — but setProgress also rewinds currentEvent/currentBeat and fires a synchronous
 * eventCallback, which re-highlights and flickers when called repeatedly, so we move startTime
 * directly and let doTiming's existing catch-up loop walk the events forward.
 */

/**
 * abcjs slop: doTiming adds 16ms to its own elapsed time to compensate for rAF not firing exactly
 * on time (abcjs/src/api/abc_timing_callbacks.js). The cursor therefore already runs 16ms ahead of
 * where its start time says it should, which offsets part of the output latency for us.
 */
const ABCJS_TIMING_SLOP_MS = 16

/**
 * Ceiling on the latency we'll trust from the browser. outputLatency is unreliable on some
 * platforms, and a bogus value would drag the cursor visibly behind the music — worse than the
 * problem we're fixing. A third of a second is far beyond any real output path.
 */
const MAX_LATENCY_MS = 400

/** Corrections below half a frame are noise; applying them would only jitter the cursor. */
const DEFAULT_THRESHOLD_MS = 8

/** These properties exist at runtime but aren't in abcjs's type declarations. */
interface SynthClock {
  startTimeSec?: number
}
interface TimerClock {
  startTime: number | null
}

/**
 * How far behind audio submission the sound actually reaches the listener's ears, and therefore how
 * far the cursor should lag the buffer start. Wired outputs are a few ms; Bluetooth is often 100ms+,
 * which is very visible on a page of sheet music.
 *
 * outputLatency is absent in Safari, where baseLatency is the best available estimate.
 */
export function outputLatencyMs(ctx: AudioContext): number {
  const reported = ctx.outputLatency || ctx.baseLatency || 0
  if (!Number.isFinite(reported) || reported <= 0) return 0
  const ms = reported * 1000 - ABCJS_TIMING_SLOP_MS
  return Math.min(Math.max(ms, 0), MAX_LATENCY_MS)
}

/** The live AudioContext, or null if nothing has started one yet (abcjs creates it on first play). */
function activeContext(): AudioContext | null {
  try {
    return abcjs.synth.activeAudioContext() ?? null
  } catch {
    return null
  }
}

/**
 * The musical position in ms that the audio clock implies right now, compensated for output latency
 * so it describes what the listener is hearing rather than what was last submitted. Null when the
 * synth hasn't started or has already finished (which clears startTimeSec).
 */
export function audioPositionMs(synth: abcjs.MidiBuffer): number | null {
  const startTimeSec = (synth as unknown as SynthClock).startTimeSec
  if (typeof startTimeSec !== 'number' || !Number.isFinite(startTimeSec)) return null
  const ctx = activeContext()
  if (!ctx) return null
  const elapsedMs = (ctx.currentTime - startTimeSec) * 1000
  if (!Number.isFinite(elapsedMs)) return null
  return elapsedMs - outputLatencyMs(ctx)
}

/**
 * How far the cursor is from the music, in ms: positive means the cursor is running behind and
 * needs to move forward. Null when there's nothing to compare — the synth hasn't started, or the
 * timer hasn't latched its zero yet.
 */
export function timerDriftMs(timer: abcjs.TimingCallbacks, synth: abcjs.MidiBuffer): number | null {
  const audioMs = audioPositionMs(synth)
  if (audioMs === null || audioMs < 0) return null
  const startTime = (timer as unknown as TimerClock).startTime
  if (typeof startTime !== 'number' || !Number.isFinite(startTime)) return null
  return audioMs - (performance.now() - startTime)
}

export interface AnchorOptions {
  /** Corrections smaller than this are skipped. Defaults to half a frame. */
  threshold?: number
  /**
   * Fraction of the error to apply, for easing a correction out over several calls instead of
   * hopping the cursor. Defaults to 1 (snap), which is what you want at a fresh start.
   */
  ease?: number
}

/**
 * Re-latches the timer's zero so its position matches the audio's. Returns the correction applied
 * in ms (positive means the cursor was behind the music and got moved forward), or 0 if it no-opped
 * because the audio position was unavailable or the error was below the threshold.
 */
export function anchorTimerToAudio(
  timer: abcjs.TimingCallbacks,
  synth: abcjs.MidiBuffer,
  { threshold = DEFAULT_THRESHOLD_MS, ease = 1 }: AnchorOptions = {},
): number {
  const audioMs = audioPositionMs(synth)
  if (audioMs === null || audioMs < 0) return 0

  const clock = timer as unknown as TimerClock
  // A timer that hasn't latched yet has no position to compare against — anchor it outright.
  if (typeof clock.startTime !== 'number' || !Number.isFinite(clock.startTime)) {
    clock.startTime = performance.now() - audioMs
    return 0
  }

  const error = timerDriftMs(timer, synth)
  if (error === null || Math.abs(error) < threshold) return 0

  const correction = error * ease
  clock.startTime -= correction
  return correction
}
