import type abcjs from 'abcjs'

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
 * - Accents the 1st note volume (+35% * swingRatio) while slightly softening follower notes.
 * - Lengthens the 1st note duration (+35% * swingRatio) and shifts start times of 2nd and 3rd notes.
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

      const isTriplet = minD > 0.005 && maxD / minD <= 1.4

      if (isTriplet) {
        const s3 = s2 + d2
        const totalD = s3 - s0
        const baseD = totalD / 3

        const newD0 = baseD * (1 + 0.35 * swingRatio)
        const newStart1 = s0 + newD0
        const remD = totalD - newD0
        const newD1 = remD / 2
        const newStart2 = newStart1 + newD1

        startMapping.set(s0, { newStart: s0, newEnd: newStart1, volumeMult: 1 + 0.35 * swingRatio })
        startMapping.set(s1, { newStart: newStart1, newEnd: newStart2, volumeMult: Math.max(0.1, 1 - 0.15 * swingRatio) })
        startMapping.set(s2, { newStart: newStart2, newEnd: s3, volumeMult: Math.max(0.1, 1 - 0.15 * swingRatio) })

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
