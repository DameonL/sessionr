import { INSTRUMENTS } from '../components/instruments'

export type PlaybackMode = 'solo' | 'band'

export interface BandPrefs {
  mode: PlaybackMode
  /** Total band size (1 leader + count - 1 backers). */
  count: number
  /** GM program numbers eligible to be picked for the band. */
  eligiblePrograms: number[]
}

export const MIN_BAND_COUNT = 1
export const MAX_BAND_COUNT = 6

const BAND_PREFS_KEY = 'sessionapp.band-prefs'

const DEFAULT_BAND_PREFS: BandPrefs = {
  mode: 'solo',
  count: 3,
  eligiblePrograms: INSTRUMENTS.map((i) => i.value),
}

export function loadBandPrefs(): BandPrefs {
  try {
    const raw = localStorage.getItem(BAND_PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // A corrupted write or a future schema change could leave eligiblePrograms
      // as an empty (or non-array) value, or count out of range (or NaN, which
      // slips past a plain `< MIN` check) — fall back rather than let Band mode
      // silently have nothing to pick from, or a permanently-broken player count.
      const eligiblePrograms =
        Array.isArray(parsed.eligiblePrograms) && parsed.eligiblePrograms.length > 0
          ? parsed.eligiblePrograms
          : DEFAULT_BAND_PREFS.eligiblePrograms
      const count =
        Number.isFinite(parsed.count) && parsed.count >= MIN_BAND_COUNT && parsed.count <= MAX_BAND_COUNT
          ? parsed.count
          : DEFAULT_BAND_PREFS.count
      const mode: PlaybackMode = parsed.mode === 'band' ? 'band' : 'solo'
      return { ...DEFAULT_BAND_PREFS, ...parsed, eligiblePrograms, count, mode }
    }
  } catch {}
  return DEFAULT_BAND_PREFS
}

export function saveBandPrefs(prefs: BandPrefs): void {
  try {
    localStorage.setItem(BAND_PREFS_KEY, JSON.stringify(prefs))
  } catch {}
}
