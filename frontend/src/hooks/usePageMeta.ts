import { useEffect } from 'react'

export const SITE_ORIGIN = 'https://sessionr.org'
export const DEFAULT_TITLE = 'sessionr — Traditional Music Repertoire, Tune Library & Practice Room'
export const DEFAULT_DESCRIPTION =
  'Browse traditional tunes in ABC notation, identify tunes by microphone, build session sets, train your ear, and connect with local music sessions.'
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`

export interface PageMetaOptions {
  /** Page title; `" · sessionr"` is appended unless `rawTitle` is true. */
  title?: string
  rawTitle?: boolean
  description?: string
  /** Path starting with `/` (and optional canonical query string). Omitted when `noindex`. */
  canonicalPath?: string
  /** Defaults to `'index, follow'`. */
  robots?: string
  ogType?: string
  ogImage?: string
  /** Optional Schema.org JSON-LD payload(s). */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>> | null
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertCanonical(href: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!href) {
    existing?.remove()
    return
  }
  const el = existing ?? document.createElement('link')
  el.setAttribute('rel', 'canonical')
  el.setAttribute('href', href)
  if (!existing) {
    document.head.appendChild(el)
  }
}

function upsertJsonLd(jsonString: string | null): void {
  const existing = document.head.querySelector<HTMLScriptElement>('script[data-sessionr-jsonld="true"]')
  if (!jsonString) {
    existing?.remove()
    return
  }
  const el = existing ?? document.createElement('script')
  el.type = 'application/ld+json'
  el.setAttribute('data-sessionr-jsonld', 'true')
  el.textContent = jsonString
  if (!existing) {
    document.head.appendChild(el)
  }
}

function buildFullTitle(title?: string, rawTitle?: boolean): string {
  if (!title) return DEFAULT_TITLE
  if (rawTitle || title.endsWith('· sessionr') || title === 'sessionr') return title
  return `${title} · sessionr`
}

function normalizeCanonicalUrl(canonicalPath?: string): string | null {
  if (!canonicalPath) return null
  const path = canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`
  return `${SITE_ORIGIN}${path}`
}

export function applyPageMeta(options: PageMetaOptions, jsonLdOverride?: string | null): void {
  if (typeof document === 'undefined') return

  const fullTitle = buildFullTitle(options.title, options.rawTitle)
  const description = options.description ?? DEFAULT_DESCRIPTION
  const robots = options.robots ?? 'index, follow'
  const isNoIndex = robots.toLowerCase().includes('noindex')
  const canonicalUrl = isNoIndex ? null : normalizeCanonicalUrl(options.canonicalPath)
  const ogUrl = normalizeCanonicalUrl(options.canonicalPath) ?? SITE_ORIGIN
  const ogType = options.ogType ?? 'website'
  const ogImage = options.ogImage ?? DEFAULT_OG_IMAGE

  document.title = fullTitle
  upsertMeta('name', 'description', description)
  upsertMeta('name', 'robots', robots)
  upsertCanonical(canonicalUrl)

  upsertMeta('property', 'og:type', ogType)
  upsertMeta('property', 'og:site_name', 'sessionr')
  upsertMeta('property', 'og:title', fullTitle)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:url', ogUrl)
  upsertMeta('property', 'og:image', ogImage)

  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', fullTitle)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'twitter:image', ogImage)

  const jsonString =
    jsonLdOverride !== undefined
      ? jsonLdOverride
      : options.jsonLd
        ? JSON.stringify(options.jsonLd)
        : null
  upsertJsonLd(jsonString)
}

export function resetPageMeta(): void {
  applyPageMeta({}, null)
}

/**
 * Synchronizes document title, meta description, robots, canonical URL, Open Graph/Twitter tags,
 * and Schema.org JSON-LD for the active route.
 */
export function usePageMeta(options: PageMetaOptions): void {
  const jsonLdString = options.jsonLd ? JSON.stringify(options.jsonLd) : null

  useEffect(() => {
    applyPageMeta(options, jsonLdString)
    return () => {
      resetPageMeta()
    }
  }, [
    options.title,
    options.rawTitle,
    options.description,
    options.canonicalPath,
    options.robots,
    options.ogType,
    options.ogImage,
    jsonLdString,
  ])
}
