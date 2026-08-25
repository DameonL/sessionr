import { extractKeyFromAbc, parseKeySignature } from './abcTools'

/**
 * Names a pitch the way the tune spells it, for showing the reader what note they just clicked.
 *
 * The same key on the keyboard is Bb in F major and A# in B major, and picking the wrong one is
 * actively confusing when the point is to connect a note on the page to a name. So the spelling
 * follows the key signature: flat keys get flats, everything else gets sharps.
 *
 * Deliberately not midiToNoteName() from pitchDetector.ts — that one is sharps-only and always
 * appends an octave, which is the right shape for the ear trainer's readout and the wrong one here.
 */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/**
 * True when the tune's key signature is written with flats, so its accidentals should read as Bb
 * rather than A#. Falls back to sharps for a tune with no readable K: field.
 */
export function prefersFlats(abc: string): boolean {
  const key = extractKeyFromAbc(abc)
  if (!key) return false
  return (parseKeySignature(key)?.sharps ?? 0) < 0
}

/** The pitch class of a MIDI note — "F#", "Bb", "A". No octave. */
export function spellMidiNote(midi: number, useFlats: boolean): string {
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES
  return names[((Math.round(midi) % 12) + 12) % 12]
}

/** A chord's worth of pitches, low to high, as "A/C#/E". Duplicated octaves are named once. */
export function spellMidiNotes(midis: number[], useFlats: boolean): string {
  const seen = new Set<string>()
  const names: string[] = []
  for (const midi of [...midis].sort((a, b) => a - b)) {
    const name = spellMidiNote(midi, useFlats)
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.join('/')
}
