import abcjs from 'abcjs'

/**
 * A single selectable metronome sound.
 *
 * Percussion sounds (instrument === 128) use MIDI channel 10; `pitch` selects
 * the drum kit voice. Melodic sounds use a standard GM instrument number and
 * a fixed `pitch` (C5 = 72) so the click has a consistent, neutral tone.
 */
export interface MetronomeSound {
  key: string
  label: string
  instrument: number // 128 = GM percussion channel 10; 0-127 = melodic
  pitch: number
  duration: number   // seconds
}

/** Beat/drum percussion sounds — listed first in the picker. */
export const BEAT_SOUNDS: MetronomeSound[] = [
  { key: 'p-42',  label: '🥁 Closed Hi-Hat',     instrument: 128, pitch: 42, duration: 0.05 },
  { key: 'p-36',  label: '🥁 Bass Drum',          instrument: 128, pitch: 36, duration: 0.05 },
  { key: 'p-37',  label: '🥁 Side Stick',         instrument: 128, pitch: 37, duration: 0.05 },
  { key: 'p-38',  label: '🥁 Snare',              instrument: 128, pitch: 38, duration: 0.05 },
  { key: 'p-39',  label: '🥁 Hand Clap',          instrument: 128, pitch: 39, duration: 0.05 },
  { key: 'p-56',  label: '🐄 Cowbell',            instrument: 128, pitch: 56, duration: 0.05 },
  { key: 'p-75',  label: '🪵 Claves',             instrument: 128, pitch: 75, duration: 0.05 },
  { key: 'p-76',  label: '🪵 Hi Wood Block',      instrument: 128, pitch: 76, duration: 0.05 },
  { key: 'p-77',  label: '🪵 Lo Wood Block',      instrument: 128, pitch: 77, duration: 0.05 },
  { key: 'p-54',  label: '🔔 Tambourine',         instrument: 128, pitch: 54, duration: 0.05 },
  { key: 'p-80',  label: '🔔 Mute Triangle',      instrument: 128, pitch: 80, duration: 0.05 },
  { key: 'p-81',  label: '🔔 Open Triangle',      instrument: 128, pitch: 81, duration: 0.05 },
]

/** Remaining GM percussion sounds. */
export const OTHER_PERCUSSION_SOUNDS: MetronomeSound[] = [
  { key: 'p-35',  label: 'Acoustic Bass Drum',    instrument: 128, pitch: 35, duration: 0.05 },
  { key: 'p-40',  label: 'Electric Snare',        instrument: 128, pitch: 40, duration: 0.05 },
  { key: 'p-41',  label: 'Low Floor Tom',         instrument: 128, pitch: 41, duration: 0.05 },
  { key: 'p-43',  label: 'High Floor Tom',        instrument: 128, pitch: 43, duration: 0.05 },
  { key: 'p-44',  label: 'Pedal Hi-Hat',          instrument: 128, pitch: 44, duration: 0.05 },
  { key: 'p-45',  label: 'Low Tom',               instrument: 128, pitch: 45, duration: 0.05 },
  { key: 'p-46',  label: 'Open Hi-Hat',           instrument: 128, pitch: 46, duration: 0.05 },
  { key: 'p-47',  label: 'Low-Mid Tom',           instrument: 128, pitch: 47, duration: 0.05 },
  { key: 'p-48',  label: 'Hi-Mid Tom',            instrument: 128, pitch: 48, duration: 0.05 },
  { key: 'p-49',  label: 'Crash Cymbal 1',        instrument: 128, pitch: 49, duration: 0.05 },
  { key: 'p-50',  label: 'High Tom',              instrument: 128, pitch: 50, duration: 0.05 },
  { key: 'p-51',  label: 'Ride Cymbal 1',         instrument: 128, pitch: 51, duration: 0.05 },
  { key: 'p-52',  label: 'Chinese Cymbal',        instrument: 128, pitch: 52, duration: 0.05 },
  { key: 'p-53',  label: 'Ride Bell',             instrument: 128, pitch: 53, duration: 0.05 },
  { key: 'p-55',  label: 'Splash Cymbal',         instrument: 128, pitch: 55, duration: 0.05 },
  { key: 'p-57',  label: 'Crash Cymbal 2',        instrument: 128, pitch: 57, duration: 0.05 },
  { key: 'p-58',  label: 'Vibraslap',             instrument: 128, pitch: 58, duration: 0.05 },
  { key: 'p-59',  label: 'Ride Cymbal 2',         instrument: 128, pitch: 59, duration: 0.05 },
  { key: 'p-60',  label: 'Hi Bongo',              instrument: 128, pitch: 60, duration: 0.05 },
  { key: 'p-61',  label: 'Low Bongo',             instrument: 128, pitch: 61, duration: 0.05 },
  { key: 'p-62',  label: 'Mute Hi Conga',         instrument: 128, pitch: 62, duration: 0.05 },
  { key: 'p-63',  label: 'Open Hi Conga',         instrument: 128, pitch: 63, duration: 0.05 },
  { key: 'p-64',  label: 'Low Conga',             instrument: 128, pitch: 64, duration: 0.05 },
  { key: 'p-65',  label: 'High Timbale',          instrument: 128, pitch: 65, duration: 0.05 },
  { key: 'p-66',  label: 'Low Timbale',           instrument: 128, pitch: 66, duration: 0.05 },
  { key: 'p-67',  label: 'High Agogo',            instrument: 128, pitch: 67, duration: 0.05 },
  { key: 'p-68',  label: 'Low Agogo',             instrument: 128, pitch: 68, duration: 0.05 },
  { key: 'p-69',  label: 'Cabasa',                instrument: 128, pitch: 69, duration: 0.05 },
  { key: 'p-70',  label: 'Maracas',               instrument: 128, pitch: 70, duration: 0.05 },
  { key: 'p-71',  label: 'Short Whistle',         instrument: 128, pitch: 71, duration: 0.05 },
  { key: 'p-72',  label: 'Long Whistle',          instrument: 128, pitch: 72, duration: 0.05 },
  { key: 'p-73',  label: 'Short Guiro',           instrument: 128, pitch: 73, duration: 0.05 },
  { key: 'p-74',  label: 'Long Guiro',            instrument: 128, pitch: 74, duration: 0.05 },
  { key: 'p-78',  label: 'Mute Cuica',            instrument: 128, pitch: 78, duration: 0.05 },
  { key: 'p-79',  label: 'Open Cuica',            instrument: 128, pitch: 79, duration: 0.05 },
]

/** All 128 General MIDI melodic instruments, playing C5 (pitch 72). */
export const MELODIC_SOUNDS: MetronomeSound[] = [
  // Piano
  { key: 'm-0',   label: 'Acoustic Grand Piano',  instrument: 0,   pitch: 72, duration: 0.15 },
  { key: 'm-1',   label: 'Bright Acoustic Piano', instrument: 1,   pitch: 72, duration: 0.15 },
  { key: 'm-2',   label: 'Electric Grand Piano',  instrument: 2,   pitch: 72, duration: 0.15 },
  { key: 'm-3',   label: 'Honky-tonk Piano',      instrument: 3,   pitch: 72, duration: 0.15 },
  { key: 'm-4',   label: 'Electric Piano 1',      instrument: 4,   pitch: 72, duration: 0.15 },
  { key: 'm-5',   label: 'Electric Piano 2',      instrument: 5,   pitch: 72, duration: 0.15 },
  { key: 'm-6',   label: 'Harpsichord',           instrument: 6,   pitch: 72, duration: 0.15 },
  { key: 'm-7',   label: 'Clavinet',              instrument: 7,   pitch: 72, duration: 0.15 },
  // Chromatic Perc
  { key: 'm-8',   label: 'Celesta',               instrument: 8,   pitch: 72, duration: 0.15 },
  { key: 'm-9',   label: 'Glockenspiel',          instrument: 9,   pitch: 72, duration: 0.15 },
  { key: 'm-10',  label: 'Music Box',             instrument: 10,  pitch: 72, duration: 0.15 },
  { key: 'm-11',  label: 'Vibraphone',            instrument: 11,  pitch: 72, duration: 0.15 },
  { key: 'm-12',  label: 'Marimba',               instrument: 12,  pitch: 72, duration: 0.15 },
  { key: 'm-13',  label: 'Xylophone',             instrument: 13,  pitch: 72, duration: 0.15 },
  { key: 'm-14',  label: 'Tubular Bells',         instrument: 14,  pitch: 72, duration: 0.15 },
  { key: 'm-15',  label: 'Dulcimer',              instrument: 15,  pitch: 72, duration: 0.15 },
  // Organ
  { key: 'm-16',  label: 'Drawbar Organ',         instrument: 16,  pitch: 72, duration: 0.15 },
  { key: 'm-17',  label: 'Percussive Organ',      instrument: 17,  pitch: 72, duration: 0.15 },
  { key: 'm-18',  label: 'Rock Organ',            instrument: 18,  pitch: 72, duration: 0.15 },
  { key: 'm-19',  label: 'Church Organ',          instrument: 19,  pitch: 72, duration: 0.15 },
  { key: 'm-20',  label: 'Reed Organ',            instrument: 20,  pitch: 72, duration: 0.15 },
  { key: 'm-21',  label: 'Accordion',             instrument: 21,  pitch: 72, duration: 0.15 },
  { key: 'm-22',  label: 'Harmonica',             instrument: 22,  pitch: 72, duration: 0.15 },
  { key: 'm-23',  label: 'Tango Accordion',       instrument: 23,  pitch: 72, duration: 0.15 },
  // Guitar
  { key: 'm-24',  label: 'Nylon Guitar',          instrument: 24,  pitch: 64, duration: 0.15 },
  { key: 'm-25',  label: 'Steel Guitar',          instrument: 25,  pitch: 64, duration: 0.15 },
  { key: 'm-26',  label: 'Jazz Guitar',           instrument: 26,  pitch: 64, duration: 0.15 },
  { key: 'm-27',  label: 'Clean Guitar',          instrument: 27,  pitch: 64, duration: 0.15 },
  { key: 'm-28',  label: 'Muted Guitar',          instrument: 28,  pitch: 64, duration: 0.10 },
  { key: 'm-29',  label: 'Overdriven Guitar',     instrument: 29,  pitch: 64, duration: 0.15 },
  { key: 'm-30',  label: 'Distortion Guitar',     instrument: 30,  pitch: 64, duration: 0.15 },
  { key: 'm-31',  label: 'Guitar Harmonics',      instrument: 31,  pitch: 72, duration: 0.15 },
  // Bass
  { key: 'm-32',  label: 'Acoustic Bass',         instrument: 32,  pitch: 48, duration: 0.15 },
  { key: 'm-33',  label: 'Finger Bass',           instrument: 33,  pitch: 48, duration: 0.15 },
  { key: 'm-34',  label: 'Pick Bass',             instrument: 34,  pitch: 48, duration: 0.15 },
  { key: 'm-35',  label: 'Fretless Bass',         instrument: 35,  pitch: 48, duration: 0.15 },
  { key: 'm-36',  label: 'Slap Bass 1',           instrument: 36,  pitch: 48, duration: 0.10 },
  { key: 'm-37',  label: 'Slap Bass 2',           instrument: 37,  pitch: 48, duration: 0.10 },
  { key: 'm-38',  label: 'Synth Bass 1',          instrument: 38,  pitch: 48, duration: 0.15 },
  { key: 'm-39',  label: 'Synth Bass 2',          instrument: 39,  pitch: 48, duration: 0.15 },
  // Strings
  { key: 'm-40',  label: 'Violin',                instrument: 40,  pitch: 72, duration: 0.15 },
  { key: 'm-41',  label: 'Viola',                 instrument: 41,  pitch: 65, duration: 0.15 },
  { key: 'm-42',  label: 'Cello',                 instrument: 42,  pitch: 60, duration: 0.15 },
  { key: 'm-43',  label: 'Contrabass',            instrument: 43,  pitch: 48, duration: 0.15 },
  { key: 'm-44',  label: 'Tremolo Strings',       instrument: 44,  pitch: 72, duration: 0.15 },
  { key: 'm-45',  label: 'Pizzicato Strings',     instrument: 45,  pitch: 72, duration: 0.10 },
  { key: 'm-46',  label: 'Orchestral Harp',       instrument: 46,  pitch: 72, duration: 0.15 },
  { key: 'm-47',  label: 'Timpani',               instrument: 47,  pitch: 53, duration: 0.10 },
  // Ensemble
  { key: 'm-48',  label: 'String Ensemble 1',     instrument: 48,  pitch: 72, duration: 0.15 },
  { key: 'm-49',  label: 'String Ensemble 2',     instrument: 49,  pitch: 72, duration: 0.15 },
  { key: 'm-50',  label: 'Synth Strings 1',       instrument: 50,  pitch: 72, duration: 0.15 },
  { key: 'm-51',  label: 'Synth Strings 2',       instrument: 51,  pitch: 72, duration: 0.15 },
  { key: 'm-52',  label: 'Choir Aahs',            instrument: 52,  pitch: 72, duration: 0.15 },
  { key: 'm-53',  label: 'Voice Oohs',            instrument: 53,  pitch: 72, duration: 0.15 },
  { key: 'm-54',  label: 'Synth Voice',           instrument: 54,  pitch: 72, duration: 0.15 },
  { key: 'm-55',  label: 'Orchestra Hit',         instrument: 55,  pitch: 72, duration: 0.10 },
  // Brass
  { key: 'm-56',  label: 'Trumpet',               instrument: 56,  pitch: 72, duration: 0.15 },
  { key: 'm-57',  label: 'Trombone',              instrument: 57,  pitch: 60, duration: 0.15 },
  { key: 'm-58',  label: 'Tuba',                  instrument: 58,  pitch: 48, duration: 0.15 },
  { key: 'm-59',  label: 'Muted Trumpet',         instrument: 59,  pitch: 72, duration: 0.15 },
  { key: 'm-60',  label: 'French Horn',           instrument: 60,  pitch: 65, duration: 0.15 },
  { key: 'm-61',  label: 'Brass Section',         instrument: 61,  pitch: 72, duration: 0.15 },
  { key: 'm-62',  label: 'Synth Brass 1',         instrument: 62,  pitch: 72, duration: 0.15 },
  { key: 'm-63',  label: 'Synth Brass 2',         instrument: 63,  pitch: 72, duration: 0.15 },
  // Reed
  { key: 'm-64',  label: 'Soprano Sax',           instrument: 64,  pitch: 72, duration: 0.15 },
  { key: 'm-65',  label: 'Alto Sax',              instrument: 65,  pitch: 65, duration: 0.15 },
  { key: 'm-66',  label: 'Tenor Sax',             instrument: 66,  pitch: 60, duration: 0.15 },
  { key: 'm-67',  label: 'Baritone Sax',          instrument: 67,  pitch: 55, duration: 0.15 },
  { key: 'm-68',  label: 'Oboe',                  instrument: 68,  pitch: 72, duration: 0.15 },
  { key: 'm-69',  label: 'English Horn',          instrument: 69,  pitch: 65, duration: 0.15 },
  { key: 'm-70',  label: 'Bassoon',               instrument: 70,  pitch: 60, duration: 0.15 },
  { key: 'm-71',  label: 'Clarinet',              instrument: 71,  pitch: 72, duration: 0.15 },
  // Pipe
  { key: 'm-72',  label: 'Piccolo',               instrument: 72,  pitch: 84, duration: 0.15 },
  { key: 'm-73',  label: 'Flute',                 instrument: 73,  pitch: 77, duration: 0.15 },
  { key: 'm-74',  label: 'Recorder',              instrument: 74,  pitch: 72, duration: 0.15 },
  { key: 'm-75',  label: 'Pan Flute',             instrument: 75,  pitch: 72, duration: 0.15 },
  { key: 'm-76',  label: 'Blown Bottle',          instrument: 76,  pitch: 72, duration: 0.15 },
  { key: 'm-77',  label: 'Shakuhachi',            instrument: 77,  pitch: 65, duration: 0.15 },
  { key: 'm-78',  label: 'Whistle',               instrument: 78,  pitch: 77, duration: 0.15 },
  { key: 'm-79',  label: 'Ocarina',               instrument: 79,  pitch: 72, duration: 0.15 },
  // Synth Lead
  { key: 'm-80',  label: 'Square Wave',           instrument: 80,  pitch: 72, duration: 0.15 },
  { key: 'm-81',  label: 'Sawtooth Wave',         instrument: 81,  pitch: 72, duration: 0.15 },
  { key: 'm-82',  label: 'Calliope',              instrument: 82,  pitch: 72, duration: 0.15 },
  { key: 'm-83',  label: 'Chiff',                 instrument: 83,  pitch: 72, duration: 0.15 },
  { key: 'm-84',  label: 'Charang',               instrument: 84,  pitch: 72, duration: 0.15 },
  { key: 'm-85',  label: 'Voice Lead',            instrument: 85,  pitch: 72, duration: 0.15 },
  { key: 'm-86',  label: 'Fifths',                instrument: 86,  pitch: 72, duration: 0.15 },
  { key: 'm-87',  label: 'Bass + Lead',           instrument: 87,  pitch: 60, duration: 0.15 },
  // Synth Pad
  { key: 'm-88',  label: 'New Age Pad',           instrument: 88,  pitch: 72, duration: 0.20 },
  { key: 'm-89',  label: 'Warm Pad',              instrument: 89,  pitch: 72, duration: 0.20 },
  { key: 'm-90',  label: 'Polysynth Pad',         instrument: 90,  pitch: 72, duration: 0.20 },
  { key: 'm-91',  label: 'Choir Pad',             instrument: 91,  pitch: 72, duration: 0.20 },
  { key: 'm-92',  label: 'Bowed Pad',             instrument: 92,  pitch: 72, duration: 0.20 },
  { key: 'm-93',  label: 'Metallic Pad',          instrument: 93,  pitch: 72, duration: 0.20 },
  { key: 'm-94',  label: 'Halo Pad',              instrument: 94,  pitch: 72, duration: 0.20 },
  { key: 'm-95',  label: 'Sweep Pad',             instrument: 95,  pitch: 72, duration: 0.20 },
  // Synth Effects
  { key: 'm-96',  label: 'Rain',                  instrument: 96,  pitch: 72, duration: 0.20 },
  { key: 'm-97',  label: 'Soundtrack',            instrument: 97,  pitch: 72, duration: 0.20 },
  { key: 'm-98',  label: 'Crystal',               instrument: 98,  pitch: 72, duration: 0.20 },
  { key: 'm-99',  label: 'Atmosphere',            instrument: 99,  pitch: 72, duration: 0.20 },
  { key: 'm-100', label: 'Brightness',            instrument: 100, pitch: 72, duration: 0.20 },
  { key: 'm-101', label: 'Goblins',               instrument: 101, pitch: 72, duration: 0.20 },
  { key: 'm-102', label: 'Echoes',                instrument: 102, pitch: 72, duration: 0.20 },
  { key: 'm-103', label: 'Sci-fi',                instrument: 103, pitch: 72, duration: 0.20 },
  // Ethnic
  { key: 'm-104', label: 'Sitar',                 instrument: 104, pitch: 65, duration: 0.15 },
  { key: 'm-105', label: 'Banjo',                 instrument: 105, pitch: 64, duration: 0.15 },
  { key: 'm-106', label: 'Shamisen',              instrument: 106, pitch: 65, duration: 0.15 },
  { key: 'm-107', label: 'Koto',                  instrument: 107, pitch: 65, duration: 0.15 },
  { key: 'm-108', label: 'Kalimba',               instrument: 108, pitch: 72, duration: 0.15 },
  { key: 'm-109', label: 'Bag Pipe',              instrument: 109, pitch: 65, duration: 0.15 },
  { key: 'm-110', label: 'Fiddle',                instrument: 110, pitch: 72, duration: 0.15 },
  { key: 'm-111', label: 'Shanai',                instrument: 111, pitch: 65, duration: 0.15 },
  // Percussive
  { key: 'm-112', label: 'Tinkle Bell',           instrument: 112, pitch: 84, duration: 0.15 },
  { key: 'm-113', label: 'Agogo',                 instrument: 113, pitch: 72, duration: 0.10 },
  { key: 'm-114', label: 'Steel Drums',           instrument: 114, pitch: 72, duration: 0.15 },
  { key: 'm-115', label: 'Woodblock',             instrument: 115, pitch: 76, duration: 0.10 },
  { key: 'm-116', label: 'Taiko Drum',            instrument: 116, pitch: 60, duration: 0.10 },
  { key: 'm-117', label: 'Melodic Tom',           instrument: 117, pitch: 60, duration: 0.10 },
  { key: 'm-118', label: 'Synth Drum',            instrument: 118, pitch: 60, duration: 0.10 },
  { key: 'm-119', label: 'Reverse Cymbal',        instrument: 119, pitch: 60, duration: 0.20 },
  // Sound Effects
  { key: 'm-120', label: 'Guitar Fret Noise',     instrument: 120, pitch: 60, duration: 0.10 },
  { key: 'm-121', label: 'Breath Noise',          instrument: 121, pitch: 72, duration: 0.15 },
  { key: 'm-122', label: 'Seashore',              instrument: 122, pitch: 72, duration: 0.20 },
  { key: 'm-123', label: 'Bird Tweet',            instrument: 123, pitch: 72, duration: 0.15 },
  { key: 'm-124', label: 'Telephone Ring',        instrument: 124, pitch: 72, duration: 0.15 },
  { key: 'm-125', label: 'Helicopter',            instrument: 125, pitch: 72, duration: 0.20 },
  { key: 'm-126', label: 'Applause',              instrument: 126, pitch: 72, duration: 0.20 },
  { key: 'm-127', label: 'Gunshot',               instrument: 127, pitch: 72, duration: 0.10 },
]

export const ALL_METRONOME_SOUNDS: MetronomeSound[] = [
  ...BEAT_SOUNDS,
  ...OTHER_PERCUSSION_SOUNDS,
  ...MELODIC_SOUNDS,
]

export const DEFAULT_METRONOME_SOUND: MetronomeSound = BEAT_SOUNDS[0] // Closed Hi-Hat
export const DEFAULT_ACCENT_SOUND: MetronomeSound =
  BEAT_SOUNDS.find((s) => s.key === 'p-76') ?? BEAT_SOUNDS[0] // Hi Wood Block

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const METRONOME_PREFS_KEY = 'sessionapp.metronome'

export interface MetronomePrefs {
  enabled: boolean
  soundKey: string
}

export function loadMetronomePrefs(): MetronomePrefs {
  try {
    const raw = localStorage.getItem(METRONOME_PREFS_KEY)
    if (raw) return { enabled: false, soundKey: DEFAULT_METRONOME_SOUND.key, ...JSON.parse(raw) }
  } catch {}
  return { enabled: false, soundKey: DEFAULT_METRONOME_SOUND.key }
}

export function saveMetronomePrefs(prefs: MetronomePrefs): void {
  try {
    localStorage.setItem(METRONOME_PREFS_KEY, JSON.stringify(prefs))
  } catch {}
}

export function findMetronomeSound(key: string): MetronomeSound {
  return ALL_METRONOME_SOUNDS.find((s) => s.key === key) ?? DEFAULT_METRONOME_SOUND
}

/**
 * Parse the K: field from an ABC string and return the MIDI note for the
 * key root placed in octave 5 (C5 = 72).  Falls back to C5 if no key is
 * found.  Only the root letter + optional accidental is considered; the
 * mode (maj/min/mix/dor/…) is irrelevant for pitch purposes.
 */
export function getAbcKeyRoot(abc: string): number {
  const match = abc.match(/^K:\s*([A-Ga-g][#b]?)/m)
  if (!match) return 72
  const letter = match[1].charAt(0).toUpperCase()
  const acc    = match[1].slice(1)
  const semitones: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  }
  let st = semitones[letter] ?? 0
  if (acc === '#') st += 1
  if (acc === 'b') st -= 1
  return 72 + st // C5 = 72
}

export function playMetronomeClick(sound: MetronomeSound, pitchOverride?: number): void {
  try {
    const pitch = pitchOverride ?? sound.pitch
    abcjs.synth.playEvent(
      [{ pitch, volume: 90, start: 0, duration: sound.duration, instrument: sound.instrument, gap: 0 }],
      [],
      500,
    ).catch(() => {})
  } catch (err) {
    console.warn('Failed to play metronome click:', err)
  }
}
