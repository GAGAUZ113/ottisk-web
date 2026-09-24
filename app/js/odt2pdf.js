/* LibreOffice / OpenOffice (.odt) → PDF прямо в программе, без интернета.
   Внутри .odt — обычный zip: content.xml с текстом и styles.xml с оформлением.
   Разбираем их, раскладываем документ на лист нужного размера и снимаем теми же
   средствами, что и Word (W.rasterize). Текст в готовом PDF становится картинкой.
   Самое точное качество даёт сам LibreOffice: Файл → Экспорт в PDF. */
(function (O) {
  'use strict';
  const U = O.U; const Z = {};
  const NS = {
    office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
    text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
    style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
    fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
    table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
    draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
    xlink: 'http://www.w3.org/1999/xlink'
  };

  Z.supported = () => !!(window.JSZip && window.html2canvas && O.W && O.W.rasterize);

  const attr = (el, ns, n) => el.getAttributeNS(NS[ns], n);
  const kids = (el, ns, n) => Array.from(el.getElementsByTagNameNS(NS[ns], n));

  /* Длина ODF («2.54cm», «12pt», «0.5in») → пиксели экрана (96 dpi) */
  function len(v) {
    if (!v) return null;
    const m = String(v).match(/^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]), u = m[2] || 'px';
    const k = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, px: 1 }[u];
    return n * k;
  }

  /* Оформление абзацев и кусков текста: style:style → готовый CSS */
  function collectStyles(docs) {
    const map = {};
    docs.forEach(doc => {
      if (!doc) return;
      kids(doc.documentElement, 'style', 'style').forEach(st => {
        const name = attr(st, 'style', 'name'); if (!name) return;
        const css = {}; const parent = attr(st, 'style', 'parent-style-name');
        const pp = st.getElementsByTagNameNS(NS.style, 'paragraph-properties')[0];
        const tp = st.getElementsByTagNameNS(NS.style, 'text-properties')[0];
        if (pp) {
          const al = attr(pp, 'fo', 'text-align');
          if (al) css['text-align'] = { start: 'left', end: 'right', center: 'center', justify: 'justify', left: 'left', right: 'right' }[al] || al;
          ['margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'text-indent', 'line-height'].forEach(k => {
            const v = attr(pp, 'fo', k); const px = len(v);
            if (px !== null) css[k] = px + 'px';
            else if (v && k === 'line-height' && /%$/.test(v)) css[k] = v;
          });
        }
        if (tp) {
          const fs = len(attr(tp, 'fo', 'font-size')); if (fs) css['font-size'] = fs + 'px';
          const fw = attr(tp, 'fo', 'font-weight'); if (fw) css['font-weight'] = fw;
          const fst = attr(tp, 'fo', 'font-style'); if (fst) css['font-style'] = fst;
          const col = attr(tp, 'fo', 'color'); if (col) css.color = col;
          const und = attr(tp, 'style', 'text-underline-style');
          if (und && und !== 'none') css['text-decoration'] = 'underline';
          const fam = attr(tp, 'style', 'font-name') || attr(tp, 'fo', 'font-family');
          if (fam) css['font-family'] = '"' + String(fam).replace(/"/g, '') + '", LibSerif, "Times New Roman", serif';
        }
        map[name] = { css, parent };
      });
    });
    return map;
  }
  function cssOf(map, name, seen) {
    const st = map[name]; if (!st) return {};
    seen = seen || {}; if (seen[name]) return {}; seen[name] = 1;
    return Object.assign({}, st.parent ? cssOf(map, st.parent, seen) : {}, st.css);
  }
  const toStyle = css => Object.keys(css).map(k => k + ':' + css[k]).join(';');

  /* Текст абзаца: жирный/курсив, переносы, табы, пробелы */
  function inline(node, map, out) {
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out.append(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      const ln = n.localName;
      if (ln === 'span') {
        const sp = U.el('span');
        const css = cssOf(map, attr(n, 'text', 'style-name'));
        if (Object.keys(css).length) sp.setAttribute('style', toStyle(css));
        inline(n, map, sp); out.append(sp);
      } else if (ln === 'line-break') out.append(U.el('br'));
      else if (ln === 'tab') out.append(document.createTextNode('    '));
      else if (ln === 's') {
        const c = +attr(n, 'text', 'c') || 1;
        out.append(document.createTextNode(' '.repeat(c)));
      } else if (ln === 'a') { const a = U.el('span'); inline(n, map, a); out.append(a); }
      else if (ln === 'frame' || ln === 'image') { /* картинки пропускаем: печать ставится на текст */ }
      else inline(n, map, out);
    });
  }

  function paragraph(n, map, tag) {
    const p = U.el(tag || 'p');
    const css = cssOf(map, attr(n, 'text', 'style-name'));
    p.setAttribute('style', toStyle(Object.assign({ margin: '0 0 .35em' }, css)));
    inline(n, map, p);
    if (!p.textContent.trim() && !p.querySelector('br')) p.append(U.el('br'));
    return p;
  }

  function block(n, map, host) {
    const ln = n.localName;
    if (ln === 'p') host.append(paragraph(n, map));
    else if (ln === 'h') host.append(paragraph(n, map, 'p'));
    else if (ln === 'list') {
      const ul = U.el('ul', { style: 'margin:0 0 .4em;padding-left:22px' });
      kids(n, 'text', 'list-item').forEach(li => {
        const item = U.el('li');
        Array.from(li.children).forEach(c => block(c, map, item));
        ul.append(item);
      });
      host.append(ul);
    } else if (ln === 'table') {
      const t = U.el('table', { style: 'border-collapse:collapse;width:100%;margin:0 0 .5em' });
      kids(n, 'table', 'table-row').forEach(r => {
        const tr = U.el('tr');
        kids(r, 'table', 'table-cell').forEach(c => {
          const td = U.el('td', { style: 'border:1px solid #666;padding:3px 6px;vertical-align:top' });
          const span = +attr(c, 'table', 'number-columns-spanned'); if (span > 1) td.setAttribute('colspan', span);
          Array.from(c.children).forEach(x => block(x, map, td));
          tr.append(td);
        });
        t.append(tr);
      });
      host.append(t);
    } else if (ln === 'section' || ln === 'soft-page-break') {
      Array.from(n.children).forEach(c => block(c, map, host));
    }
  }

  /* Размер листа и поля из styles.xml (берём первую раскладку — она же обычно и единственная) */
  function pageSetup(stylesDoc) {
    const def = { w: 210 * 96 / 25.4, h: 297 * 96 / 25.4, mt: 20 * 96 / 25.4, mr: 15 * 96 / 25.4, mb: 20 * 96 / 25.4, ml: 20 * 96 / 25.4 };
    if (!stylesDoc) return def;
    const pl = stylesDoc.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0];
    if (!pl) return def;
    const g = (ns, n, d) => { const v = len(attr(pl, ns, n)); return v === null ? d : v; };
    const land = attr(pl, 'style', 'print-orientation') === 'landscape';
    let w = g('fo', 'page-width', def.w), h = g('fo', 'page-height', def.h);
    if (land && w < h) { const t = w; w = h; h = t; }
    return { w, h, mt: g('fo', 'margin-top', def.mt), mr: g('fo', 'margin-right', def.mr), mb: g('fo', 'margin-bottom', def.mb), ml: g('fo', 'margin-left', def.ml) };
  }

  Z.convert = async function (file) {
    if (!Z.supported()) throw new Error('Модуль LibreOffice не загрузился');
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const contentFile = zip.file('content.xml');
    if (!contentFile) throw new Error('Это не документ LibreOffice');
    const parser = new DOMParser();
    const content = parser.parseFromString(await contentFile.async('string'), 'application/xml');
    const stylesFile = zip.file('styles.xml');
    const styles = stylesFile ? parser.parseFromString(await stylesFile.async('string'), 'application/xml') : null;
    if (content.getElementsByTagName('parsererror').length) throw new Error('Файл повреждён');

    const map = collectStyles([styles, content]);
    const body = content.getElementsByTagNameNS(NS.office, 'text')[0];
    if (!body) throw new Error('В файле не нашлось текста');
    const pg = pageSetup(styles);

    const host = U.el('div', { class: 'docx-host', 'aria-hidden': 'true' });
    const sheet = U.el('section', { class: 'docx' });
    sheet.setAttribute('style',
      'box-sizing:border-box;background:#fff;color:#000;width:' + Math.round(pg.w) + 'px;min-height:' + Math.round(pg.h) + 'px;' +
      'padding:' + Math.round(pg.mt) + 'px ' + Math.round(pg.mr) + 'px ' + Math.round(pg.mb) + 'px ' + Math.round(pg.ml) + 'px;' +
      'font:16px/1.35 LibSerif,"Times New Roman",serif');
    Array.from(body.children).forEach(n => block(n, map, sheet));
    host.append(sheet);
    document.body.append(host);
    try {
      try { await document.fonts.ready; } catch (e) {}
      await new Promise(r => setTimeout(r, 60));
      return await O.W.rasterize([sheet], file.name);
    } finally { host.remove(); }
  };

  O.Z = Z;
})(window.Ottisk);
