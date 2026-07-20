"use client";
import { use } from 'react';
import { TuneLibraryDetail } from '../../../views/TuneLibraryDetail';

export default function Page({ params }: { params: Promise<{ tuneId: string }> }) {
  const { tuneId } = use(params);
  return <TuneLibraryDetail tuneId={tuneId} />;
}
