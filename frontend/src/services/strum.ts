import type abcjs from 'abcjs'
import { shouldSubdivideInstrument } from '../components/instruments'

/**
 * Total wall-clock spread across a whole voicing, in seconds. A physical strum takes about
 * this long whatever the tempo, so it is held fixed and converted into note units per tune
 * rather than expressed as a fraction of the beat. At 25ms that is roughly 14% of an eighth
 * on a fast jig and 5% on an air — heard as a roll, never as a late chord.
 */
const STRUM_SPREAD_SEC = 0.025

/** Fraction of variation either side of the spread, so repeated chords aren't carbon copies. */
const SPREAD_JITTER = 0.25

/**
 * Ceiling on the roll as a fraction of the shortest note in the chord. Without it a 25ms
 * strum would swallow the short re-strikes subdivideLongNotes produces at fast tempos.
 */
const MAX_SPREAD_FRACTION = 0.4

/** The first note struck is this much quieter than the last, ramped across the strike order. */
const LEAD_VOLUME_MULTIPLIER = 0.9

/**
 * Spreads simultaneous notes into a strum, alternating downstroke (low to high) and upstroke
 * (high to low) between chords the way a player's hand actually moves.
 *
 * abcjs writes every tone of a chord at an identical start (ChordTrack.writeNote is called once
 * per pitch with the same beat), which is why an unstrummed chord lands as one block. Notes are
 * grouped by that shared start rather than by track: the chord track interleaves bass and chord
 * notes carrying their own instrument names, and grouping also picks up ABC chords like [CEG] in
 * the melody. A group of one has nothing to spread, so bass lines and single-note melodies fall
 * through untouched.
 *
 * Only plucked/strummed instruments strum — the same set subdivideLongNotes re-strikes, so the
 * membership test is shared rather than duplicated.
 *
 * Mutates the track in place and returns nothing: abcjs's sequenceCallback discards whatever the
 * callback returns and goes on using its own noteMapTracks. Same contract as
 * applyCustomTripletSwing, subdivideLongNotes and humanizeBackerTracks.
 *
 * @param tempoMultiplierSec Seconds per whole note — converts STRUM_SPREAD_SEC into the units
 *   note starts are expressed in. Same conversion humanizeBackerTracks uses for its jitter.
 */
export function strumChords(
  track: abcjs.NoteMapTrack,
  tempoMultiplierSec: number,
  randomFn: () => number = Math.random,
): void {
  if (track.length === 0 || !(tempoMultiplierSec > 0)) return

  const groups = new Map<number, typeof track>()
  for (const note of track) {
    const group = groups.get(note.start)
    if (group) group.push(note)
    else groups.set(note.start, [note])
  }

  let downstroke = true
  for (const start of Array.from(groups.keys()).sort((a, b) => a - b)) {
    const group = groups.get(start)!
    if (group.length < 2) continue
    if (!group.every((note) => shouldSubdivideInstrument(note.instrument))) continue

    const shortest = Math.min(...group.map((note) => note.end - note.start))
    const jittered = STRUM_SPREAD_SEC * (1 + (randomFn() * 2 - 1) * SPREAD_JITTER)
    const spread = Math.min(jittered / tempoMultiplierSec, shortest * MAX_SPREAD_FRACTION)

    const order = [...group].sort((a, b) => a.pitch - b.pitch)
    if (!downstroke) order.reverse()

    const lastIndex = order.length - 1
    order.forEach((note, i) => {
      const progress = i / lastIndex
      note.start += spread * progress
      const ramp = LEAD_VOLUME_MULTIPLIER + (1 - LEAD_VOLUME_MULTIPLIER) * progress
      const currentVol = typeof note.volume === 'number' ? note.volume : 90
      note.volume = Math.min(127, Math.max(1, Math.round(currentVol * ramp)))
    })

    downstroke = !downstroke
  }
}
