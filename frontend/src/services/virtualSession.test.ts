import { describe, it, expect } from 'vitest'
import { generateVirtualSession } from './virtualSession'
import type { RepertoireItem } from './api'

/** A deterministic stand-in for Math.random, so a generated session is reproducible. */
function seededRandom(seed = 1): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function item(overrides: Partial<RepertoireItem> & { userTuneId: string }): RepertoireItem {
  return {
    tuneId: `tune-${overrides.userTuneId}`,
    title: `Tune ${overrides.userTuneId}`,
    tuneType: 'Reel',
    key: 'D',
    status: 'Active',
    lastPracticed: null,
    targetBpm: 110,
    abcText: 'K:D\nDEFG|ABcd|',
    hasCustomAbc: false,
    ...overrides,
  }
}

function activeRepertoire(count: number): RepertoireItem[] {
  return Array.from({ length: count }, (_, i) => item({ userTuneId: `ut-${i}` }))
}

describe('generateVirtualSession', () => {
  it('returns null for an empty repertoire', () => {
    expect(generateVirtualSession([], seededRandom())).toBeNull()
  })

  it('returns null when there is only one Active tune', () => {
    expect(generateVirtualSession(activeRepertoire(1), seededRandom())).toBeNull()
  })

  it('returns null when nothing is at Active status', () => {
    const repertoire = [
      item({ userTuneId: 'a', status: 'Learning' }),
      item({ userTuneId: 'b', status: 'Rusty' }),
      item({ userTuneId: 'c', status: 'Wishlist' }),
      item({ userTuneId: 'd', status: 'Retired' }),
    ]

    expect(generateVirtualSession(repertoire, seededRandom())).toBeNull()
  })

  it('builds a session from just two Active tunes', () => {
    const session = generateVirtualSession(activeRepertoire(2), seededRandom())

    expect(session).not.toBeNull()
    expect(session!.sets).toHaveLength(1)
    expect(session!.sets[0].tunes).toHaveLength(2)
  })

  it('draws only from Active tunes', () => {
    const repertoire = [
      ...activeRepertoire(4),
      item({ userTuneId: 'learning', status: 'Learning' }),
      item({ userTuneId: 'rusty', status: 'Rusty' }),
    ]

    const session = generateVirtualSession(repertoire, seededRandom())!
    const used = session.sets.flatMap((s) => s.tunes.map((t) => t.userTuneId))

    expect(used).not.toContain('learning')
    expect(used).not.toContain('rusty')
  })

  it('matches Active case-insensitively', () => {
    const repertoire = [
      item({ userTuneId: 'a', status: 'ACTIVE' }),
      item({ userTuneId: 'b', status: 'active' }),
    ]

    expect(generateVirtualSession(repertoire, seededRandom())).not.toBeNull()
  })

  it('builds at most three sets', () => {
    const session = generateVirtualSession(activeRepertoire(30), seededRandom())!

    expect(session.sets.length).toBeLessThanOrEqual(3)
  })

  it('puts two or three tunes in every set', () => {
    const session = generateVirtualSession(activeRepertoire(20), seededRandom())!

    for (const set of session.sets) {
      expect(set.tunes.length).toBeGreaterThanOrEqual(2)
      expect(set.tunes.length).toBeLessThanOrEqual(3)
    }
  })

  it('never repeats a tune across the whole session', () => {
    const session = generateVirtualSession(activeRepertoire(20), seededRandom())!
    const used = session.sets.flatMap((s) => s.tunes.map((t) => t.userTuneId))

    expect(new Set(used).size).toBe(used.length)
  })

  it('carries each tune’s metadata and playable ABC', () => {
    const repertoire = [
      item({ userTuneId: 'a', title: "Cooley's", tuneType: 'Reel', key: 'Edor', abcText: 'K:Edor\nEBBA|' }),
      item({ userTuneId: 'b', title: 'Drowsy Maggie', tuneType: 'Reel', key: 'Edor' }),
    ]

    const tune = generateVirtualSession(repertoire, seededRandom())!.sets[0].tunes.find(
      (t) => t.userTuneId === 'a',
    )!

    expect(tune.title).toBe("Cooley's")
    expect(tune.tuneType).toBe('Reel')
    expect(tune.key).toBe('Edor')
    expect(tune.abc).toBe('K:Edor\nEBBA|')
  })

  it('falls back to the abc field when abcText is absent', () => {
    const repertoire = [
      item({ userTuneId: 'a', abcText: undefined, abc: 'K:G\nGABc|' }),
      item({ userTuneId: 'b' }),
    ]

    const tune = generateVirtualSession(repertoire, seededRandom())!.sets[0].tunes.find(
      (t) => t.userTuneId === 'a',
    )!

    expect(tune.abc).toBe('K:G\nGABc|')
  })

  it('never leaves a tune without an abc string', () => {
    const repertoire = [
      item({ userTuneId: 'a', abcText: undefined, abc: undefined }),
      item({ userTuneId: 'b', abcText: undefined, abc: undefined }),
    ]

    const session = generateVirtualSession(repertoire, seededRandom())!

    for (const tune of session.sets.flatMap((s) => s.tunes)) {
      expect(tune.abc).toBe('')
    }
  })

  it('gives every tune the same repetition count', () => {
    const session = generateVirtualSession(activeRepertoire(10), seededRandom())!

    for (const tune of session.sets.flatMap((s) => s.tunes)) {
      expect(tune.repetitions).toBe(3)
    }
  })

  it('picks one band that plays the whole sitting', () => {
    const session = generateVirtualSession(activeRepertoire(10), seededRandom())!

    expect(session.bandVoices.filter((v) => v.role === 'leader')).toHaveLength(1)
    expect(session.bandVoices).toHaveLength(4) // leader + 3 backers
  })

  it('stamps the session with a generation time', () => {
    const session = generateVirtualSession(activeRepertoire(6), seededRandom())!

    expect(Number.isNaN(Date.parse(session.generatedAt))).toBe(false)
  })

  it('is deterministic for a given random source', () => {
    const repertoire = activeRepertoire(12)

    const first = generateVirtualSession(repertoire, seededRandom(42))!
    const second = generateVirtualSession(repertoire, seededRandom(42))!

    expect(first.sets.map((s) => s.tunes.map((t) => t.userTuneId))).toEqual(
      second.sets.map((s) => s.tunes.map((t) => t.userTuneId)),
    )
  })

  it('varies with the random source, so repeat generations differ', () => {
    const repertoire = activeRepertoire(15)

    const runs = [1, 2, 3, 4, 5].map(
      (seed) =>
        JSON.stringify(generateVirtualSession(repertoire, seededRandom(seed))!.sets.map((s) =>
          s.tunes.map((t) => t.userTuneId),
        )),
    )

    expect(new Set(runs).size).toBeGreaterThan(1)
  })
})
