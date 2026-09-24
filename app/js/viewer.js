/* Документ: показ страниц через pdf.js, размещение печатей/подписей/текста/замазки, выделение, перетаскивание, отмена. */
(function (O) {
  'use strict';
  const U = O.U, D = O.D, el = U.el; const V = {};
  const PX_PER_PT = 96 / 72;
  const MAX_CANVAS = 4096;

  V.doc = null; V.zoom = 1; V.fitMode = true; V.tool = 'select'; V.onChange = null;
  Object.defineProperty(V, 'scale', { get: () => V.zoom * PX_PER_PT });

  /* ── pdf.js без сети: таблицы кодировок и стандартные шрифты из встроенных данных ── */
  function BundledCMapReaderFactory() {}
  BundledCMapReaderFactory.prototype.fetch = function (o) {
    const b = window.OTTISK_CMAPS && window.OTTISK_CMAPS[o.name];
    if (!b) return Promise.reject(new Error('Нет таблицы кодировки ' + o.name));
    return Promise.resolve({ cMapData: U.b64ToU8(b), compressionType: pdfjsLib.CMapCompressionType.BINARY });
  };
  function BundledStandardFontDataFactory() {}
  BundledStandardFontDataFactory.prototype.fetch = function (o) {
    const b = window.OTTISK_STD_FONTS && window.OTTISK_STD_FONTS[o.filename];
    if (!b) return Promise.reject(new Error('Нет стандартного шрифта ' + o.filename));
    return Promise.resolve(U.b64ToU8(b));
  };
  V.loadPdf = function (bytes) {
    return pdfjsLib.getDocument({
      data: bytes.slice(), useSystemFonts: true, cMapPacked: true,
      CMapReaderFactory: BundledCMapReaderFactory, StandardFontDataFactory: BundledStandardFontDataFactory,
      isEvalSupported: true, disableAutoFetch: true
    }).promise;
  };

  /* ── Шрифты для текста на экране (те же, что попадут в PDF) ── */
  const measureCanvas = document.createElement('canvas'); const mctx = measureCanvas.getContext('2d');
  /* ключ шрифта → имя на экране; те же файлы уходят и в готовый PDF */
  V.FONT_FAMILY = { serif: 'LibSerif', sans: 'LibSans', hpen: 'LibHandPen', hcursive: 'LibHandCursive', hprint: 'LibHandPrint' };
  /* цвет чернил для текста: на экране и в PDF одинаковый */
  V.INKS = { black: '#1b1b1f', blue: '#1c3f94', violet: '#57399a' };
  V.isHand = f => String(f || '').charAt(0) === 'h';
  V.fontsReady = (async function () {
    try {
      if (!window.OTTISK_FONTS || !window.FontFace) return;
      const loaded = await Promise.all(Object.keys(V.FONT_FAMILY)
        .filter(k => window.OTTISK_FONTS[k])
        .map(k => new FontFace(V.FONT_FAMILY[k], U.b64ToU8(window.OTTISK_FONTS[k]).buffer).load()));
      loaded.forEach(f => document.fonts.add(f));
    } catch (e) { console.warn('Шрифты для текста не загрузились', e); }
  })();
  function measureText(e) {
    mctx.font = e.size + 'px ' + (V.FONT_FAMILY[e.font] || 'LibSerif');
    const lines = e.text.split('\n'); let w = 0; for (const l of lines) w = Math.max(w, mctx.measureText(l).width);
    e.pad = 2; e.w = Math.max(8, w + 2 * e.pad); e.h = lines.length * e.size * 1.2 + 2 * e.pad;
  }

  /* ── Открытие ── */
  /* Есть несохранённые печати/подписи — спросить, прежде чем закрыть документ */
  V.isDirty = () => !!(V.doc && V.doc.dirty && V.doc.elements.length);
  V.confirmLeave = async function () {
    if (!V.isDirty()) return true;
    return D.confirm(`На документе «${V.doc.name}» есть несохранённые печати или подписи. Открыть другой документ без сохранения?`, { title: 'Не сохранено', ok: 'Открыть без сохранения', danger: true });
  };
  V.openFile = async function (file) {
    if (!await V.confirmLeave()) return false;
    const name = file.name || 'документ';
    const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    if (ext === 'docx' && O.W && O.W.supported()) return V.openWord(file);
    if (ext === 'odt' && O.Z && O.Z.supported()) return V.openOdt(file);
    if (['doc', 'xls', 'xlsx', 'ods', 'rtf', 'ppt', 'pptx', 'odp', 'pages', 'numbers'].includes(ext)) { D.wordFile(name, ext); return false; }
    try {
      U.busy('Открываю документ…');
      const bytes = await U.fileToU8(file);
      if (ext === 'pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return await V.openPdf(bytes, U.stripExt(name), name);
      if (/^image\//.test(file.type) || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'].includes(ext)) return await V.openImage(bytes, file.type || 'image/' + ext, U.stripExt(name), name);
      D.wordFile(name, ext); return false;
    } catch (e) { console.error(e); U.toast('Не удалось открыть файл: ' + (e.message || e), true); return false; }
    finally { U.busy(null); }
  };
  /* Word → PDF внутри программы, затем обычная работа с PDF */
  V.openWord = async function (file) {
    try {
      U.busy('Перевожу Word в PDF…');
      const bytes = await O.W.convert(file);
      const ok = await V.openPdf(bytes, U.stripExt(file.name), file.name);
      if (ok) U.toast('Word переведён в PDF. Текст в нём — картинка, как после печати: править текст лучше в Word до перевода.');
      return ok;
    } catch (e) { console.error(e); U.toast('Не удалось перевести Word: ' + (e.message || e) + '. Сохраните его в Word как PDF.', true); return false; }
    finally { U.busy(null); }
  };
  /* LibreOffice (.odt) → PDF внутри программы */
  V.openOdt = async function (file) {
    try {
      U.busy('Перевожу документ LibreOffice в PDF…');
      const bytes = await O.Z.convert(file);
      const ok = await V.openPdf(bytes, U.stripExt(file.name), file.name);
      if (ok) U.toast('Документ переведён в PDF. Текст в нём стал картинкой; если вёрстка уехала — сохраните из LibreOffice в PDF (Файл → Экспорт в PDF).');
      return ok;
    } catch (e) {
      console.error(e);
      await D.alert('Не удалось открыть документ', U.el('div', null, [
        U.el('p', { text: '«' + file.name + '» не получилось разобрать: ' + (e.message || e) }),
        U.el('p', { text: 'Откройте его в LibreOffice и сохраните в PDF: Файл → Экспорт в PDF → Экспорт. Затем откройте PDF здесь.' })
      ]));
      return false;
    } finally { U.busy(null); }
  };
  V.openSample = async function () { if (!await V.confirmLeave()) return false; return V.openPdf(U.b64ToU8(window.OTTISK_SAMPLE_PDF), 'Договор_образец', 'Договор_образец.pdf'); };

  /* Фото или скан → одна страница PDF формата A4 */
  V.openImage = async function (bytes, mime, name, srcName) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    let img;
    if (/png/.test(mime)) img = await pdfDoc.embedPng(bytes);
    else if (/jpe?g/.test(mime)) img = await pdfDoc.embedJpg(bytes);
    else { // прочие форматы — через canvas в PNG
      const blob = new Blob([bytes], { type: mime }); const url = URL.createObjectURL(blob);
      const im = await U.loadImage(url); URL.revokeObjectURL(url);
      const c = O.IP.canvasFromImage(im, 3000); img = await pdfDoc.embedPng(U.dataUrlToU8(c.toDataURL('image/png')));
    }
    const A4 = [595.28, 841.89]; const landscape = img.width > img.height;
    const pw = landscape ? A4[1] : A4[0], ph = landscape ? A4[0] : A4[1];
    const page = pdfDoc.addPage([pw, ph]);
    const k = Math.min(pw / img.width, ph / img.height); const w = img.width * k, h = img.height * k;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    const out = await pdfDoc.save();
    return V.openPdf(out, name, srcName);
  };

  V.openPdf = async function (bytes, name, srcName) {
    U.busy('Открываю документ…');
    try {
      const pdf = await V.loadPdf(bytes);
      if (V.doc) closeDoc();
      const doc = { name, srcName: srcName || name, bytes, pdf, pages: [], elements: [], undo: [], sel: null, dirty: false };
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        doc.pages.push({ index: i - 1, page, vp1: page.getViewport({ scale: 1 }), renderedScale: 0, rendering: false, visible: false });
      }
      V.doc = doc;
      buildDom(); V.fitWidth(); V.select(null); changed(); doc.dirty = false;
      U.$('#dropzone').hidden = true; U.$('#pages').hidden = false;
      const bar = U.$('#docBar'); if (bar) { bar.hidden = false; U.$('#docName').textContent = doc.srcName; U.$('#docPages').textContent = doc.pages.length + ' стр.'; }
      document.title = doc.srcName + ' — Оттиск';
      if (O.F && O.F.renderDocs) O.F.renderDocs();
      return true;
    } catch (e) {
      console.error(e); U.toast('Не удалось прочитать PDF: ' + (e.message || e), true); return false;
    } finally { U.busy(null); }
  };
  function closeDoc() {
    try { V.doc.pdf.destroy(); } catch (e) {}
    if (io) io.disconnect(); U.$('#pages').innerHTML = ''; V.doc = null;
  }

  /* ── DOM страниц ── */
  let io = null, selbox = null;
  function buildDom() {
    const root = U.$('#pages'); root.innerHTML = '';
    io = new IntersectionObserver(entries => { entries.forEach(en => { const p = V.doc.pages[+en.target.dataset.i]; p.visible = en.isIntersecting; if (p.visible) renderPage(p); }); }, { root: U.$('#workspace'), rootMargin: '500px 0px' });
    V.doc.pages.forEach(p => {
      p.wrap = el('div', { class: 'page', 'data-i': p.index });
      p.canvas = el('canvas'); p.overlay = el('div', { class: 'overlay', 'data-i': p.index });
      p.wrap.append(p.canvas, p.overlay, el('div', { class: 'pnum', text: (p.index + 1) + ' / ' + V.doc.pages.length }));
      root.append(p.wrap); io.observe(p.wrap);
      bindOverlay(p);
    });
    selbox = el('div', { class: 'selbox', hidden: '' });
    ['nw', 'ne', 'sw', 'se', 'rot'].forEach(k => selbox.append(el('div', { class: 'h ' + k, 'data-k': k })));
    selbox.append(el('div', { class: 'tag' }));
    bindSelbox();
    layout();
  }
  function layout() {
    if (!V.doc) return; const s = V.scale;
    V.doc.pages.forEach(p => {
      p.wrap.style.width = Math.round(p.vp1.width * s) + 'px'; p.wrap.style.height = Math.round(p.vp1.height * s) + 'px';
      p.canvas.style.width = '100%'; p.canvas.style.height = '100%';
      U.$$('.el', p.overlay).forEach(n => styleEl(n, byId(n.dataset.id)));
    });
    U.$$('#zoomVal, .zoomval-m').forEach(n => { n.textContent = Math.round(V.zoom * 100) + '%'; });
    updateSelbox(); V.doc.pages.forEach(p => { if (p.visible) renderPage(p); });
  }
  async function renderPage(p) {
    const s = V.scale; if (p.renderedScale === s || p.rendering) return;
    p.rendering = true;
    try {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      let k = s * dpr; const maxSide = Math.max(p.vp1.width, p.vp1.height);
      if (maxSide * k > MAX_CANVAS) k = MAX_CANVAS / maxSide;
      const vp = p.page.getViewport({ scale: k });
      const off = document.createElement('canvas'); off.width = Math.round(vp.width); off.height = Math.round(vp.height);
      await p.page.render({ canvasContext: off.getContext('2d', { alpha: false }), viewport: vp }).promise;
      p.canvas.width = off.width; p.canvas.height = off.height; p.canvas.getContext('2d').drawImage(off, 0, 0);
      p.renderedScale = s;
    } catch (e) { if (e && e.name !== 'RenderingCancelledException') console.warn('Не удалось отрисовать страницу', e); }
    finally { p.rendering = false; if (p.visible && p.renderedScale !== V.scale) renderPage(p); }
  }

  /* ── Масштаб ── */
  V.setZoom = function (z, fromFit) { V.zoom = U.clamp(z, 0.25, 4); V.fitMode = !!fromFit; layout(); };
  V.fitWidth = function () {
    if (!V.doc) return; const ws = U.$('#workspace'); const maxW = Math.max.apply(null, V.doc.pages.map(p => p.vp1.width));
    const avail = Math.max(200, ws.clientWidth - 48); V.setZoom(Math.min(2, avail / (maxW * PX_PER_PT)), true);
  };
  V.currentPage = function () {
    if (!V.doc) return 0; const ws = U.$('#workspace'); const mid = ws.scrollTop + ws.clientHeight / 2; let best = 0, bd = Infinity;
    V.doc.pages.forEach(p => { const c = p.wrap.offsetTop + p.wrap.offsetHeight / 2; const d = Math.abs(c - mid); if (d < bd) { bd = d; best = p.index; } });
    return best;
  };

  /* ── Элементы ── */
  const byId = id => V.doc && V.doc.elements.find(e => e.id === id);
  V.byId = byId;
  function changed() { if (V.doc) V.doc.dirty = true; if (V.onChange) V.onChange(); }
  V.pushUndo = function () { if (!V.doc) return; V.doc.undo.push(JSON.stringify(V.doc.elements)); if (V.doc.undo.length > 60) V.doc.undo.shift(); };
  V.undo = function () {
    if (!V.doc || !V.doc.undo.length) return; V.doc.elements = JSON.parse(V.doc.undo.pop());
    V.doc.pages.forEach(p => { p.overlay.innerHTML = ''; });
    V.doc.elements.forEach(e => mount(e));
    if (V.doc.sel && !byId(V.doc.sel)) V.doc.sel = null; V.select(V.doc.sel); changed();
  };

  function mount(e) {
    const p = V.doc.pages[e.page]; if (!p) return;
    const n = el('div', { class: 'el ' + e.type + (e.type === 'text' ? ' ' + e.font : ''), 'data-id': e.id });
    if (e.type === 'image') n.append(el('img', { src: e.dataUrl, alt: e.name, draggable: 'false' }));
    p.overlay.append(n); styleEl(n, e);
    return n;
  }
  function styleEl(n, e) {
    if (!e) return; const s = V.scale;
    n.style.left = e.x * s + 'px'; n.style.top = e.y * s + 'px'; n.style.width = e.w * s + 'px'; n.style.height = e.h * s + 'px';
    n.style.transform = e.rot ? 'rotate(' + e.rot + 'deg)' : '';
    if (e.type === 'image') n.style.opacity = e.ink;
    if (e.type === 'text') {
      n.className = 'el text ' + e.font; n.style.fontSize = e.size * s + 'px'; n.style.lineHeight = (e.size * 1.2 * s) + 'px'; n.style.padding = (e.pad * s) + 'px';
      n.style.color = V.INKS[e.color] || V.INKS.black;
      n.innerHTML = ''; e.text.split('\n').forEach(l => n.append(el('div', { class: 'ln', text: l || ' ' })));
    }
  }
  V.refreshEl = function (e) { const n = nodeOf(e); if (n) styleEl(n, e); updateSelbox(); if (e && V.doc && V.doc.sel === e.id) syncProps(); };
  /* Цифры в панели «Свойства» всегда совпадают с тем, что на странице (кроме поля, которое сейчас редактируют) */
  let syncRaf = 0;
  function syncProps() {
    if (syncRaf) return;
    syncRaf = requestAnimationFrame(() => { syncRaf = 0; const body = U.$('#propsBody'); if (body && body.contains(document.activeElement)) return; renderProps(); });
  }
  const nodeOf = e => e && V.doc.pages[e.page] && V.doc.pages[e.page].overlay.querySelector('.el[data-id="' + e.id + '"]');

  V.add = function (e) { V.pushUndo(); V.doc.elements.push(e); mount(e); V.select(e.id); changed(); return e; };
  V.placeAsset = function (type, id, pageIndex, x, y) {
    const a = O.L.findAsset(type, id); if (!a || !V.doc) return null;
    const w = U.mm2pt(a.wMm), h = U.mm2pt(a.hMm);
    return V.add({ id: U.uid(), type: 'image', assetType: type, assetId: a.id, name: a.name, dataUrl: a.dataUrl, round: !!a.round, page: pageIndex, x: x - w / 2, y: y - h / 2, w, h, rot: 0, ink: 0.92 });
  };
  V.addWhiteout = function (pageIndex, x, y, w, h) { w = w || U.mm2pt(60); h = h || U.mm2pt(8); return V.add({ id: U.uid(), type: 'whiteout', page: pageIndex, x, y, w, h, rot: 0 }); };
  V.addText = function (pageIndex, x, y, text) {
    const font = V.lastFont || 'serif';
    // печатный текст всегда чёрный; цвет ручки запоминаем только для рукописного
    const color = V.isHand(font) ? (V.lastInk || 'blue') : 'black';
    const e = { id: U.uid(), type: 'text', page: pageIndex, x, y, w: 0, h: 0, rot: 0, text: text || 'Текст', font, color, size: V.lastSize || 12, pad: 2 };
    measureText(e); e.y -= e.h / 2; V.add(e); setTimeout(() => { const ta = U.$('#propText'); if (ta) { ta.focus(); ta.select(); } }, 30); return e;
  };
  V.remove = function (id) { const e = byId(id); if (!e) return; V.pushUndo(); V.doc.elements = V.doc.elements.filter(x => x !== e); const n = nodeOf(e); if (n) n.remove(); if (V.doc.sel === id) V.select(null); changed(); };
  V.deleteSelected = () => { if (V.doc && V.doc.sel) V.remove(V.doc.sel); };
  V.updateText = function (e) { measureText(e); V.refreshEl(e); };

  /* ── Выделение ── */
  V.select = function (id) {
    if (!V.doc) return; V.doc.sel = id || null; const e = byId(id);
    if (e) { const p = V.doc.pages[e.page]; p.overlay.append(selbox); selbox.hidden = false; selbox.classList.toggle('no-rot', e.type === 'whiteout'); }
    else selbox.hidden = true;
    updateSelbox(); renderProps();
  };
  V.selected = () => V.doc && byId(V.doc.sel);
  function updateSelbox() {
    const e = V.selected(); if (!e || !selbox) return; const s = V.scale;
    selbox.style.left = e.x * s + 'px'; selbox.style.top = e.y * s + 'px'; selbox.style.width = e.w * s + 'px'; selbox.style.height = e.h * s + 'px';
    selbox.style.transform = e.rot ? 'rotate(' + e.rot + 'deg)' : '';
    const tag = U.$('.tag', selbox);
    tag.textContent = e.type === 'text' ? e.size + ' pt' : (e.round ? 'Ø ' + U.fmt(U.pt2mm(e.w), 1) + ' мм' : U.fmt(U.pt2mm(e.w), 1) + ' × ' + U.fmt(U.pt2mm(e.h), 1) + ' мм') + (e.rot ? '  ' + U.fmt(e.rot, 0) + '°' : '');
  }

  /* ── Указатель: перетаскивание, инструменты ── */
  function ptOf(ev, overlay) { const r = overlay.getBoundingClientRect(); const s = V.scale; return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s }; }
  function bindOverlay(p) {
    const ov = p.overlay;
    ov.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const elNode = ev.target.closest('.el');
      const pt = ptOf(ev, ov);
      if (V.tool === 'select' || (V.tool === 'place' && elNode)) {
        if (!elNode) { V.select(null); return; }
        ev.preventDefault(); V.select(elNode.dataset.id); startDrag(ev, ov, byId(elNode.dataset.id), pt);
        return;
      }
      ev.preventDefault();
      if (V.tool === 'place' && O.L.armed) { V.placeAsset(O.L.armed.type, O.L.armed.id, p.index, pt.x, pt.y); V.setTool('select'); O.L.arm(null); return; }
      if (V.tool === 'text') { V.addText(p.index, pt.x, pt.y); V.setTool('select'); return; }
      if (V.tool === 'whiteout') { startWhiteout(ev, ov, p.index, pt); return; }
    });
    ov.addEventListener('dragover', ev => { if (ev.dataTransfer.types.includes('text/plain')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
    ov.addEventListener('drop', ev => {
      const t = ev.dataTransfer.getData('text/plain'); if (!t || !t.startsWith('ottisk:')) return;
      ev.preventDefault(); ev.stopPropagation(); const [, type, id] = t.split(':'); const pt = ptOf(ev, ov); V.placeAsset(type, id, p.index, pt.x, pt.y); O.L.arm(null); V.setTool('select');
    });
  }
  function startDrag(ev, ov, e, pt) {
    if (!e) return; ov.setPointerCapture(ev.pointerId);
    const x0 = e.x, y0 = e.y; let moved = false; const snap = JSON.stringify(V.doc.elements);
    const move = mv => {
      const q = ptOf(mv, ov); const dx = q.x - pt.x, dy = q.y - pt.y;
      if (!moved && Math.hypot(dx, dy) * V.scale < 2) return;
      if (!moved) { moved = true; V.doc.undo.push(snap); }
      e.x = x0 + dx; e.y = y0 + dy; V.refreshEl(e);
    };
    const up = () => { ov.removeEventListener('pointermove', move); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); if (moved) { renderProps(); changed(); } };
    ov.addEventListener('pointermove', move); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
  }
  function startWhiteout(ev, ov, pageIndex, pt) {
    ov.setPointerCapture(ev.pointerId); let ghost = null;
    const move = mv => {
      const q = ptOf(mv, ov); const s = V.scale;
      if (!ghost) { ghost = el('div', { class: 'el whiteout', style: 'box-shadow:0 0 0 1px var(--accent)' }); ov.append(ghost); }
      ghost.style.left = Math.min(pt.x, q.x) * s + 'px'; ghost.style.top = Math.min(pt.y, q.y) * s + 'px'; ghost.style.width = Math.abs(q.x - pt.x) * s + 'px'; ghost.style.height = Math.abs(q.y - pt.y) * s + 'px'; ghost._q = q;
    };
    const up = () => {
      ov.removeEventListener('pointermove', move); ov.removeEventListener('pointerup', up);
      if (ghost && ghost._q && Math.abs(ghost._q.x - pt.x) > 4 && Math.abs(ghost._q.y - pt.y) > 4) { const q = ghost._q; V.addWhiteout(pageIndex, Math.min(pt.x, q.x), Math.min(pt.y, q.y), Math.abs(q.x - pt.x), Math.abs(q.y - pt.y)); }
      else V.addWhiteout(pageIndex, pt.x - U.mm2pt(30), pt.y - U.mm2pt(4));
      if (ghost) ghost.remove(); V.setTool('select');
    };
    ov.addEventListener('pointermove', move); ov.addEventListener('pointerup', up);
  }
  function bindSelbox() {
    selbox.addEventListener('pointerdown', ev => {
      const k = ev.target.dataset.k; const e = V.selected(); if (!k || !e) return;
      ev.preventDefault(); ev.stopPropagation(); ev.target.setPointerCapture(ev.pointerId);
      const ov = V.doc.pages[e.page].overlay; V.pushUndo();
      const w0 = e.w, h0 = e.h, size0 = e.size, t = (e.rot || 0) * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
      const cx = e.x + w0 / 2, cy = e.y + h0 / 2;
      const sx = k.includes('e') ? 1 : -1, sy = k.includes('s') ? 1 : -1;
      const R = (x, y) => [x * cos - y * sin, x * sin + y * cos];
      const F = (() => { const [fx, fy] = R(-sx * w0 / 2, -sy * h0 / 2); return { x: cx + fx, y: cy + fy }; })();
      const move = mv => {
        const q = ptOf(mv, ov);
        if (k === 'rot') {
          let a = Math.atan2(q.y - cy, q.x - cx) * 180 / Math.PI + 90; a = ((a + 180) % 360 + 360) % 360 - 180;
          for (const s of [0, 90, -90, 180, -180]) if (Math.abs(a - s) < 3) a = s === -180 ? 180 : s;
          e.rot = Math.round(a * 10) / 10; V.refreshEl(e); return;
        }
        const dx = q.x - F.x, dy = q.y - F.y; const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
        let w, h;
        if (e.type === 'whiteout') { w = Math.max(2, lx * sx); h = Math.max(2, ly * sy); }
        else {
          const f = Math.max(0.08, lx * sx / w0, ly * sy / h0);
          if (e.type === 'text') { e.size = Math.max(4, Math.round(size0 * f * 2) / 2); measureText(e); w = e.w; h = e.h; }
          else { w = w0 * f; h = h0 * f; }
        }
        const [ox, oy] = R(sx * w / 2, sy * h / 2); e.w = w; e.h = h; e.x = F.x + ox - w / 2; e.y = F.y + oy - h / 2; V.refreshEl(e);
      };
      const up = () => { ev.target.removeEventListener('pointermove', move); ev.target.removeEventListener('pointerup', up); renderProps(); changed(); };
      ev.target.addEventListener('pointermove', move); ev.target.addEventListener('pointerup', up);
    });
  }

  V.setTool = function (t) {
    V.tool = t; const ws = U.$('#workspace'); ws.className = 'workspace tool-' + t;
    U.$('#toolSelect').classList.toggle('active', t === 'select'); U.$('#toolWhiteout').classList.toggle('active', t === 'whiteout'); U.$('#toolText').classList.toggle('active', t === 'text');
  };
  V.nudge = function (dxMm, dyMm) { const e = V.selected(); if (!e) return; V.pushUndo(); e.x += U.mm2pt(dxMm); e.y += U.mm2pt(dyMm); V.refreshEl(e); renderProps(); changed(); };

  /* ── Панель свойств ── */
  function renderProps() {
    const e = V.selected(); const body = U.$('#propsBody'), empty = U.$('#propsEmpty');
    if (!e) { body.hidden = true; body.innerHTML = ''; empty.hidden = false; empty.textContent = V.doc ? 'Нажмите на печать или подпись слева, затем на место в документе. Или перетащите миниатюру прямо на страницу.' : 'Сначала откройте документ.'; return; }
    empty.hidden = true; body.hidden = false; body.innerHTML = '';
    const title = e.type === 'image' ? (e.assetType === 'stamp' ? 'Печать' : 'Подпись') + ': ' + e.name : e.type === 'text' ? 'Текст' : 'Замазка';
    body.append(el('div', null, [el('div', { style: 'font-weight:500', text: title }), el('div', { class: 'hint', text: 'Страница ' + (e.page + 1) })]));
    const num = (label, val, min, max, step, onInput) => {
      const i = el('input', { type: 'number', class: 'inp num', value: Math.round(val * 10) / 10, min, max, step });
      i.addEventListener('change', () => { const v = U.clamp(parseFloat(String(i.value).replace(',', '.')) || 0, min, max); V.pushUndo(); onInput(v); V.refreshEl(e); i.value = Math.round(v * 10) / 10; changed(); });
      return el('label', { class: 'f' }, [el('span', { text: label }), i]);
    };
    const kv = el('div', { class: 'kv' });
    if (e.type === 'image') {
      kv.append(num(e.round ? 'Диаметр, мм' : 'Ширина, мм', U.pt2mm(e.w), 5, 300, 0.5, v => { const k = U.mm2pt(v) / e.w; const cx = e.x + e.w / 2, cy = e.y + e.h / 2; e.w *= k; e.h *= k; e.x = cx - e.w / 2; e.y = cy - e.h / 2; }));
      kv.append(num('Поворот, °', e.rot, -180, 180, 1, v => { e.rot = v; }));
      const r = el('input', { type: 'range', class: 'range', min: 70, max: 100, value: Math.round(e.ink * 100) }); const rv = el('span', { class: 'num', text: Math.round(e.ink * 100) + '%' });
      r.addEventListener('input', () => { e.ink = +r.value / 100; rv.textContent = r.value + '%'; V.refreshEl(e); });
      r.addEventListener('change', () => changed());
      body.append(kv, el('label', { class: 'f' }, [el('span', null, [el('span', { text: 'Насыщенность краски' }), rv]), r]));
    } else if (e.type === 'whiteout') {
      kv.append(num('Ширина, мм', U.pt2mm(e.w), 1, 300, 0.5, v => { e.w = U.mm2pt(v); }));
      kv.append(num('Высота, мм', U.pt2mm(e.h), 1, 300, 0.5, v => { e.h = U.mm2pt(v); }));
      body.append(kv, el('p', { class: 'hint', text: 'Белый прямоугольник закрывает текст под собой. Сверху можно положить новый текст.' }),
        el('p', { class: 'hint', text: 'Важно: замазка прячет текст только на вид. Внутри PDF старый текст остаётся — его найдёт поиск и копирование. Если текст нужно убрать совсем, правьте документ в Word («В Word для правки»).' }));
    } else if (e.type === 'text') {
      const ta = el('textarea', { class: 'inp', id: 'propText' }); ta.value = e.text;
      let snap = false; ta.addEventListener('input', () => { if (!snap) { V.pushUndo(); snap = true; } e.text = ta.value; V.updateText(e); changed(); });
      const fs = el('select', { class: 'sel' }, [
        el('option', { value: 'serif', text: 'Печатный с засечками (как Times New Roman)' }),
        el('option', { value: 'sans', text: 'Печатный без засечек (как Arial)' }),
        el('option', { value: 'hpen', text: 'От руки — обычный почерк ручкой' }),
        el('option', { value: 'hprint', text: 'От руки — крупно и размашисто' }),
        el('option', { value: 'hcursive', text: 'От руки — с завитками, нарядный' })
      ]); fs.value = e.font;
      const inkTitle = el('span', { text: V.isHand(e.font) ? 'Цвет чернил' : 'Цвет текста' });
      const inkInputs = {};
      fs.addEventListener('change', () => {
        V.pushUndo();
        const wasHand = V.isHand(e.font);
        e.font = V.lastFont = fs.value;
        const isHand = V.isHand(fs.value);
        // печатный текст в документе всегда чёрный; вернулись к ручке — вернули её цвет
        if (!isHand) e.color = 'black';
        else if (!wasHand) e.color = V.lastInk || 'blue';
        // от руки обычно пишут крупнее печатного текста — подскажем размер один раз
        if (isHand && e.size <= 12) { e.size = V.lastSize = 14; }
        // подпись и кружки обновляем прямо здесь: общая перерисовка ждёт ухода фокуса из панели
        inkTitle.textContent = isHand ? 'Цвет чернил' : 'Цвет текста';
        Object.keys(inkInputs).forEach(k => { inkInputs[k].checked = (k === e.color); });
        V.updateText(e); changed();
      });
      const cs = el('div', { class: 'radio inks' });
      [['black', 'Чёрная'], ['blue', 'Синяя'], ['violet', 'Фиолетовая']].forEach(([v, t]) => {
        const r = el('input', { type: 'radio', name: 'txtink', value: v }); if ((e.color || 'black') === v) r.checked = true;
        inkInputs[v] = r;
        r.addEventListener('change', () => {
          V.pushUndo(); e.color = v;
          if (V.isHand(e.font)) V.lastInk = v; // цвет ручки запоминаем, цвет печатного текста — нет
          V.refreshEl(e); changed();
        });
        cs.append(el('label', null, [r, el('span', { class: 'swatch', style: 'background:' + V.INKS[v] }), el('span', { text: t })]));
      });
      kv.append(num('Размер, pt', e.size, 4, 96, 0.5, v => { e.size = V.lastSize = v; measureText(e); }));
      kv.append(num('Поворот, °', e.rot, -180, 180, 1, v => { e.rot = v; }));
      body.append(el('label', { class: 'f' }, [el('span', { text: 'Текст' }), ta]),
        el('label', { class: 'f' }, [el('span', { text: 'Как написано' }), fs]),
        el('div', { class: 'f' }, [inkTitle, cs]), kv);
    }
    body.append(el('button', { class: 'btn danger sm', text: 'Удалить', onclick: () => V.deleteSelected() }), el('p', { class: 'hint', text: window.matchMedia('(pointer: coarse)').matches ? 'Двигать — пальцем. Размер — за углы, наклон — за круглую ручку сверху. Удалить — кнопка выше.' : 'Двигать: мышью или стрелками. Поворот — за круглую ручку. Удалить — клавиша Delete. Отменить — Ctrl+Z.' }));
  }
  V.renderProps = renderProps;

  O.V = V;
})(window.Ottisk);
