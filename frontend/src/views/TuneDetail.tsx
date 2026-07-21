"use client";

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  TUNE_STATUSES,
  formatTuneType,
  getRepertoire,
  isToday,
  logPractice,
  parseServerDate,
  removeFromRepertoire,
  updateUserTune,
} from '../services/api'
import { currentUserId, useSignal } from '../state/appState'
import { foldAbcOctaves, transposeAbc } from '../services/abcTools'
import { TuneSettingsModal } from '../components/TuneSettingsModal'

// Dynamically import TunePlayer to prevent abcjs SSR errors
const TunePlayer = dynamic(() => import('../components/TunePlayer').then((m) => m.TunePlayer), { ssr: false })

const FOLD_NOTE_OPTIONS = [
  { midi: 55, name: 'G3 (lowest fiddle G)' },
  { midi: 62, name: 'D4 (fiddle open D)' },
  { midi: 64, name: 'E4' },
  { midi: 69, name: 'A4' },
  { midi: 76, name: 'E5' },
  { midi: 83, name: 'B5 (typical range max)' },
  { midi: 88, name: 'E6' },
]

const TRANSPOSE_KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function TuneDetail({ userTuneId }: { userTuneId?: string }) {
  const id = userTuneId ?? ''
  const userId = useSignal(currentUserId)
  const router = useRouter()
  const queryClient = useQueryClient()

  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: () => getRepertoire(),
  })
  const item = repertoire.data?.items?.find((i) => i.userTuneId === id)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
    queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
  }

  const [editingAbc, setEditingAbc] = useState<string | null>(null)
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  const updateMutation = useMutation({
    mutationFn: (patch: { status?: string; targetBpm?: number; customAbcText?: string }) =>
      updateUserTune(id, patch),
    onSuccess: invalidate,
  })
  const saveAbcMutation = useMutation({
    mutationFn: (customAbcText: string) => updateUserTune(id, { customAbcText }),
    onSuccess: () => {
      invalidate()
      setEditingAbc(null)
    },
  })
  const practiceMutation = useMutation({
    mutationFn: () => logPractice(id),
    onSuccess: invalidate,
  })
  const removeMutation = useMutation({
    mutationFn: () => removeFromRepertoire(id),
    onSuccess: () => {
      invalidate()
      router.push('/repertoire')
    },
  })

  if (repertoire.isLoading) {
    return <p>Loading…</p>
  }
  if (repertoire.isError) {
    return <p className="error">Could not load the tune.</p>
  }
  const practicedToday = item?.lastPracticed != null && isToday(item.lastPracticed)

  if (!item) {
    return (
      <section>
        <p>This tune is not in the repertoire.</p>
        <Link href="/repertoire">← Back to repertoire</Link>
      </section>
    )
  }

  return (
    <section>
      <Link href="/repertoire">← Repertoire</Link>
      <div className="set-header">
        <h1>{item.title}</h1>
        <span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
      </div>
      <p className="tune-meta">
        {formatTuneType(item.tuneType)} · {item.key}
        {item.hasCustomAbc && ' · custom setting'}
      </p>

      {editingAbc === null ? (
        <>
          <TunePlayer abc={item.abc} />
          <div className="detail-controls">
            <button onClick={() => setEditingAbc(item.abc)}>✎ Edit setting</button>
            <button className="secondary" onClick={() => setShowSettingsModal(true)}>⚙ Alternate Settings & Names</button>
            {item.hasCustomAbc && (
              <button onClick={() => saveAbcMutation.mutate('')}>Revert to master setting</button>
            )}
          </div>
        </>
      ) : (
        <AbcEditor
          value={editingAbc}
          onChange={setEditingAbc}
          onSave={() => saveAbcMutation.mutate(editingAbc)}
          onCancel={() => setEditingAbc(null)}
          saving={saveAbcMutation.isPending}
          error={saveAbcMutation.isError ? (saveAbcMutation.error as Error).message : null}
        />
      )}

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
          <input
            type="number"
            min="40"
            max="200"
            value={item.targetBpm ?? ''}
            onChange={(e) => {
              const bpm = Number(e.target.value)
              if (bpm) updateMutation.mutate({ targetBpm: bpm })
            }}
          />
        </label>
        <button
          className={practicedToday ? 'toggled' : ''}
          disabled={practicedToday || practiceMutation.isPending}
          onClick={() => practiceMutation.mutate()}
        >
          {practicedToday ? '✓ Practiced today' : 'Mark practiced'}
        </button>
        <button className="danger" onClick={() => removeMutation.mutate()}>
          Remove
        </button>
      </div>
      <p className="tune-meta">
        {item.lastPracticed
          ? `Last practiced ${parseServerDate(item.lastPracticed).toLocaleDateString()}`
          : 'Never practiced'}
      </p>
      {removeMutation.isError && <p className="error">{(removeMutation.error as Error).message}</p>}
      {showSettingsModal && (
        <TuneSettingsModal
          tuneId={item.tuneId}
          userId={userId}
          userTuneId={item.userTuneId}
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
  const [transposeKey, setTransposeKey] = useState('D')
  const [foldMin, setFoldMin] = useState('62')
  const [foldMax, setFoldMax] = useState('83')

  useEffect(() => {
    const handle = setTimeout(() => setPreviewAbc(value), 300)
    return () => clearTimeout(handle)
  }, [value])

  const handleTranspose = () => {
    const transposed = transposeAbc(value, transposeKey)
    onChange(transposed)
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
          <label>
            Transpose to
            <select value={transposeKey} onChange={(e) => setTransposeKey(e.target.value)}>
              {TRANSPOSE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button onClick={handleTranspose}>Transpose</button>
        </div>

        <div className="editor-tool-group">
          <label>
            Fold Min
            <select value={foldMin} onChange={(e) => setFoldMin(e.target.value)}>
              {FOLD_NOTE_OPTIONS.map((opt) => (
                <option key={opt.midi} value={opt.midi}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fold Max
            <select value={foldMax} onChange={(e) => setFoldMax(e.target.value)}>
              {FOLD_NOTE_OPTIONS.map((opt) => (
                <option key={opt.midi} value={opt.midi}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={handleFold}>Fold</button>
        </div>
      </div>

      <p className="tune-meta">
        Live preview below. Tip: chord symbols like "G" before a note make the chord and bass
        instruments audible during playback.
      </p>
      <TunePlayer abc={previewAbc} targetBpm={targetBpm} />
      <div className="detail-controls">
        <button onClick={onSave} disabled={saving || !value.trim()}>
          {saving ? 'Saving…' : 'Save setting'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
