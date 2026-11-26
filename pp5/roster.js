/*
 * ทะเบียนรายชื่อนักเรียนทั้งโรงเรียน จากไฟล์ Word (.docx) แบบ "รายชื่อนักเรียน ปี 25xx"
 *   หัวเรื่อง: "รายชื่อนักเรียน ปี 2569" / "2 พย.69 รวม 294 คน"
 *   แต่ละห้อง: "รายชื่อนักเรียนชั้นประถมศึกษาปีที่ 4/1 ปีการศึกษา 2569 ชาย 13 หญิง 11 รวม 24 คน"
 *              "ครู..." แล้วตาราง: ที่ | เลขประจำตัวนักเรียน | ชื่อ – สกุลนักเรียน | เลขประจำตัวประชาชน 13 หลัก
 * เก็บเฉพาะเลขบัตรประชาชน 4 ตัวท้ายในข้อมูลของระบบ (ไฟล์ต้นฉบับเก็บแยกไว้ให้ดาวน์โหลด)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PP5Roster = factory(root.JSZip);
})(typeof self !== 'undefined' ? self : this, function (JSZip) {
  'use strict';

  var MONTHS = { 'มค': 1, 'กพ': 2, 'มีค': 3, 'เมย': 4, 'พค': 5, 'มิย': 6, 'กค': 7, 'สค': 8, 'กย': 9, 'ตค': 10, 'พย': 11, 'ธค': 12 };
  var MONTH_TXT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var PREFIX = ['เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.', 'นางสาว', 'นาย', 'นาง'];
  var PREFIX_FULL = { 'ด.ช.': 'เด็กชาย', 'ด.ญ.': 'เด็กหญิง' };

  function unesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function sp(s) { return String(s || '').replace(/[\s ​]+/g, ' ').trim(); }

  // ข้อความของย่อหน้า: รวม <w:t> และแปลง tab เป็นช่องว่าง
  function paraText(xml) {
    var out = '', re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g, m;
    while ((m = re.exec(xml))) out += m[1] != null ? unesc(m[1]) : ' ';
    return out;
  }
  // แยกองค์ประกอบชั้นบนสุดของ <w:body> ตามลำดับ (ย่อหน้า / ตาราง)
  function bodyParts(doc) {
    var b0 = doc.indexOf('<w:body'), b1 = doc.lastIndexOf('</w:body>');
    var body = doc.slice(doc.indexOf('>', b0) + 1, b1), parts = [], i = 0;
    while (i < body.length) {
      var p = body.indexOf('<w:p', i), t = body.indexOf('<w:tbl>', i), t2 = body.indexOf('<w:tbl ', i);
      if (t < 0 || (t2 >= 0 && t2 < t)) t = t2;
      while (p >= 0 && /[A-Za-z]/.test(body.charAt(p + 4))) p = body.indexOf('<w:p', p + 4); // ข้าม <w:pPr ...>
      if (p < 0 && t < 0) break;
      if (t >= 0 && (p < 0 || t < p)) {
        var depth = 0, j = t, re = /<w:tbl[\s>]|<\/w:tbl>/g, m;
        re.lastIndex = t;
        while ((m = re.exec(body))) { if (m[0].charAt(1) === '/') depth--; else depth++; if (depth === 0) { j = re.lastIndex; break; } }
        parts.push({ type: 'tbl', xml: body.slice(t, j) });
        i = j;
      } else {
        var selfClose = body.charAt(body.indexOf('>', p) - 1) === '/';
        var e = selfClose ? body.indexOf('>', p) + 1 : body.indexOf('</w:p>', p) + 6;
        parts.push({ type: 'p', text: sp(paraText(body.slice(p, e))) });
        i = e;
      }
    }
    return parts;
  }
  function tableRows(xml) {
    var rows = [], re = /<w:tr\b[\s\S]*?<\/w:tr>/g, m;
    while ((m = re.exec(xml))) {
      var cells = [], cre = /<w:tc\b[\s\S]*?<\/w:tc>/g, c;
      while ((c = cre.exec(m[0]))) cells.push(sp(paraText(c[0])));
      rows.push(cells);
    }
    return rows;
  }

  function parseDate(text) {
    var m = /(\d{1,2})\s*([ก-ฮ]{1,2}\.?[ก-ฮ]?\.?[ก-ฮ]?\.?)\s*(\d{2,4})/.exec(text || '');
    if (!m) return null;
    var mon = MONTHS[m[2].replace(/\./g, '')];
    if (!mon) return null;
    var y = +m[3];
    if (y < 100) y += 2500;
    var d = +m[1];
    return { day: d, month: mon, year: y, display: d + ' ' + MONTH_TXT[mon] + ' ' + y, iso: (y - 543) + '-' + String(mon).padStart(2, '0') + '-' + String(d).padStart(2, '0') };
  }
  function parseHeading(t) {
    var m = /รายชื่อนักเรียนชั้น\s*(อนุบาล|ประถมศึกษา|มัธยมศึกษา|ป\.|ม\.|อ\.)[^\d]*(\d)\s*\/\s*(\d+)/.exec(t);
    if (!m) return null;
    var stage = /อนุบาล|อ\./.test(m[1]) ? 'อ' : /มัธยม|ม\./.test(m[1]) ? 'ม' : 'ป';
    var cnt = function (lab) { var x = new RegExp(lab + '\\s*(\\d+)').exec(t); return x ? +x[1] : null; };
    var y = /ปีการศึกษา\s*(\d{4})/.exec(t);
    return { stage: stage, level: +m[2], room: +m[3], label: (stage === 'อ' ? 'อ.' : stage + '.') + m[2] + '/' + m[3], year: y ? +y[1] : null, declared: { male: cnt('ชาย'), female: cnt('หญิง'), total: cnt('รวม') } };
  }
  function parseName(raw) {
    var s = sp(raw), prefix = '', junk = '';
    for (var i = 0; i < PREFIX.length; i++) if (s.indexOf(PREFIX[i]) === 0) { prefix = PREFIX[i]; s = s.slice(prefix.length).trim(); break; }
    if (!prefix) { // มีตัวอักษรเกินหน้าคำนำหน้า (พิมพ์ผิด) เช่น "เดเดกเด็กชาย..."
      for (var k = 0; k < PREFIX.length && !prefix; k++) {
        var at = s.indexOf(PREFIX[k]);
        if (at > 0 && at <= 12) { junk = s.slice(0, at); prefix = PREFIX[k]; s = s.slice(at + prefix.length).trim(); }
      }
    }
    prefix = PREFIX_FULL[prefix] || prefix;
    var parts = s.split(' ');
    return { prefix: prefix, first: parts.shift() || '', last: parts.join(' '), junk: junk };
  }

  function parseDocumentXml(doc) {
    var parts = bodyParts(doc), out = { title: '', dateText: '', date: null, year: null, declaredTotal: null, classes: [], warnings: [] };
    var cur = null;
    parts.forEach(function (p, idx) {
      if (p.type === 'p') {
        var t = p.text;
        if (!t) return;
        var h = parseHeading(t);
        if (h) { cur = h; cur.teachers = []; return; }
        if (cur && !cur.students && /^ครู/.test(t)) {
          cur.teachers = t.split(/\s+-\s+|,|\//).map(function (x) { return sp(x).replace(/^ครู\s*/, ''); }).filter(Boolean);
          return;
        }
        if (!out.classes.length && !cur) {
          if (!out.title && /รายชื่อนักเรียน/.test(t)) { out.title = t; var yy = /(\d{4})/.exec(t); if (yy) out.year = +yy[1]; return; }
          var d = parseDate(t);
          if (d && !out.date) { out.date = d; out.dateText = t; var tot = /รวม\s*(\d+)/.exec(t); if (tot) out.declaredTotal = +tot[1]; }
        }
        return;
      }
      if (!cur || cur.students) return;
      var rows = tableRows(p.xml), head = rows[0] || [];
      var col = { no: 0, id: 1, name: 2, nid: 3 };
      head.forEach(function (h, i) {
        var n = h.replace(/\s+/g, '');
        if (/^ที่$/.test(n)) col.no = i;
        else if (/เลขประจำตัวนักเรียน/.test(n)) col.id = i;
        else if (/ชื่อ/.test(n)) col.name = i;
        else if (/ประชาชน/.test(n)) col.nid = i;
      });
      cur.students = [];
      rows.slice(1).forEach(function (r) {
        var no = parseInt(r[col.no], 10), name = r[col.name] || '';
        if (!isFinite(no) || !name) return;
        var nm = parseName(name), nid = String(r[col.nid] || '').replace(/\D/g, '');
        if (nm.junk) out.warnings.push('ชั้น ' + cur.label + ' เลขที่ ' + no + ' (' + String(r[col.id] || '').trim() + '): ชื่อในไฟล์มีตัวอักษรเกิน "' + nm.junk + '" หน้าคำนำหน้า ระบบตัดออกให้แล้ว (ควรแก้ในไฟล์ Word)');
        cur.students.push({
          no: no, id: String(r[col.id] || '').replace(/\s+/g, ''), prefix: nm.prefix, first: nm.first, last: nm.last,
          name: (nm.prefix + nm.first + ' ' + nm.last).trim(), sex: /หญิง|นางสาว|^นาง$/.test(nm.prefix) ? 'หญิง' : nm.prefix ? 'ชาย' : '',
          nid4: nid.length >= 4 ? nid.slice(-4) : '', status: 'ปกติ'
        });
      });
      var male = cur.students.filter(function (s) { return s.sex === 'ชาย'; }).length, female = cur.students.filter(function (s) { return s.sex === 'หญิง'; }).length;
      cur.counts = { male: male, female: female, total: cur.students.length };
      var dc = cur.declared;
      if ((dc.total != null && dc.total !== cur.counts.total) || (dc.male != null && dc.male !== male) || (dc.female != null && dc.female !== female)) {
        out.warnings.push('ชั้น ' + cur.label + ': หัวตารางระบุ ชาย ' + dc.male + ' หญิง ' + dc.female + ' รวม ' + dc.total + ' แต่ในตารางมี ชาย ' + male + ' หญิง ' + female + ' รวม ' + cur.counts.total);
      }
      if (!cur.year) cur.year = out.year;
      out.classes.push(cur);
      cur = null;
      void idx;
    });
    if (!out.year && out.classes[0]) out.year = out.classes[0].year;
    out.total = out.classes.reduce(function (a, c) { return a + c.students.length; }, 0);
    if (out.declaredTotal != null && out.declaredTotal !== out.total) out.warnings.push('หัวเอกสารระบุรวม ' + out.declaredTotal + ' คน แต่ในตารางรวมได้ ' + out.total + ' คน');
    var seen = {};
    out.classes.forEach(function (c) {
      c.students.forEach(function (s) {
        if (!s.id) return;
        if (seen[s.id]) out.warnings.push('เลขประจำตัว ' + s.id + ' ซ้ำ (' + seen[s.id] + ' และ ' + c.label + ')');
        seen[s.id] = c.label;
      });
    });
    if (!out.classes.length) throw new Error('ไม่พบตารางรายชื่อในไฟล์ (ต้องมีหัวข้อ "รายชื่อนักเรียนชั้น..." ตามด้วยตารางรายชื่อ)');
    return out;
  }

  async function parseDocx(bytes) {
    var Z = JSZip || (typeof window !== 'undefined' && window.JSZip);
    var zip = await Z.loadAsync(bytes);
    var f = zip.file('word/document.xml');
    if (!f) throw new Error('ไม่ใช่ไฟล์ Word (.docx)');
    return parseDocumentXml(await f.async('string'));
  }

  function findClass(roster, year, stage, level, room) {
    if (!roster) return null;
    return roster.classes.filter(function (c) { return (!year || !c.year || c.year === year) && c.stage === stage && c.level === level && c.room === room; })[0] || null;
  }
  function byId(roster) {
    var m = {};
    if (roster) roster.classes.forEach(function (c) { c.students.forEach(function (s) { if (s.id) m[s.id] = { s: s, c: c }; }); });
    return m;
  }

  return { parseDocx: parseDocx, parseDocumentXml: parseDocumentXml, parseDate: parseDate, findClass: findClass, byId: byId };
});
