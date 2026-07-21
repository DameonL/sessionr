"use client";

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  getGroupDetails,
  joinGroup,
  leaveGroup,
  getFullRepertoireList,
  addToRepertoire,
  formatTuneType,
  searchTunes,
  addGroupTune,
  updateGroupTune,
  removeGroupTune,
  removeGroupMember,
  grantGroupAdministrator,
  revokeGroupAdministrator,
  updateGroupPrivacy,
  regenerateGroupInviteCode,
  approveGroupMember,
  rejectGroupMember,
  type GroupMember,
  type GroupTuneListItem,
} from '../services/api'
import { currentUserId, useSignal, showToast } from '../state/appState'
import { Dialog } from '../components/Dialog'
import { TuneSettingsModal } from '../components/TuneSettingsModal'
import { TransferOwnershipModal } from '../components/TransferOwnershipModal'
import { GroupSetBuilder } from '../components/GroupSetBuilder'
import { GroupSessions } from '../components/GroupSessions'
import { GroupCalendar } from '../components/GroupCalendar'
import { GroupUpdates } from '../components/GroupUpdates'
import { GroupAdminSettings } from '../components/GroupAdminSettings'
import { getGroupSessions } from '../services/api'

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    color: active ? 'var(--text)' : 'var(--muted)',
    padding: '0.75rem 1.25rem',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: active ? '600' : '400',
  }
}

function RoleBadge({ role }: { role: GroupMember['role'] }) {
  const colors: Record<GroupMember['role'], string> = {
    Owner: 'var(--accent)',
    Administrator: 'var(--learning)',
    Member: 'var(--muted)',
  }
  return (
    <span
      style={{
        fontSize: '0.75rem',
        fontWeight: 600,
        color: colors[role],
        border: `1px solid ${colors[role]}`,
        borderRadius: '999px',
        padding: '0.1rem 0.55rem',
      }}
    >
      {role}
    </span>
  )
}

export function GroupDetail({ groupId }: { groupId: string }) {
  const id = groupId
  const userId = useSignal(currentUserId)
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<'overview' | 'tunes' | 'sets' | 'repertoire' | 'activity' | 'members' | 'settings'>('overview')
  const [shareUrl, setShareUrl] = useState('')
  const [inviteCodeInput, setInviteCodeInput] = useState(searchParams.get('code') ?? '')

  // Master tune list: add-tune search and setting-selection modals
  const [tuneSearch, setTuneSearch] = useState('')
  const [addTuneId, setAddTuneId] = useState<string | null>(null)
  const [settingChangeTarget, setSettingChangeTarget] = useState<GroupTuneListItem | null>(null)
  const [transferTarget, setTransferTarget] = useState<{ userId: string; displayName: string } | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShareUrl(window.location.origin + `/group/${id}`)
    }
  }, [id])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['group-details', id, userId] })
    queryClient.invalidateQueries({ queryKey: ['groups', userId] })
    queryClient.invalidateQueries({ queryKey: ['group-sessions', id, userId] })
  }

  // Fetch group details
  const groupQuery = useQuery({
    queryKey: ['group-details', id, userId],
    queryFn: () => getGroupDetails(id, userId),
  })

  // Fetch group sessions for calendar
  const sessionsQuery = useQuery({
    queryKey: ['group-sessions', id, userId],
    queryFn: () => getGroupSessions(id, userId),
  })

  // Fetch user's own repertoire (tune IDs only) to check if they already have tunes (signed-in members only)
  const repertoireQuery = useQuery({
    queryKey: ['repertoire-list-full', userId],
    queryFn: getFullRepertoireList,
    enabled: !!userId,
  })

  const librarySearch = useQuery({
    queryKey: ['tunes', tuneSearch],
    queryFn: () => searchTunes(tuneSearch),
    enabled: tuneSearch.length >= 2,
  })

  // Join group mutation (invite code is only meaningful for private groups)
  const joinMutation = useMutation({
    mutationFn: () => joinGroup(id, inviteCodeInput.trim() || undefined),
    onSuccess: invalidate,
  })

  const [showPrivacyConfirm, setShowPrivacyConfirm] = useState(false)

  const privacyMutation = useMutation({
    mutationFn: (isPrivate: boolean) => updateGroupPrivacy(id, isPrivate),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['group-details', id, userId], (oldData: any) => {
        if (!oldData) return oldData
        return { ...oldData, isPrivate: variables }
      })
      invalidate()
      setShowPrivacyConfirm(false)
      showToast(
        variables ? 'Group is now private!' : 'Group is now public!',
        'success'
      )
    },
  })

  const regenerateCodeMutation = useMutation({
    mutationFn: () => regenerateGroupInviteCode(id),
    onSuccess: invalidate,
  })



  const approveMutation = useMutation({
    mutationFn: (targetUserId: string) => approveGroupMember(id, targetUserId),
    onSuccess: invalidate,
  })

  const rejectMutation = useMutation({
    mutationFn: (targetUserId: string) => rejectGroupMember(id, targetUserId),
    onSuccess: invalidate,
  })

  // Leave group mutation
  const leaveMutation = useMutation({
    mutationFn: () => leaveGroup(id),
    onSuccess: () => {
      invalidate()
      router.push('/groups')
    },
  })

  // Add to repertoire from common tunes
  const addTuneMutation = useMutation({
    mutationFn: (tuneId: string) => addToRepertoire(tuneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repertoire-list-full', userId] })
    },
  })

  const removeGroupTuneMutation = useMutation({
    mutationFn: (groupTuneId: string) => removeGroupTune(id, groupTuneId),
    onSuccess: invalidate,
  })

  const removeMemberMutation = useMutation({
    mutationFn: (targetUserId: string) => removeGroupMember(id, targetUserId),
    onSuccess: invalidate,
  })

  const promoteMutation = useMutation({
    mutationFn: (targetUserId: string) => grantGroupAdministrator(id, targetUserId),
    onSuccess: invalidate,
  })

  const demoteMutation = useMutation({
    mutationFn: (targetUserId: string) => revokeGroupAdministrator(id, targetUserId),
    onSuccess: invalidate,
  })

  if (groupQuery.isLoading) {
    return <section><p>Loading group details…</p></section>
  }

  if (groupQuery.isError || !groupQuery.data) {
    return (
      <section>
        <p className="error">Could not load group details.</p>
        <Link href="/groups">← Back to groups</Link>
      </section>
    )
  }

  const details = groupQuery.data
  const isSignedIn = !!userId
  const isMember = details.viewerStatus === 'Active'
  const isPending = details.viewerStatus === 'Pending'
  const viewer = details.members.find((m) => m.userId === userId)
  const isAdmin = viewer?.role === 'Administrator' || viewer?.role === 'Owner'
  const isOwner = viewer?.role === 'Owner'
  const userTuneIds = new Set(repertoireQuery.data?.map((t) => t.tuneId) ?? [])
  const masterTuneIds = new Set(details.masterTunes.map((t) => t.tuneId))
  const librarySearchMatches = (librarySearch.data?.items ?? []).filter((t) => !masterTuneIds.has(t.tuneId))

  const canRemove = (target: GroupMember) => {
    if (target.userId === userId) return false
    if (viewer?.role === 'Owner') return target.role !== 'Owner'
    if (viewer?.role === 'Administrator') return target.role === 'Member'
    return false
  }

  // Private groups hide all content from non-approved viewers; show a join gate instead.
  if (details.isPrivate && !isMember) {
    return (
      <section>
        <div style={{ marginBottom: '1rem' }}>
          <Link href="/groups">← Back to groups</Link>
        </div>
        <h1>🔒 {details.name}</h1>
        <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
          <p>This is a private group. {isPending ? '' : 'You need an invite code or admin approval to join.'}</p>

          {!isSignedIn ? (
            <>
              <p className="tune-meta">Sign in to request access or enter an invite code.</p>
              <Link href="/login"><button>Sign In</button></Link>
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

  return (
    <section>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/groups">← Back to groups</Link>
      </div>

      <div className="set-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>{details.isPrivate ? '🔒 ' : ''}{details.name}</h1>
            {details.city && <span style={{ fontSize: '1rem', color: 'var(--accent)', fontWeight: 600 }}>📍 {details.city}</span>}
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
            <span>{details.members.length} {details.members.length === 1 ? 'member' : 'members'}</span>
            {details.schedules && details.schedules.length > 0 && (
              <span>🕒 {details.schedules.map((s) => s.meetingScheduleText || 'Regular meetup').join(' • ')}</span>
            )}
          </div>
        </div>

        {isMember ? (
          <button
            className="secondary danger-hover"
            onClick={() => leaveMutation.mutate()}
            disabled={leaveMutation.isPending}
          >
            Leave Group
          </button>
        ) : isSignedIn ? (
          <button
            onClick={() => joinMutation.mutate()}
            disabled={joinMutation.isPending}
          >
            Join Group
          </button>
        ) : (
          <Link href="/login"><button>Sign In to Join</button></Link>
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
            <strong>Guest View:</strong> You are viewing this group dashboard{isSignedIn ? '' : ' as a visitor'}.{' '}
            {isSignedIn ? 'Join the group to share your repertoire and play history.' : (
              <>
                <Link href="/login">Sign in</Link> to join, RSVP, and share your repertoire.
              </>
            )}
          </p>
        </div>
      )}

      {/* Tabs Menu */}
      <div className="tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')} style={tabStyle(activeTab === 'overview')}>
          Overview & Calendar
        </button>
        <button className={`tab-btn ${activeTab === 'tunes' ? 'active' : ''}`} onClick={() => setActiveTab('tunes')} style={tabStyle(activeTab === 'tunes')}>
          Master Tune List
        </button>
        <button className={`tab-btn ${activeTab === 'sets' ? 'active' : ''}`} onClick={() => setActiveTab('sets')} style={tabStyle(activeTab === 'sets')}>
          Set Lists
        </button>
        <button className={`tab-btn ${activeTab === 'repertoire' ? 'active' : ''}`} onClick={() => setActiveTab('repertoire')} style={tabStyle(activeTab === 'repertoire')}>
          Shared Repertoire
        </button>
        <button className={`tab-btn ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')} style={tabStyle(activeTab === 'activity')}>
          Practice Feed
        </button>
        <button className={`tab-btn ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')} style={tabStyle(activeTab === 'members')}>
          Members ({details.members.length})
        </button>
        {isAdmin && (
          <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')} style={tabStyle(activeTab === 'settings')}>
            ⚙️ Settings
          </button>
        )}
      </div>

      {/* Tab Panels */}
      {activeTab === 'settings' && isAdmin && (
        <GroupAdminSettings
          details={details}
          userId={userId}
          isOwner={isOwner}
          onSaved={invalidate}
        />
      )}
      {activeTab === 'overview' && (
        <div>
          <GroupCalendar
            schedules={details.schedules ?? []}
            sessions={sessionsQuery.data ?? []}
          />

          <GroupUpdates
            groupId={id}
            userId={userId}
            isAdmin={isAdmin}
            updates={details.updates ?? []}
          />
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'tunes' && (
        <div>
          <h2>Master Tune List</h2>
          <p className="tune-meta italic">
            The curated list of tunes this group plays, including the specific setting used for each.
            {isAdmin ? ' As an administrator, you can add, remove, and change settings below.' : ' Only group administrators can edit this list.'}
          </p>

          {details.masterTunes.length === 0 ? (
            <p className="tune-meta italic">No tunes on the master list yet.</p>
          ) : (
            <ul className="tune-list">
              {details.masterTunes.map((t) => (
                <li key={t.groupTuneId} className="card tune-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1 }}>
                    <span className="tune-title">{t.title}</span>
                    <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                      {formatTuneType(t.tuneType)} · Key: {t.key}
                      {t.settingSubmitterName ? ` · Setting by ${t.settingSubmitterName}` : ''}
                      {' · added by '}{t.addedByDisplayName}
                    </span>
                  </div>

                  {isAdmin && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => setSettingChangeTarget(t)}
                      >
                        Change Setting
                      </button>
                      <button
                        className="secondary danger-hover"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => removeGroupTuneMutation.mutate(t.groupTuneId)}
                        disabled={removeGroupTuneMutation.isPending}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <div style={{ marginTop: '2rem' }}>
              <h3>Add a Tune</h3>
              <input
                className="search-box"
                type="search"
                placeholder="Search tunes… (title, type, or key)"
                value={tuneSearch}
                onChange={(e) => setTuneSearch(e.target.value)}
              />
              {tuneSearch.length >= 2 && (
                <ul className="tune-list" style={{ marginTop: '0.75rem' }}>
                  {librarySearchMatches.length === 0 && <p className="tune-meta italic">No matches found.</p>}
                  {librarySearchMatches.map((tune) => (
                    <li key={tune.tuneId} className="card tune-row">
                      <span className="tune-title">{tune.title}</span>
                      <span className="tune-meta">
                        {formatTuneType(tune.tuneType)} · {tune.key}
                      </span>
                      <button onClick={() => setAddTuneId(tune.tuneId)}>+ Add</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'sets' && (
        <GroupSetBuilder groupId={id} userId={userId} isAdmin={isAdmin} masterTunes={details.masterTunes} />
      )}

      {activeTab === 'repertoire' && (
        <div>
          <h2>Tunes Known in Common</h2>
          {details.commonTunes.length === 0 ? (
            <p className="tune-meta italic">No shared repertoire found. Add tunes to your repertoires to see them here.</p>
          ) : (
            <ul className="tune-list">
              {details.commonTunes.map((t) => {
                const alreadyHas = userTuneIds.has(t.tuneId)
                const isOnMaster = masterTuneIds.has(t.tuneId)
                const percent = Math.round((t.memberCount / t.totalMembersInGroup) * 100)

                return (
                  <li key={t.tuneId} className="card tune-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <span className="tune-title">{t.title}</span>
                      <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                        {formatTuneType(t.tuneType)} · Key: {t.key}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span className={`badge ${percent === 100 ? 'badge-active' : 'badge-learning'}`}>
                        {t.memberCount}/{t.totalMembersInGroup} ({percent}%)
                      </span>

                      {isAdmin && !isOnMaster && (
                        <button
                          className="secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                          onClick={() => setAddTuneId(t.tuneId)}
                        >
                          + Add to Master List
                        </button>
                      )}

                      {!alreadyHas && isMember && (
                        <button
                          className="secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                          onClick={() => addTuneMutation.mutate(t.tuneId)}
                          disabled={addTuneMutation.isPending}
                        >
                          + Repertoire
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div>
          <h2>Recent Activity</h2>
          {details.recentActivity.length === 0 ? (
            <p className="tune-meta italic">No practice activity logged yet by members of this group.</p>
          ) : (
            <div className="activity-feed" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {details.recentActivity.map((act, i) => (
                <div key={i} className="card" style={{ padding: '0.75rem 1rem' }}>
                  <p style={{ margin: 0 }}>
                    <strong>{act.memberName}</strong> practiced <em>{act.tuneTitle}</em>
                  </p>
                  <span className="tune-meta" style={{ fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>
                    {new Date(act.practicedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div>
          {isAdmin && (
            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
              <h3 style={{ marginTop: 0 }}>Privacy &amp; Invites</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <strong>Visibility:</strong>{' '}
                  <span className="tune-meta">
                    {details.isPrivate
                      ? 'Private (new members need an invite code or admin approval)'
                      : 'Public (anyone can join instantly)'}
                  </span>
                </div>
                <button
                  type="button"
                  className={details.isPrivate ? 'primary' : 'secondary'}
                  onClick={() => setShowPrivacyConfirm(true)}
                  disabled={privacyMutation.isPending}
                >
                  {details.isPrivate ? 'Make Group Public' : 'Make Group Private'}
                </button>
              </div>

              {details.isPrivate && details.inviteCode && (
                <div style={{ marginTop: '0.75rem' }}>
                  <span className="tune-meta">Invite code:</span>{' '}
                  <code style={{ fontSize: '1rem' }}>{details.inviteCode}</code>
                  <button
                    className="secondary"
                    style={{ marginLeft: '0.75rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                    onClick={() => {
                      navigator.clipboard.writeText(`${shareUrl}?code=${details.inviteCode}`)
                      alert('Invite link copied to clipboard!')
                    }}
                  >
                    Copy Invite Link
                  </button>
                  <button
                    className="secondary"
                    style={{ marginLeft: '0.5rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                    onClick={() => regenerateCodeMutation.mutate()}
                    disabled={regenerateCodeMutation.isPending}
                  >
                    Regenerate Code
                  </button>
                </div>
              )}
            </div>
          )}

          {isAdmin && details.pendingMembers.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3>Pending Requests ({details.pendingMembers.length})</h3>
              {(approveMutation.isError || rejectMutation.isError) && (
                <p className="error">
                  {((approveMutation.error || rejectMutation.error) as Error)?.message || 'Action failed.'}
                </p>
              )}
              <ul className="tune-list">
                {details.pendingMembers.map((m) => (
                  <li key={m.userId} className="card tune-row">
                    <div style={{ flex: 1 }}>
                      <strong>{m.displayName}</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => approveMutation.mutate(m.userId)}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </button>
                      <button
                        className="secondary danger-hover"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => rejectMutation.mutate(m.userId)}
                        disabled={rejectMutation.isPending}
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2>Group Members</h2>
          {(removeMemberMutation.isError || promoteMutation.isError || demoteMutation.isError) && (
            <p className="error">
              {((removeMemberMutation.error || promoteMutation.error || demoteMutation.error) as Error)?.message
                || 'Action failed.'}
            </p>
          )}
          <ul className="tune-list">
            {details.members.map((m) => (
              <li key={m.userId} className="card tune-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <strong style={{ fontSize: '1.05rem' }}>{m.displayName}</strong>
                  <RoleBadge role={m.role} />
                </div>

                {(isOwner || isAdmin) && m.userId !== userId && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                    {isOwner && m.role === 'Member' && (
                      <button
                        className="secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => promoteMutation.mutate(m.userId)}
                        disabled={promoteMutation.isPending}
                      >
                        Make Administrator
                      </button>
                    )}
                    {isOwner && m.role === 'Administrator' && (
                      <button
                        className="secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => demoteMutation.mutate(m.userId)}
                        disabled={demoteMutation.isPending}
                      >
                        Remove Administrator
                      </button>
                    )}
                    {isOwner && m.role !== 'Owner' && (
                      <button
                        className="secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => setTransferTarget({ userId: m.userId, displayName: m.displayName })}
                      >
                        Transfer Ownership
                      </button>
                    )}
                    {canRemove(m) && (
                      <button
                        className="secondary danger-hover"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => removeMemberMutation.mutate(m.userId)}
                        disabled={removeMemberMutation.isPending}
                      >
                        Remove from Group
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sharing Invite Box */}
      <div className="card" style={{ marginTop: '2.5rem', border: '1px dashed var(--border)', background: 'var(--surface)' }}>
        <h3>Invite Musicians</h3>
        <p className="tune-meta">
          {details.isPrivate
            ? 'Share this link — since the group is private, they\'ll need to request to join or use an invite code (see Members tab).'
            : 'Share this link with other session players so they can view and join your group:'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input
            type="text"
            readOnly
            value={shareUrl}
            style={{ flex: 1, padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.9rem' }}
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl)
              alert('Join link copied to clipboard!')
            }}
          >
            Copy Link
          </button>
        </div>
      </div>

      {addTuneId !== null && (
        <TuneSettingsModal
          tuneId={addTuneId}
          userId={userId}
          onClose={() => setAddTuneId(null)}
          onAdded={invalidate}
          onSelectSetting={(settingId) => addGroupTune(id, addTuneId, settingId)}
          actionLabel="+ Add to Master List"
        />
      )}

      {settingChangeTarget !== null && (
        <TuneSettingsModal
          tuneId={settingChangeTarget.tuneId}
          userId={userId}
          onClose={() => setSettingChangeTarget(null)}
          onAdded={invalidate}
          onSelectSetting={(settingId) => updateGroupTune(id, settingChangeTarget.groupTuneId, settingId)}
          actionLabel="Use this setting"
        />
      )}

      {transferTarget !== null && (
        <TransferOwnershipModal
          groupId={id}
          userId={userId}
          target={transferTarget}
          onClose={() => setTransferTarget(null)}
          onTransferred={invalidate}
        />
      )}

      <Dialog
        isOpen={showPrivacyConfirm}
        title="Change Group Visibility"
        onClose={() => setShowPrivacyConfirm(false)}
      >
        <div>
          <p>
            Are you sure you want to make this group{' '}
            <strong>{details.isPrivate ? 'Public' : 'Private'}</strong>?
          </p>
          <p className="tune-meta">
            {details.isPrivate
              ? 'Making the group public allows anyone to instantly view and join. No invite code or administrator approval will be required.'
              : 'Making the group private hides the group content from non-members. New members will need to enter an invite code or request access to join.'}
          </p>
        </div>
        {privacyMutation.isError && (
          <p className="error" style={{ marginTop: '0.75rem' }}>
            {(privacyMutation.error as Error).message || 'Failed to update visibility.'}
          </p>
        )}
        <div className="form-actions" style={{ marginTop: '1.5rem' }}>
          <button
            type="button"
            className="secondary"
            onClick={() => setShowPrivacyConfirm(false)}
            disabled={privacyMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={details.isPrivate ? 'secondary' : 'primary'}
            onClick={() => privacyMutation.mutate(!details.isPrivate)}
            disabled={privacyMutation.isPending}
          >
            {privacyMutation.isPending
              ? 'Updating…'
              : details.isPrivate
                ? 'Make Public'
                : 'Make Private'}
          </button>
        </div>
      </Dialog>
    </section>
  )
}
