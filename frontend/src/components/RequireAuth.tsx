"use client";

import type { ReactNode } from 'react'
import Link from 'next/link'
import { currentUserId, useAuthStatus, useSignal } from '../state/appState'

/** Gates inherently personal pages (repertoire, sets, practice room) behind sign-in. */
export function RequireAuth({ children, message }: { children: ReactNode; message?: string }) {
  const userId = useSignal(currentUserId)
  const status = useAuthStatus()

  if (status === 'pending') {
    return (
      <section>
        <div className="card" style={{ padding: '1.5rem', minHeight: '120px' }} />
      </section>
    )
  }

  if (!userId) {
    return (
      <section>
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <p>{message ?? 'Sign in to use this feature.'}</p>
          <Link href="/login" prefetch={false}><button>Sign In</button></Link>
        </div>
      </section>
    )
  }

  return <>{children}</>
}
