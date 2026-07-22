const CACHE_NAME = 'sessionapp-cache-v2';
const SOUNDFONT_CACHE_NAME = 'sessionapp-soundfont-v1';

const PRECACHE_ASSETS = [
  '/',
  '/repertoire',
  '/practice/queue',
  '/practice/sets',
  '/practice/ear',
  '/sets',
  '/tunes',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons.svg',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

const SOUNDFONT_BASE = 'https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM';

// Generate soundfont MP3 URLs for default instruments:
// Fiddle (110): MIDI 55 to 84 (G3 to C6)
// Guitar Nylon (24): MIDI 40 to 67 (E2 to G4)
// Acoustic Bass (32): MIDI 28 to 52 (E1 to E3)
function buildSoundfontUrls() {
  const urls = [];
  const addFolderRange = (folder, startMidi, endMidi) => {
    for (let midi = startMidi; midi <= endMidi; midi++) {
      urls.push(`${SOUNDFONT_BASE}/${folder}/c${midi}.mp3`);
    }
  };

  addFolderRange('fiddle-mp3', 55, 84);
  addFolderRange('acoustic_guitar_nylon-mp3', 40, 67);
  addFolderRange('acoustic_bass-mp3', 28, 52);
  return urls;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => {
        // Non-blocking best-effort precache for soundfont files
        caches.open(SOUNDFONT_CACHE_NAME).then((sfCache) => {
          const sfUrls = buildSoundfontUrls();
          Promise.allSettled(
            sfUrls.map((url) =>
              fetch(url, { mode: 'cors' }).then((res) => {
                if (res.ok) sfCache.put(url, res);
              }).catch(() => {})
            )
          );
        });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name !== SOUNDFONT_CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Avoid caching non-GET requests or backend APIs (JS-layer IndexedDB handles /api/)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Cache-First strategy for soundfonts (cross-origin or local)
  if (url.hostname === 'paulrosen.github.io' || url.pathname.includes('-mp3/')) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok || networkResponse.type === 'opaque') {
            const responseClone = networkResponse.clone();
            caches.open(SOUNDFONT_CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => {
          return new Response('', { status: 404, statusText: 'Soundfont note unavailable offline' });
        });
      })
    );
    return;
  }

  // Cache-First strategy for static JS/CSS and local assets
  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2|mp3|wav|json|webmanifest)$/);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Network-First strategy for page documents to allow offline fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return caches.match('/');
        });
      })
  );
});
