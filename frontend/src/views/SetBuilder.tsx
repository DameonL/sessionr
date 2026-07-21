"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import dynamic from 'next/dynamic'
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
} from '../services/api'
import { currentUserId, useSignal } from '../state/appState'
import { parseSuggestionReason } from '../services/suggestions'

// Dynamically import SetPlayer to prevent abcjs SSR errors
const SetPlayer = dynamic(() => import('../components/SetPlayer').then((m) => m.SetPlayer), { ssr: false })

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
}

const DEFAULT_REPETITIONS = 3

export function SetBuilder() {
  const userId = useSignal(currentUserId)
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
        repertoire={repertoire.data?.items ?? []}
        available={(repertoire.data?.items ?? []).filter(
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
        <div key={set.setId} className="card set-card">
          <div className="set-header">
            <h2>
              <Link className="quiet-link" href={`/set/${set.setId}`}>{set.title}</Link>
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
            <Link href={`/set/${set.setId}`}>
              <button>▶ View &amp; play</button>
            </Link>
            <button onClick={() => startEdit(set)}>Edit</button>
            <button className="danger" onClick={() => deleteMutation.mutate(set.setId)}>
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

  const userId = useSignal(currentUserId)
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
        className="search-box"
        type="text"
        placeholder="Set title"
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
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
      <ul className="tune-list">
        {available.map((item) => (
          <li key={item.userTuneId} className="card tune-row">
            <span className="tune-title">{item.title}</span>
            <span className="tune-meta">
              {formatTuneType(item.tuneType)} · {item.key}
            </span>
            <button onClick={() => addItem(item)}>+ Add</button>
          </li>
        ))}
      </ul>

      <div className="detail-controls">
        <button onClick={onSave} disabled={saving || !draft.title || draft.items.length === 0}>
          {saving ? 'Saving…' : 'Save set'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
