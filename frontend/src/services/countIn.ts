import {
  METRONOME_ACCENT_VOLUME,
  METRONOME_VOLUME,
  type MetronomeSound,
} from './metronome'
import { playNoteSequence, type NoteStep, type SequencePlayback } from './earTraining'

/**
 * The bar or two counted in before the tune starts, the way someone counts a session in.
 *
 * Two things have to agree: what the player hears and the number they read. Both come from the
 * beats computed here, so a count that reads "1 2 3 4 5 6" is also six clicks.
 */

/** How long each click sounds. Matches the metronome's own click length. */
const CLICK_MS = 60

/**
 * Under this, one bar is over before a player can latch onto it — a jig at its usual tempo is six
 * numbers in a second — so the count gets two bars. The test is the bar's length rather than the
 * tempo, because abcjs's BPM is not comparable across meters: it counts dotted quarters in a jig,
 * so 120 there is a 1s bar and in a reel a 2s one.
 */
const TWO_BAR_MAX_BAR_MS = 1200

export interface CountInBeat {
  /** When this beat falls, in milliseconds from the start of the count-in. */
  offsetMs: number
  /** What the screen shows. Restarts at 1 on each bar, the way a bar is counted aloud. */
  count: number
  /** A bar's downbeat: the click that gets the accent velocity. */
  accented: boolean
}

export interface CountIn {
  beats: CountInBeat[]
  /** How long the whole count lasts, and so when the tune comes in. */
  totalMs: number
  /** Numbers to a bar, for the overlay to say "3 of 6". */
  beatsPerBar: number
}

interface CountInTuneObject {
  millisecondsPerMeasure(bpm?: number): number
  getMeterFraction(): { num?: number; den?: number }
}

/**
 * The beats to count in for this tune at this tempo.
 *
 * The count is what the meter says it is — the numerator, evenly across the bar. A jig is counted
 * in six, not in the two dotted-quarter groups it is felt in: a count-in is someone saying "one
 * two three four five six", and it has to match the bar the player is about to read.
 *
 * Past 6/8 that stops being true. A slide's twelve eighths go by at about eight a second, which
 * nobody can either say or hear as a count — so the wider compound meters are counted in their
 * dotted-quarter groups instead: a slide in four, a slip jig in three. 7/8 and its like keep their
 * numerator, since a bar of seven is short enough to count and has no even grouping to fall back
 * on anyway.
 *
 * A short bar is counted twice rather than faster: the trouble with a quick count-in is that it is
 * over before it has registered, and repeating the bar is how a session fixes that.
 *
 * The bar's length comes from abcjs rather than from bpm arithmetic, so the count-in is exactly a
 * bar — or two — however the tune's Q: field relates to its meter.
 */
export function getCountIn(visualObj: CountInTuneObject, bpm: number): CountIn {
  const barMs = Math.max(0, visualObj.millisecondsPerMeasure(bpm))
  const meter = visualObj.getMeterFraction()
  const num = Math.max(1, Math.round(meter.num ?? 4))
  const isWideCompound = meter.den === 8 && num > 6 && num % 3 === 0
  const beatsPerBar = isWideCompound ? num / 3 : num
  // A bar of no length can't be counted through; the caller skips a count-in of no beats.
  if (barMs <= 0) return { beats: [], totalMs: 0, beatsPerBar }

  const bars = barMs < TWO_BAR_MAX_BAR_MS ? 2 : 1
  const beats: CountInBeat[] = []
  for (let bar = 0; bar < bars; bar++) {
    for (let i = 0; i < beatsPerBar; i++) {
      beats.push({
        offsetMs: bar * barMs + (i / beatsPerBar) * barMs,
        count: i + 1,
        accented: i === 0,
      })
    }
  }
  return { beats, totalMs: bars * barMs, beatsPerBar }
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
 * Each bar's downbeat is the same click played harder, as in the running metronome.
 */
export function playCountIn(
  countIn: CountIn,
  sound: MetronomeSound,
): Promise<SequencePlayback> {
  const steps: NoteStep[] = countIn.beats.map((beat, index) => {
    const nextMs = countIn.beats[index + 1]?.offsetMs ?? countIn.totalMs
    const clickMs = Math.max(1, Math.min(CLICK_MS, nextMs - beat.offsetMs))
    return {
      midi: sound.pitch,
      durationMs: clickMs,
      gapMs: Math.max(0, nextMs - beat.offsetMs - clickMs),
      volume: beat.accented ? METRONOME_ACCENT_VOLUME : METRONOME_VOLUME,
    }
  })
  return playNoteSequence(steps, sound.instrument)
}
