/* Номер документа — то, что по-настоящему защищает от подделки.

   Потёртость и размытие оттиска не защищают: их повторит кто угодно за пять минут
   в любом редакторе. Защищает номер, которого у подделывателя нет: чтобы он сошёлся,
   нужен ваш журнал.

   Как это работает на складе:
   у каждого рабочего места свой код (СКЛ3, СКЛ7, КАНЦ), каждый поставленный номер
   попадает в журнал с датой, временем, файлом и фирмой. Пришла спорная накладная —
   нашли номер в журнале: есть запись — наша, нет — не наша.

   Номер вида КОД-ГОД-НННН, счёт идёт по каждому рабочему месту отдельно и
   обнуляется с нового года. */
(function (O) {
  'use strict';
  const U = O.U, el = U.el; const N = { code: '', year: 0, seq: 0 };
  const KEY = 'numbering';
  const pad4 = n => String(n).padStart(4, '0');
  const CODE_RE = /^[A-ZА-Я0-9][A-ZА-Я0-9-]{0,9}$/;

  function save() { try { O.Store.set(KEY, { code: N.code, year: N.year, seq: N.seq }); } catch (e) { console.warn(e); } }

  N.init = async function () {
    try {
      const v = await O.Store.get(KEY);
      if (v && typeof v === 'object') { N.code = v.code || ''; N.year = +v.year || 0; N.seq = +v.seq || 0; }
    } catch (e) { console.warn(e); }
    const edit = U.$('#numEdit'), place = U.$('#numPlace');
    if (edit) edit.addEventListener('click', N.ask);
    if (place) place.addEventListener('click', N.place);
    N.render();
  };

  /* Какой номер будет следующим — показываем заранее, чтобы не было сюрпризов */
  N.peek = function () {
    const y = new Date().getFullYear();
    return (N.code || '—') + '-' + y + '-' + pad4((N.year === y ? N.seq : 0) + 1);
  };

  N.next = function () {
    const y = new Date().getFullYear();
    if (N.year !== y) { N.year = y; N.seq = 0; }   // с нового года счёт с единицы
    N.seq++; save(); N.render();
    return N.code + '-' + y + '-' + pad4(N.seq);
  };

  N.render = function () {
    const c = U.$('#numCode'); if (c) { c.textContent = N.code || 'не задано'; c.classList.toggle('muted', !N.code); }
    const n = U.$('#numNext');
    if (n) n.textContent = N.code ? 'Следующий номер: ' + N.peek() : 'Сначала задайте код рабочего места.';
    const p = U.$('#numPlace'); if (p) p.disabled = !N.code;
  };

  /* Спросить код рабочего места. Главное, что человек должен понять: код у каждого
     компьютера СВОЙ, иначе два склада выдадут одинаковые номера и сверка развалится. */
  N.ask = function () {
    const D = O.D;
    const inp = el('input', { class: 'inp', value: N.code, placeholder: 'СКЛ3', maxlength: '10',
      autocapitalize: 'characters', spellcheck: 'false' });
    const err = el('p', { class: 'hint', style: 'color:var(--danger)', hidden: true });
    const body = el('div', { class: 'stack' }, [
      el('label', { class: 'f' }, [el('span', { text: 'Код рабочего места' }), inp]),
      err,
      el('p', { class: 'hint', text: 'Короткая метка этого компьютера: СКЛ3, СКЛ7, КАНЦ. Русские и латинские буквы, цифры и дефис, до 10 знаков.' }),
      el('p', { class: 'hint', text: 'ВАЖНО: у каждого компьютера должен быть СВОЙ код. Если поставить одинаковый на двух, номера совпадут и по журналу уже не разобрать, кто ставил.' })
    ]);
    let dlg = null;
    const apply = () => {
      const v = inp.value.trim().toUpperCase();
      if (!CODE_RE.test(v)) { err.textContent = 'Так нельзя: нужны буквы, цифры и дефис, от 1 до 10 знаков.'; err.hidden = false; inp.focus(); return false; }
      if (v !== N.code) { N.code = v; N.year = 0; N.seq = 0; }   // сменили место — счёт начинается заново
      save(); N.render();
      U.toast('Код рабочего места: ' + N.code + '. Следующий номер — ' + N.peek());
      return true;
    };
    dlg = D.show({
      title: 'Код рабочего места', body, width: 'sm',
      buttons: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, onClick: () => apply() }]
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (apply()) D.close(dlg); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  };

  /* Поставить номер на текущую страницу. Это обычный текст — его видно на бумаге,
     можно подвинуть и увеличить, но он помечен изнутри и попадёт в журнал. */
  N.place = function () {
    const V = O.V;
    if (!V.doc) { U.toast('Сначала откройте документ', true); return; }
    if (!N.code) { N.ask(); return; }
    const i = V.currentPage(), p = V.doc.pages[i];
    if (!p) { U.toast('Не нашёл страницу', true); return; }
    // один номер на страницу: иначе второй лёг бы точно поверх первого,
    // а из счётчика впустую ушёл бы номер, которого потом не найти в журнале
    const уже = V.doc.elements.find(e => e.num && e.page === i);
    if (уже) {
      V.select(уже.id);
      U.toast('На этой странице уже стоит номер ' + уже.num + '. Чтобы поставить другой — сначала удалите этот.', true);
      return;
    }
    const num = N.next();
    // правый нижний угол — там, где обычно и ставят регистрационный номер
    const x = Math.max(U.mm2pt(10), p.vp1.width - U.mm2pt(52));
    const y = Math.max(U.mm2pt(8), p.vp1.height - U.mm2pt(14));
    const e = V.addText(i, x, y, num);
    e.num = num; e.size = 10; e.font = 'serif'; e.color = 'black';
    V.updateText(e);
    // addText наводит курсор в поле правки, и следующая же буква стёрла бы номер
    setTimeout(() => { const ta = U.$('#propText'); if (ta) ta.blur(); }, 60);
    U.toast('Номер ' + num + ' поставлен. В журнал он попадёт, когда сохраните PDF.');
  };

  /* Номера, стоящие на документе сейчас */
  N.onDoc = function () {
    const V = O.V;
    if (!V.doc) return [];
    return V.doc.elements.filter(e => e.num).map(e => e.num);
  };

  O.N = N;
})(window.Ottisk);
