"use client";

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { addTuneAlias } from '../services/api'

/**
 * The "alternate names" list and its add form, shared by the settings modal and the library
 * detail page, which each carried their own copy.
 */
export function TuneAliases({
  tuneId,
  aliases,
  onAdded,
  style,
}: {
  tuneId: string
  aliases: string[]
  onAdded: () => void
  style?: React.CSSProperties
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (newName: string) => addTuneAlias(tuneId, newName),
    onSuccess: () => {
      setName('')
      setError(null)
      onAdded()
    },
    onError: (err: Error) => setError(err.message || 'Failed to add alternate name.'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    // Caught here rather than at the server so the answer is immediate and the name stays put.
    if (aliases.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      setError('That name is already listed.')
      return
    }
    mutation.mutate(trimmed)
  }

  return (
    <div className="modal-section alternate-names-section" style={style}>
      <h3>Alternate Names</h3>
      <div className="alias-container">
        {aliases.length === 0 ? (
          <span className="tune-meta italic">No alternate names registered yet.</span>
        ) : (
          aliases.map((alias, i) => (
            <span key={i} className="badge badge-learning alias-badge">{alias}</span>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="add-alias-form" style={{ marginTop: '0.75rem' }}>
        <input
          type="text"
          placeholder="Add alternate name..."
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (error) setError(null)
          }}
          disabled={mutation.isPending}
          aria-label="Alternate name"
          style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
        />
        <button type="submit" disabled={mutation.isPending || !name.trim()}>
          {mutation.isPending ? 'Adding…' : '+ Add Name'}
        </button>
      </form>
      {error && <p className="error" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{error}</p>}
    </div>
  )
}
