const CACHE = 'ygoexclusives-v2';

const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/config.js',
  '/js/db.js',
  '/js/app.js',
  '/js/inventory.js',
  '/js/collection.js',
  '/js/add-card.js',
  '/js/acquisitions.js',
  '/js/sales.js',
  '/js/reports.js',
  '/js/listing.js',
  '/js/rarity-sets.js',
  '/Icons/icon-192.png',
  '/Icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept Supabase API calls — always go network-first
  if (url.hostname.includes('supabase.co') || url.hostname.includes('ygoprodeck.com')) {
    return;
  }

  // JS and CSS: network-first so deploys are always fresh, cache as offline fallback
  if (url.pathname.match(/\.(js|css)$/)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else (HTML, images): cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
