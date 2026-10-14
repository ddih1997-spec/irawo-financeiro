const CACHE = 'irawo-v3';
const BASE = ['./', './index.html', './logica.js', './manifest.json', './icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Rede primeiro e sem cache HTTP (sempre a versão mais nova); cache só como reserva offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-store' }).then(res => {
    const copia = res.clone();
    caches.open(CACHE).then(c => c.put(req, copia));
    return res;
  }).catch(() => caches.match(req)));
});
