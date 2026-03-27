/**
 * Service worker — caches the app shell (HTML/CSS/JS) so the UI loads offline
 * after the first successful visit. Your business data still lives in localStorage.
 */
const CACHE_NAME = 'auf-yellows-v2';
const CORE = ['index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE))
      .then(async () => {
        const cache = await caches.open(CACHE_NAME);
        const idx = await cache.match('index.html');
        if (idx) {
          const scope = self.registration.scope;
          try {
            await cache.put(scope, idx.clone());
          } catch (_) {}
        }
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || !response.ok) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            try {
              cache.put(event.request, copy);
            } catch (_) {}
          });
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate' || event.request.destination === 'document') {
            return caches.match('index.html');
          }
        });
    })
  );
});
