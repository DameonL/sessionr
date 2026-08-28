import type abcjs from 'abcjs'

/**
 * Unrolls a tune's repetitions into a single linear ABC, so playback can run from one continuous
 * audio buffer instead of restarting the same buffer once per pass.
 *
 * abcjs sizes its audio buffer from the flattened tune's total duration *before* sequenceCallback
 * runs, and MidiBuffer.start() takes no scheduled start time — so there is no way to append passes
 * to an existing buffer or to hand one off gaplessly to the next. The only route to gapless repeats
 * is to hand the synth an ABC that already contains every pass.
 *
 * Internal `|: :|` repeats and `|1 |2` endings are left exactly as written: abcjs's own flattener
 * expands those within each copy. What this module adds is the *outer* repetition, and with it the
 * two questions abcjs has no opinion about — what to do with a lead-in before the first repeat and a
 * lead-out after the last one.
 */

export interface PlaybackAbc {
  abc: string
  /** Number of passes the ABC contains. */
  passes: number
  /**
   * Whether passes after the first start without the lead-in, and are therefore shorter than the
   * displayed tune by exactly its pickup. The player needs this to keep the cursor, the position
   * bar and the audio clock agreeing.
   */
  leadInStripped: boolean
}

export interface AbcParts {
  /** Everything up to and including the K: line, emitted once. */
  headers: string
  /** Anacrusis before the first `|:`. Empty when there isn't one, or when it isn't safe to detect. */
  leadIn: string
  /** The repeated body. */
  core: string
  /** Trailing coda after the final sectional barline. Empty unless safely detected. */
  leadOut: string
}

type BarKind = 'plain' | 'sectional'

interface BarToken {
  start: number
  end: number
  kind: BarKind
}

/**
 * Barline tokens, longest first so `||:` never matches as `||`. A "sectional" bar is one that
 * delimits a repeated or terminal section; a bare `|` is just a bar division. Only sectional bars
 * are treated as boundaries for the lead-in and lead-out, because a plain `|` carries no structural
 * meaning and stripping across one would amputate real bars.
 */
const BAR_TOKENS: Array<[string, BarKind]> = [
  ['[|:', 'sectional'],
  ['||:', 'sectional'],
  [':||', 'sectional'],
  [':|]', 'sectional'],
  ['::', 'sectional'],
  [':|', 'sectional'],
  ['|:', 'sectional'],
  ['|]', 'sectional'],
  ['||', 'sectional'],
  ['[|', 'sectional'],
  ['|', 'plain'],
]

/** Every barline in `text`, in order. `:` and `|` inside inline fields or chords match nothing here. */
function findBarTokens(text: string): BarToken[] {
  const tokens: BarToken[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '|' || ch === ':' || ch === '[') {
      const match = BAR_TOKENS.find(([token]) => text.startsWith(token, i))
      if (match) {
        tokens.push({ start: i, end: i + match[0].length, kind: match[1] })
        i += match[0].length
        continue
      }
    }
    i++
  }
  return tokens
}

/** Index just past the header block — the K: line if there is one, otherwise the leading `X:`-style lines. */
function headerEnd(abc: string): number {
  let offset = 0
  let end = 0
  for (const line of abc.split('\n')) {
    if (!/^[A-Za-z]:/.test(line.trim())) break
    offset += line.length + 1
    end = offset
    if (/^K:/i.test(line.trim())) break
  }
  return Math.min(end, abc.length)
}

/** A variant ending (`|1`, `[2`, `:|2`) is part of the tune, never a lead-out. */
function startsVariantEnding(text: string): boolean {
  return /^\s*\[?\s*\d/.test(text)
}

/**
 * Splits an ABC into the parts the unroller repeats and the parts it doesn't.
 *
 * Both the lead-in and the lead-out are detected conservatively: when the shape is at all ambiguous
 * they come back empty and the whole body becomes `core`, which reproduces today's behaviour rather
 * than risking a stripped bar.
 */
export function splitAbcForUnroll(abc: string): AbcParts {
  const bodyStart = headerEnd(abc)
  const headers = abc.slice(0, bodyStart)
  const body = abc.slice(bodyStart)
  const tokens = findBarTokens(body)

  let leadInEnd = 0
  // The pickup runs up to the first start-repeat, or to the first barline of any kind in a tune
  // written without repeat marks.
  const boundary = tokens.find((t) => /^(\|\||\[\|)?\|:/.test(body.slice(t.start, t.end))) ?? tokens[0]
  if (boundary) {
    const pre = body.slice(0, boundary.start)
    // A lead-in is by definition the pickup before the very first barline. If any barline precedes
    // the boundary, the material ahead of it is real bars — a first section that simply isn't
    // repeated — and must not be stripped.
    if (pre.trim() !== '' && !tokens.some((t) => t.start < boundary.start)) {
      leadInEnd = boundary.start
    }
  }

  let leadOutStart = body.length
  const sectionals = tokens.filter((t) => t.kind === 'sectional')
  if (sectionals.length > 0) {
    const last = sectionals[sectionals.length - 1]
    const afterLast = body.slice(last.end)
    if (afterLast.trim() !== '') {
      // Material after the final sectional bar — a coda, if it holds no bars of its own.
      if (!findBarTokens(afterLast).length && !startsVariantEnding(afterLast)) {
        leadOutStart = last.end
      }
    } else if (sectionals.length > 1) {
      // The tune is properly terminated (`||`, `|]`), so any coda sits between the previous
      // sectional bar and that terminator. Carry the terminator along with it.
      const prev = sectionals[sectionals.length - 2]
      const between = body.slice(prev.end, last.start)
      if (between.trim() !== '' && !findBarTokens(between).length && !startsVariantEnding(between)) {
        leadOutStart = prev.end
      }
    }
  }

  if (leadOutStart <= leadInEnd) leadOutStart = body.length

  return {
    headers,
    leadIn: body.slice(0, leadInEnd),
    core: body.slice(leadInEnd, leadOutStart),
    leadOut: body.slice(leadOutStart),
  }
}

/**
 * Whether the lead-in should keep playing on every pass.
 *
 * A genuine anacrusis is compensated by a truncated final bar, so the tune's total length comes out
 * to a whole number of measures — dropping the pickup on a repeat would leave that final bar short.
 * A decorative lead-in (The Cowboy's `BA|:`) sits on top of a whole number of complete bars, so the
 * total runs over by exactly the pickup's length, and replaying it on every pass adds beats that
 * aren't in the tune. Comparing the leftover against the pickup tells the two apart, and holds
 * whether or not getTotalTime() has the internal repeats folded in, since those only add whole bars.
 */
const MEASURE_TOLERANCE = 0.02

export function shouldKeepLeadIn(visualObj: abcjs.TuneObject): boolean {
  try {
    const meter = visualObj.getMeterFraction()
    const meterSize = meter?.den ? meter.num / meter.den : 0
    const pickup = visualObj.getPickupLength()
    if (!meterSize || !pickup) return true

    const msPerMeasure = visualObj.millisecondsPerMeasure(visualObj.getBpm())
    if (!msPerMeasure) return true
    // getTotalTime() is undefined until the tune has been timed, and an untimed object would
    // silently answer "keep" for every tune.
    if (typeof visualObj.getTotalTime() !== 'number') {
      ;(visualObj as unknown as { setTiming(bpm?: number): unknown }).setTiming(visualObj.getBpm())
    }
    const measures = (visualObj.getTotalTime() * 1000) / msPerMeasure
    if (!Number.isFinite(measures)) return true

    const pickupMeasures = pickup / meterSize
    // A pickup is by definition shorter than a bar. When abcjs reports a whole measure or more the
    // tune simply has no repeat marks and no anacrusis — its first bar is a bar, not a lead-in.
    if (pickupMeasures >= 1 - MEASURE_TOLERANCE) return true

    const leftover = measures - Math.floor(measures)
    return Math.abs(leftover - pickupMeasures) > MEASURE_TOLERANCE
  } catch {
    return true
  }
}

/**
 * Builds the ABC that playback runs from: `repetitions` copies of the tune, back to back.
 *
 * The lead-in always plays on the first pass (it is the start of the tune) and the lead-out always
 * plays on the last (it is the end); in between, each is emitted only where it belongs. With
 * `repetitions === 1` the result is the input unchanged but for trailing whitespace, so the common
 * single-pass case costs nothing.
 */
export function buildPlaybackAbc(
  abc: string,
  repetitions: number,
  { keepLeadIn }: { keepLeadIn: boolean },
): PlaybackAbc {
  const passes = Math.max(1, Math.floor(repetitions))
  const parts = splitAbcForUnroll(abc)
  const leadInStripped = !keepLeadIn && parts.leadIn.trim() !== '' && passes > 1

  const copies: string[] = []
  for (let pass = 1; pass <= passes; pass++) {
    copies.push(
      (pass === 1 || !leadInStripped ? parts.leadIn : '') + parts.core + (pass === passes ? parts.leadOut : ''),
    )
  }

  // Copies are verbatim slices, so `…G3||` butted straight against `|:GDE…` would read as one long
  // barline. A newline is a legal bar separator in ABC and keeps the two apart — but only one: a
  // slice that already ends in a newline would otherwise leave a blank line between copies, and a
  // blank line ends the tune, so abcjs would silently drop every pass after the first.
  const body = copies.map((copy) => copy.replace(/\s+$/, '')).join('\n')
  return { abc: parts.headers + body + '\n', passes, leadInStripped }
}
