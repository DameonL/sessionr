"use client";

import { useQuery } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { formatTuneType, getFullRepertoireList, type TuneSummary } from '../../services/api'
import { InfiniteScrollSentinel } from '../../components/InfiniteScrollSentinel'
import { Spinner } from '../../components/Spinner'
import { currentUserId, useSignal } from '../../state/appState'

/** Shared results list for the tune library views (search + browse). */
export function TuneResultsList({
  tunes,
  isLoading,
  isError,
  error,
  hasMore,
  isFetchingMore,
  onLoadMore,
  showRepertoireCount = false,
}: {
  tunes: TuneSummary[]
  isLoading: boolean
  isError: boolean
  error?: unknown
  hasMore: boolean
  isFetchingMore: boolean
  onLoadMore: () => void
  showRepertoireCount?: boolean
}) {
  const userId = useSignal(currentUserId)

  // Browsing the library gave no hint which tunes you already have, so the only way to find out
  // was to open one. Same query as the group repertoire panel, so the two share a cache entry —
  // and it pages to the end, because the API caps a page at 100 and a partial answer here would
  // read as "not in your repertoire".
  const repertoireQuery = useQuery({
    queryKey: ['repertoire-list-full', userId],
    queryFn: getFullRepertoireList,
    enabled: !!userId,
  })
  const ownedTuneIds = new Set((repertoireQuery.data ?? []).map((i) => i.tuneId))

  return (
    <>
      {isLoading && <div className="spinner-row"><Spinner /></div>}
      {isError && (
        <p className="error" style={{ marginTop: '1rem' }}>
          Could not load tunes.{error instanceof Error && error.message ? ` (${error.message})` : ''}
        </p>
      )}

      <ul className="tune-list">
        {tunes.map((tune) => (
          <li key={tune.tuneId} className="card tune-row">
            <Link href={`/tunes/${tune.tuneId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }} prefetch={false}>
              <span className="tune-title">{tune.title}</span>
              <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                {formatTuneType(tune.tuneType)} · {tune.key}
                {ownedTuneIds.has(tune.tuneId) && <> · <span className="in-repertoire">✓ In your repertoire</span></>}
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
