"use client";

import Link, { usePathname, useRouter } from '@/utils/routerCompat'
import { usePageMeta } from '../hooks/usePageMeta'

/** Rendered for any URL the router can't match, instead of silently bouncing to home. */
export function NotFound() {
  const router = useRouter()
  const pathname = usePathname()

  usePageMeta({
    title: 'Page not found',
    description: 'The requested page could not be found on sessionr.',
    robots: 'noindex, nofollow',
  })

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
          <Link href="/" className="btn not-found-primary" prefetch={false}>Go Home</Link>
          <button onClick={router.back}>Go Back</button>
        </div>
      </div>
    </section>
  )
}

export default NotFound
