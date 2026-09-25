/* Конвертер: «из чего → во что», всё считается на этом компьютере, без интернета.
   Картинки — через холст (BMP пишем сами, браузер его не умеет сохранять).
   Word и LibreOffice → PDF теми же модулями, что и при открытии документа.
   PDF → картинки — отрисовкой страниц через pdf.js, PDF → Word — через docx.js. */
(function (O) {
  'use strict';
  const U = O.U, D = O.D, el = U.el; const C = {};

  /* Что во что умеем переводить */
  const KIND = {
    jpg: { name: 'Фото JPG', to: ['png', 'bmp', 'pdf'] },
    png: { name: 'Картинка PNG', to: ['jpg', 'bmp', 'pdf'] },
    webp: { name: 'Картинка WEBP', to: ['jpg', 'png', 'bmp', 'pdf'] },
    bmp: { name: 'Картинка BMP', to: ['jpg', 'png', 'pdf'] },
    pdf: { name: 'PDF', to: ['pdfsmall', 'jpg', 'png', 'docx', 'txt'] },
    docx: { name: 'Word (.docx)', to: ['pdf'] },
    odt: { name: 'LibreOffice (.odt)', to: ['pdf'] }
  };
  const OUT = { jpg: 'Фото JPG', png: 'Картинка PNG', bmp: 'Картинка BMP', pdf: 'PDF', pdfsmall: 'PDF поменьше (сжать)', docx: 'Word (.docx)', txt: 'Текст (.txt)' };
  const EXT = { jpg: '.jpg', png: '.png', bmp: '.bmp', pdf: '.pdf', pdfsmall: '.pdf', docx: '.docx', txt: '.txt' };
  /* Размер результата: чем меньше точек на дюйм и качество, тем легче файл */
  const SIZES = {
    small:  { name: 'Меньше — для почты', dpi: 100, q: 0.60, side: 1400 },
    medium: { name: 'Средний — обычный выбор', dpi: 150, q: 0.75, side: 2200 },
    large:  { name: 'Больше — лучше качество', dpi: 200, q: 0.88, side: 3200 },
    orig:   { name: 'Как есть — ничего не ужимать', dpi: 300, q: 0.95, side: 5000 }
  };

  C.kindOf = function (file) {
    const e = (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    if (e === 'jpeg' || e === 'jpe') return 'jpg';
    return KIND[e] ? e : null;
  };

  /* ── BMP: 24 бита без сжатия. Браузер такое не сохраняет, пишем байты руками ── */
  function canvasToBmp(c) {
    const w = c.width, h = c.height;
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const rowRaw = w * 3, pad = (4 - (rowRaw % 4)) % 4, rowSize = rowRaw + pad;
    const size = 54 + rowSize * h;
    const b = new Uint8Array(size), v = new DataView(b.buffer);
    b[0] = 0x42; b[1] = 0x4D;                 // «BM»
    v.setUint32(2, size, true); v.setUint32(10, 54, true);
    v.setUint32(14, 40, true);                 // размер заголовка
    v.setInt32(18, w, true); v.setInt32(22, h, true);
    v.setUint16(26, 1, true); v.setUint16(28, 24, true);
    v.setUint32(34, rowSize * h, true);
    v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);   // ≈72 dpi
    let p = 54;
    for (let y = h - 1; y >= 0; y--) {          // BMP хранит строки снизу вверх
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, a = d[i + 3] / 255;
        // прозрачность кладём на белый: в BMP её нет
        b[p++] = Math.round(d[i + 2] * a + 255 * (1 - a));
        b[p++] = Math.round(d[i + 1] * a + 255 * (1 - a));
        b[p++] = Math.round(d[i] * a + 255 * (1 - a));
      }
      p += pad;
    }
    return new Blob([b], { type: 'image/bmp' });
  }

  function canvasToBlob(c, fmt, q) {
    if (fmt === 'bmp') return Promise.resolve(canvasToBmp(c));
    if (fmt === 'jpg') {
      // у JPG нет прозрачности — подкладываем белый лист
      const w = document.createElement('canvas'); w.width = c.width; w.height = c.height;
      const x = w.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
      return new Promise(r => w.toBlob(r, 'image/jpeg', q || 0.92));
    }
    return new Promise(r => c.toBlob(r, 'image/png'));
  }

  /* Страницы PDF → картинки (200 dpi — как обычный скан) */
  async function pdfToImages(bytes, fmt, size) {
    const S = SIZES[size] || SIZES.medium;
    const doc = await O.V.loadPdf(bytes);
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: S.dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ blob: await canvasToBlob(c, fmt, S.q), page: i });
    }
    return out;
  }

  /* Картинка → PDF на лист по размеру самой картинки */
  async function imageToPdf(file, size) {
    const S = SIZES[size] || SIZES.medium;
    const c = await O.IP.fromFile(file, S.side);
    const pdf = await window.PDFLib.PDFDocument.create();
    const jpg = await pdf.embedJpg(U.dataUrlToU8(c.toDataURL('image/jpeg', S.q)));
    const pw = c.width * 0.72, ph = c.height * 0.72;   // 100 dpi → пункты
    pdf.addPage([pw, ph]).drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
    return pdf.save();
  }

  /* PDF → PDF поменьше: каждая страница становится картинкой выбранного качества.
     Текст при этом перестаёт быть текстом — честно предупреждаем в подсказке. */
  async function shrinkPdf(bytes, size) {
    const S = SIZES[size] || SIZES.medium;
    const doc = await O.V.loadPdf(bytes);
    const pdf = await window.PDFLib.PDFDocument.create();
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: S.dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const jpg = await pdf.embedJpg(U.dataUrlToU8(c.toDataURL('image/jpeg', S.q)));
      pdf.addPage([vp1.width, vp1.height]).drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }
    return pdf.save();
  }

  /* Что внутри PDF: настоящие буквы или снимок бумаги.
     Страницы при этом не рисуются, поэтому быстро — миллисекунды на страницу.
     Порог в 20 знаков: у скана часто есть слой из одного номера страницы, это не текст. */
  C.peek = async function (bytes) {
    const pdf = await O.V.loadPdf(bytes);
    const perPage = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        perPage.push(tc.items.map(it => it.str || '').join('').replace(/\s+/g, '').length);
      }
    } finally { try { pdf.destroy(); } catch (e) {} }
    const withText = perPage.filter(n => n >= 20).length;
    return { total: perPage.length, withText, scans: perPage.length - withText, perPage };
  };

  /* Само преобразование. Возвращает [{blob, name}] */
  C.run = async function (file, to, size, opts) {
    const from = C.kindOf(file);
    const base = U.stripExt(file.name);
    if (!from) throw new Error('Не понимаю этот формат');
    if (from === to) throw new Error('Это уже такой формат');

    if (['jpg', 'png', 'webp', 'bmp'].includes(from)) {
      if (to === 'pdf') return [{ blob: new Blob([await imageToPdf(file, size)], { type: 'application/pdf' }), name: base + '.pdf' }];
      const S = SIZES[size] || SIZES.medium;
      const c = await O.IP.fromFile(file, S.side);
      return [{ blob: await canvasToBlob(c, to, S.q), name: base + EXT[to] }];
    }
    if (from === 'pdf') {
      const bytes = await U.fileToU8(file);
      if (to === 'docx' || to === 'txt') {
        // своя копия документа: раньше конвертер открывал файл на столе
        // и молча закрывал тот, который человек в это время правил
        const pdf = await O.V.loadPdf(bytes);
        try {
          const pages = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            pages.push(await pdf.getPage(i));
            if (opts && opts.onPage) opts.onPage(i, pdf.numPages);
            await new Promise(r => setTimeout(r, 0));   // отпускаем окно: всё считается в нём же
          }
          if (to === 'docx') {
            const res = await O.X.buildFrom(pages, base);
            if (res.scanPages === res.total) throw new Error('СКАН');
            return [{ blob: res.blob, name: base + '.docx', scanPages: res.scanPages, total: res.total }];
          }
          const parts = []; let scanPages = 0;
          for (let i = 0; i < pages.length; i++) {
            const t = await O.X.pageText(pages[i]);
            if (t === null) { scanPages++; parts.push('[Страница ' + (i + 1) + ' — снимок бумаги, букв внутри нет]'); }
            else parts.push(t);
          }
          if (scanPages === pages.length) throw new Error('СКАН');
          // метка в начале файла нужна, иначе Блокнот на Windows покажет кракозябры
          return [{ blob: new Blob(['\ufeff' + parts.join('\n\n')], { type: 'text/plain;charset=utf-8' }),
                    name: base + '.txt', scanPages: scanPages, total: pages.length }];
        } finally { try { pdf.destroy(); } catch (e) {} }
      }
      if (to === 'pdfsmall') return [{ blob: new Blob([await shrinkPdf(bytes, size)], { type: 'application/pdf' }), name: base + '_меньше.pdf' }];
      const imgs = await pdfToImages(bytes, to, size);
      return imgs.map(i => ({ blob: i.blob, name: base + (imgs.length > 1 ? '_стр' + i.page : '') + EXT[to] }));
    }
    if (from === 'docx') return [{ blob: new Blob([await O.W.convert(file)], { type: 'application/pdf' }), name: base + '.pdf' }];
    if (from === 'odt') return [{ blob: new Blob([await O.Z.convert(file)], { type: 'application/pdf' }), name: base + '.pdf' }];
    throw new Error('Такое пока не переводится');
  };

  /* Сохранение результата: в папку программы, если она подключена, иначе — загрузкой */
  C.save = async function (items) {
    const saved = [];
    for (const it of items) {
      if (O.F && O.F.ready && O.F.ready()) saved.push(await O.F.saveOutput('signed', it.name, it.blob, it.blob.type));
      else { U.download(it.blob, it.name, it.blob.type); saved.push(it.name); }
    }
    return saved;
  };

  /* ── Окно «Конвертер» ── */
  /* Сайты-распознаватели: адрес по умолчанию и запасные.
     PDF24 — единственный из проверенных, у кого одновременно: бесплатно и без суточного
     счётчика, без регистрации, названы компания (geek Software GmbH, Германия) и место
     обработки (ЕС), и в правилах стоит конкретный срок удаления файлов — час. */
  const OCR_SITES = [
    'https://tools.pdf24.org/ru/ocr-pdf',
    'https://www.ilovepdf.com/ru/ocr-pdf',
    'https://convertio.co/ru/ocr/'
  ];

  C.open = function (preset) {
    let file = null, from = null;
    let peeked = null, seq = 0;          // что нашлось внутри PDF и номер попытки
    let running = false, stopped = false;
    let netSaved = OCR_SITES.slice();
    const drop = el('div', { class: 'conv-drop' });
    const pick = el('button', { class: 'btn primary', text: 'Выбрать файл' });
    const inp = el('input', { type: 'file', hidden: true });
    const fileName = el('div', { class: 'conv-name muted', text: 'или нажмите кнопку ниже' });
    const fromBox = el('div', { class: 'conv-kind muted', text: 'пока не выбран' });
    const toSel = el('select', { class: 'sel' });
    const resetTo = () => { toSel.innerHTML = ''; toSel.append(el('option', { text: 'Сначала выберите файл' })); toSel.disabled = true; };
    const sizeR = el('input', { type: 'range', class: 'range', min: 0, max: 3, step: 1, value: 1 });
    const sizeName = el('div', { class: 'conv-size-name' });
    const sizeBox = el('div', { class: 'f conv-size' }, [
      el('span', { text: 'Размер файла' }), sizeR, sizeName,
      el('p', { class: 'hint', text: 'Чем меньше — тем легче файл и быстрее уходит по почте. Текст остаётся читаемым на всех уровнях.' })
    ]);
    const SIZE_KEYS = ['small', 'medium', 'large', 'orig'];
    const sizeKey = () => SIZE_KEYS[+sizeR.value];
    sizeR.addEventListener('input', () => { sizeName.textContent = SIZES[sizeKey()].name; });
    sizeName.textContent = SIZES.medium.name;
    const hint = el('p', { class: 'hint' });
    const look = el('p', { class: 'conv-look' });
    const prog = el('p', { class: 'conv-prog', hidden: true });

    /* ── Сайты-распознаватели. Программа сама ничего не отправляет: только открывает вкладку ── */
    const netInp = el('input', { class: 'inp', type: 'text', inputmode: 'url', spellcheck: 'false',
                                 autocapitalize: 'off', autocorrect: 'off', placeholder: 'адрес сайта' });
    const netGo = el('button', { class: 'btn', text: 'Открыть' });
    const netChips = el('div', { class: 'scan-net-saved' });
    const netBox = el('details', { class: 'scan-net conv-net' }, [
      el('summary', null, [
        el('span', { html: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c4.5 5 4.5 12 0 17M12 3.5c-4.5 5-4.5 12 0 17"/></svg>' }).firstChild,
        el('b', { text: 'Прочитать скан в интернете' }),
        el('span', { class: 'muted', text: '— файл уйдёт на чужой сервер' })
      ]),
      el('div', { class: 'scan-net-row' }, [netInp, netGo]),
      netChips,
      el('p', { class: 'net-do', text: 'Что делать: нажмите «Открыть» → на сайте выберите свой файл → язык Russian → скачайте готовый PDF → вернитесь сюда и переведите его в Word как обычно.' }),
      el('p', { class: 'hint', text: 'Программа сама ничего не отправляет — она только открывает сайт в соседней вкладке. Файл туда кладёте вы, и дальше он на чужом сервере. Накладные с ценами и поставщиками так отправлять не стоит. По умолчанию — PDF24: компания geek Software GmbH, Германия, в их правилах написано, что файлы удаляются через час.' })
    ]);

    function renderNet() {
      netChips.innerHTML = '';
      if (!netSaved.length) return;
      netChips.append(el('span', { class: 'muted small', text: 'Ещё:' }));
      netSaved.forEach(u => {
        const chip = el('span', { class: 'chip' });
        const goBtn = el('button', { class: 'lnk', title: u, text: short(u) });
        goBtn.addEventListener('click', () => { netInp.value = u; openNet(); });
        const x = el('button', { class: 'x', title: 'Убрать адрес', 'aria-label': 'Убрать адрес ' + u, text: '×' });
        x.addEventListener('click', () => { netSaved = netSaved.filter(v => v !== u); renderNet(); storeNet(netInp.value.trim()); });
        chip.append(goBtn, x); netChips.append(chip);
      });
    }
    function short(href) { try { return new URL(href).hostname.replace(/^www\./, ''); } catch (e) { return href; } }
    function storeNet(last) { try { O.Store.set('conv.ocr', { last: last || '', saved: netSaved }); } catch (e) { console.warn(e); } }
    function openNet() {
      const href = O.S && O.S.normUrl ? O.S.normUrl(netInp.value) : (netInp.value || '').trim();
      if (!href) { U.toast('Не понял адрес сайта', true); netInp.focus(); return; }
      netInp.value = href;
      netSaved = [href].concat(netSaved.filter(u => u !== href)).slice(0, 6);
      renderNet(); storeNet(href);
      const w = window.open(href, '_blank', 'noopener');
      if (!w) U.toast('Браузер не дал открыть вкладку — разрешите всплывающие окна для этой страницы', true);
    }
    netGo.addEventListener('click', openNet);
    netInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); openNet(); } });
    (async function () {
      try {
        const v = await O.Store.get('conv.ocr');
        if (v && typeof v === 'object') {
          if (Array.isArray(v.saved) && v.saved.length) netSaved = v.saved.slice(0, 6);
          netInp.value = v.last || OCR_SITES[0];
        } else netInp.value = OCR_SITES[0];
      } catch (e) { netInp.value = OCR_SITES[0]; }
      netSaved = netSaved.filter(u => u !== netInp.value);
      renderNet();
    })();

    const go = { disabled: true };

    drop.append(
      el('div', { class: 'conv-icon', html: '<svg viewBox="0 0 24 24"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z"/><path d="M14 3v4.5h4.5"/><path d="M12 17v-6m0 0-2.2 2.2M12 11l2.2 2.2"/></svg>' }),
      el('div', { class: 'conv-invite', text: 'Перетащите файл сюда' }),
      fileName,
      el('div', { class: 'row', style: 'justify-content:center;margin-top:10px' }, pick), inp);

    /* Одна честная фраза про выбранный файл */
    function lookLine(r) {
      if (!r) return '';
      if (r.scans === 0) return 'Внутри настоящие буквы — достану их точно и за секунду.';
      if (r.withText === 0) return 'Внутри букв нет, это снимок бумаги. Прочитать их программа пока не умеет — см. «Прочитать скан в интернете» внизу.';
      return 'Буквы есть на ' + r.withText + ' стр. из ' + r.total + '. Остальные ' + r.scans + ' — снимки бумаги, текста с них не будет.';
    }
    function setFile(f) {
      file = f; from = C.kindOf(f);
      peeked = null; look.textContent = ''; look.classList.remove('warn');
      fileName.textContent = f.name;
      fromBox.textContent = from ? KIND[from].name : 'Формат не поддерживается';
      fromBox.classList.toggle('muted', !from);
      toSel.innerHTML = ''; toSel.disabled = !from;
      if (from) KIND[from].to.forEach(t => toSel.append(el('option', { value: t, text: OUT[t] })));
      else toSel.append(el('option', { text: 'Формат не поддерживается' }));
      if (preset && from && KIND[from].to.includes(preset)) toSel.value = preset;
      updateHint(); syncSize();
      if (from === 'pdf') {
        // ответ по старому файлу не должен перебить новый выбор
        const my = ++seq;
        look.textContent = 'Смотрю, что внутри…';
        U.fileToU8(f).then(C.peek)
          .then(r => {
            if (my !== seq) return;
            peeked = r; look.textContent = lookLine(r);
            // в файле есть буквы — самое ценное для человека именно вытащить их
            if (r.withText && !preset && toSel.value === 'pdfsmall') { toSel.value = 'docx'; updateHint(); syncSize(); }
            syncNet(true);
          })
          .catch(() => { if (my === seq) look.textContent = ''; });
      } else syncNet();
      const btn = dlg && dlg.querySelector('footer .btn.primary'); if (btn) btn.disabled = !from;
    }
    function updateHint() {
      const t = toSel.value;
      hint.textContent = !from ? 'Подойдут: фото JPG, PNG, WEBP, BMP, а также PDF, Word (.docx) и LibreOffice (.odt).'
        : t === 'pdfsmall' ? 'Тяжёлый PDF станет легче. Страницы превратятся в картинки: искать текст поиском в таком файле уже не получится.'
        : t === 'docx' ? 'Из PDF вытащится текст. Если PDF — скан (картинка), текста в нём нет.'
        : t === 'txt' ? 'Получится обычный текстовый файл — его открывает и Блокнот, и Word. Оформление, таблицы и картинки не сохранятся, только буквы.'
        : from === 'pdf' && ['jpg', 'png', 'bmp'].includes(t) ? 'Каждая страница станет отдельной картинкой, хорошего качества — годится и для печати.'
        : t === 'pdf' ? 'Документ станет PDF: его можно подписать печатью прямо здесь.'
        : 'Картинка пересохранится в выбранный формат, размер не изменится.';
    }
    function syncSize() {
      // для Word и BMP размер не применяется: там нет качества сжатия
      const t = toSel.value;
      sizeBox.hidden = !from || t === 'docx' || t === 'txt' || t === 'bmp';
      // при сжатии PDF «как есть» бессмысленно: файл получится больше исходного
      sizeR.max = t === 'pdfsmall' ? 2 : 3;
      if (+sizeR.value > +sizeR.max) sizeR.value = sizeR.max;
      sizeName.textContent = SIZES[sizeKey()].name;
    }
    toSel.addEventListener('change', () => { updateHint(); syncSize(); syncNet(); });
    pick.addEventListener('click', () => { inp.value = ''; inp.click(); });
    inp.addEventListener('change', e => { const f = e.target.files[0]; if (f) setFile(f); });
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) setFile(f); });

    const body = el('div', { class: 'conv' }, [
      drop,
      el('div', { class: 'conv-row' }, [
        el('div', { class: 'f' }, [el('span', { text: 'Из чего' }), fromBox]),
        el('div', { class: 'conv-arrow', html: '<svg viewBox="0 0 24 24"><path d="M4 12h15m0 0-5-5m5 5-5 5"/></svg>' }),
        el('label', { class: 'f' }, [el('span', { text: 'Во что' }), toSel])
      ]),
      look,
      sizeBox,
      hint,
      prog,
      netBox
    ]);

    const dlg = D.show({
      title: 'Перевести файл в другой формат', body, width: 'md',
      buttons: [{ label: 'Закрыть' }, {
        label: 'Перевести и сохранить', primary: true, onClick: () => {
          if (running) { stopped = true; prog.textContent = 'Останавливаю…'; return false; }
          if (!file || !from) { U.toast('Сначала выберите файл', true); return false; }
          run(); return false;
        }
      }]
    });
    const btn = dlg.querySelector('footer .btn.primary'); btn.disabled = true;

    /* Блок с чужими сайтами сам раскрывается, когда он и правда нужен */
    /* Раскрываем по СОДЕРЖИМОМУ файла, а не по выбранному выходу: человек ещё ничего
       не выбрал, а уже должен видеть, что с этим сканом делать. */
    function syncNet(scroll) {
      const надо = from === 'pdf' && peeked && peeked.withText === 0;
      if (надо && !netBox.open) {
        netBox.open = true;
        if (scroll) setTimeout(() => { try { netBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }, 60);
      }
      netBox.classList.toggle('need', !!надо);
    }

    /* Ход работы показываем ВНУТРИ окна: надпись U.busy браузер прячет за открытым окном */
    let t0 = 0;
    function setRunning(on) {
      running = on; if (on) stopped = false;
      btn.textContent = on ? 'Остановить' : 'Перевести и сохранить';
      btn.classList.toggle('danger', on);
      pick.disabled = inp.disabled = toSel.disabled = sizeR.disabled = on;
      prog.hidden = !on;
      if (on) { t0 = 0; prog.textContent = 'Открываю файл…'; }
    }
    function onPage(i, n) {
      if (!t0) t0 = performance.now();
      const per = i > 1 ? (performance.now() - t0) / (i - 1) : 0;
      const left = per > 0 && i < n ? ' · осталось примерно ' + Math.max(1, Math.ceil(per * (n - i) / 1000)) + ' с' : '';
      prog.textContent = 'Читаю страницу ' + i + ' из ' + n + left;
    }

    async function run() {
      setRunning(true);
      try {
        const items = await C.run(file, toSel.value, sizeKey(), { onPage: onPage, stopped: () => stopped });
        prog.textContent = 'Сохраняю…';
        const saved = await C.save(items);
        D.close(dlg);
        const было = file.size, стало = items.reduce((a, i) => a + i.blob.size, 0);
        const кб = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
        const сколько = кб(было) + ' → ' + кб(стало) +
          (стало < было ? ' (легче на ' + Math.round((1 - стало / было) * 100) + '%)'
                        : ' (легче не стало — попробуйте размер поменьше)');
        const частично = items[0] && items[0].scanPages
          ? ' · ' + items[0].scanPages + ' из ' + items[0].total + ' стр. — снимки бумаги, текста с них нет' : '';
        U.toast((saved.length === 1 ? 'Готово: ' + saved[0] : 'Готово, файлов: ' + saved.length) + ' · ' + сколько + частично);
      } catch (e) {
        if (e && e.message === 'СКАН') {
          // тост лёг бы поверх того самого блока, на который показывает — пишем в строку над ним
          prog.hidden = true;
          look.textContent = 'Букв в этом файле нет — доставать нечего. Прочитать его можно на сайте: блок ниже уже раскрыт.';
          look.classList.add('warn');
          netBox.open = true; netBox.classList.add('need');
          setTimeout(() => { try { netBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (err) {} }, 60);
        } else {
          console.error(e);
          U.toast('Не получилось: ' + (e.message || e), true);
        }
      } finally { setRunning(false); }
    }

    resetTo();
    updateHint(); syncSize(); syncNet();   // подсказка и список нужны сразу: человек должен видеть, какие файлы подойдут
    if (preset && preset.file) setFile(preset.file);
  };

  O.C = C;
})(window.Ottisk);
