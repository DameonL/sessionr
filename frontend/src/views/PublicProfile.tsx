"use client";

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { formatTuneType, getPublicActiveTunes, getPublicGamificationSummary, getPublicUserProfile } from '../services/api'
import { getBadgeInfo } from '../services/badges'

/** Bookmarkable public profile page: /profile/{userId} */
export function PublicProfile({ userId }: { userId?: string }) {
  const id = userId ?? ''

  const profile = useQuery({
    queryKey: ['public-profile', id],
    queryFn: () => getPublicUserProfile(id),
    retry: false,
  })

  const gamification = useQuery({
    queryKey: ['public-gamification', id],
    queryFn: () => getPublicGamificationSummary(id),
    retry: false,
    enabled: !!profile.data,
  })

  const activeTunes = useQuery({
    queryKey: ['public-active-tunes', id],
    queryFn: () => getPublicActiveTunes(id),
    retry: false,
    enabled: !!profile.data,
  })

  if (profile.isLoading) {
    return <p>Loading profile…</p>
  }

  if (profile.isError || !profile.data) {
    return (
      <section>
        <p className="error">This musician's profile could not be found.</p>
        <Link href="/" prefetch={false}>← Back home</Link>
      </section>
    )
  }

  const { displayName, bio, location, instruments } = profile.data
  const isEmpty = !bio && !location && !instruments

  return (
    <section>
      <div className="card" style={{ padding: '1.5rem' }}>
        <h1 style={{ marginTop: 0 }}>{displayName}</h1>
        {location && <p className="tune-meta">📍 {location}</p>}
        {instruments && <p className="tune-meta">🎻 {instruments}</p>}
        {bio && <p style={{ whiteSpace: 'pre-wrap' }}>{bio}</p>}
        {isEmpty && <p className="tune-meta">This musician hasn't added anything to their profile yet.</p>}

        {gamification.data && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              🏆 {gamification.data.totalPoints} points
            </div>
            {gamification.data.badges.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {gamification.data.badges.map((b) => {
                  const info = getBadgeInfo(b.badgeKey)
                  return (
                    <span
                      key={b.badgeKey}
                      className="card"
                      title={info.description}
                      style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
                    >
                      {info.emoji} {info.label}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {activeTunes.data && activeTunes.data.length > 0 && (
        <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
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
      )}
    </section>
  )
}
