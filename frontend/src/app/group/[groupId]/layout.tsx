"use client";

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname, useParams } from 'next/navigation'
import { getGroupDetails, joinGroup, leaveGroup } from '../../../services/api'
import { currentUserId, currentUserProfile, useAuthStatus, useSignal } from '../../../state/appState'
import { GroupDetailProvider } from '../../../views/group/groupDetailContext'
import { QRCodeModal } from '../../../components/QRCodeModal'

export default function GroupDetailLayout({ children }: { children: React.ReactNode }) {
  const { groupId } = useParams<{ groupId: string }>()
  const userId = useSignal(currentUserId)
  const profile = useSignal(currentUserProfile)
  const authStatus = useAuthStatus()
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [shareUrl, setShareUrl] = useState('')
  const [inviteCodeInput, setInviteCodeInput] = useState(searchParams.get('code') ?? '')
  const [showQrModal, setShowQrModal] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShareUrl(window.location.origin + `/group/${groupId}`)
    }
  }, [groupId])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['group-details', groupId, userId] })
    queryClient.invalidateQueries({ queryKey: ['groups', userId] })
    queryClient.invalidateQueries({ queryKey: ['group-sessions', groupId, userId] })
  }

  const groupQuery = useQuery({
    queryKey: ['group-details', groupId, userId],
    queryFn: () => getGroupDetails(groupId, userId),
    enabled: authStatus !== 'pending',
  })

  const joinMutation = useMutation({
    mutationFn: () => joinGroup(groupId, inviteCodeInput.trim() || undefined),
    onSuccess: invalidate,
  })

  const leaveMutation = useMutation({
    mutationFn: () => leaveGroup(groupId),
    onSuccess: () => {
      invalidate()
      router.push('/groups')
    },
  })

  if (groupQuery.isPending) {
    return <section><p>Loading group details…</p></section>
  }

  if (groupQuery.isError || !groupQuery.data) {
    return (
      <section>
        <p className="error">Could not load group details.</p>
        <Link href="/groups" prefetch={false}>← Back to groups</Link>
      </section>
    )
  }

  const isModerator = !!profile?.isModerator
  const details = groupQuery.data
  const showSignedInUi = authStatus !== 'anonymous'
  const isMember = details.viewerStatus === 'Active'
  const isPending = details.viewerStatus === 'Pending'
  const viewer = details.members.find((m) => m.userId === userId)
  const isAdmin = viewer?.role === 'Administrator' || viewer?.role === 'Owner' || isModerator
  const isOwner = viewer?.role === 'Owner'

  // Private groups hide all content from non-approved viewers; show a join gate instead unless caller is a Moderator.
  if (details.isPrivate && !isMember && !isModerator) {
    return (
      <section>
        <div style={{ marginBottom: '1rem' }}>
          <Link href="/groups" prefetch={false}>← Back to groups</Link>
        </div>
        <h1>🔒 {details.name}</h1>
        <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
          <p>This is a private group. {isPending ? '' : 'You need an invite code or admin approval to join.'}</p>

          {!showSignedInUi ? (
            <>
              <p className="tune-meta">Sign in to request access or enter an invite code.</p>
              <Link href="/login" prefetch={false}><button>Sign In</button></Link>
            </>
          ) : isPending ? (
            <>
              <p className="tune-meta">Your request to join is pending approval from a group admin.</p>
              <button
                className="secondary danger-hover"
                onClick={() => leaveMutation.mutate()}
                disabled={leaveMutation.isPending}
              >
                Withdraw Request
              </button>
            </>
          ) : (
            <>
              <label>
                Invite code (optional — leave blank to request approval instead)
                <input
                  type="text"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value)}
                  placeholder="e.g. AB3DE9FG"
                  style={{ display: 'block', marginTop: '0.35rem', fontFamily: 'monospace' }}
                />
              </label>
              <button
                style={{ marginTop: '1rem' }}
                onClick={() => joinMutation.mutate()}
                disabled={joinMutation.isPending}
              >
                {inviteCodeInput.trim() ? 'Join with Code' : 'Request to Join'}
              </button>
              {joinMutation.isSuccess && joinMutation.data.status === 'Pending' && (
                <p className="tune-meta" style={{ marginTop: '0.75rem' }}>Request sent — waiting for approval.</p>
              )}
              {joinMutation.isError && (
                <p className="error" style={{ marginTop: '0.75rem' }}>
                  {(joinMutation.error as Error).message || 'Could not join this group.'}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    )
  }

  const base = `/group/${groupId}`
  const tabs: { href: string; label: string; icon: string; badge?: number }[] = [
    { href: base, label: 'Overview & Calendar', icon: '📅' },
    { href: `${base}/tunes`, label: 'Master Tune List', icon: '🎵', badge: details.masterTunes.length },
    { href: `${base}/sets`, label: 'Set Lists', icon: '🎼' },
    { href: `${base}/repertoire`, label: 'Shared Repertoire', icon: '🎶' },
    { href: `${base}/activity`, label: 'Activity', icon: '⚡' },
    { href: `${base}/members`, label: 'Members', icon: '👥', badge: details.members.length },
    ...(isAdmin ? [{ href: `${base}/settings`, label: 'Settings', icon: '⚙️' }] : []),
  ]

  return (
    <section>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/groups" prefetch={false}>← Back to groups</Link>
      </div>

      {isModerator && details.isPrivate && !isMember && (
        <div
          className="card"
          style={{
            padding: '0.75rem 1.25rem',
            marginBottom: '1rem',
            background: 'rgba(239, 100, 97, 0.15)',
            border: '1px solid #ef6461',
            borderRadius: '8px',
            color: '#fca5a5',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>🛡️ Moderator Inspection Mode — Viewing Private Group</span>
        </div>
      )}

      <div className="set-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>{details.isPrivate ? '🔒 ' : ''}{details.name}</h1>
            {details.city && <span style={{ fontSize: '1rem', color: 'var(--accent)', fontWeight: 600 }}>📍 {details.city}</span>}
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
            <span>{details.members.length} {details.members.length === 1 ? 'member' : 'members'}</span>
            {details.schedules && details.schedules.length > 0 && (
              <span>🕒 {details.schedules.map((s) => (s.name ? `${s.name} (${s.meetingScheduleText || 'Regular meetup'})` : (s.meetingScheduleText || 'Regular meetup'))).join(' • ')}</span>
            )}
          </div>
        </div>

        {isMember ? (
          isOwner ? (
            <span className="tune-meta" style={{ fontSize: '0.8rem', maxWidth: '18rem', textAlign: 'right' }}>
              As the owner you can&rsquo;t leave — transfer ownership (Members) or delete the group (Settings).
            </span>
          ) : (
            <button
              className="secondary danger-hover"
              onClick={() => leaveMutation.mutate()}
              disabled={leaveMutation.isPending}
            >
              Leave Group
            </button>
          )
        ) : showSignedInUi ? (
          <button
            onClick={() => joinMutation.mutate()}
            disabled={joinMutation.isPending}
          >
            Join Group
          </button>
        ) : (
          <Link href="/login" prefetch={false}><button>Sign In to Join</button></Link>
        )}
      </div>

      {details.description && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', background: 'var(--surface-2)' }}>
          <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {details.description}
          </p>
        </div>
      )}

      {leaveMutation.isError && (
        <p className="error" style={{ marginBottom: '1rem' }}>
          {(leaveMutation.error as Error).message || 'Could not leave group.'}
        </p>
      )}

      {!isMember && (
        <div className="card" style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid var(--accent)', padding: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, color: 'var(--accent)' }}>
            <strong>Guest View:</strong> You are viewing this group dashboard{showSignedInUi ? '' : ' as a visitor'}.{' '}
            {showSignedInUi ? 'Join the group to share your repertoire and play history.' : (
              <>
                <Link href="/login" prefetch={false}>Sign in</Link> to join, RSVP, and share your repertoire.
              </>
            )}
          </p>
        </div>
      )}

      {/* Responsive Group Navigation Menu */}
      <nav className="group-detail-nav" aria-label="Group Details Section Navigation" style={{ marginBottom: '1.75rem' }}>
        {/* Mobile Section Picker Dropdown */}
        <div className="mobile-tab-select" style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.35rem' }}>
            Jump to section:
          </label>
          <select
            value={tabs.find((t) => t.href === pathname)?.href ?? base}
            onChange={(e) => router.push(e.target.value)}
            style={{
              width: '100%',
              padding: '0.6rem 0.85rem',
              fontSize: '0.95rem',
              fontWeight: 600,
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
            }}
          >
            {tabs.map((tab) => (
              <option key={tab.href} value={tab.href}>
                {tab.icon} {tab.label}{tab.badge !== undefined ? ` (${tab.badge})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Desktop / Responsive Segmented Pill Navigation Bar */}
        <div
          className="group-tabs-pills"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.4rem',
            padding: '0.35rem',
            background: 'var(--surface-2)',
            borderRadius: '10px',
            border: '1px solid var(--border)',
          }}
        >
          {tabs.map((tab) => {
            const active = pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch={false}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.5rem 0.85rem',
                  fontSize: '0.9rem',
                  fontWeight: active ? 600 : 400,
                  borderRadius: '7px',
                  border: 'none',
                  textDecoration: 'none',
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--muted)',
                  cursor: 'pointer',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
                  outline: active ? '1px solid var(--accent)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: '0.1rem 0.45rem',
                      borderRadius: '999px',
                      background: active ? 'var(--accent)' : 'var(--border)',
                      color: active ? '#000' : 'var(--text)',
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      <GroupDetailProvider
        value={{ groupId, userId, details, viewer, isAdmin, isMember, isOwner, isModerator, showSignedInUi, invalidate }}
      >
        {children}
      </GroupDetailProvider>

      {/* Sharing Invite Box */}
      <div className="card" style={{ marginTop: '2.5rem', border: '1px dashed var(--border)', background: 'var(--surface)' }}>
        <h3>Invite Musicians</h3>
        <p className="tune-meta">
          {details.isPrivate
            ? 'Share this link or QR code — since the group is private, members scanning the QR code will automatically have the invite code pre-filled.'
            : 'Share this link or QR code with other session players so they can view and join your group:'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            readOnly
            value={details.isPrivate && details.inviteCode ? `${shareUrl}?code=${details.inviteCode}` : shareUrl}
            style={{ flex: 1, minWidth: '220px', padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.9rem' }}
          />
          <button
            onClick={() => {
              const link = details.isPrivate && details.inviteCode ? `${shareUrl}?code=${details.inviteCode}` : shareUrl
              navigator.clipboard.writeText(link)
              alert('Join link copied to clipboard!')
            }}
          >
            Copy Link
          </button>
          <button
            className="secondary"
            onClick={() => setShowQrModal(true)}
          >
            📱 Show QR Code
          </button>
        </div>
      </div>

      <QRCodeModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        title={`Group Invite: ${details.name}`}
        subtitle={details.isPrivate ? 'Scan with a phone camera to join this private group' : 'Scan to open and join this group'}
        url={details.isPrivate && details.inviteCode ? `${shareUrl}?code=${details.inviteCode}` : shareUrl}
        downloadFilename={`group-${details.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-qr.png`}
      />
    </section>
  )
}
