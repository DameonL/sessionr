"use client";

import { GroupSetBuilder } from '../../components/GroupSetBuilder'
import { useGroupDetail } from './groupDetailContext'

export function GroupSetsPanel() {
  const { groupId, userId, isAdmin, details } = useGroupDetail()
  return <GroupSetBuilder groupId={groupId} userId={userId} isAdmin={isAdmin} masterTunes={details.masterTunes} />
}
