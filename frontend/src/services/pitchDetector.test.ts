import { describe, it, expect } from 'vitest'
import { detectHz, hzToMidi } from './pitchDetector'

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
