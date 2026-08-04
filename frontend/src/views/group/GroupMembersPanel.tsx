"use client";

import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  updateGroupPrivacy,
  regenerateGroupInviteCode,
  approveGroupMember,
  rejectGroupMember,
  removeGroupMember,
  grantGroupAdministrator,
  revokeGroupAdministrator,
  type GroupMember,
} from '../../services/api'
import { showToast } from '../../state/appState'
import { Dialog } from '../../components/Dialog'
import { TransferOwnershipModal } from '../../components/TransferOwnershipModal'
import { QRCodeModal } from '../../components/QRCodeModal'
import { useGroupDetail } from './groupDetailContext'

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

export function GroupMembersPanel() {
  const { groupId, userId, isAdmin, isOwner, viewer, details, invalidate } = useGroupDetail()
  const queryClient = useQueryClient()

  const [showPrivacyConfirm, setShowPrivacyConfirm] = useState(false)
  const [transferTarget, setTransferTarget] = useState<{ userId: string; displayName: string } | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [showQrModal, setShowQrModal] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShareUrl(window.location.origin + `/group/${groupId}`)
    }
  }, [groupId])

  const privacyMutation = useMutation({
    mutationFn: (isPrivate: boolean) => updateGroupPrivacy(groupId, isPrivate),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['group-details', groupId, userId], (oldData: any) => {
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
    mutationFn: () => regenerateGroupInviteCode(groupId),
    onSuccess: invalidate,
  })

  const approveMutation = useMutation({
    mutationFn: (targetUserId: string) => approveGroupMember(groupId, targetUserId),
    onSuccess: invalidate,
  })

  const rejectMutation = useMutation({
    mutationFn: (targetUserId: string) => rejectGroupMember(groupId, targetUserId),
    onSuccess: invalidate,
  })

  const removeMemberMutation = useMutation({
    mutationFn: (targetUserId: string) => removeGroupMember(groupId, targetUserId),
    onSuccess: invalidate,
  })

  const promoteMutation = useMutation({
    mutationFn: (targetUserId: string) => grantGroupAdministrator(groupId, targetUserId),
    onSuccess: invalidate,
  })

  const demoteMutation = useMutation({
    mutationFn: (targetUserId: string) => revokeGroupAdministrator(groupId, targetUserId),
    onSuccess: invalidate,
  })

  const canRemove = (target: GroupMember) => {
    if (target.userId === userId) return false
    if (viewer?.role === 'Owner') return target.role !== 'Owner'
    if (viewer?.role === 'Administrator') return target.role === 'Member'
    return false
  }

  return (
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
            <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="tune-meta">Invite code:</span>{' '}
              <code style={{ fontSize: '1rem' }}>{details.inviteCode}</code>
              <button
                className="secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                onClick={() => {
                  navigator.clipboard.writeText(`${shareUrl}?code=${details.inviteCode}`)
                  alert('Invite link copied to clipboard!')
                }}
              >
                Copy Invite Link
              </button>
              <button
                className="secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                onClick={() => setShowQrModal(true)}
              >
                📱 QR Code Invite
              </button>
              <button
                className="secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                onClick={() => regenerateCodeMutation.mutate()}
                disabled={regenerateCodeMutation.isPending}
              >
                Regenerate Code
              </button>
            </div>
          )}
        </div>
      )}

      <QRCodeModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        title={`Group Invite: ${details.name}`}
        subtitle="Scan with a phone camera to join this private group with invite code pre-filled"
        url={`${shareUrl}?code=${details.inviteCode}`}
        downloadFilename={`group-${details.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-invite-qr.png`}
      />

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

      {transferTarget !== null && (
        <TransferOwnershipModal
          groupId={groupId}
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
    </div>
  )
}
