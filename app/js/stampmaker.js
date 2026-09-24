/* Конструктор канцелярских штампов: «Принято», «Вх. № __ от __», «Копия верна», складские отметки.
   Это рабочие пометки делопроизводства — они ничего не удостоверяют.
   Круглую печать организации с реквизитами программа не рисует: настоящую печать
   заказывают в мастерской, а сюда заносят фотографией готового оттиска. */
(function (O) {
  'use strict';
  const U = O.U, D = O.D, el = U.el; const M = {};

  const DPI = 600;                       // штамп рисуем с запасом, чтобы был чётким в PDF
  const MM = 25.4;
  const INKS = { blue: '#1c3f94', violet: '#57399a', black: '#1b1b1f' };

  /* Готовые заготовки: то, что чаще всего нужно в канцелярии и на складе */
  M.TEMPLATES = [
    { id: 'in', name: 'Входящий документ', w: 55, frame: 'single',
      lines: [{ t: 'ВХОДЯЩИЙ', b: true }, { t: '№ ______________' }, { t: '«___» __________ 20__ г.' }] },
    { id: 'accepted', name: 'Принято', w: 48, frame: 'double',
      lines: [{ t: 'ПРИНЯТО', b: true, s: 1.3 }, { t: '«___» __________ 20__ г.' }, { t: 'Подпись ____________' }] },
    { id: 'copy', name: 'Копия верна', w: 52, frame: 'single',
      lines: [{ t: 'КОПИЯ ВЕРНА', b: true }, { t: 'Должность ___________' }, { t: 'Подпись ____________' }, { t: '«___» __________ 20__ г.' }] },
    { id: 'paid', name: 'Оплачено', w: 44, frame: 'double',
      lines: [{ t: 'ОПЛАЧЕНО', b: true, s: 1.3 }, { t: '«___» __________ 20__ г.' }] },
    { id: 'case', name: 'В дело', w: 40, frame: 'single',
      lines: [{ t: 'В ДЕЛО', b: true, s: 1.3 }, { t: '№ ________' }, { t: '«___» ______ 20__ г.' }] },
    { id: 'ship', name: 'Отгружено (склад)', w: 50, frame: 'single',
      lines: [{ t: 'ОТГРУЖЕНО', b: true }, { t: 'Склад № ______' }, { t: '«___» __________ 20__ г.' }, { t: 'Кладовщик __________' }] },
    { id: 'check', name: 'Проверено (склад)', w: 48, frame: 'single',
      lines: [{ t: 'ПРОВЕРЕНО', b: true }, { t: 'Количество ________' }, { t: 'Подпись ___________' }] },
    { id: 'received', name: 'Получено', w: 50, frame: 'single',
      lines: [{ t: 'ПОЛУЧЕНО', b: true }, { t: '«___» __________ 20__ г.' }, { t: 'Подпись ____________' }] },
    { id: 'shift', name: 'Смена (круглый)', w: 38, frame: 'double', shape: 'round',
      lines: [{ t: 'СМЕНА' }, { t: '№ ___', b: true, s: 1.4 }, { t: '«__» ____ 20__' }] },
    { id: 'qc', name: 'ОТК — проверено (круглый)', w: 40, frame: 'double', shape: 'round',
      lines: [{ t: 'ОТК', b: true, s: 1.3 }, { t: 'ПРОВЕРЕНО' }, { t: 'Контролёр № ___' }] },
    { id: 'courier', name: 'Курьер — выдано (овальный)', w: 52, frame: 'single', shape: 'oval',
      lines: [{ t: 'ВЫДАНО КУРЬЕРУ', b: true }, { t: 'Маршрут № ______' }, { t: '«___» ______ 20__ г.' }] },
    { id: 'free', name: 'Свой текст', w: 50, frame: 'single', lines: [{ t: 'Текст штампа', b: true }] }
  ];

  /* Отрисовка штампа на холсте. opts: {lines:[{t,b,s}], shape:'rect'|'round'|'oval', frame, ink, wMm} */
  M.draw = function (opts) {
    const shape = opts.shape || 'rect';
    const wPx = Math.round(opts.wMm / MM * DPI);
    const lines = opts.lines.filter(l => l.t.trim().length);
    if (!lines.length) lines.push({ t: ' ' });
    const baseFull = wPx * (shape === 'round' ? 0.075 : 0.082);   // кегль при обычном тексте
    const pad = Math.round(wPx * 0.055);
    const lw = Math.max(2, Math.round(wPx * 0.011));
    const measure = document.createElement('canvas').getContext('2d');

    /* раскладка при выбранном кегле */
    const layout = k => {
      const base = baseFull * k, lh = base * 1.42;
      const rows = lines.map(l => ({ l, size: base * (l.s || 1), step: lh * (l.s || 1) }));
      const textH = rows.reduce((a, r) => a + r.step, 0);
      const h = shape === 'round' ? wPx
        : shape === 'oval' ? Math.round(wPx * 0.66)
        : Math.round(pad * 2 + textH + base * 0.25);
      let y = shape === 'rect' ? pad + base * 0.15 : (h - textH) / 2;
      rows.forEach(r => { r.cy = y + r.step / 2; y += r.step; });
      return { base, rows, textH, h };
    };
    /* сколько места есть у строки по ширине: у круга и овала — хорда на её высоте */
    const room = (L, r) => {
      if (shape === 'rect') return wPx - pad * 2 - (opts.frame === 'double' ? wPx * 0.03 : 0);
      const inset = (opts.frame === 'double' ? lw * 3.4 : lw) + wPx * 0.03;
      const a = wPx / 2 - inset, b = L.h / 2 - inset;
      const dy = Math.abs(r.cy - L.h / 2) + r.size * 0.62;       // нижний край букв
      if (dy >= b) return 0;
      return 2 * a * Math.sqrt(1 - (dy / b) * (dy / b)) * 0.94;  // небольшой запас до рамки
    };
    const fits = L => {
      if (shape !== 'rect' && L.textH > (L.h - 2 * lw) * 0.9) return false;
      return L.rows.every(r => {
        measure.font = (r.l.b ? '700 ' : '400 ') + Math.round(r.size) + 'px LibSans, Arial, sans-serif';
        return measure.measureText(r.l.t).width <= room(L, r);
      });
    };
    // подбираем кегль: уменьшаем, пока строки по-настоящему не влезут в рамку
    let k = 1, L = layout(1);
    for (let i = 0; i < 40 && !fits(L); i++) { k *= 0.95; L = layout(k); }

    const hPx = L.h;
    const c = document.createElement('canvas'); c.width = wPx; c.height = hPx;
    const x = c.getContext('2d');
    const ink = INKS[opts.ink] || INKS.blue;
    x.clearRect(0, 0, wPx, hPx);
    x.fillStyle = ink; x.strokeStyle = ink;
    x.textAlign = 'center'; x.textBaseline = 'middle';

    if (opts.frame !== 'none') {
      if (shape === 'rect') {
        const r = Math.round(wPx * 0.02);
        const rect = (inset, width) => {
          x.lineWidth = width;
          const a = inset, b = wPx - inset, t = inset, d2 = hPx - inset;
          x.beginPath();
          x.moveTo(a + r, t); x.lineTo(b - r, t); x.quadraticCurveTo(b, t, b, t + r);
          x.lineTo(b, d2 - r); x.quadraticCurveTo(b, d2, b - r, d2);
          x.lineTo(a + r, d2); x.quadraticCurveTo(a, d2, a, d2 - r);
          x.lineTo(a, t + r); x.quadraticCurveTo(a, t, a + r, t);
          x.closePath(); x.stroke();
        };
        rect(lw, lw);
        if (opts.frame === 'double') rect(Math.round(lw * 3.2), Math.max(1, Math.round(lw * 0.55)));
      } else {
        const ring = (inset, width) => {
          x.lineWidth = width;
          x.beginPath();
          x.ellipse(wPx / 2, hPx / 2, wPx / 2 - inset, hPx / 2 - inset, 0, 0, Math.PI * 2);
          x.stroke();
        };
        ring(lw, lw);
        if (opts.frame === 'double') ring(Math.round(lw * 3.4), Math.max(1, Math.round(lw * 0.55)));
      }
    }

    L.rows.forEach(r => {
      x.font = (r.l.b ? '700 ' : '400 ') + Math.round(r.size) + 'px LibSans, Arial, sans-serif';
      const avail = room(L, r), w = x.measureText(r.l.t).width;
      // кегль уже подобран; сжимаем по ширине только если строка совсем не поддалась
      if (w > avail && avail > 0) { x.save(); x.translate(wPx / 2, r.cy); x.scale(avail / w, 1); x.fillText(r.l.t, 0, 0); x.restore(); }
      else x.fillText(r.l.t, wPx / 2, r.cy);
    });
    return c;
  };

  /* Окно конструктора. Возвращает готовый элемент библиотеки или null */
  M.open = function () {
    return new Promise(resolve => {
      const st = { tpl: M.TEMPLATES[0], shape: 'rect', frame: 'single', ink: 'blue', wMm: 55, lines: [] };
      const applyTpl = t => {
        st.tpl = t; st.frame = t.frame; st.wMm = t.w; st.shape = t.shape || 'rect';
        st.lines = t.lines.map(l => Object.assign({}, l));
        ta.value = st.lines.map((l, i) => (l.b && i > 0 ? '* ' : '') + l.t).join('\n');
        widthI.value = st.wMm; frameSeg.set(st.frame); shapeSeg.set(st.shape);
        nameI.value = t.id === 'free' ? '' : 'Штамп «' + t.name + '»';
        render();
      };

      const cv = el('canvas');
      const prevWrap = el('div', { class: 'prev paper' }, el('div', { class: 'stage blend' }, cv));

      const tplSel = el('select', { class: 'sel' }, M.TEMPLATES.map(t => el('option', { value: t.id, text: t.name })));
      tplSel.addEventListener('change', () => applyTpl(M.TEMPLATES.find(t => t.id === tplSel.value)));

      const ta = el('textarea', { class: 'inp', rows: '5' });
      ta.addEventListener('input', () => {
        const raw = ta.value.split('\n');
        const звёздочки = raw.some(s => /^\*\s?/.test(s));
        st.lines = raw.map((s, i) => {
          // без звёздочек первая строка сама становится главной — так штамп и выглядит
          const b = звёздочки ? /^\*\s?/.test(s) : i === 0;
          return { t: s.replace(/^\*\s?/, ''), b, s: b && raw.length <= 2 ? 1.3 : 1 };
        });
        render();
      });

      const shapeSeg = seg([['rect', 'Прямоугольный'], ['round', 'Круглый'], ['oval', 'Овальный']], 'rect', v => { st.shape = v; render(); });
      const frameSeg = seg([['single', 'Одинарная'], ['double', 'Двойная'], ['none', 'Без рамки']], 'single', v => { st.frame = v; render(); });
      const inkRadios = el('div', { class: 'radio inks' });
      [['blue', 'Синяя'], ['violet', 'Фиолетовая'], ['black', 'Чёрная']].forEach(([v, t]) => {
        const r = el('input', { type: 'radio', name: 'stampink', value: v }); if (v === 'blue') r.checked = true;
        r.addEventListener('change', () => { st.ink = v; render(); });
        inkRadios.append(el('label', null, [r, el('span', { class: 'swatch', style: 'background:' + INKS[v] }), el('span', { text: t })]));
      });
      const widthI = el('input', { type: 'number', class: 'inp num', min: 20, max: 120, step: 1, value: 55 });
      widthI.addEventListener('input', () => { st.wMm = U.clamp(+widthI.value || 50, 20, 120); render(); });
      const nameI = el('input', { class: 'inp' });
      const sizeNote = el('p', { class: 'hint' });

      const ctl = el('div', { class: 'ctl' }, [
        el('label', { class: 'f' }, [el('span', { text: 'Заготовка' }), tplSel]),
        el('label', { class: 'f' }, [el('span', { text: 'Текст штампа' }), ta,
          el('p', { class: 'hint', text: 'Каждая строка — с новой строки. Первая строка выделяется сама. Если нужно выделить другую — поставьте * в её начале. Прочерки для даты и номера пишите так: «___» __________ 20__ г.' })]),
        el('div', { class: 'f' }, [el('span', { text: 'Форма' }), shapeSeg]),
        el('div', { class: 'f' }, [el('span', { text: 'Рамка' }), frameSeg]),
        el('div', { class: 'f' }, [el('span', { text: 'Цвет краски' }), inkRadios]),
        el('label', { class: 'f' }, [el('span', { text: 'Ширина (у круглого — диаметр), мм' }), widthI, sizeNote]),
        el('label', { class: 'f' }, [el('span', { text: 'Название (обязательно)' }), nameI]),
        el('p', { class: 'hint', text: 'Это канцелярский штамп — рабочая пометка. Круглую печать организации программа не рисует: её заказывают в мастерской, а сюда заносят фотографией оттиска.' })
      ]);

      let out = null;
      function render() {
        out = M.draw({ lines: st.lines, shape: st.shape, frame: st.frame, ink: st.ink, wMm: st.wMm });
        cv.width = out.width; cv.height = out.height;
        cv.getContext('2d').drawImage(out, 0, 0);
        const areaW = prevWrap.clientWidth - 40 || 480;
        const k = Math.min(areaW / out.width, 1);
        cv.style.width = (out.width * k) + 'px'; cv.style.height = (out.height * k) + 'px';
        sizeNote.textContent = 'Размер на бумаге: ' + U.fmt(st.wMm, 0) + ' × ' + U.fmt(st.wMm * out.height / out.width, 0) + ' мм';
      }

      const dlg = D.show({
        title: 'Создать штамп', body: el('div', { class: 'proc' }, [prevWrap, ctl]), width: 'lg',
        onClose: () => resolve(null),
        buttons: [{ label: 'Отмена' }, {
          label: 'Сохранить в библиотеку', primary: true, onClick: () => {
            const name = nameI.value.trim();
            if (!name) { nameI.focus(); U.toast('Дайте штампу название', true); return false; }
            const hMm = st.wMm * out.height / out.width;
            resolve({ id: U.uid(), name, role: '', dataUrl: out.toDataURL('image/png'), wMm: st.wMm, hMm, round: st.shape === 'round', ink: st.ink, px: [out.width, out.height] });
          }
        }]
      });
      applyTpl(M.TEMPLATES[0]);
      setTimeout(render, 30);
    });
  };

  function seg(items, val, onChange) {
    let v = val; const s = el('div', { class: 'segment' }); const btns = {};
    items.forEach(([value, text]) => {
      const b = el('button', { text, class: value === val ? 'on' : '' });
      btns[value] = b;
      b.addEventListener('click', () => { s.set(value); onChange(value); });
      s.append(b);
    });
    s.set = nv => { v = nv; Object.keys(btns).forEach(k => btns[k].classList.toggle('on', k === nv)); };
    s.value = () => v;
    return s;
  }

  O.M = M;
})(window.Ottisk);
