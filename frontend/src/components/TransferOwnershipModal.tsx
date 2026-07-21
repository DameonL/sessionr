"use client";

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { transferGroupOwnership } from '../services/api'

interface TransferOwnershipModalProps {
  groupId: string
  userId: string
  target: { userId: string; displayName: string }
  onClose: () => void
  onTransferred: () => void
}

export function TransferOwnershipModal({
  groupId,
  userId,
  target,
  onClose,
  onTransferred,
}: TransferOwnershipModalProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const mutation = useMutation({
    mutationFn: () => transferGroupOwnership(groupId, target.userId),
    onSuccess: () => {
      onTransferred()
      onClose()
    },
  })

  const confirmed = confirmText.trim().toLowerCase() === target.displayName.trim().toLowerCase()
  const canSubmit = acknowledged && confirmed && !mutation.isPending

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Transfer Group Ownership</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div
          className="card"
          style={{
            background: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid #dc2626',
            padding: '1rem',
            margin: '1rem 0',
          }}
        >
          <p style={{ margin: 0 }}>
            You are about to make <strong>{target.displayName}</strong> the owner of this group.
            You will immediately lose owner privileges and become an administrator instead.
            Only <strong>{target.displayName}</strong> will be able to transfer ownership back to you.
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginTop: '0.2rem' }}
          />
          <span>I understand I will no longer be the owner of this group.</span>
        </label>

        <label>
          Type <strong>{target.displayName}</strong> to confirm
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={target.displayName}
            style={{ width: '100%', marginTop: '0.35rem' }}
          />
        </label>

        {mutation.isError && (
          <p className="error" style={{ marginTop: '0.75rem' }}>
            {(mutation.error as Error).message || 'Failed to transfer ownership.'}
          </p>
        )}

        <div className="form-actions" style={{ marginTop: '1.5rem' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="danger-hover"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Transferring…' : 'Transfer Ownership'}
          </button>
        </div>
      </div>
    </div>
  )
}
