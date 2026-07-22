"use client";

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { getCurrentUser, updateCurrentUser } from '../services/api'
import { currentUserId, currentUserProfile, showToast, useSignal } from '../state/appState'

/** Edit-your-own-profile page: /profile */
export function Profile() {
  const userId = useSignal(currentUserId)
  const profileQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser })

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [instruments, setInstruments] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  useEffect(() => {
    if (profileQuery.data && !seeded.current) {
      seeded.current = true
      setDisplayName(profileQuery.data.displayName)
      setBio(profileQuery.data.bio ?? '')
      setLocation(profileQuery.data.location ?? '')
      setInstruments(profileQuery.data.instruments ?? '')
    }
  }, [profileQuery.data])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) return

    setSaving(true)
    setError(null)
    try {
      const updated = await updateCurrentUser({
        displayName: displayName.trim(),
        bio: bio.trim(),
        location: location.trim(),
        instruments: instruments.trim(),
      })
      currentUserProfile.value = updated
      showToast('Profile updated successfully!')
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.')
    } finally {
      setSaving(false)
    }
  }

  if (profileQuery.isLoading) {
    return <p>Loading your profile…</p>
  }

  if (profileQuery.isError) {
    return <p className="error">Could not load your profile: {(profileQuery.error as Error).message}</p>
  }

  return (
    <section>
      <h1>Your Profile</h1>
      <form className="card" onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Display Name *</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              style={{ width: '100%' }}
              disabled={saving}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Bio</label>
            <textarea
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell fellow musicians a bit about yourself…"
              style={{ width: '100%', resize: 'vertical' }}
              disabled={saving}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Portland, OR"
              style={{ width: '100%' }}
              disabled={saving}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Instruments</label>
            <input
              type="text"
              value={instruments}
              onChange={(e) => setInstruments(e.target.value)}
              placeholder="e.g. Fiddle, Tenor Banjo"
              style={{ width: '100%' }}
              disabled={saving}
            />
          </div>

          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
            {userId && (
              <Link href={`/profile/${userId}`} prefetch={false} className="quiet-link">
                View your public profile
              </Link>
            )}
            <button type="submit" disabled={saving || !displayName.trim()}>
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}
