/* ═══════════════════════════════════════════════════
   DELAX GEO-RISK — Service Worker v2.2
   Place this file at the ROOT of your repo (same level as index.html).
   Vercel will serve it at https://your-domain.com/sw.js automatically.

   Strategy: Cache-first for static assets, network-first for API calls.
   ═══════════════════════════════════════════════════ */

const CACHE_NAME  = 'delax-georisk-v2.4'; // bumped — globe.gl removed Fix 2.1
const CACHE_URLS  = [
  '/',
  '/index.html',
  '/dashboard-live.js',
  'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js',
  // globe.gl removed — Fix 2.1 (saves 820KB from precache)
];

/* Install — pre-cache critical assets */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS)).catch(() => {})
  );
});

/* Activate — clear old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch — network first for /api/, cache first for everything else */
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Always go to network for API calls — don't cache live data
  if (url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — using model estimate' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});
