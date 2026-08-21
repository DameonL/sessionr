import type abcjs from 'abcjs'

/** Also defined in components/instruments.ts, which re-strikes long notes at the same value. */
const EIGHTH_NOTE_DURATION = 0.125

/**
 * How much longer the first of each three gets at full swing, as a fraction of the even
 * duration. At 0.5 it takes exactly half the beat and the two that follow split the rest —
 * a 2:1 ratio, classic triplet swing.
 *
 * Hard ceiling of 0.75, and not by taste: at that point the lengthened note reaches 1.75
 * eighths, which is exactly the re-strike threshold in subdivideLongNotes (EIGHTH_NOTE_DURATION
 * and SPLIT_TOLERANCE in components/instruments.ts). Past it, every lilted note on a plucked
 * instrument splits in two and double-strikes. Raising this beyond 0.75 means raising that
 * threshold to match.
 */
const MAX_LENGTHEN = 0.5

/** Volume boost on the first of each three at full swing. */
const MAX_ACCENT = 0.5

/** Volume reduction on the two that follow, at full swing. */
const MAX_SOFTEN = 0.2

/**
 * Returns true for compound meters (6/8, 9/8, 12/8), where the beat divides into three
 * and the lilt lengthens the first of each group of three — the jig/slip jig/slide feel.
 *
 * Everything else (4/4, 2/4, 2/2, 3/4) belongs to abcjs's own swing, which is correct for
 * den === 4 but halves its beat length when den === 8, swinging 16ths rather than the
 * first-of-three quavers. Missing or malformed meters report false, so they fall back to
 * that native path.
 */
export function isCompoundMeter(meter: { num?: number; den?: number } | null | undefined): boolean {
  if (!meter || typeof meter.num !== 'number' || typeof meter.den !== 'number') return false
  if (meter.num === 0 || meter.den === 0) return false
  return meter.den === 8 && meter.num % 3 === 0
}

/**
 * Applies triplet swing to compound-meter sequence tracks.
 * Identifies 3-note triplet groups (consecutive notes with near-equal step durations) and:
 * - Lengthens the 1st note by MAX_LENGTHEN * swingRatio, shifting the 2nd and 3rd later so the
 *   group still ends where it did — at full swing a 2:1 ratio against each follower.
 * - Accents the 1st note by MAX_ACCENT * swingRatio and softens the followers by MAX_SOFTEN,
 *   since the lilt reads as much through emphasis as through duration.
 *
 * Mutates the tracks in place and returns nothing: abcjs's sequenceCallback discards whatever
 * the callback returns and goes on using its own noteMapTracks (see create-synth.js, "prime"),
 * so a version of this that built new arrays — as this once did — was a silent no-op.
 * Same contract as humanizeBackerTracks in services/band.ts.
 */
export function applyCustomTripletSwing(tracks: abcjs.NoteMapTrack[], swingPercent: number): void {
  if (swingPercent <= 0) return
  const swingRatio = Math.min(Math.max(swingPercent / 100, 0), 1)

  for (const track of tracks) {
    if (!track || track.length === 0) continue

    const startTimes = Array.from(new Set(track.map((n) => n.start))).sort((a, b) => a - b)
    if (startTimes.length < 3) continue

    const startMapping = new Map<number, { newStart: number; newEnd: number; volumeMult: number }>()

    let i = 0
    while (i < startTimes.length - 2) {
      const s0 = startTimes[i]
      const s1 = startTimes[i + 1]
      const s2 = startTimes[i + 2]
      const d0 = s1 - s0
      const d1 = s2 - s1
      const d2 = i + 3 < startTimes.length ? startTimes[i + 3] - s2 : d1

      const minD = Math.min(d0, d1, d2)
      const maxD = Math.max(d0, d1, d2)
      const meanD = (d0 + d1 + d2) / 3

      // Only lilt groups that move in eighths — the melody's three-per-beat. The chord and
      // bass tracks step in dotted quarters, and three of those also look "near-equal" to the
      // ratio test; re-timing them drags the accompaniment off the melody's grid. abcjs's own
      // swing has the same property, moving only notes that sit off the beat.
      const isTriplet =
        minD > 0.005 &&
        maxD / minD <= 1.4 &&
        Math.abs(meanD - EIGHTH_NOTE_DURATION) < EIGHTH_NOTE_DURATION * 0.4

      if (isTriplet) {
        const s3 = s2 + d2
        const totalD = s3 - s0
        // totalD is exactly d0 + d1 + d2, so this is the mean step tested above.
        const baseD = meanD

        const newD0 = baseD * (1 + MAX_LENGTHEN * swingRatio)
        const newStart1 = s0 + newD0
        const remD = totalD - newD0
        const newD1 = remD / 2
        const newStart2 = newStart1 + newD1

        const accent = 1 + MAX_ACCENT * swingRatio
        const soften = Math.max(0.1, 1 - MAX_SOFTEN * swingRatio)

        startMapping.set(s0, { newStart: s0, newEnd: newStart1, volumeMult: accent })
        startMapping.set(s1, { newStart: newStart1, newEnd: newStart2, volumeMult: soften })
        startMapping.set(s2, { newStart: newStart2, newEnd: s3, volumeMult: soften })

        i += 3
      } else {
        i += 1
      }
    }

    if (startMapping.size === 0) continue

    for (const note of track) {
      // Read the key out before writing: the lookup is keyed on the *original* start.
      const mapping = startMapping.get(note.start)
      if (!mapping) continue
      const currentVol = typeof note.volume === 'number' ? note.volume : 90
      note.start = mapping.newStart
      note.end = mapping.newEnd
      note.volume = Math.min(127, Math.max(1, Math.round(currentVol * mapping.volumeMult)))
    }
  }
}
