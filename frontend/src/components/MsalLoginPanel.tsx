"use client";

import { useEffect } from 'react'
import { useRouter } from '@/utils/routerCompat'
import { useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { loginRequest } from '../services/authConfig'
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
  if (inProgress !== InteractionStatus.None) {
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

      <button
        onClick={() => instance.loginRedirect(loginRequest).catch((err) => console.error('MSAL Login Failed:', err))}
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
