"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import {
  formatTuneType,
  getPracticeQueue,
  getRepertoire,
  logPractice,
} from '../../../services/api'
import { currentUserId, useSignal } from '../../../state/appState'
import { parseSuggestionReason, suggestNextPracticeTunes, type NextTuneSuggestion } from '../../../services/suggestions'

interface SetDraftItem {
  userTuneId: string
  title: string
  tuneType: string
  key: string
  abc: string
  repetitions: number
}

// Dynamically import SetPlayer to prevent abcjs SSR errors
const SetPlayer = dynamic(() => import('../../../components/SetPlayer').then((m) => m.SetPlayer), { ssr: false })

export default function MedleySetsPage() {
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()
  const [setDraft, setSetDraft] = useState<SetDraftItem[]>([])

  const queue = useQuery({
    queryKey: ['practice-queue', userId],
    queryFn: () => getPracticeQueue(userId),
  })

  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: () => getRepertoire(userId),
  })

  const draftIds = setDraft.map((i) => i.userTuneId)
  const candidates = (queue.data ?? []).map((item) => ({
    userTuneId: item.userTuneId,
    title: item.title,
    tuneType: item.tuneType,
    key: item.key,
    status: item.status,
  }))
  const calculatedSuggestions = suggestNextPracticeTunes(draftIds, candidates, repertoire.data?.items ?? [])
  const suggestions = { data: calculatedSuggestions }

  const practiceMutation = useMutation({
    mutationFn: logPractice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
    },
  })

  const addSuggestion = (s: NextTuneSuggestion) => {
    const repItem = (repertoire.data?.items ?? []).find((r) => r.userTuneId === s.userTuneId)
    if (!repItem) return

    setSetDraft([
      ...setDraft,
      {
        userTuneId: s.userTuneId,
        title: s.title,
        tuneType: s.tuneType,
        key: s.key,
        abc: repItem.abc,
        repetitions: 2,
      },
    ])
  }

  const handleGenerateRandomSet = () => {
    const rep = repertoire.data?.items ?? []
    if (rep.length === 0) return

    const candidatesList = (queue.data ?? []).map((item) => ({
      userTuneId: item.userTuneId,
      title: item.title,
      tuneType: item.tuneType,
      key: item.key,
      status: item.status,
    }))

    const currentDraft: SetDraftItem[] = []

    // 1. Opener
    const openers = suggestNextPracticeTunes([], candidatesList, rep)
    if (openers.length > 0) {
      const opener = openers[Math.floor(Math.random() * openers.length)]
      const repItem = rep.find((r) => r.userTuneId === opener.userTuneId)
      if (repItem) {
        currentDraft.push({
          userTuneId: repItem.userTuneId,
          title: repItem.title,
          tuneType: repItem.tuneType,
          key: repItem.key,
          abc: repItem.abc,
          repetitions: 2,
        })
      }
    }

    // 2. Second tune
    if (currentDraft.length > 0) {
      const nextSug = suggestNextPracticeTunes([currentDraft[0].userTuneId], candidatesList, rep)
      if (nextSug.length > 0) {
        const second = nextSug[0]
        const repItem = rep.find((r) => r.userTuneId === second.userTuneId)
        if (repItem) {
          currentDraft.push({
            userTuneId: repItem.userTuneId,
            title: repItem.title,
            tuneType: repItem.tuneType,
            key: repItem.key,
            abc: repItem.abc,
            repetitions: 2,
          })
        }
      }
    }

    // 3. Third tune
    if (currentDraft.length > 1) {
      const nextSug = suggestNextPracticeTunes(
        [currentDraft[0].userTuneId, currentDraft[1].userTuneId],
        candidatesList,
        rep,
      )
      if (nextSug.length > 0) {
        const third = nextSug[0]
        const repItem = rep.find((r) => r.userTuneId === third.userTuneId)
        if (repItem) {
          currentDraft.push({
            userTuneId: repItem.userTuneId,
            title: repItem.title,
            tuneType: repItem.tuneType,
            key: repItem.key,
            abc: repItem.abc,
            repetitions: 2,
          })
        }
      }
    }

    setSetDraft(currentDraft)
  }

  const logSetPractice = async () => {
    try {
      for (const item of setDraft) {
        await logPractice(item.userTuneId)
      }
      queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
      setSetDraft([])
      alert('Logged practice for all tunes in the set!')
    } catch (err) {
      alert(`Failed logging practice: ${(err as Error).message}`)
    }
  }

  const canAddMore = setDraft.length < 3

  return (
    <div>
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div className="set-header" style={{ marginBottom: '0.5rem' }}>
          <h2>Medley Builder</h2>
          {setDraft.length === 0 && (
            <button onClick={handleGenerateRandomSet}>
              ⚡ Auto-Generate Practice Set
            </button>
          )}
        </div>
        
        {setDraft.length === 0 ? (
          <p className="tune-meta" style={{ margin: '1rem 0' }}>
            Select a suggested opener below or click "Auto-Generate" to instantly build a set.
          </p>
        ) : (
          <div>
            <ol className="set-tunes" style={{ margin: '1rem 0' }}>
              {setDraft.map((item, idx) => (
                <li key={item.userTuneId} className="card tune-row" style={{ padding: '0.45rem 0.6rem' }}>
                  <span className="tune-title">
                    {idx + 1}. {item.title}
                    <span className="tune-meta"> ({formatTuneType(item.tuneType)} · {item.key})</span>
                  </span>
                  <label className="reps-label">
                    ×
                    <input
                      className="reps-input"
                      type="number"
                      min="1"
                      max="9"
                      value={item.repetitions}
                      onChange={(e) => {
                        const val = Math.min(Math.max(Number(e.target.value) || 1, 1), 9)
                        setSetDraft(setDraft.map((d, dIdx) => dIdx === idx ? { ...d, repetitions: val } : d))
                      }}
                    />
                  </label>
                  <button
                    className="danger"
                    onClick={() => setSetDraft(setDraft.filter((_, dIdx) => dIdx !== idx))}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>

            <div className="detail-controls" style={{ marginBottom: '1.5rem' }}>
              <button onClick={() => setSetDraft([])} className="danger">
                Clear Medley
              </button>
              <button
                onClick={logSetPractice}
                disabled={practiceMutation.isPending}
              >
                ✓ Log practice for set
              </button>
            </div>

            <div style={{ marginTop: '1.5rem' }}>
              <h3>Practice Medley</h3>
              <SetPlayer items={setDraft} />
            </div>
          </div>
        )}
      </div>

      {canAddMore && (suggestions.data ?? []).length > 0 && (
        <div>
          <h2>{setDraft.length === 0 ? 'Suggested openers' : 'Suggested next'}</h2>
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
                <button onClick={() => addSuggestion(s)}>
                  + Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
