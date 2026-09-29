import {
  METRONOME_ACCENT_VOLUME,
  METRONOME_VOLUME,
  type MetronomeSound,
} from './metronome'
import { playNoteSequence, type NoteStep, type SequencePlayback } from './earTraining'

/**
 * A bar counted in before the tune starts, the way someone counts a session in.
 *
 * Two things have to agree: what the player hears and the number they read. Both come from the
 * offsets computed here, so a count that reads "1 2 3 4 5 6" is also six clicks.
 */

/** How long each click sounds. Matches the metronome's own click length. */
const CLICK_MS = 60

export interface CountInBar {
  /** When each counted beat falls, in milliseconds from the start of the count-in. */
  offsetsMs: number[]
  /** The whole bar's length, and so how long the count-in lasts. */
  barMs: number
}

interface CountInTuneObject {
  millisecondsPerMeasure(bpm?: number): number
  getMeterFraction(): { num?: number; den?: number }
}

/**
 * The beats to count, for one bar of this tune at this tempo.
 *
 * The count is what the meter says it is — the numerator, evenly across the bar. A jig is counted
 * in six, not in the two dotted-quarter groups it is felt in: a count-in is someone saying "one
 * two three four five six", and it has to match the bar the player is about to read.
 *
 * The bar's length comes from abcjs rather than from bpm arithmetic, so the count-in is exactly a
 * bar however the tune's Q: field relates to its meter.
 */
export function getCountInBar(visualObj: CountInTuneObject, bpm: number): CountInBar {
  const barMs = Math.max(0, visualObj.millisecondsPerMeasure(bpm))
  // A bar of no length can't be counted through; the caller skips a count-in of zero beats.
  if (barMs <= 0) return { offsetsMs: [], barMs: 0 }
  const beats = Math.max(1, Math.round(visualObj.getMeterFraction().num ?? 4))
  const offsetsMs = Array.from({ length: beats }, (_, i) => (i / beats) * barMs)
  return { offsetsMs, barMs }
}

/**
 * Sound the count-in as a single rendered buffer.
 *
 * One buffer, not a click per timer: every separately scheduled playEvent starts at the audio
 * context's current render position, and that position stays frozen until the output device has
 * finished opening. JS timers run on through that window, so a cold start or a Bluetooth handover
 * would land every click on the same instant and count the bar in as one thud. Rendering the gaps
 * into the samples makes the spacing a property of the buffer instead. See the note on
 * playNoteSequence for the full story.
 *
 * The downbeat is the same click played harder, as in the running metronome.
 */
export function playCountIn(
  bar: CountInBar,
  sound: MetronomeSound,
): Promise<SequencePlayback> {
  const steps: NoteStep[] = bar.offsetsMs.map((offsetMs, index) => {
    const nextMs = index === bar.offsetsMs.length - 1 ? bar.barMs : bar.offsetsMs[index + 1]
    const clickMs = Math.max(1, Math.min(CLICK_MS, nextMs - offsetMs))
    return {
      midi: sound.pitch,
      durationMs: clickMs,
      gapMs: Math.max(0, nextMs - offsetMs - clickMs),
      volume: index === 0 ? METRONOME_ACCENT_VOLUME : METRONOME_VOLUME,
    }
  })
  return playNoteSequence(steps, sound.instrument)
}
