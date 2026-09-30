import { describe, it, expect } from 'vitest'
import { getCountIn } from './countIn'

/** A stand-in for the abcjs tune object, which only has to answer these two questions. */
function tune(num: number, den: number, barMs: number) {
  return {
    millisecondsPerMeasure: () => barMs,
    getMeterFraction: () => ({ num, den }),
  }
}

const offsets = (c: ReturnType<typeof getCountIn>) => c.beats.map((b) => Math.round(b.offsetMs))
const counts = (c: ReturnType<typeof getCountIn>) => c.beats.map((b) => b.count)
const strengths = (c: ReturnType<typeof getCountIn>) => c.beats.map((b) => b.strength)

describe('getCountIn', () => {
  it('counts a reel in four, evenly across the bar', () => {
    const countIn = getCountIn(tune(4, 4, 2000), 120)
    expect(countIn.totalMs).toBe(2000)
    expect(offsets(countIn)).toEqual([0, 500, 1000, 1500])
    expect(counts(countIn)).toEqual([1, 2, 3, 4])
  })

  it('counts a jig by the bar as written, not the two groups it is felt in', () => {
    // 1.5s to the bar is over the two-bar threshold, so this is one bar of six.
    expect(offsets(getCountIn(tune(6, 8, 1500), 120))).toEqual([0, 250, 500, 750, 1000, 1250])
  })

  it('counts a waltz in three', () => {
    expect(offsets(getCountIn(tune(3, 4, 1800), 100))).toEqual([0, 600, 1200])
  })

  it('counts a slide in four, not twelve: a bar of twelve eighths goes by too fast to count', () => {
    expect(offsets(getCountIn(tune(12, 8, 2000), 120))).toEqual([0, 500, 1000, 1500])
  })

  it('counts a slip jig in three, by its dotted-quarter groups', () => {
    expect(offsets(getCountIn(tune(9, 8, 1500), 120))).toEqual([0, 500, 1000])
  })

  it('counts an irregular meter by its numerator too', () => {
    expect(offsets(getCountIn(tune(7, 8, 1400), 120))).toEqual([0, 200, 400, 600, 800, 1000, 1200])
  })

  describe('the weight the meter gives each beat', () => {
    it('answers a reel’s 1 on its 3', () => {
      expect(strengths(getCountIn(tune(4, 4, 2000), 120))).toEqual([
        'strong',
        'light',
        'medium',
        'light',
      ])
    })

    it('leans on 1 and 4 of a jig, the pair it is felt in', () => {
      // Counted in six, heard in two: the count says what bar is coming as well as when.
      expect(strengths(getCountIn(tune(6, 8, 1500), 120))).toEqual([
        'strong',
        'off',
        'off',
        'medium',
        'off',
        'off',
      ])
    })

    it('gives a slide’s four dotted-quarter groups a weight each', () => {
      expect(strengths(getCountIn(tune(12, 8, 2000), 120))).toEqual([
        'strong',
        'medium',
        'medium',
        'medium',
      ])
    })

    it('puts a waltz’s weight all on the 1', () => {
      expect(strengths(getCountIn(tune(3, 4, 1800), 100))).toEqual(['strong', 'light', 'light'])
    })
  })

  describe('a bar too short to latch onto', () => {
    it('counts a jig at its usual tempo twice, restarting the numbers', () => {
      // 1s to the bar: six numbers in a second, gone before they have registered.
      const countIn = getCountIn(tune(6, 8, 1000), 120)
      expect(countIn.totalMs).toBe(2000)
      expect(countIn.beatsPerBar).toBe(6)
      expect(counts(countIn)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6])
      expect(offsets(countIn)).toEqual([
        0, 167, 333, 500, 667, 833, 1000, 1167, 1333, 1500, 1667, 1833,
      ])
    })

    it('counts a polka twice too, in two', () => {
      const countIn = getCountIn(tune(2, 4, 1000), 120)
      expect(counts(countIn)).toEqual([1, 2, 1, 2])
      expect(offsets(countIn)).toEqual([0, 500, 1000, 1500])
    })

    it('repeats the meter’s weights over both bars, so both downbeats are strong', () => {
      const countIn = getCountIn(tune(4, 4, 1000), 240)
      expect(strengths(countIn)).toEqual([
        'strong', 'light', 'medium', 'light',
        'strong', 'light', 'medium', 'light',
      ])
      expect(countIn.beats.filter((b) => b.strength === 'strong').map((b) => b.offsetMs)).toEqual([
        0, 1000,
      ])
    })

    it('takes the second bar just under the threshold, and not at it', () => {
      expect(getCountIn(tune(4, 4, 1199), 120).totalMs).toBe(2398)
      expect(getCountIn(tune(4, 4, 1200), 120).totalMs).toBe(1200)
    })
  })

  it('counts nothing through a bar of no length, so the caller can skip it', () => {
    const countIn = getCountIn(tune(4, 4, 0), 120)
    expect(countIn.beats).toEqual([])
    expect(countIn.totalMs).toBe(0)
  })
})
