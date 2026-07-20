import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSet,
  deleteSet,
  formatTuneType,
  getRepertoire,
  getSets,
  suggestNextTune,
  updateSet,
  type RepertoireItem,
  type TuneSet,
} from '../services/api.ts'
import { SetPlayer } from '../components/SetPlayer.tsx'
import { currentUserId } from '../state/appState.ts'
import { parseSuggestionReason } from '../services/suggestions.ts'

interface DraftItem {
  userTuneId: number
  title: string
  tuneType: string
  key: string
  repetitions: number
}

interface Draft {
  setId: number | null
  title: string
  items: DraftItem[]
}

const DEFAULT_REPETITIONS = 3

export function SetBuilder() {
  const userId = currentUserId.value
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)

  const sets = useQuery({ queryKey: ['sets', userId], queryFn: () => getSets(userId) })
  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: () => getRepertoire(userId),
  })

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => {
      const items = d.items.map(({ userTuneId, repetitions }) => ({ userTuneId, repetitions }))
      return d.setId === null
        ? createSet(userId, d.title, items)
        : updateSet(d.setId, d.title, items)
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['sets', userId] })
      queryClient.invalidateQueries({ queryKey: ['set', saved.setId] })
      setDraft(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: deleteSet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sets', userId] })
      setDraft(null)
    },
  })

  const startEdit = (set: TuneSet) =>
    setDraft({
      setId: set.setId,
      title: set.title,
      items: set.items.map(({ userTuneId, title, tuneType, key, repetitions }) => ({
        userTuneId,
        title,
        tuneType,
        key,
        repetitions,
      })),
    })

  if (draft) {
    return (
      <SetEditor
        draft={draft}
        setDraft={setDraft}
        repertoire={repertoire.data ?? []}
        available={(repertoire.data ?? []).filter(
          (r) => !draft.items.some((i) => i.userTuneId === r.userTuneId),
        )}
        onSave={() => saveMutation.mutate(draft)}
        onCancel={() => setDraft(null)}
        saving={saveMutation.isPending}
        error={saveMutation.isError ? (saveMutation.error as Error).message : null}
      />
    )
  }

  return (
    <section>
      <h1>Set Builder</h1>
      <button onClick={() => setDraft({ setId: null, title: '', items: [] })}>+ New set</button>

      {sets.isLoading && <p>Loading…</p>}
      {(sets.data ?? []).map((set) => (
        <div key={set.setId} class="card set-card">
          <div class="set-header">
            <h2>
              <a class="quiet-link" href={`/set/${set.setId}`}>{set.title}</a>
            </h2>
            <span class="tune-meta">{set.analysis.totalPlaytime} min</span>
          </div>
          <ol class="set-tunes">
            {set.items.map((item) => (
              <li key={item.userTuneId}>
                {item.title}{' '}
                <span class="tune-meta">
                  ({formatTuneType(item.tuneType)}, {item.key}) × {item.repetitions}
                </span>
              </li>
            ))}
          </ol>
          {set.analysis.transitions.length > 0 && (
            <ul class="transitions">
              {set.analysis.transitions.map((t) => (
                <li key={`${t.fromTitle}-${t.toTitle}`} class="tune-meta">
                  {t.fromKey} → {t.toKey}: {t.label}
                </li>
              ))}
            </ul>
          )}
          <div class="detail-controls">
            <a href={`/set/${set.setId}`}>
              <button>▶ View &amp; play</button>
            </a>
            <button onClick={() => startEdit(set)}>Edit</button>
            <button class="danger" onClick={() => deleteMutation.mutate(set.setId)}>
              Delete
            </button>
          </div>
        </div>
      ))}
      {!sets.isLoading && (sets.data ?? []).length === 0 && (
        <p>No sets yet — build your first medley.</p>
      )}
    </section>
  )
}

function SetEditor({
  draft,
  setDraft,
  repertoire,
  available,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  repertoire: RepertoireItem[]
  available: Omit<DraftItem, 'repetitions'>[]
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const userId = currentUserId.value
  const draftIds = draft.items.map((i) => i.userTuneId)
  const suggestions = useQuery({
    queryKey: ['suggest-next', userId, draftIds.join('-')],
    queryFn: () => suggestNextTune(userId, draftIds),
  })

  const addItem = (item: Omit<DraftItem, 'repetitions'>) =>
    setDraft({
      ...draft,
      items: [...draft.items, { ...item, repetitions: DEFAULT_REPETITIONS }],
    })

  const previewItems = draft.items
    .map((item) => ({
      userTuneId: item.userTuneId,
      title: item.title,
      abc: repertoire.find((r) => r.userTuneId === item.userTuneId)?.abc ?? '',
      repetitions: item.repetitions,
    }))
    .filter((item) => item.abc)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length) return
    const items = [...draft.items]
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    setDraft({ ...draft, items })
  }

  const setRepetitions = (index: number, repetitions: number) => {
    const items = draft.items.map((item, i) =>
      i === index ? { ...item, repetitions: Math.min(Math.max(repetitions, 1), 9) } : item,
    )
    setDraft({ ...draft, items })
  }

  return (
    <section>
      <h1>{draft.setId === null ? 'New set' : 'Edit set'}</h1>
      <input
        class="search-box"
        type="text"
        placeholder="Set title"
        value={draft.title}
        onInput={(e) => setDraft({ ...draft, title: (e.target as HTMLInputElement).value })}
      />

      <h2>Tunes in this set</h2>
      {draft.items.length === 0 && <p class="tune-meta">Add tunes from your repertoire below.</p>}
      <ol class="set-tunes">
        {draft.items.map((item, index) => (
          <li
            key={item.userTuneId}
            class={`card tune-row draggable ${dragIndex === index ? 'dragging' : ''}`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== index) {
                move(dragIndex, index)
                setDragIndex(index)
              }
            }}
          >
            <span class="drag-handle">⋮⋮</span>
            <span class="tune-title">{item.title}</span>
            <span class="tune-meta">
              {formatTuneType(item.tuneType)} · {item.key}
            </span>
            <label class="reps-label">
              ×
              <input
                class="reps-input"
                type="number"
                min="1"
                max="9"
                value={item.repetitions}
                aria-label={`Times through ${item.title}`}
                onChange={(e) =>
                  setRepetitions(index, Number((e.target as HTMLInputElement).value) || 1)
                }
              />
            </label>
            <span class="row-buttons">
              <button onClick={() => move(index, index - 1)} aria-label="Move up">▲</button>
              <button onClick={() => move(index, index + 1)} aria-label="Move down">▼</button>
              <button
                class="danger"
                onClick={() =>
                  setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })
                }
                aria-label="Remove"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>

      {previewItems.length > 0 && (
        <>
          <h2>Preview set</h2>
          <SetPlayer items={previewItems} />
        </>
      )}

      {(suggestions.data ?? []).length > 0 && (
        <>
          <h2>{draft.items.length === 0 ? 'Suggested openers' : 'Suggested next'}</h2>
          <ul class="tune-list">
            {suggestions.data!.map((s) => (
              <li key={s.userTuneId} class="card tune-row suggestion">
                <span class="tune-title">
                  {s.title}
                  <span class="tune-meta"> {formatTuneType(s.tuneType)} · {s.key}</span>
                  <br />
                  <span class="tune-meta suggestion-reason">
                    {parseSuggestionReason(s.reason).map((piece, idx) => (
                      <span key={idx}>
                        {idx > 0 && ' · '}
                        <span class="tooltip" data-tooltip={piece.tooltip}>
                          {piece.text}
                        </span>
                      </span>
                    ))}
                  </span>
                </span>
                <button
                  onClick={() =>
                    addItem({ userTuneId: s.userTuneId, title: s.title, tuneType: s.tuneType, key: s.key })
                  }
                >
                  + Add
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Your repertoire</h2>
      <ul class="tune-list">
        {available.map((item) => (
          <li key={item.userTuneId} class="card tune-row">
            <span class="tune-title">{item.title}</span>
            <span class="tune-meta">
              {formatTuneType(item.tuneType)} · {item.key}
            </span>
            <button onClick={() => addItem(item)}>+ Add</button>
          </li>
        ))}
      </ul>

      <div class="detail-controls">
        <button onClick={onSave} disabled={saving || !draft.title || draft.items.length === 0}>
          {saving ? 'Saving…' : 'Save set'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {error && <p class="error">{error}</p>}
    </section>
  )
}
