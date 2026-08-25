#!/usr/bin/env node
/*
 * يبني «تعليمات العقود.html» من مصادره في مجلد src.
 *
 *   node build.js            بناء عادي
 *   node build.js --check    لا يكتب شيئاً، يخبرك فقط هل المُخرَج مطابق
 *   node build.js --force    يبني فوق مُخرَج عُدِّل باليد
 *
 * الملف المُخرَج مُولَّد: لا تحرّره. حرّر ملفات src ثم أعد البناء.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'تعليمات العقود.html');
const STAMP = path.join(SRC, '.built-hash');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');

const lf = s => s.replace(/\r\n/g, '\n');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

// نفس دالة البصمة المستعملة داخل الصفحة: FNV-1a 32-bit.
// تشمل المحتوى وحده — النسخة وتاريخ الإصدار خارجها عمداً، فتصحيح مطبعي
// يغيّر البصمة بينما رقم إصدار جديد لا يغيّرها.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function assemble() {
  const order = readJson(path.join(SRC, 'order.json'));
  const clauses = [];
  const seen = new Set();

  for (const file of order) {
    const p = path.join(SRC, 'units', file);
    if (!fs.existsSync(p)) throw new Error('وحدة مفقودة: ' + file);
    const unit = readJson(p);
    if (!Array.isArray(unit.clauses)) throw new Error('لا توجد مصفوفة clauses في ' + file);
    for (const c of unit.clauses) {
      if (c.article !== unit.article) {
        throw new Error(file + ': البند ' + c.id + ' يحمل «' + c.article + '» بينما الوحدة «' + unit.article + '»');
      }
      if (seen.has(c.id)) throw new Error('معرّف مكرر: ' + c.id + ' في ' + file);
      seen.add(c.id);
      clauses.push(c);
    }
  }

  // أي ملف وحدة لا يذكره order.json هو عمل ضائع لا يصل إلى الصفحة
  const listed = new Set(order);
  const orphans = fs.readdirSync(path.join(SRC, 'units'))
    .filter(f => f.endsWith('.json') && !listed.has(f));
  if (orphans.length) throw new Error('وحدات غير مذكورة في order.json: ' + orphans.join('، '));

  const chapters = readJson(path.join(SRC, 'chapters.json'));
  const annexes = readJson(path.join(SRC, 'annexes.json'));
  const meta = readJson(path.join(SRC, 'meta.json'));
  const concepts = readJson(path.join(SRC, 'concepts.json'));

  const integrity = fnv1a(JSON.stringify({ clauses, chapters, annexes, credit: meta.credit }));

  // ترتيب المفاتيح هنا مقصود: تسلسل الجذر يدخل في البصمة المطبوعة على
  // الصفحة، فتغييره يغيّرها دون أن يتغير حرف واحد من النص.
  // و«المفاهيم» خارج البصمة عمداً كالنسخة والتاريخ: هي أداة تنقّل لا نصّاً
  // رسمياً، فتصحيحُ مترادفٍ يجب ألا يجعل النسخة تبدو معبوثاً بها.
  return {
    data: {
      clauses,
      chapters,
      integrity,
      version: meta.version,
      releaseDate: meta.releaseDate,
      credit: meta.credit,
      annexes,
      concepts
    },
    integrity
  };
}

function render(data) {
  const template = lf(fs.readFileSync(path.join(SRC, 'template.html'), 'utf8'));
  if (!template.includes('@@APPDATA@@')) throw new Error('القالب لا يحوي العلامة @@APPDATA@@');
  return template.replace('@@APPDATA@@', () => JSON.stringify(data, null, 2));
}

function main() {
  const { data, integrity } = assemble();
  const out = render(data);
  const existing = fs.existsSync(OUT) ? lf(fs.readFileSync(OUT, 'utf8')) : null;
  const same = existing === out;

  if (CHECK) {
    console.log(same ? '✔ المُخرَج مطابق للمصادر' : '✘ المُخرَج يختلف عن المصادر — شغّل «node build.js»');
    process.exit(same ? 0 : 1);
  }

  // حارس التحرير اليدوي: إن كان الملف الموجود لا يطابق ما بنيناه آخر مرة،
  // فقد حرّره أحد مباشرةً، والبناء سيمحو تعديله. أوقفه واطلب قراراً صريحاً.
  if (existing !== null && !same && fs.existsSync(STAMP) && !FORCE) {
    const stamped = fs.readFileSync(STAMP, 'utf8').trim();
    if (fnv1a(existing) !== stamped) {
      console.error('توقف: «تعليمات العقود.html» عُدِّل يدوياً بعد آخر بناء.');
      console.error('البناء سيمحو ذلك التعديل. انقل تغييرك إلى src أولاً،');
      console.error('أو شغّل «node build.js --force» إن كنت تقصد إهماله.');
      process.exit(2);
    }
  }

  fs.writeFileSync(OUT, out, 'utf8');
  fs.writeFileSync(STAMP, fnv1a(out) + '\n', 'utf8');

  console.log('بنود   : ' + data.clauses.length + ' (منها ' + data.clauses.filter(c => c.verbatim === true).length + ' حرفياً)');
  console.log('البصمة : ' + integrity);
  console.log('المُخرَج: ' + (same ? 'لم يتغير' : 'تغيّر'));
}

try {
  main();
} catch (e) {
  console.error('فشل البناء: ' + e.message);
  process.exit(1);
}
