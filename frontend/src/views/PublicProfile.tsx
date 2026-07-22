"use client";

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { getPublicUserProfile } from '../services/api'

/** Bookmarkable public profile page: /profile/{userId} */
export function PublicProfile({ userId }: { userId?: string }) {
  const id = userId ?? ''

  const profile = useQuery({
    queryKey: ['public-profile', id],
    queryFn: () => getPublicUserProfile(id),
    retry: false,
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
      </div>
    </section>
  )
}
