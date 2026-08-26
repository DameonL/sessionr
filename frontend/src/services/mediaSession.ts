/**
 * OS-level media controls (headset play/pause buttons, keyboard media keys, lock-screen and
 * notification-shade transport UI) for the abcjs players.
 *
 * Two things make this less direct than it sounds:
 *
 * 1. Our audio comes out of the Web Audio API (the abcjs synth), not a media element. Browsers only
 *    route media keys to a page they consider to be *playing audible media*, and raw Web Audio does
 *    not qualify — so nothing reaches `navigator.mediaSession` unless we also keep a silent looping
 *    <audio> element playing for the duration of playback. That element makes no sound; it exists
 *    purely to make the page eligible.
 *
 * 2. `navigator.mediaSession` is a single global, but several players can be mounted at once (a set
 *    page with a per-tune player, the practice queue). So ownership is arbitrated here: the last
 *    player to start playing claims the session, and a player only ever writes to or clears the
 *    session while it still holds the claim.
 */

/** Seconds to jump when the OS sends a seek button without an explicit offset. */
const DEFAULT_SEEK_OFFSET = 10

export interface MediaSessionHandlers {
  play: () => void
  pause: () => void
  stop: () => void
  /** Absolute position, in seconds from the start of the set. */
  seekTo: (seconds: number) => void
  seekBy: (offsetSeconds: number) => void
  /** Omit to leave the corresponding OS button disabled (single-tune players). */
  nextTrack?: () => void
  previousTrack?: () => void
}

export interface MediaSessionInfo {
  title: string
  artist: string
  album: string
}

export interface MediaSessionPosition {
  duration: number
  position: number
}

let owner: symbol | null = null
let silentAudio: HTMLAudioElement | null = null
let silentAudioUrl: string | null = null

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

/**
 * A fraction of a second of silence as a WAV blob. Built here rather than embedded as a base64
 * data URI so the bytes stay readable, and because Safari refuses to loop some data-URI sources.
 */
function createSilentAudio(): HTMLAudioElement {
  const sampleRate = 8000
  const samples = sampleRate / 4
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  // The sample data is left as the zeroes ArrayBuffer already contains: silence.

  silentAudioUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
  const audio = new Audio(silentAudioUrl)
  audio.loop = true
  audio.volume = 0
  // Keeps iOS from treating this as a candidate for AirPlay / route pickers.
  audio.setAttribute('playsinline', '')
  return audio
}

/**
 * Starts the silent element so the browser considers the page audible.
 *
 * Must be called from inside the user gesture that starts playback — a media element's first
 * play() needs the activation, and our real play() path awaits soundfont loading long enough to
 * lose it.
 */
export function primeMediaSession(): void {
  if (!supported()) return
  try {
    if (!silentAudio) silentAudio = createSilentAudio()
    // Rejection is expected and harmless when there is no activation to spend (autoplay policy);
    // it only costs us the OS controls for that one playback.
    void silentAudio.play().catch(() => {})
  } catch {
    /* Audio construction can throw in locked-down embeddings; media keys simply stay unavailable. */
  }
}

function stopSilentAudio(): void {
  if (!silentAudio) return
  silentAudio.pause()
  silentAudio.currentTime = 0
}

/**
 * Claims the global media session for one player and installs its handlers.
 *
 * @returns true if the claim succeeded, i.e. the caller now owns the session.
 */
export function claimMediaSession(token: symbol, handlers: MediaSessionHandlers): boolean {
  if (!supported()) return false
  owner = token

  const ms = navigator.mediaSession
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, handler)
    } catch {
      /* Not every browser implements every action; an unsupported one just stays unhandled. */
    }
  }

  set('play', () => handlers.play())
  set('pause', () => handlers.pause())
  set('stop', () => handlers.stop())
  set('seekforward', (details) => handlers.seekBy(details.seekOffset ?? DEFAULT_SEEK_OFFSET))
  set('seekbackward', (details) => handlers.seekBy(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET)))
  set('seekto', (details) => {
    if (typeof details.seekTime === 'number') handlers.seekTo(details.seekTime)
  })
  set('nexttrack', handlers.nextTrack ? () => handlers.nextTrack!() : null)
  set('previoustrack', handlers.previousTrack ? () => handlers.previousTrack!() : null)

  return true
}

export function ownsMediaSession(token: symbol): boolean {
  return owner === token
}

export function setMediaSessionMetadata(token: symbol, info: MediaSessionInfo): void {
  if (!supported() || owner !== token) return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title,
      artist: info.artist,
      album: info.album,
      artwork: [
        { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
    })
  } catch {
    /* MediaMetadata is unavailable in a few engines that still expose mediaSession. */
  }
}

export function setMediaSessionPlaybackState(token: symbol, state: MediaSessionPlaybackState): void {
  if (!supported() || owner !== token) return
  navigator.mediaSession.playbackState = state
  if (state === 'playing') primeMediaSession()
  else if (state === 'none') stopSilentAudio()
}

export function setMediaSessionPosition(token: symbol, pos: MediaSessionPosition): void {
  if (!supported() || owner !== token) return
  // A duration of 0, a NaN, or a position past the end all throw; a set whose durations have not
  // been measured yet hits exactly that, so skip rather than let it break the render.
  if (!Number.isFinite(pos.duration) || pos.duration <= 0) return
  const position = Math.min(Math.max(pos.position, 0), pos.duration)
  try {
    navigator.mediaSession.setPositionState({ duration: pos.duration, position, playbackRate: 1 })
  } catch {
    /* setPositionState is not universally implemented. */
  }
}

/** Relinquishes the session, but only if this player still holds it. */
export function releaseMediaSession(token: symbol): void {
  if (owner !== token) return
  owner = null
  stopSilentAudio()
  if (!supported()) return
  const ms = navigator.mediaSession
  ms.metadata = null
  ms.playbackState = 'none'
  for (const action of ['play', 'pause', 'stop', 'seekforward', 'seekbackward', 'seekto', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) {
    try {
      ms.setActionHandler(action, null)
    } catch {
      /* ignore */
    }
  }
}

/** Test seam: drops the shared element and any claim. */
export function resetMediaSessionForTests(): void {
  owner = null
  if (silentAudio) {
    silentAudio.pause()
    silentAudio = null
  }
  if (silentAudioUrl) {
    URL.revokeObjectURL(silentAudioUrl)
    silentAudioUrl = null
  }
}
