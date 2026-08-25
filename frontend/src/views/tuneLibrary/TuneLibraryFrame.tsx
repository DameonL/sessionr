"use client";

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { useRouter } from '@/utils/routerCompat'
import { createTune, formatTuneType } from '../../services/api'
import {
  extractKeyFromAbc,
  extractTitleFromAbc,
  extractTuneTypeFromAbc,
  normalizeAbcHeaders,
  validateAbc,
} from '../../services/abcTools'
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
  const [addAbc, setAddAbc] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const detectedTitle = extractTitleFromAbc(addAbc)
  const detectedTuneType = extractTuneTypeFromAbc(addAbc)
  const detectedKey = extractKeyFromAbc(addAbc)

  const createTuneMutation = useMutation({
    mutationFn: (newTune: { title: string; tuneType: string; key: string; abc: string }) => createTune(newTune),
    onSuccess: (data) => {
      setShowAddModal(false)
      setAddAbc('')
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

  const handleAbcChange = (newAbc: string) => {
    setAddAbc(newAbc)
    if (addError) setAddError(null)
  }

  const handleAddTuneSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validation = validateAbc(addAbc)
    if (!validation.isValid) {
      setAddError(validation.error || 'Invalid ABC notation.')
      return
    }
    const { normalizedAbc, title, tuneType, key } = normalizeAbcHeaders(addAbc)
    createTuneMutation.mutate({
      title,
      tuneType,
      key,
      abc: normalizedAbc,
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
          !addAbc.trim()
            ? true
            : confirm('Discard this tune? What you have entered will be lost.')
        }
        maxWidth="540px"
      >
        <form onSubmit={handleAddTuneSubmit}>
          {/* ABC leads, because Title, Rhythm, and Key are read out of it as it is pasted. */}
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            ABC Notation
            <textarea
              placeholder="Paste ABC text here (must include T:, R:, and K: headers, e.g. T:My Tune, R:reel, K:D)..."
              value={addAbc}
              onChange={(e) => handleAbcChange(e.target.value)}
              rows={8}
              required
              className="abc-textarea"
              style={{ display: 'block', marginTop: '0.35rem' }}
            />
          </label>

          {/* Read-only detected properties section */}
          <div className="new-setting-meta" style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--card-bg, #1e1e1e)', borderRadius: '6px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Detected ABC Properties:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.9rem' }}>
              <div>Title (T:): <strong>{detectedTitle || '(Required - e.g. T: The Maid Behind The Bar)'}</strong></div>
              <div>Rhythm / Type (R:): <strong>{detectedTuneType ? `${formatTuneType(detectedTuneType)} (R: ${extractRhythmFromAbc(addAbc)})` : '(Required - e.g. R: reel)'}</strong></div>
              <div>Key (K:): <strong>{detectedKey || '(Required - e.g. K: D)'}</strong></div>
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

