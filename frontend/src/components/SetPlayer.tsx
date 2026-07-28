import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import abcjs from "abcjs";
import { INSTRUMENTS, loadInstruments, saveInstruments, shouldSubdivideInstrument, subdivideLongNotes, synthInstrumentOptions } from "./instruments";
import { backerStartOffsetMs, clearPendingTimeouts, pickBandVoices, type BandVoice } from "../services/band";
import { createBandSynth } from "../services/bandSynth";
import { loadBandPrefs, saveBandPrefs, MAX_BAND_COUNT, MIN_BAND_COUNT, type BandPrefs } from "../services/bandPrefs";
import { getAbcKeyRoot, playMetronomeClick } from "../services/metronome";
import { fixAbcRepeats } from "../services/abcTools";
import { generateBodhranTrack, getBodhranDrumOption } from "../services/bodhran";
import { loadPlayerPrefs, savePlayerPrefs } from "../services/playerPrefs";
import { loadTunePlaybackPrefs, saveTunePlaybackPrefs } from "../services/tunePlaybackPrefs";
import { getDefaultTargetBpm } from "../services/api";
import { DebouncedNumberInput } from "./DebouncedNumberInput";
import {
  MetronomeControls,
  StaffLine,
  extractLinesFromTimings,
  formatTime,
  getOrCreateCursor,
  scrollToKeepLinesVisible,
  toAbcjsSwing,
  updateCursorPosition,
  useCommitOnChange,
  useMetronomePrefs,
} from "./playerControls";

export interface SetPlayerItem {
  userTuneId: string;
  title: string;
  abc: string;
  repetitions: number;
  /** Used to fall back to a sensible genre-based default tempo when no explicit target BPM is set. */
  tuneType?: string;
}

type PlayerStatus = "stopped" | "playing" | "paused";

interface ExtendedTuneObject extends abcjs.TuneObject {
  setTiming(bpm?: number, measuresOfDelay?: number): abcjs.NoteTimingEvent[];
}

interface Loop {
  a: number;
  b: number;
}

interface Trainer {
  armed: boolean;
  startBpm: number;
  stepBpm: number;
  targetBpm: number;
}

export interface SetPlayerProps {
  items: SetPlayerItem[];
  targetBpm?: number | null;
  isSingleTune?: boolean;
  /** Overrides the per-tune link target (defaults to the personal tune detail page); return null to render plain text. */
  linkHref?: (item: SetPlayerItem) => string | null;
}

/** Computes the base/natural BPM for a tune, falling back to explicit targetBpm or default genre BPM (120) if no Q: header is present. */
function getTuneBaseBpm(visualObj: abcjs.TuneObject | null, targetBpm?: number | null, tuneType?: string): number {
  const natural = visualObj?.getBpm() ?? 0;
  if (natural > 0) return natural;
  if (targetBpm) return targetBpm;
  if (tuneType) return getDefaultTargetBpm(tuneType);
  return 120;
}

/**
 * Consolidated player component: renders and plays sheet music for a single tune
 * or a set medley of multiple tunes. Automatically hides set-specific headers
 * for single tunes while offering speed training and section looping.
 *
 * Playback is either Solo (one synth per tune, with separately configurable
 * melody/chords/bass instruments) or Band (several independent players — like
 * a folk session — each playing the melody line with their own instrument,
 * stereo position, humanized timing/volume, and fixed intonation quirk, mirroring
 * the same virtual-band logic the Virtual Session feature uses).
 */
export function SetPlayer({ items, targetBpm, isSingleTune, linkHref }: SetPlayerProps) {
  const tuneKey = items.map((i) => i.userTuneId).join(",");
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);
  const visualObjsRef = useRef<(ExtendedTuneObject | null)[]>([]);
  const durationsRef = useRef<number[]>([]);
  /** Per tune index, the voices currently loaded for it — length 1 in Solo mode, one per band member in Band mode. Voice 0 is always the leader that drives the timer/cursor. */
  const synthsRef = useRef<abcjs.MidiBuffer[][]>([]);
  const timerRef = useRef<abcjs.TimingCallbacks | null>(null);
  const highlightedRef = useRef<Element[]>([]);
  const isDraggingRef = useRef(false);
  const noteTimingsRef = useRef<abcjs.NoteTimingEvent[][]>([]);
  const tuneLinesRef = useRef<StaffLine[][]>([]);
  const pendingTimeoutsRef = useRef<number[]>([]);
  /** Backers scheduled by startBackersStaggered that haven't started yet — flushed (started immediately) rather than dropped on pause, so pausing never permanently silences one. */
  const pendingBackersRef = useRef<Set<abcjs.MidiBuffer>>(new Set());
  /**
   * Bumped by beginNewPlaySession() (from stop()/seek()) every time playback is
   * torn down and restarted. play()/seek()/advanceToTune() capture the value
   * current when they begin, and re-check it after their async synth-build
   * completes — if it's changed, a newer stop/seek/play has since taken over,
   * so the (now stale) build's result must be discarded rather than committed,
   * which would otherwise resurrect audio the user already stopped/moved past.
   */
  const playSessionRef = useRef(0);
  const [initialPrefs] = useState(loadPlayerPrefs);
  const repeatRef = useRef(initialPrefs.repeat);
  const repeatLimitRef = useRef<number | null>(initialPrefs.repeatLimit);
  const setPassRef = useRef(1);
  const keyRootRef = useRef<number>(72);
  const loopRef = useRef<Loop | null>(null);
  const trainerRef = useRef<Trainer | null>(null);
  const currentTrainerBpmRef = useRef<number>(80);
  const passRef = useRef(1);

  const metronome = useMetronomePrefs();
  const { useMetronome, metronomeSound, useMetronomeRef, metronomeSoundRef } = metronome;
  const [status, setStatus] = useState<PlayerStatus>("stopped");
  const [currentBpm, setCurrentBpm] = useState<number>(() => {
    const saved = loadTunePlaybackPrefs(tuneKey);
    const base = getTuneBaseBpm(null, targetBpm, items[0]?.tuneType);
    return Math.round(base * (saved.tempoPercent / 100));
  });
  const [swingPercent, setSwingPercent] = useState(() => loadTunePlaybackPrefs(tuneKey).swingPercent);
  const [repeat, setRepeat] = useState(initialPrefs.repeat);
  const [repeatLimit, setRepeatLimit] = useState<number | null>(initialPrefs.repeatLimit);
  const [bodhran, setBodhran] = useState(() => initialPrefs.bodhran ?? false);
  const [instruments, setInstruments] = useState(loadInstruments);
  const [bandPrefs, setBandPrefs] = useState(loadBandPrefs);
  const [bandVoices, setBandVoices] = useState<BandVoice[]>([]);
  const [positionSec, setPositionSec] = useState(0);
  const [currentTotalSec, setCurrentTotalSec] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activePass, setActivePass] = useState(1);
  const [loop, setLoop] = useState<Loop | null>(null);
  const [markA, setMarkA] = useState<number | null>(null);
  const [trainer, setTrainer] = useState<Trainer>(initialPrefs.trainer);
  trainerRef.current = trainer;
  const [passCount, setPassCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isSingle = isSingleTune || items.length === 1;
  const isBandMode = bandPrefs.mode === "band";

  /**
   * "Latest value" refs for state that deferred async continuations (in
   * particular advanceToTune(), reached via a tune-transition eventCallback
   * that can be many renders old by the time its await resolves) need to read
   * fresh at the moment they actually run, not whatever a stale closure
   * captured. Synced directly in the render body (not an effect) so they're
   * always current before any event handler can fire.
   */
  const statusRef = useRef(status);
  statusRef.current = status;
  const isBandModeRef = useRef(isBandMode);
  isBandModeRef.current = isBandMode;
  const bandVoicesRef = useRef(bandVoices);
  bandVoicesRef.current = bandVoices;
  const instrumentsRef = useRef(instruments);
  instrumentsRef.current = instruments;
  const swingPercentRef = useRef(swingPercent);
  swingPercentRef.current = swingPercent;
  const bodhranRef = useRef(bodhran);
  bodhranRef.current = bodhran;

  useEffect(() => {
    const handleFsChange = () => {
      const next = document.fullscreenElement === containerRef.current;
      isFullscreenRef.current = next;
      setIsFullscreen(next);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const [showFsControls, setShowFsControls] = useState(true);
  const fsControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetFsControlsTimer = useCallback(() => {
    setShowFsControls(true);
    if (fsControlsTimerRef.current) {
      clearTimeout(fsControlsTimerRef.current);
    }
    fsControlsTimerRef.current = setTimeout(() => {
      setShowFsControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      setShowFsControls(true);
      if (fsControlsTimerRef.current) {
        clearTimeout(fsControlsTimerRef.current);
        fsControlsTimerRef.current = null;
      }
      return;
    }

    resetFsControlsTimer();

    const handleUserActivity = () => {
      resetFsControlsTimer();
    };

    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("mousemove", handleUserActivity);
    container.addEventListener("touchstart", handleUserActivity);
    container.addEventListener("pointermove", handleUserActivity);
    container.addEventListener("keydown", handleUserActivity);
    container.addEventListener("click", handleUserActivity);

    return () => {
      if (fsControlsTimerRef.current) {
        clearTimeout(fsControlsTimerRef.current);
        fsControlsTimerRef.current = null;
      }
      container.removeEventListener("mousemove", handleUserActivity);
      container.removeEventListener("touchstart", handleUserActivity);
      container.removeEventListener("pointermove", handleUserActivity);
      container.removeEventListener("keydown", handleUserActivity);
      container.removeEventListener("click", handleUserActivity);
    };
  }, [isFullscreen, resetFsControlsTimer]);

  useEffect(() => {
    savePlayerPrefs({ repeat, repeatLimit, bodhran, trainer });
  }, [repeat, repeatLimit, bodhran, trainer]);

  useEffect(() => {
    const baseBpm = getTuneBaseBpm(visualObjsRef.current[0], targetBpm, items[0]?.tuneType);
    const tempoPercent = baseBpm > 0 ? Math.round((currentBpm / baseBpm) * 100) : 100;
    saveTunePlaybackPrefs(tuneKey, { tempoPercent, swingPercent });
    // tuneKey deliberately excluded: this must only fire on an actual tempo/swing change by the
    // user, not on every tune switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBpm, swingPercent]);

  useEffect(() => {
    saveBandPrefs(bandPrefs);
  }, [bandPrefs]);

  useEffect(() => {
    if (isBandMode) {
      setBandVoices(pickBandVoices(bandPrefs.eligiblePrograms, bandPrefs.count));
    } else {
      setBandVoices((prev) => (prev.length === 0 ? prev : []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBandMode, bandPrefs.count, bandPrefs.eligiblePrograms.join(",")]);

  useEffect(() => {
    if (status !== "stopped") {
      play(currentBpm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandVoices]);

  function updateBandPrefs(patch: Partial<BandPrefs>) {
    setBandPrefs((prev) => ({ ...prev, ...patch }));
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const itemsKey = items.map((i) => `${i.userTuneId}:${i.repetitions}:${i.abc}`).join(",");

  useEffect(() => {
    noteTimingsRef.current = [];
    tuneLinesRef.current = [];
    const savedTempo = loadTunePlaybackPrefs(tuneKey);
    const hasSavedTempo = savedTempo.tempoPercent !== 100 || savedTempo.swingPercent !== 0;
    visualObjsRef.current = items.map((item, index) => {
      const host = sheetRefs.current[index];
      if (!host) return null;
      const visualObj = abcjs.renderAbc(host, fixAbcRepeats(item.abc), {
        responsive: "resize",
      })[0] as ExtendedTuneObject;
      const timings = visualObj.setTiming(visualObj.getBpm());
      noteTimingsRef.current[index] = timings;
      tuneLinesRef.current[index] = extractLinesFromTimings(timings);
      if (index === 0) {
        const baseBpm = getTuneBaseBpm(visualObj, targetBpm, item.tuneType);
        const effectiveTargetBpm = targetBpm ?? (item.tuneType ? getDefaultTargetBpm(item.tuneType) : null) ?? baseBpm;
        if (effectiveTargetBpm) {
          setTrainer((t) => ({
            ...t,
            targetBpm: t.targetBpm || effectiveTargetBpm,
            startBpm: t.startBpm || Math.round(effectiveTargetBpm * 0.6),
          }));
        }
        if (hasSavedTempo) {
          setCurrentBpm(Math.round(baseBpm * (savedTempo.tempoPercent / 100)));
          setSwingPercent(savedTempo.swingPercent);
        } else {
          setSwingPercent(0);
          setCurrentBpm(effectiveTargetBpm);
        }
      }
      return visualObj;
    });
    return () => stop(false);
  }, [itemsKey, targetBpm]);

  function checkAutoScroll(tuneIndex: number, ev: { top?: number }) {
    if (!isFullscreenRef.current || typeof ev.top !== "number") return;
    const lines = tuneLinesRef.current[tuneIndex] || [];
    if (lines.length === 0) return;

    const host = sheetRefs.current[tuneIndex];
    const svg = host?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;

    const top = ev.top;
    const lineIndex = lines.findIndex((l) => Math.abs(l.top - top) < 15);
    if (lineIndex === -1) return;

    const currentLine = lines[lineIndex];
    let nextLine: StaffLine | null = null;
    let nextSvg: SVGSVGElement | null = null;

    if (lineIndex + 1 < lines.length) {
      nextLine = lines[lineIndex + 1];
    } else if (tuneIndex + 1 < items.length) {
      const nextTuneLines = tuneLinesRef.current[tuneIndex + 1] || [];
      if (nextTuneLines.length > 0) {
        nextLine = nextTuneLines[0];
        const nextHost = sheetRefs.current[tuneIndex + 1];
        nextSvg = (nextHost?.querySelector("svg") as SVGSVGElement | null) ?? null;
      }
    }

    const scrollContainer =
      (containerRef.current?.querySelector(".set-player-tunes-list, .sheet-music") as HTMLElement | null) ??
      containerRef.current;
    scrollToKeepLinesVisible(scrollContainer, svg, currentLine, nextLine, nextSvg);
  }

  useEffect(() => {
    if (visualObjsRef.current.length === items.length) {
      const newDurations = items.map((_, index) => {
        const visualObj = visualObjsRef.current[index];
        const naturalTotalSec = visualObj?.getTotalTime() ?? 0;
        const baseBpm = getTuneBaseBpm(visualObj, targetBpm, items[index]?.tuneType);
        const sourceBpm = (visualObj?.getBpm() ?? 0) > 0 ? visualObj!.getBpm() : baseBpm;
        return currentBpm > 0 ? naturalTotalSec * (sourceBpm / currentBpm) : naturalTotalSec;
      });
      durationsRef.current = newDurations;
      setCurrentTotalSec(newDurations.reduce((sum, duration, index) => sum + duration * items[index].repetitions, 0));
    }
  }, [itemsKey, currentBpm, targetBpm]);

  function clearHighlights() {
    for (const el of highlightedRef.current) {
      el.classList.remove("highlight");
    }
    highlightedRef.current = [];
    for (const host of sheetRefs.current) {
      const svg = host?.querySelector("svg");
      const cursor = svg?.querySelector(".abcjs-cursor");
      if (cursor) {
        cursor.setAttribute("y1", "0");
        cursor.setAttribute("y2", "0");
      }
    }
  }

  function voicesAt(index: number): abcjs.MidiBuffer[] {
    return synthsRef.current[index] ?? [];
  }

  function forEachVoice(index: number, fn: (v: abcjs.MidiBuffer) => void) {
    for (const v of voicesAt(index)) fn(v);
  }

  /** Starts a tune's backers a touch after its leader, like independent live musicians joining in — only for a genuine fresh start (position 0), not a seek/resume. */
  function startBackersStaggered(index: number, backers: abcjs.MidiBuffer[]) {
    for (const backer of backers) {
      pendingBackersRef.current.add(backer);
      const id = window.setTimeout(() => {
        pendingBackersRef.current.delete(backer);
        if (!synthsRef.current[index]?.includes(backer)) return;
        backer.start();
      }, backerStartOffsetMs());
      pendingTimeoutsRef.current.push(id);
    }
  }

  /** Cancels any pending staggered entrances and immediately starts those backers now, instead of just dropping them — used before pausing, so a pause never permanently silences a backer that hadn't entered yet. */
  function flushPendingBackers() {
    pendingTimeoutsRef.current = clearPendingTimeouts(pendingTimeoutsRef.current);
    for (const backer of pendingBackersRef.current) backer.start();
    pendingBackersRef.current.clear();
  }

  /** Marks any in-flight synth build (from play()/seek()/advanceToTune()) as superseded — called whenever playback is torn down and potentially restarted, so a build that resolves afterward knows to discard its result instead of resurrecting stopped/superseded audio. */
  function beginNewPlaySession(): number {
    playSessionRef.current += 1;
    return playSessionRef.current;
  }

  function stop(keepPosition = false) {
    beginNewPlaySession();
    pendingTimeoutsRef.current = clearPendingTimeouts(pendingTimeoutsRef.current);
    pendingBackersRef.current.clear();
    for (const voices of synthsRef.current) {
      if (!voices) continue;
      for (const synth of voices) synth.stop();
    }
    synthsRef.current = [];
    if (timerRef.current) {
      timerRef.current.stop();
      timerRef.current = null;
    }
    clearHighlights();
    setActiveIndex(null);
    setActivePass(1);
    if (!keepPosition) {
      setPositionSec(0);
    }
    setStatus("stopped");
    setPassRef.current = 1;
    passRef.current = 1;
    setPassCount(1);
  }

  function pause() {
    if (activeIndex === null) return;
    flushPendingBackers();
    forEachVoice(activeIndex, (v) => v.pause());
    timerRef.current?.pause();
    setStatus("paused");
  }

  function resume() {
    if (activeIndex === null) return;
    forEachVoice(activeIndex, (v) => v.resume());
    timerRef.current?.start();
    setStatus("playing");
  }

  function markLoopPoint() {
    if (!currentTotalSec) return;
    const fraction = Math.min(Math.max(positionSec / currentTotalSec, 0), 1);
    if (markA === null) {
      setMarkA(fraction);
      loopRef.current = null;
      setLoop(null);
    } else {
      const a = Math.min(markA, fraction);
      const b = Math.max(markA, fraction);
      if (b - a > 0.01) {
        const newLoop = { a, b };
        loopRef.current = newLoop;
        setLoop(newLoop);
      }
      setMarkA(null);
    }
  }

  function clearLoop() {
    loopRef.current = null;
    setLoop(null);
    setMarkA(null);
  }

  function toggleBodhran() {
    const next = !bodhran;
    setBodhran(next);
    bodhranRef.current = next;
    savePlayerPrefs({ repeat, repeatLimit, bodhran: next, trainer });
    if (status !== "stopped") {
      play(currentBpm);
    }
  }

  function updateTrainer(patch: Partial<Trainer>) {
    setTrainer((t) => {
      const next = { ...t, ...patch };
      trainerRef.current = next;
      return next;
    });
  }

  async function seek(seconds: number) {
    if (currentTotalSec <= 0 || durationsRef.current.length !== items.length) {
      return;
    }

    const clampedSeconds = Math.min(Math.max(seconds, 0), currentTotalSec);
    let remaining = clampedSeconds;
    let targetIndex = 0;
    let targetPass = 1;

    for (let i = 0; i < items.length; i++) {
      const tuneDuration = durationsRef.current[i];
      const totalTuneDuration = tuneDuration * items[i].repetitions;
      if (remaining < totalTuneDuration) {
        targetIndex = i;
        targetPass = Math.floor(remaining / tuneDuration) + 1;
        remaining = remaining - tuneDuration * (targetPass - 1);
        break;
      }
      remaining -= totalTuneDuration;
    }

    const startFraction = durationsRef.current[targetIndex] > 0 ? remaining / durationsRef.current[targetIndex] : 0;

    if (status === "stopped") {
      setPositionSec(clampedSeconds);
      setActiveIndex(targetIndex);
      setActivePass(targetPass);
      updateVisualsForTime(clampedSeconds);
      return;
    }

    if (timerRef.current) {
      timerRef.current.stop();
      timerRef.current = null;
    }
    if (activeIndex !== null) {
      pendingTimeoutsRef.current = clearPendingTimeouts(pendingTimeoutsRef.current);
      pendingBackersRef.current.clear();
      forEachVoice(activeIndex, (v) => v.stop());
    }

    clearHighlights();
    setPositionSec(clampedSeconds);
    setActiveIndex(targetIndex);
    setActivePass(targetPass);

    const mySession = beginNewPlaySession();
    const result = await ensureTuneSynths(targetIndex, currentBpm, mySession);
    if (result === "stale") return;
    if (result === "failed") {
      setError("Audio unavailable (soundfont could not be loaded).");
      return;
    }

    startTune(targetIndex, currentBpm, targetPass, startFraction, false);
  }

  async function buildSynthsForTune(index: number, bpm: number): Promise<abcjs.MidiBuffer[] | null> {
    const visualObj = visualObjsRef.current[index];
    if (!visualObj) return null;
    const msPerMeasure = visualObj.millisecondsPerMeasure(bpm);
    const bandMode = isBandModeRef.current;
    const voicesToUse = bandMode ? bandVoicesRef.current : [];
    const useBodhran = bodhranRef.current;

    if (bandMode && voicesToUse.length === 0) return null;

    try {
      if (voicesToUse.length > 0) {
        const meter = visualObj.getMeterFraction();
        const meterSize = meter.den ? meter.num / meter.den : 1;
        const tempoMultiplierSec = msPerMeasure / 1000 / meterSize;
        return await Promise.all(
          voicesToUse.map((voice) =>
            createBandSynth(visualObj, msPerMeasure, voice, tempoMultiplierSec, {
              swing: toAbcjsSwing(swingPercentRef.current),
              bodhran: useBodhran,
            }),
          ),
        );
      }

      const synth = new abcjs.synth.CreateSynth();
      const currentInst = instrumentsRef.current;
      const bodhranPattern = useBodhran ? getBodhranDrumOption(visualObj.getMeterFraction()) : undefined;

      await synth.init({
        visualObj,
        millisecondsPerMeasure: msPerMeasure,
        options: {
          ...synthInstrumentOptions(currentInst),
          swing: toAbcjsSwing(swingPercentRef.current),
          drum: bodhranPattern,
          drumBars: bodhranPattern ? 1 : undefined,
          sequenceCallback: (tracks) => {
            return tracks.map((track, trackIdx) => {
              let prog: number | string = trackIdx === 0 ? currentInst.melody : trackIdx === 1 ? currentInst.chords : currentInst.bass;
              if (track.length > 0 && track[0].instrument) {
                prog = track[0].instrument;
              }
              if (shouldSubdivideInstrument(prog)) {
                return subdivideLongNotes(track);
              }
              return track;
            });
          },
        },
      });
      await synth.prime();
      return [synth];
    } catch {
      return null;
    }
  }

  async function ensureTuneSynths(index: number, bpm: number, mySession: number): Promise<"ok" | "stale" | "failed"> {
    if (synthsRef.current[index] && synthsRef.current[index].length > 0) return "ok";
    const voices = await buildSynthsForTune(index, bpm);
    if (playSessionRef.current !== mySession) return "stale";
    if (!voices) return "failed";
    synthsRef.current[index] = voices;
    return "ok";
  }

  async function advanceToTune(nextIndex: number, bpm: number) {
    const mySession = playSessionRef.current;
    const result = await ensureTuneSynths(nextIndex, bpm, mySession);
    if (result === "stale") return;
    if (result === "failed") {
      setError("Audio unavailable (soundfont could not be loaded).");
      stop();
      return;
    }
    startTune(nextIndex, bpm);
  }

  async function play(targetBpmParam?: number, keepPosition = positionSec > 0) {
    const wasStopped = status === "stopped";
    stop(keepPosition);
    const mySession = playSessionRef.current;
    if (wasStopped) {
      setPassRef.current = 1;
    }
    setError(null);
    try {
      const startingTrainer = trainer.armed && wasStopped;
      let effectiveBpm = targetBpmParam ?? currentBpm;

      if (startingTrainer) {
        currentTrainerBpmRef.current = trainer.startBpm;
        effectiveBpm = trainer.startBpm;
      }

      const oldDurations = durationsRef.current;
      const newDurations = items.map((_, index) => {
        const visualObj = visualObjsRef.current[index];
        const naturalTotalSec = visualObj?.getTotalTime() ?? 0;
        const baseBpm = getTuneBaseBpm(visualObj, targetBpm, items[index]?.tuneType);
        const sourceBpm = (visualObj?.getBpm() ?? 0) > 0 ? visualObj!.getBpm() : baseBpm;
        return effectiveBpm > 0 ? naturalTotalSec * (sourceBpm / effectiveBpm) : naturalTotalSec;
      });
      durationsRef.current = newDurations;
      setCurrentTotalSec(newDurations.reduce((sum, duration, index) => sum + duration * items[index].repetitions, 0));

      let targetIndex = 0;
      let targetPass = 1;
      let targetFraction = 0;

      if (keepPosition) {
        let remaining = positionSec;
        for (let i = 0; i < items.length; i++) {
          const tuneDuration = oldDurations[i] ?? 0;
          const totalTuneDuration = tuneDuration * items[i].repetitions;
          if (remaining < totalTuneDuration) {
            targetIndex = i;
            targetPass = Math.floor(remaining / tuneDuration) + 1;
            remaining = remaining - tuneDuration * (targetPass - 1);
            break;
          }
          remaining -= totalTuneDuration;
        }
        const oldTuneDuration = oldDurations[targetIndex] ?? 0;
        targetFraction = oldTuneDuration > 0 ? remaining / oldTuneDuration : 0;
      }

      const voices = await buildSynthsForTune(targetIndex, effectiveBpm);
      if (playSessionRef.current !== mySession) return;
      if (!voices) throw new Error("Could not build synths for tune.");
      synthsRef.current[targetIndex] = voices;

      setStatus("playing");
      setCurrentBpm(effectiveBpm);
      if (startingTrainer) {
        passRef.current = 1;
        setPassCount(1);
      }
      startTune(targetIndex, effectiveBpm, targetPass, loop?.a ?? targetFraction);
    } catch {
      setError("Audio unavailable (soundfont could not be loaded).");
    }
  }

  function startTune(index: number, bpm: number, startPass = 1, startFraction = 0, shouldScroll = true) {
    const visualObj = visualObjsRef.current[index];
    const voices = synthsRef.current[index];
    if (!visualObj || !voices || voices.length === 0) return;

    pendingTimeoutsRef.current = clearPendingTimeouts(pendingTimeoutsRef.current);
    pendingBackersRef.current.clear();

    const synth = voices[0];
    const backers = voices.slice(1);
    let pass = startPass;

    setActiveIndex(index);
    setActivePass(startPass);
    if (shouldScroll) {
      sheetRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    const elapsedBeforeTune = durationsRef.current
      .slice(0, index)
      .reduce((sum, duration, i) => sum + duration * items[i].repetitions, 0);
    const tuneDuration = durationsRef.current[index] ?? 0;

    if (!isDraggingRef.current) {
      setPositionSec(elapsedBeforeTune + tuneDuration * (startPass - 1) + tuneDuration * startFraction);
    }

    keyRootRef.current = getAbcKeyRoot(items[index].abc);

    const timer = new abcjs.TimingCallbacks(visualObj, {
      qpm: bpm,
      beatCallback: (beatNumber: number) => {
        if (useMetronomeRef.current) {
          const sound = metronomeSoundRef.current;
          if (beatNumber === 1) {
            const pitch = sound.instrument === 128 ? 36 : keyRootRef.current;
            playMetronomeClick(sound, pitch);
          } else {
            const pitch = sound.instrument === 128 ? undefined : keyRootRef.current - 12;
            playMetronomeClick(sound, pitch);
          }
        }
        const activeLoop = loopRef.current;
        const totalMsAtTempo = currentTotalSec * 1000;
        const ms = timer.currentMillisecond();
        if (activeLoop && totalMsAtTempo > 0 && ms >= activeLoop.b * totalMsAtTempo) {
          for (const v of voices) v.seek(activeLoop.a);
          timer.setProgress(activeLoop.a);
        }
      },
      eventCallback: (ev: abcjs.NoteTimingEvent | null) => {
        clearHighlights();
        if (ev) {
          const ms = timer.currentMillisecond();
          const elapsedBeforeTune = durationsRef.current
            .slice(0, index)
            .reduce((sum, duration, i) => sum + duration * items[i].repetitions, 0);

          if (!isDraggingRef.current) {
            setPositionSec(elapsedBeforeTune + tuneDuration * (pass - 1) + ms / 1000);
          }

          for (const group of ev.elements ?? []) {
            for (const el of group) {
              el.classList.add("highlight");
              highlightedRef.current.push(el);
            }
          }
          const host = sheetRefs.current[index];
          const svg = host?.querySelector("svg") as SVGSVGElement | null;
          if (typeof ev.left === "number" && typeof ev.top === "number" && typeof ev.height === "number" && svg) {
            updateCursorPosition(svg, ev.left - 2, ev.top, ev.top + ev.height);
            checkAutoScroll(index, ev);
          }
          return undefined;
        }
        // End of one pass through the tune.
        for (const v of voices) v.stop();
        timer.stop();
        const host = sheetRefs.current[index];
        const svg = host?.querySelector("svg");
        const cursor = svg?.querySelector(".abcjs-cursor");
        if (cursor) {
          cursor.setAttribute("y1", "0");
          cursor.setAttribute("y2", "0");
        }

        if (pass < items[index].repetitions) {
          pass++;
          setActivePass(pass);
          for (const v of voices) v.seek(0);
          synth.start();
          startBackersStaggered(index, backers);
          timer.setProgress(0);
          timer.start(0);
          return "continue";
        } else if (index + 1 < items.length) {
          advanceToTune(index + 1, bpm);
        } else {
          // Reached end of entire tune/set. Check Speed Trainer.
          const activeTrainer = trainerRef.current;
          if (activeTrainer?.armed) {
            const currentBpmVal = currentTrainerBpmRef.current;
            if (currentBpmVal >= activeTrainer.targetBpm) {
              stop();
              return undefined;
            }
            passRef.current++;
            setPassCount(passRef.current);
            const nextBpm = Math.min(currentBpmVal + activeTrainer.stepBpm, activeTrainer.targetBpm);
            currentTrainerBpmRef.current = nextBpm;
            play(nextBpm, false);
            return undefined;
          }

          if (repeatRef.current) {
            if (repeatLimitRef.current === null || setPassRef.current < repeatLimitRef.current) {
              setPassRef.current++;
              advanceToTune(0, bpm);
            } else {
              stop();
            }
          } else {
            stop();
          }
        }
        return undefined;
      },
    });
    timerRef.current = timer;

    const isPlayerPaused = statusRef.current === "paused";
    if (isPlayerPaused) {
      for (const v of voices) v.seek(startFraction);
      timer.start(startFraction);
      timer.setProgress(startFraction);
      timer.pause();
    } else {
      if (startFraction > 0) {
        for (const v of voices) v.seek(startFraction);
      }
      synth.start();
      if (startFraction === 0) {
        startBackersStaggered(index, backers);
      } else {
        for (const backer of backers) backer.start();
      }
      timer.start(startFraction);
      if (startFraction > 0) {
        timer.setProgress(startFraction);
      }
    }
  }

  function onTempoInput(e: ChangeEvent<HTMLInputElement>) {
    const raw = Number((e.target as HTMLInputElement).value);
    setCurrentBpm(raw);
  }

  function onSwingInput(e: ChangeEvent<HTMLInputElement>) {
    const percent = Number((e.target as HTMLInputElement).value);
    setSwingPercent(percent);
  }

  function restartAtCurrentPosition() {
    if (status !== "stopped") {
      play(currentBpm);
    }
  }
  const tempoInputRef = useCommitOnChange(restartAtCurrentPosition);
  const swingInputRef = useCommitOnChange(restartAtCurrentPosition);

  function onInstrumentChange(part: keyof typeof instruments) {
    return (e: ChangeEvent<HTMLSelectElement>) => {
      const next = { ...instruments, [part]: Number((e.target as HTMLSelectElement).value) };
      setInstruments(next);
      saveInstruments(next);
      if (status !== "stopped") {
        play(currentBpm);
      }
    };
  }

  function toggleEligibleInstrument(program: number) {
    const eligible = bandPrefs.eligiblePrograms.includes(program);
    if (eligible && bandPrefs.eligiblePrograms.length <= 1) return; // keep at least one eligible
    const next = eligible
      ? bandPrefs.eligiblePrograms.filter((v) => v !== program)
      : [...bandPrefs.eligiblePrograms, program];
    updateBandPrefs({ eligiblePrograms: next });
  }

  const activeVisualObj = visualObjsRef.current[activeIndex ?? 0] ?? null;
  const baseBpm = getTuneBaseBpm(activeVisualObj, targetBpm, items[activeIndex ?? 0]?.tuneType);
  const tempoPercent = baseBpm > 0 ? Math.round((currentBpm / baseBpm) * 100) : 100;

  return (
    <div ref={containerRef} className={`player-container ${isFullscreen ? "is-fullscreen" : ""}`}>
      {isFullscreen && (
        <div className={`fullscreen-controls ${showFsControls ? "" : "hidden"}`}>
          <button onClick={() => (status === "playing" ? pause() : status === "paused" ? resume() : play())}>
            {status === "playing" ? "⏸" : "▶"}
          </button>
          <button onClick={() => stop(false)} disabled={status === "stopped" && positionSec === 0}>
            ■
          </button>
          <button onClick={toggleFullscreen}>✕</button>
        </div>
      )}
      <div className="player-controls">
        <button onClick={() => (status === "playing" ? pause() : status === "paused" ? resume() : play())}>
          {status === "playing" ? "⏸ Pause" : isSingle ? "▶ Play" : "▶ Play set"}
        </button>
        <button onClick={() => stop(false)} disabled={status === "stopped" && positionSec === 0}>
          ■ Stop
        </button>
        <button onClick={toggleFullscreen}>⛶ Fullscreen</button>
        <button
          className={showAdvanced ? "toggled" : ""}
          aria-pressed={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "▾" : "▸"} Advanced Controls
        </button>
        {trainer.armed && (
          <span className="badge badge-working" title="Speed Trainer is active and controlling repeats">
            🎯 Speed Trainer ({trainer.startBpm} → {trainer.targetBpm} BPM)
          </span>
        )}
      </div>

      {showAdvanced && (
        <>
          <div className="player-controls">
            <button
              className={repeat ? "toggled" : ""}
              aria-pressed={repeat}
              disabled={trainer.armed}
              title={trainer.armed ? "Speed trainer controls repeats while active" : undefined}
              onClick={() => {
                if (trainer.armed) return;
                const next = !repeat;
                setRepeat(next);
                repeatRef.current = next;
              }}
            >
              {isSingle ? "🔁 Repeat" : "🔁 Repeat set"}
            </button>
            {repeat && (
              <label>
                Times
                <DebouncedNumberInput
                  className="reps-input"
                  min={1}
                  allowNull
                  placeholder="∞"
                  title="Number of times to repeat (leave empty for infinite)"
                  value={repeatLimit}
                  onChange={(clamped) => {
                    setRepeatLimit(clamped);
                    repeatLimitRef.current = clamped;
                  }}
                />
              </label>
            )}
            <MetronomeControls {...metronome} />
            <button
              className={bodhran ? "toggled" : ""}
              aria-pressed={bodhran}
              onClick={toggleBodhran}
              title="Toggle automated bodhrán folk drum backing"
            >
              🥁 Bodhrán
            </button>
            <button
              className={loop || markA !== null ? "toggled" : ""}
              disabled={status === "stopped"}
              onClick={markLoopPoint}
              title="Mark loop start, then loop end, at the current position"
            >
              {markA !== null ? "Set loop end" : loop ? "New loop" : "Set loop start"}
            </button>
            {(loop || markA !== null) && <button onClick={clearLoop}>✕ Loop off</button>}
            <label>
              Tempo {currentBpm} BPM ({tempoPercent}%)
              <input
                ref={tempoInputRef}
                type="range"
                min={Math.max(30, Math.round(baseBpm * 0.5))}
                max={Math.round(baseBpm * 1.5)}
                step="1"
                value={currentBpm}
                onChange={onTempoInput}
              />
            </label>
            <label>
              Swing {swingPercent}%
              <input
                ref={swingInputRef}
                type="range"
                min="0"
                max="100"
                step="1"
                value={swingPercent}
                onChange={onSwingInput}
              />
            </label>
          </div>

          <div className="player-controls">
            <button
              className={trainer.armed ? "toggled" : ""}
              aria-pressed={trainer.armed}
              onClick={() => {
                const nextArmed = !trainer.armed;
                if (nextArmed) {
                  setRepeat(false);
                  repeatRef.current = false;
                }
                updateTrainer({ armed: nextArmed });
              }}
            >
              🎯 Speed trainer
            </button>
            {trainer.armed && (
              <>
                <label>
                  Start BPM
                  <DebouncedNumberInput
                    className="trainer-input"
                    min={30}
                    max={300}
                    step={5}
                    value={trainer.startBpm}
                    onChange={(startBpm) => startBpm !== null && updateTrainer({ startBpm })}
                  />
                </label>
                <label>
                  Step BPM
                  <DebouncedNumberInput
                    className="trainer-input"
                    min={1}
                    max={50}
                    step={1}
                    value={trainer.stepBpm}
                    onChange={(stepBpm) => stepBpm !== null && updateTrainer({ stepBpm })}
                  />
                </label>
                <label>
                  Target BPM
                  <DebouncedNumberInput
                    className="trainer-input"
                    min={30}
                    max={300}
                    step={5}
                    value={trainer.targetBpm}
                    onChange={(targetBpm) => targetBpm !== null && updateTrainer({ targetBpm })}
                  />
                </label>
                {status !== "stopped" && (
                  <span className="tune-meta">
                    Pass {passCount} · {currentBpm} BPM → {trainer.targetBpm} BPM
                  </span>
                )}
              </>
            )}
          </div>
        </>
      )}

      <div className="player-seek">
        <span className="time-label">{formatTime(positionSec)}</span>
        <div className="seek-track">
          <input
            type="range"
            min="0"
            max={currentTotalSec || 1}
            step="0.1"
            value={positionSec}
            disabled={currentTotalSec <= 0}
            aria-label="Position in tune"
            onMouseDown={() => {
              isDraggingRef.current = true;
            }}
            onTouchStart={() => {
              isDraggingRef.current = true;
            }}
            onChange={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              setPositionSec(val);
              updateVisualsForTime(val);
            }}
            onMouseUp={(e) => {
              isDraggingRef.current = false;
              seek(Number((e.currentTarget as HTMLInputElement).value));
            }}
            onTouchEnd={(e) => {
              isDraggingRef.current = false;
              seek(Number((e.currentTarget as HTMLInputElement).value));
            }}
          />
          {markA !== null && <span className="loop-marker" style={{ left: `${markA * 100}%` }} title="Loop start" />}
          {loop && (
            <>
              <span className="loop-marker" style={{ left: `${loop.a * 100}%` }} title="Loop A" />
              <span className="loop-marker" style={{ left: `${loop.b * 100}%` }} title="Loop B" />
            </>
          )}
        </div>
        <span className="time-label">{formatTime(currentTotalSec)}</span>
      </div>

      {showAdvanced && (
        <div className="player-controls">
          <button
            className={isBandMode ? "toggled" : ""}
            aria-pressed={isBandMode}
            onClick={() => updateBandPrefs({ mode: isBandMode ? "solo" : "band" })}
            title="Solo: one instrument with melody/chords/bass. Band: several independent players, like a folk session."
          >
            {isBandMode ? "👥 Band" : "🎻 Solo"}
          </button>
        </div>
      )}

      {showAdvanced && !isBandMode && (
        <div className="player-controls">
          {(["melody", "chords", "bass"] as const).map((part) => (
            <label key={part}>
              {part[0].toUpperCase() + part.slice(1)}
              <select value={instruments[part]} onChange={onInstrumentChange(part)}>
                {INSTRUMENTS.map((inst) => (
                  <option key={inst.value} value={inst.value}>
                    {inst.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {showAdvanced && isBandMode && (
        <>
          <div className="player-controls">
            <label>
              Players
              <DebouncedNumberInput
                className="trainer-input"
                min={MIN_BAND_COUNT}
                max={MAX_BAND_COUNT}
                value={bandPrefs.count}
                onChange={(count) => {
                  if (count !== null) updateBandPrefs({ count });
                }}
              />
            </label>
            <button
              onClick={() => setBandVoices(pickBandVoices(bandPrefs.eligiblePrograms, bandPrefs.count))}
              title="Pick a fresh set of instruments from the eligible list below"
            >
              🎲 Randomize
            </button>
          </div>
          <div className="player-controls">
            {INSTRUMENTS.map((inst) => (
              <label key={inst.value} style={{ fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={bandPrefs.eligiblePrograms.includes(inst.value)}
                  onChange={() => toggleEligibleInstrument(inst.value)}
                />{" "}
                {inst.label}
              </label>
            ))}
          </div>
          {bandVoices.length > 0 && (
            <p className="tune-meta">
              Now playing: {bandVoices.map((v) => INSTRUMENTS.find((i) => i.value === v.program)?.label ?? v.program).join(", ")}
            </p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}

      <div className={isSingle ? "sheet-music" : "set-player-tunes-list"}>
        {items.map((item, index) => {
          const href = linkHref ? linkHref(item) : `/tune/${item.userTuneId}`;
          const showHeader = !isSingle && Boolean(item.title);
          return (
            <div
              key={item.userTuneId}
              className={isSingle ? "" : `set-player-tune ${activeIndex === index ? "active" : ""}`}
            >
              {showHeader && (
                <div className="set-header">
                  <h2>
                    {href ? (
                      <Link className="quiet-link" href={href} prefetch={false}>
                        {index + 1}. {item.title}
                      </Link>
                    ) : (
                      <span>
                        {index + 1}. {item.title}
                      </span>
                    )}
                  </h2>
                  <span className="tune-meta">
                    {activeIndex === index ? `pass ${activePass} of ${item.repetitions}` : `× ${item.repetitions}`}
                  </span>
                </div>
              )}
              <div
                className="sheet-music"
                ref={(el) => {
                  sheetRefs.current[index] = el;
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  function updateVisualsForTime(seconds: number) {
    if (durationsRef.current.length !== items.length || noteTimingsRef.current.length !== items.length) return;

    const clampedSeconds = Math.min(Math.max(seconds, 0), currentTotalSec);
    let remaining = clampedSeconds;
    let targetIndex = 0;

    for (let i = 0; i < items.length; i++) {
      const tuneDuration = durationsRef.current[i];
      const totalTuneDuration = tuneDuration * items[i].repetitions;
      if (remaining < totalTuneDuration) {
        targetIndex = i;
        remaining = remaining % tuneDuration;
        break;
      }
      remaining -= totalTuneDuration;
    }

    const naturalMs = remaining * tempoPercent * 10;
    const timings = noteTimingsRef.current[targetIndex];
    if (!timings || timings.length === 0) return;

    let bestEvent = null;
    for (const ev of timings) {
      if (ev.type === "event") {
        if (ev.milliseconds <= naturalMs) {
          bestEvent = ev;
        } else {
          break;
        }
      }
    }

    clearHighlights();

    items.forEach((_, i) => {
      if (i !== targetIndex) {
        const otherHost = sheetRefs.current[i];
        const otherSvg = otherHost?.querySelector("svg");
        const otherCursor = otherSvg?.querySelector(".abcjs-cursor");
        if (otherCursor) {
          otherCursor.setAttribute("y1", "0");
          otherCursor.setAttribute("y2", "0");
        }
      }
    });

    const host = sheetRefs.current[targetIndex];
    const svg = host?.querySelector("svg") as SVGSVGElement | null;

    if (
      bestEvent &&
      typeof bestEvent.left === "number" &&
      typeof bestEvent.top === "number" &&
      typeof bestEvent.height === "number"
    ) {
      for (const group of bestEvent.elements ?? []) {
        for (const el of group) {
          el.classList.add("highlight");
          highlightedRef.current.push(el);
        }
      }

      if (svg) {
        updateCursorPosition(svg, bestEvent.left - 2, bestEvent.top, bestEvent.top + bestEvent.height);
        checkAutoScroll(targetIndex, bestEvent);
      }
    } else {
      const cursor = svg?.querySelector(".abcjs-cursor");
      if (cursor) {
        cursor.setAttribute("y1", "0");
        cursor.setAttribute("y2", "0");
      }
    }
  }
}


