import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  claimMediaSession,
  ownsMediaSession,
  primeMediaSession,
  releaseMediaSession,
  resetMediaSessionForTests,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPosition,
  type MediaSessionHandlers,
} from './mediaSession'

interface FakeSession {
  metadata: unknown
  playbackState: string
  handlers: Map<string, unknown>
  setActionHandler: (action: string, handler: unknown) => void
  setPositionState: (state: unknown) => void
  positionStates: unknown[]
}

let session: FakeSession
let audioInstances: Array<{ play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; currentTime: number; loop: boolean; volume: number }>

function noopHandlers(overrides: Partial<MediaSessionHandlers> = {}): MediaSessionHandlers {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seekTo: vi.fn(),
    seekBy: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  session = {
    metadata: null,
    playbackState: 'none',
    handlers: new Map(),
    positionStates: [],
    setActionHandler(action, handler) {
      this.handlers.set(action, handler)
    },
    setPositionState(state) {
      this.positionStates.push(state)
    },
  }
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true, writable: true })

  audioInstances = []
  vi.stubGlobal(
    'Audio',
    class {
      loop = false
      volume = 1
      currentTime = 0
      play = vi.fn(() => Promise.resolve())
      pause = vi.fn()
      setAttribute = vi.fn()
      constructor() {
        audioInstances.push(this as never)
      }
    },
  )
  vi.stubGlobal('MediaMetadata', class { constructor(public init: unknown) {} })
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:silent', revokeObjectURL: () => {} })
})

afterEach(() => {
  resetMediaSessionForTests()
  vi.unstubAllGlobals()
})

describe('claimMediaSession', () => {
  it('registers the transport actions the OS can send', () => {
    claimMediaSession(Symbol('a'), noopHandlers())

    for (const action of ['play', 'pause', 'stop', 'seekto', 'seekforward', 'seekbackward']) {
      expect(session.handlers.get(action)).toBeTypeOf('function')
    }
  })

  it('leaves skip buttons disabled when no skip handlers are supplied', () => {
    claimMediaSession(Symbol('a'), noopHandlers())

    expect(session.handlers.get('nexttrack')).toBeNull()
    expect(session.handlers.get('previoustrack')).toBeNull()
  })

  it('enables skip buttons for a set', () => {
    claimMediaSession(Symbol('a'), noopHandlers({ nextTrack: vi.fn(), previousTrack: vi.fn() }))

    expect(session.handlers.get('nexttrack')).toBeTypeOf('function')
    expect(session.handlers.get('previoustrack')).toBeTypeOf('function')
  })

  it('applies the OS-supplied seek offset, and a default when none is given', () => {
    const seekBy = vi.fn()
    claimMediaSession(Symbol('a'), noopHandlers({ seekBy }))

    const forward = session.handlers.get('seekforward') as (d: { seekOffset?: number }) => void
    const backward = session.handlers.get('seekbackward') as (d: { seekOffset?: number }) => void
    forward({ seekOffset: 30 })
    forward({})
    backward({ seekOffset: 30 })

    expect(seekBy.mock.calls).toEqual([[30], [10], [-30]])
  })

  it('ignores a seekto without a time', () => {
    const seekTo = vi.fn()
    claimMediaSession(Symbol('a'), noopHandlers({ seekTo }))

    const seekto = session.handlers.get('seekto') as (d: { seekTime?: number }) => void
    seekto({})
    expect(seekTo).not.toHaveBeenCalled()

    seekto({ seekTime: 12 })
    expect(seekTo).toHaveBeenCalledWith(12)
  })
})

describe('ownership between concurrent players', () => {
  it('hands the session to the player that most recently started', () => {
    const a = Symbol('a')
    const b = Symbol('b')

    claimMediaSession(a, noopHandlers())
    expect(ownsMediaSession(a)).toBe(true)

    claimMediaSession(b, noopHandlers())
    expect(ownsMediaSession(a)).toBe(false)
    expect(ownsMediaSession(b)).toBe(true)
  })

  it('ignores writes from a player that no longer owns the session', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    claimMediaSession(a, noopHandlers())
    claimMediaSession(b, noopHandlers())

    setMediaSessionMetadata(a, { title: 'Stale', artist: '', album: '' })
    setMediaSessionPlaybackState(a, 'paused')
    setMediaSessionPosition(a, { duration: 10, position: 1 })

    expect(session.metadata).toBeNull()
    expect(session.playbackState).toBe('none')
    expect(session.positionStates).toEqual([])
  })

  it('does not let a superseded player tear down the live session', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    claimMediaSession(a, noopHandlers())
    claimMediaSession(b, noopHandlers())

    releaseMediaSession(a)

    expect(ownsMediaSession(b)).toBe(true)
    expect(session.handlers.get('play')).toBeTypeOf('function')
  })
})

describe('releaseMediaSession', () => {
  it('clears metadata, state, and every handler for the owner', () => {
    const a = Symbol('a')
    claimMediaSession(a, noopHandlers({ nextTrack: vi.fn() }))
    setMediaSessionMetadata(a, { title: 'Cooley’s', artist: 'Reel', album: 'sessionr' })

    releaseMediaSession(a)

    expect(session.metadata).toBeNull()
    expect(session.playbackState).toBe('none')
    expect([...session.handlers.values()].every((h) => h === null)).toBe(true)
    expect(ownsMediaSession(a)).toBe(false)
  })
})

describe('setMediaSessionPosition', () => {
  it('publishes duration and position', () => {
    const a = Symbol('a')
    claimMediaSession(a, noopHandlers())

    setMediaSessionPosition(a, { duration: 120, position: 30 })

    expect(session.positionStates).toEqual([{ duration: 120, position: 30, playbackRate: 1 }])
  })

  it('skips an unmeasured set rather than throwing', () => {
    const a = Symbol('a')
    claimMediaSession(a, noopHandlers())

    setMediaSessionPosition(a, { duration: 0, position: 0 })
    setMediaSessionPosition(a, { duration: Number.NaN, position: 0 })

    expect(session.positionStates).toEqual([])
  })

  it('clamps a position past the end, which the spec treats as an error', () => {
    const a = Symbol('a')
    claimMediaSession(a, noopHandlers())

    setMediaSessionPosition(a, { duration: 10, position: 99 })
    setMediaSessionPosition(a, { duration: 10, position: -5 })

    expect(session.positionStates).toEqual([
      { duration: 10, position: 10, playbackRate: 1 },
      { duration: 10, position: 0, playbackRate: 1 },
    ])
  })
})

describe('the silent audio element', () => {
  it('plays a single looping muted element so the page counts as audible', () => {
    primeMediaSession()

    expect(audioInstances).toHaveLength(1)
    expect(audioInstances[0].loop).toBe(true)
    expect(audioInstances[0].volume).toBe(0)
    expect(audioInstances[0].play).toHaveBeenCalled()
  })

  it('reuses the same element across playbacks', () => {
    primeMediaSession()
    primeMediaSession()

    expect(audioInstances).toHaveLength(1)
    expect(audioInstances[0].play).toHaveBeenCalledTimes(2)
  })

  it('survives a rejected play() when there is no user activation to spend', () => {
    primeMediaSession()
    audioInstances[0].play.mockReturnValue(Promise.reject(new Error('NotAllowedError')))

    expect(() => primeMediaSession()).not.toThrow()
  })

  it('keeps playing while paused so the OS still offers a play button', () => {
    const a = Symbol('a')
    claimMediaSession(a, noopHandlers())
    primeMediaSession()

    setMediaSessionPlaybackState(a, 'paused')

    expect(session.playbackState).toBe('paused')
    expect(audioInstances[0].pause).not.toHaveBeenCalled()
  })

  it('stops when the owning player releases the session', () => {
    const a = Symbol('a')
    claimMediaSession(a, noopHandlers())
    primeMediaSession()

    releaseMediaSession(a)

    expect(audioInstances[0].pause).toHaveBeenCalled()
  })
})
