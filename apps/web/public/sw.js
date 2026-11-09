// timedesk service worker: lets the web app open without a connection. It only keeps the app's own files (the page
// and its scripts, styles and fonts). It never touches API requests or your data: those live in the app's outbox and
// cache, and go to the server as usual.
const CACHE = 'timedesk-app-v1'
const MAX_FILES = 250

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/')).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MAX_FILES; i++) await cache.delete(keys[i])
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // the API and anything else: straight to the network

  // Pages: the newest from the network, or the saved one when offline (the app routes on the device).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    )
    return
  }

  // Built files have a content hash in their name, so a saved copy is always right: use it, else fetch and save.
  if (url.pathname.startsWith('/assets/') || /\.(woff2?|png|svg|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              void caches.open(CACHE).then((c) => c.put(req, copy).then(() => trim(c)))
            }
            return res
          }),
      ),
    )
  }
})
