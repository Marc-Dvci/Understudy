// The production build replaces these values with a content hash and every
// file needed for an offline session. Dev mode keeps a minimal shell cache.
const CACHE = 'understudy-v1';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  // Wait for existing sessions to close before replacing their cached chunks.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('understudy-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  e.respondWith(
    isPage
      ? fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => caches.match(req, { ignoreVary: true }).then((r) => r ?? caches.match('./index.html', { ignoreVary: true })))
      : caches.match(req, { ignoreVary: true }).then(
          (hit) =>
            hit ??
            fetch(req).then((res) => {
              if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy));
              }
              return res;
            }),
        ),
  );
});
