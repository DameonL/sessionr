"use client";
import { use } from 'react';
import { SetDetail } from '../../../views/SetDetail';

export default function Page({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = use(params);
  return <SetDetail setId={setId} />;
}
