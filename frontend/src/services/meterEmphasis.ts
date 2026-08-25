import type abcjs from 'abcjs'
import type { MeterPulse, PulseStrength } from './meterPulse'

/**
 * Leans on the notes the meter leans on, so a reel sounds like a reel rather than a stream of even
 * eighths.
 *
 * Nothing else in the audio path does this. abcjs's own swing has its volume increase hard-coded to
 * zero, and swing.ts accents the first of each group of three — which is relative to the group, not
 * to the bar. So a tune plays back with flat dynamics and the meter is inaudible unless the bodhrán
 * is switched on.
 */

/** Volume multipliers at full strength; the slider scales how far each moves away from 1. */
const MULTIPLIER: Record<PulseStrength, number> = {
  strong: 1.25,
  medium: 1.12,
  light: 1.0,
  off: 0.85,
}

/**
 * Half a 32nd note. Wide enough to absorb the rounding abcjs applies to note starts
 * (create-note-map.js rounds to 6 decimal places, and swing shifts notes before we run), narrow
 * enough that a genuine off-beat is never mistaken for a beat.
 */
const MATCH_TOLERANCE = 0.01

/**
 * abcjs renders and caches one audio buffer per distinct
 * instrument/pitch/volume/duration/pan/tempo/cents combination, so every new volume value is
 * another buffer to build before playback can start. Snapping to a coarse grid keeps the number of
 * distinct velocities small, which keeps priming quick.
 */
const VOLUME_STEP = 4

/** abcjs omits volume on some events; its own default is 90. */
const DEFAULT_VOLUME = 90

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

/** The weight the meter gives this position in the bar. */
export function strengthAtPosition(pulse: MeterPulse, positionWholeNotes: number): PulseStrength {
  const bar = pulse.barLengthWholeNotes
  if (!(bar > 0)) return 'off'
  const position = mod(positionWholeNotes, bar)

  let best: PulseStrength = 'off'
  let bestDistance = MATCH_TOLERANCE
  for (const beat of pulse.beats) {
    // A position just before the barline belongs to the next bar's downbeat, not to nothing.
    const distance = Math.min(
      Math.abs(position - beat.offsetWholeNotes),
      Math.abs(position - beat.offsetWholeNotes - bar),
    )
    if (distance <= bestDistance) {
      bestDistance = distance
      best = beat.strength
    }
  }
  return best
}

/**
 * Scales note volumes by where each note falls in the bar. Mutates in place, because abcjs discards
 * whatever sequenceCallback returns.
 *
 * `pickupWholeNotes` shifts the grid so bar 1 starts after an anacrusis. Getting this wrong would
 * put every accent on the wrong note of any tune that starts mid-bar, which in this repertoire is
 * most of them.
 *
 * At 0% this leaves every volume exactly as it found it.
 */
export function applyMeterEmphasis(
  tracks: abcjs.NoteMapTrack[],
  pulse: MeterPulse,
  pickupWholeNotes: number,
  emphasisPercent: number,
): void {
  if (!(emphasisPercent > 0) || !(pulse.barLengthWholeNotes > 0)) return
  const amount = Math.min(100, emphasisPercent) / 100

  for (const track of tracks) {
    for (const note of track) {
      const strength = strengthAtPosition(pulse, note.start - pickupWholeNotes)
      const multiplier = 1 + (MULTIPLIER[strength] - 1) * amount
      const current = typeof note.volume === 'number' ? note.volume : DEFAULT_VOLUME
      const scaled = Math.round((current * multiplier) / VOLUME_STEP) * VOLUME_STEP
      note.volume = Math.min(127, Math.max(1, scaled))
    }
  }
}
