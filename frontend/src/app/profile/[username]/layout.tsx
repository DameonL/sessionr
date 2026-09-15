"use client";

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from '@/utils/routerCompat'
import { usePathname, useParams, useSearchParams } from '@/utils/routerCompat'
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendshipStatus,
  getModeratorUserDetails,
  getPublicGamificationSummary,
  getPublicUserProfile,
  removeFriend,
  sanitizeUserProfile,
  sendFriendRequest,
  type UserBadge,
} from '../../../services/api'
import { currentUserProfile, useSignal, showToast } from '../../../state/appState'
import { BadgeModal } from '../../../components/BadgeModal'
import { QRCodeModal } from '../../../components/QRCodeModal'
import { Spinner } from '../../../components/Spinner'
import { TabNav, type Tab } from '../../../components/TabNav'
import { PublicProfileProvider } from '../../../views/profile/publicProfileContext'

/**
 * Bookmarkable public profile: /profile/{username}, with the musician's tunes and sets on their own
 * sub-routes. The identity header and the friend/moderator actions stay put across the tabs.
 *
 * The lists themselves are fetched by their own panels, not here. Prefetching both to label the
 * tabs cost up to ~15 KB gzipped on a view most people never click past; the profile payload
 * carries the two counts instead.
 */
export default function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  const { username } = useParams<{ username: string }>()
  const slug = username ?? ''
  const viewerProfile = useSignal(currentUserProfile)
  const isViewerModerator = !!viewerProfile?.isModerator
  const queryClient = useQueryClient()
  const pathname = usePathname()
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

  const { displayName, location, instruments } = profile.data

  const handleOpenSanitize = () => {
    setSanName(displayName)
    setSanBio(profile.data.bio ?? '')
    setSanLoc(location ?? '')
    setSanInst(instruments ?? '')
    setShowSanitizeModal(true)
  }

  const friendshipStatus = friendshipStatusQuery.data?.status
  const friendshipId = friendshipStatusQuery.data?.friendshipId

  const base = `/profile/${slug}`
  const tabs: Tab[] = [
    { href: base, label: 'Overview', icon: '👤' },
    { href: `${base}/tunes`, label: 'Tunes', icon: '🎵', badge: profile.data.activeTuneCount },
    { href: `${base}/sets`, label: 'Sets', icon: '🎼', badge: profile.data.setCount },
  ]

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

      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
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
      </div>

      <TabNav tabs={tabs} activeHref={pathname} fallbackHref={base} label="Profile" />

      <PublicProfileProvider
        value={{
          slug,
          profile: profile.data,
          userId: profile.data.userId,
          isViewerModerator,
          isOwnProfile: viewerProfile?.userId === profile.data.userId,
          gamification: gamification.data,
          moderatorDetails: moderatorDetails.data,
          onSelectBadge: setSelectedBadge,
        }}
      >
        {children}
      </PublicProfileProvider>

      <BadgeModal badge={selectedBadge} onClose={() => setSelectedBadge(null)} />

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
