/* Сборка: верхняя панель, горячие клавиши, открытие файлов, сохранение, первый запуск. */
(function (O) {
  'use strict';
  const U = O.U, D = O.D, V = O.V, L = O.L, J = O.J, E = O.E, X = O.X;
  let settings = { rulesShown: false };

  async function init() {
    await O.Store.init();
    settings = (await O.Store.get('settings')) || settings;
    await L.init(); await J.init();
    bind();
    await O.F.init();
    V.renderProps();
    if (!settings.rulesShown) { await D.rules(); settings.rulesShown = true; O.Store.set('settings', settings); }
    await openShared();
    if (isTouch()) { U.$('#dzTitle').textContent = 'Откройте документ'; U.$('#dzText').textContent = 'PDF, Word (.docx) или фото документа.'; }
  }

  function bind() {
    const fileInput = U.$('#fileInput');
    const openPicker = () => { fileInput.value = ''; fileInput.click(); };
    U.$('#btnOpen').addEventListener('click', openPicker); U.$('#dzOpen').addEventListener('click', openPicker);
    fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) V.openFile(f); });
    U.$('#dzSample').addEventListener('click', () => V.openSample());
    U.$('#btnRules').addEventListener('click', () => D.rules());
    U.$('#docsRefresh').addEventListener('click', () => O.F.refreshDocs());
    U.$('#zoomIn').addEventListener('click', () => V.setZoom(V.zoom * 1.2));
    U.$('#zoomOut').addEventListener('click', () => V.setZoom(V.zoom / 1.2));
    U.$('#zoomFit').addEventListener('click', () => V.fitWidth());
    U.$('#toolSelect').addEventListener('click', () => { V.setTool('select'); L.arm(null); });
    U.$('#toolWhiteout').addEventListener('click', () => { needDoc() && V.setTool(V.tool === 'whiteout' ? 'select' : 'whiteout'); L.arm(null); });
    U.$('#toolText').addEventListener('click', () => { needDoc() && V.setTool(V.tool === 'text' ? 'select' : 'text'); L.arm(null); });
    U.$('#btnUndo').addEventListener('click', () => V.undo());
    U.$('#btnSave').addEventListener('click', savePdf);
    U.$('#btnDocx').addEventListener('click', toWord);
    U.$('#togLeft').addEventListener('click', () => { U.$('#rightPanel').classList.remove('open'); U.$('#leftPanel').classList.toggle('open'); syncScrim(); });
    U.$('#togRight').addEventListener('click', () => { U.$('#leftPanel').classList.remove('open'); U.$('#rightPanel').classList.toggle('open'); syncScrim(); });
    U.$('#scrim').addEventListener('click', () => closeDrawers());
    // закрыть вкладку с несохранёнными печатями — браузер переспросит
    window.addEventListener('beforeunload', e => { if (V.isDirty()) { e.preventDefault(); e.returnValue = ''; } });

    L.onArm = armed => {
      if (armed) {
        if (!V.doc) U.toast('Сначала откройте документ, затем нажмите на место для печати');
        else if (isNarrow()) { closeDrawers(); U.toast('Теперь нажмите на место в документе'); }
        V.setTool('place');
      } else if (V.tool === 'place') V.setTool('select');
    };
    V.onChange = () => { U.$('#btnUndo').disabled = !(V.doc && V.doc.undo.length); updatePageInfo(); };
    V.onChange();

    // перетаскивание файлов в рабочую область
    const ws = U.$('#workspace');
    ['dragenter', 'dragover'].forEach(t => ws.addEventListener(t, e => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) { e.preventDefault(); ws.classList.add('over'); } }));
    ws.addEventListener('dragleave', e => { if (e.target === ws || e.target === U.$('#dropzone')) ws.classList.remove('over'); });
    ws.addEventListener('drop', e => { ws.classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); V.openFile(e.dataTransfer.files[0]); } });
    document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', e => e.preventDefault());
    ws.addEventListener('scroll', U.debounce(updatePageInfo, 80));
    window.addEventListener('resize', U.debounce(() => { if (V.doc) { if (V.fitMode) V.fitWidth(); V.renderProps(); } }, 200));
    // узкий экран: кнопки из шапки продублированы в шторке «Библиотека»
    U.$$('[data-proxy]').forEach(b => b.addEventListener('click', () => { const t = U.$('#' + b.dataset.proxy); if (t) t.click(); if (b.dataset.close) closeDrawers(); }));
    // шторки закрываются касанием по документу и клавишей Esc
    ws.addEventListener('pointerdown', () => closeDrawers());

    // клавиши
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable || document.querySelector('dialog[open]');
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); V.undo(); return; }
      if (typing) return;
      if (e.key === 'Escape') { closeDrawers(); V.select(null); V.setTool('select'); L.arm(null); return; }
      if (!V.doc) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { if (V.selected()) { e.preventDefault(); V.deleteSelected(); } return; }
      const step = e.shiftKey ? 5 : 0.5;
      if (e.key === 'ArrowLeft') { e.preventDefault(); V.nudge(-step, 0); } else if (e.key === 'ArrowRight') { e.preventDefault(); V.nudge(step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); V.nudge(0, -step); } else if (e.key === 'ArrowDown') { e.preventDefault(); V.nudge(0, step); }
    });
  }

  const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;
  function closeDrawers() { U.$('#leftPanel').classList.remove('open'); U.$('#rightPanel').classList.remove('open'); syncScrim(); }
  O.closeDrawers = () => closeDrawers();
  function syncScrim() { U.$('#scrim').hidden = !(U.$('#leftPanel').classList.contains('open') || U.$('#rightPanel').classList.contains('open')); }

  /* Приложение с сайта: работает без интернета после первого открытия (service worker), на file:// не нужен */
  if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Без офлайн-режима:', e.message));
  }
  /* Android: документ отправили в «Оттиск» через «Поделиться» (Telegram, почта, Файлы) */
  async function openShared() {
    if (!/[?&]shared=1/.test(location.search) || !('caches' in window)) return;
    try {
      const c = await caches.open('ottisk-share'); const r = await c.match('shared-file');
      if (r) { const blob = await r.blob(); const name = decodeURIComponent(r.headers.get('x-name') || 'документ.pdf'); await c.delete('shared-file'); await V.openFile(new File([blob], name, { type: blob.type })); }
    } catch (e) { console.warn(e); }
    history.replaceState(null, '', location.pathname);
  }
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  /* Файл без папки программы: на телефоне — «Отправить…», на компьютере — в «Загрузки» */
  async function deliver(bytes, name, mime) {
    const file = new File([bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime })], name, { type: mime });
    if (isTouch() && D.canShare(file)) { await D.shareFile(file); return 'share'; }
    U.download(file, name, mime); return 'download';
  }

  function needDoc() { if (!V.doc) { U.toast('Сначала откройте документ'); return false; } return true; }
  function updatePageInfo() { U.$('#pageInfo').textContent = V.doc ? (V.currentPage() + 1) + ' / ' + V.doc.pages.length : '—'; }

  async function savePdf() {
    if (!needDoc()) return;
    if (!V.doc.elements.length && !await D.confirm('На документе пока ничего не размещено. Сохранить как есть?', { ok: 'Сохранить' })) return;
    try {
      U.busy('Сохраняю PDF…');
      const bytes = await E.build();
      let where = null;
      if (O.F.ready()) { try { where = await O.F.saveOutput('signed', E.outputName(), bytes, 'application/pdf'); } catch (err) { console.warn(err); } }
      let how = null; if (!where) how = await deliver(bytes, E.outputName(), 'application/pdf');
      const co = L.current();
      const assets = []; V.doc.elements.forEach(e => { if (e.type === 'image' && !assets.includes(e.name)) assets.push(e.name); });
      const pages = Array.from(new Set(V.doc.elements.map(e => e.page + 1))).sort((a, b) => a - b);
      J.add({ ts: new Date().toISOString(), file: where ? where.split(' → ').pop() : E.outputName(), company: co ? co.name : '', assets, pages: pages.length ? pages : ['—'] });
      V.doc.dirty = false;
      if (how !== 'share') U.toast(where ? 'PDF сохранён: ' + where : 'PDF сохранён в загрузки: ' + E.outputName());
    } catch (e) { console.error(e); U.toast('Не удалось сохранить PDF: ' + (e.message || e), true); }
    finally { U.busy(null); }
  }

  async function toWord() {
    if (!needDoc()) return;
    try {
      U.busy('Собираю документ Word…');
      const r = await X.build();
      if (r.scanPages === r.total) { U.busy(null); await D.alert('Это скан', 'Это скан — текст из картинки эта версия не распознаёт. В Word получится только пустой документ, поэтому файл не сохраняем.'); return; }
      let where = null;
      if (O.F.ready()) { try { where = await O.F.saveOutput('word', V.doc.name + '.docx', r.blob); } catch (err) { console.warn(err); } }
      let how = null; if (!where) how = await deliver(r.blob, V.doc.name + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const place = where ? 'в папку: ' + where : how === 'share' ? 'и передан' : 'в загрузки';
      if (r.scanPages) U.toast(`Word сохранён ${place}. ${r.scanPages} из ${r.total} стр. — сканы, текст с них не распознан.`);
      else U.toast('Документ Word сохранён ' + place);
    } catch (e) { console.error(e); U.toast('Не удалось собрать Word: ' + (e.message || e), true); }
    finally { U.busy(null); }
  }

  /* Служебный доступ для проверки (не для пользователя) */
  O.api = {
    pdfBase64: async () => U.u8ToB64(await E.build()),
    docxBase64: async () => { const r = await X.build(); return { b64: U.u8ToB64(new Uint8Array(await r.blob.arrayBuffer())), scanPages: r.scanPages, total: r.total }; },
    pngForWordBase64: (type, id) => U.u8ToB64(L.pngForWord(L.findAsset(type, id))),
    openBytes: (b64, name) => V.openPdf(U.b64ToU8(b64), name),
    state: () => ({ lib: L.lib, journal: J.entries, elements: V.doc ? V.doc.elements : null, zoom: V.zoom, store: O.Store.mode })
  };

  document.addEventListener('DOMContentLoaded', init);
})(window.Ottisk);
