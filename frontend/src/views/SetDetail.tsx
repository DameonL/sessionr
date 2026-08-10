"use client";

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { getSet } from '../services/api'
import { Spinner } from '../components/Spinner'

// Dynamically import SetPlayer to prevent abcjs SSR errors
const SetPlayer = dynamic(() => import('../components/SetPlayer').then((m) => m.SetPlayer), { ssr: false })

/** Bookmarkable page for a full set: /set/{setId} */
export function SetDetail({ setId }: { setId?: string }) {
  const id = setId ?? ''

  const set = useQuery({ queryKey: ['set', id], queryFn: () => getSet(id) })

  if (set.isLoading) {
    return <div className="spinner-row"><Spinner /></div>
  }
  if (set.isError || !set.data) {
    return (
      <section>
        <p className="error">Could not load this set.</p>
        <Link href="/sets" prefetch={false}>← Back to sets</Link>
      </section>
    )
  }

  const { title, items, analysis } = set.data

  return (
    <section>
      <Link href="/sets" prefetch={false}>← Sets</Link>
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
        items={items.map(({ userTuneId, title: tuneTitle, abc, repetitions }) => ({
          userTuneId,
          title: tuneTitle,
          abc,
          repetitions,
        }))}
      />
    </section>
  )
}
