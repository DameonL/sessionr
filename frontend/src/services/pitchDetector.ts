/**
 * Microphone pitch listener for the ear trainer.
 *
 * Detection is plain ACF2+ autocorrelation with parabolic interpolation —
 * no dependencies, and adequate for the monophonic instruments this app
 * targets (fiddle, whistle, flute, box). The algorithm is isolated behind
 * `detectHz` so a library like pitchy (McLeod MPM) is a one-function swap
 * if field accuracy ever disappoints.
 *
 * A detection only fires after several consecutive animation frames agree on
 * the same midi note (rejects transients, bow noise, and octave flicker),
 * and re-fires only after the note changes or a short silence.
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

const RMS_GATE = 0.01
const MIN_HZ = 60
const MAX_HZ = 1500
const STABLE_FRAMES = 5
const SILENCE_REARM_MS = 400

/** ACF2+ autocorrelation; returns the detected frequency or null. */
export function detectHz(buf: Float32Array, sampleRate: number): number | null {
  let size = buf.length
  let rms = 0
  for (let i = 0; i < size; i++) {
    rms += buf[i] * buf[i]
  }
  rms = Math.sqrt(rms / size)
  if (rms < RMS_GATE) return null

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
  if (size < 2) return null

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
  if (maxPos <= 0) return null

  // Parabolic interpolation around the peak for sub-sample precision.
  let period = maxPos
  const x1 = c[maxPos - 1]
  const x2 = c[maxPos]
  const x3 = c[maxPos + 1] ?? x2
  const a = (x1 + x3 - 2 * x2) / 2
  const b = (x3 - x1) / 2
  if (a) period = maxPos - b / (2 * a)

  const hz = sampleRate / period
  if (hz < MIN_HZ || hz > MAX_HZ) return null
  return hz
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

export function createPitchListener(): PitchListener {
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let analyser: AnalyserNode | null = null
  let rafId = 0
  let paused = false
  let stopped = false

  let candidateMidi: number | null = null
  let candidateFrames = 0
  let firedMidi: number | null = null
  let lastSoundAt = 0

  return {
    async start(onStableNote) {
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
        if (paused || !analyser || !ctx) return

        analyser.getFloatTimeDomainData(buf)
        const hz = detectHz(buf, ctx.sampleRate)
        const now = performance.now()

        if (hz === null) {
          candidateMidi = null
          candidateFrames = 0
          // Silence long enough re-arms the same note as a fresh answer.
          if (firedMidi !== null && now - lastSoundAt > SILENCE_REARM_MS) {
            firedMidi = null
          }
          return
        }

        lastSoundAt = now
        const midi = hzToMidi(hz)
        if (midi === candidateMidi) {
          candidateFrames++
        } else {
          candidateMidi = midi
          candidateFrames = 1
        }
        if (candidateFrames >= STABLE_FRAMES && midi !== firedMidi) {
          firedMidi = midi
          const exactMidi = 69 + 12 * Math.log2(hz / 440)
          const centsDeviation = Math.round((exactMidi - midi) * 100)
          onStableNote(midi, hz, centsDeviation)
        }
      }
      tick()
    },

    pause() {
      paused = true
      candidateMidi = null
      candidateFrames = 0
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
