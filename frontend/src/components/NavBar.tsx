"use client";

import Link from 'next/link'
import { useMsal } from '@azure/msal-react'
import { isMsalEnabled } from '../services/authConfig'
import { currentUserId, currentUserProfile, useSignal } from '../state/appState'

export function NavBar() {
  return (
    <nav className="app-nav">
      <Link href="/">Dashboard</Link>
      <Link href="/tunes">Tunes</Link>
      <Link href="/repertoire">Repertoire</Link>
      <Link href="/sets">Set Builder</Link>
      <Link href="/practice">Practice Room</Link>
      <Link href="/groups">Groups</Link>
      <span style={{ marginLeft: 'auto' }}>
        {isMsalEnabled ? <MsalAuthWidget /> : <DevAuthWidget />}
      </span>
    </nav>
  )
}

function DevAuthWidget() {
  const userId = useSignal(currentUserId)
  const profile = useSignal(currentUserProfile)

  if (!userId) {
    return <Link href="/login">Sign In</Link>
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      {profile?.displayName ?? 'Signed in'}
      <button
        className="secondary"
        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto' }}
        onClick={() => {
          currentUserId.value = ''
          currentUserProfile.value = null
        }}
      >
        Sign Out
      </button>
    </span>
  )
}

function MsalAuthWidget() {
  const { instance } = useMsal()
  const userId = useSignal(currentUserId)
  const profile = useSignal(currentUserProfile)

  if (!userId) {
    return <Link href="/login">Sign In</Link>
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      {profile?.displayName ?? 'Signed in'}
      <button
        className="secondary"
        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto' }}
        onClick={() => instance.logoutPopup().catch((err) => console.error('MSAL Logout Failed:', err))}
      >
        Sign Out
      </button>
    </span>
  )
}
