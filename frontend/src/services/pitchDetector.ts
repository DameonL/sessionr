/**
 * Microphone pitch detection for the ear trainer (live) and tune identifier
 * (batch record-then-process). Detection is YIN (de Cheveigné & Kawahara's
 * cumulative-mean-normalized difference function) with parabolic
 * interpolation — no dependencies, and adequate for the monophonic
 * instruments this app targets (fiddle, whistle, flute, box). A prior plain
 * ACF2+ autocorrelation version was replaced: on real (harmonically rich)
 * fiddle/whistle recordings it frequently locked onto a strong harmonic
 * instead of the fundamental, in a way that got *worse* at a denser sampling
 * rate — an algorithmic weakness in ACF peak-picking, not a timing issue.
 * YIN's cumulative-mean normalization is specifically designed to resist
 * that failure mode. The algorithm is isolated behind `detectHz` so a
 * library like pitchy (McLeod MPM) is a one-function swap if field accuracy
 * ever disappoints again.
 *
 * `detectHz` is a pure measurement function — it always returns its rms and
 * "clarity" (1 minus the normalized difference at the chosen lag: how
 * confidently periodic/tonal a frame is, not just how loud) and never
 * decides accept/reject itself.
 * That decision belongs to each caller:
 *  - `createPitchListener` (EarTrainer's live call-and-response) applies a
 *    small static gate per frame, since it must decide in real time.
 *  - `createSampleRecorder` (the tune identifier) applies no gate at all —
 *    it captures ~20s of raw audio, which `analyzeClipFrames` then measures
 *    offline at a fixed hop so a batch pass (see tuneMatcher.ts) can decide
 *    signal vs. noise from the whole clip at once. Capturing audio rather
 *    than per-frame results is what lets that pass run at a rate of its own
 *    choosing instead of the display refresh rate, and lets the band-limiting
 *    high-pass be zero-phase.
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
// This is the *live* (EarTrainer) default: it has to hear a fiddle's low G
// (196Hz) and below, and its input is one player close to the mic.
const MIN_HZ = 130
const MAX_HZ = 1500

/** Optional search range for `detectHz`; defaults to the live path's MIN/MAX_HZ. */
export interface PitchRange {
  minHz?: number
  maxHz?: number
}

/**
 * Identify-path band limits. A recording made *at a session* contains guitar,
 * bouzouki and bodhrán as well as the melody, and a monophonic tracker will
 * happily lock onto the loudest low-frequency thing it can find rather than
 * the tune. Measured on real session recordings, 27-35% of total spectral
 * energy sat below 300Hz (a solo whistle recording had 0%), and only 47 of
 * 169 detected notes landed in the melody's range; band-limiting took that to
 * 121 of 121.
 *
 * 220Hz is below every common melody instrument's working bottom (flute and
 * whistle bottom out at D4=294Hz; a fiddle's low G is 196Hz but rarely carries
 * the tune in a session) while excluding accompaniment fundamentals. The
 * high-pass sits at 250Hz deliberately *below* D4 — a 300Hz cutoff measurably
 * cut real melody out of a tune in E dorian.
 */
export const IDENTIFY_MIN_HZ = 220
export const IDENTIFY_HIGHPASS_HZ = 250

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

// YIN's absolute threshold: the first lag whose cumulative-mean-normalized
// difference dips below this is accepted outright (before even comparing to
// the global minimum) — the standard YIN default.
const YIN_THRESHOLD = 0.15

/**
 * YIN (de Cheveigné & Kawahara) pitch detection: a difference function
 * (instead of raw autocorrelation) that is far more resistant to locking
 * onto a strong harmonic than a plain ACF peak search — important for
 * fiddle/whistle/flute/box tone, which carries strong upper harmonics that
 * can otherwise look more "periodic" at half or a third of the true period
 * than the fundamental itself does. Pure measurement — always returns
 * rms/clarity diagnostics and never applies a perceptual accept/reject
 * threshold; callers decide what counts as signal.
 */
export function detectHz(
  buf: Float32Array,
  sampleRate: number,
  range: PitchRange = {},
): PitchFrame {
  const minHz = range.minHz ?? MIN_HZ
  const maxHz = range.maxHz ?? MAX_HZ
  const size = buf.length
  let rms = 0
  for (let i = 0; i < size; i++) {
    rms += buf[i] * buf[i]
  }
  rms = Math.sqrt(rms / size)
  // Numerical-safety floor only (avoids a degenerate all-zero buffer), not
  // a perceptual noise gate — real thresholds live with each caller.
  if (rms < 1e-6) return { rms, clarity: null, hz: null }

  // The difference function needs buf[i] and buf[i + tau] both in range for
  // every tau up to the search window, so only the first half of the buffer
  // is usable as the integration window W.
  const w = size >> 1
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz))
  const tauMax = Math.min(w - 1, Math.ceil(sampleRate / minHz))
  if (tauMax <= tauMin) return { rms, clarity: null, hz: null }

  // Step 1-2: squared difference function, then its cumulative-mean
  // normalization (this is what makes YIN resistant to a harmonic scoring
  // "more periodic" than the fundamental — an ACF peak search has no
  // equivalent normalization).
  const d = new Float32Array(tauMax + 1)
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0
    for (let i = 0; i < w; i++) {
      const diff = buf[i] - buf[i + tau]
      sum += diff * diff
    }
    d[tau] = sum
  }
  const cmnd = new Float32Array(tauMax + 1)
  let runningSum = 0
  for (let tau = tauMin; tau <= tauMax; tau++) {
    runningSum += d[tau]
    cmnd[tau] = runningSum > 0 ? (d[tau] * (tau - tauMin + 1)) / runningSum : 1
  }

  // Step 3-4: absolute threshold — take the first local minimum under the
  // threshold; if none qualifies, fall back to the global minimum (a
  // low-clarity, low-confidence guess rather than "no pitch").
  let tau = -1
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) {
    let best = Infinity
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < best) {
        best = cmnd[t]
        tau = t
      }
    }
  }
  if (tau < 0) return { rms, clarity: null, hz: null }

  // Normalized confidence: 1 minus the (cumulative-mean-normalized)
  // difference at the chosen lag — near 1 for a clean periodic tone, low for
  // broadband noise. Same 0-1 "clarity" semantics the rest of the file
  // (and every caller's threshold) already expects from the prior ACF NACF.
  const clarity = Math.max(0, 1 - cmnd[tau])

  // Step 5: parabolic interpolation around the chosen lag for sub-sample
  // precision.
  let period = tau
  const x1 = cmnd[tau - 1] ?? cmnd[tau]
  const x2 = cmnd[tau]
  const x3 = cmnd[tau + 1] ?? cmnd[tau]
  const a = (x1 + x3 - 2 * x2) / 2
  const b = (x3 - x1) / 2
  if (a) period = tau - b / (2 * a)

  const hz = sampleRate / period
  if (hz < minHz || hz > maxHz) return { rms, clarity, hz: null }
  return { rms, clarity, hz }
}

/**
 * Zero-phase 2nd-order Butterworth high-pass: one forward pass, one backward
 * pass, so the filter's own phase shift cancels and note onsets don't smear in
 * time (which would matter for note grouping). Only possible because the
 * identify path analyses a *finished* buffer offline — a real-time
 * BiquadFilterNode could only do the causal forward half.
 */
export function highPassZeroPhase(input: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const w = Math.tan((Math.PI * cutoffHz) / sampleRate)
  const norm = 1 / (1 + Math.SQRT2 * w + w * w)
  const b0 = norm
  const b1 = -2 * norm
  const b2 = norm
  const a1 = 2 * (w * w - 1) * norm
  const a2 = (1 - Math.SQRT2 * w + w * w) * norm

  const onePass = (src: Float32Array): Float32Array => {
    const out = new Float32Array(src.length)
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    for (let i = 0; i < src.length; i++) {
      const y = b0 * src[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = src[i]
      y2 = y1
      y1 = y
      out[i] = y
    }
    return out
  }

  const forward = onePass(input)
  forward.reverse()
  const backward = onePass(forward)
  backward.reverse()
  return backward
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

/** Opens the mic and runs `onFrame` for every analyzed 4096-sample window until `stop()`. */
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
      // YIN's difference function only integrates over the first half of the
      // buffer (see detectHz), so this needs to be double the old ACF window
      // to keep the same effective integration length at MIN_HZ.
      analyser.fftSize = 4096
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

// Inlined as a Blob URL rather than a separate file so the worklet needs no
// bundler/asset-path configuration to find it.
const PCM_WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) this.port.postMessage(channel.slice())
    return true
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor)
`

/**
 * Opens the mic and hands every block of raw PCM to `onChunk`, until `stop()`.
 * Unlike the live pitch loop this does no analysis — it just accumulates
 * audio, so the identify path can process a finished clip offline at its own
 * fixed rate rather than at the display's refresh rate.
 */
function startMicPcmCapture(onChunk: (chunk: Float32Array, sampleRate: number) => void): {
  start(): Promise<void>
  stop(): void
} {
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let node: AudioWorkletNode | ScriptProcessorNode | null = null
  let sink: GainNode | null = null
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
      // Both node types below only get pulled by the graph if they reach the
      // destination, so route through a muted gain — connecting the mic
      // straight to the speakers would howl.
      sink = ctx.createGain()
      sink.gain.value = 0
      sink.connect(ctx.destination)

      const rate = ctx.sampleRate
      let usedWorklet = false
      if (ctx.audioWorklet) {
        try {
          const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }))
          await ctx.audioWorklet.addModule(url)
          URL.revokeObjectURL(url)
          if (stopped) return
          const worklet = new AudioWorkletNode(ctx, 'pcm-capture')
          worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
            if (!stopped) onChunk(e.data, rate)
          }
          node = worklet
          usedWorklet = true
        } catch {
          // Fall through to ScriptProcessor below.
        }
      }
      if (!usedWorklet) {
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processor.onaudioprocess = (e) => {
          if (!stopped) onChunk(new Float32Array(e.inputBuffer.getChannelData(0)), rate)
        }
        node = processor
      }
      if (!node) return
      source.connect(node)
      node.connect(sink)
    },
    stop() {
      stopped = true
      if (node) {
        node.disconnect()
        if ('port' in node) node.port.onmessage = null
        else node.onaudioprocess = null
      }
      sink?.disconnect()
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close().catch(() => {})
      stream = null
      ctx = null
      node = null
      sink = null
    },
  }
}

export interface SampleRecorder {
  /**
   * Starts the mic; resolves once live. Captures raw PCM until `durationMs`
   * elapses or `stop()` is called. `onProgress` fires as audio arrives, purely
   * to drive a UI countdown/level meter.
   */
  start(onProgress?: (elapsedMs: number, rms: number, durationMs: number) => void): Promise<void>
  isDone(): boolean
  /** The captured audio so far. */
  audio(): { samples: Float32Array; sampleRate: number }
  /**
   * The captured audio analyzed into pitch frames — band-limited for the
   * identify path and measured at a fixed hop (see `analyzeClipFrames`).
   */
  frames(): RawFrame[]
  /** Stops early; audio captured so far is kept. */
  stop(): void
}

// Analysis window for the offline pass. YIN integrates over the first half of
// the buffer (see detectHz), so 4096 gives a 2048-sample integration window.
const ANALYSIS_WINDOW = 4096
/**
 * Fixed analysis hop, in samples (~5.8ms at 44.1kHz).
 *
 * This being fixed — rather than "however often requestAnimationFrame happens
 * to fire" — is load-bearing, not a tidiness preference. The identify path
 * used to run detection once per animation frame (~16.7ms); at that rate a
 * reel's notes span only 6-7 frames, `requiredStableFrames` wants 3-8 of them,
 * and there is no redundancy left to median-filter errors out of. Measured on
 * three real recordings, the same gating and band-limiting fixes ranked the
 * correct tune first 3/3 at this hop and only 1/3 at the animation-frame rate.
 * It was also display-dependent and stopped entirely in a backgrounded tab.
 */
const ANALYSIS_HOP = 256

/**
 * Offline pass over a finished clip: band-limit, then measure pitch at a fixed
 * hop. Separated from capture so it is directly testable, and so the whole
 * clip's audio is available at once (which is what lets the high-pass be
 * zero-phase rather than causal).
 */
export function analyzeClipFrames(
  samples: Float32Array,
  sampleRate: number,
  options: { highPassHz?: number; minHz?: number; maxHz?: number } = {},
): RawFrame[] {
  const {
    highPassHz = IDENTIFY_HIGHPASS_HZ,
    minHz = IDENTIFY_MIN_HZ,
    maxHz = MAX_HZ,
  } = options

  const source = highPassHz > 0 ? highPassZeroPhase(samples, sampleRate, highPassHz) : samples
  const frames: RawFrame[] = []
  for (let start = 0; start + ANALYSIS_WINDOW <= source.length; start += ANALYSIS_HOP) {
    const window = source.subarray(start, start + ANALYSIS_WINDOW)
    const frame = detectHz(window, sampleRate, { minHz, maxHz })
    frames.push({
      // Timestamp the centre of the window, so a note's frames straddle its
      // real onset rather than all trailing it by half a window.
      tMs: ((start + ANALYSIS_WINDOW / 2) / sampleRate) * 1000,
      rms: frame.rms,
      clarity: frame.clarity,
      hz: frame.hz,
    })
  }
  return frames
}

// Discards the first audio outright rather than recording it — hardware
// settling protection only (a stream-init pop/click).
const RECORDER_STARTUP_MUTE_MS = 150

export function createSampleRecorder(durationMs: number): SampleRecorder {
  const chunks: Float32Array[] = []
  let captured = 0
  let sampleRate = 44100
  let done = false
  let capture: ReturnType<typeof startMicPcmCapture> | null = null
  let cachedFrames: RawFrame[] | null = null

  const concat = (): Float32Array => {
    const out = new Float32Array(captured)
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }

  return {
    async start(onProgress) {
      capture = startMicPcmCapture((chunk, rate) => {
        if (done) return
        sampleRate = rate
        const elapsedBefore = (captured / rate) * 1000
        // Drop the settling window, then keep everything until we have the
        // full duration — trimming the tail so the clip is exactly as long as
        // asked for regardless of the audio callback's block size.
        if (elapsedBefore >= RECORDER_STARTUP_MUTE_MS - (chunk.length / rate) * 1000) {
          const remaining = Math.ceil((durationMs / 1000) * rate) - captured
          const take = Math.min(chunk.length, Math.max(0, remaining))
          if (take > 0) {
            chunks.push(take === chunk.length ? chunk : chunk.subarray(0, take))
            captured += take
          }
        }
        const elapsed = (captured / rate) * 1000
        if (elapsed >= durationMs) {
          done = true
          capture?.stop()
        }
        let rms = 0
        for (let i = 0; i < chunk.length; i++) rms += chunk[i] * chunk[i]
        onProgress?.(elapsed, Math.sqrt(rms / Math.max(1, chunk.length)), durationMs)
      })
      await capture.start()
    },

    isDone() {
      return done
    },

    audio() {
      return { samples: concat(), sampleRate }
    },

    frames() {
      if (cachedFrames === null) cachedFrames = analyzeClipFrames(concat(), sampleRate)
      return cachedFrames
    },

    stop() {
      done = true
      capture?.stop()
    },
  }
}
