import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type abcjs from 'abcjs'
import {
  outputLatencyMs,
  audioPositionMs,
  timerDriftMs,
  anchorTimerToAudio,
  seekAndLatch,
  waitForAudioClock,
  resetAudioClockConfirmation,
} from './audioClock'

const { activeAudioContext } = vi.hoisted(() => ({ activeAudioContext: vi.fn() }))

vi.mock('abcjs', () => ({ default: { synth: { activeAudioContext } } }))

/** Just the two fields audioClock reads off a real AudioContext. */
function ctx(currentTime: number, latency: Partial<{ outputLatency: number; baseLatency: number }> = {}) {
  return { currentTime, ...latency } as unknown as AudioContext
}

function synthAt(startTimeSec: number | undefined): abcjs.MidiBuffer {
  return { startTimeSec } as unknown as abcjs.MidiBuffer
}

function timerAt(startTime: number | null): abcjs.TimingCallbacks {
  return { startTime } as unknown as abcjs.TimingCallbacks
}

/** Reads back the private startTime that anchorTimerToAudio writes. */
function startTimeOf(timer: abcjs.TimingCallbacks): number | null {
  return (timer as unknown as { startTime: number | null }).startTime
}

beforeEach(() => {
  activeAudioContext.mockReset()
  vi.spyOn(performance, 'now').mockReturnValue(10_000)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('outputLatencyMs', () => {
  it('subtracts the 16ms of slop abcjs already adds to its own clock', () => {
    expect(outputLatencyMs(ctx(0, { outputLatency: 0.05 }))).toBe(34)
  })

  it('falls back to baseLatency where outputLatency is unavailable (Safari)', () => {
    expect(outputLatencyMs(ctx(0, { baseLatency: 0.04 }))).toBeCloseTo(24)
  })

  it('prefers outputLatency when both are present', () => {
    expect(outputLatencyMs(ctx(0, { outputLatency: 0.2, baseLatency: 0.01 }))).toBe(184)
  })

  it('reports no latency when the browser reports none', () => {
    expect(outputLatencyMs(ctx(0))).toBe(0)
  })

  it('floors at zero rather than pulling the cursor ahead of the music', () => {
    // 10ms of real latency is less than the slop abcjs already applies.
    expect(outputLatencyMs(ctx(0, { outputLatency: 0.01 }))).toBe(0)
  })

  it('clamps an implausible reported latency instead of dragging the cursor far behind', () => {
    expect(outputLatencyMs(ctx(0, { outputLatency: 30 }))).toBe(400)
  })

  it('ignores nonsense values', () => {
    expect(outputLatencyMs(ctx(0, { outputLatency: Number.NaN }))).toBe(0)
    expect(outputLatencyMs(ctx(0, { outputLatency: -1 }))).toBe(0)
  })
})

describe('audioPositionMs', () => {
  it('reports elapsed audio time, less the output latency', () => {
    activeAudioContext.mockReturnValue(ctx(12.5, { outputLatency: 0.05 }))
    // 2.5s of audio submitted, 34ms of which hasn't reached the ears yet.
    expect(audioPositionMs(synthAt(10))).toBeCloseTo(2466)
  })

  it('returns null before the synth has started', () => {
    activeAudioContext.mockReturnValue(ctx(5))
    expect(audioPositionMs(synthAt(undefined))).toBeNull()
  })

  it('returns null when no audio context exists yet', () => {
    activeAudioContext.mockReturnValue(null)
    expect(audioPositionMs(synthAt(0))).toBeNull()
  })

  it('returns null rather than throwing if abcjs has no context to hand out', () => {
    activeAudioContext.mockImplementation(() => {
      throw new Error('no context')
    })
    expect(audioPositionMs(synthAt(0))).toBeNull()
  })
})

describe('timerDriftMs', () => {
  it('is positive when the cursor is running behind the music', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    // Audio is 1000ms in; the cursor thinks it is 900ms in.
    expect(timerDriftMs(timerAt(10_000 - 900), synthAt(0))).toBeCloseTo(100)
  })

  it('is negative when the cursor is running ahead of the music', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    expect(timerDriftMs(timerAt(10_000 - 1100), synthAt(0))).toBeCloseTo(-100)
  })

  it('returns null when the timer has not latched its zero yet', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    expect(timerDriftMs(timerAt(null), synthAt(0))).toBeNull()
  })
})

describe('anchorTimerToAudio', () => {
  it('latches an unstarted timer straight onto the audio position', () => {
    activeAudioContext.mockReturnValue(ctx(0.5))
    const timer = timerAt(null)
    anchorTimerToAudio(timer, synthAt(0))
    // performance.now() - startTime must now equal the 500ms the audio has played.
    expect(10_000 - startTimeOf(timer)!).toBeCloseTo(500)
  })

  it('pulls a lagging cursor forward onto the music', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    const timer = timerAt(10_000 - 700) // cursor 300ms behind
    const correction = anchorTimerToAudio(timer, synthAt(0))
    expect(correction).toBeCloseTo(300)
    expect(10_000 - startTimeOf(timer)!).toBeCloseTo(1000)
  })

  it('holds a cursor that has run ahead of the music', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    const timer = timerAt(10_000 - 1300) // cursor 300ms ahead
    const correction = anchorTimerToAudio(timer, synthAt(0))
    expect(correction).toBeCloseTo(-300)
    expect(10_000 - startTimeOf(timer)!).toBeCloseTo(1000)
  })

  it('applies only part of the error when easing, so the cursor converges instead of hopping', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    const timer = timerAt(10_000 - 900) // 100ms behind
    expect(anchorTimerToAudio(timer, synthAt(0), { ease: 0.25 })).toBeCloseTo(25)
    expect(10_000 - startTimeOf(timer)!).toBeCloseTo(925)
  })

  it('leaves sub-frame error alone rather than jittering the cursor', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    const timer = timerAt(10_000 - 995) // 5ms behind, below the 8ms threshold
    expect(anchorTimerToAudio(timer, synthAt(0))).toBe(0)
    expect(startTimeOf(timer)).toBe(10_000 - 995)
  })

  it('respects a caller-supplied threshold', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    const timer = timerAt(10_000 - 950) // 50ms behind
    expect(anchorTimerToAudio(timer, synthAt(0), { threshold: 100 })).toBe(0)
    expect(startTimeOf(timer)).toBe(10_000 - 950)
  })

  it('does nothing when there is no audio position to anchor to', () => {
    activeAudioContext.mockReturnValue(ctx(1))
    const timer = timerAt(10_000 - 900)
    expect(anchorTimerToAudio(timer, synthAt(undefined))).toBe(0)
    expect(startTimeOf(timer)).toBe(10_000 - 900)
  })

  it('holds the cursor at the start while the audio has not sounded yet', () => {
    // The context clock has not advanced past the synth's start: nothing is audible, so the cursor
    // must wait rather than run on without the music.
    activeAudioContext.mockReturnValue(ctx(5))
    const timer = timerAt(10_000 - 400) // cursor already 400ms in
    expect(anchorTimerToAudio(timer, synthAt(5))).toBeCloseTo(-400)
    expect(10_000 - startTimeOf(timer)!).toBeCloseTo(0)
  })

  it('holds at the start when latency compensation would push the position negative', () => {
    activeAudioContext.mockReturnValue(ctx(5, { outputLatency: 0.2 }))
    const timer = timerAt(10_000 - 300)
    anchorTimerToAudio(timer, synthAt(5))
    expect(10_000 - startTimeOf(timer)!).toBeCloseTo(0)
  })
})

describe('seekAndLatch', () => {
  /**
   * Stands in for abcjs's MidiBuffer: seek() restarts the sound at the offset and records it, but
   * deliberately leaves startTimeSec alone, exactly as create-synth.js does.
   */
  function seekableSynth(startTimeSec: number) {
    const synth = {
      startTimeSec,
      pausedTimeSec: undefined as number | undefined,
      seek(position: number, units: string) {
        expect(units).toBe('seconds')
        synth.pausedTimeSec = position
      },
    }
    return synth as unknown as abcjs.MidiBuffer & { pausedTimeSec: number | undefined }
  }

  it('re-latches the clock so the position reads back where the seek landed', () => {
    activeAudioContext.mockReturnValue(ctx(30))
    // 30s into the context, playing a tune that started at its zero — so 30s in musically.
    const synth = seekableSynth(0)
    expect(audioPositionMs(synth)).toBeCloseTo(30_000)

    seekAndLatch(synth, 4)

    expect(synth.pausedTimeSec).toBe(4)
    // Without the latch this still reported 30_000: the sound jumped back but the clock did not,
    // and anything anchored to it was dragged straight back to where the jump came from.
    expect(audioPositionMs(synth)).toBeCloseTo(4_000)
  })

  it('keeps counting from the seek point as the context clock runs on', () => {
    const context = ctx(30)
    activeAudioContext.mockReturnValue(context)
    const synth = seekableSynth(0)
    seekAndLatch(synth, 4)
    ;(context as { currentTime: number }).currentTime = 32.5
    expect(audioPositionMs(synth)).toBeCloseTo(6_500)
  })

  it('still seeks when there is no context to latch against', () => {
    activeAudioContext.mockReturnValue(null)
    const synth = seekableSynth(0)
    seekAndLatch(synth, 4)
    expect(synth.pausedTimeSec).toBe(4)
  })
})

describe('timerDriftMs while the audio has not sounded', () => {
  it('reports the cursor as ahead, so the drift correction pulls it back', () => {
    activeAudioContext.mockReturnValue(ctx(5))
    expect(timerDriftMs(timerAt(10_000 - 250), synthAt(5))).toBeCloseTo(-250)
  })
})

describe('waitForAudioClock', () => {
  /**
   * A context whose clock only starts moving after `framesUntilRunning` reads — which is what a
   * real one does between being unsuspended and the output device finishing opening.
   */
  function openingContext(framesUntilRunning: number, state: AudioContextState = 'running') {
    let reads = 0
    return {
      state,
      resume: vi.fn().mockResolvedValue(undefined),
      get currentTime() {
        reads++
        return reads > framesUntilRunning ? reads * 0.01 : 0
      },
    } as unknown as AudioContext & { resume: ReturnType<typeof vi.fn> }
  }

  /** performance.now advancing by `stepMs` per read, so a deadline can actually be reached. */
  function advancingClock(stepMs: number) {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += stepMs
      return now
    })
  }

  beforeEach(() => {
    resetAudioClockConfirmation()
  })

  it('waits for the device to start rendering before letting the sound go', async () => {
    advancingClock(16)
    const ctx = openingContext(3)
    activeAudioContext.mockReturnValue(ctx)

    await waitForAudioClock()

    expect(ctx.currentTime).toBeGreaterThan(0)
  })

  it('resumes a suspended context, since nothing else in the app does', async () => {
    advancingClock(16)
    const ctx = openingContext(1, 'suspended')
    activeAudioContext.mockReturnValue(ctx)

    await waitForAudioClock()

    expect(ctx.resume).toHaveBeenCalled()
  })

  it('gives up rather than blocking playback on a device that never reports progress', async () => {
    // Past the deadline on the first check inside the loop.
    advancingClock(5000)
    activeAudioContext.mockReturnValue(openingContext(Number.POSITIVE_INFINITY))

    await waitForAudioClock(3000)

    // Nothing was confirmed, so the next call has to wait all over again.
    advancingClock(5000)
    const second = openingContext(Number.POSITIVE_INFINITY)
    activeAudioContext.mockReturnValue(second)
    await waitForAudioClock(3000)
    expect(second.currentTime).toBe(0)
  })

  it('costs nothing once the device has been seen running', async () => {
    advancingClock(16)
    activeAudioContext.mockReturnValue(openingContext(1))
    await waitForAudioClock()

    const later = openingContext(Number.POSITIVE_INFINITY, 'suspended')
    activeAudioContext.mockReturnValue(later)
    await waitForAudioClock()

    expect(later.resume).not.toHaveBeenCalled()
  })

  it('does nothing when no context exists yet', async () => {
    activeAudioContext.mockReturnValue(undefined)
    await expect(waitForAudioClock()).resolves.toBeUndefined()
  })
})
