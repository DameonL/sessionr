import { describe, it, expect, vi, beforeEach } from 'vitest'
import { playNoteSequence } from './earTraining'

/** Everything the sequence builder and the synth were asked to do, in order. */
const { log, appended, initOptions, clockGate } = vi.hoisted(() => ({
  log: [] as string[],
  appended: [] as Array<{ track: number; pitch: number; duration: number; volume: number }>,
  initOptions: [] as unknown[],
  /** Lets a test hold playback at the audio-clock wait and release it by hand. */
  clockGate: { release: null as null | (() => void) },
}))

vi.mock('./audioClock', () => ({
  waitForAudioClock: () => {
    log.push('waitForAudioClock')
    if (!clockGate.release) return Promise.resolve()
    return new Promise<void>((resolve) => {
      clockGate.release = () => resolve()
    })
  },
}))

vi.mock('abcjs', () => {
  class SynthSequence {
    tracks = 0
    addTrack() {
      log.push('addTrack')
      return this.tracks++
    }
    setInstrument(track: number, instrument: number) {
      log.push(`setInstrument(${track},${instrument})`)
    }
    appendNote(track: number, pitch: number, duration: number, volume: number) {
      appended.push({ track, pitch, duration, volume })
    }
  }
  class CreateSynth {
    init(options: unknown) {
      log.push('init')
      initOptions.push(options)
      return Promise.resolve({})
    }
    prime() {
      log.push('prime')
      return Promise.resolve({})
    }
    start() {
      log.push('start')
    }
    stop() {
      log.push('stop')
    }
  }
  return { default: { synth: { SynthSequence, CreateSynth } } }
})

beforeEach(() => {
  log.length = 0
  appended.length = 0
  initOptions.length = 0
  clockGate.release = null
})

describe('playNoteSequence', () => {
  it('renders the notes and their gaps into one buffer, on a single track', async () => {
    await playNoteSequence(
      [
        { midi: 62, durationMs: 900, gapMs: 400 },
        { midi: 66, durationMs: 900 },
      ],
      110,
    )

    expect(log.filter((c) => c === 'addTrack')).toHaveLength(1)
    expect(appended).toEqual([
      { track: 0, pitch: 62, duration: 0.9, volume: 85 },
      // The gap: silence rendered as a note nobody can hear.
      { track: 0, pitch: 62, duration: 0.4, volume: 0 },
      { track: 0, pitch: 66, duration: 0.9, volume: 85 },
    ])
    expect(log).toContain('setInstrument(0,110)')
  })

  it('reuses the preceding pitch for a gap, so no extra soundfont note is fetched', async () => {
    await playNoteSequence([
      { midi: 71, durationMs: 500, gapMs: 250 },
      { midi: 59, durationMs: 500 },
    ])
    expect(appended[1]).toEqual({ track: 0, pitch: 71, duration: 0.25, volume: 0 })
  })

  it('drops a trailing gap rather than padding the buffer with silence', async () => {
    const playback = await playNoteSequence([{ midi: 62, durationMs: 900, gapMs: 400 }])
    expect(appended).toHaveLength(1)
    expect(playback.durationMs).toBe(900)
  })

  it('reports the sounding length, gaps included, so the caller can time the prompt', async () => {
    const playback = await playNoteSequence([
      { midi: 62, durationMs: 900, gapMs: 400 },
      { midi: 64, durationMs: 900, gapMs: 400 },
      { midi: 66, durationMs: 900 },
    ])
    expect(playback.durationMs).toBe(3500)
  })

  it('loads and renders the buffer before starting it', async () => {
    await playNoteSequence([{ midi: 62, durationMs: 900 }])
    expect(log.filter((c) => ['init', 'prime', 'waitForAudioClock', 'start'].includes(c))).toEqual([
      'init',
      'prime',
      'waitForAudioClock',
      'start',
    ])
  })

  it('measures durations against a one-second measure', async () => {
    await playNoteSequence([{ midi: 62, durationMs: 900 }])
    expect(initOptions[0]).toMatchObject({ millisecondsPerMeasure: 1000 })
  })

  it('holds the start until the output device is really rendering', async () => {
    clockGate.release = () => {}
    const pending = playNoteSequence([{ midi: 62, durationMs: 900 }])
    await vi.waitFor(() => expect(log).toContain('waitForAudioClock'))
    expect(log).not.toContain('start')

    clockGate.release()
    await pending
    expect(log).toContain('start')
  })

  it('surfaces a failed soundfont load instead of playing nothing in silence', async () => {
    const synth = (await import('abcjs')).default.synth as unknown as {
      CreateSynth: { prototype: { init: () => Promise<unknown> } }
    }
    const init = vi
      .spyOn(synth.CreateSynth.prototype, 'init')
      .mockRejectedValueOnce(new Error('soundfont 404'))

    await expect(playNoteSequence([{ midi: 62, durationMs: 900 }])).rejects.toThrow('soundfont 404')
    init.mockRestore()
  })

  it('stops the buffer on request', async () => {
    const playback = await playNoteSequence([{ midi: 62, durationMs: 900 }])
    playback.stop()
    expect(log).toContain('stop')
  })
})
