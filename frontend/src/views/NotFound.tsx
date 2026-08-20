"use client";

import { useEffect } from 'react'
import Link, { usePathname, useRouter } from '@/utils/routerCompat'

/** Rendered for any URL the router can't match, instead of silently bouncing to home. */
export function NotFound() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const previous = document.title
    document.title = 'Page not found · sessionr'
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <section>
      <div className="card not-found">
        <img className="not-found-logo" src="/logo-transparent-bordered.png" alt="" />
        <p className="not-found-code">404</p>
        <h1 className="not-found-title">That tune isn't in the book</h1>
        <p className="tune-meta">
          We couldn't find a page at <code className="not-found-path">{pathname}</code>. The link may be
          out of date, or the page may have moved.
        </p>
        <div className="detail-controls not-found-actions">
          <Link href="/" prefetch={false}><button className="not-found-primary">Go Home</button></Link>
          <button onClick={router.back}>Go Back</button>
        </div>
      </div>
    </section>
  )
}

export default NotFound
