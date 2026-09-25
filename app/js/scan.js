/* Сканер бумажного документа: снимок камерой или фото → поиск листа → выпрямление → чистка →
   PDF, картинка или Word. Плюс «сканер по сети»: кнопка открывает страницу вашего МФУ по его
   IP-адресу — у каждого рабочего места свой аппарат, адрес вводится один раз и запоминается.
   Это оцифровка НАСТОЯЩЕЙ бумаги, которая лежит перед вами. Вида «отсканировано» для файлов,
   напечатанных на компьютере, программа не делает и делать не будет. */
(function (O) {
  'use strict';
  const U = O.U, D = O.D, IP = O.IP, el = U.el; const S = {};

  const MM = 25.4;
  const A4 = [210, 297];                 // мм

  /* Качество: dpi — точек на дюйм, как у настоящего сканера; jpeg — сила сжатия снимка. */
  const QUALITY = {
    light:  { name: 'Лёгкое',  dpi: 150, jpeg: 0.75 },
    normal: { name: 'Обычное', dpi: 200, jpeg: 0.88 },
    high:   { name: 'Высокое', dpi: 300, jpeg: 0.94 }
  };
  const FORMATS = { pdf: 'PDF', jpg: 'JPG', png: 'PNG', docx: 'Word' };

  /* Адрес сетевого сканера или МФУ.
     Пускаем только http и https: всё остальное («javascript:», «data:») браузер
     выполнил бы как код прямо на этой странице. */
  S.normUrl = function (raw) {
    let str = String(raw || '').trim();
    if (!str) return null;
    if (!/^https?:\/\//i.test(str)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(str)) return null;   // чужая схема — не открываем
      str = 'http://' + str;
    }
    let u; try { u = new URL(str); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.href;
  };
  /* Короткая подпись для кнопки сохранённого адреса: «192.168.1.50:8080» */
  S.shortUrl = function (href) {
    try { const u = new URL(href); return u.hostname + (u.port ? ':' + u.port : ''); }
    catch (e) { return String(href); }
  };

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

  /* Выпрямление: из четырёхугольника на фото делаем ровный лист outW×outH.
     Когда кусок фото КРУПНЕЕ выхода, одной точки на пиксель мало: выборка начинает
     не уменьшать, а прореживать — строки мелкого текста выходят через одну, в таблицах
     идёт муар. Поэтому берём сетку точек на весь след пикселя и усредняем.
     При выходе в натуральную величину (ss = 1) всё считается ровно как раньше. */
  S.warp = function (src, quad, outW, outH) {
    const h = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
    const out = document.createElement('canvas'); out.width = outW; out.height = outH;
    const octx = out.getContext('2d', { willReadFrequently: true });
    if (!h) { octx.drawImage(src, 0, 0, outW, outH); return out; }
    const sctx = src.getContext('2d', { willReadFrequently: true });
    const sd = sctx.getImageData(0, 0, src.width, src.height).data;
    const od = octx.createImageData(outW, outH); const dd = od.data;
    const sw = src.width, sh = src.height;
    // во сколько раз кусок фото крупнее выхода; 4 точки на сторону — потолок по времени
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const kx = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2])) / outW;
    const ky = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2])) / outH;
    const ss = U.clamp(Math.floor(Math.min(kx, ky) + 0.5 - 0.15), 1, 4);
    const ox = new Float32Array(ss * ss), oy = new Float32Array(ss * ss);
    for (let j = 0, o = 0; j < ss; j++) for (let i2 = 0; i2 < ss; i2++, o++) {
      ox[o] = (i2 + 0.5) / ss - 0.5; oy[o] = (j + 0.5) / ss - 0.5;
    }
    const nOff = ss * ss;
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const i = (y * outW + x) * 4;
        let ar = 0, ag = 0, ab = 0, got = 0;
        for (let o = 0; o < nOff; o++) {
          const X = x + ox[o], Y = y + oy[o];
          const w = h[6] * X + h[7] * Y + 1;
          const u = (h[0] * X + h[1] * Y + h[2]) / w, v = (h[3] * X + h[4] * Y + h[5]) / w;
          if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) continue;
          // билинейная выборка — без неё текст рассыпается на «лесенку»
          const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
          const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
          const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4, p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
          const r0 = sd[p00] + (sd[p10] - sd[p00]) * fx, r1 = sd[p01] + (sd[p11] - sd[p01]) * fx;
          const g0 = sd[p00 + 1] + (sd[p10 + 1] - sd[p00 + 1]) * fx, g1 = sd[p01 + 1] + (sd[p11 + 1] - sd[p01 + 1]) * fx;
          const b0 = sd[p00 + 2] + (sd[p10 + 2] - sd[p00 + 2]) * fx, b1 = sd[p01 + 2] + (sd[p11 + 2] - sd[p01 + 2]) * fx;
          ar += r0 + (r1 - r0) * fy; ag += g0 + (g1 - g0) * fy; ab += b0 + (b1 - b0) * fy;
          got++;
        }
        if (!got) { dd[i] = dd[i + 1] = dd[i + 2] = 255; dd[i + 3] = 255; continue; }
        dd[i] = ar / got; dd[i + 1] = ag / got; dd[i + 2] = ab / got; dd[i + 3] = 255;
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

  /* ── Чистка: выровнять свет, вывести бумагу в белый, вернуть чернилам черноту ──

     Старый способ — «размыть серое и поделить» — делал три ошибки сразу.
     Размытие усредняет бумагу ВМЕСТЕ с буквами, поэтому под плотным текстом фон
     занижался и абзац выцветал. Белая и чёрная точки не искались вовсе: вместо них
     стоял контраст вокруг выдуманной середины 128, из-за чего чернила оставались
     серыми (замер: до чистки 2 % самых тёмных точек лежали на 122, после чистки —
     на 147, то есть текст становился СВЕТЛЕЕ). И весь цвет лампы оставался на месте:
     три канала делились на одно и то же серое число — это общий множитель, он не
     может убрать желтизну.

     Теперь: фон берём по сетке клеток светлым квантилем (буквы в него не попадают),
     ищем чёрную точку по гистограмме и растягиваем диапазон, убираем цвет лампы
     по белой точке бумаги, а в чёрно-белом ставим порог не один на лист, а свой
     у каждой точки (Sauvola). Ничего поверх снимка не рисуем: ни шума, ни теней,
     ни зерна — только исправляем съёмку. */

  /* Быстрое размытие серого «коробкой» — нужно для нерезкого маскирования */
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

  /* ── Фон бумаги по сетке клеток ─────────────────────────────────────────── */

  const CELLS = 28;        // столько клеток укладывается по короткой стороне листа
  const QUANT = 0.80;      // «это ещё бумага»: 80-й процентиль яркости в клетке

  function paperGrid(gray, w, h) {
    const cell = Math.max(8, Math.round(Math.min(w, h) / CELLS));
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), gn = gw * gh;
    const colCell = new Int32Array(w);
    for (let x = 0; x < w; x++) colCell[x] = (x / cell) | 0;
    const BIN = 64, hist = new Uint32Array(gn * BIN), cnt = new Uint32Array(gn);
    for (let y = 0; y < h; y++) {
      const row = y * w, gRow = ((y / cell) | 0) * gw;
      for (let x = 0; x < w; x++) {
        const gi = gRow + colCell[x];
        const v = gray[row + x]; const b = v < 0 ? 0 : v > 255 ? 255 : v | 0;
        hist[gi * BIN + (b >> 2)]++; cnt[gi]++;
      }
    }
    const q = new Float32Array(gn);
    for (let i = 0; i < gn; i++) {
      const need = cnt[i] * QUANT, off = i * BIN; let acc = 0, b = BIN - 1;
      for (let j = 0; j < BIN; j++) { acc += hist[off + j]; if (acc >= need) { b = j; break; } }
      q[i] = b * 4 + 2;
    }
    /* Клетку, целиком закрытую печатью или чёрной заливкой, вытягивает замыкание
       (максимум, потом минимум). Окно 5×5 держит пятно шириной до четырёх клеток —
       это шапка таблицы или крупный логотип. Плавную тень от руки замыкание не двигает. */
    const cx = x => x < 0 ? 0 : x >= gw ? gw - 1 : x, cy = y => y < 0 ? 0 : y >= gh ? gh - 1 : y;
    const pass = (src, kind, rad) => {
      const out = new Float32Array(gn);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let acc = kind === 'max' ? -1 : kind === 'min' ? 1e9 : 0, num = 0;
        for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
          const v = src[cy(y + j) * gw + cx(x + i)];
          if (kind === 'max') { if (v > acc) acc = v; }
          else if (kind === 'min') { if (v < acc) acc = v; }
          else { acc += v; num++; }
        }
        out[y * gw + x] = kind === 'avg' ? acc / num : acc;
      }
      return out;
    };
    const closed = pass(pass(q, 'max', 2), 'min', 2);
    const smooth = pass(closed, 'avg', 1);
    /* Пол по странице: если пятно шире окна замыкания, фон под ним всё равно просядет
       и чернила там побелеют. Медиана сетки — это уровень бумаги листа; ниже её
       половины фон опуститься не может. */
    const sorted = Float32Array.from(smooth).sort();
    const med = sorted[sorted.length >> 1];
    const floor = med * 0.55;
    for (let i = 0; i < gn; i++) if (smooth[i] < floor) smooth[i] = floor;
    return { g: smooth, gw: gw, gh: gh, cell: cell, paper: med };
  }

  /* Сетку раскладываем обратно на пиксели билинейно — фон выходит гладкий, без ступенек.
     Веса по X у всех строк одинаковые, считаем их один раз.
     ВНИМАНИЕ: возвращает всегда ОДИН И ТОТ ЖЕ буфер, перезаписывая его на каждый вызов.
     Строку нужно использовать сразу, до следующего вызова. */
  function baseSampler(G, w) {
    const xa = new Int32Array(w), xb = new Int32Array(w), xf = new Float32Array(w);
    const cx = x => x < 0 ? 0 : x >= G.gw ? G.gw - 1 : x;
    for (let x = 0; x < w; x++) {
      const t = x / G.cell - 0.5, i0 = Math.floor(t);
      xa[x] = cx(i0); xb[x] = cx(i0 + 1); xf[x] = t - i0;
    }
    const row = new Float32Array(w);
    return function (y) {
      const t = y / G.cell - 0.5, j0 = Math.floor(t), fy = t - j0;
      const a = (j0 < 0 ? 0 : j0 >= G.gh ? G.gh - 1 : j0) * G.gw;
      const b = (j0 + 1 < 0 ? 0 : j0 + 1 >= G.gh ? G.gh - 1 : j0 + 1) * G.gw;
      for (let x = 0; x < w; x++) {
        const i0 = xa[x], i1 = xb[x], f = xf[x];
        const p = G.g[a + i0] + (G.g[a + i1] - G.g[a + i0]) * f;
        const q = G.g[b + i0] + (G.g[b + i1] - G.g[b + i0]) * f;
        const v = p + (q - p) * fy;
        row[x] = v < 1 ? 1 : v;
      }
      return row;
    };
  }

  /* ── Порог для чёрно-белого: у каждой точки свой ───────────────────────── */

  /* Интегральные изображения: сумма и сумма квадратов. По ним среднее и разброс
     в любом окне берутся за четыре обращения к массиву — размер окна на скорость
     не влияет. Суммы держим в Float64: значения тут не целые и растут до миллиардов. */
  function integrals(v, w, h) {
    const W = w + 1;
    const s1 = new Float64Array(W * (h + 1));
    const s2 = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      const row = y * w, up = y * W, dn = up + W;
      let r1 = 0, r2 = 0;
      for (let x = 0; x < w; x++) {
        const p = v[row + x];
        r1 += p; r2 += p * p;
        s1[dn + x + 1] = s1[up + x + 1] + r1;
        s2[dn + x + 1] = s2[up + x + 1] + r2;
      }
    }
    return { s1: s1, s2: s2, W: W };
  }

  /* Порог Sauvola: t = m * (1 + k * (s / R - 1)).
     Где вокруг чистая бумага (разброс почти нулевой) — граница уходит заметно ниже
     среднего, и бумага остаётся белой без крапин. Где рядом штрих (разброс велик) —
     граница подтягивается к среднему, и бледная обводка печати или карандаш
     всё-таки чернеют. Узкий переход SOFT вместо обрыва не даёт контуру букв
     рассыпаться в лесенку. Массив flat — в шкале, где бумага = 255, но БЕЗ обрезки
     сверху: внутри печати фон ниже бумаги, и обрезка съела бы именно то, ради чего
     всё затеяно. */
  function sauvolaBW(flat, hard, w, h, strength) {
    // окно ≈ 3 % ширины листа: при 200 dpi это 49 точек ≈ 6 мм — строка текста с полями
    const win = U.clamp(Math.round(w * 0.03), 15, 81);
    const r = win >> 1;
    const ii = integrals(flat, w, h), s1 = ii.s1, s2 = ii.s2, W = ii.W;
    const ks = 0.10 + 0.16 * U.clamp(strength, 0, 1);
    const R = 128;      // размах разброса для 8 бит — как в исходной работе Sauvola
    const SOFT = 7;     // ширина перехода, уровней серого
    const out = new Uint8ClampedArray(flat.length);
    for (let y = 0; y < h; y++) {
      const y0 = y < r ? 0 : y - r, y1 = y + r > h - 1 ? h - 1 : y + r;
      const a = y0 * W, b = (y1 + 1) * W, hh = y1 - y0 + 1, row = y * w;
      for (let x = 0; x < w; x++) {
        const p = flat[row + x];
        // пол по СЫРОЙ яркости: сплошная заливка шире окна не должна выедаться изнутри
        if (hard[row + x]) { out[row + x] = 0; continue; }
        const x0 = x < r ? 0 : x - r, x1 = x + r > w - 1 ? w - 1 : x + r;
        const area = (x1 - x0 + 1) * hh;
        const m = (s1[b + x1 + 1] - s1[a + x1 + 1] - s1[b + x0] + s1[a + x0]) / area;
        const q = (s2[b + x1 + 1] - s2[a + x1 + 1] - s2[b + x0] + s2[a + x0]) / area - m * m;
        const t = m * (1 + ks * ((q > 0 ? Math.sqrt(q) : 0) / R - 1));
        const u = (p - t + SOFT) / (2 * SOFT);
        out[row + x] = u <= 0 ? 0 : u >= 1 ? 255 : (u * 255) | 0;
      }
    }
    return out;
  }

  /* ── Резкость ───────────────────────────────────────────────────────────── */

  /* Нерезкое маскирование по яркости: из картинки вычитаем её же чуть размытую копию —
     разница и есть контуры букв, их и усиливаем. Фотография всегда мягче отпечатка,
     настоящий сканер отличается от снимка именно этим шагом. Радиус привязан к размеру
     листа, а не к числу пикселей, поэтому предпросмотр и файл обостряются одинаково.
     Добавку считаем ДО деления на фон: в затенённом углу она вырастет ровно во столько
     же раз, во сколько тень придавила там контраст. */
  function unsharpGray(gray, w, h) {
    const r = Math.max(1, Math.round(Math.min(w, h) / 1400));
    const soft = blurGray(gray, w, h, r);
    const amount = 0.7;    // сила
    const edge = 3;        // ниже этого — зерно бумаги, его не трогаем
    const limit = 16;      // предел добавки: дальше растёт ореол и буквы толстеют
    for (let p = 0; p < gray.length; p++) {
      let e = gray[p] - soft[p];
      e = e > edge ? e - edge : e < -edge ? e + edge : 0;
      e *= amount;
      soft[p] = e > limit ? limit : e < -limit ? -limit : e;
    }
    return soft;
  }

  /* ── Баланс белого ──────────────────────────────────────────────────────── */

  /* Какого цвета сама бумага при этом свете. Смотрим только светлые места — там бумага,
     а не краска, — и отбрасываем пересвет: в нём цвет уже потерян и соврёт.
     Если светлого на снимке нет или каналы разошлись слишком сильно (цветной бланк,
     а не лампа) — возвращаем null, и цвет не трогаем вовсе. */
  function paperWhite(d, gray, n) {
    const step = n > 400000 ? 4 : 1;
    /* Порог «это светлое» и сам замер считаем по ОДНОМУ и тому же набору точек:
       иначе на светлом снимке порог уезжает в 255, все точки отсеиваются как пересвет,
       и баланс белого молча выключается.
       Перебираем потолок пересвета: сначала строгий (252) — на нём цвет ещё не потерян;
       если светлого почти не осталось, отпускаем. Отсекаем по МАКСИМАЛЬНОМУ каналу:
       у жёлтой лампы красный упирается в 255 первым, и если брать такие точки,
       желтизна покажется меньше, чем она есть. */
    for (const cap of [252, 254, 256]) {
      const hist = new Uint32Array(256);
      let cnt = 0;
      for (let p = 0; p < n; p += step) {
        const i = p * 4;
        if (d[i] >= cap || d[i + 1] >= cap || d[i + 2] >= cap) continue;
        const v = gray[p]; hist[v < 0 ? 0 : v > 255 ? 255 : v | 0]++; cnt++;
      }
      if (cnt < 256) continue;
      let acc = 0, lo = 0;
      for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= cnt * 0.25) { lo = v; break; } }
      let sr = 0, sg = 0, sb = 0, m = 0;
      for (let p = 0; p < n; p += step) {
        const i = p * 4;
        if (d[i] >= cap || d[i + 1] >= cap || d[i + 2] >= cap) continue;
        if (gray[p] < lo) continue;
        sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; m++;
      }
      if (m >= 64) return [sr / m, sg / m, sb / m];
    }
    return null;
  }

  function whiteGains(wp, k) {
    if (!wp) return null;
    const y = (wp[0] * 299 + wp[1] * 587 + wp[2] * 114) / 1000;
    if (y < 110) return null;                                  // ничего светлого нет — гадать нельзя
    // очень сильный разброс — это уже цвет самой бумаги (синяя копирка, цветной бланк),
    // гадать там нельзя. Тёплый свет лампы в этот предел укладывается.
    if (Math.max(wp[0], wp[1], wp[2]) - Math.min(wp[0], wp[1], wp[2]) > 78) return null;
    const kw = 0.7 + 0.3 * k, g = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      g[ch] = U.clamp(y / Math.max(1, wp[ch]), 0.72, 1.45);
      g[ch] = 1 + (g[ch] - 1) * kw;
    }
    return g;
  }

  /* ── Сама чистка ────────────────────────────────────────────────────────── */

  /* mode: 'color' | 'gray' | 'bw'; strength 0..1 — насколько сильно выбеливать */
  S.clean = function (c, mode, strength) {
    const w = c.width, h = c.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h), d = id.data;
    const n = w * h;
    const str = U.clamp(strength === undefined ? 0.7 : strength, 0, 1);
    const k = 0.35 + 0.65 * str;

    let luma = new Float32Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) luma[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

    const wb = whiteGains(paperWhite(d, luma, n), k);
    const gR = wb ? wb[0] : 1, gG = wb ? wb[1] : 1, gB = wb ? wb[2] : 1;

    /* Дальше работаем по яркости уже с убранным цветом лампы — тогда бумага
       действительно доходит до 255, а не до «почти белого».
       В сером и чёрно-белом за яркостью вдобавок прячется цветная краска: у синей
       печати яркость по формуле 299/587/114 почти как у бумаги, и печать пропадает.
       Поэтому там вычитаем цветность — но тем слабее, чем пиксель светлее бумаги,
       иначе зелёный или жёлтый маркер стал бы чёрной кляксой поверх текста. */
    let gray = new Float32Array(n);
    if (mode === 'color') {
      for (let i = 0, p = 0; p < n; i += 4, p++) {
        gray[p] = (d[i] * gR * 299 + d[i + 1] * gG * 587 + d[i + 2] * gB * 114) / 1000;
      }
    } else {
      // грубый уровень бумаги, чтобы понять, что светлое, а что краска
      const rough = (function () {
        const hh = new Uint32Array(256); let c2 = 0;
        for (let p = 0; p < n; p += 4) { const v = luma[p]; hh[v < 0 ? 0 : v > 255 ? 255 : v | 0]++; c2++; }
        let acc = 0; for (let v = 255; v >= 0; v--) { acc += hh[v]; if (acc >= c2 * 0.15) return Math.max(40, v); }
        return 200;
      })();
      for (let i = 0, p = 0; p < n; i += 4, p++) {
        const R = d[i] * gR, G = d[i + 1] * gG, B = d[i + 2] * gB;
        const y = (R * 299 + G * 587 + B * 114) / 1000;
        const mx = R > G ? (R > B ? R : B) : (G > B ? G : B);
        const mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
        const col = mx - mn > 90 ? 90 : mx - mn;
        const dark = 1 - y / rough;                        // 0 у бумаги, 1 у чёрного
        gray[p] = y - col * (dark > 1 ? 1 : dark < 0 ? 0 : dark);
      }
    }
    luma = null;                                            // 15 МБ на странице А4 — отдаём сразу

    const G0 = paperGrid(gray, w, h), baseAt = baseSampler(G0, w);
    let sharp = unsharpGray(gray, w, h);

    /* Чёрная точка — то, чем настоящий сканер отличается от «поделили на фон».
       Белую не ищем: после выравнивания бумага и так упирается в 255, а 95-й
       процентиль там всегда 255 — проверено, отдельный поиск был бы мёртвым кодом. */
    const hist = new Uint32Array(256);
    let tot = 0;
    for (let y = 0; y < h; y += 2) {
      const base = baseAt(y), row = y * w;
      for (let x = 0; x < w; x += 2) {
        let v = (gray[row + x] + sharp[row + x]) / base[x] * 255;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        hist[v | 0]++; tot++;
      }
    }
    let black = 0;
    { const need = tot * 0.02; let acc = 0; for (let j = 0; j < 256; j++) { acc += hist[j]; if (acc >= need) { black = j; break; } } }
    if (255 - black < 90) black = 165;            // почти пустой лист: шум не делаем грязью
    const span = Math.max(1, (255 - black) * 0.94);

    /* Чёрно-белое собираем в два прохода: сначала ровная полутоновая страница,
       потом порог по соседям каждой точки. */
    const flat = mode === 'bw' ? new Float32Array(n) : null;
    const hard = mode === 'bw' ? new Uint8Array(n) : null;
    const hardLevel = G0.paper * 0.5;             // темнее половины бумаги листа — чёрное при любом окне

    for (let y = 0; y < h; y++) {
      const base = baseAt(y);
      let i = y * w * 4, p = y * w;
      for (let x = 0; x < w; x++, i += 4, p++) {
        const b = base[x], s = sharp[p];
        const flatY = (gray[p] + s) / b * 255;                 // ровный свет по всему листу
        if (flat) { flat[p] = flatY; hard[p] = gray[p] < hardLevel ? 1 : 0; continue; }
        let t = (flatY - black) / span; t = t < 0 ? 0 : t > 1 ? 1 : t;
        t = t + (t * t * (3 - 2 * t) - t) * k;                 // мягкая S-кривая
        if (t > 0.97) t = 1;                                   // бумага ровно белая, без ряби
        const target = flatY + (t * 255 - flatY) * k;
        if (mode === 'color') {
          /* тон и насыщенность держим: все три канала умножаем на один коэффициент,
             иначе синяя печать уезжает в кислотный */
          const mul = flatY > 1 ? target / flatY : 1;
          d[i] = U.clamp((d[i] * gR + s) / b * 255 * mul, 0, 255);
          d[i + 1] = U.clamp((d[i + 1] * gG + s) / b * 255 * mul, 0, 255);
          d[i + 2] = U.clamp((d[i + 2] * gB + s) / b * 255 * mul, 0, 255);
        } else {
          d[i] = d[i + 1] = d[i + 2] = U.clamp(target, 0, 255);
        }
      }
    }
    if (flat) {
      gray = sharp = null;                                  // до порога не нужны, а места занимают 30 МБ
      const bwOut = sauvolaBW(flat, hard, w, h, str);
      for (let i = 0, p = 0; p < n; i += 4, p++) d[i] = d[i + 1] = d[i + 2] = bwOut[p];
    }
    ctx.putImageData(id, 0, 0);
    return c;
  };

  /* ── Окно сканирования ─────────────────────────────────────────────────── */

  S.open = function () {
    const pages = [];              // {src, quad, out, mode}
    let cur = -1, stream = null, dispScale = 1;
    let saveBtn = null;            // кнопка «Сохранить …» — подпись меняется от формата
    let netSaved = [];             // сохранённые адреса сканеров по сети

    const video = el('video', { playsinline: '', muted: '', autoplay: '' });
    const cv = el('canvas');
    const empty = el('div', { class: 'scan-empty', text: 'Здесь появится фото документа. Нажмите «Снять камерой» или «Выбрать фото».' });
    const stage = el('div', { class: 'scan-stage' }, [video, cv, empty]);
    const corners = [];
    for (let i = 0; i < 4; i++) { const h = el('div', { class: 'scan-h', 'data-i': i }); corners.push(h); stage.append(h); }
    const edges = el('canvas', { class: 'scan-edges' }); stage.append(edges);
    const wrap = el('div', { class: 'scan-prev' }, stage);
    /* В натуральную величину лист шире окошка. Без подсказки человек крутит только вниз
       и не находит печать, которая стоит справа, — решает, что она пропала. */
    const zoomNote = el('p', { class: 'hint scan-zoom-note', hidden: true,
      text: 'Страница в натуральную величину — она больше окошка. Тяните её мышью или пальцем, вниз и вбок.' });
    const prevCol = el('div', { class: 'scan-col' }, [wrap, zoomNote]);
    // мышью лист таскаем сами; на сенсорном экране пусть работает обычная прокрутка пальцем
    wrap.addEventListener('pointerdown', ev => {
      if (!wrap.classList.contains('zoom') || ev.pointerType !== 'mouse') return;
      ev.preventDefault();
      const sx = ev.clientX, sy = ev.clientY, l = wrap.scrollLeft, t = wrap.scrollTop;
      const move = e2 => { wrap.scrollLeft = l - (e2.clientX - sx); wrap.scrollTop = t - (e2.clientY - sy); };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        wrap.classList.remove('drag');
      };
      wrap.classList.add('drag');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    const status = el('p', { class: 'hint', text: 'Положите документ на стол, снимите сверху целиком, при хорошем свете.' });

    const camBtn = el('button', { class: 'btn primary', html: '<svg class="i" viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="13" rx="1.5"/><circle cx="12" cy="13" r="3.5"/><path d="M9 6.5 10 4h4l1 2.5"/></svg><span>Снять камерой</span>' });
    const fileBtn = el('button', { class: 'btn', text: 'Выбрать фото' });
    const shotBtn = el('button', { class: 'btn primary', text: 'Снимок', hidden: true });
    const modeSeg = segment([['color', 'Цветной'], ['gray', 'Серый'], ['bw', 'Чёрно-белый']], 'gray', v => { if (cur >= 0) { pages[cur].mode = v; redraw(); } syncSave(); });
    const viewSeg = segment([['photo', 'Фото'], ['result', 'Как получится']], 'photo', () => { syncZoom(); redraw(); });
    /* В окошко предпросмотра лист А4 влезает уменьшенным раз в шесть — мелкий текст
       там не разглядеть ни при каком алгоритме, хоть он в файле и чёткий. Поэтому
       даём посмотреть страницу в натуральную величину с прокруткой. */
    let zoomed = false;
    const zoomBtn = el('button', { class: 'btn sm', hidden: true,
      html: '<svg class="i" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/></svg><span>Крупно</span>' });
    const zoomLbl = zoomBtn.querySelector('span');
    zoomBtn.addEventListener('click', () => {
      zoomed = !zoomed;
      zoomLbl.textContent = zoomed ? 'Вся страница' : 'Крупно';
      redraw();
    });
    function syncZoom() {
      const on = viewSeg.value() === 'result';
      zoomBtn.hidden = !on;
      if (!on && zoomed) { zoomed = false; zoomLbl.textContent = 'Крупно'; }
    }
    const fmtSeg = segment([['pdf', 'PDF'], ['jpg', 'JPG'], ['png', 'PNG'], ['docx', 'Word']], 'pdf', () => syncSave());
    const qualSeg = segment([['light', 'Лёгкое'], ['normal', 'Обычное'], ['high', 'Высокое']], 'normal', () => syncSave());
    const modeNote = el('p', { class: 'hint' });
    const fmtNote = el('p', { class: 'hint' });
    const qualNote = el('p', { class: 'hint' });
    const strengthR = el('input', { type: 'range', class: 'range', min: 0, max: 100, value: 70 });
    const strengthV = el('span', { class: 'num', text: '70' });
    const autoBtn = el('button', { class: 'btn sm', text: 'Найти лист заново' });
    const thumbs = el('div', { class: 'scan-thumbs' });
    const fileInp = el('input', { type: 'file', accept: 'image/*,.jpg,.jpeg,.png,.heic,.heif', capture: 'environment', hidden: true, multiple: true });

    /* — сканер по сети: страница вашего МФУ по его IP-адресу — */
    const netInp = el('input', { class: 'inp', type: 'text', inputmode: 'url', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', placeholder: '192.168.1.50' });
    const netGo = el('button', { class: 'btn', text: 'Открыть' });
    const netChips = el('div', { class: 'scan-net-saved' });
    // свёрнут по умолчанию: главное действие — «Снять камерой», сеть нужна не всем
    const netBox = el('details', { class: 'scan-net' }, [
      el('summary', null, [
        el('span', { html: '<svg class="i" viewBox="0 0 24 24"><rect x="3.5" y="9.5" width="17" height="8" rx="1.5"/><path d="M7 9.5V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5v4"/><path d="M7 17.5V20h10v-2.5"/><circle cx="17" cy="13" r=".8"/></svg>' }).firstChild,
        el('b', { text: 'Сканер по сети' }),
        el('span', { class: 'muted', text: '— МФУ по IP' })
      ]),
      el('div', { class: 'scan-net-row' }, [netInp, netGo]),
      netChips,
      el('p', { class: 'hint', text: 'Адрес страницы сканера или МФУ — тот же IP, что у принтера. Вводится один раз. Отсканировали там — вернитесь сюда и нажмите «Выбрать фото».' })
    ]);

    const ctl = el('div', { class: 'ctl' }, [
      el('div', { class: 'row wrap' }, [camBtn, fileBtn, shotBtn]),
      status,
      netBox,
      el('div', { class: 'f' }, [el('span', { text: 'Показать' }),
        el('div', { class: 'row wrap' }, [viewSeg, zoomBtn]),
        el('p', { class: 'hint', text: '«Как получится» — готовая страница: выпрямленная и очищенная. Целый лист в окошке мелкий — нажмите «Крупно», чтобы увидеть текст в натуральную величину.' })]),
      el('div', { class: 'f' }, [el('span', { text: 'Цвет' }), modeSeg, modeNote]),
      el('label', { class: 'f' }, [el('span', null, [el('span', { text: 'Выбелить бумагу' }), strengthV]), strengthR]),
      el('div', { class: 'f' }, [el('span', { text: 'В каком формате сохранить' }), fmtSeg, fmtNote]),
      el('div', { class: 'f' }, [el('span', { text: 'Качество' }), qualSeg, qualNote]),
      el('div', { class: 'f' }, [el('span', { text: 'Углы листа' }), el('div', { class: 'row' }, autoBtn),
        el('p', { class: 'hint', text: 'Программа сама находит лист. Если рамка легла мимо — перетащите углы.' })]),
      el('div', { class: 'f' }, [el('span', { text: 'Страницы' }), thumbs])
    ]);

    /* — сохранённые адреса сканеров — */
    function renderNet() {
      netChips.innerHTML = '';
      if (!netSaved.length) return;
      netChips.append(el('span', { class: 'muted small', text: 'Сохранённые:' }));
      netSaved.forEach(u => {
        const chip = el('span', { class: 'chip' });
        const go = el('button', { class: 'lnk', title: u, text: S.shortUrl(u) });
        go.addEventListener('click', () => { netInp.value = u; openNet(); });
        const x = el('button', { class: 'x', title: 'Убрать адрес', 'aria-label': 'Убрать адрес ' + u, text: '×' });
        x.addEventListener('click', () => { netSaved = netSaved.filter(v => v !== u); renderNet(); storeNet(netInp.value.trim()); });
        chip.append(go, x); netChips.append(chip);
      });
    }
    function storeNet(last) {
      try { O.Store.set('scan.net', { last: last || '', saved: netSaved }); } catch (e) { console.warn(e); }
    }
    function openNet() {
      const href = S.normUrl(netInp.value);
      if (!href) { U.toast('Не понял адрес. Так: 192.168.1.50 или http://192.168.1.50', true); netInp.focus(); return; }
      netInp.value = href;
      netSaved = [href].concat(netSaved.filter(u => u !== href)).slice(0, 6);
      renderNet(); storeNet(href);
      const w = window.open(href, '_blank', 'noopener');
      if (!w) U.toast('Браузер не дал открыть вкладку — разрешите всплывающие окна для этой страницы', true);
      else U.toast('Сканер открыт в соседней вкладке');
    }
    netGo.addEventListener('click', openNet);
    netInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); openNet(); } });
    (async function () {
      try {
        const v = await O.Store.get('scan.net');
        if (v && typeof v === 'object') {
          netSaved = (Array.isArray(v.saved) ? v.saved : []).filter(u => S.normUrl(u)).slice(0, 6);
          if (v.last && !netInp.value) netInp.value = v.last;
        }
      } catch (e) { console.warn(e); }
      // кто сканером по сети уже пользуется — тому он нужен сразу раскрытым
      if (netInp.value || netSaved.length) netBox.open = true;
      renderNet();
    })();

    /* — подпись кнопки сохранения и подсказки под форматом/качеством — */
    function syncSave() {
      const f = fmtSeg.value(), q = QUALITY[qualSeg.value()] || QUALITY.normal;
      // пояснение должно говорить про выбранное, иначе человек читает его про чужой вариант
      modeNote.textContent = {
        color: 'Цветной — видно синюю печать и пометки ручкой. Файл самый тяжёлый.',
        gray: 'Серый — обычный выбор: похоже на настоящий сканер, вес умеренный.',
        bw: 'Чёрно-белый — только текст, файл самый лёгкий. Синяя печать станет чёрной.'
      }[modeSeg.value()] || '';
      if (saveBtn) saveBtn.textContent = 'Сохранить ' + FORMATS[f];
      fmtNote.textContent =
        f === 'pdf' ? 'PDF — все страницы в одном файле. Его можно тут же открыть здесь и поставить печать.'
        : f === 'docx' ? 'В Word страницы лягут картинками: их можно двигать и подписывать, но текст внутри не ищется и не правится.'
        : pages.length > 1 ? 'Каждая страница сохранится отдельной картинкой — файлов будет ' + pages.length + '.'
        : 'Страница сохранится картинкой.';
      qualNote.textContent = q.dpi + ' точек на дюйм. '
        + (q.dpi === 150 ? 'Самый лёгкий файл — для почты и мессенджеров.'
        : q.dpi === 200 ? 'Как у обычного офисного сканера. Подходит почти всегда.'
        : 'Для мелкого шрифта, печатей и подписей. Файл тяжелее.');
    }

    const body = el('div', { class: 'scan' }, [prevCol, ctl, fileInp]);

    const dlg = D.show({
      title: 'Сканировать документ', body, width: 'lg',
      onClose: () => { stopCam(); window.removeEventListener('resize', onResize); },
      buttons: [
        { label: 'Отмена' },
        { label: 'Сохранить PDF', onClick: () => { finish(false); return false; } },
        { label: 'Открыть в программе', primary: true, onClick: () => { finish(true); return false; } }
      ]
    });
    // подпись у этой кнопки меняется вслед за выбранным форматом
    saveBtn = dlg.querySelectorAll('footer .btn')[1] || null;
    const openBtn = dlg.querySelectorAll('footer .btn')[2];
    if (openBtn) openBtn.title = 'Открыть скан здесь, чтобы поставить печать и подпись. Формат для этого всегда PDF.';

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
      pages[cur].quad = q; dropCache(pages[cur]); redraw();
    });
    /* Цифру двигаем сразу, лист пересчитываем, когда рука остановилась: одна чистка
       листа 150 dpi идёт около 0,2 с, при короткой паузе тики копились бы в очередь.
       В режиме «Фото» ползунок на экране ничего не меняет — там не считаем вовсе. */
    const redrawSoon = U.debounce(() => requestAnimationFrame(() => redraw()), 220);
    strengthR.addEventListener('input', () => {
      strengthV.textContent = strengthR.value;
      if (viewSeg.value() === 'result') redrawSoon();
    });
    // поворот телефона и изменение окна: ручки пересчитываем, иначе они разъезжаются
    const onResize = U.debounce(() => redraw(), 150);
    window.addEventListener('resize', onResize);

    function renderThumbs() {
      // без единой страницы сохранять нечего — кнопки не должны нажиматься
      // подпись «Сохранить …» меняется, поэтому смотрим на место кнопки, а не на текст
      const foot = dlg && dlg.querySelectorAll('footer .btn');
      if (foot) Array.from(foot).forEach((b, i) => { if (i > 0) b.disabled = !pages.length; });
      syncSave();
      thumbs.innerHTML = '';
      if (!pages.length) { thumbs.append(el('div', { class: 'empty-note', text: 'Пока ни одной страницы.' })); return; }
      pages.forEach((p, i) => {
        // не <button>: внутри лежит крестик «убрать», а кнопку в кнопку вкладывать нельзя
        const t = el('div', { class: 'scan-th' + (i === cur ? ' on' : ''), role: 'button', tabindex: '0', title: 'Страница ' + (i + 1) });
        // в миниатюре показываем готовую страницу, а не кривое фото — сразу видно, удалась ли съёмка
        const im = thumbImage(p);
        t.append(im, el('span', { class: 'n', text: String(i + 1) }));
        const pick = () => { cur = i; modeSeg.set(p.mode); renderThumbs(); redraw(); };
        t.addEventListener('click', pick);
        t.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
        const del = el('button', { class: 'btn icon del', title: 'Убрать страницу', html: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>' });
        del.addEventListener('click', ev => {
          ev.stopPropagation(); pages.splice(i, 1);
          cur = Math.min(cur, pages.length - 1); renderThumbs(); redraw();
        });
        t.append(del);
        thumbs.append(t);
      });
    }

    /* ── Предпросмотр «Как получится»: считаем по-настоящему, показываем мелко ──
       Раньше страница и выпрямлялась, и чистилась сразу в размер окошка — 310 точек
       на всю ширину А4, то есть 38 точек на дюйм, тогда как файл сохраняется при 200.
       При таком сжатии выборка брала каждый шестой пиксель снимка: штрих буквы либо
       попадал под точку и становился кляксой втрое толще настоящей, либо пропадал
       совсем, а порог чёрно-белого это закреплял. Человек видел рваный текст, которого
       в файле нет.
       Теперь лист считается на 150 dpi — это ровно «Лёгкое» качество, один из настоящих
       режимов программы, — и только потом усредняющим уменьшением доводится до размера
       окошка. На экране то же, что окажется в файле. */
    const PREV_DPI = 150;     // предпросмотр «Как получится»
    const THUMB_DPI = 75;     // миниатюры: на 64 точках разницы со 150 всё равно не видно

    /* Уменьшение с усреднением: половинками, пока не останется меньше двойного запаса.
       Прямой drawImage сразу в несколько раз браузер делает прореживанием — буквы
       опять рассыплются. */
    function fit(src, w) {
      let c = src;
      while (c.width > w * 2) {
        const half = document.createElement('canvas');
        half.width = Math.max(1, c.width >> 1); half.height = Math.max(1, c.height >> 1);
        const hx = half.getContext('2d');
        hx.imageSmoothingEnabled = true; hx.imageSmoothingQuality = 'high';
        hx.drawImage(c, 0, 0, half.width, half.height);
        c = half;
      }
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(w));
      out.height = Math.max(1, Math.round(w * c.height / c.width));
      const ox = out.getContext('2d');
      ox.imageSmoothingEnabled = true; ox.imageSmoothingQuality = 'high';
      ox.drawImage(c, 0, 0, out.width, out.height);
      return out;
    }

    /* Размер готового листа в пикселях — одна формула и для файла, и для предпросмотра */
    function sheet(p, dpi) {
      const [q0, q1, q2, q3] = p.quad;
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const wPx = Math.max(dist(q0, q1), dist(q3, q2)), hPx = Math.max(dist(q0, q3), dist(q1, q2));
      const ratio = wPx / (hPx || 1), a4 = A4[1] / A4[0];   // 1,414 — пропорция А4
      let mmW, mmH;
      if (Math.abs(ratio - 1 / a4) < 0.06) { mmW = A4[0]; mmH = A4[1]; }        // книжный А4
      else if (Math.abs(ratio - a4) < 0.06) { mmW = A4[1]; mmH = A4[0]; }       // альбомный А4
      else if (ratio < 1) { mmH = A4[1]; mmW = A4[1] * ratio; }                 // другой размер —
      else { mmW = A4[1]; mmH = A4[1] / ratio; }                                // сохраняем пропорции листа
      return [Math.max(16, Math.round(mmW / MM * dpi)), Math.max(16, Math.round(mmH / MM * dpi))];
    }

    /* Пока углы не двигали, пересчитывать выпрямление незачем */
    function quadKey(p) { return p.quad.map(c => Math.round(c[0]) + ',' + Math.round(c[1])).join(';'); }

    /* Готовая страница предпросмотра. Выпрямление от цвета и ползунка не зависит —
       держим его в памяти; чистка зависит, у неё свой ключ. */
    function pageOf(p) {
      const st = Math.round(+strengthR.value) / 100;
      const fKey = quadKey(p);
      if (p.flatKey !== fKey) {
        const [w, h] = sheet(p, PREV_DPI);
        p.flat = S.warp(p.src, p.quad, w, h); p.flatKey = fKey;
        p.prev = null; p.prevKey = null;
      }
      const key = fKey + '|' + p.mode + '|' + st;
      if (p.prevKey !== key) { p.prev = S.clean(IP.clone(p.flat), p.mode, st); p.prevKey = key; }
      return p.prev;
    }

    /* Углы подвинули — всё посчитанное устарело */
    function dropCache(p) { p.flat = p.prev = p.thumb = null; p.flatKey = p.prevKey = p.thumbKey = null; }

    /* Лист 150 dpi — это около 9 МБ. На два десятка страниц набежало бы полгигабайта,
       поэтому большие холсты держим только у текущей страницы. */
    function trimCache() {
      pages.forEach((p, i) => { if (i !== cur) { p.flat = p.prev = null; p.flatKey = p.prevKey = null; } });
    }

    /* — миниатюры — */
    /* Считаются по одной с передышкой, иначе на десяти листах окно замирает.
       За ползунком миниатюра не следит: на 64 точках разницы не видно, а пересчёт
       всех страниц на каждое движение ручки — это и был бы тормоз. */
    const thumbJobs = [];
    let queueOn = false;
    function runQueue() {
      if (queueOn || !thumbJobs.length) return;
      queueOn = true;
      setTimeout(() => {
        queueOn = false;
        const job = thumbJobs.shift();
        if (job) { try { job(); } catch (e) { console.warn(e); } }
        runQueue();
      }, 0);
    }
    function thumbImage(p) {
      const box = el('div', { class: 'scan-th-im' });
      const put = c => { box.innerHTML = ''; box.append(c); };
      const key = quadKey(p) + '|' + p.mode;
      if (p.thumb && p.thumbKey === key) { put(p.thumb); return box; }
      const ph = document.createElement('canvas');           // место под миниатюру, пока считаем
      ph.width = 64; ph.height = 90;
      const px = ph.getContext('2d'); px.fillStyle = '#f2f3f6'; px.fillRect(0, 0, 64, 90);
      put(ph);
      thumbJobs.push(() => {
        if (pages.indexOf(p) < 0 || !box.isConnected) return;
        if (p.thumb && p.thumbKey === key) { put(p.thumb); return; }
        const [w, h] = sheet(p, THUMB_DPI);
        const page = S.clean(S.warp(p.src, p.quad, w, h), p.mode, +strengthR.value / 100);
        p.thumb = fit(page, 64); p.thumbKey = key; put(p.thumb);
      });
      runQueue();
      return box;
    }

    /* — отрисовка предпросмотра — */
    function redraw() {
      empty.hidden = !!pages.length || stage.classList.contains('live');
      if (cur < 0 || !pages[cur]) { cv.width = cv.height = 0; edges.width = edges.height = 0; corners.forEach(h => h.hidden = true); return; }
      const p = pages[cur];
      // режим «как получится»: показываем готовую страницу без рамки и ручек
      if (viewSeg.value() === 'result') {
        const page = pageOf(p);
        // «Крупно» — страница один к одному, окошко прокручивается
        const res = zoomed ? page : fit(page, Math.round(((wrap.clientHeight - 24) || 430) * 0.72));
        cv.width = res.width; cv.height = res.height;
        cv.getContext('2d').drawImage(res, 0, 0);
        cv.style.width = ''; cv.style.height = '';
        wrap.classList.toggle('zoom', zoomed);
        zoomNote.hidden = !zoomed;
        edges.width = edges.height = 0;
        corners.forEach(h => h.hidden = true);
        trimCache();
        return;
      }
      wrap.classList.remove('zoom'); zoomNote.hidden = true;
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
          pages[cur].quad[i] = [x, y]; dropCache(pages[cur]); redraw();
        };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
    });

    /* — готовый лист для файла —
       Кэш предпросмотра тут намеренно не трогаем: при сохранении идёт цикл по всем
       страницам, и холст на каждую — это сотни мегабайт на ровном месте. */
    function render(p, dpi) {
      const [outW, outH] = sheet(p, dpi);
      return S.clean(S.warp(p.src, p.quad, outW, outH), p.mode, +strengthR.value / 100);
    }

    const toBlob = (c, mime, q) => new Promise(r => c.toBlob(r, mime, q));
    const docName = ext => 'Скан_' + pages.length + (pages.length === 1 ? '_страница' : '_страницы') + ext;
    const weight = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';

    async function buildPdf(Q) {
      const PL = window.PDFLib;
      const pdf = await PL.PDFDocument.create();
      for (const p of pages) {
        const c = render(p, Q.dpi);
        const blob = await toBlob(c, 'image/jpeg', Q.jpeg);
        const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const page = pdf.addPage([c.width / Q.dpi * 72, c.height / Q.dpi * 72]);
        page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      }
      const bytes = await pdf.save();
      return [{ blob: new Blob([bytes], { type: 'application/pdf' }), name: docName('.pdf') }];
    }

    async function buildImages(fmt, Q) {
      const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      const out = [];
      for (let i = 0; i < pages.length; i++) {
        const c = render(pages[i], Q.dpi);
        // у PNG сжатие без потерь — параметр качества там не нужен
        const blob = await toBlob(c, mime, fmt === 'png' ? undefined : Q.jpeg);
        out.push({ blob, name: 'Скан' + (pages.length > 1 ? '_стр' + (i + 1) : '') + '.' + fmt });
      }
      return out;
    }

    /* Word: каждая страница — картинка во весь лист А4 с полями 1,27 см */
    async function buildDocx(Q) {
      const dx = window.docx;
      if (!dx || !dx.Document) throw new Error('Модуль Word не загрузился');
      const MARGIN = 720;                                     // твипы = 1,27 см
      const maxW = A4[0] - 2 * 12.7, maxH = A4[1] - 2 * 12.7; // мм
      const children = [];
      for (let i = 0; i < pages.length; i++) {
        const c = render(pages[i], Q.dpi);
        const blob = await toBlob(c, 'image/jpeg', Q.jpeg);
        const data = new Uint8Array(await blob.arrayBuffer());
        const mmW = c.width / Q.dpi * MM, mmH = c.height / Q.dpi * MM;
        const k = Math.min(maxW / mmW, maxH / mmH, 1);        // вписываем лист в поля
        const px = mm => Math.max(1, Math.round(mm * k / MM * 96));
        if (i > 0) children.push(new dx.Paragraph({ children: [new dx.PageBreak()] }));
        children.push(new dx.Paragraph({
          spacing: { after: 0 },
          children: [new dx.ImageRun({ data, type: 'jpg', transformation: { width: px(mmW), height: px(mmH) } })]
        }));
      }
      const doc = new dx.Document({
        creator: 'Оттиск', title: 'Скан',
        sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } }, children }]
      });
      return [{ blob: await dx.Packer.toBlob(doc), name: docName('.docx') }];
    }

    async function finish(openHere) {
      if (!pages.length) { U.toast('Сначала снимите или выберите фото документа', true); return; }
      const Q = QUALITY[qualSeg.value()] || QUALITY.normal;
      // «Открыть в программе» — это подписание, а печати ставятся на PDF
      const fmt = openHere ? 'pdf' : fmtSeg.value();
      U.busy(fmt === 'docx' ? 'Собираю документ Word…' : fmt === 'pdf' ? 'Собираю PDF…' : 'Готовлю картинки…');
      try {
        const items = fmt === 'pdf' ? await buildPdf(Q) : fmt === 'docx' ? await buildDocx(Q) : await buildImages(fmt, Q);
        D.close(dlg);
        if (openHere) {
          await O.V.openFile(new File([items[0].blob], items[0].name, { type: 'application/pdf' }));
          U.toast('Скан открыт — можно ставить печать и подпись');
          return;
        }
        const saved = [];
        for (const it of items) {
          if (O.F && O.F.ready && O.F.ready()) saved.push(await O.F.saveOutput('signed', it.name, it.blob, it.blob.type));
          else { U.download(it.blob, it.name, it.blob.type); saved.push(it.name); }
        }
        const total = items.reduce((a, it) => a + it.blob.size, 0);
        U.toast((saved.length === 1 ? 'Сохранено: ' + saved[0] : 'Сохранено файлов: ' + saved.length) + ' · ' + weight(total));
      } catch (e) {
        console.error(e); U.toast('Не удалось сохранить: ' + (e && e.message || ''), true);
      } finally { U.busy(); trimCache(); }   // после цикла по страницам память не держим
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
