import { LETTER_PITCHES, getDefaultAlteration, parseKeyDetails, parseKeySignature } from './abcTools'

/**
 * Material for the interval trainer: pairs of notes drawn from one key + mode,
 * so the sizes a player drills are the ones that actually occur in the tune
 * they'd play next. The key fixes each size's quality — a 3rd in D dorian is
 * always minor — which is why questions carry a diatonic size (2..8) and never
 * a m3/M3 style label.
 *
 * Intervals are melodic: the root sounds first, and the target follows above
 * or below it. Which way is a round setting — ascending, descending, or drawn
 * at random per question.
 *
 * Randomness is injected (`randomFn`) so rounds are deterministic in tests,
 * matching pickBandVoices in ./band.ts.
 */

export type IntervalDirection = 'up' | 'down'

/** Which way a round's intervals run. 'mixed' draws per question. */
export type DirectionMode = IntervalDirection | 'mixed'

export interface IntervalQuestion {
  /** The note sounded first. Above the target when the interval descends. */
  rootMidi: number
  /** The note sounded second. */
  targetMidi: number
  direction: IntervalDirection
  /** Diatonic size: 2 = 2nd, 3 = 3rd, ... 8 = octave. */
  size: number
}

export interface RoundConfig {
  /** Key root as written in a K: field — 'D', 'Bb', 'F#'. */
  key: string
  /** Mode suffix understood by parseKeySignature — 'maj', 'min', 'dor', 'mix', ... */
  mode: string
  minMidi: number
  maxMidi: number
  questionCount: number
  directionMode?: DirectionMode
  /** Limit the round to these sizes; omitted or empty means every size the scale allows. */
  sizes?: number[]
  /** Relative draw weight per size, as weightsFromHistory builds them. */
  weights?: Record<number, number>
}

/** The smallest and largest diatonic sizes a question can use. */
const MIN_SIZE = 2
const MAX_SIZE = 8

const SIZE_LABELS: Record<number, string> = {
  2: '2nd',
  3: '3rd',
  4: '4th',
  5: '5th',
  6: '6th',
  7: '7th',
  8: 'octave',
}

/** '2nd' … '7th', or 'octave' for 8. */
export function intervalSizeLabel(size: number): string {
  return SIZE_LABELS[size] ?? `${size}th`
}

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b']

/**
 * Every pitch of the key's scale between minMidi and maxMidi, ascending.
 *
 * The scale's pitch classes come from the key signature rather than a mode
 * table of its own: parseKeySignature already folds the mode shift into a
 * sharps count, and getDefaultAlteration turns that into each letter's
 * accidental. Null for a key root the parser doesn't recognise.
 */
export function scaleMidis(key: string, mode: string, minMidi: number, maxMidi: number): number[] | null {
  const details = parseKeyDetails(key + mode)
  if (!details) return null
  const sig = parseKeySignature(key + mode)
  if (!sig) return null

  // Letters of the scale in order from the root, so the Nth entry is the Nth degree.
  const rootLetterIndex = LETTERS.indexOf(details.root[0].toLowerCase())
  if (rootLetterIndex === -1) return null

  const degreePitchClasses: number[] = []
  for (let d = 0; d < 7; d++) {
    const letter = LETTERS[(rootLetterIndex + d) % 7]
    const pc = LETTER_PITCHES[letter] + getDefaultAlteration(letter, sig.sharps)
    degreePitchClasses.push(((pc % 12) + 12) % 12)
  }

  const out: number[] = []
  // Walk degrees upward from an octave safely below the range until past the top.
  const rootPc = degreePitchClasses[0]
  let midi = rootPc
  while (midi < minMidi - 12) midi += 12
  let degree = 0
  while (midi <= maxMidi) {
    if (midi >= minMidi) out.push(midi)
    const next = degreePitchClasses[(degree + 1) % 7]
    // Ascending step: 1..11 semitones to the next degree's pitch class.
    const step = (((next - degreePitchClasses[degree % 7]) % 12) + 12) % 12 || 12
    midi += step
    degree++
  }
  return out
}

/**
 * The mode's home pitch class, or null for a key root the parser doesn't
 * recognise.
 */
function tonicPitchClass(key: string, mode: string): number | null {
  const details = parseKeyDetails(key + mode)
  const sig = parseKeySignature(key + mode)
  if (!details || !sig) return null
  const letter = details.root[0].toLowerCase()
  if (LETTER_PITCHES[letter] === undefined) return null
  const pc = LETTER_PITCHES[letter] + getDefaultAlteration(letter, sig.sharps)
  return ((pc % 12) + 12) % 12
}

/**
 * The tonic as a playable note: the lowest scale member with the mode's home
 * pitch class, so a reference note stays put between questions. Not scale[0] —
 * scaleMidis keeps only what falls inside the range, so a low bound (G3 in key
 * D) makes the first entry a note other than the tonic.
 */
export function tonicMidiInScale(key: string, mode: string, scale: number[]): number | null {
  const pc = tonicPitchClass(key, mode)
  if (pc === null) return null
  return scale.find((midi) => midi % 12 === pc) ?? null
}

/**
 * The sizes this scale can actually produce, so the Name-it buttons never
 * offer an answer the range can't generate.
 */
export function availableSizes(scale: number[]): number[] {
  const sizes: number[] = []
  for (let size = MIN_SIZE; size <= MAX_SIZE; size++) {
    if (scale.length > size - 1) sizes.push(size)
  }
  return sizes
}

export interface QuestionOptions {
  /** Size to avoid, so a round doesn't ask the same one twice running. */
  excludeSize?: number
  directionMode?: DirectionMode
  /** Sizes the round is limited to; intersected with what the scale allows. */
  sizes?: number[]
  /** Relative draw weight per size. Missing entries count as 1. */
  weights?: Record<number, number>
}

/** Picks from pool with the given relative weights; uniform when none apply. */
function pickWeighted(pool: number[], weights: Record<number, number> | undefined, draw: number): number {
  if (!weights) return pool[Math.floor(draw * pool.length)]
  const total = pool.reduce((sum, size) => sum + (weights[size] ?? 1), 0)
  let remaining = draw * total
  for (const size of pool) {
    remaining -= weights[size] ?? 1
    if (remaining < 0) return size
  }
  return pool[pool.length - 1]
}

/**
 * One question, or null if the scale is too short for any interval. Draws from
 * randomFn in a fixed order — size, then position, then direction — so seeded
 * tests stay readable. A fixed directionMode skips the direction draw entirely,
 * which leaves those seeded draws meaning what they did before this setting.
 */
export function generateQuestion(
  scale: number[],
  randomFn: () => number = Math.random,
  opts: QuestionOptions = {},
): IntervalQuestion | null {
  const allowed = availableSizes(scale).filter((s) => !opts.sizes?.length || opts.sizes.includes(s))
  const withoutLast = allowed.filter((s) => s !== opts.excludeSize)
  // Falling back to `allowed` and never to every size matters: a round limited
  // to one size empties withoutLast on every question after the first.
  const pool = withoutLast.length > 0 ? withoutLast : allowed
  if (pool.length === 0) return null

  const size = pickWeighted(pool, opts.weights, randomFn())
  const steps = size - 1
  const maxLowIndex = scale.length - 1 - steps
  const lowIndex = Math.floor(randomFn() * (maxLowIndex + 1))
  const low = scale[lowIndex]
  const high = scale[lowIndex + steps]
  const directionMode = opts.directionMode ?? 'mixed'
  const direction: IntervalDirection =
    directionMode === 'mixed' ? (randomFn() < 0.5 ? 'up' : 'down') : directionMode

  return direction === 'up'
    ? { rootMidi: low, targetMidi: high, direction, size }
    : { rootMidi: high, targetMidi: low, direction, size }
}

export interface SizeStat {
  asked: number
  correct: number
}

/** Lifetime record per diatonic size, kept across rounds. */
export type IntervalHistory = Record<number, SizeStat>

/**
 * Steepness of the weighting curve, as the exponent on a size's miss rate: a
 * size always missed is drawn e^WEAK_BIAS — about 20 times — as often as one
 * always got right.
 *
 * It is an exponent rather than a multiplier because the obvious linear form,
 * 1 + k(1 - accuracy), cannot tilt a round far enough to be felt: the constant
 * dominates, so a player at 8% on one size and 69% on another still saw the two
 * in almost the same proportion. Real records also cluster well short of the
 * ends — nobody is at 0% and 100% — and a curve only spreads them apart where
 * it is steep.
 */
const WEAK_BIAS = 3
/** Answers before a size's record is trusted rather than treated as unproven. */
const MIN_SAMPLES = 4

/**
 * Relative draw weights from a player's record: 1 for a size they always get,
 * rising to e^WEAK_BIAS for one they always miss. A size with too few answers
 * to judge counts as half right, so it comes up more often than a mastered one
 * without crowding out the sizes actually known to be weak.
 */
export function weightsFromHistory(history: IntervalHistory, sizes: number[]): Record<number, number> {
  const weights: Record<number, number> = {}
  for (const size of sizes) {
    const stat = history[size]
    const accuracy = !stat || stat.asked < MIN_SAMPLES ? 0.5 : stat.correct / stat.asked
    weights[size] = Math.exp(WEAK_BIAS * (1 - accuracy))
  }
  return weights
}

/** A round's worth of questions, never repeating a size back to back. */
export function generateRound(
  config: RoundConfig,
  randomFn: () => number = Math.random,
): IntervalQuestion[] {
  const scale = scaleMidis(config.key, config.mode, config.minMidi, config.maxMidi)
  if (!scale) return []

  const questions: IntervalQuestion[] = []
  let lastSize: number | undefined
  for (let i = 0; i < config.questionCount; i++) {
    const q = generateQuestion(scale, randomFn, {
      excludeSize: lastSize,
      directionMode: config.directionMode,
      sizes: config.sizes,
      weights: config.weights,
    })
    if (!q) break
    questions.push(q)
    lastSize = q.size
  }
  return questions
}
