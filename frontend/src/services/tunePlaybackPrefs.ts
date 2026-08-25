export interface TunePlaybackPrefs {
  tempoPercent: number
  swingPercent: number
  /** How hard playback leans on the beats the meter leans on, 0-100. */
  emphasisPercent: number
}

const TUNE_PLAYBACK_PREFS_KEY = 'sessionapp.tune-playback-prefs'
/**
 * On by default, and modest: enough that a reel leans and a jig lilts, not so much that the tune
 * sounds like it is being conducted. 0 turns it off entirely and gives back the old flat playback.
 */
export const DEFAULT_EMPHASIS_PERCENT = 40

const DEFAULT_PREFS: TunePlaybackPrefs = { tempoPercent: 100, swingPercent: 0, emphasisPercent: DEFAULT_EMPHASIS_PERCENT }

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
  // Spread over the defaults rather than returning the stored object: entries saved before a field
  // existed would otherwise hand back undefined for it.
  const stored = loadAll()[tuneKey]
  return stored ? { ...DEFAULT_PREFS, ...stored } : DEFAULT_PREFS
}

/** Only persists an entry when something differs from the tune's natural defaults, so unmodified tunes don't clutter storage. */
export function saveTunePlaybackPrefs(tuneKey: string, prefs: TunePlaybackPrefs): void {
  if (!tuneKey) return
  const all = loadAll()
  const isDefault =
    prefs.tempoPercent === DEFAULT_PREFS.tempoPercent &&
    prefs.swingPercent === DEFAULT_PREFS.swingPercent &&
    prefs.emphasisPercent === DEFAULT_PREFS.emphasisPercent
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
