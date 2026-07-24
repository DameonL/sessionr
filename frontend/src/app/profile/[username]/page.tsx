"use client";
import { use } from 'react';
import { PublicProfile } from '../../../views/PublicProfile';

export default function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  return <PublicProfile username={username} />;
}
