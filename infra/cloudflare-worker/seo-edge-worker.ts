/**
 * Cloudflare Worker for sessionr.org SEO & social link previews.
 *
 * 1. Proxies dynamic XML sitemaps (/sitemap.xml, /sitemap-tunes.xml,
 *    /sitemap-groups.xml, /sitemap-sets.xml) to api-public.sessionr.org.
 *    (/sitemap-static.xml and /robots.txt pass through to Azure Static Web Apps.)
 *
 * 2. For social/search crawlers requesting /tunes/{id}, /group/{id}, or /set/{id},
 *    fetches the public entity from api-public.sessionr.org and injects per-page
 *    <title>, <meta>, Open Graph, Twitter Card, canonical, and JSON-LD tags
 *    into the Azure SWA index.html response (or returns HTTP 404 for missing/private
 *    entities).
 */

const SITE_ORIGIN = 'https://sessionr.org'
const PUBLIC_API_ORIGIN = 'https://api-public.sessionr.org/api'

const SITEMAP_PATHS = new Set([
  '/sitemap.xml',
  '/sitemap-tunes.xml',
  '/sitemap-groups.xml',
  '/sitemap-sets.xml',
])

const BOT_UA_REGEX =
  /facebookexternalhit|twitterbot|discordbot|slackbot|whatsapp|linkedinbot|telegrambot|applebot|pinterest|googlebot|bingbot|duckduckbot/i

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TUNE_ROUTE_RE = new RegExp(`^/tunes/(${UUID_PATTERN})/?$`, 'i')
const GROUP_ROUTE_RE = new RegExp(`^/group/(${UUID_PATTERN})(?:/.*)?$`, 'i')
const SET_ROUTE_RE = new RegExp(`^/set/(${UUID_PATTERN})/?$`, 'i')

interface ResolvedMeta {
  status: number
  title: string
  description: string
  canonicalUrl?: string
  robots: string
  ogType: string
  jsonLd?: Record<string, unknown>
}

function formatTuneType(raw: string): string {
  if (!raw) return 'Tune'
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

async function resolveEntityMeta(pathname: string): Promise<ResolvedMeta | null> {
  const tuneMatch = pathname.match(TUNE_ROUTE_RE)
  if (tuneMatch) {
    const tuneId = tuneMatch[1]
    const res = await fetch(`${PUBLIC_API_ORIGIN}/tunes/${tuneId}`)
    if (res.status === 404) {
      return {
        status: 404,
        title: 'Tune not found · sessionr',
        description: 'The requested traditional tune could not be found.',
        robots: 'noindex, nofollow',
        ogType: 'website',
      }
    }
    if (!res.ok) return null
    const tune = (await res.json()) as {
      tuneId: string
      title: string
      tuneType: string
      key: string
      aliases?: string[]
      settings?: unknown[]
    }
    const typeLabel = formatTuneType(tune.tuneType)
    const settingCount = tune.settings?.length ?? 0
    const aliasText =
      tune.aliases && tune.aliases.length > 0 ? ` Also known as ${tune.aliases.slice(0, 4).join(', ')}.` : ''
    const canonicalUrl = `${SITE_ORIGIN}/tunes/${tune.tuneId}`
    return {
      status: 200,
      title: `${tune.title} (${typeLabel} in ${tune.key}) · sessionr`,
      description: `Play ${tune.title}, a traditional ${typeLabel.toLowerCase()} in ${tune.key} with ${settingCount} ABC notation ${settingCount === 1 ? 'setting' : 'settings'} and audio playback.${aliasText}`,
      canonicalUrl,
      robots: 'index, follow',
      ogType: 'music.song',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'MusicComposition',
        name: tune.title,
        ...(tune.aliases && tune.aliases.length > 0 ? { alternateName: tune.aliases } : {}),
        musicalKey: tune.key,
        genre: ['Traditional music', typeLabel],
        url: canonicalUrl,
      },
    }
  }

  const groupMatch = pathname.match(GROUP_ROUTE_RE)
  if (groupMatch) {
    const groupId = groupMatch[1]
    const res = await fetch(`${PUBLIC_API_ORIGIN}/groups/${groupId}`)
    if (res.status === 404) {
      return {
        status: 404,
        title: 'Group not found · sessionr',
        description: 'The requested session group could not be found.',
        robots: 'noindex, nofollow',
        ogType: 'website',
      }
    }
    if (!res.ok) return null
    const group = (await res.json()) as {
      groupId: string
      name: string
      description?: string | null
      city?: string | null
      isPrivate: boolean
    }
    if (group.isPrivate) {
      return {
        status: 200,
        title: `${group.name} · sessionr`,
        description: 'Private traditional music session group on sessionr.',
        robots: 'noindex, nofollow',
        ogType: 'website',
      }
    }
    const canonicalUrl = `${SITE_ORIGIN}/group/${group.groupId}`
    const titlePrefix = group.city ? `${group.name} (${group.city})` : group.name
    return {
      status: 200,
      title: `${titlePrefix} · sessionr`,
      description:
        group.description?.slice(0, 155) ||
        `View session calendar, master tune list, and set lists for ${group.name}.`,
      canonicalUrl,
      robots: 'index, follow',
      ogType: 'website',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'MusicGroup',
        name: group.name,
        ...(group.description ? { description: group.description } : {}),
        ...(group.city ? { location: { '@type': 'Place', name: group.city } } : {}),
        url: canonicalUrl,
      },
    }
  }

  const setMatch = pathname.match(SET_ROUTE_RE)
  if (setMatch) {
    const setId = setMatch[1]
    const res = await fetch(`${PUBLIC_API_ORIGIN}/sets/${setId}`)
    if (res.status === 404) {
      return {
        status: 404,
        title: 'Set not found · sessionr',
        description: 'The requested traditional tune set could not be found.',
        robots: 'noindex, nofollow',
        ogType: 'website',
      }
    }
    if (!res.ok) return null
    const set = (await res.json()) as {
      setId: string
      title: string
      items: Array<{ title: string }>
      analysis: { totalPlaytime: number }
    }
    const canonicalUrl = `${SITE_ORIGIN}/set/${set.setId}`
    const tuneNames = set.items.map((i) => i.title).join(' → ')
    return {
      status: 200,
      title: `${set.title} — Tune Set · sessionr`,
      description: `Play the traditional tune set "${set.title}" (${set.analysis.totalPlaytime} min): ${tuneNames}.`,
      canonicalUrl,
      robots: 'index, follow',
      ogType: 'music.playlist',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'MusicPlaylist',
        name: set.title,
        numTracks: set.items.length,
        url: canonicalUrl,
      },
    }
  }

  return null
}

function rewriteHtmlForMeta(originResponse: Response, meta: ResolvedMeta): Response {
  const headers = new Headers(originResponse.headers)
  headers.delete('content-length')

  const rewriter = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title)
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute('content', meta.description)
      },
    })
    .on('meta[name="robots"]', {
      element(el) {
        el.setAttribute('content', meta.robots)
      },
    })
    .on('meta[property="og:type"]', {
      element(el) {
        el.setAttribute('content', meta.ogType)
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute('content', meta.title)
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute('content', meta.description)
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute('content', meta.title)
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute('content', meta.description)
      },
    })
    .on('head', {
      element(el) {
        if (meta.canonicalUrl) {
          el.append(`<link rel="canonical" href="${meta.canonicalUrl}" />`, { html: true })
          el.append(`<meta property="og:url" content="${meta.canonicalUrl}" />`, { html: true })
        }
        if (meta.jsonLd) {
          el.append(`<script type="application/ld+json">${safeJsonLd(meta.jsonLd)}</script>`, {
            html: true,
          })
        }
      },
    })

  const rewritten = rewriter.transform(originResponse)
  return new Response(rewritten.body, {
    status: meta.status,
    headers,
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // 1. Proxy dynamic XML sitemaps to api-public.sessionr.org
    if ((request.method === 'GET' || request.method === 'HEAD') && SITEMAP_PATHS.has(url.pathname)) {
      const targetUrl = `${PUBLIC_API_ORIGIN}${url.pathname}${url.search}`
      return fetch(targetUrl, {
        method: request.method,
        headers: {
          Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
        },
      })
    }

    // 2. Inject dynamic meta/OG/canonical/404 tags for social & search bots on entity pages
    const userAgent = request.headers.get('user-agent') ?? ''
    if (request.method === 'GET' && BOT_UA_REGEX.test(userAgent)) {
      const isEntityRoute =
        TUNE_ROUTE_RE.test(url.pathname) ||
        GROUP_ROUTE_RE.test(url.pathname) ||
        SET_ROUTE_RE.test(url.pathname)

      if (isEntityRoute) {
        const [originResponse, meta] = await Promise.all([
          fetch(request),
          resolveEntityMeta(url.pathname).catch(() => null),
        ])

        if (meta && originResponse.headers.get('content-type')?.includes('text/html')) {
          return rewriteHtmlForMeta(originResponse, meta)
        }
        return originResponse
      }
    }

    return fetch(request)
  },
}
