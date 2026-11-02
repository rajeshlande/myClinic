/* myClinic service worker — offline app shell.
   Clinical data is never cached: Supabase/auth traffic always goes to the network. */
const VERSION = '1.2.1';
const SHELL_CACHE = `myclinic-shell-v${VERSION}`;
const ASSET_CACHE = `myclinic-assets-v${VERSION}`;

// Relative to the SW scope so the app works from /, /repo/ and a custom domain.
const scope = new URL(self.registration.scope);
const shell = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png']
  .map((p) => new URL(p, scope).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(shell).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only same-origin app files. Supabase REST/auth calls must hit the network.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/rest/v1/') || url.pathname.includes('/auth/v1/')) return;

  // Navigations (hash routes included): network first, cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(shell[1], copy)).catch(() => {});
          return response;
        })
        .catch(async () => (await caches.match(shell[1])) ?? (await caches.match(shell[0])) ?? Response.error()),
    );
    return;
  }

  // Hashed build assets + icons: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
