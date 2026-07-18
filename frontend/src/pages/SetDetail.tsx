import { useQuery } from '@tanstack/react-query'
import { getSet } from '../services/api.ts'
import { SetPlayer } from '../components/SetPlayer.tsx'

/** Bookmarkable page for a full set: /set/{setId} */
export function SetDetail({ setId }: { setId?: string }) {
  const id = Number(setId)

  const set = useQuery({ queryKey: ['set', id], queryFn: () => getSet(id) })

  if (set.isLoading) {
    return <p>Loading…</p>
  }
  if (set.isError || !set.data) {
    return (
      <section>
        <p class="error">Could not load this set.</p>
        <a href="/sets">← Back to sets</a>
      </section>
    )
  }

  const { title, items, analysis } = set.data

  return (
    <section>
      <a href="/sets">← Sets</a>
      <div class="set-header">
        <h1>{title}</h1>
        <span class="tune-meta">{analysis.totalPlaytime} min</span>
      </div>
      {analysis.transitions.length > 0 && (
        <ul class="transitions">
          {analysis.transitions.map((t) => (
            <li key={`${t.fromTitle}-${t.toTitle}`} class="tune-meta">
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
