/* PDF → Word: текстовый слой через pdf.js, сборка .docx через docx.js. Сканы (без текста) не распознаём. */
(function (O) {
  'use strict';
  const V = O.V; const X = {};

  async function fontIsBold(page, fontName) {
    try {
      if (page.commonObjs.has(fontName)) { const f = page.commonObjs.get(fontName); return !!(f && (f.bold || /bold|black|heavy|semibold|demibold/i.test(f.name || ''))); }
    } catch (e) {}
    return /bold|black|heavy/i.test(fontName);
  }

  /* Разбор одной страницы → абзацы [{align, runs:[{text,bold,size}]}] */
  async function extractPage(page) {
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str !== undefined && it.str.replace(/\s+/g, '').length);
    if (!items.length) return null;
    // подгрузить шрифты (нужно для определения жирности), если ещё не загружены
    if (items.some(it => !page.commonObjs.has(it.fontName))) { try { await page.getOperatorList(); } catch (e) {} }
    const boldCache = {};
    for (const it of items) if (!(it.fontName in boldCache)) boldCache[it.fontName] = await fontIsBold(page, it.fontName);
    const view = page.view; const pw = view[2] - view[0], px0 = view[0];
    const recs = items.map(it => { const tr = it.transform; const fs = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || 12; return { s: it.str, x: tr[4], y: tr[5], w: it.width, fs, bold: boldCache[it.fontName] }; });
    recs.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    // строки
    const lines = []; let cur = null;
    for (const r of recs) {
      if (cur && Math.abs(r.y - cur.y) < 0.5 * Math.max(r.fs, cur.fs)) cur.items.push(r);
      else { cur = { y: r.y, fs: r.fs, items: [r] }; lines.push(cur); }
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x); l.fs = Math.max.apply(null, l.items.map(i => i.fs));
      l.x0 = l.items[0].x; l.x1 = Math.max.apply(null, l.items.map(i => i.x + i.w));
      const runs = []; let prevEnd = null;
      for (const it of l.items) {
        let text = it.s;
        if (prevEnd !== null && it.x - prevEnd > 0.2 * it.fs && !/\s$/.test(runs.length ? runs[runs.length - 1].text : '') && !/^\s/.test(text)) text = ' ' + text;
        if (runs.length && runs[runs.length - 1].bold === it.bold) runs[runs.length - 1].text += text;
        else runs.push({ text, bold: it.bold, size: it.fs });
        prevEnd = it.x + it.w;
      }
      l.runs = runs;
    }
    // абзацы
    const paras = []; let p = null, prev = null;
    for (const l of lines) {
      const gap = prev ? prev.y - l.y : 0;
      const newPara = !p || gap > 1.55 * Math.max(l.fs, prev.fs) || (l.x0 - prev.x0 > 2 * l.fs && prev.x1 < px0 + pw * 0.85) || l.x0 - p.x0 > 1.5 * l.fs;
      if (newPara) { p = { lines: [l], x0: l.x0 }; paras.push(p); }
      else p.lines.push(l);
      prev = l;
    }
    return paras.map(pa => {
      const runs = []; pa.lines.forEach((l, i) => {
        l.runs.forEach(r => { const t = i > 0 && runs.length && !/\s$/.test(runs[runs.length - 1].text) && !/^\s/.test(r.text) ? ' ' + r.text : r.text; if (runs.length && runs[runs.length - 1].bold === r.bold) runs[runs.length - 1].text += t; else runs.push({ text: t, bold: r.bold, size: r.size }); });
      });
      let align = 'left';
      if (pa.lines.length === 1) { const l = pa.lines[0]; const c = (l.x0 + l.x1) / 2 - px0; if (Math.abs(c - pw / 2) < 8 && (l.x1 - l.x0) < pw * 0.8) align = 'center'; else if (l.x0 - px0 > pw * 0.5) align = 'right'; }
      return { align, runs };
    });
  }

  /* Собрать документ. Возвращает {blob, scanPages, total} */
  X.build = async function () {
    const doc = V.doc; if (!doc) throw new Error('Документ не открыт');
    const dx = window.docx; const children = []; let scanPages = 0;
    for (let i = 0; i < doc.pages.length; i++) {
      const paras = await extractPage(doc.pages[i].page);
      if (i > 0) children.push(new dx.Paragraph({ children: [new dx.PageBreak()] }));
      if (!paras) { scanPages++; children.push(new dx.Paragraph({ children: [new dx.TextRun({ text: '[Страница ' + (i + 1) + ' — скан без текстового слоя, текст не распознан]', italics: true, color: '888888' })] })); continue; }
      for (const pa of paras) {
        children.push(new dx.Paragraph({
          alignment: pa.align === 'center' ? dx.AlignmentType.CENTER : pa.align === 'right' ? dx.AlignmentType.RIGHT : dx.AlignmentType.LEFT,
          spacing: { after: 120 },
          children: pa.runs.map(r => { const o = { text: r.text, bold: r.bold }; if (Math.abs(r.size - 12) >= 1) o.size = Math.round(r.size * 2); return new dx.TextRun(o); })
        }));
      }
    }
    const d = new dx.Document({
      creator: 'Оттиск', title: doc.name,
      styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1418 } } }, children }]
    });
    const blob = await dx.Packer.toBlob(d);
    return { blob, scanPages, total: doc.pages.length };
  };

  O.X = X;
})(window.Ottisk);
