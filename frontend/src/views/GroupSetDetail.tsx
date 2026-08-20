import { lazy } from 'react'
"use client";

import { useQuery } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import dynamic from '@/utils/routerCompat'
import { getGroupSet } from '../services/api'
import { currentUserId, useAuthStatus, useSignal } from '../state/appState'
import { Spinner } from '../components/Spinner'

// Dynamically import SetPlayer to prevent abcjs SSR errors
const SetPlayer = lazy(() => import('../components/SetPlayer').then((m) => ({ default: m.SetPlayer })))

/** Bookmarkable page for a full group set: /groupset/{groupSetId} */
export function GroupSetDetail({ groupSetId }: { groupSetId?: string }) {
  const id = groupSetId ?? ''
  const userId = useSignal(currentUserId)
  const authStatus = useAuthStatus()

  const set = useQuery({
    queryKey: ['group-set', id, userId],
    queryFn: () => getGroupSet(id, userId),
    enabled: authStatus !== 'pending',
  })

  if (set.isPending) {
    return <div className="spinner-row"><Spinner /></div>
  }
  if (set.isError || !set.data) {
    return (
      <section>
        <p className="error">Could not load this set list.</p>
      </section>
    )
  }

  const { title, items, analysis, groupId } = set.data

  return (
    <section>
      <div style={{ marginBottom: '1rem' }}>
        <Link href={`/group/${groupId}`} prefetch={false}>← Back to group</Link>
      </div>
      <div className="set-header">
        <h1>{title}</h1>
        <span className="tune-meta">{analysis.totalPlaytime} min</span>
      </div>
      {analysis.transitions.length > 0 && (
        <ul className="transitions">
          {analysis.transitions.map((t) => (
            <li key={`${t.fromTitle}-${t.toTitle}`} className="tune-meta">
              {t.fromKey} → {t.toKey}: {t.label}
            </li>
          ))}
        </ul>
      )}

      <SetPlayer
        items={items.map(({ groupTuneId, title: tuneTitle, abc, repetitions }) => ({
          userTuneId: groupTuneId,
          title: tuneTitle,
          abc,
          repetitions,
        }))}
        linkHref={() => null}
      />
    </section>
  )
}
