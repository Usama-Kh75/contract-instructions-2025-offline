/* عامل الخدمة — يجعل النسخة المنشورة تعمل بلا إنترنت.
   مُولَّد من src/sw.js؛ لا تحرّر الملف في الجذر. */
'use strict';

const VERSION = '@@VERSION@@';
const SHELL = 'shell-v' + VERSION;   // الصفحة وملحقاتها، تتغير مع كل إصدار
const PAGES = 'pages-v1';            // صور الصفحات، لا تتغير مع تغيّر البرنامج

// الهيكل وحده يُخزَّن تلقائياً — نحو ميغابايت واحد. أما صور الصفحات
// فـ31 ميغابايت، ولا تُنزَّل إلا بطلب صريح من القارئ.
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './app-icon.jpg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
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

const FONTS = 'fonts-v1';           // خطوط Google، لا تتغير لنفس الرابط
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // الخطوط: من المخزن أولاً، فلا ينتظر العرضُ Google عند كل فتح، وتبقى
  // الخطوط نفسها بلا إنترنت بدل خط النظام
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(FONTS).then(c =>
        c.match(req).then(hit => hit || fetch(req).then(res => {
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;
  // الصفحة تقرأ sw.js لتعرف إصدار العامل الجديد؛ يجب أن يأتي من الشبكة دائماً
  if (url.pathname.endsWith('/sw.js')) return;

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

  // الهيكل: من المخزن فوراً، ويُجلب الجديد في الخلفية لفتحةٍ لاحقة.
  // كان من الشبكة أولاً، فكان كل فتحٍ ينتظر تنزيل الصفحة كاملة (1.5 م.ب)
  // على اتصال ضعيف مع أنها محفوظة. الإصدار الجديد يُعلَن عنه في الصفحة
  // حين يتبدّل العامل، فلا يبقى القارئ على نسخة قديمة دون علمه.
  e.respondWith((async () => {
    const cached = await caches.match(req) ||
      (req.mode === 'navigate' ? await caches.match('./index.html') : undefined);
    const fresh = fetch(req).then(async res => {
      if (res.ok) {
        const copy = res.clone();
        const c = await caches.open(SHELL);
        await c.put(req, copy);
      }
      return res;
    });
    if (cached) {
      e.waitUntil(fresh.catch(() => { }));
      return cached;
    }
    return fresh.catch(() => caches.match('./index.html'));
  })());
});
