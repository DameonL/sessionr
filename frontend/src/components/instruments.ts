export interface Instruments {
  melody: number
  chords: number
  bass: number
}

/** Curated General MIDI programs that suit traditional music. */
export const INSTRUMENTS: { value: number; label: string }[] = [
  { value: 0, label: 'Piano' },
  { value: 15, label: 'Dulcimer' },
  { value: 21, label: 'Accordion' },
  { value: 22, label: 'Harmonica' },
  { value: 24, label: 'Guitar (nylon)' },
  { value: 25, label: 'Guitar (steel)' },
  { value: 32, label: 'Acoustic Bass' },
  { value: 40, label: 'Violin' },
  { value: 42, label: 'Cello' },
  { value: 46, label: 'Harp' },
  { value: 73, label: 'Flute' },
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
