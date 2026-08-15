/**
 * Microphone pitch listener for the ear trainer and tune identifier.
 *
 * Detection is plain ACF2+ autocorrelation with parabolic interpolation —
 * no dependencies, and adequate for the monophonic instruments this app
 * targets (fiddle, whistle, flute, box). The algorithm is isolated behind
 * `detectHz` so a library like pitchy (McLeod MPM) is a one-function swap
 * if field accuracy ever disappoints.
 *
 * Sessions are loud and busy — other instruments, chatter, glasses — so every
 * frame also carries a "clarity" score (how confidently periodic/tonal it is,
 * not just how loud). A wrong note actively corrupts downstream tune matching
 * (it lands as a specific mismatch), while a missed note is comparatively
 * harmless (the matcher tolerates gaps), so ambiguous frames are rejected
 * rather than guessed: clarity gates detection, scales how much consecutive
 * agreement is required before a note fires, and (via `onQuality`) lets the
 * UI tell the player when the room is too noisy to hear clearly.
 *
 * A detection only fires after several consecutive animation frames agree on
 * the same midi note (rejects transients, bow noise, and octave flicker),
 * and re-fires only after the note changes or a short silence.
 */

export interface QualityFrame {
  /** Whether this frame produced an accepted pitch detection. */
  accepted: boolean
  /** Normalized autocorrelation peak (0-1); null if the frame was too quiet to analyze. */
  clarity: number | null
  /** Root-mean-square amplitude of the analysis buffer. */
  rms: number
}

export interface PitchListener {
  /**
   * Starts the mic and detection loop. Rejects if mic access is denied.
   * `onQuality`, if given, fires every analyzed frame (not just accepted
   * notes) so a caller can show "too noisy" feedback during a loud session.
   */
  start(
    onStableNote: (midi: number, hz: number, cents: number) => void,
    onQuality?: (q: QualityFrame) => void,
  ): Promise<void>
  /** Temporarily ignore the mic (e.g. while the app itself plays audio). */
  pause(): void
  resume(): void
  /** Release the mic and audio resources for good. */
  stop(): void
}

// A quiet room's floor; the active gate adapts upward from here in a loud one.
const RMS_GATE_FLOOR = 0.01
// Active RMS gate = tracked ambient noise floor * this margin.
const NOISE_FLOOR_MARGIN = 2.75
// How fast the ambient noise floor EMA adapts (frames that fail the clarity
// gate are "room noise", and slowly pull the floor toward the room's level).
const NOISE_FLOOR_EMA_RATE = 0.02
// Don't fire notes for a brief window after start() so the floor can seed
// from real ambient audio instead of the constant default.
const STARTUP_MUTE_MS = 300

// Below fiddle/whistle/flute/box's practical range — free rejection of room
// rumble/PA bleed without a dedicated filter stage.
const MIN_HZ = 130
const MAX_HZ = 1500

// Minimum normalized-autocorrelation peak to trust a frame as periodic/tonal
// at all, rather than broadband noise (chatter, glasses) or two instruments'
// pitches smearing the correlation peak into an ambiguous middle band.
const CLARITY_GATE = 0.45
// Below this, a candidate needs the full STABLE_FRAMES_MAX consecutive
// agreeing frames; at/above this it only needs STABLE_FRAMES_MIN.
const CLARITY_STABLE_LOW = 0.45
const CLARITY_STABLE_HIGH = 0.75
const STABLE_FRAMES_MIN = 3
const STABLE_FRAMES_MAX = 8

const SILENCE_REARM_MS = 400

export interface PitchFrame {
  /** Root-mean-square amplitude of the analysis buffer. */
  rms: number
  /** Normalized autocorrelation peak (0-1); null if too quiet/short to analyze. */
  clarity: number | null
  /** Detected frequency in Hz; null unless the rms, clarity, and range gates all pass. */
  hz: number | null
}

/**
 * ACF2+ autocorrelation with a clarity (normalized peak) score. Always
 * returns rms/clarity diagnostics even when `hz` fails to clear a gate, so
 * the caller can track the ambient noise floor and report signal quality.
 */
export function detectHz(buf: Float32Array, sampleRate: number, rmsGate = RMS_GATE_FLOOR): PitchFrame {
  let size = buf.length
  let rms = 0
  for (let i = 0; i < size; i++) {
    rms += buf[i] * buf[i]
  }
  rms = Math.sqrt(rms / size)
  if (rms < rmsGate) return { rms, clarity: null, hz: null }

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
  if (clarity < CLARITY_GATE) return { rms, clarity, hz: null }

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
function requiredStableFrames(minClarity: number): number {
  if (minClarity >= CLARITY_STABLE_HIGH) return STABLE_FRAMES_MIN
  if (minClarity <= CLARITY_STABLE_LOW) return STABLE_FRAMES_MAX
  const t = (minClarity - CLARITY_STABLE_LOW) / (CLARITY_STABLE_HIGH - CLARITY_STABLE_LOW)
  return Math.round(STABLE_FRAMES_MAX - t * (STABLE_FRAMES_MAX - STABLE_FRAMES_MIN))
}

export function createPitchListener(): PitchListener {
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let analyser: AnalyserNode | null = null
  let rafId = 0
  let paused = false
  let stopped = false
  let startedAt = 0

  let candidateMidi: number | null = null
  let candidateFrames = 0
  let candidateMinClarity = Infinity
  let firedMidi: number | null = null
  let lastSoundAt = 0
  let noiseFloor = RMS_GATE_FLOOR

  return {
    async start(onStableNote, onQuality) {
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
      startedAt = performance.now()

      const tick = () => {
        if (stopped) return
        rafId = requestAnimationFrame(tick)
        if (paused || !analyser || !ctx) return

        analyser.getFloatTimeDomainData(buf)
        const activeGate = Math.max(RMS_GATE_FLOOR, noiseFloor * NOISE_FLOOR_MARGIN)
        const frame = detectHz(buf, ctx.sampleRate, activeGate)
        const now = performance.now()
        const withinStartupMute = now - startedAt < STARTUP_MUTE_MS

        // Track the ambient floor from frames that don't look tonal, so a
        // loud room's gate adapts up and a quiet one's stays low. Frames
        // during startup mute still seed it — that's the point.
        if (frame.clarity === null || frame.clarity < CLARITY_GATE) {
          noiseFloor = noiseFloor * (1 - NOISE_FLOOR_EMA_RATE) + frame.rms * NOISE_FLOOR_EMA_RATE
        }

        const accepted = !withinStartupMute && frame.hz !== null
        onQuality?.({ accepted, clarity: frame.clarity, rms: frame.rms })

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
          onStableNote(midi, frame.hz, centsDeviation)
        }
      }
      tick()
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
