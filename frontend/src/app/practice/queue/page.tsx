"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  formatTuneType,
  getPracticeQueue,
  logPractice,
} from '../../../services/api'
import { currentUserId, showToast, useSignal } from '../../../state/appState'

// Dynamically import TunePlayer to prevent abcjs SSR errors
const TunePlayer = dynamic(() => import('../../../components/TunePlayer').then((m) => m.TunePlayer), { ssr: false })

export default function DailyQueuePage() {
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const queue = useQuery({
    queryKey: ['practice-queue', userId],
    queryFn: () => getPracticeQueue(),
  })

  const practiceMutation = useMutation({
    mutationFn: ({ userTuneId }: { userTuneId: string; title: string }) => logPractice(userTuneId),
    onSuccess: (_data, variables) => {
      showToast(`Practice logged for "${variables.title}"`, 'success')
      queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
      queryClient.invalidateQueries({ queryKey: ['practice-stats', userId] })
    },
    onError: (_err, variables) => {
      showToast(`Failed to log practice for "${variables.title}"`, 'error')
    },
  })

  const items = queue.data ?? []
  const current = items.find((i) => i.userTuneId === selectedId) ?? items[0]

  const handlePractice = (tuneId: string, title: string) => {
    const idx = items.findIndex((i) => i.userTuneId === tuneId)
    const next = items.find((i, i2) => i2 > idx && i.userTuneId !== tuneId) ?? items.find((i) => i.userTuneId !== tuneId)
    setSelectedId(next ? next.userTuneId : null)
    practiceMutation.mutate({ userTuneId: tuneId, title })
  }

  return (
    <>
      {queue.isLoading && <p>Loading today's queue…</p>}
      {queue.isError && <p className="error">Could not load the practice queue.</p>}
      {!queue.isLoading && items.length === 0 && (
        <p>Queue is clear — add tunes to your repertoire or mark some as Learning.</p>
      )}

      {current && (
        <div className="card practice-current">
          <div className="set-header">
            <h2>
              <Link className="quiet-link" href={`/tune/${current.userTuneId}`} prefetch={false}>{current.title}</Link>
            </h2>
            <span className="tune-meta">
              {formatTuneType(current.tuneType)} · {current.key}
              {current.targetBpm ? ` · target ${current.targetBpm} bpm` : ''}
            </span>
          </div>
          <p className="badge badge-queue">{current.reason}</p>
          <TunePlayer abc={current.abc} tuneId={current.userTuneId} targetBpm={current.targetBpm} tuneType={current.tuneType} />
          <button onClick={() => handlePractice(current.userTuneId, current.title)}>
            ✓ Done — log practice
          </button>
        </div>
      )}

      {items.length > 0 && (
        <>
          <h2>Up next</h2>
          <ul className="tune-list">
            {items.map((item) => (
              <li key={item.userTuneId} className="card">
                <button
                  className={`tune-row ${current?.userTuneId === item.userTuneId ? 'selected' : ''}`}
                  onClick={() => setSelectedId(item.userTuneId)}
                >
                  <span className="tune-title">{item.title}</span>
                  <span className="tune-meta">{item.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
