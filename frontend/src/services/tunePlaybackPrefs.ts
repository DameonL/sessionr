export interface TunePlaybackPrefs {
  tempoPercent: number
  swingPercent: number
}

const TUNE_PLAYBACK_PREFS_KEY = 'sessionapp.tune-playback-prefs'
const DEFAULT_PREFS: TunePlaybackPrefs = { tempoPercent: 100, swingPercent: 0 }

function loadAll(): Record<string, TunePlaybackPrefs> {
  try {
    return JSON.parse(localStorage.getItem(TUNE_PLAYBACK_PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveAll(all: Record<string, TunePlaybackPrefs>): void {
  try {
    localStorage.setItem(TUNE_PLAYBACK_PREFS_KEY, JSON.stringify(all))
  } catch {}
}

export function loadTunePlaybackPrefs(tuneKey: string): TunePlaybackPrefs {
  if (!tuneKey) return DEFAULT_PREFS
  return loadAll()[tuneKey] ?? DEFAULT_PREFS
}

/** Only persists an entry when tempo/swing differ from the tune's natural defaults, so unmodified tunes don't clutter storage. */
export function saveTunePlaybackPrefs(tuneKey: string, prefs: TunePlaybackPrefs): void {
  if (!tuneKey) return
  const all = loadAll()
  const isDefault = prefs.tempoPercent === DEFAULT_PREFS.tempoPercent && prefs.swingPercent === DEFAULT_PREFS.swingPercent
  if (isDefault) {
    if (tuneKey in all) {
      delete all[tuneKey]
      saveAll(all)
    }
    return
  }
  all[tuneKey] = prefs
  saveAll(all)
}
