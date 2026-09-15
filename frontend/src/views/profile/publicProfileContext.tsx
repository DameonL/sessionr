"use client";

import { createContext, useContext } from 'react'
import type {
  GamificationSummary,
  ModeratorUserDetails,
  PublicUserProfile,
  UserBadge,
} from '../../services/api'

/**
 * Shared public-profile state, provided by the profile route layout and consumed by each tab panel.
 * The layout only renders its children once the profile query has resolved, so `profile` is always
 * defined for consumers.
 *
 * Deliberately carries no tune or set list: each panel fetches its own when it is opened. The
 * layout used to prefetch both so the tabs could show counts, which cost up to ~15 KB gzipped on
 * a landing view that needed two integers — the profile payload carries those counts instead.
 */
export interface PublicProfileContextValue {
  slug: string
  profile: PublicUserProfile
  /** The profile owner's id, resolved from the slug. */
  userId: string
  isViewerModerator: boolean
  /** True when the signed-in viewer is looking at their own profile. */
  isOwnProfile: boolean
  gamification: GamificationSummary | undefined
  moderatorDetails: ModeratorUserDetails | undefined
  onSelectBadge: (badge: UserBadge) => void
}

const PublicProfileContext = createContext<PublicProfileContextValue | null>(null)

export const PublicProfileProvider = PublicProfileContext.Provider

export function usePublicProfile(): PublicProfileContextValue {
  const value = useContext(PublicProfileContext)
  if (!value) {
    throw new Error('usePublicProfile must be used within the profile route layout')
  }
  return value
}
