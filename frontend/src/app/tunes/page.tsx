"use client";
import { Suspense } from 'react';
import { TuneLibraryFrame } from '../../views/tuneLibrary/TuneLibraryFrame';
import { TuneSearchView } from '../../views/tuneLibrary/TuneSearchView';

export default function Page() {
  return (
    <TuneLibraryFrame active="search">
      {/* TuneSearchView reads useSearchParams; Suspense keeps static prerender happy. */}
      <Suspense fallback={null}>
        <TuneSearchView />
      </Suspense>
    </TuneLibraryFrame>
  );
}
