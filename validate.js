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

// ── 8. جدول المفاهيم ─────────────────────────────────────────────────────
const norm = s => String(s ?? '').normalize('NFKD')
  .replace(/[ً-ٰٟ]/g, '').replace(/ـ/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^\p{L}\p{N}%]+/gu, ' ').replace(/\s+/g, ' ').trim();

const haystacks = clauses.map(c =>
  norm([c.title, c.officialText, c.explanation, (c.keywords || []).join(' ')].join(' ')));
// يحاكي سلوك search() في الصفحة: كل كلمات الاستعلام حاضرة، لا العبارة
// متصلة. عدّها بالعبارة المتصلة يجعل «التغيير في العقد» تبدو بلا نتائج
// وهي تُرجع أربع عشرة.
const STOP = ['هل', 'ما', 'من', 'في', 'عن', 'هي', 'علي', 'الي'];
const hits = term => {
  const tokens = norm(term).split(' ').filter(t => t.length > 1 && !STOP.includes(t));
  if (!tokens.length) return 0;
  return haystacks.filter(x => tokens.every(t => x.includes(t))).length;
};

const concepts = readJson(path.join(SRC, 'concepts.json'));
const conceptIds = new Set();
const termOwner = new Map();
for (const k of concepts) {
  const at = 'concepts.json › ' + (k.label || k.id || '؟');
  if (!k.id) fail(at + ': بلا معرّف');
  else if (conceptIds.has(k.id)) fail(at + ': معرّف مفهوم مكرر «' + k.id + '»');
  else conceptIds.add(k.id);
  if (!k.label) fail(at + ': بلا عنوان');
  // الجدول فهمُنا مُدوَّناً، وقد يكون فهمنا خاطئاً. ومساواةٌ بلا تعليل لا
  // يمكن لأحد أن يراجعها — لا نحن بعد سنة، ولا من يخلفنا.
  if (!k.note || !String(k.note).trim()) {
    fail(at + ': بلا تعليل — اكتب في «note» لماذا هذه الألفاظ شيء واحد في هذا المستند');
  }
  if (!Array.isArray(k.terms) || k.terms.length < 2) {
    fail(at + ': المفهوم يحتاج مصطلحين على الأقل، وإلا فلا شيء يربطه بشيء');
    continue;
  }

  const counts = k.terms.map(t => [t, hits(t)]);
  // مصطلح بلا نتائج ليس مدخلاً ميتاً بل أنفعها: هو لفظ الميدان الذي لا
  // يستعمله النص، والجسر إليه. «الأمر التغييري» مثاله.
  const live = counts.filter(([, n]) => n > 0);
  if (!live.length) fail(at + ': لا مصطلح من مصطلحاته يرد في المستند إطلاقاً — المفهوم كله لا يصل إلى شيء');
  else if (live.length === 1 && counts.length > 1 && live[0][1] === Math.max(...counts.map(c => c[1]))) {
    const bridges = counts.filter(([, n]) => n === 0).map(([t]) => t);
    if (!bridges.length) warn(at + ': مصطلح واحد فقط يصل إلى نتائج — راجع فائدة الباقي');
  }

  for (const [t] of counts) {
    const key = norm(t);
    if (termOwner.has(key) && termOwner.get(key) !== k.id) {
      warn(at + ': المصطلح «' + t + '» يظهر أيضاً في مفهوم «' + termOwner.get(key) + '» — أولهما في الملف يفوز');
    } else termOwner.set(key, k.id);
  }
}

// ── 9. تصادم أسماء الدوال في القالب ──────────────────────────────────────
// تعريفان بالاسم نفسه لا يُعدّان خطأً في JavaScript: الأخير يفوز بصمت
// ويُبطل الأول. وقع ذلك فعلاً حين حمل فاصلُ النتائج ومطابقةُ المفاهيم اسم
// «hasPhrase» كلاهما، فتعطّل الفصل كله ولم يشتكِ شيء.
const tpl = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
const script = tpl.slice(tpl.indexOf('<script>', tpl.indexOf('</style>')));
const decls = {};
for (const m of script.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
  decls[m[1]] = (decls[m[1]] || 0) + 1;
}
for (const [name, n] of Object.entries(decls)) {
  if (n > 1) fail('القالب: الدالة «' + name + '» معرَّفة ' + n + ' مرات — الأخيرة تُبطل ما قبلها بصمت');
}

// ── التقرير ───────────────────────────────────────────────────────────────
console.log('بنود: ' + clauses.length + '  |  وحدات: ' + order.length +
            '  |  حرفية: ' + clauses.filter(c => c.verbatim === true).length +
            '  |  مفاهيم: ' + concepts.length);
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
