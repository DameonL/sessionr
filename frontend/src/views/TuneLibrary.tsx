"use client";

import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { searchTunes, createTune, formatTuneType, TUNE_TYPES } from '../services/api'
import { extractKeyFromAbc, validateAbc } from '../services/abcTools'
import { useAuthStatus, showToast } from '../state/appState'
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel'
import { Dialog } from '../components/Dialog'

/** Public tune library browser — search tunes by name or alternate name. */
export function TuneLibrary() {
  const router = useRouter()
  const authStatus = useAuthStatus()
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')

  // Add Tune Modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addType, setAddType] = useState('Reel')
  const [addAbc, setAddAbc] = useState('')
  const [addKeyOverride, setAddKeyOverride] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const hasSearchQuery = search.trim().length > 0 || filterType !== ''

  const libraryQuery = useInfiniteQuery({
    queryKey: ['tune-library', search, filterType],
    queryFn: ({ pageParam = 1 }) => searchTunes(search, filterType, pageParam, 20),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
    enabled: hasSearchQuery,
  })

  const createTuneMutation = useMutation({
    mutationFn: (newTune: { title: string; tuneType: string; key: string; abc: string }) => createTune(newTune),
    onSuccess: (data) => {
      setShowAddModal(false)
      setAddTitle('')
      setAddAbc('')
      setAddKeyOverride('')
      setAddError(null)
      showToast('Tune added to library!', 'success')
      router.push(`/tunes/${data.tuneId}`)
    },
    onError: (err: Error) => {
      setAddError(err.message || 'Failed to add tune.')
    },
  })

  const handleOpenAddModal = () => {
    if (authStatus === 'anonymous') {
      showToast('Please sign in to add a tune', 'info')
      router.push('/login')
      return
    }
    setShowAddModal(true)
  }

  const handleAddTuneSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!addTitle.trim()) {
      setAddError('Title is required.')
      return
    }
    const validation = validateAbc(addAbc)
    if (!validation.isValid) {
      setAddError(validation.error || 'Invalid ABC notation.')
      return
    }
    const trimmedAbc = validation.trimmedAbc
    const derivedKey = addKeyOverride.trim() || extractKeyFromAbc(trimmedAbc)
    if (!derivedKey) {
      setAddError('Key could not be detected from ABC notation. Please include a K: header (e.g. K:G) or enter a key.')
      return
    }
    createTuneMutation.mutate({
      title: addTitle.trim(),
      tuneType: addType,
      key: derivedKey,
      abc: trimmedAbc,
    })
  }

  const allTunes = libraryQuery.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Tune Library</h1>
          <p className="tune-meta italic" style={{ marginTop: '0.25rem' }}>Browse, play, and practice any tune in the shared library.</p>
        </div>
        <button onClick={handleOpenAddModal}>
          + Add a Tune
        </button>
      </div>

      <div className="detail-controls">
        <input
          className="search-box"
          type="search"
          placeholder="Search tunes by name or alternate name…"
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

      {!hasSearchQuery && (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center', marginTop: '1.5rem', background: 'var(--surface-2)' }}>
          <p style={{ fontSize: '1.1rem', margin: 0, color: 'var(--muted)' }}>
            🔍 Search for a tune above by name or alternate name
          </p>
        </div>
      )}

      {hasSearchQuery && libraryQuery.isLoading && <p style={{ marginTop: '1rem' }}>Searching tunes…</p>}
      {hasSearchQuery && libraryQuery.isError && <p className="error" style={{ marginTop: '1rem' }}>Could not search the tune library.</p>}

      {hasSearchQuery && (
        <ul className="tune-list">
          {allTunes.map((tune) => (
            <li key={tune.tuneId} className="card tune-row">
              <Link href={`/tunes/${tune.tuneId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }} prefetch={false}>
                <span className="tune-title">{tune.title}</span>
                <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                  {formatTuneType(tune.tuneType)} · {tune.key}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasSearchQuery && !libraryQuery.isLoading && allTunes.length === 0 && (
        <p className="tune-meta italic" style={{ marginTop: '1rem' }}>No tunes found.</p>
      )}

      {hasSearchQuery && (
        <InfiniteScrollSentinel
          hasMore={libraryQuery.hasNextPage}
          isLoadingMore={libraryQuery.isFetchingNextPage}
          onLoadMore={() => libraryQuery.fetchNextPage()}
        />
      )}

      {/* Add Tune Modal */}
      <Dialog isOpen={showAddModal} title="Add a New Tune" onClose={() => setShowAddModal(false)} maxWidth="540px">
        <form onSubmit={handleAddTuneSubmit}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            Title
            <input
              type="text"
              placeholder="e.g. The Maid Behind The Bar"
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              required
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <label style={{ flex: 1 }}>
              Tune Type
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
              >
                {TUNE_TYPES.map((t) => (
                  <option key={t} value={t}>{formatTuneType(t)}</option>
                ))}
              </select>
            </label>

            <label style={{ flex: 1 }}>
              Key (Auto-detected)
              <input
                type="text"
                placeholder="Auto-detected from K:"
                value={addKeyOverride || extractKeyFromAbc(addAbc)}
                onChange={(e) => setAddKeyOverride(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
              />
            </label>
          </div>

          <label style={{ display: 'block', marginBottom: '1rem' }}>
            ABC Notation
            <textarea
              placeholder="Paste ABC text here (must include K: header, e.g. K:D)..."
              value={addAbc}
              onChange={(e) => setAddAbc(e.target.value)}
              rows={6}
              required
              style={{ display: 'block', width: '100%', marginTop: '0.35rem', fontFamily: 'monospace' }}
            />
          </label>

          {addError && <p className="error" style={{ marginBottom: '1rem' }}>{addError}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </button>
            <button type="submit" disabled={createTuneMutation.isPending}>
              {createTuneMutation.isPending ? 'Adding…' : 'Add Tune'}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}
