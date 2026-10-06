import { describe, it, expect, beforeEach } from 'vitest'
import {
  BUCKET_ANSWERS,
  MAX_ROUNDS,
  appendRound,
  clearIntervalLog,
  describeAge,
  headlineStats,
  loadIntervalLog,
  rollingAccuracy,
  roundSummaries,
  sizeProgress,
  type RoundLogEntry,
} from './intervalStats'
import type { IntervalHistory } from './intervalTraining'

const LOG_KEY = 'sessionapp.interval-log'
const DAY_MS = 86_400_000

beforeEach(() => {
  localStorage.clear()
})

/** A round of answers for one size: `pattern` is right/wrong per question. */
function round(size: number, pattern: boolean[], at = 0): RoundLogEntry {
  return {
    at,
    key: 'D',
    mode: 'dor',
    answerMode: 'name',
    answers: pattern.map((correct) => ({ size, correct })),
  }
}

/** `count` rounds, each a single answer for `size`, a day apart and all right or all wrong. */
function dailyRounds(size: number, count: number, correct: boolean, startAt = 0): RoundLogEntry[] {
  return Array.from({ length: count }, (_, i) => round(size, [correct], startAt + i * DAY_MS))
}

describe('the round log', () => {
  it('returns an empty log when nothing has been stored', () => {
    expect(loadIntervalLog()).toEqual([])
  })

  it('round-trips an appended round', () => {
    const entry = round(3, [true, false], 1_000)
    expect(appendRound(entry)).toEqual([entry])
    expect(loadIntervalLog()).toEqual([entry])
  })

  it('returns an empty log rather than throwing on stored nonsense', () => {
    localStorage.setItem(LOG_KEY, '{not json')
    expect(loadIntervalLog()).toEqual([])
    localStorage.setItem(LOG_KEY, '{"rounds":3}')
    expect(loadIntervalLog()).toEqual([])
  })

  it('drops entries without answers, which can only be corruption', () => {
    localStorage.setItem(LOG_KEY, JSON.stringify([round(3, [true]), { at: 1 }]))
    expect(loadIntervalLog()).toHaveLength(1)
  })

  it('keeps the newest MAX_ROUNDS rounds', () => {
    localStorage.setItem(
      LOG_KEY,
      JSON.stringify(Array.from({ length: MAX_ROUNDS }, (_, i) => round(2, [true], i))),
    )
    const log = appendRound(round(2, [true], 9_999))

    expect(log).toHaveLength(MAX_ROUNDS)
    expect(log[log.length - 1].at).toBe(9_999)
    // The oldest went, not the newest.
    expect(log[0].at).toBe(1)
  })

  it('empties the log when the record is reset', () => {
    appendRound(round(3, [true]))
    clearIntervalLog()
    expect(loadIntervalLog()).toEqual([])
  })
})

describe('sizeProgress', () => {
  const history: IntervalHistory = { 3: { asked: 16, correct: 8 } }

  it('buckets by the size\'s own answers, not by round', () => {
    // The 3rd comes up once per round across 16 rounds: two full buckets, not sixteen coin tosses.
    const log = [...dailyRounds(3, 8, false), ...dailyRounds(3, 8, true, 8 * DAY_MS)]
    const [row] = sizeProgress(log, history, [3])

    expect(row.series.map((p) => p.asked)).toEqual([BUCKET_ANSWERS, BUCKET_ANSWERS])
    expect(row.series.map((p) => p.accuracy)).toEqual([0, 1])
  })

  it('chunks from the newest backwards, so the latest point is a full bucket', () => {
    const [row] = sizeProgress([round(3, Array(11).fill(true))], { 3: { asked: 11, correct: 11 } }, [3])
    expect(row.series.map((p) => p.asked)).toEqual([3, BUCKET_ANSWERS])
  })

  it('drops a leading bucket too short to read as anything', () => {
    const [row] = sizeProgress([round(3, Array(10).fill(true))], { 3: { asked: 10, correct: 10 } }, [3])
    expect(row.series.map((p) => p.asked)).toEqual([BUCKET_ANSWERS])
  })

  it('reports a climb as improving, with the standing from the newest bucket', () => {
    const log = [round(3, Array(8).fill(false)), round(3, Array(8).fill(true), DAY_MS)]
    const [row] = sizeProgress(log, history, [3])

    expect(row.delta).toBe(1)
    expect(row.standing).toBe(1)
    expect(row.trend).toBe('improving')
    expect(row.lastDrilled).toBe(DAY_MS)
  })

  it('reports a slide as slipping even while the standing is still high', () => {
    const log = [
      round(3, Array(8).fill(true)),
      round(3, [true, true, true, true, true, true, false, false], DAY_MS),
    ]
    const [row] = sizeProgress(log, history, [3])

    expect(row.delta).toBeCloseTo(-0.25)
    expect(row.standing).toBe(0.75)
    expect(row.trend).toBe('slipping')
  })

  it('calls a size unproven under MIN_SAMPLES however it was answered', () => {
    const [row] = sizeProgress([round(4, [true, true, true])], { 4: { asked: 3, correct: 3 } }, [4])
    expect(row.trend).toBe('unproven')
  })

  it('calls a size mastered at the same line the ramp uses, and steady just under it', () => {
    const [atTheLine] = sizeProgress([], { 5: { asked: 10, correct: 7 } }, [5])
    expect(atTheLine.standing).toBe(0.7)
    expect(atTheLine.trend).toBe('mastered')

    const justUnder = [true, true, true, true, true, false, false, false]
    const [row] = sizeProgress([round(5, justUnder)], { 5: { asked: 8, correct: 5 } }, [5])
    expect(row.standing).toBe(0.625)
    expect(row.delta).toBeNull()
    expect(row.trend).toBe('steady')
  })

  it('calls a low, unmoving size weak, and a middling one steady', () => {
    const low = [false, false, false, false, false, false, false, true]
    const [weak] = sizeProgress([round(6, low)], { 6: { asked: 8, correct: 1 } }, [6])
    const middling = [true, true, true, true, false, false, false, false]
    const [steady] = sizeProgress([round(7, middling)], { 7: { asked: 8, correct: 4 } }, [7])

    expect(weak.trend).toBe('weak')
    expect(steady.trend).toBe('steady')
  })

  it('falls back to the lifetime tally for a player whose record predates the log', () => {
    const [row] = sizeProgress([], { 3: { asked: 16, correct: 12 } }, [3])

    expect(row.series).toEqual([])
    expect(row.standing).toBe(0.75)
    expect(row.delta).toBeNull()
    expect(row.lastDrilled).toBeNull()
    expect(row.trend).toBe('mastered')
  })

  it('still lists a size that has never been asked, so the gap shows', () => {
    const rows = sizeProgress([], {}, [2, 3])

    expect(rows.map((r) => r.size)).toEqual([2, 3])
    expect(rows[0]).toMatchObject({
      lifetime: { asked: 0, correct: 0 },
      series: [],
      standing: null,
      delta: null,
      lastDrilled: null,
      trend: 'unproven',
    })
  })

  it('keeps each size to its own answers', () => {
    const log = [
      { ...round(2, [true]), answers: [{ size: 2, correct: true }, { size: 6, correct: false }] },
    ]
    const rows = sizeProgress(log, { 2: { asked: 1, correct: 1 }, 6: { asked: 1, correct: 0 } }, [2, 6])

    expect(rows[0].lifetime).toEqual({ asked: 1, correct: 1 })
    expect(rows[1].lifetime).toEqual({ asked: 1, correct: 0 })
  })
})

describe('roundSummaries and rollingAccuracy', () => {
  it('scores each round, oldest first', () => {
    const log = [round(3, [true, false], 1), round(3, [true, true], 2)]
    expect(roundSummaries(log)).toEqual([
      { at: 1, asked: 2, correct: 1, accuracy: 0.5 },
      { at: 2, asked: 2, correct: 2, accuracy: 1 },
    ])
  })

  it('has nothing to say about an empty log', () => {
    expect(roundSummaries([])).toEqual([])
    expect(rollingAccuracy([])).toEqual([])
  })

  it('averages a trailing window, and only over the rounds that exist', () => {
    const log = [
      round(3, [false, false], 1),
      round(3, [true, true], 2),
      round(3, [true, true], 3),
    ]
    const rolling = rollingAccuracy(roundSummaries(log), 2)

    // The first point averages itself alone rather than being padded toward zero.
    expect(rolling[0]).toBe(0)
    expect(rolling[1]).toBe(0.5)
    expect(rolling[2]).toBe(1)
  })
})

describe('headlineStats', () => {
  it('names the size that has climbed most and the one standing lowest', () => {
    const log = [
      round(3, Array(8).fill(false)),
      round(3, Array(8).fill(true), DAY_MS),
      round(6, Array(8).fill(false), DAY_MS),
      round(2, Array(8).fill(true), DAY_MS),
    ]
    const history: IntervalHistory = {
      2: { asked: 8, correct: 8 },
      3: { asked: 16, correct: 8 },
      6: { asked: 8, correct: 0 },
    }
    const stats = headlineStats(sizeProgress(log, history, [2, 3, 6]), log)

    expect(stats.rounds).toBe(4)
    expect(stats.answers).toBe(32)
    expect(stats.mostImproved?.size).toBe(3)
    expect(stats.weakest?.size).toBe(6)
    expect(stats.mastered).toBe(2)
  })

  it('reports nulls rather than NaN on an empty record', () => {
    const stats = headlineStats(sizeProgress([], {}, [2, 3]), [])

    expect(stats).toEqual({
      rounds: 0,
      answers: 0,
      mostImproved: null,
      weakest: null,
      mastered: 0,
    })
  })
})

describe('describeAge', () => {
  it('reads roughly, so a stale size stands out without arithmetic', () => {
    const now = 100 * DAY_MS
    expect(describeAge(now, now)).toBe('today')
    expect(describeAge(now - DAY_MS, now)).toBe('yesterday')
    expect(describeAge(now - 5 * DAY_MS, now)).toBe('5 days ago')
    expect(describeAge(now - 21 * DAY_MS, now)).toBe('3 weeks ago')
    expect(describeAge(now - 90 * DAY_MS, now)).toBe('3 months ago')
  })
})
