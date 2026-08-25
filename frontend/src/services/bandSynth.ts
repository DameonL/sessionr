import abcjs from 'abcjs'
import { humanizeBackerTracks, type BandVoice } from './band'
import { shouldSubdivideInstrument, subdivideLongNotes } from '../components/instruments'
import { getBodhranDrumOption } from './bodhran'
import { applyMeterEmphasis } from './meterEmphasis'
import { getMeterPulse } from './meterPulse'
import { applyCustomTripletSwing, isCompoundMeter } from './swing'
import { strumChords } from './strum'

export interface BandSynthOptions extends abcjs.SynthOptions {
  bodhran?: boolean
  swingPercent?: number
  /** How hard to lean on the beats the meter leans on, 0-100. Every voice gets it: pulse is an ensemble property. */
  emphasisPercent?: number
}

/**
 * Creates and primes one band voice's synth: melody/chords/bass all set to the
 * same program (so a backer plays the tune itself, not a harmony/bass part),
 * panned to its stereo position, with per-note humanization wired in for
 * backers (never for the leader, which stays exactly in sync with its own
 * cursor/timing). `extraOptions` lets a caller layer on its own synth options
 * (e.g. swing, bodhran) without duplicating this wiring.
 *
 * Split out from band.ts (which stays free of the real abcjs runtime import,
 * only using its types) so pure band-picking logic — used by virtualSession.ts
 * on a page that deliberately keeps the abcjs synth engine out of its initial
 * bundle via a dynamic, ssr:false import of the player component — doesn't
 * drag the whole synth engine back in through a static import.
 */
export async function createBandSynth(
  visualObj: abcjs.TuneObject,
  msPerMeasure: number,
  voice: BandVoice,
  tempoMultiplierSec: number,
  extraOptions?: BandSynthOptions,
): Promise<abcjs.MidiBuffer> {
  const synth = new abcjs.synth.CreateSynth()
  const isSubdivided = shouldSubdivideInstrument(voice.program)
  const isBacker = voice.role === 'backer'
  const isBodhran = !!extraOptions?.bodhran && voice.role === 'leader'
  const bodhranPattern = isBodhran ? getBodhranDrumOption(visualObj.getMeterFraction()) : undefined
  const meter = visualObj.getMeterFraction()
  const compound = isCompoundMeter(meter)
  const swingPercent = extraOptions?.swingPercent ?? 0
  const emphasisPercent = extraOptions?.emphasisPercent ?? 0
  const pulse = getMeterPulse(meter)
  const pickupWholeNotes = visualObj.getPickupLength()

  await synth.init({
    visualObj,
    millisecondsPerMeasure: msPerMeasure,
    options: {
      ...extraOptions,
      swing: compound ? undefined : extraOptions?.swing,
      program: voice.program,
      chordprog: voice.program,
      bassprog: voice.program,
      pan: [voice.pan, voice.pan, voice.pan],
      drum: bodhranPattern || extraOptions?.drum,
      drumBars: bodhranPattern ? 1 : extraOptions?.drumBars,
      // abcjs discards this callback's return value, so every stage rewrites the tracks
      // in place. Order matters: swing moves note starts, meter emphasis reads those final
      // starts to weigh each note by its place in the bar, subdivision splits from them so
      // each re-strike inherits its beat's weight, the strum spreads the re-strikes, and
      // humanization rides on top of all of it.
      sequenceCallback: (tracks: abcjs.NoteMapTrack[]) => {
        if (compound && swingPercent > 0) {
          applyCustomTripletSwing(tracks, swingPercent)
        }
        applyMeterEmphasis(tracks, pulse, pickupWholeNotes, emphasisPercent)
        if (isSubdivided) {
          for (const track of tracks) subdivideLongNotes(track)
        }
        for (const track of tracks) strumChords(track, tempoMultiplierSec)
        if (isBacker) {
          humanizeBackerTracks(tracks, voice, tempoMultiplierSec)
        }
        // Ignored at runtime; abcjs's type declaration still demands a return.
        return tracks
      },
    },
  })
  await synth.prime()
  return synth
}



