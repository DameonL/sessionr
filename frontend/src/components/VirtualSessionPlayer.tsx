"use client";

import { useEffect, useRef, useState } from "react";
import abcjs from "abcjs";
import { fixAbcRepeats } from "../services/abcTools";
import { getDefaultTargetBpm } from "../services/api";
import type { SessionTune } from "../services/virtualSession";
import { getOrCreateCursor, updateCursorPosition } from "./playerControls";

interface BandVoice {
  role: "leader" | "backer";
  program: number;
  pan: number;
  volumeMultiplier: number;
}

/** Leader drives the melody, cursor, and note reveal; backers are audio-only. */
const BAND_VOICES: BandVoice[] = [
  { role: "leader", program: 110, pan: 0, volumeMultiplier: 1.0 }, // Fiddle
  { role: "backer", program: 105, pan: -0.6, volumeMultiplier: 1.0 }, // Banjo
  { role: "backer", program: 25, pan: 0.6, volumeMultiplier: 1.0 }, // Guitar (steel)
  { role: "backer", program: 21, pan: 0, volumeMultiplier: 1.0 }, // Accordion
];

/** Backers start a bit after the leader, like independent live musicians settling in. */
const MIN_BACKER_OFFSET_MS = 60;
const MAX_BACKER_OFFSET_MS = 280;
/**
 * On a tune's first pass, each backer joins in one at a time rather than all
 * at once — the Nth backer enters after N measures (plus the usual humanized
 * offset), so the band visibly/audibly builds within the first few bars.
 */
const BACKER_ENTRANCE_MEASURES = [1, 2, 3];
/** Small per-pass tempo jitter so the band doesn't feel perfectly metronomic. */
const TEMPO_JITTER_PCT = 0.02;

export interface VirtualSessionPlayerProps {
  tune: SessionTune;
  /** Notation stays hidden and reveals note-by-note until this tune has had one full pass this sitting. */
  alreadyRevealed: boolean;
  onTuneRevealed: (userTuneId: string) => void;
  onTuneComplete: (userTuneId: string) => void;
}

/**
 * Plays a single Virtual Session tune with a simulated 4-piece band: one
 * leader synth (drives the cursor and, on a tune's first pass, progressive
 * note reveal) plus three backer synths. Backers are independently started
 * with a humanized stagger rather than in perfect sync; on a tune's first
 * pass they also enter one at a time across the first few measures instead
 * of all joining at once.
 */
export function VirtualSessionPlayer({ tune, alreadyRevealed, onTuneRevealed, onTuneComplete }: VirtualSessionPlayerProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const visualObjRef = useRef<abcjs.TuneObject | null>(null);
  const synthsRef = useRef<abcjs.MidiBuffer[]>([]);
  const timerRef = useRef<abcjs.TimingCallbacks | null>(null);
  const pendingTimeoutsRef = useRef<number[]>([]);
  const passRef = useRef(1);
  const isFirstPassRef = useRef(!alreadyRevealed);
  const [status, setStatus] = useState<"loading" | "playing" | "done">("loading");
  const [pass, setPass] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    passRef.current = 1;
    isFirstPassRef.current = !alreadyRevealed;
    setPass(1);
    setStatus("loading");
    setError(null);

    const host = sheetRef.current;
    if (!host) return;
    const visualObj = abcjs.renderAbc(host, fixAbcRepeats(tune.abc), {
      responsive: "resize",
      add_classes: true,
    })[0] as abcjs.TuneObject;
    visualObjRef.current = visualObj;

    if (isFirstPassRef.current) {
      hideAllNotes(host);
    } else {
      showAllNotes(host);
    }

    startPass();

    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tune.userTuneId]);

  function clearPendingTimeouts() {
    for (const id of pendingTimeoutsRef.current) window.clearTimeout(id);
    pendingTimeoutsRef.current = [];
  }

  function teardown() {
    clearPendingTimeouts();
    for (const synth of synthsRef.current) synth.stop();
    synthsRef.current = [];
    if (timerRef.current) {
      timerRef.current.stop();
      timerRef.current = null;
    }
  }

  async function startPass() {
    const visualObj = visualObjRef.current;
    if (!visualObj) return;
    setStatus("loading");
    setError(null);
    clearPendingTimeouts();

    const isFirstPass = isFirstPassRef.current;
    const jitterPct = (Math.random() * 2 - 1) * TEMPO_JITTER_PCT;
    const baseBpm = tune.tuneType ? getDefaultTargetBpm(tune.tuneType) : visualObj.getBpm();
    const effectiveBpm = Math.round((baseBpm || visualObj.getBpm()) * (1 + jitterPct));
    const msPerMeasure = visualObj.millisecondsPerMeasure(effectiveBpm);

    try {
      const synths = await Promise.all(
        BAND_VOICES.map(async (voice) => {
          const synth = new abcjs.synth.CreateSynth();
          await synth.init({
            visualObj,
            millisecondsPerMeasure: msPerMeasure,
            options: {
              program: voice.program,
              chordprog: voice.program,
              bassprog: voice.program,
              pan: [voice.pan, voice.pan, voice.pan],
              soundFontVolumeMultiplier: voice.volumeMultiplier,
            },
          });
          await synth.prime();
          return synth;
        }),
      );
      synthsRef.current = synths;

      const timer = new abcjs.TimingCallbacks(visualObj, {
        qpm: effectiveBpm,
        eventCallback: (ev: abcjs.NoteTimingEvent | null) => handleEvent(ev, isFirstPass),
      });
      timerRef.current = timer;

      setStatus("playing");
      synths[0].start();
      synths.slice(1).forEach((synth, backerIndex) => {
        const humanizedOffset = MIN_BACKER_OFFSET_MS + Math.random() * (MAX_BACKER_OFFSET_MS - MIN_BACKER_OFFSET_MS);
        // First pass: each backer enters one at a time, N measures in, so the band audibly
        // builds — seek the backer's own synth forward to that point in the tune before
        // starting it, rather than just delaying when it starts (which would otherwise play
        // the opening notes late instead of joining in where the tune actually is).
        const entranceMeasures = isFirstPass ? BACKER_ENTRANCE_MEASURES[backerIndex] ?? 0 : 0;
        const entranceSeconds = (entranceMeasures * msPerMeasure) / 1000;
        const id = window.setTimeout(() => {
          if (!synthsRef.current.includes(synth)) return;
          if (entranceSeconds > 0) synth.seek(entranceSeconds, "seconds");
          synth.start();
        }, humanizedOffset);
        pendingTimeoutsRef.current.push(id);
      });
      timer.start();
    } catch {
      setError("Audio unavailable (soundfont could not be loaded).");
    }
  }

  function handleEvent(ev: abcjs.NoteTimingEvent | null, isFirstPass: boolean) {
    const host = sheetRef.current;
    if (ev) {
      for (const group of ev.elements ?? []) {
        for (const el of group) {
          el.classList.add("highlight");
          if (isFirstPass) el.style.visibility = "visible";
        }
      }
      const svg = host?.querySelector("svg") as SVGSVGElement | null;
      if (typeof ev.left === "number" && typeof ev.top === "number" && typeof ev.height === "number" && svg) {
        updateCursorPosition(svg, ev.left - 2, ev.top, ev.top + ev.height);
      }
      return undefined;
    }

    // End of one pass.
    for (const synth of synthsRef.current) synth.stop();
    timerRef.current?.stop();
    clearHighlights(host);

    if (isFirstPass) {
      isFirstPassRef.current = false;
      onTuneRevealed(tune.userTuneId);
      showAllNotes(host);
    }

    if (passRef.current < tune.repetitions) {
      passRef.current += 1;
      setPass(passRef.current);
      startPass();
    } else {
      setStatus("done");
      onTuneComplete(tune.userTuneId);
    }
    return undefined;
  }

  function clearHighlights(host: HTMLDivElement | null | undefined) {
    if (!host) return;
    for (const el of host.querySelectorAll(".highlight")) el.classList.remove("highlight");
    const svg = host.querySelector("svg");
    const cursor = getOrCreateCursor(svg as SVGSVGElement | null);
    if (cursor) {
      cursor.setAttribute("y1", "0");
      cursor.setAttribute("y2", "0");
    }
  }

  return (
    <div className="player-container">
      <div className="set-header">
        <h2>{tune.title}</h2>
        <span className="tune-meta">
          pass {pass} of {tune.repetitions}
          {isFirstPassRef.current && status !== "done" ? " · first hearing — notes reveal as the band plays" : ""}
        </span>
      </div>
      {status === "loading" && <p className="tune-meta">🎻 Tuning up…</p>}
      {error && <p className="error">{error}</p>}
      <div className="sheet-music" ref={sheetRef} />
    </div>
  );
}

function hideAllNotes(host: HTMLDivElement) {
  host.querySelectorAll<SVGElement>(".abcjs-note:not(.abcjs-rest)").forEach((el) => {
    el.style.visibility = "hidden";
  });
  host.querySelectorAll<SVGElement>(".abcjs-beam-elem, .abcjs-slur, .abcjs-tie, .abcjs-triplet").forEach((el) => {
    el.style.visibility = "hidden";
  });
}

function showAllNotes(host: HTMLDivElement | null | undefined) {
  host?.querySelectorAll<SVGElement>('[style*="visibility"]').forEach((el) => {
    el.style.visibility = "";
  });
}
