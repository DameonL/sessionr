import type { RepertoireItem } from './api'
import { suggestNextPracticeTunes, type SuggestionCandidate } from './suggestions'
import { INSTRUMENTS } from '../components/instruments'
import { pickBandVoices, type BandVoice } from './band'

export type { BandVoice }

export interface SessionTune {
  userTuneId: string
  title: string
  tuneType: string
  key: string
  abc: string
  repetitions: number
}

export interface VirtualSessionSet {
  tunes: SessionTune[]
}

export interface VirtualSession {
  sets: VirtualSessionSet[]
  generatedAt: string
  /** [leader, ...3 backers], picked fresh per session so the same band plays the whole sitting. */
  bandVoices: BandVoice[]
}

const MIN_ACTIVE_TUNES = 2
const SETS_PER_SESSION = 3
const REPETITIONS_PER_TUNE = 3
/** Band size for a sitting: leader + this many backers. */
const BAND_SIZE = 4
/** How many top-scored candidates to randomize among, so repeated generations don't always pick the same tune. */
const TOP_CANDIDATE_POOL = 3

const BAND_INSTRUMENT_POOL = INSTRUMENTS.map((i) => i.value)

function pickRandom<T>(items: T[], randomFn: () => number): T {
  return items[Math.floor(randomFn() * items.length)]
}

function buildOneSet(
  pool: SuggestionCandidate[],
  repertoire: RepertoireItem[],
  randomFn: () => number,
): SessionTune[] | null {
  const size = pool.length >= 3 ? (randomFn() < 0.5 ? 2 : 3) : Math.min(2, pool.length)
  if (pool.length < 2 || size < 2) return null

  const draftIds: string[] = []
  let remainingPool = pool

  while (draftIds.length < size) {
    const suggestions = suggestNextPracticeTunes(draftIds, remainingPool, repertoire)
    if (suggestions.length === 0) break
    const pick = pickRandom(suggestions.slice(0, TOP_CANDIDATE_POOL), randomFn)
    draftIds.push(pick.userTuneId)
    remainingPool = remainingPool.filter((c) => c.userTuneId !== pick.userTuneId)
  }

  if (draftIds.length < 2) return null

  return draftIds.map((id) => {
    const item = repertoire.find((r) => r.userTuneId === id)!
    return {
      userTuneId: item.userTuneId,
      title: item.title,
      tuneType: item.tuneType,
      key: item.key,
      abc: item.abcText ?? item.abc ?? '',
      repetitions: REPETITIONS_PER_TUNE,
    }
  })
}

/**
 * Builds a virtual session: up to 3 non-overlapping sets of 2-3 tunes each,
 * drawn only from the caller's `Active`-status repertoire. Returns null if
 * there aren't enough Active tunes to build even one set.
 */
export function generateVirtualSession(
  repertoire: RepertoireItem[],
  randomFn: () => number = Math.random,
): VirtualSession | null {
  const activeRepertoire = repertoire.filter((r) => r.status.toLowerCase() === 'active')
  if (activeRepertoire.length < MIN_ACTIVE_TUNES) return null

  const candidates: SuggestionCandidate[] = activeRepertoire.map((r) => ({
    userTuneId: r.userTuneId,
    title: r.title,
    tuneType: r.tuneType,
    key: r.key,
    status: r.status,
  }))

  const sets: VirtualSessionSet[] = []
  let pool = candidates

  for (let i = 0; i < SETS_PER_SESSION; i++) {
    const tunes = buildOneSet(pool, activeRepertoire, randomFn)
    if (!tunes) break
    sets.push({ tunes })
    const usedIds = new Set(tunes.map((t) => t.userTuneId))
    pool = pool.filter((c) => !usedIds.has(c.userTuneId))
  }

  if (sets.length === 0) return null

  return { sets, generatedAt: new Date().toISOString(), bandVoices: pickBandVoices(BAND_INSTRUMENT_POOL, BAND_SIZE, randomFn) }
}
