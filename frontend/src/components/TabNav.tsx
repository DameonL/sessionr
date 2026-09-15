"use client";

import Link from '@/utils/routerCompat'
import { useRouter } from '@/utils/routerCompat'

export interface Tab {
  href: string
  label: string
  icon: string
  badge?: number
}

/**
 * The segmented pill navigation used by the detail pages that split their content across sub-routes
 * (a group, a musician's profile). Collapses to a "jump to section" select on narrow screens, where
 * a row of pills would wrap into an unreadable block.
 */
export function TabNav({
  tabs,
  activeHref,
  fallbackHref,
  label,
}: {
  tabs: Tab[]
  /** The current path; the tab matching it is highlighted. */
  activeHref: string
  /** Selected in the mobile picker when nothing matches — normally the section's index route. */
  fallbackHref: string
  /** Describes the section for screen readers, e.g. "Group Details". */
  label: string
}) {
  const router = useRouter()

  return (
    <nav className="tab-nav" aria-label={`${label} Section Navigation`} style={{ marginBottom: '1.75rem' }}>
      <div className="mobile-tab-select" style={{ marginBottom: '0.75rem' }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.35rem' }}>
          Jump to section:
        </label>
        <select
          value={tabs.find((t) => t.href === activeHref)?.href ?? fallbackHref}
          onChange={(e) => router.push(e.target.value)}
          style={{
            width: '100%',
            padding: '0.6rem 0.85rem',
            fontSize: '0.95rem',
            fontWeight: 600,
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
          }}
        >
          {tabs.map((tab) => (
            <option key={tab.href} value={tab.href}>
              {tab.icon} {tab.label}{tab.badge !== undefined ? ` (${tab.badge})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div
        className="tab-nav-pills"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem',
          padding: '0.35rem',
          background: 'var(--surface-2)',
          borderRadius: '10px',
          border: '1px solid var(--border)',
        }}
      >
        {tabs.map((tab) => {
          const active = activeHref === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.5rem 0.85rem',
                fontSize: '0.9rem',
                fontWeight: active ? 600 : 400,
                borderRadius: '7px',
                border: 'none',
                textDecoration: 'none',
                background: active ? 'var(--surface)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--muted)',
                cursor: 'pointer',
                boxShadow: active ? 'var(--shadow-sm)' : 'none',
                outline: active ? '1px solid var(--accent)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '0.1rem 0.45rem',
                    borderRadius: '999px',
                    background: active ? 'var(--accent)' : 'var(--border)',
                    color: active ? 'var(--on-accent)' : 'var(--text)',
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
