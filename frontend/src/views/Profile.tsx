"use client";

import { useEffect, useRef, useState } from 'react'
import Link from '@/utils/routerCompat'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  acceptFriendRequest,
  checkUsernameAvailable,
  declineFriendRequest,
  getCurrentUser,
  getFriendsList,
  getMyGamificationSummary,
  getPendingFriendRequests,
  getPracticeStats,
  removeFriend,
  updateCurrentUser,
  type FriendDto,
  type FriendRequestDto,
  type UserBadge,
  type UserProfile,
} from '../services/api'
import { currentUserId, currentUserProfile, showToast, useSignal } from '../state/appState'
import { getBadgeInfo } from '../services/badges'
import { isPreloading, preloadOfflineData, preloadStatus } from '../services/offlineWarming'
import { BadgeModal } from '../components/BadgeModal'
import { QRCodeModal } from '../components/QRCodeModal'
import { QRScannerModal } from '../components/QRScannerModal'
import { Spinner } from '../components/Spinner'
import { setThemePreference, themePreference, type ThemePreference } from '../services/theme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '🖥️ System' },
  { value: 'light', label: '☀️ Light' },
  { value: 'dark', label: '🌙 Dark' },
]

function AppearanceCard() {
  const pref = useSignal(themePreference)

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>🎨 Appearance</h2>
      <p className="tune-meta" style={{ marginTop: 0 }}>
        Choose a colour theme. “System” follows your device setting.
      </p>
      <div className="theme-picker" role="radiogroup" aria-label="Colour theme">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={pref === opt.value}
            className={`theme-option ${pref === opt.value ? 'active' : ''}`}
            onClick={() => setThemePreference(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function OfflinePreloadCard() {
  const loading = useSignal(isPreloading)
  const status = useSignal(preloadStatus)

  const handlePreload = async () => {
    const res = await preloadOfflineData()
    if (res.success) {
      showToast(`Preloaded ${res.itemCount} repertoire items and audio for offline use!`, 'success')
    } else if (res.error) {
      showToast(`Offline preload error: ${res.error}`, 'error')
    }
  }

  return (
    <div className="card" style={{ marginTop: '2rem', padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚡</span>
            <span>Make Available Offline</span>
          </h3>
          <p className="tune-meta" style={{ margin: '0.35rem 0 0 0' }}>
            Download your full repertoire, custom sets, practice queue, and soundfonts into local cache so sessionr functions 100% offline.
          </p>
        </div>

        <button onClick={handlePreload} disabled={loading} style={{ whiteSpace: 'nowrap' }}>
          {loading ? 'Preloading...' : '📥 Preload Offline Data'}
        </button>
      </div>

      {status && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
            <span>{status.message}</span>
            <span>{status.percent}%</span>
          </div>
          <div style={{ width: '100%', height: '8px', background: 'var(--surface-2)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${status.percent}%`,
                height: '100%',
                background: status.error ? 'var(--danger)' : 'var(--brand-2)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Profile visibility, saved on its own rather than through the Edit Profile form.
 *
 * That form is gated behind `isEditing` and refuses to submit while the username is missing or
 * taken, so folding privacy into it would put an unrelated validation check between a user and
 * turning their profile off. This saves the moment the toggle moves.
 */
function ProfileVisibilityCard({ profile }: { profile: UserProfile }) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const isPrivate = profile.isProfilePrivate

  const handleToggle = async (nextPrivate: boolean) => {
    setSaving(true)
    try {
      const updated = await updateCurrentUser({ isProfilePrivate: nextPrivate })
      currentUserProfile.value = updated
      queryClient.setQueryData(['current-user'], updated)
      showToast(
        nextPrivate ? 'Your profile is now private.' : 'Your profile is now public.',
        'success',
      )
    } catch (err: any) {
      showToast(err.message || 'Failed to update profile visibility.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: '2rem', padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>🔒 Profile Visibility</h2>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: saving ? 'wait' : 'pointer' }}>
        <input
          type="checkbox"
          checked={!isPrivate}
          disabled={saving}
          onChange={(e) => handleToggle(!e.target.checked)}
          style={{ marginTop: '0.25rem' }}
        />
        <span>
          <strong>Make my profile public</strong>
          <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
            {isPrivate
              ? 'Your profile is private. Nobody can view your profile page, tunes, sets, or badges.'
              : 'Anyone with the link can see your profile page, your active tunes, your sets, and your badges.'}
          </span>
          <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
            This does not affect the groups you are in — your bandmates still see your name and what
            you contribute there.
          </span>
        </span>
      </label>
    </div>
  )
}

const USERNAME_FORMAT = /^[a-z0-9-]{3,30}$/

/** Edit-your-own-profile page: /profile */
export function Profile() {
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()
  const profileQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser })
  const gamificationQuery = useQuery({ queryKey: ['my-gamification'], queryFn: getMyGamificationSummary })
  const practiceStatsQuery = useQuery({ queryKey: ['practice-stats', userId], queryFn: getPracticeStats })
  const friendsQuery = useQuery({ queryKey: ['friends-list'], queryFn: getFriendsList })
  const pendingRequestsQuery = useQuery({ queryKey: ['pending-friends'], queryFn: getPendingFriendRequests })

  const acceptMutation = useMutation({
    mutationFn: (friendshipId: string) => acceptFriendRequest(friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends-list'] })
      queryClient.invalidateQueries({ queryKey: ['pending-friends'] })
      showToast('Friend request accepted!', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to accept friend request.', 'error'),
  })

  const declineMutation = useMutation({
    mutationFn: (friendshipId: string) => declineFriendRequest(friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-friends'] })
      showToast('Friend request declined.')
    },
    onError: (err: any) => showToast(err.message || 'Failed to decline friend request.', 'error'),
  })

  const removeFriendMutation = useMutation({
    mutationFn: (targetUserId: string) => removeFriend(targetUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends-list'] })
      showToast('Friend removed.')
    },
    onError: (err: any) => showToast(err.message || 'Failed to remove friend.', 'error'),
  })

  const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null)
  const [showQrModal, setShowQrModal] = useState(false)
  const [showScannerModal, setShowScannerModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [instruments, setInstruments] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)
  const usernameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mustSetUsername = !!profileQuery.data && !profileQuery.data.username
  // Both of these hand out a link to the public profile, which 404s while the profile is private.
  const isPublished = !!profileQuery.data?.username && !profileQuery.data.isProfilePrivate

  useEffect(() => {
    if (profileQuery.data && (!seeded.current || !isEditing)) {
      seeded.current = true
      setDisplayName(profileQuery.data.displayName)
      setUsername(profileQuery.data.username ?? '')
      setBio(profileQuery.data.bio ?? '')
      setLocation(profileQuery.data.location ?? '')
      setInstruments(profileQuery.data.instruments ?? '')
    }
  }, [profileQuery.data, isEditing])

  useEffect(() => {
    if (mustSetUsername) setIsEditing(true)
  }, [mustSetUsername])

  useEffect(() => {
    if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current)

    if (!isEditing || !username || username === profileQuery.data?.username) {
      setUsernameStatus('idle')
      return
    }
    if (!USERNAME_FORMAT.test(username)) {
      setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')
    usernameCheckTimer.current = setTimeout(() => {
      checkUsernameAvailable(username)
        .then((result) => setUsernameStatus(result.available ? 'available' : 'taken'))
        .catch(() => setUsernameStatus('idle'))
    }, 400)

    return () => {
      if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current)
    }
  }, [username, isEditing, profileQuery.data?.username])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) return
    if (!USERNAME_FORMAT.test(username)) return
    if (usernameStatus === 'taken' || usernameStatus === 'checking') return

    setSaving(true)
    setError(null)
    try {
      const updated = await updateCurrentUser({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        bio: bio.trim(),
        location: location.trim(),
        instruments: instruments.trim(),
      })
      currentUserProfile.value = updated
      queryClient.setQueryData(['current-user'], updated)
      showToast('Profile updated successfully!')
      setIsEditing(false)
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.')
    } finally {
      setSaving(false)
    }
  }

  if (profileQuery.isLoading) {
    return <div className="spinner-row"><Spinner /></div>
  }

  if (profileQuery.isError) {
    return <p className="error">Could not load your profile: {(profileQuery.error as Error).message}</p>
  }

  const gamification = gamificationQuery.data
  const stats = practiceStatsQuery.data

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Your Profile</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {isPublished && (
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => setShowQrModal(true)}
            >
              📱 My Friend QR Code
            </button>
          )}
          {isPublished && (
            <Link href={`/profile/${profileQuery.data!.username}`} prefetch={false} className="quiet-link">
              View public profile ↗
            </Link>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Your Progress</h2>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{gamification?.totalPoints ?? 0}</div>
            <div className="tune-meta">Points</div>
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {stats ? `🔥 ${stats.currentStreakDays}` : '—'}
            </div>
            <div className="tune-meta">Day streak</div>
          </div>
        </div>
        {gamification && gamification.badges.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {gamification.badges.map((b) => {
              const info = getBadgeInfo(b.badgeKey)
              return (
                <span
                  key={b.badgeKey}
                  className="card badge-pill"
                  onClick={() => setSelectedBadge(b)}
                  title="Click to view explanation"
                  style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  {info.emoji} {info.label}
                </span>
              )
            })}
          </div>
        ) : (
          <p className="tune-meta" style={{ margin: 0 }}>
            No badges earned yet — log a practice to get started!
          </p>
        )}
      </div>

      <BadgeModal badge={selectedBadge} onClose={() => setSelectedBadge(null)} />

      <AppearanceCard />

      {profileQuery.data && <ProfileVisibilityCard profile={profileQuery.data} />}

      {!isEditing ? (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ margin: 0 }}>{displayName || profileQuery.data?.displayName}</h2>
              {location && <p className="tune-meta" style={{ marginTop: '0.25rem' }}>📍 {location}</p>}
              {instruments && <p className="tune-meta">🎻 {instruments}</p>}
            </div>
            <button className="secondary" onClick={() => setIsEditing(true)}>
              ✏️ Edit Profile
            </button>
          </div>
          {bio && <p style={{ whiteSpace: 'pre-wrap', marginTop: '1rem', marginBottom: 0 }}>{bio}</p>}
          {!bio && !location && !instruments && (
            <p className="tune-meta" style={{ marginTop: '1rem', marginBottom: 0 }}>No profile details added yet.</p>
          )}
        </div>
      ) : (
        <form className="card" onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Edit Profile</h3>
          {mustSetUsername && (
            <p className="tune-meta" style={{ marginTop: 0, marginBottom: '1rem' }}>
              Welcome! Choose a username to finish setting up your profile.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Username *</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="e.g. jane-fiddler"
                required
                style={{ width: '100%' }}
                disabled={saving}
              />
              {usernameStatus === 'checking' && (
                <p className="tune-meta" style={{ margin: '0.25rem 0 0' }}>Checking…</p>
              )}
              {usernameStatus === 'available' && (
                <p className="tune-meta" style={{ margin: '0.25rem 0 0', color: 'var(--accent)' }}>✓ Available</p>
              )}
              {usernameStatus === 'taken' && (
                <p className="error" style={{ margin: '0.25rem 0 0' }}>✗ That username is already taken.</p>
              )}
              {usernameStatus === 'invalid' && (
                <p className="error" style={{ margin: '0.25rem 0 0' }}>3-30 characters: lowercase letters, numbers, and hyphens only.</p>
              )}
            </div>

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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              {!mustSetUsername && (
                <button type="button" className="secondary" onClick={() => setIsEditing(false)} disabled={saving}>
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={saving || !displayName.trim() || !USERNAME_FORMAT.test(username) || usernameStatus === 'checking' || usernameStatus === 'taken'}
              >
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Friends & Friend Requests Section */}
      <div className="card" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            👥 Friends {friendsQuery.data && `(${friendsQuery.data.length})`}
          </h2>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => setShowScannerModal(true)}
            title="Scan a friend QR code to add them"
          >
            📷 Scan QR Code
          </button>
        </div>

        {/* Pending Requests Sub-section */}
        {pendingRequestsQuery.data && pendingRequestsQuery.data.length > 0 && (
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--accent-soft)', borderRadius: '8px', border: '1px solid var(--accent)' }}>
            <h3 style={{ marginTop: 0, fontSize: '1.05rem', color: 'var(--accent)' }}>
              📩 Pending Friend Requests ({pendingRequestsQuery.data.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pendingRequestsQuery.data.map((req) => (
                <div key={req.friendshipId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <strong>{req.requesterDisplayName}</strong>
                    {req.requesterUsername && (
                      <Link href={`/profile/${req.requesterUsername}`} prefetch={false} className="quiet-link" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                        @{req.requesterUsername} ↗
                      </Link>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="primary btn-sm"
                      onClick={() => acceptMutation.mutate(req.friendshipId)}
                      disabled={acceptMutation.isPending}
                    >
                      ✓ Accept
                    </button>
                    <button
                      className="secondary btn-sm"
                      onClick={() => declineMutation.mutate(req.friendshipId)}
                      disabled={declineMutation.isPending}
                    >
                      ✕ Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Friends List */}
        {friendsQuery.isLoading ? (
          <div className="spinner-row"><Spinner size={22} /></div>
        ) : friendsQuery.data && friendsQuery.data.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
            {friendsQuery.data.map((friend) => (
              <div key={friend.userId} className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.05rem' }}>
                    {friend.username ? (
                      <Link href={`/profile/${friend.username}`} prefetch={false} className="quiet-link">
                        {friend.displayName}
                      </Link>
                    ) : (
                      friend.displayName
                    )}
                  </h4>
                  {friend.username && <div className="tune-meta" style={{ fontSize: '0.8rem' }}>@{friend.username}</div>}
                  {friend.location && <div className="tune-meta" style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>📍 {friend.location}</div>}
                  {friend.instruments && <div className="tune-meta" style={{ fontSize: '0.85rem' }}>🎻 {friend.instruments}</div>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
                  {friend.username ? (
                    <Link href={`/profile/${friend.username}`} prefetch={false} className="quiet-link" style={{ fontSize: '0.85rem' }}>
                      View Profile ↗
                    </Link>
                  ) : (
                    <div />
                  )}
                  <button
                    className="secondary btn-sm"
                    onClick={() => removeFriendMutation.mutate(friend.userId)}
                    disabled={removeFriendMutation.isPending}
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  >
                    Unfriend
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="tune-meta" style={{ margin: 0 }}>
            You haven't added any friends yet. Visit another musician's public profile page to send a friend request!
          </p>
        )}
      </div>

      <OfflinePreloadCard />

      {profileQuery.data?.username && (
        <QRCodeModal
          isOpen={showQrModal}
          onClose={() => setShowQrModal(false)}
          title={`Friend Invite: ${profileQuery.data.displayName}`}
          subtitle="Show this QR code to a fellow musician so they can scan and add you as a friend!"
          url={typeof window !== 'undefined' ? `${window.location.origin}/profile/${profileQuery.data.username}?action=add-friend` : `https://sessionapp.dev/profile/${profileQuery.data.username}?action=add-friend`}
          downloadFilename={`friend-${profileQuery.data.username}-qr.png`}
        />
      )}

      <QRScannerModal
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
      />
    </section>
  )
}
