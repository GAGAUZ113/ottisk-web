/* Обработка картинок печатей и подписей: убрать фон бумаги, перекрасить, выровнять, обрезать поля. Всё на canvas. */
(function (O) {
  'use strict';
  const U = O.U; const IP = {};

  IP.INKS = { auto: null, blue: '#2b3a8c', violet: '#57399a', black: '#1b1b1f' };

  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  IP.canvasFromImage = function (img, maxPx) {
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(1, (maxPx || 2000) / Math.max(w, h));
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
    return c;
  };
  IP.downscale = function (c, maxPx) { if (Math.max(c.width, c.height) <= maxPx) return c; return IP.canvasFromImage(c, maxPx); };

  /* Какие файлы годятся как источник печати или подписи */
  IP.SUPPORTED = /\.(jpe?g|jpe|png|webp|gif|bmp|tiff?|heic|heif|pdf)$/i;
  IP.isSupported = f => !!f && !/^[._]/.test(f.name || '') && (IP.SUPPORTED.test(f.name || '') || /^image\//.test(f.type || '') || f.type === 'application/pdf');

  /* Открыть файл как холст: картинка любого формата, который знает браузер, или первая страница PDF.
     Ошибки — понятным текстом, чтобы человек знал, что делать. */
  IP.fromFile = async function (file, maxPx) {
    maxPx = maxPx || 2000;
    const name = (file.name || '').toLowerCase();
    const ext = (name.match(/\.[a-z0-9]+$/) || [''])[0];
    if (file.type === 'application/pdf' || ext === '.pdf') {
      if (!window.pdfjsLib || !O.V || !O.V.loadPdf) throw new Error('PDF сейчас открыть нельзя. Сохраните страницу с печатью как JPG и загрузите снова.');
      const doc = await O.V.loadPdf(new Uint8Array(await file.arrayBuffer()));
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = U.clamp(maxPx / Math.max(base.width, base.height), 1, 6);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return c;
    }
    let img;
    try { img = await U.loadImage(await U.blobToDataUrl(file)); }
    catch (e) {
      if (ext === '.heic' || ext === '.heif' || /heic|heif/.test(file.type || '')) {
        throw new Error('Это фото с айфона (формат HEIC) — браузер его не открывает. На Маке: откройте фото в «Просмотре» → Файл → Экспортировать → JPEG. На айфоне: Настройки → Камера → Форматы → «Наиболее совместимый».');
      }
      throw new Error(`Файл «${file.name || ''}» не открылся. Подойдут JPG, PNG или PDF.`);
    }
    return IP.canvasFromImage(img, maxPx);
  };

  /* Есть ли в картинке настоящая прозрачность (готовый PNG без фона)? */
  IP.hasRealAlpha = function (c) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let tr = 0; const n = d.length / 4;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 128) tr++;
    return tr / n > 0.02;
  };

  /* Цвет бумаги — медиана пикселей по краям */
  function estimatePaper(d, w, h) {
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
    const R = [], G = [], B = [];
    const push = (x, y) => { const i = (y * w + x) * 4; R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]); };
    const step = Math.max(1, Math.round(Math.sqrt(w * h) / 400));
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      if (x < band || y < band || x >= w - band || y >= h - band) push(x, y);
    }
    const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    return R.length ? [med(R), med(G), med(B)] : [255, 255, 255];
  }

  /* Повернуть холст на угол (градусы), расширив поле; фон прозрачный */
  IP.rotate = function (c, deg) {
    if (!deg) return c;
    const r = deg * Math.PI / 180, cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
    const w = Math.ceil(c.width * cos + c.height * sin), h = Math.ceil(c.width * sin + c.height * cos);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.translate(w / 2, h / 2); ctx.rotate(r); ctx.drawImage(c, -c.width / 2, -c.height / 2);
    return out;
  };

  /* Основная обработка. opts: {keepAlpha, cleanup 0..1, ink: 'auto'|'blue'|'violet'|'black', angle, paper:[r,g,b]} */
  IP.process = function (src, opts) {
    opts = opts || {};
    const rotated = IP.rotate(src, opts.angle || 0);
    // при повороте по краям появляется прозрачность — цвет бумаги оцениваем по исходнику
    const srcCtx = src.getContext('2d', { willReadFrequently: true });
    const paper = opts.paper || estimatePaper(srcCtx.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
    const w = rotated.width, h = rotated.height;
    const ctx = rotated.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h); const d = id.data;
    const ink = IP.INKS[opts.ink || 'auto'] ? hex2rgb(IP.INKS[opts.ink]) : null;
    const cleanup = U.clamp(opts.cleanup === undefined ? 0.45 : opts.cleanup, 0, 1);
    const lo = 0.04 + 0.30 * cleanup, hi = lo + 0.12 + 0.10 * (1 - cleanup);
    const [pr, pg, pb] = paper;
    for (let i = 0; i < d.length; i += 4) {
      let a = d[i + 3] / 255;
      if (a === 0) continue;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (!opts.keepAlpha) {
        const dist = Math.sqrt((r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb)) / 441.7;
        let t = (dist - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t);
        a *= t;
        if (t > 0 && t < 1) { // убрать примесь бумаги из полупрозрачного края
          const k = 1 / Math.max(t, 0.25);
          r = U.clamp(pr + (r - pr) * k, 0, 255); g = U.clamp(pg + (g - pg) * k, 0, 255); b = U.clamp(pb + (b - pb) * k, 0, 255);
        }
      }
      if (ink) { r = ink[0]; g = ink[1]; b = ink[2]; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(id, 0, 0);
    return rotated;
  };

  /* Авто-обрезка по краске. Возвращает {x,y,w,h,round} */
  IP.autoCrop = function (c, wantRound) {
    const w = c.width, h = c.height;
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const rows = new Uint32Array(h), cols = new Uint32Array(w); let total = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) { rows[y]++; cols[x]++; total++; }
    }
    if (!total) return { x: 0, y: 0, w, h, round: false };
    const minRow = Math.max(2, Math.round(w * 0.004)), minCol = Math.max(2, Math.round(h * 0.004)), skip = total * 0.001;
    const find = (arr, n, minC, dir) => {
      let acc = 0, i = dir > 0 ? 0 : n - 1;
      for (; i >= 0 && i < n; i += dir) { acc += arr[i]; if (arr[i] >= minC && acc > skip) return i; }
      return dir > 0 ? 0 : n - 1;
    };
    let y0 = find(rows, h, minRow, 1), y1 = find(rows, h, minRow, -1), x0 = find(cols, w, minCol, 1), x1 = find(cols, w, minCol, -1);
    if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w, h, round: false };
    let bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // круглая? почти квадрат и пустые углы
    let round = false;
    const ar = bw / bh;
    if (ar > 0.9 && ar < 1.1) {
      const s = Math.round(Math.min(bw, bh) * 0.14); let inked = 0, n = 0;
      const corners = [[x0, y0], [x1 - s, y0], [x0, y1 - s], [x1 - s, y1 - s]];
      for (const [cx, cy] of corners) for (let y = cy; y < cy + s; y += 2) for (let x = cx; x < cx + s; x += 2) { n++; if (d[(y * w + x) * 4 + 3] > 40) inked++; }
      round = n > 0 && inked / n < 0.03;
    }
    if (wantRound === true) round = round || (ar > 0.85 && ar < 1.18);
    const pad = Math.round(Math.max(bw, bh) * 0.025);
    let rx = x0 - pad, ry = y0 - pad, rw = bw + 2 * pad, rh = bh + 2 * pad;
    if (round) { const side = Math.max(rw, rh); rx -= (side - rw) / 2; ry -= (side - rh) / 2; rw = rh = side; }
    return { x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), round };
  };

  /* Вырезать область (может выходить за края — тогда прозрачно), ограничить размер */
  IP.crop = function (c, r, maxPx) {
    const out = document.createElement('canvas'); out.width = Math.max(1, r.w); out.height = Math.max(1, r.h);
    out.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return maxPx ? IP.downscale(out, maxPx) : out;
  };

  /* Обрезать прозрачные поля (для нарисованной подписи) */
  IP.trimTransparent = function (c, padPx) {
    const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height;
    copy.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0); c = copy;
    const r = IP.autoCrop(c, false); const pad = padPx || 0;
    return IP.crop(c, { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });
  };

  O.IP = IP;
})(window.Ottisk);
