import { describe, it, expect } from 'vitest'
import abcjs from 'abcjs'
import { buildPlaybackAbc, shouldKeepLeadIn, splitAbcForUnroll } from './abcUnroll'

const COWBOY = `X:1
T:The Cowboy
R:jig
M:6/8
L:1/8
K:G
BA|:GDE G2A|Bgf gdB|ABc BGA|B2B AGE|
 GDE G2A|Bgf gdB|ABc BGA|1 BGG GBA:|2 BGG GBd||
 |:e2e edB|egf edB|d2d d2d|dge dBG|
 c2d e2d|egB A2e|dBG B2A|1 BGG GBd:|2 BGG G3||
`

/** A real anacrusis: the D pickup is paid back by the short final bar. */
const REAL_ANACRUSIS = `X:1
T:Anacrusis
M:4/4
L:1/8
K:D
D2|:FAdA BAFA|ABde fdec|d2fd c2ec|1 d2fd cAFA:|2 d2fd c2||
`

const NO_REPEATS = `X:1
T:Straight
M:4/4
L:1/8
K:G
GABc dedB|dedB dedB|GABc dedB|A2AB AGEF|
`

const UNREPEATED_FIRST_SECTION = `X:1
T:Intro then repeat
M:4/4
L:1/8
K:G
GABc dedB|dedB dedB|:GABc dedB|A2AB AGEF:|
`

const WITH_LEADOUT = `X:1
T:Coda
M:4/4
L:1/8
K:G
|:GABc dedB|dedB dedB:| G4 |]
`

describe('splitAbcForUnroll', () => {
  it('splits The Cowboy into its lead-in and repeated core', () => {
    const parts = splitAbcForUnroll(COWBOY)
    expect(parts.headers).toContain('K:G')
    expect(parts.leadIn).toBe('BA')
    expect(parts.core.startsWith('|:GDE')).toBe(true)
    // The second ending is part of the tune, not a coda.
    expect(parts.core).toContain('2 BGG G3||')
    expect(parts.leadOut.trim()).toBe('')
  })

  it('leaves a first section that simply is not repeated alone', () => {
    const parts = splitAbcForUnroll(UNREPEATED_FIRST_SECTION)
    expect(parts.leadIn).toBe('')
    expect(parts.core.trim().startsWith('GABc')).toBe(true)
  })

  it('finds the anacrusis in a tune written without repeat marks', () => {
    const parts = splitAbcForUnroll(NO_REPEATS)
    // No barline precedes the first, so the whole first bar reads as a pickup here; the timing
    // guard in shouldKeepLeadIn is what decides whether it is ever dropped.
    expect(parts.leadIn).toBe('GABc dedB')
  })

  it('detects a coda after the final repeat', () => {
    const parts = splitAbcForUnroll(WITH_LEADOUT)
    expect(parts.leadOut.trim()).toBe('G4 |]')
    expect(parts.core).toContain('dedB:|')
  })

  it('reassembles into the original text', () => {
    for (const abc of [COWBOY, REAL_ANACRUSIS, NO_REPEATS, UNREPEATED_FIRST_SECTION, WITH_LEADOUT]) {
      const parts = splitAbcForUnroll(abc)
      expect(parts.headers + parts.leadIn + parts.core + parts.leadOut).toBe(abc)
    }
  })
})

describe('buildPlaybackAbc', () => {
  it('round-trips unchanged for a single pass', () => {
    expect(buildPlaybackAbc(COWBOY, 1, { keepLeadIn: true }).abc).toBe(COWBOY.trimEnd() + '\n')
  })

  it('drops the lead-in on later passes but keeps it on the first', () => {
    const { abc, passes, leadInStripped } = buildPlaybackAbc(COWBOY, 3, { keepLeadIn: false })
    expect(passes).toBe(3)
    expect(leadInStripped).toBe(true)
    expect(abc.slice(abc.indexOf('BA|:')).split('\n|:GDE')).toHaveLength(3)
    // Headers appear once, the body three times.
    expect(abc.match(/K:G/g)).toHaveLength(1)
    expect(abc.match(/BA\|:/g)).toHaveLength(1)
    expect(abc.match(/e2e edB/g)).toHaveLength(3)
  })

  it('keeps the lead-in on every pass for a real anacrusis', () => {
    const { abc, leadInStripped } = buildPlaybackAbc(REAL_ANACRUSIS, 2, { keepLeadIn: true })
    expect(leadInStripped).toBe(false)
    expect(abc.match(/D2\|:/g)).toHaveLength(2)
  })

  it('reports no stripping for a single pass, so the player keeps its simple timing', () => {
    expect(buildPlaybackAbc(COWBOY, 1, { keepLeadIn: false }).leadInStripped).toBe(false)
  })

  it('emits the lead-out only after the last pass', () => {
    const { abc } = buildPlaybackAbc(WITH_LEADOUT, 3, { keepLeadIn: false })
    expect(abc.match(/G4/g)).toHaveLength(1)
    expect(abc.match(/dedB:\|/g)).toHaveLength(3)
    expect(abc.trimEnd().endsWith('G4 |]')).toBe(true)
  })

  it('treats zero or negative repetitions as one pass', () => {
    expect(buildPlaybackAbc(COWBOY, 0, { keepLeadIn: true }).abc).toBe(COWBOY.trimEnd() + '\n')
  })
})

describe('shouldKeepLeadIn', () => {
  function render(abc: string) {
    return abcjs.renderAbc('*', abc)[0]
  }

  it('drops a decorative lead-in over whole bars', () => {
    expect(shouldKeepLeadIn(render(COWBOY))).toBe(false)
  })

  it('keeps a genuine anacrusis paid back by a short final bar', () => {
    expect(shouldKeepLeadIn(render(REAL_ANACRUSIS))).toBe(true)
  })

  it('keeps everything when there is no pickup at all', () => {
    expect(shouldKeepLeadIn(render(WITH_LEADOUT))).toBe(true)
  })

  it('does not mistake a whole first bar for a lead-in', () => {
    // splitAbcForUnroll reads this tune's first bar as a lead-in because no barline precedes it;
    // this guard is what stops it ever being dropped.
    expect(shouldKeepLeadIn(render(NO_REPEATS))).toBe(true)
  })
})

describe('the unrolled ABC as abcjs sequences it', () => {
  /** Total length in whole notes, repeats and endings expanded, exactly as the synth buffer is sized. */
  function playedWholeNotes(abc: string): number {
    return (abcjs.parseOnly(abc)[0] as unknown as { setUpAudio(p: object): { totalDuration: number } }).setUpAudio({})
      .totalDuration
  }

  it('adds one lead-in-free pass per repetition', () => {
    const single = playedWholeNotes(COWBOY)
    const triple = playedWholeNotes(buildPlaybackAbc(COWBOY, 3, { keepLeadIn: false }).abc)
    const pickupWholeNotes = 0.25 // BA at L:1/8
    expect(triple).toBeCloseTo(single * 3 - pickupWholeNotes * 2, 6)
  })

  it('repeats a real anacrusis in full', () => {
    const single = playedWholeNotes(REAL_ANACRUSIS)
    const triple = playedWholeNotes(buildPlaybackAbc(REAL_ANACRUSIS, 3, { keepLeadIn: true }).abc)
    expect(triple).toBeCloseTo(single * 3, 6)
  })

  it('plays the coda once however many passes there are', () => {
    const single = playedWholeNotes(WITH_LEADOUT)
    const triple = playedWholeNotes(buildPlaybackAbc(WITH_LEADOUT, 3, { keepLeadIn: true }).abc)
    const coda = 0.5 // G4 at L:1/8
    expect(triple).toBeCloseTo((single - coda) * 3 + coda, 6)
  })
})
