/* عامل الخدمة — يجعل النسخة المنشورة تعمل بلا إنترنت.
   مُولَّد من src/sw.js؛ لا تحرّر الملف في الجذر. */
'use strict';

const VERSION = '1.19';
// المخازن مشتركة بين كل مشاريع النطاق usama-kh75.github.io؛ بلا بادئة خاصة
// قد يحذف هذا العامل هيكلَ تطبيقٍ آخر على النطاق نفسه أو يخلط صوره بصوره
const APP = 'cic2025';
const SHELL = APP + '-shell-v' + VERSION;   // الصفحة وملحقاتها، تتغير مع كل إصدار
const PAGES = APP + '-pages-v1';            // صور الصفحات، لا تتغير مع تغيّر البرنامج
const FONTS = APP + '-fonts-v1';            // خطوط Google، لا تتغير لنفس الرابط

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
// لكن الصفحة نفسها شرطٌ لا يُتسامح فيه: عاملٌ جديد يُفعَّل بلا صفحته يحذف
// هيكل الإصدار السابق الكامل (انظر activate) فلا يفتح الدليل بلا إنترنت.
// ويجب أن تكون الصفحة من الإصدار نفسه: أثناء النشر قد يصل sw.js الجديد
// والصفحة القديمة، فيُعلن الإصدار الجديد ولا يأتي به التحديث أبداً.
// فشلُ التثبيت هنا يُبقي العامل القديم وهيكله، ويعيد المتصفح المحاولة لاحقاً.
// و«./» و«./index.html» الصفحة نفسها (1.5 م.ب): تُنزَّل مرة وتُحفظ بالاسمين،
// وكانت تُنزَّل مرتين فيطول التثبيت الأول ويُثقل على بيانات الهاتف.
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    const page = await fetch('./index.html', { cache: 'reload' });
    if (!page.ok) throw new Error('page unavailable');
    const body = await page.clone().text();
    if (!body.includes('"version": "' + VERSION + '"')) throw new Error('page is not version ' + VERSION);
    await c.put('./index.html', page.clone());
    await c.put('./', page);
    // أيقونة تعذّر جلبها تُؤخذ من هيكل الإصدار السابق (ما زال موجوداً حتى
    // activate) بدل أن تضيع معه حين يُحذف
    await Promise.all(SHELL_FILES.filter(f => f !== './' && f !== './index.html').map(async f => {
      let res = null;
      try { res = await fetch(f, { cache: 'reload' }); } catch (err) { }
      if (!res || !res.ok) res = await caches.match(f);
      if (res) await c.put(f, res);
    }));
    await self.skipWaiting();
  })());
});

// الصفحة تسأل العامل الذي يخدمها عن إصداره لتعرف إن كان أحدث منها
self.addEventListener('message', e => {
  if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION);
});

// المخزن القديم بلا بادئة يُعدّ لنا فقط إن كانت كل مداخله داخل نطاقنا
async function ownedLegacy(name) {
  const c = await caches.open(name);
  const keys = await c.keys();
  return { c, keys, ours: keys.every(r => r.url.startsWith(self.registration.scope)) };
}

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // احذف هياكلنا السابقة، وأبقِ الصور: تنزيلها كلّف القارئ بياناته
    await Promise.all(keys.filter(k => k.startsWith(APP + '-shell-v') && k !== SHELL).map(k => caches.delete(k)));
    // الأسماء القديمة بلا بادئة: تُنقل الصور المحفوظة إلى الاسم الجديد بدل
    // أن يُطلب من القارئ تنزيل 31 م.ب من جديد، ثم يُحذف القديم إن كان لنا وحدنا
    for (const k of keys) {
      if (k.startsWith('shell-v')) {
        const { ours } = await ownedLegacy(k);
        if (ours) await caches.delete(k);
      } else if (k === 'pages-v1') {
        const { c, keys: reqs, ours } = await ownedLegacy(k);
        const dest = await caches.open(PAGES);
        for (const r of reqs) {
          if (!r.url.startsWith(self.registration.scope)) continue;
          if (await dest.match(r)) continue;
          const res = await c.match(r);
          if (res) await dest.put(r, res);
        }
        if (ours) await caches.delete(k);
      }
    }
    await self.clients.claim();
  })());
});

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// من المخزن أولاً، وإلا من الشبكة مع حفظ نسخة. الحفظ داخل waitUntil: بدونه
// قد يُوقَف العامل بعد تسليم الرد وقبل اكتمال الكتابة، فلا يُحفظ شيء
async function cacheFirst(e, name, keep) {
  const c = await caches.open(name);
  const hit = await c.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (keep(res)) e.waitUntil(c.put(e.request, res.clone()).catch(() => { }));
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // الخطوط: من المخزن أولاً، فلا ينتظر العرضُ Google عند كل فتح، وتبقى
  // الخطوط نفسها بلا إنترنت بدل خط النظام
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(e, FONTS, res => res.ok || res.type === 'opaque'));
    return;
  }

  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  // طلبٌ صريح لنسخة جديدة (كزر «نزّل نسخة الملف») يذهب إلى الشبكة كما طلب،
  // وإلا حفظ القارئُ نسخةً قديمة من المخزن وهو متصل
  if (req.cache === 'no-store' || req.cache === 'reload') return;

  // صور الصفحات: من المخزن أولاً — فهي لا تتغير أبداً، وجلبها مرة يكفي
  if (/\/pages\/page-\d+\.jpg$/.test(url.pathname)) {
    e.respondWith(cacheFirst(e, PAGES, res => res.ok));
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
    // الصفحة بديلٌ لفتح الدليل فقط؛ لملفٍ آخر (أيقونة، manifest) تُعيد
    // الصفحةَ بحالة 200 فيُقرأ HTML على أنه صورة أو JSON
    return fresh.catch(async () =>
      (req.mode === 'navigate' && await caches.match('./index.html')) || Response.error());
  })());
});
