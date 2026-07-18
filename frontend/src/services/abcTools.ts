const LETTER_PITCHES: Record<string, number> = {
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

const MODE_SHIFTS: Record<string, number> = {
  maj: 0,
  major: 0,
  mix: -1,
  mixolydian: -1,
  dor: -2,
  dorian: -2,
  min: -3,
  minor: -3,
  aeolian: -3,
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

const MODE_ALIASES: Record<string, string> = {
  maj: 'maj',
  major: 'maj',
  min: 'min',
  minor: 'min',
  m: 'min',
  mix: 'mix',
  mixolydian: 'mix',
  dor: 'dor',
  dorian: 'dor',
  aeolian: 'min',
  phrygian: 'phr',
  lydian: 'lyd',
}

function parseKeySignature(kStr: string): { root: string; sharps: number } | null {
  kStr = kStr.trim().toLowerCase()
  const match = kStr.match(/^([a-g][#b]?)(.*)$/)
  if (!match) return null

  const root = match[1]
  const modePart = match[2].trim()

  const baseSharps = ROOT_TO_SHARPS[root]
  if (baseSharps === undefined) return null

  let modeShift = 0
  if (modePart) {
    for (const [mName, shift] of Object.entries(MODE_SHIFTS)) {
      if (modePart.startsWith(mName)) {
        modeShift = shift
        break
      }
    }
  }

  return { root, sharps: baseSharps + modeShift }
}

function parseKeyDetails(kStr: string) {
  kStr = kStr.trim()
  const match = kStr.match(/^([A-Ga-g][#b]?)(.*)$/)
  if (!match) return null

  const root = match[1]
  const modeStr = match[2].trim()

  const rootKey = root.toLowerCase()
  const rootPitch = ROOT_PITCHES[rootKey]
  if (rootPitch === undefined) return null

  let mode = 'maj'
  const cleanMode = modeStr.toLowerCase().replace(/\s+/g, '')
  for (const [alias, canonical] of Object.entries(MODE_ALIASES)) {
    if (cleanMode.startsWith(alias)) {
      mode = canonical
      break
    }
  }

  return { root, mode, rootPitch }
}

function getDefaultAlteration(letter: string, sharps: number): number {
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

    if (Math.abs(needed) < Math.abs(bestVal)) {
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

export function transposeAbc(abcText: string, targetRoot: string): string {
  const lines = abcText.split('\n')
  let keyLineIdx = -1
  let keyDetails: ReturnType<typeof parseKeyDetails> = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.toLowerCase().startsWith('k:')) {
      keyLineIdx = i
      const kStr = line.slice(2).trim()
      keyDetails = parseKeyDetails(kStr)
      break
    }
  }

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

  const transposedLines = lines.map((line, idx) => {
    if (idx === keyLineIdx) {
      const match = lines[idx].match(/^([Kk]:\s*)[^%]*(.*)$/)
      if (match) {
        return `${match[1]}${newKeyStr}${match[2]}`
      }
      return `K:${newKeyStr}`
    }
    return transposeLine(line, finalInterval, oldSharps, newSharps)
  })

  return transposedLines.join('\n')
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
