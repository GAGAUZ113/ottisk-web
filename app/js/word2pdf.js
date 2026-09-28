/* Word (.docx) → PDF прямо в программе, без интернета.
   docx-preview раскладывает документ по страницам так, как их последний раз разбил Word,
   html2canvas снимает каждую страницу в картинку 240 dpi, pdf-lib собирает PDF.
   Текст в таком PDF — картинка (как после печати). Лучшее качество — «Сохранить как PDF» в самом Word. */
(function (O) {
  'use strict';
  const U = O.U; const W = {};
  const SCALE = 2.5; // 96 dpi × 2,5 = 240 dpi

  W.supported = () => !!(window.docxPreview && window.docxPreview.renderAsync && window.html2canvas && window.JSZip);

  W.convert = async function (file) {
    if (!W.supported()) throw new Error('Модуль Word не загрузился');
    const buf = await file.arrayBuffer();
    // рабочий холст под интерфейсом: должен быть в документе и видим для раскладки, но человек его не видит
    const host = U.el('div', { class: 'docx-host', 'aria-hidden': 'true' });
    document.body.append(host);
    try {
      await window.docxPreview.renderAsync(buf, host, host, {
        className: 'docx', inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
        ignoreWidth: false, ignoreHeight: false, ignoreFonts: false, renderHeaders: true, renderFooters: true,
        renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: false
      });
      try { await document.fonts.ready; } catch (e) {}
      await new Promise(r => setTimeout(r, 60));
      const sections = Array.from(host.querySelectorAll('section.docx'));
      if (!sections.length) throw new Error('В файле не нашлось страниц');
      return await W.rasterize(sections, file.name);
    } finally { host.remove(); }
  };

  /* Общая часть: готовые «листы» на экране → страницы PDF. Ею же пользуется LibreOffice-модуль. */
  W.rasterize = async function (sections, name) {
    {
      const pdf = await PDFLib.PDFDocument.create();
      for (const s of sections) {
        // файл без размера листа (такое сохраняют некоторые программы) — ставим A4 и обычные поля Word
        if (!s.style.width) { s.style.boxSizing = 'border-box'; s.style.width = '210mm'; s.style.minHeight = '297mm'; s.style.padding = '20mm 15mm 20mm 30mm'; }
        const cs = getComputedStyle(s);
        const wPx = s.offsetWidth, hPx = s.scrollHeight;
        const pageHpx = parseFloat(cs.minHeight) || wPx * Math.SQRT2;

        /* Снимаем НЕ всю простыню разом. Реестр из 1С на 40 листов — это 45 000 точек
           высоты, а с нашим увеличением 2,5 — уже 112 000. Браузер столько не умеет:
           предел холста около 32 000, и снимок выходил пустым. Человек получал PDF
           из сорока белых страниц без единой ошибки.
           Поэтому режем на куски по целому числу листов, чтобы влезало с запасом. */
        const ПРЕДЕЛ = 16000;
        /* Длинный документ снимаем чуть мельче: 240 точек на дюйм на реестре из
           двадцати листов дают под двадцать мегабайт, а такое письмо не уходит.
           192 точки на дюйм текст держит уверенно, а файл втрое легче. */
        const листов = Math.max(1, Math.round(hPx / Math.max(1, pageHpx)));
        const МАСШТАБ = листов > 8 ? 2 : SCALE;
        const КАЧЕСТВО = листов > 8 ? 0.82 : 0.9;
        const листовВКуске = Math.max(1, Math.floor(ПРЕДЕЛ / Math.max(1, pageHpx * МАСШТАБ)));
        const высотаКуска = листовВКуске * pageHpx;
        const верхЛиста = s.getBoundingClientRect().top + (window.scrollY || 0);
        const окно = Math.max(wPx + 40, document.documentElement.clientWidth);

        for (let y0 = 0; y0 < hPx - 4; y0 += высотаКуска) {
          const hКуска = Math.min(высотаКуска, hPx - y0);
          const shot = await window.html2canvas(s, {
            scale: МАСШТАБ, backgroundColor: '#ffffff', logging: false, useCORS: true,
            width: wPx, height: hКуска, x: s.getBoundingClientRect().left + (window.scrollX || 0),
            y: верхЛиста + y0, windowWidth: окно
          });
          if (!shot || !shot.width || !shot.height) throw new Error('Не удалось снять страницы документа. Сохраните файл в PDF из Word и откройте его здесь.');
          const k = shot.width / wPx;
          // внутри куска Word мог не поставить разрывы — режем сами на листы
          for (let y = 0; y < hКуска - 4; y += pageHpx) {
            const c = document.createElement('canvas'); c.width = shot.width; c.height = Math.round(pageHpx * k);
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            const sh = Math.min(pageHpx, hКуска - y) * k;
            ctx.drawImage(shot, 0, Math.round(y * k), shot.width, Math.round(sh), 0, 0, shot.width, Math.round(sh));
            const jpg = await pdf.embedJpg(U.dataUrlToU8(c.toDataURL('image/jpeg', КАЧЕСТВО)));
            const pw = wPx * 0.75, ph = pageHpx * 0.75; // px → pt
            pdf.addPage([pw, ph]).drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
          }
          shot.width = shot.height = 0;   // кусок больше не нужен, отдаём память
        }
      }
      pdf.setTitle(String(name || 'Документ').replace(/\.[^.]+$/, ''));
      return await pdf.save();
    }
  };

  O.W = W;
})(window.Ottisk);
