# `sessionr` SEO Cloudflare Worker

This Worker sits in front of `https://sessionr.org/*` on Cloudflare and handles two responsibilities that static Azure Static Web Apps cannot do at origin:

1. **Dynamic XML Sitemaps on the canonical domain:** Proxies `/sitemap.xml`, `/sitemap-tunes.xml`, `/sitemap-groups.xml`, and `/sitemap-sets.xml` directly to `https://api-public.sessionr.org/api/...` (`/sitemap-static.xml` and `/robots.txt` pass through to Azure Static Web Apps).
2. **Social & Bot Meta Injection:** For crawler user-agents (Discord, WhatsApp, Slack, Facebook, X/Twitter, Googlebot, Bingbot, etc.) visiting `/tunes/{id}`, `/group/{id}`, or `/set/{id}`, rewrites `<title>`, `<meta name="description">`, Open Graph, Twitter Card, `<link rel="canonical">`, JSON-LD, and HTTP `404` status using live data from `api-public.sessionr.org`.

## Deploy

```bash
cd infra/cloudflare-worker
npx wrangler deploy
```

Make sure `sessionr.org` DNS in Cloudflare is **Proxied** (orange cloud) and the route `sessionr.org/*` in `wrangler.toml` matches your zone.
