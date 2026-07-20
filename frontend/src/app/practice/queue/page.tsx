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
import { currentUserId } from '../../../state/appState'

// Dynamically import TunePlayer to prevent abcjs SSR errors
const TunePlayer = dynamic(() => import('../../../components/TunePlayer').then((m) => m.TunePlayer), { ssr: false })

export default function DailyQueuePage() {
  const userId = currentUserId.value
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const queue = useQuery({
    queryKey: ['practice-queue', userId],
    queryFn: () => getPracticeQueue(userId),
  })

  const practiceMutation = useMutation({
    mutationFn: logPractice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-queue', userId] })
      queryClient.invalidateQueries({ queryKey: ['repertoire', userId] })
    },
  })

  const items = queue.data ?? []
  const current = items.find((i) => i.userTuneId === selectedId) ?? items[0]

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
              <Link className="quiet-link" href={`/tune/${current.userTuneId}`}>{current.title}</Link>
            </h2>
            <span className="tune-meta">
              {formatTuneType(current.tuneType)} · {current.key}
              {current.targetBpm ? ` · target ${current.targetBpm} bpm` : ''}
            </span>
          </div>
          <p className="badge badge-queue">{current.reason}</p>
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
