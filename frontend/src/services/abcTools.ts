export const LETTER_PITCHES: Record<string, number> = {
  'c': 0,
  'd': 2,
  'e': 4,
  'f': 5,
  'g': 7,
  'a': 9,
  'b': 11,
}

const ROOT_PITCHES: Record<string, number> = {
  'c': 0,
  'c#': 1,
  'db': 1,
  'd': 2,
  'd#': 3,
  'eb': 3,
  'e': 4,
  'f': 5,
  'f#': 6,
  'gb': 6,
  'g': 7,
  'g#': 8,
  'ab': 8,
  'a': 9,
  'a#': 10,
  'bb': 10,
  'b': 11,
}

/**
 * Distance from the mode's tonic to the major key sharing its signature, in steps around the
 * circle of fifths (E dorian is two flats-ward of E major, i.e. D major's signature).
 *
 * Must stay complete with respect to every canonical value MODE_ALIASES can produce: both
 * transposeAbc and earTraining feed parseKeyDetails' output straight back into
 * parseKeySignature, so a mode this table doesn't know silently falls back to the parallel
 * *major*'s accidentals. Mirrors MajorPitchClass in api/Shared/Services/TuneHeuristics.cs.
 */
const MODE_SHIFTS: Record<string, number> = {
  lyd: 1,
  lydian: 1,
  maj: 0,
  major: 0,
  ion: 0,
  ionian: 0,
  mix: -1,
  mixolydian: -1,
  dor: -2,
  dorian: -2,
  min: -3,
  minor: -3,
  m: -3,
  aeo: -3,
  aeolian: -3,
  phr: -4,
  phrygian: -4,
  loc: -5,
  locrian: -5,
}

const ROOT_TO_SHARPS: Record<string, number> = {
  c: 0,
  'c#': 7,
  db: -5,
  d: 2,
  'd#': -3,
  eb: -3,
  e: 4,
  f: -1,
  'f#': 6,
  gb: -6,
  g: 1,
  'g#': -4,
  ab: -4,
  a: 3,
  'a#': -2,
  bb: -2,
  b: 5,
  cb: -7,
}

/** Every spelling of a mode ABC is written in, mapped to the canonical abbreviation we emit. */
const MODE_ALIASES: Record<string, string> = {
  maj: 'maj',
  major: 'maj',
  ion: 'maj',
  ionian: 'maj',
  min: 'min',
  minor: 'min',
  m: 'min',
  aeo: 'min',
  aeolian: 'min',
  mix: 'mix',
  mixolydian: 'mix',
  dor: 'dor',
  dorian: 'dor',
  phr: 'phr',
  phrygian: 'phr',
  lyd: 'lyd',
  lydian: 'lyd',
  loc: 'loc',
  locrian: 'loc',
}

/**
 * Resolves a mode suffix against a lookup table, longest matching alias first.
 *
 * The length ordering is the point, not a detail: these tables are scanned by prefix, so a
 * short entry that happens to prefix a longer one shadows it entirely if it is reached first.
 * That is what made every mixolydian tune parse as minor — 'm' sat above 'mix', so "mix"
 * matched 'm' and stopped. Picking the longest match makes the result independent of the
 * order the entries happen to be declared in.
 */
function matchMode<T>(modeText: string, table: Record<string, T>): T | undefined {
  const clean = modeText.toLowerCase().replace(/\s+/g, '')
  if (!clean) return undefined

  let bestAlias: string | undefined
  for (const alias of Object.keys(table)) {
    if (clean.startsWith(alias) && (bestAlias === undefined || alias.length > bestAlias.length)) {
      bestAlias = alias
    }
  }
  return bestAlias === undefined ? undefined : table[bestAlias]
}

export function parseKeySignature(kStr: string): { root: string; sharps: number } | null {
  kStr = kStr.trim().toLowerCase()
  const match = kStr.match(/^([a-g][#b]?)(.*)$/)
  if (!match) return null

  const root = match[1]
  const modePart = match[2].trim()

  const baseSharps = ROOT_TO_SHARPS[root]
  if (baseSharps === undefined) return null

  // An unrecognized suffix falls back to major, the same as no suffix at all.
  const modeShift = modePart ? matchMode(modePart, MODE_SHIFTS) ?? 0 : 0

  return { root, sharps: baseSharps + modeShift }
}

export function parseKeyDetails(kStr: string) {
  kStr = kStr.trim()
  const match = kStr.match(/^([A-Ga-g][#b]?)(.*)$/)
  if (!match) return null

  const root = match[1]
  const modeStr = match[2].trim()

  const rootKey = root.toLowerCase()
  const rootPitch = ROOT_PITCHES[rootKey]
  if (rootPitch === undefined) return null

  const mode = matchMode(modeStr, MODE_ALIASES) ?? 'maj'

  return { root, mode, rootPitch }
}

export function getDefaultAlteration(letter: string, sharps: number): number {
  const sharpsOrder = ['f', 'c', 'g', 'd', 'a', 'e', 'b']
  const flatsOrder = ['b', 'e', 'a', 'd', 'g', 'c', 'f']
  const l = letter.toLowerCase()

  if (sharps > 0) {
    const sharped = sharpsOrder.slice(0, sharps)
    if (sharped.includes(l)) return 1
  } else if (sharps < 0) {
    const flatted = flatsOrder.slice(0, -sharps)
    if (flatted.includes(l)) return -1
  }
  return 0
}

function getPitchSpelling(pitchClass: number, sharps: number): string {
  const flatSpellings = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

  if (sharps < 0) {
    return flatSpellings[pitchClass]
  } else {
    const hybrid = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
    return hybrid[pitchClass]
  }
}

function midiToAbcNote(midi: number, newSharps: number): string {
  const pitchClass = ((midi % 12) + 12) % 12
  const targetOctave = Math.floor(midi / 12) - 1

  let bestLetter = ''
  let bestVal = 999

  const letters = ['c', 'd', 'e', 'f', 'g', 'a', 'b']
  for (const letter of letters) {
    const basePC = LETTER_PITCHES[letter]
    let needed = pitchClass - basePC
    if (needed > 6) needed -= 12
    if (needed < -6) needed += 12

    // A black key sits a semitone from two letters, so the accidental count ties and the key
    // signature decides: in a flat key Db is _D, not the ^C the letter order would otherwise pick.
    const tie = Math.abs(needed) === Math.abs(bestVal)
    const preferred = tie && (newSharps < 0 ? needed < bestVal : needed > bestVal)
    if (Math.abs(needed) < Math.abs(bestVal) || preferred) {
      bestVal = needed
      bestLetter = letter
    }
  }

  const defAlt = getDefaultAlteration(bestLetter, newSharps)
  let bestAccidental = ''
  if (bestVal === defAlt) {
    bestAccidental = ''
  } else {
    if (bestVal === 0) bestAccidental = '='
    else if (bestVal === 1) bestAccidental = '^'
    else if (bestVal === 2) bestAccidental = '^^'
    else if (bestVal === -1) bestAccidental = '_'
    else if (bestVal === -2) bestAccidental = '__'
  }

  let noteChar = bestLetter
  if (targetOctave === 4) {
    noteChar = bestLetter.toUpperCase()
  } else if (targetOctave === 5) {
    noteChar = bestLetter.toLowerCase()
  } else if (targetOctave < 4) {
    noteChar = bestLetter.toUpperCase() + ','.repeat(4 - targetOctave)
  } else {
    noteChar = bestLetter.toLowerCase() + "'".repeat(targetOctave - 5)
  }

  return bestAccidental + noteChar
}

function transposeLine(line: string, interval: number, oldSharps: number, newSharps: number): string {
  if (line.trim().startsWith('%')) return line
  if (/^[A-HJ-Za-hj-z]:/.test(line.trim())) return line

  let result = ''
  let i = 0
  while (i < line.length) {
    const char = line[i]

    if (char === '"') {
      result += '"'
      i++
      let chordContent = ''
      while (i < line.length && line[i] !== '"') {
        chordContent += line[i]
        i++
      }

      const chordMatch = chordContent.match(/^([A-G][#b]?)(.*)$/)
      if (chordMatch) {
        const root = chordMatch[1]
        const suffix = chordMatch[2]
        const rootKey = root.toLowerCase()
        const pitch = ROOT_PITCHES[rootKey]
        if (pitch !== undefined) {
          const newPitch = (pitch + interval + 12) % 12
          const newRoot = getPitchSpelling(newPitch, newSharps)
          result += newRoot + suffix
        } else {
          result += chordContent
        }
      } else {
        result += chordContent
      }
      if (i < line.length) {
        result += '"'
        i++
      }
      continue
    }

    if (char === '[') {
      let bracketContent = ''
      result += '['
      i++
      while (i < line.length && line[i] !== ']') {
        bracketContent += line[i]
        i++
      }
      if (bracketContent.includes(':')) {
        result += bracketContent
      } else {
        result += transposeLine(bracketContent, interval, oldSharps, newSharps)
      }
      if (i < line.length) {
        result += ']'
        i++
      }
      continue
    }

    const noteMatch = line.slice(i).match(/^([\^=_]*)([A-Ga-g])([,']*)/)
    if (noteMatch) {
      const fullMatch = noteMatch[0]
      const accidentals = noteMatch[1]
      const letter = noteMatch[2]
      const octaves = noteMatch[3]

      const basePitch = LETTER_PITCHES[letter.toLowerCase()]
      let midi = 60 + basePitch
      if (letter === letter.toLowerCase()) {
        midi += 12
      }
      for (const oct of octaves) {
        if (oct === "'") midi += 12
        if (oct === ',') midi -= 12
      }

      let alteration = 0
      if (accidentals) {
        if (accidentals === '^') alteration = 1
        else if (accidentals === '^^') alteration = 2
        else if (accidentals === '_') alteration = -1
        else if (accidentals === '__') alteration = -2
        else if (accidentals === '=') alteration = 0
      } else {
        alteration = getDefaultAlteration(letter, oldSharps)
      }

      const origMidi = midi + alteration
      const newMidi = origMidi + interval

      const newNoteStr = midiToAbcNote(newMidi, newSharps)
      result += newNoteStr

      i += fullMatch.length
    } else {
      result += char
      i++
    }
  }

  return result
}

/**
 * Every spelling of a pitch class we are willing to name a key after, best-first.
 *
 * Deliberately narrower than ROOT_PITCHES: it omits D#, G# and A#, whose ROOT_TO_SHARPS entries
 * carry their flat twins' signatures rather than their own (D# major is nine sharps, not three
 * flats), so choosing one would name a key whose accidentals we then get wrong. Where two honest
 * spellings exist the mode decides between them, and the first entry breaks a tie.
 */
const KEY_ROOT_SPELLINGS: Record<number, string[]> = {
  0: ['C'],
  1: ['Db', 'C#'],
  2: ['D'],
  3: ['Eb'],
  4: ['E'],
  5: ['F'],
  6: ['F#', 'Gb'],
  7: ['G'],
  8: ['Ab'],
  9: ['A'],
  10: ['Bb'],
  11: ['B', 'Cb'],
}

/**
 * Names a pitch class as a key root, picking the spelling that gives the mode the fewest
 * accidentals — C# dorian (five sharps) rather than Db dorian (seven flats).
 */
function spellKeyRoot(pitchClass: number, mode: string): string {
  const candidates = KEY_ROOT_SPELLINGS[pitchClass] ?? ['C']
  const modeShift = MODE_SHIFTS[mode] ?? 0

  let best = candidates[0]
  let bestSharps = Math.abs((ROOT_TO_SHARPS[best.toLowerCase()] ?? 0) + modeShift)
  for (const candidate of candidates.slice(1)) {
    const sharps = Math.abs((ROOT_TO_SHARPS[candidate.toLowerCase()] ?? 0) + modeShift)
    if (sharps < bestSharps) {
      best = candidate
      bestSharps = sharps
    }
  }
  return best
}

function findKeyLine(lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.toLowerCase().startsWith('k:')) {
      return { keyLineIdx: i, keyDetails: parseKeyDetails(line.slice(2).trim()) }
    }
  }
  return { keyLineIdx: -1, keyDetails: null as ReturnType<typeof parseKeyDetails> }
}

/**
 * Rewrites the key header and shifts every note by `semitones`.
 *
 * The header is derived from `newKeyStr` rather than from the interval, so a caller shifting by a
 * whole number of octaves passes the unchanged key back in and only the notes move.
 */
function renderTransposed(
  lines: string[],
  keyLineIdx: number,
  semitones: number,
  newKeyStr: string,
  oldSharps: number,
  newSharps: number,
): string {
  return lines
    .map((line, idx) => {
      if (idx === keyLineIdx) {
        const match = lines[idx].match(/^([Kk]:\s*)[^%]*(.*)$/)
        if (match) {
          return `${match[1]}${newKeyStr}${match[2]}`
        }
        return `K:${newKeyStr}`
      }
      return transposeLine(line, semitones, oldSharps, newSharps)
    })
    .join('\n')
}

/**
 * Shifts a tune by a signed number of semitones, keeping direction and distance exactly as asked.
 *
 * Unlike transposeAbc, which is handed a destination key and always takes the shorter way round,
 * this preserves the octave the caller is steering toward: twelve steps the same direction is a
 * clean octave, and ±12 leaves the key header alone while every note moves.
 */
export function transposeAbcBySemitones(abcText: string, semitones: number): string {
  if (semitones === 0) return abcText

  const lines = abcText.split('\n')
  const { keyLineIdx, keyDetails } = findKeyLine(lines)

  const oldRoot = keyDetails ? keyDetails.root : 'C'
  const oldMode = keyDetails ? keyDetails.mode : 'maj'
  const oldRootPitch = keyDetails ? keyDetails.rootPitch : 0
  const oldSharps = parseKeySignature(oldRoot + oldMode)?.sharps ?? 0

  const newRootPitch = (((oldRootPitch + semitones) % 12) + 12) % 12
  const newKeyStr = spellKeyRoot(newRootPitch, oldMode) + (oldMode === 'maj' ? '' : oldMode)
  const newSharps = parseKeySignature(newKeyStr)?.sharps ?? 0

  return renderTransposed(lines, keyLineIdx, semitones, newKeyStr, oldSharps, newSharps)
}

export function transposeAbc(abcText: string, targetRoot: string): string {
  const lines = abcText.split('\n')
  const { keyLineIdx, keyDetails } = findKeyLine(lines)

  const oldRoot = keyDetails ? keyDetails.root : 'C'
  const oldMode = keyDetails ? keyDetails.mode : 'maj'
  const oldRootPitch = keyDetails ? keyDetails.rootPitch : 0
  const oldSharps = parseKeySignature(oldRoot + oldMode)?.sharps ?? 0

  const targetRootKey = targetRoot.toLowerCase()
  const targetRootPitch = ROOT_PITCHES[targetRootKey]
  if (targetRootPitch === undefined) return abcText

  const interval = (targetRootPitch - oldRootPitch + 12) % 12
  let finalInterval = interval
  if (finalInterval > 6) {
    finalInterval -= 12
  }

  const newRootFormatted = targetRoot.charAt(0).toUpperCase() + targetRoot.slice(1).toLowerCase()
  const newKeyStr = newRootFormatted + (oldMode === 'maj' ? '' : oldMode)
  const newSharps = parseKeySignature(newKeyStr)?.sharps ?? 0

  return renderTransposed(lines, keyLineIdx, finalInterval, newKeyStr, oldSharps, newSharps)
}

function foldNoteLine(line: string, minMidi: number, maxMidi: number, sharps: number): string {
  if (line.trim().startsWith('%')) return line
  if (/^[A-HJ-Za-hj-z]:/.test(line.trim())) return line

  let result = ''
  let i = 0
  while (i < line.length) {
    const char = line[i]

    if (char === '"') {
      result += '"'
      i++
      while (i < line.length && line[i] !== '"') {
        result += line[i]
        i++
      }
      if (i < line.length) {
        result += '"'
        i++
      }
      continue
    }

    if (char === '[') {
      let bracketContent = ''
      result += '['
      i++
      while (i < line.length && line[i] !== ']') {
        bracketContent += line[i]
        i++
      }
      if (bracketContent.includes(':')) {
        result += bracketContent
      } else {
        result += foldNoteLine(bracketContent, minMidi, maxMidi, sharps)
      }
      if (i < line.length) {
        result += ']'
        i++
      }
      continue
    }

    const noteMatch = line.slice(i).match(/^([\^=_]*)([A-Ga-g])([,']*)/)
    if (noteMatch) {
      const fullMatch = noteMatch[0]
      const accidentals = noteMatch[1]
      const letter = noteMatch[2]
      const octaves = noteMatch[3]

      const basePitch = LETTER_PITCHES[letter.toLowerCase()]
      let midi = 60 + basePitch
      if (letter === letter.toLowerCase()) {
        midi += 12
      }
      for (const oct of octaves) {
        if (oct === "'") midi += 12
        if (oct === ',') midi -= 12
      }

      let alteration = 0
      if (accidentals) {
        if (accidentals === '^') alteration = 1
        else if (accidentals === '^^') alteration = 2
        else if (accidentals === '_') alteration = -1
        else if (accidentals === '__') alteration = -2
        else if (accidentals === '=') alteration = 0
      } else {
        alteration = getDefaultAlteration(letter, sharps)
      }

      const origMidi = midi + alteration
      let newMidi = origMidi

      if (newMidi < minMidi) {
        while (newMidi < minMidi) {
          if (newMidi + 12 > maxMidi) break
          newMidi += 12
        }
      } else if (newMidi > maxMidi) {
        while (newMidi > maxMidi) {
          if (newMidi - 12 < minMidi) break
          newMidi -= 12
        }
      }

      const newNoteStr = midiToAbcNote(newMidi, sharps)
      result += newNoteStr

      i += fullMatch.length
    } else {
      result += char
      i++
    }
  }

  return result
}

export function foldAbcOctaves(abcText: string, minMidi: number, maxMidi: number): string {
  const lines = abcText.split('\n')
  let sharps = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.toLowerCase().startsWith('k:')) {
      const kStr = line.slice(2).trim()
      const keyDetails = parseKeyDetails(kStr)
      if (keyDetails) {
        sharps = parseKeySignature(keyDetails.root + keyDetails.mode)?.sharps ?? 0
      }
      break
    }
  }

  const foldedLines = lines.map((line) => {
    return foldNoteLine(line, minMidi, maxMidi, sharps)
  })

  return foldedLines.join('\n')
}

export function fixAbcRepeats(abc: string): string {
  const lines = abc.split('\n')
  const headers: string[] = []
  const musicLines: string[] = []
  
  let inHeader = true
  for (const line of lines) {
    if (inHeader && /^[A-Z]:/.test(line.trim())) {
      headers.push(line)
      if (line.trim().startsWith('K:')) {
        inHeader = false
      }
    } else {
      musicLines.push(line)
    }
  }
  
  const musicText = musicLines.join('\n')
  let fixedMusicText = ''
  let lastBarrierPos = 0
  let hasStartRepeat = false
  
  let i = 0
  while (i < musicText.length) {
    if (musicText.substring(i).startsWith('|:')) {
      hasStartRepeat = true
      fixedMusicText += '|:'
      i += 2
    } else if (musicText.substring(i).startsWith(':|')) {
      if (!hasStartRepeat) {
        const insertOffset = fixedMusicText.length - (i - lastBarrierPos)
        let nonWsOffset = insertOffset
        while (nonWsOffset < fixedMusicText.length && /\s/.test(fixedMusicText[nonWsOffset])) {
          nonWsOffset++
        }
        fixedMusicText = fixedMusicText.substring(0, nonWsOffset) + '|:' + fixedMusicText.substring(nonWsOffset)
        hasStartRepeat = true
      }
      hasStartRepeat = false
      fixedMusicText += ':|'
      i += 2
      lastBarrierPos = i
    } else if (musicText.substring(i).startsWith('||') || musicText.substring(i).startsWith('[|') || musicText.substring(i).startsWith('|]')) {
      hasStartRepeat = false
      fixedMusicText += musicText.substring(i, i + 2)
      i += 2
      lastBarrierPos = i
    } else {
      fixedMusicText += musicText[i]
      i++
    }
  }
  
  return [...headers, fixedMusicText].join('\n')
}

export function extractKeyFromAbc(abcText: string): string {
  if (!abcText) return ''
  const lines = abcText.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^K:/i.test(trimmed)) {
      const rawKey = trimmed.slice(2).trim().split('%')[0].trim().split(/\s+/)[0]
      if (rawKey) {
        let k = rawKey
        const lower = k.toLowerCase()
        if (lower.endsWith('major')) k = k.slice(0, -5)
        else if (lower.endsWith('minor')) k = k.slice(0, -5) + 'm'
        else if (lower.endsWith('dorian')) k = k.slice(0, -6) + 'dor'
        else if (lower.endsWith('mixolydian')) k = k.slice(0, -10) + 'mix'
        else if (lower.endsWith('phrygian')) k = k.slice(0, -8) + 'phr'
        else if (lower.endsWith('lydian')) k = k.slice(0, -6) + 'lyd'
        return k
      }
    }
  }
  return ''
}

export function extractTitleFromAbc(abcText: string): string {
  if (!abcText) return ''
  const lines = abcText.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^T:/i.test(trimmed)) {
      return trimmed.slice(2).trim().split('%')[0].trim()
    }
  }
  return ''
}

export function validateAbc(abcText: string): { isValid: boolean; error?: string; trimmedAbc: string } {
  const trimmedAbc = (abcText || '').trim()
  if (!trimmedAbc) {
    return { isValid: false, error: 'ABC notation text cannot be empty.', trimmedAbc }
  }

  const lines = trimmedAbc.split('\n')
  let hasKeyHeader = false
  let hasNotesOrBars = false

  for (const line of lines) {
    const t = line.trim()
    if (/^K:/i.test(t)) {
      const keyVal = t.slice(2).trim().split('%')[0].trim()
      if (keyVal.length > 0) {
        hasKeyHeader = true
      }
    } else if (!/^[A-Z]:/.test(t) && !t.startsWith('%')) {
      if (/[a-gA-G|]/.test(t)) {
        hasNotesOrBars = true
      }
    }
  }

  if (!hasKeyHeader) {
    return {
      isValid: false,
      error: 'ABC notation must include a Key header (e.g. K:G or K:Ddor).',
      trimmedAbc,
    }
  }

  if (!hasNotesOrBars) {
    return {
      isValid: false,
      error: 'ABC notation does not contain any music notes or bar lines.',
      trimmedAbc,
    }
  }

  return { isValid: true, trimmedAbc }
}

/**
 * Normalizes a tune title for alphabetical sorting by stripping leading articles ("The ", "A ", "An ").
 */
export function normalizeTitleForSorting(title: string): string {
  const lower = (title || '').trim().toLowerCase()
  if (lower.startsWith('the ')) return lower.slice(4).trim()
  if (lower.startsWith('a ')) return lower.slice(2).trim()
  if (lower.startsWith('an ')) return lower.slice(3).trim()
  return lower
}
