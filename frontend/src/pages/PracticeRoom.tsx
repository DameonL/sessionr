import { useEffect, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  formatTuneType,
  getPracticeQueue,
  logPractice,
  getRepertoire,
} from '../services/api.ts'
import { currentUserId } from '../state/appState.ts'
import { TunePlayer } from '../components/TunePlayer.tsx'
import { SetPlayer } from '../components/SetPlayer.tsx'
import { parseSuggestionReason, suggestNextPracticeTunes } from '../services/suggestions.ts'

export function PracticeRoom() {
  const userId = currentUserId.value
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [practiceMode, setPracticeMode] = useState<'queue' | 'sets'>('queue')
  const [setDraft, setSetDraft] = useState<any[]>([])

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
  const calculatedSuggestions = suggestNextPracticeTunes(draftIds, candidates, repertoire.data ?? [])
  const suggestions = { data: calculatedSuggestions }

  const practiceMutation = useMutation({
    mutationFn: logPractice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
    },
  })

  // Keep the screen awake during practice (best effort — not all browsers
  // support the Wake Lock API).
  useEffect(() => {
    let wakeLock: { release: () => Promise<void> } | undefined
    ;(navigator as any).wakeLock
      ?.request('screen')
      .then((lock: any) => (wakeLock = lock))
      .catch(() => {})
    return () => {
      wakeLock?.release().catch(() => {})
    }
  }, [])

  const items = queue.data ?? []
  const current = items.find((i) => i.userTuneId === selectedId) ?? items[0]

  const addSuggestion = (s: any) => {
    const repItem = (repertoire.data ?? []).find((r) => r.userTuneId === s.userTuneId)
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
    const rep = repertoire.data ?? []
    if (rep.length === 0) return

    const candidatesList = (queue.data ?? []).map((item) => ({
      userTuneId: item.userTuneId,
      title: item.title,
      tuneType: item.tuneType,
      key: item.key,
      status: item.status,
    }))

    const currentDraft: any[] = []

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
    <section>
      <h1>Practice Room</h1>
      
      <div class="detail-controls" style={{ marginBottom: '1.5rem', justifyContent: 'center' }}>
        <button
          class={practiceMode === 'queue' ? 'toggled' : ''}
          onClick={() => setPracticeMode('queue')}
        >
          📋 Daily Queue
        </button>
        <button
          class={practiceMode === 'sets' ? 'toggled' : ''}
          onClick={() => setPracticeMode('sets')}
        >
          🎛 Medley Sets
        </button>
      </div>

      {practiceMode === 'queue' && (
        <>
          {queue.isLoading && <p>Loading today's queue…</p>}
          {queue.isError && <p class="error">Could not load the practice queue.</p>}
          {!queue.isLoading && items.length === 0 && (
            <p>Queue is clear — add tunes to your repertoire or mark some as Learning.</p>
          )}

          {current && (
            <div class="card practice-current">
              <div class="set-header">
                <h2>
                  <a class="quiet-link" href={`/tune/${current.userTuneId}`}>{current.title}</a>
                </h2>
                <span class="tune-meta">
                  {formatTuneType(current.tuneType)} · {current.key}
                  {current.targetBpm ? ` · target ${current.targetBpm} bpm` : ''}
                </span>
              </div>
              <p class="badge badge-queue">{current.reason}</p>
              <TunePlayer abc={current.abc} />
              <button
                disabled={practiceMutation.isPending}
                onClick={() => practiceMutation.mutate(current.userTuneId)}
              >
                ✓ Done — log practice
              </button>
            </div>
          )}

          {items.length > 0 && (
            <>
              <h2>Up next</h2>
              <ul class="tune-list">
                {items.map((item) => (
                  <li key={item.userTuneId} class="card">
                    <button
                      class={`tune-row ${current?.userTuneId === item.userTuneId ? 'selected' : ''}`}
                      onClick={() => setSelectedId(item.userTuneId)}
                    >
                      <span class="tune-title">{item.title}</span>
                      <span class="tune-meta">{item.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {practiceMode === 'sets' && (
        <div>
          <div class="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <div class="set-header" style={{ marginBottom: '0.5rem' }}>
              <h2>Medley Builder</h2>
              {setDraft.length === 0 && (
                <button onClick={handleGenerateRandomSet}>
                  ⚡ Auto-Generate Practice Set
                </button>
              )}
            </div>
            
            {setDraft.length === 0 ? (
              <p class="tune-meta" style={{ margin: '1rem 0' }}>
                Select a suggested opener below or click "Auto-Generate" to instantly build a set.
              </p>
            ) : (
              <div>
                <ol class="set-tunes" style={{ margin: '1rem 0' }}>
                  {setDraft.map((item, idx) => (
                    <li key={item.userTuneId} class="card tune-row" style={{ padding: '0.45rem 0.6rem' }}>
                      <span class="tune-title">
                        {idx + 1}. {item.title}
                        <span class="tune-meta"> ({formatTuneType(item.tuneType)} · {item.key})</span>
                      </span>
                      <label class="reps-label">
                        ×
                        <input
                          class="reps-input"
                          type="number"
                          min="1"
                          max="9"
                          value={item.repetitions}
                          onChange={(e) => {
                            const val = Math.min(Math.max(Number((e.target as HTMLInputElement).value) || 1, 1), 9)
                            setSetDraft(setDraft.map((d, dIdx) => dIdx === idx ? { ...d, repetitions: val } : d))
                          }}
                        />
                      </label>
                      <button
                        class="danger"
                        onClick={() => setSetDraft(setDraft.filter((_, dIdx) => dIdx !== idx))}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>

                <div class="detail-controls" style={{ marginBottom: '1.5rem' }}>
                  <button onClick={() => setSetDraft([])} class="danger">
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
                    <button onClick={() => addSuggestion(s)}>
                      + Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
