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
 * Returns true if the General MIDI program corresponds to a plucked or strummed
 * instrument (e.g. guitars, banjo, dulcimer, acoustic bass, harp) where notes
 * longer than 1/8th should be played as repeated 1/8th note strokes.
 * Bowed strings (Fiddle, Violin, Cello) and sustained wind/reed instruments return false.
 */
export function shouldSubdivideInstrument(program: number): boolean {
  if (typeof program !== 'number' || isNaN(program)) return false
  return (
    program === 15 || // Dulcimer / Santur
    (program >= 24 && program <= 31) || // Guitars
    (program >= 32 && program <= 39) || // Basses
    program === 45 || // Pizzicato Strings
    program === 46 || // Harp
    (program >= 104 && program <= 108) // Banjo, Sitar, Shamisen, Koto
  )
}

const EIGHTH_NOTE_DURATION = 0.125
const EPSILON = 0.0001

/**
 * Subdivides any notes in a sequence track that are strictly longer than 1/8th note
 * (duration > 0.125 whole notes) into consecutive 1/8th notes that add up to the
 * original note duration.
 */
export function subdivideLongNotes(track: abcjs.NoteMapTrack): abcjs.NoteMapTrack {
  const newTrack: abcjs.NoteMapTrack = []
  for (const note of track) {
    const duration = note.end - note.start
    if (duration > EIGHTH_NOTE_DURATION + EPSILON) {
      let currentStart = note.start
      while (currentStart < note.end - EPSILON) {
        const currentEnd = Math.min(currentStart + EIGHTH_NOTE_DURATION, note.end)
        newTrack.push({
          ...note,
          start: currentStart,
          end: currentEnd,
        })
        currentStart = currentEnd
      }
    } else {
      newTrack.push(note)
    }
  }
  return newTrack
}

