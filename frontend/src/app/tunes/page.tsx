"use client";
import { TuneLibraryFrame } from '../../views/tuneLibrary/TuneLibraryFrame';
import { TuneSearchView } from '../../views/tuneLibrary/TuneSearchView';

export default function Page() {
  return (
    <TuneLibraryFrame active="search">
      <TuneSearchView />
    </TuneLibraryFrame>
  );
}
