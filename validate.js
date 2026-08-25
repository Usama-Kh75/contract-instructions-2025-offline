#!/usr/bin/env node
/*
 * فحوص المصادر قبل البناء والرفع.  node validate.js
 *
 * كل فحص هنا كشف خطأً حقيقياً في هذا العمل من قبل، لا فحص نظري:
 * المراجع المعلّقة كشفت الضابطة (13)، والوسوم المكررة كشفت 17 موضعاً
 * في المتن، وكثافة الفواصل أنذرت بالضابطة (5) قبل يوم من الحاجة إليها.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const errors = [];
const warnings = [];
const fail = m => errors.push(m);
const warn = m => warnings.push(m);

const order = readJson(path.join(SRC, 'order.json'));
const clauses = [];
for (const f of order) {
  const u = readJson(path.join(SRC, 'units', f));
  u.clauses.forEach(c => clauses.push(Object.assign({ _file: f }, c)));
}

const where = c => c._file + ' › ' + c.article + ' / ' + c.clause;

// ── 1. المعرّفات ───────────────────────────────────────────────────────────
const byId = new Map();
for (const c of clauses) {
  if (!c.id) fail('بند بلا معرّف في ' + where(c));
  else if (byId.has(c.id)) fail('معرّف مكرر «' + c.id + '»: ' + where(byId.get(c.id)) + '  و  ' + where(c));
  else byId.set(c.id, c);
}

// ── 2. الحقول المطلوبة ────────────────────────────────────────────────────
const REQUIRED = ['id', 'title', 'clause', 'officialText', 'printedPage', 'pdfPage', 'article', 'pageImage'];
for (const c of clauses) {
  for (const k of REQUIRED) {
    if (c[k] === undefined || c[k] === null || String(c[k]).trim() === '') fail('حقل «' + k + '» فارغ في ' + where(c));
  }
  if (!Array.isArray(c.keywords) || c.keywords.length === 0) warn('لا كلمات مفتاحية: ' + where(c));
  if (c.verbatim !== true && c.verbatim !== false) fail('وسم verbatim غير محسوم في ' + where(c));
}

// ── 3. إزاحة الصفحات ─────────────────────────────────────────────────────
// المطبوع يبدأ عند صورة رقم 7، فالإزاحة ست صفحات في كل الملف
for (const c of clauses) {
  const printed = String(c.printedPage).split('-')[0].trim();
  if (printed !== String(c.pdfPage - 6)) {
    fail('إزاحة خاطئة: ' + where(c) + ' — مطبوعة ' + c.printedPage + ' بينما الصورة ' + c.pdfPage);
  }
  if (c.pageImage !== '/pages/page-' + c.pdfPage + '.jpg') {
    fail('مسار الصورة لا يطابق pdfPage: ' + where(c) + ' — ' + c.pageImage);
  }
}

// ── 4. تغطية الصفحات ─────────────────────────────────────────────────────
const pages = new Set(clauses.map(c => c.pdfPage));
const gaps = [];
for (let p = 7; p <= 174; p++) if (!pages.has(p)) gaps.push(p);
if (gaps.length) fail('صفحات بلا بنود: ' + gaps.join('، '));

// ── 5. نظافة النص الرسمي ─────────────────────────────────────────────────
// ترقيم البند يعيش في حقل clause، فتسرّبه إلى النص يكسر النسخ للاستشهاد
const PREFIX = /^\s*(اولا|أولا|أولاً|ثانيا|ثانياً|ثالثا|ثالثاً|رابعا|رابعاً|خامسا|خامساً|سادسا|سادساً|سابعا|سابعاً|ثامنا|ثامناً|تاسعا|تاسعاً|عاشرا|عاشراً)\s*[:\-–]/;
const LETTER = /^\s*[أ-ي]\s*[)\-–]\s/;
for (const c of clauses) {
  if (PREFIX.test(c.officialText)) fail('ترتيب البند مسرَّب داخل النص: ' + where(c));
  if (LETTER.test(c.officialText)) fail('حرف الفقرة مسرَّب داخل النص: ' + where(c));
  if (/\bمكرر|\(تتمة\)|\(تتمه\)/.test(c.clause)) fail('تعليق داخل وسم البند: ' + where(c));
  if (/\sو(أولا|ثانيا|ثالثا|رابعا)/.test(c.clause)) fail('وسم مركّب: ' + where(c));
  if (/%\s*\d/.test(c.officialText)) fail('علامة النسبة قبل الرقم (قراءة معكوسة): ' + where(c));
}

// ── 6. كثافة الفواصل ──────────────────────────────────────────────────────
// المصدر المطبوع نادراً ما يستعمل «،» — فالوحدة الغنية بها على الأرجح مُعاد
// صياغتها لا منقولة. هذا ما أنذر بالضابطة (5).
const perUnit = {};
for (const c of clauses) {
  const u = perUnit[c._file] || (perUnit[c._file] = { chars: 0, commas: 0 });
  u.chars += c.officialText.length;
  u.commas += (c.officialText.match(/،/g) || []).length;
}
for (const [f, u] of Object.entries(perUnit)) {
  const rate = u.chars ? (u.commas / u.chars) * 1000 : 0;
  if (rate > 4) warn('كثافة فواصل عالية (' + rate.toFixed(1) + ' لكل ألف حرف) في ' + f + ' — راجع أنه منقول لا ملخَّص');
}

// ── 7. المراجع الداخلية المعلّقة ─────────────────────────────────────────
// إشارة إلى مادة أو ضابطة غير موجودة تعني نصاً ناقصاً — هكذا انكشفت
// الضابطة (13)
const haveArticles = new Set(clauses.map(c => c.article));
// مراجع تحقّقنا أنها تشير خارج هذا المستند — نصٌّ مُلغى أو قانون آخر.
// غيابها صحيح، فتوثيقها هنا أصدق من إسكات الفحص.
const external = new Set(readJson(path.join(SRC, 'external-refs.json')).map(x => x.ref));
const refRe = /(المادة|الماده|ضوابط رقم)\s*\((\d+)\)/g;
const dangling = new Map();
for (const c of clauses) {
  let m;
  while ((m = refRe.exec(c.officialText)) !== null) {
    const target = /ضوابط/.test(m[1]) ? 'ضوابط رقم (' + m[2] + ')' : 'المادة (' + m[2] + ')';
    if (!haveArticles.has(target) && !external.has(target)) {
      if (!dangling.has(target)) dangling.set(target, []);
      dangling.get(target).push(where(c));
    }
  }
}
for (const [t, srcs] of dangling) {
  warn('مرجع إلى «' + t + '» غير موجود، من ' + srcs.length + ' موضعاً — أولها ' + srcs[0]);
}

// ── التقرير ───────────────────────────────────────────────────────────────
console.log('بنود: ' + clauses.length + '  |  وحدات: ' + order.length +
            '  |  حرفية: ' + clauses.filter(c => c.verbatim === true).length);
console.log('');
if (warnings.length) {
  console.log('تنبيهات (' + warnings.length + '):');
  warnings.forEach(w => console.log('  ⚠  ' + w));
  console.log('');
}
if (errors.length) {
  console.log('أخطاء (' + errors.length + '):');
  errors.forEach(e => console.log('  ✘  ' + e));
  process.exit(1);
}
console.log('✔ لا أخطاء');
