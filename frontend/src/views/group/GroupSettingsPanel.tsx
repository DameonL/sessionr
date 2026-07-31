"use client";

import { redirect } from 'next/navigation'
import { GroupAdminSettings } from '../../components/GroupAdminSettings'
import { useGroupDetail } from './groupDetailContext'

export function GroupSettingsPanel() {
  const { groupId, userId, isAdmin, isOwner, details, invalidate } = useGroupDetail()

  // Guard direct navigation to /group/[id]/settings by non-admins.
  if (!isAdmin) {
    redirect(`/group/${groupId}`)
  }

  return (
    <GroupAdminSettings
      details={details}
      userId={userId}
      isOwner={isOwner}
      onSaved={invalidate}
    />
  )
}
