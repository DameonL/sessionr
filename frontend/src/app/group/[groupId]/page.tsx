"use client";

import { use } from 'react'
import { GroupDetail } from '../../../views/GroupDetail'

export default function GroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = use(params)
  return <GroupDetail groupId={groupId} />
}
