import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  formatTuneType,
  getRepertoire,
  isToday,
  logPractice,
  parseServerDate,
  removeFromRepertoire,
  updateUserTune,
  TUNE_STATUSES,
} from '../services/api.ts'
import { currentUserId } from '../state/appState.ts'
import { TunePlayer } from '../components/TunePlayer.tsx'
import { transposeAbc, foldAbcOctaves } from '../services/abcTools.ts'

const FOLD_NOTE_OPTIONS = [
  { midi: 55, name: 'G3 (low G)' },
  { midi: 57, name: 'A3' },
  { midi: 59, name: 'B3' },
  { midi: 60, name: 'C4 (Middle C)' },
  { midi: 62, name: 'D4 (whistle low D)' },
  { midi: 64, name: 'E4' },
  { midi: 65, name: 'F4' },
  { midi: 67, name: 'G4' },
  { midi: 69, name: 'A4' },
  { midi: 71, name: 'B4' },
  { midi: 72, name: 'C5' },
  { midi: 74, name: 'D5' },
  { midi: 76, name: 'E5' },
  { midi: 77, name: 'F5' },
  { midi: 79, name: 'G5' },
  { midi: 81, name: 'A5' },
  { midi: 83, name: 'B5 (whistle high B)' },
  { midi: 84, name: 'C6' },
  { midi: 86, name: 'D6' },
  { midi: 88, name: 'E6' },
  { midi: 91, name: 'G6' },
]

const TRANSPOSE_KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

/** Bookmarkable page for a single repertoire tune: /tune/{userTuneId} */
export function TuneDetail({ userTuneId }: { userTuneId?: string }) {
  const id = Number(userTuneId)
  const userId = currentUserId.value
  const { route } = useLocation()
  const queryClient = useQueryClient()

  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: () => getRepertoire(userId),
  })
  const item = repertoire.data?.find((i) => i.userTuneId === id)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
    queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
  }

  const [editingAbc, setEditingAbc] = useState<string | null>(null)

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
      route('/repertoire')
    },
  })

  if (repertoire.isLoading) {
    return <p>Loading…</p>
  }
  if (repertoire.isError) {
    return <p class="error">Could not load the tune.</p>
  }
  const practicedToday = item?.lastPracticed != null && isToday(item.lastPracticed)

  if (!item) {
    return (
      <section>
        <p>This tune is not in the repertoire.</p>
        <a href="/repertoire">← Back to repertoire</a>
      </section>
    )
  }

  return (
    <section>
      <a href="/repertoire">← Repertoire</a>
      <div class="set-header">
        <h1>{item.title}</h1>
        <span class={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
      </div>
      <p class="tune-meta">
        {formatTuneType(item.tuneType)} · {item.key}
        {item.hasCustomAbc && ' · custom setting'}
      </p>

      {editingAbc === null ? (
        <>
          <TunePlayer abc={item.abc} />
          <div class="detail-controls">
            <button onClick={() => setEditingAbc(item.abc)}>✎ Edit setting</button>
            {item.hasCustomAbc && (
              <button onClick={() => saveAbcMutation.mutate('')}>Revert to master setting</button>
            )}
          </div>
        </>
      ) : (
        <AbcEditor
          value={editingAbc}
          onInput={setEditingAbc}
          onSave={() => saveAbcMutation.mutate(editingAbc)}
          onCancel={() => setEditingAbc(null)}
          saving={saveAbcMutation.isPending}
          error={saveAbcMutation.isError ? (saveAbcMutation.error as Error).message : null}
        />
      )}

      <div class="detail-controls">
        <label>
          Status
          <select
            value={item.status}
            onChange={(e) =>
              updateMutation.mutate({ status: (e.target as HTMLSelectElement).value })
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
              const bpm = Number((e.target as HTMLInputElement).value)
              if (bpm) updateMutation.mutate({ targetBpm: bpm })
            }}
          />
        </label>
        <button
          class={practicedToday ? 'toggled' : ''}
          disabled={practicedToday || practiceMutation.isPending}
          onClick={() => practiceMutation.mutate()}
        >
          {practicedToday ? '✓ Practiced today' : 'Mark practiced'}
        </button>
        <button class="danger" onClick={() => removeMutation.mutate()}>
          Remove
        </button>
      </div>
      <p class="tune-meta">
        {item.lastPracticed
          ? `Last practiced ${parseServerDate(item.lastPracticed).toLocaleDateString()}`
          : 'Never practiced'}
      </p>
      {removeMutation.isError && <p class="error">{(removeMutation.error as Error).message}</p>}
    </section>
  )
}

/** ABC textarea with a debounced live notation preview. */
function AbcEditor({
  value,
  onInput,
  onSave,
  onCancel,
  saving,
  error,
  targetBpm,
}: {
  value: string
  onInput: (abc: string) => void
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
    onInput(transposed)
  }

  const handleFold = () => {
    const folded = foldAbcOctaves(value, Number(foldMin), Number(foldMax))
    onInput(folded)
  }

  return (
    <div class="abc-editor">
      <textarea
        class="abc-textarea"
        rows={12}
        spellcheck={false}
        value={value}
        onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
      />

      <div class="editor-tools">
        <div class="editor-tool-group">
          <label>
            Transpose to
            <select value={transposeKey} onChange={(e) => setTransposeKey((e.target as HTMLSelectElement).value)}>
              {TRANSPOSE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button onClick={handleTranspose}>Transpose</button>
        </div>

        <div class="editor-tool-group">
          <label>
            Fold Min
            <select value={foldMin} onChange={(e) => setFoldMin((e.target as HTMLSelectElement).value)}>
              {FOLD_NOTE_OPTIONS.map((opt) => (
                <option key={opt.midi} value={opt.midi}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fold Max
            <select value={foldMax} onChange={(e) => setFoldMax((e.target as HTMLSelectElement).value)}>
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

      <p class="tune-meta">
        Live preview below. Tip: chord symbols like "G" before a note make the chord and bass
        instruments audible during playback.
      </p>
      <TunePlayer abc={previewAbc} targetBpm={targetBpm} />
      <div class="detail-controls">
        <button onClick={onSave} disabled={saving || !value.trim()}>
          {saving ? 'Saving…' : 'Save setting'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {error && <p class="error">{error}</p>}
    </div>
  )
}
