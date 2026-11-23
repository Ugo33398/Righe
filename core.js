/* Righe — logica pura (nessun accesso a DOM o database): date, finestra di tre mesi,
   importazione/confronto, filtri, testi per solleciti e messaggi ai clienti. */
(function (root) {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // limite della finestra mobile: oggi meno tre mesi di calendario (23/11 -> 23/08)
  function cutoffISO(today) {
    var p = today.split('-').map(Number), y = p[0], m = p[1] - 3, d = p[2];
    if (m < 1) { m += 12; y--; }
    var dim = new Date(y, m, 0).getDate();
    if (d > dim) d = dim;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function daysBetween(a, b) {
    var x = a.split('-').map(Number), y = b.split('-').map(Number);
    return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86400000);
  }
  function fmt(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  function fmtShort(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : ''; }

  var FIELDS = ['agente', 'dataOC', 'ordine', 'cliente', 'riferimento', 'marchio', 'referenza', 'descrizione', 'quantita', 'rit'];

  function inWindow(r, cut) { return r.dataOC >= cut; }

  /* Importa un documento. rows = righe già note; parsed = righe lette dal PDF.
     Restituisce { rows, record } senza modificare gli oggetti in ingresso. */
  function applyImport(rows, parsed, o) {
    var today = o.today, cut = cutoffISO(today), impId = o.impId;
    var out = {}, k;
    for (k in rows) out[k] = Object.assign({}, rows[k]);
    var seen = {}, nuove = [], tornate = [], persist = 0, escluse = [], inFin = 0;
    parsed.forEach(function (p) {
      if (p.dataOC < cut) {
        if (escluse.length < 150) escluse.push({ id: p.id, ordine: p.ordine, cliente: p.cliente, dataOC: p.dataOC, marchio: p.marchio, referenza: p.referenza, descrizione: p.descrizione, quantita: p.quantita });
        return;
      }
      inFin++;
      seen[p.id] = 1;
      var ex = out[p.id];
      if (!ex) {
        var r = { id: p.id };
        FIELDS.forEach(function (f) { r[f] = p[f]; });
        r.present = true; r.firstSeen = o.refDate || today; r.firstImport = impId; r.lastImport = impId;
        r.stato = 'in_attesa'; r.priorita = 'normale'; r.eta = ''; r.etaConf = ''; r.note = ''; r.solleciti = []; r.ultimoSollecito = '';
        out[p.id] = r; nuove.push(p.id);
      } else {
        FIELDS.forEach(function (f) { ex[f] = p[f]; });
        if (!ex.present) { ex.tornata = impId; tornate.push(p.id); } else persist++;
        ex.present = true; ex.lastImport = impId;
        delete ex.goneAt; delete ex.goneImport; delete ex.archiviata;
      }
    });
    var gone = [];
    for (k in out) {
      var x = out[k];
      if (x.present && !seen[k]) {
        x.present = false;
        if (x.dataOC >= cut) { x.goneAt = o.refDate || today; x.goneImport = impId; gone.push(k); }
        // se è uscita dalla finestra non è un possibile arrivo: resta solo nascosta
      }
    }
    // pulizia: righe più vecchie di sei mesi
    var purge = cutoffISO(cut);
    for (k in out) if (out[k].dataOC < purge) delete out[k];
    return {
      rows: out,
      record: { id: impId, file: o.file || '', at: o.nowISO, refDate: o.refDate || today, totale: parsed.length, inFinestra: inFin, cutoff: cut, nuove: nuove, gone: gone, tornate: tornate, persistenti: persist, escluse: escluse }
    };
  }

  // anteprima senza modificare nulla
  function previewImport(rows, parsed, today) {
    var cut = cutoffISO(today), seen = {}, nuove = 0, pers = 0, tornate = 0, esc = 0, inFin = 0;
    parsed.forEach(function (p) {
      if (p.dataOC < cut) { esc++; return; }
      inFin++; seen[p.id] = 1;
      var ex = rows[p.id];
      if (!ex) nuove++; else if (ex.present) pers++; else tornate++;
    });
    var gone = 0;
    for (var k in rows) if (rows[k].present && !seen[k] && rows[k].dataOC >= cut) gone++;
    return { totale: parsed.length, inFinestra: inFin, nuove: nuove, persistenti: pers, tornate: tornate, gone: gone, escluse: esc, cutoff: cut };
  }

  function isNew(r, ctx) { return !!ctx.baseline && r.present && r.firstImport === ctx.lastImportId; }
  function isGone(r) { return !r.present && !!r.goneImport && !r.archiviata; }
  function isOltre(r, today) { return r.present && !!r.eta && r.eta < today && r.stato !== 'arrivo_confermato'; }

  function plain(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function alnum(s) { return plain(s).replace(/[^a-z0-9]/g, ''); }
  function hay(r) { return plain([r.cliente, r.ordine, r.riferimento, r.referenza, r.descrizione, r.marchio, r.note].join(' ')); }
  function matchQuery(r, q) {
    if (!q) return true;
    var h = hay(r), ha = alnum(h);
    var toks = plain(q).split(/\s+/).filter(Boolean);
    return toks.every(function (t) {
      if (h.indexOf(t) >= 0) return true;
      var ta = alnum(t);
      return ta.length >= 3 && ha.indexOf(ta) >= 0;
    });
  }

  var PRI = { urgente: 0, alta: 1, normale: 2 };
  function sorter(mode) {
    return function (a, b) {
      if (mode === 'recenti') return b.dataOC.localeCompare(a.dataOC) || a.cliente.localeCompare(b.cliente);
      if (mode === 'vecchie') return a.dataOC.localeCompare(b.dataOC) || a.cliente.localeCompare(b.cliente);
      if (mode === 'priorita') return (PRI[a.priorita] - PRI[b.priorita]) || a.dataOC.localeCompare(b.dataOC);
      return a.cliente.localeCompare(b.cliente) || a.ordine.localeCompare(b.ordine) || a.referenza.localeCompare(b.referenza);
    };
  }

  /* scope: aperte | nuove | gone | oltre | sollecitare | urgenti | note | tutte */
  function filterRows(rowsObj, f, ctx) {
    var cut = ctx.cut, today = ctx.today, list = [];
    for (var k in rowsObj) {
      var r = rowsObj[k];
      if (r.dataOC < cut) continue;
      var ok;
      switch (f.scope) {
        case 'nuove': ok = isNew(r, ctx); break;
        case 'gone': ok = isGone(r); break;
        case 'oltre': ok = isOltre(r, today); break;
        case 'sollecitare': ok = r.present && r.stato === 'da_sollecitare'; break;
        case 'urgenti': ok = r.present && r.priorita !== 'normale'; break;
        case 'note': ok = !!(r.note && r.note.trim()); break;
        case 'tutte': ok = r.present || isGone(r); break;
        default: ok = r.present;
      }
      if (ok && matchQuery(r, f.q)) list.push(r);
    }
    list.sort(sorter(f.sort || 'cliente'));
    return list;
  }
  function counts(rowsObj, ctx) {
    var c = { aperte: 0, nuove: 0, gone: 0, oltre: 0, sollecitare: 0, urgenti: 0, note: 0, tutte: 0, clienti: 0 }, cl = {};
    for (var k in rowsObj) {
      var r = rowsObj[k];
      if (r.dataOC < ctx.cut) continue;
      if (r.present) { c.aperte++; cl[r.cliente] = 1; if (isNew(r, ctx)) c.nuove++; if (r.stato === 'da_sollecitare') c.sollecitare++; if (r.priorita !== 'normale') c.urgenti++; }
      if (isGone(r)) c.gone++;
      if (isOltre(r, ctx.today)) c.oltre++;
      if (r.note && r.note.trim()) c.note++;
      if (r.present || isGone(r)) c.tutte++;
    }
    c.clienti = Object.keys(cl).length;
    return c;
  }

  var STATI = { in_attesa: 'In attesa', da_sollecitare: 'Da sollecitare', arrivo_possibile: 'Arrivo possibile', arrivo_confermato: 'Arrivo confermato' };
  var PRIORITA = { normale: 'Normale', alta: 'Alta', urgente: 'Urgente' };

  var OLD_INTRO = 'Buongiorno {nome},\nvi chiedo cortesemente un aggiornamento sulla disponibilità e sulla data di arrivo dei seguenti ricambi, ancora in attesa:';
  var OLD_FIRMA = 'Grazie e buon lavoro.\nMatteo Ugolotti\nBLM Bovio Ricambi';
  var DEFAULT_INTRO = 'Ciao {nome}, mi potresti dare informazioni su quando riesco a consegnare {pezzo}?';
  var DEFAULT_FIRMA = 'Grazie mille!\nUgo';

  // il campo Riferimento contiene l'ora di inserimento (a volte troncata, es. "15:"): la togliamo
  function pulisciRif(rif) {
    return String(rif || '').replace(/\s+\d{1,2}:\d{0,2}\s*$/, '').replace(/\s\d{1,2}:\d{2}\b/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  }
  // nome della carrozzeria come lo scriveresti tu: "CARROZZERIA FRANCHINI SRL" -> "Carrozzeria Franchini SRL"
  var SIGLE = { SRL: 1, SNC: 1, SAS: 1, SPA: 1, SRLS: 1, SS: 1, SDF: 1 }, CONN = { DI: 1, DEL: 1, DELLA: 1, E: 1, DA: 1, DE: 1 };
  function nomeCliente(n) {
    return String(n || '').trim().split(/\s+/).map(function (w, i) {
      var u = w.toUpperCase(), bare = u.replace(/\./g, '');
      if (SIGLE[bare]) return u;
      if (i > 0 && CONN[bare]) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }
  function ordNum(o) { return String(o || '').replace(/^OC\s*/, ''); }
  function composeSollecito(rows, mgr, set) {
    set = set || {};
    var nome = mgr && mgr.nome ? mgr.nome.split(/\s+/)[0] : '';
    var intro = (set.intro || DEFAULT_INTRO).replace('{nome}', nome).replace('{pezzo}', rows.length === 1 ? 'questo pezzo' : 'questi pezzi').replace(/\s+,/g, ',').replace(/Ciao\s*,/, 'Ciao,');
    var firma = set.firma || DEFAULT_FIRMA;
    var subject = nomeCliente(rows[0].cliente) + ' info';
    // solo i codici dei pezzi, uno per riga (senza targa, macchina o ordine)
    var lines = rows.map(function (r) { return '• ' + (r.marchio ? r.marchio + ' ' : '') + r.referenza + (r.quantita && Number(r.quantita) !== 1 ? ' (x' + r.quantita + ')' : ''); });
    return { subject: subject, body: intro + '\n\n' + lines.join('\n') + '\n\n' + firma };
  }
  function mailtoHref(to, subject, body) {
    return 'mailto:' + (to || '') + '?subject=' + encodeURIComponent(subject).replace(/%0A/g, '%0D%0A') +
      '&body=' + encodeURIComponent(body).replace(/%0A/g, '%0D%0A');
  }

  // messaggio per il cliente (WhatsApp): previsioni mai presentate come conferme
  function lineaCliente(r) {
    var s = '• ' + r.quantita + '× ' + r.descrizione + ' (cod. ' + r.referenza + ')';
    if (r.stato === 'arrivo_confermato') s += ' – arrivo confermato' + (r.etaConf ? ' il ' + fmtShort(r.etaConf) : '');
    else if (r.eta) s += ' – arrivo previsto ' + fmtShort(r.eta) + ' (da confermare)';
    else s += ' – in attesa di conferma dal magazzino';
    return s;
  }
  function composeCliente(rows) {
    var byOrder = {}, order = [];
    rows.forEach(function (r) { if (!byOrder[r.ordine]) { byOrder[r.ordine] = []; order.push(r.ordine); } byOrder[r.ordine].push(r); });
    var parts = order.map(function (o) {
      var rs = byOrder[o];
      return o + ' del ' + fmt(rs[0].dataOC) + (rs[0].riferimento ? ' – ' + pulisciRif(rs[0].riferimento) : '') + '\n' + rs.map(lineaCliente).join('\n');
    });
    return 'Buongiorno, ecco la situazione dei ricambi ancora in attesa:\n\n' + parts.join('\n\n') + '\n\nVi aggiorno appena il magazzino conferma le date di arrivo.';
  }

  var api = { pulisciRif: pulisciRif, todayISO: todayISO, cutoffISO: cutoffISO, daysBetween: daysBetween, fmt: fmt, fmtShort: fmtShort, applyImport: applyImport, previewImport: previewImport,
    isNew: isNew, isGone: isGone, isOltre: isOltre, filterRows: filterRows, counts: counts, matchQuery: matchQuery, STATI: STATI, PRIORITA: PRIORITA,
    DEFAULT_INTRO: DEFAULT_INTRO, DEFAULT_FIRMA: DEFAULT_FIRMA, OLD_INTRO: OLD_INTRO, OLD_FIRMA: OLD_FIRMA, nomeCliente: nomeCliente, composeSollecito: composeSollecito, mailtoHref: mailtoHref, composeCliente: composeCliente };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RigheCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
