"use client";

import { getBadgeInfo } from '../../services/badges'
import { usePublicProfile } from './publicProfileContext'

/** The profile's index tab: what the musician says about themselves, and what they've earned. */
export function ProfileOverviewPanel() {
  const { profile, isViewerModerator, moderatorDetails, gamification, onSelectBadge } = usePublicProfile()
  const { bio, location, instruments } = profile
  const isEmpty = !bio && !location && !instruments

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      {isViewerModerator && moderatorDetails && (
        <div
          className="card"
          style={{
            padding: '1rem',
            marginBottom: '1rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--accent)',
            borderRadius: '8px',
            fontSize: '0.85rem',
          }}
        >
          <strong style={{ color: 'var(--accent)' }}>🛡️ Moderator Inspection Details:</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', marginTop: '0.5rem' }}>
            <div>📧 <strong>Email:</strong> {moderatorDetails.email}</div>
            <div>🔑 <strong>User ID:</strong> {moderatorDetails.userId}</div>
            <div>👥 <strong>Group Memberships:</strong> {moderatorDetails.groupCount}</div>
            <div>🎵 <strong>Repertoire Tunes:</strong> {moderatorDetails.tuneCount}</div>
          </div>
        </div>
      )}

      {bio && <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{bio}</p>}
      {isEmpty && <p className="tune-meta" style={{ marginTop: 0 }}>This musician hasn't added anything to their profile yet.</p>}

      {gamification && (
        <div style={{ marginTop: bio || isEmpty ? '1rem' : 0 }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            🏆 {gamification.totalPoints} points
          </div>
          {gamification.badges.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {gamification.badges.map((b) => {
                const info = getBadgeInfo(b.badgeKey)
                return (
                  <span
                    key={b.badgeKey}
                    className="card badge-pill"
                    onClick={() => onSelectBadge(b)}
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
  )
}
