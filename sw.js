// Guarda o app e o reconhecimento facial no celular: abre rápido e funciona sem internet.
const VERSAO = 'ponto-v3';
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
  if (u.hostname === 'cdn.jsdelivr.net') {             // reconhecimento facial: baixa uma vez e guarda
    e.respondWith(caches.open('rosto').then(async c => {
      const r = await c.match(e.request);
      if (r) return r;
      const n = await fetch(e.request);
      if (n.ok) c.put(e.request, n.clone());
      return n;
    }));
    return;
  }
  if (u.origin === location.origin) {                   // app: abre na hora pelo que está guardado e atualiza por trás
    e.respondWith(caches.open(VERSAO).then(async c => {
      const guardado = await c.match(e.request, { ignoreSearch: true });
      const rede = fetch(e.request).then(n => { if (n.ok) c.put(e.request, n.clone()); return n; });
      if (guardado) { e.waitUntil(rede.catch(() => {})); return guardado; }
      return rede.catch(() => c.match('./index.html'));
    }));
  }
});
