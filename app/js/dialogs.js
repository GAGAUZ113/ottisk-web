/* Диалоги: общие окна, правила, обработка картинки печати/подписи, рисование подписи. */
(function (O) {
  'use strict';
  const U = O.U, IP = O.IP, el = U.el; const D = {};

  /* Базовое окно. opts: {title, body (элемент), buttons:[{label,primary,danger,left,onClick}], width} */
  D.show = function (opts) {
    const dlg = el('dialog');
    const box = el('div', { class: 'dlg w-' + (opts.width || 'md') });
    const head = el('header', null, [el('h2', { text: opts.title }), el('button', { class: 'btn icon', title: 'Закрыть', 'aria-label': 'Закрыть', onclick: () => D.close(dlg) }, svgX())]);
    const body = el('div', { class: 'body' }, opts.body);
    const foot = el('footer');
    (opts.buttons || []).forEach(b => {
      const btn = el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '') + (b.left ? ' left' : ''), text: b.label });
      btn.addEventListener('click', () => { const r = b.onClick ? b.onClick(dlg) : true; if (r !== false) D.close(dlg); });
      foot.append(btn);
    });
    box.append(head, body); if (opts.buttons && opts.buttons.length) box.append(foot);
    dlg.append(box); document.body.append(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); if (opts.onClose) opts.onClose(dlg.returnValue); });
    dlg.addEventListener('cancel', e => { if (opts.noEsc) e.preventDefault(); });
    dlg.showModal();
    return dlg;
  };
  D.close = function (dlg, value) { try { dlg.close(value || ''); } catch (e) { dlg.remove(); } };
  function svgX() { return el('span', { html: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>' }).firstChild; }

  D.confirm = (text, o) => new Promise(res => {
    o = o || {}; let ok = false;
    D.show({ title: o.title || 'Подтвердите', body: el('p', { text }), onClose: () => res(ok),
      buttons: [{ label: 'Отмена' }, { label: o.ok || 'Да', primary: !o.danger, danger: !!o.danger, onClick: () => { ok = true; } }] });
  });
  D.alert = (title, text) => new Promise(res => { D.show({ title, body: typeof text === 'string' ? el('p', { text }) : text, onClose: () => res(), buttons: [{ label: 'Понятно', primary: true }] }); });
  D.prompt = (title, label, value) => new Promise(res => {
    let out = null; const inp = el('input', { class: 'inp', value: value || '' });
    const dlg = D.show({ title, body: el('label', { class: 'f' }, [el('span', { text: label }), inp]), onClose: () => res(out),
      buttons: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, onClick: () => { out = inp.value.trim(); if (!out) { inp.focus(); return false; } } }] });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { out = inp.value.trim(); if (out) D.close(dlg); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });

  /* Телефон: готовый файл — сразу в Telegram, почту, WhatsApp (стандартное меню «Поделиться») */
  D.canShare = file => { try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; } };
  D.shareFile = (file, title) => new Promise(res => {
    const body = el('div', { class: 'stack' }, [
      el('p', { style: 'margin:0', text: `«${file.name}» готов.` }),
      el('p', { class: 'muted', style: 'margin:0', text: 'Отправьте его сразу в Telegram, почту или WhatsApp — или сохраните в «Файлы».' })
    ]);
    D.show({ title: title || 'Готово', body, onClose: () => res(),
      buttons: [
        { label: 'Сохранить', onClick: () => { U.download(file, file.name, file.type); } },
        { label: 'Отправить…', primary: true, onClick: () => { navigator.share({ files: [file], title: file.name }).catch(e => { if (e && e.name !== 'AbortError') U.download(file, file.name, file.type); }); } }
      ] });
  });

  D.rules = () => new Promise(res => {
    const body = el('div', { class: 'rules' }, [
      el('p', { class: 'muted', text: 'Четыре простых правила, чтобы не было неприятностей:' }),
      el('ol', null, [
        el('li', { text: 'Только печати и подписи своей компании и только с согласия директора.' }),
        el('li', { text: 'Подпись человека рисует или фотографирует он сам.' }),
        el('li', { text: 'Правка текста — только в своих документах и черновиках; документ, подписанный другой стороной, не меняем.' }),
        el('li', { text: 'Для налоговой, банка, суда, нотариуса нужен оригинал или электронная подпись.' })
      ])
    ]);
    D.show({ title: 'Правила', body, onClose: () => res(), buttons: [{ label: 'Понятно', primary: true }] });
  });

  D.wordFile = function (name) {
    const body = el('div', null, [
      el('p', { text: `«${name}» — старый формат Word (.doc), Excel или другой офисный файл. Здесь открываются PDF, Word .docx и фото.` }),
      el('p', { text: 'Откройте файл в Word или Excel и сохраните как PDF (Файл → Сохранить как → PDF) или как .docx, затем откройте здесь.' }),
      el('p', { class: 'muted', text: 'Или возьмите печать для Word: под каждой печатью и подписью слева есть кнопка «PNG для Word». Картинка вставится в точном размере; в Word выберите Обтекание текстом → За текстом.' })
    ]);
    return D.alert('Нужен PDF', body);
  };

  /* ───────── Обработка фото/скана печати или подписи ───────── */
  D.processImage = function (file, kind) {
    return new Promise(async (resolve) => {
      let img;
      try { const url = await U.blobToDataUrl(file); img = await U.loadImage(url); }
      catch (e) { U.toast('Не удалось открыть картинку', true); return resolve(null); }
      const full = IP.canvasFromImage(img, 2000);
      const keepAlpha = IP.hasRealAlpha(full);
      const prev = IP.downscale(full, 640);
      const isStamp = kind === 'stamp';
      const st = { cleanup: 0.45, ink: 'auto', angle: 0, size: isStamp ? 40 : 35, cropMode: 'auto', crop: null, round: false, bg: 'checker' };
      let processed = null, result = null;

      // разметка
      const stage = el('div', { class: 'stage blend' }); const cv = el('canvas'); stage.append(cv);
      const cropBox = el('div', { class: 'crop' }); ['nw', 'ne', 'sw', 'se'].forEach(k => cropBox.append(el('div', { class: 'h ' + k, 'data-k': k }))); stage.append(cropBox);
      const prevWrap = el('div', { class: 'prev checker' }, stage);
      const bgSeg = seg([['checker', 'Клетка'], ['paper', 'На бумаге']], 'checker', v => { st.bg = v; prevWrap.className = 'prev ' + v; });
      const cleanupR = el('input', { type: 'range', class: 'range', min: 0, max: 100, value: 45 });
      const cleanupV = el('span', { class: 'num', text: '45' });
      const inkRadios = el('div', { class: 'radio' });
      [['auto', 'Как на фото', null], ['blue', 'Синяя', IP.INKS.blue], ['violet', 'Фиолетовая', IP.INKS.violet], ['black', 'Чёрная', IP.INKS.black]].forEach(([v, t, c]) => {
        const r = el('input', { type: 'radio', name: 'ink', value: v }); if (v === 'auto') r.checked = true;
        r.addEventListener('change', () => { st.ink = v; render(); });
        inkRadios.append(el('label', null, [r, c ? el('span', { class: 'swatch', style: 'background:' + c }) : null, el('span', { text: t })]));
      });
      const angleR = el('input', { type: 'range', class: 'range', min: -15, max: 15, step: 0.5, value: 0 });
      const angleV = el('span', { class: 'num', text: '0°' });
      const sizeI = el('input', { type: 'number', class: 'inp num', min: 5, max: 300, step: 0.5, value: st.size });
      const sizeLbl = el('span', { text: isStamp ? 'Диаметр, мм' : 'Ширина, мм' });
      const nameI = el('input', { class: 'inp', value: isStamp ? 'Печать' : '', placeholder: isStamp ? 'Например: Основная печать' : 'Фамилия И. О.' });
      const roleI = el('input', { class: 'inp', placeholder: 'Например: Директор' });
      const autoBtn = el('button', { class: 'btn sm', text: 'Обрезать автоматически', onclick: () => { st.cropMode = 'auto'; render(); } });
      const alphaNote = keepAlpha ? el('p', { class: 'hint', text: 'В картинке уже есть прозрачный фон — оставляем как есть.' }) : null;

      const ctl = el('div', { class: 'ctl' }, [
        el('div', { class: 'row', style: 'justify-content:space-between' }, [el('span', { class: 'muted small', text: 'Предпросмотр' }), bgSeg]),
        el('label', { class: 'f' }, [el('span', null, [el('span', { text: 'Очистка фона' }), cleanupV]), cleanupR]),
        alphaNote,
        el('div', { class: 'f' }, [el('span', { text: 'Цвет краски' }), inkRadios]),
        el('label', { class: 'f' }, [el('span', null, [el('span', { text: 'Выровнять' }), angleV]), angleR]),
        el('div', { class: 'f' }, [el('span', { text: 'Обрезка' }), el('div', { class: 'row' }, autoBtn), el('span', { class: 'hint', text: 'Если рамка легла неточно — потяните за её углы.' })]),
        el('label', { class: 'f' }, [sizeLbl, sizeI]),
        el('label', { class: 'f' }, [el('span', { text: isStamp ? 'Название (обязательно)' : 'ФИО владельца (обязательно)' }), nameI]),
        isStamp ? null : el('label', { class: 'f' }, [el('span', { text: 'Должность' }), roleI])
      ]);
      if (keepAlpha) { cleanupR.disabled = true; cleanupR.parentElement.style.opacity = .5; }
      const body = el('div', { class: 'proc' }, [prevWrap, ctl]);

      let dispScale = 1;
      function render() {
        processed = IP.process(prev, { keepAlpha, cleanup: st.cleanup, ink: st.ink, angle: st.angle });
        if (st.cropMode === 'auto' || !st.crop) { const r = IP.autoCrop(processed, isStamp ? undefined : false); st.crop = r; st.round = r.round; }
        cv.width = processed.width; cv.height = processed.height; cv.getContext('2d').drawImage(processed, 0, 0);
        const areaW = prevWrap.clientWidth - 24 || 560, areaH = prevWrap.clientHeight - 24 || 430;
        dispScale = Math.min(areaW / processed.width, areaH / processed.height, 1.5);
        cv.style.width = (processed.width * dispScale) + 'px'; cv.style.height = (processed.height * dispScale) + 'px';
        placeCrop(); updateSizeLabel();
      }
      function placeCrop() {
        const r = st.crop; cropBox.style.left = r.x * dispScale + 'px'; cropBox.style.top = r.y * dispScale + 'px';
        cropBox.style.width = r.w * dispScale + 'px'; cropBox.style.height = r.h * dispScale + 'px';
      }
      function updateSizeLabel() { const rnd = st.round && isStamp; sizeLbl.textContent = rnd ? 'Диаметр, мм' : 'Ширина, мм'; }
      const rerender = U.debounce(render, 40);
      cleanupR.addEventListener('input', () => { st.cleanup = +cleanupR.value / 100; cleanupV.textContent = cleanupR.value; st.cropMode = 'auto'; rerender(); });
      angleR.addEventListener('input', () => { st.angle = +angleR.value; angleV.textContent = angleR.value + '°'; st.cropMode = 'auto'; rerender(); });

      // ручная обрезка — углы рамки
      cropBox.addEventListener('pointerdown', e => {
        const k = e.target.getAttribute('data-k'); if (!k) return;
        e.preventDefault(); e.target.setPointerCapture(e.pointerId);
        const start = { x: e.clientX, y: e.clientY }, r0 = Object.assign({}, st.crop);
        const move = ev => {
          const dx = (ev.clientX - start.x) / dispScale, dy = (ev.clientY - start.y) / dispScale;
          let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
          if (k.includes('w')) x0 = Math.min(x0 + dx, x1 - 10); if (k.includes('e')) x1 = Math.max(x1 + dx, x0 + 10);
          if (k.includes('n')) y0 = Math.min(y0 + dy, y1 - 10); if (k.includes('s')) y1 = Math.max(y1 + dy, y0 + 10);
          st.crop = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), round: false }; st.cropMode = 'manual';
          const ar = st.crop.w / st.crop.h; st.round = isStamp && ar > 0.9 && ar < 1.1; placeCrop(); updateSizeLabel();
        };
        const up = () => { cropBox.removeEventListener('pointermove', move); cropBox.removeEventListener('pointerup', up); };
        cropBox.addEventListener('pointermove', move); cropBox.addEventListener('pointerup', up);
      });

      const dlg = D.show({
        title: isStamp ? 'Новая печать' : 'Подпись с фото', body, width: 'lg', onClose: () => resolve(result),
        buttons: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, onClick: () => {
          const name = nameI.value.trim(); if (!name) { nameI.focus(); U.toast(isStamp ? 'Дайте печати название' : 'Укажите ФИО владельца подписи', true); return false; }
          const size = U.clamp(+sizeI.value || st.size, 5, 300);
          const fullP = IP.process(full, { keepAlpha, cleanup: st.cleanup, ink: st.ink, angle: st.angle });
          const k = fullP.width / processed.width;
          const rect = { x: Math.round(st.crop.x * k), y: Math.round(st.crop.y * k), w: Math.round(st.crop.w * k), h: Math.round(st.crop.h * k) };
          const out = IP.crop(fullP, rect, 1600);
          const round = isStamp && st.round;
          const wMm = size, hMm = round ? size : size * out.height / out.width;
          result = { id: U.uid(), name, role: roleI.value.trim(), dataUrl: out.toDataURL('image/png'), wMm, hMm, round, ink: st.ink, px: [out.width, out.height] };
        } }]
      });
      setTimeout(render, 30);
      window.addEventListener('resize', rerender, { once: true });
      dlg.addEventListener('close', () => window.removeEventListener('resize', rerender));
    });
  };

  function seg(items, val, onChange) {
    const s = el('div', { class: 'segment' });
    items.forEach(([v, t]) => { const b = el('button', { text: t, class: v === val ? 'on' : '' }); b.addEventListener('click', () => { U.$$('button', s).forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(v); }); s.append(b); });
    return s;
  }

  /* ───────── Рисование подписи ───────── */
  D.drawSignature = function () {
    return new Promise(resolve => {
      let result = null;
      const wrap = el('div', { class: 'sigwrap' }); const cv = el('canvas'); wrap.append(cv);
      const PENS = { blue: '#1f2f86', black: '#1b1b1f' };
      let pad;
      const penSeg = seg([['blue', 'Шариковая синяя'], ['black', 'Чёрная ручка']], 'blue', v => { pad.penColor = PENS[v]; });
      const nameI = el('input', { class: 'inp', placeholder: 'Фамилия И. О.' });
      const roleI = el('input', { class: 'inp', placeholder: 'Например: Директор' });
      const widthI = el('input', { type: 'number', class: 'inp num', min: 10, max: 120, step: 0.5, value: 35 });
      const clearB = el('button', { class: 'btn sm', text: 'Очистить', onclick: () => pad.clear() });
      const undoB = el('button', { class: 'btn sm', text: 'Отменить штрих', onclick: () => { const d = pad.toData(); if (d.length) { d.pop(); pad.fromData(d); } } });
      const body = el('div', { class: 'stack' }, [
        el('p', { class: 'muted', style: 'margin:0', text: 'Подпись рисует её владелец. Мышью или пальцем по экрану — как ручкой по строке.' }),
        el('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:wrap;gap:8px' }, [penSeg, el('div', { class: 'row' }, [undoB, clearB])]),
        wrap,
        el('div', { class: 'props' }, el('div', { class: 'kv' }, [
          el('label', { class: 'f' }, [el('span', { text: 'ФИО владельца (обязательно)' }), nameI]),
          el('label', { class: 'f' }, [el('span', { text: 'Должность' }), roleI]),
          el('label', { class: 'f' }, [el('span', { text: 'Ширина на документе, мм' }), widthI])
        ]))
      ]);
      const dlg = D.show({
        title: 'Нарисовать подпись', body, width: 'lg', onClose: () => resolve(result),
        buttons: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, onClick: () => {
          if (pad.isEmpty()) { U.toast('Подпись пока пустая', true); return false; }
          const name = nameI.value.trim(); if (!name) { nameI.focus(); U.toast('Укажите ФИО владельца подписи', true); return false; }
          const trimmed = IP.trimTransparent(cv, 6);
          const wMm = U.clamp(+widthI.value || 35, 10, 120);
          result = { id: U.uid(), name, role: roleI.value.trim(), dataUrl: trimmed.toDataURL('image/png'), wMm, hMm: wMm * trimmed.height / trimmed.width, round: false, ink: 'auto', px: [trimmed.width, trimmed.height] };
        } }]
      });
      // размер холста под DPR
      setTimeout(() => {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const r = wrap.getBoundingClientRect();
        cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
        cv.getContext('2d').scale(dpr, dpr);
        // Толщина как у шариковой ручки: подпись шириной ~450 px на экране ложится в 35 мм на документе,
        // значит след 0,3–0,6 мм — это примерно 1,4–3,4 px на холсте.
        pad = new SignaturePad(cv, { minWidth: 1.4, maxWidth: 3.4, dotSize: 2.4, velocityFilterWeight: 0.7, minDistance: 1, throttle: 8, penColor: PENS.blue, backgroundColor: 'rgba(0,0,0,0)' });
        dlg._pad = pad;
      }, 40);
    });
  };

  O.D = D;
})(window.Ottisk);
