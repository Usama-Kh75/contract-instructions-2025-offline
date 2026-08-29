/* عامل الخدمة — يجعل النسخة المنشورة تعمل بلا إنترنت.
   مُولَّد من src/sw.js؛ لا تحرّر الملف في الجذر. */
'use strict';

const VERSION = '1.9';
const SHELL = 'shell-v' + VERSION;   // الصفحة وملحقاتها، تتغير مع كل إصدار
const PAGES = 'pages-v1';            // صور الصفحات، لا تتغير مع تغيّر البرنامج

// الهيكل وحده يُخزَّن تلقائياً — نحو ميغابايت واحد. أما صور الصفحات
// فـ31 ميغابايت، ولا تُنزَّل إلا بطلب صريح من القارئ.
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './app-icon.jpg'
];

// addAll هي عملية كلّية: يُسقط فشلُ ملفٍ واحد التخزينَ كلَّه فلا يُحفظ شيء.
// وذلك يقع فعلاً أثناء نشر GitHub، إذ يردّ ملفٌ 404 للحظة. نحفظ كلاً على
// حدة، فيبقى ما نجح ولا يجرّه الفاشل معه.
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(async f => {
      try {
        const res = await fetch(f, { cache: 'reload' });
        if (res.ok) await c.put(f, res);
      } catch (err) { /* يُعاد جلبه عند أول زيارة متصلة */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  // احذف هياكل الإصدارات السابقة، وأبقِ الصور: تنزيلها كلّف القارئ بياناته
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('shell-v') && k !== SHELL).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // صور الصفحات: من المخزن أولاً — فهي لا تتغير أبداً، وجلبها مرة يكفي
  if (/\/pages\/page-\d+\.jpg$/.test(url.pathname)) {
    e.respondWith(
      caches.open(PAGES).then(c =>
        c.match(req).then(hit => hit || fetch(req).then(res => {
          if (res.ok) c.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // الهيكل: من الشبكة أولاً حتى يصل التحديث، ومن المخزن إن انقطعت
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
