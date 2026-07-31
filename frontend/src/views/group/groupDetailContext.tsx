"use client";

import { createContext, useContext } from 'react'
import type { GroupDetails, GroupMember } from '../../services/api'

/**
 * Shared group-detail state, provided by the group route layout and consumed by
 * each tab panel. The layout only renders its children once the group query has
 * resolved, so `details` is always defined for consumers.
 */
export interface GroupDetailContextValue {
  groupId: string
  userId: string
  details: GroupDetails
  viewer: GroupMember | undefined
  isAdmin: boolean
  isMember: boolean
  isOwner: boolean
  isModerator: boolean
  showSignedInUi: boolean
  invalidate: () => void
}

const GroupDetailContext = createContext<GroupDetailContextValue | null>(null)

export const GroupDetailProvider = GroupDetailContext.Provider

export function useGroupDetail(): GroupDetailContextValue {
  const value = useContext(GroupDetailContext)
  if (!value) {
    throw new Error('useGroupDetail must be used within the group route layout')
  }
  return value
}
