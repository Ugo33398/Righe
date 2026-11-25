/* Foto delle macchine dei clienti.
   1) Claude (con la chiave dell'utente) capisce dal testo del PDF di che macchina si tratta
      (es. «LAND CRUIS» -> Toyota Land Cruiser) e indica la pagina di Wikipedia del modello.
   2) L'app prende la foto principale di quella pagina da Wikipedia.
   Alla richiesta viaggiano solo il nome del modello e i marchi dei pezzi: mai targhe, clienti o ordini. */
(function () {
  'use strict';
  var CARS = window.RigheCars = {}, H = null, LS = 'righeCars', ON = 'righeCarsOn';
  var store = {}, pend = {}, running = false, timer = null, lastErr = '', NONE_AGE = 7 * 864e5;
  var cut = {}, cutQ = [], cutBusy = false, cutMsg = '', cutLoading = {}, LIB = null;
  var BG_DATA = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.4.5/dist/'; // modello (circa 45 MB, scaricato una volta)
  function media() { return H && H.media ? H.media() : null; }

  try { store = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { store = {}; }
  function save() { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) { /* piena: pazienza */ } }
  function on() { try { return localStorage.getItem(ON) !== '0'; } catch (e) { return true; } }
  function idOf(model) { return String(model || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function esc(s) { return H ? H.esc(s) : String(s); }
  function hasKey() { return !!(window.RigheAI && window.RigheAI.hasKey()); }
  function done(e) { return !!(e && (e.img || (e.none && Date.now() - e.t < NONE_AGE))); }

  function cardHtml(id, e) {
    return '<div class="vcar' + (cut[id] ? ' cut' : '') + '" data-car="' + id + '" data-act="car-big" title="Tocca per ingrandire"><img src="' + esc(cut[id] || e.img) + '" alt="' + esc(e.name) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
      '<span class="vcap">' + esc(e.name) + '</span><a class="vcr" href="' + esc(e.page) + '" target="_blank" rel="noopener">Foto: Wikipedia</a></div>';
  }
  // segnaposto (o foto già pronta) da mettere in cima a ogni macchina
  CARS.slot = function (model, hints) {
    if (!on()) return '';
    var id = idOf(model); if (id.length < 2) return '';
    if (!hasKey()) return '<div class="vnote">Per vedere la foto della macchina serve la chiave API: inseriscila in Impostazioni (rotellina).</div>';
    var e = store[id];
    if (e && e.img) { if (e.cut && !cut[id]) loadCut(id); return cardHtml(id, e); }
    if (done(e)) return '';
    return '<div class="vcar load" data-car="' + id + '" data-m="' + esc(model) + '" data-h="' + esc(hints || '') + '"></div>';
  };

  var TOOL = {
    name: 'identifica_auto',
    description: 'Per ogni voce dell\'elenco, di che automobile si tratta.',
    input_schema: { type: 'object', properties: { auto: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', description: 'L\'id esatto della voce.' },
      e_auto: { type: 'boolean', description: 'true solo se il testo indica con ragionevole certezza un\'automobile o un furgone.' },
      marca: { type: 'string' }, modello: { type: 'string' },
      wikipedia: { type: 'string', description: 'Titolo ESATTO della pagina di Wikipedia in inglese del modello (non della marca), es. "Volvo XC40".' }
    }, required: ['id', 'e_auto'] } } }, required: ['auto'] }
  };
  async function identify(ids) {
    var list = ids.map(function (id) { return id + ' | ' + pend[id].raw + ' | pezzi ordinati dei marchi: ' + (pend[id].hints || '—'); }).join('\n');
    var data = await window.RigheAI.ask({
      model: window.RigheAI.model, max_tokens: 3500,
      system: 'Sei un esperto di automobili. Ricevi brevi testi scritti da un rappresentante di ricambi per indicare il veicolo di un cliente (carrozzerie italiane): possono essere abbreviati (es. "LAND CRUIS"), con errori o contenere altro. Per ogni voce dimmi se è un\'automobile o un furgone identificabile e quale: marca, modello e il titolo esatto della pagina di Wikipedia in inglese di quel modello. I marchi dei pezzi sono solo un indizio e a volte sono codici interni del magazzino (es. FCA = gruppo Fiat/Jeep/Alfa). Se il testo è un nome di persona, un codice, o non si capisce: e_auto=false. Non inventare.',
      tools: [TOOL], tool_choice: { type: 'tool', name: 'identifica_auto' },
      messages: [{ role: 'user', content: 'Elenco (id | testo | indizi):\n' + list }]
    });
    var tu = (data.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
    if (!tu) throw new Error('risposta non leggibile');
    var by = {}; ((tu.input || {}).auto || []).forEach(function (a) { if (a && a.id) by[a.id] = a; });
    ids.forEach(function (id) {
      var a = by[id];
      if (!a) return; // la riproverò più tardi
      var name = ((a.marca || '') + ' ' + (a.modello || '')).trim();
      store[id] = a.e_auto && (a.wikipedia || name) ? { ident: true, name: name || a.wikipedia, wiki: a.wikipedia || '', raw: pend[id].raw, t: Date.now() } : { none: true, raw: pend[id].raw, why: 'Claude: non è una macchina riconoscibile', t: Date.now() };
    });
    save();
  }

  async function wapi(p) {
    var u = 'https://en.wikipedia.org/w/api.php?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&') + '&format=json&origin=*';
    var r = await fetch(u); if (!r.ok) throw new Error('Wikipedia ' + r.status); return r.json();
  }
  async function pageImg(title) {
    var d = await wapi({ action: 'query', titles: title, redirects: 1, prop: 'pageimages|info|pageprops', piprop: 'thumbnail', pithumbsize: 900, inprop: 'url', ppprop: 'disambiguation' });
    var pg = d && d.query && d.query.pages ? Object.keys(d.query.pages).map(function (k) { return d.query.pages[k]; })[0] : null;
    if (!pg || pg.missing !== undefined || !pg.thumbnail) return null;
    if (pg.pageprops && pg.pageprops.disambiguation !== undefined) return null;
    var src = pg.thumbnail.source || '';
    if (/\.svg(\.png)?$/i.test(src) || /logo|badge|emblem/i.test(src)) return null; // niente loghi
    return { img: src, page: pg.fullurl || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(pg.title)), title: pg.title };
  }
  async function findImg(e) {
    var r = e.wiki ? await pageImg(e.wiki) : null; if (r) return r;
    var model = (e.name.split(' ').slice(1).join(' ') || e.name).toLowerCase().split(' ')[0];
    var s = await wapi({ action: 'query', list: 'search', srsearch: e.name + ' car', srlimit: 3, srnamespace: 0 });
    var hits = (s && s.query && s.query.search) || [];
    for (var i = 0; i < hits.length; i++) {
      if (model.length > 1 && hits[i].title.toLowerCase().indexOf(model) < 0) continue; // il titolo deve citare il modello
      r = await pageImg(hits[i].title); if (r) return r;
    }
    return null;
  }

  // ---- ritaglio dello sfondo (tutto sul dispositivo) ----
  function loadCut(id) {
    if (cut[id] || cutLoading[id] || !media()) return; cutLoading[id] = 1;
    media().get('car_' + id).then(function (m) {
      if (m && m.buf) { cut[id] = URL.createObjectURL(new Blob([m.buf], { type: 'image/png' })); fill(id); }
      else if (store[id]) { store[id].cut = false; save(); }
    }).catch(function () { /* resta la foto intera */ }).then(function () { delete cutLoading[id]; });
  }
  function bmp(blob) { return createImageBitmap ? createImageBitmap(blob) : Promise.reject(new Error('createImageBitmap mancante')); }
  // riempie ciò che è chiuso dentro la sagoma (finestrini, cerchioni), toglie i bordi vuoti, riduce
  async function finish(srcBlob, cutBlob) {
    var a = await bmp(cutBlob), o = await bmp(srcBlob), sc = Math.min(1, 760 / a.width), w = Math.round(a.width * sc), h = Math.round(a.height * sc);
    var c1 = document.createElement('canvas'), c2 = document.createElement('canvas'); c1.width = c2.width = w; c1.height = c2.height = h;
    var x1 = c1.getContext('2d'), x2 = c2.getContext('2d'); x1.drawImage(a, 0, 0, w, h); x2.drawImage(o, 0, 0, w, h);
    var d = x1.getImageData(0, 0, w, h), od = x2.getImageData(0, 0, w, h).data, p = d.data, n = w * h, seen = new Uint8Array(n), st = [], i, x, y;
    function push(k) { if (!seen[k] && p[k * 4 + 3] < 128) { seen[k] = 1; st.push(k); } }
    for (x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (st.length) { i = st.pop(); x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
    var x0 = w, x1b = 0, y0 = h, y1 = 0;
    for (i = 0; i < n; i++) {
      if (!seen[i] && p[i * 4 + 3] < 255) { p[i * 4] = od[i * 4]; p[i * 4 + 1] = od[i * 4 + 1]; p[i * 4 + 2] = od[i * 4 + 2]; p[i * 4 + 3] = 255; }
      if (p[i * 4 + 3] > 24) { x = i % w; y = (i - x) / w; if (x < x0) x0 = x; if (x > x1b) x1b = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1b <= x0 || y1 <= y0) throw new Error('nessuna sagoma trovata');
    x1.putImageData(d, 0, 0);
    var pad = Math.round(Math.max(x1b - x0, y1 - y0) * 0.03), sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad), sw = Math.min(w, x1b + pad) - sx, sh = Math.min(h, y1 + pad) - sy;
    var c3 = document.createElement('canvas'); c3.width = sw; c3.height = sh; c3.getContext('2d').drawImage(c1, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise(function (res, rej) { c3.toBlob(function (b) { b ? res(b) : rej(new Error('PNG non creato')); }, 'image/png'); });
  }
  function paintMsg() { var el = document.getElementById('carCut'); if (el) el.textContent = cutMsg; }
  async function processCut() {
    if (cutBusy) return; cutBusy = true;
    while (cutQ.length) {
      var id = cutQ.shift(), e = store[id];
      if (!e || !e.img || e.cut || !media()) continue;
      try {
        cutMsg = 'Ritaglio dello sfondo… ' + (cutQ.length ? '(altre ' + cutQ.length + ' in coda)' : '') + ' La prima volta scarica circa 45 MB.'; paintMsg();
        LIB = LIB || await import(new URL('vendor/bgremove.js?v=1', document.baseURI).href);
        var src = await (await fetch(e.img)).blob();
        var out = await LIB.default(src, { publicPath: BG_DATA, model: 'small', output: { format: 'image/png' } });
        var png = await finish(src, out);
        await media().put('car_' + id, 'image/png', await png.arrayBuffer());
        cut[id] = URL.createObjectURL(png); e.cut = true; delete e.cutFail; save(); fill(id); cutMsg = '';
      } catch (err) { e.cutFail = Date.now(); save(); cutMsg = 'Ritaglio non riuscito: ' + String((err && err.message) || err).slice(0, 120); }
      paintMsg();
    }
    cutBusy = false; if (!cutMsg) paintMsg();
  }
  function queueCut(id) { var e = store[id]; if (!e || !e.img || e.cut || cutQ.indexOf(id) >= 0 || (e.cutFail && Date.now() - e.cutFail < 36e5)) return; cutQ.push(id); setTimeout(processCut, 300); }

  function fill(id) {
    var e = store[id], els = document.querySelectorAll('.vcar[data-car="' + id + '"]');
    Array.prototype.forEach.call(els, function (el) {
      if (e && e.img) { var t = document.createElement('div'); t.innerHTML = cardHtml(id, e); el.replaceWith(t.firstChild); } else el.remove();
    });
  }
  function showErr(msg, id) {
    var sel = id ? '.vcar.load[data-car="' + id + '"]' : '.vcar.load';
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
      var d = document.createElement('div'); d.className = 'vnote'; d.innerHTML = 'Foto non disponibile: ' + esc(msg) + ' <button class="btn small" data-act="car-redo">Riprova</button>'; el.replaceWith(d);
    });
  }
  async function run() {
    if (running) return; running = true; lastErr = '';
    try {
      var ids = Object.keys(pend), need = ids.filter(function (id) { return !(store[id] && (store[id].ident || done(store[id]))); });
      for (var i = 0; i < need.length; i += 40) await identify(need.slice(i, i + 40));
      for (var j = 0; j < ids.length; j++) {
        var id = ids[j], e = store[id];
        if (!e) continue;
        if (e.ident && !e.img) {
          try {
            var r = await findImg(e);
            store[id] = r ? { img: r.img, page: r.page, name: e.name, raw: e.raw, t: Date.now() } : { none: true, raw: e.raw, why: 'Wikipedia: nessuna foto per «' + (e.wiki || e.name) + '»', t: Date.now() };
            save(); if (store[id].img) queueCut(id);
          } catch (err) { lastErr = 'Wikipedia non raggiungibile (' + String((err && err.message) || err) + ')'; showErr(lastErr, id); delete pend[id]; continue; }
        }
        fill(id); delete pend[id];
      }
    } catch (err) {
      lastErr = String((err && err.message) || 'ricerca non riuscita');
      showErr(lastErr); pend = {};
    }
    running = false;
  }
  // chiamata dopo ogni disegno della pagina e quando si apre un cliente
  CARS.scan = function () {
    if (!on() || !hasKey()) return;
    Array.prototype.forEach.call(document.querySelectorAll('details.cli[open] .vcar:not(.load):not(.cut)'), function (el) { queueCut(el.dataset.car); });
    var els = document.querySelectorAll('details.cli[open] .vcar.load'), n = 0;
    Array.prototype.forEach.call(els, function (el) { var id = el.dataset.car; if (id && !pend[id]) { pend[id] = { raw: el.dataset.m, hints: el.dataset.h }; n++; } });
    if (!n && !Object.keys(pend).length) return;
    clearTimeout(timer); timer = setTimeout(run, 250);
  };

  function recent() {
    var ks = Object.keys(store).filter(function (k) { return store[k].raw; }).sort(function (a, b) { return store[b].t - store[a].t; }).slice(0, 8);
    if (!ks.length) return '';
    return '<div class="tiny" style="margin:0 0 8px">' + ks.map(function (k) { var e = store[k]; return esc(e.raw) + ' → ' + (e.img ? '<b>' + esc(e.name) + ' ✓</b>' : '<span class="redt">' + esc(e.why || 'in corso') + '</span>'); }).join('<br>') + '</div>';
  }
  CARS.cardHtml = function () {
    var n = Object.keys(store).filter(function (k) { return store[k].img; }).length;
    return '<div class="card pad" style="margin-top:14px"><b>Foto delle macchine</b>' +
      '<p class="muted tiny">Sopra ogni macchina compare la foto del modello. Claude capisce dal testo del PDF di che macchina si tratta (serve la chiave API), la foto viene da Wikipedia e lo sfondo viene tolto sul dispositivo (la prima volta scarica circa 45 MB). Escono dall’app solo il nome del modello e i marchi dei pezzi, mai targhe, clienti o ordini.</p>' +
      '<p class="tiny" id="carCut" style="margin:0 0 6px">' + esc(cutMsg) + '</p><p class="tiny" style="margin:0 0 8px">Foto trovate finora: <b>' + n + '</b>' + (lastErr ? ' · <span class="redt">' + esc(lastErr) + '</span>' : '') + (hasKey() ? '' : ' · <span class="redt">manca la chiave API</span>') + '</p>' +
      recent() + '<div class="acts" style="margin-top:0"><button class="btn small" data-act="car-tog">' + (on() ? 'Foto attive: spegni' : 'Foto spente: accendi') + '</button><button class="btn small" data-act="car-redo">Cerca di nuovo</button><button class="btn small" data-act="car-diag">Prova ora</button></div><pre id="carDiag" class="tiny" style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0"></pre></div>';
  };
  async function diagnose() {
    var out = [], box = document.getElementById('carDiag'); if (!box) return;
    function show() { box.textContent = out.join('\n'); }
    out.push('Chiave API: ' + (hasKey() ? 'presente' : 'MANCA')); show();
    if (hasKey()) {
      try {
        var d = await window.RigheAI.ask({ model: window.RigheAI.model, max_tokens: 20, messages: [{ role: 'user', content: 'Rispondi solo: ok' }] });
        out.push('Claude: risponde (' + String((d.content && d.content[0] && d.content[0].text) || '').slice(0, 20) + ')');
      } catch (e) { out.push('Claude: ERRORE — ' + e.message); }
      show();
    }
    try { var r = await pageImg('Volvo XC40'); out.push(r ? 'Wikipedia: ok, foto trovata (' + r.img.slice(0, 60) + '…)' : 'Wikipedia: risponde ma senza foto per «Volvo XC40»'); }
    catch (e) { out.push('Wikipedia: ERRORE — ' + e.message); }
    show();
    if (hasKey()) {
      try {
        pend.__t = { raw: 'XC40', hints: 'VOL (volvo)' }; await identify(['__t']); var e = store.__t; delete pend.__t; delete store.__t;
        if (!e) out.push('Giro completo: Claude non ha risposto sulla voce di prova');
        else if (e.none) out.push('Giro completo: Claude dice «non è una macchina» per XC40 (strano)');
        else { out.push('Giro completo: Claude → «' + e.name + '» (pagina «' + e.wiki + '»)'); var rr = await findImg(e); out.push(rr ? 'Giro completo: foto trovata ✓' : 'Giro completo: nessuna foto trovata ✗'); }
      } catch (er) { delete pend.__t; delete store.__t; out.push('Giro completo: ERRORE — ' + er.message); }
      show();
    }
    out.push('Foto attive: ' + (on() ? 'sì' : 'NO')); out.push('Macchine in memoria: ' + Object.keys(store).length); show();
  }
  CARS.click = function (a, el) {
    if (a === 'car-big') { if (el && el.classList) el.classList.toggle('big'); return; }
    if (a === 'car-diag') { var b = document.getElementById('carDiag'); if (b) b.textContent = 'Provo…'; diagnose(); return; }
    if (a === 'car-tog') { try { localStorage.setItem(ON, on() ? '0' : '1'); } catch (e) { /* ignore */ } H.render(); setTimeout(CARS.scan, 50); }
    else if (a === 'car-redo') { Object.keys(cut).forEach(function (k) { try { URL.revokeObjectURL(cut[k]); } catch (e) { /* ok */ } if (media()) media().del('car_' + k).catch(function () {}); }); cut = {}; cutQ = []; store = {}; pend = {}; save(); H.render(); H.toast('Cerco di nuovo le foto'); setTimeout(CARS.scan, 50); }
  };
  CARS.init = function (host) { H = host; document.addEventListener('toggle', function (ev) { var t = ev.target; if (t && t.matches && t.matches('details.cli') && t.open) CARS.scan(); }, true); };
})();
