/* Righe — funziona anche senza rete: prima prova la rete, se manca usa la copia salvata. */
const V = 'righe-v27';
const FILES = ['./', 'index.html', 'app.js', 'note.js', 'ai.js', 'prev.js', 'brands.js', 'core.js', 'parser.js', 'pdf.min.js', 'pdf.worker.min.js', 'logo-blm.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
