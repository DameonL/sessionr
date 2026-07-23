"use client";

import { useEffect, useRef, useState } from "react";
import abcjs from "abcjs";
import { fixAbcRepeats } from "../services/abcTools";
import { getDefaultTargetBpm } from "../services/api";
import type { BandVoice, SessionTune } from "../services/virtualSession";
import { getOrCreateCursor, updateCursorPosition } from "./playerControls";

/** Per-note timing jitter for backers, in seconds — subtle, applied within every pass, not just at the entrance. */
const TIMING_JITTER_SEC = 0.02;
/** Per-note volume jitter for backers, as a multiplier range around the notated velocity. */
const MIN_VOLUME_MULTIPLIER = 0.85;
const MAX_VOLUME_MULTIPLIER = 1.15;

/**
 * Backers start a touch after the leader, like independent live musicians —
 * kept small since this offset persists for the whole pass (each synth runs
 * on its own clock once started), so anything much bigger reads as flamming
 * rather than a live feel.
 */
const MIN_BACKER_OFFSET_MS = 10;
const MAX_BACKER_OFFSET_MS = 35;
/**
 * On a tune's first pass, each backer joins in one at a time rather than all
 * at once — the Nth backer enters after roughly N measures, so the band
 * visibly/audibly builds within the first few bars.
 */
const BACKER_ENTRANCE_MEASURES = [1, 2, 3];
/**
 * Entrances are nudged off the barline by up to this fraction of a measure
 * (earlier or later) — a real player joining in doesn't click in exactly on
 * beat 1, they catch the tail of the previous bar or slip in just after it.
 */
const ENTRANCE_MEASURE_JITTER_FRACTION = 0.2;
/** Small per-pass tempo jitter so the band doesn't feel perfectly metronomic. */
const TEMPO_JITTER_PCT = 0.02;

export interface VirtualSessionPlayerProps {
  tune: SessionTune;
  /** [leader, ...backers] for this session — same band plays every tune in the sitting. */
  bandVoices: BandVoice[];
  /** Notation stays hidden and reveals note-by-note until this tune has had one full pass this sitting. */
  alreadyRevealed: boolean;
  onTuneRevealed: (userTuneId: string) => void;
  onTuneComplete: (userTuneId: string) => void;
}

/**
 * Plays a single Virtual Session tune with a simulated 4-piece band: one
 * leader synth (drives the cursor and, on a tune's first pass, progressive
 * note reveal) plus three backer synths. Backers get per-note timing/volume
 * humanization and a fixed per-instrument detune (the leader's audio is left
 * untouched so it stays exactly in sync with its own cursor/reveal timing),
 * plus a humanized start stagger; on a tune's first pass they also enter one
 * at a time across the first few measures instead of all joining at once.
 */
export function VirtualSessionPlayer({ tune, bandVoices, alreadyRevealed, onTuneRevealed, onTuneComplete }: VirtualSessionPlayerProps) {
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
    const meter = visualObj.getMeterFraction();
    const meterSize = meter.den ? meter.num / meter.den : 1;
    const tempoMultiplierSec = msPerMeasure / 1000 / meterSize;

    try {
      const synths = await Promise.all(
        bandVoices.map(async (voice) => {
          const synth = new abcjs.synth.CreateSynth();
          await synth.init({
            visualObj,
            millisecondsPerMeasure: msPerMeasure,
            options: {
              program: voice.program,
              chordprog: voice.program,
              bassprog: voice.program,
              pan: [voice.pan, voice.pan, voice.pan],
              sequenceCallback:
                voice.role === "backer"
                  ? (tracks: abcjs.NoteMapTrack[]) => {
                      humanizeBackerTracks(tracks, voice, tempoMultiplierSec);
                      return tracks;
                    }
                  : undefined,
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
        const humanizedOffsetMs = MIN_BACKER_OFFSET_MS + Math.random() * (MAX_BACKER_OFFSET_MS - MIN_BACKER_OFFSET_MS);
        // First pass: each backer enters one at a time, N measures in, so the band audibly
        // builds. The wall-clock delay before starting must match how far into the tune we
        // then seek — otherwise the backer starts playing almost immediately (barely after
        // the leader) but from a position N measures into the buffer, so it sounds like it's
        // playing a completely different part of the tune than the leader, rather than
        // joining in where the tune actually is by the time it comes in.
        const entranceMeasures = isFirstPass ? BACKER_ENTRANCE_MEASURES[backerIndex] ?? 0 : 0;
        // Nudge off the barline rather than landing exactly on beat 1 of the entrance measure.
        const measureJitter =
          entranceMeasures > 0 ? (Math.random() * 2 - 1) * ENTRANCE_MEASURE_JITTER_FRACTION * msPerMeasure : 0;
        const entranceMs = Math.max(0, entranceMeasures * msPerMeasure + measureJitter);
        const entranceSeconds = entranceMs / 1000;
        const id = window.setTimeout(() => {
          if (!synthsRef.current.includes(synth)) return;
          if (entranceSeconds > 0) synth.seek(entranceSeconds, "seconds");
          synth.start();
        }, entranceMs + humanizedOffsetMs);
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

/**
 * Mutates a backer's generated note sequence in place (abcjs ignores the
 * return value) so it doesn't sound like a perfectly quantized MIDI track:
 * a small random timing nudge and volume variation per note, plus this
 * backer's own fixed intonation quirk.
 */
function humanizeBackerTracks(tracks: abcjs.NoteMapTrack[], voice: BandVoice, tempoMultiplierSec: number) {
  for (const track of tracks) {
    for (const note of track) {
      const jitter = ((Math.random() * 2 - 1) * TIMING_JITTER_SEC) / tempoMultiplierSec;
      note.start = Math.max(0, note.start + jitter);
      note.end = Math.max(note.start + 0.001, note.end + jitter);
      note.volume = Math.max(1, Math.round(note.volume * (MIN_VOLUME_MULTIPLIER + Math.random() * (MAX_VOLUME_MULTIPLIER - MIN_VOLUME_MULTIPLIER))));
      if (voice.centsOffset) note.cents = (note.cents ?? 0) + voice.centsOffset;
    }
  }
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
