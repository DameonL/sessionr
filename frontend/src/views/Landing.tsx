"use client";

import Link from '@/utils/routerCompat'
import { usePageMeta, SITE_ORIGIN } from '@/hooks/usePageMeta'

const LANDING_JSON_LD = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'sessionr',
    url: SITE_ORIGIN,
    description:
      'Mobile-first traditional music repertoire manager, ABC notation tune library, microphone tune identifier, and session group hub.',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_ORIGIN}/tunes?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'sessionr',
    url: SITE_ORIGIN,
    applicationCategory: 'MusicApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  },
]

/** Login-agnostic landing page: browse and play tunes, identify melodies, and find session groups without an account. */
export function Landing() {
  usePageMeta({
    title: 'sessionr — Traditional Music Repertoire, Tune Library & Practice Room',
    rawTitle: true,
    description:
      'Browse Irish and traditional folk tunes in ABC notation, identify tunes live from your microphone, practice by ear and intervals, build medley sets, and join local sessions.',
    canonicalPath: '/',
    jsonLd: LANDING_JSON_LD,
  })

  return (
    <section>
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>sessionr — Traditional Session Practice &amp; Tune Library</h1>
        <p className="tune-meta" style={{ maxWidth: '42rem', margin: '0 auto', lineHeight: 1.6 }}>
          Browse thousands of traditional Irish, Scottish, and folk tunes in ABC notation, play sheet
          music with tempo and accompaniment controls, identify unknown tunes from a live recording,
          and discover local music sessions — no account required.
        </p>
        <div className="detail-controls" style={{ justifyContent: 'center', marginTop: '1.25rem' }}>
          <Link href="/tunes" className="btn primary" prefetch={false}>Browse Tunes</Link>
          <Link href="/identify" className="btn" prefetch={false}>Identify a Tune</Link>
          <Link href="/groups" className="btn" prefetch={false}>Browse Groups</Link>
          <Link href="/login" className="btn" prefetch={false}>Sign In</Link>
        </div>
      </div>

      <div className="landing-grid">
        <article className="card landing-card">
          <div>
            <h2>ABC Tune Library &amp; Player</h2>
            <p>
              Search tunes by title or alternate name, explore community ABC settings, transpose keys,
              and loop phrases with built-in metronome and bodhrán backing.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
            <Link href="/tunes/popular" prefetch={false}>Most Popular →</Link>
            <Link href="/tunes/newest" prefetch={false}>Newest Tunes →</Link>
          </div>
        </article>

        <article className="card landing-card">
          <div>
            <h2>Tune Identifier</h2>
            <p>
              Hear a reel or jig at a session? Record a short clip on your phone or laptop microphone
              to match the melody against the tune library right in your browser.
            </p>
          </div>
          <div>
            <Link href="/identify" prefetch={false}>Try Tune Identifier →</Link>
          </div>
        </article>

        <article className="card landing-card">
          <div>
            <h2>Ear &amp; Interval Practice</h2>
            <p>
              Learn traditional melodies phrase-by-phrase by ear and sharpen your pitch recognition
              with customizable musical interval drills.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
            <Link href="/practice/ear" prefetch={false}>Ear Training →</Link>
            <Link href="/practice/intervals" prefetch={false}>Interval Trainer →</Link>
          </div>
        </article>

        <article className="card landing-card">
          <div>
            <h2>Session Groups &amp; Medley Sets</h2>
            <p>
              Find public session groups near you, browse shared master tune lists and session
              calendars, and explore medley sets with circle-of-fifths key transitions.
            </p>
          </div>
          <div>
            <Link href="/groups" prefetch={false}>Explore Session Groups →</Link>
          </div>
        </article>
      </div>

      <footer className="site-footer">
        <span>sessionr — Mobile-first PWA for traditional musicians</span>
        <nav className="site-footer-links" aria-label="Public directory links">
          <Link href="/tunes" prefetch={false}>Tune Search</Link>
          <Link href="/tunes/popular" prefetch={false}>Popular Tunes</Link>
          <Link href="/tunes/newest" prefetch={false}>Newest Tunes</Link>
          <Link href="/identify" prefetch={false}>Tune Identifier</Link>
          <Link href="/practice/ear" prefetch={false}>Ear Training</Link>
          <Link href="/practice/intervals" prefetch={false}>Interval Trainer</Link>
          <Link href="/groups" prefetch={false}>Session Groups</Link>
        </nav>
      </footer>
    </section>
  )
}
