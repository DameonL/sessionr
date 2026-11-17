import type abcjs from 'abcjs'
import { shouldSubdivideInstrument, subdivideLongNotes } from '../components/instruments'
import { humanizeBackerTracks, type BandVoice } from './band'
import { applyMeterEmphasis } from './meterEmphasis'
import { getMeterPulse } from './meterPulse'
import { strumChords } from './strum'
import { applyCustomTripletSwing, isCompoundMeter } from './swing'

export interface TransformTracksParams {
  meter: abcjs.MeterFraction | null | undefined
  pickupWholeNotes: number
  tempoMultiplierSec: number
  swingPercent: number
  emphasisPercent: number
  /** Fallback GM programs by track index [melody, chords, bass] when note.instrument is absent. */
  fallbackPrograms?: [number, number, number]
  /** Fixed GM program for Band mode, where melody/chords/bass all share one voice program. */
  uniformProgram?: number
  /** Band voice metadata; when role === 'backer', applies per-note timing/volume/cents humanization. */
  bandVoice?: BandVoice
  /** Whether to run non-compound swing here (true for MIDI export; false for CreateSynth which runs addSwing itself). */
  applyNonCompoundSwing?: boolean
  /** Mapped abcjs swing parameter (50..75) used when applyNonCompoundSwing is true. */
  abcjsSwing?: number
}

/**
 * Applies abcjs-compatible swing to non-compound meters (X/4 and X/8 where den is 4 or 8).
 * Mirrors CreateSynth's internal `addSwing` so offline MIDI export matches live playback.
 */
export function applySimpleSwing(
  tracks: abcjs.NoteMapTrack[],
  abcjsSwing: number,
  meter: abcjs.MeterFraction | null | undefined,
  pickupWholeNotes: number,
): void {
  if (!meter || (meter.den !== 4 && meter.den !== 8)) return
  if (!Number.isFinite(abcjsSwing) || abcjsSwing <= 50) return

  const clamped = Math.min(abcjsSwing, 75)
  const swingFactor = clamped / 50 - 1
  const beatLength = meter.den === 8 ? 0.125 : 0.25
  const halfbeatLength = beatLength / 2
  const swingDuration = halfbeatLength * swingFactor
  const EPS = 1e-5

  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) {
      const event = track[i]
      const pos = event.start - pickupWholeNotes
      const halfRem = ((pos % halfbeatLength) + halfbeatLength) % halfbeatLength
      const onHalf = halfRem < EPS || Math.abs(halfRem - halfbeatLength) < EPS
      const beatRem = ((pos % beatLength) + beatLength) % beatLength
      const onBeat = beatRem < EPS || Math.abs(beatRem - beatLength) < EPS
      const prevOk = i === 0 || track[i - 1].start <= event.start - halfbeatLength + EPS
      const nextOk = i === track.length - 1 || track[i + 1].start >= event.start + halfbeatLength - EPS

      if (onHalf && !onBeat && prevOk && nextOk) {
        const oldEventStart = event.start
        event.start += swingDuration
        if (i > 0 && Math.abs(track[i - 1].end - oldEventStart) < EPS) {
          track[i - 1].end = event.start
        }
      }
    }
  }
}

/**
 * Shared in-place transformation pipeline for NoteMapTrack arrays used by both live
 * CreateSynth playback (Solo & Band) and offline MIDI export.
 *
 * Order matters:
 * 1. Swing (compound triplet lilt or non-compound simple swing) moves note starts.
 * 2. Meter emphasis weighs each note by its final position in the bar.
 * 3. Plucked-instrument subdivision splits long notes so re-strikes inherit beat weights.
 * 4. Chord strumming spreads simultaneous plucked notes (including re-struck chords).
 * 5. Band backer humanization adds per-note timing/volume jitter and fixed intonation cents.
 */
export function transformNoteMapTracks(
  tracks: abcjs.NoteMapTrack[],
  params: TransformTracksParams,
): void {
  const {
    meter,
    pickupWholeNotes,
    tempoMultiplierSec,
    swingPercent,
    emphasisPercent,
    fallbackPrograms,
    uniformProgram,
    bandVoice,
    applyNonCompoundSwing = false,
    abcjsSwing = 50,
  } = params

  const compound = isCompoundMeter(meter)
  if (compound && swingPercent > 0) {
    applyCustomTripletSwing(tracks, swingPercent)
  } else if (!compound && applyNonCompoundSwing && abcjsSwing > 50) {
    applySimpleSwing(tracks, abcjsSwing, meter, pickupWholeNotes)
  }

  const pulse = getMeterPulse(meter)
  applyMeterEmphasis(tracks, pulse, pickupWholeNotes, emphasisPercent)

  if (uniformProgram !== undefined) {
    const isSubdivided = shouldSubdivideInstrument(uniformProgram)
    for (const track of tracks) {
      if (isSubdivided) subdivideLongNotes(track)
      strumChords(track, tempoMultiplierSec)
    }
  } else {
    tracks.forEach((track, trackIdx) => {
      let prog: number | string = fallbackPrograms
        ? fallbackPrograms[Math.min(trackIdx, fallbackPrograms.length - 1)]
        : 0
      if (track.length > 0 && track[0].instrument) {
        prog = track[0].instrument
      }
      if (shouldSubdivideInstrument(prog)) {
        subdivideLongNotes(track)
      }
      strumChords(track, tempoMultiplierSec)
    })
  }

  if (bandVoice && bandVoice.role === 'backer') {
    humanizeBackerTracks(tracks, bandVoice, tempoMultiplierSec)
  }
}
