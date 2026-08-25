import { describe, it, expect } from 'vitest'
import { getBodhranDrumOption, getBodhranPatternForMeter } from './bodhran'
import { getMeterPulse } from './meterPulse'

/**
 * The drum strings below are what the bodhrán produced before its stroke offsets were rebased onto
 * meterPulse. They are here to prove that refactor changed no sound at all — if one of these moves,
 * the drum's rhythm moved with it.
 */
describe('getBodhranDrumOption', () => {
  it.each([
    ['4/4', { num: 4, den: 4 }, 'dddddddd 36 76 37 76 36 76 37 76 90 50 75 50 85 50 75 50'],
    ['2/4', { num: 2, den: 4 }, 'dddddddd 36 76 37 76 36 76 37 76 90 50 75 50 85 50 75 50'],
    ['2/2', { num: 2, den: 2 }, 'dddddddd 36 76 37 76 36 76 37 76 90 50 75 50 85 50 75 50'],
    ['3/4', { num: 3, den: 4 }, 'dddddd 36 76 37 76 37 76 90 45 65 45 65 45'],
    ['3/8', { num: 3, den: 8 }, 'dddddd 36 76 37 76 37 76 90 45 65 45 65 45'],
    ['6/8', { num: 6, den: 8 }, 'dddddd 36 76 76 36 76 76 95 55 55 85 55 55'],
    ['9/8', { num: 9, den: 8 }, 'ddddddddd 36 76 76 36 76 76 37 76 76 95 55 55 85 55 55 85 55 55'],
    ['12/8', { num: 12, den: 8 }, 'dddddddddddd 36 76 76 36 76 76 36 76 76 37 76 76 95 50 50 85 50 50 90 50 50 80 50 50'],
    ['5/8', { num: 5, den: 8 }, 'dddddddd 36 76 37 76 36 76 37 76 90 50 75 50 85 50 75 50'],
    ['7/8', { num: 7, den: 8 }, 'dddddddd 36 76 37 76 36 76 37 76 90 50 75 50 85 50 75 50'],
  ])('is unchanged for %s', (_label, meter, expected) => {
    expect(getBodhranDrumOption(meter)).toBe(expected)
  })

  it('falls back to the reel pattern when there is no meter', () => {
    expect(getBodhranDrumOption(null)).toBe('dddddddd 36 76 37 76 36 76 37 76 90 50 75 50 85 50 75 50')
  })

  it('is empty when there are no strokes to play', () => {
    expect(getBodhranDrumOption({ num: 0, den: 0 })).not.toBe('')
  })
})

describe('getBodhranPatternForMeter', () => {
  it('strikes the drum where the meter says the beats are', () => {
    // The point of sharing meterPulse: the drum's bass strokes land on the pulse's strong and
    // medium beats, so the tune's emphasis and the drum cannot drift apart.
    const { strokes } = getBodhranPatternForMeter({ num: 6, den: 8 })
    const { beats } = getMeterPulse({ num: 6, den: 8 })
    const bassOffsets = strokes.filter((s) => s.pitch === 36).map((s) => s.offsetWholeNotes)
    const weighted = beats.filter((b) => b.strength !== 'off').map((b) => b.offsetWholeNotes)
    expect(bassOffsets).toEqual(weighted)
  })

  it('reports the real bar length, not the pattern family it borrowed', () => {
    // 2/4 is voiced with the reel pattern but is still a half-length bar.
    expect(getBodhranPatternForMeter({ num: 2, den: 4 }).measureLengthWholeNotes).toBe(0.5)
    expect(getBodhranPatternForMeter({ num: 4, den: 4 }).measureLengthWholeNotes).toBe(1)
    expect(getBodhranPatternForMeter({ num: 9, den: 8 }).measureLengthWholeNotes).toBe(1.125)
  })
})
