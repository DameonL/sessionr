"use client";

import { useEffect } from 'react'
import { useRouter } from '@/utils/routerCompat'
import { useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { loginRequest } from '../services/authConfig'
import { recoverFromStaleInteraction } from '../services/msalRecovery'
import { useAuthStatus } from '../state/appState'

export function MsalLoginPanel() {
  const { instance, inProgress } = useMsal()
  const status = useAuthStatus()
  const router = useRouter()

  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/')
    }
  }, [status, router])

  // While MSAL is mid-interaction (processing a redirect response, acquiring a
  // token), showing the sign-in button would let the user click it again before
  // the in-flight sign-in resolves — the "have to click twice" symptom. Show a
  // finishing-up spinner instead.
  //
  // Logout is deliberately not one of those states. It means a sign-out was
  // started and never finished — backing out of the IdP's sign-out page leaves it
  // here permanently, since LOGOUT_END never fires — and a user who has navigated
  // to /login is asking to sign in, not waiting on that. Blocking on it strands
  // them behind a spinner that claims to be finishing a sign-in that was never
  // started. Let the button render; the click handler recovers the stale
  // interaction mark that a half-finished sign-out leaves behind.
  if (inProgress !== InteractionStatus.None && inProgress !== InteractionStatus.Logout) {
    return (
      <div style={{ minHeight: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="signin-loader-ring" />
        <span style={{ marginLeft: '0.75rem' }}>Finishing sign-in…</span>
      </div>
    )
  }

  // Covers both "still resolving" (pending) and "authenticated, redirect
  // about to take effect" — either way, showing the sign-in button here
  // would be wrong. Mirrors how RequireAuth/NavBar gate on the same signal.
  if (status !== 'anonymous') {
    return <div style={{ minHeight: '150px' }} />
  }

  return (
    <>
      <p className="tune-meta" style={{ marginBottom: '1.5rem' }}>
        Learn, organize, and practice your musical repertoire.
      </p>

      {/* No rememberReturnUrl() here on purpose: the page worth returning to was
          already recorded by whatever sent the user to /login (NavBar, RequireAuth),
          and recording again from /login would only overwrite it with nothing. */}
      <button
        onClick={() =>
          instance.loginRedirect(loginRequest).catch((err) => {
            // A stale interaction mark from an abandoned sign-out blocks this
            // outright. Reloading is the only supported way to clear it — the
            // bootstrap's handleRedirectPromise does it — so recover rather than
            // leaving the user with a button that silently does nothing.
            if (recoverFromStaleInteraction(err)) return
            console.error('MSAL Login Failed:', err)
          })
        }
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
      >
        <svg style={{ width: '20px', height: '20px' }} viewBox="0 0 23 23">
          <path fill="#f3f2f1" d="M0 0h11v11H0z"/>
          <path fill="#f3f2f1" d="M12 0h11v11H12z"/>
          <path fill="#f3f2f1" d="M0 12h11v11H0z"/>
          <path fill="#f3f2f1" d="M12 12h11v11H12z"/>
        </svg>
        Sign In with Microsoft
      </button>
    </>
  )
}
