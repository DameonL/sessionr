import { useEffect, useRef } from "react";

export interface AbcCursorRange {
  start: number;
  end: number;
}

export interface AbcSourceViewProps {
  /** The engraved ABC — the exact string handed to renderAbc, so cursor offsets line up with it. */
  abc: string;
  /** Character range of the note currently sounding, or null when nothing is playing. */
  cursor: AbcCursorRange | null;
  onCopy: () => void;
}

/**
 * The tune as ABC text, with the same playback cursor the staff gets.
 *
 * abcjs reports each note's startChar/endChar as offsets into the string it engraved, so following
 * playback here is a matter of slicing that string around the current note. Both halves of the
 * staff's cursor are mirrored: the note's characters are highlighted the way its note heads are,
 * and a caret sits in front of them the way the vertical cursor line does — without it the eye has
 * nothing to track through a run of notes that all look alike as text.
 */
export function AbcSourceView({ abc, cursor, onCopy }: AbcSourceViewProps) {
  const noteRef = useRef<HTMLElement>(null);

  const start = cursor ? Math.max(0, Math.min(cursor.start, abc.length)) : 0;
  const end = cursor ? Math.max(start, Math.min(cursor.end, abc.length)) : 0;
  // A zero-width range would render an invisible mark, so give the caret at least one character to
  // sit on. Notes always report a real range; this covers a malformed one.
  const hasCursor = cursor !== null && end > start;

  useEffect(() => {
    if (!hasCursor) return;
    noteRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [hasCursor, start, end]);

  return (
    <div className="abc-source-view">
      <div className="abc-source-toolbar">
        <button type="button" onClick={onCopy}>
          📋 Copy ABC
        </button>
      </div>
      <pre className="abc-code-block abc-source-text">
        {hasCursor ? (
          <>
            {abc.slice(0, start)}
            <span className="abc-source-caret" aria-hidden="true" />
            <mark className="abc-source-note" ref={noteRef}>
              {abc.slice(start, end)}
            </mark>
            {abc.slice(end)}
          </>
        ) : (
          abc
        )}
      </pre>
    </div>
  );
}
