import { describe, it, expect } from 'vitest'
import { BADGE_CATALOG, getBadgeInfo } from './badges'

describe('badges', () => {
  it.each(Object.keys(BADGE_CATALOG))('describes %s with an emoji, label and description', (key) => {
    const badge = getBadgeInfo(key)

    expect(badge.emoji).not.toBe('')
    expect(badge.label).not.toBe('')
    expect(badge.description).not.toBe('')
  })

  it('covers exactly the badge keys the server awards', () => {
    // Mirrors GamificationService.BadgeLabel in api/Shared/Services/GamificationService.cs.
    // A badge added there without a catalog entry here renders as a bare key with a 🏅.
    expect(Object.keys(BADGE_CATALOG).sort()).toEqual([
      'active-20',
      'active-5',
      'first-practice',
      'interval-first',
      'interval-perfect',
      'interval-perfect-play',
      'interval-rounds-10',
      'interval-rounds-200',
      'interval-rounds-50',
      'streak-100',
      'streak-30',
      'streak-365',
      'streak-7',
    ])
  })

  it('falls back to a generic badge for an unknown key', () => {
    const badge = getBadgeInfo('streak-1000')

    expect(badge.emoji).toBe('🏅')
    expect(badge.label).toBe('streak-1000') // shows the raw key rather than nothing
    expect(badge.description).toBe('')
  })

  it('gives every streak badge the same emoji', () => {
    const streakEmojis = Object.entries(BADGE_CATALOG)
      .filter(([key]) => key.startsWith('streak-'))
      .map(([, badge]) => badge.emoji)

    expect(new Set(streakEmojis).size).toBe(1)
  })

  it('has a distinct label per badge', () => {
    const labels = Object.values(BADGE_CATALOG).map((b) => b.label)

    expect(new Set(labels).size).toBe(labels.length)
  })
})
