import { describe, it, expect } from 'vitest'
import { getCountInBar } from './countIn'

/** A stand-in for the abcjs tune object, which only has to answer these two questions. */
function tune(num: number, den: number, barMs: number) {
  return {
    millisecondsPerMeasure: () => barMs,
    getMeterFraction: () => ({ num, den }),
  }
}

describe('getCountInBar', () => {
  it('counts a reel in four, evenly across the bar', () => {
    const { offsetsMs, barMs } = getCountInBar(tune(4, 4, 2000), 120)
    expect(barMs).toBe(2000)
    expect(offsetsMs).toEqual([0, 500, 1000, 1500])
  })

  it('counts a jig in two, not six: the dotted-quarter groups it is felt in', () => {
    const { offsetsMs } = getCountInBar(tune(6, 8, 1500), 120)
    expect(offsetsMs).toEqual([0, 750])
  })

  it('counts a waltz in three', () => {
    const { offsetsMs } = getCountInBar(tune(3, 4, 1800), 100)
    expect(offsetsMs).toEqual([0, 600, 1200])
  })

  it('counts a polka in two', () => {
    expect(getCountInBar(tune(2, 4, 1000), 120).offsetsMs).toEqual([0, 500])
  })

  it('follows the meter pulse groupings for an irregular meter', () => {
    // 7/8 groups in twos, so the counted beats fall every quarter note: 0, 2/8, 4/8, 6/8 of a
    // bar that is 7/8 long.
    const { offsetsMs } = getCountInBar(tune(7, 8, 1400), 120)
    expect(offsetsMs.map((ms) => Math.round(ms))).toEqual([0, 400, 800, 1200])
  })

  it('counts nothing through a bar of no length, so the caller can skip it', () => {
    expect(getCountInBar(tune(4, 4, 0), 120)).toEqual({ offsetsMs: [], barMs: 0 })
  })
})
