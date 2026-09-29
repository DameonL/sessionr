import abcjs from 'abcjs'
import { LETTER_PITCHES, getDefaultAlteration, parseKeyDetails, parseKeySignature } from './abcTools'
import { waitForAudioClock } from './audioClock'

/**
 * Turns a tune's ABC into the material the ear trainer needs: an ordered
 * list of target notes (with midi pitches) grouped into short phrases, plus
 * a standalone ABC excerpt per phrase that renders/plays exactly those notes.
 *
 * The sanitized phrase text is the single source for both note extraction and
 * abcjs rendering, so the Nth extracted note is the Nth `.abcjs-note` element
 * in the rendered SVG — the reveal logic depends on that alignment.
 *
 * Deliberately out of scope (degrades, never crashes):
 * - Repeats (|: :|) and 1st/2nd endings are treated as plain barlines; the
 *   notes are trained in written order without unrolling.
 * - Inline field changes ([K:...], [M:...]) are dropped.
 * - Multi-voice tunes (V:) are unsupported → returns null.
 * - Bracket chords [ceg] collapse to their first note.
 */

export interface NoteEvent {
  midi: number
  pitchClass: number
  abcToken: string
  /** Second half of a tie on the same pitch — revealed for free, never a target. */
  isTieContinuation: boolean
  /** Which bar of its phrase the note sits in, from 0. */
  barIndex: number
}

export interface Phrase {
  notes: NoteEvent[]
  excerptAbc: string
  /** A standalone ABC tune per bar of the phrase, for playing one bar alone. */
  barExcerpts: string[]
}

export interface EarTrainingTune {
  phrases: Phrase[]
  totalTargets: number
}

const NOTE_RE = /^([\^=_]*)([A-Ga-g])([,']*)/
const BARLINE_RE = /^(\|\]|\[\||\|\||::|:\||\|:|\||\[[1-9])/
const DURATION_RE = /[0-9/><]/

function sanitizeBodyLine(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '"') {
      i++
      while (i < line.length && line[i] !== '"') i++
      i++
      continue
    }
    if (ch === '{') {
      while (i < line.length && line[i] !== '}') i++
      i++
      continue
    }
    if (ch === '!') {
      const close = line.indexOf('!', i + 1)
      i = close !== -1 ? close + 1 : i + 1
      continue
    }
    if (ch === '~' || ch === '.') {
      i++
      continue
    }
    if (ch === '[') {
      const next = line[i + 1]
      if (next === '|') {
        out += '[|'
        i += 2
        continue
      }
      if (next >= '1' && next <= '9') {
        out += '[' + next
        i += 2
        continue
      }
      const close = line.indexOf(']', i + 1)
      if (close !== -1) {
        const content = line.slice(i + 1, close)
        if (/^[A-Za-z]:/.test(content)) {
          i = close + 1
          continue
        }
        const m = content.match(NOTE_RE)
        if (m) out += m[0]
        i = close + 1
        continue
      }
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

interface Bar {
  text: string
  notes: NoteEvent[]
  barlineAfter: string
  endingNumber: number | null
}

export function buildEarTrainingTune(abc: string, barsPerPhrase = 2): EarTrainingTune | null {
  const headerLines: string[] = []
  const bodyLines: string[] = []
  for (const raw of abc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('%')) continue
    if (/^[A-HJ-Za-hj-z]:/.test(trimmed)) {
      if (/^v:/i.test(trimmed)) return null
      headerLines.push(trimmed)
      continue
    }
    bodyLines.push(raw)
  }

  const pick = (prefix: string) => headerLines.find((l) => l.toLowerCase().startsWith(prefix))
  const kLine = pick('k:') ?? 'K:C'
  const excerptHeader = ['X:1', pick('m:'), pick('l:') ?? 'L:1/8', pick('q:'), kLine]
    .filter(Boolean)
    .join('\n')

  const keyDetails = parseKeyDetails(kLine.slice(2).trim())
  const sharps = keyDetails
    ? parseKeySignature(keyDetails.root + keyDetails.mode)?.sharps ?? 0
    : 0

  const body = bodyLines.map(sanitizeBodyLine).join(' ')

  const bars: Bar[] = []
  let barText = ''
  let barNotes: NoteEvent[] = []
  let barAccidentals: Record<string, number> = {}
  let pendingTieMidi: number | null = null
  let currentEnding: number | null = null

  const flushBar = (nextBarline: string) => {
    if (barText.trim() || barNotes.length > 0) {
      bars.push({
        text: barText.trim(),
        notes: barNotes,
        barlineAfter: nextBarline,
        endingNumber: currentEnding,
      })
    }
    barText = ''
    barNotes = []
    barAccidentals = {}
  }

  let i = 0
  while (i < body.length) {
    const rest = body.slice(i)

    const barMatch = rest.match(BARLINE_RE)
    if (barMatch) {
      const matchText = barMatch[0]
      flushBar(matchText)
      i += matchText.length

      if (matchText.startsWith('[')) {
        currentEnding = Number(matchText[1])
      } else if (i < body.length && body[i] >= '1' && body[i] <= '9') {
        currentEnding = Number(body[i])
        i++
      } else {
        currentEnding = null
      }
      continue
    }

    const noteMatch = rest.match(NOTE_RE)
    if (noteMatch) {
      const [token, accidentals, letter, octaves] = noteMatch

      let midi = 60 + LETTER_PITCHES[letter.toLowerCase()]
      if (letter === letter.toLowerCase()) midi += 12
      for (const oct of octaves) {
        if (oct === "'") midi += 12
        if (oct === ',') midi -= 12
      }

      const accKey = letter + octaves
      let alteration: number
      if (accidentals) {
        if (accidentals === '^') alteration = 1
        else if (accidentals === '^^') alteration = 2
        else if (accidentals === '_') alteration = -1
        else if (accidentals === '__') alteration = -2
        else alteration = 0
        barAccidentals[accKey] = alteration
      } else {
        alteration = barAccidentals[accKey] ?? getDefaultAlteration(letter, sharps)
      }
      midi += alteration

      let j = i + token.length
      let duration = ''
      while (j < body.length && DURATION_RE.test(body[j])) {
        duration += body[j]
        j++
      }
      const tiesForward = body[j] === '-'

      barNotes.push({
        midi,
        pitchClass: ((midi % 12) + 12) % 12,
        abcToken: token + duration,
        isTieContinuation: pendingTieMidi === midi,
        // Assigned per phrase below; a bar can land in more than one phrase.
        barIndex: 0,
      })
      pendingTieMidi = tiesForward ? midi : null

      barText += token + duration + (tiesForward ? '-' : '')
      i = j + (tiesForward ? 1 : 0)
      continue
    }

    barText += body[i]
    i++
  }
  flushBar('|]')

  // Unroll repeats and endings
  const unrolled: Bar[] = []
  let sectionStart = 0
  let playedRepeatForSection = false

  for (let idx = 0; idx < bars.length; idx++) {
    const bar = bars[idx]

    if (idx > 0 && (bars[idx - 1].barlineAfter === '|:' || bars[idx - 1].barlineAfter === '::')) {
      sectionStart = idx
      playedRepeatForSection = false
    }

    unrolled.push(bar)

    const hasRepeat = bar.barlineAfter === ':|' || bar.barlineAfter === '::'
    if (hasRepeat && !playedRepeatForSection) {
      const sectionBars = bars.slice(sectionStart, idx + 1)
      const firstEndingIndex = sectionBars.findIndex((b) => b.endingNumber === 1)

      if (firstEndingIndex !== -1) {
        const repeatPreEnding = sectionBars.slice(0, firstEndingIndex)
        for (const rBar of repeatPreEnding) {
          unrolled.push(rBar)
        }
        let nextIdx = idx + 1
        const secondEndingBars: Bar[] = []
        while (nextIdx < bars.length && bars[nextIdx].endingNumber === 2) {
          secondEndingBars.push(bars[nextIdx])
          nextIdx++
        }
        for (const rBar of secondEndingBars) {
          unrolled.push(rBar)
        }
        idx = nextIdx - 1
      } else {
        for (const rBar of sectionBars) {
          unrolled.push(rBar)
        }
      }

      playedRepeatForSection = true
      sectionStart = idx + 1
    }
  }

  const phrases: Phrase[] = []
  for (let b = 0; b < unrolled.length; b += barsPerPhrase) {
    const chunk = unrolled.slice(b, b + barsPerPhrase)
    phrases.push({
      // Copied, not shared: unrolling pushes the same Bar object once per
      // repeat, and each copy needs the bar index of its own phrase.
      notes: chunk.flatMap((bar, barIndex) => bar.notes.map((n) => ({ ...n, barIndex }))),
      excerptAbc: `${excerptHeader}\n${chunk.map((bar) => bar.text).join(' | ')} |]`,
      barExcerpts: chunk.map((bar) => `${excerptHeader}\n${bar.text} |]`),
    })
  }

  const totalTargets = phrases.reduce(
    (sum, p) => sum + p.notes.filter((n) => !n.isTieContinuation).length,
    0,
  )
  if (totalTargets === 0) return null

  return { phrases, totalTargets }
}

// --- Bar-by-bar call and response ---

/** One pitch the player owes, standing for one or more written notes. */
export interface CallResponseTarget {
  midi: number
  pitchClass: number
  /** Phrase note indices revealed when this target is found — repeats and ties included. */
  noteIndices: number[]
}

/** A bar (or two) the app plays and the player answers in one go. */
export interface CallResponseChunk {
  firstBar: number
  barCount: number
  /** Every phrase note index in the chunk, for revealing it whole. */
  noteIndices: number[]
  /** In order. Consecutive targets never share a pitch class. */
  targets: CallResponseTarget[]
}

/**
 * Splits a phrase into chunks of `barsPerChunk` bars, each an ordered list of
 * pitches to play back. Rhythm is ignored.
 *
 * Consecutive notes of the same pitch class merge into one target. The pitch
 * listener only re-fires a MIDI note after a silence, so a re-bowed AAA is a
 * single detection — asking for three would make the bar unfinishable. Tie
 * continuations are never targets; they're revealed with the note they extend.
 */
export function buildCallResponseChunks(phrase: Phrase, barsPerChunk: 1 | 2): CallResponseChunk[] {
  const barCount = phrase.notes.reduce((max, n) => Math.max(max, n.barIndex + 1), 0)
  const chunks: CallResponseChunk[] = []

  for (let firstBar = 0; firstBar < barCount; firstBar += barsPerChunk) {
    const lastBar = Math.min(firstBar + barsPerChunk, barCount) - 1
    const chunk: CallResponseChunk = {
      firstBar,
      barCount: lastBar - firstBar + 1,
      noteIndices: [],
      targets: [],
    }

    phrase.notes.forEach((note, idx) => {
      if (note.barIndex < firstBar || note.barIndex > lastBar) return
      chunk.noteIndices.push(idx)
      const last = chunk.targets[chunk.targets.length - 1]
      if (last && (note.isTieContinuation || note.pitchClass === last.pitchClass)) {
        last.noteIndices.push(idx)
        return
      }
      // A tie continuation opening the chunk has nothing to attach to; it's
      // still revealed with the chunk, just never asked for.
      if (note.isTieContinuation) return
      chunk.targets.push({ midi: note.midi, pitchClass: note.pitchClass, noteIndices: [idx] })
    })

    chunks.push(chunk)
  }
  return chunks
}

export type CallResponseMatch =
  | { kind: 'hit'; position: number }
  | { kind: 'done' }
  | { kind: 'miss'; expected: CallResponseTarget }
  | { kind: 'ignore' }

/**
 * Scores one detected pitch class against the target at `position`.
 *
 * A detection matching the target just found is ignored rather than missed:
 * it's the note still sounding (an octave flip, a harmonic) re-reported, and
 * can't be a genuine next note because consecutive targets always differ.
 */
export function matchCallResponse(
  targets: CallResponseTarget[],
  position: number,
  playedPitchClass: number,
): CallResponseMatch {
  const expected = targets[position]
  if (!expected) return { kind: 'ignore' }
  if (playedPitchClass === expected.pitchClass) {
    return position + 1 >= targets.length ? { kind: 'done' } : { kind: 'hit', position: position + 1 }
  }
  if (position > 0 && playedPitchClass === targets[position - 1].pitchClass) {
    return { kind: 'ignore' }
  }
  return { kind: 'miss', expected }
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * abcjs measures a note's length in measures, so a millisecond duration is passed as a fraction of
 * a measure declared to last exactly one second.
 */
const MS_PER_MEASURE = 1000

/** The volume abcjs is given for an audible prompt note, on its 0-127 scale. */
const PROMPT_VOLUME = 85

/**
 * Sound a single target pitch using the abcjs synth.
 *
 * Resolves when the note *starts*, not when it ends: playEvent's promise
 * settles right after buffer.start(), once the soundfont is loaded and primed.
 * A caller that needs to wait out the note has to time that itself.
 *
 * playEvent measures a note's duration in measures, so the milliseconds asked
 * for here are handed over as a fraction of a one-second measure. Passing
 * durationMs/1000 against the default 500ms measure used to sound every note
 * for half its requested length.
 */
export function playTargetNote(midi: number, durationMs = 600, instrument = 110): Promise<void> {
  return new Promise((resolve) => {
    abcjs.synth
      .playEvent(
        [
          {
            pitch: midi,
            volume: PROMPT_VOLUME,
            start: 0,
            duration: durationMs / MS_PER_MEASURE,
            instrument,
            gap: 0,
          },
        ],
        [],
        MS_PER_MEASURE,
      )
      .then(() => resolve())
      .catch(() => resolve())
  })
}

export interface NoteStep {
  midi: number
  durationMs: number
  /** Silence after this note before the next one. Ignored on the last step. */
  gapMs?: number
  /** abcjs velocity, 0-127. Defaults to the prompt volume; a count-in accents its downbeat with it. */
  volume?: number
}

export interface SequencePlayback {
  /** How long the rendered buffer sounds, in ms. */
  durationMs: number
  /** Silences the buffer. Safe to call after it has already finished. */
  stop(): void
}

/**
 * Sound a run of notes, one after the other, as a single rendered buffer.
 *
 * Playing each note with its own playEvent and spacing them with setTimeout looks equivalent and
 * isn't. Every playEvent ends in source.start(0) — "play at the context's current render position"
 * — and a context's clock stays frozen until the output device has finished opening, which on a
 * cold start or a Bluetooth handover takes seconds. JS timers keep running through that window, so
 * notes meant to be seconds apart are all submitted at the same rendered instant and sound on top
 * of each other when the device finally opens.
 *
 * Here the gaps are rendered into the samples instead, so the spacing is a property of the buffer
 * and survives however late the device starts. waitForAudioClock then holds the one start() back
 * until the device is really rendering, so the opening of the first note isn't swallowed either.
 *
 * Resolves once the buffer has *started*; the caller times the music out itself using the returned
 * durationMs. Unlike playTargetNote, a failed soundfont load rejects rather than passing silently.
 */
export async function playNoteSequence(
  steps: NoteStep[],
  instrument = 110,
): Promise<SequencePlayback> {
  const sequence = new abcjs.synth.SynthSequence()
  // addTrack returns the new track's index at runtime; the typings claim it returns the track.
  const track = sequence.addTrack() as unknown as number
  sequence.setInstrument(track, instrument)

  let durationMs = 0
  for (const [index, step] of steps.entries()) {
    sequence.appendNote(track, step.midi, step.durationMs / MS_PER_MEASURE, step.volume ?? PROMPT_VOLUME, 0)
    durationMs += step.durationMs
    const gapMs = index === steps.length - 1 ? 0 : (step.gapMs ?? 0)
    if (gapMs > 0) {
      // SynthSequence has no appendRest, and its per-track cursor only advances by what's appended,
      // so silence has to be a note nobody can hear. Reusing the pitch just played keeps abcjs from
      // fetching a second soundfont sample to render at zero volume.
      sequence.appendNote(track, step.midi, gapMs / MS_PER_MEASURE, 0, 0)
      durationMs += gapMs
    }
  }

  const synth = new abcjs.synth.CreateSynth()
  await synth.init({
    // SynthSequence is what abcjs's own playEvent hands to init, but the typings describe the
    // richer AudioSequence that comes off a tune.
    sequence: sequence as unknown as abcjs.AudioSequence,
    millisecondsPerMeasure: MS_PER_MEASURE,
  })
  await synth.prime()
  await waitForAudioClock()
  synth.start()

  return {
    durationMs,
    stop: () => synth.stop(),
  }
}
