import { describe, it, expect } from 'vitest'
import abcjs from 'abcjs'

/**
 * Guards the assumption SetPlayer's click-a-note feature rests on: that setUpAudio() is what puts
 * midiPitches on note elements. Nothing else does until a synth is built, which is why clicking a
 * note used to do nothing until the tune had been played once.
 */

const TUNE = `X:1
T:Test
M:4/4
L:1/8
K:D
DEFG|ABcd|`

function noteElements(visualObj: abcjs.TuneObject) {
  const notes: abcjs.AbcElem[] = []
  for (const line of visualObj.lines ?? []) {
    for (const staff of line.staff ?? []) {
      for (const voice of staff.voices ?? []) {
        for (const el of voice) {
          if ((el as abcjs.AbcElem).el_type === 'note') notes.push(el as abcjs.AbcElem)
        }
      }
    }
  }
  return notes
}

describe('setUpAudio populates midiPitches', () => {
  it('leaves note elements without midiPitches until it runs', () => {
    const visualObj = abcjs.parseOnly(TUNE)[0]
    const notes = noteElements(visualObj)
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.every((n) => !n.midiPitches?.length)).toBe(true)
  })

  it('gives every note a sounding pitch once it has run', () => {
    const visualObj = abcjs.parseOnly(TUNE)[0]
    visualObj.setUpAudio({})
    const notes = noteElements(visualObj)

    expect(notes.every((n) => (n.midiPitches?.length ?? 0) > 0)).toBe(true)
    // D major: the F and C are sharpened by the key signature, which is exactly the work that
    // makes running the real pass better than deriving pitches from the staff position by hand.
    expect(notes.map((n) => n.midiPitches![0].pitch)).toEqual([62, 64, 66, 67, 69, 71, 73, 74])
  })

  it('does not need setTiming to have run first', () => {
    const visualObj = abcjs.parseOnly(TUNE)[0]
    expect(() => visualObj.setUpAudio({})).not.toThrow()
    expect(noteElements(visualObj)[0].midiPitches?.length).toBeGreaterThan(0)
  })
})
