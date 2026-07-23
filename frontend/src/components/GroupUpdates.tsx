"use client";

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createGroupUpdate, deleteGroupUpdate, type GroupUpdateData, parseServerDate } from '../services/api'
import { currentUserProfile, useSignal, showToast } from '../state/appState'

interface GroupUpdatesProps {
  groupId: string
  userId: string
  isAdmin: boolean
  updates: GroupUpdateData[]
}

export function GroupUpdates({ groupId, userId, isAdmin, updates }: GroupUpdatesProps) {
  const profile = useSignal(currentUserProfile)
  const isModerator = !!profile?.isModerator
  const canDelete = isAdmin || isModerator
  const queryClient = useQueryClient()

  const [showPostForm, setShowPostForm] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const postMutation = useMutation({
    mutationFn: () => createGroupUpdate(groupId, title.trim(), content.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', groupId] })
      setTitle('')
      setContent('')
      setShowPostForm(false)
      setError(null)
      showToast('Group update posted!')
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to post update.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (updateId: string) => deleteGroupUpdate(groupId, updateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', groupId] })
      showToast('Update deleted.')
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to delete update.', 'error')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    postMutation.mutate()
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>📢 Group Updates & Announcements</h2>
        {isAdmin && !showPostForm && (
          <button onClick={() => setShowPostForm(true)}>+ Post Update</button>
        )}
      </div>

      {showPostForm && (
        <form onSubmit={handleSubmit} className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Post a Group Announcement</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              type="text"
              placeholder="Announcement Title (e.g. Next session location update)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={postMutation.isPending}
            />
            <textarea
              placeholder="Write update details here..."
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              disabled={postMutation.isPending}
              style={{ width: '100%', resize: 'vertical' }}
            />
            {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setShowPostForm(false)}>
                Cancel
              </button>
              <button type="submit" disabled={postMutation.isPending || !title.trim() || !content.trim()}>
                {postMutation.isPending ? 'Posting…' : 'Publish Update'}
              </button>
            </div>
          </div>
        </form>
      )}

      {updates.length === 0 ? (
        <p className="tune-meta italic">No announcements posted yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {updates.map((up) => (
            <div key={up.groupUpdateId} className="card" style={{ padding: '1.25rem', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.25rem 0' }}>{up.title}</h3>
                  <span className="tune-meta" style={{ fontSize: '0.8rem' }}>
                    Posted by <strong>{up.createdByDisplayName}</strong> on {parseServerDate(up.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>
                {canDelete && (
                  <button
                    className="secondary danger-hover"
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                    onClick={() => {
                      if (confirm('Delete this update?')) {
                        deleteMutation.mutate(up.groupUpdateId)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </button>
                )}

              </div>
              <p style={{ marginTop: '0.75rem', marginBottom: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {up.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
