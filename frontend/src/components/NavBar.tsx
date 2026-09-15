"use client";

import { useEffect, useRef, useState } from 'react'
import Link from '@/utils/routerCompat'
import { usePathname } from '@/utils/routerCompat'
import { useMsal } from '@azure/msal-react'
import { clearAuthSession } from '../services/authSnapshot'
import { clearOfflineHttpCache } from '../services/offlineDb'
import { queryClient } from '../services/queryClient'
import { rememberReturnUrl } from '../services/returnUrl'
import { authStatus, currentUserId, currentUserProfile, useAuthStatus, useSignal } from '../state/appState'
import { NetworkStatusBanner } from './NetworkStatusBanner'

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/tunes', label: 'Tunes' },
  { href: '/identify', label: 'Identify' },
  { href: '/repertoire', label: 'Repertoire' },
  { href: '/sets', label: 'Set Builder' },
  { href: '/practice', label: 'Practice Room' },
  { href: '/groups', label: 'Groups' },
]

export function NavBar() {
  const [mounted, setMounted] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const profile = useSignal(currentUserProfile)
  const headerRef = useRef<HTMLElement | null>(null)

  const links = [...NAV_LINKS]
  if (profile?.isModerator) {
    links.push({ href: '/moderator', label: '🛡️ Moderator' })
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  /*
   * Publishes the sticky header's real height as --header-block so CSS can size
   * against it. The drawer needs it to cap itself at the visible viewport (it is
   * absolutely positioned, so nothing else bounds it and its lower items become
   * unreachable on a phone in landscape), and the sticky player toolbar needs it
   * to offset by. A constant won't do: NetworkStatusBanner sits inside the
   * header and appears and disappears, and the bar itself shrinks in landscape.
   */
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const publish = () => {
      document.documentElement.style.setProperty('--header-block', `${el.offsetHeight}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Auto-close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <header className={`app-header${mobileOpen ? ' drawer-open' : ''}`} ref={headerRef}>
      <div className="nav-container">
        <Link href="/" className="nav-brand" prefetch={false}>
          <span className="brand-icon"><img src="/favicon-96x96.png" /></span>
          <span className="brand-text">sessionr</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="desktop-nav">
          {links.map((link) => {
            const active = pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href))
            return (
              <Link key={link.href} href={link.href} className={`nav-pill ${active ? 'active' : ''}`} prefetch={false}>
                <span>{link.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Desktop Auth Section */}
        <div className="desktop-auth-slot">
          {!mounted ? (
            <div className="nav-pill" />
          ) : (
            <MsalAuthWidget />
          )}
        </div>

        {/* Mobile Hamburger Toggle */}
        <button
          className={`hamburger-btn ${mobileOpen ? 'open' : ''}`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle Navigation Menu"
        >
          <span className="bar"></span>
          <span className="bar"></span>
          <span className="bar"></span>
        </button>
      </div>

      <NetworkStatusBanner />

      {/* Mobile Menu Drawer & Overlay */}
      {mobileOpen && (
        <>
          <div className="mobile-backdrop" onClick={() => setMobileOpen(false)} />
          <div className="mobile-drawer">
            <nav className="mobile-nav-links">
              {links.map((link) => {
                const active = pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href))
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`mobile-nav-item ${active ? 'active' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span>{link.label}</span>
                  </Link>
                )
              })}
              <div className="mobile-auth-section">
                {!mounted ? <div className="nav-pill" /> : <MsalAuthWidget />}
              </div>
            </nav>
          </div>
        </>
      )}
    </header>
  )
}


function MsalAuthWidget() {
  const { instance } = useMsal()
  const userId = useSignal(currentUserId)
  const profile = useSignal(currentUserProfile)
  const status = useAuthStatus()

  if (status === 'pending') {
    return <div className="nav-pill" />
  }

  if (!userId) {
    // Record the page before leaving it: /login is a normal route, so this
    // navigation loses the user's place well before MSAL is involved.
    // AuthProvider replays it once the redirect round trip comes back.
    return (
      <Link href="/login" className="nav-pill" prefetch={false} onClick={() => rememberReturnUrl()}>
        Sign In
      </Link>
    )
  }

  const initial = profile?.displayName ? profile.displayName.charAt(0).toUpperCase() : 'U'

  return (
    <div className="user-profile-badge">
      <Link href="/profile" prefetch={false} className="user-profile-link">
        <div className="user-avatar">{initial}</div>
        <span className="user-name">{profile?.displayName ?? 'Signed in'}</span>
      </Link>
      <button
        className="secondary btn-sm"
        onClick={() => {
          // Clear before handing control to MSAL: logoutRedirect() navigates
          // away, so anything queued after it may never run. This is what stops
          // the next load from optimistically painting the just-signed-out
          // user. Belt-and-braces — a completed logout also empties MSAL's
          // account index, which alone would fail corroboration — but it covers
          // a logout that is blocked or cancelled. The IndexedDB GET cache is
          // keyed by URL with no user scoping, so it goes too.
          clearAuthSession()
          authStatus.value = 'anonymous'
          queryClient.clear()
          void clearOfflineHttpCache()
          instance.logoutRedirect().catch((err) => console.error('MSAL Logout Failed:', err))
        }}
      >
        Sign Out
      </button>
    </div>
  )
}
