/* Righe — Promemoria e Calendario. Si appoggia a app.js tramite RigheNote.init(host). */
(function () {
  'use strict';
  var NT = window.RigheNote = {}, H = null;
  var DOW = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  var DOWL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  var MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var REP = [[0, 'Non ripetere'], [30, 'Ogni 30 minuti'], [60, 'Ogni ora'], [180, 'Ogni 3 ore'], [1440, 'Ogni giorno']];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };

  NT.scope = 'dafare'; NT.q = '';
  NT.cal = null;
  var ED = null;        // bozza in modifica
  var rec = null;       // registrazione in corso
  var mem = {};         // archivio in memoria se il database non c'è
  var urls = {};        // id -> indirizzo temporaneo

  /* ------------------------------------------------------------- utilità */
  function esc(s) { return H.esc(s); }
  function notes() { return H.ST.notes; }
  function all() { var o = notes(); return Object.keys(o).map(function (k) { return o[k]; }); }
  function nowLocal() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function addDays(iso, n) { var x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + n); return H.C.todayISO(x); }
  function dow(iso) { return new Date(iso + 'T12:00:00').getDay(); }
  function dayLabel(d) {
    var td = H.today();
    if (d === td) return 'Oggi'; if (d === addDays(td, 1)) return 'Domani'; if (d === addDays(td, -1)) return 'Ieri';
    return DOW[dow(d)] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7) + (d.slice(0, 4) !== td.slice(0, 4) ? '/' + d.slice(2, 4) : '');
  }
  function whenText(q) { return q ? dayLabel(q.slice(0, 10)) + ' · ' + q.slice(11, 16) : ''; }
  function repText(m) { var r = REP.filter(function (x) { return x[0] === +m; })[0]; return r && +m ? r[1].charAt(0).toLowerCase() + r[1].slice(1) : ''; }
  function isOver(n) { return !n.fatto && !!n.quando && n.quando <= nowLocal(); }
  function save(n) { n.mod = new Date().toISOString(); notes()[n.id] = n; H.markDirty('notes'); }
  function icon(kind) {
    var p = kind === 'cam' ? '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>' :
      kind === 'mic' ? '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>' :
      kind === 'clock' ? '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' :
      kind === 'rep' ? '<path d="M4 11V9a3 3 0 0 1 3-3h11m0 0-3-3m3 3-3 3M20 13v2a3 3 0 0 1-3 3H6m0 0 3 3m-3-3 3-3"/>' : '';
    return '<svg class="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* ------------------------------------------------- foto e vocali (solo su questo dispositivo) */
  function mPut(id, type, buf) {
    if (H.Store.media) return H.Store.media.put(id, type, buf);
    mem[id] = { type: type, buf: buf }; return Promise.resolve();
  }
  function mGet(id) { return H.Store.media ? H.Store.media.get(id) : Promise.resolve(mem[id]); }
  function mDel(id) { if (urls[id]) { try { URL.revokeObjectURL(urls[id]); } catch (e) { /* ignore */ } delete urls[id]; } if (H.Store.media) return H.Store.media.del(id).catch(function () {}); delete mem[id]; return Promise.resolve(); }
  function mUrl(id) {
    if (urls[id]) return Promise.resolve(urls[id]);
    return mGet(id).then(function (m) { if (!m) return ''; urls[id] = URL.createObjectURL(new Blob([m.buf], { type: m.type })); return urls[id]; }).catch(function () { return ''; });
  }
  function hydrate(root) {
    root = root || document;
    Array.prototype.forEach.call(root.querySelectorAll('img[data-m]'), function (img) {
      if (img.getAttribute('src')) return;
      mUrl(img.dataset.m).then(function (u) { if (u) img.src = u; else { img.classList.add('miss'); img.removeAttribute('data-m'); img.alt = 'Foto su un altro dispositivo'; img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'); } });
    });
    Array.prototype.forEach.call(root.querySelectorAll('audio[data-a]'), function (au) {
      if (au.getAttribute('src')) return;
      mUrl(au.dataset.a).then(function (u) { if (u) au.src = u; else { var s = document.createElement('span'); s.className = 'muted tiny'; s.textContent = 'Vocale registrato su un altro dispositivo'; au.replaceWith(s); } });
    });
  }
  NT.hydrate = hydrate;
  function loadImg(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('immagine non leggibile')); };
      im.src = u;
    });
  }
  function toJpeg(im, max, q) {
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) b.arrayBuffer().then(res, rej); else rej(new Error('compressione non riuscita')); }, 'image/jpeg', q); });
  }
  async function addPhotos(files) {
    var ok = 0, i;
    for (i = 0; i < files.length; i++) {
      try {
        var im = await loadImg(files[i]), id = 'f_' + H.uid();
        await mPut(id, 'image/jpeg', await toJpeg(im, 1600, 0.82));
        await mPut('t_' + id, 'image/jpeg', await toJpeg(im, 360, 0.72));
        ED.d.foto.push(id); ED.newMedia.push(id, 't_' + id); ok++;
      } catch (e) { H.toast('Una foto non è stata letta', 3000); }
    }
    if (ok) renderEditor();
  }

  /* ------------------------------------------------------------- elenco */
  function counts() {
    var c = { dafare: 0, ritardo: 0, fatti: 0, tutti: 0 };
    all().forEach(function (n) { c.tutti++; if (n.fatto) c.fatti++; else { c.dafare++; if (isOver(n)) c.ritardo++; } });
    return c;
  }
  NT.badge = function () { var c = counts().ritardo; return c ? '<span class="nbadge">' + c + '</span>' : ''; };
  NT.paintBadge = function () {
    var b = $('#nav [data-tab=promemoria]'); if (b) b.innerHTML = 'Promemoria' + NT.badge();
    var c = counts().ritardo; try { document.title = (c ? '(' + c + ') ' : '') + 'Righe'; if (navigator.setAppBadge) { if (c) navigator.setAppBadge(c); else navigator.clearAppBadge(); } } catch (e) { /* ignore */ }
  };
  function sortNotes(a, b) {
    var ra = isOver(a) ? 0 : a.quando ? 1 : 2, rb = isOver(b) ? 0 : b.quando ? 1 : 2;
    if (ra !== rb) return ra - rb;
    if (a.quando && b.quando) return a.quando.localeCompare(b.quando);
    return (b.creata || '').localeCompare(a.creata || '');
  }
  function noteHtml(n, showCli) {
    var over = isOver(n), thumbs = (n.foto || []).slice(0, 4).map(function (f) { return '<img data-m="t_' + esc(f) + '" data-act="n-view" data-f="' + esc(f) + '" alt="Foto">'; }).join('');
    var meta = [];
    if (n.quando) meta.push('<span class="nq' + (over ? ' over' : '') + '">' + icon('clock') + esc(whenText(n.quando)) + '</span>');
    if (n.quando && +n.ripeti && !n.fatto) meta.push('<span class="nq">' + icon('rep') + esc(repText(n.ripeti)) + '</span>');
    if ((n.foto || []).length) meta.push('<span class="nq">' + icon('cam') + n.foto.length + '</span>');
    if ((n.voc || []).length) meta.push('<span class="nq">' + icon('mic') + n.voc.length + '</span>');
    if (showCli && n.cliente) meta.unshift('<span class="nq cli">' + esc(n.cliente) + '</span>');
    return '<div class="nt' + (over ? ' over' : '') + (n.fatto ? ' done' : '') + '" data-act="n-edit" data-id="' + esc(n.id) + '">' +
      '<button class="nchk" data-act="n-done" data-id="' + esc(n.id) + '" aria-label="' + (n.fatto ? 'Riapri' : 'Segna come fatto') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>' +
      '<div class="ntb"><div class="ntt">' + (n.testo ? esc(n.testo) : '<span class="muted">(senza testo)</span>') + '</div>' + (meta.length ? '<div class="ntm">' + meta.join('') + '</div>' : '') + (thumbs ? '<div class="nth">' + thumbs + '</div>' : '') + '</div></div>';
  }
  function listInner() {
    var q = (NT.q || '').toLowerCase().trim(), list = all().filter(function (n) {
      if (q && ((n.cliente || '') + ' ' + (n.testo || '')).toLowerCase().indexOf(q) < 0) return false;
      if (NT.scope === 'dafare') return !n.fatto; if (NT.scope === 'ritardo') return isOver(n); if (NT.scope === 'fatti') return n.fatto; return true;
    });
    if (!list.length) return '<div class="empty card"><b>' + (all().length ? 'Nessun promemoria qui' : 'Ancora nessun promemoria') + '</b>' + (all().length ? 'Cambia filtro o cerca altro.' : 'Tocca «Nuovo» per scrivere un appunto, registrare un vocale o aggiungere una foto. Con una data diventa un promemoria che ti avvisa finché non lo spunti.') + '</div>';
    var by = {}, order = [];
    list.forEach(function (n) { var k = n.cliente || ''; if (!(k in by)) { by[k] = []; order.push(k); } by[k].push(n); });
    order.sort(function (a, b) {
      var oa = by[a].some(isOver) ? 0 : 1, ob = by[b].some(isOver) ? 0 : 1;
      if (oa !== ob) return oa - ob; if (!a !== !b) return a ? -1 : 1; return a.localeCompare(b);
    });
    return order.map(function (k) {
      var arr = by[k].sort(NT.scope === 'fatti' ? function (a, b) { return (b.tFatto || '').localeCompare(a.tFatto || ''); } : sortNotes), over = arr.filter(isOver).length;
      return '<details class="ngrp" open><summary><b>' + esc(k || 'Senza cliente') + '</b><span class="tag">' + arr.length + '</span>' + (over ? '<span class="tag red">' + over + ' in ritardo</span>' : '') + '</summary><div class="nlist">' + arr.map(function (n) { return noteHtml(n, false); }).join('') + '</div></details>';
    }).join('');
  }
  NT.viewList = function () {
    var c = counts(), chip = function (k, l) { return '<button class="chip" data-act="n-scope" data-s="' + k + '" aria-pressed="' + (NT.scope === k) + '">' + l + ' <i>' + (c[k] || '–') + '</i></button>'; };
    return '<div class="nhead"><h1>Promemoria</h1><button class="btn primary" data-act="n-new">+ Nuovo</button></div>' +
      '<input class="search" id="nq" data-n="q" type="search" placeholder="Cerca per cliente o testo" value="' + esc(NT.q) + '" autocomplete="off">' +
      '<div class="chips">' + chip('dafare', 'Da fare') + chip('ritardo', 'In ritardo') + chip('fatti', 'Fatti') + chip('tutti', 'Tutti') + '</div>' +
      '<div id="nlist">' + listInner() + '</div>';
  };

  /* ---------------------------------------------------------- calendario */
  function dayTitle(d, sd) {
    var td = H.today(), rel = d === td ? 'Oggi' : d === addDays(td, 1) ? 'Domani' : d === addDays(td, -1) ? 'Ieri' : '', w = DOWL[sd.getDay()];
    return (rel || w.charAt(0).toUpperCase() + w.slice(1)) + ' <span class="muted" style="font-weight:500">' + (rel ? w + ' ' : '') + sd.getDate() + ' ' + MESI[sd.getMonth()] + '</span>';
  }
  function calInit() { if (!NT.cal) NT.cal = { sel: H.today(), mode: 'week' }; return NT.cal; }
  // arrivi dei ricambi: data confermata o stimata a mano, oppure i tempi abituali del marchio dalla data dell'ordine
  var lateArr = {};
  function arrivals() {
    var td = H.today(), cut = H.C.cutoffISO(td), out = {}, k; lateArr = {};
    var RANK = { auto: 0, man: 1, conf: 2 };
    for (k in H.ST.rows) {
      var r = H.ST.rows[k]; if (r.dataOC < cut) continue;
      var e = H.C.estimate(r); if (!e) continue;
      if (e.kind !== 'conf' && e.to < td) { var l = lateArr[r.cliente] || (lateArr[r.cliente] = { n: 0 }); l.n++; continue; }
      var day = e.kind === 'auto' ? (e.from > td ? e.from : td) : e.from, dd = out[day] || (out[day] = {}), c = dd[r.cliente];
      if (!c) c = dd[r.cliente] = { n: 0, kind: e.kind, to: e.to, vary: false };
      c.n++; if (RANK[e.kind] < RANK[c.kind]) c.kind = e.kind; if (e.to > c.to) c.to = e.to; if (e.vary) c.vary = true;
    }
    return out;
  }
  function arrTag(a) {
    if (a.kind === 'conf') return '<span class="tag green">confermato</span>';
    if (a.kind === 'man') return '<span class="tag amber">stimato</span>';
    return '<span class="tag amber">' + (a.vary ? 'indicativo · ' : '') + 'entro ' + esc(dayLabel(a.to).toLowerCase()) + '</span>';
  }
  function arrHtml(day, arr, showLate) {
    var cl = Object.keys(arr[day] || {}).sort(), late = showLate ? Object.keys(lateArr).sort() : [], h = '';
    var item = function (c, n, tag) { return '<button class="narr-i" data-act="gocli" data-q="' + esc(c) + '"><span><b>' + esc(c) + '</b><br><span class="muted tiny">' + n + (n === 1 ? ' pezzo' : ' pezzi') + '</span></span>' + tag + '</button>'; };
    if (cl.length) h += '<div class="narr"><div class="narr-h">Arrivi previsti</div>' + cl.map(function (c) { return item(c, arr[day][c].n, arrTag(arr[day][c])); }).join('') + '</div>';
    if (late.length) {
      var tot = late.reduce(function (s, c) { return s + lateArr[c].n; }, 0);
      h += '<details class="narr late"><summary><span class="narr-h red" style="margin:0">Oltre il tempo previsto</span><span class="muted tiny">' + tot + (tot === 1 ? ' pezzo' : ' pezzi') + ' · ' + late.length + (late.length === 1 ? ' cliente' : ' clienti') + '</span></summary>' + late.map(function (c) { return item(c, lateArr[c].n, '<span class="tag red">in ritardo</span>'); }).join('') + '</details>';
    }
    return h;
  }
  function dayCell(d, cal, byDay, td) {
    var o = byDay[d], dots = '';
    if (o) dots = (o.over ? '<i class="r"></i>' : '') + (o.open ? '<i class="b"></i>' : '') + (o.arr ? '<i class="a"></i>' : '') + (o.done && !o.open && !o.over ? '<i class="g"></i>' : '');
    return '<button class="cd' + (d === td ? ' today' : '') + (d === cal.sel ? ' sel' : '') + '" data-act="n-day" data-d="' + d + '"><small>' + DOW[dow(d)].slice(0, 3) + '</small><span>' + (+d.slice(8, 10)) + '</span><em>' + dots + '</em></button>';
  }
  NT.viewCal = function () {
    var cal = calInit(), td = H.today(), arr = arrivals(), byDay = {}, i;
    all().forEach(function (n) { if (!n.quando) return; var d = n.quando.slice(0, 10), o = byDay[d] || (byDay[d] = {}); if (n.fatto) o.done = (o.done || 0) + 1; else if (isOver(n)) o.over = (o.over || 0) + 1; else o.open = (o.open || 0) + 1; });
    Object.keys(arr).forEach(function (d) { (byDay[d] = byDay[d] || {}).arr = 1; });
    if (Object.keys(lateArr).length) { var bt = byDay[td] = byDay[td] || {}; bt.over = (bt.over || 0) + 1; }
    var sd = new Date(cal.sel + 'T12:00:00'), strip = '';
    if (cal.mode === 'week') {
      var mon = addDays(cal.sel, -((sd.getDay() + 6) % 7));
      for (i = 0; i < 7; i++) strip += dayCell(addDays(mon, i), cal, byDay, td);
      strip = '<div class="ncal-g week">' + strip + '</div>';
    } else {
      var y = sd.getFullYear(), m = sd.getMonth(), lead = (new Date(y, m, 1).getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate();
      for (i = 0; i < lead; i++) strip += '<span></span>';
      for (i = 1; i <= nd; i++) strip += dayCell(y + '-' + p2(m + 1) + '-' + p2(i), cal, byDay, td);
      strip = '<div class="ncal-g month">' + strip + '</div>';
    }
        var late = cal.sel === td ? all().filter(function (n) { return isOver(n) && n.quando.slice(0, 10) < td; }).sort(sortNotes) : [];
    var day = all().filter(function (n) { return n.quando && n.quando.slice(0, 10) === cal.sel; }).sort(function (a, b) { return a.quando.localeCompare(b.quando); });
    var next = [], d2 = cal.sel;
    for (i = 0; i < 21 && next.length < 5; i++) {
      d2 = addDays(d2, 1);
      var ns = all().filter(function (n) { return n.quando && n.quando.slice(0, 10) === d2 && !n.fatto; }).sort(function (a, b) { return a.quando.localeCompare(b.quando); });
      if (ns.length || arr[d2]) next.push({ d: d2, ns: ns });
    }
    return '<div class="nhead"><h1>Calendario</h1><div class="nhead-r"><button class="btn small" data-act="n-mode">' + (cal.mode === 'week' ? 'Mese' : 'Settimana') + '</button><button class="btn small" data-act="n-today">Oggi</button></div></div>' +
      '<div class="card pad ncal"><div class="ncal-h"><button class="x" data-act="n-mm" data-v="-1" aria-label="Precedente">‹</button><b>' + MESI[sd.getMonth()] + ' ' + sd.getFullYear() + '</b><button class="x" data-act="n-mm" data-v="1" aria-label="Successivo">›</button></div>' +
      (cal.mode === 'month' ? '<div class="ncal-w"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>' : '') + strip +
      '<div class="ncal-l"><span><i class="r"></i>in ritardo</span><span><i class="b"></i>promemoria</span><span><i class="a"></i>arrivi</span></div></div>' +
      '<div class="nhead" style="margin-top:18px"><h2 style="margin:0">' + dayTitle(cal.sel, sd) + '</h2><button class="btn small primary" data-act="n-new" data-d="' + cal.sel + '">+ Aggiungi</button></div>' +
      (late.length ? '<p class="nsec red">In ritardo</p><div class="nlist">' + late.map(function (n) { return noteHtml(n, true); }).join('') + '</div>' : '') +
      (day.length ? (late.length ? '<p class="nsec">Di oggi</p>' : '') + '<div class="nlist">' + day.map(function (n) { return noteHtml(n, true); }).join('') + '</div>' : '') +
      arrHtml(cal.sel, arr, cal.sel === td) +
      (!late.length && !day.length && !arr[cal.sel] && !(cal.sel === td && Object.keys(lateArr).length) ? '<div class="empty card" style="padding:20px"><b>Niente in programma</b>Tocca «Aggiungi» per mettere un promemoria in questo giorno.</div>' : '') +
      (next.length ? '<h2>Nei prossimi giorni</h2>' + next.map(function (x) { return '<button class="nday" data-act="n-day" data-d="' + x.d + '"><b>' + esc(dayLabel(x.d)) + '</b><span class="muted tiny">' + x.d.slice(8, 10) + '/' + x.d.slice(5, 7) + '</span><span class="nday-t">' +
        x.ns.slice(0, 3).map(function (n) { return '<span>' + esc(n.quando.slice(11, 16) + ' · ' + (n.cliente || n.testo || '').slice(0, 34)) + '</span>'; }).join('') +
        (x.ns.length > 3 ? '<span class="muted">+' + (x.ns.length - 3) + ' altri</span>' : '') + (arr[x.d] ? '<span class="tag amber">arrivi: ' + Object.keys(arr[x.d]).length + ' clienti</span>' : '') + '</span></button>'; }).join('') : '');
  };

  /* --------------------------------------------------------- panoramica */
  NT.dashHtml = function () {
    var td = H.today(), list = all().filter(function (n) { return !n.fatto && n.quando && (isOver(n) || n.quando.slice(0, 10) === td); }).sort(sortNotes);
    if (!list.length) return '';
    return '<h2>Promemoria di oggi</h2><div class="nlist">' + list.slice(0, 5).map(function (n) { return noteHtml(n, true); }).join('') + '</div>' +
      (list.length > 5 ? '<p class="muted tiny">e altri ' + (list.length - 5) + '…</p>' : '') + '<div style="margin-top:8px"><button class="btn small" data-act="tab" data-tab="promemoria">Apri promemoria</button></div>';
  };

  /* ------------------------------------------------------------ editor */
  function blank(date) {
    var q = '';
    if (date) {
      var td = H.today();
      if (date === td) { var d = new Date(Date.now() + 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); q = H.C.todayISO(d) === td ? H.C.todayISO(d) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : td + 'T23:30'; }
      else q = date + 'T09:00';
    }
    return { id: H.uid(), cliente: '', testo: '', quando: q, ripeti: q ? 60 : 0, fatto: false, foto: [], voc: [], creata: new Date().toISOString() };
  }
  function openEditor(n, isNew) {
    ED = { d: JSON.parse(JSON.stringify(n)), isNew: isNew, newMedia: [], toDel: [], confirmDel: false };
    renderEditor();
  }
  function clients() {
    var set = {}, k; for (k in H.ST.rows) { var c = H.ST.rows[k].cliente; if (c) set[c] = 1; }
    all().forEach(function (n) { if (n.cliente) set[n.cliente] = 1; });
    return Object.keys(set).sort();
  }
  function syncDraft() {
    if (!ED || !$('#n-txt', H.L2())) return;
    ED.d.cliente = $('#n-cli', H.L2()).value.trim(); ED.d.testo = $('#n-txt', H.L2()).value;
    ED.d.quando = $('#n-when', H.L2()).value || ''; ED.d.ripeti = +$('#n-rep', H.L2()).value || 0;
  }
  function renderEditor() {
    syncDraftSafe();
    var d = ED.d, L = H.L2();
    var ph = d.foto.map(function (f) { return '<div class="nph"><img data-m="t_' + esc(f) + '" data-act="n-view" data-f="' + esc(f) + '" alt="Foto"><button data-act="n-photodel" data-f="' + esc(f) + '" aria-label="Togli la foto">×</button></div>'; }).join('');
    var vc = d.voc.map(function (v) { return '<div class="nvo"><audio controls preload="metadata" data-a="' + esc(v.id) + '"></audio><button class="x" data-act="n-vocdel" data-id="' + esc(v.id) + '" aria-label="Elimina il vocale">×</button></div>'; }).join('');
    var canRec = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    L.innerHTML = '<div class="veil"><div class="sheet" role="dialog" aria-modal="true" aria-label="Promemoria">' +
      '<div class="sh-head"><h3>' + (ED.isNew ? 'Nuovo promemoria' : 'Promemoria') + '</h3><button class="x" data-act="n-close" aria-label="Chiudi">×</button></div>' +
      '<div class="field"><label for="n-cli">Cliente</label><input class="in" id="n-cli" list="n-clist" value="' + esc(d.cliente) + '" placeholder="Facoltativo" autocomplete="off" autocapitalize="words"><datalist id="n-clist">' + clients().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
      '<div class="field"><label for="n-txt">Cosa devo ricordare</label><textarea class="in" id="n-txt" rows="4" placeholder="Scrivi, oppure tocca il microfono sulla tastiera per dettare">' + esc(d.testo) + '</textarea></div>' +
      '<div class="field"><label>Foto</label><div class="nphs">' + ph + '<label class="nadd" for="n-photo">' + icon('cam') + '<span>Aggiungi</span></label></div><input type="file" id="n-photo" data-n="photo" accept="image/*" multiple hidden></div>' +
      '<div class="field"><label>Vocali</label>' + vc +
      (canRec ? (rec ? '<button class="btn danger" data-act="n-rec" style="width:100%">Stop · <span id="n-rect">0:00</span></button>' : '<button class="btn" data-act="n-rec" style="width:100%">' + icon('mic') + 'Registra un vocale</button>') : '<p class="muted tiny">La registrazione non è disponibile qui: usa il microfono della tastiera nel testo.</p>') + '</div>' +
      '<div class="field"><label for="n-when">Quando</label><input class="in" type="datetime-local" id="n-when" value="' + esc(d.quando) + '">' +
      '<div class="npre"><button class="btn small" data-act="n-pre" data-v="oggi">Oggi</button><button class="btn small" data-act="n-pre" data-v="domani">Domani</button><button class="btn small" data-act="n-pre" data-v="sett">Tra 1 settimana</button><button class="btn small ghost" data-act="n-pre" data-v="no">Senza data</button></div></div>' +
      '<div class="field"><label for="n-rep">Se non lo segno fatto, avvisami</label><select class="in" id="n-rep">' + REP.map(function (r) { return '<option value="' + r[0] + '"' + (+d.ripeti === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select><div class="muted tiny" style="margin-top:6px">Gli avvisi arrivano mentre l’app è aperta. Restano in evidenza in rosso finché non lo spunti.</div></div>' +
      '<div class="acts"><button class="btn primary" data-act="n-save">Salva</button>' + (!ED.isNew ? '<button class="btn" data-act="n-fatto">' + (d.fatto ? 'Riapri' : 'Segna come fatto') + '</button><button class="btn danger" data-act="n-del">' + (ED.confirmDel ? 'Tocca ancora per eliminare' : 'Elimina') + '</button>' : '') + '</div></div></div>';
    hydrate(L);
  }
  function syncDraftSafe() { try { syncDraft(); } catch (e) { /* ignore */ } }
  function closeEditor(discard) {
    if (rec) recStop(true);
    if (discard && ED) ED.newMedia.forEach(mDel);
    ED = null; H.L2().innerHTML = '';
  }
  function setPreset(v) {
    syncDraft(); var td = H.today(), d = ED.d;
    if (v === 'no') { d.quando = ''; d.ripeti = 0; }
    else { d.quando = v === 'oggi' ? blank(td).quando : v === 'domani' ? addDays(td, 1) + 'T09:00' : addDays(td, 7) + 'T09:00'; if (!+d.ripeti) d.ripeti = 60; }
    renderEditor();
  }
  function commit() {
    syncDraft(); var d = ED.d;
    if (!d.testo.trim() && !d.foto.length && !d.voc.length) { H.toast('Scrivi qualcosa, o aggiungi una foto o un vocale'); return false; }
    if (!d.quando) d.ripeti = 0;
    var old = notes()[d.id];
    if (old && d.quando !== old.quando) d.avvisato = '';
    d.cliente = d.cliente.trim();
    ED.toDel.forEach(mDel); save(d); return true;
  }
  function finishSave(msg) { ED = null; H.L2().innerHTML = ''; H.render(); NT.paintBadge(); if (msg) H.toast(msg); }

  /* ------------------------------------------------------------ vocali */
  async function recStart() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].filter(function (m) { return window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0];
      var mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream), chunks = [], t0 = Date.now();
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec = { mr: mr, stream: stream, chunks: chunks, t0: t0, discard: false, timer: setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000), el = $('#n-rect'); if (el) el.textContent = Math.floor(s / 60) + ':' + p2(s % 60); if (s >= 300) recStop(false);
      }, 500) };
      mr.onstop = async function () {
        var r = rec; clearInterval(r.timer); r.stream.getTracks().forEach(function (t) { t.stop(); }); rec = null;
        if (!r.discard && r.chunks.length && ED) {
          var type = r.mr.mimeType || mime || 'audio/mp4', blob = new Blob(r.chunks, { type: type }), id = 'a_' + H.uid();
          await mPut(id, type, await blob.arrayBuffer()); ED.d.voc.push({ id: id, dur: Math.round((Date.now() - r.t0) / 1000) }); ED.newMedia.push(id);
        }
        if (ED) renderEditor();
      };
      mr.start(); renderEditor();
    } catch (e) { rec = null; H.toast('Microfono non consentito: attivalo dalle impostazioni di Safari per questo sito', 5000); }
  }
  function recStop(discard) { if (!rec) return; rec.discard = !!discard; try { rec.mr.stop(); } catch (e) { rec = null; } }

  /* ----------------------------------------------------------- visore foto */
  function viewPhoto(f) {
    var v = document.createElement('div'); v.className = 'nview'; v.innerHTML = '<button class="x" aria-label="Chiudi">×</button><img alt="Foto">';
    document.body.appendChild(v); v.addEventListener('click', function () { v.remove(); });
    mUrl(f).then(function (u) { if (u) $('img', v).src = u; else { v.remove(); H.toast('Foto su un altro dispositivo'); } });
  }

  /* ----------------------------------------------------- avvisi (app aperta) */
  var alertOpen = false;
  function dueList() {
    var now = Date.now(), nl = nowLocal();
    return all().filter(function (n) {
      if (n.fatto || !n.quando || n.quando > nl) return false;
      if (!n.avvisato) return true;
      return +n.ripeti > 0 && now - new Date(n.avvisato).getTime() >= n.ripeti * 60000;
    }).sort(sortNotes);
  }
  NT.tick = function () {
    if (!H || !H.ST.ready) return;
    NT.paintBadge();
    if (alertOpen || ED || H.L2().innerHTML) return;
    var due = dueList(); if (!due.length) return;
    alertOpen = true; var iso = new Date().toISOString();
    due.forEach(function (n) { n.avvisato = iso; save(n); });
    H.L2().innerHTML = '<div class="veil center"><div class="dlg" role="alertdialog" aria-modal="true" aria-label="Promemoria"><div class="sh-head"><h3>' + (due.length === 1 ? 'Promemoria' : due.length + ' promemoria') + '</h3></div><div class="nlist">' +
      due.map(function (n) { return noteHtml(n, true).replace('data-act="n-edit"', 'data-act="n-aedit"'); }).join('') + '</div><div class="acts" style="margin-top:14px"><button class="btn primary" data-act="n-aok">Ok</button></div>' +
      '<p class="muted tiny" style="margin-top:10px">Se non li segni come fatti, ti riavviso in base a quanto hai scelto per ciascuno.</p></div></div>';
    hydrate(H.L2());
  };
  function closeAlert() { alertOpen = false; H.L2().innerHTML = ''; H.render(); NT.paintBadge(); }

  /* ----------------------------------------------------------- eventi */
  NT.click = function (a, t) {
    var id = t.dataset.id, n = id ? notes()[id] : null;
    switch (a) {
      case 'n-new': openEditor(blank(t.dataset.d || ''), true); break;
      case 'n-edit': if (n) openEditor(n, false); break;
      case 'n-aedit': if (n) { alertOpen = false; openEditor(n, false); } break;
      case 'n-aok': closeAlert(); break;
      case 'n-done':
        if (!n) break;
        n.fatto = !n.fatto; n.tFatto = n.fatto ? new Date().toISOString() : ''; save(n);
        if (alertOpen) { var row = t.closest('.nt'); if (row) row.classList.toggle('done', n.fatto); if (!dueList().length && !$('.nt:not(.done)', H.L2())) closeAlert(); }
        else H.render();
        NT.paintBadge(); H.toast(n.fatto ? 'Fatto ✓' : 'Riaperto'); break;
      case 'n-scope': NT.scope = t.dataset.s; H.render(); break;
      case 'n-day': calInit().sel = t.dataset.d; H.render(); window.scrollTo(0, 0); break;
      case 'n-today': NT.cal = null; H.render(); break;
      case 'n-mode': var cm = calInit(); cm.mode = cm.mode === 'week' ? 'month' : 'week'; H.render(); break;
      case 'n-mm': var cc = calInit(), v = +t.dataset.v, dd = new Date(cc.sel + 'T12:00:00');
        if (cc.mode === 'week') cc.sel = addDays(cc.sel, 7 * v); else { dd.setDate(1); dd.setMonth(dd.getMonth() + v); cc.sel = H.C.todayISO(dd); if (cc.sel.slice(0, 7) === H.today().slice(0, 7)) cc.sel = H.today(); }
        H.render(); break;
      case 'n-close': closeEditor(true); break;
      case 'n-save': if (commit()) finishSave('Salvato'); break;
      case 'n-fatto': syncDraft(); ED.d.fatto = !ED.d.fatto; ED.d.tFatto = ED.d.fatto ? new Date().toISOString() : ''; if (commit()) finishSave('Salvato'); break;
      case 'n-del':
        if (!ED.confirmDel) { syncDraft(); ED.confirmDel = true; renderEditor(); setTimeout(function () { if (ED && ED.confirmDel) { ED.confirmDel = false; renderEditor(); } }, 4000); break; }
        var saved = notes()[ED.d.id] || {};
        (saved.foto || []).forEach(function (f) { mDel(f); mDel('t_' + f); });
        (saved.voc || []).forEach(function (v) { mDel(v.id); });
        ED.newMedia.forEach(mDel); delete notes()[ED.d.id]; H.markDirty('notes'); finishSave('Eliminato'); break;
      case 'n-pre': setPreset(t.dataset.v); break;
      case 'n-photodel': syncDraft(); ED.d.foto = ED.d.foto.filter(function (f) { return f !== t.dataset.f; }); if (ED.newMedia.indexOf(t.dataset.f) >= 0) { mDel(t.dataset.f); mDel('t_' + t.dataset.f); } else ED.toDel.push(t.dataset.f, 't_' + t.dataset.f); renderEditor(); break;
      case 'n-vocdel': syncDraft(); ED.d.voc = ED.d.voc.filter(function (v) { return v.id !== id; }); if (ED.newMedia.indexOf(id) >= 0) mDel(id); else ED.toDel.push(id); renderEditor(); break;
      case 'n-rec': if (rec) recStop(false); else { syncDraft(); recStart(); } break;
      case 'n-view': viewPhoto(t.dataset.f); break;
    }
  };
  NT.change = function (t) {
    if (t.dataset.n === 'photo') { var fs = Array.prototype.slice.call(t.files || []); t.value = ''; if (fs.length && ED) { syncDraft(); addPhotos(fs); } }
  };
  NT.input = function (t) {
    if (t.dataset.n === 'q') { NT.q = t.value; var el = $('#nlist'); if (el) { el.innerHTML = listInner(); hydrate(el); } }
  };
  NT.afterRender = function () { hydrate($('#view')); NT.paintBadge(); };

  NT.init = function (host) { H = host; };
  NT.start = function () {
    NT.paintBadge(); setTimeout(NT.tick, 800); setInterval(NT.tick, 30000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') NT.tick(); });
  };
})();
