/* Righe — impara i tempi di consegna reali dai PDF di ogni giorno (anche quelli vecchi). */
(function () {
  'use strict';
  var CAL = window.RigheCal = {}, H = null, busy = false, msg = '';
  var MIN_N = 5;

  function esc(s) { return H.esc(s); }
  function obs() { var o = H.ST.obs || (H.ST.obs = {}); if (!o.items) o.items = {}; if (!o.dates) o.dates = []; return o; }
  function plus1(iso) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 1); return H.C.todayISO(d); }

  // giorni lavorativi tra due date (a esclusa, b inclusa)
  function wd(a, b) {
    var n = 0, d = a, guard = 0;
    while (d < b && guard++ < 400) { d = plus1(d); if (H.C.isWork(d)) n++; }
    return n;
  }
  function pct(arr, p) { var s = arr.slice().sort(function (x, y) { return x - y; }), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }

  // Kaplan-Meier: tiene conto anche delle righe ancora aperte, senza contarle come finite oggi
  function km(a, p) {
    var times = a.filter(function (x) { return x[1]; }).map(function (x) { return x[0]; }).sort(function (x, y) { return x - y; }), seen = {}, S = 1, i;
    for (i = 0; i < times.length; i++) {
      var t = times[i]; if (seen[t]) continue; seen[t] = 1;
      var atRisk = a.filter(function (x) { return x[0] >= t; }).length, d = times.filter(function (x) { return x === t; }).length;
      S *= 1 - d / atRisk;
      if (1 - S >= p) return t;
    }
    return null;
  }

  /* ---- registrazione di ciò che si vede in ogni PDF ---- */
  CAL.ingest = function (rows, refDate) {
    if (!refDate) return 0;
    var o = obs(), n = 0;
    if (o.dates.indexOf(refDate) < 0) { o.dates.push(refDate); o.dates.sort(); }
    rows.forEach(function (r) {
      if (!r.id || !r.dataOC) return;
      var it = o.items[r.id];
      if (!it) { o.items[r.id] = [r.dataOC, r.marchio, refDate, refDate]; n++; }
      else { if (refDate < it[2]) it[2] = refDate; if (refDate > it[3]) it[3] = refDate; }
    });
    // tengo solo ciò che serve: ordini degli ultimi 14 mesi
    var cut = H.C.cutoffISO(H.today()), old = new Date(cut + 'T12:00:00'); old.setMonth(old.getMonth() - 11); var lim = H.C.todayISO(old), k;
    for (k in o.items) if (o.items[k][0] < lim) delete o.items[k];
    CAL.invalidate(); H.markDirty('obs');
    return n;
  };
  // al primo uso parte da ciò che l'app già sa
  CAL.seed = function () {
    var o = obs(); if (o.seeded) return; o.seeded = true;
    var ds = (H.ST.imports || []).map(function (i) { return i.refDate; }).filter(Boolean).sort(), last = ds[ds.length - 1];
    ds.forEach(function (d) { if (o.dates.indexOf(d) < 0) o.dates.push(d); }); o.dates.sort();
    Object.keys(H.ST.rows).forEach(function (k) {
      var r = H.ST.rows[k]; if (o.items[k] || !r.dataOC) return;
      var first = r.firstSeen || ds[0] || r.dataOC, lastSeen = last;
      if (!r.present) { var prev = ds.filter(function (d) { return r.goneAt && d < r.goneAt; }); lastSeen = prev.length ? prev[prev.length - 1] : (r.goneAt || last); }
      if (lastSeen) o.items[k] = [r.dataOC, r.marchio, first, lastSeen];
    });
    CAL.invalidate(); H.markDirty('obs');
  };

  /* ---- statistiche per marchio ---- */
  // codice articolo (Referenza) ricavato dall'id riga: «ordine_referenza_n»
  function codeOf(id) { var p = String(id).split('_'); return (p.length >= 3 ? p.slice(1, -1).join('') : (p[1] || '')).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  CAL.codeOf = codeOf;
  // una riga per ogni ordine osservato: giorni lavorativi, concluso sì/no, marchio, codice
  function collect() {
    var o = obs(), ds = o.dates, latest = ds[ds.length - 1]; if (!latest) return { list: [], ds: ds, latest: '' };
    var list = [], k;
    for (k in o.items) {
      var it = o.items[k], oc = it[0], next = ds.filter(function (d) { return d > it[3]; })[0], t, ev, rw = H.ST.rows[k];
      if (rw && rw.nascosta && rw.motivo === 'annullato') continue;      // un ordine annullato non è una consegna: non deve contare
      if (next) { t = (wd(oc, it[3]) + wd(oc, next)) / 2; ev = true; }   // sparita tra l'ultimo PDF in cui c'era e il primo senza: la metà
      else { t = wd(oc, latest); ev = false; }                            // ancora aperta: «almeno» questi giorni (dato censurato)
      if (rw && rw.nascosta && rw.motivo === 'consegnato' && rw.tolta && rw.tolta >= oc) {   // l'hai segnata tu come consegnata: il pezzo c'era di sicuro a quella data
        var tm = wd(oc, rw.tolta);
        if (!ev || tm < t) { t = tm; ev = true; }
      }
      if (t < 0 || t > 60) continue;
      list.push({ t: t, ev: ev, m: it[1], c: codeOf(k) });
    }
    return { list: list, ds: ds, latest: latest };
  }
  function range(a) {                                                     // da – a, tipico per un gruppo di ordini
    var done = a.filter(function (x) { return x[1]; }); if (!done.length) return null;
    var lo = km(a, 0.25), med = km(a, 0.5), hi = km(a, 0.85); if (med === null) return null;
    if (hi === null) hi = Math.max.apply(null, done.map(function (x) { return x[0]; }));
    return { n: done.length, lo: Math.max(0, Math.round(lo === null ? med : lo)), med: Math.round(med), hi: Math.max(1, Math.round(hi)) };
  }

  CAL.stats = function () {
    var col = collect(), ds = col.ds, latest = col.latest; if (!latest) return { by: {}, n: 0, from: '', to: '' };
    var by = {};
    col.list.forEach(function (x) { (by[x.m] = by[x.m] || []).push([x.t, x.ev]); });
    var out = {};
    Object.keys(by).forEach(function (m) {
      var a = by[m], done = a.filter(function (x) { return x[1]; }); if (done.length < MIN_N) return;
      var rg = range(a); if (!rg) return;                                 // troppo poche righe concluse per dire un tempo tipico
      out[m] = rg;
    });
    return { by: out, n: ds.length, from: ds[0], to: latest };
  };

  /* ---- tempi per codice articolo: l'agente che studia ogni codice ---- */
  var MIN_CODE = 3, MIN_FAM = 5, PREF = [8, 6, 4, 3], model = null, rep = null;
  CAL.invalidate = function () { model = null; rep = null; };
  function width(r) { return r.hi - r.lo; }
  function med(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; }
  function build() {
    var col = collect(), byB = {}, groups = {}, map = {}, fams = [], nCodes = 0;
    col.list.forEach(function (x) {
      (byB[x.m] = byB[x.m] || []).push([x.t, x.ev]);
      if (!x.c) return;
      function add(k, kind, len) { var g = groups[k] || (groups[k] = { m: x.m, kind: kind, len: len, key: k.split('|')[1], a: [], codes: {} }); g.a.push([x.t, x.ev]); g.codes[x.c] = 1; g.items = (g.items || []).concat([x]); }
      add(x.m + '|=' + x.c, 'codice', 0);
      PREF.forEach(function (L) { if (x.c.length > L) add(x.m + '|' + L + ':' + x.c.slice(0, L), 'famiglia', L); });
    });
    var base = {}; Object.keys(byB).forEach(function (m) { var a = byB[m]; if (a.filter(function (x) { return x[1]; }).length >= MIN_N) base[m] = range(a); });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], done = g.a.filter(function (x) { return x[1]; }).length, rg;
      if (g.kind === 'codice') {
        if (done < MIN_CODE || !(rg = range(g.a))) return;
        rg.src = 'codice'; rg.n = done; map[k] = rg; nCodes++;
      } else {
        if (done < MIN_FAM || Object.keys(g.codes).length < 2 || !base[g.m] || !(rg = range(g.a))) return;
        if (!(width(rg) < width(base[g.m]))) return;                       // la famiglia deve essere davvero più precisa del marchio intero
        rg.src = 'famiglia'; rg.n = done; rg.len = g.len; rg.key = g.key.split(':')[1]; rg.cods = Object.keys(g.codes).length; rg.m = g.m; map[k] = rg; fams.push(rg);
      }
    });
    return { map: map, base: base, groups: groups, fams: fams, nCodes: nCodes };
  }
  function ensure() { if (!model) model = build(); return model; }
  // stima per una riga: prima il codice preciso, poi la famiglia di codici più specifica, altrimenti null (si usa il marchio)
  CAL.lookup = function (r) {
    if (!r || !r.marchio || !r.referenza) return null;
    var c = String(r.referenza).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!c) return null;
    var m = ensure().map, x = m[r.marchio + '|=' + c], i, L;
    for (i = -1; i < PREF.length; i++) {
      x = i < 0 ? m[r.marchio + '|=' + c] : (c.length > (L = PREF[i]) ? m[r.marchio + '|' + L + ':' + c.slice(0, L)] : null);
      if (x) return { src: x.src, n: x.n, lo: x.lo, hi: Math.max(x.hi, x.med + 1) };        // un giorno lavorativo di tolleranza: meno falsi «in ritardo»
    }
    return null;
  };
  // quanto è più precisa la stima per codice: ogni ordine concluso viene «predetto» senza se stesso e confrontato col solo marchio
  function topFams(f) {                                                    // una sola riga per famiglia: il prefisso più corto con gli stessi risultati
    var seen = {}, out = [];
    f.slice().sort(function (a, b) { return b.n - a.n || a.len - b.len; }).forEach(function (g) { var k = g.m + g.n + '|' + g.lo + '|' + g.hi + '|' + g.cods; if (seen[k]) return; seen[k] = 1; out.push(g); });
    return out.slice(0, 4);
  }
  CAL.report = function () {
    if (rep) return rep;
    var md = ensure(), errB = [], errC = [], used = 0, tot = 0;
    Object.keys(md.groups).forEach(function (k) {
      var g = md.groups[k]; if (!md.map[k]) return;
      g.items.forEach(function (x) {
        if (!x.ev) return;
        var others = g.items.filter(function (y) { return y !== x && y.ev; }).map(function (y) { return y.t; }), bm = md.base[g.m]; if (!others.length || !bm) return;
        if (g.kind === 'famiglia' && g.len !== Math.max.apply(null, PREF.filter(function (L) { return x.c.length > L && md.map[g.m + '|' + L + ':' + x.c.slice(0, L)]; }).concat([0]))) return;
        errC.push(Math.abs(x.t - med(others))); errB.push(Math.abs(x.t - bm.med));
      });
    });
    function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; }
    rep = { codici: md.nCodes, famiglie: md.fams.length, prove: errC.length, erroreCodice: avg(errC), erroreMarchio: avg(errB),
      top: topFams(md.fams) };
    return rep;
  };

  /* ---- tempi dei marchi: si aggiornano da soli a ogni PDF ---- */
  // I marchi che hai scritto tu a mano restano come li hai messi (finché non tocchi «Usa»); quelli «molto variabili» non si toccano.
  CAL.autoBrands = function () {
    var s = H.ST.settings; if (s.autoMarchi === false) return 0;
    var st = CAL.stats(), lead = s.lead || (s.lead = {}), man = s.leadMan || (s.leadMan = {}), n = 0;
    if (!s.leadManInit) {                                                  // prima volta: ciò che era già diverso sia dai valori di partenza sia dai dati l'hai deciso tu
      s.leadManInit = true; var def = H.defLead() || {};
      Object.keys(st.by).forEach(function (m) {
        var l = lead[m], d = def[m], b = st.by[m];
        if (l && l.length && !(d && l[0] === d[0] && l[1] === d[1]) && !(l[0] === b.lo && l[1] === b.hi)) man[m] = 1;
      });
    }
    Object.keys(st.by).forEach(function (m) {
      var b = st.by[m], l = lead[m] || [];
      if (man[m] || l[2]) return;
      if (l.length && l[0] === b.lo && l[1] === b.hi) return;
      lead[m] = [b.lo, b.hi]; n++;
    });
    if (n) H.saveSettings();
    return n;
  };

  /* ---- vecchi PDF ---- */
  CAL.loadFiles = async function (files) {
    if (busy) return; busy = true; msg = 'Leggo i PDF…'; H.render();
    var ok = 0, skip = 0;
    for (var i = 0; i < files.length; i++) {
      try {
        msg = 'Leggo ' + (i + 1) + ' di ' + files.length + '…'; H.render();
        var res = await H.readPdf(files[i]);
        if (!res.refDate || !res.rows.length) { skip++; continue; }
        CAL.ingest(res.rows, res.refDate); ok++;
      } catch (e) { skip++; }
    }
    var ch = ok ? CAL.autoBrands() : 0;
    busy = false; msg = ok + (ok === 1 ? ' PDF letto' : ' PDF letti') + (skip ? ' · ' + skip + ' non riconosciuti' : '') + (ch ? ' · tempi aggiornati per ' + ch + (ch === 1 ? ' marchio' : ' marchi') : '') + '.'; H.render();
  };

  /* ---- scheda nelle Impostazioni ---- */
  CAL.cardHtml = function () {
    CAL.seed();
    var st = CAL.stats(), lead = H.ST.settings.lead || {}, rows = Object.keys(st.by).sort();
    var head = '<b>Tempi reali di consegna</b><p class="muted tiny">BLM DASHBOARD guarda quando le righe spariscono dai PDF e calcola quanti giorni lavorativi ci mettono davvero i marchi. Con l’aggiornamento automatico i tempi dei marchi si correggono da soli a ogni PDF (tranne quelli che hai scritto tu a mano, finché non tocchi «Usa»). Una riga sparisce quando l’ordine è chiuso, quindi il dato include anche la consegna a te.</p>' +
      '<p class="tiny" style="margin:0 0 8px">' + (st.n ? 'Ho <b>' + st.n + '</b> PDF, dal ' + H.C.fmt(st.from) + ' al ' + H.C.fmt(st.to) + '.' : 'Non ho ancora nessun PDF.') + '</p>' +
      '<div class="acts" style="margin-top:0"><button class="btn small' + (lead && H.ST.settings.autoMarchi !== false ? ' primary' : '') + '" data-act="cal-marchi">' + (H.ST.settings.autoMarchi !== false ? 'Si aggiornano da soli · tocca per spegnere' : 'Aggiornamento manuale · tocca per attivare da solo') + '</button><label class="btn small" for="oldIn">Carica vecchi PDF</label><input type="file" id="oldIn" accept="application/pdf,.pdf" multiple hidden></div>' +
      (msg ? '<p class="tiny" style="margin:8px 0 0"><b>' + esc(msg) + '</b></p>' : '');
    var codeCard = CAL.codeCardHtml();
    if (!rows.length) return codeCard + '<div class="card pad" style="margin-top:14px">' + head + '<p class="muted tiny" style="margin-top:8px">Servono almeno ' + MIN_N + ' righe concluse per marchio: con qualche PDF in più compaiono i confronti.</p></div>';
    var diff = 0;
    var list = rows.map(function (m) {
      var s = st.by[m], l = lead[m] || [], mine = l.length ? l[0] + '–' + l[1] : '—', same = l.length && Math.abs(l[0] - s.lo) <= 0 && Math.abs(l[1] - s.hi) <= 0;
      if (!same) diff++;
      return '<div class="brandrow"><span class="mar">' + esc(m) + '</span><span class="tiny" style="flex:1">Tu: <b>' + mine + '</b> · Dati: <b>' + s.lo + '–' + s.hi + '</b> <span class="muted">(tipico ' + s.med + ', su ' + s.n + ' concluse)</span></span>' + (same ? '<span class="tag green">Ok</span>' : '<button class="btn small" data-act="cal-use" data-b="' + esc(m) + '">Usa</button>') + '</div>';
    }).join('');
    return '<div class="card pad" style="margin-top:14px">' + head + '<div style="margin-top:10px">' + list + '</div>' + (diff > 1 ? '<div class="acts"><button class="btn primary small" data-act="cal-useall">Usa i dati per tutti (' + diff + ')</button></div>' : '') + '</div>' + codeCard;
  };
  CAL.codeCardHtml = function () {
    var on = H.ST.settings.autoCodici !== false, r = on ? CAL.report() : null;
    var h = '<div class="card pad" style="margin-top:14px"><b>Tempi per codice articolo</b>' +
      '<p class="muted tiny">A ogni PDF che carichi, BLM DASHBOARD studia ogni codice: se un codice (o una famiglia di codici con le stesse prime cifre) ha tempi di consegna diversi da quelli del marchio, usa i suoi. Più PDF carichi, più diventa precisa.</p>' +
      '<div class="acts" style="margin-top:6px"><button class="btn small' + (on ? ' primary' : '') + '" data-act="cal-codici">' + (on ? 'Attivo · tocca per disattivare' : 'Spento · tocca per attivare') + '</button></div>';
    if (!on) return h + '</div>';
    if (!r.codici && !r.famiglie) return h + '<p class="tiny muted" style="margin:8px 0 0">Per ora non ho abbastanza consegne concluse per codice (servono almeno ' + MIN_CODE + ' per un codice, ' + MIN_FAM + ' per una famiglia). Usa i tempi del marchio.</p></div>';
    h += '<p class="tiny" style="margin:8px 0 0">Codici con tempi propri: <b>' + r.codici + '</b> · famiglie di codici simili: <b>' + r.famiglie + '</b></p>';
    if (r.prove >= 5) h += '<p class="tiny" style="margin:4px 0 0">Prova su ' + r.prove + ' ordini già conclusi: errore medio <b>' + r.erroreCodice.toFixed(1).replace('.', ',') + ' giorni</b> per codice contro ' + r.erroreMarchio.toFixed(1).replace('.', ',') + ' del solo marchio.</p>';
    h += r.top.map(function (f) { return '<div class="brandrow"><span class="mar">' + esc(f.m) + '</span><span class="tiny" style="flex:1">codici che iniziano per <b>' + esc(f.key) + '</b> (' + f.cods + ' codici): <b>' + f.lo + '–' + f.hi + '</b> giorni <span class="muted">su ' + f.n + ' concluse</span></span></div>'; }).join('');
    return h + '</div>';
  };
  CAL.click = function (a, t) {
    var s = H.ST.settings, st = CAL.stats();
    function apply(m) { var d = st.by[m]; if (!d) return; if (s.leadMan) delete s.leadMan[m]; var l = s.lead[m] || []; s.lead[m] = l.length > 2 ? [d.lo, d.hi, l[2]] : [d.lo, d.hi]; }
    if (a === 'cal-use') { apply(t.dataset.b); H.saveSettings(); H.render(); H.toast('Tempi aggiornati', 2500); }
    else if (a === 'cal-codici') { s.autoCodici = s.autoCodici === false; H.saveSettings(); H.render(); H.toast(s.autoCodici === false ? 'Tempi per codice spenti' : 'Tempi per codice attivi', 2500); }
    else if (a === 'cal-marchi') { s.autoMarchi = s.autoMarchi === false; if (s.autoMarchi !== false) CAL.autoBrands(); H.saveSettings(); H.render(); H.toast(s.autoMarchi === false ? 'Aggiornamento automatico spento' : 'Aggiornamento automatico attivo', 2500); }
    else if (a === 'cal-useall') { Object.keys(st.by).forEach(apply); H.saveSettings(); H.render(); H.toast('Tempi aggiornati per tutti', 2500); }
  };
  CAL.init = function (host) { H = host; };
})();
