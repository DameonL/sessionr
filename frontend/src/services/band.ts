import type abcjs from 'abcjs'

export interface BandVoice {
  role: 'leader' | 'backer'
  program: number
  pan: number
  /** Fixed per-instrument intonation quirk, in cents — not randomized per note. */
  centsOffset: number
}

/** How far backers are spread across the stereo field, as a fraction of full left/right. */
const MAX_PAN = 0.7
/** Small extra per-voice pan randomization on top of the even spread, so it doesn't look mechanically symmetric. */
const PAN_JITTER = 0.1
/** Fixed per-voice intonation quirk range, in cents either direction. */
const CENTS_OFFSET_RANGE = 4

/**
 * Picks a band of `count` voices — one leader plus `count - 1` backers — from
 * `pool` (a list of GM instrument program numbers). The leader is drawn from
 * the pool at random, same as backers — nobody is fixed to a specific
 * instrument. Backers are spread across the stereo field and each gets a
 * small fixed intonation quirk, same as a mixed group of real players never
 * being in perfect unison tuning.
 *
 * Backers never repeat the leader's instrument, and avoid repeating a backer
 * instrument already picked until the remaining pool is exhausted, then start
 * repeating (so a pool smaller than `count` still works, down to a 1-instrument
 * pool producing a leader with no backers).
 */
export function pickBandVoices(pool: number[], count: number, randomFn: () => number = Math.random): BandVoice[] {
  if (pool.length === 0 || count < 1) return []

  const leaderProgram = pool[Math.floor(randomFn() * pool.length)]
  const leader: BandVoice = { role: 'leader', program: leaderProgram, pan: 0, centsOffset: 0 }

  const backerPool = pool.filter((program) => program !== leaderProgram)
  const backerCount = backerPool.length === 0 ? 0 : Math.max(0, count - 1)
  const backers: BandVoice[] = []
  let remaining = [...backerPool]
  for (let i = 0; i < backerCount; i++) {
    if (remaining.length === 0) remaining = [...backerPool]
    const index = Math.floor(randomFn() * remaining.length)
    const [program] = remaining.splice(index, 1)
    const evenSpread = backerCount > 1 ? (i / (backerCount - 1)) * 2 - 1 : 0
    const pan = Math.max(-1, Math.min(1, evenSpread * MAX_PAN + (randomFn() * 2 - 1) * PAN_JITTER))
    const centsOffset = (randomFn() * 2 - 1) * CENTS_OFFSET_RANGE
    backers.push({ role: 'backer', program, pan, centsOffset })
  }

  return [leader, ...backers]
}

/** Per-note timing jitter for backers, in seconds — subtle, applied within every pass, not just at the entrance. */
const TIMING_JITTER_SEC = 0.02
/** Per-note volume jitter for backers, as a multiplier range around the notated velocity. */
const MIN_VOLUME_MULTIPLIER = 0.85
const MAX_VOLUME_MULTIPLIER = 1.15

/**
 * Mutates a backer's generated note sequence in place (abcjs ignores the
 * return value) so it doesn't sound like a perfectly quantized MIDI track:
 * a small random timing nudge and volume variation per note, plus this
 * backer's own fixed intonation quirk.
 */
export function humanizeBackerTracks(tracks: abcjs.NoteMapTrack[], voice: BandVoice, tempoMultiplierSec: number) {
  for (const track of tracks) {
    for (const note of track) {
      const jitter = ((Math.random() * 2 - 1) * TIMING_JITTER_SEC) / tempoMultiplierSec
      note.start = Math.max(0, note.start + jitter)
      note.end = Math.max(note.start + 0.001, note.end + jitter)
      note.volume = Math.max(1, Math.round(note.volume * (MIN_VOLUME_MULTIPLIER + Math.random() * (MAX_VOLUME_MULTIPLIER - MIN_VOLUME_MULTIPLIER))))
      if (voice.centsOffset) note.cents = (note.cents ?? 0) + voice.centsOffset
    }
  }
}

/** Backers start a touch after the leader, like independent live musicians — small humanized wall-clock offset in ms. */
const MIN_BACKER_OFFSET_MS = 10
const MAX_BACKER_OFFSET_MS = 35

export function backerStartOffsetMs(randomFn: () => number = Math.random): number {
  return MIN_BACKER_OFFSET_MS + randomFn() * (MAX_BACKER_OFFSET_MS - MIN_BACKER_OFFSET_MS)
}

/** Cancels every pending timeout id and returns the empty array to reassign to the ref. */
export function clearPendingTimeouts(ids: number[]): number[] {
  for (const id of ids) window.clearTimeout(id)
  return []
}
