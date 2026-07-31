import { MetadataRoute } from 'next'

// Static content, never varies per-request — the default dynamic-route caching
// (max-age=0, must-revalidate) means every single page load refetches this
// otherwise. A day is generous for something that only changes on deploy.
export const revalidate = 86400

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'sessionr',
    short_name: 'sessionr',
    description: 'Learn and practice music repertoire with speed training and metronome.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
