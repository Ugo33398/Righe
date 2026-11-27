/* BLM DASHBOARD — nuovo ordine da foto.
   L'AI legge libretto, targa, foto del mezzo e messaggio del cliente e prepara una bozza da rivedere.
   Un segnalibro di Safari (blm()) scrive poi la bozza nei campi della pagina ordini del magazzino. */
(function () {
  'use strict';
  var OD = window.RigheOrdine = {}, H = null, AI = null;
  var ORD_URL = 'https://ordini.bovioricambi.it/order', LS = 'righeOrdineBozza';
  var st = { imgs: [], text: '', busy: false, err: '', draft: null, help: false, go: false };

  function esc(s) { return H.esc(s); }
  function $(s, r) { return (r || document).querySelector(s); }
  try { var old = JSON.parse(localStorage.getItem(LS) || 'null'); if (old && old.draft) { st.draft = old.draft; st.text = old.text || ''; } } catch (e) { /* bozza non leggibile */ }
  function save() { try { localStorage.setItem(LS, JSON.stringify({ draft: st.draft, text: st.text })); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------ lettura con l'AI */
  var TOOL = {
    name: 'compila_ordine',
    description: 'Dati per compilare il modulo d\'ordine al magazzino.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['ordine', 'preventivo', 'incerto'] },
        ditta: { type: 'string', description: 'Cliente (carrozzeria/officina), scelto dall\'elenco noto solo se il messaggio lo indica chiaramente; altrimenti vuoto.' },
        marca: { type: 'string' }, modello: { type: 'string' },
        cilindrata: { type: 'string', description: 'Solo cifre, in cm3 (es. 1598).' },
        anno: { type: 'string', description: 'Anno della prima immatricolazione, AAAA.' },
        targa: { type: 'string' }, telaio: { type: 'string', description: 'Numero di telaio / VIN, 17 caratteri.' },
        righe: { type: 'array', items: { type: 'object', properties: {
          codice: { type: 'string', description: 'Solo se scritto dal cliente; altrimenti vuoto.' },
          descrizione: { type: 'string' }, quantita: { type: 'string' } }, required: ['descrizione'] } },
        note: { type: 'string', description: 'Indicazioni utili che non entrano nei campi (colore, lato, urgenza...).' },
        verifica: { type: 'array', items: { type: 'string', enum: ['ditta', 'marca', 'modello', 'cilindrata', 'anno', 'targa', 'telaio', 'righe'] }, description: 'Campi di cui non sei sicuro.' },
        dubbi: { type: 'array', items: { type: 'string' }, description: 'Cosa non si legge o non è chiaro, in italiano e in breve.' }
      },
      required: ['tipo', 'righe', 'verifica', 'dubbi']
    }
  };
  var SYS = 'Aiuti un rappresentante di ricambi auto italiano (BLM Bovio Ricambi). Ti arrivano foto e/o testo mandati da un cliente (carrozzeria o officina): libretto/carta di circolazione, targa, foto del veicolo, foto di pezzi o danni, screenshot di chat, elenchi di pezzi. ' +
    'Estrai i dati per compilare il modulo d\'ordine al magazzino. NON inventare: se un dato non c\'è o non si legge, lascialo vuoto e scrivilo nei dubbi. ' +
    'Libretto italiano: targa (A), prima immatricolazione (B, prendi l\'anno), marca (D.1), modello/tipo commerciale (D.3 o D.2), telaio (E, 17 caratteri, mai le lettere I, O, Q), cilindrata (P.1, cm3). Se il telaio letto non ha 17 caratteri, segnalalo nei dubbi. ' +
    'Righe: una per pezzo richiesto; il codice solo se lo scrive il cliente; la descrizione in italiano tecnico chiaro con lato/posizione (es. «Paraurti anteriore», «Faro anteriore destro»); quantità 1 se non detta. ' +
    'tipo: «preventivo» se chiede prezzo, disponibilità o quanto costa; «ordine» se chiede di ordinare/mandare; altrimenti «incerto». Metti in «verifica» i campi di cui non sei certo.';

  function clients() {
    var seen = {}, out = [], k, r;
    for (k in H.ST.rows) { r = H.ST.rows[k]; if (r.cliente && !seen[r.cliente]) { seen[r.cliente] = 1; out.push(r.cliente); } }
    return out.sort();
  }
  function norm(d) {
    var up = function (s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    var dg = function (s) { return String(s == null ? '' : s).replace(/\D/g, ''); };
    var o = { tipo: d.tipo === 'preventivo' || d.tipo === 'ordine' ? d.tipo : 'incerto', ditta: String(d.ditta || ''), marca: String(d.marca || '').toUpperCase(), modello: String(d.modello || '').toUpperCase(),
      cilindrata: dg(d.cilindrata), anno: dg(d.anno).slice(0, 4), targa: up(d.targa), telaio: up(d.telaio), note: String(d.note || ''), verifica: d.verifica || [], dubbi: d.dubbi || [],
      righe: (d.righe || []).map(function (r) { return { codice: String(r.codice || '').trim(), descrizione: String(r.descrizione || '').trim(), quantita: dg(r.quantita) || '1' }; }) };
    if (!o.righe.length) o.righe.push({ codice: '', descrizione: '', quantita: '1' });
    return o;
  }
  async function read() {
    var content = [];
    st.imgs.forEach(function (im) { content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.b64 } }); });
    content.push({ type: 'text', text: 'CLIENTI NOTI (per «ditta»):\n' + clients().slice(0, 250).join('; ') + '\n\nMESSAGGIO DEL CLIENTE:\n' + (st.text.trim() || '(solo foto)') + '\n\nCompila il modulo.' });
    var data = await AI.ask({ model: AI.model, max_tokens: 3000, system: SYS, tools: [TOOL], tool_choice: { type: 'tool', name: 'compila_ordine' }, messages: [{ role: 'user', content: content }] });
    var tu = (data.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
    if (!tu) throw new Error('Non sono riuscito a leggere le foto. Riprova con foto più nitide.');
    return norm(tu.input || {});
  }

  /* ----------------------------------------------------------------- schermata */
  function vinInfo(v) {
    if (!v) return '';
    var bad = /[IOQ]/.test(v) || v.length !== 17;
    return '<span id="od-vinn" class="' + (bad ? 'odbad' : 'odok') + '">' + v.length + '/17' + (bad ? (/[IOQ]/.test(v) ? ' · contiene I, O o Q' : ' · controlla') : ' ✓') + '</span>';
  }
  function fld(k, label, d, extra) {
    var w = d.verifica.indexOf(k) >= 0;
    return '<div class="odf' + (w ? ' warn' : '') + '"><label for="od-' + k + '">' + label + (w ? ' <i>da controllare</i>' : '') + '</label><input class="in" id="od-' + k + '" data-od="f" data-k="' + k + '" value="' + esc(d[k]) + '" autocomplete="off" autocapitalize="characters"' + (extra || '') + '></div>';
  }
  function draftHtml() {
    var d = st.draft; if (!d) return '';
    var rows = d.righe.map(function (r, i) {
      return '<div class="odr"><input class="in" data-od="r" data-i="' + i + '" data-k="codice" placeholder="Codice" value="' + esc(r.codice) + '" autocapitalize="characters"><input class="in odd" data-od="r" data-i="' + i + '" data-k="descrizione" placeholder="Descrizione" value="' + esc(r.descrizione) + '">' +
        '<input class="in odq" data-od="r" data-i="' + i + '" data-k="quantita" inputmode="numeric" value="' + esc(r.quantita) + '" aria-label="Quantità"><button class="x" data-act="od-del" data-i="' + i + '" aria-label="Togli la riga">×</button></div>';
    }).join('');
    var dubbi = d.dubbi.length ? '<div class="banner warn"><div><b>Da controllare:</b><br>' + d.dubbi.map(function (x) { return '• ' + esc(x); }).join('<br>') + '</div></div>' : '';
    return '<h2>Bozza da rivedere</h2>' + dubbi + '<div class="card pad odform">' +
      '<div class="odt">' + ['ordine', 'preventivo'].map(function (t) { return '<button class="chip" data-act="od-tipo" data-v="' + t + '" aria-pressed="' + (d.tipo === t) + '">' + (t === 'ordine' ? 'Ordine' : 'Preventivo') + '</button>'; }).join('') + (d.tipo === 'incerto' ? '<span class="tiny muted">non è chiaro: scegli tu</span>' : '') + '</div>' +
      '<div class="odf' + (d.verifica.indexOf('ditta') >= 0 ? ' warn' : '') + '"><label for="od-ditta">Ditta</label><input class="in" id="od-ditta" data-od="f" data-k="ditta" list="od-cli" value="' + esc(d.ditta) + '" autocomplete="off"><datalist id="od-cli">' + clients().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
      '<div class="odg">' + fld('marca', 'Marca', d) + fld('modello', 'Modello', d) + fld('cilindrata', 'Cilindrata', d, ' inputmode="numeric"') + fld('anno', 'Anno immatr.', d, ' inputmode="numeric" maxlength="4"') + fld('targa', 'Targa', d) + '</div>' +
      '<div class="odf' + (d.verifica.indexOf('telaio') >= 0 ? ' warn' : '') + '"><label for="od-telaio">N. telaio ' + vinInfo(d.telaio) + '</label><input class="in" id="od-telaio" data-od="f" data-k="telaio" value="' + esc(d.telaio) + '" autocomplete="off" autocapitalize="characters" maxlength="17"></div>' +
      '<div class="odf' + (d.verifica.indexOf('righe') >= 0 ? ' warn' : '') + '"><label>Pezzi' + (d.verifica.indexOf('righe') >= 0 ? ' <i>da controllare</i>' : '') + '</label>' + rows + '<button class="btn small" data-act="od-add">＋ Aggiungi riga</button></div>' +
      '<div class="odf"><label for="od-note">Note</label><textarea class="in" id="od-note" data-od="f" data-k="note" style="min-height:64px">' + esc(d.note) + '</textarea></div></div>' +
      '<div class="acts" style="margin-top:12px"><button class="btn primary" data-act="od-go">Compila la pagina ordini</button><button class="btn" data-act="od-copy">Copia la bozza</button><button class="btn" data-act="od-clear">Nuova bozza</button></div>' +
      (st.go ? goHtml() : '<p class="tiny muted" style="margin:8px 0 0">Controlla i campi e premi tu «Invia» sulla pagina del magazzino.</p>');
  }
  function goHtml() {
    return '<div class="banner" style="margin-top:12px"><div><b>Bozza copiata.</b> Ho provato ad aprire Safari da solo. Se non si è aperto, dall’app la pagina si aprirebbe in una finestra interna senza segnalibri. Fai così:<ol class="odsteps"><li>Apri <b>Safari</b> (l’icona normale, non questa app) e vai su <b>' + ORD_URL.replace('https://', '') + '</b>.</li><li>Accedi se serve, poi apri i segnalibri e tocca <b>BLM Compila</b>.</li><li>Se Safari chiede di incollare, tocca <b>Consenti incolla</b>. Controlla e premi tu <b>Invia</b>.</li></ol>' +
      '<div class="acts"><button class="btn small" data-act="od-url">Copia l’indirizzo della pagina</button><button class="btn small" data-act="od-open">Prova ad aprirla da qui</button></div></div></div>';
  }
  function helpHtml() {
    return '<h2>Segnalibro «BLM Compila» <span class="tiny muted">(una volta sola)</span></h2><div class="card pad">' +
      '<p class="tiny" style="margin:0 0 8px">Un segnalibro di Safari che scrive la bozza nei campi della pagina ordini. Non invia nulla.</p>' +
      '<button class="btn primary small" data-act="od-bm">Copia il segnalibro</button>' +
      '<ol class="odsteps"><li>Tocca <b>Copia il segnalibro</b>.</li><li>In Safari tocca Condividi → <b>Aggiungi segnalibro</b>, chiamalo <b>BLM Compila</b>, scegli <b>Preferiti</b> e Salva.</li><li>Apri i segnalibri (icona libro) → Preferiti → <b>Modifica</b> → apri «BLM Compila», cancella l’indirizzo, <b>incolla</b> quello copiato e premi Fine.</li><li>Uso: qui tocca <b>Compila la pagina ordini</b>; sulla pagina del magazzino apri i segnalibri e tocca <b>BLM Compila</b>.</li></ol>' +
      '<p class="tiny muted" style="margin:6px 0 0">Se un campo non si riempie, il segnalibro lo dice e ti dà «Copia diagnosi»: incollala qui in chat e lo sistemo.</p></div>';
  }
  OD.view = function () {
    var hasKey = AI.hasKey();
    return '<div class="nhead"><h1>Nuovo ordine</h1></div>' +
      '<p class="muted tiny" style="margin:0 0 10px">Carica libretto, targa, foto del mezzo e il messaggio del cliente: l’AI prepara la bozza dell’ordine. Le foto vengono inviate a Claude solo per leggerle e non restano salvate.</p>' +
      (hasKey ? '' : '<div class="banner warn"><div>Serve la chiave API: inseriscila in Impostazioni → Assistente AI.</div></div>') +
      '<div class="card pad"><div class="odth">' + st.imgs.map(function (im, i) { return '<div class="odth1"><img src="' + im.url + '" alt="Foto ' + (i + 1) + '"><button class="x" data-act="od-rm" data-i="' + i + '" aria-label="Togli la foto">×</button></div>'; }).join('') +
      '<label class="odadd" for="od-file">＋<span>Foto</span></label><input type="file" id="od-file" data-od="files" accept="image/*" multiple hidden></div>' +
      '<div class="odf"><label for="od-text">Messaggio del cliente</label><textarea class="in" id="od-text" data-od="text" placeholder="Incolla qui il messaggio (WhatsApp, mail…)">' + esc(st.text) + '</textarea></div>' +
      '<div class="acts"><button class="btn primary" data-act="od-read"' + (st.busy || !hasKey ? ' disabled' : '') + '>' + (st.busy ? 'Leggo…' : 'Leggi con l’AI') + '</button></div>' +
      (st.err ? '<p class="tiny" style="color:var(--bad);margin:8px 0 0">' + esc(st.err) + '</p>' : '') + '</div>' +
      draftHtml() +
      '<div class="acts" style="margin-top:14px"><button class="btn small" data-act="od-help">' + (st.help ? 'Nascondi le istruzioni del segnalibro' : 'Come installare il segnalibro') + '</button></div>' + (st.help ? helpHtml() : '');
  };

  /* --------------------------------------------------------------- bozza → pagina */
  function payload() {
    var d = st.draft;
    return { blm: 1, tipo: d.tipo, ditta: d.ditta, marca: d.marca, modello: d.modello, cilindrata: d.cilindrata, anno: d.anno, targa: d.targa, telaio: d.telaio, note: d.note,
      righe: d.righe.filter(function (r) { return r.codice || r.descrizione; }) };
  }
  function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  /* Questa funzione NON gira nell'app: diventa il segnalibro e gira sulla pagina del magazzino. Niente commenti e niente accenti nelle stringhe. */
  function blm() {
    var doc = document, miss = [], ok = 0;
    function q(s, r) { return [].slice.call((r || doc).querySelectorAll(s)); }
    function vis(e) { var r = e.getBoundingClientRect(); return !!(r.width || r.height); }
    function nm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function fields() {
      return q('input,textarea,select,[contenteditable=true]').filter(function (e) {
        var t = (e.type || '').toLowerCase();
        return ['hidden', 'radio', 'checkbox', 'file', 'button', 'submit', 'image', 'reset'].indexOf(t) < 0 && vis(e);
      });
    }
    function attrs(e) { return [e.name, e.id, e.placeholder, e.getAttribute('aria-label'), e.title, e.getAttribute('formcontrolname'), e.getAttribute('ng-model')].join(' '); }
    function put(e, v) {
      v = String(v == null ? '' : v);
      try { e.focus(); } catch (x) { x = null; }
      if (e.tagName === 'SELECT') {
        var o = [].slice.call(e.options).filter(function (p) { return nm(p.text).toLowerCase() === v.toLowerCase() || String(p.value).toLowerCase() === v.toLowerCase(); })[0];
        if (o) e.value = o.value;
      } else if (e.isContentEditable) {
        e.textContent = v;
      } else {
        var pr = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var d = Object.getOwnPropertyDescriptor(pr, 'value');
        if (d && d.set) d.set.call(e, v); else e.value = v;
      }
      ['input', 'change'].forEach(function (n) { e.dispatchEvent(new Event(n, { bubbles: true })); });
      e.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    function leafs() {
      return q('label,span,div,td,th,p,b,strong,legend,h1,h2,h3,h4,small,i').filter(function (e) { return e.children.length === 0 && nm(e.textContent).length > 0 && nm(e.textContent).length <= 26 && vis(e); });
    }
    function leaf(re) { return leafs().filter(function (e) { return re.test(nm(e.textContent)); })[0] || null; }
    function after(l, list) {
      for (var i = 0; i < list.length; i++) { if (!l.contains(list[i]) && (l.compareDocumentPosition(list[i]) & 4)) return list[i]; }
      return null;
    }
    function find(a, l) {
      var f = fields(), i;
      for (i = 0; i < f.length; i++) { if (a.test(attrs(f[i]))) return f[i]; }
      var lb = leaf(l);
      if (!lb) return null;
      if (lb.tagName === 'LABEL' && lb.htmlFor && doc.getElementById(lb.htmlFor)) return doc.getElementById(lb.htmlFor);
      return after(lb, f);
    }
    function head() {
      var f = fields(), out = [], i;
      for (i = 0; i < f.length; i++) { if (/^codice$/i.test(f[i].placeholder || '')) break; if ((f[i].type || '').toLowerCase() !== 'date') out.push(f[i]); }
      var ok7 = out.length === 7 && out[0].tagName === 'TEXTAREA' && out[1].type === 'text' && out[2].type === 'text' && out[3].type === 'number' && out[4].type === 'number' && out[5].type === 'text' && out[6].type === 'text';
      return ok7 ? { ditta: out[0], marca: out[1], modello: out[2], cilindrata: out[3], anno: out[4], targa: out[5], telaio: out[6] } : null;
    }
    function vin(v) {
      var hh = head();
      if (hh && hh.telaio.maxLength !== 1) { put(hh.telaio, v); return 1; }
      var f = fields(), lb = leaf(/telaio/i), seg = [], i;
      if (lb) {
        for (i = 0; i < f.length; i++) {
          if (!(lb.compareDocumentPosition(f[i]) & 4)) continue;
          if (f[i].maxLength === 1) seg.push(f[i]); else if (seg.length) break;
        }
      }
      if (seg.length >= 10) { for (i = 0; i < seg.length; i++) put(seg[i], v.charAt(i)); return seg.length; }
      var one = find(/telaio|vin/i, /telaio/i);
      if (one) { put(one, v); return 1; }
      return 0;
    }
    function box(title, lines, withInput) {
      var old = doc.getElementById('blm-ov'); if (old) old.remove();
      var o = doc.createElement('div'); o.id = 'blm-ov';
      o.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;background:#111;color:#fff;font:15px/1.4 -apple-system,sans-serif;padding:12px 14px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45)';
      var h = doc.createElement('b'); h.textContent = title; o.appendChild(h);
      lines.forEach(function (t) { var p = doc.createElement('div'); p.textContent = t; p.style.cssText = 'margin-top:4px;font-size:14px;opacity:.9'; o.appendChild(p); });
      var ta = null;
      if (withInput) { ta = doc.createElement('textarea'); ta.placeholder = 'Incolla qui la bozza'; ta.style.cssText = 'display:block;width:100%;height:80px;margin-top:8px;font-size:16px;border-radius:8px;padding:8px;box-sizing:border-box'; o.appendChild(ta); }
      var row = doc.createElement('div'); row.style.cssText = 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap'; o.appendChild(row);
      function btn(t, fn) { var b = doc.createElement('button'); b.textContent = t; b.style.cssText = 'font-size:15px;padding:9px 14px;border-radius:9px;border:0;background:#2f5be0;color:#fff;font-weight:600'; b.onclick = fn; row.appendChild(b); return b; }
      doc.body.appendChild(o);
      return { o: o, ta: ta, btn: btn };
    }
    function dump() {
      var ls = leafs(), f = fields();
      var campi = f.map(function (e) {
        var lab = '', i;
        for (i = ls.length - 1; i >= 0; i--) { if (ls[i].compareDocumentPosition(e) & 4) { lab = nm(ls[i].textContent); break; } }
        return { tag: e.tagName, tipo: e.type || '', id: e.id, name: e.name, ph: e.placeholder, max: e.maxLength > 0 ? e.maxLength : '', etichetta: lab };
      });
      var bt = q('button,a,input[type=button],input[type=submit]').filter(vis).map(function (e) { return nm(e.textContent || e.value || e.title); }).filter(Boolean).slice(0, 40);
      var rd = q('input[type=radio]').map(function (e) { return (e.name || '') + '=' + (e.value || '') + ' ' + nm(e.parentElement ? e.parentElement.textContent : ''); });
      return JSON.stringify({ diagnosi: 1, url: location.href.split('#')[0], titolo: doc.title, campi: campi, radio: rd, pulsanti: bt });
    }
    function report() {
      var lines = miss.length ? ['Non trovati: ' + miss.join(', ')] : ['Controlla i dati e premi Invia tu.'];
      var b = box('BLM: compilati ' + ok + ' campi', lines, false);
      b.btn('Chiudi', function () { b.o.remove(); });
      if (miss.length) {
        b.btn('Copia diagnosi', function () {
          var s = dump();
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(function () { alert('Diagnosi copiata: incollala nella chat.'); }, function () { prompt('Copia questo testo', s); });
          else prompt('Copia questo testo', s);
        });
      }
    }
    function fail(e) {
      var b = box('BLM: errore', [nm((e && e.message) || e)], false);
      b.btn('Chiudi', function () { b.o.remove(); });
      b.btn('Copia diagnosi', function () { var s = dump(); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(function () { alert('Diagnosi copiata: incollala nella chat.'); }, function () { prompt('Copia questo testo', s); }); else prompt('Copia questo testo', s); });
    }
    function run(d) { try { run2(d); } catch (e) { fail(e); } }
    function run2(d) {
      var map = [['ditta', /ditta/i, /^ditta$/i], ['marca', /marca/i, /^marca$/i], ['modello', /modello/i, /^modello$/i], ['cilindrata', /cilindr/i, /^cilindrata$/i], ['anno', /immatr|anno(?!taz)/i, /^anno\b/i], ['targa', /targa/i, /^targa$/i]];
      var H0 = head();
      map.forEach(function (m) {
        var v = d[m[0]];
        if (!v) return;
        var e = H0 ? H0[m[0]] : find(m[1], m[2]);
        if (e) { put(e, v); ok++; } else miss.push(m[0]);
      });
      if (d.telaio) { if (vin(d.telaio)) ok++; else miss.push('telaio'); }
      var rr = d.righe || [];
      if (rr.length) {
        var f = fields();
        var cod = f.filter(function (e) { return /codice/i.test(attrs(e)); });
        var des = f.filter(function (e) { return /descrizion/i.test(attrs(e)); });
        var qta = f.filter(function (e) { return /quant/i.test(attrs(e)); });
        var n = Math.min(rr.length, Math.max(cod.length, des.length)), i;
        for (i = 0; i < n; i++) {
          if (cod[i] && rr[i].codice) put(cod[i], rr[i].codice);
          if (des[i] && rr[i].descrizione) put(des[i], rr[i].descrizione);
          if (qta[i] && rr[i].quantita) put(qta[i], rr[i].quantita);
        }
        ok += n;
        if (!n) miss.push('righe'); else if (rr.length > n) miss.push('righe oltre la ' + n + 'a');
      }
      report();
    }
    function parse(t) { try { var o = JSON.parse(t); return o && o.blm === 1 ? o : null; } catch (e) { return null; } }
    function ask() {
      var b = box('BLM Compila', ['Non riesco a leggere la bozza dagli appunti.', 'Incollala qui sotto e tocca Compila.'], true);
      b.btn('Compila', function () { var o = parse(b.ta.value); if (o) { b.o.remove(); run(o); } else alert('Bozza non valida: copiala di nuovo dall’app.'); });
      b.btn('Chiudi', function () { b.o.remove(); });
    }
    var m = /blm=([A-Za-z0-9_-]+)/.exec(location.hash + location.search), D = null, fin = false;
    if (m) {
      try { var s = m[1].replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; D = parse(decodeURIComponent(escape(atob(s)))); } catch (e) { D = null; }
    }
    try {
      box('BLM Compila', ['Leggo la bozza...'], false);
      if (D) { fin = true; run(D); return; }
      var tm = setTimeout(function () { if (!fin) ask(); }, 1200);
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) { var o = parse(t); if (o && !fin) { fin = true; clearTimeout(tm); run(o); } else if (!fin) { clearTimeout(tm); ask(); } }, function () { if (!fin) { clearTimeout(tm); ask(); } });
      } else { clearTimeout(tm); ask(); }
    } catch (e) { fail(e); }
  }
  OD.bookmarklet = function () { return 'javascript:' + encodeURI('(' + blm.toString().replace(/\s+/g, ' ') + ')()').replace(/#/g, '%23'); };

  /* ------------------------------------------------------------------- azioni */
  function addFiles(list) {
    var fs = Array.prototype.slice.call(list || []).slice(0, Math.max(0, 6 - st.imgs.length));
    if (!fs.length) return;
    Promise.all(fs.map(function (f) { return AI.shrink(f).then(function (b64) { return { b64: b64, url: 'data:image/jpeg;base64,' + b64 }; }); }))
      .then(function (a) { st.imgs = st.imgs.concat(a); H.render(); })
      .catch(function () { st.err = 'Una foto non si legge: riprova.'; H.render(); });
  }
  OD.change = function (t) { if (t.dataset.od === 'files') { var l = t.files; addFiles(l); t.value = ''; } };
  OD.input = function (t) {
    var o = t.dataset.od, d = st.draft;
    if (o === 'text') { st.text = t.value; save(); return; }
    if (!d) return;
    if (o === 'f') {
      var k = t.dataset.k, v = t.value;
      if (k === 'targa' || k === 'telaio') { v = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (v !== t.value) t.value = v; }
      d[k] = v; var bx = t.closest('.odf'); if (bx) bx.classList.remove('warn');
      if (k === 'telaio') { var n = $('#od-vinn'); var bad = /[IOQ]/.test(v) || v.length !== 17; if (n) { n.className = bad ? 'odbad' : 'odok'; n.textContent = v.length + '/17' + (bad ? (/[IOQ]/.test(v) ? ' · contiene I, O o Q' : ' · controlla') : ' ✓'); } }
    } else if (o === 'r') { var r = d.righe[+t.dataset.i]; if (r) r[t.dataset.k] = t.dataset.k === 'quantita' ? t.value.replace(/\D/g, '') : t.value; }
    save();
  };
  OD.click = function (a, t) {
    var d = st.draft;
    switch (a) {
      case 'od-read': st.go = false;
        if (!st.imgs.length && !st.text.trim()) { st.err = 'Aggiungi almeno una foto o il messaggio del cliente.'; H.render(); break; }
        st.busy = true; st.err = ''; H.render();
        read().then(function (x) { st.busy = false; st.draft = x; save(); H.render(); })
          .catch(function (e) { st.busy = false; st.err = e.message || 'Lettura non riuscita.'; H.render(); });
        break;
      case 'od-rm': st.imgs.splice(+t.dataset.i, 1); H.render(); break;
      case 'od-tipo': if (d) { d.tipo = t.dataset.v; save(); H.render(); } break;
      case 'od-add': if (d) { d.righe.push({ codice: '', descrizione: '', quantita: '1' }); save(); H.render(); } break;
      case 'od-del': if (d) { d.righe.splice(+t.dataset.i, 1); if (!d.righe.length) d.righe.push({ codice: '', descrizione: '', quantita: '1' }); save(); H.render(); } break;
      case 'od-clear': st.go = false; st.draft = null; st.text = ''; st.imgs = []; st.err = ''; save(); H.render(); break;
      case 'od-help': st.help = !st.help; H.render(); break;
      case 'od-bm': H.copy(OD.bookmarklet()).then(function (ok) { H.toast(ok ? 'Segnalibro copiato: ora segui i passi qui sotto' : 'Copia non riuscita', 3500); }); break;
      case 'od-copy': if (d) H.copy(JSON.stringify(payload())).then(function (ok) { H.toast(ok ? 'Bozza copiata' : 'Copia non riuscita'); }); break;
      case 'od-go':
        if (!d) break;
        var js = JSON.stringify(payload());
        var sa = (window.navigator && window.navigator.standalone) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        H.copy(js).then(function (ok) {
          if (sa) {
            st.go = true; H.render(); H.toast(ok ? 'Apro Safari: tocca il segnalibro «BLM Compila»' : 'Copia non riuscita', 3500);
            try { OD.nav('x-safari-' + ORD_URL + '#blm=' + b64url(js)); } catch (e) { e = null; }
          }
          else { window.open(ORD_URL + '#blm=' + b64url(js), '_blank'); H.toast('Pagina aperta: tocca il segnalibro «BLM Compila»', 4500); }
        });
        break;
      case 'od-url': H.copy(ORD_URL).then(function (ok) { H.toast(ok ? 'Indirizzo copiato: incollalo in Safari' : 'Copia non riuscita'); }); break;
      case 'od-open': window.open(ORD_URL + '#blm=' + b64url(JSON.stringify(payload())), '_blank'); break;
    }
  };
  OD.nav = function (u) { window.location.href = u; };
  OD.init = function (host) { H = host; AI = window.RigheAI; };
})();
