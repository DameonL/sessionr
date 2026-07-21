"use client";

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { getGroups, createGroup, joinGroup, leaveGroup, GroupSummary } from '../services/api'
import { currentUserId, useSignal } from '../state/appState'

export function Groups() {
  const userId = useSignal(currentUserId)
  const isSignedIn = !!userId
  const queryClient = useQueryClient()
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupPrivate, setNewGroupPrivate] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Fetch groups
  const groupsQuery = useQuery({
    queryKey: ['groups', userId],
    queryFn: () => getGroups(userId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['groups', userId] })
  }

  // Join group mutation
  const joinMutation = useMutation({
    mutationFn: (groupId: string) => joinGroup(groupId, userId),
    onSuccess: invalidate,
  })

  // Leave group mutation
  const leaveMutation = useMutation({
    mutationFn: (groupId: string) => leaveGroup(groupId, userId),
    onSuccess: invalidate,
  })

  // Create group mutation
  const createMutation = useMutation({
    mutationFn: (name: string) => createGroup(name, userId, newGroupPrivate),
    onSuccess: () => {
      invalidate()
      setNewGroupName('')
      setNewGroupPrivate(false)
      setShowCreateForm(false)
      setCreateError(null)
    },
    onError: (err) => {
      setCreateError(err.message || 'Failed to create group.')
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    createMutation.mutate(newGroupName.trim())
  }

  if (groupsQuery.isLoading) {
    return <section><p>Loading groups…</p></section>
  }

  if (groupsQuery.isError) {
    return <section><p className="error">Could not load groups.</p></section>
  }

  const allGroups = groupsQuery.data ?? []
  const myGroups = allGroups.filter((g) => g.isMember || g.isPending)
  const otherGroups = allGroups.filter((g) => !g.isMember && !g.isPending)

  return (
    <section>
      <div className="set-header">
        <h1>Groups</h1>
        {isSignedIn ? (
          !showCreateForm && <button onClick={() => setShowCreateForm(true)}>+ Create Group</button>
        ) : (
          <Link href="/login"><button className="secondary">Sign in to create a group</button></Link>
        )}
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateSubmit} className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
          <h3>Create a New Group</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="e.g. Traditional Session Dublin"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              required
              style={{ flex: 1 }}
              disabled={createMutation.isPending}
            />
            <button type="submit" disabled={createMutation.isPending || !newGroupName.trim()}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
            <button type="button" className="secondary" onClick={() => setShowCreateForm(false)}>
              Cancel
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={newGroupPrivate}
              onChange={(e) => setNewGroupPrivate(e.target.checked)}
              disabled={createMutation.isPending}
            />
            Private (new members must be approved or use an invite code)
          </label>
          {createError && <p className="error" style={{ marginTop: '0.5rem' }}>{createError}</p>}
        </form>
      )}

      {isSignedIn ? (
        <>
          <h2>My Groups</h2>
          {myGroups.length === 0 ? (
            <p className="tune-meta italic">You haven't joined any groups yet. Discover one below!</p>
          ) : (
            <ul className="tune-list">
              {myGroups.map((g) => (
                <li key={g.groupId} className="card tune-row">
                  <Link href={`/group/${g.groupId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
                    <span className="tune-title">{g.isPrivate ? '🔒 ' : ''}{g.name}</span>
                    <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                      {g.isPending
                        ? 'Request pending approval'
                        : `${g.memberCount} ${g.memberCount === 1 ? 'member' : 'members'}`}
                    </span>
                  </Link>
                  <button
                    className="secondary danger-hover"
                    onClick={() => leaveMutation.mutate(g.groupId)}
                    disabled={leaveMutation.isPending}
                  >
                    {g.isPending ? 'Withdraw Request' : 'Leave'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="tune-meta italic">
          <Link href="/login">Sign in</Link> to see and join your own groups.
        </p>
      )}

      <h2 style={{ marginTop: '2rem' }}>Discover Groups</h2>
      {otherGroups.length === 0 ? (
        <p className="tune-meta italic">No other public groups found.</p>
      ) : (
        <ul className="tune-list">
          {otherGroups.map((g) => (
            <li key={g.groupId} className="card tune-row">
              <Link href={`/group/${g.groupId}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
                <span className="tune-title">{g.name}</span>
                <span className="tune-meta" style={{ display: 'block', marginTop: '0.25rem' }}>
                  {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                </span>
              </Link>
              {isSignedIn ? (
                <button
                  onClick={() => joinMutation.mutate(g.groupId)}
                  disabled={joinMutation.isPending}
                >
                  Join
                </button>
              ) : (
                <Link href="/login"><button className="secondary">Sign in to join</button></Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
