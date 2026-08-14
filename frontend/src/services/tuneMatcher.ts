import { createPitchListener, type PitchListener } from './pitchDetector'

/**
 * Turns pitchDetector.ts's single-note callback into a rolling capture buffer
 * for an arbitrary-length played snippet, for tune identification. Unlike
 * EarTrainer (which compares each stable note against one target), this just
 * appends every stable note it hears, in order, until the caller stops it.
 */
export interface SnippetCapture {
  /** Starts the mic and capture loop. Rejects if mic access is denied. */
  start(onNote?: (midi: number, count: number) => void): Promise<void>
  /** Ordered MIDI notes captured so far. */
  notes(): number[]
  /** Clears the captured buffer without restarting the mic. */
  reset(): void
  /** Releases the mic and audio resources for good. */
  stop(): void
}

const MAX_NOTES = 200

export function createSnippetCapture(maxNotes = MAX_NOTES): SnippetCapture {
  const listener: PitchListener = createPitchListener()
  const buffer: number[] = []

  return {
    async start(onNote) {
      await listener.start((midi) => {
        if (buffer.length >= maxNotes) return
        buffer.push(midi)
        onNote?.(midi, buffer.length)
      })
    },

    notes() {
      return [...buffer]
    },

    reset() {
      buffer.length = 0
    },

    stop() {
      listener.stop()
    },
  }
}
