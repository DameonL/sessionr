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

  it('counts a jig in six: the bar as written, not the two groups it is felt in', () => {
    const { offsetsMs } = getCountInBar(tune(6, 8, 1500), 120)
    expect(offsetsMs).toEqual([0, 250, 500, 750, 1000, 1250])
  })

  it('counts a waltz in three', () => {
    const { offsetsMs } = getCountInBar(tune(3, 4, 1800), 100)
    expect(offsetsMs).toEqual([0, 600, 1200])
  })

  it('counts a polka in two', () => {
    expect(getCountInBar(tune(2, 4, 1000), 120).offsetsMs).toEqual([0, 500])
  })

  it('counts a slide in four, not twelve: a bar of twelve eighths goes by too fast to count', () => {
    const { offsetsMs } = getCountInBar(tune(12, 8, 2000), 120)
    expect(offsetsMs).toEqual([0, 500, 1000, 1500])
  })

  it('counts a slip jig in three, by its dotted-quarter groups', () => {
    const { offsetsMs } = getCountInBar(tune(9, 8, 1500), 120)
    expect(offsetsMs).toEqual([0, 500, 1000])
  })

  it('counts an irregular meter by its numerator too', () => {
    const { offsetsMs } = getCountInBar(tune(7, 8, 1400), 120)
    expect(offsetsMs.map((ms) => Math.round(ms))).toEqual([0, 200, 400, 600, 800, 1000, 1200])
  })

  it('counts nothing through a bar of no length, so the caller can skip it', () => {
    expect(getCountInBar(tune(4, 4, 0), 120)).toEqual({ offsetsMs: [], barMs: 0 })
  })
})
