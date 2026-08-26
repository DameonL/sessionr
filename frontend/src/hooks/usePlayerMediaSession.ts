"use client";

import { useEffect, useRef } from 'react'
import {
  claimMediaSession,
  ownsMediaSession,
  releaseMediaSession,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPosition,
  type MediaSessionHandlers,
} from '../services/mediaSession'

interface PlayerMediaSessionOptions {
  /** 'stopped' releases the session; 'playing' claims it. */
  status: 'stopped' | 'playing' | 'paused'
  title: string
  artist: string
  album: string
  positionSec: number
  durationSec: number
  handlers: MediaSessionHandlers
}

/**
 * Wires one player instance up to the OS media controls (headset buttons, media keys, lock screen).
 *
 * The session is claimed when this player starts playing and released when it stops or unmounts, so
 * on a page with several players the one actually making sound owns the controls. See
 * services/mediaSession.ts for why a silent audio element is involved.
 */
export function usePlayerMediaSession({
  status,
  title,
  artist,
  album,
  positionSec,
  durationSec,
  handlers,
}: PlayerMediaSessionOptions) {
  // Identifies this player instance for the lifetime of the component.
  const tokenRef = useRef<symbol | null>(null)
  if (tokenRef.current === null) tokenRef.current = Symbol('player-media-session')
  const token = tokenRef.current

  /*
   * The OS invokes handlers long after this effect ran, and they close over player state (position,
   * active tune) that changes constantly. Registering them once against a ref keeps the handlers
   * current without re-running setActionHandler on every beat.
   */
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (status === 'stopped') {
      releaseMediaSession(token)
      return
    }

    if (!ownsMediaSession(token)) {
      const stable: MediaSessionHandlers = {
        play: () => handlersRef.current.play(),
        pause: () => handlersRef.current.pause(),
        stop: () => handlersRef.current.stop(),
        seekTo: (s) => handlersRef.current.seekTo(s),
        seekBy: (s) => handlersRef.current.seekBy(s),
        // Presence, not identity, is what matters here: it decides whether the OS shows the skip
        // buttons at all, so it is read from the first render's handlers and refreshed below.
        nextTrack: handlers.nextTrack ? () => handlersRef.current.nextTrack?.() : undefined,
        previousTrack: handlers.previousTrack ? () => handlersRef.current.previousTrack?.() : undefined,
      }
      claimMediaSession(token, stable)
    }

    setMediaSessionPlaybackState(token, status === 'playing' ? 'playing' : 'paused')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, token, Boolean(handlers.nextTrack), Boolean(handlers.previousTrack)])

  useEffect(() => {
    if (status === 'stopped') return
    setMediaSessionMetadata(token, { title, artist, album })
  }, [status, token, title, artist, album])

  useEffect(() => {
    if (status === 'stopped') return
    setMediaSessionPosition(token, { duration: durationSec, position: positionSec })
  }, [status, token, durationSec, positionSec])

  useEffect(() => () => releaseMediaSession(token), [token])
}
