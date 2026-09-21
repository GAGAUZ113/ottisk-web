/* Общие помощники. Всё в одном глобальном объекте Ottisk (без модулей — работает из file://). */
window.Ottisk = window.Ottisk || {};
(function (O) {
  'use strict';
  const U = {};

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  U.el = function (tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of [].concat(children)) if (c !== null && c !== undefined) e.append(c);
    return e;
  };
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.mm2pt = mm => mm * 72 / 25.4;
  U.pt2mm = pt => pt * 25.4 / 72;
  U.fmt = (v, d) => (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('ru-RU');
  U.debounce = function (fn, ms) { let t; return function () { clearTimeout(t); const a = arguments, s = this; t = setTimeout(() => fn.apply(s, a), ms); }; };
  U.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* base64 <-> байты */
  U.b64ToU8 = function (b64) {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  U.u8ToB64 = function (u8) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  };
  U.dataUrlToU8 = d => U.b64ToU8(d.slice(d.indexOf(',') + 1));
  U.blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  U.fileToU8 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = rej; r.readAsArrayBuffer(file); });
  U.loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Не удалось прочитать картинку')); im.src = src; });

  /* Скачивание файла через Blob (работает из file://) */
  U.download = function (data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: filename });
    document.body.append(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  };

  /* CRC32 для PNG-чанков */
  const crcTable = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  U.crc32 = function (u8, start, end) {
    let c = 0xFFFFFFFF; start = start || 0; end = end === undefined ? u8.length : end;
    for (let i = start; i < end; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  /* Вставить/заменить чанк pHYs, чтобы Word вставлял картинку в точном размере (мм) */
  U.pngWithPhysicalSize = function (pngU8, widthMm) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (pngU8[i] !== sig[i]) throw new Error('Это не PNG');
    const dv = new DataView(pngU8.buffer, pngU8.byteOffset, pngU8.byteLength);
    const width = dv.getUint32(16); // из IHDR
    const ppm = Math.round(width / (widthMm / 1000));
    // собрать чанки, выкинув старый pHYs
    const parts = []; let p = 8; let ihdrEnd = 0;
    while (p < pngU8.length) {
      const len = dv.getUint32(p); const type = String.fromCharCode(pngU8[p + 4], pngU8[p + 5], pngU8[p + 6], pngU8[p + 7]);
      const chunk = pngU8.subarray(p, p + 12 + len);
      if (type !== 'pHYs') parts.push(chunk);
      if (type === 'IHDR') ihdrEnd = parts.length;
      p += 12 + len;
    }
    const phys = new Uint8Array(21); const pv = new DataView(phys.buffer);
    pv.setUint32(0, 9); phys.set([112, 72, 89, 115], 4); pv.setUint32(8, ppm); pv.setUint32(12, ppm); phys[16] = 1;
    pv.setUint32(17, U.crc32(phys, 4, 17));
    parts.splice(ihdrEnd, 0, phys);
    let total = 8; for (const c of parts) total += c.length;
    const out = new Uint8Array(total); out.set(sig, 0); let o = 8;
    for (const c of parts) { out.set(c, o); o += c.length; }
    return out;
  };

  /* Тост-сообщение внизу */
  let toastT;
  U.toast = function (msg, isErr) {
    const t = U.$('#toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { if (!t.classList.contains('show')) t.textContent = ''; }, 250); }, isErr ? 6000 : 3200);
  };

  /* Индикатор занятости */
  U.busy = function (msg) {
    let b = U.$('#busy');
    if (!msg) { if (b) b.remove(); return; }
    if (!b) { b = U.el('div', { id: 'busy', class: 'busy' }); document.body.append(b); }
    b.textContent = msg;
  };

  U.dateStr = d => { d = d || new Date(); const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  U.stripExt = n => n.replace(/\.[^.]+$/, '');

  O.U = U;
})(window.Ottisk);
