"use client";

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  TUNE_STATUSES,
  TUNE_TYPES,
  addToRepertoire,
  formatTuneType,
  getRepertoireList,
  importFromTheSession,
  importTunebook,
  searchTheSession,
  searchTunes,
  type RepertoireListItem,
} from '../services/api'
import { currentUserId, repertoireSearch, useSignal } from '../state/appState'
import { RepertoireBackup } from '../components/RepertoireBackup'
import { TuneSettingsModal } from '../components/TuneSettingsModal'
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel'

function getSortKey(item: RepertoireListItem, field: 'title' | 'tuneType' | 'key'): string {
  const val = (item[field] || '').toLowerCase()
  if (field === 'title') {
    if (val.startsWith('the ')) return val.slice(4)
    if (val.startsWith('a ')) return val.slice(2)
  }
  return val
}

export function Repertoire() {
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()
  const search = useSignal(repertoireSearch)

  const [theSessionQuery, setTheSessionQuery] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('')
  const [filterKey, setFilterKey] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortField, setSortField] = useState<'title' | 'tuneType' | 'key'>('title')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const repertoireQuery = useInfiniteQuery({
    queryKey: ['repertoire', userId, search, filterType, filterStatus],
    queryFn: ({ pageParam = 1 }) => getRepertoireList(search, filterType, filterStatus, pageParam as number, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })

  const allRepertoireItems = repertoireQuery.data?.pages.flatMap((p) => p.items) ?? []

  const library = useQuery({
    queryKey: ['tunes', search],
    queryFn: () => searchTunes(search),
    enabled: search.length >= 2,
  })

  const theSession = useQuery({
    queryKey: ['thesession', theSessionQuery],
    queryFn: () => searchTheSession(theSessionQuery!),
    enabled: theSessionQuery != null && theSessionQuery.length >= 2,
  })

  const [selectedTuneIdForModal, setSelectedTuneIdForModal] = useState<string | null>(null)

  const addMutation = useMutation({
    mutationFn: (tuneId: string) => addToRepertoire(tuneId),
    onSuccess: () => invalidate(),
  })

  const importMutation = useMutation({
    mutationFn: importFromTheSession,
    onSuccess: (saved) => {
      setSelectedTuneIdForModal(saved.tuneId)
    },
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
  }

  const filteredItems = useMemo(() => {
    return allRepertoireItems
      .filter((item) => {
        if (filterKey && item.key !== filterKey) return false
        return true
      })
      .sort((a, b) => {
        const left = getSortKey(a, sortField)
        const right = getSortKey(b, sortField)
        if (left === right) return 0
        const result = left < right ? -1 : 1
        return sortDirection === 'asc' ? result : -result
      })
  }, [allRepertoireItems, filterKey, sortField, sortDirection])

  const ownedTuneIds = new Set(allRepertoireItems.map((i) => i.tuneId))
  const libraryMatches = (library.data?.items ?? []).filter((t) => !ownedTuneIds.has(t.tuneId))

  return (
    <section>
      <h1>Repertoire</h1>
      <div className="detail-controls">
        <input
          className="search-box"
          type="search"
          placeholder="Search tunes… (title, type, or key)"
          value={search}
          onChange={(e) => (repertoireSearch.value = e.target.value)}
        />
      </div>

      <div className="detail-controls">
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
        <label>
          Filter by key
          <select value={filterKey} onChange={(e) => setFilterKey(e.target.value)}>
            <option value="">All keys</option>
            {[...new Set(allRepertoireItems.map((item) => item.key))]
              .sort()
              .map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
          </select>
        </label>
        <label>
          Filter by status
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TUNE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select value={sortField} onChange={(e) => setSortField(e.target.value as 'title' | 'tuneType' | 'key')}>
            <option value="title">Title</option>
            <option value="tuneType">Type</option>
            <option value="key">Key</option>
          </select>
        </label>
        <label>
          Direction
          <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value as 'asc' | 'desc')}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>

      {repertoireQuery.isLoading && <p>Loading…</p>}
      {repertoireQuery.isError && <p className="error">Could not load repertoire.</p>}

      <ul className="tune-list">
        {filteredItems.map((item) => (
          <li key={item.userTuneId} className="card">
            <Link className="tune-row" href={`/tune/${item.userTuneId}`}>
              <span className="tune-title">{item.title}</span>
              <span className="tune-meta">
                {formatTuneType(item.tuneType)} · {item.key}
              </span>
              <span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
            </Link>
          </li>
        ))}
      </ul>
      <InfiniteScrollSentinel
        hasMore={repertoireQuery.hasNextPage}
        isLoadingMore={repertoireQuery.isFetchingNextPage}
        onLoadMore={() => repertoireQuery.fetchNextPage()}
      />
      {!repertoireQuery.isLoading && filteredItems.length === 0 && <p>No tunes match.</p>}

      {libraryMatches.length > 0 && (
        <>
          <h2>Add from library</h2>
          <ul className="tune-list">
            {libraryMatches.map((tune) => (
              <li key={tune.tuneId} className="card tune-row">
                <span className="tune-title">{tune.title}</span>
                <span className="tune-meta">
                  {formatTuneType(tune.tuneType)} · {tune.key}
                </span>
                <button onClick={() => setSelectedTuneIdForModal(tune.tuneId)}>+ Add</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {search.length >= 2 && (
        <>
          <h2>thesession.org</h2>
          {theSessionQuery !== search && (
            <button onClick={() => setTheSessionQuery(search)}>
              Search thesession.org for “{search}”
            </button>
          )}
          {theSession.isFetching && <p>Searching thesession.org…</p>}
          {theSession.isError && <p className="error">thesession.org search failed.</p>}
          {theSessionQuery === search && theSession.data && (
            <>
              {theSession.data.length === 0 && <p className="tune-meta">No matches found.</p>}
              <ul className="tune-list">
                {theSession.data.map((result) => (
                  <li key={result.theSessionId} className="card tune-row">
                    <span className="tune-title">{result.name}</span>
                    <span className="tune-meta">{formatTuneType(result.type)}</span>
                    <button
                      disabled={importMutation.isPending}
                      onClick={() => importMutation.mutate(result.theSessionId)}
                    >
                      ⬇ Import
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {importMutation.isError && (
            <p className="error">{(importMutation.error as Error).message}</p>
          )}
        </>
      )}

      <TunebookImport userId={userId} onImported={invalidate} />
      <RepertoireBackup
        userId={userId}
        onImported={invalidate}
      />
      {selectedTuneIdForModal !== null && (
        <TuneSettingsModal
          tuneId={selectedTuneIdForModal}
          userId={userId}
          onClose={() => setSelectedTuneIdForModal(null)}
          onAdded={invalidate}
        />
      )}
    </section>
  )
}

function TunebookImport({ userId, onImported }: { userId: string; onImported: () => void }) {
  const [memberId, setMemberId] = useState('')

  const parseMemberId = (value: string) => {
    const trimmed = value.trim()
    const urlMatch = trimmed.match(/members\/(\d+)/i)
    if (urlMatch) return urlMatch[1]
    return /^[0-9]+$/.test(trimmed) ? trimmed : ''
  }

  const parsedMemberId = parseMemberId(memberId)

  const tunebookMutation = useMutation({
    mutationFn: () => importTunebook(parsedMemberId),
    onSuccess: onImported,
  })
  const result = tunebookMutation.data

  return (
    <>
      <h2>Import your thesession.org tunebook</h2>
      <div className="detail-controls">
        <input
          className="tunebook-url"
          type="text"
          placeholder="Member ID or thesession.org URL"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        />
        <button
          disabled={tunebookMutation.isPending || !parsedMemberId}
          onClick={() => tunebookMutation.mutate()}
        >
          {tunebookMutation.isPending ? 'Importing… (this can take a while)' : '⬇ Import tunebook'}
        </button>
      </div>
      {result && (
        <p className="tune-meta">
          Found {result.totalFound} tunes · imported {result.imported} · added{' '}
          {result.addedToRepertoire} to your repertoire
          {result.alreadyInRepertoire > 0 && ` · ${result.alreadyInRepertoire} already there`}
          {result.failures.length > 0 && ` · ${result.failures.length} failed`}
        </p>
      )}
      {tunebookMutation.isError && (
        <p className="error">{(tunebookMutation.error as Error).message}</p>
      )}
    </>
  )
}
