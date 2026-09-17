import { describe, it, expect } from 'vitest'
import {
  availableSizes,
  generateQuestion,
  generateRound,
  intervalSizeLabel,
  scaleMidis,
  tonicMidiInScale,
  weightsFromHistory,
} from './intervalTraining'

/** Deterministic stand-in for Math.random: cycles through the given values. */
function seeded(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('scaleMidis', () => {
  it('builds D dorian with F and C natural', () => {
    const scale = scaleMidis('D', 'dor', 62, 86)
    // D4 E4 F4 G4 A4 B4 C5 D5 ...
    expect(scale?.slice(0, 8)).toEqual([62, 64, 65, 67, 69, 71, 72, 74])
  })

  it('applies the mode shift rather than assuming major', () => {
    const major = scaleMidis('D', 'maj', 62, 74)
    // D major sharpens F and C: F#4 = 66, C#5 = 73.
    expect(major).toEqual([62, 64, 66, 67, 69, 71, 73, 74])

    const mixolydian = scaleMidis('D', 'mix', 62, 74)
    // Mixolydian keeps F# but flattens the 7th back to C natural.
    expect(mixolydian).toEqual([62, 64, 66, 67, 69, 71, 72, 74])
  })

  it('handles a flat key', () => {
    const scale = scaleMidis('Bb', 'maj', 58, 70)
    // Bb3 C4 D4 Eb4 F4 G4 A4 Bb4
    expect(scale).toEqual([58, 60, 62, 63, 65, 67, 69, 70])
  })

  it('stays inside the requested range', () => {
    const scale = scaleMidis('G', 'maj', 67, 79) ?? []
    expect(scale.length).toBeGreaterThan(0)
    for (const midi of scale) {
      expect(midi).toBeGreaterThanOrEqual(67)
      expect(midi).toBeLessThanOrEqual(79)
    }
  })

  it('returns null for an unparseable key', () => {
    expect(scaleMidis('H', 'maj', 60, 72)).toBeNull()
  })
})

describe('availableSizes', () => {
  it('offers every size when the range spans an octave', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    expect(availableSizes(scale)).toEqual([2, 3, 4, 5, 6, 7, 8])
  })

  it('excludes sizes a narrow range cannot produce', () => {
    // D4..A4 is five scale notes: D E F G A — a 5th is the widest interval.
    const scale = scaleMidis('D', 'dor', 62, 69) ?? []
    expect(scale).toHaveLength(5)
    expect(availableSizes(scale)).toEqual([2, 3, 4, 5])
  })
})

describe('tonicMidiInScale', () => {
  it('finds the tonic by pitch class, not as the scale\'s first note', () => {
    // G3-D6 in D dorian starts on G3; the tonic is the D above it.
    const low = scaleMidis('D', 'dor', 55, 86) ?? []
    expect(low[0]).toBe(55)
    expect(tonicMidiInScale('D', 'dor', low)).toBe(62)
  })

  it('takes the lowest tonic when the range opens on one', () => {
    expect(tonicMidiInScale('D', 'dor', scaleMidis('D', 'dor', 62, 86) ?? [])).toBe(62)
  })

  it('follows the mode rather than the key signature\'s major', () => {
    // E phrygian carries G major's signature, but its home note is E.
    expect(tonicMidiInScale('E', 'phr', scaleMidis('E', 'phr', 60, 84) ?? [])).toBe(64)
  })

  it('is null for a key the parser does not recognise', () => {
    expect(tonicMidiInScale('H', 'maj', [62, 64])).toBeNull()
  })
})

describe('generateQuestion', () => {
  it('produces a rising pair when the direction draw is low', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    // Draws: size, then position, then direction.
    const q = generateQuestion(scale, seeded([0, 0, 0]))
    expect(q).toEqual({ rootMidi: 62, targetMidi: 64, direction: 'up', size: 2 })
  })

  it('produces a falling pair over the same notes when the direction draw is high', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    const q = generateQuestion(scale, seeded([0, 0, 0.9]))
    expect(q).toEqual({ rootMidi: 64, targetMidi: 62, direction: 'down', size: 2 })
  })

  it('never picks the excluded size when others are available', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    for (let i = 0; i < 20; i++) {
      const q = generateQuestion(scale, seeded([i / 20, 0.5]), { excludeSize: 3 })
      expect(q?.size).not.toBe(3)
    }
  })

  it('returns null for a scale too short for any interval', () => {
    expect(generateQuestion([62], seeded([0, 0]))).toBeNull()
  })

  it('draws only from the sizes the round selected', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    for (let i = 0; i < 20; i++) {
      const q = generateQuestion(scale, seeded([i / 20, 0.5]), { sizes: [3, 5] })
      expect([3, 5]).toContain(q?.size)
    }
  })

  it('keeps to a single selected size even when it is the excluded one', () => {
    // excludeSize empties the pool on every question after the first, and the
    // fallback must reopen the selection — not every size the scale allows.
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    for (let i = 0; i < 20; i++) {
      const q = generateQuestion(scale, seeded([i / 20, 0.5]), { sizes: [4], excludeSize: 4 })
      expect(q?.size).toBe(4)
    }
  })

  it('favours heavily weighted sizes without ever leaving the pool', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    const counts: Record<number, number> = { 2: 0, 6: 0 }
    for (let i = 0; i < 600; i++) {
      const q = generateQuestion(scale, Math.random, { sizes: [2, 6], weights: { 2: 3, 6: 1 } })
      counts[q!.size]++
    }
    expect(counts[2] + counts[6]).toBe(600)
    // 3:1 odds; a wide margin, so the test isn't flaky.
    expect(counts[2]).toBeGreaterThan(counts[6] * 2)
  })

  it('picks uniformly when every size weighs the same', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    const flat = { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 }
    for (let i = 0; i < 20; i++) {
      const draws = [i / 20, 0.5, 0.25]
      expect(generateQuestion(scale, seeded(draws), { weights: flat }))
        .toEqual(generateQuestion(scale, seeded(draws)))
    }
  })

  it('takes a fixed direction without spending a draw on it', () => {
    const scale = scaleMidis('D', 'dor', 62, 86) ?? []
    let draws = 0
    const counting = () => {
      draws++
      return 0
    }
    const q = generateQuestion(scale, counting, { directionMode: 'down' })
    expect(q).toEqual({ rootMidi: 64, targetMidi: 62, direction: 'down', size: 2 })
    // Size and position only — the direction is settled by the caller.
    expect(draws).toBe(2)
  })
})

describe('generateRound', () => {
  const config = { key: 'D', mode: 'dor', minMidi: 62, maxMidi: 86, questionCount: 10 }

  it('is deterministic for a given randomFn', () => {
    const seed = () => seeded([0.1, 0.9, 0.4, 0.2, 0.7, 0.55])
    expect(generateRound(config, seed())).toEqual(generateRound(config, seed()))
  })

  it('returns exactly questionCount questions inside the scale and range', () => {
    const scale = scaleMidis(config.key, config.mode, config.minMidi, config.maxMidi) ?? []
    const round = generateRound(config, seeded([0.1, 0.9, 0.4, 0.2, 0.7, 0.55]))
    expect(round).toHaveLength(10)
    for (const q of round) {
      expect(scale).toContain(q.rootMidi)
      expect(scale).toContain(q.targetMidi)
      const [low, high] = [Math.min(q.rootMidi, q.targetMidi), Math.max(q.rootMidi, q.targetMidi)]
      expect(q.direction === 'up' ? q.targetMidi > q.rootMidi : q.targetMidi < q.rootMidi).toBe(true)
      // The two notes sit exactly size - 1 scale steps apart, inside the range.
      expect(scale.indexOf(high) - scale.indexOf(low)).toBe(q.size - 1)
      expect(low).toBeGreaterThanOrEqual(config.minMidi)
      expect(high).toBeLessThanOrEqual(config.maxMidi)
    }
  })

  it('goes both up and down over a round', () => {
    const round = generateRound({ ...config, questionCount: 40 }, Math.random)
    const directions = new Set(round.map((q) => q.direction))
    expect(directions).toEqual(new Set(['up', 'down']))
  })

  it.each([
    ['up' as const, (q: { rootMidi: number; targetMidi: number }) => q.targetMidi > q.rootMidi],
    ['down' as const, (q: { rootMidi: number; targetMidi: number }) => q.targetMidi < q.rootMidi],
  ])('keeps every question going %s when the round is fixed that way', (directionMode, rises) => {
    const round = generateRound({ ...config, questionCount: 40, directionMode }, Math.random)
    expect(round).toHaveLength(40)
    for (const q of round) {
      expect(q.direction).toBe(directionMode)
      expect(rises(q)).toBe(true)
    }
  })

  it('never repeats a size back to back', () => {
    const round = generateRound({ ...config, questionCount: 40 }, Math.random)
    for (let i = 1; i < round.length; i++) {
      expect(round[i].size).not.toBe(round[i - 1].size)
    }
  })

  it('returns nothing for an unparseable key', () => {
    expect(generateRound({ ...config, key: 'H' })).toEqual([])
  })

  it('keeps a whole round inside the selected sizes', () => {
    const round = generateRound({ ...config, questionCount: 40, sizes: [3, 5] }, Math.random)
    expect(round).toHaveLength(40)
    expect(new Set(round.map((q) => q.size))).toEqual(new Set([3, 5]))
  })
})

describe('weightsFromHistory', () => {
  const sizes = [2, 3, 4]

  it('weighs a mastered size least and a missed one most', () => {
    const weights = weightsFromHistory(
      { 2: { asked: 10, correct: 10 }, 3: { asked: 10, correct: 0 } },
      sizes,
    )
    expect(weights[2]).toBe(1)
    expect(weights[3]).toBe(3)
  })

  it('treats an unproven size as middling', () => {
    // Absent entirely, and present but under MIN_SAMPLES, both land in the middle.
    const weights = weightsFromHistory({ 3: { asked: 2, correct: 0 } }, sizes)
    expect(weights[4]).toBe(2)
    expect(weights[3]).toBe(2)
  })

  it('gives every requested size a weight', () => {
    expect(Object.keys(weightsFromHistory({}, sizes))).toEqual(['2', '3', '4'])
  })
})

describe('intervalSizeLabel', () => {
  it('names the diatonic sizes', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map(intervalSizeLabel)).toEqual([
      '2nd', '3rd', '4th', '5th', '6th', '7th', 'octave',
    ])
  })
})
