"use client";

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import {
  formatTuneType,
  getFullRepertoire,
} from '../../../services/api'
import { currentUserId, useSignal } from '../../../state/appState'

// Dynamically import EarTrainer to prevent abcjs SSR errors
const EarTrainer = dynamic(() => import('../../../components/EarTrainer').then((m) => m.EarTrainer), { ssr: false })

export default function EarTrainingPage() {
  const userId = useSignal(currentUserId)
  const [earTuneId, setEarTuneId] = useState<string | null>(null)

  const repertoire = useQuery({
    queryKey: ['repertoire', userId],
    queryFn: getFullRepertoire,
  })

  const earCandidates = [...(repertoire.data ?? [])].sort((a, b) => {
    const aLearning = a.status === 'Learning' ? 0 : 1
    const bLearning = b.status === 'Learning' ? 0 : 1
    return aLearning - bLearning || a.title.localeCompare(b.title)
  })
  const earTune = earCandidates.find((r) => r.userTuneId === earTuneId)

  return (
    <div>
      {repertoire.isLoading && <p>Loading your tunebook…</p>}
      {repertoire.isError && <p className="error">Could not load your tunebook.</p>}

      {earTuneId !== null && earTune ? (
        <div>
          <div className="detail-controls" style={{ marginBottom: '1rem' }}>
            <button onClick={() => setEarTuneId(null)}>← Choose another tune</button>
          </div>
          <EarTrainer key={earTune.userTuneId} item={earTune} />
        </div>
      ) : (
        <div>
          <p className="tune-meta" style={{ marginBottom: '1rem' }}>
            Pick a tune to learn by ear — you'll hear one note at a time and play it back
            on your instrument. Tunes you're learning are listed first.
          </p>
          <ul className="tune-list">
            {earCandidates.map((r) => (
              <li key={r.userTuneId} className="card">
                <button className="tune-row" onClick={() => setEarTuneId(r.userTuneId)}>
                  <span className="tune-title">{r.title}</span>
                  <span className="tune-meta">
                    {formatTuneType(r.tuneType)} · {r.key} · {r.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!repertoire.isLoading && earCandidates.length === 0 && (
            <p>Your tunebook is empty — add some tunes first.</p>
          )}
        </div>
      )}
    </div>
  )
}
