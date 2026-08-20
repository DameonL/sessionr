"use client";

import Link from '@/utils/routerCompat'

/** Login-agnostic landing page: browse and play tunes, and find session groups, without an account. */
export function Landing() {
  return (
    <section>
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>Session Practice</h1>
        <p className="tune-meta">
          Browse the tune library, play and practice along, and see what session groups are up to —
          no account needed. Sign in to track your own repertoire and join a group.
        </p>
        <div className="detail-controls" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <Link href="/tunes" prefetch={false}><button>Browse Tunes</button></Link>
          <Link href="/groups" prefetch={false}><button className="secondary">Browse Groups</button></Link>
          <Link href="/login" prefetch={false}><button className="secondary">Sign In</button></Link>
        </div>
      </div>
    </section>
  )
}
