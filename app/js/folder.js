/* Папка программы на диске (Chrome и Edge). Печати, подписи, готовые документы и журнал лежат обычными файлами:
     Библиотека/<Фирма>/Печати/*.png, Библиотека/<Фирма>/Подписи/*.png, Библиотека/библиотека.json
     Документы/Входящие — что подписать, Документы/Подписанные — готовые PDF, Документы/Для правки в Word — .docx
     журнал.csv
   Браузер не может писать на диск сам — папку один раз выбирает человек, дальше браузер её помнит. */
(function (O) {
  'use strict';
  const U = O.U, el = U.el; const F = {};
  const LIB = 'Библиотека', DOCS = 'Документы', INBOX = 'Входящие', SIGNED = 'Подписанные', WORD = 'Для правки в Word', TRASH = '_Корзина', ORIG = '_исходники';
  const META = 'библиотека.json', JOURNAL = 'журнал.csv';
  const IMG_RE = /\.(png|jpe?g|webp)$/i, DOC_RE = /\.(pdf|docx|jpe?g|png)$/i;

  F.supported = typeof window.showDirectoryPicker === 'function';
  F.state = 'none'; // none | unsupported | need-permission | ready
  F.handle = null;
  F.ready = () => F.state === 'ready' && !!F.handle;

  /* ── Мелкие помощники для работы с файлами ── */
  const safeName = s => (String(s || 'без названия').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'без названия').slice(0, 80);
  async function sub(dir, name) { return dir.getDirectoryHandle(name, { create: true }); }
  async function exists(dir, name) { try { await dir.getFileHandle(name); return true; } catch (e) { return false; } }
  async function uniqueFile(dir, base, ext) {
    let n = base + ext, i = 2;
    while (await exists(dir, n)) n = `${base} (${i++})${ext}`;
    return n;
  }
  async function writeFile(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable();
    await w.write(data); await w.close(); return name;
  }
  async function readFile(dir, name) { try { return await (await dir.getFileHandle(name)).getFile(); } catch (e) { return null; } }
  async function list(dir) { const out = []; for await (const [name, h] of dir.entries()) out.push({ name, h }); return out; }
  async function moveToTrash(fromDir, name, trashDir) {
    const f = await readFile(fromDir, name); if (!f) return;
    const dot = name.lastIndexOf('.'); const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    await writeFile(trashDir, await uniqueFile(trashDir, base, ext), f);
    await fromDir.removeEntry(name);
  }
  const dataUrlToBlob = d => new Blob([U.dataUrlToU8(d)], { type: 'image/png' });

  /* ── Подключение ── */
  F.init = async function () {
    if (!F.supported) { F.state = 'unsupported'; F.render(); return; }
    let h = null; try { h = await O.Store.get('folderHandle'); } catch (e) {}
    if (h && typeof h.queryPermission === 'function') {
      F.handle = h;
      let p = 'prompt'; try { p = await h.queryPermission({ mode: 'readwrite' }); } catch (e) {}
      F.state = p === 'granted' ? 'ready' : 'need-permission';
      // папку могли перенести или удалить — тогда подключаем заново
      if (F.state === 'ready') {
        try { for await (const _ of h.entries()) break; }
        catch (e) { F.handle = null; F.state = 'none'; U.toast('Папка программы не найдена — её перенесли или удалили. Подключите папку заново.', true); }
      }
    }
    F.render();
    if (F.ready()) await F.afterConnect(true);
  };

  F.connect = async function () {
    let h;
    try { h = await window.showDirectoryPicker({ id: 'ottisk-folder', mode: 'readwrite' }); }
    catch (e) { if (e && e.name !== 'AbortError') U.toast('Не удалось открыть папку: ' + (e.message || e), true); return false; }
    return F.useHandle(h);
  };
  F.useHandle = async function (h) {
    // выбрали внутреннюю папку app по ошибке — предупреждаем и не подключаем
    let isApp = false; try { await h.getDirectoryHandle('js'); await h.getDirectoryHandle('lib'); isApp = true; } catch (e) {}
    if (isApp) { U.toast('Это внутренняя папка app. Выберите папку уровнем выше — ту, где лежит «Открыть_Оттиск.html».', true); return false; }
    F.handle = h; F.state = 'ready';
    const ok = await O.Store.set('folderHandle', h);
    if (!ok) U.toast('Браузер не запомнил папку — после перезапуска выберите её снова.', true);
    F.render(); await F.afterConnect(false); return true;
  };
  F.reconnect = async function () {
    if (!F.handle) return F.connect();
    let p = 'denied'; try { p = await F.handle.requestPermission({ mode: 'readwrite' }); } catch (e) {}
    if (p === 'granted') { F.state = 'ready'; F.render(); await F.afterConnect(false); }
    else U.toast('Без разрешения программа не сможет сохранять в папку. Всё хранится в браузере.', true);
  };
  F.disconnect = async function () {
    F.handle = null; F.state = F.supported ? 'none' : 'unsupported'; await O.Store.set('folderHandle', null); F.render();
  };

  F.afterConnect = async function (quiet) {
    try {
      U.busy('Читаю папку программы…');
      const docs = await sub(F.handle, DOCS); await sub(docs, INBOX); await sub(docs, SIGNED); await sub(docs, WORD);
      const res = await F.syncLibrary();
      await F.writeJournal();
      await F.refreshDocs();
      if (!quiet) U.toast('Папка подключена: ' + F.handle.name + (res.imported ? ` · новых картинок: ${res.imported}` : ''));
      else if (res.imported) U.toast(`Из папки добавлено картинок: ${res.imported}`);
    } catch (e) {
      console.error(e);
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { F.state = 'need-permission'; F.render(); }
      else U.toast('Не удалось прочитать папку: ' + (e.message || e), true);
    } finally { U.busy(null); }
  };

  /* ── Библиотека: папка ↔ программа ── */
  async function imageToAsset(file, kind, company) {
    const url = await U.blobToDataUrl(file); const img = await U.loadImage(url);
    const IP = O.IP; const full = IP.canvasFromImage(img, 2000);
    let out, round = false, processed = false;
    if (IP.hasRealAlpha(full)) {
      const r = IP.autoCrop(full, kind === 'stamp' ? undefined : false); round = kind === 'stamp' && r.round;
      out = IP.crop(full, r, 1600);
    } else {
      const p = IP.process(full, { cleanup: 0.45, ink: 'auto' });
      const r = IP.autoCrop(p, kind === 'stamp' ? undefined : false); round = kind === 'stamp' && r.round;
      out = IP.crop(p, r, 1600); processed = true;
    }
    const base = file.name.replace(/\.[^.]+$/, '');
    const wMm = kind === 'stamp' ? (round ? 40 : 50) : 35;
    const role = kind === 'signature' && base.includes(' — ') ? base.split(' — ').slice(1).join(' — ') : '';
    const name = kind === 'signature' && base.includes(' — ') ? base.split(' — ')[0] : base;
    return { asset: { id: U.uid(), name, role, dataUrl: out.toDataURL('image/png'), wMm, hMm: round ? wMm : wMm * out.height / out.width, round, ink: 'auto', px: [out.width, out.height] }, processed };
  }

  F.syncLibrary = async function () {
    const L = O.L; const lib = L.lib; let imported = 0;
    const libDir = await sub(F.handle, LIB);
    let meta = null; const mf = await readFile(libDir, META);
    if (mf) { try { meta = JSON.parse(await mf.text()); } catch (e) { console.warn('библиотека.json повреждён', e); } }

    // 1) фирмы и описания из библиотека.json, которых нет в браузере
    const metaIds = new Set();
    if (meta && Array.isArray(meta.companies)) meta.companies.forEach(mc => ['stamps', 'signatures'].forEach(k => (mc[k] || []).forEach(a => metaIds.add(a.id))));
    if (meta && Array.isArray(meta.companies)) {
      for (const mc of meta.companies) {
        let c = lib.companies.find(x => x.id === mc.id);
        if (!c) { c = { id: mc.id, name: mc.name, dir: mc.dir, stamps: [], signatures: [] }; lib.companies.push(c); }
        c.dir = c.dir || mc.dir;
        for (const [kind, key] of [['stamp', 'stamps'], ['signature', 'signatures']]) {
          for (const ma of (mc[key] || [])) if (!c[key].some(a => a.id === ma.id)) c[key].push(Object.assign({}, ma, { dataUrl: null }));
        }
      }
    }
    // 2) папки фирм и картинки в них
    const usedDirs = new Set(lib.companies.map(c => c.dir).filter(Boolean));
    for (const { name, h } of await list(libDir)) {
      if (h.kind !== 'directory' || name.startsWith('_')) continue;
      if (!lib.companies.some(c => c.dir === name)) { lib.companies.push({ id: U.uid(), name, dir: name, stamps: [], signatures: [] }); usedDirs.add(name); }
    }
    for (const c of lib.companies) {
      if (!c.dir) { let d = safeName(c.name), i = 2; while (usedDirs.has(d)) d = safeName(c.name) + ` (${i++})`; c.dir = d; usedDirs.add(d); }
      const cd = await sub(libDir, c.dir);
      for (const [kind, key, folder] of [['stamp', 'stamps', 'Печати'], ['signature', 'signatures', 'Подписи']]) {
        const td = await sub(cd, folder);
        const files = (await list(td)).filter(x => x.h.kind === 'file' && IMG_RE.test(x.name) && !x.name.startsWith('.'));
        const names = new Set(files.map(x => x.name));
        // описанные ранее картинки: файл удалили руками — убираем из библиотеки; нет картинки в браузере — читаем из файла
        const keep = [];
        for (const a of c[key]) {
          if (a.file && !names.has(a.file)) {
            if (metaIds.has(a.id)) continue; // в этой папке файл был и его удалили руками — убираем
            a.file = null;                   // картинка из другой папки или из браузера — запишем заново
          }
          if (a.file && !a.dataUrl) { const f = await readFile(td, a.file); a.dataUrl = await U.blobToDataUrl(new Blob([await f.arrayBuffer()], { type: 'image/png' })); }
          if (a.dataUrl) keep.push(a);
        }
        c[key] = keep;
        // новые картинки, которые человек положил в папку сам
        const known = new Set(c[key].map(a => a.file).filter(Boolean));
        for (const x of files) {
          if (known.has(x.name)) continue;
          try {
            const file = await x.h.getFile(); const r = await imageToAsset(file, kind, c);
            if (r.processed || !/\.png$/i.test(x.name)) {
              // исходник — в _исходники, рядом — обработанная картинка без фона
              await moveToTrash(td, x.name, await sub(cd, ORIG));
              r.asset.file = await writeFile(td, await uniqueFile(td, x.name.replace(/\.[^.]+$/, ''), '.png'), dataUrlToBlob(r.asset.dataUrl));
            } else r.asset.file = x.name;
            c[key].push(r.asset); imported++;
          } catch (e) { console.warn('Не удалось взять картинку', x.name, e); }
        }
      }
    }
    if (!L.current()) lib.currentId = lib.companies[0] && lib.companies[0].id;
    await F.writeLibrary();
    L.render(); L.saveLocal();
    return { imported };
  };

  /* Записать библиотеку в папку: недостающие картинки + библиотека.json */
  let writing = null, again = false;
  F.writeLibrary = async function () {
    if (!F.ready()) return;
    if (writing) { again = true; return writing; }
    writing = (async () => {
      try {
        const lib = O.L.lib; const libDir = await sub(F.handle, LIB);
        const meta = { app: 'Оттиск', version: 1, savedAt: new Date().toISOString(), currentId: lib.currentId, companies: [] };
        const used = new Set();
        for (const c of lib.companies) {
          if (!c.dir) { let d = safeName(c.name), i = 2; while (used.has(d)) d = safeName(c.name) + ` (${i++})`; c.dir = d; }
          used.add(c.dir);
          const cd = await sub(libDir, c.dir); const mc = { id: c.id, name: c.name, dir: c.dir, stamps: [], signatures: [] };
          for (const [key, folder] of [['stamps', 'Печати'], ['signatures', 'Подписи']]) {
            const td = await sub(cd, folder);
            for (const a of c[key]) {
              if (!a.dataUrl) continue;
              if (!a.file || !(await exists(td, a.file))) {
                const base = safeName(key === 'signatures' && a.role ? `${a.name} — ${a.role}` : a.name);
                a.file = await writeFile(td, await uniqueFile(td, base, '.png'), dataUrlToBlob(a.dataUrl));
              }
              const m = Object.assign({}, a); delete m.dataUrl; mc[key].push(m);
            }
          }
          meta.companies.push(mc);
        }
        await writeFile(libDir, META, JSON.stringify(meta, null, 1));
      } catch (e) { console.warn('Не удалось записать библиотеку в папку', e); U.toast('Не удалось записать библиотеку в папку: ' + (e.message || e), true); }
    })();
    await writing; writing = null;
    if (again) { again = false; return F.writeLibrary(); }
  };
  F.scheduleWrite = U.debounce(() => F.writeLibrary(), 400);

  /* Удаление из программы = перенос файла в Библиотека/_Корзина */
  F.trashAsset = async function (c, type, a) {
    if (!F.ready() || !c.dir || !a.file) return;
    try {
      const libDir = await sub(F.handle, LIB); const cd = await sub(libDir, c.dir); const td = await sub(cd, type === 'stamp' ? 'Печати' : 'Подписи');
      await moveToTrash(td, a.file, await sub(await sub(libDir, TRASH), c.dir));
    } catch (e) { console.warn(e); }
  };
  F.trashCompany = async function (c) {
    if (!F.ready() || !c.dir) return;
    try {
      const libDir = await sub(F.handle, LIB); const cd = await sub(libDir, c.dir); const trash = await sub(await sub(libDir, TRASH), c.dir);
      for (const folder of ['Печати', 'Подписи', ORIG]) {
        let td; try { td = await cd.getDirectoryHandle(folder); } catch (e) { continue; }
        const tt = await sub(trash, folder);
        for (const { name, h } of await list(td)) if (h.kind === 'file') await moveToTrash(td, name, tt);
      }
      await libDir.removeEntry(c.dir, { recursive: true });
    } catch (e) { console.warn(e); }
  };

  /* ── Документы ── */
  F.docs = [];
  F.refreshDocs = async function () {
    if (!F.ready()) { F.docs = []; F.renderDocs(); return; }
    try {
      const inbox = await sub(await sub(F.handle, DOCS), INBOX);
      const out = [];
      for (const { name, h } of await list(inbox)) if (h.kind === 'file' && DOC_RE.test(name) && !name.startsWith('.') && !name.startsWith('~$')) { const f = await h.getFile(); out.push({ name, h, size: f.size, mtime: f.lastModified }); }
      out.sort((a, b) => b.mtime - a.mtime); F.docs = out;
    } catch (e) { console.warn(e); F.docs = []; }
    F.renderDocs();
  };
  /* Сохранить готовый файл в Документы/<папка>. Возвращает путь для показа человеку */
  F.saveOutput = async function (kind, name, bytes, mime) {
    const target = kind === 'word' ? WORD : SIGNED;
    const d = await sub(await sub(F.handle, DOCS), target);
    const dot = name.lastIndexOf('.'); const fname = await uniqueFile(d, safeName(name.slice(0, dot)), name.slice(dot));
    await writeFile(d, fname, bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime }));
    return DOCS + ' → ' + target + ' → ' + fname;
  };
  F.writeJournal = async function () {
    if (!F.ready() || !O.J) return;
    try { await writeFile(F.handle, JOURNAL, new Blob([O.J.csv()], { type: 'text/csv;charset=utf-8' })); } catch (e) { console.warn(e); }
  };

  /* ── Панель слева ── */
  F.render = function () {
    const root = U.$('#folderBox'); if (!root) return; root.innerHTML = '';
    const icon = '<svg class="i" viewBox="0 0 24 24"><path d="M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V9.5A1.5 1.5 0 0 0 18.5 8H12l-2-2.5H5.5A1.5 1.5 0 0 0 4 7Z"/></svg>';
    if (F.state === 'unsupported') {
      root.append(el('p', { class: 'hint', text: window.matchMedia('(pointer: coarse)').matches
        ? 'На телефоне печати и подписи хранятся в памяти этого приложения. Готовый PDF — кнопкой «Отправить…» в Telegram или почту, либо «Сохранить» в «Файлы». Сделайте копию библиотеки (внизу), чтобы не потерять печати.'
        : 'Этот браузер не умеет сохранять в папку. Откройте программу в Chrome или Edge — тогда печати, подписи и готовые документы будут лежать в папке рядом с программой. Сейчас всё хранится в браузере, готовые файлы уходят в «Загрузки».' }));
    } else if (F.state === 'none') {
      root.append(el('button', { class: 'btn primary sm wide', id: 'folderConnect', html: icon + '<span>Подключить папку программы</span>', onclick: () => F.connect() }));
      root.append(el('p', { class: 'hint', style: 'margin-top:8px', text: 'Один раз выберите папку, где лежит «Открыть_Оттиск.html». Печати, подписи и готовые документы будут сохраняться в ней обычными файлами.' }));
    } else if (F.state === 'need-permission') {
      root.append(el('button', { class: 'btn primary sm wide', html: icon + '<span>Открыть папку «' + U.esc(F.handle.name) + '»</span>', onclick: () => F.reconnect() }));
      root.append(el('p', { class: 'hint', style: 'margin-top:8px', text: 'После перезапуска браузер спрашивает разрешение ещё раз. В окне браузера выберите «Разрешить» (лучше — «Разрешать при каждом посещении»).' }));
      root.append(el('button', { class: 'btn link', style: 'margin-top:4px;padding:0', text: 'Выбрать другую папку', onclick: () => F.connect() }));
    } else {
      root.append(el('div', { class: 'folder-ok' }, [el('span', { class: 'dot' }), el('span', { class: 'fname', title: F.handle.name, text: F.handle.name })]));
      root.append(el('p', { class: 'hint', text: 'Печати и подписи — в папке «Библиотека», готовые PDF — в «Документы → Подписанные».' }));
      root.append(el('div', { class: 'row wrap', style: 'margin-top:8px' }, [
        el('button', { class: 'btn sm', text: 'Обновить из папки', onclick: () => F.afterConnect(false) }),
        el('button', { class: 'btn sm ghost', text: 'Другая папка', onclick: () => F.connect() })
      ]));
    }
    const docsSec = U.$('#docsSec'); if (docsSec) docsSec.hidden = !F.ready();
    const ch = U.$('#libCopyHint');
    if (ch) ch.textContent = F.ready()
      ? 'Основное хранилище — папка «' + F.handle.name + '»: храните её копию на флешке или в облаке. Копия библиотеки нужна, чтобы перенести печати в другой браузер.'
      : 'Печати и подписи хранятся только в этом браузере на этом компьютере. Раз в месяц сохраняйте копию в надёжное место — или подключите папку программы.';
  };
  F.renderDocs = function () {
    const root = U.$('#docsList'); if (!root) return; root.innerHTML = '';
    if (!F.docs.length) { root.append(el('div', { class: 'empty-note', text: 'Пусто. Положите PDF, Word или фото документа в папку «Документы → Входящие» и нажмите «Обновить».' })); return; }
    const kb = n => n > 1048576 ? U.fmt(n / 1048576, 1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
    F.docs.forEach(d => {
      const active = O.V.doc && O.V.doc.srcName === d.name;
      const b = el('button', { class: 'doc' + (active ? ' active' : ''), title: 'Открыть «' + d.name + '»', 'aria-current': active ? 'true' : null }, [
        el('span', { class: 'ext', text: (d.name.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase() }),
        el('span', { class: 'dn', text: d.name }), el('span', { class: 'ds num', text: kb(d.size) })
      ]);
      b.addEventListener('click', async () => { const f = await d.h.getFile(); const ok = await O.V.openFile(f); if (ok && O.closeDrawers) O.closeDrawers(); });
      root.append(b);
    });
  };

  O.F = F;
})(window.Ottisk);
