"use client";
import { use } from 'react';
import { PublicProfile } from '../../../views/PublicProfile';

export default function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return <PublicProfile userId={userId} />;
}
