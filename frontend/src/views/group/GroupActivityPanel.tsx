"use client";

import { useGroupDetail } from './groupDetailContext'

export function GroupActivityPanel() {
  const { details } = useGroupDetail()

  return (
    <div>
      <h2>Recent Activity</h2>
      {details.feed.length === 0 ? (
        <p className="tune-meta italic">No activity yet in this group.</p>
      ) : (
        <div className="activity-feed" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {details.feed.map((event, i) => (
            <div key={i} className="card" style={{ padding: '0.75rem 1rem' }}>
              <p style={{ margin: 0 }}>
                <strong>{event.memberName}</strong>{' '}
                {event.eventType === 'MemberJoined' ? (
                  'joined the group'
                ) : event.detail ? (
                  event.detail
                ) : (
                  <>
                    {event.eventType === 'GroupTuneAdded' ? 'added' : event.eventType === 'GroupTuneRemoved' ? 'removed' : 'learned'}{' '}
                    {event.tuneTitles.length === 1 ? (
                      <em>{event.tuneTitles[0]}</em>
                    ) : (
                      <>{event.tuneTitles.length} tunes: <em>{event.tuneTitles.join(', ')}</em></>
                    )}
                  </>
                )}
              </p>
              <span className="tune-meta" style={{ fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>
                {new Date(event.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
