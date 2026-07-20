"use client";

import { useEffect, type ReactNode } from 'react'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { msalConfig, isMsalEnabled } from '../services/authConfig'
import { loginOrRegisterUser } from '../services/api'
import { currentUserId, currentUserProfile } from '../state/appState'

interface AuthProviderProps {
  children: ReactNode
}

let pcaInstance: PublicClientApplication | null = null

if (isMsalEnabled) {
  pcaInstance = new PublicClientApplication(msalConfig)
  pcaInstance.initialize().catch((err) => {
    console.error('MSAL initialization failed:', err)
  })
}

/**
 * Identity provider only — never blocks rendering. Guests browse the whole
 * app freely; this just keeps currentUserId/currentUserProfile in sync with
 * whatever auth state exists (dev bypass login, or an active MSAL session).
 */
export default function AuthProvider({ children }: AuthProviderProps) {
  if (!isMsalEnabled) {
    return <>{children}</>
  }

  return (
    <MsalProvider instance={pcaInstance!}>
      <MsalBackgroundSync />
      {children}
    </MsalProvider>
  )
}

/** Keeps the shared signals in sync with the active MSAL account, with no UI of its own. */
function MsalBackgroundSync() {
  const { accounts } = useMsal()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (isAuthenticated && accounts.length > 0) {
      const activeAccount = accounts[0]
      const email = activeAccount.username
      const displayName = activeAccount.name || 'Microsoft Musician'

      loginOrRegisterUser(email, displayName)
        .then((profile) => {
          currentUserId.value = profile.userId
          currentUserProfile.value = { email: profile.email, displayName: profile.displayName }
        })
        .catch((err) => {
          console.error('Failed to sync user with DB:', err)
        })
    } else {
      currentUserId.value = ''
      currentUserProfile.value = null
    }
  }, [isAuthenticated, accounts])

  return null
}
