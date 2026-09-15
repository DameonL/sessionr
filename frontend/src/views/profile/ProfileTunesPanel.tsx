"use client";

import { useQuery } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { formatTuneType, getPublicActiveTunes } from '../../services/api'
import { Spinner } from '../../components/Spinner'
import { usePublicProfile } from './publicProfileContext'

/** The tunes this musician currently has at Active status: /profile/{username}/tunes */
export function ProfileTunesPanel() {
  const { profile, userId } = usePublicProfile()

  // Fetched here rather than in the layout so a visitor who never opens this tab never pays for it.
  const activeTunes = useQuery({
    queryKey: ['public-active-tunes', userId],
    queryFn: () => getPublicActiveTunes(userId),
    retry: false,
    enabled: !!userId,
  })

  if (activeTunes.isPending) {
    return <div className="spinner-row"><Spinner /></div>
  }

  if (activeTunes.isError) {
    return (
      <div className="card" style={{ padding: '1.5rem' }}>
        <p className="error" style={{ margin: 0 }}>Could not load these tunes.</p>
      </div>
    )
  }

  if (activeTunes.data.length === 0) {
    return (
      <div className="card" style={{ padding: '1.5rem' }}>
        <p className="tune-meta" style={{ margin: 0 }}>
          {profile.displayName} has no active tunes yet.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>Active Tunes</h2>
      <ul className="tune-list">
        {activeTunes.data.map((t) => (
          <li key={t.tuneId} className="card tune-row">
            <Link className="tune-title quiet-link" href={`/tunes/${t.tuneId}`} prefetch={false}>
              {t.title}
            </Link>
            <span className="tune-meta">{formatTuneType(t.tuneType)} · {t.key}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
