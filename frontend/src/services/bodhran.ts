import type abcjs from 'abcjs'

export interface BodhranStroke {
  offsetWholeNotes: number
  pitch: number
  volume: number
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

  // 12/8 Slide
  if (num === 12 && den === 8) {
    return {
      measureLengthWholeNotes: 1.5,
      strokes: [
        { offsetWholeNotes: 0.0, pitch: 36, volume: 95 }, // Beat 1: Heavy bass
        { offsetWholeNotes: 0.125, pitch: 76, volume: 50 },
        { offsetWholeNotes: 0.25, pitch: 76, volume: 50 },
        { offsetWholeNotes: 0.375, pitch: 36, volume: 85 }, // Beat 4: Bass
        { offsetWholeNotes: 0.5, pitch: 76, volume: 50 },
        { offsetWholeNotes: 0.625, pitch: 76, volume: 50 },
        { offsetWholeNotes: 0.75, pitch: 36, volume: 90 }, // Beat 7: Accent bass
        { offsetWholeNotes: 0.875, pitch: 76, volume: 50 },
        { offsetWholeNotes: 1.0, pitch: 76, volume: 50 },
        { offsetWholeNotes: 1.125, pitch: 37, volume: 80 }, // Beat 10: Rim stroke
        { offsetWholeNotes: 1.25, pitch: 76, volume: 50 },
        { offsetWholeNotes: 1.375, pitch: 76, volume: 50 },
      ],
    }
  }

  // 9/8 Slip Jig
  if (num === 9 && den === 8) {
    return {
      measureLengthWholeNotes: 1.125,
      strokes: [
        { offsetWholeNotes: 0.0, pitch: 36, volume: 95 }, // Beat 1: Heavy bass
        { offsetWholeNotes: 0.125, pitch: 76, volume: 55 },
        { offsetWholeNotes: 0.25, pitch: 76, volume: 55 },
        { offsetWholeNotes: 0.375, pitch: 36, volume: 85 }, // Beat 4: Bass
        { offsetWholeNotes: 0.5, pitch: 76, volume: 55 },
        { offsetWholeNotes: 0.625, pitch: 76, volume: 55 },
        { offsetWholeNotes: 0.75, pitch: 37, volume: 85 }, // Beat 7: Accent rim
        { offsetWholeNotes: 0.875, pitch: 76, volume: 55 },
        { offsetWholeNotes: 1.0, pitch: 76, volume: 55 },
      ],
    }
  }

  // 6/8 Double Jig
  if (num === 6 && den === 8) {
    return {
      measureLengthWholeNotes: 0.75,
      strokes: [
        { offsetWholeNotes: 0.0, pitch: 36, volume: 95 }, // Beat 1: Heavy bass
        { offsetWholeNotes: 0.125, pitch: 76, volume: 55 },
        { offsetWholeNotes: 0.25, pitch: 76, volume: 55 },
        { offsetWholeNotes: 0.375, pitch: 36, volume: 85 }, // Beat 4: Bass
        { offsetWholeNotes: 0.5, pitch: 76, volume: 55 },
        { offsetWholeNotes: 0.625, pitch: 76, volume: 55 },
      ],
    }
  }

  // 3/4 Waltz / Mazurka
  if (num === 3 && (den === 4 || den === 8)) {
    const len = num / den
    return {
      measureLengthWholeNotes: len,
      strokes: [
        { offsetWholeNotes: 0.0, pitch: 36, volume: 90 }, // Beat 1: Bass
        { offsetWholeNotes: 0.125, pitch: 76, volume: 45 },
        { offsetWholeNotes: 0.25, pitch: 37, volume: 65 }, // Beat 2: Rim
        { offsetWholeNotes: 0.375, pitch: 76, volume: 45 },
        { offsetWholeNotes: 0.5, pitch: 37, volume: 65 }, // Beat 3: Rim
        { offsetWholeNotes: 0.625, pitch: 76, volume: 45 },
      ],
    }
  }

  // Default: 4/4 or 2/4 Reel / Hornpipe / Polka
  const measureLength = den ? num / den : 1.0
  return {
    measureLengthWholeNotes: measureLength,
    strokes: [
      { offsetWholeNotes: 0.0, pitch: 36, volume: 90 }, // Beat 1: Open bass
      { offsetWholeNotes: 0.125, pitch: 76, volume: 50 },
      { offsetWholeNotes: 0.25, pitch: 37, volume: 75 }, // Beat 2: Tipper rim
      { offsetWholeNotes: 0.375, pitch: 76, volume: 50 },
      { offsetWholeNotes: 0.5, pitch: 36, volume: 85 }, // Beat 3: Bass
      { offsetWholeNotes: 0.625, pitch: 76, volume: 50 },
      { offsetWholeNotes: 0.75, pitch: 37, volume: 75 }, // Beat 4: Tipper rim
      { offsetWholeNotes: 0.875, pitch: 76, volume: 50 },
    ],
  }
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
