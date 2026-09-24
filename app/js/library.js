/* Библиотека фирм: печати и подписи. Левая панель. */
(function (O) {
  'use strict';
  const U = O.U, D = O.D, el = U.el; const L = {};

  L.lib = { companies: [], currentId: null };
  L.armed = null; // {type:'stamp'|'signature', id}
  L.onArm = null; // колбэк для рабочей области

  const ICON = {
    word: '<svg class="i" viewBox="0 0 24 24"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z"/><path d="M14 3v4.5h4.5M8.5 12l1.5 5 2-4 2 4 1.5-5"/></svg>',
    edit: '<svg class="i" viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a1.4 1.4 0 0 0 0-2L16.5 5.5a1.4 1.4 0 0 0-2 0L4 16Z"/></svg>',
    del: '<svg class="i" viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 12h9.4l.8-12M9 7V4.5h6V7"/></svg>'
  };

  L.current = () => L.lib.companies.find(c => c.id === L.lib.currentId) || L.lib.companies[0] || null;
  L.findAsset = function (type, id) {
    for (const c of L.lib.companies) { const a = (type === 'stamp' ? c.stamps : c.signatures).find(x => x.id === id); if (a) return a; }
    return null;
  };

  const saveLocal = U.debounce(() => O.Store.set('library', L.lib).then(ok => { if (!ok) U.toast('Не удалось сохранить библиотеку в браузере. Сохраните копию библиотеки вручную.', true); }), 300);
  // в браузере — всегда; в папке программы — если она подключена
  const save = () => { saveLocal(); if (O.F && O.F.ready()) O.F.scheduleWrite(); };
  L.save = save; L.saveLocal = saveLocal;

  L.init = async function () {
    const stored = await O.Store.get('library');
    if (stored && stored.companies && stored.companies.length) L.lib = stored;
    else {
      L.lib = { companies: [{ id: U.uid(), name: 'Образец (учебная)', stamps: [], signatures: [] }], currentId: null };
      if (window.OTTISK_SAMPLE_STAMP) L.lib.companies[0].stamps.push({ id: U.uid(), name: 'Печать ОБРАЗЕЦ', dataUrl: window.OTTISK_SAMPLE_STAMP, wMm: 40, hMm: 40, round: true, ink: 'auto' });
      L.lib.currentId = L.lib.companies[0].id;
      save();
    }
    if (!L.current()) L.lib.currentId = L.lib.companies[0] && L.lib.companies[0].id;
    bind(); L.render();
  };

  function bind() {
    U.$('#coSelect').addEventListener('change', e => { L.lib.currentId = e.target.value; L.arm(null); save(); L.render(); });
    U.$('#coAdd').addEventListener('click', async () => {
      const name = await D.prompt('Новая фирма', 'Название фирмы', ''); if (!name) return;
      const c = { id: U.uid(), name, stamps: [], signatures: [] }; L.lib.companies.push(c); L.lib.currentId = c.id; save(); L.render();
    });
    U.$('#coRename').addEventListener('click', async () => {
      const c = L.current(); if (!c) return; const name = await D.prompt('Переименовать фирму', 'Название фирмы', c.name); if (!name) return; c.name = name; save(); L.render();
    });
    U.$('#coDelete').addEventListener('click', async () => {
      const c = L.current(); if (!c) return;
      if (L.lib.companies.length === 1) { U.toast('Нельзя удалить единственную фирму. Сначала добавьте другую.', true); return; }
      if (!await D.confirm(`Удалить фирму «${c.name}» вместе с её печатями и подписями?`, { ok: 'Удалить', danger: true })) return;
      if (O.F) await O.F.trashCompany(c);
      L.lib.companies = L.lib.companies.filter(x => x !== c); L.lib.currentId = L.lib.companies[0].id; L.arm(null); save(); L.render();
    });
    U.$('#stampAdd').addEventListener('click', () => pickImage('stamp'));
    U.$('#stampFolder').addEventListener('click', () => pickFolder('stamp'));
    U.$('#sigPhoto').addEventListener('click', () => pickImage('signature'));
    U.$('#sigDraw').addEventListener('click', async () => {
      const c = L.current(); if (!c) return; const a = await D.drawSignature(); if (!a) return; c.signatures.push(a); save(); L.render(); U.toast('Подпись сохранена');
    });
    U.$('#libExport').addEventListener('click', () => L.exportJson());
    U.$('#libImport').addEventListener('click', () => U.$('#jsonInput').click());
    U.$('#jsonInput').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      if (!files.length) return;
      const json = files.find(f => /\.json$/i.test(f.name) || f.type === 'application/json');
      if (json) { await L.importJson(json); return; }
      // сюда часто заходят с картинками печатей — не отправляем человека обратно, а добавляем их
      const imgs = files.filter(O.IP.isSupported);
      if (!imgs.length) { U.toast('Нужен файл копии .json — или картинка печати', true); return; }
      if (!await D.confirm(imgs.length === 1
        ? 'Это не копия библиотеки, а картинка. Добавить её как печать?'
        : `Это не копия библиотеки, а картинки (${imgs.length} шт.). Добавить их как печати?`,
        { title: 'Добавить как печать?', ok: 'Добавить как печать' })) return;
      await addMany(imgs, 'stamp');
    });
  }

  function pickImage(kind) {
    const inp = U.$('#imgInput'); inp.onchange = async e => {
      const files = Array.from(e.target.files || []); inp.value = '';
      if (files.length) await addMany(files, kind);
    }; inp.click();
  }

  /* Целая папка с печатями: берём из неё все картинки и PDF */
  function pickFolder(kind) {
    const inp = U.$('#dirInput'); inp.onchange = async e => {
      const all = Array.from(e.target.files || []); inp.value = '';
      if (!all.length) return;
      const files = all.filter(O.IP.isSupported).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
      if (!files.length) { U.toast(`В этой папке нет картинок и PDF (файлов всего ${all.length})`, true); return; }
      await addMany(files, kind);
    }; inp.click();
  }

  /* Несколько файлов подряд: на каждый — своё окно обработки. «Отмена» прекращает очередь. */
  async function addMany(files, kind) {
    let n = 0;
    for (let i = 0; i < files.length; i++) {
      const a = await L.addFromFile(files[i], kind, files.length > 1 ? { index: i + 1, total: files.length } : null);
      if (!a) break;
      n++;
    }
    if (files.length > 1) U.toast(n === files.length ? `Добавлено: ${n}` : `Добавлено: ${n} из ${files.length}`);
  }
  L.addFromFile = async function (file, kind, queue) {
    const c = L.current(); if (!c) return null;
    const a = await D.processImage(file, kind, queue); if (!a) return null;
    (kind === 'stamp' ? c.stamps : c.signatures).push(a); save(); L.render();
    if (!queue) U.toast(kind === 'stamp' ? 'Печать добавлена' : 'Подпись добавлена');
    return a;
  };

  L.arm = function (armed) {
    L.armed = armed; U.$$('.thumb').forEach(t => t.classList.toggle('armed', !!armed && t.dataset.id === armed.id));
    if (L.onArm) L.onArm(armed);
  };

  L.render = function () {
    const sel = U.$('#coSelect'); sel.innerHTML = '';
    L.lib.companies.forEach(c => sel.append(el('option', { value: c.id, text: c.name })));
    const cur = L.current(); if (cur) sel.value = cur.id;
    renderList('stamp', U.$('#stampList'), cur ? cur.stamps : [], 'Печатей пока нет.');
    renderList('signature', U.$('#sigList'), cur ? cur.signatures : [], 'Подписей пока нет.');
  };

  function renderList(type, root, items, emptyText) {
    root.innerHTML = '';
    if (!items.length) { root.append(el('div', { class: 'empty-note', style: 'grid-column:1/-1', text: emptyText })); return; }
    items.forEach(a => {
      const t = el('div', { class: 'thumb' + (L.armed && L.armed.id === a.id ? ' armed' : ''), draggable: 'true', tabindex: '0', 'data-id': a.id, title: 'Нажмите, затем нажмите на место в документе. Или перетащите на страницу.' });
      t.append(el('div', { class: 'img' }, el('img', { src: a.dataUrl, alt: a.name })));
      t.append(el('div', { class: 'name', text: a.name }));
      if (type === 'signature' && a.role) t.append(el('div', { class: 'role', text: a.role }));
      t.append(el('div', { class: 'mm', text: (a.round ? 'Ø ' : '') + U.fmt(a.wMm, 1) + (a.round ? ' мм' : ' × ' + U.fmt(a.hMm, 1) + ' мм') }));
      const acts = el('div', { class: 'acts' });
      acts.append(iconBtn(ICON.word, 'PNG для Word — картинка в точном размере', () => L.downloadPngForWord(a)));
      acts.append(iconBtn(ICON.edit, 'Переименовать / размер', () => editAsset(type, a)));
      acts.append(iconBtn(ICON.del, 'Удалить', async () => {
        if (!await D.confirm(`Удалить «${a.name}»?`, { ok: 'Удалить', danger: true })) return;
        const c = L.current(); if (O.F) await O.F.trashAsset(c, type, a);
        const arr = type === 'stamp' ? c.stamps : c.signatures; arr.splice(arr.indexOf(a), 1); if (L.armed && L.armed.id === a.id) L.arm(null); save(); L.render();
      }));
      t.append(acts);
      t.addEventListener('click', e => { if (e.target.closest('.acts')) return; L.arm(L.armed && L.armed.id === a.id ? null : { type, id: a.id }); });
      t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); L.arm({ type, id: a.id }); } });
      t.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'ottisk:' + type + ':' + a.id); e.dataTransfer.effectAllowed = 'copy'; });
      root.append(t);
    });
  }
  function iconBtn(svg, title, fn) { const b = el('button', { class: 'btn icon', title, 'aria-label': title, html: svg }); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; }

  async function editAsset(type, a) {
    const nameI = el('input', { class: 'inp', value: a.name });
    const roleI = el('input', { class: 'inp', value: a.role || '' });
    const sizeI = el('input', { type: 'number', class: 'inp num', min: 5, max: 300, step: 0.5, value: Math.round(a.wMm * 10) / 10 });
    const body = el('div', { class: 'stack' }, [
      el('label', { class: 'f' }, [el('span', { text: type === 'stamp' ? 'Название' : 'ФИО владельца' }), nameI]),
      type === 'signature' ? el('label', { class: 'f' }, [el('span', { text: 'Должность' }), roleI]) : null,
      el('label', { class: 'f' }, [el('span', { text: a.round ? 'Диаметр, мм' : 'Ширина, мм' }), sizeI]),
      el('p', { class: 'hint', text: 'Это настоящий размер на бумаге. Обычная круглая печать — 38–40 мм, подпись — 30–40 мм.' })
    ]);
    D.show({ title: 'Изменить', body, buttons: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, onClick: () => {
      const n = nameI.value.trim(); if (!n) return false; const s = U.clamp(+sizeI.value || a.wMm, 5, 300);
      a.hMm = a.hMm * s / a.wMm; a.wMm = s; a.name = n; a.role = roleI.value.trim(); save(); L.render();
    } }] });
  }

  /* PNG для Word с физическим размером (pHYs) */
  L.pngForWord = function (a) { return U.pngWithPhysicalSize(U.dataUrlToU8(a.dataUrl), a.wMm); };
  L.downloadPngForWord = function (a) {
    try { U.download(L.pngForWord(a), a.name.replace(/[\\/:*?"<>|]/g, '_') + '_' + Math.round(a.wMm) + 'мм.png', 'image/png'); U.toast('Word: Вставка → Рисунки → Это устройство, затем Обтекание текстом → За текстом'); }
    catch (e) { U.toast('Не удалось подготовить PNG: ' + e.message, true); }
  };

  /* Копия библиотеки */
  L.exportJson = function () {
    const data = { app: 'Оттиск', version: 1, exportedAt: new Date().toISOString(), library: L.lib, journal: O.J ? O.J.entries : [] };
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    U.download(JSON.stringify(data), `Оттиск_библиотека_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`, 'application/json');
    U.toast('Копия библиотеки сохранена в загрузки');
  };
  L.importJson = async function (file) {
    let data; try { data = JSON.parse(await file.text()); } catch (e) { U.toast('Это не файл копии библиотеки', true); return false; }
    if (!data || !data.library || !Array.isArray(data.library.companies)) { U.toast('Это не файл копии библиотеки', true); return false; }
    const n = data.library.companies.reduce((s, c) => s + (c.stamps || []).length + (c.signatures || []).length, 0);
    data.library.companies.forEach(c => { c.stamps = c.stamps || []; c.signatures = c.signatures || []; });
    if (O.F && O.F.ready()) {
      // с подключённой папкой копия добавляется к библиотеке, ничего из папки не удаляется
      if (!await D.confirm(`В копии ${data.library.companies.length} фирм(ы) и ${n} печатей/подписей. Добавить их в библиотеку? Уже имеющиеся останутся.`, { ok: 'Добавить' })) return false;
      for (const ic of data.library.companies) {
        let c = L.lib.companies.find(x => x.id === ic.id);
        if (!c) { L.lib.companies.push(Object.assign({}, ic, { dir: null, stamps: ic.stamps.map(a => Object.assign({}, a, { file: null })), signatures: ic.signatures.map(a => Object.assign({}, a, { file: null })) })); continue; }
        for (const k of ['stamps', 'signatures']) ic[k].forEach(a => { if (!c[k].some(x => x.id === a.id)) c[k].push(Object.assign({}, a, { file: null })); });
      }
      L.arm(null); save(); L.render(); if (O.J && Array.isArray(data.journal)) O.J.merge(data.journal);
      U.toast('Копия добавлена в библиотеку и папку'); return true;
    }
    if (!await D.confirm(`В копии ${data.library.companies.length} фирм(ы) и ${n} печатей/подписей. Заменить текущую библиотеку этой копией?`, { ok: 'Заменить' })) return false;
    L.lib = data.library;
    if (!L.current()) L.lib.currentId = L.lib.companies[0] && L.lib.companies[0].id;
    L.arm(null); save(); L.render();
    if (O.J && Array.isArray(data.journal)) O.J.merge(data.journal);
    U.toast('Библиотека загружена'); return true;
  };

  O.L = L;
})(window.Ottisk);
