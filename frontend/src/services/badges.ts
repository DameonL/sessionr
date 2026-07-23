import { showToast } from '../state/appState'

export interface BadgeInfo {
  emoji: string
  label: string
  description: string
}

/** Mirrors the badge keys awarded server-side in api/Shared/Services/GamificationService.cs. */
export const BADGE_CATALOG: Record<string, BadgeInfo> = {
  'first-practice': {
    emoji: '🌱',
    label: 'First Steps',
    description: 'Logged your first practice.',
  },
  'streak-7': {
    emoji: '🔥',
    label: 'Week Warrior',
    description: 'Practiced 7 days in a row.',
  },
  'streak-30': {
    emoji: '🔥',
    label: 'Dedicated',
    description: 'Practiced 30 days in a row.',
  },
  'streak-100': {
    emoji: '🔥',
    label: 'Century',
    description: 'Practiced 100 days in a row.',
  },
  'streak-365': {
    emoji: '🔥',
    label: 'Marathon',
    description: 'Practiced 365 days in a row.',
  },
  'active-5': {
    emoji: '🎻',
    label: 'Getting Started',
    description: '5 tunes at Active status.',
  },
  'active-20': {
    emoji: '🎻',
    label: 'Session Ready',
    description: '20 tunes at Active status.',
  },
}

export function getBadgeInfo(badgeKey: string): BadgeInfo {
  return BADGE_CATALOG[badgeKey] ?? { emoji: '🏅', label: badgeKey, description: '' }
}

/** Shows one toast per newly-earned badge key, e.g. from a logPractice() response. */
export function showBadgeToasts(newBadges: string[] | undefined) {
  for (const key of newBadges ?? []) {
    const badge = getBadgeInfo(key)
    showToast(`${badge.emoji} Badge earned: ${badge.label}!`, 'success')
  }
}
