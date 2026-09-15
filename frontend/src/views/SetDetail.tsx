"use client";

import { lazy } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { getSet } from '../services/api'
import { currentUserId, useSignal } from '../state/appState'
import { Spinner } from '../components/Spinner'

// Dynamically import SetPlayer to prevent abcjs SSR errors
const SetPlayer = lazy(() => import('../components/SetPlayer').then((m) => ({ default: m.SetPlayer })))

/** Bookmarkable page for a full set: /set/{setId}. Public — anyone with the link can view and play
 *  it, so nothing here may assume a signed-in viewer, let alone the set's owner. */
export function SetDetail({ setId }: { setId?: string }) {
  const id = setId ?? ''
  const viewerId = useSignal(currentUserId)

  const set = useQuery({ queryKey: ['set', id], queryFn: () => getSet(id) })

  // /sets is the signed-in builder; send a visitor home instead of into a sign-in card.
  const backHref = viewerId ? '/sets' : '/'
  const backLabel = viewerId ? 'Sets' : 'Home'

  if (set.isLoading) {
    return <div className="spinner-row"><Spinner /></div>
  }
  if (set.isError || !set.data) {
    return (
      <section>
        <p className="error">Could not load this set.</p>
        <Link href={backHref} prefetch={false}>← Back to {backLabel.toLowerCase()}</Link>
      </section>
    )
  }

  const { title, items, analysis } = set.data

  return (
    <section>
      <Link href={backHref} prefetch={false}>← {backLabel}</Link>
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
        items={items.map(({ userTuneId, tuneId, title: tuneTitle, abc, repetitions }) => ({
          userTuneId,
          tuneId,
          title: tuneTitle,
          abc,
          repetitions,
        }))}
        // The player's default target is /tune/{userTuneId}, the owner's private repertoire page —
        // a dead end for a visitor, and a 404 for any signed-in non-owner. The public tune library
        // page works for everyone.
        linkHref={(item) => (item.tuneId ? `/tunes/${item.tuneId}` : null)}
      />
    </section>
  )
}
