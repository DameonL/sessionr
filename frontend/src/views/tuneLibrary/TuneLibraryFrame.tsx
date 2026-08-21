"use client";

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { useRouter } from '@/utils/routerCompat'
import { createTune, formatTuneType, TUNE_TYPES } from '../../services/api'
import { extractKeyFromAbc, extractTitleFromAbc, validateAbc } from '../../services/abcTools'
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
  const [addError, setAddError] = useState<string | null>(null)
  const lastAutoTitleRef = useRef('')

  const createTuneMutation = useMutation({
    mutationFn: (newTune: { title: string; tuneType: string; key: string; abc: string }) => createTune(newTune),
    onSuccess: (data) => {
      setShowAddModal(false)
      setAddTitle('')
      setAddAbc('')
      setAddError(null)
      lastAutoTitleRef.current = ''
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

  const handleAbcChange = (newAbc: string) => {
    setAddAbc(newAbc)
    // Auto-fill the title from the ABC's T: header, mirroring how Key is auto-derived below —
    // but only while the title still matches what we last auto-filled, so a manual edit sticks.
    if (addTitle.trim() === '' || addTitle === lastAutoTitleRef.current) {
      const detected = extractTitleFromAbc(newAbc)
      lastAutoTitleRef.current = detected
      setAddTitle(detected)
    }
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
    const derivedKey = extractKeyFromAbc(trimmedAbc)
    if (!derivedKey) {
      setAddError('The key could not be read from the ABC. Please include a K: header, e.g. K:G.')
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
      <Dialog
        isOpen={showAddModal}
        title="Add a New Tune"
        onClose={() => setShowAddModal(false)}
        // A pasted tune is easy to lose to a stray click on the backdrop and tedious to re-fetch.
        onRequestClose={() =>
          !addAbc.trim() && !addTitle.trim()
            ? true
            : confirm('Discard this tune? What you have entered will be lost.')
        }
        maxWidth="540px"
      >
        <form onSubmit={handleAddTuneSubmit}>
          {/* ABC leads, because Title and Key are read out of it as it is pasted. */}
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            ABC Notation
            <textarea
              placeholder="Paste ABC text here (must include K: header, e.g. K:D)..."
              value={addAbc}
              onChange={(e) => handleAbcChange(e.target.value)}
              rows={8}
              required
              className="abc-textarea"
              style={{ display: 'block', marginTop: '0.35rem' }}
            />
          </label>

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

          <div className="form-row" style={{ marginBottom: '1rem', alignItems: 'end' }}>
            <label>
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
            {/* The key that will actually be saved, which was invisible until after submitting. */}
            <div className="new-setting-meta" style={{ flex: 1 }}>
              <span>Key: <strong>{extractKeyFromAbc(addAbc) || 'Read from the K: header'}</strong></span>
            </div>
          </div>

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
