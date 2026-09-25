#!/usr/bin/env node
/*
 * اختبارات الواجهة: تفتح الدليل المبني (index.html) في Chrome بلا واجهة،
 * بحجم الحاسوب وبحجم الهاتف، وتتحقق من السلوك الذي يعتمد عليه الزملاء.
 *
 *   npm test                  يستعمل Chrome المثبّت على الجهاز
 *   CHROME_PATH=... npm test  لمسار آخر
 *
 * تعمل على نسخة file:// كما يفتحها من نزّل الملف، فلا تحتاج خادماً.
 * أي فشل يُنهي بالرمز 1، فيوقف النشر في GitHub Actions.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('لم يُعثر على Chrome — حدّد مساره في CHROME_PATH');
  return found;
}

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  ✔ ' + name); }
  else { failures++; console.log('  ✘ ' + name + (detail !== undefined ? '  ←  ' + JSON.stringify(detail) : '')); }
}

const DEVICES = [
  { name: 'حاسوب', phone: false, viewport: { width: 1400, height: 900 } },
  { name: 'هاتف', phone: true, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }
];

async function openPage(browser, dev, errors) {
  const pg = await browser.newPage();
  await pg.setViewport(dev.viewport);
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(URL, { waitUntil: 'load' });
  await sleep(1200);
  return pg;
}

const isActive = pg => pg.$eval('#lightboxModal', e => e.classList.contains('active'));
const chooseChapter = (pg, n) => pg.evaluate(n => [...document.querySelectorAll('.chapter-btn')]
  .find(b => b.dataset.kind === 'chapter' && b.dataset.number === String(n)).click(), n);

async function run(dev, browser) {
  console.log('\n— ' + dev.name + ' —');
  const errors = [];
  const pg = await openPage(browser, dev, errors);

  // شاشة الفصل
  check('العدّاد «صفحة 1 من 4»', await pg.$eval('#pageCount', e => e.textContent) === 'صفحة 1 من 4');
  check('صورة الصفحة زرّ حقيقي', await pg.$eval('#chapterImagePane', e => e.tagName === 'BUTTON' && !!e.getAttribute('aria-label')));
  check('فهرس الصفحة ' + (dev.phone ? 'مطويّ' : 'مفتوح'), await pg.$eval('#pageIndex', e => e.open) === !dev.phone);

  // نافذة العرض بلوحة المفاتيح
  await pg.focus('#chapterImagePane');
  await pg.keyboard.press('Enter');
  await sleep(900);
  check('Enter يفتح نافذة العرض', await isActive(pg));
  check('التركيز ينتقل إلى «إغلاق»', await pg.evaluate(() => document.activeElement.id) === 'lightboxCloseBtn');
  let escaped = 0;
  for (let i = 0; i < 10; i++) {
    await pg.keyboard.press('Tab');
    if (!(await pg.evaluate(() => lightboxModal.contains(document.activeElement)))) escaped++;
  }
  check('Tab يبقى داخل النافذة', escaped === 0, escaped);
  check('«تصغير» معطّل عند الحجم الأصلي', await pg.$eval('#zoomOutBtn', e => e.disabled));
  for (let i = 0; i < 6; i++) await pg.evaluate(() => { if (!zoomInBtn.disabled) zoomInBtn.click(); });
  check('«تكبير» يتعطّل عند 4×', await pg.evaluate(() => currentZoom === 4 && zoomInBtn.disabled));
  await pg.keyboard.press('0');
  const pt = await pg.$eval('#lightboxImg', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.25 }; });
  await pg.mouse.click(pt.x, pt.y, { clickCount: 1 });
  await pg.mouse.click(pt.x, pt.y, { clickCount: 2 });
  await sleep(200);
  check('النقر المزدوج يكبّر 2× ولا يغلق', await pg.evaluate(() => currentZoom) === 2 && await isActive(pg));
  if (!dev.phone) {
    await pg.keyboard.press('0');
    const before = await pg.$eval('#lightboxTitle', e => e.textContent);
    await pg.keyboard.press('ArrowLeft');
    await sleep(300);
    check('السهم الأيسر يقلّب إلى الصفحة التالية', await pg.$eval('#lightboxTitle', e => e.textContent) !== before);
  } else {
    check('أدوات الهاتف شريط سفلي ثابت', await pg.$eval('.lightbox-controls', e => getComputedStyle(e).position === 'fixed'));
  }
  await pg.keyboard.press('Escape');
  await sleep(300);
  check('Escape يغلق ويعيد التركيز', !(await isActive(pg)) && await pg.evaluate(() => document.activeElement.id) === 'chapterImagePane');

  // فهرس الصفحة: الفصل المختار أولاً والمجاور مطويّ
  await chooseChapter(pg, 7);
  await sleep(700);
  if (dev.phone) {
    const top = await pg.evaluate(() => document.querySelector('.chapter-info').getBoundingClientRect().top);
    check('اختيار فصل على الهاتف ينقل إليه', top > 0 && top < 300, top);
    await pg.evaluate(() => { pageIndexEl.open = true; });
  }
  const idx = await pg.evaluate(() => ({
    title: pageIndexTitle.textContent,
    arts: [...document.querySelectorAll('#pageIndexList > .pi-article')].map(x => x.textContent),
    fold: (document.querySelector('.pi-others') || {}).textContent || ''
  }));
  check('الفصل 7 يبدأ بالمادة (16)', idx.arts.join() === 'المادة (16)', idx);
  check('بنود الفصل 6 مطويّة في سطر', /من الفصل 6 في أعلى الصفحة/.test(idx.fold), idx.fold);

  // البند يُفتح في مكانه
  await pg.evaluate(() => document.querySelector('#pageIndexList > .pi-entry .pi-item').click());
  await sleep(400);
  check('البند يُفتح في مكانه دون شاشة البحث', await pg.evaluate(() =>
    !!document.querySelector('.pi-body:not([hidden]) .pi-text') && !document.getElementById('workspace').classList.contains('visible')));

  // فروع في الصفحة التالية
  await chooseChapter(pg, 3);
  await sleep(600);
  if (dev.phone) await pg.evaluate(() => { pageIndexEl.open = true; });
  await pg.evaluate(() => [...document.querySelectorAll('.pi-item')].find(x => x.textContent.includes('المناقصة المحدودة')).click());
  await sleep(300);
  const more = await pg.evaluate(() => (document.querySelector('.pi-body:not([hidden]) .pi-more') || {}).textContent || '');
  check('ملاحظة «فروع في الصفحة التالية»', /لهذا البند فروع في الصفحة التالية \(10\)/.test(more), more.slice(0, 80));
  await pg.evaluate(() => document.querySelector('.pi-body:not([hidden]) .pi-more .pi-link').click());
  await sleep(600);
  check('رابط الفرع يفتح «أولاً / أ» في الصفحة 10', await pg.evaluate(() =>
    document.getElementById('chapterPrinted').textContent === 'الصفحة المطبوعة 10' &&
    (document.querySelector('.pi-item[aria-expanded=true] .pi-num') || {}).textContent === 'أولاً / أ'));

  // البحث والزر العائم
  await pg.evaluate(() => performSearch('التأمينات الأولية'));
  await sleep(700);
  await pg.evaluate(() => window.scrollTo(0, 1500));
  await sleep(300);
  const hit = await pg.$eval('#indexButton', e => {
    const r = e.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hidden: e.hidden, inView: r.bottom <= innerHeight && r.top >= 0, onTop: !!t && e.contains(t) };
  });
  check('«قائمة الفصول» عائم ظاهر ولا يغطيه شيء', !hit.hidden && hit.inView && hit.onTop, hit);
  await pg.click('#indexButton');
  await sleep(500);
  check('«قائمة الفصول» يعيد إلى الفصول', await pg.$eval('#chapters', e => getComputedStyle(e).display) === 'block');

  // رابط البند: الإرسال
  const shared = await pg.evaluate(() => {
    const c = data.clauses.find(x => x.article === 'المادة (27)' && x.clause === 'أولاً / أ');
    let got = null;
    const real = navigator.share;
    navigator.share = d => { got = d; return Promise.resolve(); };
    shareClause(c);
    navigator.share = real;
    return { id: c.id, got, link: clauseLink(c) };
  });
  check('الرابط على الموقع المنشور وبحروف لاتينية', /^https:\/\/usama-kh75\.github\.io\/contract-instructions-2025-offline\/#c\/[\x21-\x7e]+$/.test(shared.link), shared.link);
  if (dev.phone) check('الهاتف يفتح قائمة المشاركة', !!shared.got && shared.got.url === shared.link, shared.got);
  else check('الحاسوب ينسخ ولا يفتح قائمة المشاركة', shared.got === null, shared.got);

  check('لا أخطاء في الصفحة', errors.length === 0, errors);
  await pg.close();

  // رابط البند: الفتح — صفحة جديدة كما يفتحها من استلم الرابط
  const errs2 = [];
  const pg2 = await browser.newPage();
  await pg2.setViewport(dev.viewport);
  pg2.on('pageerror', e => errs2.push(e.message));
  await pg2.goto(URL + '#c/' + encodeURIComponent(shared.id), { waitUntil: 'load' });
  await sleep(1200);
  const landed = await pg2.evaluate(() => ({
    page: document.getElementById('chapterPrinted').textContent,
    open: (document.querySelector('.pi-item[aria-expanded=true] .pi-num') || {}).textContent,
    title: (document.querySelector('.pi-item[aria-expanded=true] .pi-title') || {}).textContent,
    inView: (() => { const e = document.querySelector('.pi-item[aria-expanded=true]'); if (!e) return false; const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()
  }));
  check('الرابط يفتح البند نفسه في صفحته', landed.page === 'الصفحة المطبوعة 37' && landed.open === 'أولاً / أ', landed);
  check('البند المفتوح ظاهر في الشاشة', landed.inView, landed);
  // رابط آخر والدليل مفتوح
  const other = await pg2.evaluate(() => data.clauses.find(x => x.article === 'المادة (6)' && x.clause === 'أولاً').id);
  await pg2.evaluate(id => { location.hash = '#c/' + encodeURIComponent(id); }, other);
  await sleep(700);
  check('تغيير الرابط والدليل مفتوح ينتقل إليه', await pg2.evaluate(() =>
    (document.querySelector('.pi-item[aria-expanded=true] .pi-title') || {}).textContent === 'المناقصة المحدودة'));
  await pg2.evaluate(() => { location.hash = '#c/no-such-clause'; });
  await sleep(400);
  check('رابط لبند غير موجود ينبّه ولا يتعطّل', await pg2.$eval('#toastNotification', e => e.classList.contains('show') && /غير موجود/.test(e.textContent)));
  check('لا أخطاء عند الفتح من رابط', errs2.length === 0, errs2);
  await pg2.close();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  try {
    for (const dev of DEVICES) await run(dev, browser);
  } finally {
    await browser.close();
  }
  console.log('\n' + passes + ' نجح، ' + failures + ' فشل');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
