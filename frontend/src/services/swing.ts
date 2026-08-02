import type abcjs from 'abcjs'

/**
 * Returns true if a meter is duple or quadruple time (e.g. 4/4, 2/4, 2/2, common time),
 * where notes organize into pairs of 8th notes and native duple swing applies.
 * Compound (6/8, 9/8, 12/8) and triple (3/4, 3/2, 9/4) meters return false.
 */
export function isDupleMeter(meter: { num?: number; den?: number } | null | undefined): boolean {
  if (!meter || typeof meter.num !== 'number' || typeof meter.den !== 'number') return true
  if (meter.num === 0 || meter.den === 0) return true
  return (meter.num === 4 || meter.num === 2) && (meter.den === 4 || meter.den === 2)
}

/**
 * Applies custom triplet swing to sequence tracks for non-duple meters (such as 6/8, 9/8, 12/8, 3/4).
 * Identifies 3-note triplet groups (consecutive notes with near-equal step durations) and:
 * - Accents the 1st note volume (+35% * swingRatio) while slightly softening follower notes.
 * - Lengthens the 1st note duration (+35% * swingRatio) and shifts start times of 2nd and 3rd notes.
 */
export function applyCustomTripletSwing(tracks: abcjs.NoteMapTrack[], swingPercent: number): abcjs.NoteMapTrack[] {
  if (swingPercent <= 0) return tracks
  const swingRatio = Math.min(Math.max(swingPercent / 100, 0), 1)

  return tracks.map((track) => {
    if (!track || track.length === 0) return track

    const startTimes = Array.from(new Set(track.map((n) => n.start))).sort((a, b) => a - b)
    if (startTimes.length < 3) return track

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

    if (startMapping.size === 0) return track

    return track.map((note) => {
      const mapping = startMapping.get(note.start)
      if (mapping) {
        const currentVol = typeof note.volume === 'number' ? note.volume : 90
        return {
          ...note,
          start: mapping.newStart,
          end: mapping.newEnd,
          volume: Math.min(127, Math.max(1, Math.round(currentVol * mapping.volumeMult))),
        }
      }
      return note
    })
  })
}
