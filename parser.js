/* Righe — lettore del PDF "Righe ordini cliente aperte" (Access).
   Funziona sulle POSIZIONI delle colonne, non sul testo libero, perché
   Riferimento e Descrizione sono sporchi e di lunghezza variabile.
   Input: pagine = [ [ {str, x, y, w}, ... ], ... ]  (elementi di testo per pagina)
   Output: { rows, refDate, warnings } */
(function (root) {
  // limiti colonna (x di inizio del testo, in punti PDF, pagina A4 orizzontale)
  var COLS = [
    ['ag', 0, 45],
    ['data', 45, 110],
    ['oc', 110, 130],
    ['num', 130, 178],
    ['cliente', 178, 352],
    ['rif', 352, 452],
    ['mar', 452, 480],
    ['ref', 480, 566],
    ['desc', 566, 775],
    ['qta', 775, 803],
    ['rit', 803, 9999]
  ];
  var MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

  function colOf(x) {
    for (var i = 0; i < COLS.length; i++) if (x >= COLS[i][1] && x < COLS[i][2]) return COLS[i][0];
    return null;
  }
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // spezza un elemento di testo in parole, assegnando a ciascuna la sua x stimata
  function splitItem(it) {
    var s = it.str; if (!s || !s.trim()) return [];
    if (s.indexOf(' ') < 0) return [{ s: s, x: it.x }];
    var out = [], len = s.length, w = it.w || 0, cw = len ? w / len : 0, i = 0;
    while (i < len) {
      while (i < len && s[i] === ' ') i++;
      var st = i; while (i < len && s[i] !== ' ') i++;
      if (i > st) out.push({ s: s.slice(st, i), x: it.x + cw * st });
    }
    return out;
  }

  function parse(pagine) {
    var rows = [], warnings = [], refDate = null, seen = {}, headerSeen = false;
    pagine.forEach(function (items, pi) {
      // raggruppa per riga (y simile)
      var lines = [];
      items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; }).forEach(function (it) {
        var last = lines[lines.length - 1];
        if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it);
        else lines.push({ y: it.y, items: [it] });
      });
      lines.forEach(function (ln) {
        var words = [];
        ln.items.sort(function (a, b) { return a.x - b.x; }).forEach(function (it) { words = words.concat(splitItem(it)); });
        if (!words.length) return;
        var text = words.map(function (w) { return w.s; }).join(' ');
        // data del documento, nel piè di pagina: "venerdì 20 novembre 2026"
        var m = text.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i);
        if (m && !/^\d{3}\s/.test(text)) refDate = m[3] + '-' + pad2(MESI[m[2].toLowerCase()]) + '-' + pad2(+m[1]);
        if (/^Ag\.\s+Data/i.test(text)) { headerSeen = true; return; }
        // riga dati = inizia con codice agente numerico e ha una data dd/mm/yyyy
        var first = words[0];
        if (!/^\d{1,4}$/.test(first.s) || first.x > COLS[0][2]) return;
        var cells = {};
        COLS.forEach(function (c) { cells[c[0]] = []; });
        words.forEach(function (w) { var c = colOf(w.x); if (c) cells[c].push(w.s); });
        var d = (cells.data[0] || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!d) { warnings.push('Pagina ' + (pi + 1) + ': riga senza data valida ignorata (' + text.slice(0, 60) + ')'); return; }
        var dataOC = d[3] + '-' + d[2] + '-' + d[1];
        var num = (cells.num.join('')).replace(/\D/g, '');
        var ordine = 'OC ' + num;
        var qta = parseInt(cells.qta.join('').replace(/\D/g, ''), 10);
        if (!num) { warnings.push('Pagina ' + (pi + 1) + ': ordine mancante (' + text.slice(0, 60) + ')'); return; }
        if (isNaN(qta)) { warnings.push('Quantità non leggibile per ' + ordine); qta = 1; }
        var ref = cells.ref.join('').replace(/\s+/g, '');
        var row = {
          agente: cells.ag.join(''),
          dataOC: dataOC,
          ordine: ordine,
          cliente: norm(cells.cliente.join(' ')),
          riferimento: norm(cells.rif.join(' ')),
          marchio: norm(cells.mar.join(' ')),
          referenza: ref,
          descrizione: norm(cells.desc.join(' ')),
          quantita: qta,
          rit: norm(cells.rit.join(' '))
        };
        // id stabile: ordine + referenza + n-esima occorrenza (gestisce i duplicati)
        var key = num + '_' + ref.replace(/[^A-Za-z0-9]/g, '');
        seen[key] = (seen[key] || 0) + 1;
        row.id = key + '_' + seen[key];
        rows.push(row);
      });
    });
    if (!headerSeen) warnings.push('Intestazione colonne non trovata: il file potrebbe non essere "Righe ordini cliente aperte".');
    return { rows: rows, refDate: refDate, warnings: warnings };
  }

  // estrazione veicolo/targa dal campo Riferimento (testo libero, spesso troncato)
  function veicolo(rif) {
    var s = norm(rif || '');
    var t = s.match(/\b([A-Za-z]{2}\s?\d{3}\s?[A-Za-z]{2})\b/); // targa italiana AA123BB
    var targa = t ? t[1].replace(/\s/g, '').toUpperCase() : '';
    var modello = s.replace(t ? t[0] : '', '').replace(/\b\d{1,2}:\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
    return { targa: targa, modello: modello };
  }

  var api = { parse: parse, veicolo: veicolo, COLS: COLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RigheParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
