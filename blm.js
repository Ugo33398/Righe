/* BLM Compila - generato dall app */
(function(){
var blm = function blm() {
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
      var b = box('BLM Compila', ['Tocca Incolla e compila. Se Safari mostra la scritta Incolla, toccala.'], true);
      function go(t) { var o = parse(t); if (o) { b.o.remove(); fin = true; run(o); return true; } return false; }
      b.btn('Incolla e compila', function () {
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(function (t) { if (!go(t)) alert('Negli appunti non c e una bozza valida: nell app tocca Compila la pagina ordini.'); }, function () { alert('Safari non ha dato accesso agli appunti: tieni premuto nel campo bianco e scegli Incolla.'); });
        } else alert('Tieni premuto nel campo bianco e scegli Incolla.');
      });
      b.btn('Compila', function () { if (!go(b.ta.value)) alert('Bozza non valida: copiala di nuovo dall app.'); });
      b.btn('Chiudi', function () { b.o.remove(); });
      b.ta.addEventListener('paste', function () { setTimeout(function () { go(b.ta.value); }, 60); });
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
  };
blm();
})();
