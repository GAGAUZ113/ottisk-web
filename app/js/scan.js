/* Сканер бумажного документа: снимок камерой или фото → поиск листа → выпрямление → чистка → PDF.
   Это оцифровка НАСТОЯЩЕЙ бумаги, которая лежит перед вами. Вида «отсканировано» для файлов,
   напечатанных на компьютере, программа не делает и делать не будет. */
(function (O) {
  'use strict';
  const U = O.U, D = O.D, IP = O.IP, el = U.el; const S = {};

  const DPI = 200;                       // качество как у обычного сканера
  const MM = 25.4;
  const A4 = [210, 297];                 // мм

  /* ── Гомография: 4 угла листа → ровный прямоугольник ───────────────────── */

  /* Решение системы n×n методом Гаусса с выбором главного элемента */
  function gauss(M, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      const t = M[i]; M[i] = M[p]; M[p] = t; const tb = b[i]; b[i] = b[p]; b[p] = tb;
      if (Math.abs(M[i][i]) < 1e-12) return null;
      for (let k = i + 1; k < n; k++) {
        const f = M[k][i] / M[i][i];
        for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
        b[k] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  /* Матрица перехода: точка выходного листа (x,y) → точка исходного фото (u,v) */
  function homography(dst, src) {
    const M = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [u, v] = src[i];
      M.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
      M.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    return gauss(M, b);
  }

  /* Выпрямление: из четырёхугольника на фото делаем ровный лист outW×outH */
  S.warp = function (src, quad, outW, outH) {
    const h = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
    const out = document.createElement('canvas'); out.width = outW; out.height = outH;
    const octx = out.getContext('2d', { willReadFrequently: true });
    if (!h) { octx.drawImage(src, 0, 0, outW, outH); return out; }
    const sctx = src.getContext('2d', { willReadFrequently: true });
    const sd = sctx.getImageData(0, 0, src.width, src.height).data;
    const od = octx.createImageData(outW, outH); const dd = od.data;
    const sw = src.width, sh = src.height;
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const w = h[6] * x + h[7] * y + 1;
        const u = (h[0] * x + h[1] * y + h[2]) / w, v = (h[3] * x + h[4] * y + h[5]) / w;
        const i = (y * outW + x) * 4;
        if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) { dd[i] = dd[i + 1] = dd[i + 2] = 255; dd[i + 3] = 255; continue; }
        // билинейная выборка — без неё текст рассыпается на «лесенку»
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4, p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const a = sd[p00 + c] + (sd[p10 + c] - sd[p00 + c]) * fx;
          const b2 = sd[p01 + c] + (sd[p11 + c] - sd[p01 + c]) * fx;
          dd[i + c] = a + (b2 - a) * fy;
        }
        dd[i + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  };

  /* ── Поиск листа на фото ───────────────────────────────────────────────── */

  /* Порог Оцу: сам подбирает границу между бумагой и фоном */
  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  /* Углы листа: самая большая светлая область, дальше её крайние точки по диагоналям */
  S.detectQuad = function (src) {
    const W = 320, k = W / src.width, H = Math.max(1, Math.round(src.height * k));
    const s = document.createElement('canvas'); s.width = W; s.height = H;
    s.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, W, H);
    const d = s.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H), hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      gray[p] = g; hist[g]++;
    }
    const thr = otsu(hist, W * H);
    // связная светлая область, идём от центра кадра — там почти всегда лист
    const seen = new Uint8Array(W * H), stack = [((H >> 1) * W + (W >> 1))];
    if (gray[stack[0]] <= thr) {                    // центр тёмный — ищем любую светлую точку рядом
      let best = -1;
      for (let p = 0; p < W * H; p++) if (gray[p] > thr) { best = p; break; }
      if (best < 0) return null;
      stack[0] = best;
    }
    seen[stack[0]] = 1; let count = 0;
    let minSum = 1e9, maxSum = -1e9, minDif = 1e9, maxDif = -1e9;
    let cTL = null, cBR = null, cTR = null, cBL = null;
    while (stack.length) {
      const p = stack.pop(); count++;
      const x = p % W, y = (p / W) | 0;
      const sum = x + y, dif = x - y;
      if (sum < minSum) { minSum = sum; cTL = [x, y]; }
      if (sum > maxSum) { maxSum = sum; cBR = [x, y]; }
      if (dif > maxDif) { maxDif = dif; cTR = [x, y]; }
      if (dif < minDif) { minDif = dif; cBL = [x, y]; }
      if (x > 0 && !seen[p - 1] && gray[p - 1] > thr) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && !seen[p + 1] && gray[p + 1] > thr) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - W] && gray[p - W] > thr) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && !seen[p + W] && gray[p + W] > thr) { seen[p + W] = 1; stack.push(p + W); }
    }
    if (count < W * H * 0.08 || !cTL) return null;   // лист слишком мал — пусть человек поставит углы сам
    const back = c => [U.clamp(c[0] / k, 0, src.width), U.clamp(c[1] / k, 0, src.height)];
    const quad = [back(cTL), back(cTR), back(cBR), back(cBL)];
    // чуть поджимаем внутрь: иначе по краю остаётся полоска стола
    const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
    const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
    return quad.map(([x, y]) => [x + (cx - x) * 0.008, y + (cy - y) * 0.008]);
  };

  /* ── Чистка: убрать тень, вывести бумагу в белый ────────────────────────── */

  /* Фон оцениваем сильным размытием и делим на него — так уходит тень от руки и неровный свет */
  function blurGray(g, w, h, r) {
    const tmp = new Float32Array(g.length), out = new Float32Array(g.length), win = r * 2 + 1;
    const cl = (v, n) => v < 0 ? 0 : v > n - 1 ? n - 1 : v;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += g[y * w + cl(x, w)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / win;
        sum += g[y * w + cl(x + r + 1, w)] - g[y * w + cl(x - r, w)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[cl(y, h) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / win;
        sum += tmp[cl(y + r + 1, h) * w + x] - tmp[cl(y - r, h) * w + x];
      }
    }
    return out;
  }

  /* mode: 'color' | 'gray' | 'bw'; strength 0..1 — насколько сильно выбеливать */
  S.clean = function (c, mode, strength) {
    const w = c.width, h = c.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h), d = id.data;
    const n = w * h, gray = new Float32Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) gray[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    const r = Math.max(4, Math.round(Math.min(w, h) * 0.04));
    const bg = blurGray(gray, w, h, r);
    const k = 0.35 + 0.65 * U.clamp(strength === undefined ? 0.7 : strength, 0, 1);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      const base = bg[p] < 1 ? 1 : bg[p];
      if (mode === 'color') {
        for (let ch = 0; ch < 3; ch++) {
          const norm = d[i + ch] / base * 255;
          d[i + ch] = U.clamp(d[i + ch] + (norm - d[i + ch]) * k, 0, 255);
        }
      } else {
        let g = gray[p] / base * 255;
        g = 128 + (g - 128) * (1 + k);                       // контраст
        if (mode === 'bw') g = g > 205 - 40 * k ? 255 : 0;   // порог по локальному фону
        g = U.clamp(g, 0, 255);
        d[i] = d[i + 1] = d[i + 2] = g;
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  };

  /* ── Окно сканирования ─────────────────────────────────────────────────── */

  S.open = function () {
    const pages = [];              // {src, quad, out, mode}
    let cur = -1, stream = null, dispScale = 1;

    const video = el('video', { playsinline: '', muted: '', autoplay: '' });
    const cv = el('canvas');
    const empty = el('div', { class: 'scan-empty', text: 'Здесь появится фото документа. Нажмите «Снять камерой» или «Выбрать фото».' });
    const stage = el('div', { class: 'scan-stage' }, [video, cv, empty]);
    const corners = [];
    for (let i = 0; i < 4; i++) { const h = el('div', { class: 'scan-h', 'data-i': i }); corners.push(h); stage.append(h); }
    const edges = el('canvas', { class: 'scan-edges' }); stage.append(edges);
    const wrap = el('div', { class: 'scan-prev' }, stage);
    const status = el('p', { class: 'hint', text: 'Положите документ на стол, снимите сверху целиком, при хорошем свете.' });

    const camBtn = el('button', { class: 'btn primary', html: '<svg class="i" viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="13" rx="1.5"/><circle cx="12" cy="13" r="3.5"/><path d="M9 6.5 10 4h4l1 2.5"/></svg><span>Снять камерой</span>' });
    const fileBtn = el('button', { class: 'btn', text: 'Выбрать фото' });
    const shotBtn = el('button', { class: 'btn primary', text: 'Снимок', hidden: true });
    const modeSeg = segment([['color', 'Цветной'], ['gray', 'Серый'], ['bw', 'Чёрно-белый']], 'gray', v => { if (cur >= 0) { pages[cur].mode = v; redraw(); } });
    const viewSeg = segment([['photo', 'Фото'], ['result', 'Как получится']], 'photo', () => redraw());
    const strengthR = el('input', { type: 'range', class: 'range', min: 0, max: 100, value: 70 });
    const strengthV = el('span', { class: 'num', text: '70' });
    const autoBtn = el('button', { class: 'btn sm', text: 'Найти лист заново' });
    const thumbs = el('div', { class: 'scan-thumbs' });
    const fileInp = el('input', { type: 'file', accept: 'image/*,.jpg,.jpeg,.png,.heic,.heif', capture: 'environment', hidden: true, multiple: true });

    const ctl = el('div', { class: 'ctl' }, [
      el('div', { class: 'row wrap' }, [camBtn, fileBtn, shotBtn]),
      status,
      el('div', { class: 'f' }, [el('span', { text: 'Показать' }), viewSeg,
        el('p', { class: 'hint', text: '«Как получится» — готовая страница: выпрямленная и очищенная.' })]),
      el('div', { class: 'f' }, [el('span', { text: 'Как сохранить' }), modeSeg,
        el('p', { class: 'hint', text: 'Серый — обычный выбор. Чёрно-белый — только текст, файл самый лёгкий. Цветной — если есть печать или цветные пометки.' })]),
      el('label', { class: 'f' }, [el('span', null, [el('span', { text: 'Выбелить бумагу' }), strengthV]), strengthR]),
      el('div', { class: 'f' }, [el('span', { text: 'Углы листа' }), el('div', { class: 'row' }, autoBtn),
        el('p', { class: 'hint', text: 'Программа сама находит лист. Если рамка легла мимо — перетащите углы.' })]),
      el('div', { class: 'f' }, [el('span', { text: 'Страницы' }), thumbs])
    ]);

    const body = el('div', { class: 'scan' }, [wrap, ctl, fileInp]);

    const dlg = D.show({
      title: 'Сканировать документ', body, width: 'lg',
      onClose: () => { stopCam(); window.removeEventListener('resize', onResize); },
      buttons: [
        { label: 'Отмена' },
        { label: 'Сохранить PDF', onClick: () => { finish(false); return false; } },
        { label: 'Открыть в программе', primary: true, onClick: () => { finish(true); return false; } }
      ]
    });

    /* — камера — */
    const NO_CAM = 'Камера в этом окне недоступна — возможно, её нет или браузер не дал разрешение. Нажмите «Выбрать фото»: на телефоне откроется камера, на компьютере — папка со снимками.';
    async function startCam() {
      camBtn.disabled = true;
      status.textContent = 'Спрашиваю разрешение на камеру…';
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('нет камеры');
        // если браузер «задумался» и не отвечает — не оставляем человека перед чёрным окном
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('камера не ответила')), 12000))
        ]);
        video.srcObject = stream; await video.play();
        stage.classList.add('live'); shotBtn.hidden = false; camBtn.hidden = true;
        empty.hidden = true;
        status.textContent = 'Наведите камеру так, чтобы лист попал целиком, и нажмите «Снимок».';
      } catch (e) {
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        stage.classList.remove('live'); shotBtn.hidden = true;
        status.textContent = NO_CAM;
        if (!pages.length) empty.textContent = NO_CAM;
      } finally { camBtn.disabled = false; }
    }
    function stopCam() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } stage.classList.remove('live'); shotBtn.hidden = true; camBtn.hidden = false; }
    camBtn.addEventListener('click', startCam);
    shotBtn.addEventListener('click', () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      addPage(IP.downscale(c, 2600));
    });
    fileBtn.addEventListener('click', () => { fileInp.value = ''; fileInp.click(); });
    fileInp.addEventListener('change', async e => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      for (const f of files) {
        try { addPage(IP.downscale(await IP.fromFile(f, 2600), 2600)); }
        catch (err) { await D.alert('Файл не открылся', (err && err.message) || 'Не удалось открыть фото'); }
      }
    });

    /* — страницы — */
    function addPage(src) {
      stopCam();
      const quad = S.detectQuad(src) || [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
      pages.push({ src, quad, mode: modeSeg.value(), out: null });
      cur = pages.length - 1;
      status.textContent = pages.length === 1 ? 'Проверьте углы листа и при необходимости поправьте их.' : `Страниц: ${pages.length}. Можно снять ещё.`;
      renderThumbs(); redraw();
    }
    autoBtn.addEventListener('click', () => {
      if (cur < 0) return;
      const q = S.detectQuad(pages[cur].src);
      if (!q) { U.toast('Не нашёл лист — поставьте углы вручную', true); return; }
      pages[cur].quad = q; redraw();
    });
    strengthR.addEventListener('input', () => { strengthV.textContent = strengthR.value; redrawSoon(); });
    const redrawSoon = U.debounce(() => redraw(), 120);
    // поворот телефона и изменение окна: ручки пересчитываем, иначе они разъезжаются
    const onResize = U.debounce(() => redraw(), 150);
    window.addEventListener('resize', onResize);

    function renderThumbs() {
      // без единой страницы сохранять нечего — кнопки не должны нажиматься
      const foot = dlg && dlg.querySelectorAll('footer .btn');
      if (foot) Array.from(foot).forEach(b => { if (b.textContent !== 'Отмена') b.disabled = !pages.length; });
      thumbs.innerHTML = '';
      if (!pages.length) { thumbs.append(el('div', { class: 'empty-note', text: 'Пока ни одной страницы.' })); return; }
      pages.forEach((p, i) => {
        const t = el('button', { class: 'scan-th' + (i === cur ? ' on' : ''), title: 'Страница ' + (i + 1) });
        // в миниатюре показываем готовую страницу, а не кривое фото — сразу видно, удалась ли съёмка
        const im = small(p, 64);
        t.append(im, el('span', { class: 'n', text: String(i + 1) }));
        t.addEventListener('click', () => { cur = i; modeSeg.set(p.mode); renderThumbs(); redraw(); });
        const del = el('button', { class: 'btn icon del', title: 'Убрать страницу', html: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>' });
        del.addEventListener('click', ev => {
          ev.stopPropagation(); pages.splice(i, 1);
          cur = Math.min(cur, pages.length - 1); renderThumbs(); redraw();
        });
        t.append(del);
        thumbs.append(t);
      });
    }

    /* Маленькая копия готовой страницы — для миниатюр и предпросмотра «как получится» */
    function small(p, w) {
      const [q0, q1, q2, q3] = p.quad;
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const ratio = Math.max(dist(q0, q1), dist(q3, q2)) / Math.max(dist(q0, q3), dist(q1, q2));
      const outW = Math.max(16, Math.round(w)), outH = Math.max(16, Math.round(w / (ratio || 1)));
      return S.clean(S.warp(p.src, p.quad, outW, outH), p.mode, +strengthR.value / 100);
    }

    /* — отрисовка предпросмотра — */
    function redraw() {
      empty.hidden = !!pages.length || stage.classList.contains('live');
      if (cur < 0 || !pages[cur]) { cv.width = cv.height = 0; edges.width = edges.height = 0; corners.forEach(h => h.hidden = true); return; }
      const p = pages[cur];
      // режим «как получится»: показываем готовую страницу без рамки и ручек
      if (viewSeg.value() === 'result') {
        const areaH = (wrap.clientHeight - 24) || 430;
        const res = small(p, Math.round(areaH * 0.72));
        cv.width = res.width; cv.height = res.height;
        cv.getContext('2d').drawImage(res, 0, 0);
        cv.style.width = ''; cv.style.height = '';
        edges.width = edges.height = 0;
        corners.forEach(h => h.hidden = true);
        return;
      }
      const src = p.src;
      const areaW = wrap.clientWidth - 24 || 560, areaH = wrap.clientHeight - 24 || 430;
      dispScale = Math.min(areaW / src.width, areaH / src.height, 1);
      cv.width = src.width; cv.height = src.height;
      cv.getContext('2d').drawImage(src, 0, 0);
      cv.style.width = edges.style.width = (src.width * dispScale) + 'px';
      cv.style.height = edges.style.height = (src.height * dispScale) + 'px';
      edges.width = Math.round(src.width * dispScale); edges.height = Math.round(src.height * dispScale);
      const ec = edges.getContext('2d');
      ec.clearRect(0, 0, edges.width, edges.height);
      ec.strokeStyle = '#2c3d8f'; ec.lineWidth = 2; ec.setLineDash([6, 4]);
      ec.beginPath();
      p.quad.forEach(([x, y], i) => { const X = x * dispScale, Y = y * dispScale; i ? ec.lineTo(X, Y) : ec.moveTo(X, Y); });
      ec.closePath(); ec.stroke();
      corners.forEach((h, i) => {
        h.hidden = false;
        h.style.left = (p.quad[i][0] * dispScale) + 'px';
        h.style.top = (p.quad[i][1] * dispScale) + 'px';
      });
    }

    /* — перетаскивание углов — */
    corners.forEach((h, i) => {
      h.addEventListener('pointerdown', ev => {
        if (cur < 0) return;
        ev.preventDefault(); h.setPointerCapture(ev.pointerId);
        const r = cv.getBoundingClientRect();
        const move = e2 => {
          const x = U.clamp((e2.clientX - r.left) / dispScale, 0, pages[cur].src.width);
          const y = U.clamp((e2.clientY - r.top) / dispScale, 0, pages[cur].src.height);
          pages[cur].quad[i] = [x, y]; redraw();
        };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
    });

    /* — готовый лист — */
    function render(p) {
      const [q0, q1, q2, q3] = p.quad;
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const wPx = Math.max(dist(q0, q1), dist(q3, q2)), hPx = Math.max(dist(q0, q3), dist(q1, q2));
      const ratio = wPx / hPx, a4 = A4[1] / A4[0];   // 1,414 — пропорция А4
      let mmW, mmH;
      if (Math.abs(ratio - 1 / a4) < 0.06) { mmW = A4[0]; mmH = A4[1]; }        // книжный А4
      else if (Math.abs(ratio - a4) < 0.06) { mmW = A4[1]; mmH = A4[0]; }       // альбомный А4
      else if (ratio < 1) { mmH = A4[1]; mmW = A4[1] * ratio; }                 // другой размер —
      else { mmW = A4[1]; mmH = A4[1] / ratio; }                                // сохраняем пропорции листа
      const outW = Math.round(mmW / MM * DPI), outH = Math.round(mmH / MM * DPI);
      const flat = S.warp(p.src, p.quad, outW, outH);
      return S.clean(flat, p.mode, +strengthR.value / 100);
    }

    async function finish(openHere) {
      if (!pages.length) { U.toast('Сначала снимите или выберите фото документа', true); return; }
      U.busy('Собираю PDF…');
      try {
        const PL = window.PDFLib;
        const pdf = await PL.PDFDocument.create();
        for (const p of pages) {
          const c = render(p);
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
          const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const page = pdf.addPage([c.width / DPI * 72, c.height / DPI * 72]);
          page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
        }
        const bytes = await pdf.save();
        const name = 'Скан_' + pages.length + (pages.length === 1 ? '_страница' : '_страницы') + '.pdf';
        D.close(dlg);
        if (openHere) {
          await O.V.openFile(new File([bytes], name, { type: 'application/pdf' }));
          U.toast('Скан открыт — можно ставить печать и подпись');
        } else if (O.F && O.F.ready && O.F.ready()) {
          const saved = await O.F.saveOutput('signed', name, bytes, 'application/pdf');
          U.toast('Сохранено: ' + saved);
        } else {
          U.download(new Blob([bytes], { type: 'application/pdf' }), name, 'application/pdf');
        }
      } catch (e) {
        console.error(e); U.toast('Не удалось собрать PDF: ' + (e && e.message || ''), true);
      } finally { U.busy(); }
    }

    renderThumbs(); redraw();
    // на телефоне сразу предлагаем камеру, на компьютере — выбор фото
    if (window.matchMedia('(pointer: coarse)').matches) startCam();
  };

  /* маленький переключатель с возможностью прочитать и задать значение */
  function segment(items, val, onChange) {
    let v = val; const s = el('div', { class: 'segment' });
    const btns = {};
    items.forEach(([value, text]) => {
      const b = el('button', { text, class: value === val ? 'on' : '' });
      btns[value] = b;
      b.addEventListener('click', () => { s.set(value); onChange(value); });
      s.append(b);
    });
    s.value = () => v;
    s.set = nv => { v = nv; Object.keys(btns).forEach(k => btns[k].classList.toggle('on', k === nv)); };
    return s;
  }

  O.S = S;
})(window.Ottisk);
