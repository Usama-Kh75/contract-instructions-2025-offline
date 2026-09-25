#!/usr/bin/env node
/*
 * اختبارات العمل بلا إنترنت والتحديث: الجزء الذي يعطب بصمت. لو توقف الدليل
 * عن الفتح بلا إنترنت، أو لم تصل التحديثات، لما ظهر شيء على الشاشة.
 *
 * يقدّم خادمٌ محلي الدليلَ كما يقدّمه GitHub Pages، ويستطيع أن:
 *   - «ينقطع» فلا يجيب، كانقطاع الإنترنت؛
 *   - ينشر «إصداراً جديداً» بتغيير رقم الإصدار في الصفحة وفي عامل الخدمة؛
 *   - يحاكي لحظة النشر، حين يصل sw.js الجديد والصفحة القديمة ما زالت.
 *
 *   npm test   (مع اختبارات الواجهة)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'meta.json'), 'utf8')).version;
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

// ---------- الخادم ----------
const state = { down: false, version: null, staleIndex: false };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  // «الإنترنت مقطوع»: لا جواب، كما يرى المتصفح عند انقطاع الشبكة
  if (state.down) { req.socket.destroy(); return; }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>blank</title>'); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([\\/])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file);
  // «نشر» إصدار جديد: الرقم نفسه يتغير في الصفحة وفي العامل، كما يفعل build.js
  if (state.version) {
    const name = path.basename(file);
    if (name === 'sw.js') body = Buffer.from(body.toString('utf8').replace("const VERSION = '" + VER + "'", "const VERSION = '" + state.version + "'"));
    if (name === 'index.html' && !state.staleIndex) body = Buffer.from(body.toString('utf8').replace('"version": "' + VER + '"', '"version": "' + state.version + '"'));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
});

async function waitFor(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e.message; }
    await sleep(step);
  }
  return last;
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port + '/';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cic-offline-'));
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', userDataDir: profile, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 1280, height: 900 });
    pg.on('pageerror', e => errors.push(e.message));

    const cacheKeys = () => pg.evaluate(() => caches.keys());
    // match with cacheName, never open: open would create the cache it checks
    const cacheHas = (name, url) => pg.evaluate(async (name, url) =>
      !!(await caches.match(url, { cacheName: name })), name, url);
    const workerVersion = () => pg.evaluate(() => new Promise(resolve => {
      const w = navigator.serviceWorker.controller;
      if (!w) return resolve(null);
      const ch = new MessageChannel();
      ch.port1.onmessage = e => resolve(e.data);
      w.postMessage('version', [ch.port2]);
      setTimeout(() => resolve(null), 2000);
    }));

    console.log('\n— الزيارة الأولى —');
    // قبل أن يعمل الدليل: مخزن لتطبيق آخر على النطاق نفسه، ومخازن الدليل
    // بأسمائها القديمة (قبل البادئة cic2025-) كما عند الزملاء الأوائل
    await pg.goto(BASE + 'blank');
    await pg.evaluate(async base => {
      await (await caches.open('other-app-shell')).put(base + 'other-app/index.html', new Response('x'));
      await (await caches.open('shell-v1.0')).put(base + 'index.html', new Response('old'));
      await (await caches.open('pages-v1')).put(base + 'pages/page-7.jpg', new Response('saved-by-reader'));
    }, BASE);

    await pg.goto(BASE, { waitUntil: 'load' });
    const controlled = await waitFor(() => pg.evaluate(() => !!navigator.serviceWorker.controller));
    check('عامل الخدمة يعمل ويخدم الصفحة', controlled === true, controlled);
    const SHELL = 'cic2025-shell-v' + VER;
    check('الصفحة محفوظة باسميها', await cacheHas(SHELL, BASE) && await cacheHas(SHELL, BASE + 'index.html'));
    check('الأيقونات والـ manifest محفوظة', await cacheHas(SHELL, BASE + 'manifest.json') && await cacheHas(SHELL, BASE + 'icon-192.png'));
    // الترحيل يجري في activate؛ انتظر اكتماله كله قبل الحكم
    const keys = await waitFor(async () => { const k = await cacheKeys(); return !k.includes('pages-v1') && !k.includes('shell-v1.0') && k; })
      || await cacheKeys();
    check('مخزن تطبيق آخر على النطاق لم يُمسّ', Array.isArray(keys) && keys.includes('other-app-shell'), keys);
    check('المخزن القديم للصفحة حُذف', Array.isArray(keys) && !keys.includes('shell-v1.0'), keys);
    check('صور الصفحات المحفوظة سابقاً نُقلت إلى الاسم الجديد', await cacheHas('cic2025-pages-v1', BASE + 'pages/page-7.jpg'));

    console.log('\n— صور الصفحات —');
    await pg.click('#nextPage');
    const img8 = BASE + 'pages/page-8.jpg';
    check('صورة الصفحة المعروضة تُحفظ للعمل بلا إنترنت', await waitFor(() => cacheHas('cic2025-pages-v1', img8)) === true);

    console.log('\n— بلا إنترنت —');
    state.down = true;
    await pg.reload({ waitUntil: 'load' });
    check('الدليل يفتح بلا إنترنت', await pg.evaluate(v => typeof data === 'object' && data.version === v && document.querySelectorAll('.chapter-btn').length > 20, VER));
    await pg.click('#nextPage');
    const shown = await waitFor(() => pg.$eval('#chapterImage', e => e.complete && e.naturalWidth > 0 && e.src.endsWith('page-8.jpg')));
    check('الصورة المحفوظة تظهر بلا إنترنت', shown === true, shown);
    const status = await waitFor(() => pg.$eval('#offlineState', e => /يعمل بلا إنترنت|جاهز للعمل بلا إنترنت/.test(e.textContent) && e.textContent));
    check('حالة الحفظ تقول إنه يعمل بلا إنترنت', typeof status === 'string', status);
    const missing = await pg.evaluate(async () => {
      try { const r = await fetch('./not-there.png'); return r.ok ? 'ok ' + r.headers.get('content-type') : 'status ' + r.status; }
      catch (e) { return 'network-error'; }
    });
    check('ملفٌ غير محفوظ يفشل كخطأ شبكة لا كصفحة HTML', missing === 'network-error', missing);
    state.down = false;

    console.log('\n— لحظة النشر: العامل الجديد قبل صفحته —');
    state.version = '9.98';
    state.staleIndex = true;
    await pg.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()).catch(() => { }));
    await sleep(2500);
    check('لا يُثبَّت إصدار ناقص: العامل القديم باقٍ', await workerVersion() === VER, await workerVersion());
    check('الدليل المحفوظ لم يُمسّ', await cacheHas(SHELL, BASE) && !(await cacheKeys()).includes('cic2025-shell-v9.98'));

    console.log('\n— تحديث حقيقي —');
    state.version = '9.99';
    state.staleIndex = false;
    await pg.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()).catch(() => { }));
    check('الإصدار الجديد يتولّى الخدمة', await waitFor(async () => (await workerVersion()) === '9.99') === true);
    const bar = await waitFor(() => pg.evaluate(() => !document.getElementById('updateBar').hidden && document.getElementById('updateTitle').textContent));
    check('الزملاء يرون «يتوفر إصدار أحدث»', typeof bar === 'string' && /يتوفر إصدار أحدث.*9\.99/.test(bar), bar);
    const after = await waitFor(async () => { const k = await cacheKeys(); return !k.includes(SHELL) && k; });
    check('مخزن الإصدار القديم حُذف', Array.isArray(after) && after.includes('cic2025-shell-v9.99'), after);
    check('صور الصفحات المحفوظة بقيت بعد التحديث', await cacheHas('cic2025-pages-v1', img8));
    await pg.reload({ waitUntil: 'load' });
    const done = await waitFor(() => pg.evaluate(() => data.version === '9.99' && !document.getElementById('updateBar').hidden && document.getElementById('updateTitle').textContent));
    check('بعد الفتح: «تم تحديث الدليل إلى الإصدار 9.99»', typeof done === 'string' && /تم تحديث الدليل إلى الإصدار 9\.99/.test(done), done);

    console.log('\n— حفظ صور الصفحات كلها —');
    await pg.evaluate(() => document.getElementById('offlineBtn').click());
    const ready = await waitFor(() => pg.evaluate(() => {
      const t = document.getElementById('offlineState').textContent;
      return /جاهز للعمل بلا إنترنت/.test(t) && document.getElementById('offlineBtn').hidden && t;
    }), 120000, 500);
    check('بعد حفظها كلها: «جاهز للعمل بلا إنترنت» ويختفي الزر', typeof ready === 'string', ready);
    const counted = await pg.evaluate(async () => {
      const need = [...new Set(data.clauses.map(c => c.pdfPage))];
      const hits = await Promise.all(need.map(p => caches.match(new URL('./pages/page-' + p + '.jpg', location.href).href, { cacheName: 'cic2025-pages-v1' })));
      return { need: need.length, saved: hits.filter(Boolean).length };
    });
    check('كل الصور المطلوبة في مخزن الدليل', counted.need > 0 && counted.saved === counted.need, counted);

    check('لا أخطاء في الصفحة', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + passes + ' نجح، ' + failures + ' فشل');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
