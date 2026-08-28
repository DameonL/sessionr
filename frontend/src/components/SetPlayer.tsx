import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from '@/utils/routerCompat';
import abcjs from "abcjs";
import { INSTRUMENTS, loadInstruments, saveInstruments, shouldSubdivideInstrument, subdivideLongNotes, synthInstrumentOptions } from "./instruments";
import { anchorTimerToAudio, timerDriftMs, waitForAudioClock } from "../services/audioClock";
import { prefersFlats, spellMidiNotes } from "../services/noteSpelling";
import { showToast } from "../state/appState";
import { AbcSourceView, type AbcCursorRange } from "./AbcSourceView";
import { backerStartOffsetMs, clearPendingTimeouts, pickBandVoices, type BandVoice } from "../services/band";
import { createBandSynth } from "../services/bandSynth";
import { loadBandPrefs, saveBandPrefs, MAX_BAND_COUNT, MIN_BAND_COUNT, type BandPrefs } from "../services/bandPrefs";
import { getAbcKeyRoot, playMetronomeClick } from "../services/metronome";
import { extractComposerFromAbc, fixAbcRepeats } from "../services/abcTools";
import { buildPlaybackAbc, shouldKeepLeadIn } from "../services/abcUnroll";
import { generateBodhranTrack, getBodhranDrumOption } from "../services/bodhran";
import { loadPlayerPrefs, savePlayerPrefs } from "../services/playerPrefs";
import { primeMediaSession } from "../services/mediaSession";
import { usePlayerMediaSession } from "../hooks/usePlayerMediaSession";
import { DEFAULT_EMPHASIS_PERCENT, loadTunePlaybackPrefs, saveTunePlaybackPrefs } from "../services/tunePlaybackPrefs";
import { getDefaultTargetBpm } from "../services/api";
import { applyMeterEmphasis } from "../services/meterEmphasis";
import { getMeterPulse } from "../services/meterPulse";
import { applyCustomTripletSwing, isCompoundMeter } from "../services/swing";
import { strumChords } from "../services/strum";
import { DebouncedNumberInput } from "./DebouncedNumberInput";
import { Spinner } from "./Spinner";
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

/**
 * How much of a mid-playback drift error to correct per beat. The cursor eases back into place over
 * a few beats rather than hopping, which would read as a stutter.
 */
const DRIFT_EASE = 0.25;

/**
 * Past this the clocks haven't drifted, something structural happened — a backgrounded tab where
 * abcjs's setTimeout jogger took over from rAF, or a long stall. Easing a quarter second back at
 * 25% a beat would visibly crawl, so snap instead.
 */
const DRIFT_SNAP_MS = 250;

/**
 * Most passes a tune's audio buffer ever holds. Three times through is a common setting, so the
 * buffer carries double that before it has to fall back to looping — and a buffer is a few tens of
 * megabytes a pass per voice, so it cannot simply grow with whatever the repeat count is set to.
 */
const MAX_UNROLLED_PASSES = 6;

/** How long a clicked note's name stays on screen before fading. */
const NOTE_BADGE_MS = 1100;

/** Length of a clicked note, in seconds — long enough to hear the pitch, short enough to click on. */
const CLICKED_NOTE_SEC = 0.6;

type PlayerStatus = "stopped" | "playing" | "paused";

type SheetViewMode = "sheet" | "abc";

/** The name of a just-clicked note, placed over the note it belongs to. */
interface NoteBadge {
  /**
   * Distinct per click, and used as the badge's React key. Without it a click during the previous
   * badge's fade reuses the same DOM node, which leaves the CSS animation where it was — mid-fade
   * or finished at opacity 0 — so the new note's name never appears.
   */
  id: number;
  index: number;
  text: string;
  x: number;
  y: number;
}

/** Which tune's ABC the playback cursor is in, and where. */
interface AbcCursor extends AbcCursorRange {
  index: number;
}

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
  /** Optional callback to log practice for the tune/set directly from the top player toolbar. */
  onLogPractice?: () => void;
  isPracticedToday?: boolean;
  isLoggingPractice?: boolean;
  logPracticeLabel?: string;
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
export function SetPlayer({
  items,
  targetBpm,
  isSingleTune,
  linkHref,
  onLogPractice,
  isPracticedToday,
  isLoggingPractice,
  logPracticeLabel,
}: SetPlayerProps) {
  const tuneKey = items.map((i) => i.userTuneId).join(",");
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** Per-tune wrapper, the positioning context the clicked-note badge is placed against. */
  const tuneRefs = useRef<(HTMLDivElement | null)[]>([]);
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
  /**
   * Per tune, the exact string handed to renderAbc. The ABC view, the copy button and abcjs's
   * startChar/endChar offsets must all reference the identical text, and that text is not
   * item.abc — fixAbcRepeats rewrites it on the way to the engraver.
   */
  const engravedAbcRef = useRef<string[]>([]);
  /**
   * Per tune, the tune object the synth plays from: the same music unrolled into back-to-back
   * passes, so one continuous buffer covers as many of them as it is allowed to hold.
   *
   * Repeats used to be played by seeking the single-pass buffer back to zero and starting it again,
   * which put an audible gap at every one, and replayed the tune's lead-in each time — two extra
   * notes a pass on a tune like The Cowboy, where the lead-in sits outside the repeat.
   *
   * Null when a tune plays exactly once, where this and the engraved object are the same thing. See
   * buildPlaybackTune.
   */
  const playVisualObjsRef = useRef<(abcjs.TuneObject | null)[]>([]);
  /** Per tune, how many passes the built buffer actually holds — 1 when nothing was unrolled. */
  const builtPassesRef = useRef<number[]>([]);
  /** Per tune, whether the repeats drop its lead-in. Set once from the ABC; independent of how many times it plays. */
  const stripLeadInRef = useRef<boolean[]>([]);
  /** Per tune, the lead-in that unrolled passes 2..N skip, in seconds at the tune's own tempo; 0 when it is kept. */
  const naturalPickupSecRef = useRef<number[]>([]);
  /** The same lead-in scaled to the tempo currently playing, alongside durationsRef. */
  const pickupSecRef = useRef<number[]>([]);
  /**
   * Audio the earlier passes of the current tune already used up. The buffer runs straight through
   * every pass while the cursor's timer restarts at the top of the staff for each one, so this is
   * what keeps anchorTimerToAudio comparing like with like.
   */
  const passOffsetMsRef = useRef(0);
  /** Per tune, whether its key signature spells accidentals with flats. */
  const prefersFlatsRef = useRef<boolean[]>([]);
  const noteBadgeTimeoutRef = useRef<number | null>(null);
  const noteBadgeIdRef = useRef(0);
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
  const [emphasisPercent, setEmphasisPercent] = useState(() => loadTunePlaybackPrefs(tuneKey).emphasisPercent);
  const [repeat, setRepeat] = useState(initialPrefs.repeat);
  const [repeatLimit, setRepeatLimit] = useState<number | null>(initialPrefs.repeatLimit);
  const [bodhran, setBodhran] = useState(() => initialPrefs.bodhran ?? false);
  const [instruments, setInstruments] = useState(loadInstruments);
  const [bandPrefs, setBandPrefs] = useState(loadBandPrefs);
  const [bandVoices, setBandVoices] = useState<BandVoice[]>([]);
  const [viewMode, setViewMode] = useState<SheetViewMode>("sheet");
  const [noteBadge, setNoteBadge] = useState<NoteBadge | null>(null);
  const [abcCursor, setAbcCursor] = useState<AbcCursor | null>(null);
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
  /**
   * False until abcjs has actually engraved the items. The controls are hidden
   * behind a spinner until then: a caller can hand us items whose `abc` is still
   * empty (a repertoire item served from the offline cache before the ABC has
   * arrived), and a toolbar that looks ready over a blank staff invites a Play
   * that computes zero-length durations and silently does nothing.
   */
  const [sheetReady, setSheetReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isSingle = isSingleTune || items.length === 1;
  const hasRenderableAbc = items.length > 0 && items.every((i) => i.abc.trim() !== "");
  const isReady = hasRenderableAbc && sheetReady;
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
  const emphasisPercentRef = useRef(emphasisPercent);
  emphasisPercentRef.current = emphasisPercent;
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
    saveTunePlaybackPrefs(tuneKey, { tempoPercent, swingPercent, emphasisPercent });
    // tuneKey deliberately excluded: this must only fire on an actual tempo/swing/emphasis change
    // by the user, not on every tune switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBpm, swingPercent, emphasisPercent]);

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

  /**
   * Measures the lead-in a tune's repeats will drop, if any.
   *
   * Whether it is dropped depends only on the music — a decorative lead-in over whole bars goes, a
   * genuine anacrusis paid back by a short final bar stays — so this is settled here, once, and not
   * at the buffer-building stage where the number of passes is finally known.
   */
  function measureLeadIn(index: number, engravedAbc: string, visualObj: ExtendedTuneObject) {
    stripLeadInRef.current[index] = false;
    naturalPickupSecRef.current[index] = 0;

    const keepLeadIn = shouldKeepLeadIn(visualObj);
    if (keepLeadIn || !buildPlaybackAbc(engravedAbc, 2, { keepLeadIn }).leadInStripped) return;

    const meter = visualObj.getMeterFraction();
    const meterSize = meter?.den ? meter.num / meter.den : 0;
    if (!meterSize) return;

    stripLeadInRef.current[index] = true;
    // The staff still shows the lead-in, so every pass after the first finishes this much sooner
    // than the cursor would on its own. Held at the tune's own tempo and scaled with the durations.
    naturalPickupSecRef.current[index] =
      (visualObj.getPickupLength() / meterSize) * (visualObj.millisecondsPerMeasure(visualObj.getBpm()) / 1000);
  }

  useEffect(() => {
    noteTimingsRef.current = [];
    tuneLinesRef.current = [];
    engravedAbcRef.current = [];
    prefersFlatsRef.current = [];
    playVisualObjsRef.current = [];
    builtPassesRef.current = [];
    stripLeadInRef.current = [];
    naturalPickupSecRef.current = [];
    if (!hasRenderableAbc) {
      // Nothing to engrave yet — leave the spinner up rather than rendering an
      // empty staff under a live toolbar. Re-runs when the ABC arrives.
      setSheetReady(false);
      return;
    }
    const savedTempo = loadTunePlaybackPrefs(tuneKey);
    const hasSavedTempo =
      savedTempo.tempoPercent !== 100 || savedTempo.swingPercent !== 0 || savedTempo.emphasisPercent !== DEFAULT_EMPHASIS_PERCENT;
    visualObjsRef.current = items.map((item, index) => {
      const host = sheetRefs.current[index];
      if (!host) return null;
      const engravedAbc = fixAbcRepeats(item.abc);
      engravedAbcRef.current[index] = engravedAbc;
      prefersFlatsRef.current[index] = prefersFlats(engravedAbc);
      const visualObj = abcjs.renderAbc(host, engravedAbc, {
        responsive: "resize",
        add_classes: true,
        clickListener: (abcElem, _tuneNumber, _classes, analysis) => handleNoteClick(index, abcElem, analysis),
      })[0] as ExtendedTuneObject;
      const timings = visualObj.setTiming(visualObj.getBpm());
      noteTimingsRef.current[index] = timings;
      // Runs the sequence/flatten pass, whose side effect is writing midiPitches onto every note
      // element. Nothing else does that until a synth is built, so without it clicking a note has
      // no pitch to sound or name until the tune has been played once. It needs no soundfont and
      // no audio context, and CreateSynth re-runs it with the real options at play time anyway.
      try {
        visualObj.setUpAudio({});
      } catch {
        // A tune the sequencer chokes on should still engrave and play; only clicking is lost.
      }
      tuneLinesRef.current[index] = extractLinesFromTimings(timings);
      measureLeadIn(index, engravedAbc, visualObj);
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
          setEmphasisPercent(savedTempo.emphasisPercent);
        } else {
          setSwingPercent(0);
          setEmphasisPercent(DEFAULT_EMPHASIS_PERCENT);
          setCurrentBpm(effectiveTargetBpm);
        }
      }
      return visualObj;
    });
    setSheetReady(true);
    return () => stop(false);
  }, [itemsKey, targetBpm, hasRenderableAbc]);

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

  /**
   * How many times through tune `index` playback will make, all told.
   *
   * A one-tune set has no distinction between "repeat the tune" and "repeat the set": the single
   * player passes repetitions 1 and leaves the repeat control to say how many times the tune plays,
   * so the two are folded together here and the buffer covers the lot. A set of several tunes keeps
   * them apart — its repeat replays the tunes in order, which no per-tune buffer can express — and
   * so does the Speed Trainer, which drives its own passes and disables the repeat control.
   *
   * Infinity for an unlimited repeat, which the buffer handles by looping rather than by unrolling.
   */
  function effectivePasses(index: number): number {
    const base = items[index]?.repetitions ?? 1;
    if (items.length !== 1 || !repeatRef.current || trainerRef.current?.armed) return base;
    return repeatLimitRef.current === null ? Infinity : base * repeatLimitRef.current;
  }

  /** How many passes the audio buffer is built with — every pass, or as many as it is allowed to hold. */
  function bufferPasses(index: number): number {
    return Math.max(1, Math.min(effectivePasses(index), MAX_UNROLLED_PASSES));
  }

  /** Whether the buffer has to loop to cover every pass, because it can't hold them all. */
  function needsAudioLoop(index: number): boolean {
    return effectivePasses(index) > bufferPasses(index);
  }

  /**
   * Recomputes every tune's length at `bpm`, along with the lead-in each of its repeat passes
   * skips, and returns the running time of the whole set. Both are stored on refs the transport
   * reads; the total is state because the scrubber renders it.
   */
  function applyDurations(bpm: number): number {
    durationsRef.current = items.map((_, index) => {
      const visualObj = visualObjsRef.current[index];
      const naturalTotalSec = visualObj?.getTotalTime() ?? 0;
      const baseBpm = getTuneBaseBpm(visualObj, targetBpm, items[index]?.tuneType);
      const sourceBpm = (visualObj?.getBpm() ?? 0) > 0 ? visualObj!.getBpm() : baseBpm;
      const scale = bpm > 0 && sourceBpm > 0 ? sourceBpm / bpm : 1;
      pickupSecRef.current[index] = stripLeadInRef.current[index] ? (naturalPickupSecRef.current[index] ?? 0) * scale : 0;
      return naturalTotalSec * scale;
    });
    const total = items.reduce((sum, _, index) => sum + tuneTotalSec(index), 0);
    setCurrentTotalSec(total);
    return total;
  }

  /**
   * How long the `pass`th time through tune `index` lasts. Passes after the first are shorter by
   * the lead-in whenever the unroller dropped it — the staff still shows it, but no sound is made
   * for it a second time.
   */
  function passSec(index: number, pass: number): number {
    const full = durationsRef.current[index] ?? 0;
    if (pass <= 1) return full;
    return Math.max(0, full - (pickupSecRef.current[index] ?? 0));
  }

  /**
   * Every pass of tune `index` end to end — what it contributes to the set's running time.
   *
   * An unlimited repeat has no end to measure, so it counts as one pass: the position bar spans a
   * single time through and the position wraps, which is what it has always done for a repeat with
   * no limit set.
   */
  function tuneTotalSec(index: number): number {
    const passes = effectivePasses(index);
    if (!Number.isFinite(passes)) return passSec(index, 1);
    return passSec(index, 1) + (passes - 1) * passSec(index, 2);
  }

  /** Audio consumed by the passes of tune `index` before `pass` — the offset the two clocks differ by. */
  function passStartSec(index: number, pass: number): number {
    return pass <= 1 ? 0 : passSec(index, 1) + (pass - 2) * passSec(index, 2);
  }

  /**
   * Splits a position measured from the start of the set into the tune, the pass, and how far into
   * that pass it falls.
   */
  function locate(seconds: number): { index: number; pass: number; offsetSec: number } {
    let remaining = Math.max(0, seconds);
    for (let index = 0; index < items.length; index++) {
      const total = tuneTotalSec(index);
      const isLast = index === items.length - 1;
      if (remaining < total || isLast) {
        const passes = Number.isFinite(effectivePasses(index)) ? effectivePasses(index) : 1;
        for (let pass = 1; pass <= passes; pass++) {
          const length = passSec(index, pass);
          if (remaining < length || pass === passes) {
            return { index, pass, offsetSec: Math.min(Math.max(remaining, 0), length) };
          }
          remaining -= length;
        }
        return { index, pass: 1, offsetSec: 0 };
      }
      remaining -= total;
    }
    return { index: 0, pass: 1, offsetSec: 0 };
  }

  /**
   * Where the cursor belongs on the staff, as a fraction of the engraved tune. The staff always
   * carries the lead-in, so a repeat pass starts just past it rather than at zero.
   */
  function displayFraction(index: number, pass: number, offsetSec: number): number {
    const full = durationsRef.current[index] ?? 0;
    if (full <= 0) return 0;
    // A hair early, because abcjs's setProgress walks events forward while their timestamp is
    // strictly less than the position asked for. Landing exactly on a note's start is a coin toss
    // between float roundings — this tune's length as the timer computed it against as we did — and
    // losing it puts the cursor a note ahead of the music for the rest of the pass. The millisecond
    // given up is well under a frame, and the audio anchor takes it straight back.
    const NUDGE_SEC = 0.001;
    return Math.min(Math.max((skippedSec(index, pass) + offsetSec - NUDGE_SEC) / full, 0), 1);
  }

  /**
   * Where to seek the buffer, in seconds from its start. Not a fraction of the tune's whole run:
   * once the buffer loops, it is shorter than the music it plays.
   */
  function audioSec(index: number, pass: number, offsetSec: number): number {
    const built = builtPassesRef.current[index] ?? 1;
    // A pass beyond what the buffer holds is played by the looped region, which is its last pass.
    const bufferPass = Math.min(pass, built);
    return passStartSec(index, bufferPass) + offsetSec;
  }

  /** The stretch of buffer the browser loops to keep an over-long repeat going, in seconds. */
  function loopWindowSec(index: number): { start: number; end: number } | null {
    const built = builtPassesRef.current[index] ?? 1;
    if (built < 2 || !needsAudioLoop(index)) return null;
    // The last pass in the buffer. Its opening already carries the previous pass's ring-out, so
    // looping back onto it rejoins the music exactly where cutting the last note's tail left off.
    return { start: passStartSec(index, built), end: passStartSec(index, built + 1) };
  }

  /** The lead-in the staff shows on `pass` but the unrolled audio doesn't play. */
  function skippedSec(index: number, pass: number): number {
    return pass > 1 ? pickupSecRef.current[index] ?? 0 : 0;
  }

  /**
   * The cursor's clock reads in staff time, which still counts the lead-in a repeat pass never
   * sounds. Taking that back off turns it into a position in the set.
   */
  function positionFromTimer(index: number, pass: number, timerMs: number): number {
    const offsetSec = Math.max(0, timerMs / 1000 - skippedSec(index, pass));
    // An unlimited repeat has no end for the bar to measure against, so the bar shows one pass and
    // the position wraps — which is what it has always done for a repeat with no limit set.
    if (!Number.isFinite(effectivePasses(index))) return tuneStartSec(index) + offsetSec;
    return absoluteSec(index, pass, offsetSec);
  }

  /**
   * What to subtract from the audio clock to read it as staff time, for audio starting at
   * `audioStartSec` with the cursor at `pass` and `offsetSec`.
   *
   * The audio clock counts from wherever in the buffer the sound was started, and keeps counting
   * straight through every pass — past the buffer's own length once it is looping. The cursor's
   * timer restarts at the top of the staff for each pass, and restarts it past the lead-in the
   * audio dropped. Taking the two readings at the one moment they are known to agree is what
   * reconciles all of that, including a seek that lands in the looped region, where the buffer
   * position and the musical position are passes apart.
   */
  function audioClockOffsetSec(index: number, pass: number, audioStartSec: number, offsetSec: number): number {
    return audioStartSec - skippedSec(index, pass) - offsetSec;
  }

  /**
   * Points the browser's own buffer looping at the tune's last unrolled pass, so a repeat count the
   * buffer can't hold — an unlimited one above all — keeps going without ever restarting the sound.
   *
   * Re-applied every beat rather than once at the start, because anything that makes a new sound
   * gets a fresh AudioBufferSourceNode with none of this on it: a seek, a resume, a backer coming in
   * late. Setting the same three properties again is free, and it means no start path has to
   * remember to do it. It is also how the loop gets switched off for the final pass, so a tune with
   * a lead-out plays past the loop into it.
   */
  function armAudioLoop(index: number, voices: abcjs.MidiBuffer[], pass: number) {
    const window = loopWindowSec(index);
    if (!window) return;
    const looping = pass < effectivePasses(index);
    for (const voice of voices) {
      const sources = (voice as unknown as { directSource?: AudioBufferSourceNode[] }).directSource;
      if (!sources) continue;
      for (const source of sources) {
        source.loopStart = window.start;
        source.loopEnd = window.end;
        source.loop = looping;
      }
    }
  }

  /** Parks the playback cursor out of sight on one tune's staff. */
  function clearCursorLine(index: number) {
    const cursor = sheetRefs.current[index]?.querySelector("svg")?.querySelector(".abcjs-cursor");
    if (cursor) {
      cursor.setAttribute("y1", "0");
      cursor.setAttribute("y2", "0");
    }
  }

  useEffect(() => {
    if (visualObjsRef.current.length === items.length) {
      applyDurations(currentBpm);
    }
  }, [itemsKey, currentBpm, targetBpm]);

  /**
   * Names and sounds a note the reader clicked on the staff.
   *
   * abcjs only makes notes selectable by default (Selectables.canSelect), so bars, clefs and the
   * rest never arrive here — but rests do, as notes with a rest property, and they have nothing to
   * play or name.
   */
  function handleNoteClick(index: number, abcElem: abcjs.AbcElem, analysis: abcjs.ClickListenerAnalysis) {
    if (abcElem.rest) return;

    // setTiming() runs on every tune right after renderAbc, which is what fills in midiPitches;
    // the parsed pitches are the fallback if that hasn't happened for some reason.
    const pitches =
      abcElem.midiPitches?.map((p) => p.pitch) ??
      abcElem.pitches?.map((p) => p.midipitch).filter((p): p is number => typeof p === "number") ??
      [];
    if (pitches.length === 0) return;

    // The one-shot synth: no CreateSynth, no init/prime, no audio context of our own — the same
    // path playMetronomeClick and playTargetNote use. Passing 1000 as the measure length makes
    // duration read straight through as seconds.
    const instrument = instrumentsRef.current.melody;
    abcjs.synth
      .playEvent(
        pitches.map((pitch) => ({ pitch, volume: 90, start: 0, duration: CLICKED_NOTE_SEC, instrument, gap: 0 })),
        [],
        1000,
      )
      .catch(() => {});

    showNoteBadge(index, spellMidiNotes(pitches, prefersFlatsRef.current[index] ?? false), analysis.selectableElement);
  }

  /** Floats a note's name just above it, fading out on its own. A new click replaces the old badge. */
  function showNoteBadge(index: number, text: string, target: Element | null) {
    const host = tuneRefs.current[index];
    if (!host || !text) return;
    const targetRect = target?.getBoundingClientRect();
    if (!targetRect) return;
    const hostRect = host.getBoundingClientRect();

    if (noteBadgeTimeoutRef.current !== null) window.clearTimeout(noteBadgeTimeoutRef.current);
    noteBadgeIdRef.current += 1;
    setNoteBadge({
      id: noteBadgeIdRef.current,
      index,
      text,
      x: targetRect.left + targetRect.width / 2 - hostRect.left,
      y: targetRect.top - hostRect.top,
    });
    noteBadgeTimeoutRef.current = window.setTimeout(() => {
      noteBadgeTimeoutRef.current = null;
      setNoteBadge(null);
      clearNoteSelection();
    }, NOTE_BADGE_MS);
  }

  /**
   * Drops abcjs's own selection mark from a clicked note.
   *
   * Clicking makes abcjs paint the note with a hardcoded red fill attribute and leave it that way
   * indefinitely, which is neither transitory nor in the app's palette. CSS restyles it while it is
   * there (see .abcjs-note_selected); this clears it once the name has faded, so the whole
   * interaction ends where it started.
   */
  function clearNoteSelection() {
    for (const host of sheetRefs.current) {
      for (const el of host?.querySelectorAll(".abcjs-note_selected") ?? []) {
        el.classList.remove("abcjs-note_selected");
        el.setAttribute("fill", "currentColor");
      }
    }
  }

  /** A badge is positioned against the staff, so it means nothing once the staff is gone. */
  useEffect(() => {
    if (noteBadgeTimeoutRef.current !== null) window.clearTimeout(noteBadgeTimeoutRef.current);
    noteBadgeTimeoutRef.current = null;
    setNoteBadge(null);
    clearNoteSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  useEffect(() => {
    return () => {
      if (noteBadgeTimeoutRef.current !== null) window.clearTimeout(noteBadgeTimeoutRef.current);
    };
  }, []);

  function copyAbc(index: number) {
    const abc = engravedAbcRef.current[index];
    if (!abc) return;
    navigator.clipboard
      ?.writeText(abc)
      .then(() => showToast("ABC copied", "success"))
      .catch(() => showToast("Could not copy to clipboard", "error"));
  }

  /**
   * Moves the ABC view's cursor to the note this timing event belongs to.
   *
   * Tracked whichever view is showing, not just in ABC mode: the two views have to agree the
   * instant you switch between them, rather than the one you land on sitting blank until the next
   * note comes round.
   */
  function setAbcCursorFromEvent(index: number, ev: abcjs.NoteTimingEvent) {
    if (typeof ev.startChar !== "number" || ev.startChar < 0) return;
    setAbcCursor({ index, start: ev.startChar, end: ev.endChar ?? ev.startChar });
  }

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
    setAbcCursor(null);
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

  /**
   * Pins the cursor's clock to the audio's on the next frame — i.e. after the React commit, scroll
   * and layout work that a start kicks off, which is exactly the delay that used to be baked into
   * the cursor's zero and leave it permanently behind the music.
   *
   * Guarded by the play-session generation and timer identity so a superseded start can't re-anchor
   * whatever timer has since replaced it.
   */
  function anchorOnNextFrame(timer: abcjs.TimingCallbacks, synth: abcjs.MidiBuffer) {
    const session = playSessionRef.current;
    requestAnimationFrame(() => {
      if (playSessionRef.current !== session) return;
      if (timerRef.current !== timer) return;
      anchorTimerToAudio(timer, synth, { offsetMs: passOffsetMsRef.current });
    });
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
    passOffsetMsRef.current = 0;
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
    const timer = timerRef.current;
    timer?.start();
    setStatus("playing");
    // The synth measured its pause point on the AudioContext clock and the timer measured its own
    // on performance.now(), so without this the two disagree a little more after every pause.
    const leader = voicesAt(activeIndex)[0];
    if (timer && leader) anchorOnNextFrame(timer, leader);
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

  /**
   * The repeat settings decide how many passes the buffer holds and how long the set runs, so a
   * change to them has to rebuild both — the same full restart a bodhran toggle does.
   */
  function applyRepeatChange(next: { repeat?: boolean; repeatLimit?: number | null }) {
    const nextRepeat = next.repeat ?? repeat;
    const nextLimit = next.repeatLimit !== undefined ? next.repeatLimit : repeatLimit;
    if (next.repeat !== undefined) setRepeat(nextRepeat);
    if (next.repeatLimit !== undefined) setRepeatLimit(nextLimit);
    repeatRef.current = nextRepeat;
    repeatLimitRef.current = nextLimit;
    if (status !== "stopped") {
      play(currentBpm);
    } else {
      applyDurations(currentBpm);
    }
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
    const { index: targetIndex, pass: targetPass, offsetSec } = locate(clampedSeconds);

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

    startTune(targetIndex, currentBpm, targetPass, offsetSec, false);
  }

  /** Absolute position, in seconds from the start of the set, at which tune `index` begins. */
  function tuneStartSec(index: number): number {
    let sum = 0;
    for (let i = 0; i < index; i++) sum += tuneTotalSec(i);
    return sum;
  }

  /** Absolute position, in seconds from the start of the set, of a point inside a tune's pass. */
  function absoluteSec(index: number, pass: number, offsetSec: number): number {
    return tuneStartSec(index) + passStartSec(index, pass) + offsetSec;
  }

  /**
   * How far into the current tune the user has to be before "previous" restarts it instead of
   * stepping back a tune — the convention every hardware transport uses.
   */
  const PREV_RESTART_SEC = 3;

  function skipToNextTune() {
    const index = activeIndex ?? 0;
    if (index + 1 < items.length) {
      seek(tuneStartSec(index + 1));
    } else if (repeatRef.current) {
      seek(0);
    }
  }

  function skipToPreviousTune() {
    const index = activeIndex ?? 0;
    const start = tuneStartSec(index);
    if (positionSec - start > PREV_RESTART_SEC || index === 0) {
      seek(start);
    } else {
      seek(tuneStartSec(index - 1));
    }
  }

  /**
   * The tune object the synth plays from: the music unrolled into as many back-to-back passes as
   * the buffer is allowed to hold.
   *
   * It is parsed rather than engraved (abcjs.parseOnly), so unrolling costs no layout — the synth
   * only ever asks it for the flattened note sequence and the meter. The staff, the cursor and the
   * ABC view all keep using the single-pass object. Falls back to that object when there is nothing
   * to unroll, or when the unrolled ABC won't parse, and playback then repeats it the old way.
   */
  function buildPlaybackTune(index: number, visualObj: ExtendedTuneObject): abcjs.TuneObject {
    const passes = bufferPasses(index);
    playVisualObjsRef.current[index] = null;
    builtPassesRef.current[index] = 1;
    if (passes <= 1) return visualObj;

    const engravedAbc = engravedAbcRef.current[index] ?? "";
    const playback = buildPlaybackAbc(engravedAbc, passes, { keepLeadIn: !stripLeadInRef.current[index] });
    try {
      const parsed = abcjs.parseOnly(playback.abc)[0];
      if (!parsed) return visualObj;
      playVisualObjsRef.current[index] = parsed;
      builtPassesRef.current[index] = passes;
      return parsed;
    } catch {
      return visualObj;
    }
  }

  async function buildSynthsForTune(index: number, bpm: number): Promise<abcjs.MidiBuffer[] | null> {
    const visualObj = visualObjsRef.current[index];
    if (!visualObj) return null;
    const timings = visualObj.setTiming(bpm);
    noteTimingsRef.current[index] = timings;
    tuneLinesRef.current[index] = extractLinesFromTimings(timings);
    // The staff shows one pass; the synth plays as many as the buffer can hold, and loops the last
    // of them if that still isn't every pass. Everything below that feeds the audio reads the
    // unrolled tune, so a repeat never has to restart the buffer.
    const playObj = buildPlaybackTune(index, visualObj);
    const msPerMeasure = visualObj.millisecondsPerMeasure(bpm);
    const bandMode = isBandModeRef.current;
    const voicesToUse = bandMode ? bandVoicesRef.current : [];
    const useBodhran = bodhranRef.current;

    if (bandMode && voicesToUse.length === 0) return null;

    try {
      const meter = visualObj.getMeterFraction();
      // Compound meters (6/8, 9/8, 12/8) lilt the first of each three; everything else
      // uses abcjs's own swing, which is a no-op at 0% (toAbcjsSwing(0) === 50).
      const compound = isCompoundMeter(meter);
      const swingPercent = swingPercentRef.current;
      const emphasisPercent = emphasisPercentRef.current;
      const pulse = getMeterPulse(meter);
      // Where bar 1 actually starts. Most tunes in this repertoire begin on an upbeat, and without
      // this every accent would land a beat or two off for all of them.
      const pickupWholeNotes = playObj.getPickupLength();
      // Seconds per whole note — converts the strum's wall-clock spread into the units note
      // starts use. Both the band and solo paths need it.
      const meterSize = meter.den ? meter.num / meter.den : 1;
      const tempoMultiplierSec = msPerMeasure / 1000 / meterSize;

      if (voicesToUse.length > 0) {
        return await Promise.all(
          voicesToUse.map((voice) =>
            createBandSynth(playObj, msPerMeasure, voice, tempoMultiplierSec, {
              swing: compound ? undefined : toAbcjsSwing(swingPercent),
              swingPercent,
              emphasisPercent,
              bodhran: useBodhran,
            }),
          ),
        );
      }

      const synth = new abcjs.synth.CreateSynth();
      const currentInst = instrumentsRef.current;
      const bodhranPattern = useBodhran ? getBodhranDrumOption(meter) : undefined;

      await synth.init({
        visualObj: playObj,
        millisecondsPerMeasure: msPerMeasure,
        options: {
          ...synthInstrumentOptions(currentInst),
          swing: compound ? undefined : toAbcjsSwing(swingPercent),
          drum: bodhranPattern,
          drumBars: bodhranPattern ? 1 : undefined,
          // abcjs discards this callback's return value, so every helper rewrites the
          // tracks in place. Order matters: swing moves note starts, subdivision splits
          // from those (already swung) starts, and the strum spreads each re-strike
          // subdivision produced.
          sequenceCallback: (tracks) => {
            if (compound && swingPercent > 0) {
              applyCustomTripletSwing(tracks, swingPercent);
            }
            // After swing (so it weighs each note's final position) and before subdivision (so a
            // re-struck long note inherits its beat's weight) and the strum (so a chord's volume
            // ramp is relative to the accented level rather than fighting it).
            applyMeterEmphasis(tracks, pulse, pickupWholeNotes, emphasisPercent);
            tracks.forEach((track, trackIdx) => {
              let prog: number | string = trackIdx === 0 ? currentInst.melody : trackIdx === 1 ? currentInst.chords : currentInst.bass;
              if (track.length > 0 && track[0].instrument) {
                prog = track[0].instrument;
              }
              if (shouldSubdivideInstrument(prog)) {
                subdivideLongNotes(track);
              }
              // Judges each simultaneous group on its own instrument, so it still strums
              // the chord track when the track's first note is a bass note.
              strumChords(track, tempoMultiplierSec);
            });
            // Ignored at runtime; abcjs's type declaration still demands a return.
            return tracks;
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
    // The controls are hidden until isReady, but fullscreen/keyboard paths and a
    // mid-flight items change can still get here before the staff exists.
    if (!isReady) return;
    // Spends the user gesture now: the awaits below (soundfont loading) run long enough for the
    // browser to forget the activation, and without an audible media element the OS never routes
    // headset or media-key presses back to us.
    primeMediaSession();
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

      // Where the old tempo's timeline put us, as a share of the set, so the same musical spot comes
      // back after the durations are rebuilt at the new one.
      const oldTotalSec = currentTotalSec;
      const positionShare = keepPosition && oldTotalSec > 0 ? positionSec / oldTotalSec : 0;

      const newTotalSec = applyDurations(effectiveBpm);

      const loopStartSec = loop ? loop.a * newTotalSec : null;
      const resumeSec = loopStartSec ?? (keepPosition ? positionShare * newTotalSec : 0);
      const { index: targetIndex, pass: targetPass, offsetSec: targetOffsetSec } = locate(resumeSec);

      const synthResults = await Promise.all(items.map((_, idx) => buildSynthsForTune(idx, effectiveBpm)));
      if (playSessionRef.current !== mySession) return;
      if (synthResults.some((v) => !v)) throw new Error("Could not build synths for set.");
      synthsRef.current = synthResults as abcjs.MidiBuffer[][];

      setStatus("playing");
      setCurrentBpm(effectiveBpm);
      if (startingTrainer) {
        passRef.current = 1;
        setPassCount(1);
      }
      startTune(targetIndex, effectiveBpm, targetPass, targetOffsetSec, true, true);
    } catch {
      setError("Audio unavailable (soundfont could not be loaded).");
    }
  }

  function startTune(
    index: number,
    bpm: number,
    startPass = 1,
    /** How far into that pass to begin, in seconds. */
    startOffsetSec = 0,
    shouldScroll = true,
    /**
     * Hold the sound until the staff has painted. Only for a fresh start from play(), never for a
     * pass repeat or a tune-to-tune handover, where waiting two frames would put an audible gap in
     * the middle of continuous playback.
     */
    waitForPaint = false,
  ) {
    const visualObj = visualObjsRef.current[index];
    const voices = synthsRef.current[index];
    if (!visualObj || !voices || voices.length === 0) return;

    pendingTimeoutsRef.current = clearPendingTimeouts(pendingTimeoutsRef.current);
    pendingBackersRef.current.clear();

    const synth = voices[0];
    const backers = voices.slice(1);
    let pass = startPass;
    /**
     * Whether this tune's buffer holds every pass. When it does, a repeat is nothing but the cursor
     * going back to the top — the audio never stops, so there is no gap to hear. Only a tune that
     * couldn't be unrolled falls back to restarting the buffer.
     */
    const isUnrolled = playVisualObjsRef.current[index] != null;

    setActiveIndex(index);
    setActivePass(startPass);
    if (shouldScroll) {
      sheetRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    if (!isDraggingRef.current) {
      setPositionSec(absoluteSec(index, startPass, startOffsetSec));
    }

    keyRootRef.current = getAbcKeyRoot(items[index].abc);

    /*
     * abcjs counts beats straight through the tune — beatCallback gets 0, 1, 2, 3, … and never
     * restarts at each barline (abc_timing_callbacks.js builds beatStarts as j/beatSubdivisions).
     * So the old `beatNumber === 1` test accented the second beat of the pass and nothing else.
     * Folding the count back into the bar gives a real downbeat, offset by the pickup so a tune
     * that starts on an upbeat still accents its barlines rather than its anacrusis.
     */
    const beatsPerBar = Math.max(1, Math.round(visualObj.getBeatsPerMeasure()));
    const beatLength = visualObj.getBeatLength();
    const pickupBeats = beatLength > 0 ? Math.round(visualObj.getPickupLength() / beatLength) : 0;

    const timer = new abcjs.TimingCallbacks(visualObj, {
      qpm: bpm,
      beatCallback: (beatNumber: number) => {
        if (useMetronomeRef.current) {
          const sound = metronomeSoundRef.current;
          const beatInBar = (((Math.round(beatNumber) + pickupBeats) % beatsPerBar) + beatsPerBar) % beatsPerBar;
          const isDownbeat = beatInBar === 0;
          // The downbeat is the same click played harder, not a different drum. Swapping in a bass
          // drum, as this used to, ties the accent's loudness to whichever sample was substituted —
          // and against most of the sounds in the list that made the "accent" the quieter of the
          // two. A melodic click still drops an octave off the beat, which reads as a pulse the way
          // a drum's pitch does not.
          const pitch =
            sound.instrument === 128 ? undefined : isDownbeat ? keyRootRef.current : keyRootRef.current - 12;
          playMetronomeClick(sound, pitch, isDownbeat);
        }
        armAudioLoop(index, voices, pass);
        const activeLoop = loopRef.current;
        const ms = timer.currentMillisecond();
        if (activeLoop && currentTotalSec > 0 && positionFromTimer(index, pass, ms) >= activeLoop.b * currentTotalSec) {
          const target = locate(activeLoop.a * currentTotalSec);
          // A loop that runs back into an earlier tune needs the whole restart that seek() does;
          // one inside this tune is just a jump in the buffer already playing.
          if (target.index !== index) {
            void seek(activeLoop.a * currentTotalSec);
            return;
          }
          pass = target.pass;
          setActivePass(pass);
          const jumpSec = isUnrolled ? audioSec(index, pass, target.offsetSec) : target.offsetSec;
          passOffsetMsRef.current = isUnrolled
            ? audioClockOffsetSec(index, pass, jumpSec, target.offsetSec) * 1000
            : 0;
          for (const v of voices) v.seek(jumpSec, "seconds");
          timer.setProgress(displayFraction(index, pass, target.offsetSec));
          // Same split-clock problem as a fresh start: the seek lands on the audio clock and
          // setProgress on performance.now(), so re-pin them once the jump has settled.
          anchorOnNextFrame(timer, synth);
          return;
        }

        // Keep the cursor pinned to the audio as playback continues. Free when the two agree, so
        // this costs nothing on the common path.
        if (!isDraggingRef.current && statusRef.current === "playing") {
          const drift = timerDriftMs(timer, synth, passOffsetMsRef.current);
          if (drift !== null) {
            anchorTimerToAudio(timer, synth, {
              ease: Math.abs(drift) >= DRIFT_SNAP_MS ? 1 : DRIFT_EASE,
              offsetMs: passOffsetMsRef.current,
            });
          }
        }
      },
      eventCallback: (ev: abcjs.NoteTimingEvent | null) => {
        clearHighlights();
        if (ev) {
          if (!isDraggingRef.current) {
            setPositionSec(positionFromTimer(index, pass, timer.currentMillisecond()));
          }

          for (const group of ev.elements ?? []) {
            for (const el of group) {
              el.classList.add("highlight");
              highlightedRef.current.push(el);
            }
          }
          setAbcCursorFromEvent(index, ev);
          const host = sheetRefs.current[index];
          const svg = host?.querySelector("svg") as SVGSVGElement | null;
          if (typeof ev.left === "number" && typeof ev.top === "number" && typeof ev.height === "number" && svg) {
            updateCursorPosition(svg, ev.left - 2, ev.top, ev.top + ev.height);
            checkAutoScroll(index, ev);
          }
          return undefined;
        }
        // The cursor has reached the end of the staff.
        if (pass < effectivePasses(index)) {
          pass++;
          setActivePass(pass);
          // Switches the browser's looping off on the last pass, so a lead-out is reached.
          armAudioLoop(index, voices, pass);
          if (isUnrolled) {
            // The buffer is already partway into this pass; only the cursor goes back to the top,
            // and it skips whatever lead-in the unrolled audio left out. Nothing stops, so there is
            // nothing to restart and no gap to hear.
            // The audio ran on by one pass while the cursor went back to the top of the staff.
            passOffsetMsRef.current += passSec(index, 2) * 1000;
            // setProgress moves the clock and lights the pass's first note in the same breath;
            // start(0) would only reset, leaving the staff blank until the next frame. start() is
            // still needed after it — doTiming stops rescheduling itself once it has run the tune
            // out, so nothing would drive the cursor otherwise.
            timer.setProgress(displayFraction(index, pass, 0));
            timer.start();
            anchorOnNextFrame(timer, synth);
            return "continue";
          }
          for (const v of voices) v.stop();
          timer.stop();
          clearCursorLine(index);
          for (const v of voices) v.seek(0);
          synth.start();
          startBackersStaggered(index, backers);
          // start(0) resets the timer's zero, so the setProgress(0) it used to be paired with was
          // discarded anyway; the anchor is what actually lines the new pass up with the audio.
          timer.start(0);
          anchorOnNextFrame(timer, synth);
          return "continue";
        }

        // End of the tune.
        for (const v of voices) v.stop();
        timer.stop();
        clearCursorLine(index);

        if (index + 1 < items.length) {
          const nextIndex = index + 1;
          if (synthsRef.current[nextIndex] && synthsRef.current[nextIndex].length > 0) {
            startTune(nextIndex, bpm);
            return "continue";
          }
          advanceToTune(nextIndex, bpm);
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

          // A one-tune set counts its repeat as passes of the tune, and has just played them all.
          if (repeatRef.current && items.length > 1) {
            if (repeatLimitRef.current === null || setPassRef.current < repeatLimitRef.current) {
              setPassRef.current++;
              if (synthsRef.current[0] && synthsRef.current[0].length > 0) {
                startTune(0, bpm);
                return "continue";
              }
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

    // Where in the buffer and on the staff this start lands. They differ once a tune is unrolled:
    // the buffer spans several passes, the staff only ever spans one.
    const audioStartSec = isUnrolled
      ? audioSec(index, startPass, startOffsetSec)
      : startOffsetSec;
    const staffStart = displayFraction(index, startPass, startOffsetSec);
    passOffsetMsRef.current = isUnrolled
      ? audioClockOffsetSec(index, startPass, audioStartSec, startOffsetSec) * 1000
      : 0;

    function beginPlayback() {
      if (audioStartSec > 0) {
        for (const v of voices) v.seek(audioStartSec, "seconds");
      }
      synth.start();
      if (audioStartSec === 0) {
        startBackersStaggered(index, backers);
      } else {
        for (const backer of backers) backer.start();
      }
      armAudioLoop(index, voices, pass);
      timer.start(staffStart);
      // The cursor's zero would otherwise be whenever the first frame after all of the above lands
      // — the React commit, the scrollIntoView, the SVG layout — leaving it that far behind the
      // music for the rest of the tune. Anchoring to the audio clock makes the start delay moot.
      anchorOnNextFrame(timer, synth);
    }

    const isPlayerPaused = statusRef.current === "paused";
    if (isPlayerPaused) {
      for (const v of voices) v.seek(audioStartSec, "seconds");
      timer.start(staffStart);
      // Not redundant with start(): for a zero offset start() resets startTime to null, and
      // pause() reads startTime to record where it paused. setProgress puts a real value there.
      timer.setProgress(staffStart);
      timer.pause();
    } else if (waitForPaint) {
      /*
       * Sound waits for the staff, rather than the other way round.
       *
       * The cursor cannot paint until a frame after the timer starts, so starting audio first means
       * the tune is already under way by the time anything appears — and the cursor, correctly
       * anchored to the audio, then shows up partway through the melody. The slower the device (or
       * the heavier the page), the further in it lands.
       *
       * So paint the starting note first, using the same scrub-preview path that draws a position
       * without any audio, and only make a sound on the frame after that has actually appeared.
       */
      const session = playSessionRef.current;
      const stillCurrent = () => playSessionRef.current === session && timerRef.current === timer;
      requestAnimationFrame(() => {
        if (!stillCurrent()) return;
        updateVisualsForTime(absoluteSec(index, startPass, startOffsetSec));
        // Waits for the output device to actually be rendering before making a sound. Resolves at
        // once on every play after the first, so only the very first start ever pays for it.
        void waitForAudioClock().then(() => {
          if (!stillCurrent()) return;
          requestAnimationFrame(() => {
            if (!stillCurrent()) return;
            beginPlayback();
          });
        });
      });
    } else {
      beginPlayback();
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

  function onEmphasisInput(e: ChangeEvent<HTMLInputElement>) {
    const percent = Number((e.target as HTMLInputElement).value);
    setEmphasisPercent(percent);
  }

  function restartAtCurrentPosition() {
    if (status !== "stopped") {
      play(currentBpm);
    }
  }
  const tempoInputRef = useCommitOnChange(restartAtCurrentPosition);
  const swingInputRef = useCommitOnChange(restartAtCurrentPosition);
  // Like swing, emphasis is baked into the synth buffer at init time, so it commits on change
  // rather than on every drag step.
  const emphasisInputRef = useCommitOnChange(restartAtCurrentPosition);

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

  /*
   * OS media controls: headset play/pause, keyboard media keys, and the lock-screen transport. The
   * skip handlers are only supplied for a real set — on a single tune there is nothing to skip to,
   * and handing the OS a handler anyway lights up buttons that would do nothing.
   */
  const mediaItem = items[activeIndex ?? 0];
  /*
   * Most session tunes are traditional and carry no C: header, so the composer is a bonus rather
   * than the primary label: fall back to the tune type, which is always the more useful thing to
   * show on a lock screen than a blank line.
   */
  const mediaComposer = extractComposerFromAbc(mediaItem?.abc ?? "");
  usePlayerMediaSession({
    status,
    title: mediaItem?.title?.trim() || "Tune",
    artist: [mediaComposer || mediaItem?.tuneType, isSingle ? null : `Tune ${(activeIndex ?? 0) + 1} of ${items.length}`]
      .filter(Boolean)
      .join(" \u00b7 "),
    album: "sessionr",
    positionSec,
    durationSec: currentTotalSec,
    handlers: {
      // Idempotent on purpose: a repeated or spurious action from the OS should do nothing rather
      // than restart the set from the top, which is what a bare play() on an already-playing
      // player would do.
      play: () => (status === "paused" ? resume() : status === "stopped" ? play() : undefined),
      pause: () => (status === "playing" ? pause() : undefined),
      stop: () => stop(false),
      seekTo: (seconds) => seek(seconds),
      seekBy: (offset) => seek(Math.min(Math.max(positionSec + offset, 0), currentTotalSec)),
      nextTrack: isSingle ? undefined : skipToNextTune,
      previousTrack: isSingle ? undefined : skipToPreviousTune,
    },
  });

  return (
    <div ref={containerRef} className={`player-container ${isFullscreen ? "is-fullscreen" : ""}`}>
      {isFullscreen && isReady && (
        <div className={`fullscreen-controls ${showFsControls ? "" : "hidden"}`}>
          <button onClick={() => (status === "playing" ? pause() : status === "paused" ? resume() : play())} title={status === "playing" ? "Pause" : "Play"}>
            {status === "playing" ? "⏸" : "▶"}
          </button>
          <button onClick={() => stop(false)} disabled={status === "stopped" && positionSec === 0} title="Stop">
            ■
          </button>
          <button
            className={repeat ? "toggled" : ""}
            aria-pressed={repeat}
            disabled={trainer.armed}
            title={trainer.armed ? "Speed trainer controls repeats while active" : "Repeat"}
            onClick={() => {
              if (trainer.armed) return;
              applyRepeatChange({ repeat: !repeat });
            }}
          >
            🔁
          </button>
          <div className="fs-seek-track">
            <span className="time-label">{formatTime(positionSec)}</span>
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
            <span className="time-label">{formatTime(currentTotalSec)}</span>
          </div>
          <button onClick={toggleFullscreen} title="Exit Fullscreen">
            ✕
          </button>
        </div>
      )}

      {!isReady && (
        <div className="player-loading spinner-row" role="status" aria-live="polite">
          <Spinner />
        </div>
      )}

      {isReady && (<>
      <div className="player-controls primary-controls">
        <button onClick={() => (status === "playing" ? pause() : status === "paused" ? resume() : play())}>
          {status === "playing" ? "⏸ Pause" : isSingle ? "▶ Play" : "▶ Play set"}
        </button>
        <button onClick={() => stop(false)} disabled={status === "stopped" && positionSec === 0}>
          ■ Stop
        </button>
        <button
          className={repeat ? "toggled" : ""}
          aria-pressed={repeat}
          disabled={trainer.armed}
          title={trainer.armed ? "Speed trainer controls repeats while active" : undefined}
          onClick={() => {
            if (trainer.armed) return;
            applyRepeatChange({ repeat: !repeat });
          }}
        >
          {isSingle ? "🔁 Repeat" : "🔁 Repeat set"}
        </button>
        {repeat && (
          <label className="reps-label">
            Times
            <DebouncedNumberInput
              className="reps-input"
              min={1}
              allowNull
              placeholder="∞"
              title="Number of times to repeat (leave empty for infinite)"
              value={repeatLimit}
              onChange={(clamped) => {
                applyRepeatChange({ repeatLimit: clamped });
              }}
            />
          </label>
        )}
        {onLogPractice && (
          <button
            className={isPracticedToday ? "toggled" : "primary-action"}
            disabled={isPracticedToday || isLoggingPractice}
            onClick={onLogPractice}
          >
            {isPracticedToday
              ? "✓ Practiced today"
              : logPracticeLabel || (isSingle ? "✓ Log practice" : "✓ Log set practice")}
          </button>
        )}
        <button
          className={viewMode === "abc" ? "toggled" : ""}
          aria-pressed={viewMode === "abc"}
          title="Switch between the engraved staff and the ABC source. Playback follows along in both."
          onClick={() => setViewMode((v) => (v === "abc" ? "sheet" : "abc"))}
        >
          {viewMode === "abc" ? "🔤 ABC" : "🎼 Sheet"}
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
        {metronome.useMetronome && (
          <span className="badge badge-working" title="Metronome active">
            🔊 Metronome ({metronome.metronomeSound.label})
          </span>
        )}
        {bodhran && (
          <span className="badge badge-working" title="Bodhrán drum active">
            🥁 Bodhrán
          </span>
        )}
        {isBandMode && (
          <span className="badge badge-working" title="Band mode active">
            👥 Band ({bandPrefs.count} players)
          </span>
        )}
      </div>

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
      </>)}

      {isReady && showAdvanced && (
        <div className="advanced-controls-panel">
          <div className="advanced-section">
            <h4 className="advanced-section-title">Playback & Tempo</h4>
            <div className="player-controls">
              <label>
                Tempo {currentBpm} BPM ({tempoPercent}%)
                <input
                  ref={tempoInputRef}
                  type="range"
                  min={Math.max(30, Math.round(baseBpm * 0.1))}
                  max={Math.round(baseBpm * 2)}
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
              <label title="How hard playback leans on the beats the meter leans on — 1 and 3 in a reel, the two groups of a jig.">
                Emphasis {emphasisPercent}%
                <input
                  ref={emphasisInputRef}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={emphasisPercent}
                  onChange={onEmphasisInput}
                />
              </label>
              <MetronomeControls {...metronome} />
            </div>
          </div>

          <div className="advanced-section">
            <h4 className="advanced-section-title">Practice Tools</h4>
            <div className="player-controls">
              <button
                className={trainer.armed ? "toggled" : ""}
                aria-pressed={trainer.armed}
                onClick={() => {
                  const nextArmed = !trainer.armed;
                  if (nextArmed) {
                    applyRepeatChange({ repeat: false });
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
              <button
                className={loop || markA !== null ? "toggled" : ""}
                disabled={status === "stopped"}
                onClick={markLoopPoint}
                title="Mark loop start, then loop end, at the current position"
              >
                {markA !== null ? "Set loop end" : loop ? "New loop" : "Set loop start"}
              </button>
              {(loop || markA !== null) && <button onClick={clearLoop}>✕ Loop off</button>}
            </div>
          </div>

          <div className="advanced-section">
            <h4 className="advanced-section-title">Ensemble & Sound</h4>
            <div className="player-controls">
              <button
                className={isBandMode ? "toggled" : ""}
                aria-pressed={isBandMode}
                onClick={() => updateBandPrefs({ mode: isBandMode ? "solo" : "band" })}
                title="Solo: one instrument with melody/chords/bass. Band: several independent players, like a folk session."
              >
                {isBandMode ? "👥 Band" : "🎻 Solo"}
              </button>
              <button
                className={bodhran ? "toggled" : ""}
                aria-pressed={bodhran}
                onClick={toggleBodhran}
                title="Toggle automated bodhrán folk drum backing"
              >
                🥁 Bodhrán
              </button>
            </div>

            {!isBandMode ? (
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
            ) : (
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
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {/* Keeps the .sheet-music class in ABC mode even though nothing is engraved: the fullscreen
          rules key off it to decide what stays visible and what scrolls. showing-abc strips the
          paper styling instead, so ABC mode isn't the source framed by an empty staff panel. */}
      <div
        className={`${isSingle ? "sheet-music" : "set-player-tunes-list"} ${viewMode === "abc" ? "showing-abc" : ""}`}
      >
        {items.map((item, index) => {
          const href = linkHref ? linkHref(item) : `/tune/${item.userTuneId}`;
          const showHeader = !isSingle && Boolean(item.title);
          return (
            <div
              key={item.userTuneId}
              className={`tune-view ${isSingle ? "" : `set-player-tune ${activeIndex === index ? "active" : ""}`}`}
              ref={(el) => {
                tuneRefs.current[index] = el;
              }}
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
              {/* The wrapper is what gets hidden, not the engraving host itself: responsive:"resize"
                  makes abcjs write display:inline-block as an inline style on its host, which beats
                  any class rule we could put there.

                  And hidden rather than unmounted — the engraving, its note timings and the live
                  abcjs cursor all hang off that node, and the render effect only re-runs when the
                  tunes themselves change, so tearing it down would quietly break playback. */}
              <div className={viewMode === "abc" ? "sheet-music-hidden" : ""}>
                <div
                  className="sheet-music"
                  ref={(el) => {
                    sheetRefs.current[index] = el;
                  }}
                />
              </div>
              {viewMode === "abc" && (
                <AbcSourceView
                  abc={engravedAbcRef.current[index] ?? ""}
                  cursor={abcCursor?.index === index ? abcCursor : null}
                  onCopy={() => copyAbc(index)}
                />
              )}
              {noteBadge?.index === index && (
                <span key={noteBadge.id} className="note-badge" style={{ left: noteBadge.x, top: noteBadge.y }}>
                  {noteBadge.text}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  function updateVisualsForTime(seconds: number) {
    if (durationsRef.current.length !== items.length || noteTimingsRef.current.length !== items.length) return;

    const clampedSeconds = Math.min(Math.max(seconds, 0), currentTotalSec);
    const { index: targetIndex, pass, offsetSec } = locate(clampedSeconds);
    // The staff carries the lead-in on every pass even where the audio drops it, so the cursor sits
    // that much further in than the elapsed time alone would say.
    const naturalMs = (skippedSec(targetIndex, pass) + offsetSec) * 1000;
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
      if (i !== targetIndex) clearCursorLine(i);
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
      setAbcCursorFromEvent(targetIndex, bestEvent);

      if (svg) {
        updateCursorPosition(svg, bestEvent.left - 2, bestEvent.top, bestEvent.top + bestEvent.height);
        checkAutoScroll(targetIndex, bestEvent);
      }
    } else {
      clearCursorLine(targetIndex);
      setAbcCursor(null);
    }
  }
}


