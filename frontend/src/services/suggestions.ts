import type { RepertoireItem } from './api'

export interface SuggestionReasonPiece {
  text: string
  tooltip: string
}

export interface SuggestionCandidate {
  userTuneId: string
  title: string
  tuneType: string
  key: string
  status: string
}

export interface NextTuneSuggestion {
  userTuneId: string
  title: string
  tuneType: string
  key: string
  status: string
  score: number
  reason: string
}

export function parseSuggestionReason(reason: string): SuggestionReasonPiece[] {
  if (!reason) return []

  const segments = reason.split(/\s*·\s*/)
  const pieces: SuggestionReasonPiece[] = []

  for (const segment of segments) {
    if (segment.includes(',')) {
      const subSegments = segment.split(/\s*,\s*/)
      for (const sub of subSegments) {
        pieces.push({
          text: sub.trim(),
          tooltip: getTooltipForPiece(sub.trim()),
        })
      }
    } else {
      pieces.push({
        text: segment.trim(),
        tooltip: getTooltipForPiece(segment.trim()),
      })
    }
  }

  return pieces
}

function getTooltipForPiece(piece: string): string {
  const p = piece.toLowerCase()
  if (p.includes('keeps the') && p.includes('going')) {
    const type = p.replace('keeps the ', '').replace('s going', '').replace(' going', '')
    return `Rhythm consistency: Playing the same type of tune (${type}s) keeps the tempo and groove steady for dancers.`
  }
  if (p.includes('stays in')) {
    return `Same key: Staying in the same key signature makes a direct transition with no pitch changes needed.`
  }
  if (p.includes('relative key')) {
    return `Relative key: Relative keys share the same key signature (like G major and E minor) but resolve to a different home note, creating a smooth mood shift.`
  }
  if (p.includes('classic lift')) {
    return `Classic lift: A key shift (up a perfect fifth) that raises the musical energy, making the transition feel bright and driven.`
  }
  if (p.includes('one sharp brighter')) {
    return `One sharp brighter: Moving up a perfect fifth (clockwise on the Circle of Fifths), adding a sharp to the key signature to brighten the tone.`
  }
  if (p.includes('eases down')) {
    return `Easing down: Shifting down a perfect fifth (counter-clockwise on the Circle of Fifths), removing a sharp to reduce tension.`
  }
  if (p.includes('manageable key shift')) {
    return `Circle shift: Moving two steps on the Circle of Fifths is a common, noticeable shift that clearly changes the tonal center.`
  }
  if (p.includes('bold key jump')) {
    return `Bold shift: Moving to a distant key signature creates a dramatic, surprising transition that commands attention.`
  }
  if (p.includes('lands on the same note')) {
    return `Seamless join: The next tune starts on the same note the previous one ended on, so the seam between them disappears.`
  }
  if (p.includes('fourth or fifth')) {
    return `Strong lead-in: The previous tune's last note is a fourth or fifth away from the next tune's first note — a natural, resolving leap.`
  }
  if (p.includes('steps straight in')) {
    return `Stepwise join: The next tune begins a step away from where the last one ended, so the melody flows straight in.`
  }
  if (p.includes('gig-ready') || p.includes('active')) {
    return `Active tune: A tune you know well and can play confidently at full speed.`
  }
  if (p.includes('rust')) {
    return `Rusty tune: A tune in your active library that hasn't been practiced for a while and would benefit from a run-through.`
  }
  if (p.includes('learning')) {
    return `Learning tune: A tune you are currently active in learning, great to practice slowly.`
  }
  if (p.includes('solid opener')) {
    return `Solid opener: A well-practiced tune in your active repertoire, ideal for starting off a medley.`
  }
  if (p.includes('opener candidate')) {
    return `Opener candidate: A tune from your repertoire that can be used to open a practice set.`
  }
  return 'Set recommendation: Suggested transition based on traditional rhythm and key compatibility.'
}

function parseKeySignature(key: string): number | null {
  if (!key || !key.trim()) return null
  key = key.trim()

  const tonicChar = key[0].toUpperCase()
  const tonicIndex = 'C D EF G A B'.indexOf(tonicChar)
  if (tonicIndex < 0) return null

  let tonic = tonicIndex
  let rest = key.slice(1)
  if (rest.startsWith('#')) {
    tonic++
    rest = rest.slice(1)
  } else if (rest.startsWith('b')) {
    tonic--
    rest = rest.slice(1)
  }

  let modeOffset = 0
  const lowerRest = rest.toLowerCase()
  if (lowerRest === '' || lowerRest === 'maj' || lowerRest === 'major' || lowerRest === 'ion') {
    modeOffset = 0
  } else if (
    lowerRest === 'm' ||
    lowerRest === 'min' ||
    lowerRest === 'minor' ||
    lowerRest === 'aeo' ||
    lowerRest === 'aeolian'
  ) {
    modeOffset = 3
  } else if (lowerRest === 'dor' || lowerRest === 'dorian') {
    modeOffset = 10
  } else if (lowerRest === 'mix' || lowerRest === 'mixolydian') {
    modeOffset = 5
  } else if (lowerRest === 'phr' || lowerRest === 'phrygian') {
    modeOffset = 8
  } else if (lowerRest === 'lyd' || lowerRest === 'lydian') {
    modeOffset = 7
  } else if (lowerRest === 'loc' || lowerRest === 'locrian') {
    modeOffset = 1
  }

  return (((tonic + modeOffset) % 12) + 12) % 12
}

export function scoreNextTune(
  lastType: string,
  lastKey: string,
  candidateType: string,
  candidateKey: string,
  status: string,
  lastEndingMidi?: number | null,
  candidateStartingMidi?: number | null
): { score: number; reason: string } {
  let score = 0
  const reasons: string[] = []

  if (candidateType === lastType) {
    score += 50
    reasons.push(`keeps the ${candidateType.toLowerCase()}s going`)
  }

  const from = parseKeySignature(lastKey)
  const to = parseKeySignature(candidateKey)
  if (from !== null && to !== null) {
    const steps = ((to - from) * 7) % 12
    const fifths = steps > 6 ? steps - 12 : steps < -6 ? steps + 12 : steps

    let keyScore = 0
    let keyReason = ''
    if (fifths === 0 && lastKey === candidateKey) {
      keyScore = 25
      keyReason = `stays in ${candidateKey}`
    } else if (fifths === 0) {
      keyScore = 30
      keyReason = 'relative key — seamless change'
    } else if (fifths === 1) {
      keyScore = 30
      keyReason = 'classic lift, one sharp brighter'
    } else if (fifths === -1) {
      keyScore = 22
      keyReason = 'eases down a fifth'
    } else if (fifths === 2 || fifths === -2) {
      keyScore = 8
      keyReason = 'manageable key shift'
    } else {
      keyScore = 0
      keyReason = 'bold key jump'
    }

    score += keyScore
    reasons.push(keyReason)
  }

  // Melodic join: how the last tune's final note leads into the next tune's
  // first note. Mirrors SetAnalyzer.ScoreNextTune on the backend.
  if (
    lastEndingMidi !== undefined &&
    lastEndingMidi !== null &&
    candidateStartingMidi !== undefined &&
    candidateStartingMidi !== null
  ) {
    const interval = (((candidateStartingMidi - lastEndingMidi) % 12) + 12) % 12
    let joinScore = 0
    let joinReason: string | null = null
    if (interval === 0) {
      joinScore = 12
      joinReason = 'lands on the same note'
    } else if (interval === 5 || interval === 7) {
      joinScore = 8
      joinReason = 'note leads by a fourth or fifth'
    } else if (interval === 1 || interval === 2 || interval === 10 || interval === 11) {
      joinScore = 6
      joinReason = 'steps straight in'
    }
    score += joinScore
    if (joinReason) {
      reasons.push(joinReason)
    }
  }

  let statusScore = 0
  let statusReason: string | null = null
  const cleanStatus = status.toLowerCase()
  if (cleanStatus === 'active') {
    statusScore = 15
    statusReason = 'gig-ready'
  } else if (cleanStatus === 'rusty') {
    statusScore = 8
    statusReason = 'chance to shake off rust'
  } else if (cleanStatus === 'learning') {
    statusScore = 4
    statusReason = 'still learning it'
  }

  score += statusScore
  if (statusReason) {
    reasons.push(statusReason)
  }

  return { score, reason: reasons.join(' · ') }
}

export function suggestNextPracticeTunes(
  draftIds: string[],
  candidates: SuggestionCandidate[],
  repertoire: RepertoireItem[]
): NextTuneSuggestion[] {
  const filteredCandidates = candidates.filter((c) => !draftIds.includes(c.userTuneId))

  if (draftIds.length === 0) {
    return filteredCandidates
      .map((c) => ({
        userTuneId: c.userTuneId,
        title: c.title,
        tuneType: c.tuneType,
        key: c.key,
        status: c.status,
        score: c.status.toLowerCase() === 'active' ? 15 : 0,
        reason:
          c.status.toLowerCase() === 'active' ? 'solid opener — gig-ready' : 'opener candidate',
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        return a.title.localeCompare(b.title)
      })
  }

  const lastId = draftIds[draftIds.length - 1]
  const last = repertoire.find((r) => r.userTuneId === lastId)
  if (!last) return []

  return filteredCandidates
    .map((c) => {
      // The melodic join needs each tune's first/last note, which live on the
      // repertoire item (candidates may come from the leaner practice queue).
      const candidateStartingMidi = repertoire.find(
        (r) => r.userTuneId === c.userTuneId
      )?.startingMidi
      const { score, reason } = scoreNextTune(
        last.tuneType,
        last.key,
        c.tuneType,
        c.key,
        c.status,
        last.endingMidi,
        candidateStartingMidi
      )
      return {
        userTuneId: c.userTuneId,
        title: c.title,
        tuneType: c.tuneType,
        key: c.key,
        status: c.status,
        score,
        reason,
      }
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      return a.title.localeCompare(b.title)
    })
}
