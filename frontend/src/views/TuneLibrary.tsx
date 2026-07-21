"use client";

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { searchTunes, formatTuneType, TUNE_TYPES } from '../services/api'
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel'

/** Public tune library browser — works without an account. */
export function TuneLibrary() {
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')

  const libraryQuery = useInfiniteQuery({
    queryKey: ['tune-library', search, filterType],
    queryFn: ({ pageParam = 1 }) => searchTunes(search, filterType, pageParam, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })

  const allTunes = libraryQuery.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section>
      <h1>Tune Library</h1>
      <p className="tune-meta italic">Browse, play, and practice any tune in the shared library — no account needed.</p>

      <div className="detail-controls">
        <input
          className="search-box"
          type="search"
          placeholder="Search tunes… (title, type, or key)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          Filter by type
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {TUNE_TYPES.map((type) => (
              <option key={type} value={type}>
                {formatTuneType(type)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {libraryQuery.isLoading && <p>Loading…</p>}
      {libraryQuery.isError && <p className="error">Could not load the tune library.</p>}

      <ul className="tune-list">
        {allTunes.map((tune) => (
          <li key={tune.tuneId} className="card tune-row">
            <Link href={`/tunes/${tune.tuneId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
              <span className="tune-title">{tune.title}</span>
              <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                {formatTuneType(tune.tuneType)} · {tune.key}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {!libraryQuery.isLoading && allTunes.length === 0 && (
        <p className="tune-meta italic">No tunes found.</p>
      )}

      <InfiniteScrollSentinel
        hasMore={libraryQuery.hasNextPage}
        isLoadingMore={libraryQuery.isFetchingNextPage}
        onLoadMore={() => libraryQuery.fetchNextPage()}
      />
    </section>
  )
}
