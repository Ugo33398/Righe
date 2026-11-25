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
    H.markDirty('obs');
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
    H.markDirty('obs');
  };

  /* ---- statistiche per marchio ---- */
  CAL.stats = function () {
    var o = obs(), ds = o.dates, latest = ds[ds.length - 1]; if (!latest) return { by: {}, n: 0, from: '', to: '' };
    var by = {}, k;
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
      (by[it[1]] = by[it[1]] || []).push([t, ev]);
    }
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
    var out = {};
    Object.keys(by).forEach(function (m) {
      var a = by[m], done = a.filter(function (x) { return x[1]; }); if (done.length < MIN_N) return;
      var lo = km(a, 0.25), med = km(a, 0.5), hi = km(a, 0.85);
      if (med === null) return;                                           // troppo poche righe concluse per dire un tempo tipico
      if (hi === null) hi = Math.max.apply(null, done.map(function (x) { return x[0]; }));
      out[m] = { n: done.length, lo: Math.max(0, Math.round(lo === null ? med : lo)), med: Math.round(med), hi: Math.max(1, Math.round(hi)) };
    });
    return { by: out, n: ds.length, from: ds[0], to: latest };
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
    busy = false; msg = ok + (ok === 1 ? ' PDF letto' : ' PDF letti') + (skip ? ' · ' + skip + ' non riconosciuti' : '') + '.'; H.render();
  };

  /* ---- scheda nelle Impostazioni ---- */
  CAL.cardHtml = function () {
    CAL.seed();
    var st = CAL.stats(), lead = H.ST.settings.lead || {}, rows = Object.keys(st.by).sort();
    var head = '<b>Tempi reali di consegna</b><p class="muted tiny">Righe guarda quando le righe spariscono dai PDF e calcola quanti giorni lavorativi ci mettono davvero i marchi. Più PDF vecchi carichi, più è precisa. Una riga sparisce quando l’ordine è chiuso, quindi il dato include anche la consegna a te.</p>' +
      '<p class="tiny" style="margin:0 0 8px">' + (st.n ? 'Ho <b>' + st.n + '</b> PDF, dal ' + H.C.fmt(st.from) + ' al ' + H.C.fmt(st.to) + '.' : 'Non ho ancora nessun PDF.') + '</p>' +
      '<div class="acts" style="margin-top:0"><label class="btn small" for="oldIn">Carica vecchi PDF</label><input type="file" id="oldIn" accept="application/pdf,.pdf" multiple hidden></div>' +
      (msg ? '<p class="tiny" style="margin:8px 0 0"><b>' + esc(msg) + '</b></p>' : '');
    if (!rows.length) return '<div class="card pad" style="margin-top:14px">' + head + '<p class="muted tiny" style="margin-top:8px">Servono almeno ' + MIN_N + ' righe concluse per marchio: con qualche PDF in più compaiono i confronti.</p></div>';
    var diff = 0;
    var list = rows.map(function (m) {
      var s = st.by[m], l = lead[m] || [], mine = l.length ? l[0] + '–' + l[1] : '—', same = l.length && Math.abs(l[0] - s.lo) <= 0 && Math.abs(l[1] - s.hi) <= 0;
      if (!same) diff++;
      return '<div class="brandrow"><span class="mar">' + esc(m) + '</span><span class="tiny" style="flex:1">Tu: <b>' + mine + '</b> · Dati: <b>' + s.lo + '–' + s.hi + '</b> <span class="muted">(tipico ' + s.med + ', su ' + s.n + ' concluse)</span></span>' + (same ? '<span class="tag green">Ok</span>' : '<button class="btn small" data-act="cal-use" data-b="' + esc(m) + '">Usa</button>') + '</div>';
    }).join('');
    return '<div class="card pad" style="margin-top:14px">' + head + '<div style="margin-top:10px">' + list + '</div>' + (diff > 1 ? '<div class="acts"><button class="btn primary small" data-act="cal-useall">Usa i dati per tutti (' + diff + ')</button></div>' : '') + '</div>';
  };
  CAL.click = function (a, t) {
    var s = H.ST.settings, st = CAL.stats();
    function apply(m) { var d = st.by[m]; if (!d) return; var l = s.lead[m] || []; s.lead[m] = l.length > 2 ? [d.lo, d.hi, l[2]] : [d.lo, d.hi]; }
    if (a === 'cal-use') { apply(t.dataset.b); H.saveSettings(); H.render(); H.toast('Tempi aggiornati', 2500); }
    else if (a === 'cal-useall') { Object.keys(st.by).forEach(apply); H.saveSettings(); H.render(); H.toast('Tempi aggiornati per tutti', 2500); }
  };
  CAL.init = function (host) { H = host; };
})();
