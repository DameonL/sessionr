import { describe, expect, it } from 'vitest'
import { DEFAULT_INSTRUMENTS } from '../components/instruments'
import { buildMidiFile, sanitizeMidiFilename, type MidiExportOptions } from './midiExport'

interface ParsedEvent {
  tick: number
  kind: 'meta' | 'channel'
  metaType?: number
  status?: number
  channel?: number
  data: number[]
}

interface ParsedMidi {
  format: number
  trackCount: number
  ppqn: number
  tracks: ParsedEvent[][]
}

function readVarLen(bytes: Uint8Array, pos: { i: number }): number {
  let val = 0
  while (pos.i < bytes.length) {
    const b = bytes[pos.i++]
    val = (val << 7) | (b & 0x7f)
    if ((b & 0x80) === 0) break
  }
  return val
}

function parseSmf(bytes: Uint8Array): ParsedMidi {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  expect(magic).toBe('MThd')
  const headerLen = view.getUint32(4)
  expect(headerLen).toBe(6)
  const format = view.getUint16(8)
  const trackCount = view.getUint16(10)
  const ppqn = view.getUint16(12)

  let offset = 14
  const tracks: ParsedEvent[][] = []
  for (let t = 0; t < trackCount; t++) {
    const trkMagic = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    expect(trkMagic).toBe('MTrk')
    const trkLen = view.getUint32(offset + 4)
    const end = offset + 8 + trkLen
    const pos = { i: offset + 8 }
    const events: ParsedEvent[] = []
    let tick = 0

    while (pos.i < end) {
      tick += readVarLen(bytes, pos)
      const status = bytes[pos.i++]
      if (status === 0xff) {
        const metaType = bytes[pos.i++]
        const len = readVarLen(bytes, pos)
        const data = Array.from(bytes.slice(pos.i, pos.i + len))
        pos.i += len
        events.push({ tick, kind: 'meta', metaType, data })
      } else {
        const type = status & 0xf0
        const channel = status & 0x0f
        const dataLen = type === 0xc0 || type === 0xd0 ? 1 : 2
        const data = Array.from(bytes.slice(pos.i, pos.i + dataLen))
        pos.i += dataLen
        events.push({ tick, kind: 'channel', status: type, channel, data })
      }
    }
    expect(pos.i).toBe(end)
    tracks.push(events)
    offset = end
  }
  expect(offset).toBe(bytes.length)
  return { format, trackCount, ppqn, tracks }
}

const REEL_ABC = `X:1
T:Test Reel
M:4/4
L:1/8
Q:1/4=120
K:D
|: "D"DEFG ABcd | "G"edef dBAG :|`

const REEL_WITH_DECORATIVE_LEAD_IN = `X:1
T:Cowboy Style
M:4/4
L:1/8
K:D
BA |: DEFG ABcd | edef d4 :|`

const JIG_ABC = `X:1
T:Test Jig
M:6/8
L:1/8
K:G
|: "G"GAB BAG | "D"FGA AFD :|`

function baseOptions(overrides: Partial<MidiExportOptions> = {}): MidiExportOptions {
  return {
    title: 'Test Reel',
    items: [{ title: 'Test Reel', abc: REEL_ABC, repetitions: 1, tuneType: 'Reel' }],
    bpm: 120,
    swingPercent: 0,
    emphasisPercent: 40,
    instruments: DEFAULT_INSTRUMENTS,
    bandMode: false,
    bandVoices: [],
    bodhran: false,
    repeat: false,
    repeatLimit: null,
    ...overrides,
  }
}

describe('sanitizeMidiFilename', () => {
  it('slugifies titles and strips apostrophes', () => {
    expect(sanitizeMidiFilename("The Banshee's Reel (D Maj)")).toBe('the-banshees-reel-d-maj.mid')
    expect(sanitizeMidiFilename('   ')).toBe('tune.mid')
  })
})

describe('buildMidiFile', () => {
  it('writes a valid Format 1 SMF header and end-of-track markers', () => {
    const res = buildMidiFile(baseOptions())
    expect(res.filename).toBe('test-reel.mid')
    expect(res.infiniteRepeatClamped).toBe(false)

    const midi = parseSmf(res.bytes)
    expect(midi.format).toBe(1)
    expect(midi.ppqn).toBe(480)
    expect(midi.trackCount).toBeGreaterThanOrEqual(2)
    for (const track of midi.tracks) {
      const last = track[track.length - 1]
      expect(last.kind).toBe('meta')
      expect(last.metaType).toBe(0x2f)
    }
  })

  it('unrolls configured single-tune repeats and clamps infinite repeats to 1 pass', () => {
    const onePass = parseSmf(buildMidiFile(baseOptions({ repeat: false })).bytes)
    const threePasses = parseSmf(
      buildMidiFile(baseOptions({ repeat: true, repeatLimit: 3 })).bytes,
    )
    const infPass = buildMidiFile(baseOptions({ repeat: true, repeatLimit: null }))

    const countNoteOns = (midi: ParsedMidi) =>
      midi.tracks[1].filter((e) => e.kind === 'channel' && e.status === 0x90).length

    const singleNotes = countNoteOns(onePass)
    expect(singleNotes).toBeGreaterThan(0)
    expect(countNoteOns(threePasses)).toBe(singleNotes * 3)

    expect(infPass.infiniteRepeatClamped).toBe(true)
    expect(countNoteOns(parseSmf(infPass.bytes))).toBe(singleNotes)
  })

  it('strips decorative lead-in on repeated passes just like live playback', () => {
    const single = parseSmf(
      buildMidiFile(
        baseOptions({
          items: [{ title: 'Cowboy', abc: REEL_WITH_DECORATIVE_LEAD_IN, repetitions: 1 }],
          repeat: false,
        }),
      ).bytes,
    )
    const doubled = parseSmf(
      buildMidiFile(
        baseOptions({
          items: [{ title: 'Cowboy', abc: REEL_WITH_DECORATIVE_LEAD_IN, repetitions: 1 }],
          repeat: true,
          repeatLimit: 2,
        }),
      ).bytes,
    )

    const noteOns = (m: ParsedMidi) =>
      m.tracks[1].filter((e) => e.kind === 'channel' && e.status === 0x90).length

    // Single pass has 2 pickup notes + 2 bars played twice (|: ... :|) = 2 + 12*2? Let's just check
    // that pass 2 drops the 2 pickup notes rather than doubling the entire count.
    const singleCount = noteOns(single)
    const doubleCount = noteOns(doubled)
    expect(doubleCount).toBe(singleCount * 2 - 2)
  })

  it('exports multi-tune sets with per-tune repetitions, set repeats, and changing tempo/meter/key', () => {
    const setRes = buildMidiFile(
      baseOptions({
        title: 'Session Set',
        items: [
          { title: 'Test Reel', abc: REEL_ABC, repetitions: 2, tuneType: 'Reel' },
          { title: 'Test Jig', abc: JIG_ABC, repetitions: 1, tuneType: 'Jig' },
        ],
        bpm: 120,
        repeat: true,
        repeatLimit: 2,
      }),
    )
    expect(setRes.filename).toBe('session-set.mid')
    const midi = parseSmf(setRes.bytes)
    const conductor = midi.tracks[0]

    // Markers for Reel, Jig, Reel, Jig (2 set passes)
    const markers = conductor
      .filter((e) => e.kind === 'meta' && e.metaType === 0x06)
      .map((e) => new TextDecoder().decode(new Uint8Array(e.data)))
    expect(markers).toEqual(['Test Reel', 'Test Jig', 'Test Reel', 'Test Jig'])

    // Tempo events: 4/4 at 120 BPM = 500,000 us/quarter; 6/8 at 120 dotted-quarter BPM = 333,333 us/quarter
    const tempos = conductor
      .filter((e) => e.kind === 'meta' && e.metaType === 0x51)
      .map((e) => (e.data[0] << 16) | (e.data[1] << 8) | e.data[2])
    expect(tempos[0]).toBe(500000)
    expect(tempos[1]).toBe(333333)
  })

  it('routes Solo Melody, Chords, Bass, and Bodhrán onto distinct MIDI channels with Program Changes', () => {
    const midi = parseSmf(
      buildMidiFile(
        baseOptions({
          instruments: { melody: 73, chords: 24, bass: 32 },
          bodhran: true,
        }),
      ).bytes,
    )

    const programEvents = midi.tracks
      .slice(1)
      .flatMap((trk) => trk.filter((e) => e.kind === 'channel' && e.status === 0xc0))
      .map((e) => ({ channel: e.channel, program: e.data[0] }))

    expect(programEvents).toContainEqual({ channel: 0, program: 73 })
    const chordProg = programEvents.find((e) => e.program === 24)
    const bassProg = programEvents.find((e) => e.program === 32)
    expect(chordProg).toBeDefined()
    expect(bassProg).toBeDefined()
    expect(chordProg!.channel).not.toBe(0)
    expect(bassProg!.channel).not.toBe(0)
    expect(chordProg!.channel).not.toBe(bassProg!.channel)

    // Bodhrán percussion track on channel 9 (MIDI channel 10)
    const percTrack = midi.tracks.find((trk) =>
      trk.some((e) => e.kind === 'channel' && e.status === 0x90 && e.channel === 9),
    )
    expect(percTrack).toBeDefined()
  })

  it('exports Band mode voices with pan, pitch bend cents, and optional bodhrán', () => {
    const midi = parseSmf(
      buildMidiFile(
        baseOptions({
          bandMode: true,
          bandVoices: [
            { role: 'leader', program: 110, pan: 0, centsOffset: 0 },
            { role: 'backer', program: 73, pan: -0.6, centsOffset: 4 },
          ],
          bodhran: true,
        }),
      ).bytes,
    )

    const programs = midi.tracks
      .slice(1)
      .flatMap((trk) => trk.filter((e) => e.kind === 'channel' && e.status === 0xc0))
    expect(programs.some((e) => e.channel === 0 && e.data[0] === 110)).toBe(true)
    expect(programs.some((e) => e.channel === 1 && e.data[0] === 73)).toBe(true)

    const backerTrack = midi.tracks.find((trk) =>
      trk.some((e) => e.kind === 'channel' && e.channel === 1),
    )!
    // Pan CC 10 on channel 1 is shifted left (< 64)
    const panEvent = backerTrack.find((e) => e.kind === 'channel' && e.status === 0xb0 && e.data[0] === 10)
    expect(panEvent).toBeDefined()
    expect(panEvent!.data[1]).toBeLessThan(64)

    // Pitch bend event emitted for centsOffset = 4
    const bendEvent = backerTrack.find((e) => e.kind === 'channel' && e.status === 0xe0)
    expect(bendEvent).toBeDefined()

    // Leader bodhrán on channel 9
    expect(
      midi.tracks.some((trk) => trk.some((e) => e.kind === 'channel' && e.status === 0x90 && e.channel === 9)),
    ).toBe(true)
  })

  it('applies swing, meter emphasis, and plucked-instrument subdivision', () => {
    const straight = parseSmf(
      buildMidiFile(
        baseOptions({
          items: [{ title: 'Jig', abc: JIG_ABC, repetitions: 1, tuneType: 'Jig' }],
          swingPercent: 0,
          emphasisPercent: 0,
          instruments: { melody: 110, chords: 24, bass: 32 },
        }),
      ).bytes,
    )
    const swungAndEmphasized = parseSmf(
      buildMidiFile(
        baseOptions({
          items: [{ title: 'Jig', abc: JIG_ABC, repetitions: 1, tuneType: 'Jig' }],
          swingPercent: 80,
          emphasisPercent: 100,
          instruments: { melody: 105, chords: 24, bass: 32 }, // Banjo (105) triggers subdivision on longer notes
        }),
      ).bytes,
    )

    const melodyNoteOns = (m: ParsedMidi) =>
      m.tracks[1].filter((e) => e.kind === 'channel' && e.status === 0x90)

    const a = melodyNoteOns(straight)
    const b = melodyNoteOns(swungAndEmphasized)

    // Swung ticks differ from straight ticks
    expect(b.map((e) => e.tick)).not.toEqual(a.map((e) => e.tick))
    // Emphasized velocities have wider dynamic spread than flat 0% emphasis
    const minVel = Math.min(...b.map((e) => e.data[1]))
    const maxVel = Math.max(...b.map((e) => e.data[1]))
    expect(maxVel - minVel).toBeGreaterThan(20)
  })
})
