"use client";

import { useMsal } from '@azure/msal-react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { loginRequest } from '../services/authConfig'
import { showToast } from '../state/appState'

export function NetworkStatusBanner() {
  const { isOnline, pendingCount, isSyncing, authRequired, triggerSync } = useNetworkStatus()
  const { instance } = useMsal()

  if (isOnline && pendingCount === 0 && !authRequired) return null

  const statusText = !isOnline
    ? "You're offline — changes are saved locally."
    : isSyncing
      ? 'Syncing offline changes…'
      : authRequired
        ? 'Sign in to sync your offline changes.'
        : `${pendingCount} offline change${pendingCount === 1 ? '' : 's'} pending.`

  return (
    <div className={`network-status-banner ${isOnline ? '' : 'offline'}`}>
      <span className="network-status-dot" />
      <span className="network-status-text">{statusText}</span>
      {pendingCount > 0 && (
        authRequired ? (
          <button
            className="secondary btn-sm"
            disabled={!isOnline}
            onClick={() => {
              // loginRedirect, not loginPopup — popups get blocked too
              // unreliably in practice. No redirectStartPage is passed, so
              // MSAL defaults it to the current page and (with
              // navigateToLoginRequestUrl defaulting true, unset here) will
              // bring the user back to wherever they clicked this from once
              // the round trip completes, same as MsalLoginPanel's own
              // loginRedirect call.
              instance.loginRedirect(loginRequest).catch((err) => {
                console.error('Sign-in failed:', err)
                showToast('Sign-in failed. Please try again.', 'error')
              })
            }}
          >
            Sign In to Sync
          </button>
        ) : (
          <button
            className="secondary btn-sm"
            disabled={!isOnline || isSyncing}
            onClick={() => { void triggerSync() }}
          >
            {isSyncing ? 'Syncing…' : 'Sync Now'}
          </button>
        )
      )}
    </div>
  )
}
