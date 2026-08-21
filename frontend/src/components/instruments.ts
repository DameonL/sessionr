import type abcjs from 'abcjs'

export interface Instruments {
  melody: number
  chords: number
  bass: number
}

/** Curated General MIDI programs that suit traditional music — covers the usual instruments that turn up at a folk session. */
export const INSTRUMENTS: { value: number; label: string }[] = [
  { value: 0, label: 'Piano' },
  { value: 15, label: 'Dulcimer' },
  { value: 21, label: 'Accordion' },
  { value: 22, label: 'Harmonica' },
  { value: 23, label: 'Concertina' },
  { value: 24, label: 'Guitar (nylon)' },
  { value: 25, label: 'Guitar (steel)' },
  { value: 32, label: 'Acoustic Bass' },
  { value: 40, label: 'Violin' },
  { value: 41, label: 'Viola' },
  { value: 42, label: 'Cello' },
  { value: 43, label: 'Double Bass (bowed)' },
  { value: 46, label: 'Harp' },
  { value: 68, label: 'Oboe' },
  { value: 71, label: 'Clarinet' },
  { value: 73, label: 'Flute' },
  { value: 75, label: 'Recorder' },
  { value: 78, label: 'Whistle' },
  { value: 105, label: 'Banjo' },
  { value: 109, label: 'Bagpipe' },
  { value: 110, label: 'Fiddle' },
]

export const DEFAULT_INSTRUMENTS: Instruments = { melody: 110, chords: 24, bass: 32 }

const STORAGE_KEY = 'sessionapp.midi-instruments'

export function loadInstruments(): Instruments {
  try {
    return { ...DEFAULT_INSTRUMENTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return DEFAULT_INSTRUMENTS
  }
}

export function saveInstruments(instruments: Instruments): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(instruments))
}

/** The nested options CreateSynth.init expects for instrument selection. */
export function synthInstrumentOptions(instruments: Instruments) {
  return {
    program: instruments.melody,
    chordprog: instruments.chords,
    bassprog: instruments.bass,
  }
}

/**
 * Returns true if the General MIDI program or instrument name corresponds to a plucked or strummed
 * instrument (e.g. guitars, banjo, dulcimer, acoustic bass, harp) where notes
 * longer than 1/8th should be played as repeated 1/8th note strokes.
 * Bowed strings (Fiddle, Violin, Cello) and sustained wind/reed instruments return false.
 */
export function shouldSubdivideInstrument(instrument: number | string): boolean {
  if (typeof instrument === 'number') {
    if (isNaN(instrument)) return false
    return (
      instrument === 15 || // Dulcimer / Santur
      (instrument >= 24 && instrument <= 31) || // Guitars
      (instrument >= 32 && instrument <= 39) || // Basses
      instrument === 45 || // Pizzicato Strings
      instrument === 46 || // Harp
      (instrument >= 104 && instrument <= 108) // Banjo, Sitar, Shamisen, Koto
    )
  }
  if (typeof instrument === 'string') {
    const lower = instrument.toLowerCase()
    return (
      lower.includes('guitar') ||
      lower.includes('banjo') ||
      lower.includes('dulcimer') ||
      lower.includes('harp') ||
      lower.includes('sitar') ||
      lower.includes('koto') ||
      (lower.includes('bass') && !lower.includes('double_bass') && !lower.includes('contrabass'))
    )
  }
  return false
}

/** Also defined in services/swing.ts, which gates the jig lilt on the same note value. */
const EIGHTH_NOTE_DURATION = 0.125

/**
 * How generously a duration is counted as a whole number of eighths. A note has to be
 * worth ~1.75 eighths before it re-strikes at all, so a swing-lengthened eighth (1.35
 * eighths) and a dotted eighth (1.5) each stay a single strike.
 */
const SPLIT_TOLERANCE = 0.25

/**
 * Re-strikes long notes as repeated eighths, so plucked/decaying instruments don't fade
 * to silence part-way through. A note worth two or more eighths is divided into that many
 * *equal* parts; anything shorter is left alone.
 *
 * Equal division matters: chopping at fixed 0.125 boundaries (as this once did) leaves the
 * remainder as its own note, so a swung eighth became 0.125 + 0.04375 and a dotted eighth
 * became 0.125 + 0.0625 — an audible double strike on every lilted note in a jig.
 *
 * Rewrites the track in place and returns nothing: abcjs's sequenceCallback discards
 * whatever the callback returns and goes on using its own noteMapTracks (see
 * create-synth.js, "prime"), so a version of this that returned a new array — as this
 * once did — was a silent no-op. Same contract as humanizeBackerTracks in services/band.ts.
 */
export function subdivideLongNotes(track: abcjs.NoteMapTrack): void {
  const newTrack: abcjs.NoteMapTrack = []
  for (const note of track) {
    const duration = note.end - note.start
    const parts = Math.floor(duration / EIGHTH_NOTE_DURATION + SPLIT_TOLERANCE)
    if (parts >= 2) {
      const step = duration / parts
      for (let i = 0; i < parts; i++) {
        newTrack.push({
          ...note,
          start: note.start + i * step,
          // Land the last part exactly on the original end rather than on accumulated float.
          end: i === parts - 1 ? note.end : note.start + (i + 1) * step,
        })
      }
    } else {
      newTrack.push(note)
    }
  }
  // Splice-with-spread would risk an argument-count ceiling on a long track; push instead.
  track.length = 0
  for (const note of newTrack) track.push(note)
}

