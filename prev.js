/* Righe — preventivi e ordini fatti sul sito del magazzino. Si registrano incollando la mail di conferma. */
(function () {
  'use strict';
  var PV = window.RighePrev = {}, H = null;
  var ed = null, flt = 'aperti', busy = false;
  var STATI = [['mandato', 'Preventivo mandato', 'amber'], ['ordinato', 'Ordinato', 'blue'], ['consegnato', 'Consegnato', 'green'], ['perso', 'Perso', 'red']];
  var STOP = { srl: 1, snc: 1, spa: 1, sas: 1, di: 1, e: 1, s: 1, r: 1, l: 1, c: 1, n: 1, a: 1, p: 1, de: 1, del: 1, di_: 1 };

  function esc(s) { return H.esc(s); }
  function items() { return H.ST.prev || (H.ST.prev = {}); }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function alnum(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function toks(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(function (t) { return t && !STOP[t]; }); }
  function sameCli(a, b) {
    var ta = toks(a), tb = toks(b); if (!ta.length || !tb.length) return false;
    var s = ta.length <= tb.length ? ta : tb, l = s === ta ? tb : ta;
    return s.every(function (t) { return l.indexOf(t) >= 0; });
  }
  function stInfo(k) { return STATI.filter(function (s) { return s[0] === k; })[0] || STATI[0]; }

  // quante righe del preventivo compaiono già nel PDF degli ordini aperti, per lo stesso cliente
  function inPdf(it, idx) {
    var n = 0;
    (it.righe || []).forEach(function (p) {
      var c = alnum(p.cod); if (!c) return;
      if ((idx[c] || []).some(function (r) { return sameCli(r.cliente, it.cliente); })) n++;
    });
    return n;
  }
  function pdfIndex() {
    var idx = {}, k, cut = H.C.cutoffISO(H.today());
    for (k in H.ST.rows) { var r = H.ST.rows[k]; if (!r.present || r.nascosta || r.dataOC < cut) continue; (idx[alnum(r.referenza)] = idx[alnum(r.referenza)] || []).push(r); }
    return idx;
  }
  function eff(it, n) { return it.stato === 'mandato' && n > 0 ? 'ordinato' : it.stato; }
  function due(it, e) { return e === 'mandato' && it.richiamo && it.richiamo <= H.today(); }
  function all() { var idx = pdfIndex(); return Object.keys(items()).map(function (k) { var it = items()[k], n = inPdf(it, idx), e = eff(it, n); return { it: it, n: n, e: e, due: due(it, e) }; }); }
  PV.dueList = function () {
    return all().filter(function (x) { return x.due; }).map(function (x) { return '- ' + (x.it.cliente || 'senza cliente') + (x.it.numero ? ' (n. ' + x.it.numero + ')' : '') + ', preventivo del ' + (x.it.data || '?') + ', richiamo previsto il ' + x.it.richiamo; });
  };
  PV.badge = function () { var c = all().filter(function (x) { return x.due; }).length; return c ? '<span class="nbadge">' + c + '</span>' : ''; };

  function card(x) {
    var it = x.it, st = stInfo(x.e), np = (it.righe || []).length;
    var cods = (it.righe || []).slice(0, 3).map(function (p) { return esc(p.cod); }).join(' · ') + (np > 3 ? ' · +' + (np - 3) : '');
    return '<div class="card pad pvc" data-act="pv-open" data-id="' + esc(it.id) + '"><div class="pv1"><b>' + esc(it.cliente || 'Senza cliente') + '</b><span class="tag ' + st[2] + '">' + st[1] + '</span></div>' +
      '<div class="muted tiny">' + (it.numero ? 'n. ' + esc(it.numero) + ' · ' : '') + (it.data ? H.C.fmt(it.data) + ' · ' : '') + np + (np === 1 ? ' pezzo' : ' pezzi') + '</div>' +
      (cods ? '<div class="tiny num" style="margin-top:4px">' + cods + '</div>' : '') +
      '<div class="pv2">' + (x.n ? '<span class="tag green">Nel PDF ' + x.n + '/' + np + '</span>' : '') + (x.due ? '<span class="tag red">Da richiamare</span>' : (x.e === 'mandato' && it.richiamo ? '<span class="tag">Richiamo ' + H.C.fmtShort(it.richiamo) + '</span>' : '')) + '</div></div>';
  }
  PV.view = function () {
    var xs = all(), cnt = { aperti: 0, consegnati: 0, persi: 0, tutti: xs.length };
    xs.forEach(function (x) { if (x.e === 'mandato' || x.e === 'ordinato') cnt.aperti++; else if (x.e === 'consegnato') cnt.consegnati++; else cnt.persi++; });
    var list = xs.filter(function (x) { return flt === 'tutti' || (flt === 'aperti' ? (x.e === 'mandato' || x.e === 'ordinato') : flt === 'consegnati' ? x.e === 'consegnato' : x.e === 'perso'); })
      .sort(function (a, b) { return (b.due - a.due) || String(b.it.data || '').localeCompare(String(a.it.data || '')); });
    var F = [['aperti', 'Aperti'], ['consegnati', 'Consegnati'], ['persi', 'Persi'], ['tutti', 'Tutti']];
    return '<div class="nhead"><h1>Preventivi</h1><div class="acts" style="margin:0"><button class="btn small primary" data-act="pv-paste">Incolla mail</button><button class="btn small" data-act="pv-new">+ Nuovo</button></div></div>' +
      '<div class="chips">' + F.map(function (f) { return '<button class="chip" data-act="pv-flt" data-f="' + f[0] + '" aria-pressed="' + (flt === f[0]) + '">' + f[1] + ' <b>' + cnt[f[0]] + '</b></button>'; }).join('') + '</div>' +
      (list.length ? '<div class="pvl">' + list.map(card).join('') + '</div>' :
        '<div class="empty card"><b>' + (xs.length ? 'Nessun preventivo in questo elenco' : 'Ancora nessun preventivo') + '</b>' + (xs.length ? '' : 'Quando mandi un preventivo o un ordine dal sito del magazzino, copia la mail di conferma e tocca «Incolla mail»: lo registro io.') + '</div>');
  };
  PV.dashHtml = function () {
    var d = all().filter(function (x) { return x.due; }); if (!d.length) return '';
    return '<div class="card pad aiplan" style="border-left-color:#B3261E"><div class="nhead" style="margin:0 0 6px"><b>Preventivi da richiamare</b><button class="btn small" data-act="tab" data-tab="preventivi">Apri</button></div>' +
      d.slice(0, 5).map(function (x) { return '<div class="pvd" data-act="pv-open" data-id="' + esc(x.it.id) + '"><b>' + esc(x.it.cliente || 'Senza cliente') + '</b> <span class="muted tiny">' + (x.it.numero ? 'n. ' + esc(x.it.numero) + ' · ' : '') + 'mandato il ' + H.C.fmtShort(x.it.data || x.it.richiamo) + '</span></div>'; }).join('') + (d.length > 5 ? '<div class="muted tiny">+ altri ' + (d.length - 5) + '</div>' : '') + '</div>';
  };

  /* ------------------------------------------------------------ dialoghi */
  function dlg(inner, label) { H.L2().innerHTML = '<div class="veil center"><div class="dlg" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' + inner + '</div></div>'; }
  function close() { ed = null; busy = false; H.L2().innerHTML = ''; }
  function draw() {
    if (!ed) return;
    var key = window.RigheAI && window.RigheAI.hasKey && window.RigheAI.hasKey();
    if (ed.mode === 'paste') {
      var head = '<div class="sh-head"><div><h3>Incolla la mail</h3><div class="muted tiny">La conferma del sito per il preventivo o l’ordine.</div></div><button class="x" data-act="pv-close" aria-label="Chiudi">×</button></div>';
      if (!key) { dlg(head + '<div class="banner info"><div>Per leggere la mail serve la chiave API, da inserire una volta sola in Impostazioni. Intanto puoi inserire il preventivo a mano.</div></div><div class="acts"><button class="btn primary" data-act="ai-tosettings">Vai alle Impostazioni</button><button class="btn" data-act="pv-new">Inserisci a mano</button></div>', 'Incolla la mail'); return; }
      if (busy) { dlg(head + '<div class="empty" style="padding:30px"><b>Sto leggendo…</b>Ci vogliono pochi secondi.</div>', 'Incolla la mail'); return; }
      dlg(head + (ed.err ? '<div class="banner bad"><div>' + esc(ed.err) + '</div></div>' : '') +
        '<div class="field"><label for="pvtxt">Testo della mail</label><textarea class="in" id="pvtxt" data-pv="text" rows="9" placeholder="Incolla qui tutto il testo della mail di conferma">' + esc(ed.text || '') + '</textarea></div>' +
        '<p class="muted tiny">Il testo viene inviato all’API di Anthropic con la tua chiave. Prima di salvare puoi controllare e correggere tutto.</p>' +
        '<div class="acts"><button class="btn primary" data-act="pv-read">Leggi</button><button class="btn" data-act="pv-new">Inserisci a mano</button></div>', 'Incolla la mail');
      return;
    }
    var d = ed.d;
    dlg('<div class="sh-head"><div><h3>' + (ed.isNew ? 'Nuovo preventivo' : 'Preventivo') + '</h3>' + (ed.note ? '<div class="muted tiny">' + esc(ed.note) + '</div>' : '') + '</div><button class="x" data-act="pv-close" aria-label="Chiudi">×</button></div>' +
      '<div class="field"><label for="pv-c">Cliente</label><input class="in" id="pv-c" data-pv="cliente" value="' + esc(d.cliente) + '" autocomplete="off"></div>' +
      '<div class="two"><div class="field"><label for="pv-n">Numero</label><input class="in" id="pv-n" data-pv="numero" value="' + esc(d.numero) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="pv-s">Stato</label><select class="in" id="pv-s" data-pv="stato">' + STATI.map(function (s) { return '<option value="' + s[0] + '"' + (d.stato === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="two"><div class="field"><label for="pv-d">Data</label><input class="in" type="date" id="pv-d" data-pv="data" value="' + esc(d.data) + '"></div>' +
      '<div class="field"><label for="pv-r">Richiamare il</label><input class="in" type="date" id="pv-r" data-pv="richiamo" value="' + esc(d.richiamo) + '"></div></div>' +
      '<div class="field"><label>Pezzi</label>' + d.righe.map(function (p, i) {
        return '<div class="pvrow"><input class="in" data-pv="cod" data-i="' + i + '" value="' + esc(p.cod) + '" placeholder="Codice" aria-label="Codice" autocapitalize="characters" autocomplete="off"><input class="in pvq" data-pv="qta" data-i="' + i + '" value="' + esc(p.qta) + '" inputmode="numeric" placeholder="Qtà" aria-label="Quantità">' +
          '<button class="x" data-act="pv-delp" data-i="' + i + '" aria-label="Togli pezzo">×</button><input class="in pvd2" data-pv="desc" data-i="' + i + '" value="' + esc(p.desc) + '" placeholder="Descrizione" aria-label="Descrizione"></div>';
      }).join('') + '<button class="btn small" data-act="pv-addp">+ Aggiungi pezzo</button></div>' +
      '<div class="field"><label for="pv-t">Note</label><textarea class="in" id="pv-t" data-pv="note" rows="2">' + esc(d.note) + '</textarea></div>' +
      '<div class="acts"><button class="btn primary" data-act="pv-save">Salva</button>' + (ed.isNew ? '' : '<button class="btn danger" data-act="pv-del">Elimina</button>') + '<button class="btn" data-act="pv-close">Annulla</button></div>', 'Preventivo');
  }
  function blank() { return { id: uid(), tipo: 'preventivo', numero: '', cliente: '', stato: 'mandato', data: H.today(), richiamo: H.C.addWorkDays(H.today(), 3), note: '', righe: [{ cod: '', desc: '', qta: '1' }] }; }
  function openEdit(d, isNew, note) { ed = { mode: 'edit', d: d, isNew: isNew, note: note || '' }; draw(); }

  /* ------------------------------------------------------------ lettura con l'AI */
  var TOOL = {
    name: 'registra_documento',
    description: 'Registra il preventivo o l\'ordine descritto nella mail.',
    input_schema: { type: 'object', properties: {
      tipo: { type: 'string', enum: ['preventivo', 'ordine'], description: 'Se la mail conferma un preventivo/offerta o un ordine vero e proprio.' },
      numero: { type: 'string', description: 'Numero del preventivo o dell\'ordine, se c\'è.' },
      cliente: { type: 'string', description: 'Il cliente finale a cui è destinato, se indicato; altrimenti stringa vuota.' },
      data: { type: 'string', description: 'Data del documento AAAA-MM-GG, se c\'è.' },
      righe: { type: 'array', items: { type: 'object', properties: {
        codice: { type: 'string', description: 'Codice del pezzo, esatto come scritto.' },
        descrizione: { type: 'string' },
        quantita: { type: 'string' }
      }, required: ['codice'] } },
      note: { type: 'string', description: 'Altro di utile in una riga (facoltativo).' }
    }, required: ['tipo', 'righe'] }
  };
  async function read() {
    var td = H.today();
    var data = await window.RigheAI.ask({
      model: window.RigheAI.model, max_tokens: 2500,
      system: 'Aiuti un rappresentante di ricambi auto. Ti do il testo di una mail di conferma del sito ordini di un magazzino di ricambi. Estrai se è un preventivo o un ordine, il numero, il cliente (solo se indicato), la data e l\'elenco dei pezzi con codice esatto, descrizione e quantità. Non inventare nulla: lascia vuoto ciò che non c\'è. Oggi è ' + td + '.',
      tools: [TOOL], tool_choice: { type: 'tool', name: 'registra_documento' }, messages: [{ role: 'user', content: ed.text }]
    });
    var tu = (data.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
    if (!tu) throw new Error('Non sono riuscito a leggere la mail. Controlla di aver incollato il testo completo.');
    return tu.input || {};
  }
  function fromRead(o) {
    var d = blank(), dt = /^\d{4}-\d{2}-\d{2}$/.test(o.data || '') ? o.data : H.today();
    d.tipo = o.tipo === 'ordine' ? 'ordine' : 'preventivo'; d.stato = d.tipo === 'ordine' ? 'ordinato' : 'mandato';
    d.numero = String(o.numero || '').trim(); d.cliente = String(o.cliente || '').trim(); d.data = dt; d.note = String(o.note || '').trim();
    d.richiamo = d.stato === 'mandato' ? H.C.addWorkDays(dt < H.today() ? H.today() : dt, 3) : '';
    d.righe = (o.righe || []).filter(function (p) { return p && p.codice; }).map(function (p) { return { cod: String(p.codice).trim(), desc: String(p.descrizione || '').trim(), qta: String(p.quantita || '1').trim() }; });
    if (!d.righe.length) d.righe = [{ cod: '', desc: '', qta: '1' }];
    return d;
  }

  function save() {
    var d = ed.d; d.cliente = d.cliente.trim();
    d.righe = d.righe.filter(function (p) { return p.cod.trim() || p.desc.trim(); });
    if (!d.cliente) { H.toast('Scrivi il nome del cliente'); if (!d.righe.length) d.righe = [{ cod: '', desc: '', qta: '1' }]; draw(); return; }
    if (!d.righe.length) { H.toast('Aggiungi almeno un pezzo'); d.righe = [{ cod: '', desc: '', qta: '1' }]; draw(); return; }
    d.tipo = d.stato === 'mandato' || d.stato === 'perso' ? 'preventivo' : (d.tipo || 'ordine');
    items()[d.id] = JSON.parse(JSON.stringify(d)); H.markDirty('prev'); close(); H.render(); H.toast('Salvato');
  }

  PV.click = function (a, t) {
    switch (a) {
      case 'pv-flt': flt = t.dataset.f; H.render(); break;
      case 'pv-paste': ed = { mode: 'paste', text: '', err: '' }; draw(); break;
      case 'pv-new': openEdit(blank(), true); break;
      case 'pv-close': close(); break;
      case 'pv-open': var it = items()[t.dataset.id]; if (it) openEdit(JSON.parse(JSON.stringify(it)), false); break;
      case 'pv-addp': ed.d.righe.push({ cod: '', desc: '', qta: '1' }); draw(); break;
      case 'pv-delp': ed.d.righe.splice(+t.dataset.i, 1); if (!ed.d.righe.length) ed.d.righe.push({ cod: '', desc: '', qta: '1' }); draw(); break;
      case 'pv-save': save(); break;
      case 'pv-del': if (confirm('Eliminare questo preventivo?')) { delete items()[ed.d.id]; H.markDirty('prev'); close(); H.render(); H.toast('Eliminato'); } break;
      case 'pv-read':
        if (!ed.text || ed.text.trim().length < 20) { ed.err = 'Incolla prima il testo della mail.'; draw(); break; }
        busy = true; ed.err = ''; draw();
        read().then(function (o) {
          busy = false; var d = fromRead(o), dup = d.numero ? Object.keys(items()).filter(function (k) { return items()[k].numero === d.numero; })[0] : '';
          if (dup) { openEdit(JSON.parse(JSON.stringify(items()[dup])), false, 'Questo numero era già registrato: ho aperto quello.'); return; }
          openEdit(d, true, 'Controlla che sia tutto giusto, poi salva.');
        }).catch(function (e) { busy = false; if (ed) { ed.err = e.message; draw(); } });
        break;
    }
  };
  PV.change = function (t) {
    if (!ed || !ed.d) return; var k = t.dataset.pv;
    if (k === 'stato') { ed.d.stato = t.value; if (t.value === 'mandato' && !ed.d.richiamo) ed.d.richiamo = H.C.addWorkDays(H.today(), 3); }
    else if (k === 'data' || k === 'richiamo') ed.d[k] = t.value;
  };
  PV.input = function (t) {
    var k = t.dataset.pv;
    if (k === 'text' && ed) { ed.text = t.value; return; }
    if (!ed || !ed.d) return;
    if (k === 'cliente' || k === 'numero' || k === 'note') ed.d[k] = t.value;
    else if (k === 'cod' || k === 'desc' || k === 'qta') ed.d.righe[+t.dataset.i][k] = t.value;
  };
  PV.init = function (host) { H = host; };
})();
