"use client";
import { use } from 'react';
import { GroupSetDetail } from '../../../views/GroupSetDetail';

export default function Page({ params }: { params: Promise<{ groupSetId: string }> }) {
  const { groupSetId } = use(params);
  return <GroupSetDetail groupSetId={groupSetId} />;
}
