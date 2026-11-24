/* Righe — funzioni con l'intelligenza artificiale (API di Anthropic). La chiave resta solo su questo dispositivo. */
(function () {
  'use strict';
  var AI = window.RigheAI = {}, H = null;
  var MODEL = 'claude-sonnet-5-5', URL_API = 'https://api.anthropic.com/v1/messages';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var st = { text: '', img: null, busy: false, res: null, err: '' };

  function key() { try { return localStorage.getItem('righeAIKey') || ''; } catch (e) { return ''; } }
  function setKey(k) { try { if (k) localStorage.setItem('righeAIKey', k); else localStorage.removeItem('righeAIKey'); } catch (e) { /* ignore */ } }
  function esc(s) { return H.esc(s); }

  async function call(body) {
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 90000), r;
    try {
      r = await fetch(URL_API, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Ci mette troppo: riprova tra poco.' : 'Non riesco a raggiungere il servizio. Controlla la rete e riprova.');
    } finally { clearTimeout(to); }
    if (!r.ok) {
      var msg = r.status === 401 ? 'La chiave non è valida. Controllala in Impostazioni.' : r.status === 403 ? 'La chiave non ha il permesso di usare questo servizio.' : r.status === 429 ? 'Troppe richieste in poco tempo: aspetta un minuto.' : r.status === 400 ? 'Richiesta rifiutata (controlla il credito disponibile nella Console di Anthropic).' : 'Il servizio non risponde (' + r.status + '). Riprova più tardi.';
      var e2 = new Error(msg); e2.status = r.status; throw e2;
    }
    return r.json();
  }

  /* ----------------------------------------------------------- impostazioni */
  AI.settingsHtml = function () {
    var k = key();
    return '<div class="card pad" style="margin-top:14px"><b>Intelligenza artificiale</b><p class="muted tiny">Serve per le funzioni che leggono testi e foto (per ora: «Leggi risposta» nelle Righe). Incolla qui la tua chiave API di Anthropic: resta solo su questo dispositivo, non viene sincronizzata né inserita nei backup. Le richieste costano pochi centesimi.</p>' +
      (k ? '<div class="muted tiny" style="margin:6px 0">Chiave salvata: …' + esc(k.slice(-4)) + '</div>' : '') +
      '<div class="field"><label for="aikey">Chiave API</label><input class="in" id="aikey" data-ai="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…"></div>' +
      '<div class="acts"><button class="btn small primary" data-act="ai-savekey">Salva e verifica</button>' + (k ? '<button class="btn small danger" data-act="ai-delkey">Rimuovi chiave</button>' : '') + '</div><div id="aimsg" class="muted tiny" style="margin-top:8px" aria-live="polite"></div></div>';
  };
  async function saveKey() {
    var el = $('#aikey'), v = el ? el.value.trim() : '', msg = $('#aimsg');
    if (!v) { if (msg) msg.textContent = 'Incolla prima la chiave.'; return; }
    if (v.indexOf('sk-ant-') !== 0) { if (msg) msg.textContent = 'Non sembra una chiave di Anthropic: di solito inizia con «sk-ant-».'; return; }
    setKey(v); if (msg) msg.textContent = 'Verifico…';
    try { await call({ model: MODEL, max_tokens: 8, messages: [{ role: 'user', content: 'Rispondi solo: ok' }] }); H.toast('Chiave salvata e funzionante', 3200); H.render(); }
    catch (e) { if (e.status === 401) setKey(''); if ($('#aimsg')) $('#aimsg').textContent = e.message; }
  }

  /* -------------------------------------------------------- leggi risposta */
  function openRows() {
    var rows = [], k, cut = H.C.cutoffISO(H.today());
    for (k in H.ST.rows) { var r = H.ST.rows[k]; if (r.present && !r.archiviata && r.dataOC >= cut) rows.push(r); }
    return rows;
  }
  function loadImg(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('immagine non leggibile')); }; im.src = u;
    });
  }
  async function shrink(file) {
    var im = await loadImg(file), w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k); var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  var TOOL = {
    name: 'registra_arrivi',
    description: 'Registra cosa dice il magazzino su ciascuna riga d\'ordine.',
    input_schema: {
      type: 'object',
      properties: {
        riassunto: { type: 'string', description: 'Una frase in italiano su cosa hai capito.' },
        aggiornamenti: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string', description: 'L\'id esatto della riga, come nell\'elenco.' },
          tipo: { type: 'string', enum: ['confermato', 'stimato', 'non_disponibile', 'ritardo'] },
          data: { type: 'string', description: 'Data di arrivo in formato AAAA-MM-GG, se c\'è.' },
          nota: { type: 'string', description: 'Dettaglio utile in italiano, breve (facoltativo).' }
        }, required: ['id', 'tipo'] } },
        non_trovati: { type: 'array', items: { type: 'string' }, description: 'Pezzi citati nel messaggio che non corrispondono a nessuna riga dell\'elenco.' }
      },
      required: ['riassunto', 'aggiornamenti', 'non_trovati']
    }
  };
  async function analyze() {
    var rows = openRows(), td = H.today(), dn = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'][new Date(td + 'T12:00:00').getDay()];
    var list = rows.map(function (r) { return [r.id, r.marchio, r.referenza, String(r.descrizione || '').slice(0, 40), String(r.cliente || '').slice(0, 26), H.C.pulisciRif(r.riferimento).slice(0, 18), 'q' + r.quantita].join(' | '); }).join('\n');
    var content = [];
    if (st.img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: st.img } });
    content.push({ type: 'text', text: 'Oggi è ' + dn + ' ' + td + '.\n\nRIGHE D\'ORDINE APERTE (id | marchio | codice | descrizione | cliente | veicolo | quantità):\n' + list + '\n\nRISPOSTA DEL MAGAZZINO:\n' + (st.text.trim() || '(vedi immagine)') });
    var data = await call({
      model: MODEL, max_tokens: 4000,
      system: 'Aiuti un rappresentante di ricambi auto. Ti do l\'elenco delle righe d\'ordine aperte e la risposta di un magazzino sulla disponibilità o sulla data di arrivo dei pezzi. Associa ogni informazione alla riga giusta e registrala con lo strumento. Regole: confronta i codici ignorando spazi, trattini e punti; se il messaggio non cita i codici ma solo descrizione, cliente o veicolo, abbina solo se è inequivocabile; non inventare mai righe, id o date; se un pezzo citato non è nell\'elenco, mettilo in non_trovati. Le date relative (domani, giovedì, tra 3 giorni, la prossima settimana) calcolale da oggi, contando solo giorni lavorativi lunedì-venerdì quando il magazzino parla di giorni lavorativi. Tipo: «confermato» se il magazzino dà una data certa; «stimato» se è indicativa (entro, circa, verso, di solito); «non_disponibile» se dice che non c\'è o non è reperibile, senza data; «ritardo» se dice che è in ritardo senza una nuova data. Se la stessa risposta vale per più righe (es. «tutto Volvo arriva giovedì»), registra ogni riga interessata. Usa sempre lo strumento una sola volta.',
      tools: [TOOL], tool_choice: { type: 'tool', name: 'registra_arrivi' }, messages: [{ role: 'user', content: content }]
    });
    var tu = (data.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
    if (!tu) throw new Error('Non sono riuscito a leggere la risposta. Riprova o scrivila più chiara.');
    var out = tu.input || {}, byId = {}; rows.forEach(function (r) { byId[r.id] = r; });
    var items = (out.aggiornamenti || []).filter(function (u) { return byId[u.id]; }).map(function (u) {
      var d = /^\d{4}-\d{2}-\d{2}$/.test(u.data || '') ? u.data : '';
      return { id: u.id, tipo: u.tipo, data: d, nota: u.nota || '', on: true };
    });
    return { riassunto: out.riassunto || '', items: items, nonTrovati: out.non_trovati || [], scartati: (out.aggiornamenti || []).length - items.length };
  }

  function dlg(inner) { H.L2().innerHTML = '<div class="veil center"><div class="dlg" role="dialog" aria-modal="true" aria-label="Leggi risposta">' + inner + '</div></div>'; }
  var TIPO = { confermato: ['Confermato', 'green'], stimato: ['Stimato', 'amber'], non_disponibile: ['Non disponibile', 'red'], ritardo: ['In ritardo', 'red'] };
  function render() {
    var head = '<div class="sh-head"><div><h3>Leggi risposta del magazzino</h3><div class="muted tiny">Incolla il messaggio o carica una foto: aggiorno io le date di arrivo.</div></div><button class="x" data-act="ai-close" aria-label="Chiudi">×</button></div>';
    if (!key()) { dlg(head + '<div class="banner info"><div>Per usare questa funzione serve la chiave API, da inserire una volta sola in Impostazioni.</div></div><div class="acts"><button class="btn primary" data-act="ai-tosettings">Vai alle Impostazioni</button></div>'); return; }
    if (st.busy) { dlg(head + '<div class="empty" style="padding:30px"><b>Sto leggendo…</b>Ci vogliono pochi secondi.</div>'); return; }
    if (st.res) {
      var r = st.res, rows = H.ST.rows, n = r.items.filter(function (x) { return x.on; }).length;
      dlg(head + (r.riassunto ? '<p style="margin:4px 0 12px">' + esc(r.riassunto) + '</p>' : '') +
        (r.items.length ? r.items.map(function (x, i) {
          var row = rows[x.id], t = TIPO[x.tipo] || TIPO.stimato, needsDate = x.tipo === 'confermato' || x.tipo === 'stimato';
          return '<div class="airow' + (x.on ? '' : ' off') + '"><label class="aick"><input type="checkbox" data-ai="on" data-i="' + i + '"' + (x.on ? ' checked' : '') + '><span><b class="ref">' + esc(row.referenza) + '</b> · ' + esc(String(row.descrizione || '').slice(0, 44)) + '<br><span class="muted tiny">' + esc(row.marchio) + ' · ' + esc(row.cliente) + '</span></span></label>' +
            '<div class="aiin"><span class="tag ' + t[1] + '">' + t[0] + '</span>' + (needsDate || x.data ? '<input class="in" type="date" data-ai="date" data-i="' + i + '" value="' + esc(x.data) + '" aria-label="Data di arrivo">' : '') + '</div>' + (x.nota ? '<div class="muted tiny" style="margin-top:4px">' + esc(x.nota) + '</div>' : '') + '</div>';
        }).join('') : '<div class="empty card" style="padding:18px"><b>Nessuna riga riconosciuta</b>Prova con il messaggio completo, che contenga i codici dei pezzi.</div>') +
        (r.nonTrovati.length ? '<div class="banner warn" style="margin-top:12px"><div><b>Non trovati nelle tue righe:</b> ' + esc(r.nonTrovati.join(', ')) + '</div></div>' : '') +
        '<div class="acts" style="margin-top:14px"><button class="btn primary" data-act="ai-apply"' + (n ? '' : ' disabled') + '>Applica (' + n + ')</button><button class="btn" data-act="ai-back">Indietro</button></div>'); return;
    }
    dlg(head + (st.err ? '<div class="banner bad"><div>' + esc(st.err) + '</div></div>' : '') +
      '<div class="field"><label for="aitxt">Messaggio del magazzino</label><textarea class="in" id="aitxt" data-ai="text" rows="6" placeholder="Incolla qui, per esempio: «31407946 arriva giovedì, 31109033 non disponibile»">' + esc(st.text) + '</textarea></div>' +
      '<div class="field"><label>Oppure una foto</label><div class="acts"><label class="btn small" for="aiimg">' + (st.img ? 'Cambia foto' : 'Scegli o scatta una foto') + '</label>' + (st.img ? '<span class="tag green">foto caricata</span><button class="btn small ghost" data-act="ai-noimg">Togli</button>' : '') + '</div><input type="file" id="aiimg" data-ai="img" accept="image/*" hidden></div>' +
      '<p class="muted tiny">Il testo (o la foto) e l’elenco dei pezzi ancora aperti vengono inviati all’API di Anthropic con la tua chiave.</p>' +
      '<div class="acts"><button class="btn primary" data-act="ai-run">Leggi</button></div>');
  }
  function apply() {
    var n = 0, today = H.today();
    st.res.items.forEach(function (x) {
      if (!x.on) return; var r = H.ST.rows[x.id]; if (!r) return;
      var p = {}, stamp = today.slice(8, 10) + '/' + today.slice(5, 7), add = function (t) { p.note = ((p.note !== undefined ? p.note : r.note) ? (p.note !== undefined ? p.note : r.note) + '\n' : '') + '[' + stamp + '] ' + t; };
      if (x.tipo === 'confermato' && x.data) { p.stato = 'arrivo_confermato'; p.eta = x.data; p.etaConf = x.data; }
      else if ((x.tipo === 'stimato' || x.tipo === 'ritardo') && x.data) p.eta = x.data;
      else if (x.tipo === 'non_disponibile') add('Magazzino: non disponibile' + (x.nota ? ' (' + x.nota + ')' : ''));
      else if (x.tipo === 'ritardo') add('Magazzino: in ritardo' + (x.nota ? ' (' + x.nota + ')' : ''));
      if (x.nota && x.data && p.note === undefined) add(x.nota);
      if (Object.keys(p).length) { H.updateRow(x.id, p, true); n++; }
    });
    st.res = null; st.text = ''; st.img = null; H.L2().innerHTML = ''; H.render(); H.toast(n + (n === 1 ? ' riga aggiornata' : ' righe aggiornate'), 3200);
  }

  /* ------------------------------------------------------- cosa faccio oggi */
  var plan = { busy: false, err: '' };
  function cached() { try { var o = JSON.parse(localStorage.getItem('righeAIOggi') || 'null'); return o && o.d === H.today() ? o.t : ''; } catch (e) { return ''; } }
  function nice(t) { return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/^[-•*]\s+/gm, '• ').replace(/\n/g, '<br>'); }
  AI.todayHtml = function () {
    var t = cached();
    return '<div class="card pad aiplan"><div class="nhead" style="margin:0 0 6px"><b>Cosa faccio oggi</b><button class="btn small' + (t ? '' : ' primary') + '" data-act="ai-today"' + (plan.busy ? ' disabled' : '') + '>' + (plan.busy ? 'Sto pensando…' : t ? 'Aggiorna' : 'Preparami la giornata') + '</button></div>' +
      (plan.err ? '<div class="banner bad" style="margin:8px 0 0"><div>' + esc(plan.err) + '</div></div>' : '') +
      (t ? '<div class="aitxt">' + nice(t) + '</div>' : '<p class="muted tiny" style="margin:0">Un riepilogo di cosa conviene fare adesso, scritto dall’intelligenza artificiale in base ai tuoi dati.</p>') + '</div>';
  };
  function C0() { return H.C; }
  function lastSol(r) { var s = (r.solleciti || []).filter(function (x) { return x.inviato; }); return s.length ? String(s[s.length - 1].tInv || '').slice(0, 10) : ''; }

  /* ------------------------------------------------- scheda prima della visita */
  var sch = {};
  function schCache() { try { var o = JSON.parse(localStorage.getItem('righeAIScheda') || 'null'); return o && o.d === H.today() ? o.m : {}; } catch (e) { return {}; } }
  function schSave(nm, t) { var m = schCache(); m[nm] = t; try { localStorage.setItem('righeAIScheda', JSON.stringify({ d: H.today(), m: m })); } catch (e) { /* ignore */ } }
  function lateOf(nm) {
    var td = H.today(), cut = H.C.cutoffISO(td), out = [], k;
    for (k in H.ST.rows) {
      var r = H.ST.rows[k];
      if (r.cliente !== nm || !r.present || r.archiviata || r.dataOC < cut || !H.C.isOltre(r, td)) continue;
      var e = H.C.estimate(r);
      out.push({ r: r, giorni: H.C.daysBetween(e.to, td), eta: H.C.daysBetween(r.dataOC, td), to: e.to, sol: lastSol(r) });
    }
    return out.sort(function (a, b) { return b.giorni - a.giorni || a.r.dataOC.localeCompare(b.r.dataOC); });
  }
  function lateItem(x) {
    var r = x.r;
    return '<div class="sl"><div class="sl1"><b class="num">' + esc(r.referenza) + '</b> <span class="muted">' + esc(r.descrizione) + '</span></div>' +
      '<div class="sl2 tiny">' + esc(r.marchio) + ' · ordinato ' + x.eta + ' gg fa · <b class="redt">' + x.giorni + (x.giorni === 1 ? ' giorno' : ' giorni') + ' oltre</b> (era previsto entro ' + H.C.fmtShort(x.to) + ') · ' + (x.sol ? 'sollecitato il ' + H.C.fmtShort(x.sol) : '<b>mai sollecitato</b>') + '</div></div>';
  }
  AI.schedaHtml = function (nm) {
    var late = lateOf(nm), t = (schCache())[nm], b = sch[nm] || {};
    if (!late.length) return '<div class="sch" data-cli="' + esc(nm) + '"><div class="sch-ok">Nessun pezzo oltre il tempo previsto.</div></div>';
    var first = late.slice(0, 5), rest = late.slice(5);
    return '<div class="sch" data-cli="' + esc(nm) + '"><div class="sch-h"><b>Prima della visita</b><button class="btn small' + (t ? '' : ' primary') + '" data-act="ai-sch" data-cli="' + esc(nm) + '"' + (b.busy ? ' disabled' : '') + '>' + (b.busy ? 'Sto pensando…' : t ? 'Aggiorna' : 'Riassunto') + '</button></div>' +
      (b.err ? '<div class="banner bad" style="margin:6px 0"><div>' + esc(b.err) + '</div></div>' : '') +
      (t ? '<div class="aitxt sch-t">' + nice(t) + '</div>' : '') +
      '<div class="sch-l"><div class="muted tiny" style="margin-bottom:4px">' + late.length + (late.length === 1 ? ' pezzo in ritardo' : ' pezzi in ritardo') + ', dal più ritardato</div>' + first.map(lateItem).join('') +
      (rest.length ? '<details class="sch-more"><summary>Mostra altri ' + rest.length + '</summary>' + rest.map(lateItem).join('') + '</details>' : '') + '</div></div>';
  };
  function schRefresh(nm) {
    Array.prototype.slice.call(document.querySelectorAll('.sch')).forEach(function (el) { if (el.dataset.cli === nm) { var d = document.createElement('div'); d.innerHTML = AI.schedaHtml(nm); el.replaceWith(d.firstChild); } });
  }
  function schDigest(nm) {
    var late = lateOf(nm), td = H.today(), out = ['Oggi è ' + td + '. Cliente: ' + nm + '. Pezzi oltre il tempo previsto: ' + late.length + '.'];
    late.slice(0, 40).forEach(function (x) { out.push('- ' + x.r.marchio + ', ordinato ' + x.eta + ' giorni fa, ' + x.giorni + ' giorni oltre la stima' + (x.r.priorita !== 'normale' ? ', priorità ' + x.r.priorita : '') + (x.sol ? ', sollecitato il ' + x.sol : ', mai sollecitato')); });
    var notes = Object.values(H.ST.notes || {}).filter(function (n) { return !n.fatto && n.cliente === nm; });
    if (notes.length) out.push('Promemoria aperti su questo cliente: ' + notes.map(function (n) { return String(n.testo || '').slice(0, 80); }).join(' | '));
    return out.join('\n');
  }
  async function schMake(nm) {
    var data = await call({
      model: MODEL, max_tokens: 350,
      system: 'Sei l\'assistente di un rappresentante di ricambi auto che sta per andare in visita da un cliente. In italiano informale e diretto scrivi AL MASSIMO 2 righe (ognuna inizia con «• »): la situazione in numeri (quanti pezzi in ritardo, da quanto il più vecchio, quali marchi pesano di più, se è già stato sollecitato) e cosa conviene fare o dirgli. Usa solo i dati ricevuti, non inventare, non elencare i pezzi. Niente codici.',
      messages: [{ role: 'user', content: schDigest(nm) }]
    });
    return (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
  }

  function digest() {
    var td = H.today(), cut = H.C.cutoffISO(td), p2 = function (n) { return (n < 10 ? '0' : '') + n; }, d0 = new Date(), nowL = d0.getFullYear() + '-' + p2(d0.getMonth() + 1) + '-' + p2(d0.getDate()) + 'T' + p2(d0.getHours()) + ':' + p2(d0.getMinutes());
    var late = {}, arrToday = {}, k, out = [];
    for (k in H.ST.rows) {
      var r = H.ST.rows[k]; if (!r.present || r.archiviata || r.dataOC < cut) continue;
      var e = H.C.estimate(r);
      if (e && C0().isOltre(r, td)) {
        var l = late[r.cliente] || (late[r.cliente] = { n: 0, marchi: {}, old: '9', soll: '', pr: 0 });
        l.n++; l.marchi[r.marchio] = 1; if (r.dataOC < l.old) l.old = r.dataOC; var ls = lastSol(r); if (ls > l.soll) l.soll = ls; if (r.priorita !== 'normale') l.pr++;
      }
      if (e && e.from <= td && e.to >= td) { var a = arrToday[r.cliente] || (arrToday[r.cliente] = { n: 0, k: e.kind, to: e.to }); a.n++; }
    }
    out.push('Oggi è ' + td + '.');
    var notes = Object.values(H.ST.notes || {}).filter(function (n) { return !n.fatto && n.quando && (n.quando <= nowL || n.quando.slice(0, 10) === td); }).sort(function (a, b) { return a.quando.localeCompare(b.quando); });
    out.push('PROMEMORIA (scaduti o di oggi):\n' + (notes.length ? notes.map(function (n) { return '- ' + n.quando.replace('T', ' ') + ' · ' + (n.cliente || 'senza cliente') + ' · ' + String(n.testo || '').slice(0, 90) + (n.quando.slice(0, 10) < td ? ' (SCADUTO)' : ''); }).join('\n') : '(nessuno)'));
    var lc = Object.keys(late).sort(function (a, b) { return late[b].n - late[a].n; }).slice(0, 25);
    out.push('PEZZI OLTRE IL TEMPO PREVISTO, per cliente:\n' + (lc.length ? lc.map(function (c) { var x = late[c]; return '- ' + c + ': ' + x.n + ' pezzi (' + Object.keys(x.marchi).join('/') + '), ordine più vecchio ' + x.old + (x.soll ? ', ultimo sollecito ' + x.soll : ', mai sollecitato') + (x.pr ? ', ' + x.pr + ' con priorità alta' : ''); }).join('\n') : '(nessuno)'));
    var ac = Object.keys(arrToday).sort();
    out.push('PEZZI CHE POTREBBERO ARRIVARE OGGI:\n' + (ac.length ? ac.map(function (c) { return '- ' + c + ': ' + arrToday[c].n + (arrToday[c].k === 'conf' ? ' (confermato)' : ' (stimato entro ' + arrToday[c].to + ')'); }).join('\n') : '(nessuno)'));
    return out.join('\n\n');
  }
  async function makePlan() {
    var data = await call({
      model: MODEL, max_tokens: 900,
      system: 'Sei l\'assistente di un rappresentante di ricambi auto che ogni mattina chiede cosa fare. Scrivi un piano per la giornata in italiano informale e diretto, al massimo 8 righe, ognuna che inizia con «• ». Metti in ordine di priorità: prima i promemoria scaduti o di oggi (con orario), poi i solleciti più utili (clienti con più pezzi oltre il tempo previsto o ordini più vecchi, evitando chi è stato sollecitato da meno di 2 giorni), poi cosa può arrivare oggi. Per ogni punto dì cosa fare e perché, in poche parole. Usa **grassetto** solo per i nomi dei clienti. Non inventare dati e non elencare i pezzi uno per uno: di\' solo quanti sono. Se non c\'è nulla di urgente, dillo in una riga.',
      messages: [{ role: 'user', content: digest() }]
    });
    return (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
  }

  AI.click = function (a, t) {
    switch (a) {
      case 'ai-sch': {
        var nm = t.dataset.cli, b = sch[nm] = sch[nm] || {};
        if (!key()) { b.err = 'Per questa funzione serve la chiave API: inseriscila in Impostazioni.'; schRefresh(nm); break; }
        b.busy = true; b.err = ''; schRefresh(nm);
        schMake(nm).then(function (txt) { b.busy = false; if (!txt) b.err = 'Non ho ricevuto risposta: riprova.'; else schSave(nm, txt); schRefresh(nm); })
          .catch(function (e) { b.busy = false; b.err = e.message; schRefresh(nm); });
        break; }
      case 'ai-today':
        if (!key()) { plan.err = 'Per questa funzione serve la chiave API: inseriscila in Impostazioni.'; H.render(); break; }
        plan.busy = true; plan.err = ''; H.render();
        makePlan().then(function (txt) {
          plan.busy = false;
          if (!txt) plan.err = 'Non ho ricevuto risposta: riprova.'; else { try { localStorage.setItem('righeAIOggi', JSON.stringify({ d: H.today(), t: txt })); } catch (e) { /* ignore */ } }
          H.render();
        }).catch(function (e) { plan.busy = false; plan.err = e.message; H.render(); });
        break;
      case 'ai-open': st = { text: '', img: null, busy: false, res: null, err: '' }; render(); break;
      case 'ai-close': H.L2().innerHTML = ''; break;
      case 'ai-tosettings': H.L2().innerHTML = ''; H.setTab('impostazioni'); break;
      case 'ai-savekey': saveKey(); break;
      case 'ai-delkey': setKey(''); H.toast('Chiave rimossa'); H.render(); break;
      case 'ai-noimg': st.img = null; render(); break;
      case 'ai-back': st.res = null; render(); break;
      case 'ai-apply': apply(); break;
      case 'ai-run':
        if (!st.text.trim() && !st.img) { st.err = 'Incolla il messaggio o scegli una foto.'; render(); break; }
        st.err = ''; st.busy = true; render();
        analyze().then(function (r) { st.res = r; st.busy = false; render(); }).catch(function (e) { st.busy = false; st.err = e.message; render(); });
        break;
    }
  };
  AI.change = function (t) {
    var k = t.dataset.ai;
    if (k === 'img') { var f = t.files[0]; t.value = ''; if (f) shrink(f).then(function (b) { st.img = b; render(); }).catch(function () { H.toast('Foto non leggibile'); }); }
    else if (k === 'on') { st.res.items[+t.dataset.i].on = t.checked; render(); }
    else if (k === 'date') { st.res.items[+t.dataset.i].data = t.value; }
  };
  AI.input = function (t) { if (t.dataset.ai === 'text') st.text = t.value; };
  AI.init = function (host) { H = host; };
})();
