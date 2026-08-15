"use client";

import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { searchTunes, formatTuneType, TUNE_TYPES } from '../../services/api'
import { useQueryFilters } from '../../hooks/useQueryFilters'
import { TuneResultsList } from './TuneResultsList'

/** Search the tune library by name/alternate name, optionally filtered by type. */
export function TuneSearchView() {
  const { searchParams, setParams } = useQueryFilters()

  // The URL holds the *submitted* search, so the view is bookmarkable and
  // restored on back/forward. Inputs below are the form draft.
  const submittedSearch = searchParams.get('q') ?? ''
  const submittedType = searchParams.get('type') ?? ''

  const [searchInput, setSearchInput] = useState(submittedSearch)
  const [filterTypeInput, setFilterTypeInput] = useState(submittedType)

  // Re-sync the draft inputs when the URL changes via back/forward or a bookmark.
  useEffect(() => setSearchInput(submittedSearch), [submittedSearch])
  useEffect(() => setFilterTypeInput(submittedType), [submittedType])

  const hasSearchQuery = submittedSearch.length > 0 || submittedType !== ''

  const libraryQuery = useInfiniteQuery({
    queryKey: ['tune-library', 'search', submittedSearch, submittedType],
    queryFn: ({ pageParam = 1 }) => searchTunes(submittedSearch, submittedType, 'alphabetical', pageParam, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: hasSearchQuery,
  })

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Blur the focused input so mobile dismisses the on-screen keyboard on search.
    ;(document.activeElement as HTMLElement | null)?.blur()
    setParams({ q: searchInput.trim(), type: filterTypeInput })
  }

  const allTunes = libraryQuery.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <form onSubmit={handleSearchSubmit} className="detail-controls" style={{ display: 'block', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ minWidth: '220px' }}>
          <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.85rem' }}>Search by name</label>
          <input
            className="search-box"
            type="search"
            placeholder="Type tune name or alternate name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: "flex", columnGap: "1rem" }}>
          <span>
            <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.85rem' }}>Filter by type</label>
            <select value={filterTypeInput} onChange={(e) => setFilterTypeInput(e.target.value)}>
              <option value="">All types</option>
              {TUNE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {formatTuneType(type)}
                </option>
              ))}
            </select>
          </span>
          <button type="submit" style={{ padding: '0.45rem 1.25rem', whiteSpace: 'nowrap', marginTop: "auto" }}>
            🔍 Search
          </button>
          {(hasSearchQuery || searchInput || filterTypeInput) && (
            <button
              type="button"
              className="secondary"
              style={{ padding: '0.45rem 1rem', whiteSpace: 'nowrap', marginTop: "auto" }}
              onClick={() => {
                setSearchInput('')
                setFilterTypeInput('')
                setParams({ q: '', type: '' })
              }}
            >
              ✕ Clear
            </button>
          )}
        </div>
      </form>

      {!hasSearchQuery ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center', marginTop: '1.5rem', background: 'var(--surface-2)' }}>
          <p style={{ fontSize: '1.1rem', margin: 0, color: 'var(--muted)' }}>
            🔍 Search for a tune above by name or alternate name
          </p>
        </div>
      ) : (
        <TuneResultsList
          tunes={allTunes}
          isLoading={libraryQuery.isLoading}
          isError={libraryQuery.isError}
          error={libraryQuery.error}
          hasMore={libraryQuery.hasNextPage}
          isFetchingMore={libraryQuery.isFetchingNextPage}
          onLoadMore={() => libraryQuery.fetchNextPage()}
        />
      )}
    </>
  )
}
