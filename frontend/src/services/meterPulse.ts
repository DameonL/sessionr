/**
 * Where the weight falls in a bar, for each meter.
 *
 * This is the one place that knows a reel leans on beats 1 and 3, that a jig is two dotted-quarter
 * groups rather than six even eighths, and that a waltz puts everything on the 1. Both the bodhrán
 * pattern and the melody's dynamic emphasis are built from it, so the drum and the tune cannot end
 * up disagreeing about where beat 1 is.
 *
 * Offsets are in whole notes — the same unit abcjs note maps use, so a note's position in the bar
 * compares directly against them. An eighth is 0.125, a 4/4 bar is 1.0, a 6/8 bar is 0.75.
 */

export type PulseStrength =
  /** The downbeat. */
  | 'strong'
  /** The other beat the meter leans on — 3 in a reel, the second group of a jig. */
  | 'medium'
  /** A counted beat that carries no particular weight — 2 and 4 in a reel. */
  | 'light'
  /** Between the beats. */
  | 'off'

export interface PulseBeat {
  /** Offset from the barline, in whole notes. */
  offsetWholeNotes: number
  strength: PulseStrength
}

export interface MeterPulse {
  barLengthWholeNotes: number
  /** Every eighth-note position in the bar, in order, so a caller can zip a voicing against it. */
  beats: PulseBeat[]
}

const EIGHTH = 0.125

/** Builds a bar of eighths, with the named offsets promoted above the surrounding off-beats. */
function pulse(
  barLengthWholeNotes: number,
  weighted: Partial<Record<PulseStrength, number[]>>,
): MeterPulse {
  const strengthAt = new Map<number, PulseStrength>()
  for (const [strength, offsets] of Object.entries(weighted)) {
    for (const offset of offsets ?? []) strengthAt.set(offset, strength as PulseStrength)
  }

  const beats: PulseBeat[] = []
  for (let offset = 0; offset < barLengthWholeNotes - 1e-9; offset += EIGHTH) {
    const rounded = Math.round(offset * 1000) / 1000
    beats.push({ offsetWholeNotes: rounded, strength: strengthAt.get(rounded) ?? 'off' })
  }
  return { barLengthWholeNotes, beats }
}

export function getMeterPulse(meter?: { num?: number; den?: number } | null): MeterPulse {
  const num = meter?.num ?? 4
  const den = meter?.den ?? 4

  // Slide: four dotted-quarter groups.
  if (num === 12 && den === 8) return pulse(1.5, { strong: [0], medium: [0.375, 0.75, 1.125] })

  // Slip jig: three groups of three.
  if (num === 9 && den === 8) return pulse(1.125, { strong: [0], medium: [0.375, 0.75] })

  // Double jig: two groups of three. The whole character of a jig is this pair.
  if (num === 6 && den === 8) return pulse(0.75, { strong: [0], medium: [0.375] })

  // Waltz and mazurka: the 1 carries it; 2 and 3 are merely counted.
  if (num === 3 && (den === 4 || den === 8)) return pulse(num / den, { strong: [0], light: [0.25, 0.5] })

  // Cut time: two half-note beats.
  if (num === 2 && den === 2) return pulse(1, { strong: [0], medium: [0.5] })

  // Polka and other 2/4: one strong beat and one answering it.
  if (num === 2 && den === 4) return pulse(0.5, { strong: [0], light: [0.25] })

  // Reel, hornpipe, march: 1 strongest, 3 next, 2 and 4 merely counted.
  if (num === 4 && den === 4) return pulse(1, { strong: [0], medium: [0.5], light: [0.25, 0.75] })

  // Anything irregular — 5/8, 7/8, 3/2 — gets a derived pulse rather than a guessed one: the
  // barline is strong and every counted beat is light. Beat length follows abcjs's own rule
  // (abc_tune.js getBeatLength), which groups 5/8 and 7/8 in twos and n/8 multiples of 3 in threes.
  const barLength = den ? num / den : 1
  const multiplier = num % 3 === 0 && den === 8 ? 3 : den === 8 && (num === 5 || num === 7) ? 2 : 1
  const beatLength = multiplier / (den || 4)
  const light: number[] = []
  for (let offset = beatLength; offset < barLength - 1e-9; offset += beatLength) {
    light.push(Math.round(offset * 1000) / 1000)
  }
  return pulse(barLength, { strong: [0], light })
}
