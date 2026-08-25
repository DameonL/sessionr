"use client";

import { useEffect, useRef, useState } from "react";
import abcjs from "abcjs";
import { fixAbcRepeats } from "../services/abcTools";
import { getDefaultTargetBpm } from "../services/api";
import type { BandVoice, SessionTune } from "../services/virtualSession";
import { anchorTimerToAudio } from "../services/audioClock";
import { backerStartOffsetMs, clearPendingTimeouts } from "../services/band";
import { createBandSynth } from "../services/bandSynth";
import { getOrCreateCursor, updateCursorPosition } from "./playerControls";

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

interface PreparedPass {
  synths: abcjs.MidiBuffer[];
  effectiveBpm: number;
  msPerMeasure: number;
}

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
  /** In-flight (or resolved) priming of the *next* pass's band, started as soon as the current pass begins playing. */
  const nextPassRef = useRef<Promise<PreparedPass | null> | null>(null);
  /** Synths from a resolved prefetch that haven't been claimed by startPass() yet — tracked so teardown()/a tune switch can stop them instead of leaking. */
  const nextPassSynthsRef = useRef<abcjs.MidiBuffer[]>([]);
  /** Bumped by teardown() so an in-flight startPass() knows if a tune switch or teardown occurred while it was awaiting synth preparation. */
  const playSessionRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "playing" | "done">("loading");
  const [pass, setPass] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    passRef.current = 1;
    isFirstPassRef.current = !alreadyRevealed;
    nextPassRef.current = null;
    nextPassSynthsRef.current = [];
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

  function teardown() {
    playSessionRef.current += 1;
    pendingTimeoutsRef.current = clearPendingTimeouts(pendingTimeoutsRef.current);
    for (const synth of synthsRef.current) synth.stop();
    synthsRef.current = [];
    for (const synth of nextPassSynthsRef.current) synth.stop();
    nextPassSynthsRef.current = [];
    nextPassRef.current = null;
    if (timerRef.current) {
      timerRef.current.stop();
      timerRef.current = null;
    }
  }

  /**
   * Creates and primes a full band's synths for one pass — the expensive, async part
   * (audio buffer rendering) — without starting playback. Split out from startPass so
   * it can be run ahead of time for the *next* pass while the current one is still
   * playing, instead of only starting once the current pass has already stopped.
   */
  async function prepareSynths(): Promise<PreparedPass | null> {
    const visualObj = visualObjRef.current;
    if (!visualObj) return null;

    const jitterPct = (Math.random() * 2 - 1) * TEMPO_JITTER_PCT;
    const baseBpm = tune.tuneType ? getDefaultTargetBpm(tune.tuneType) : visualObj.getBpm();
    const effectiveBpm = Math.round((baseBpm || visualObj.getBpm()) * (1 + jitterPct));
    const msPerMeasure = visualObj.millisecondsPerMeasure(effectiveBpm);
    const meter = visualObj.getMeterFraction();
    const meterSize = meter.den ? meter.num / meter.den : 1;
    const tempoMultiplierSec = msPerMeasure / 1000 / meterSize;

    try {
      const synths = await Promise.all(
        bandVoices.map((voice) => createBandSynth(visualObj, msPerMeasure, voice, tempoMultiplierSec)),
      );
      return { synths, effectiveBpm, msPerMeasure };
    } catch {
      return null;
    }
  }

  async function startPass() {
    const visualObj = visualObjRef.current;
    if (!visualObj) return;
    const mySession = playSessionRef.current;
    setStatus("loading");
    setError(null);
    pendingTimeoutsRef.current = clearPendingTimeouts(pendingTimeoutsRef.current);

    const isFirstPass = isFirstPassRef.current;

    // Reuse the band that was primed in the background while the previous pass was
    // still playing, if it's ready (or wait for it if it hasn't quite finished yet) —
    // that's what avoids a dead gap here on every repeat. Only the very first pass of
    // a tune has to prime cold.
    let prepared: PreparedPass | null;
    if (nextPassRef.current) {
      prepared = await nextPassRef.current;
      nextPassRef.current = null;
      nextPassSynthsRef.current = [];
    } else {
      prepared = await prepareSynths();
    }

    if (playSessionRef.current !== mySession) {
      prepared?.synths.forEach((s) => s.stop());
      return;
    }

    if (!prepared) {
      setError("Audio unavailable (soundfont could not be loaded).");
      return;
    }

    const { synths, effectiveBpm, msPerMeasure } = prepared;

    try {
      synthsRef.current = synths;

      const timer = new abcjs.TimingCallbacks(visualObj, {
        qpm: effectiveBpm,
        eventCallback: (ev: abcjs.NoteTimingEvent | null) => handleEvent(ev, isFirstPass),
      });
      timerRef.current = timer;

      setStatus("playing");
      synths[0].start();
      synths.slice(1).forEach((synth, backerIndex) => {
        const humanizedOffsetMs = backerStartOffsetMs();
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
      // The timer only latches its zero on the next animation frame, so any delay between
      // synths[0].start() and that frame would become a permanent cursor lag. Pin it to the
      // audio clock once the frame arrives instead.
      requestAnimationFrame(() => {
        if (playSessionRef.current !== mySession) return;
        if (timerRef.current !== timer) return;
        anchorTimerToAudio(timer, synths[0]);
      });
    } catch {
      setError("Audio unavailable (soundfont could not be loaded).");
      return;
    }

    // Kick off priming the next pass's band now, in the background, so it's ready by
    // the time this pass ends instead of only starting to prime after it's already over.
    if (passRef.current < tune.repetitions) {
      const preparePromise = prepareSynths();
      nextPassRef.current = preparePromise;
      preparePromise.then((result) => {
        if (nextPassRef.current === preparePromise) {
          nextPassSynthsRef.current = result?.synths ?? [];
        } else {
          // Superseded by a tune change/teardown before this resolved — don't leak it.
          result?.synths.forEach((s) => s.stop());
        }
      });
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
