import abcjs from 'abcjs'
import { LETTER_PITCHES, getDefaultAlteration, parseKeyDetails, parseKeySignature } from './abcTools.ts'

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
}

export interface Phrase {
  notes: NoteEvent[]
  excerptAbc: string
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
      notes: chunk.flatMap((bar) => bar.notes),
      excerptAbc: `${excerptHeader}\n${chunk.map((bar) => bar.text).join(' | ')} |]`,
    })
  }

  const totalTargets = phrases.reduce(
    (sum, p) => sum + p.notes.filter((n) => !n.isTieContinuation).length,
    0,
  )
  if (totalTargets === 0) return null

  return { phrases, totalTargets }
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Sound a single target pitch using the abcjs synth; resolves when it ends. */
export function playTargetNote(midi: number, durationMs = 600, instrument = 110): Promise<void> {
  return new Promise((resolve) => {
    abcjs.synth
      .playEvent(
        [{ pitch: midi, volume: 85, start: 0, duration: durationMs / 1000, instrument, gap: 0 }],
        [],
        500,
      )
      .then(() => resolve())
      .catch(() => resolve())
  })
}
