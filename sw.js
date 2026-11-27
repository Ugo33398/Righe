/* Righe — funziona anche senza rete: prima prova la rete, se manca usa la copia salvata. */
const V = 'righe-v67';
const FILES = ['./', 'index.html', 'app.js', 'note.js', 'ai.js', 'ordine.js', 'prev.js', 'calib.js', 'cars.js', 'push.js', 'brands.js', 'core.js', 'parser.js', 'pdf.min.js', 'pdf.worker.min.js', 'logo-blm.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'righe-bg' && k !== 'righe-cfg').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // solo i file dell'app: le chiamate ad altri siti (es. la sincronizzazione) non passano dalla copia salvata
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // il modello per togliere lo sfondo è pesante e non cambia: copia salvata a parte, scaricata una volta sola
  if (new URL(e.request.url).pathname.indexOf('/vendor/bgdata/') >= 0) {
    e.respondWith(caches.open('righe-bg').then(c => c.match(e.request).then(m => m || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()).catch(() => {}); return r; }))));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)).catch(() => {}); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

// notifiche dei promemoria (servizio su Cloudflare): il push arriva «vuoto», qui chiedo il testo da mostrare
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const r = await (await caches.open('righe-cfg')).match('/__push'), c = r && await r.json();
      if (c) {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(c.url + '/due?key=' + encodeURIComponent(c.key) + '&dev=' + encodeURIComponent(c.dev), { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t); items = ((await res.json()).items) || [];
      }
    } catch (err) { /* senza rete: avviso generico */ }
    if (!items.length) items = [{ i: 'x', t: 'Promemoria', b: 'Hai un promemoria da guardare.' }];
    await Promise.all(items.map(it => self.registration.showNotification(it.t || 'Promemoria', { body: it.b || '', tag: 'righe-' + it.i, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './#promemoria' } })));
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(items.length); } catch (err) { /* ignore */ }
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs[0];
    if (c) { try { c.navigate('./#promemoria'); } catch (err) { /* ignore */ } return c.focus(); }
    return self.clients.openWindow('./#promemoria');
  }));
});
