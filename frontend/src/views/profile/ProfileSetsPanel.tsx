"use client";

import { useQuery } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { getPublicUserSets } from '../../services/api'
import { Spinner } from '../../components/Spinner'
import { usePublicProfile } from './publicProfileContext'

/** The sets this musician has built: /profile/{username}/sets */
export function ProfileSetsPanel() {
  const { profile, slug } = usePublicProfile()

  // Fetched here rather than in the layout so a visitor who never opens this tab never pays for it.
  // Keyed on the slug: the username is what makes a profile public, and so is what gates the sets.
  const sets = useQuery({
    queryKey: ['public-user-sets', slug],
    queryFn: () => getPublicUserSets(slug),
    retry: false,
    enabled: !!slug,
  })

  if (sets.isPending) {
    return <div className="spinner-row"><Spinner /></div>
  }

  if (sets.isError) {
    return (
      <div className="card" style={{ padding: '1.5rem' }}>
        <p className="error" style={{ margin: 0 }}>Could not load these sets.</p>
      </div>
    )
  }

  if (sets.data.length === 0) {
    return (
      <div className="card" style={{ padding: '1.5rem' }}>
        <p className="tune-meta" style={{ margin: 0 }}>
          {profile.displayName} hasn't built any sets yet.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>Sets</h2>
      <ul className="tune-list">
        {sets.data.map((s) => (
          <li key={s.setId} className="card tune-row">
            <Link className="tune-title quiet-link" href={`/set/${s.setId}`} prefetch={false}>
              {s.title}
            </Link>
            <span className="tune-meta">
              {s.items.map((i) => i.title).join(' / ')}
              {s.items.length > 0 && ' · '}
              {s.analysis.totalPlaytime} min
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
