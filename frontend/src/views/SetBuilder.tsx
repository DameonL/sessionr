"use client";

import { lazy, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import dynamic from '@/utils/routerCompat'
import {
  TUNE_STATUSES,
  TUNE_TYPES,
  createSet,
  deleteSet,
  formatTuneType,
  getFullRepertoire,
  getSets,
  suggestNextTune,
  updateSet,
  type RepertoireItem,
  type TuneSetSummary,
} from '../services/api'
import { currentUserId, useSignal } from '../state/appState'
import { parseSuggestionReason } from '../services/suggestions'
import { Spinner } from '../components/Spinner'

// Dynamically import SetPlayer to prevent abcjs SSR errors
const SetPlayer = lazy(() => import('../components/SetPlayer').then((m) => ({ default: m.SetPlayer })))

interface DraftItem {
  userTuneId: string
  title: string
  tuneType: string
  key: string
  repetitions: number
}

interface Draft {
  setId: string | null
  title: string
  items: DraftItem[]
  isCustomTitle?: boolean
}

function generateDefaultSetTitle(items: { title: string }[]): string {
  return items.map((i) => i.title).join(' / ')
}

const DEFAULT_REPETITIONS = 3

export function SetBuilder() {
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)

  const sets = useQuery({ queryKey: ['sets', userId], queryFn: () => getSets(), enabled: !!userId })
  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: getFullRepertoire,
    enabled: !!userId,
  })

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => {
      const items = d.items.map(({ userTuneId, repetitions }) => ({ userTuneId, repetitions }))
      return d.setId === null
        ? createSet(d.title, items)
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

  const startEdit = (set: TuneSetSummary) => {
    const items = set.items.map(({ userTuneId, title, tuneType, key, repetitions }) => ({
      userTuneId,
      title,
      tuneType,
      key,
      repetitions,
    }))
    const defaultTitle = generateDefaultSetTitle(items)
    setDraft({
      setId: set.setId,
      title: set.title,
      items,
      isCustomTitle: set.title !== defaultTitle,
    })
  }

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
      <button onClick={() => setDraft({ setId: null, title: '', items: [], isCustomTitle: false })}>+ New set</button>

      {sets.isPending && <div className="spinner-row"><Spinner /></div>}
      {(sets.data ?? []).map((set) => (
        <div key={set.setId} className="card set-card">
          <div className="set-header">
            <h2>
              <Link className="quiet-link" href={`/set/${set.setId}`} prefetch={false}>{set.title}</Link>
            </h2>
            <span className="tune-meta">{set.analysis.totalPlaytime} min</span>
          </div>
          <ol className="set-tunes">
            {set.items.map((item) => (
              <li key={item.userTuneId}>
                {item.title}{' '}
                <span className="tune-meta">
                  ({formatTuneType(item.tuneType)}, {item.key}) × {item.repetitions}
                </span>
              </li>
            ))}
          </ol>
          {set.analysis.transitions.length > 0 && (
            <ul className="transitions">
              {set.analysis.transitions.map((t) => (
                <li key={`${t.fromTitle}-${t.toTitle}`} className="tune-meta">
                  {t.fromKey} → {t.toKey}: {t.label}
                </li>
              ))}
            </ul>
          )}
          <div className="detail-controls">
            <Link href={`/set/${set.setId}`} prefetch={false}>
              <button>▶ View &amp; play</button>
            </Link>
            <button onClick={() => startEdit(set)}>Edit</button>
            <button className="danger" onClick={() => deleteMutation.mutate(set.setId)}>
              Delete
            </button>
          </div>
        </div>
      ))}
      {!sets.isPending && (sets.data ?? []).length === 0 && (
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
  available: RepertoireItem[]
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const userId = useSignal(currentUserId)
  const draftIds = draft.items.map((i) => i.userTuneId)
  const suggestions = useQuery({
    queryKey: ['suggest-next', userId, draftIds.join('-')],
    queryFn: () => suggestNextTune(draftIds),
    enabled: !!userId,
  })

  const updateDraftItems = (newItems: DraftItem[]) => {
    const nextTitle = draft.isCustomTitle
      ? draft.title
      : generateDefaultSetTitle(newItems)
    setDraft({
      ...draft,
      title: nextTitle,
      items: newItems,
    })
  }

  const addItem = (item: Omit<DraftItem, 'repetitions'>) =>
    updateDraftItems([
      ...draft.items,
      {
        userTuneId: item.userTuneId,
        title: item.title,
        tuneType: item.tuneType,
        key: item.key,
        repetitions: DEFAULT_REPETITIONS,
      },
    ])

  // Local filters for the "Your repertoire" picker — mirrors the Repertoire view.
  // Kept in component state (not the URL) since a mid-edit filter is ephemeral.
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerType, setPickerType] = useState('')
  const [pickerKey, setPickerKey] = useState('')
  const [pickerStatus, setPickerStatus] = useState('')

  const availableKeys = useMemo(
    () => [...new Set(available.map((r) => r.key))].sort(),
    [available],
  )

  const filteredAvailable = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase()
    return available.filter((r) => {
      if (pickerType && r.tuneType !== pickerType) return false
      if (pickerKey && r.key !== pickerKey) return false
      if (pickerStatus && r.status !== pickerStatus) return false
      if (q && !`${r.title} ${r.tuneType} ${r.key}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [available, pickerSearch, pickerType, pickerKey, pickerStatus])

  const hasPickerFilters = Boolean(pickerSearch || pickerType || pickerKey || pickerStatus)
  const clearPickerFilters = () => {
    setPickerSearch('')
    setPickerType('')
    setPickerKey('')
    setPickerStatus('')
  }

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
    updateDraftItems(items)
  }

  const removeItem = (index: number) => {
    updateDraftItems(draft.items.filter((_, i) => i !== index))
  }

  const setRepetitions = (index: number, repetitions: number) => {
    const items = draft.items.map((item, i) =>
      i === index ? { ...item, repetitions: Math.min(Math.max(repetitions, 1), 9) } : item,
    )
    setDraft({ ...draft, items })
  }

  const canSave = !saving && draft.title.trim().length > 0 && draft.items.length > 0

  const renderActionControls = (extraStyle?: React.CSSProperties) => (
    <div className="detail-controls" style={{ margin: 0, ...extraStyle }}>
      <button onClick={onSave} disabled={!canSave}>
        {saving ? 'Saving…' : 'Save set'}
      </button>
      <button type="button" className="secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <h1 style={{ margin: 0 }}>{draft.setId === null ? 'New set' : 'Edit set'}</h1>
        {renderActionControls()}
      </div>

      <input
        className="search-box"
        type="text"
        placeholder="Set title"
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value, isCustomTitle: true })}
        onBlur={() => {
          if (draft.title.trim().length === 0) {
            setDraft({
              ...draft,
              title: generateDefaultSetTitle(draft.items),
              isCustomTitle: false,
            })
          }
        }}
      />

      <h2>Tunes in this set</h2>
      {draft.items.length === 0 && <p className="tune-meta">Add tunes from your repertoire below.</p>}
      <ol className="set-tunes">
        {draft.items.map((item, index) => (
          <li
            key={item.userTuneId}
            className={`card tune-row draggable ${dragIndex === index ? 'dragging' : ''}`}
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
            <span className="drag-handle">⋮⋮</span>
            <span className="tune-title">{item.title}</span>
            <span className="tune-meta">
              {formatTuneType(item.tuneType)} · {item.key}
            </span>
            <label className="reps-label">
              ×
              <input
                className="reps-input"
                type="number"
                min="1"
                max="9"
                value={item.repetitions}
                aria-label={`Times through ${item.title}`}
                onChange={(e) =>
                  setRepetitions(index, Number(e.target.value) || 1)
                }
              />
            </label>
            <span className="row-buttons">
              <button onClick={() => move(index, index - 1)} aria-label="Move up">▲</button>
              <button onClick={() => move(index, index + 1)} aria-label="Move down">▼</button>
              <button
                className="danger"
                onClick={() => removeItem(index)}
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

      {/* Mid-editor Action Controls */}
      <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
        {renderActionControls()}
      </div>

      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      {(suggestions.data ?? []).length > 0 && (
        <>
          <h2>{draft.items.length === 0 ? 'Suggested openers' : 'Suggested next'}</h2>
          <ul className="tune-list">
            {suggestions.data!.map((s) => (
              <li key={s.userTuneId} className="card tune-row suggestion">
                <span className="tune-title">
                  {s.title}
                  <span className="tune-meta"> {formatTuneType(s.tuneType)} · {s.key}</span>
                  <br />
                  <span className="tune-meta suggestion-reason">
                    {parseSuggestionReason(s.reason).map((piece, idx) => (
                      <span key={idx}>
                        {idx > 0 && ' · '}
                        <span className="tooltip" data-tooltip={piece.tooltip}>
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
      <div className="detail-controls">
        <input
          className="search-box"
          type="search"
          placeholder="Search tunes… (title, type, or key)"
          value={pickerSearch}
          onChange={(e) => setPickerSearch(e.target.value)}
        />
      </div>
      <div className="detail-controls">
        <label>
          Filter by type
          <select value={pickerType} onChange={(e) => setPickerType(e.target.value)}>
            <option value="">All types</option>
            {TUNE_TYPES.map((type) => (
              <option key={type} value={type}>
                {formatTuneType(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter by key
          <select value={pickerKey} onChange={(e) => setPickerKey(e.target.value)}>
            <option value="">All keys</option>
            {availableKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter by status
          <select value={pickerStatus} onChange={(e) => setPickerStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TUNE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        {hasPickerFilters && (
          <button className="secondary" onClick={clearPickerFilters}>
            ✕ Clear filters
          </button>
        )}
      </div>
      <ul className="tune-list">
        {filteredAvailable.map((item) => (
          <li key={item.userTuneId} className="card tune-row">
            <span className="tune-title">{item.title}</span>
            <span className="tune-meta">
              {formatTuneType(item.tuneType)} · {item.key}
            </span>
            <span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
            <button onClick={() => addItem(item)}>+ Add</button>
          </li>
        ))}
      </ul>
      {available.length > 0 && filteredAvailable.length === 0 && (
        <p className="tune-meta">No tunes match these filters.</p>
      )}

      {/* Bottom Action Controls */}
      <div style={{ marginTop: '1rem' }}>
        {renderActionControls()}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
