/* Foto delle macchine dei clienti.
   1) Claude (con la chiave dell'utente) capisce dal testo del PDF di che macchina si tratta
      (es. «LAND CRUIS» -> Toyota Land Cruiser) e indica la pagina di Wikipedia del modello.
   2) L'app prende la foto principale di quella pagina da Wikipedia.
   Alla richiesta viaggiano solo il nome del modello e i marchi dei pezzi: mai targhe, clienti o ordini. */
(function () {
  'use strict';
  var CARS = window.RigheCars = {}, H = null, LS = 'righeCars', ON = 'righeCarsOn';
  var store = {}, pend = {}, running = false, timer = null, lastErr = '', NONE_AGE = 7 * 864e5;

  try { store = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { store = {}; }
  function save() { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) { /* piena: pazienza */ } }
  function on() { try { return localStorage.getItem(ON) !== '0'; } catch (e) { return true; } }
  function idOf(model) { return String(model || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function esc(s) { return H ? H.esc(s) : String(s); }
  function hasKey() { return !!(window.RigheAI && window.RigheAI.hasKey()); }
  function done(e) { return !!(e && (e.img || (e.none && Date.now() - e.t < NONE_AGE))); }

  function cardHtml(id, e) {
    return '<div class="vcar" data-car="' + id + '"><img src="' + esc(e.img) + '" alt="' + esc(e.name) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
      '<span class="vcap">' + esc(e.name) + '</span><a class="vcr" href="' + esc(e.page) + '" target="_blank" rel="noopener">Foto: Wikipedia</a></div>';
  }
  // segnaposto (o foto già pronta) da mettere in cima a ogni macchina
  CARS.slot = function (model, hints) {
    if (!on() || !hasKey()) return '';
    var id = idOf(model); if (id.length < 2) return '';
    var e = store[id];
    if (e && e.img) return cardHtml(id, e);
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
      store[id] = a.e_auto && (a.wikipedia || name) ? { ident: true, name: name || a.wikipedia, wiki: a.wikipedia || '', t: Date.now() } : { none: true, t: Date.now() };
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

  function fill(id) {
    var e = store[id], els = document.querySelectorAll('.vcar[data-car="' + id + '"]');
    Array.prototype.forEach.call(els, function (el) {
      if (e && e.img) { var t = document.createElement('div'); t.innerHTML = cardHtml(id, e); el.replaceWith(t.firstChild); } else el.remove();
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
            store[id] = r ? { img: r.img, page: r.page, name: e.name, t: Date.now() } : { none: true, t: Date.now() };
            save();
          } catch (err) { lastErr = 'Wikipedia non raggiungibile'; continue; }
        }
        fill(id); delete pend[id];
      }
    } catch (err) {
      lastErr = /401|403|invalid|key|chiave/i.test(String(err && err.message)) ? 'chiave non valida' : 'ricerca non riuscita';
      Array.prototype.forEach.call(document.querySelectorAll('.vcar.load'), function (el) { el.remove(); });
      pend = {};
    }
    running = false;
  }
  // chiamata dopo ogni disegno della pagina e quando si apre un cliente
  CARS.scan = function () {
    if (!on() || !hasKey()) return;
    var els = document.querySelectorAll('details.cli[open] .vcar.load'), n = 0;
    Array.prototype.forEach.call(els, function (el) { var id = el.dataset.car; if (id && !pend[id]) { pend[id] = { raw: el.dataset.m, hints: el.dataset.h }; n++; } });
    if (!n && !Object.keys(pend).length) return;
    clearTimeout(timer); timer = setTimeout(run, 250);
  };

  CARS.cardHtml = function () {
    var n = Object.keys(store).filter(function (k) { return store[k].img; }).length;
    return '<div class="card pad" style="margin-top:14px"><b>Foto delle macchine</b>' +
      '<p class="muted tiny">Sopra ogni macchina compare la foto del modello. Claude capisce dal testo del PDF di che macchina si tratta (serve la chiave API) e la foto viene da Wikipedia. Escono dall’app solo il nome del modello e i marchi dei pezzi, mai targhe, clienti o ordini.</p>' +
      '<p class="tiny" style="margin:0 0 8px">Foto trovate finora: <b>' + n + '</b>' + (lastErr ? ' · <span class="redt">' + esc(lastErr) + '</span>' : '') + (hasKey() ? '' : ' · <span class="redt">manca la chiave API</span>') + '</p>' +
      '<div class="acts" style="margin-top:0"><button class="btn small" data-act="car-tog">' + (on() ? 'Foto attive: spegni' : 'Foto spente: accendi') + '</button><button class="btn small" data-act="car-redo">Cerca di nuovo</button></div></div>';
  };
  CARS.click = function (a) {
    if (a === 'car-tog') { try { localStorage.setItem(ON, on() ? '0' : '1'); } catch (e) { /* ignore */ } H.render(); setTimeout(CARS.scan, 50); }
    else if (a === 'car-redo') { store = {}; pend = {}; save(); H.render(); H.toast('Cerco di nuovo le foto'); setTimeout(CARS.scan, 50); }
  };
  CARS.init = function (host) { H = host; document.addEventListener('toggle', function (ev) { var t = ev.target; if (t && t.matches && t.matches('details.cli') && t.open) CARS.scan(); }, true); };
})();
