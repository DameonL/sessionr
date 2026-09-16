"use client";

import { lazy, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { formatTuneType, getTuneDetails, searchTunes, type TuneSummary } from '../../../services/api'
import { InfiniteScrollSentinel } from '../../../components/InfiniteScrollSentinel'
import { Spinner } from '../../../components/Spinner'

// Dynamically import EarTrainer to prevent abcjs SSR errors
const EarTrainer = lazy(() => import('../../../components/EarTrainer').then((m) => ({ default: m.EarTrainer })))

/**
 * Ear training for signed-out players: pick any tune from the public library,
 * most popular first. Nothing here touches the private API — the trainer runs
 * without saving progress.
 */
export function PublicEarTunePicker() {
  const [picked, setPicked] = useState<TuneSummary | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const tunesQuery = useInfiniteQuery({
    queryKey: ['tune-library', 'ear', search],
    queryFn: ({ pageParam = 1 }) => searchTunes(search, '', 'popular', pageParam, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })

  if (picked) {
    return (
      <div>
        <div className="detail-controls" style={{ marginBottom: '1rem' }}>
          <button onClick={() => setPicked(null)}>← Choose another tune</button>
        </div>
        <PublicEarTrainer tune={picked} />
      </div>
    )
  }

  const tunes = tunesQuery.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div>
      <p className="tune-meta" style={{ marginBottom: '1rem' }}>
        Pick a tune to learn by ear — you'll hear one note at a time and play it back
        on your instrument. The most popular tunes are listed first.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          // Blur so mobile dismisses the on-screen keyboard.
          ;(document.activeElement as HTMLElement | null)?.blur()
          setSearch(searchInput.trim())
        }}
        style={{ marginBottom: '1rem' }}
      >
        <input
          className="search-box"
          type="search"
          placeholder="Search tunes by name…"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value)
            // Clearing the box goes straight back to the popular list.
            if (!e.target.value) setSearch('')
          }}
          style={{ width: '100%' }}
        />
      </form>

      {tunesQuery.isLoading && <div className="spinner-row"><Spinner /></div>}
      {tunesQuery.isError && <p className="error">Could not load tunes.</p>}

      <ul className="tune-list">
        {tunes.map((t) => (
          <li key={t.tuneId} className="card">
            <button className="tune-row" onClick={() => setPicked(t)}>
              <span className="tune-title">{t.title}</span>
              <span className="tune-meta">
                {formatTuneType(t.tuneType)} · {t.key}
                {t.repertoireCount > 0 &&
                  ` · ${t.repertoireCount} ${t.repertoireCount === 1 ? 'player' : 'players'}`}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <InfiniteScrollSentinel
        hasMore={tunesQuery.hasNextPage}
        isLoadingMore={tunesQuery.isFetchingNextPage}
        onLoadMore={() => tunesQuery.fetchNextPage()}
      />

      {tunesQuery.isSuccess && tunes.length === 0 && (
        <p>{search ? `No tunes match "${search}".` : 'No tunes yet.'}</p>
      )}
    </div>
  )
}

/** Loads the tune's top-voted setting — the public list carries no ABC. */
function PublicEarTrainer({ tune }: { tune: TuneSummary }) {
  const details = useQuery({
    queryKey: ['tune-details', tune.tuneId],
    queryFn: () => getTuneDetails(tune.tuneId),
  })

  if (details.isLoading) return <div className="spinner-row"><Spinner /></div>
  if (details.isError) return <p className="error">Could not load this tune.</p>

  const abcText = details.data?.settings[0]?.abcText
  if (!abcText) {
    return (
      <div className="card">
        <p className="error">This tune has no notation to train from yet.</p>
      </div>
    )
  }

  return <EarTrainer key={tune.tuneId} item={{ title: tune.title, abcText }} />
}
