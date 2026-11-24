/* Righe — funziona anche senza rete: prima prova la rete, se manca usa la copia salvata. */
const V = 'righe-v45';
const FILES = ['./', 'index.html', 'app.js', 'note.js', 'ai.js', 'prev.js', 'calib.js', 'cars.js', 'brands.js', 'core.js', 'parser.js', 'pdf.min.js', 'pdf.worker.min.js', 'logo-blm.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // solo i file dell'app: le chiamate ad altri siti (es. la sincronizzazione) non passano dalla copia salvata
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)).catch(() => {}); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
