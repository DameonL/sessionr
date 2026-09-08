"use client";

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import {
  formatTuneType,
  moderatorDeleteTune,
  moderatorUpdateTune,
  type TuneDetails,
} from '../services/api'
import { currentUserProfile, useSignal, showToast } from '../state/appState'
import { useRouter } from '@/utils/routerCompat'
import { Dialog } from '../components/Dialog'
import { TuneView } from '../components/TuneView'

/**
 * Public, login-agnostic tune page: view every setting, play and practice along, no account needed.
 *
 * The tune itself is TuneView, the same component the settings modal renders, so the two stay in
 * step. What is left here belongs to this page alone: the way back to the library, and the
 * moderator's master-tune tools.
 */
export function TuneLibraryDetail({ tuneId }: { tuneId?: string }) {
  const id = tuneId ?? ''
  const profile = useSignal(currentUserProfile)
  const isModerator = !!profile?.isModerator
  const router = useRouter()
  const queryClient = useQueryClient()

  const [showEditModal, setShowEditModal] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState('')
  const [editKey, setEditKey] = useState('')
  const [editAbc, setEditAbc] = useState('')

  const deleteTuneMutation = useMutation({
    mutationFn: () => moderatorDeleteTune(id),
    onSuccess: () => {
      showToast('Tune deleted permanently.', 'info')
      router.push('/tunes')
    },
    onError: (err: Error) => showToast(err.message || 'Failed to delete tune.', 'error'),
  })

  const updateTuneMutation = useMutation({
    mutationFn: () =>
      moderatorUpdateTune(id, {
        title: editTitle.trim(),
        tuneType: editType.trim(),
        key: editKey.trim(),
        masterAbcText: editAbc,
      }),
    onSuccess: () => {
      // The tune is TuneView's query now, so an edit here has to tell it to read the tune again.
      queryClient.invalidateQueries({ queryKey: ['tune-details', id] })
      setShowEditModal(false)
      showToast('Master tune updated.', 'success')
    },
    onError: (err: Error) => showToast(err.message || 'Failed to update tune.', 'error'),
  })

  const header = (details: TuneDetails) => (
    <div
      className="set-header"
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}
    >
      <div>
        <h1 style={{ margin: 0 }}>{details.title}</h1>
        <span className="tune-meta">{formatTuneType(details.tuneType)} · {details.key}</span>
      </div>

      {isModerator && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="secondary"
            onClick={() => {
              setEditTitle(details.title)
              setEditType(details.tuneType)
              setEditKey(details.key)
              setEditAbc(details.settings[0]?.abcText ?? '')
              setShowEditModal(true)
            }}
          >
            ✏️ Edit Master Tune
          </button>
          <button
            className="secondary danger-hover"
            onClick={() => {
              if (confirm(`Are you sure you want to permanently delete "${details.title}"?`)) {
                deleteTuneMutation.mutate()
              }
            }}
            disabled={deleteTuneMutation.isPending}
          >
            🗑️ Delete Tune
          </button>
        </div>
      )}
    </div>
  )

  return (
    <section>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/tunes" prefetch={false}>← Tune Library</Link>
      </div>

      <TuneView tuneId={id} variant="page" header={header} />

      <Dialog
        isOpen={showEditModal}
        title={`Edit Master Tune: ${editTitle}`}
        onClose={() => setShowEditModal(false)}
        maxWidth="650px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label>
            Title
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              Tune Type
              <input type="text" value={editType} onChange={(e) => setEditType(e.target.value)} required />
            </label>
            <label>
              Key
              <input type="text" value={editKey} onChange={(e) => setEditKey(e.target.value)} required />
            </label>
          </div>
          <label>
            Master ABC Notation
            <textarea
              className="abc-textarea"
              rows={8}
              value={editAbc}
              onChange={(e) => setEditAbc(e.target.value)}
              required
            />
          </label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setShowEditModal(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => updateTuneMutation.mutate()}
              disabled={updateTuneMutation.isPending || !editTitle.trim() || !editAbc.trim()}
            >
              {updateTuneMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
