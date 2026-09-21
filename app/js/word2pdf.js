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
      const pdf = await PDFLib.PDFDocument.create();
      for (const s of sections) {
        // файл без размера листа (такое сохраняют некоторые программы) — ставим A4 и обычные поля Word
        if (!s.style.width) { s.style.boxSizing = 'border-box'; s.style.width = '210mm'; s.style.minHeight = '297mm'; s.style.padding = '20mm 15mm 20mm 30mm'; }
        const cs = getComputedStyle(s);
        const wPx = s.offsetWidth, hPx = s.scrollHeight;
        const pageHpx = parseFloat(cs.minHeight) || wPx * Math.SQRT2;
        const shot = await window.html2canvas(s, { scale: SCALE, backgroundColor: '#ffffff', logging: false, useCORS: true, width: wPx, height: hPx, windowWidth: Math.max(wPx + 40, document.documentElement.clientWidth) });
        const k = shot.width / wPx;
        // Word не всегда сохраняет разрывы страниц — длинный кусок режем на листы
        for (let y = 0; y < hPx - 4; y += pageHpx) {
          const c = document.createElement('canvas'); c.width = shot.width; c.height = Math.round(pageHpx * k);
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          const sh = Math.min(pageHpx, hPx - y) * k;
          ctx.drawImage(shot, 0, Math.round(y * k), shot.width, Math.round(sh), 0, 0, shot.width, Math.round(sh));
          const jpg = await pdf.embedJpg(U.dataUrlToU8(c.toDataURL('image/jpeg', 0.9)));
          const pw = wPx * 0.75, ph = pageHpx * 0.75; // px → pt
          pdf.addPage([pw, ph]).drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
        }
      }
      pdf.setTitle(file.name.replace(/\.[^.]+$/, ''));
      return await pdf.save();
    } finally { host.remove(); }
  };

  O.W = W;
})(window.Ottisk);
