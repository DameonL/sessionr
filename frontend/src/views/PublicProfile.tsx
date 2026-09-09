"use client";

import { useState } from 'react'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { useSearchParams } from '@/utils/routerCompat'
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  formatTuneType,
  getFriendshipStatus,
  getModeratorUserDetails,
  getPublicActiveTunes,
  getPublicGamificationSummary,
  getPublicUserProfile,
  removeFriend,
  sanitizeUserProfile,
  sendFriendRequest,
  type UserBadge,
} from '../services/api'
import { getBadgeInfo } from '../services/badges'
import { currentUserProfile, useSignal, showToast } from '../state/appState'
import { BadgeModal } from '../components/BadgeModal'
import { QRCodeModal } from '../components/QRCodeModal'
import { Spinner } from '../components/Spinner'

/** Bookmarkable public profile page: /profile/{username} */
export function PublicProfile({ username }: { username?: string }) {
  const slug = username ?? ''
  const viewerProfile = useSignal(currentUserProfile)
  const isViewerModerator = !!viewerProfile?.isModerator
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const isAddFriendAction = searchParams.get('action') === 'add-friend'

  const [showSanitizeModal, setShowSanitizeModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null)
  const [sanName, setSanName] = useState('')
  const [sanBio, setSanBio] = useState('')
  const [sanLoc, setSanLoc] = useState('')
  const [sanInst, setSanInst] = useState('')

  const profile = useQuery({
    queryKey: ['public-profile', slug],
    queryFn: () => getPublicUserProfile(slug),
    retry: false,
  })

  const resolvedUserId = profile.data?.userId

  const friendshipStatusQuery = useQuery({
    queryKey: ['friendship-status', resolvedUserId],
    queryFn: () => getFriendshipStatus(resolvedUserId!),
    enabled: !!resolvedUserId && !!viewerProfile && viewerProfile.userId !== resolvedUserId,
    retry: false,
  })

  const sendRequestMutation = useMutation({
    mutationFn: () => sendFriendRequest(resolvedUserId!),
    onSuccess: (data) => {
      queryClient.setQueryData(['friendship-status', resolvedUserId], data)
      showToast('Friend request sent!', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to send friend request.', 'error'),
  })

  const acceptRequestMutation = useMutation({
    mutationFn: (friendshipId: string) => acceptFriendRequest(friendshipId),
    onSuccess: (data) => {
      queryClient.setQueryData(['friendship-status', resolvedUserId], data)
      queryClient.invalidateQueries({ queryKey: ['friends-list'] })
      queryClient.invalidateQueries({ queryKey: ['pending-friends'] })
      showToast('Friend request accepted!', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to accept friend request.', 'error'),
  })

  const declineRequestMutation = useMutation({
    mutationFn: (friendshipId: string) => declineFriendRequest(friendshipId),
    onSuccess: (data) => {
      queryClient.setQueryData(['friendship-status', resolvedUserId], data)
      queryClient.invalidateQueries({ queryKey: ['pending-friends'] })
      showToast('Friend request declined.')
    },
    onError: (err: any) => showToast(err.message || 'Failed to decline friend request.', 'error'),
  })

  const cancelRequestMutation = useMutation({
    mutationFn: (friendshipId: string) => cancelFriendRequest(friendshipId),
    onSuccess: (data) => {
      queryClient.setQueryData(['friendship-status', resolvedUserId], data)
      showToast('Friend request cancelled.')
    },
    onError: (err: any) => showToast(err.message || 'Failed to cancel request.', 'error'),
  })

  const removeFriendMutation = useMutation({
    mutationFn: () => removeFriend(resolvedUserId!),
    onSuccess: (data) => {
      queryClient.setQueryData(['friendship-status', resolvedUserId], data)
      queryClient.invalidateQueries({ queryKey: ['friends-list'] })
      showToast('Friend removed.')
    },
    onError: (err: any) => showToast(err.message || 'Failed to remove friend.', 'error'),
  })

  const moderatorDetails = useQuery({
    queryKey: ['moderator-user-details', resolvedUserId],
    queryFn: () => getModeratorUserDetails(resolvedUserId!),
    retry: false,
    enabled: isViewerModerator && !!resolvedUserId,
  })

  const gamification = useQuery({
    queryKey: ['public-gamification', resolvedUserId],
    queryFn: () => getPublicGamificationSummary(resolvedUserId!),
    retry: false,
    enabled: !!resolvedUserId,
  })

  const activeTunes = useQuery({
    queryKey: ['public-active-tunes', resolvedUserId],
    queryFn: () => getPublicActiveTunes(resolvedUserId!),
    retry: false,
    enabled: !!resolvedUserId,
  })

  const sanitizeMutation = useMutation({
    mutationFn: () =>
      sanitizeUserProfile(resolvedUserId!, {
        displayName: sanName,
        bio: sanBio,
        location: sanLoc,
        instruments: sanInst,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-profile', slug] })
      setShowSanitizeModal(false)
      showToast('Profile sanitized successfully.', 'success')
    },
    onError: (err: any) => showToast(err.message || 'Failed to sanitize profile.', 'error'),
  })

  if (profile.isLoading) {
    return <div className="spinner-row"><Spinner /></div>
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

  const handleOpenSanitize = () => {
    setSanName(displayName)
    setSanBio(bio ?? '')
    setSanLoc(location ?? '')
    setSanInst(instruments ?? '')
    setShowSanitizeModal(true)
  }

  const friendshipStatus = friendshipStatusQuery.data?.status
  const friendshipId = friendshipStatusQuery.data?.friendshipId

  return (
    <section>
      {isAddFriendAction && viewerProfile && viewerProfile.userId !== resolvedUserId && friendshipStatus === 'None' && (
        <div
          className="card"
          style={{
            padding: '1rem 1.25rem',
            marginBottom: '1rem',
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong>👋 Scanned Friend QR Code!</strong>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Send a friend request to connect with {displayName}.
            </div>
          </div>
          <button
            className="primary"
            onClick={() => sendRequestMutation.mutate()}
            disabled={sendRequestMutation.isPending}
          >
            {sendRequestMutation.isPending ? 'Sending…' : '➕ Send Friend Request'}
          </button>
        </div>
      )}

      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span>{displayName}</span>
            </h1>
            {location && <p className="tune-meta">📍 {location}</p>}
            {instruments && <p className="tune-meta">🎻 {instruments}</p>}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="secondary"
              onClick={() => setShowQrModal(true)}
              title="Show friend invite QR code"
            >
              📱 Share QR Code
            </button>

            {viewerProfile && viewerProfile.userId !== resolvedUserId && friendshipStatus && (
              <>
                {friendshipStatus === 'None' && (
                  <button
                    className="primary"
                    onClick={() => sendRequestMutation.mutate()}
                    disabled={sendRequestMutation.isPending}
                  >
                    {sendRequestMutation.isPending ? 'Sending…' : '➕ Add Friend'}
                  </button>
                )}

                {friendshipStatus === 'PendingSent' && (
                  <button
                    className="secondary"
                    onClick={() => friendshipId && cancelRequestMutation.mutate(friendshipId)}
                    disabled={cancelRequestMutation.isPending}
                    title="Click to cancel pending request"
                  >
                    {cancelRequestMutation.isPending ? 'Cancelling…' : '⏳ Request Sent (Cancel)'}
                  </button>
                )}

                {friendshipStatus === 'PendingReceived' && (
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="primary btn-sm"
                      onClick={() => friendshipId && acceptRequestMutation.mutate(friendshipId)}
                      disabled={acceptRequestMutation.isPending}
                    >
                      {acceptRequestMutation.isPending ? 'Accepting…' : '✓ Accept Request'}
                    </button>
                    <button
                      className="secondary btn-sm"
                      onClick={() => friendshipId && declineRequestMutation.mutate(friendshipId)}
                      disabled={declineRequestMutation.isPending}
                    >
                      {declineRequestMutation.isPending ? 'Declining…' : '✕ Decline'}
                    </button>
                  </div>
                )}

                {friendshipStatus === 'Accepted' && (
                  <button
                    className="secondary"
                    onClick={() => removeFriendMutation.mutate()}
                    disabled={removeFriendMutation.isPending}
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  >
                    {removeFriendMutation.isPending ? 'Removing…' : '✓ Friends (Unfriend)'}
                  </button>
                )}
              </>
            )}

            {isViewerModerator && (
              <button className="secondary" onClick={handleOpenSanitize}>
                🛡️ Edit Profile
              </button>
            )}
          </div>
        </div>

        {isViewerModerator && moderatorDetails.data && (
          <div
            className="card"
            style={{
              padding: '1rem',
              marginTop: '1rem',
              background: 'var(--surface-2)',
              border: '1px solid var(--accent)',
              borderRadius: '8px',
              fontSize: '0.85rem',
            }}
          >
            <strong style={{ color: 'var(--accent)' }}>🛡️ Moderator Inspection Details:</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', marginTop: '0.5rem' }}>
              <div>📧 <strong>Email:</strong> {moderatorDetails.data.email}</div>
              <div>🔑 <strong>User ID:</strong> {moderatorDetails.data.userId}</div>
              <div>👥 <strong>Group Memberships:</strong> {moderatorDetails.data.groupCount}</div>
              <div>🎵 <strong>Repertoire Tunes:</strong> {moderatorDetails.data.tuneCount}</div>
            </div>
          </div>
        )}

        {bio && <p style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>{bio}</p>}
        {isEmpty && <p className="tune-meta" style={{ marginTop: '1rem' }}>This musician hasn't added anything to their profile yet.</p>}


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
            )}
          </div>
        )}
      </div>

      <BadgeModal badge={selectedBadge} onClose={() => setSelectedBadge(null)} />

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

      {showSanitizeModal && (

        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-card" style={{ maxWidth: '550px', width: '100%', padding: '1.75rem' }}>
            <h2 style={{ marginTop: 0 }}>🛡️ Edit User Profile: {displayName}</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
              Clear or sanitize inappropriate text in this user's profile fields.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Display Name</label>
                <input type="text" value={sanName} onChange={(e) => setSanName(e.target.value)} required />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Location</label>
                <input type="text" value={sanLoc} onChange={(e) => setSanLoc(e.target.value)} placeholder="Clear or set location..." />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Instruments</label>
                <input type="text" value={sanInst} onChange={(e) => setSanInst(e.target.value)} placeholder="Clear or set instruments..." />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Bio</label>
                <textarea
                  rows={4}
                  value={sanBio}
                  onChange={(e) => setSanBio(e.target.value)}
                  placeholder="Clear or set bio text..."
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="secondary" onClick={() => setShowSanitizeModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => sanitizeMutation.mutate()}
                  disabled={sanitizeMutation.isPending || !sanName.trim()}
                >
                  {sanitizeMutation.isPending ? 'Saving…' : 'Save & Sanitize'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <QRCodeModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        title={`Friend Invite: ${displayName}`}
        subtitle="Show this QR code to a fellow musician so they can scan and add you as a friend!"
        url={typeof window !== 'undefined' ? `${window.location.origin}/profile/${slug}?action=add-friend` : `https://sessionapp.dev/profile/${slug}?action=add-friend`}
        downloadFilename={`friend-${slug}-qr.png`}
      />
    </section>
  )
}

