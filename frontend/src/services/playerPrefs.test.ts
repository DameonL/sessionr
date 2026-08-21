import { describe, it, expect, beforeEach } from 'vitest'
import { loadPlayerPrefs, savePlayerPrefs, type PlayerPrefs } from './playerPrefs'
import { loadTunePlaybackPrefs, saveTunePlaybackPrefs } from './tunePlaybackPrefs'

const PLAYER_PREFS_KEY = 'sessionapp.player-prefs'
const TUNE_PLAYBACK_PREFS_KEY = 'sessionapp.tune-playback-prefs'

beforeEach(() => {
  localStorage.clear()
})

describe('loadPlayerPrefs', () => {
  it('returns the defaults when nothing has been stored', () => {
    expect(loadPlayerPrefs()).toEqual({
      repeat: false,
      repeatLimit: null,
      bodhran: false,
      trainer: { armed: false, startBpm: 80, stepBpm: 15, targetBpm: 120 },
    })
  })

  it('round-trips saved preferences', () => {
    const prefs: PlayerPrefs = {
      repeat: true,
      repeatLimit: 3,
      bodhran: true,
      trainer: { armed: true, startBpm: 90, stepBpm: 10, targetBpm: 140 },
    }

    savePlayerPrefs(prefs)

    expect(loadPlayerPrefs()).toEqual(prefs)
  })

  it('fills in preferences added since the stored value was written', () => {
    // An older build's payload has no bodhran flag; it must not come back undefined.
    localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify({ repeat: true }))

    const loaded = loadPlayerPrefs()

    expect(loaded.repeat).toBe(true)
    expect(loaded.bodhran).toBe(false)
    expect(loaded.repeatLimit).toBeNull()
    expect(loaded.trainer.startBpm).toBe(80)
  })

  it('replaces non-numeric trainer values with the defaults', () => {
    localStorage.setItem(
      PLAYER_PREFS_KEY,
      JSON.stringify({ trainer: { armed: 'yes', startBpm: 'fast', stepBpm: null, targetBpm: 200 } }),
    )

    const loaded = loadPlayerPrefs()

    expect(loaded.trainer.armed).toBe(true) // coerced, not defaulted
    expect(loaded.trainer.startBpm).toBe(80)
    expect(loaded.trainer.stepBpm).toBe(15)
    expect(loaded.trainer.targetBpm).toBe(200) // a good value is kept
  })

  it('falls back to the defaults on a corrupted payload', () => {
    localStorage.setItem(PLAYER_PREFS_KEY, '{ not json')

    expect(loadPlayerPrefs().trainer.startBpm).toBe(80)
  })

  it('tolerates a stored value with no trainer at all', () => {
    localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify({ repeat: true }))

    expect(loadPlayerPrefs().trainer).toEqual({ armed: false, startBpm: 80, stepBpm: 15, targetBpm: 120 })
  })
})

describe('tune playback prefs', () => {
  it('returns the defaults for a tune with nothing stored', () => {
    expect(loadTunePlaybackPrefs('tune-1')).toEqual({ tempoPercent: 100, swingPercent: 0 })
  })

  it('round-trips a modified tune', () => {
    saveTunePlaybackPrefs('tune-1', { tempoPercent: 80, swingPercent: 40 })

    expect(loadTunePlaybackPrefs('tune-1')).toEqual({ tempoPercent: 80, swingPercent: 40 })
  })

  it('keeps each tune’s settings separate', () => {
    saveTunePlaybackPrefs('tune-1', { tempoPercent: 80, swingPercent: 40 })
    saveTunePlaybackPrefs('tune-2', { tempoPercent: 120, swingPercent: 0 })

    expect(loadTunePlaybackPrefs('tune-1').tempoPercent).toBe(80)
    expect(loadTunePlaybackPrefs('tune-2').tempoPercent).toBe(120)
  })

  it('does not store a tune left at its natural defaults', () => {
    saveTunePlaybackPrefs('tune-1', { tempoPercent: 100, swingPercent: 0 })

    expect(localStorage.getItem(TUNE_PLAYBACK_PREFS_KEY)).toBeNull()
  })

  it('drops a tune’s entry when it is reset to the defaults', () => {
    saveTunePlaybackPrefs('tune-1', { tempoPercent: 80, swingPercent: 40 })
    saveTunePlaybackPrefs('tune-2', { tempoPercent: 120, swingPercent: 0 })

    saveTunePlaybackPrefs('tune-1', { tempoPercent: 100, swingPercent: 0 })

    expect(loadTunePlaybackPrefs('tune-1')).toEqual({ tempoPercent: 100, swingPercent: 0 })
    expect(loadTunePlaybackPrefs('tune-2').tempoPercent).toBe(120) // the other survives
  })

  it.each(['', undefined])('ignores a blank tune key', (key) => {
    expect(loadTunePlaybackPrefs(key as unknown as string)).toEqual({ tempoPercent: 100, swingPercent: 0 })
    expect(() => saveTunePlaybackPrefs(key as unknown as string, { tempoPercent: 50, swingPercent: 0 })).not.toThrow()
    expect(localStorage.getItem(TUNE_PLAYBACK_PREFS_KEY)).toBeNull()
  })

  it('falls back to the defaults on a corrupted payload', () => {
    localStorage.setItem(TUNE_PLAYBACK_PREFS_KEY, 'not json at all')

    expect(loadTunePlaybackPrefs('tune-1')).toEqual({ tempoPercent: 100, swingPercent: 0 })
  })
})
