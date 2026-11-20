import { describe, it, expect } from 'vitest'
import {
  analyzeClipFrames,
  createSampleRecorder,
  detectHz,
  hzToMidi,
  normalizeClipGain,
  passesLiveGate,
  type PcmCaptureFactory,
} from './pitchDetector'

const SAMPLE_RATE = 44100
const WINDOW = 4096

/** A pure sine at `hz`, the size YIN's difference function needs (2x its integration window). */
function sineTone(hz: number, size = WINDOW): Float32Array {
  const buf = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    buf[i] = Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)
  }
  return buf
}

/**
 * A harmonic-rich tone (fundamental + strong 2nd/3rd harmonics), approximating a
 * fiddle/whistle's timbre. This is the case that broke the prior plain-ACF detector: a
 * naive autocorrelation/peak search can find the 2nd harmonic's period "more periodic"
 * than the fundamental's, since a strong harmonic partial repeats twice as often.
 */
function harmonicTone(hz: number, size = WINDOW): Float32Array {
  const buf = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const t = i / SAMPLE_RATE
    buf[i] =
      1.0 * Math.sin(2 * Math.PI * hz * t) +
      0.6 * Math.sin(2 * Math.PI * hz * 2 * t) +
      0.3 * Math.sin(2 * Math.PI * hz * 3 * t)
  }
  return buf
}

describe('detectHz', () => {
  it('returns null for a near-silent buffer', () => {
    const result = detectHz(new Float32Array(WINDOW), SAMPLE_RATE)
    expect(result.hz).toBeNull()
    expect(result.clarity).toBeNull()
  })

  // Fiddle open strings, whistle range, and a few in-between notes.
  const testHz = [196, 293.66, 392, 440, 587.33, 880]

  for (const hz of testHz) {
    it(`recovers a pure ${hz}Hz sine's fundamental`, () => {
      const result = detectHz(sineTone(hz), SAMPLE_RATE)
      expect(result.hz).not.toBeNull()
      expect(result.hz!).toBeCloseTo(hz, 0)
      expect(result.clarity).toBeGreaterThan(0.9)
    })

    it(`recovers the fundamental of a harmonic-rich ${hz}Hz tone, not a harmonic`, () => {
      const result = detectHz(harmonicTone(hz), SAMPLE_RATE)
      expect(result.hz).not.toBeNull()
      // Within a few cents of the true fundamental — and specifically NOT locked onto
      // the 2nd harmonic (2x) or 3rd harmonic (3x), which is the failure mode this
      // algorithm replaces a prior plain-ACF detector to fix.
      expect(result.hz!).toBeCloseTo(hz, 0)
      expect(hzToMidi(result.hz!)).toBe(hzToMidi(hz))
    })
  }

  it('reports high clarity for a clean tone and low clarity for noise', () => {
    const clean = detectHz(sineTone(440), SAMPLE_RATE)
    const noiseBuf = new Float32Array(WINDOW)
    for (let i = 0; i < WINDOW; i++) noiseBuf[i] = Math.random() * 2 - 1
    const noisy = detectHz(noiseBuf, SAMPLE_RATE)

    expect(clean.clarity).toBeGreaterThan(0.9)
    expect(noisy.clarity ?? 0).toBeLessThan(clean.clarity!)
  })
})

describe('passesLiveGate', () => {
  it('accepts quiet but clear notes down to -54 dBFS (rms >= 0.002)', () => {
    expect(passesLiveGate({ rms: 0.003, clarity: 0.7, hz: 440 })).toBe(true)
  })

  it('rejects near-silent or low-clarity frames', () => {
    expect(passesLiveGate({ rms: 0.001, clarity: 0.9, hz: 440 })).toBe(false)
    expect(passesLiveGate({ rms: 0.05, clarity: 0.2, hz: 440 })).toBe(false)
    expect(passesLiveGate({ rms: 0.05, clarity: 0.9, hz: null })).toBe(false)
  })
})

describe('normalizeClipGain', () => {
  it('boosts quiet audio toward target RMS without distorting pitch', () => {
    const quiet = sineTone(440, 8192).map((v) => v * 0.0003)
    const normalized = normalizeClipGain(quiet)
    let sumSq = 0
    for (let i = 0; i < normalized.length; i++) sumSq += normalized[i] * normalized[i]
    const rms = Math.sqrt(sumSq / normalized.length)

    expect(rms).toBeGreaterThan(0.03)
    const detected = detectHz(normalized.subarray(0, WINDOW), SAMPLE_RATE)
    expect(detected.hz!).toBeCloseTo(440, 0)
    expect(detected.clarity).toBeGreaterThan(0.9)
  })

  it('leaves already-loud audio and digital silence untouched', () => {
    const loud = sineTone(440, 4096)
    expect(normalizeClipGain(loud)).toBe(loud)

    const silence = new Float32Array(4096).fill(1e-6)
    expect(normalizeClipGain(silence)).toBe(silence)
  })
})

describe('analyzeClipFrames', () => {
  it('detects a very quiet (-70 dBFS) melody tone after band-limiting and normalization', () => {
    const quiet = harmonicTone(440, SAMPLE_RATE).map((v) => v * 0.0003)
    const frames = analyzeClipFrames(quiet, SAMPLE_RATE)
    const pitched = frames.filter((f) => f.hz !== null && (f.clarity ?? 0) >= 0.7)

    expect(pitched.length).toBeGreaterThan(20)
    expect(hzToMidi(pitched[0].hz!)).toBe(69)
    expect(pitched[0].rms).toBeGreaterThan(0.01)
  })

  it('keeps digital silence below the detection threshold', () => {
    const silent = new Float32Array(SAMPLE_RATE / 2)
    const frames = analyzeClipFrames(silent, SAMPLE_RATE)
    expect(frames.every((f) => f.hz === null)).toBe(true)
  })
})

describe('createSampleRecorder', () => {
  function runWithChunkSize(chunkSize: number, durationMs: number, amplitude = 0.05) {
    const captureState: { onChunk: ((chunk: Float32Array, rate: number) => void) | null } = {
      onChunk: null,
    }
    let stopped = false
    const fakeCapture: PcmCaptureFactory = (onChunk) => {
      captureState.onChunk = onChunk
      return {
        async start() {},
        stop() {
          stopped = true
        },
      }
    }

    const recorder = createSampleRecorder(durationMs, fakeCapture)
    const progressEvents: Array<{ elapsedMs: number; rms: number }> = []
    void recorder.start((elapsedMs, rms) => {
      progressEvents.push({ elapsedMs, rms })
    })

    // Feed 500ms of audio in chunkSize blocks (covers 150ms startup mute + durationMs).
    const totalSamples = Math.ceil(SAMPLE_RATE * 0.5)
    for (let offset = 0; offset < totalSamples && !stopped; offset += chunkSize) {
      const len = Math.min(chunkSize, totalSamples - offset)
      const chunk = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        chunk[i] = amplitude * Math.sin((2 * Math.PI * 440 * (offset + i)) / SAMPLE_RATE)
      }
      captureState.onChunk?.(chunk, SAMPLE_RATE)
    }

    return { recorder, progressEvents, stopped }
  }

  it('skips the 150ms startup mute and captures audio for 128-sample AudioWorklet chunks', () => {
    const { recorder, progressEvents, stopped } = runWithChunkSize(128, 250)
    const { samples, sampleRate } = recorder.audio()

    expect(stopped).toBe(true)
    expect(recorder.isDone()).toBe(true)
    expect(sampleRate).toBe(SAMPLE_RATE)
    expect(samples.length).toBe(Math.ceil((250 / 1000) * SAMPLE_RATE))
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(250)
    expect(progressEvents.at(-1)!.rms).toBeGreaterThan(0.02)
  })

  it('skips the 150ms startup mute and captures audio for 4096-sample ScriptProcessor chunks', () => {
    const { recorder, stopped } = runWithChunkSize(4096, 250)
    const { samples } = recorder.audio()

    expect(stopped).toBe(true)
    expect(recorder.isDone()).toBe(true)
    expect(samples.length).toBe(Math.ceil((250 / 1000) * SAMPLE_RATE))
  })
})
