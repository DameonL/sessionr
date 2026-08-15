/**
 * Microphone pitch detection for the ear trainer (live) and tune identifier
 * (batch record-then-process). Detection is plain ACF2+ autocorrelation with
 * parabolic interpolation — no dependencies, and adequate for the monophonic
 * instruments this app targets (fiddle, whistle, flute, box). The algorithm
 * is isolated behind `detectHz` so a library like pitchy (McLeod MPM) is a
 * one-function swap if field accuracy ever disappoints.
 *
 * `detectHz` is a pure measurement function — it always returns its rms and
 * "clarity" (normalized autocorrelation peak: how confidently periodic/tonal
 * a frame is, not just how loud) and never decides accept/reject itself.
 * That decision belongs to each caller:
 *  - `createPitchListener` (EarTrainer's live call-and-response) applies a
 *    small static gate per frame, since it must decide in real time.
 *  - `createSampleRecorder` (the tune identifier) applies no gate at all —
 *    it just buffers every frame's measurements for ~20s so a batch pass
 *    (see tuneMatcher.ts) can classify signal vs. noise from the whole
 *    clip's statistics, which is far more robust than any per-frame guess.
 *
 * A prior version of the live path tried to *adapt* its gate from a live
 * per-frame noise-floor estimate. That was a bug, not a feature: a note's
 * own attack transient is briefly low-clarity despite being real, often
 * loud, signal, so the adaptive floor got taught by the player's own
 * playing and ratcheted up until it rejected real notes too — sometimes
 * within seconds, even in total silence. Do not reintroduce adaptive
 * gating into the live path; if it needs to be smarter, that intelligence
 * belongs in a batch pass with a full clip's statistics to work from, not
 * a causal running average.
 */

export interface PitchListener {
  /** Starts the mic and detection loop. Rejects if mic access is denied. */
  start(onStableNote: (midi: number, hz: number, cents: number) => void): Promise<void>
  /** Temporarily ignore the mic (e.g. while the app itself plays audio). */
  pause(): void
  resume(): void
  /** Release the mic and audio resources for good. */
  stop(): void
}

// Below fiddle/whistle/flute/box's practical range — a hard physical range
// constraint on the target instruments, not an adaptive/perceptual gate.
const MIN_HZ = 130
const MAX_HZ = 1500

const SILENCE_REARM_MS = 400

// How much consecutive-frame agreement to require before trusting a note,
// scaled by how marginal the candidate's clarity was — shared by the live
// loop (causal: uses the running minimum clarity seen so far) and by
// tuneMatcher.ts's batch note grouping (which can use a better statistic,
// since it has already seen the whole run by the time it decides).
const CLARITY_STABLE_LOW = 0.3
const CLARITY_STABLE_HIGH = 0.75
const STABLE_FRAMES_MIN = 3
const STABLE_FRAMES_MAX = 8

export interface PitchFrame {
  /** Root-mean-square amplitude of the analysis buffer. */
  rms: number
  /** Normalized autocorrelation peak (0-1); null if too quiet/short to analyze. */
  clarity: number | null
  /** Detected frequency in Hz; null if no valid periodic peak was found, or it's outside the instrument range. */
  hz: number | null
}

/**
 * ACF2+ autocorrelation with a clarity (normalized peak) score. Pure
 * measurement — always returns rms/clarity diagnostics and never applies a
 * perceptual accept/reject threshold; callers decide what counts as signal.
 */
export function detectHz(buf: Float32Array, sampleRate: number): PitchFrame {
  let size = buf.length
  let rms = 0
  for (let i = 0; i < size; i++) {
    rms += buf[i] * buf[i]
  }
  rms = Math.sqrt(rms / size)
  // Numerical-safety floor only (avoids a degenerate all-zero buffer), not
  // a perceptual noise gate — real thresholds live with each caller.
  if (rms < 1e-6) return { rms, clarity: null, hz: null }

  // Trim low-amplitude edges so the correlation sees the strong middle.
  const threshold = 0.2
  let r1 = 0
  let r2 = size - 1
  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buf[i]) < threshold) r1 = i
    else break
  }
  for (let i = 1; i < size / 2; i++) {
    if (Math.abs(buf[size - i]) < threshold) r2 = size - i
    else break
  }
  const trimmed = buf.slice(r1, r2)
  size = trimmed.length
  if (size < 2) return { rms, clarity: null, hz: null }

  const c = new Float32Array(size)
  for (let lag = 0; lag < size; lag++) {
    let sum = 0
    for (let i = 0; i < size - lag; i++) {
      sum += trimmed[i] * trimmed[i + lag]
    }
    c[lag] = sum
  }

  let d = 0
  while (d < size - 1 && c[d] > c[d + 1]) d++
  let maxVal = -1
  let maxPos = -1
  for (let i = d; i < size; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i]
      maxPos = i
    }
  }
  if (maxPos <= 0) return { rms, clarity: null, hz: null }

  // Normalized autocorrelation peak relative to zero-lag energy: near 1 for a
  // clean periodic tone, low for broadband noise, ambiguous-middle for two
  // simultaneous unrelated pitches. The standard NACF clarity used by
  // YIN/MPM-family pitch trackers.
  const clarity = c[0] > 0 ? maxVal / c[0] : 0

  // Parabolic interpolation around the peak for sub-sample precision.
  let period = maxPos
  const x1 = c[maxPos - 1]
  const x2 = c[maxPos]
  const x3 = c[maxPos + 1] ?? x2
  const a = (x1 + x3 - 2 * x2) / 2
  const b = (x3 - x1) / 2
  if (a) period = maxPos - b / (2 * a)

  const hz = sampleRate / period
  if (hz < MIN_HZ || hz > MAX_HZ) return { rms, clarity, hz: null }
  return { rms, clarity, hz }
}

export function hzToMidi(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440))
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToNoteName(midi: number): string {
  const noteIdx = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[noteIdx]}${octave}`
}

/** Frames required for STABLE_FRAMES_MIN..STABLE_FRAMES_MAX, scaled by clarity. */
export function requiredStableFrames(clarity: number): number {
  if (clarity >= CLARITY_STABLE_HIGH) return STABLE_FRAMES_MIN
  if (clarity <= CLARITY_STABLE_LOW) return STABLE_FRAMES_MAX
  const t = (clarity - CLARITY_STABLE_LOW) / (CLARITY_STABLE_HIGH - CLARITY_STABLE_LOW)
  return Math.round(STABLE_FRAMES_MAX - t * (STABLE_FRAMES_MAX - STABLE_FRAMES_MIN))
}

/** Opens the mic and runs `onFrame` for every analyzed 2048-sample window until `stop()`. */
function startMicFrameLoop(onFrame: (frame: PitchFrame) => void): {
  start(): Promise<void>
  stop(): void
} {
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let analyser: AnalyserNode | null = null
  let rafId = 0
  let stopped = false

  return {
    async start() {
      // Disable browser voice processing — it mangles instrument harmonics.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)

      const tick = () => {
        if (stopped) return
        rafId = requestAnimationFrame(tick)
        if (!analyser || !ctx) return
        analyser.getFloatTimeDomainData(buf)
        onFrame(detectHz(buf, ctx.sampleRate))
      }
      tick()
    },
    stop() {
      stopped = true
      cancelAnimationFrame(rafId)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close().catch(() => {})
      stream = null
      ctx = null
      analyser = null
    },
  }
}

// Static live gate for EarTrainer's real-time path — same rms value the
// pre-hardening baseline used (never implicated in the noise-floor bug),
// with clarity loosened from an earlier, unvalidated 0.45: a note's attack
// is briefly low-clarity even when clean, and EarTrainer's downstream check
// (pitch-class equality against one known target) tolerates an occasional
// stray frame far better than it tolerates missing the note entirely.
// Not adaptive — deliberately, so it can't reproduce the old feedback loop.
const LIVE_RMS_GATE = 0.01
const LIVE_CLARITY_GATE = 0.3
// Brief mute after start() to let audio hardware settle (avoids a stream-init
// pop/click reading as a spurious frame) — unrelated to noise-floor gating.
const STARTUP_MUTE_MS = 300

function passesLiveGate(frame: PitchFrame): boolean {
  return frame.hz !== null && frame.rms >= LIVE_RMS_GATE && (frame.clarity ?? 0) >= LIVE_CLARITY_GATE
}

export function createPitchListener(): PitchListener {
  let paused = false
  let startedAt = 0

  let candidateMidi: number | null = null
  let candidateFrames = 0
  let candidateMinClarity = Infinity
  let firedMidi: number | null = null
  let lastSoundAt = 0

  let onStableNoteRef: ((midi: number, hz: number, cents: number) => void) | null = null

  const loop = startMicFrameLoop((frame) => {
    if (paused) return
    const now = performance.now()
    if (now - startedAt < STARTUP_MUTE_MS) return

    const accepted = passesLiveGate(frame)
    if (!accepted || frame.hz === null) {
      candidateMidi = null
      candidateFrames = 0
      candidateMinClarity = Infinity
      // Silence long enough re-arms the same note as a fresh answer.
      if (firedMidi !== null && now - lastSoundAt > SILENCE_REARM_MS) {
        firedMidi = null
      }
      return
    }

    lastSoundAt = now
    const midi = hzToMidi(frame.hz)
    const clarity = frame.clarity ?? 0
    if (midi === candidateMidi) {
      candidateFrames++
      candidateMinClarity = Math.min(candidateMinClarity, clarity)
    } else {
      candidateMidi = midi
      candidateFrames = 1
      candidateMinClarity = clarity
    }
    const needed = requiredStableFrames(candidateMinClarity)
    if (candidateFrames >= needed && midi !== firedMidi) {
      firedMidi = midi
      const exactMidi = 69 + 12 * Math.log2(frame.hz / 440)
      const centsDeviation = Math.round((exactMidi - midi) * 100)
      onStableNoteRef?.(midi, frame.hz, centsDeviation)
    }
  })

  return {
    async start(onStableNote) {
      onStableNoteRef = onStableNote
      startedAt = performance.now()
      await loop.start()
    },

    pause() {
      paused = true
      candidateMidi = null
      candidateFrames = 0
      candidateMinClarity = Infinity
      // firedMidi is kept: a note still sounding when we resume must not
      // re-fire as a new answer. A silence gap re-arms it naturally.
    },

    resume() {
      paused = false
    },

    stop() {
      loop.stop()
      onStableNoteRef = null
    },
  }
}

export interface RawFrame {
  /** Milliseconds since recording started. */
  tMs: number
  rms: number
  clarity: number | null
  hz: number | null
}

export interface SampleRecorder {
  /**
   * Starts the mic; resolves once live. Records every analyzed frame
   * (no accept/reject decision — that's a batch step, see tuneMatcher.ts)
   * until `durationMs` elapses or `stop()` is called. `onProgress` fires
   * every frame purely to drive a UI countdown/level meter.
   */
  start(onProgress?: (elapsedMs: number, rms: number, durationMs: number) => void): Promise<void>
  isDone(): boolean
  /** Raw frames captured so far — safe to read before recording finishes. */
  frames(): RawFrame[]
  /** Stops early; frames captured so far are kept. */
  stop(): void
}

// Discards the first frames outright rather than recording them — hardware
// settling protection only (a stream-init pop/click), not noise-floor
// seeding, since there's no adaptive floor here to seed.
const RECORDER_STARTUP_MUTE_MS = 150

export function createSampleRecorder(durationMs: number): SampleRecorder {
  const raw: RawFrame[] = []
  let startedAt = 0
  let done = false
  let loop: ReturnType<typeof startMicFrameLoop> | null = null

  return {
    async start(onProgress) {
      startedAt = performance.now()
      loop = startMicFrameLoop((frame) => {
        if (done) return
        const elapsed = performance.now() - startedAt
        if (elapsed >= durationMs) {
          done = true
          loop?.stop()
          return
        }
        if (elapsed >= RECORDER_STARTUP_MUTE_MS) {
          raw.push({ tMs: elapsed, rms: frame.rms, clarity: frame.clarity, hz: frame.hz })
        }
        onProgress?.(elapsed, frame.rms, durationMs)
      })
      await loop.start()
    },

    isDone() {
      return done
    },

    frames() {
      return [...raw]
    },

    stop() {
      done = true
      loop?.stop()
    },
  }
}
