export interface PlayerPrefs {
  repeat: boolean
  repeatLimit: number | null
  bodhran: boolean
  trainer: {
    armed: boolean
    startPct: number
    stepPct: number
    targetPct: number
  }
}

const PLAYER_PREFS_KEY = 'sessionapp.player-prefs'

const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  repeat: false,
  repeatLimit: null,
  bodhran: false,
  trainer: { armed: false, startPct: 60, stepPct: 5, targetPct: 100 },
}

export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(PLAYER_PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        ...DEFAULT_PLAYER_PREFS,
        ...parsed,
        trainer: { ...DEFAULT_PLAYER_PREFS.trainer, ...parsed.trainer },
      }
    }
  } catch {}
  return DEFAULT_PLAYER_PREFS
}

export function savePlayerPrefs(prefs: PlayerPrefs): void {
  try {
    localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify(prefs))
  } catch {}
}
