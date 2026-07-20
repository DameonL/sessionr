"use client";
import { use } from 'react';
import { TuneDetail } from '../../../views/TuneDetail';
import { RequireAuth } from '../../../components/RequireAuth';

export default function Page({ params }: { params: Promise<{ userTuneId: string }> }) {
  const { userTuneId } = use(params);
  return (
    <RequireAuth message="Sign in to view your personal repertoire.">
      <TuneDetail userTuneId={userTuneId} />
    </RequireAuth>
  );
}
