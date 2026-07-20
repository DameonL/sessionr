"use client";

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { loginOrRegisterUser } from '../services/api'
import { currentUserId, currentUserProfile } from '../state/appState'

export function DevLoginForm() {
  const router = useRouter()
  const [mockEmail, setMockEmail] = useState('dev@example.com')
  const [mockName, setMockName] = useState('Dev Musician')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleDevLogin = async (e?: FormEvent, email = mockEmail, name = mockName) => {
    if (e) e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const profile = await loginOrRegisterUser(email, name)
      currentUserId.value = profile.userId
      currentUserProfile.value = { email: profile.email, displayName: profile.displayName }
      router.push('/')
    } catch (err) {
      setError((err as Error).message || 'Sign in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <p className="tune-meta" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        Local Development Authentication Bypass
      </p>

      <form onSubmit={(e) => handleDevLogin(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          Email Address
          <input
            type="email"
            value={mockEmail}
            onChange={(e) => setMockEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Display Name
          <input
            type="text"
            value={mockName}
            onChange={(e) => setMockName(e.target.value)}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting} style={{ marginTop: '0.5rem' }}>
          {submitting ? 'Signing in…' : 'Sign In as Developer'}
        </button>
      </form>

      <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem', textAlign: 'center' }}>
        <button
          className="secondary w-full"
          disabled={submitting}
          onClick={() => {
            setMockEmail('dev@example.com')
            setMockName('Dev Musician')
            handleDevLogin(undefined, 'dev@example.com', 'Dev Musician')
          }}
        >
          Quick Login: Dev Musician
        </button>
      </div>
    </>
  )
}
