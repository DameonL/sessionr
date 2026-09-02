import { describe, it, expect } from 'vitest'
import {
  parseKeySignature,
  parseKeyDetails,
  getDefaultAlteration,
  transposeAbc,
  transposeAbcBySemitones,
  extractKeyFromAbc,
  extractTitleFromAbc,
  extractComposerFromAbc,
  extractRhythmFromAbc,
  extractTuneTypeFromAbc,
  normalizeAbcHeaders,
  validateAbc,
  normalizeTitleForSorting,
  fixAbcRepeats,
  foldAbcOctaves,
} from './abcTools'

describe('parseKeySignature', () => {
  it.each([
    ['C', 0],
    ['G', 1],
    ['D', 2],
    ['A', 3],
    ['F', -1],
    ['Bb', -2],
  ])('reads %s as %i sharps', (key, sharps) => {
    expect(parseKeySignature(key)?.sharps).toBe(sharps)
  })

  it.each([
    // Every mode of C, which must all come back as C major's empty signature.
    ['Ddor', 'C'],
    ['Emix', 'A'],
    ['Amin', 'C'],
    ['Em', 'G'],
    ['Ephr', 'C'],
    ['Flyd', 'C'],
    ['Bloc', 'C'],
    ['Cion', 'C'],
    ['Aaeolian', 'C'],
    ['Edor', 'D'],
    ['Amix', 'D'],
  ])('gives %s the same signature as %s major', (modal, parentMajor) => {
    expect(parseKeySignature(modal)?.sharps).toBe(parseKeySignature(parentMajor)?.sharps)
  })

  it.each([
    ['Em', 'Emin'],
    ['Emin', 'Eminor'],
    ['Eaeo', 'Eaeolian'],
    ['Edor', 'Edorian'],
    ['Amix', 'Amixolydian'],
    ['Ephr', 'Ephrygian'],
    ['Flyd', 'Flydian'],
    ['Bloc', 'Blocrian'],
  ])('reads the abbreviation %s the same as %s', (short, long) => {
    expect(parseKeySignature(short)?.sharps).toBe(parseKeySignature(long)?.sharps)
  })

  it('does not let a short mode name shadow a longer one that starts with it', () => {
    // Regression: 'm' (minor) sat above 'mix' in the lookup, so "mix" matched 'm' first and
    // every mixolydian key was read — and transposed — as minor.
    expect(parseKeySignature('Amix')?.sharps).not.toBe(parseKeySignature('Amin')?.sharps)
    expect(parseKeySignature('Amix')?.sharps).toBe(parseKeySignature('D')?.sharps)
  })

  it('treats an unrecognized mode suffix as major', () => {
    expect(parseKeySignature('Dwhatever')?.sharps).toBe(parseKeySignature('D')?.sharps)
  })

  it('is case insensitive', () => {
    expect(parseKeySignature('edor')?.sharps).toBe(parseKeySignature('EDor')?.sharps)
  })

  it.each(['', 'H', 'xyz', '7'])('returns null for the unparseable %s', (key) => {
    expect(parseKeySignature(key)).toBeNull()
  })
})

describe('parseKeyDetails', () => {
  it('splits a key into its root, mode and pitch', () => {
    expect(parseKeyDetails('Edor')).toEqual({ root: 'E', mode: 'dor', rootPitch: 4 })
  })

  it.each([
    ['Amix', 'mix'],
    ['Amixolydian', 'mix'],
    ['Edor', 'dor'],
    ['Em', 'min'],
    ['Emin', 'min'],
    ['Eaeolian', 'min'],
    ['Ephr', 'phr'],
    ['Ephrygian', 'phr'],
    ['Flyd', 'lyd'],
    ['Flydian', 'lyd'],
    ['Bloc', 'loc'],
    ['Cion', 'maj'],
  ])('reads the mode of %s as %s', (key, mode) => {
    expect(parseKeyDetails(key)?.mode).toBe(mode)
  })

  it('does not read a mixolydian key as minor', () => {
    // The bug this guards: transposing K:Amix used to emit K:Dmin, changing the tune's mode.
    expect(parseKeyDetails('Amix')?.mode).toBe('mix')
  })

  it('understands every canonical mode it emits', () => {
    // The invariant that broke: transposeAbc and earTraining both feed this function's output
    // straight back into parseKeySignature, so any mode spelled here must be one that
    // parseKeySignature also knows — otherwise it silently degrades to the parallel major.
    const canonicalModes = ['maj', 'min', 'mix', 'dor', 'phr', 'lyd', 'loc']

    for (const mode of canonicalModes) {
      const emitted = parseKeyDetails('D' + mode)
      expect(emitted?.mode).toBe(mode)

      const roundTripped = parseKeySignature('D' + mode)
      expect(roundTripped).not.toBeNull()
      // Only major shares a signature with plain D; every other mode must differ from it.
      if (mode !== 'maj') {
        expect(roundTripped!.sharps).not.toBe(parseKeySignature('D')!.sharps)
      }
    }
  })

  it('treats a bare root as major', () => {
    expect(parseKeyDetails('G')?.mode).toBe('maj')
  })

  it('keeps the root spelled as written', () => {
    expect(parseKeyDetails('Bb')?.root).toBe('Bb')
  })

  it.each(['', 'H', 'nonsense'])('returns null for %s', (key) => {
    expect(parseKeyDetails(key)).toBeNull()
  })
})

describe('getDefaultAlteration', () => {
  it('sharpens notes covered by a sharp signature', () => {
    // D major: F# and C#.
    expect(getDefaultAlteration('f', 2)).toBe(1)
    expect(getDefaultAlteration('c', 2)).toBe(1)
    expect(getDefaultAlteration('g', 2)).toBe(0)
  })

  it('flattens notes covered by a flat signature', () => {
    // Bb major: Bb and Eb.
    expect(getDefaultAlteration('b', -2)).toBe(-1)
    expect(getDefaultAlteration('e', -2)).toBe(-1)
    expect(getDefaultAlteration('a', -2)).toBe(0)
  })

  it('alters nothing in C major', () => {
    for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(getDefaultAlteration(letter, 0)).toBe(0)
    }
  })

  it('is case insensitive', () => {
    expect(getDefaultAlteration('F', 2)).toBe(getDefaultAlteration('f', 2))
  })

  it('follows the order sharps are added to a signature', () => {
    // One sharp is F#; C# only arrives with the second.
    expect(getDefaultAlteration('f', 1)).toBe(1)
    expect(getDefaultAlteration('c', 1)).toBe(0)
  })
})

describe('extractKeyFromAbc', () => {
  it('reads the K: header', () => {
    expect(extractKeyFromAbc('X:1\nT:Cooley\'s\nK:Edor\nEBBA')).toBe('Edor')
  })

  it('ignores anything after the key, like a clef', () => {
    expect(extractKeyFromAbc('K:G clef=treble\nGABc')).toBe('G')
  })

  it('strips a trailing comment', () => {
    expect(extractKeyFromAbc('K:D % the usual\nDEFG')).toBe('D')
  })

  it.each([
    ['K:Gmajor', 'G'],
    ['K:Aminor', 'Am'],
    ['K:Edorian', 'Edor'],
    ['K:Dmixolydian', 'Dmix'],
    ['K:Ephrygian', 'Ephr'],
    ['K:Flydian', 'Flyd'],
  ])('abbreviates the spelled-out mode in %s', (header, expected) => {
    expect(extractKeyFromAbc(header + '\nCDEF')).toBe(expected)
  })

  it('takes the first key when a tune changes key mid-way', () => {
    expect(extractKeyFromAbc('K:G\nGABc\nK:D\nDEFG')).toBe('G')
  })

  it.each(['', 'X:1\nT:No Key\nCDEF'])('returns an empty string when there is no key', (abc) => {
    expect(extractKeyFromAbc(abc)).toBe('')
  })
})

describe('extractTitleFromAbc', () => {
  it('reads the T: header', () => {
    expect(extractTitleFromAbc('X:1\nT:The Butterfly\nK:Em')).toBe('The Butterfly')
  })

  it('strips a trailing comment', () => {
    expect(extractTitleFromAbc('T:Cooley\'s % aka Tulla Reel\nK:Edor')).toBe("Cooley's")
  })

  it('takes the first of several titles', () => {
    expect(extractTitleFromAbc('T:Primary\nT:Also Known As\nK:G')).toBe('Primary')
  })

  it.each(['', 'X:1\nK:G\nGABc'])('returns an empty string when there is no title', (abc) => {
    expect(extractTitleFromAbc(abc)).toBe('')
  })
})

describe('extractComposerFromAbc', () => {
  it('reads the C: header', () => {
    expect(extractComposerFromAbc('X:1\nT:The Butterfly\nC:Paddy O\'Brien\nK:Em')).toBe("Paddy O'Brien")
  })

  it('strips a trailing comment', () => {
    expect(extractComposerFromAbc('C:Turlough O\'Carolan % 1670-1738\nK:D')).toBe("Turlough O'Carolan")
  })

  it('collapses runs of whitespace', () => {
    expect(extractComposerFromAbc('C:  Ed   Reavy  \nK:D')).toBe('Ed Reavy')
  })

  it('takes the first of several composer headers', () => {
    expect(extractComposerFromAbc('C:Ed Reavy\nC:arr. Someone Else\nK:G')).toBe('Ed Reavy')
  })

  it('returns empty for the traditional tunes that carry no composer', () => {
    expect(extractComposerFromAbc('X:1\nT:Cooley\'s\nR:reel\nK:Edor\n|:EBBA B2 EB:|')).toBe('')
  })

  it('ignores the body, where a line can legitimately start with the note C', () => {
    // Without stopping at K:, "C:" here reads as a composer header naming the rest of the bar.
    expect(extractComposerFromAbc('X:1\nT:Test\nK:C\nC:E:G|\n')).toBe('')
  })

  it('handles empty input', () => {
    expect(extractComposerFromAbc('')).toBe('')
  })
})

describe('extractRhythmFromAbc', () => {
  it('reads the R: header', () => {
    expect(extractRhythmFromAbc('X:1\nT:Cooley\'s\nR:reel\nK:Edor')).toBe('reel')
  })

  it('collapses multiple spaces and strips comments', () => {
    expect(extractRhythmFromAbc('R:  slip   jig  % traditional\nK:G')).toBe('slip jig')
  })

  it('returns empty string when there is no rhythm header', () => {
    expect(extractRhythmFromAbc('X:1\nT:Test\nK:D')).toBe('')
  })
})

describe('extractTuneTypeFromAbc', () => {
  it.each([
    ['R: reel', 'Reel'],
    ['R: REEL', 'Reel'],
    ['R: jig', 'Jig'],
    ['R: slip jig', 'SlipJig'],
    ['R: slipjig', 'SlipJig'],
    ['R: hornpipe', 'Hornpipe'],
    ['R: polka', 'Polka'],
    ['R: slide', 'Slide'],
    ['R: waltz', 'Waltz'],
    ['R: march', 'March'],
    ['R: strathspey', 'Strathspey'],
    ['R: barndance', 'Barndance'],
    ['R: barn dance', 'Barndance'],
    ['R: mazurka', 'Mazurka'],
    ['R: air', 'Air'],
    ['R: custom rhythm', 'Other'],
  ])('maps %s to TuneType %s', (header, expectedType) => {
    expect(extractTuneTypeFromAbc(`X:1\nT:Test\n${header}\nK:D`)).toBe(expectedType)
  })
})

describe('normalizeAbcHeaders', () => {
  it('cleans up T:, R:, and K: headers in ABC notation', () => {
    const input = 'X:1\nT:  the   maid  \nR:  REEL  \nK: D major % comment\n|:FAAF AFDF|'
    const result = normalizeAbcHeaders(input)

    expect(result.title).toBe('the maid')
    expect(result.rhythm).toBe('reel')
    expect(result.tuneType).toBe('Reel')
    expect(result.key).toBe('D')
    expect(result.normalizedAbc).toContain('T:the maid')
    expect(result.normalizedAbc).toContain('R:reel')
    expect(result.normalizedAbc).toContain('K:D % comment')
  })
})

describe('validateAbc', () => {
  it('accepts a tune with title, rhythm, key, and some music', () => {
    const result = validateAbc('X:1\nT:Cooley\'s\nR:reel\nK:Edor\nEBBA B2EB|')

    expect(result.isValid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it.each(['', '   ', '\n\n'])('rejects blank input', (abc) => {
    const result = validateAbc(abc)

    expect(result.isValid).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it('rejects a tune missing required headers', () => {
    const result = validateAbc('X:1\nEBBA B2EB|')

    expect(result.isValid).toBe(false)
    expect(result.error).toMatch(/missing required header/i)
  })

  it('rejects a key header with no key', () => {
    expect(validateAbc('T:Test\nR:reel\nK:\nEBBA|').isValid).toBe(false)
  })

  it('rejects headers with no music at all', () => {
    const result = validateAbc('X:1\nT:Headers Only\nR:jig\nM:4/4\nK:G')

    expect(result.isValid).toBe(false)
    expect(result.error).toMatch(/music notes or bar lines/i)
  })

  it('does not count comment lines as music', () => {
    expect(validateAbc('T:Test\nR:reel\nK:G\n% just a note to self').isValid).toBe(false)
  })

  it('trims the input it hands back', () => {
    expect(validateAbc('  \nT:Test\nR:jig\nK:G\nGABc\n  ').trimmedAbc).toBe('T:Test\nR:jig\nK:G\nGABc')
  })

  it('handles null-ish input without throwing', () => {
    expect(validateAbc(undefined as unknown as string).isValid).toBe(false)
  })
})

describe('normalizeTitleForSorting', () => {
  it.each([
    ['The Butterfly', 'butterfly'],
    ['A Fig for a Kiss', 'fig for a kiss'],
    ['An Buachaill Dreoite', 'buachaill dreoite'],
    ["Cooley's", "cooley's"],
    ['  The Kesh  ', 'kesh'],
  ])('files %s under %s', (title, expected) => {
    expect(normalizeTitleForSorting(title)).toBe(expected)
  })

  it('only strips an article that is a whole word', () => {
    expect(normalizeTitleForSorting('Theme from Nowhere')).toBe('theme from nowhere')
    expect(normalizeTitleForSorting('Andante')).toBe('andante')
  })

  it.each([undefined, null, ''])('returns an empty string for %s', (title) => {
    expect(normalizeTitleForSorting(title as unknown as string)).toBe('')
  })

  it('sorts a list the way the repertoire view expects', () => {
    const sorted = ['The Butterfly', 'A Fig for a Kiss', "Cooley's"].sort((a, b) =>
      normalizeTitleForSorting(a).localeCompare(normalizeTitleForSorting(b)),
    )

    expect(sorted).toEqual(['The Butterfly', "Cooley's", 'A Fig for a Kiss'])
  })
})

describe('transposeAbc', () => {
  it('rewrites the key header to the target root', () => {
    expect(transposeAbc('K:D\nDEFG', 'G')).toContain('K:G')
  })

  it.each([
    ['K:Edor\nEFGA', 'A', 'K:Ador'],
    ['K:Amix\nABcd', 'D', 'K:Dmix'],
    ['K:Ephr\nEFGA', 'A', 'K:Aphr'],
    ['K:Flyd\nFGAB', 'C', 'K:Clyd'],
    ['K:Em\nEFGA', 'A', 'K:Amin'],
  ])('keeps the mode of %s when moving to %s', (abc, target, expectedHeader) => {
    // A transposition may change the key but must never change the tune's mode.
    expect(transposeAbc(abc, target)).toContain(expectedHeader)
  })

  it('shifts the notes by the same interval as the key', () => {
    // D -> E is up a tone, so D E F# G becomes E F# G# A.
    const transposed = transposeAbc('K:D\nDEFG', 'E')

    expect(transposed).toContain('K:E')
    expect(transposed).not.toContain('K:D')
  })

  it('is a no-op when the target is the current key', () => {
    const abc = 'K:D\nDEFG|ABcd|'

    expect(transposeAbc(abc, 'D')).toBe(abc)
  })

  it('round-trips back to the original key', () => {
    const abc = 'K:D\nDEFG|ABcd|'

    expect(transposeAbc(transposeAbc(abc, 'G'), 'D')).toBe(abc)
  })

  it('returns the input unchanged for an unknown target root', () => {
    const abc = 'K:D\nDEFG'

    expect(transposeAbc(abc, 'H')).toBe(abc)
  })

  it('leaves the other headers alone', () => {
    const transposed = transposeAbc('X:1\nT:Cooley\'s\nM:4/4\nK:Edor\nEBBA', 'A')

    expect(transposed).toContain('X:1')
    expect(transposed).toContain("T:Cooley's")
    expect(transposed).toContain('M:4/4')
  })
})

describe('transposeAbcBySemitones', () => {
  it('shifts the key and the notes by the interval asked for', () => {
    // D -> E is up a tone, so D E F# G becomes E F# G# A.
    expect(transposeAbcBySemitones('K:D\nDEFG', 2)).toBe('K:E\nEFGA')
  })

  it('steps down as readily as up', () => {
    // Db, not C#: a step down should not land the player in seven sharps. In Db's five flats
    // every one of these notes takes its accidental from the signature, so none are written out.
    expect(transposeAbcBySemitones('K:D\nDEFG', -1)).toBe('K:Db\nDEFG')
  })

  it('spells accidentals to match a flat key signature', () => {
    // C major has no signature to lean on, so the flats have to be written: Db Eb F Gb.
    expect(transposeAbcBySemitones('K:C\nCDEF', 1)).toBe('K:Db\nDEFG')
    // Bb and B natural, both an octave down from middle C, then C itself.
    expect(transposeAbcBySemitones('K:C\nC^CD', -2)).toBe('K:Bb\nB,=B,C')
  })

  it('spells the new root to suit the mode', () => {
    // C# dorian is five sharps; Db dorian would be seven flats.
    expect(transposeAbcBySemitones('K:Cdor\nCDEF', 1)).toContain('K:C#dor')
  })

  it('moves a whole octave without touching the key', () => {
    const transposed = transposeAbcBySemitones('K:D\nDEFG|abcd|', 12)

    expect(transposed).toContain('K:D')
    expect(transposed).toContain('defg')
    expect(transposed).toContain("a'b'c'd'")
  })

  it('round-trips an octave up and back down', () => {
    const abc = 'K:D\nDEFG|ABcd|'

    expect(transposeAbcBySemitones(transposeAbcBySemitones(abc, 12), -12)).toBe(abc)
  })

  it('reaches the same place in twelve steps as in one jump', () => {
    // The whole point of stepping: repeated single semitones must not drift or wrap.
    const abc = 'K:D\nDEFG|ABcd|'
    let stepped = abc
    for (let i = 0; i < 12; i++) {
      stepped = transposeAbcBySemitones(stepped, 1)
    }

    expect(stepped).toBe(transposeAbcBySemitones(abc, 12))
  })

  it('keeps the mode', () => {
    expect(transposeAbcBySemitones('K:Ador\nABcd', 2)).toContain('K:Bdor')
  })

  it('moves chord symbols with the notes', () => {
    expect(transposeAbcBySemitones('K:D\n"D"D2 "G"G2', 2)).toBe('K:E\n"E"E2 "A"A2')
  })

  it('is a no-op for zero semitones', () => {
    const abc = 'K:D\nDEFG|ABcd|'

    expect(transposeAbcBySemitones(abc, 0)).toBe(abc)
  })

  it('leaves the other headers alone', () => {
    const transposed = transposeAbcBySemitones('X:1\nT:Cooley\'s\nM:4/4\nK:Edor\nEBBA', 5)

    expect(transposed).toContain('X:1')
    expect(transposed).toContain("T:Cooley's")
    expect(transposed).toContain('M:4/4')
    expect(transposed).toContain('K:Ador')
  })

  it('transposes a variant ending written with a bracket', () => {
    // The closing `:|` used to be read as an inline field's colon, which left the whole
    // first ending untransposed while the second ending beside it moved.
    expect(transposeAbcBySemitones('K:G\n[1 GABc defg:|\n[2 GABc defa||', 2)).toBe(
      'K:A\n[1 ABcd efga:|\n[2 ABcd efgb||',
    )
  })

  it('transposes variant endings written inline', () => {
    expect(transposeAbcBySemitones('K:G\nGABc|1 defg:|2 defa||', 2)).toBe(
      'K:A\nABcd|1 efga:|2 efgb||',
    )
  })

  it('transposes a chord but leaves an inline field alone', () => {
    expect(transposeAbcBySemitones('K:G\n[GBd]2', 2)).toBe('K:A\n[Ace]2')
    expect(transposeAbcBySemitones('K:G\nGA[K:D]Bc', 2)).toBe('K:A\nAB[K:D]cd')
  })

  it('does not let an unclosed bracket swallow the rest of the line', () => {
    expect(transposeAbcBySemitones('K:G\nGA[Bc', 2)).toBe('K:A\nAB[cd')
  })
})

describe('foldAbcOctaves', () => {
  it('folds a variant ending written with a bracket', () => {
    // Same bracket bug as transposition: the ending's `:|` used to stop the fold dead.
    expect(foldAbcOctaves("K:G\n[1 GABc g'a'b'c'':|", 60, 84)).toBe("K:G\n[1 GABc gabc':|")
  })
})

describe('fixAbcRepeats', () => {
  it('leaves a balanced repeat alone', () => {
    const abc = 'K:G\n|:GABc dedB:|'

    expect(fixAbcRepeats(abc)).toBe(abc)
  })

  it('supplies the opening mark for a bare closing repeat', () => {
    const fixed = fixAbcRepeats('K:G\nGABc dedB:|')

    expect(fixed).toContain('|:')
    expect(fixed).toContain(':|')
  })

  it('opens each part of a two-part tune', () => {
    const fixed = fixAbcRepeats('K:G\nGABc dedB:|\ncBAG FGAB:|')

    expect(fixed.match(/\|:/g)).toHaveLength(2)
    expect(fixed.match(/:\|/g)).toHaveLength(2)
  })

  it('keeps the headers at the top', () => {
    const fixed = fixAbcRepeats("X:1\nT:Cooley's\nK:Edor\nEBBA:|")

    expect(fixed.startsWith('X:1')).toBe(true)
    expect(fixed).toContain("T:Cooley's")
    expect(fixed).toContain('K:Edor')
  })

  it('leaves a tune with no repeats untouched apart from reassembly', () => {
    expect(fixAbcRepeats('K:G\nGABc dedB|')).toContain('GABc dedB|')
  })
})
