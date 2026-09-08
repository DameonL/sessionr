"use client";

import { lazy, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@/utils/routerCompat'
import Link from '@/utils/routerCompat'
import dynamic from '@/utils/routerCompat'
import {
  TUNE_STATUSES,
  formatTuneType,
  getRepertoireItem,
  isToday,
  logPractice,
  parseServerDate,
  removeFromRepertoire,
  updateUserTune,
} from '../services/api'
import { currentUserId, showToast, useSignal } from '../state/appState'
import { extractKeyFromAbc, foldAbcOctaves, transposeAbcBySemitones } from '../services/abcTools'
import { showBadgeToasts } from '../services/badges'
import { TuneSettingsModal } from '../components/TuneSettingsModal'
import { DebouncedNumberInput } from '../components/DebouncedNumberInput'
import { Spinner } from '../components/Spinner'

// Dynamically import TunePlayer to prevent abcjs SSR errors
const TunePlayer = lazy(() => import('../components/TunePlayer').then((m) => ({ default: m.TunePlayer })))

// The parenthetical guidance lives in `hint` rather than the option text: as option text it made
// the two fold selects wide enough to wrap the whole tool row onto a second line on a phone.
const FOLD_NOTE_OPTIONS = [
  { midi: 55, name: 'G3', hint: 'lowest fiddle G' },
  { midi: 62, name: 'D4', hint: 'fiddle open D' },
  { midi: 64, name: 'E4', hint: '' },
  { midi: 69, name: 'A4', hint: '' },
  { midi: 76, name: 'E5', hint: '' },
  { midi: 83, name: 'B5', hint: 'typical range max' },
  { midi: 88, name: 'E6', hint: '' },
]

const foldOptionLabel = (opt: { name: string; hint: string }) =>
  opt.hint ? `${opt.name} — ${opt.hint}` : opt.name

export function TuneDetail({ userTuneId }: { userTuneId?: string }) {
  const id = userTuneId ?? ''
  const userId = useSignal(currentUserId)
  const router = useRouter()
  const queryClient = useQueryClient()

  const itemQuery = useQuery({
    queryKey: ['repertoire-item', id],
    queryFn: () => getRepertoireItem(id),
    enabled: id !== '',
    retry: false,
  })
  const item = itemQuery.data

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['repertoire-item', id] })
    queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
    queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
  }

  const [editingAbc, setEditingAbc] = useState<string | null>(null)
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  const updateMutation = useMutation({
    mutationFn: (patch: { status?: string; targetBpm?: number; customAbcText?: string }) =>
      updateUserTune(id, patch),
    onSuccess: invalidate,
    // These controls write on change with nothing to click again, so a failure has to announce
    // itself — otherwise the select just snaps back and the change looks like it never happened.
    onError: (err: Error) => showToast(err.message || 'Could not save that change.', 'error'),
  })
  const saveAbcMutation = useMutation({
    mutationFn: (customAbcText: string) => updateUserTune(id, { customAbcText }),
    onSuccess: (_data, customAbcText) => {
      invalidate()
      setEditingAbc(null)
      showToast(customAbcText === '' ? 'Reverted to the master setting.' : 'Setting saved.', 'success')
    },
  })
  const practiceMutation = useMutation({
    mutationFn: () => logPractice(id),
    onSuccess: (data) => {
      invalidate()
      showBadgeToasts(data.newBadges)
    },
  })
  const removeMutation = useMutation({
    mutationFn: () => removeFromRepertoire(id),
    onSuccess: () => {
      invalidate()
      router.push('/repertoire')
    },
  })

  if (itemQuery.isLoading) {
    return <div className="spinner-row"><Spinner /></div>
  }
  if (itemQuery.isError) {
    const notFound = (itemQuery.error as Error).message.includes('404')
    if (!notFound) {
      return <p className="error">Could not load the tune: {(itemQuery.error as Error).message}</p>
    }
  }
  if (!item) {
    return (
      <section>
        <p>This tune is not in the repertoire.</p>
        <Link href="/repertoire" prefetch={false}>← Back to repertoire</Link>
      </section>
    )
  }
  const practicedToday = item.lastPracticed != null && isToday(item.lastPracticed)
  const effectiveAbc = item.abcText ?? item.abc ?? ''

  return (
    <section>
      <Link href="/repertoire" prefetch={false}>← Repertoire</Link>
      <div className="set-header">
        <h1>{item.title}</h1>
        <span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
      </div>
      <p className="tune-meta">
        {formatTuneType(item.tuneType)} · {item.key}
        {item.hasCustomAbc
          ? ' · custom setting'
          : item.settingSubmitterName
            ? ` · setting by ${item.settingSubmitterName}${item.isPinnedSetting ? '' : ' (community default)'}`
            : ''}
      </p>

      {editingAbc === null ? (
        <>
          <TunePlayer
            abc={effectiveAbc}
            tuneId={item.userTuneId}
            targetBpm={item.targetBpm}
            tuneType={item.tuneType}
            onLogPractice={() => practiceMutation.mutate()}
            isPracticedToday={practicedToday}
            isLoggingPractice={practiceMutation.isPending}
            logPracticeLabel="✓ Mark practiced"
          />
          <div className="detail-controls">
            <button onClick={() => setEditingAbc(effectiveAbc)}>✎ Edit setting</button>
            <button className="secondary" onClick={() => setShowSettingsModal(true)}>⚙ Alternate Settings & Names</button>
            {item.hasCustomAbc && (
              <button
                disabled={saveAbcMutation.isPending}
                onClick={() => {
                  // The custom setting is the only copy of whatever the user edited into it.
                  if (confirm('Discard your custom setting and go back to the master setting?')) {
                    saveAbcMutation.mutate('')
                  }
                }}
              >
                Revert to master setting
              </button>
            )}
          </div>
        </>
      ) : (
        <AbcEditor
          value={editingAbc}
          onChange={setEditingAbc}
          onSave={() => saveAbcMutation.mutate(editingAbc)}
          onCancel={() => {
            if (editingAbc === effectiveAbc || confirm('Discard your unsaved changes to this setting?')) {
              setEditingAbc(null)
            }
          }}
          saving={saveAbcMutation.isPending}
          error={saveAbcMutation.isError ? (saveAbcMutation.error as Error).message : null}
          targetBpm={item.targetBpm}
        />
      )}

      {/* Editing is a mode: these would otherwise sit live under the open editor, putting Remove
          directly below the editor's Cancel. */}
      {editingAbc === null && (
        <>
          <div className="detail-controls">
            <label>
              Status
              <select
                value={item.status}
                onChange={(e) =>
                  updateMutation.mutate({ status: e.target.value })
                }
              >
                {TUNE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target BPM
              <DebouncedNumberInput
                min={40}
                max={200}
                value={item.targetBpm ?? null}
                onChange={(bpm) => {
                  if (bpm !== null) updateMutation.mutate({ targetBpm: bpm })
                }}
              />
            </label>
          </div>
          <p className="tune-meta">
            {item.lastPracticed
              ? `Last practiced ${parseServerDate(item.lastPracticed).toLocaleDateString()}`
              : 'Never practiced'}
          </p>

          <div className="danger-zone">
            <button
              className="danger"
              disabled={removeMutation.isPending}
              onClick={() => {
                // Takes the practice history and any custom setting with it, and navigates away.
                if (confirm(`Remove "${item.title}" from your repertoire? This also discards its practice history.`)) {
                  removeMutation.mutate()
                }
              }}
            >
              Remove from repertoire
            </button>
            <p className="tune-meta">
              Discards this tune's practice history and any custom setting. This cannot be undone.
            </p>
            {removeMutation.isError && <p className="error">{(removeMutation.error as Error).message}</p>}
          </div>
        </>
      )}
      {showSettingsModal && (
        <TuneSettingsModal
          tuneId={item.tuneId}
          userTuneId={item.userTuneId}
          currentTuneSettingId={item.tuneSettingId}
          isPinnedSetting={item.isPinnedSetting}
          onClose={() => setShowSettingsModal(false)}
          onAdded={invalidate}
        />
      )}
    </section>
  )
}

function AbcEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  targetBpm,
}: {
  value: string
  onChange: (abc: string) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
  targetBpm?: number | null
}) {
  const [previewAbc, setPreviewAbc] = useState(value)
  const [foldMin, setFoldMin] = useState('62')
  const [foldMax, setFoldMax] = useState('83')

  useEffect(() => {
    const handle = setTimeout(() => setPreviewAbc(value), 300)
    return () => clearTimeout(handle)
  }, [value])

  const stepTranspose = (semitones: number) => {
    onChange(transposeAbcBySemitones(value, semitones))
  }

  const handleFold = () => {
    const folded = foldAbcOctaves(value, Number(foldMin), Number(foldMax))
    onChange(folded)
  }

  return (
    <div className="abc-editor">
      <textarea
        className="abc-textarea"
        rows={12}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      <div className="editor-tools">
        <div className="editor-tool-group">
          <span className="editor-tool-label">Transpose</span>
          <div className="vote-controls">
            <button
              className="vote-btn"
              onClick={() => stepTranspose(-1)}
              title="Down a semitone"
              aria-label="Transpose down a semitone"
            >
              ▼
            </button>
            <span className="vote-score transpose-key">{extractKeyFromAbc(value) || '—'}</span>
            <button
              className="vote-btn"
              onClick={() => stepTranspose(1)}
              title="Up a semitone"
              aria-label="Transpose up a semitone"
            >
              ▲
            </button>
          </div>
        </div>

        <div className="editor-tool-group">
          <span className="editor-tool-label">Fold to</span>
          <select
            value={foldMin}
            onChange={(e) => setFoldMin(e.target.value)}
            aria-label="Fold: lowest note"
            title="Notes below this are moved up an octave"
          >
            {FOLD_NOTE_OPTIONS.map((opt) => (
              <option key={opt.midi} value={opt.midi}>
                {foldOptionLabel(opt)}
              </option>
            ))}
          </select>
          <span className="editor-tool-label">to</span>
          <select
            value={foldMax}
            onChange={(e) => setFoldMax(e.target.value)}
            aria-label="Fold: highest note"
            title="Notes above this are moved down an octave"
          >
            {FOLD_NOTE_OPTIONS.map((opt) => (
              <option key={opt.midi} value={opt.midi}>
                {foldOptionLabel(opt)}
              </option>
            ))}
          </select>
          <button onClick={handleFold}>Fold</button>
        </div>
      </div>

      {/* Sticky, so it stays in reach while the preview below is scrolled. */}
      <div className="editor-actions">
        <button onClick={onSave} disabled={saving || !value.trim()}>
          {saving ? 'Saving…' : 'Save setting'}
        </button>
        <button onClick={onCancel}>Cancel</button>
        {error && <span className="error">{error}</span>}
      </div>

      <h3 className="editor-preview-heading">Preview</h3>
      <p className="tune-meta">
        Tip: chord symbols like "G" before a note make the chord and bass instruments audible
        during playback.
      </p>
      <TunePlayer abc={previewAbc} targetBpm={targetBpm} />
    </div>
  )
}


