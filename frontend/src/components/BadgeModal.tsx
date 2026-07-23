"use client";

import { Dialog } from './Dialog'
import { getBadgeInfo } from '../services/badges'
import type { UserBadge } from '../services/api'

interface BadgeModalProps {
  badge: UserBadge | null
  onClose: () => void
}

export function BadgeModal({ badge, onClose }: BadgeModalProps) {
  if (!badge) return null

  const info = getBadgeInfo(badge.badgeKey)
  const earnedDate = badge.earnedAt
    ? new Date(badge.earnedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <Dialog isOpen={!!badge} title="" onClose={onClose} maxWidth="420px">
      <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem', lineHeight: 1 }}>
          {info.emoji}
        </div>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: 'var(--text)' }}>
          {info.label}
        </h3>
        <div
          className="card"
          style={{
            padding: '1rem',
            margin: '1rem 0',
            background: 'var(--surface-2)',
            borderRadius: '8px',
          }}
        >
          <p style={{ fontSize: '0.95rem', color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
            {info.description || 'Awarded for achievement in sessionr.'}
          </p>
        </div>
        {earnedDate && (
          <p className="tune-meta" style={{ fontSize: '0.85rem', color: 'var(--accent)', margin: 0, fontWeight: 600 }}>
            ✨ Earned on {earnedDate}
          </p>
        )}
      </div>
    </Dialog>
  )
}
