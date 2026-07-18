import { useEffect, useRef } from 'preact/hooks';
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

  return <div class="sheet-music" ref={ref} />;
}
