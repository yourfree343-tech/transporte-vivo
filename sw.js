// Service worker: la app abre al instante y funciona sin cobertura con lo último guardado.
const V = 'tv-v11';
const SHELL = ['./', 'index.html', 'feeds-client.js', 'extras.js', 'planner.js', 'vendor/leaflet.js', 'vendor/leaflet.css', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // datos en directo y mapas: siempre de la red
  // primero la red (para tener siempre la última versión); si no hay conexión, lo guardado
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
