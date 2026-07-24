import abcjs from 'abcjs'
import { humanizeBackerTracks, type BandVoice } from './band'
import { shouldSubdivideInstrument, subdivideLongNotes } from '../components/instruments'
import { generateBodhranTrack, getBodhranDrumOption } from './bodhran'

export interface BandSynthOptions extends abcjs.SynthOptions {
  bodhran?: boolean
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

  await synth.init({
    visualObj,
    millisecondsPerMeasure: msPerMeasure,
    options: {
      ...extraOptions,
      program: voice.program,
      chordprog: voice.program,
      bassprog: voice.program,
      pan: [voice.pan, voice.pan, voice.pan],
      drum: bodhranPattern || extraOptions?.drum,
      drumBars: bodhranPattern ? 1 : extraOptions?.drumBars,
      sequenceCallback:
        isSubdivided || isBacker
          ? (tracks: abcjs.NoteMapTrack[]) => {
              if (isSubdivided) {
                tracks = tracks.map((track) => subdivideLongNotes(track))
              }
              if (isBacker) {
                humanizeBackerTracks(tracks, voice, tempoMultiplierSec)
              }
              return tracks
            }
          : undefined,
    },
  })
  await synth.prime()
  return synth
}



