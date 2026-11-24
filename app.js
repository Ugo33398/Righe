/* Righe — interfaccia e archivio. Logica pura in core.js, lettore PDF in parser.js. */
(function () {
  'use strict';
  var C = window.RigheCore, P = window.RigheParser, NT = window.RigheNote, AI = window.RigheAI, PV = window.RighePrev;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var today = function () { return C.todayISO(); };

  /* ------------------------------------------------------------------ stato */
  // Referenti per marchio, dalla lista interna "Gestione case automobilistiche" (Gianluca Filippone sostituito da Ivan Corsini).
  // I codici sono quelli della colonna Mar del PDF. FCA (Fiat/Jeep/Chrysler) e i codici dei ricambi non originali restano da assegnare.
  var SEED_V = 7;
  function defSettings() {
    return {
      seedV: SEED_V, firma: C.DEFAULT_FIRMA, intro: C.DEFAULT_INTRO,
      lead: { VOL: [3, 7], BM: [2, 3], VLK: [2, 3], NSS: [4, 7], FCA: [1, 2], REN: [2, 4], MA: [7, 8], ME: [3, 4], TOY: [2, 3], HYU: [6, 7], FRD: [2, 5], TM: [15, 15, 1], SUB: [7, 8], MG: [10, 10], JAE: [15, 20, 1], CIT: [2, 3], 700: [2, 6], DRA: [2, 6], SID: [2, 6], BLZ: [2, 6], 113: [2, 6], 501: [2, 6], WD: [2, 6] },
      managers: [
        { id: 'm_nicola', nome: 'Nicola Deboni', email: '' },
        { id: 'm_fabio', nome: 'Fabio Pinzetta', email: '' },
        { id: 'm_davide', nome: 'Davide Lagana', email: '' },
        { id: 'm_ivan', nome: 'Ivan Corsini', email: '' },
        { id: 'm_pietro', nome: 'Pietro Borghesan', email: '' },
        { id: 'm_stefano', nome: 'Stefano Gattini', email: '' },
        { id: 'm_marco', nome: 'Marco Zanini', email: '' },
        { id: 'm_gianluca', nome: 'Gianluca Filippone', email: '' }
      ],
      brandMap: {
        BM: 'm_nicola', VLK: 'm_nicola',
        REN: 'm_fabio', TOY: 'm_fabio', HYU: 'm_fabio', KIA: 'm_fabio', MG: 'm_fabio',
        VOL: 'm_davide', NSS: 'm_davide', FRD: 'm_davide', SUB: 'm_davide',
        ME: 'm_gianluca', OPL: 'm_gianluca', CIT: 'm_gianluca',
        MA: 'm_pietro', TM: 'm_pietro', LND: 'm_pietro', FCA: 'm_pietro',
        700: 'm_marco', DRA: 'm_marco', SID: 'm_marco', BLZ: 'm_marco', 113: 'm_marco', 501: 'm_marco', WD: 'm_marco',
        JAE: 'm_stefano'
      }
    };
  }
  // chi ha già un archivio riceve i nuovi referenti senza perdere ciò che ha cambiato
  function seedMerge(st) {
    if ((st.seedV || 0) >= SEED_V) return false;
    var d = defSettings();
    if ((st.seedV || 0) < 7) ['ME', 'OPL', 'CIT'].forEach(function (b) { if (st.brandMap && st.brandMap[b] === 'm_ivan') st.brandMap[b] = 'm_gianluca'; });
    d.managers.forEach(function (m) {
      var ex = st.managers.filter(function (x) { return x.id === m.id; })[0];
      if (!ex) st.managers.push(m); else if (!ex.email) ex.email = m.email;
    });
    Object.keys(d.brandMap).forEach(function (b) { if (!st.brandMap[b]) st.brandMap[b] = d.brandMap[b]; });
    st.lead = st.lead || {}; Object.keys(d.lead).forEach(function (b) { if (!(b in st.lead)) st.lead[b] = d.lead[b]; });
    if (!st.intro || st.intro === C.OLD_INTRO || st.intro === C.MID_INTRO) st.intro = C.DEFAULT_INTRO;
    if (!st.firma || st.firma === C.OLD_FIRMA || st.firma === C.MID_FIRMA) st.firma = C.DEFAULT_FIRMA;
    st.seedV = SEED_V; return true;
  }
  var ST = { settings: defSettings(), imports: [], rows: {}, notes: {}, prev: {}, logo: '', ready: false };
  C.setLead(ST.settings.lead);
  var UI = { tab: 'dashboard', scope: 'aperte', q: '', sort: 'cliente', limit: 40, sheetId: null, sol: null, cli: null };
  var TABS = [['dashboard', 'Panoramica'], ['righe', 'Righe'], ['promemoria', 'Promemoria'], ['calendario', 'Calendario'], ['ordini', 'Ordini'], ['impostazioni', 'Impostazioni']];

  function ctx() {
    var last = ST.imports[0];
    return { cut: C.cutoffISO(today()), today: today(), baseline: ST.imports.length >= 2, lastImportId: last ? last.id : '' };
  }
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function toast(msg, ms) {
    var d = document.createElement('div'); d.textContent = msg; $('#toast').appendChild(d);
    setTimeout(function () { d.remove(); }, ms || 2600);
  }

  /* --------------------------------------------------------------- archivio */
  var Store = { mode: 'loading', col: null, shards: {}, shardIds: {}, dirty: {}, inflight: {}, flushing: false, fails: 0, status: 'loading', firstSnap: false };

  function setStatus(s) {
    Store.status = s;
    var t = { loading: 'Carico i dati…', saving: 'Salvataggio…', saved: '✓ Salvato', error: '⚠ Non salvato', mem: '⚠ Solo sessione', offline: '⚠ Archivio non raggiunto' }[s] || '';
    $('#status').textContent = t;
  }
  function shardOf(r) { return 'rows_' + r.dataOC.slice(0, 7); }
  function markDirty(id) { Store.dirty[id] = 1; flushSoon(); }
  function markAll() {
    var ids = { settings: 1, imports: 1, notes: 1, prev: 1 }, k;
    if (ST.logo) ids.logo = 1;
    for (k in ST.rows) ids[shardOf(ST.rows[k])] = 1;
    for (k in Store.shardIds) ids[k] = 1;
    for (k in ids) Store.dirty[k] = 1;
    flushSoon();
  }
  function buildDoc(id) {
    if (id === 'settings') return JSON.parse(JSON.stringify(ST.settings));
    if (id === 'imports') return { list: JSON.parse(JSON.stringify(ST.imports)) };
    if (id === 'logo') return { dataUrl: ST.logo || '' };
    if (id === 'notes') return { items: JSON.parse(JSON.stringify(ST.notes)) };
    if (id === 'prev') return { items: JSON.parse(JSON.stringify(ST.prev)) };
    var rows = {}, k;
    for (k in ST.rows) if (shardOf(ST.rows[k]) === id) rows[k] = ST.rows[k];
    return { rows: JSON.parse(JSON.stringify(rows)) };
  }
  var flushTimer = null;
  function flushSoon() {
    if (Store.mode !== 'db') { setStatus('mem'); return; }
    setStatus('saving');
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 500);
  }
  async function flush() {
    if (Store.flushing || Store.mode !== 'db') return;
    Store.flushing = true;
    try {
      while (Object.keys(Store.dirty).length) {
        var id = Object.keys(Store.dirty)[0], data = buildDoc(id);
        delete Store.dirty[id]; Store.inflight[id] = 1;
        try {
          if (JSON.stringify(data).length > 240000) toast('Attenzione: archivio del mese quasi pieno', 5000);
          await Store.col.doc(id).set(data);
          Store.shardIds[id] = 1; Store.fails = 0;
          if (id.indexOf('rows_') === 0) Store.shards[id] = clone(data.rows || {});
        } catch (e) {
          Store.dirty[id] = 1; Store.fails++;
          if (Store.fails >= 3) { setStatus('error'); toast('Salvataggio non riuscito. Riprovo appena possibile.', 5000); Store.flushing = false; setTimeout(flush, 15000); return; }
          await sleep(1200 * Store.fails);
        } finally { delete Store.inflight[id]; }
      }
    } finally { Store.flushing = false; }
    setStatus(Object.keys(Store.dirty).length ? 'saving' : 'saved');
    if (Store.local && !Object.keys(Store.dirty).length) syncSoon(3000);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function applyDoc(id, data) {
    if (id === 'settings') { var d = defSettings(); ST.settings = Object.assign(d, clone(data)); if (!ST.settings.managers) ST.settings.managers = d.managers; if (!ST.settings.brandMap) ST.settings.brandMap = {}; if (seedMerge(ST.settings)) markDirty('settings'); C.setLead(ST.settings.lead); }
    else if (id === 'imports') ST.imports = clone(data.list || []);
    else if (id === 'logo') ST.logo = data.dataUrl || '';
    else if (id === 'notes') ST.notes = clone(data.items || {});
    else if (id === 'prev') ST.prev = clone(data.items || {});
    else if (id.indexOf('rows_') === 0) { Store.shards[id] = clone(data.rows || {}); Store.shardIds[id] = 1; }
  }
  function rebuildRows(skip) {
    // i documenti in scrittura (skip) non si toccano: valgono le righe locali
    var next = {}, s, k;
    for (s in Store.shards) if (!skip[s]) Object.assign(next, Store.shards[s]);
    for (k in ST.rows) if (skip[shardOf(ST.rows[k])]) next[k] = ST.rows[k];
    ST.rows = next;
  }

  async function initStore() { await initLocal(); }
  // I dati stanno in questo dispositivo, nel database del browser
  async function initLocal() {
    try {
      var idb = await new Promise(function (res, rej) {
        var rq = indexedDB.open('righe-v1', 2);
        rq.onupgradeneeded = function () { var db = rq.result; if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs'); if (!db.objectStoreNames.contains('media')) db.createObjectStore('media'); };
        rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); };
      });
      var all = await new Promise(function (res, rej) {
        var out = {}, cur = idb.transaction('docs', 'readonly').objectStore('docs').openCursor();
        cur.onsuccess = function (e) { var c = e.target.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
        cur.onerror = function () { rej(cur.error); };
      });
      var putRaw = function (id, v) { return new Promise(function (res, rej) {
        var tx = idb.transaction('docs', 'readwrite'); tx.objectStore('docs').put(v, id);
        tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); };
      Store.t = {}; Object.keys(all).forEach(function (id) { Store.t[id] = (all[id] && all[id]._t) || 0; });
      Store.col = { doc: function (id) { return { set: function (d) { var v = JSON.parse(JSON.stringify(d)); v._t = Date.now(); Store.t[id] = v._t; return putRaw(id, v); } }; } };
      Store.getDoc = function (id) { return new Promise(function (res, rej) { var rq = idb.transaction('docs', 'readonly').objectStore('docs').get(id); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); };
      Store.putRemote = function (id, data, t) { var v = JSON.parse(JSON.stringify(data)); v._t = t; Store.t[id] = t; return putRaw(id, v); };
      // foto e vocali: archivio a parte, solo su questo dispositivo (non finisce nella sincronizzazione)
      Store.media = {
        put: function (id, type, buf) { return new Promise(function (res, rej) { var tx = idb.transaction('media', 'readwrite'); tx.objectStore('media').put({ type: type, buf: buf }, id); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); },
        get: function (id) { return new Promise(function (res, rej) { var rq2 = idb.transaction('media', 'readonly').objectStore('media').get(id); rq2.onsuccess = function () { res(rq2.result); }; rq2.onerror = function () { rej(rq2.error); }; }); },
        del: function (id) { return new Promise(function (res, rej) { var tx = idb.transaction('media', 'readwrite'); tx.objectStore('media').delete(id); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }
      };
      Store.mode = 'db'; Store.local = true; Store.firstSnap = true;
      Object.keys(all).forEach(function (id) { applyDoc(id, all[id]); });
      rebuildRows({});
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
      setStatus('saved'); finishLoad(); syncLoadCfg(); if (Sync.cfg) setTimeout(syncNow, 600);
    } catch (e) { Store.mode = 'mem'; setStatus('mem'); finishLoad(); }
  }
  function finishLoad() { ST.ready = true; refresh(); NT.start(); }

  /* ------------------------------------------------- sincronizzazione (archivio privato su GitHub) */
  var Sync = { cfg: null, meta: { sha: {}, rt: {}, last: '' }, busy: false, err: '', timer: null };
  function syncLoadCfg() {
    try { Sync.cfg = JSON.parse(localStorage.getItem('righeSync') || 'null'); } catch (e) { Sync.cfg = null; }
    try { var m = JSON.parse(localStorage.getItem('righeSyncMeta') || 'null'); if (m) Sync.meta = m; } catch (e) { /* ignore */ }
  }
  function syncSaveMeta() { try { localStorage.setItem('righeSyncMeta', JSON.stringify(Sync.meta)); } catch (e) { /* ignore */ } }
  function toB64(str) { var b = new TextEncoder().encode(str), o = '', i; for (i = 0; i < b.length; i += 0x8000) o += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(o); }
  function fromB64(b) { var o = atob(String(b).replace(/\s/g, '')), a = new Uint8Array(o.length), i; for (i = 0; i < o.length; i++) a[i] = o.charCodeAt(i); return new TextDecoder().decode(a); }
  async function gh(method, path, body) {
    var r = await fetch('https://api.github.com/repos/' + Sync.cfg.repo + path, { method: method, cache: 'no-store', headers: { Authorization: 'Bearer ' + Sync.cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404) return null;
    if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  function syncMsg(e) {
    var st = e && e.status;
    return st === 401 ? 'Token non valido o scaduto: creane uno nuovo.' : st === 403 ? 'Il token non ha il permesso «Contents: lettura e scrittura» su questo archivio.' : st === 404 ? 'Archivio non trovato: controlla il nome e che il token lo comprenda.' : 'Nessuna connessione o servizio non raggiungibile. Riprovo più tardi.';
  }
  function syncStatusText() {
    if (!Sync.cfg) return '';
    if (Sync.busy) return 'Sincronizzo…';
    if (Sync.err) return '⚠ ' + Sync.err;
    return Sync.meta.last ? 'Ultima sincronizzazione: ' + fmtTs(Sync.meta.last) : 'Non ancora sincronizzato.';
  }
  function syncPaint() { var el = $('#syncst'); if (el) el.textContent = syncStatusText(); }
  async function syncPutDoc(id) {
    var raw = await Store.getDoc(id); if (!raw) return;
    var t = raw._t || Store.t[id] || Date.now(), data = Object.assign({}, raw); delete data._t;
    var body = { message: 'sync ' + id, content: toB64(JSON.stringify({ t: t, data: data })) }, path = '/contents/docs/' + id + '.json', res;
    if (Sync.meta.sha[id]) body.sha = Sync.meta.sha[id];
    try { res = await gh('PUT', path, body); }
    catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      var cur = await gh('GET', path); if (cur) body.sha = cur.sha; else delete body.sha;
      res = await gh('PUT', path, body);
    }
    Sync.meta.sha[id] = res.content.sha; Sync.meta.rt[id] = t;
  }
  async function syncNow() {
    if (!Store.local || !Sync.cfg || Sync.busy) return;
    if (navigator.onLine === false) { Sync.err = 'Senza rete.'; syncPaint(); return; }
    Sync.busy = true; Sync.err = ''; syncPaint();
    try {
      var list = await gh('GET', '/contents/docs'), remote = {}, changed = false, skip = Object.assign({}, Store.dirty, Store.inflight), id;
      (Array.isArray(list) ? list : []).forEach(function (f) { if (/\.json$/.test(f.name)) remote[f.name.slice(0, -5)] = f.sha; });
      for (id in remote) {
        if (remote[id] === Sync.meta.sha[id]) continue;
        var f = await gh('GET', '/contents/docs/' + id + '.json'); if (!f) continue;
        var doc = JSON.parse(fromB64(f.content)), rt = doc.t || 0;
        Sync.meta.sha[id] = f.sha; Sync.meta.rt[id] = rt;
        if (rt > (Store.t[id] || 0) && !skip[id]) { await Store.putRemote(id, doc.data || {}, rt); applyDoc(id, doc.data || {}); changed = true; }
      }
      if (changed) { rebuildRows(skip); refresh(); }
      for (id in Store.t) { if (Store.t[id] > (Sync.meta.rt[id] || 0) && !skip[id]) await syncPutDoc(id); }
      Sync.meta.last = new Date().toISOString(); syncSaveMeta();
    } catch (e) { Sync.err = syncMsg(e); }
    Sync.busy = false; syncPaint();
  }
  function syncSoon(ms) { if (!Sync.cfg) return; clearTimeout(Sync.timer); Sync.timer = setTimeout(syncNow, ms || 3000); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') syncSoon(500); });
  window.addEventListener('online', function () { syncSoon(800); });
  setInterval(function () { if (document.visibilityState === 'visible') syncNow(); }, 90000);
  async function syncOn() {
    var repo = ($('#sy-repo').value || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, ''), tok = ($('#sy-tok').value || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !tok) { showMsg('Mancano dei dati', 'Scrivi il nome dell’archivio (es. Ugo33398/righe-dati) e incolla il token.'); return; }
    Sync.cfg = { repo: repo, token: tok }; Sync.meta = { sha: {}, rt: {}, last: '' };
    try { var info = await gh('GET', ''); if (!info) throw Object.assign(new Error('nf'), { status: 404 }); }
    catch (e) { Sync.cfg = null; showMsg('Non riesco a collegarmi', syncMsg(e)); return; }
    try { localStorage.setItem('righeSync', JSON.stringify(Sync.cfg)); } catch (e) { /* ignore */ }
    syncSaveMeta(); render(); toast('Sincronizzazione attiva'); syncNow();
  }
  function syncOff() { Sync.cfg = null; Sync.err = ''; try { localStorage.removeItem('righeSync'); localStorage.removeItem('righeSyncMeta'); } catch (e) { /* ignore */ } Sync.meta = { sha: {}, rt: {}, last: '' }; render(); toast('Sincronizzazione disattivata su questo dispositivo'); }
  function syncCard() {
    if (!Store.local) return '';
    return '<div class="card pad" style="margin-top:14px"><b>Sincronizzazione tra dispositivi</b><p class="muted tiny">I dati vengono copiati in un archivio privato sul tuo GitHub e tenuti uguali su tutti i dispositivi collegati. Attivala prima dove hai già i dati, poi sugli altri.</p>' +
      (Sync.cfg ? '<p id="syncst" class="tiny">' + esc(syncStatusText()) + '</p><div class="muted tiny" style="margin-bottom:8px">Archivio: ' + esc(Sync.cfg.repo) + '</div><div class="acts"><button class="btn small" data-act="syncnow">Sincronizza ora</button><button class="btn small danger" data-act="syncoff">Disattiva su questo dispositivo</button></div>'
        : '<div class="field"><label for="sy-repo">Archivio privato</label><input class="in" id="sy-repo" autocapitalize="off" autocorrect="off" spellcheck="false" value="Ugo33398/righe-dati"></div><div class="field"><label for="sy-tok">Token di accesso</label><input class="in" id="sy-tok" type="password" autocomplete="off" autocapitalize="off" placeholder="github_pat_…"></div><div class="acts"><button class="btn primary small" data-act="syncon">Attiva</button></div>') + '</div>';
  }

  /* -------------------------------------------------------------- modifiche */
  function updateRow(id, patch, noRefresh) {
    var r = ST.rows[id]; if (!r) return;
    Object.assign(r, patch); markDirty(shardOf(r));
    if (!noRefresh) refresh();
  }
  function saveSettings() { C.setLead(ST.settings.lead); markDirty('settings'); }
  function managerFor(marchio) {
    var id = ST.settings.brandMap[marchio];
    return ST.settings.managers.filter(function (m) { return m.id === id; })[0] || null;
  }

  /* --------------------------------------------------------------- utilità UI */
  function tag(t, c) { return '<span class="tag ' + (c || '') + '">' + esc(t) + '</span>'; }
  function localDate(iso) { return C.todayISO(new Date(iso)); }
  function fmtTs(iso) { if (!iso) return ''; var d = new Date(iso), p2 = function (n) { return (n < 10 ? '0' : '') + n; }; return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function ageText(iso) { var n = C.daysBetween(iso, today()); return n <= 0 ? 'oggi' : n === 1 ? 'ieri' : n + ' gg'; }
  function lastSent(r) { var s = (r.solleciti || []).filter(function (x) { return x.inviato; }); return s.length ? localDate(s[s.length - 1].tInv) : ''; }
  function hasPrepared(r) { return (r.solleciti || []).some(function (x) { return !x.inviato; }); }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fallback */ }
    try {
      var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  function drawMark() { var m = $('#mark'); m.className = 'mark logo'; m.innerHTML = '<img alt="B.L.M. Bovio Ricambi" src="' + esc(ST.logo || 'logo-blm.png') + '">'; }

  /* ------------------------------------------------------------------ viste */
  function rowHtml(r, c) {
    var tags = [], gone = C.isGone(r);
    if (C.isNew(r, c)) tags.push(tag('Nuova', 'blue'));
    if (r.present && r.tornata && r.tornata === c.lastImportId) tags.push(tag('Ricomparsa', 'vio'));
    if (gone) tags.push(tag('Non più presente dal ' + C.fmtShort(r.goneAt), 'amber'));
    if (r.priorita === 'urgente') tags.push(tag('Urgente', 'red')); else if (r.priorita === 'alta') tags.push(tag('Alta', 'amber'));
    if (r.stato !== 'in_attesa') tags.push(tag(C.STATI[r.stato], r.stato === 'arrivo_confermato' ? 'green' : r.stato === 'da_sollecitare' ? 'red' : 'blue'));
    if (C.isOltre(r, c.today)) tags.push(tag('Oltre la stima', 'red'));
    var ls = lastSent(r); if (ls) tags.push(tag('Sollecitata ' + C.fmtShort(ls), 'green')); else if (hasPrepared(r)) tags.push(tag('Mail preparata', 'amber'));
    if (r.note && r.note.trim()) tags.push(tag('Note'));
    return '<button class="row' + (gone ? ' gone' : '') + '" data-act="open" data-id="' + esc(r.id) + '">' +
      '<div><div class="r-cli">' + esc(r.cliente) + '</div><div class="r-sub num">' + esc(r.ordine) + ' · ' + C.fmtShort(r.dataOC) + ' · ' + esc(ageText(r.dataOC)) + '</div></div>' +
      '<div class="r-veh">' + esc(C.pulisciRif(r.riferimento) || '—') + '</div>' +
      '<div><div><span class="mar">' + esc(r.marchio) + '</span><span class="ref">' + esc(r.referenza) + '</span></div><div class="r-desc">' + esc(r.descrizione) + '</div></div>' +
      '<div class="r-tags"><span class="qty">×' + esc(r.quantita) + '</span>' + tags.join('') + '</div></button>';
  }
  function emptyHtml(title, text, withBtn) {
    return '<div class="empty card"><b>' + esc(title) + '</b>' + esc(text) + (withBtn ? '<div style="margin-top:16px"><label class="btn primary" for="pdfIn">Carica il PDF degli ordini aperti</label></div>' : '') + '</div>';
  }
  function memBanner() {
    return Store.mode === 'mem' ? '<div class="banner bad"><div><b>Archivio non disponibile.</b> I dati restano solo finché questa pagina è aperta: se la chiudi li perdi. Fai un backup prima di chiudere.</div></div>' : '';
  }

  function viewDashboard() {
    var c = ctx(), n = C.counts(ST.rows, c), last = ST.imports[0];
    if (!last) return memBanner() + '<h1>Benvenuto in Righe</h1>' + emptyHtml('Nessun documento caricato', 'Carica il PDF «Righe ordini cliente aperte» e vedrai subito ricambi, clienti e ritardi. Dal giorno dopo, Righe confronta i documenti e ti dice cosa è nuovo e cosa non c’è più.', true);
    var days = C.daysBetween(last.refDate, today());
    var att = [], k;
    for (k in ST.rows) { var r = ST.rows[k]; if (r.dataOC >= c.cut && r.present && !r.nascosta && (r.priorita !== 'normale' || C.isOltre(r, c.today) || r.stato === 'da_sollecitare')) att.push(r); }
    var pr = { urgente: 0, alta: 1, normale: 2 };
    att.sort(function (a, b) { return pr[a.priorita] - pr[b.priorita] || a.dataOC.localeCompare(b.dataOC); });
    var byCli = {}; for (k in ST.rows) { var x = ST.rows[k]; if (x.dataOC >= c.cut && x.present && !x.nascosta) byCli[x.cliente] = (byCli[x.cliente] || 0) + 1; }
    var top = Object.keys(byCli).sort(function (a, b) { return byCli[b] - byCli[a]; }).slice(0, 6), max = top.length ? byCli[top[0]] : 1;
    var stat = function (scope, num, label, cls) { return '<button class="stat ' + (cls || '') + '" data-act="goscope" data-scope="' + scope + '"><b>' + num + '</b><span>' + label + '</span></button>'; };
    return memBanner() +
      (days >= 1 ? '<div class="banner warn"><div>L’ultimo documento è del <b>' + C.fmt(last.refDate) + '</b> (' + (days === 1 ? 'ieri' : days + ' giorni fa') + '). Carica quello di oggi per avere la situazione aggiornata.</div></div>' : '') +
      '<div class="hero"><div><div class="big">' + n.aperte + '</div><div>righe aperte</div></div><div><p><b>' + n.clienti + '</b> clienti · documento del <b>' + C.fmt(last.refDate) + '</b></p><p>Ultimi tre mesi: ordini dal ' + C.fmt(c.cut) + '</p>' + (last.escluse.length ? '<p class="tiny" style="opacity:.8">' + last.escluse.length + ' righe più vecchie nel PDF non sono mostrate</p>' : '') + '</div></div>' +
      '<div class="grid5">' + stat('nuove', c.baseline ? n.nuove : '–', 'nuove dall’ultimo documento', 'blue') + stat('gone', n.gone, 'non più presenti') + stat('sollecitare', n.sollecitare, 'da sollecitare') + stat('oltre', n.oltre, 'oltre la stima', n.oltre ? 'hot' : '') + stat('urgenti', n.urgenti, 'alta priorità', n.urgenti ? 'hot' : '') + '</div>' +
      AI.todayHtml() + NT.dashHtml() + '<h2>Da tenere d’occhio</h2>' + (att.length ? '<div class="list">' + att.slice(0, 8).map(function (r) { return rowHtml(r, c); }).join('') + '</div>' + (att.length > 8 ? '<p class="muted tiny">e altre ' + (att.length - 8) + '…</p>' : '') : '<div class="card pad muted">Niente di urgente: nessuna riga con priorità alta, da sollecitare o oltre la stima.</div>') +
      '<h2>Clienti con più righe aperte</h2><div class="card pad bars">' + top.map(function (t) { return '<button class="b" data-act="gocli" data-q="' + esc(t) + '"><div class="t"><i style="width:' + Math.round(byCli[t] / max * 100) + '%"></i><span>' + esc(t) + '</span></div><b class="num">' + byCli[t] + '</b></button>'; }).join('') + '</div>';
  }

  var SCOPES = [['aperte', 'Aperte'], ['nuove', 'Nuove'], ['gone', 'Non più presenti'], ['oltre', 'Oltre la stima'], ['sollecitare', 'Da sollecitare'], ['urgenti', 'Alta priorità'], ['note', 'Con note'], ['tolte', 'Tolte'], ['tutte', 'Tutte']];
  function viewRighe() {
    var c = ctx(), n = C.counts(ST.rows, c);
    return memBanner() + '<div class="nhead"><h1>Righe e clienti</h1><button class="btn small" data-act="ai-open">Leggi risposta</button></div><div class="bar"><input id="q" class="search" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Cerca cliente, targa, codice…" value="' + esc(UI.q) + '" aria-label="Cerca">' +
      '<select id="sort" class="in" style="width:auto" aria-label="Ordina"><option value="cliente">Ordina: cliente</option><option value="recenti">Più recenti</option><option value="vecchie">Più vecchie</option><option value="priorita">Priorità</option></select></div>' +
      '<div class="chips">' + SCOPES.map(function (s) { var cnt = s[0] === 'nuove' && !c.baseline ? '–' : n[s[0]]; return '<button class="chip" data-act="scope" data-scope="' + s[0] + '" aria-pressed="' + (UI.scope === s[0]) + '">' + s[1] + ' <i>' + cnt + '</i></button>'; }).join('') + '</div>' +
      '<div id="rcount" class="muted tiny"></div><div class="list" id="rlist"></div>';
  }
  var BCOL = ['#1E40C9', '#0B7A5A', '#B4531A', '#7A3FB3', '#A31616', '#0E6F8F', '#5C6B1F', '#8A2F5E'];
  function brandImgOf(b) {
    var u = (ST.settings.brandImg || {})[b]; if (u) return u;
    var lib = window.BRAND_LIB || {}, slug = (ST.settings.brandCode || {})[b] || (window.BRAND_CODE || {})[b];
    if (!slug) { var low = String(b).toLowerCase(); if (lib[low]) slug = low; }
    return slug && lib[slug] ? lib[slug][1] : '';
  }
  function brandBadge(b) {
    var img = brandImgOf(b);
    if (img) return '<img class="bimg" alt="' + esc(b) + '" src="' + esc(img) + '">';
    if ((window.BRAND_AFTER || []).indexOf(b) >= 0) return '<span class="bsq" title="Fornitore non originale" aria-hidden="true">' + esc(b.slice(0, 3)) + '</span>';
    var h = 0, i; for (i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
    return '<span class="bdot" style="background:' + BCOL[h % BCOL.length] + '" aria-hidden="true">' + esc(b.slice(0, 3)) + '</span>';
  }
  function lineHtml(r, c) {
    var tags = [], gone = C.isGone(r);
    if (C.isNew(r, c)) tags.push(tag('Nuova', 'blue'));
    if (r.present && r.tornata && r.tornata === c.lastImportId) tags.push(tag('Ricomparsa', 'vio'));
    if (gone) tags.push(tag('Non più presente dal ' + C.fmtShort(r.goneAt), 'amber'));
    if (r.priorita !== 'normale') tags.push(tag(C.PRIORITA[r.priorita], r.priorita === 'urgente' ? 'red' : 'amber'));
    if (r.stato !== 'in_attesa') tags.push(tag(C.STATI[r.stato], r.stato === 'arrivo_confermato' ? 'green' : r.stato === 'da_sollecitare' ? 'red' : 'blue'));
    if (C.isOltre(r, c.today)) tags.push(tag('Oltre la stima', 'red'));
    var ls = lastSent(r); if (ls) tags.push(tag('Sollecitata ' + C.fmtShort(ls), 'green')); else if (hasPrepared(r)) tags.push(tag('Mail preparata', 'amber'));
    if (r.nascosta) tags.push(tag((r.motivo === 'consegnato' ? 'Consegnato' : r.motivo === 'annullato' ? 'Annullato' : 'Tolta') + (r.tolta ? ' il ' + C.fmtShort(r.tolta) : ''), r.motivo === 'consegnato' ? 'green' : 'amber'));
    if (r.note && r.note.trim()) tags.push(tag('Note'));
    return '<div class="line' + (gone ? ' gone' : '') + '" data-act="open" data-id="' + esc(r.id) + '">' + brandBadge(r.marchio) + '<span class="ref">' + esc(r.referenza) + '</span><span class="d">' + esc(r.descrizione) + '</span><b>×' + esc(r.quantita) + '</b>' + tags.join('') +
      '<button class="btn small sollbtn" data-act="solrow" data-id="' + esc(r.id) + '">Sollecita</button></div>';
  }
  // parola del modello -> marchio dell'auto (le parole sono intere, in maiuscolo)
  var MODEL_BRAND = {
    toyota: 'YARIS COROLLA AYGO RAV4 CHR C-HR AURIS AVENSIS CRUIS CRUISER HILUX PRIUS', volkswagen: 'GOLF POLO TIGUAN PASSAT TOUAREG TOURAN CADDY T-ROC TROC UP POLO SHARAN AMAROK TRANSPORTER', renault: 'CLIO TWINGO MEGANE CAPTUR KADJAR SCENIC ZOE KANGOO TRAFIC MASTER LAGUNA ESPACE',
    fiat: 'PANDA PUNTO DOBLO TIPO 500 500X 500L BRAVO DUCATO FIORINO QUBO', jeep: 'COMPASS RENEGADE WRANGLER CHEROKEE', volvo: 'XC40 XC60 XC90 V40 V60 V70 S60 S90 C30', nissan: 'JUKE QASHQAI MICRA NOTE X-TRAIL XTRAIL NAVARA LEAF PULSAR', ford: 'FOCUS FIESTA KUGA GALAXY MONDEO MUSTANG RANGER TRANSIT ECOSPORT PUMA',
    mercedes: 'VITO SPRINTER CLASSE CLA GLA GLC GLE', hyundai: 'I10 I20 I30 TUCSON KONA IONIQ SANTA', kia: 'SPORTAGE CEED RIO PICANTO NIRO STONIC SORENTO', subaru: 'FORESTER IMPREZA OUTBACK XV', mazda: 'MAZDA CX-5 CX5 CX-3', tesla: 'TESLA MODEL', mg: 'MG MG4 MG3 HS ZS', mini: 'MINI COOPER', bmw: 'BMW', audi: 'AUDI', opel: 'OPEL CORSA ASTRA MOKKA INSIGNIA', peugeot: 'PEUGEOT', citroen: 'CITROEN JUMPER BERLINGO PICASSO C3 C4 C5 DS3', dacia: 'DACIA SANDERO DUSTER LOGAN', 'land-rover': 'DISCOVERY DEFENDER FREELANDER EVOQUE', suzuki: 'SWIFT VITARA IGNIS JIMNY', honda: 'CIVIC JAZZ HONDA', seat: 'SEAT IBIZA LEON ATECA', skoda: 'SKODA OCTAVIA FABIA SUPERB KODIAQ KAROQ', alfa: 'GIULIETTA MITO STELVIO GIULIA', lancia: 'YPSILON DELTA'
  };
  var MODEL_SLUG = { mercedes: 'mercedes-benz', alfa: 'alfa-romeo' }, MODEL_IDX = null;
  function modelBrandSlug(model) {
    if (!MODEL_IDX) { MODEL_IDX = {}; Object.keys(MODEL_BRAND).forEach(function (k) { MODEL_BRAND[k].split(' ').forEach(function (w) { if (w && !MODEL_IDX[w]) MODEL_IDX[w] = MODEL_SLUG[k] || k; }); }); }
    var toks = String(model || '').toUpperCase().replace(/[^A-Z0-9\- ]/g, ' ').split(/\s+/), i;
    for (i = 0; i < toks.length; i++) if (MODEL_IDX[toks[i]]) return MODEL_IDX[toks[i]];
    return '';
  }
  function vehBrandImg(g) {
    var lib = window.BRAND_LIB || {}, slug = modelBrandSlug(g.v.model);
    if (slug && lib[slug]) return { src: lib[slug][1], name: lib[slug][0] };
    var cnt = {}, best = '', bn = 0;
    g.rows.forEach(function (r) { if (brandImgOf(r.marchio)) { cnt[r.marchio] = (cnt[r.marchio] || 0) + 1; if (cnt[r.marchio] > bn) { bn = cnt[r.marchio]; best = r.marchio; } } });
    return best ? { src: brandImgOf(best), name: best } : null;
  }
  function vehInfo(r) {
    var t = C.pulisciRif(r.riferimento) || '', m = t.match(/[A-Z]{2}\d{3}[A-Z]{2}/), plate = m ? m[0] : '';
    var model = t.replace(plate, '').replace(/\s+/g, ' ').replace(/(\s\d{1,2})+$/, '').trim();
    return { key: plate || ('T:' + (model || '—')), plate: plate, model: model };
  }
  function vehLogo(g) { var b = vehBrandImg(g); return b ? '<img class="bimg vlogo" alt="' + esc(b.name) + '" title="' + esc(b.name) + '" src="' + esc(b.src) + '">' : ''; }
  function groupHtml(nm, rs, c, openIt) {
    var veh = {}, nNew = 0, nUrg = 0, nOltre = 0;
    rs.forEach(function (r) {
      var v = vehInfo(r), g = veh[v.key] = veh[v.key] || { v: v, rows: [], ords: {}, last: '' };
      if (!g.v.model && v.model) g.v = v;
      g.rows.push(r); g.ords[r.ordine] = r.dataOC; if (r.dataOC > g.last) g.last = r.dataOC;
      if (C.isNew(r, c)) nNew++; if (r.priorita !== 'normale') nUrg++; if (C.isOltre(r, c.today)) nOltre++;
    });
    var keys = Object.keys(veh).sort(function (a, b) { return veh[b].last.localeCompare(veh[a].last) || a.localeCompare(b); });
    return '<details class="cli"' + (openIt ? ' open' : '') + ' data-cli="' + esc(nm) + '"><summary><b>' + esc(nm) + '</b>' +
      (nNew ? '<span class="tag blue">' + nNew + ' nuove</span>' : '') + (nUrg ? '<span class="tag red">' + nUrg + ' prioritarie</span>' : '') + (nOltre ? '<span class="tag red">' + nOltre + ' oltre stima</span>' : '') +
      '<span class="tag">' + keys.length + (keys.length === 1 ? ' macchina' : ' macchine') + ' · ' + rs.length + (rs.length === 1 ? ' riga' : ' righe') + '</span></summary><div class="cli-body">' + AI.schedaHtml(nm) +
      keys.map(function (k) {
        var g = veh[k], os = Object.keys(g.ords).sort().reverse(), oldest = g.rows.reduce(function (m, r) { return r.dataOC < m ? r.dataOC : m; }, g.last);
        return '<div class="ord"><div class="ord-h">' + vehLogo(g) + '<b class="plate">' + esc(g.v.plate || g.v.model || '—') + '</b>' + (g.v.plate && g.v.model ? '<span class="vmodel">' + esc(g.v.model) + '</span>' : '') + '<button class="btn small primary" style="margin-left:auto" data-act="solveh" data-cli="' + esc(nm) + '" data-veh="' + esc(k) + '">Sollecita tutto</button></div>' +
          '<div class="muted tiny num" style="margin-bottom:2px">' + os.map(function (o) { return esc(o); }).join(' · ') + ' · dal ' + C.fmtShort(oldest) + ' · ' + esc(ageText(oldest)) + '</div>' +
          g.rows.map(function (r) { return lineHtml(r, c); }).join('') + '</div>';
      }).join('') + '</div></details>';
  }
  function fillList() {
    var box = $('#rlist'); if (!box) return;
    var c = ctx(), list = C.filterRows(ST.rows, { scope: UI.scope, q: UI.q, sort: UI.sort }, c);
    var order = [], by = {};
    list.forEach(function (r) { if (!by[r.cliente]) { by[r.cliente] = []; order.push(r.cliente); } by[r.cliente].push(r); });
    $('#rcount').textContent = order.length + (order.length === 1 ? ' cliente' : ' clienti') + ' · ' + list.length + (list.length === 1 ? ' riga' : ' righe') + (UI.q ? ' per «' + UI.q + '»' : '');
    if (!ST.imports.length) box.innerHTML = emptyHtml('Nessun documento caricato', 'Carica il PDF degli ordini aperti per cominciare.', true);
    else if (!list.length) box.innerHTML = emptyHtml('Nessuna riga', UI.q ? 'Prova con meno parole o solo la targa.' : UI.scope === 'nuove' && !c.baseline ? 'Il confronto parte dal secondo documento caricato.' : 'Non ci sono righe in questa categoria.');
    else {
      var shown = order.slice(0, UI.limit);
      box.innerHTML = shown.map(function (nm) { return groupHtml(nm, by[nm], c, order.length === 1 || (!!UI.q && order.length <= 4) || UI.cli === nm); }).join('') +
        (order.length > shown.length ? '<button class="btn" data-act="more">Mostra altri ' + Math.min(40, order.length - shown.length) + ' clienti</button>' : '');
    }
  }

  function viewImpostazioni() {
    var s = ST.settings, brands = {}, k;
    for (k in ST.rows) brands[ST.rows[k].marchio] = 1; for (k in s.brandMap) brands[k] = 1;
    var bl = Object.keys(brands).sort();
    var opts = function (sel) { return '<option value="">— nessuno —</option>' + s.managers.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.nome) + '</option>'; }).join(''); };
    return memBanner() + '<h1>Impostazioni</h1>' +
      '<div class="card pad"><b>Responsabili marchio</b><p class="muted tiny">Le persone a cui mandi i solleciti, con i loro indirizzi. Puoi modificarli o aggiungerne altre.</p>' +
      s.managers.map(function (m) { return '<div class="mgr"><input class="in" data-in="mgrNome" data-id="' + esc(m.id) + '" value="' + esc(m.nome) + '" aria-label="Nome"><input class="in" type="email" inputmode="email" data-in="mgrEmail" data-id="' + esc(m.id) + '" value="' + esc(m.email) + '" placeholder="email@azienda.it" aria-label="Email"><button class="btn small danger" data-act="mgrdel" data-id="' + esc(m.id) + '">Elimina</button></div>'; }).join('') +
      '<div class="acts"><button class="btn small" data-act="mgradd">+ Aggiungi responsabile</button><button class="btn small" data-act="mgrbulk">Incolla elenco indirizzi</button></div></div>' +
      '<div class="card pad" style="margin-top:14px"><b>Chi riceve i solleciti, per marchio</b><p class="muted tiny">Scegli il responsabile di ogni marchio trovato nei documenti. Tocca il tondo a destra per dare a un marchio la sua immagine (un logo dalla Galleria). Puoi anche assegnare il responsabile al volo quando prepari un sollecito.</p>' +
      (bl.length ? bl.map(function (b) { return '<div class="brandrow"><span class="mar">' + esc(b) + '</span><select class="in" data-in="brand" data-b="' + esc(b) + '">' + opts(s.brandMap[b]) + '</select><span class="bpick"><button class="bthumb" data-act="bpick" data-b="' + esc(b) + '" title="Scegli il logo">' + brandBadge(b) + '</button>' + ((s.brandImg || {})[b] ? '<button class="x" data-act="bimgdel" data-b="' + esc(b) + '" aria-label="Togli immagine">×</button>' : '') + '</span></div>'; }).join('') : '<p class="muted">I marchi compaiono dopo il primo PDF.</p>') + '</div>' +
      '<div class="card pad" style="margin-top:14px"><b>Tempi di consegna per marchio</b><p class="muted tiny">Giorni lavorativi dalla data dell’ordine (da… a…). Con questi tempi Righe stima l’arrivo di ogni riga e lo mostra nel calendario; se li superano, la riga risulta «oltre la stima». Lascia vuoto un marchio per non stimare.</p>' +
      Object.keys(Object.assign({}, brands, s.lead)).sort().map(function (b) { var l = s.lead[b] || []; return '<div class="brandrow"><span class="mar">' + esc(b) + '</span><span class="leadin"><input class="in" type="number" min="0" max="60" inputmode="numeric" data-in="leadmin" data-b="' + esc(b) + '" value="' + (l[0] || '') + '" aria-label="Giorni minimi" placeholder="da"><span>–</span><input class="in" type="number" min="0" max="60" inputmode="numeric" data-in="leadmax" data-b="' + esc(b) + '" value="' + (l[1] || '') + '" aria-label="Giorni massimi" placeholder="a"><span class="muted tiny">giorni</span></span></div>'; }).join('') + '</div>' +
      '<div class="card pad" style="margin-top:14px"><b>Testo dei solleciti</b><div class="field"><label for="intro">Messaggio ({nome} = nome del responsabile, {pezzo} = «questo pezzo» o «questi pezzi»)</label><textarea class="in" id="intro" data-in="intro">' + esc(s.intro) + '</textarea></div><div class="field"><label for="firma">Firma</label><textarea class="in" id="firma" data-in="firma">' + esc(s.firma) + '</textarea></div></div>' +
      '<div class="card pad" style="margin-top:14px"><b>Logo</b><p class="muted tiny">In alto a sinistra c’è il logo B.L.M. Bovio Ricambi. Se vuoi, puoi sostituirlo con un’altra immagine.</p><div class="acts"><label class="btn small" for="logoIn">Scegli immagine</label><input type="file" id="logoIn" accept="image/*" hidden>' + (ST.logo ? '<button class="btn small danger" data-act="logodel">Ripristina logo Bovio</button>' : '') + '</div></div>' +
      AI.settingsHtml() +
      syncCard() +
      '<div class="card pad" style="margin-top:14px"><b>Backup</b><p class="muted tiny">' + (Store.local ? 'I dati sono salvati su questo dispositivo: se cambi telefono o cancelli i dati del sito li perdi. Fai ogni tanto un backup e conservalo nei File.' : 'I dati sono salvati nel tuo archivio privato. Una copia in più non guasta, soprattutto prima di grandi modifiche.') + '</p><div class="acts"><button class="btn small" data-act="bkexp">Salva backup</button><button class="btn small" data-act="bkcopy">Copia backup</button><label class="btn small" for="bkIn">Ripristina da file</label><input type="file" id="bkIn" accept=".json,application/json" hidden></div></div>' +
      '<p class="muted tiny" style="margin-top:18px">Righe · finestra mobile di tre mesi su Data OC (oggi dal ' + C.fmt(C.cutoffISO(today())) + '). Le righe scomparse dal PDF sono segnalate come «non più presenti»: possibile arrivo, mai una conferma.</p>';
  }

  var ORD_URL = 'https://ordini.bovioricambi.it/order';
  function viewOrdini() {
    return '<div class="nhead"><h1>Ordini</h1><a class="btn small primary" href="' + ORD_URL + '" target="_blank" rel="noopener">Apri a schermo intero</a></div>' +
      '<p class="muted tiny" style="margin:0 0 8px">La pagina degli ordini del magazzino. Se qui sotto resta bianca o non ti lascia entrare, usa il pulsante: alcuni siti non si aprono dentro un’altra app.</p>';
  }
  function showOrdHost(on) {
    var h = $('#ordHost'); if (!h) return;
    if (on && !h.firstChild) { var f = document.createElement('iframe'); f.src = ORD_URL; f.title = 'Ordini'; f.setAttribute('allow', 'camera; microphone; clipboard-write'); h.appendChild(f); }
    h.hidden = !on;
  }
  function render() {
    var nav = $('#nav'); nav.innerHTML = TABS.map(function (t) { return '<button data-act="tab" data-tab="' + t[0] + '"' + (UI.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + (t[0] === 'promemoria' ? NT.badge() : t[0] === 'preventivi' ? PV.badge() : '') + '</button>'; }).join('');
    var v = $('#view'); showOrdHost(UI.tab === 'ordini' && ST.ready);
    if (!ST.ready) { v.innerHTML = '<div class="empty"><b>Carico i dati…</b></div>'; return; }
    var fn = { dashboard: viewDashboard, righe: viewRighe, preventivi: PV.view, promemoria: NT.viewList, calendario: NT.viewCal, ordini: viewOrdini, impostazioni: viewImpostazioni }[UI.tab];
    v.innerHTML = fn();
    if (UI.tab === 'righe') { $('#sort').value = UI.sort; fillList(); }
    drawMark(); NT.afterRender();
    var cur = $('[aria-current=page]', nav); if (cur) nav.scrollLeft = Math.max(0, cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2);
  }
  function refresh() {
    var a = document.activeElement;
    if (a && a.dataset && a.dataset.n) return;
    if (a && (a.id === 'q' || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.dataset.in))) { if (UI.tab === 'righe') fillList(); return; }
    render();
  }
  function setTab(t, keepHash) {
    UI.tab = t; if (!keepHash) { try { history.replaceState(null, '', '#' + t); } catch (e) { try { location.hash = t; } catch (e2) { /* ignore */ } } }
    render(); window.scrollTo(0, 0);
  }

  /* ----------------------------------------------------------------- scheda */
  var L1, L2;
  function closeSheet() { UI.sheetId = null; L1.innerHTML = ''; }
  function closeDlg() { UI.sol = null; L2.innerHTML = ''; }
  function openSheet(id) { UI.sheetId = id; renderSheet(); }
  function renderSheet(keep) {
    var r = ST.rows[UI.sheetId]; if (!r) { closeSheet(); return; }
    var c = ctx(), prevTop = keep ? ($('.sheet', L1) || {}).scrollTop : 0;
    var pres = C.isGone(r) ? '<div class="pres gone"><b>Non più presente dal ' + C.fmt(r.goneAt) + '.</b> Può essere arrivata, ma non è confermato: potrebbe anche essere stata annullata o corretta. Verifica prima di dirlo al cliente.</div>'
      : C.isNew(r, c) ? '<div class="pres new"><b>Nuova</b>: compare per la prima volta nel documento del ' + C.fmt((ST.imports[0] || {}).refDate) + '.</div>'
      : r.present ? '<div class="pres">Presente nell’ultimo documento' + (r.firstSeen ? ' · vista dal ' + C.fmt(r.firstSeen) : '') + '.</div>' : '<div class="pres">Non presente nell’ultimo documento.</div>';
    var sol = (r.solleciti || []).slice().reverse().map(function (e) {
      return '<div class="sol"><span><b>' + esc(e.a || 'senza destinatario') + '</b><br><span class="muted tiny">' + esc(fmtTs(e.t)) + ' · ' + (e.inviato ? 'inviato il ' + C.fmt(localDate(e.tInv)) : 'preparato, non confermato come inviato') + '</span></span>' +
        '<button class="btn small" data-act="entsent" data-e="' + esc(e.id) + '">' + (e.inviato ? 'Annulla invio' : 'Segna inviato') + '</button></div>';
    }).join('');
    var mgr = managerFor(r.marchio), es = C.estimate(r), ld = ST.settings.lead[r.marchio] || [], estHtml = '';
    if (es) {
      var late = es.kind !== 'conf' && es.to < c.today;
      estHtml = '<dt>Arrivo</dt><dd>' + (es.kind === 'conf' ? 'Confermato il ' + C.fmt(es.from) : es.kind === 'man' ? 'Stimato per il ' + C.fmt(es.from)
        : 'Tra il ' + C.fmt(es.from) + ' e il ' + C.fmt(es.to) + '<br><span class="muted tiny">tempi abituali ' + ld[0] + '–' + ld[1] + ' giorni lavorativi' + (es.vary ? ', molto variabili' : '') + '</span>') +
        (late ? '<br><span class="tag red">oltre il tempo previsto</span>' : '') + '</dd>';
    }
    L1.innerHTML = '<div class="veil" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Dettaglio riga" data-stop="1">' +
      '<div class="sh-head"><div><h3>' + esc(r.cliente) + '</h3><div class="muted num">' + esc(r.ordine) + ' · ' + C.fmt(r.dataOC) + ' (' + esc(ageText(r.dataOC)) + ')</div></div><button class="x" data-act="closesheet" aria-label="Chiudi">×</button></div>' + pres +
      '<dl class="kv"><dt>Veicolo</dt><dd>' + esc(C.pulisciRif(r.riferimento) || '—') + '</dd><dt>Marchio</dt><dd>' + esc(r.marchio) + (mgr ? ' <span class="muted tiny">· ' + esc(mgr.nome) + '</span>' : '') + '</dd>' + estHtml + '<dt>Codice</dt><dd class="ref">' + esc(r.referenza) + '</dd><dt>Descrizione</dt><dd>' + esc(r.descrizione) + '</dd><dt>Quantità</dt><dd>' + esc(r.quantita) + '</dd>' + (r.rit ? '<dt>Rit</dt><dd>' + esc(r.rit) + '</dd>' : '') + '</dl>' +
      '<div class="field"><label>Priorità</label><div class="seg">' + ['normale', 'alta', 'urgente'].map(function (p) { return '<button class="r-' + p + '" data-act="pri" data-v="' + p + '" aria-pressed="' + (r.priorita === p) + '">' + C.PRIORITA[p] + '</button>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="f-stato">Stato</label><select class="in" id="f-stato" data-in="stato">' + Object.keys(C.STATI).map(function (s) { return '<option value="' + s + '"' + (r.stato === s ? ' selected' : '') + '>' + C.STATI[s] + '</option>'; }).join('') + '</select></div>' +
      '<div class="two"><div class="field"><label for="f-eta">Arrivo stimato</label><input class="in" type="date" id="f-eta" data-in="eta" value="' + esc(r.eta || '') + '"></div>' +
      (r.stato === 'arrivo_confermato' ? '<div class="field"><label for="f-conf">Arrivo confermato</label><input class="in" type="date" id="f-conf" data-in="etaConf" value="' + esc(r.etaConf || '') + '"></div>' : '<div></div>') + '</div>' +
      (r.eta && r.stato !== 'arrivo_confermato' ? '<div class="muted tiny">Una stima non è una conferma: nei messaggi ai clienti compare come «da confermare».</div>' : '') +
      '<div class="field"><label for="f-note">Note</label><textarea class="in" id="f-note" data-in="note" placeholder="Es. chiamato il magazzino, richiamare giovedì…">' + esc(r.note || '') + '</textarea></div>' +
      '<div class="acts"><button class="btn primary" data-act="sollecita">Sollecita magazzino</button>' + (C.isGone(r) ? '<button class="btn" data-act="archivia">Archivia</button>' : '') + (r.nascosta ? '<button class="btn" data-act="rimetti">Rimetti nella lista</button>' : '<button class="btn" data-act="togli" data-m="consegnato">Consegnato</button><button class="btn" data-act="togli" data-m="annullato">Annullato</button>') + '</div>' +
      (sol ? '<div class="field"><label>Solleciti</label>' + sol + '</div>' : '') + '</div></div>';
    if (keep && prevTop) $('.sheet', L1).scrollTop = prevTop;
  }

  /* ------------------------------------------------------------- sollecito */
  function solRows() {
    var s = UI.sol, ids = [s.rowId].concat(Object.keys(s.extra)); return ids.map(function (i) { return ST.rows[i]; }).filter(Boolean);
  }
  function solRecompute() {
    var s = UI.sol, mgr = ST.settings.managers.filter(function (m) { return m.id === s.mgrId; })[0] || null, t = C.composeSollecito(solRows(), mgr, ST.settings);
    s.subject = t.subject; s.body = t.body;
  }
  // un tocco su "Sollecita": se il responsabile ha già l'indirizzo, apre direttamente Mail con il testo pronto
  function quickSollecito(ids) {
    var first = ST.rows[ids[0]]; if (!first) return;
    var mgr = managerFor(first.marchio);
    UI.sol = { rowId: ids[0], mgrId: mgr ? mgr.id : '', to: mgr && mgr.email ? mgr.email : '', remember: false, extra: {}, prepared: false, entries: [] };
    ids.slice(1).forEach(function (i) { UI.sol.extra[i] = 1; });
    solRecompute(); var href = solHref(); solPrepare(); UI.sol = null;
    var a = document.createElement('a'); a.href = href; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
  }
  function vehRows(cli, veh) {
    var c = ctx(), out = [], k;
    for (k in ST.rows) { var r = ST.rows[k]; if (r.present && !r.nascosta && r.dataOC >= c.cut && r.cliente === cli && vehInfo(r).key === veh) out.push(r); }
    return out.sort(function (a, b) { return a.marchio.localeCompare(b.marchio) || a.referenza.localeCompare(b.referenza); });
  }
  function solVeh(cli, veh) { solMany(vehRows(cli, veh), 'Sollecita la macchina'); }
  function solMany(rows, title) {
    var by = {}, order = [];
    rows.forEach(function (r) { var m = managerFor(r.marchio), key = m ? m.id : '?' + r.marchio; if (!by[key]) { by[key] = { m: m, ids: [], marchi: {} }; order.push(key); } by[key].ids.push(r.id); by[key].marchi[r.marchio] = 1; });
    if (order.length === 1) { quickSollecito(by[order[0]].ids); return; }
    UI.solGroups = order.map(function (k) { return by[k]; });
    L2.innerHTML = '<div class="veil center" data-act="closedlg"><div class="dlg" role="dialog" aria-modal="true" aria-label="' + esc(title) + '" data-stop="1"><div class="sh-head"><div><h3>' + esc(title) + '</h3><div class="muted tiny">I pezzi sono di responsabili diversi: una mail per ciascuno</div></div><button class="x" data-act="closedlg" aria-label="Chiudi">×</button></div>' +
      UI.solGroups.map(function (g, i) { return '<button class="btn" style="width:100%;margin:6px 0;justify-content:space-between" data-act="solgrp" data-i="' + i + '"><span>' + esc(g.m ? g.m.nome : 'Senza responsabile') + '</span><span class="muted tiny">' + Object.keys(g.marchi).join(' ') + ' · ' + g.ids.length + (g.ids.length === 1 ? ' pezzo' : ' pezzi') + '</span></button>'; }).join('') + '</div></div>';
  }
  function openSollecito(rowId) {
    var r = ST.rows[rowId], m = managerFor(r.marchio);
    UI.sol = { rowId: rowId, mgrId: m ? m.id : '', to: m ? m.email : '', remember: !m, extra: {}, prepared: false, entries: [] };
    solRecompute(); renderSol();
  }
  function solHref() { var s = UI.sol; return C.mailtoHref(s.to, s.subject, s.body); }
  function renderSol() {
    var s = UI.sol, r = ST.rows[s.rowId], c = ctx(), others = [], k;
    for (k in ST.rows) { var o = ST.rows[k]; if (o.present && !o.nascosta && o.dataOC >= c.cut && o.marchio === r.marchio && o.id !== r.id) others.push(o); }
    others.sort(function (a, b) { return a.dataOC.localeCompare(b.dataOC); });
    L2.innerHTML = '<div class="veil center" data-act="closedlg"><div class="dlg" role="dialog" aria-modal="true" aria-label="Sollecita magazzino" data-stop="1">' +
      '<div class="sh-head"><h3>Sollecita magazzino · ' + esc(r.marchio) + '</h3><button class="x" data-act="closedlg" aria-label="Chiudi">×</button></div>' +
      '<div class="two"><div class="field"><label for="s-m">Responsabile</label><select class="in" id="s-m" data-sol="mgr"><option value="">— scegli —</option>' + ST.settings.managers.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === s.mgrId ? ' selected' : '') + '>' + esc(m.nome) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="s-to">Indirizzo email</label><input class="in" id="s-to" type="email" inputmode="email" autocomplete="off" data-sol="to" value="' + esc(s.to) + '" placeholder="Inserisci l’indirizzo"></div></div>' +
      (s.mgrId && managerFor(r.marchio) && managerFor(r.marchio).id !== s.mgrId || (s.mgrId && !managerFor(r.marchio)) ? '<label class="check" style="border:0;padding-top:0"><input type="checkbox" data-sol="remember"' + (s.remember ? ' checked' : '') + '><span>Usa questo responsabile per tutto il marchio ' + esc(r.marchio) + '</span></label>' : '') +
      (others.length ? '<details style="margin:8px 0"><summary style="cursor:pointer;font-weight:600;min-height:40px;display:flex;align-items:center">Aggiungi altre righe ' + esc(r.marchio) + ' ancora aperte (' + others.length + ')</summary>' + others.slice(0, 60).map(function (o) { return '<label class="check"><input type="checkbox" data-sol="extra" data-id="' + esc(o.id) + '"' + (s.extra[o.id] ? ' checked' : '') + '><span><b>' + esc(o.cliente) + '</b> · ' + esc(o.ordine) + ' · ' + esc(o.referenza) + ' ' + esc(o.descrizione) + '</span></label>'; }).join('') + '</details>' : '') +
      '<div class="field"><label for="s-o">Oggetto</label><input class="in" id="s-o" data-sol="subject" value="' + esc(s.subject) + '"></div>' +
      '<div class="field"><label for="s-b">Testo</label><textarea class="in" id="s-b" style="min-height:230px" data-sol="body">' + esc(s.body) + '</textarea></div>' +
      '<div class="acts"><a class="btn primary" id="mailA" href="' + esc(solHref()) + '" data-act="mailclick">Apri in Mail</a><button class="btn" data-act="solcopy">Copia testo</button><button class="btn" data-act="solcopyto">Copia indirizzo</button></div>' +
      '<div class="banner info" style="margin:0"><div>Aprire la mail non vuol dire averla inviata. Quando l’hai spedita, premi <b>Segna come inviato</b>: così lo storico dei solleciti resta vero.</div></div>' +
      '<div class="acts"><button class="btn" data-act="solsent">Segna come inviato</button></div></div></div>';
  }
  function solPrepare() {
    var s = UI.sol; if (s.prepared) return; s.prepared = true;
    solRows().forEach(function (r) {
      var e = { id: uid(), t: new Date().toISOString(), a: s.to, o: s.subject, inviato: false };
      s.entries.push({ row: r.id, e: e.id }); updateRow(r.id, { solleciti: (r.solleciti || []).concat([e]) }, true);
    });
    var mg = ST.settings.managers.filter(function (m) { return m.id === s.mgrId; })[0];
    if (s.remember && mg) ST.settings.brandMap[ST.rows[s.rowId].marchio] = mg.id;
    if (mg && !mg.email && s.to) mg.email = s.to; // ricorda l'indirizzo la prima volta
    saveSettings();
    refresh(); if (UI.sheetId) renderSheet(true);
  }
  function solMarkSent() {
    var s = UI.sol; solPrepare();
    s.entries.forEach(function (x) {
      var r = ST.rows[x.row]; if (!r) return;
      var list = (r.solleciti || []).map(function (e) { return e.id === x.e ? Object.assign({}, e, { inviato: true, tInv: new Date().toISOString() }) : e; });
      updateRow(x.row, { solleciti: list, ultimoSollecito: today() }, true);
    });
    refresh(); if (UI.sheetId) renderSheet(true);
    toast('Registrato come inviato'); closeDlg();
  }

  /* ------------------------------------------------------------- importazione */
  async function readPdf(file) {
    var buf = await file.arrayBuffer();
    if (!window.pdfjsLib) await new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'pdf.min.js'; sc.onload = res; sc.onerror = function () { rej(new Error('lettore PDF non caricato')); }; document.head.appendChild(sc); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', document.baseURI).href;
    var pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise, pages = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      var tc = await (await pdf.getPage(i)).getTextContent();
      pages.push(tc.items.map(function (it) { return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }; }));
    }
    return P.parse(pages);
  }
  var pending = null;
  async function importFile(file) {
    toast('Leggo il PDF…');
    var res;
    try { res = await readPdf(file); } catch (e) { showMsg('Non riesco a leggere questo PDF', 'Il file potrebbe essere danneggiato o protetto. ' + (e && e.message ? '(' + e.message + ')' : '')); return; }
    if (!res.rows.length) { showMsg('Nessuna riga trovata', 'Non riconosco il formato. Serve il PDF «Righe ordini cliente aperte» esportato dal gestionale.'); return; }
    var pv = C.previewImport(ST.rows, res.rows, today()), last = ST.imports[0], warns = res.warnings.slice(0, 3), refDate = res.refDate || today();
    if (!res.refDate) warns.push('Non trovo la data del documento: uso quella di oggi.');
    if (last && refDate < last.refDate) warns.push('Questo documento (' + C.fmt(refDate) + ') è più vecchio dell’ultimo caricato (' + C.fmt(last.refDate) + '): importarlo farebbe tornare indietro la situazione.');
    if (last && refDate === last.refDate) warns.push('Hai già caricato un documento con questa data. Reimportarlo non cambia le tue note.');
    var openNow = C.counts(ST.rows, ctx()).aperte;
    if (last && pv.gone >= 10 && pv.gone > openNow * 0.5) warns.push('Mancano ' + pv.gone + ' righe su ' + openNow + ': controlla di aver esportato lo stesso agente e senza filtri diversi, altrimenti verrebbero segnate come «non più presenti».');
    var agenti = Array.from(new Set(res.rows.map(function (r) { return r.agente; })));
    pending = { res: res, file: file.name, refDate: refDate };
    L2.innerHTML = '<div class="veil center"><div class="dlg" role="dialog" aria-modal="true" aria-label="Conferma importazione" data-stop="1"><h3 style="margin-top:0">Importa documento del ' + C.fmt(refDate) + '</h3>' +
      '<p class="muted">' + esc(file.name) + ' · ' + pv.totale + ' righe lette' + (agenti.length ? ' · agente ' + esc(agenti.join(', ')) : '') + '</p>' +
      warns.map(function (w) { return '<div class="banner warn"><div>' + esc(w) + '</div></div>'; }).join('') +
      '<table class="t"><tr><td>Righe negli ultimi tre mesi (dal ' + C.fmt(pv.cutoff) + ')</td><td class="n"><b>' + pv.inFinestra + '</b></td></tr>' +
      (last ? '<tr><td>Nuove</td><td class="n"><b>' + pv.nuove + '</b></td></tr><tr><td>Ancora aperte</td><td class="n"><b>' + pv.persistenti + '</b></td></tr><tr><td>Non più presenti</td><td class="n"><b>' + pv.gone + '</b></td></tr>' + (pv.tornate ? '<tr><td>Ricomparse</td><td class="n"><b>' + pv.tornate + '</b></td></tr>' : '') : '<tr><td colspan="2" class="muted">Primo documento: il confronto parte dal prossimo.</td></tr>') +
      '<tr><td>Più vecchie di tre mesi (non mostrate)</td><td class="n"><b>' + pv.escluse + '</b></td></tr></table>' +
      '<div class="acts"><button class="btn primary" data-act="doimport">Importa</button><button class="btn" data-act="closedlg">Annulla</button></div></div></div>';
  }
  function pruneOld() {
    var d = new Date(); d.setMonth(d.getMonth() - 6); var cut = C.todayISO(d), k, n = 0;
    for (k in ST.rows) { var r = ST.rows[k]; if (r.dataOC < cut) { markDirty(shardOf(r)); delete ST.rows[k]; n++; } }
    return n;
  }
  function doImport() {
    var p = pending; if (!p) return; pending = null;
    var last = ST.imports[0], same = !!(last && last.refDate === p.refDate);
    var out = C.applyImport(ST.rows, p.res.rows, { today: today(), refDate: p.refDate, impId: same ? last.id : 'i' + Date.now().toString(36), nowISO: new Date().toISOString(), file: p.file });
    ST.rows = out.rows;
    if (same) { // stessa data: aggiorno il caricamento di oggi senza perdere cosa risultava nuovo o sparito
      var rec = out.record, uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
      rec.nuove = uniq(last.nuove.concat(rec.nuove)).filter(function (i) { return ST.rows[i] && ST.rows[i].present; });
      rec.gone = uniq(last.gone.concat(rec.gone)).filter(function (i) { return ST.rows[i] && !ST.rows[i].present; });
      rec.tornate = uniq(last.tornate.concat(rec.tornate)).filter(function (i) { return ST.rows[i] && ST.rows[i].present; });
      rec.persistenti = Math.max(0, rec.inFinestra - rec.nuove.length - rec.tornate.length);
      ST.imports[0] = rec;
    } else ST.imports.unshift(out.record);
    ST.imports = ST.imports.slice(0, 30);
    // riallinea le copie locali dei documenti mensili con lo stato nuovo
    pruneOld(); markAll(); closeDlg();
    var r = ST.imports[0], first = ST.imports.length === 1;
    toast(first ? r.inFinestra + ' righe importate' : r.nuove.length + ' nuove · ' + r.gone.length + ' non più presenti · ' + r.persistenti + ' ancora aperte', 4500);
    if (first) setTab('dashboard'); else { UI.scope = r.nuove.length ? 'nuove' : 'aperte'; UI.q = ''; setTab('righe'); }
  }
  function showMsg(title, text) {
    L2.innerHTML = '<div class="veil center" data-act="closedlg"><div class="dlg" data-stop="1" role="alertdialog" aria-modal="true"><h3 style="margin-top:0">' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p><div class="acts"><button class="btn primary" data-act="closedlg">Ok</button></div></div></div>';
  }
  function ask(title, text, okLabel, onOk) {
    L2.innerHTML = '<div class="veil center" data-act="closedlg"><div class="dlg" data-stop="1" role="alertdialog" aria-modal="true"><h3 style="margin-top:0">' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p><div class="acts"><button class="btn danger" data-act="askok">' + esc(okLabel) + '</button><button class="btn" data-act="closedlg">Annulla</button></div></div></div>';
    ask.fn = onOk;
  }

  /* --------------------------------------------------------------- backup/logo */
  function backupJson() { return JSON.stringify({ v: 1, app: 'righe', salvato: new Date().toISOString(), settings: ST.settings, imports: ST.imports, rows: ST.rows, notes: ST.notes, prev: ST.prev, logo: ST.logo }); }
  async function exportBackup() {
    var name = 'righe-backup-' + today() + '.json';
    try {
      var file = new File([backupJson()], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Backup Righe' }); toast('Backup condiviso'); return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Backup scaricato');
    } catch (e) {
      if (e && (e.code === 'declined' || e.name === 'AbortError')) return;
      var ok = await copyText(backupJson()); toast(ok ? 'Download non disponibile: backup copiato negli appunti' : 'Backup non riuscito', 4000);
    }
  }
  function restoreBackup(text) {
    var o; try { o = JSON.parse(text); } catch (e) { showMsg('File non valido', 'Non è un backup di Righe.'); return; }
    if (!o || o.app !== 'righe' || !o.rows) { showMsg('File non valido', 'Non è un backup di Righe.'); return; }
    ask('Ripristinare il backup?', 'Sostituisce i dati attuali (' + Object.keys(ST.rows).length + ' righe) con quelli del backup (' + Object.keys(o.rows).length + ' righe).', 'Ripristina', function () {
      ST.settings = Object.assign(defSettings(), o.settings || {}); ST.imports = o.imports || []; ST.rows = o.rows; ST.notes = o.notes || {}; ST.prev = o.prev || {}; ST.logo = o.logo || '';
      markAll(); closeDlg(); toast('Backup ripristinato'); render();
    });
  }
  function openBrandPick(b, q) {
    var lib = window.BRAND_LIB || {}, ql = (q || '').toLowerCase(), keys = Object.keys(lib).filter(function (k) { return !ql || lib[k][0].toLowerCase().indexOf(ql) >= 0; }).sort(function (x, y) { return lib[x][0].localeCompare(lib[y][0]); });
    var grid = keys.map(function (k) { return '<button class="bp" data-act="bpset" data-b="' + esc(b) + '" data-k="' + esc(k) + '"><img src="' + esc(lib[k][1]) + '" alt=""><span>' + esc(lib[k][0]) + '</span></button>'; }).join('') || '<p class="muted">Nessun marchio con questo nome.</p>';
    var keep = $('#bpq', L2) ? $('#bpq', L2).value : q || '';
    L2.innerHTML = '<div class="veil center" data-act="closedlg"><div class="dlg" role="dialog" aria-modal="true" aria-label="Scegli il logo" data-stop="1"><div class="sh-head"><div><h3>Logo per ' + esc(b) + '</h3><div class="muted tiny">Scegli il marchio, oppure carica un’immagine tua</div></div><button class="x" data-act="closedlg" aria-label="Chiudi">×</button></div>' +
      '<input id="bpq" class="search" type="search" autocomplete="off" placeholder="Cerca marchio…" value="' + esc(keep) + '" data-b="' + esc(b) + '"><div class="bpgrid" id="bpgrid">' + grid + '</div>' +
      '<div class="acts"><label class="btn small" for="bpf">Carica un’immagine mia</label><input type="file" id="bpf" accept="image/*" hidden data-bimg="' + esc(b) + '">' + ((ST.settings.brandImg || {})[b] ? '<button class="btn small danger" data-act="bimgdel" data-b="' + esc(b) + '">Togli la mia immagine</button>' : '') + '</div></div></div>';
  }
  function loadBrandImg(b, file) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var n = 96, cv = document.createElement('canvas'); cv.width = n; cv.height = n; var x = cv.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); var sc = Math.min(n / img.width, n / img.height) * 0.92, w = img.width * sc, h = img.height * sc;
      x.drawImage(img, (n - w) / 2, (n - h) / 2, w, h); URL.revokeObjectURL(url);
      ST.settings.brandImg = ST.settings.brandImg || {}; ST.settings.brandImg[b] = cv.toDataURL('image/jpeg', 0.85); saveSettings(); closeDlg(); render(); toast('Immagine di ' + b + ' salvata');
    };
    img.onerror = function () { showMsg('Immagine non leggibile', 'Prova con un PNG o un JPG.'); };
    img.src = url;
  }
  function loadLogo(file) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var h = Math.min(160, img.height), w = Math.round(img.width * h / img.height), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      ST.logo = cv.toDataURL('image/png'); markDirty('logo'); drawMark(); render(); toast('Logo aggiornato');
    };
    img.onerror = function () { showMsg('Immagine non leggibile', 'Prova con un PNG o un JPG.'); };
    img.src = url;
  }

  /* ------------------------------------------------------------------ eventi */
  var noteTimer = null;
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.dataset.act;
    // un clic dentro la scheda non deve chiudere il velo
    if ((a === 'closesheet' || a === 'closedlg') && t.classList.contains('veil') && e.target !== t) return;
    if (a.indexOf('ai-') === 0) { AI.click(a, t); return; }
    if (a.indexOf('n-') === 0) { NT.click(a, t); return; }
    if (a.indexOf('pv-') === 0) { PV.click(a, t); return; }
    if (a === 'mailclick') { solPrepare(); return; }
    if (t.tagName === 'A' && a === 'goscope') e.preventDefault();
    var id = t.dataset.id, r = ST.rows[UI.sheetId];
    switch (a) {
      case 'tab': setTab(t.dataset.tab); break;
      case 'open': openSheet(id); break;
      case 'closesheet': closeSheet(); break;
      case 'closedlg': closeDlg(); break;
      case 'goscope': UI.scope = t.dataset.scope; UI.q = ''; setTab('righe'); break;
      case 'gocli': UI.scope = 'aperte'; UI.q = t.dataset.q; setTab('righe'); break;
      case 'scope': UI.scope = t.dataset.scope; UI.limit = 40; render(); break;
      case 'more': UI.limit += 40; fillList(); break;
      case 'solrow': quickSollecito([id]); break;
      case 'mgrbulk':
        L2.innerHTML = '<div class="veil center" data-act="closedlg"><div class="dlg" role="dialog" aria-modal="true" aria-label="Incolla indirizzi" data-stop="1"><div class="sh-head"><div><h3>Incolla gli indirizzi</h3><div class="muted tiny">Uno per riga. Abbino ogni indirizzo al responsabile dal nome (es. nome.cognome@…).</div></div><button class="x" data-act="closedlg" aria-label="Chiudi">×</button></div>' +
          '<div class="field"><textarea class="in" id="mgrbulktxt" rows="9" autocapitalize="off" spellcheck="false" placeholder="nome.cognome@azienda.it"></textarea></div><div class="acts"><button class="btn primary" data-act="mgrbulkapply">Applica</button></div></div></div>'; break;
      case 'mgrbulkapply':
        var found = String(($('#mgrbulktxt') || {}).value || '').toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) || [], nOk = 0, miss = [];
        found.forEach(function (em) {
          var loc = em.split('@')[0].replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
          var m = ST.settings.managers.filter(function (x) { var nm = x.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean); return nm.length && loc.length && nm.every(function (w) { return loc.indexOf(w) >= 0; }); })[0];
          if (m) { m.email = em; nOk++; } else miss.push(em);
        });
        if (nOk) saveSettings(); closeDlg(); render();
        toast(nOk + (nOk === 1 ? ' indirizzo inserito' : ' indirizzi inseriti') + (miss.length ? ' · ' + miss.length + ' non abbinati' : ''), 4200); break;
      case 'solcli': solMany(AI.lateRows(t.dataset.cli), 'Sollecita i pezzi in ritardo'); break;
      case 'solveh': solVeh(t.dataset.cli, t.dataset.veh); break;
      case 'solgrp': var gg = UI.solGroups[+t.dataset.i]; closeDlg(); if (gg) quickSollecito(gg.ids); break;
      case 'bpick': openBrandPick(t.dataset.b); break;
      case 'bpset': ST.settings.brandImg = ST.settings.brandImg || {}; ST.settings.brandImg[t.dataset.b] = ST.settings.brandImg[t.dataset.b]; delete ST.settings.brandImg[t.dataset.b]; ST.settings.brandCode = ST.settings.brandCode || {}; ST.settings.brandCode[t.dataset.b] = t.dataset.k; saveSettings(); closeDlg(); render(); toast('Logo impostato'); break;
      case 'bimgdel': if (ST.settings.brandImg) delete ST.settings.brandImg[t.dataset.b]; if (ST.settings.brandCode) delete ST.settings.brandCode[t.dataset.b]; saveSettings(); closeDlg(); render(); break;
      case 'pri': updateRow(UI.sheetId, { priorita: t.dataset.v }); renderSheet(true); break;
      case 'togli': updateRow(UI.sheetId, { nascosta: true, motivo: t.dataset.m, tolta: today() }); closeSheet(); toast((t.dataset.m === 'consegnato' ? 'Segnata come consegnata' : 'Segnata come annullata') + ': la ritrovi in «Tolte»'); break;
      case 'rimetti': updateRow(UI.sheetId, { nascosta: false, motivo: '', tolta: '' }); closeSheet(); toast('Rimessa nella lista'); break;
      case 'archivia': updateRow(UI.sheetId, { archiviata: true }); closeSheet(); toast('Archiviata'); break;
      case 'sollecita': quickSollecito([UI.sheetId]); break;
      case 'solcopy': solPrepare(); copyText(UI.sol.body).then(function (ok) { toast(ok ? 'Testo copiato' : 'Copia non riuscita: selezionalo a mano'); }); break;
      case 'solcopyto': copyText(UI.sol.to).then(function (ok) { toast(ok ? 'Indirizzo copiato' : 'Copia non riuscita'); }); break;
      case 'solsent': solMarkSent(); break;
      case 'entsent':
        if (r) { var list = (r.solleciti || []).map(function (x) { return x.id === t.dataset.e ? Object.assign({}, x, x.inviato ? { inviato: false, tInv: '' } : { inviato: true, tInv: new Date().toISOString() }) : x; });
          var sentDates = list.filter(function (x) { return x.inviato; }).map(function (x) { return localDate(x.tInv); });
          updateRow(UI.sheetId, { solleciti: list, ultimoSollecito: sentDates.length ? sentDates[sentDates.length - 1] : '' }); renderSheet(true); }
        break;
      case 'doimport': doImport(); break;
      case 'askok': var f = ask.fn; ask.fn = null; if (f) f(); break;
      case 'mgradd': ST.settings.managers.push({ id: 'm_' + uid(), nome: 'Nuovo responsabile', email: '' }); saveSettings(); render(); break;
      case 'mgrdel': ask('Eliminare il responsabile?', 'I marchi assegnati a lui resteranno senza responsabile.', 'Elimina', function () {
        ST.settings.managers = ST.settings.managers.filter(function (m) { return m.id !== id; });
        Object.keys(ST.settings.brandMap).forEach(function (b) { if (ST.settings.brandMap[b] === id) delete ST.settings.brandMap[b]; });
        saveSettings(); closeDlg(); render(); }); break;
      case 'logodel': ST.logo = ''; markDirty('logo'); render(); break;
      case 'syncon': syncOn(); break;
      case 'syncoff': syncOff(); break;
      case 'syncnow': syncNow(); break;
      case 'bkexp': exportBackup(); break;
      case 'bkcopy': copyText(backupJson()).then(function (ok) { toast(ok ? 'Backup copiato negli appunti' : 'Copia non riuscita'); }); break;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.n) { NT.change(t); return; }
    if (t.dataset && t.dataset.ai) { AI.change(t); return; }
    if (t.dataset && t.dataset.pv) { PV.change(t); return; }
    if (t.id === 'pdfIn') { var f = t.files[0]; t.value = ''; if (f) importFile(f); return; }
    if (t.dataset.bimg) { var bf = t.files[0]; var bn = t.dataset.bimg; t.value = ''; if (bf) loadBrandImg(bn, bf); return; }
    if (t.id === 'logoIn') { var g = t.files[0]; t.value = ''; if (g) loadLogo(g); return; }
    if (t.id === 'bkIn') { var h = t.files[0]; t.value = ''; if (h) h.text().then(restoreBackup); return; }
    if (t.id === 'sort') { UI.sort = t.value; fillList(); return; }
    var k = t.dataset.in, s = t.dataset.sol;
    if (k === 'stato' || k === 'eta' || k === 'etaConf') { var p = {}; p[k] = t.value; if (k === 'stato' && t.value === 'arrivo_confermato' && !(ST.rows[UI.sheetId] || {}).etaConf) p.etaConf = today(); updateRow(UI.sheetId, p); renderSheet(true); }
    else if (k === 'leadmin' || k === 'leadmax') { var lb = t.dataset.b, cur = (ST.settings.lead[lb] || [0, 0, 0]).slice(), v = parseInt(t.value, 10) || 0; cur[k === 'leadmin' ? 0 : 1] = v; if (cur[0] > cur[1] && cur[1]) cur[0] = cur[1]; if (!cur[0] && !cur[1]) delete ST.settings.lead[lb]; else { if (!cur[1]) cur[1] = cur[0]; ST.settings.lead[lb] = cur; } saveSettings(); }
    else if (k === 'brand') { if (t.value) ST.settings.brandMap[t.dataset.b] = t.value; else delete ST.settings.brandMap[t.dataset.b]; saveSettings(); }
    else if (s === 'mgr') { var m = ST.settings.managers.filter(function (x) { return x.id === t.value; })[0]; UI.sol.mgrId = t.value; if (m && m.email) UI.sol.to = m.email; UI.sol.remember = !!m; solRecompute(); renderSol(); }
    else if (s === 'extra') { if (t.checked) UI.sol.extra[t.dataset.id] = 1; else delete UI.sol.extra[t.dataset.id]; solRecompute(); renderSol(); var d = $('details', L2); if (d) d.open = true; }
    else if (s === 'remember') { UI.sol.remember = t.checked; }
  });
  document.addEventListener('input', function (e) {
    var t = e.target, k = t.dataset.in, s = t.dataset.sol;
    if (t.dataset.n) { NT.input(t); return; }
    if (t.dataset.ai) { AI.input(t); return; }
    if (t.dataset.pv) { PV.input(t); return; }
    if (t.id === 'bpq') { var g2 = $('#bpgrid', L2), lib2 = window.BRAND_LIB || {}, ql2 = t.value.toLowerCase(), b2 = t.dataset.b; g2.innerHTML = Object.keys(lib2).filter(function (k) { return !ql2 || lib2[k][0].toLowerCase().indexOf(ql2) >= 0; }).sort(function (x, y) { return lib2[x][0].localeCompare(lib2[y][0]); }).map(function (k) { return '<button class="bp" data-act="bpset" data-b="' + esc(b2) + '" data-k="' + esc(k) + '"><img src="' + esc(lib2[k][1]) + '" alt=""><span>' + esc(lib2[k][0]) + '</span></button>'; }).join('') || '<p class="muted">Nessun marchio con questo nome.</p>'; return; }
    if (t.id === 'q') { UI.q = t.value; UI.limit = 40; fillList(); return; }
    if (k === 'note') { clearTimeout(noteTimer); var v = t.value, id = UI.sheetId; noteTimer = setTimeout(function () { updateRow(id, { note: v }, true); }, 450); return; }
    if (k === 'mgrNome' || k === 'mgrEmail') { var m = ST.settings.managers.filter(function (x) { return x.id === t.dataset.id; })[0]; if (m) { m[k === 'mgrNome' ? 'nome' : 'email'] = t.value; clearTimeout(noteTimer); noteTimer = setTimeout(saveSettings, 600); } return; }
    if (k === 'intro' || k === 'firma') { ST.settings[k] = t.value; clearTimeout(noteTimer); noteTimer = setTimeout(saveSettings, 600); return; }
    if (s === 'to' || s === 'subject' || s === 'body') { UI.sol[s] = t.value; var a = $('#mailA'); if (a) a.href = solHref(); return; }
  });
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.matches && d.matches('details.cli') && d.open) UI.cli = d.dataset.cli; }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (L2.innerHTML) closeDlg(); else if (L1.innerHTML) closeSheet(); }
  });
  window.addEventListener('hashchange', function () {
    var h = location.hash.slice(1); if (TABS.some(function (t) { return t[0] === h; }) && h !== UI.tab) setTab(h, true);
  });

  /* ------------------------------------------------------------------- avvio */
  function boot() {
    $('#layer').innerHTML = '<div id="L1"></div><div id="L2"></div>'; L1 = $('#L1'); L2 = $('#L2');
    var h = location.hash.slice(1); if (TABS.some(function (t) { return t[0] === h; })) UI.tab = h;
    drawMark(); setStatus('loading'); render(); initStore();
  }
  AI.init({ ST: ST, C: C, esc: esc, toast: toast, today: today, render: render, updateRow: updateRow, setTab: setTab, L2: function () { return L2; } });
  PV.init({ ST: ST, C: C, esc: esc, toast: toast, today: today, markDirty: markDirty, render: render, L2: function () { return L2; } });
  NT.init({ ST: ST, UI: UI, Store: Store, C: C, esc: esc, toast: toast, uid: uid, today: today, markDirty: markDirty, render: render, L2: function () { return L2; } });
  window.__righe = { ST: ST, UI: UI, Store: Store, importFile: importFile };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
