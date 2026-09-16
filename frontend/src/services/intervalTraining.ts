import { LETTER_PITCHES, getDefaultAlteration, parseKeyDetails, parseKeySignature } from './abcTools'

/**
 * Material for the interval trainer: pairs of notes drawn from one key + mode,
 * so the sizes a player drills are the ones that actually occur in the tune
 * they'd play next. The key fixes each size's quality — a 3rd in D dorian is
 * always minor — which is why questions carry a diatonic size (2..8) and never
 * a m3/M3 style label.
 *
 * Intervals are melodic and go either way: the root sounds first, and the
 * target is above or below it at random.
 *
 * Randomness is injected (`randomFn`) so rounds are deterministic in tests,
 * matching pickBandVoices in ./band.ts.
 */

export type IntervalDirection = 'up' | 'down'

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

/**
 * One question, rising or falling at random, or null if the scale is too
 * short for any interval. Draws from randomFn in a fixed order — size, then
 * position, then direction — so seeded tests stay readable.
 */
export function generateQuestion(
  scale: number[],
  randomFn: () => number = Math.random,
  excludeSize?: number,
): IntervalQuestion | null {
  const sizes = availableSizes(scale).filter((s) => s !== excludeSize)
  const pool = sizes.length > 0 ? sizes : availableSizes(scale)
  if (pool.length === 0) return null

  const size = pool[Math.floor(randomFn() * pool.length)]
  const steps = size - 1
  const maxLowIndex = scale.length - 1 - steps
  const lowIndex = Math.floor(randomFn() * (maxLowIndex + 1))
  const low = scale[lowIndex]
  const high = scale[lowIndex + steps]
  const direction: IntervalDirection = randomFn() < 0.5 ? 'up' : 'down'

  return direction === 'up'
    ? { rootMidi: low, targetMidi: high, direction, size }
    : { rootMidi: high, targetMidi: low, direction, size }
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
    const q = generateQuestion(scale, randomFn, lastSize)
    if (!q) break
    questions.push(q)
    lastSize = q.size
  }
  return questions
}
