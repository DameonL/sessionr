import {
  MASTERY_ACCURACY,
  MIN_SAMPLES,
  type IntervalHistory,
  type SizeStat,
} from './intervalTraining'

/**
 * The interval trainer's record over time. The lifetime tally in ./intervalTraining
 * (IntervalHistory) says where a player stands; this says how they got there, which is what makes
 * "the 3rd is coming, the 6th hasn't budged" answerable.
 *
 * Everything here is per size. An overall accuracy figure averages away the only detail a player
 * can act on — which interval to drill next — so it exists only as context for the per-size view.
 */

const LOG_KEY = 'sessionapp.interval-log'
/**
 * Rounds kept before the oldest is dropped. A ten-question round is a few hundred bytes, so this
 * is well inside any quota while holding months of practice.
 */
export const MAX_ROUNDS = 500

/**
 * Answers per plotted point. A size comes up once or twice in a round, so bucketing by round would
 * plot nothing but 0% and 100%; bucketing by the size's own answers is what makes a trend visible.
 */
export const BUCKET_ANSWERS = 8
/** Answers before a bucket is worth plotting at all, rather than reading as a coin toss. */
export const MIN_BUCKET_ANSWERS = 3
/** Accuracy movement between a size's first and last bucket that counts as a real change. */
const MOVEMENT = 0.1
/** Standing below which a size reads as weak rather than merely unfinished. */
const WEAK_ACCURACY = 0.4

export interface LoggedAnswer {
  size: number
  correct: boolean
}

export interface RoundLogEntry {
  /** Epoch ms when the round finished. */
  at: number
  key: string
  mode: string
  answerMode: 'play' | 'name'
  /** One per question, in the order asked. */
  answers: LoggedAnswer[]
}

export function loadIntervalLog(): RoundLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RoundLogEntry[]
    return Array.isArray(parsed) ? parsed.filter((entry) => Array.isArray(entry?.answers)) : []
  } catch {
    return []
  }
}

function saveIntervalLog(log: RoundLogEntry[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log))
  } catch {
    // A full or blocked localStorage shouldn't stop a drill.
  }
}

/** Appends a finished round, drops the oldest past MAX_ROUNDS, and returns the new log. */
export function appendRound(entry: RoundLogEntry): RoundLogEntry[] {
  const next = [...loadIntervalLog(), entry].slice(-MAX_ROUNDS)
  saveIntervalLog(next)
  return next
}

export function clearIntervalLog() {
  saveIntervalLog([])
}

export interface SeriesPoint {
  asked: number
  correct: number
  accuracy: number
  /** When the bucket's last answer was given. */
  at: number
}

/**
 * A size's standing in a word.
 *
 * Movement is read before level on purpose: a size climbing out of 30% is the encouraging thing to
 * say about it, and one sliding down from 90% is worth saying before congratulating the player on
 * still being above the mastery line.
 */
export type SizeTrend = 'unproven' | 'slipping' | 'improving' | 'mastered' | 'weak' | 'steady'

export interface SizeProgress {
  size: number
  /** Lifetime totals, from IntervalHistory — these cover answers given before the log existed. */
  lifetime: SizeStat
  /** Oldest bucket first; empty for a size with too little logged to plot. */
  series: SeriesPoint[]
  /** Where the size stands now: the newest bucket, falling back to the lifetime tally. */
  standing: number | null
  /** Newest bucket less the oldest, or null without two buckets to compare. */
  delta: number | null
  /** Epoch ms of this size's most recent answer, or null if it has never been asked. */
  lastDrilled: number | null
  trend: SizeTrend
}

/**
 * Buckets a size's answers, oldest first, chunking from the newest backwards so the latest point is
 * always a full bucket and any short one is the oldest — the newest point is the one a player reads
 * as "where I am now", so it is the one that mustn't be a two-answer accident.
 */
function bucketAnswers(answers: { correct: boolean; at: number }[]): SeriesPoint[] {
  const leading = answers.length % BUCKET_ANSWERS
  const points: SeriesPoint[] = []
  let start = 0
  while (start < answers.length) {
    const width = start === 0 && leading > 0 ? leading : BUCKET_ANSWERS
    const chunk = answers.slice(start, start + width)
    start += width
    if (chunk.length < MIN_BUCKET_ANSWERS) continue
    const correct = chunk.filter((a) => a.correct).length
    points.push({
      asked: chunk.length,
      correct,
      accuracy: correct / chunk.length,
      at: chunk[chunk.length - 1].at,
    })
  }
  return points
}

function classify(lifetime: SizeStat, standing: number | null, delta: number | null): SizeTrend {
  if (lifetime.asked < MIN_SAMPLES) return 'unproven'
  if (delta !== null && delta <= -MOVEMENT) return 'slipping'
  if (delta !== null && delta >= MOVEMENT) return 'improving'
  if (standing === null) return 'steady'
  if (standing >= MASTERY_ACCURACY) return 'mastered'
  if (standing < WEAK_ACCURACY) return 'weak'
  return 'steady'
}

/**
 * One row per size asked for, in the order given, so the rows read as the same ladder the round's
 * difficulty ramp climbs. A size with nothing logged still appears — a gap in the record is itself
 * worth seeing.
 */
export function sizeProgress(
  log: RoundLogEntry[],
  history: IntervalHistory,
  sizes: number[],
): SizeProgress[] {
  const bySize = new Map<number, { correct: boolean; at: number }[]>()
  for (const round of log) {
    for (const answer of round.answers) {
      const list = bySize.get(answer.size)
      if (list) list.push({ correct: answer.correct, at: round.at })
      else bySize.set(answer.size, [{ correct: answer.correct, at: round.at }])
    }
  }

  return sizes.map((size) => {
    const answers = bySize.get(size) ?? []
    const lifetime = history[size] ?? { asked: 0, correct: 0 }
    const series = bucketAnswers(answers)
    const standing =
      series.length > 0
        ? series[series.length - 1].accuracy
        : lifetime.asked > 0
          ? lifetime.correct / lifetime.asked
          : null
    const delta =
      series.length >= 2 ? series[series.length - 1].accuracy - series[0].accuracy : null
    return {
      size,
      lifetime,
      series,
      standing,
      delta,
      lastDrilled: answers.length > 0 ? answers[answers.length - 1].at : null,
      trend: classify(lifetime, standing, delta),
    }
  })
}

export interface RoundSummary {
  at: number
  asked: number
  correct: number
  accuracy: number
}

/** Each logged round's score, oldest first. */
export function roundSummaries(log: RoundLogEntry[]): RoundSummary[] {
  return log
    .filter((round) => round.answers.length > 0)
    .map((round) => {
      const correct = round.answers.filter((a) => a.correct).length
      return {
        at: round.at,
        asked: round.answers.length,
        correct,
        accuracy: correct / round.answers.length,
      }
    })
}

/**
 * Mean accuracy over a trailing window of rounds, so the context strip reads through the noise of
 * single rounds. Short prefixes average what exists rather than being padded, which would drag the
 * line's start toward zero and invent a climb nobody made.
 */
export function rollingAccuracy(summaries: RoundSummary[], window = 5): number[] {
  return summaries.map((_, i) => {
    const slice = summaries.slice(Math.max(0, i - window + 1), i + 1)
    const asked = slice.reduce((sum, s) => sum + s.asked, 0)
    const correct = slice.reduce((sum, s) => sum + s.correct, 0)
    return asked > 0 ? correct / asked : 0
  })
}

export interface HeadlineStats {
  rounds: number
  answers: number
  /** The size that has climbed most, and the one standing lowest; null when nothing qualifies. */
  mostImproved: SizeProgress | null
  weakest: SizeProgress | null
  /** Sizes at or above the mastery line, over the rows passed in. */
  mastered: number
}

export function headlineStats(rows: SizeProgress[], log: RoundLogEntry[]): HeadlineStats {
  const proven = rows.filter((row) => row.lifetime.asked >= MIN_SAMPLES && row.standing !== null)
  const climbing = rows.filter((row) => row.delta !== null && row.delta > 0)
  return {
    rounds: log.length,
    answers: log.reduce((sum, round) => sum + round.answers.length, 0),
    mostImproved:
      climbing.length > 0
        ? climbing.reduce((best, row) => (row.delta! > best.delta! ? row : best))
        : null,
    weakest:
      proven.length > 0
        ? proven.reduce((worst, row) => (row.standing! < worst.standing! ? row : worst))
        : null,
    mastered: proven.filter((row) => row.standing! >= MASTERY_ACCURACY).length,
  }
}

const DAY_MS = 86_400_000

/**
 * "today", "3 days ago", "2 weeks ago" — rough on purpose. The point of showing a size's age is to
 * surface one going stale, which a date the player has to subtract in their head doesn't do.
 */
export function describeAge(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}
