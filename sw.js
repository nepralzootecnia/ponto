// Guarda o app e o reconhecimento facial no celular para abrir mais rápido.
const VERSAO = 'ponto-v1';
const APP = ['./', './index.html', './app.js', './config.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(APP)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO && k !== 'rosto').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.hostname === 'cdn.jsdelivr.net') {           // modelos do rosto: guarda de vez
    e.respondWith(caches.open('rosto').then(async c => {
      const r = await c.match(e.request);
      if (r) return r;
      const n = await fetch(e.request);
      if (n.ok) c.put(e.request, n.clone());
      return n;
    }));
    return;
  }
  if (u.origin === location.origin) {                 // app: sempre a versão mais nova, com cópia para sem internet
    e.respondWith(fetch(e.request).then(n => {
      const cp = n.clone();
      caches.open(VERSAO).then(c => c.put(e.request, cp));
      return n;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
  }
});
