"use client";

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { searchTunes, formatTuneType, TUNE_TYPES } from '../services/api'

/** Public tune library browser — works without an account. */
export function TuneLibrary() {
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')

  const library = useQuery({
    queryKey: ['tune-library', search, filterType],
    queryFn: () => searchTunes(search, filterType),
  })

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

      {library.isLoading && <p>Loading…</p>}
      {library.isError && <p className="error">Could not load the tune library.</p>}

      <ul className="tune-list">
        {(library.data ?? []).map((tune) => (
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
      {!library.isLoading && (library.data ?? []).length === 0 && (
        <p className="tune-meta italic">No tunes found.</p>
      )}
    </section>
  )
}
