import { describe, it, expect } from 'vitest'
import { getMeterPulse } from './meterPulse'

/** The offsets carrying each weight, which is what callers actually care about. */
function weighted(meter: { num: number; den: number } | null) {
  const { beats } = getMeterPulse(meter)
  return {
    strong: beats.filter((b) => b.strength === 'strong').map((b) => b.offsetWholeNotes),
    medium: beats.filter((b) => b.strength === 'medium').map((b) => b.offsetWholeNotes),
    light: beats.filter((b) => b.strength === 'light').map((b) => b.offsetWholeNotes),
  }
}

describe('getMeterPulse', () => {
  it('leans a reel on 1 and 3, and merely counts 2 and 4', () => {
    expect(getMeterPulse({ num: 4, den: 4 }).barLengthWholeNotes).toBe(1)
    expect(weighted({ num: 4, den: 4 })).toEqual({ strong: [0], medium: [0.5], light: [0.25, 0.75] })
  })

  it('makes a jig two dotted-quarter groups, not six even eighths', () => {
    expect(getMeterPulse({ num: 6, den: 8 }).barLengthWholeNotes).toBe(0.75)
    expect(weighted({ num: 6, den: 8 })).toEqual({ strong: [0], medium: [0.375], light: [] })
  })

  it('gives a slip jig three groups', () => {
    expect(weighted({ num: 9, den: 8 })).toEqual({ strong: [0], medium: [0.375, 0.75], light: [] })
  })

  it('gives a slide four groups', () => {
    expect(getMeterPulse({ num: 12, den: 8 }).barLengthWholeNotes).toBe(1.5)
    expect(weighted({ num: 12, den: 8 })).toEqual({ strong: [0], medium: [0.375, 0.75, 1.125], light: [] })
  })

  it('puts a waltz on the 1, with 2 and 3 merely counted', () => {
    expect(weighted({ num: 3, den: 4 })).toEqual({ strong: [0], medium: [], light: [0.25, 0.5] })
  })

  it('counts cut time in two half notes', () => {
    expect(getMeterPulse({ num: 2, den: 2 }).barLengthWholeNotes).toBe(1)
    expect(weighted({ num: 2, den: 2 })).toEqual({ strong: [0], medium: [0.5], light: [] })
  })

  it('gives a polka one strong beat and one answering it', () => {
    expect(getMeterPulse({ num: 2, den: 4 }).barLengthWholeNotes).toBe(0.5)
    expect(weighted({ num: 2, den: 4 })).toEqual({ strong: [0], medium: [], light: [0.25] })
  })

  it('enumerates every eighth of the bar, in order', () => {
    expect(getMeterPulse({ num: 4, den: 4 }).beats.map((b) => b.offsetWholeNotes))
      .toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875])
    expect(getMeterPulse({ num: 6, den: 8 }).beats).toHaveLength(6)
    expect(getMeterPulse({ num: 9, den: 8 }).beats).toHaveLength(9)
    expect(getMeterPulse({ num: 12, den: 8 }).beats).toHaveLength(12)
  })

  it('marks everything between the beats as off', () => {
    const jig = getMeterPulse({ num: 6, den: 8 })
    expect(jig.beats.filter((b) => b.strength === 'off').map((b) => b.offsetWholeNotes))
      .toEqual([0.125, 0.25, 0.5, 0.625])
  })

  it('derives a pulse for irregular meters rather than guessing one', () => {
    // 7/8 groups in twos per abcjs's own beat length, so beats land every quarter.
    expect(weighted({ num: 7, den: 8 })).toEqual({ strong: [0], medium: [], light: [0.25, 0.5, 0.75] })
    // 3/2 has no eighth-based table; the barline is strong and each half note is counted.
    expect(weighted({ num: 3, den: 2 })).toEqual({ strong: [0], medium: [], light: [0.5, 1] })
  })

  it('falls back to common time when there is no meter', () => {
    expect(getMeterPulse(null)).toEqual(getMeterPulse({ num: 4, den: 4 }))
    expect(getMeterPulse(undefined)).toEqual(getMeterPulse({ num: 4, den: 4 }))
    expect(getMeterPulse({})).toEqual(getMeterPulse({ num: 4, den: 4 }))
  })
})
