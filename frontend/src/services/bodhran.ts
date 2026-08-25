import type abcjs from 'abcjs'
import { getMeterPulse } from './meterPulse'

export interface BodhranStroke {
  offsetWholeNotes: number
  pitch: number
  volume: number
}

/**
 * A drum voicing: one stroke per eighth of the bar, in order, zipped against the beat positions
 * meterPulse already knows.
 *
 * Only the voicing lives here — which drum is struck and how hard. Where the strokes fall is
 * meterPulse's business, so the drum and the tune's own emphasis cannot drift apart. The voicings
 * are not derivable from the pulse strengths: 9/8 hits its two medium beats with different drums,
 * and 12/8 gives its four groups four different weights, which is the player's idiom rather than
 * anything the meter dictates. Pitches are GM percussion — 36 bass drum, 37 rim, 76 hi wood block.
 */
type Voicing = Array<{ pitch: number; volume: number }>

/**
 * Each family is voiced against its canonical meter's bar of eighths. The families are keyed by
 * feel rather than by exact meter so that, for instance, 2/4 and 2/2 both get the reel pattern —
 * which is also why the voicing length is fixed per family rather than following the real bar.
 */
const FAMILIES: Record<string, { canonical: { num: number; den: number }; voicing: Voicing }> = {
  // Slide: bass on each of the four groups, the last answered on the rim.
  slide: {
    canonical: { num: 12, den: 8 },
    voicing: [
      { pitch: 36, volume: 95 }, { pitch: 76, volume: 50 }, { pitch: 76, volume: 50 },
      { pitch: 36, volume: 85 }, { pitch: 76, volume: 50 }, { pitch: 76, volume: 50 },
      { pitch: 36, volume: 90 }, { pitch: 76, volume: 50 }, { pitch: 76, volume: 50 },
      { pitch: 37, volume: 80 }, { pitch: 76, volume: 50 }, { pitch: 76, volume: 50 },
    ],
  },
  // Slip jig: three groups, the third turned round on the rim.
  slipJig: {
    canonical: { num: 9, den: 8 },
    voicing: [
      { pitch: 36, volume: 95 }, { pitch: 76, volume: 55 }, { pitch: 76, volume: 55 },
      { pitch: 36, volume: 85 }, { pitch: 76, volume: 55 }, { pitch: 76, volume: 55 },
      { pitch: 37, volume: 85 }, { pitch: 76, volume: 55 }, { pitch: 76, volume: 55 },
    ],
  },
  // Double jig: the two dotted-quarter groups, ghosted in between.
  jig: {
    canonical: { num: 6, den: 8 },
    voicing: [
      { pitch: 36, volume: 95 }, { pitch: 76, volume: 55 }, { pitch: 76, volume: 55 },
      { pitch: 36, volume: 85 }, { pitch: 76, volume: 55 }, { pitch: 76, volume: 55 },
    ],
  },
  // Waltz and mazurka: bass on the 1, rim on 2 and 3.
  waltz: {
    canonical: { num: 3, den: 4 },
    voicing: [
      { pitch: 36, volume: 90 }, { pitch: 76, volume: 45 },
      { pitch: 37, volume: 65 }, { pitch: 76, volume: 45 },
      { pitch: 37, volume: 65 }, { pitch: 76, volume: 45 },
    ],
  },
  // Reel, hornpipe, polka, and anything else: bass on 1 and 3, rim on 2 and 4.
  reel: {
    canonical: { num: 4, den: 4 },
    voicing: [
      { pitch: 36, volume: 90 }, { pitch: 76, volume: 50 },
      { pitch: 37, volume: 75 }, { pitch: 76, volume: 50 },
      { pitch: 36, volume: 85 }, { pitch: 76, volume: 50 },
      { pitch: 37, volume: 75 }, { pitch: 76, volume: 50 },
    ],
  },
}

function familyForMeter(num: number, den: number): keyof typeof FAMILIES {
  if (num === 12 && den === 8) return 'slide'
  if (num === 9 && den === 8) return 'slipJig'
  if (num === 6 && den === 8) return 'jig'
  if (num === 3 && (den === 4 || den === 8)) return 'waltz'
  return 'reel'
}

/**
 * Returns the bodhran rhythm pattern (array of strokes per measure)
 * based on the tune's meter fraction { num, den }.
 */
export function getBodhranPatternForMeter(meter?: { num?: number; den?: number } | null): {
  measureLengthWholeNotes: number
  strokes: BodhranStroke[]
} {
  const num = meter?.num ?? 4
  const den = meter?.den ?? 4

  const family = FAMILIES[familyForMeter(num, den)]
  const { beats } = getMeterPulse(family.canonical)
  const strokes = family.voicing.map((voice, i) => ({
    offsetWholeNotes: beats[i].offsetWholeNotes,
    pitch: voice.pitch,
    volume: voice.volume,
  }))

  // The real bar, not the canonical one — generateBodhranTrack trims strokes past its end.
  return { measureLengthWholeNotes: den ? num / den : 1.0, strokes }
}

/** Humanization constants for Bodhran strokes */
const TIMING_JITTER_WHOLE_NOTES = 0.003
const MIN_VOL_MULT = 0.90
const MAX_VOL_MULT = 1.10

/**
 * Generates an abcjs NoteMapTrack containing an automated bodhran drum track
 * for the given tune visual object.
 */
export function generateBodhranTrack(
  visualObj: abcjs.TuneObject,
  randomFn: () => number = Math.random,
): abcjs.NoteMapTrackItem[] {
  if (!visualObj) return []

  const meter = visualObj.getMeterFraction() || { num: 4, den: 4 }
  const { measureLengthWholeNotes, strokes } = getBodhranPatternForMeter(meter)
  if (measureLengthWholeNotes <= 0 || strokes.length === 0) return []

  const totalTimeSec = visualObj.getTotalTime() || 0
  const msPerMeasure = visualObj.millisecondsPerMeasure(visualObj.getBpm() || 120) || 2000
  const totalMeasures = Math.max(1, Math.round((totalTimeSec * 1000) / msPerMeasure))

  const drumTrack: abcjs.NoteMapTrackItem[] = []

  for (let m = 0; m < totalMeasures; m++) {
    const measureStart = m * measureLengthWholeNotes

    for (const stroke of strokes) {
      if (stroke.offsetWholeNotes >= measureLengthWholeNotes) continue

      const jitter = (randomFn() * 2 - 1) * TIMING_JITTER_WHOLE_NOTES
      const noteStart = Math.max(0, measureStart + stroke.offsetWholeNotes + jitter)
      const noteEnd = noteStart + 0.08 // brief percussion note duration

      const volMult = MIN_VOL_MULT + randomFn() * (MAX_VOL_MULT - MIN_VOL_MULT)
      const volume = Math.max(1, Math.min(127, Math.round(stroke.volume * volMult)))

      drumTrack.push({
        pitch: stroke.pitch,
        instrument: '128',
        start: noteStart,
        end: noteEnd,
        startChar: 0,
        endChar: 0,
        volume,
      })
    }
  }

  return drumTrack
}

/**
 * Returns an abcjs drum option string (e.g. "dddddddd 36 76 37 76 36 76 37 76 90 50 75 50 85 50 75 50")
 * matching the tune's meter fraction, so abcjs pre-loads percussion soundfonts
 * and synthesizes the traditional bodhran pattern natively.
 */
export function getBodhranDrumOption(meter?: { num?: number; den?: number } | null): string {
  const { strokes } = getBodhranPatternForMeter(meter)
  if (!strokes || strokes.length === 0) return ''

  const dPattern = 'd'.repeat(strokes.length)
  const pitches = strokes.map((s) => s.pitch).join(' ')
  const vols = strokes.map((s) => s.volume).join(' ')
  return `${dPattern} ${pitches} ${vols}`
}

