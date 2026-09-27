/* Журнал сохранений: что, когда, какой фирмой. Выгрузка в CSV для Excel. */
(function (O) {
  'use strict';
  const U = O.U, el = U.el; const J = { entries: [] };

  J.init = async function () {
    const st = await O.Store.get('journal'); if (Array.isArray(st)) J.entries = st;
    U.$('#journalCsv').addEventListener('click', J.downloadCsv);
    const find = U.$('#journalFind');
    if (find) find.addEventListener('input', U.debounce(() => { J.query = find.value.trim(); J.render(); }, 200));
    J.render();
  };
  J.query = '';
  const save = () => { O.Store.set('journal', J.entries); if (O.F && O.F.ready()) O.F.writeJournal(); };

  J.add = function (entry) { J.entries.push(entry); if (J.entries.length > 2000) J.entries.shift(); save(); J.render(); };
  J.merge = function (list) {
    const keys = new Set(J.entries.map(e => e.ts + '|' + e.file));
    list.forEach(e => { if (e && e.ts && !keys.has(e.ts + '|' + e.file)) J.entries.push(e); });
    J.entries.sort((a, b) => a.ts < b.ts ? -1 : 1); save(); J.render();
  };

  const nums = e => (e.numbers && e.numbers.length) ? e.numbers : [];

  J.render = function () {
    const root = U.$('#journalList'); root.innerHTML = '';
    const q = (J.query || '').toLowerCase();
    let list = J.entries;
    if (q) list = list.filter(e => (e.file || '').toLowerCase().includes(q) || nums(e).join(' ').toLowerCase().includes(q));
    const last = list.slice(-15).reverse();
    if (!last.length) {
      root.append(el('div', { class: 'empty-note', text: q
        ? 'Такого номера в журнале нет. Значит, документ сохраняли НЕ ЗДЕСЬ — он не наш.'
        : 'Пока пусто. Здесь появится каждый сохранённый PDF.' }));
      return;
    }
    if (q) root.append(el('div', { class: 'muted small', style: 'margin-bottom:6px', text: 'Найдено записей: ' + list.length }));
    last.forEach(e => {
      const n = nums(e);
      root.append(el('div', { class: 'j' }, [
        n.length ? el('div', { class: 'jnum', text: n.join(', ') }) : null,
        el('div', { class: 'd', text: U.dateStr(new Date(e.ts)) + ' · ' + e.company }),
        el('div', { class: 'f', title: e.file, text: e.file }),
        el('div', { class: 'muted', text: (e.assets.length ? e.assets.join(', ') : 'без печатей') + ' · стр. ' + e.pages.join(', ') })
      ]));
    });
  };

  J.csv = function () {
    const q = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Номер', 'Дата и время', 'Файл', 'Фирма', 'Печати и подписи', 'Страницы'].map(q).join(';')];
    J.entries.forEach(e => rows.push([nums(e).join(', '), U.dateStr(new Date(e.ts)), e.file, e.company, e.assets.join(', '), e.pages.join(', ')].map(q).join(';')));
    return '﻿' + rows.join('\r\n');
  };
  J.downloadCsv = function () {
    if (!J.entries.length) { U.toast('Журнал пока пуст'); return; }
    U.download(J.csv(), 'Оттиск_журнал.csv', 'text/csv;charset=utf-8'); U.toast('Журнал выгружен. Откройте файл в Excel.');
  };

  O.J = J;
})(window.Ottisk);
