/* Сохранение PDF: исходный файл + печати/подписи/текст/замазка через pdf-lib. Координаты — через pdf.js viewport, поэтому повёрнутые страницы и смещённые рамки не ломаются. */
(function (O) {
  'use strict';
  const U = O.U, V = O.V; const E = {};

  /* Матрица: локальные координаты элемента (в пунктах, ось Y вверх, начало — левый нижний угол неповёрнутой рамки) → пространство PDF-страницы */
  E.matrix = function (e, vp) {
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2, t = (e.rot || 0) * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
    const P = (lx, ly) => { const dx = lx - e.w / 2, dy = (e.h - ly) - e.h / 2; return vp.convertToPdfPoint(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos); };
    const o = P(0, 0), px = P(1, 0), py = P(0, 1);
    return [px[0] - o[0], px[1] - o[1], py[0] - o[0], py[1] - o[1], o[0], o[1]];
  };

  /* Цвет чернил текста: тот же, что человек видел на экране */
  function inkColor(key) {
    const PL = window.PDFLib;
    const hex = (V.INKS && V.INKS[key]) || (V.INKS && V.INKS.black) || '#000000';
    const n = parseInt(hex.slice(1), 16);
    return PL.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  E.build = async function () {
    const doc = V.doc; if (!doc) throw new Error('Документ не открыт');
    const PL = window.PDFLib;
    const pdfDoc = await PL.PDFDocument.load(doc.bytes, { ignoreEncryption: true });
    pdfDoc.registerFontkit(window.fontkit);
    const pages = pdfDoc.getPages();
    const imgCache = {}, fontCache = {};
    for (const e of doc.elements) {
      const page = pages[e.page]; const vp = doc.pages[e.page].vp1; if (!page) continue;
      const M = E.matrix(e, vp);
      if (e.type === 'image') {
        const key = e.assetId || e.id;
        if (!imgCache[key]) imgCache[key] = await pdfDoc.embedPng(U.dataUrlToU8(e.dataUrl));
        page.pushOperators(PL.pushGraphicsState(), PL.concatTransformationMatrix(M[0] * e.w, M[1] * e.w, M[2] * e.h, M[3] * e.h, M[4], M[5]));
        page.drawImage(imgCache[key], { x: 0, y: 0, width: 1, height: 1, opacity: U.clamp(e.ink || 1, 0.1, 1), blendMode: PL.BlendMode.Multiply });
        page.pushOperators(PL.popGraphicsState());
      } else if (e.type === 'whiteout') {
        page.pushOperators(PL.pushGraphicsState(), PL.concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]));
        page.drawRectangle({ x: 0, y: 0, width: e.w, height: e.h, color: PL.rgb(1, 1, 1), borderWidth: 0 });
        page.pushOperators(PL.popGraphicsState());
      } else if (e.type === 'text') {
        if (!fontCache[e.font]) fontCache[e.font] = await pdfDoc.embedFont(U.b64ToU8(window.OTTISK_FONTS[e.font]), { subset: true });
        const font = fontCache[e.font];
        let asc = 0.891, desc = 0.216;
        try { const fk = font.embedder.font; asc = fk.ascent / fk.unitsPerEm; desc = Math.abs(fk.descent) / fk.unitsPerEm; } catch (err) {}
        const lh = e.size * 1.2, baseline = ((1.2 - (asc + desc)) / 2 + asc) * e.size;
        page.pushOperators(PL.pushGraphicsState(), PL.concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]));
        e.text.split('\n').forEach((line, i) => {
          if (!line) return;
          page.drawText(line, { x: e.pad, y: e.h - e.pad - i * lh - baseline, size: e.size, font, color: inkColor(e.color) });
        });
        page.pushOperators(PL.popGraphicsState());
      }
    }
    return pdfDoc.save();
  };

  E.outputName = () => (V.doc ? V.doc.name : 'документ') + (V.doc && V.doc.elements.length ? '_подписано' : '') + '.pdf';

  O.E = E;
})(window.Ottisk);
