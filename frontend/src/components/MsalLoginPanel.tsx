"use client";

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMsal, useIsAuthenticated } from '@azure/msal-react'
import { loginRequest } from '../services/authConfig'

export function MsalLoginPanel() {
  const { instance } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/')
    }
  }, [isAuthenticated, router])

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
