import { useMemo, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TUNE_STATUSES,
  TUNE_TYPES,
  addToRepertoire,
  formatTuneType,
  getRepertoire,
  importFromTheSession,
  importTunebook,
  searchTheSession,
  searchTunes,
} from '../services/api.ts'
import { currentUserId, repertoireSearch } from '../state/appState.ts'
import { RepertoireBackup } from '../components/RepertoireBackup.tsx'

function getSortKey(item: any, field: 'title' | 'tuneType' | 'key'): string {
  const val = (item[field] || '').toLowerCase()
  if (field === 'title') {
    if (val.startsWith('the ')) return val.slice(4)
    if (val.startsWith('a ')) return val.slice(2)
  }
  return val
}

export function Repertoire() {
  const userId = currentUserId.value
  const queryClient = useQueryClient()
  const search = repertoireSearch.value

  // The search string an external thesession.org lookup was requested for;
  // the lookup is explicit (button press), not automatic per keystroke.
  const [theSessionQuery, setTheSessionQuery] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('')
  const [filterKey, setFilterKey] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortField, setSortField] = useState<'title' | 'tuneType' | 'key'>('title')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: () => getRepertoire(userId),
  })

  // Global library search only kicks in once the user is typing, so the
  // common case (scanning your own list) stays instant.
  const library = useQuery({
    queryKey: ['tunes', search],
    queryFn: () => searchTunes(search),
    enabled: search.length >= 2,
  })

  const theSession = useQuery({
    queryKey: ['thesession', theSessionQuery],
    queryFn: () => searchTheSession(theSessionQuery!),
    enabled: theSessionQuery !== null && theSessionQuery === search,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
    queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
    queryClient.invalidateQueries({ queryKey: ['tunes'] })
  }

  const addMutation = useMutation({
    mutationFn: (tuneId: number) => addToRepertoire(userId, tuneId),
    onSuccess: invalidate,
  })

  // Import creates (or finds) the global tune, then adds it to the repertoire.
  const importMutation = useMutation({
    mutationFn: async (theSessionId: number) => {
      const tune = await importFromTheSession(theSessionId)
      return addToRepertoire(userId, tune.tuneId)
    },
    onSuccess: invalidate,
  })

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.toLowerCase()

    return (repertoire.data ?? [])
      .filter((item) => {
        const matchesSearch =
          !search ||
          item.title.toLowerCase().includes(normalizedSearch) ||
          item.tuneType.toLowerCase() === normalizedSearch ||
          formatTuneType(item.tuneType).toLowerCase() === normalizedSearch ||
          item.key.toLowerCase() === normalizedSearch

        const matchesType = !filterType || item.tuneType === filterType
        const matchesKey = !filterKey || item.key === filterKey
        const matchesStatus = !filterStatus || item.status === filterStatus

        return matchesSearch && matchesType && matchesKey && matchesStatus
      })
      .sort((a, b) => {
        const left = getSortKey(a, sortField)
        const right = getSortKey(b, sortField)
        if (left === right) return 0
        const result = left < right ? -1 : 1
        return sortDirection === 'asc' ? result : -result
      })
  }, [repertoire.data, search, filterType, filterKey, filterStatus, sortField, sortDirection])

  const ownedTuneIds = new Set((repertoire.data ?? []).map((i) => i.tuneId))
  const libraryMatches = (library.data ?? []).filter((t) => !ownedTuneIds.has(t.tuneId))

  return (
    <section>
      <h1>Repertoire</h1>
      <div class="detail-controls">
        <input
          class="search-box"
          type="search"
          placeholder="Search tunes… (title, type, or key)"
          value={search}
          onInput={(e) => (repertoireSearch.value = (e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="detail-controls">
        <label>
          Filter by type
          <select value={filterType} onChange={(e) => setFilterType((e.target as HTMLSelectElement).value)}>
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
          <select value={filterKey} onChange={(e) => setFilterKey((e.target as HTMLSelectElement).value)}>
            <option value="">All keys</option>
            {[...new Set((repertoire.data ?? []).map((item) => item.key))]
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
          <select value={filterStatus} onChange={(e) => setFilterStatus((e.target as HTMLSelectElement).value)}>
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
          <select value={sortField} onChange={(e) => setSortField((e.target as HTMLSelectElement).value as 'title' | 'tuneType' | 'key')}>
            <option value="title">Title</option>
            <option value="tuneType">Type</option>
            <option value="key">Key</option>
          </select>
        </label>
        <label>
          Direction
          <select value={sortDirection} onChange={(e) => setSortDirection((e.target as HTMLSelectElement).value as 'asc' | 'desc')}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>

      {repertoire.isLoading && <p>Loading…</p>}
      {repertoire.isError && <p class="error">Could not load repertoire.</p>}

      <ul class="tune-list">
        {filteredItems.map((item) => (
          <li key={item.userTuneId} class="card">
            <a class="tune-row" href={`/tune/${item.userTuneId}`}>
              <span class="tune-title">{item.title}</span>
              <span class="tune-meta">
                {formatTuneType(item.tuneType)} · {item.key}
              </span>
              <span class={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
            </a>
          </li>
        ))}
      </ul>
      {!repertoire.isLoading && filteredItems.length === 0 && <p>No tunes match.</p>}

      {libraryMatches.length > 0 && (
        <>
          <h2>Add from library</h2>
          <ul class="tune-list">
            {libraryMatches.map((tune) => (
              <li key={tune.tuneId} class="card tune-row">
                <span class="tune-title">{tune.title}</span>
                <span class="tune-meta">
                  {formatTuneType(tune.tuneType)} · {tune.key}
                </span>
                <button onClick={() => addMutation.mutate(tune.tuneId)}>+ Add</button>
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
          {theSession.isError && <p class="error">thesession.org search failed.</p>}
          {theSessionQuery === search && theSession.data && (
            <>
              {theSession.data.length === 0 && <p class="tune-meta">No matches found.</p>}
              <ul class="tune-list">
                {theSession.data.map((result) => (
                  <li key={result.theSessionId} class="card tune-row">
                    <span class="tune-title">{result.name}</span>
                    <span class="tune-meta">{formatTuneType(result.type)}</span>
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
            <p class="error">{(importMutation.error as Error).message}</p>
          )}
        </>
      )}

      <TunebookImport userId={userId} onImported={invalidate} />
      <RepertoireBackup
        userId={userId}
        repertoireItems={repertoire.data ?? []}
        onImported={invalidate}
      />
    </section>
  )
}

/** Bulk import of a whole thesession.org member tunebook by member ID or URL. */
function TunebookImport({ userId, onImported }: { userId: number; onImported: () => void }) {
  const [memberId, setMemberId] = useState('')

  const parseMemberId = (value: string) => {
    const trimmed = value.trim()
    const urlMatch = trimmed.match(/members\/(\d+)/i)
    if (urlMatch) return urlMatch[1]
    return /^[0-9]+$/.test(trimmed) ? trimmed : ''
  }

  const parsedMemberId = parseMemberId(memberId)

  const tunebookMutation = useMutation({
    mutationFn: () => importTunebook(userId, parsedMemberId),
    onSuccess: onImported,
  })
  const result = tunebookMutation.data

  return (
    <>
      <h2>Import your thesession.org tunebook</h2>
      <div class="detail-controls">
        <input
          class="tunebook-url"
          type="text"
          placeholder="Member ID or thesession.org URL"
          value={memberId}
          onInput={(e) => setMemberId((e.target as HTMLInputElement).value)}
        />
        <button
          disabled={tunebookMutation.isPending || !parsedMemberId}
          onClick={() => tunebookMutation.mutate()}
        >
          {tunebookMutation.isPending ? 'Importing… (this can take a while)' : '⬇ Import tunebook'}
        </button>
      </div>
      {result && (
        <p class="tune-meta">
          Found {result.totalFound} tunes · imported {result.imported} · added{' '}
          {result.addedToRepertoire} to your repertoire
          {result.alreadyInRepertoire > 0 && ` · ${result.alreadyInRepertoire} already there`}
          {result.failures.length > 0 && ` · ${result.failures.length} failed`}
        </p>
      )}
      {tunebookMutation.isError && (
        <p class="error">{(tunebookMutation.error as Error).message}</p>
      )}
    </>
  )
}
