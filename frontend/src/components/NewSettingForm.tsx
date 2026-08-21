"use client";

import { Suspense, lazy, useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { addTuneSetting } from '../services/api'
import { extractKeyFromAbc, validateAbc } from '../services/abcTools'
import { currentUserProfile, useSignal } from '../state/appState'
import { Spinner } from './Spinner'

// Dynamically import SheetMusic to prevent abcjs SSR errors
const SheetMusic = lazy(() => import('./SheetMusic').then((m) => ({ default: m.SheetMusic })))

/**
 * The "submit an alternate setting" form, shared by the settings modal and the library detail
 * page — they had drifting copies of it, and a fix to one silently missed the other.
 *
 * Shows the pasted ABC as sheet music while it is typed: every other place a setting is shown in
 * this app renders it, so submitting one blind was the odd case out.
 */
export function NewSettingForm({
  tuneId,
  fallbackKey,
  onSubmitted,
}: {
  tuneId: string
  /** Used when the pasted ABC has no readable K: header of its own. */
  fallbackKey?: string
  onSubmitted: () => void
}) {
  const profile = useSignal(currentUserProfile)
  const [showForm, setShowForm] = useState(false)
  const [abc, setAbc] = useState('')
  const [previewAbc, setPreviewAbc] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setPreviewAbc(abc), 300)
    return () => clearTimeout(handle)
  }, [abc])

  const mutation = useMutation({
    mutationFn: (newSetting: { key: string; abc: string; submitterName: string }) =>
      addTuneSetting(tuneId, newSetting.key, newSetting.abc, newSetting.submitterName),
    onSuccess: () => {
      setAbc('')
      setPreviewAbc('')
      setShowForm(false)
      setError(null)
      onSubmitted()
    },
    onError: (err: Error) => setError(err.message || 'Failed to submit setting.'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validation = validateAbc(abc)
    if (!validation.isValid) {
      setError(validation.error || 'Invalid ABC notation.')
      return
    }
    mutation.mutate({
      key: extractKeyFromAbc(validation.trimmedAbc) || fallbackKey || 'C',
      abc: validation.trimmedAbc,
      submitterName: profile?.displayName?.trim() || 'Anonymous',
    })
  }

  if (!showForm) {
    return (
      <button className="secondary w-full" onClick={() => setShowForm(true)}>
        + Submit an Alternate Setting
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="new-setting-form">
      <h4>Submit alternate setting</h4>
      <div className="new-setting-meta">
        <span>Key: <strong>{extractKeyFromAbc(abc) || fallbackKey || 'Auto-detected from K:'}</strong></span>
        <span>Submitter: <strong>{profile?.displayName || 'Anonymous'}</strong></span>
      </div>
      <label>
        ABC Notation
        <textarea
          className="abc-textarea"
          placeholder="Paste ABC text here..."
          value={abc}
          onChange={(e) => {
            setAbc(e.target.value)
            // Clear as they type; re-check when they leave the field, so the error tracks the
            // text rather than nagging mid-keystroke.
            if (error) setError(null)
          }}
          onBlur={() => {
            if (!abc.trim()) return
            const validation = validateAbc(abc)
            if (!validation.isValid) setError(validation.error || 'Invalid ABC notation.')
          }}
          rows={6}
          required
        />
      </label>

      {previewAbc.trim() && (
        <div className="setting-sheet-preview">
          <Suspense fallback={<div className="spinner-row"><Spinner /></div>}>
            <SheetMusic abcString={previewAbc} />
          </Suspense>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="secondary" onClick={() => setShowForm(false)}>
          Cancel
        </button>
        <button type="submit" disabled={mutation.isPending || !abc.trim()}>
          {mutation.isPending ? 'Submitting…' : 'Submit Setting'}
        </button>
      </div>
    </form>
  )
}
