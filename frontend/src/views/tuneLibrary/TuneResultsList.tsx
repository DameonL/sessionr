"use client";

import Link from 'next/link'
import { formatTuneType, type TuneSummary } from '../../services/api'
import { InfiniteScrollSentinel } from '../../components/InfiniteScrollSentinel'

/** Shared results list for the tune library views (search + browse). */
export function TuneResultsList({
  tunes,
  isLoading,
  isError,
  hasMore,
  isFetchingMore,
  onLoadMore,
  showRepertoireCount = false,
}: {
  tunes: TuneSummary[]
  isLoading: boolean
  isError: boolean
  hasMore: boolean
  isFetchingMore: boolean
  onLoadMore: () => void
  showRepertoireCount?: boolean
}) {
  return (
    <>
      {isLoading && <p style={{ marginTop: '1rem' }}>Loading tunes…</p>}
      {isError && <p className="error" style={{ marginTop: '1rem' }}>Could not load tunes.</p>}

      <ul className="tune-list">
        {tunes.map((tune) => (
          <li key={tune.tuneId} className="card tune-row">
            <Link href={`/tunes/${tune.tuneId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }} prefetch={false}>
              <span className="tune-title">{tune.title}</span>
              <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                {formatTuneType(tune.tuneType)} · {tune.key}
                {showRepertoireCount && (
                  <> · In {tune.repertoireCount} {tune.repertoireCount === 1 ? 'repertoire' : 'repertoires'}</>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {!isLoading && tunes.length === 0 && (
        <p className="tune-meta italic" style={{ marginTop: '1rem' }}>No tunes found.</p>
      )}

      <InfiniteScrollSentinel
        hasMore={hasMore}
        isLoadingMore={isFetchingMore}
        onLoadMore={onLoadMore}
      />
    </>
  )
}
