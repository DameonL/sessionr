import { describe, it, expect } from 'vitest'
import { prefersFlats, spellMidiNote, spellMidiNotes } from './noteSpelling'

const abcInKey = (key: string) => `X:1\nT:Test\nM:4/4\nL:1/8\nK:${key}\nABcd|`

describe('prefersFlats', () => {
  it.each(['F', 'Bb', 'Eb', 'Dm', 'Gm'])('is true for the flat key %s', (key) => {
    expect(prefersFlats(abcInKey(key))).toBe(true)
  })

  it.each(['D', 'G', 'A', 'Em', 'Bm', 'Amix', 'Ddor'])('is false for the sharp key %s', (key) => {
    expect(prefersFlats(abcInKey(key))).toBe(false)
  })

  it('treats C major, which has neither, as sharp', () => {
    expect(prefersFlats(abcInKey('C'))).toBe(false)
  })

  it('falls back to sharps when there is no readable key', () => {
    expect(prefersFlats('X:1\nT:No key\nABcd|')).toBe(false)
    expect(prefersFlats('')).toBe(false)
  })
})

describe('spellMidiNote', () => {
  it('names naturals the same either way', () => {
    expect(spellMidiNote(69, false)).toBe('A')
    expect(spellMidiNote(69, true)).toBe('A')
  })

  it('spells accidentals to match the key', () => {
    expect(spellMidiNote(70, false)).toBe('A#')
    expect(spellMidiNote(70, true)).toBe('Bb')
    expect(spellMidiNote(66, false)).toBe('F#')
    expect(spellMidiNote(66, true)).toBe('Gb')
  })

  it('drops the octave, so the same pitch class always reads the same', () => {
    expect(spellMidiNote(62, false)).toBe('D')
    expect(spellMidiNote(74, false)).toBe('D')
    expect(spellMidiNote(86, false)).toBe('D')
  })

  it('handles pitches below C0 without falling off the table', () => {
    expect(spellMidiNote(-1, false)).toBe('B')
  })
})

describe('spellMidiNotes', () => {
  it('joins a chord low to high', () => {
    expect(spellMidiNotes([69, 61, 64], false)).toBe('C#/E/A')
  })

  it('names a pitch class once even when doubled at the octave', () => {
    expect(spellMidiNotes([62, 74], false)).toBe('D')
  })

  it('follows the key for the whole chord', () => {
    expect(spellMidiNotes([70, 62, 65], true)).toBe('D/F/Bb')
  })

  it('is empty for no pitches', () => {
    expect(spellMidiNotes([], false)).toBe('')
  })
})
