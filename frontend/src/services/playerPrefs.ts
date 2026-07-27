export interface PlayerPrefs {
  repeat: boolean
  repeatLimit: number | null
  bodhran: boolean
  trainer: {
    armed: boolean
    startBpm: number
    stepBpm: number
    targetBpm: number
  }
}

const PLAYER_PREFS_KEY = 'sessionapp.player-prefs'

const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  repeat: false,
  repeatLimit: null,
  bodhran: false,
  trainer: { armed: false, startBpm: 80, stepBpm: 15, targetBpm: 120 },
}

export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(PLAYER_PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const rawTrainer = parsed.trainer || {}
      return {
        ...DEFAULT_PLAYER_PREFS,
        ...parsed,
        trainer: {
          armed: Boolean(rawTrainer.armed),
          startBpm:
            typeof rawTrainer.startBpm === 'number'
              ? rawTrainer.startBpm
              : DEFAULT_PLAYER_PREFS.trainer.startBpm,
          stepBpm:
            typeof rawTrainer.stepBpm === 'number'
              ? rawTrainer.stepBpm
              : DEFAULT_PLAYER_PREFS.trainer.stepBpm,
          targetBpm:
            typeof rawTrainer.targetBpm === 'number'
              ? rawTrainer.targetBpm
              : DEFAULT_PLAYER_PREFS.trainer.targetBpm,
        },
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
