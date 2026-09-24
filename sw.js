/* Оттиск: работа без интернета. Все файлы программы кладутся в кэш при первом открытии. */
const VERSION = '9ee6f2133a80';
const CACHE = 'ottisk-' + VERSION;
const FILES = ["./", "index.html", "manifest.webmanifest", "app/css/app.css", "app/css/fonts.css", "app/data/OFL-рукописные-шрифты.txt", "app/data/cmaps.js", "app/data/fonts_hand.js", "app/data/fonts_pdf.js", "app/data/sample_pdf.js", "app/data/sample_stamp.js", "app/data/std_fonts.js", "app/fonts/jb-400-lat.woff2", "app/fonts/jb-400.woff2", "app/fonts/man-400-lat.woff2", "app/fonts/man-400.woff2", "app/fonts/man-500-lat.woff2", "app/fonts/man-500.woff2", "app/fonts/man-700-lat.woff2", "app/fonts/man-700.woff2", "app/fonts/one-400-lat.woff2", "app/fonts/one-400.woff2", "app/fonts/one-600-lat.woff2", "app/fonts/one-600.woff2", "app/icons/apple-touch-icon.png", "app/icons/icon-192.png", "app/icons/icon-512.png", "app/icons/icon-maskable-512.png", "app/js/app.js", "app/js/dialogs.js", "app/js/docx_export.js", "app/js/exporter.js", "app/js/folder.js", "app/js/imageproc.js", "app/js/journal.js", "app/js/library.js", "app/js/odt2pdf.js", "app/js/scan.js", "app/js/stampmaker.js", "app/js/storage.js", "app/js/util.js", "app/js/viewer.js", "app/js/word2pdf.js", "app/lib/docx-preview-shim.js", "app/lib/docx-preview.min.js", "app/lib/docx.umd.js", "app/lib/fontkit.umd.min.js", "app/lib/html2canvas.min.js", "app/lib/jszip.min.js", "app/lib/pdf-lib.min.js", "app/lib/pdf.min.js", "app/lib/pdf.worker.min.js", "app/lib/signature_pad.umd.min.js"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => k.startsWith('ottisk-') && k !== CACHE && k !== 'ottisk-share')
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // документ пришёл через «Поделиться» (Android): кладём во временный кэш и открываем программу
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData(); const f = form.get('file');
        if (f) {
          const c = await caches.open('ottisk-share');
          await c.put('shared-file', new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'документ.pdf') } }));
        }
      } catch (err) { /* откроем программу без файла */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).catch(() => caches.match('./index.html'))));
});
