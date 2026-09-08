"use client";

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { addTuneAlias } from '../services/api'
import { Dialog } from './Dialog'

/**
 * The "alternate names" list. Adding one is AddAliasButton's job, and TuneView places that beside
 * the alternate-setting button rather than under the list: the two ways of contributing to a tune
 * belong together, and an always-open input read as part of whichever section it landed next to.
 */
export function TuneAliases({
  aliases,
  style,
}: {
  aliases: string[]
  style?: React.CSSProperties
}) {
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
    </div>
  )
}

/** The add-a-name button and the dialog it opens. Separate so it can sit in someone else's row. */
export function AddAliasButton({
  tuneId,
  aliases,
  onAdded,
  className,
  style,
  label = '+ Add an Alternate Name',
}: {
  tuneId: string
  aliases: string[]
  onAdded: () => void
  className?: string
  style?: React.CSSProperties
  label?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setIsOpen(false)
    setName('')
    setError(null)
  }

  const mutation = useMutation({
    mutationFn: (newName: string) => addTuneAlias(tuneId, newName),
    onSuccess: () => {
      close()
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
    <>
      <button className={className} style={style} onClick={() => setIsOpen(true)}>
        {label}
      </button>

      <Dialog
        isOpen={isOpen}
        title="Add an alternate name"
        onClose={close}
        // A half-typed name is worth a second click to discard, the way the setting form's Cancel is.
        onRequestClose={() => name.trim() === '' || confirm('Discard this alternate name?')}
        maxWidth="420px"
      >
        <form onSubmit={handleSubmit} className="add-alias-form">
          <label>
            Alternate name
            <input
              type="text"
              placeholder="e.g. The Maid Behind the Bar"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(null)
              }}
              disabled={mutation.isPending}
              data-autofocus
            />
          </label>

          {aliases.length > 0 && (
            <p className="tune-meta">Already listed: {aliases.join(', ')}</p>
          )}

          {error && <p className="error">{error}</p>}

          <div className="form-actions">
            <button type="button" className="secondary" onClick={close} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? 'Adding…' : 'Add Name'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
