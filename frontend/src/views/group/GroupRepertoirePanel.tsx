"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getFullRepertoireList,
  addToRepertoire,
  addGroupTune,
  formatTuneType,
} from '../../services/api'
import { normalizeTitleForSorting } from '../../services/abcTools'
import { TuneSettingsModal } from '../../components/TuneSettingsModal'
import { useGroupDetail } from './groupDetailContext'

export function GroupRepertoirePanel() {
  const { groupId, userId, isAdmin, isMember, details, invalidate } = useGroupDetail()
  const queryClient = useQueryClient()
  const [addTuneId, setAddTuneId] = useState<string | null>(null)

  // The viewer's own repertoire (tune IDs) to flag tunes they already hold.
  const repertoireQuery = useQuery({
    queryKey: ['repertoire-list-full', userId],
    queryFn: getFullRepertoireList,
    enabled: !!userId,
  })

  const addTuneMutation = useMutation({
    mutationFn: (tuneId: string) => addToRepertoire(tuneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repertoire-list-full', userId] })
    },
  })

  const userTuneIds = new Set(repertoireQuery.data?.map((t) => t.tuneId) ?? [])
  const masterTuneIds = new Set(details.masterTunes.map((t) => t.tuneId))

  return (
    <div>
      <h2>Tunes Known in Common</h2>
      {details.commonTunes.length === 0 ? (
        <p className="tune-meta italic">No shared repertoire found. Add tunes to your repertoires to see them here.</p>
      ) : (
        <ul className="tune-list">
          {[...details.commonTunes]
            .sort((a, b) => {
              if (b.memberCount !== a.memberCount) {
                return b.memberCount - a.memberCount
              }
              const keyA = normalizeTitleForSorting(a.title)
              const keyB = normalizeTitleForSorting(b.title)
              return keyA.localeCompare(keyB)
            })
            .map((t) => {
            const alreadyHas = userTuneIds.has(t.tuneId)
            const isOnMaster = masterTuneIds.has(t.tuneId)
            const percent = Math.round((t.memberCount / t.totalMembersInGroup) * 100)

            return (
              <li key={t.tuneId} className="card tune-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <span className="tune-title">{t.title}</span>
                  <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                    {formatTuneType(t.tuneType)} · Key: {t.key}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className={`badge ${percent === 100 ? 'badge-active' : 'badge-learning'}`}>
                    {t.memberCount}/{t.totalMembersInGroup} ({percent}%)
                  </span>

                  {isAdmin && !isOnMaster && (
                    <button
                      className="secondary"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                      onClick={() => setAddTuneId(t.tuneId)}
                    >
                      + Add to Master List
                    </button>
                  )}

                  {!alreadyHas && isMember && (
                    <button
                      className="secondary"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                      onClick={() => addTuneMutation.mutate(t.tuneId)}
                      disabled={addTuneMutation.isPending}
                    >
                      + Repertoire
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {addTuneId !== null && (
        <TuneSettingsModal
          tuneId={addTuneId}
          onClose={() => setAddTuneId(null)}
          onAdded={invalidate}
          onSelectSetting={(settingId) => addGroupTune(groupId, addTuneId, settingId)}
          actionLabel="+ Add to Master List"
        />
      )}
    </div>
  )
}
