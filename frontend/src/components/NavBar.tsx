"use client";

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMsal } from '@azure/msal-react'
import { currentUserId, currentUserProfile, useAuthStatus, useSignal } from '../state/appState'
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

  const links = [...NAV_LINKS]
  if (profile?.isModerator) {
    links.push({ href: '/moderator', label: '🛡️ Moderator' })
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  // Auto-close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <header className="app-header">
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
    return <Link href="/login" className="nav-pill" prefetch={false}>Sign In</Link>
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
        onClick={() => instance.logoutRedirect().catch((err) => console.error('MSAL Logout Failed:', err))}
      >
        Sign Out
      </button>
    </div>
  )
}
