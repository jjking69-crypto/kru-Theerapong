/*
 * ตัวถอดข้อมูลไฟล์ ปพ.5 (โปรแกรม ปพ.5 ระดับประถมศึกษา แบบเก็บคะแนนตามตัวชี้วัด)
 * อ่านไฟล์ .xlsm / .xlsx ด้วย SheetJS แล้วแปลงเป็นข้อมูลรายนักเรียน
 *
 * หลักการ: หาหัวตารางจาก "ข้อความ" ในชีต (เช่น "ที่", "ชื่อ-สกุล", "คะแนนเก็บ")
 * ไม่ยึดตำแหน่งเซลล์ตายตัว เพื่อให้ยังอ่านได้แม้แต่ละไฟล์ต่างกันเล็กน้อย
 *
 * หมายเหตุเรื่องความเป็นส่วนตัว: จงใจ "ไม่อ่าน" เลขประจำตัวประชาชน
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PP5Parser = factory(root.XLSX);
})(typeof self !== 'undefined' ? self : this, function (XLSX) {
  'use strict';

  var ERR_RE = /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)$/;
  // ในไฟล์ใช้ฟอนต์ Wingdings 2: P = ✓ (ผ่าน), O = ✗ (ไม่ผ่าน)
  var TICK = { 'P': true, '✓': true, '✔': true, '/': true, 'ผ': true, 'ผ.': true, 'ผ่าน': true };
  var CROSS = { 'O': false, 'Q': false, 'x': false, 'X': false, '×': false, '✗': false, 'มผ': false, 'มผ.': false, 'ไม่ผ่าน': false };

  function enc(r, c) { return XLSX.utils.encode_cell({ r: r, c: c }); }

  function cell(ws, r, c) {
    var x = ws[enc(r, c)];
    if (!x || x.t === 'e' || x.t === 'z') return null;
    var v = x.v;
    if (typeof v === 'string') {
      v = v.replace(/\s+/g, ' ').trim();
      if (v === '' || ERR_RE.test(v)) return null;
    }
    return v;
  }

  function norm(v) { return v == null ? '' : String(v).replace(/\s+/g, ''); }

  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/,/g, '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return parseFloat(s);
  }

  function round(v, d) {
    if (v == null) return null;
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * p) / p;
  }

  function tick(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (s in TICK) return true;
    if (s in CROSS) return false;
    return null;
  }

  function bounds(ws) {
    return XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  }

  // คอลัมน์สุดท้ายก่อนส่วน "กราฟ" (ส่วนกราฟอยู่ด้านขวาของหลายชีต)
  function tableEnd(ws) {
    var b = bounds(ws), end = b.e.c;
    for (var c = 0; c <= b.e.c; c++) {
      var v = cell(ws, 0, c);
      if (typeof v === 'string' && v.indexOf('กราฟ') === 0) { end = c - 1; break; }
    }
    return end;
  }

  // หาเซลล์ที่ข้อความตรงกับ label ในช่วงแถว/คอลัมน์ที่กำหนด
  function findLabel(ws, label, r0, r1, c0, c1) {
    var want = norm(label);
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        if (norm(cell(ws, r, c)) === want) return { r: r, c: c };
      }
    }
    return null;
  }

  // หาหัวตารางนักเรียน: แถวที่มี "ที่" และถัดไปเป็น "ชื่อ-สกุล" (หนึ่งชีตอาจมีหลายบล็อกเรียงซ้าย-ขวา)
  function findBlocks(ws, maxRow) {
    var b = bounds(ws), end = tableEnd(ws), out = [];
    for (var r = 0; r <= Math.min(maxRow || 12, b.e.r); r++) {
      for (var c = 0; c <= end; c++) {
        if (norm(cell(ws, r, c)) === 'ที่' && norm(cell(ws, r, c + 1)).indexOf('ชื่อ') === 0) {
          out.push({ r: r, cNo: c, cName: c + 1 });
        }
      }
      if (out.length) return out;
    }
    return out;
  }

  // แถวข้อมูลนักเรียน: คอลัมน์ "ที่" เป็นตัวเลข และมีชื่อ
  // เลขที่ที่เป็นสูตร (=A6+1) ในไฟล์ที่ยังไม่เคยคำนวณจะว่าง: อนุมานต่อจากแถวก่อน
  function seqNo(ws, r, c, last) {
    var raw = cell(ws, r, c), no = num(raw);
    if (no != null) return no;
    if (raw == null && last != null && last < 60) return last + 1;
    return null;
  }
  function studentRows(ws, block) {
    var b = bounds(ws), rows = [], last = null;
    for (var r = block.r + 1; r <= b.e.r; r++) {
      var no = seqNo(ws, r, block.cNo, last);
      if (no == null && cell(ws, r, block.cNo) != null) last = null; else if (no != null) last = no;
      var name = cell(ws, r, block.cName);
      // จับคู่ด้วยเลขที่ ชื่ออาจว่างได้ (ไฟล์ที่ระบบสร้างแต่ยังไม่เคยเปิดคำนวณใน Excel)
      if (no != null) rows.push({ r: r, no: no, name: typeof name === 'string' ? name : '' });
    }
    return rows;
  }

  function sheet(wb, name) {
    if (wb.Sheets[name]) return wb.Sheets[name];
    var want = norm(name);
    for (var i = 0; i < wb.SheetNames.length; i++) {
      if (norm(wb.SheetNames[i]) === want) return wb.Sheets[wb.SheetNames[i]];
    }
    return null;
  }

  // ---------------- ตั้งค่า ----------------
  var SETTING_LABELS = {
    'ปีการศึกษา': 'year', 'โรงเรียน': 'school', 'ตำบล': 'subdistrict', 'อำเภอ': 'district',
    'จังหวัด': 'province', 'ชั้น': 'gradeName', 'ห้อง': 'room', 'กลุ่มสาระ': 'group',
    'รหัสวิชา': 'code', 'วิชา': 'subject', 'หน่วยกิต': 'credit', 'ประเภทวิชา': 'type',
    'คะแนนเก็บระหว่างภาคเรียน': 'maxCollect', 'คะแนนปลายภาค': 'maxFinal', 'ครูผู้สอน': 'teacher',
    'เวลาเรียน1ปีการศึกษา': 'hours', 'สังกัด:สพป./สพม./อื่นๆ': 'office'
  };

  function parseSettings(ws) {
    var meta = {}, b = bounds(ws);
    for (var r = 0; r <= Math.min(b.e.r, 50); r++) {
      for (var c = 0; c <= Math.min(b.e.c, 12); c++) {
        var key = SETTING_LABELS[norm(cell(ws, r, c))];
        if (!key || meta[key] != null) continue;
        for (var k = c + 1; k <= c + 4; k++) {
          var v = cell(ws, r, k);
          if (v != null) { meta[key] = v; break; }
        }
      }
    }
    return meta;
  }

  function normalizeMeta(meta) {
    var m = {};
    for (var k in meta) m[k] = meta[k];
    m.year = num(m.year);
    m.room = num(m.room) || 1;
    m.credit = num(m.credit);
    m.hours = num(m.hours);
    if (m.credit == null && m.hours) m.credit = m.hours / 40; // สูตรในไฟล์: หน่วยกิต = ชั่วโมง/40
    m.maxCollect = num(m.maxCollect);
    m.maxFinal = num(m.maxFinal);
    m.code = m.code ? String(m.code).replace(/\s+/g, '') : '';
    m.subject = m.subject ? String(m.subject) : '';

    var stage = 'ป', level = null;
    var g = m.gradeName ? String(m.gradeName) : '';
    if (/มัธยม/.test(g)) stage = 'ม';
    var mm = g.match(/(\d)/);
    if (mm) level = +mm[1];
    // สำรอง: เดาจากรหัสวิชา เช่น ส14101 -> ประถม (1) ปีที่ 4
    var cm = m.code.match(/^[ก-ฮ](\d)(\d)(\d)(\d\d)$/);
    if (cm) {
      if (level == null) level = +cm[2];
      if (!g) stage = cm[1] === '1' ? 'ป' : 'ม';
    }
    m.stage = stage;
    m.level = level;
    m.levelName = level ? stage + '.' + level : '';
    return m;
  }

  // ---------------- รายชื่อนักเรียน ----------------
  function parseRoster(ws) {
    var blocks = findBlocks(ws, 10);
    if (!blocks.length) {
      // ชีตรายชื่อใช้หัว "ที่ | เลขประจำตัวนักเรียน | ..."
      var h = findLabel(ws, 'ที่', 0, 10, 0, 2);
      if (!h) return {};
      blocks = [{ r: h.r, cNo: h.c }];
    }
    var hr = blocks[0].r, b = bounds(ws), cols = {};
    var map = { 'เลขประจำตัวนักเรียน': 'id', 'คำนำหน้า': 'prefix', 'ชื่อ': 'first', 'นามสกุล': 'last', 'เพศ': 'sex', 'สถานะ': 'status',
      'เลขประจำตัวประชาชน': 'nid', 'เลขประจำตัวประชาชน(4ตัวท้าย)': 'nid' };
    for (var c = 0; c <= Math.min(b.e.c, 15); c++) {
      var key = map[norm(cell(ws, hr, c))];
      if (key) cols[key] = c;
    }
    var out = {}, lastNo = null;
    for (var r = hr + 1; r <= b.e.r; r++) {
      var no = seqNo(ws, r, blocks[0].cNo, lastNo);
      if (no != null) lastNo = no;
      var first = cols.first != null ? cell(ws, r, cols.first) : null;
      if (no == null || !first) continue;
      var s = { no: no };
      for (var k in cols) {
        var v = cell(ws, r, cols[k]);
        s[k] = v == null ? '' : String(v);
      }
      // เก็บเฉพาะเลขบัตรประชาชน 4 ตัวท้าย (ใช้ยืนยันตัวตนผู้ปกครองในหน้าประกาศผล)
      if (s.nid != null) { var d = s.nid.replace(/\D/g, ''); s.nid4 = d.length >= 4 ? d.slice(-4) : ''; delete s.nid; }
      out[no] = s;
    }
    return out;
  }

  // ---------------- มาตรฐาน ----------------
  function parseStandards(ws) {
    var out = [];
    if (!ws) return out;
    var h = findLabel(ws, 'มาตรฐานที่', 0, 10, 0, 60);
    if (!h) return out;
    var b = bounds(ws);
    for (var c = 0; c <= b.e.c; c++) {
      if (norm(cell(ws, h.r, c)) !== 'มาตรฐานที่') continue;
      for (var r = h.r + 1; r <= b.e.r; r++) {
        var code = cell(ws, r, c), text = cell(ws, r, c + 1);
        var no = cell(ws, r, c - 1);   // เลขข้อเป็นสูตร: ไฟล์ที่ยังไม่ได้เปิดใน Excel จะว่าง
        if (no != null && no !== '' && num(no) == null) continue;
        if (code) out.push({ code: String(code).trim(), text: text ? String(text) : '' });
      }
    }
    return out;
  }

  // ---------------- ตัวชี้วัด (คำอธิบาย) ----------------
  function parseIndicatorTexts(ws) {
    var out = {};
    if (!ws) return out;
    var b = bounds(ws), hr = null;
    for (var r = 0; r <= 10 && hr == null; r++) {
      for (var c = 0; c <= b.e.c; c++) {
        if (norm(cell(ws, r, c)) === 'ที่' && norm(cell(ws, r, c + 1)) === 'ภาคเรียนที่') { hr = r; break; }
      }
    }
    if (hr == null) return out;
    var starts = [];
    for (var c2 = 0; c2 <= b.e.c; c2++) if (norm(cell(ws, hr, c2)) === 'ที่') starts.push(c2);
    starts.forEach(function (s, i) {
      var end = i + 1 < starts.length ? starts[i + 1] - 1 : b.e.c;
      var col = {};
      for (var c = s; c <= end; c++) {
        var t = norm(cell(ws, hr, c));
        if (t === 'ภาคเรียนที่') col.term = c;
        else if (t === 'มาตรฐานที่') col.std = c;
        else if (t === 'ตัวชี้วัดที่') col.code = c;
        else if (t === 'ตัวชี้วัด') col.text = c;
      }
      var lastIdx = null;
      for (var r = hr + 1; r <= b.e.r; r++) {
        var idx = seqNo(ws, r, s, lastIdx);
        if (idx != null) lastIdx = idx;
        if (idx == null) continue;
        var text = col.text != null ? cell(ws, r, col.text) : null;
        var code = col.code != null ? cell(ws, r, col.code) : null;
        if (!text && !code) continue;
        out[idx] = {
          term: col.term != null ? num(cell(ws, r, col.term)) : null,
          std: col.std != null ? String(cell(ws, r, col.std) || '').trim() : '',
          code: code ? String(code).trim() : '',
          text: text ? String(text) : ''
        };
      }
    });
    return out;
  }

  // ---------------- คะแนนเก็บตามตัวชี้วัด / ประเมินตัวชี้วัด ----------------
  // ทั้งสองชีตมีหัวตารางแบบเดียวกัน: ลำดับที่ / ภาคเรียนที่ / มาตรฐาน / ตัวชี้วัด / (คะแนนเต็ม) / คะแนน
  function indicatorGrid(ws, withPass) {
    var res = { indicators: [], byNo: {} };
    if (!ws) return res;
    var blocks = findBlocks(ws, 10);
    blocks.forEach(function (bk, i) {
      var cLab = bk.cName + 1;
      if (norm(cell(ws, bk.r, cLab)) !== 'ลำดับที่') return;
      var rows = {};
      for (var r = bk.r; r <= bk.r + 8; r++) {
        var t = norm(cell(ws, r, cLab));
        if (t === 'ลำดับที่') rows.idx = r;
        else if (t === 'ภาคเรียนที่') rows.term = r;
        else if (t === 'มาตรฐาน') rows.std = r;
        else if (t === 'ตัวชี้วัด') rows.code = r;
        else if (t === 'คะแนนเต็ม') rows.max = r;
        else if (t === 'คะแนน') rows.score = r;
      }
      if (rows.idx == null) return;
      var end = i + 1 < blocks.length ? blocks[i + 1].cNo - 1 : tableEnd(ws);
      var students = studentRows(ws, bk);
      if (!students.length && i > 0) students = studentRows(ws, blocks[0]); // เลขที่ของบล็อกถัดไปเป็นสูตร (=A9)
      for (var c = cLab + 1; c <= end; c++) {
        var idx = num(cell(ws, rows.idx, c));
        if (idx == null) continue;
        var code = rows.code != null ? cell(ws, rows.code, c) : null;
        var max = rows.max != null ? num(cell(ws, rows.max, c)) : null;
        if (!code && max == null) continue; // ช่องที่ไม่ได้ใช้
        var ind = {
          idx: idx,
          term: rows.term != null ? num(cell(ws, rows.term, c)) : null,
          std: rows.std != null ? String(cell(ws, rows.std, c) || '').trim() : '',
          code: code ? String(code).trim() : '',
          max: max
        };
        res.indicators.push(ind);
        // คอลัมน์ "ผ" (ผ่าน) อยู่ทางขวาของคอลัมน์ "ได้"
        var passCol = null;
        if (withPass && rows.score != null) {
          for (var k = c + 1; k <= c + 2; k++) if (norm(cell(ws, rows.score, k)) === 'ผ') { passCol = k; break; }
        }
        students.forEach(function (s) {
          var v = num(cell(ws, s.r, c));
          var st = res.byNo[s.no] || (res.byNo[s.no] = { name: s.name, vals: {} });
          if (withPass) st.vals[idx] = { level: v, pass: passCol != null ? tick(cell(ws, s.r, passCol)) : null };
          else st.vals[idx] = v;
        });
      }
    });
    // ไฟล์ที่ยังไม่เคยคำนวณ: หัวบล็อกถัดไปเป็นสูตร (ว่าง) -> หาคอลัมน์ตัวชี้วัดจากแถวคะแนนเต็มแทน
    if (!withPass && blocks.length && blocks[0].cNo === 0) {
      var bk0 = blocks[0], rowsLab = {}, maxRow = null, scoreRow = null;
      for (var rr = bk0.r; rr <= bk0.r + 8; rr++) {
        var tl = norm(cell(ws, rr, bk0.cName + 1));
        if (tl === 'คะแนนเต็ม') maxRow = rr;
        if (tl === 'คะแนน') scoreRow = rr;
      }
      var have = {};
      res.indicators.forEach(function (i) { have[i.idx] = 1; });
      var stud0 = studentRows(ws, bk0), width = bounds(ws).e.c;
      if (maxRow != null) for (var c2 = 27; c2 <= width; c2++) {
        var mx = num(cell(ws, maxRow, c2));
        var off = c2 % 27;
        if (mx == null || off < 3 || (off - 3) % 3) continue;
        var idx2 = Math.floor(c2 / 27) * 8 + (off - 3) / 3 + 1;
        if (have[idx2]) continue;
        res.indicators.push({ idx: idx2, term: null, std: '', code: '', max: mx });
        stud0.forEach(function (s) {
          var st = res.byNo[s.no] || (res.byNo[s.no] = { name: s.name, vals: {} });
          st.vals[idx2] = num(cell(ws, s.r, c2));
        });
      }
      void rowsLab; void scoreRow;
    }
    res.indicators.sort(function (a, b) { return a.idx - b.idx; });
    return res;
  }

  // ---------------- ประเมินผลการเรียน ----------------
  function parseResults(ws) {
    var out = { max: {}, byNo: {} };
    if (!ws) return out;
    var blocks = findBlocks(ws, 6);
    if (!blocks.length) return out;
    var bk = blocks[0], end = tableEnd(ws), r0 = bk.r, col = {};
    function lab(t, from) {
      var f = findLabel(ws, t, r0, r0 + 2, from || 0, end);
      return f ? f.c : null;
    }
    col.indTotal = lab('รวมคะแนนตัวชี้วัด');
    col.collect = lab('คะแนนเก็บ');
    col.final = lab('ปลายภาค');
    col.mid = lab('ข้อสอบกลาง');
    col.total = col.final != null ? lab('รวม', col.final) : lab('รวม');
    col.rms = lab('ผลการเรียนร,มส');
    col.grade = lab('ผลการเรียน(เกรด)');
    var sum = lab('สรุปผลการประเมิน');
    var pass = sum != null ? findLabel(ws, 'ผ่าน', r0, r0 + 3, sum, sum + 3) : null;
    var fail = sum != null ? findLabel(ws, 'ไม่ผ่าน', r0, r0 + 3, sum, sum + 4) : null;
    // แถวคะแนนเต็ม = แถวที่อยู่ก่อนแถว "คะแนน / ได้"
    var scoreRow = findLabel(ws, 'คะแนน', r0, r0 + 6, bk.cName, bk.cName + 2);
    if (scoreRow) {
      ['indTotal', 'collect', 'final', 'mid', 'total'].forEach(function (k) {
        if (col[k] != null) out.max[k] = num(cell(ws, scoreRow.r - 1, col[k]));
      });
    }
    studentRows(ws, bk).forEach(function (s) {
      var g = col.grade != null ? cell(ws, s.r, col.grade) : null;
      var rms = col.rms != null ? cell(ws, s.r, col.rms) : null;
      var p = null;
      if (pass && tick(cell(ws, s.r, pass.c)) != null) p = true;
      if (fail && tick(cell(ws, s.r, fail.c)) != null) p = false;
      out.byNo[s.no] = {
        name: s.name,
        indTotal: col.indTotal != null ? num(cell(ws, s.r, col.indTotal)) : null,
        collect: col.collect != null ? num(cell(ws, s.r, col.collect)) : null,
        final: col.final != null ? num(cell(ws, s.r, col.final)) : null,
        mid: col.mid != null ? num(cell(ws, s.r, col.mid)) : null,
        total: col.total != null ? num(cell(ws, s.r, col.total)) : null,
        rms: rms ? String(rms) : '',
        grade: g == null ? '' : String(g),
        pass: p
      };
    });
    return out;
  }

  // ---------------- สรุปเวลาเรียน ----------------
  function parseAttendance(ws) {
    var out = { hours: {}, byNo: {} };
    if (!ws) return out;
    var blocks = findBlocks(ws, 6);
    if (!blocks.length) return out;
    var bk = blocks[0], end = tableEnd(ws), r0 = bk.r;
    var groups = { t1: 'ภาคเรียนที่1', t2: 'ภาคเรียนที่2', year: 'รวม1ปีการศึกษา' };
    var gc = {};
    for (var k in groups) {
      var f = findLabel(ws, groups[k], r0, r0, 0, end);
      if (f) { gc[k] = f.c; out.hours[k] = num(cell(ws, r0 + 1, f.c + 3)); }
    }
    var res = findLabel(ws, 'ผลการประเมิน', r0, r0, 0, end);
    studentRows(ws, bk).forEach(function (s) {
      var a = {};
      for (var k in gc) {
        var c = gc[k];
        a[k] = {
          sick: num(cell(ws, s.r, c)), leave: num(cell(ws, s.r, c + 1)), absent: num(cell(ws, s.r, c + 2)),
          present: num(cell(ws, s.r, c + 3)), pct: round(num(cell(ws, s.r, c + 4)), 2)
        };
      }
      a.result = res ? String(cell(ws, s.r, res.c) || '') : '';
      out.byNo[s.no] = a;
    });
    return out;
  }

  // ---------------- สรุปประเมินตัวชี้วัด ----------------
  function parseIndicatorSummary(ws) {
    var out = { byNo: {} };
    if (!ws) return out;
    var blocks = findBlocks(ws, 6);
    if (!blocks.length) return out;
    var bk = blocks[0], end = tableEnd(ws), r0 = bk.r;
    var yr = findLabel(ws, 'รวม1ปีการศึกษา', r0, r0, 0, end);
    var res = findLabel(ws, 'ผลการประเมิน', r0, r0, 0, end);
    if (!yr) return out;
    var failC = findLabel(ws, 'ไม่ผ่าน', r0, r0 + 4, yr.c + 1, yr.c + 6);
    var totRow = findLabel(ws, 'ผ่าน', r0, r0 + 4, yr.c, yr.c);
    out.total = totRow ? num(cell(ws, totRow.r - 1, yr.c)) : null;
    studentRows(ws, bk).forEach(function (s) {
      out.byNo[s.no] = {
        pass: num(cell(ws, s.r, yr.c)),
        fail: failC ? num(cell(ws, s.r, failC.c)) : null,
        result: res ? String(cell(ws, s.r, res.c) || '') : ''
      };
    });
    return out;
  }

  // ---------------- คุณลักษณะอันพึงประสงค์ ----------------
  function parseCharacteristics(ws, listWs) {
    var out = { items: [], byNo: {} };
    if (!ws) return out;
    var names = {};
    if (listWs) {
      var lb = bounds(listWs);
      for (var r = 0; r <= lb.e.r; r++) {
        var n = num(cell(listWs, r, 0)), t = cell(listWs, r, 1);
        if (n != null && t) names[n] = String(t);
      }
    }
    var blocks = findBlocks(ws, 6);
    if (!blocks.length) return out;
    var bk = blocks[0], end = tableEnd(ws), r0 = bk.r;
    var avg = findLabel(ws, 'คะแนนเฉลี่ย', r0, r0, 0, end);
    var lvl = findLabel(ws, 'ผลการประเมิน', r0, r0, 0, end);
    var tot = findLabel(ws, 'รวม', r0, r0, 0, end);
    var stop = tot ? tot.c : end;
    // แถวหมายเลขข้อ = r0+1, แถวคะแนนเต็ม = แถวที่มีตัวเลขใต้ "เต็ม"
    var fullRow = findLabel(ws, 'เต็ม', r0, r0 + 4, bk.cName + 1, stop);
    var maxRow = fullRow ? fullRow.r + 1 : r0 + 3;
    for (var c = bk.cName + 1; c < stop; c++) {
      var no = num(cell(ws, r0 + 1, c));
      var mx = num(cell(ws, maxRow, c));
      if (no != null && mx != null) out.items.push({ no: no, col: c, max: mx, name: names[no] || ('ข้อ ' + no) });
    }
    studentRows(ws, bk).forEach(function (s) {
      var items = {};
      out.items.forEach(function (it) { items[it.no] = num(cell(ws, s.r, it.col)); });
      var text = '';
      if (lvl) for (var k = lvl.c + 1; k <= lvl.c + 3; k++) {
        var v = cell(ws, s.r, k);
        if (typeof v === 'string' && !/^\d/.test(v)) { text = v; break; }
      }
      out.byNo[s.no] = {
        items: items,
        avg: avg ? round(num(cell(ws, s.r, avg.c)), 2) : null,
        level: lvl ? num(cell(ws, s.r, lvl.c)) : null,
        text: text
      };
    });
    out.items.forEach(function (it) { delete it.col; });
    return out;
  }

  // ---------------- อ่าน คิดวิเคราะห์ เขียน ----------------
  function parseRTW(ws) {
    var out = { byNo: {} };
    if (!ws) return out;
    var blocks = findBlocks(ws, 6);
    if (!blocks.length) return out;
    var bk = blocks[0], end = tableEnd(ws), r0 = bk.r;
    var terms = {};
    ['t1', 't2'].forEach(function (k, i) {
      var f = findLabel(ws, 'ภาคเรียนที่' + (i + 1), r0, r0 + 2, 0, end);
      if (!f) return;
      var cols = {}, map = { 'อ่าน': 'read', 'คิด': 'think', 'เขียน': 'write', 'เฉลี่ย': 'avg' };
      for (var r = f.r; r <= f.r + 3; r++) for (var c = f.c; c <= f.c + 8; c++) {
        var key = map[norm(cell(ws, r, c))];
        if (key && cols[key] == null) cols[key] = c;
      }
      terms[k] = cols;
    });
    var avgs = [];
    for (var c = 0; c <= end; c++) if (norm(cell(ws, r0, c)) === 'คะแนนเฉลี่ย') avgs.push(c);
    var yearAvg = avgs.length > 1 ? avgs[avgs.length - 1] : null;
    var lvl = findLabel(ws, 'ผลการประเมิน', r0, r0, 0, end);
    var sum = findLabel(ws, 'สรุปผลการประเมิน', r0, r0, 0, end);
    var sumCols = [];
    if (sum) ['ดีเยี่ยม', 'ดี', 'ผ่าน', 'ไม่ผ่าน'].forEach(function (t) {
      var f = findLabel(ws, t, r0 + 1, r0 + 3, sum.c, sum.c + 8);
      if (f) sumCols.push({ c: f.c, t: t });
    });
    var raw = parseRTWRaw(wbRef);
    studentRows(ws, bk).forEach(function (s) {
      var o = {};
      for (var k in terms) {
        o[k] = {};
        for (var j in terms[k]) o[k][j] = round(num(cell(ws, s.r, terms[k][j])), 2);
      }
      o.avg = yearAvg != null ? round(num(cell(ws, s.r, yearAvg)), 2) : null;
      // สรุปยังไม่ได้คำนวณ: ใช้ค่าเฉลี่ยจากชีตประเมินการอ่าน/การคิด/การเขียน
      var rw = raw[s.no];
      if (rw) ['t1', 't2'].forEach(function (t) {
        o[t] = o[t] || {};
        ['read', 'think', 'write'].forEach(function (k) { if (o[t][k] == null && rw[t] && rw[t][k] != null) o[t][k] = rw[t][k]; });
      });
      o.level = lvl ? num(cell(ws, s.r, lvl.c)) : null;
      o.text = '';
      sumCols.forEach(function (x) { if (tick(cell(ws, s.r, x.c)) === true) o.text = x.t; });
      out.byNo[s.no] = o;
    });
    return out;
  }

  // ชีตประเมินการอ่าน / การคิด / การเขียน: ค่าเฉลี่ยของครั้งที่ประเมินในแต่ละภาค
  var wbRef = null;
  function parseRTWRaw(wb) {
    var out = {};
    if (!wb) return out;
    [['ประเมินการอ่าน', 'read'], ['ประเมินการคิด', 'think'], ['ประเมินการเขียน', 'write']].forEach(function (p) {
      var ws = sheet(wb, p[0]);
      if (!ws) return;
      var blocks = findBlocks(ws, 6);
      if (!blocks.length) return;
      var bk = blocks[0], terms = [];
      ['ภาคเรียนที่1', 'ภาคเรียนที่2'].forEach(function (lab, ti) {
        var f = findLabel(ws, lab, bk.r, bk.r + 2, 0, 40);
        if (!f) return;
        var cols = [];
        for (var c = f.c; c <= f.c + 12; c++) {
          var t = norm(cell(ws, f.r + 1, c));
          if (t === 'เฉลี่ย') break;
          if (cell(ws, f.r + 3, c) != null || norm(cell(ws, f.r + 3, c)) === 'ได้') cols.push(c);
        }
        terms.push({ t: 't' + (ti + 1), cols: cols.filter(function (c) { return norm(cell(ws, f.r + 3, c)) === 'ได้'; }) });
      });
      studentRows(ws, bk).forEach(function (s) {
        terms.forEach(function (t) {
          var vals = t.cols.map(function (c) { return num(cell(ws, s.r, c)); }).filter(function (v) { return v != null; });
          if (!vals.length) return;
          var o = out[s.no] = out[s.no] || {};
          (o[t.t] = o[t.t] || {})[p[1]] = round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length, 2);
        });
      });
    });
    return out;
  }

  // ---------------- กิจกรรมพัฒนาผู้เรียน ----------------
  function parseActivities(ws) {
    var out = { byNo: {} };
    if (!ws) return out;
    var blocks = findBlocks(ws, 6);
    if (!blocks.length) return out;
    var bk = blocks[0], b = bounds(ws), r0 = bk.r;
    var sum = findLabel(ws, 'สรุปผล', r0, r0, 0, b.e.c);
    var club = findLabel(ws, 'ชื่อชุมนุม', r0, r0 + 3, 0, b.e.c);
    var acts = [];
    if (sum) {
      var map = { 'แนะแนว': 'guidance', 'ลูกเสือ-เนตรนารี': 'scout', 'ชุมนุม': 'club', 'กิจกรรมเพื่อสังคม': 'social' };
      for (var c = sum.c; c <= sum.c + 6; c++) {
        var key = map[norm(cell(ws, r0 + 1, c))];
        if (key) acts.push({ key: key, c: c });
      }
    }
    // ชั่วโมงที่เข้าร่วม (ใช้เมื่อช่องสรุปผลยังไม่ได้คำนวณ): หัว "จำนวนชั่วโมง" แถว r0+2 / ชั่วโมงเต็ม แถว r0+3
    var hourCols = [];
    for (var hc = 0; hc <= b.e.c && hourCols.length < 4; hc++) if (norm(cell(ws, r0 + 2, hc)) === 'จำนวนชั่วโมง') hourCols.push({ c: hc, max: num(cell(ws, r0 + 3, hc)) });
    var keys = ['guidance', 'scout', 'club', 'social'];
    studentRows(ws, bk).forEach(function (s) {
      var o = { clubName: club ? String(cell(ws, s.r, club.c) || '') : '' };
      acts.forEach(function (a) { o[a.key] = String(cell(ws, s.r, a.c) || ''); });
      hourCols.forEach(function (h, i) {
        var k = keys[i];
        if (o[k] || !h.max) return;
        var v = num(cell(ws, s.r, h.c));
        if (v != null) o[k] = v / h.max * 100 >= 80 ? 'ผ.' : 'มผ.';
      });
      out.byNo[s.no] = o;
    });
    return out;
  }

  // ---------------- รวมทุกอย่าง ----------------
  function parseWorkbook(wb) {
    wbRef = wb;
    var setWs = sheet(wb, 'ตั้งค่า');
    if (!setWs || !sheet(wb, 'คะแนนเก็บตามตัวชี้วัด')) {
      throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ ปพ.5 แบบเก็บคะแนนตามตัวชี้วัด (ไม่พบชีต "ตั้งค่า" หรือ "คะแนนเก็บตามตัวชี้วัด")');
    }
    var meta = normalizeMeta(parseSettings(setWs));
    if (!meta.code && !meta.subject) throw new Error('ไม่พบรหัสวิชา/ชื่อวิชาในชีต "ตั้งค่า"');
    if (!meta.level) throw new Error('ไม่พบชั้นเรียนในชีต "ตั้งค่า"');

    var roster = parseRoster(sheet(wb, 'รายชื่อนักเรียน'));
    var texts = parseIndicatorTexts(sheet(wb, 'ตัวชี้วัด'));
    var scores = indicatorGrid(sheet(wb, 'คะแนนเก็บตามตัวชี้วัด'), false);
    var levels = indicatorGrid(sheet(wb, 'ประเมินตัวชี้วัด'), true);
    var results = parseResults(sheet(wb, 'ประเมินผลการเรียน'));
    var att = parseAttendance(sheet(wb, 'สรุปเวลาเรียน'));
    var indSum = parseIndicatorSummary(sheet(wb, 'สรุปประเมินตัวชี้วัด'));
    var chars = parseCharacteristics(sheet(wb, 'ประเมินคุณลักษณะ'), sheet(wb, 'คุณลักษณะอันพึงประสงค์'));
    var rtw = parseRTW(sheet(wb, 'สรุปประเมินอ่านคิดเขียน'));
    var acts = parseActivities(sheet(wb, 'ประเมินกิจกรรมพัฒนาผู้เรียน'));

    var indicators = scores.indicators.map(function (ind) {
      var t = texts[ind.idx] || {};
      return {
        idx: ind.idx, term: ind.term != null ? ind.term : t.term, std: ind.std || t.std || '',
        code: ind.code || t.code || '', text: t.text || '', max: ind.max
      };
    });

    // รายชื่อหลัก: ใช้ชีตรายชื่อ ถ้าไม่มีใช้ชื่อจากชีตคะแนน
    var nos = {};
    Object.keys(roster).forEach(function (n) { nos[n] = 1; });
    Object.keys(scores.byNo).forEach(function (n) { nos[n] = 1; });
    var students = Object.keys(nos).map(Number).sort(function (a, b) { return a - b; }).map(function (no) {
      var ro = roster[no] || {};
      var sc = scores.byNo[no] || { vals: {} };
      var fullName = ro.first ? ((ro.prefix || '') + ro.first + ' ' + (ro.last || '')).trim() : (sc.name || '').replace(/\s+/g, ' ');
      var filled = indicators.filter(function (i) { return sc.vals[i.idx] != null; }).length;
      return {
        no: no, id: ro.id || '', nid4: ro.nid4 || '', prefix: ro.prefix || '', first: ro.first || '', last: ro.last || '',
        name: fullName, sex: ro.sex || '', status: ro.status || '',
        scores: sc.vals, levels: (levels.byNo[no] || {}).vals || {},
        filled: filled,
        result: results.byNo[no] || null,
        attendance: att.byNo[no] || null,
        indSummary: indSum.byNo[no] || null,
        characteristics: chars.byNo[no] || null,
        rtw: rtw.byNo[no] || null,
        activities: acts.byNo[no] || null
      };
    }).filter(function (s) { return s.name; });

    return {
      format: 'pp5-indicator', version: 1,
      meta: meta,
      indicators: indicators,
      standards: parseStandards(sheet(wb, 'มาตรฐาน')),
      characteristicItems: chars.items,
      maxima: results.max,
      hours: att.hours,
      indicatorTotal: indSum.total || indicators.length,
      students: students
    };
  }

  function parseArrayBuffer(buf) {
    var wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false });
    return parseWorkbook(wb);
  }

  return { parseWorkbook: parseWorkbook, parseArrayBuffer: parseArrayBuffer, normalizeMeta: normalizeMeta };
});
