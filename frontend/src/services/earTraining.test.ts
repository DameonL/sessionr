import { describe, it, expect } from 'vitest'
import abcjs from 'abcjs'
import {
  buildCallResponseChunks,
  buildEarTrainingTune,
  matchCallResponse,
  type CallResponseTarget,
} from './earTraining'

// Bar 1 opens with a repeated note and is played twice; bar 2 closes the tune.
// K:D, so c and f are sharp: A=69 B=71 c#=73 d=74 e=76 f#=78 g=79.
const REPEATED = `X:1
T:Repeated
M:4/4
L:1/8
K:D
|:AAAB cdef:|g2 fe d4|`

function tuneOf(abc: string, barsPerPhrase = 2) {
  const tune = buildEarTrainingTune(abc, barsPerPhrase)
  if (!tune) throw new Error('fixture did not parse')
  return tune
}

/** Played length in whole notes, as abcjs sizes the synth buffer. */
function playedWholeNotes(abc: string): number {
  return (abcjs.parseOnly(abc)[0] as unknown as { setUpAudio(p: object): { totalDuration: number } })
    .setUpAudio({}).totalDuration
}

describe('buildEarTrainingTune bar data', () => {
  it('indexes bars per phrase, even when a repeat reuses the same bar', () => {
    const [first, second] = tuneOf(REPEATED).phrases
    // The repeated bar fills both slots of the first phrase.
    expect(first.notes.map((n) => n.barIndex)).toEqual([...Array(8).fill(0), ...Array(8).fill(1)])
    expect(second.notes.map((n) => n.barIndex)).toEqual([0, 0, 0, 0])
    // Copies, so the second pass of the bar can't overwrite the first's index.
    expect(first.notes[0]).not.toBe(first.notes[8])
  })

  it('gives each bar its own playable excerpt, one bar long', () => {
    const [first, second] = tuneOf(REPEATED).phrases
    expect(first.barExcerpts).toHaveLength(2)
    expect(second.barExcerpts).toHaveLength(1)
    for (const excerpt of [...first.barExcerpts, ...second.barExcerpts]) {
      expect(excerpt).toContain('K:D')
      expect(playedWholeNotes(excerpt)).toBeCloseTo(1)
    }
    // The whole phrase is exactly its two bars.
    expect(playedWholeNotes(first.excerptAbc)).toBeCloseTo(2)
  })
})

describe('buildCallResponseChunks', () => {
  it('merges repeated notes into one target that reveals them all', () => {
    const [phrase] = tuneOf(REPEATED).phrases
    const [bar] = buildCallResponseChunks(phrase, 1)
    expect(bar.targets.map((t) => t.midi)).toEqual([69, 71, 73, 74, 76, 78])
    expect(bar.targets[0].noteIndices).toEqual([0, 1, 2])
    expect(bar.noteIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('makes one chunk per bar, or one per two bars', () => {
    const [phrase] = tuneOf(REPEATED).phrases

    const single = buildCallResponseChunks(phrase, 1)
    expect(single.map((c) => [c.firstBar, c.barCount])).toEqual([[0, 1], [1, 1]])
    expect(single[1].noteIndices[0]).toBe(8)

    const [both] = buildCallResponseChunks(phrase, 2)
    expect([both.firstBar, both.barCount]).toEqual([0, 2])
    // f# then A across the barline differ, so nothing merges there.
    expect(both.targets).toHaveLength(12)
    expect(both.noteIndices).toHaveLength(16)
  })

  it('never lets two consecutive targets share a pitch class', () => {
    const [phrase] = tuneOf(`X:1\nM:4/4\nL:1/8\nK:G\nGGgG DDdD|`).phrases
    const [bar] = buildCallResponseChunks(phrase, 1)
    // G, g and G are one pitch class, so the first four notes are one target.
    expect(bar.targets.map((t) => t.noteIndices)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]])
    for (let i = 1; i < bar.targets.length; i++) {
      expect(bar.targets[i].pitchClass).not.toBe(bar.targets[i - 1].pitchClass)
    }
  })

  it('reveals a tie continuation with its note but never asks for it', () => {
    const [phrase] = tuneOf(`X:1\nM:4/4\nL:1/8\nK:D\nA2-A2 B2 d2|`).phrases
    const [bar] = buildCallResponseChunks(phrase, 1)
    expect(bar.targets.map((t) => t.midi)).toEqual([69, 71, 74])
    expect(bar.targets[0].noteIndices).toEqual([0, 1])
  })

  it('does not ask for a tie carried in from the previous bar', () => {
    const [phrase] = tuneOf(`X:1\nM:4/4\nL:1/8\nK:D\nB4 d4-|d4 e4|`).phrases
    const [, second] = buildCallResponseChunks(phrase, 1)
    expect(second.noteIndices).toEqual([2, 3])
    expect(second.targets.map((t) => t.midi)).toEqual([76])
  })

  it('leaves a short final chunk when the bars run out', () => {
    const [phrase] = tuneOf(`X:1\nM:2/4\nL:1/8\nK:D\nDE|FG|AB|`, 3).phrases
    const chunks = buildCallResponseChunks(phrase, 2)
    expect(chunks.map((c) => [c.firstBar, c.barCount])).toEqual([[0, 2], [2, 1]])
  })
})

describe('matchCallResponse', () => {
  const t = (pitchClass: number): CallResponseTarget => ({ midi: 60 + pitchClass, pitchClass, noteIndices: [] })
  const targets = [t(9), t(11), t(1)] // A B C#

  it('advances on the expected pitch class', () => {
    expect(matchCallResponse(targets, 0, 9)).toEqual({ kind: 'hit', position: 1 })
    expect(matchCallResponse(targets, 1, 11)).toEqual({ kind: 'hit', position: 2 })
  })

  it('finishes on the last target', () => {
    expect(matchCallResponse(targets, 2, 1)).toEqual({ kind: 'done' })
  })

  it('reports the note it wanted on a miss', () => {
    expect(matchCallResponse(targets, 1, 4)).toEqual({ kind: 'miss', expected: targets[1] })
    expect(matchCallResponse(targets, 0, 11)).toEqual({ kind: 'miss', expected: targets[0] })
  })

  it('ignores the note just found sounding again', () => {
    expect(matchCallResponse(targets, 1, 9)).toEqual({ kind: 'ignore' })
  })

  it('ignores anything once the chunk is finished', () => {
    expect(matchCallResponse(targets, 3, 9)).toEqual({ kind: 'ignore' })
  })
})
