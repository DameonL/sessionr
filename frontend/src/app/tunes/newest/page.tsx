"use client";
import { TuneLibraryFrame } from '../../../views/tuneLibrary/TuneLibraryFrame';
import { TuneBrowseView } from '../../../views/tuneLibrary/TuneBrowseView';

export default function Page() {
  return (
    <TuneLibraryFrame active="newest">
      <TuneBrowseView sort="newest" />
    </TuneLibraryFrame>
  );
}
