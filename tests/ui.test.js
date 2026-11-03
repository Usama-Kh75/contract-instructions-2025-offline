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
  // الفصل 1: الصفحات 7–10 ومعها تكملته في الصفحة 11 حيث يبدأ الفصل 2
  check('العدّاد «صفحة 1 من 5»', await pg.$eval('#pageCount', e => e.textContent) === 'صفحة 1 من 5');
  check('صورة الصفحة زرّ حقيقي', await pg.$eval('#chapterImagePane', e => e.tagName === 'BUTTON' && !!e.getAttribute('aria-label')));
  check('فهرس الصفحة ' + (dev.phone ? 'مطويّ' : 'مفتوح'), await pg.$eval('#pageIndex', e => e.open) === !dev.phone);

  // نافذة العرض بلوحة المفاتيح
  await pg.focus('#chapterImagePane');
  await pg.keyboard.press('Enter');
  await sleep(900);
  check('Enter يفتح نافذة العرض', await isActive(pg));
  const head1 = await pg.evaluate(() => ({ ref: lightboxRef.textContent, sub: lightboxSub.textContent }));
  check('رأس النافذة «الفصل 1 › المادة (1)» ثم العنوان والصفحة',
    head1.ref === 'الفصل 1 › المادة (1)' && head1.sub === 'التعاريف والسريان · الصفحة المطبوعة 1', head1);
  // ‹ و› تنعكسان داخل النص العربي إن لم تُعزلا، فتشير «التالية» إلى اليمين
  const icons = await pg.evaluate(() => ['#lbNextBtn .lb-icon', '#lbPrevBtn .lb-icon', '#nextPage .pg-icon', '#prevPage .pg-icon']
    .map(s => { const e = document.querySelector(s), st = getComputedStyle(e); return e.textContent + (st.direction === 'ltr' && st.unicodeBidi === 'isolate' ? '' : '!'); }).join(''));
  check('سهم «التالية» يشير يساراً و«السابقة» يميناً', icons === '‹›‹›', icons);
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
    folds: document.querySelectorAll('#pageIndexList > .pi-others, #pageIndexList .pi-fold').length
  }));
  check('الفصل 7 يبدأ بالمادة (16)', idx.arts.join() === 'المادة (16)', idx);
  check('بنود الفصل 6 لا تظهر مع الفصل 7', idx.folds === 0, idx);

  // الفصل 15 يبدأ آخر الصفحة 37 ويستمر في 38؛ وآخر صفحاته بلا تنبيه
  const state = () => pg.evaluate(() => ({
    ch: document.getElementById('chapterNumber').textContent,
    page: chapterPage,
    arts: [...document.querySelectorAll('#pageIndexList > .pi-article')].map(x => x.textContent),
    nums: [...document.querySelectorAll('#pageIndexList .pi-num')].map(x => x.textContent),
    cont: [...document.querySelectorAll('#pageIndexList > .pi-continues')].map(x => x.textContent)
  }));
  await chooseChapter(pg, 15);
  await sleep(600);
  let s = await state();
  check('«يستمر الفصل 15 في الصفحة التالية (38)»', s.cont.length === 1 && s.cont[0].includes('يستمر الفصل 15 في الصفحة التالية (38)'), s.cont);
  check('الصفحة 37 مع الفصل 15: المادة (27) وحدها', s.arts.join() === 'المادة (27)', s.arts);
  await pg.evaluate(() => document.getElementById('chapterImagePane').click());
  await sleep(400);
  const head15 = await pg.evaluate(() => ({ ref: lightboxRef.textContent, sub: lightboxSub.textContent }));
  check('رأس النافذة «الفصل 15 › المادة (27)»',
    head15.ref === 'الفصل 15 › المادة (27)' && head15.sub === 'التأمينات والغرامات التأخيرية · الصفحة المطبوعة 37', head15);
  await pg.keyboard.press('Escape');
  await sleep(300);
  // من بند: مسار الإحالة كاملاً
  const headClause = await pg.evaluate(async () => {
    const c = data.clauses.find(x => x.title === 'الكفاءة المالية (التجهيز)');
    renderSource(c);
    [...document.querySelectorAll('#sourcePage a')].find(a => a.textContent.includes('تكبير')).click();
    await new Promise(r => setTimeout(r, 300));
    return { ref: lightboxRef.textContent, sub: lightboxSub.textContent };
  });
  check('رأس النافذة من بند «ضوابط رقم (5) › ثالثا › 1 › ب»',
    headClause.ref === 'ضوابط رقم (5) › ثالثا › 1 › ب' && headClause.sub === 'الكفاءة المالية (التجهيز) · الصفحة المطبوعة 83', headClause);
  await pg.keyboard.press('Escape');
  await sleep(300);
  await pg.evaluate(() => showChapters());
  await chooseChapter(pg, 15);
  await sleep(500);
  const last15 = await pg.evaluate(() => sectionEnd('chapter', currentSection()));
  await pg.evaluate(p => { chapterPage = p; renderChapter(); }, last15);
  await sleep(300);
  check('لا تنبيه في آخر صفحة من الفصل', (await state()).cont.length === 0);

  // «ثالثاً» من الفصل 14 في الصفحة 37: يظهر مع الفصل 14، والتالية تنتقل إلى الفصل 15 في الصفحة نفسها
  await chooseChapter(pg, 14);
  await sleep(500);
  await pg.evaluate(() => { stepPage(1); stepPage(1); });
  s = await state();
  check('الفصل 14 يستمر إلى الصفحة 37', s.cont.some(x => x.includes('الصفحة التالية (37)')), s);
  await pg.evaluate(() => stepPage(1));
  s = await state();
  check('الصفحة 37 مع الفصل 14: بنوده الأربعة وحدها', s.ch === 'الفصل 14' && s.arts.join() === 'المادة (26)' && s.nums.length === 4 && s.nums[3] === 'ثالثاً' && s.cont.length === 0, s);
  const p37 = s.page;
  await pg.evaluate(() => stepPage(1));
  s = await state();
  check('«التالية» تنتقل إلى الفصل 15 في الصفحة نفسها', s.ch === 'الفصل 15' && s.page === p37 && s.arts.join() === 'المادة (27)', s);
  await pg.evaluate(() => stepPage(-1));
  s = await state();
  check('«السابقة» تعود إلى الفصل 14 في الصفحة نفسها', s.ch === 'الفصل 14' && s.page === p37, s);
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
  // الكفاءة المالية (السيولة بكتاب مصرف) معيار غير الحسابات الختامية (أرباح ثلاث سنوات)
  const fin = await pg.evaluate(async () => {
    performSearch('الكفاءة المالية');
    await new Promise(r => setTimeout(r, 500));
    const ids = [...document.querySelectorAll('.result-card')].map(b => b.dataset.id);
    const want = data.clauses.find(x => x.title === 'الكفاءة المالية (التجهيز)').id;
    return { n: ids.length, finalAccounts: ids.includes('a4-completion-final-accounts'), capacity: ids.includes(want) };
  });
  check('بحث «الكفاءة المالية» لا يُظهر «الحسابات الختامية المصدقة»', fin.n > 0 && fin.capacity && !fin.finalAccounts, fin);
  // «عطاء مشروط»: المبني على تخفيض من عطاءات أخرى، والمتضمّن تحفظات — كلاهما
  const cond = await pg.evaluate(async () => {
    performSearch('عطاء مشروط');
    await new Promise(r => setTimeout(r, 500));
    const ids = [...document.querySelectorAll('.result-card')].map(b => b.dataset.id);
    return { discount: ids.includes('a4-minutes-conditional-discount-bids'), reservations: ids.includes('a4-minutes-reservations-and-notes') };
  });
  check('بحث «عطاء مشروط» يُظهر التخفيض المشروط والتحفظات معاً', cond.discount && cond.reservations, cond);
  // «السيولة» كلمة القارئ، و«الكفاءة المالية» لفظ الجداول: شرح معادلة الأشغال
  // يسمّيها سيولة فتظهر مباشرة، ونسب غير الاستشارية لا تحملها فتُقترح ولا تُضاف دون ضغطه
  const liq = await pg.evaluate(async () => {
    performSearch('السيولة');
    await new Promise(r => setTimeout(r, 500));
    const ids = () => [...document.querySelectorAll('.result-card')].map(b => b.dataset.id);
    const before = ids();
    const add = [...document.querySelectorAll('.concept-bar button')].find(b => b.textContent.includes('أضِف'));
    if (add) add.click();
    await new Promise(r => setTimeout(r, 300));
    const after = ids();
    return {
      entity: before.includes('a2-authority-10-percent-operating'),
      works: before.includes('a5-t1-fin-small'),
      hidden: !before.includes('a5-t3-fin-small'),
      offered: !!add,
      services: after.includes('a5-t3-fin-small')
    };
  });
  check('بحث «السيولة» يُظهر معادلة الأشغال، ويقترح نسب غير الاستشارية ولا يضيفها بلا ضغط',
    liq.entity && liq.hidden && liq.offered && liq.works && liq.services, liq);

  // «العطاء الموزون» لفظ الميدان ولا يرد في النص: كلمة مفتاحية على ضوابط (4) سادساً / 5،
  // فتظهر مباشرة بلا ضغط بصيغها كلها، وتحمل وسماً يقول إن اللفظ مفهومي لا حرفي،
  // ويقول الشريط الأمر نفسه ويقترح بنود جدول الكميات المسعّر
  const wtd = await pg.evaluate(async () => {
    const out = {};
    const ids = () => [...document.querySelectorAll('.result-card')].map(b => b.dataset.id);
    for (const t of ['العطاء الموزون', 'عطاء موزون', 'العرض الموزون', 'عرض موزون', 'موزون']) {
      performSearch(t);
      await new Promise(r => setTimeout(r, 500));
      out[t] = ids().includes('a4-exclusion-20-percent-unbalanced');
    }
    performSearch('العطاء الموزون');
    await new Promise(r => setTimeout(r, 500));
    const card = document.querySelector('.result-card[data-id="a4-exclusion-20-percent-unbalanced"]');
    out.tag = !!card && !!card.querySelector('.via-concept');
    out.notice = (document.querySelector('.concept-bar') || {}).textContent?.includes('لا يرد حرفياً في التعليمات') || false;
    for (const t of ['الأسعار الموزونة', 'العطاءات الموزونة']) {
      performSearch(t);
      await new Promise(r => setTimeout(r, 500));
      const before = ids();
      const add = [...document.querySelectorAll('.concept-bar button')].find(b => b.textContent.includes('أضِف'));
      if (add) add.click();
      await new Promise(r => setTimeout(r, 300));
      out['via ' + t] = before.length === 0 && !!add && ids().includes('a4-exclusion-20-percent-unbalanced');
    }
    return out;
  });
  check('«العطاء الموزون» بصيغه كلها يُظهر سادساً / 5 مباشرة موسوماً بأنه مفهومي، والجمع والأسعار تصل إليه بالاقتراح',
    wtd['العطاء الموزون'] && wtd['عطاء موزون'] && wtd['العرض الموزون'] && wtd['عرض موزون'] && wtd['موزون'] &&
    wtd.tag && wtd.notice && wtd['via الأسعار الموزونة'] && wtd['via العطاءات الموزونة'], wtd);

  // الوسم لا يدّعي أن العبارة غير واردة في التعليمات إلا إذا لم يقلها أي بند بنصه:
  // «الموازنة الاستثمارية» ترد نصاً في بنود، فبند كلماته المفتاحية وحدها يُوسم بالصيغة الأضيق
  const narrow = await pg.evaluate(async () => {
    performSearch('الموازنة الاستثمارية');
    await new Promise(r => setTimeout(r, 500));
    const tags = [...document.querySelectorAll('.via-concept')].map(e => e.textContent);
    return { n: tags.length, allNarrow: tags.every(t => t.startsWith('مطابقة عبر الكلمات المفتاحية')), noClaim: !tags.some(t => t.includes('لا يرد حرفياً')) };
  });
  check('وسم الكلمات المفتاحية لا يدّعي غياب العبارة عن التعليمات وهي واردة في بند آخر',
    narrow.n > 0 && narrow.allNarrow && narrow.noClaim, narrow);

  // المفهوم يُعلن فوق النتائج لا تحتها (كان يختفي تحت ست بطاقات لـ«المبلغ التخميني»)،
  // وألفاظ المستند وألفاظ الميدان في صفّين منفصلين، وكل لفظ زر يبحث به
  const top = await pg.evaluate(async () => {
    performSearch('المبلغ التخميني');
    await new Promise(r => setTimeout(r, 500));
    const list = document.getElementById('resultList');
    const first = list.firstElementChild;
    const strip = list.querySelector('.concept-top');
    const doc = strip ? [...strip.querySelectorAll('.concept-chip:not(.concept-chip-field)')].map(b => b.textContent) : [];
    const field = strip ? [...strip.querySelectorAll('.concept-chip-field')].map(b => b.textContent) : [];
    const chip = strip && strip.querySelector('.concept-chip');
    if (chip) chip.click();
    await new Promise(r => setTimeout(r, 500));
    const chipSearched = chip ? document.getElementById('searchInput').value === chip.textContent.replace(/ \(\d+\)$/, '') : false;
    performSearch('العطاء الموزون');
    await new Promise(r => setTimeout(r, 500));
    const wfield = [...document.querySelectorAll('.concept-top .concept-chip-field')].map(b => b.textContent);
    const wdoc = [...document.querySelectorAll('.concept-top .concept-chip:not(.concept-chip-field)')].map(b => b.textContent);
    return {
      firstIsStrip: !!first && first.classList.contains('concept-top'),
      docHasCost: doc.some(t => t.startsWith('الكلفة التخمينية')),
      noOwnChip: !doc.concat(field).some(t => t.startsWith('المبلغ التخميني')),
      chipSearched,
      weightedOfferIsField: wfield.some(t => t.startsWith('العرض الموزون')) && !wdoc.some(t => t.startsWith('العرض الموزون'))
    };
  });
  check('شريط المفهوم فوق النتائج، يفصل ألفاظ المستند عن ألفاظ الميدان، وكل لفظ يبحث بضغطة',
    Object.values(top).every(Boolean), top);

  // مراجعة Antigravity: لا تنبيه «لا يرد حرفياً» لعبارة تسمّي لفظاً رسمياً، ولا بلا «ال»؛
  // والوسم بإطار متقطع فعلاً؛ ورقم البند المضاف في لوحة السند هو رقم بطاقته لا «00»
  const rev = await pg.evaluate(async () => {
    const warn = async t => {
      performSearch(t); await new Promise(r => setTimeout(r, 500));
      return !!document.querySelector('.concept-top .concept-warn');
    };
    const out = {
      officialPhrase: !(await warn('شروط خطاب الضمان')),
      noAl: !(await warn('كلفة تخمينية')),
      fieldTerm: await warn('العطاء الموزون')
    };
    const tag = document.querySelector('.via-concept');
    out.dashed = !!tag && getComputedStyle(tag).borderTopStyle === 'dashed';
    performSearch('المبلغ التخميني'); await new Promise(r => setTimeout(r, 500));
    const add = [...document.querySelectorAll('.concept-bar button')].find(b => b.textContent.includes('أضِف'));
    if (add) add.click();
    await new Promise(r => setTimeout(r, 400));
    const extra = document.querySelector('.concept-divider ~ .result-card');
    if (extra) extra.click();
    await new Promise(r => setTimeout(r, 300));
    const marker = document.querySelector('.marker strong');
    out.number = !!extra && !!marker && marker.textContent === extra.querySelector('.idx').textContent && marker.textContent !== '00';
    return out;
  });
  check('التنبيه المفاهيمي لا يصيب الألفاظ الرسمية، والوسم متقطع، ورقم البند المضاف صحيح',
    Object.values(rev).every(Boolean), rev);

  // زر اللفظ في شريط المفهوم بحثٌ جانبي لا يمحو بحث القارئ: يظهر زر العودة باسم
  // بحثه، والضغط عليه يعيد «عطاء موزون» بنتائجه وشريطه
  const back = await pg.evaluate(async () => {
    performSearch('عطاء موزون');
    await new Promise(r => setTimeout(r, 500));
    const chip = [...document.querySelectorAll('.concept-top .concept-chip')].find(b => b.textContent.startsWith('جدول الكميات المسعر'));
    if (!chip) return { chip: false };
    chip.click();
    await new Promise(r => setTimeout(r, 500));
    const pill = document.getElementById('navBackInline');
    const out = {
      chip: true,
      moved: document.getElementById('searchInput').value.startsWith('جدول الكميات المسعر'),
      pill: !pill.hidden && pill.textContent.includes('«عطاء موزون»')
    };
    pill.click();
    await new Promise(r => setTimeout(r, 700));
    out.restored = document.getElementById('searchInput').value === 'عطاء موزون' &&
      [...document.querySelectorAll('.result-card')].some(b => b.dataset.id === 'a4-exclusion-20-percent-unbalanced') &&
      !!document.querySelector('.concept-top');
    out.pillGone = document.getElementById('navBackInline').hidden;
    return out;
  });
  check('زر لفظ المفهوم يبحث به ويترك زر العودة إلى بحث القارئ، والعودة تعيده كما كان',
    Object.values(back).every(Boolean), back);

  // زر الإضافة لا يجلب بنداً جاراً: ألفاظ المفهوم تُقاس بالعبارة لا بكلمات متفرّقة، فلا يدخل
  // استقطاع الفقرات غير المنفذة (ضوابط 19 عاشراً) في «العطاء الموزون»، ولا زر إضافة بلا شيء يُضاف
  const nb = await pg.evaluate(async () => {
    performSearch('عطاء موزون');
    await new Promise(r => setTimeout(r, 500));
    const strip = document.querySelector('.concept-top');
    const add = strip && [...strip.querySelectorAll('button')].find(b => b.textContent.includes('أضِف'));
    const ids = [...document.querySelectorAll('.result-card')].map(b => b.dataset.id);
    return { strip: !!strip, noAdd: !add, noNeighbour: !ids.includes('a19-deduct-unexecuted-items'), direct: ids.includes('a4-exclusion-20-percent-unbalanced') };
  });
  check('«عطاء موزون»: شريط المفهوم بلا زر إضافة ولا بند جار، والبند الصحيح مباشرة',
    Object.values(nb).every(Boolean), nb);

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

  // «أُحيل إليه من»: المادة (40) تستند إليها ديباجات الضوابط
  const art40 = await pg.evaluate(() => {
    const c = data.clauses.find(x => x.article === 'المادة (40)');
    const box = backrefsBox(c, () => {});
    return box ? { links: box.querySelectorAll('.pi-link').length, shown: [...box.querySelectorAll('.pi-link')].filter(a => !a.hidden).length, more: (box.querySelector('.pi-others') || {}).textContent } : null;
  });
  const showN = dev.phone ? 3 : 6;
  check('المادة (40): «أُحيل إليه من» 17 ضابطة، ' + showN + ' ظاهرة والباقي بزر',
    !!art40 && art40.links === 17 && art40.shown === showN && new RegExp(String(17 - showN)).test(art40.more || ''), art40);

  // حلّ الإحالات: الحالات التي كانت خاطئة أو غير مربوطة
  const refs = await pg.evaluate(() => {
    const at = (article, clause, text) => {
      const c = data.clauses.find(x => x.article === article && x.clause === clause);
      const src = String(c.officialText);
      REF_RE.lastIndex = 0;
      let m;
      while ((m = REF_RE.exec(src)) !== null) {
        if (m[0].includes(text)) {
          const r = resolveRef(m, src, c.article, c.clause);
          return r ? r.article + (r.group ? ' / «' + r.group + '» كله' : r.clause ? ' / ' + r.clause.clause : '') : 'لا رابط';
        }
      }
      return 'لم يُعثر على الإحالة';
    };
    return {
      otherRegs: at('ضوابط رقم (6)', 'المادة (2) / ثانياً', 'المادة (8)'),
      ownArticle: at('ضوابط رقم (8)', 'المادة (8) / 1', 'المادة (1)'),
      wholeClause: at('ضوابط رقم (2)', 'ثالثاً / 6', 'رابعاً'),
      letter: at('المادة (27)', 'ثانياً / أ', '(ط)'),
      sibling: at('المادة (8)', 'أولاً / ب', 'هذا البند'),
      inBracket: at('المادة (37)', 'ثالثاً', '35')
    };
  });
  check('إحالة إلى ضوابط أخرى ليست رابطاً', refs.otherRegs === 'لا رابط', refs.otherRegs);
  check('«المادة (1) من هذه الضوابط» مادة الضابطة نفسها', refs.ownArticle === 'ضوابط رقم (8) / المادة (1)', refs.ownArticle);
  check('«البند (رابعاً)» يعني رابعاً كله لا فرعه الأول', refs.wholeClause === 'ضوابط رقم (2) / «رابعاً» كله', refs.wholeClause);
  check('«الفقرة (ط) من البند (ثانيا)» تصل إلى ثانياً / ط', refs.letter === 'المادة (16) / ثانياً / ط', refs.letter);
  check('«(أ) من هذا البند» فرعٌ شقيق', refs.sibling === 'المادة (8) / أولاً / أ', refs.sibling);
  check('«(35/ ثالثاً/أ) من هذه التعليمات»', refs.inBracket === 'المادة (35) / ثالثاً / أ', refs.inBracket);
  // من البند المحال إليه إلى البند الذي أحال، تصفّحاً
  const hop = await pg.evaluate(() => {
    // ضوابط (14) تحيل إلى «الفقرة (ثانياً/ ز)» تحديداً
    const target = data.clauses.find(x => x.article === 'المادة (16)' && x.clause === 'ثانياً / ز');
    openClauseAt(target);
    const link = [...document.querySelectorAll('.pi-body:not([hidden]) .pi-back .pi-link')].find(a => a.textContent.startsWith('ضوابط رقم (14)'));
    if (!link) return null;
    link.click();
    return { chapters: getComputedStyle(document.getElementById('chapters')).display,
             open: (document.querySelector('.pi-item[aria-expanded=true] .pi-num') || {}).textContent,
             kind: selectedKind };
  });
  check('من المادة (16) إلى ضوابط (14) التي أحالت إليها', !!hop && hop.kind === 'annex' && hop.chapters === 'block' && !!hop.open, hop);
  // وفي شاشة البحث عبر مسار الإحالات، مع طريق العودة
  const viaSearch = await pg.evaluate(() => {
    showArticle('المادة (28)');
    const box = document.querySelector('.source-back');
    const link = box && box.querySelector('.pi-link');
    if (!link) return null;
    link.click();
    return { back: !document.getElementById('navBack').hidden, title: document.getElementById('queryTitle').textContent };
  });
  check('في البحث: «أُحيل إليه من» يفتح الضابطة مع زر العودة', !!viaSearch && viaSearch.back && /ضوابط رقم/.test(viaSearch.title), viaSearch);
  await pg.evaluate(() => showChapters());

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
