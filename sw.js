// Service Worker: hält die App-Dateien offline vor, damit sie wie eine echte App startet.
// Kurse und News werden nie zwischengespeichert, die kommen immer frisch aus dem Netz.
const CACHE = 'soxl-v4';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/api.js', 'js/config.js', 'js/demo.js', 'js/events.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // Datenabrufe direkt ans Netz
  // Erst Netz (für Updates), bei Funkloch aus dem Speicher.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});

// Vorgesehen für Preisalarme (Push kommt später über einen eigenen Server).
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : { title: 'Werk 2 Aktiengurus', body: '' };
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: 'icons/icon-192.png' }));
});
