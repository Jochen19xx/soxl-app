// Service Worker: hält die App-Dateien offline vor, damit sie wie eine echte App startet.
// Kurse und News werden nie zwischengespeichert, die kommen immer frisch aus dem Netz.
const CACHE = 'soxl-v25';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/api.js', 'js/config.js', 'js/demo.js', 'js/events.js', 'js/translate.js', 'js/portfolio.js', 'js/alarms.js', 'js/chart.js', 'js/trend.js',
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
    fetch(e.request, { cache: 'no-cache' }) // nie eine alte Version aus dem Browser-Speicher
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});

// Preisalarme: Der Server schickt eine leere Push-Nachricht, den Text holen wir hier ab.
const SERVER = 'https://aktiengurus.veith-jochen.workers.dev';

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let messages = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch(`${SERVER}/push/inbox?endpoint=${encodeURIComponent(sub.endpoint)}`);
      messages = (await res.json()).messages || [];
    } catch {}
    if (!messages.length) messages = [{ title: 'SOXL-Alarm', body: 'Ein Preisalarm wurde ausgelöst. Tippe, um die App zu öffnen.' }];
    await Promise.all(messages.map((m, i) => self.registration.showNotification(m.title || 'SOXL-Alarm', {
      body: m.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'alarm-' + (m.time || Date.now()) + '-' + i, data: { url: m.url },
    })));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const url = e.notification.data?.url || './';
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) {
      if (url.includes('#bericht')) all[0].postMessage({ open: 'bericht' });
      return all[0].focus();
    }
    return self.clients.openWindow(url);
  })());
});
