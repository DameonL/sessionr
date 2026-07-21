"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  createGroupSet,
  deleteGroupSet,
  formatTuneType,
  getGroupSets,
  updateGroupSet,
  type GroupSetData,
  type GroupTuneListItem,
} from '../services/api'

interface DraftItem {
  groupTuneId: string
  title: string
  tuneType: string
  key: string
  repetitions: number
}

interface Draft {
  groupSetId: string | null
  title: string
  items: DraftItem[]
}

const DEFAULT_REPETITIONS = 3

export function GroupSetBuilder({
  groupId,
  userId,
  isAdmin,
  masterTunes,
}: {
  groupId: string
  userId: string
  isAdmin: boolean
  masterTunes: GroupTuneListItem[]
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)

  const sets = useQuery({
    queryKey: ['group-sets', groupId, userId],
    queryFn: () => getGroupSets(groupId, userId),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['group-sets', groupId, userId] })

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => {
      const items = d.items.map(({ groupTuneId, repetitions }) => ({ groupTuneId, repetitions }))
      return d.groupSetId === null
        ? createGroupSet(groupId, d.title, items)
        : updateGroupSet(d.groupSetId, d.title, items)
    },
    onSuccess: () => {
      invalidate()
      setDraft(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (groupSetId: string) => deleteGroupSet(groupSetId),
    onSuccess: () => {
      invalidate()
      setDraft(null)
    },
  })

  const startEdit = (set: GroupSetData) =>
    setDraft({
      groupSetId: set.groupSetId,
      title: set.title,
      items: set.items.map(({ groupTuneId, title, tuneType, key, repetitions }) => ({
        groupTuneId,
        title,
        tuneType,
        key,
        repetitions,
      })),
    })

  if (draft) {
    return (
      <GroupSetEditor
        draft={draft}
        setDraft={setDraft}
        available={masterTunes
          .filter((t) => !draft.items.some((i) => i.groupTuneId === t.groupTuneId))
          .map((t) => ({ groupTuneId: t.groupTuneId, title: t.title, tuneType: t.tuneType, key: t.key }))}
        onSave={() => saveMutation.mutate(draft)}
        onCancel={() => setDraft(null)}
        saving={saveMutation.isPending}
        error={saveMutation.isError ? (saveMutation.error as Error).message : null}
      />
    )
  }

  return (
    <div>
      <h2>Set Lists</h2>
      <p className="tune-meta italic">
        Ordered medleys built from the group&apos;s master tune list, ready to pull up and play at a session.
      </p>

      {isAdmin && (
        <button onClick={() => setDraft({ groupSetId: null, title: '', items: [] })}>+ New Set</button>
      )}

      {sets.isLoading && <p>Loading…</p>}
      {(sets.data ?? []).map((set) => (
        <div key={set.groupSetId} className="card set-card" style={{ marginTop: '1rem' }}>
          <div className="set-header">
            <h3>
              <Link className="quiet-link" href={`/groupset/${set.groupSetId}`}>{set.title}</Link>
            </h3>
            <span className="tune-meta">{set.analysis.totalPlaytime} min</span>
          </div>
          <ol className="set-tunes">
            {set.items.map((item) => (
              <li key={item.groupTuneId}>
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
            <Link href={`/groupset/${set.groupSetId}`}>
              <button>▶ View &amp; play</button>
            </Link>
            {isAdmin && (
              <>
                <button onClick={() => startEdit(set)}>Edit</button>
                <button className="danger" onClick={() => deleteMutation.mutate(set.groupSetId)}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {!sets.isLoading && (sets.data ?? []).length === 0 && (
        <p className="tune-meta italic">No set lists yet.{isAdmin ? ' Build one from the master tune list above.' : ''}</p>
      )}
    </div>
  )
}

function GroupSetEditor({
  draft,
  setDraft,
  available,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  available: Omit<DraftItem, 'repetitions'>[]
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const addItem = (item: Omit<DraftItem, 'repetitions'>) =>
    setDraft({
      ...draft,
      items: [...draft.items, { ...item, repetitions: DEFAULT_REPETITIONS }],
    })

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
    <div>
      <h2>{draft.groupSetId === null ? 'New set list' : 'Edit set list'}</h2>
      <input
        className="search-box"
        type="text"
        placeholder="Set title"
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />

      <h3>Tunes in this set</h3>
      {draft.items.length === 0 && <p className="tune-meta">Add tunes from the master list below.</p>}
      <ol className="set-tunes">
        {draft.items.map((item, index) => (
          <li
            key={item.groupTuneId}
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
                onChange={(e) => setRepetitions(index, Number(e.target.value) || 1)}
              />
            </label>
            <span className="row-buttons">
              <button onClick={() => move(index, index - 1)} aria-label="Move up">▲</button>
              <button onClick={() => move(index, index + 1)} aria-label="Move down">▼</button>
              <button
                className="danger"
                onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}
                aria-label="Remove"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>

      <h3>Master tune list</h3>
      {available.length === 0 ? (
        <p className="tune-meta italic">No more tunes available — add them to the group&apos;s master list first.</p>
      ) : (
        <ul className="tune-list">
          {available.map((item) => (
            <li key={item.groupTuneId} className="card tune-row">
              <span className="tune-title">{item.title}</span>
              <span className="tune-meta">
                {formatTuneType(item.tuneType)} · {item.key}
              </span>
              <button onClick={() => addItem(item)}>+ Add</button>
            </li>
          ))}
        </ul>
      )}

      <div className="detail-controls">
        <button onClick={onSave} disabled={saving || !draft.title || draft.items.length === 0}>
          {saving ? 'Saving…' : 'Save set'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
