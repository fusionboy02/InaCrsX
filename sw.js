/* Service worker de IE Cross Database
   - La web y los datos se piden primero a la red (siempre lo último) y,
     sin conexión, se sirven desde la copia guardada.
   - Las imágenes se sirven al instante desde la copia y se refrescan
     en segundo plano.
   Cambia APP_VERSION cuando publiques cambios de diseño o código: la app
   mostrará el aviso «Hay una versión nueva». Para datos no hace falta. */
const APP_VERSION = '2026-10-05-1';
const SHELL = `iec-shell-${APP_VERSION}`, DATA = 'iec-data', IMG = 'iec-img';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './assets/logo.jpg', './assets/hero.jpg',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-64.png',
  './data/meta.json', './data/players.json', './data/tiers.json', './data/events.json', './data/news.json', './data/coaches.json', './data/guides.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('iec-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch {
    return (await cache.match(key || req)) || (await caches.match(key || req, { ignoreSearch: true })) || Response.error();
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL, './index.html')); return; }
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    const key = url.origin + url.pathname; // ignora el ?t= anti-caché
    e.respondWith(networkFirst(req, DATA, key)); return;
  }
  if (req.destination === 'image') { e.respondWith(staleWhileRevalidate(req)); return; }
  if (url.hostname.includes('fonts.g')) { e.respondWith(staleWhileRevalidate(req)); return; }
  if (url.origin === location.origin) e.respondWith(networkFirst(req, SHELL));
});
