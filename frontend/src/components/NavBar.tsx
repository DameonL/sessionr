"use client";

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMsal } from '@azure/msal-react'
import { currentUserId, currentUserProfile, useSignal } from '../state/appState'

const NAV_LINKS = [
  { href: '/', label: 'Dashboard', icon: '🏠' },
  { href: '/tunes', label: 'Tunes', icon: '🎵' },
  { href: '/repertoire', label: 'Repertoire', icon: '📚' },
  { href: '/sets', label: 'Set Builder', icon: '🎶' },
  { href: '/practice', label: 'Practice Room', icon: '🎻' },
  { href: '/groups', label: 'Groups', icon: '👥' },
]

export function NavBar() {
  const [mounted, setMounted] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Auto-close mobile drawer when route changes
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <header className="app-header">
      <div className="nav-container">
        <Link href="/" className="nav-brand">
          <span className="brand-icon">🎻</span>
          <span className="brand-name">SessionApp</span>
        </Link>

        {/* Desktop Links */}
        <nav className="desktop-nav">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href))
            return (
              <Link key={link.href} href={link.href} className={active ? 'active' : ''}>
                {link.label}
              </Link>
            )
          })}
          <span className="auth-slot">
            {!mounted ? <Link href="/login">Sign In</Link> : <MsalAuthWidget />}
          </span>
        </nav>

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

      {/* Mobile Menu Drawer & Overlay */}
      {mobileOpen && (
        <>
          <div className="mobile-backdrop" onClick={() => setMobileOpen(false)} />
          <div className="mobile-drawer">
            <nav className="mobile-nav-links">
              {NAV_LINKS.map((link) => {
                const active = pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href))
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`mobile-nav-item ${active ? 'active' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className="item-icon">{link.icon}</span>
                    <span>{link.label}</span>
                  </Link>
                )
              })}
              <div className="mobile-auth-section">
                {!mounted ? <Link href="/login">Sign In</Link> : <MsalAuthWidget />}
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

  if (!userId) {
    return <Link href="/login">Sign In</Link>
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{profile?.displayName ?? 'Signed in'}</span>
      <button
        className="secondary"
        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'auto' }}
        onClick={() => instance.logoutRedirect().catch((err) => console.error('MSAL Logout Failed:', err))}
      >
        Sign Out
      </button>
    </span>
  )
}
