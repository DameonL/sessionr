import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface SheetMusicProps {
  abcString: string;
}

export function SheetMusic({ abcString }: SheetMusicProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      abcjs.renderAbc(ref.current, abcString, { responsive: 'resize' });
    }
  }, [abcString]);

  return <div className="sheet-music" ref={ref} />;
}
