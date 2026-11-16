import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyPageMeta,
  resetPageMeta,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  SITE_ORIGIN,
} from './usePageMeta'

describe('usePageMeta / applyPageMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.title = ''
  })

  it('sets full title, description, canonical link, robots, OG, Twitter, and JSON-LD', () => {
    applyPageMeta({
      title: 'The Kesh Jig (Jig in G Major)',
      description: 'Sheet music and ABC settings for The Kesh Jig.',
      canonicalPath: '/tunes/1234',
      ogType: 'music.song',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'MusicComposition',
        name: 'The Kesh Jig',
      },
    })

    expect(document.title).toBe('The Kesh Jig (Jig in G Major) · sessionr')
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Sheet music and ABC settings for The Kesh Jig.'
    )
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_ORIGIN}/tunes/1234`
    )
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'The Kesh Jig (Jig in G Major) · sessionr'
    )
    expect(document.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('music.song')
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
      `${SITE_ORIGIN}/tunes/1234`
    )
    expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(
      'The Kesh Jig (Jig in G Major) · sessionr'
    )
    const ld = document.querySelector('script[data-sessionr-jsonld="true"]')
    expect(ld).not.toBeNull()
    expect(JSON.parse(ld!.textContent!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'MusicComposition',
      name: 'The Kesh Jig',
    })
  })

  it('omits canonical link when robots contains noindex', () => {
    applyPageMeta({
      title: 'Tune Library',
      canonicalPath: '/tunes',
    })
    expect(document.querySelector('link[rel="canonical"]')).not.toBeNull()

    applyPageMeta({
      title: 'Private Group',
      canonicalPath: '/group/abc',
      robots: 'noindex, nofollow',
    })
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow'
    )
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('supports rawTitle without appending suffix and resets cleanly', () => {
    applyPageMeta({
      title: 'Custom Exact Title',
      rawTitle: true,
    })
    expect(document.title).toBe('Custom Exact Title')

    resetPageMeta()
    expect(document.title).toBe(DEFAULT_TITLE)
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      DEFAULT_DESCRIPTION
    )
    expect(document.querySelector('script[data-sessionr-jsonld="true"]')).toBeNull()
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
  })
})
