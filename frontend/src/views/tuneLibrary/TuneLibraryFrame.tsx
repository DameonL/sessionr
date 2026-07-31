"use client";

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createTune, formatTuneType, TUNE_TYPES } from '../../services/api'
import { extractKeyFromAbc, validateAbc } from '../../services/abcTools'
import { useAuthStatus, showToast } from '../../state/appState'
import { Dialog } from '../../components/Dialog'

type LibraryTab = 'search' | 'popular' | 'newest'

const TABS: { id: LibraryTab; href: string; label: string }[] = [
  { id: 'search', href: '/tunes', label: '🔍 Search' },
  { id: 'popular', href: '/tunes/popular', label: '🔥 Most Popular' },
  { id: 'newest', href: '/tunes/newest', label: '✨ Newest' },
]

/**
 * Shared chrome for the tune library views: page header, the "+ Add a Tune"
 * flow, and the tab navigation. Each tab is its own route (see src/app/tunes),
 * so this is a plain component rather than a Next layout — the sibling
 * /tunes/[tuneId] detail route must not inherit this chrome.
 */
export function TuneLibraryFrame({ active, children }: { active: LibraryTab; children: React.ReactNode }) {
  const router = useRouter()
  const authStatus = useAuthStatus()

  const [showAddModal, setShowAddModal] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addType, setAddType] = useState('Reel')
  const [addAbc, setAddAbc] = useState('')
  const [addKeyOverride, setAddKeyOverride] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

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

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border, #333)', paddingBottom: '0.5rem' }}>
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            prefetch={false}
            className={active === tab.id ? '' : 'secondary'}
            role="button"
            style={{ padding: '0.4rem 1rem', textDecoration: 'none' }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {children}

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
