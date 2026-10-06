import {
  describeAge,
  headlineStats,
  rollingAccuracy,
  roundSummaries,
  sizeProgress,
  type LoggedAnswer,
  type RoundLogEntry,
  type SeriesPoint,
  type SizeProgress,
  type SizeTrend,
} from '../services/intervalStats'
import {
  MASTERY_ACCURACY,
  intervalSizeLabel,
  type IntervalHistory,
  type SizeStat,
} from '../services/intervalTraining'

/**
 * The interval trainer's progress view: one panel per size, each with its own accuracy over time,
 * so a player can see which intervals are coming on and which are stuck. The overall trend is here
 * too but kept small — an average across sizes hides the only thing worth acting on.
 *
 * Charts are inline SVG over the theme's tokens rather than a charting library, matching how every
 * other visual in the app is drawn. Each uses a uniform viewBox scale so strokes don't distort.
 */

/** Rounds shown in the overall strip — enough for a trend, few enough to stay legible. */
const STRIP_ROUNDS = 30

const TREND_COLOR: Record<SizeTrend, string> = {
  improving: 'var(--success)',
  mastered: 'var(--success)',
  slipping: 'var(--danger)',
  weak: 'var(--danger)',
  steady: 'var(--muted)',
  unproven: 'var(--muted)',
}

function trendLabel(row: SizeProgress): string {
  switch (row.trend) {
    case 'improving':
      return 'improving'
    case 'slipping':
      return 'slipping'
    case 'mastered':
      return 'mastered'
    case 'weak':
      return 'needs work'
    case 'steady':
      return 'holding steady'
    case 'unproven':
      return row.lifetime.asked === 0 ? 'not drilled yet' : 'too few to judge'
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function signedPct(value: number): string {
  return `${value > 0 ? '▲ +' : '▼ −'}${Math.round(Math.abs(value) * 100)}%`
}

/** One size's accuracy per bucket of its own answers, oldest left. */
function Sparkline({ series, color }: { series: SeriesPoint[]; color: string }) {
  const width = 120
  const height = 34
  const pad = 4
  const x = (i: number) =>
    series.length < 2 ? width / 2 : pad + (i * (width - 2 * pad)) / (series.length - 1)
  const y = (accuracy: number) => pad + (1 - accuracy) * (height - 2 * pad)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={`Accuracy over time: ${series.map((p) => pct(p.accuracy)).join(', ')}`}
    >
      <line
        x1={0}
        x2={width}
        y1={y(MASTERY_ACCURACY)}
        y2={y(MASTERY_ACCURACY)}
        stroke="var(--border)"
        strokeDasharray="3 3"
      />
      {series.length > 1 && (
        <polyline
          points={series.map((p, i) => `${x(i)},${y(p.accuracy)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
      )}
      {series.map((p, i) => (
        <circle key={p.at + '-' + i} cx={x(i)} cy={y(p.accuracy)} r={2.5} fill={color}>
          <title>
            {`${p.correct} of ${p.asked} right · ${describeAge(p.at)}`}
          </title>
        </circle>
      ))}
    </svg>
  )
}

/** Every logged round's score, with a trailing average through it. */
function TrendStrip({ log }: { log: RoundLogEntry[] }) {
  const summaries = roundSummaries(log).slice(-STRIP_ROUNDS)
  const rolling = rollingAccuracy(summaries)
  const width = 320
  const height = 72
  const pad = 5
  const x = (i: number) =>
    summaries.length < 2 ? width / 2 : pad + (i * (width - 2 * pad)) / (summaries.length - 1)
  const y = (accuracy: number) => pad + (1 - accuracy) * (height - 2 * pad)

  return (
    <div style={{ marginBottom: '1rem' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`Accuracy across the last ${summaries.length} rounds`}
      >
        <line
          x1={0}
          x2={width}
          y1={y(MASTERY_ACCURACY)}
          y2={y(MASTERY_ACCURACY)}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
        {summaries.map((s, i) => (
          <circle key={s.at + '-' + i} cx={x(i)} cy={y(s.accuracy)} r={2} fill="var(--muted)">
            <title>{`${s.correct} of ${s.asked} right · ${describeAge(s.at)}`}</title>
          </circle>
        ))}
        {rolling.length > 1 && (
          <polyline
            points={rolling.map((a, i) => `${x(i)},${y(a)}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
          />
        )}
      </svg>
      <p className="tune-meta">
        Every round, oldest first{summaries.length === STRIP_ROUNDS && ' (last 30)'} — the line is a
        five-round average, the dashed mark {pct(MASTERY_ACCURACY)}.
      </p>
    </div>
  )
}

function SizeCard({ row, thisRound }: { row: SizeProgress; thisRound?: SizeStat }) {
  const color = TREND_COLOR[row.trend]
  const lifetimeAccuracy = row.lifetime.asked > 0 ? row.lifetime.correct / row.lifetime.asked : 0

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
        <strong>{intervalSizeLabel(row.size)}</strong>
        <span style={{ color }}>{row.standing === null ? '—' : pct(row.standing)}</span>
        {row.delta !== null && row.delta !== 0 && (
          <span
            style={{
              marginLeft: 'auto',
              color: row.delta > 0 ? 'var(--success)' : 'var(--danger)',
              fontSize: '0.85rem',
            }}
          >
            {signedPct(row.delta)}
          </span>
        )}
      </div>

      {row.series.length > 0 ? (
        <Sparkline series={row.series} color={color} />
      ) : (
        <div className="progress-bar-container" title={`${pct(lifetimeAccuracy)} all time`}>
          <div
            className="progress-bar"
            style={{ width: `${lifetimeAccuracy * 100}%`, background: color }}
          />
        </div>
      )}

      <p className="tune-meta" style={{ margin: 0 }}>
        {thisRound && `this round ${thisRound.correct} of ${thisRound.asked} · `}
        {trendLabel(row)}
        {row.lifetime.asked > 0 && ` · ${row.lifetime.correct} of ${row.lifetime.asked} all time`}
        {row.lastDrilled !== null && ` · last drilled ${describeAge(row.lastDrilled)}`}
      </p>
    </div>
  )
}

interface Props {
  log: RoundLogEntry[]
  history: IntervalHistory
  /** The sizes to report on, in ladder order — the round's selection, not everything ever asked. */
  sizes: number[]
  /** Drop the headline tiles and the overall strip, for the end-of-round summary. */
  compact?: boolean
  /** The round just played, so each size's card can show it against that size's history. */
  roundResults?: LoggedAnswer[]
}

export function IntervalProgress({ log, history, sizes, compact = false, roundResults }: Props) {
  const rows = sizeProgress(log, history, sizes)
  const headline = headlineStats(rows, log)
  // Two rounds is the point at which a second bucket, and so any movement at all, becomes possible.
  const canPlotTrend = roundSummaries(log).length >= 2

  function thisRound(size: number): SizeStat | undefined {
    if (!roundResults) return undefined
    const asked = roundResults.filter((r) => r.size === size)
    if (asked.length === 0) return undefined
    return { asked: asked.length, correct: asked.filter((r) => r.correct).length }
  }

  /** The movement worth naming in one line, for the end-of-round summary. */
  const notes = [
    headline.mostImproved &&
      `${intervalSizeLabel(headline.mostImproved.size)} now ${pct(headline.mostImproved.standing!)} (${signedPct(headline.mostImproved.delta!)})`,
    headline.weakest &&
      headline.weakest.size !== headline.mostImproved?.size &&
      `${intervalSizeLabel(headline.weakest.size)} still ${pct(headline.weakest.standing!)}`,
  ].filter(Boolean)

  return (
    <div style={{ marginBottom: '1rem' }}>
      {!compact && (
        <div className="stat-grid" style={{ marginBottom: '1rem' }}>
          <div className="stat">
            <strong>{headline.rounds}</strong>
            <span>rounds</span>
          </div>
          <div className="stat">
            <strong>{headline.answers}</strong>
            <span>intervals heard</span>
          </div>
          <div className="stat">
            <strong>{`${headline.mastered} of ${rows.length}`}</strong>
            <span>mastered</span>
          </div>
          <div className="stat">
            <strong style={{ fontSize: '1.15rem', color: headline.mostImproved ? 'var(--success)' : undefined }}>
              {headline.mostImproved
                ? `${intervalSizeLabel(headline.mostImproved.size)} ${signedPct(headline.mostImproved.delta!)}`
                : '—'}
            </strong>
            <span>most improved</span>
          </div>
          <div className="stat">
            <strong style={{ fontSize: '1.15rem', color: headline.weakest ? 'var(--danger)' : undefined }}>
              {headline.weakest
                ? `${intervalSizeLabel(headline.weakest.size)} ${pct(headline.weakest.standing!)}`
                : '—'}
            </strong>
            <span>weakest</span>
          </div>
        </div>
      )}

      {compact && notes.length > 0 && (
        <p className="tune-meta" style={{ marginBottom: '0.5rem' }}>{notes.join(' · ')}</p>
      )}

      {!compact &&
        (canPlotTrend ? (
          <TrendStrip log={log} />
        ) : (
          <p className="tune-meta">
            Finish a few rounds and the graphs fill in — each interval gets its own, so you can see
            which ones are coming on.
          </p>
        ))}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
          gap: '0.6rem',
        }}
      >
        {rows.map((row) => (
          <SizeCard key={row.size} row={row} thisRound={thisRound(row.size)} />
        ))}
      </div>
    </div>
  )
}

export default IntervalProgress
