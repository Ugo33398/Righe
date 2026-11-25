/* Righe — notifiche dei promemoria anche ad app chiusa.
   Parla con il piccolo servizio gratuito su Cloudflare (cartella push-worker): gli manda l'ora dei promemoria,
   il servizio fa suonare il telefono quando scadono. Tutto resta spento finché non lo colleghi in Impostazioni. */
(function () {
  'use strict';
  var PU = window.RighePush = {}, H = null, KEY = 'righePush', msg = '', needKey = false, busy = false, timer = null;
  var DEPLOY = 'https://deploy.workers.cloudflare.com/?url=https://github.com/Ugo33398/righe/tree/main/push-worker';

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } }
  function rnd() { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function b64ToU8(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var r = atob(s), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function cfgOk(c) { return !!(c.url && c.key && c.pub); }
  function paint() { var el = document.getElementById('puMsg'); if (el) el.textContent = msg; }
  function say(t) { msg = t; paint(); }
  function api(c, path, body) {
    var o = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {};
    return fetch(c.url + path, o).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__s = r.status; return j; }); });
  }
  function cfgForSw(c) {
    try { return caches.open('righe-cfg').then(function (ch) { return ch.put('/__push', new Response(JSON.stringify({ url: c.url, key: c.key, dev: c.dev }))); }); } catch (e) { return Promise.resolve(); }
  }
  function getSub() { return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }); }
  function subscribe(c) {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(c.pub) }); });
    });
  }

  /* elenco dei promemoria da mandare al servizio */
  function items() {
    var o = H.ST.notes || {}, out = [];
    Object.keys(o).forEach(function (k) {
      var n = o[k]; if (n.fatto || !n.quando) return;
      var at = new Date(n.quando).getTime(); if (!(at > 0)) return;
      out.push({ i: n.id, at: at, rep: +n.ripeti || 0, t: n.cliente ? 'Promemoria · ' + n.cliente : 'Promemoria', b: n.testo || '(senza testo)' });
    });
    return out;
  }
  PU.sync = function () {
    var c = load(); if (!c.on || !cfgOk(c) || !supported()) return Promise.resolve();
    return getSub().then(function (s) { if (!s) return null; return api(c, '/sync', { key: c.key, dev: c.dev, sub: { endpoint: s.endpoint }, items: items() }); }).catch(function () { /* senza rete: riprova al prossimo cambio */ });
  };
  PU.changed = function () { var c = load(); if (!c.on) return; clearTimeout(timer); timer = setTimeout(PU.sync, 1500); };
  PU.start = function () {
    var c = load(); if (!c.on || !cfgOk(c) || !supported()) return;
    if (Notification.permission !== 'granted') return;
    subscribe(c).then(function () { return cfgForSw(c); }).then(PU.sync).catch(function () { /* ignore */ });
  };

  /* ------------------------------------------------------------- impostazioni */
  PU.status = function () {
    var c = load();
    if (!supported()) return 'Non disponibili qui';
    if (!cfgOk(c)) return 'Da collegare';
    return c.on && Notification.permission === 'granted' ? 'Attive' : 'Collegate, da attivare';
  };
  PU.settingsHtml = function () {
    var c = load(), E = H.esc, h = '';
    if (!supported()) return '<div class="card pad"><b>Notifiche</b><p class="muted tiny">Questo browser non le supporta. Su iPhone e iPad servono iOS 16.4 o più recente e Righe aggiunta alla schermata Home (Condividi → «Aggiungi alla schermata Home»).</p></div>';
    if (isIOS() && !standalone()) h += '<div class="vnote" style="margin-bottom:12px">Su iPhone/iPad le notifiche funzionano solo se apri Righe dall’icona sulla schermata Home. Se non l’hai ancora fatto: Condividi → «Aggiungi alla schermata Home».</div>';
    if (!cfgOk(c)) {
      h += '<div class="card pad"><b>1 · Crea il servizio</b><p class="muted tiny">Un piccolo servizio gratuito su Cloudflare manda le notifiche al posto dell’app. Si crea con un tocco: ti chiede di accedere a Cloudflare e a GitHub e di premere «Deploy».</p><div class="acts"><a class="btn small primary" href="' + DEPLOY + '" target="_blank" rel="noopener">Crea il servizio ↗</a></div></div>' +
        '<div class="card pad"><b>2 · Collega l’app</b><p class="muted tiny">Alla fine Cloudflare ti mostra l’indirizzo del servizio (finisce con «.workers.dev»). Incollalo qui.</p>' +
        '<div class="field" style="margin-top:6px"><input class="in" id="puUrl" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://righe-notifiche.nome.workers.dev" value="' + E(c.url || '') + '" aria-label="Indirizzo del servizio"></div>' +
        (needKey ? '<div class="field"><input class="in" id="puKey" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Chiave (dal primo dispositivo)" aria-label="Chiave"></div>' : '') +
        '<div class="acts"><button class="btn small primary" data-act="pu-link">Collega</button></div></div>';
    } else {
      var granted = Notification.permission === 'granted', denied = Notification.permission === 'denied';
      h += '<div class="card pad"><b>Servizio collegato ✓</b><p class="muted tiny">' + E(c.url.replace(/^https?:\/\//, '')) + '</p>' +
        '<p style="margin:8px 0 0">Questo dispositivo: <b>' + (c.on && granted ? 'notifiche attive ✓' : denied ? 'bloccate dalle impostazioni del telefono' : 'notifiche spente') + '</b></p>' +
        '<div class="acts">' + (c.on && granted ? '<button class="btn small" data-act="pu-test">Invia una prova</button><button class="btn small" data-act="pu-off">Spegni qui</button>' : '<button class="btn small primary" data-act="pu-on">Attiva le notifiche</button>') + '</div>' +
        (denied ? '<p class="muted tiny" style="margin-top:8px">Per riattivarle: Impostazioni del telefono → Notifiche → Righe.</p>' : '') + '</div>' +
        '<div class="card pad"><b>Altri dispositivi</b><p class="muted tiny">Per averle anche su un altro telefono o iPad: apri Righe lì, vai in Notifiche, incolla lo stesso indirizzo e questa chiave.</p><div class="acts"><button class="btn small" data-act="pu-copy">Copia la chiave</button><button class="btn small danger" data-act="pu-unlink">Scollega</button></div></div>';
    }
    return h + '<p class="tiny" id="puMsg" style="margin:8px 4px;min-height:18px">' + H.esc(msg) + '</p>';
  };

  PU.click = function (a) {
    var c = load();
    if (busy) return; busy = true; var done = function () { busy = false; H.render(); };
    if (a === 'pu-link') {
      var el = document.getElementById('puUrl'), url = (el ? el.value : c.url || '').trim().replace(/\/+$/, '');
      if (!url) { busy = false; return say('Incolla l’indirizzo del servizio.'); }
      if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      var ke = document.getElementById('puKey'), key = ke ? ke.value.trim() : '';
      say('Mi collego…');
      var nc = { url: url, dev: c.dev || rnd() };
      api(nc, '/pub').then(function (p) {
        if (p.pub) {  // servizio già avviato: serve la chiave
          if (!key) { needKey = true; say('Il servizio è già in uso: incolla la chiave che trovi nelle Notifiche del primo dispositivo.'); done(); return; }
          return api(nc, '/due?key=' + encodeURIComponent(key) + '&dev=' + nc.dev).then(function (r) {
            if (r.__s === 401) { needKey = true; say('Chiave non valida.'); done(); return; }
            nc.key = key; nc.pub = p.pub; save(nc); needKey = false; say('Collegato ✓ Ora attiva le notifiche.'); done();
          });
        }
        return api(nc, '/init', {}).then(function (r) {
          if (!r.key) { say('Il servizio non risponde come previsto (' + (r.error || r.__s) + ').'); done(); return; }
          nc.key = r.key; nc.pub = r.pub; save(nc); needKey = false; say('Collegato ✓ Ora attiva le notifiche.'); done();
        });
      }).catch(function () { say('Non riesco a raggiungere quell’indirizzo. Controllalo e riprova.'); done(); });
    } else if (a === 'pu-on') {
      Notification.requestPermission().then(function (p) {
        if (p !== 'granted') { say('Permesso negato: abilitalo dalle impostazioni del telefono.'); done(); return; }
        return subscribe(c).then(function () { c.on = true; save(c); return cfgForSw(c); }).then(PU.sync).then(function () { say('Notifiche attive ✓ Prova a inviarne una.'); done(); });
      }).catch(function (e) { say('Non riesco ad attivarle: ' + String((e && e.message) || e).slice(0, 120)); done(); });
    } else if (a === 'pu-test') {
      say('Invio la prova…');
      PU.sync().then(function () { return api(c, '/test', { key: c.key, dev: c.dev }); }).then(function (r) { say(r.ok ? 'Prova inviata: dovrebbe arrivare tra pochi secondi.' : 'Il servizio non è riuscito a inviarla (' + (r.error || r.status || '?') + ').'); done(); }).catch(function () { say('Servizio non raggiungibile.'); done(); });
    } else if (a === 'pu-off') {
      getSub().then(function (s) { return s ? s.unsubscribe() : 0; }).then(function () { return api(c, '/unsync', { key: c.key, dev: c.dev }); }).catch(function () { /* ignore */ }).then(function () { c.on = false; save(c); say('Notifiche spente su questo dispositivo.'); done(); });
    } else if (a === 'pu-unlink') {
      getSub().then(function (s) { return s ? s.unsubscribe() : 0; }).then(function () { return api(c, '/unsync', { key: c.key, dev: c.dev }); }).catch(function () { /* ignore */ }).then(function () { save({}); say('Scollegato.'); done(); });
    } else if (a === 'pu-copy') {
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(c.key) : Promise.reject()).then(function () { say('Chiave copiata.'); busy = false; }, function () { say('Non riesco a copiarla: ' + c.key); busy = false; });
    } else busy = false;
  };

  PU.init = function (host) {
    H = host;
    setTimeout(PU.start, 4000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) PU.changed(); });
  };
})();
