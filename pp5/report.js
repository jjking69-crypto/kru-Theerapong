/* ใบรายงานผลการเรียนรายบุคคล (ปพ.6): แสดงตัวอย่าง พิมพ์ และดาวน์โหลด PDF (รวม / แยกรายคน, A4 / ครึ่ง A4) */
(function () {
  'use strict';

  var CHAR_PASS = ['ดีเยี่ยม', 'ดี', 'ผ่าน'];
  var LIBS = ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jszip.min.js'];
  var ctx = null;     // ตัวช่วยจาก app.js
  var busyRun = false;

  function esc(v) { return ctx.esc(v); }
  function dash(v, d) {
    if (v == null || v === '') return '–';
    if (typeof v === 'number') return d != null ? v.toFixed(d) : String(Math.round(v * 100) / 100);
    return esc(v);
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ''); }

  // ---------- การคำนวณ (สูตรเดียวกับไฟล์ ปพ.6) ----------
  function gradeOf(pct) {
    if (pct == null) return null;
    if (pct >= 80) return 4; if (pct >= 75) return 3.5; if (pct >= 70) return 3; if (pct >= 65) return 2.5;
    if (pct >= 60) return 2; if (pct >= 55) return 1.5; if (pct >= 50) return 1; return 0;
  }
  function bmiText(b) {
    if (b == null) return '';
    if (b >= 30) return 'โรคอ้วนระดับที่ 2'; if (b >= 25) return 'โรคอ้วนระดับที่ 1'; if (b >= 23) return 'น้ำหนักเกิน';
    if (b >= 18.5) return 'อยู่ในเกณฑ์ปกติ'; return 'น้ำหนักน้อยหรือผอม';
  }
  function bmi(w, h) { return w && h ? w / Math.pow(h / 100, 2) : null; }

  function defaults(d) {
    var s = d.meta.signers || {};
    var hasT2 = d.students.some(function (st) { return Object.keys(st.t2 || {}).some(function (k) { return st.t2[k]; }); });
    return {
      paper: 'a4', showLogo: true, showSign: true, gradeMode: hasT2 ? 'year' : 'term1',
      school: d.meta.school || '',
      teacher: { name: (s.teacher && s.teacher.name) || d.meta.teacher || '', position: 'ครูประจำชั้น', img: 'teacher' },
      deputy: { name: (s.deputy && s.deputy.name) || '', position: (s.deputy && s.deputy.position) || 'รองผู้อำนวยการโรงเรียน', img: 'deputy' },
      director: { name: (s.director && s.director.name) || '', position: (s.director && s.director.position) || 'ผู้อำนวยการโรงเรียน', img: 'director' },
      logo: 'logo'
    };
  }
  function settingsOf(rec) {
    var def = defaults(rec.data), s = rec.settings || {};
    var out = Object.assign({}, def, s);
    ['teacher', 'deputy', 'director'].forEach(function (k) { out[k] = Object.assign({}, def[k], s[k] || {}); });
    return out;
  }
  function imgOf(rec, key) {
    if (!key) return null;
    var d = rec.data;
    if (/^#\d+$/.test(key)) return d.allImages[+key.slice(1)] || null;
    return d.images[key] || null;
  }

  // ข้อมูลตัวชี้วัด/กิจกรรมจากไฟล์ ปพ.5 ของห้องเดียวกัน (ถ้าอัปโหลดไว้)
  function pp5Lookup() {
    var map = {};
    ctx.classRecords().forEach(function (r) {
      var code = r.data.meta.code;
      r.data.students.forEach(function (s) {
        var k = s.id ? 'id:' + s.id : 'nm:' + norm(s.name);
        (map[k] = map[k] || {})[code] = s;
      });
    });
    return map;
  }

  function computeAll(rec, st) {
    var d = rec.data, max = d.meta.termMax || 50, lookup = pp5Lookup();
    var list = d.students.map(function (s) {
      var p5 = lookup['id:' + s.id] || lookup['nm:' + norm(s.name)] || {};
      var rows = d.subjects.map(function (sub) {
        var a = s.t1[sub.code], b = s.t2[sub.code];
        var t1 = a ? a.total : null, t2 = b ? b.total : null, total = null, pct = null, basis = '';
        if (t1 != null && t2 != null) { total = t1 + t2; pct = total; basis = 'year'; }
        else if (t1 != null && st.gradeMode === 'term1') { pct = t1 / max * 100; basis = 'term1'; }
        var g = gradeOf(pct);
        var pr = p5[sub.code];
        if (pr && pr.result && pr.result.rms) g = pr.result.rms; // ร / มส จาก ปพ.5
        return { sub: sub, t1: t1, t2: t2, total: total, pct: pct, grade: g, basis: basis };
      });
      var cr = 0, gp = 0, pp = 0, complete = true;
      rows.forEach(function (r) {
        if (typeof r.grade !== 'number' || !r.sub.credit) { if (r.sub.credit) complete = false; return; }
        cr += r.sub.credit; gp += r.grade * r.sub.credit; pp += r.pct * r.sub.credit;
      });
      var gpa = cr ? gp / cr : null, pct = cr ? pp / cr : null;

      var att = s.attendance && s.attendance.year, attPct = att ? att.pct : null;
      var ind = Object.keys(d.indicatorTable).map(function (name) {
        var base = d.indicatorTable[name];
        var sub = d.subjects.filter(function (x) { return norm(x.name) === name; })[0];
        var pr = sub && p5[sub.code];
        if (pr && pr.indSummary && pr.indSummary.pass != null) {
          var tot = (pr.indSummary.pass || 0) + (pr.indSummary.fail || 0);
          return { name: sub ? sub.name : name, total: tot, passed: pr.indSummary.pass, src: 'pp5' };
        }
        return { name: sub ? sub.name : name, total: base.total, passed: base.passed, src: 'pp6' };
      });
      var indTot = ind.reduce(function (a, x) { return a + (x.total || 0); }, 0);
      var indPassed = ind.reduce(function (a, x) { return a + (x.passed || 0); }, 0);

      var act = null;
      Object.keys(p5).some(function (k) { var a = p5[k].activities; if (a && (a.guidance || a.scout)) { act = a; return true; } return false; });
      var actDefault = attPct == null ? '' : attPct >= 80 ? 'ผ่าน' : 'ไม่ผ่าน';
      function actText(v) { return !v ? actDefault : /^ผ/.test(v) ? 'ผ่าน' : /^มผ/.test(v) ? 'ไม่ผ่าน' : v; }
      var acts = [
        ['กิจกรรมแนะแนว', actText(act && act.guidance)],
        ['กิจกรรมลูกเสือ - เนตรนารี', actText(act && act.scout)],
        ['กิจกรรมชุมนุม' + (act && act.clubName ? ' (' + act.clubName + ')' : ''), actText(act && act.club)],
        ['กิจกรรมเพื่อสังคมและสาธารณประโยชน์', actText(act && act.social)]
      ];

      var gradesKnown = rows.every(function (r) { return r.grade != null; });
      var minPass = gradesKnown ? rows.every(function (r) { return typeof r.grade === 'number' && r.grade >= 1; }) : null;
      var res = {
        att: attPct == null ? null : attPct >= 80,
        ind: indTot ? indPassed >= indTot : null,
        grade: minPass,
        rtw: s.rtw && s.rtw.result ? s.rtw.result !== 'ไม่ผ่าน' : null,
        chars: s.characteristics && s.characteristics.summary ? CHAR_PASS.indexOf(s.characteristics.summary) >= 0 : null,
        acts: acts.every(function (a) { return a[1] === 'ผ่าน'; }) ? true : acts.some(function (a) { return a[1] === 'ไม่ผ่าน'; }) ? false : null
      };
      var vals = Object.keys(res).map(function (k) { return res[k]; });
      var promote = vals.indexOf(false) >= 0 ? false : vals.indexOf(null) >= 0 ? null : true;
      // ยังไม่มีคะแนนภาค 2: ยังไม่ตัดสินเลื่อนชั้น
      if (rows.some(function (r) { return r.basis === 'term1'; })) promote = null;

      return {
        s: s, rows: rows, gpa: gpa, pct: pct, complete: complete, attPct: attPct, att: att,
        ind: ind, indTot: indTot, indPassed: indPassed, acts: acts, res: res, promote: promote
      };
    });
    // อันดับตามเกรดเฉลี่ย (แบบ RANK ของ Excel)
    list.forEach(function (x) {
      x.rank = x.gpa == null ? null : 1 + list.filter(function (y) { return y.gpa != null && Math.round(y.gpa * 1e6) > Math.round(x.gpa * 1e6); }).length;
    });
    list.count = list.filter(function (x) { return x.gpa != null; }).length;
    return list;
  }

  // ---------- สร้างหน้ากระดาษ ----------
  function cb(on) { return '<span class="rc-cb' + (on ? ' on' : '') + '"></span>'; }
  function pf(v, yes, no) { return '<span class="op">' + cb(v === true) + yes + '</span><span class="op">' + cb(v === false) + no + '</span>'; }

  function sign(rec, st, who, label) {
    var p = st[who], img = st.showSign ? imgOf(rec, p.img) : null;
    return '<div class="rc-sign"><div class="sig">' + (img ? '<img src="' + img + '" alt="">' : '') + '</div>' +
      '<div class="ln">ลงชื่อ.......................................................' + (label || '') + '</div>' +
      '<div>(' + esc(p.name || '.......................................................') + ')</div>' +
      (p.position ? '<div>ตำแหน่ง ' + esc(p.position) + '</div>' : '') + '</div>';
  }

  function header(rec, st, x, title) {
    var m = rec.data.meta, logo = st.showLogo ? imgOf(rec, st.logo) : null;
    return '<div class="rc-head">' + (logo ? '<img class="rc-logo" src="' + logo + '" alt="">' : '') +
      '<span class="rc-tag">ปพ.6</span><p class="rc-title">' + esc(title) + '</p>' +
      '<div class="rc-sub">' + esc(st.school) + ' · ปีการศึกษา ' + esc(m.year) + ' · ชั้น' + esc(m.className) + '</div>' +
      '<div class="rc-who"><span>ชื่อ <b>' + esc(x.s.name) + '</b></span><span>เลขที่ <b>' + esc(x.s.no) + '</b></span>' +
      (x.s.id ? '<span>เลขประจำตัวนักเรียน <b>' + esc(x.s.id) + '</b></span>' : '') + '</div></div>';
  }

  function page1(rec, st, x, total) {
    var d = rec.data, max = d.meta.termMax || 50;
    var h = '<div class="rc-page">' + header(rec, st, x, 'รายงานการพัฒนาคุณภาพผู้เรียนรายบุคคล');
    h += '<h4>1. เวลาเรียนตลอดปีการศึกษา ไม่น้อยกว่าร้อยละ 80</h4><div class="rc-line">' + pf(x.res.att, 'ผ่านเกณฑ์', 'ไม่ผ่านเกณฑ์') +
      '<span>มาเรียน ' + dash(x.att && x.att.present) + ' จาก ' + dash(x.att && x.att.total) + ' ชั่วโมง (ร้อยละ ' + dash(x.attPct, 2) + ')</span></div>';
    var termNote = st.gradeMode === 'term1' && x.rows.some(function (r) { return r.basis === 'term1'; });
    h += '<h4>2. ผลการเรียนรายวิชา</h4><table class="rc-t"><thead><tr><th rowspan="2" style="width:17mm">รหัสวิชา</th><th rowspan="2" class="l">รายวิชา</th><th rowspan="2" style="width:15mm">หน่วยกิต</th>' +
      '<th>ภาคเรียนที่ 1</th><th>ภาคเรียนที่ 2</th><th>รวม</th><th rowspan="2" style="width:21mm">ระดับ<br>ผลการเรียน</th></tr>' +
      '<tr><th><small>' + max + ' คะแนน</small></th><th><small>' + max + ' คะแนน</small></th><th><small>' + (max * 2) + ' คะแนน</small></th></tr></thead><tbody>';
    var groups = [['รายวิชาพื้นฐาน', true], ['รายวิชาเพิ่มเติม', false]];
    groups.forEach(function (g) {
      var rs = x.rows.filter(function (r) { return r.sub.basic === g[1]; });
      if (!rs.length) return;
      h += '<tr class="grp"><td colspan="7">' + g[0] + '</td></tr>';
      rs.forEach(function (r) {
        h += '<tr><td>' + esc(r.sub.code) + '</td><td class="l">' + esc(r.sub.name) + '</td><td>' + dash(r.sub.credit, 1) + '</td><td>' + dash(r.t1) + '</td><td>' + dash(r.t2) + '</td><td>' + dash(r.total) + '</td><td><b>' + dash(r.grade) + '</b></td></tr>';
      });
    });
    var cr = d.subjects.reduce(function (a, s) { return a + (s.credit || 0); }, 0);
    h += '<tr class="sum"><td colspan="2" class="l">รวมหน่วยกิต</td><td>' + dash(cr, 1) + '</td><td colspan="3">ผลการเรียนเฉลี่ย (GPA)</td><td>' + dash(x.gpa, 2) + '</td></tr>' +
      '<tr class="sum"><td colspan="6" class="l" style="text-align:right">ผลการเรียนเฉลี่ยร้อยละ</td><td>' + dash(x.pct, 2) + '</td></tr>' +
      '<tr class="sum"><td colspan="6" class="l" style="text-align:right">ลำดับที่ในห้องเรียน</td><td>' + (x.rank ? x.rank + ' / ' + total : '–') + '</td></tr></tbody></table>';
    if (termNote) h += '<div class="rc-note">* ระดับผลการเรียนคิดจากคะแนนภาคเรียนที่ 1 (ยังไม่มีคะแนนภาคเรียนที่ 2)</div>';
    else if (!x.complete) h += '<div class="rc-note">* รายวิชาที่ยังไม่มีคะแนนครบทั้งสองภาคเรียน ยังไม่แสดงระดับผลการเรียน</div>';

    h += '<div class="rc-cols"><div><h4>3. กิจกรรมพัฒนาผู้เรียน</h4><table class="rc-t"><thead><tr><th class="l">กิจกรรม</th><th style="width:26mm">ผลการประเมิน</th></tr></thead><tbody>' +
      x.acts.map(function (a) { return '<tr><td class="l">' + esc(a[0]) + '</td><td>' + dash(a[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var r = x.s.rtw || { scores: [] };
    h += '<div><h4>4. การอ่าน คิดวิเคราะห์ และเขียน</h4><table class="rc-t"><thead><tr>' +
      d.rtwItems.map(function (it) { return '<th>' + esc(it.short) + '<br><small>' + dash(it.max) + ' คะแนน</small></th>'; }).join('') +
      '<th>รวม<br><small>100 คะแนน</small></th></tr></thead><tbody><tr>' +
      d.rtwItems.map(function (it, i) { return '<td>' + dash(r.scores[i]) + '</td>'; }).join('') + '<td>' + dash(r.total) + '</td></tr>' +
      '<tr><td colspan="' + (d.rtwItems.length + 1) + '">ผลการประเมิน: <b>' + dash(r.result) + '</b></td></tr></tbody></table></div></div>';
    h += '<div class="rc-foot">หน้า 1</div></div>';
    return h;
  }

  function page2(rec, st, x) {
    var d = rec.data, s = x.s, hl = s.health || { t1: {}, t2: {} };
    var h = '<div class="rc-page rc-dense"><div class="rc-head"><p class="rc-title" style="font-size:14pt">ข้อมูลสุขภาพ การพัฒนาทางด้านร่างกาย และผลการประเมิน</p>' +
      '<div class="rc-who"><span>ชื่อ <b>' + esc(s.name) + '</b></span><span>ชั้น <b>' + esc(d.meta.className) + '</b></span><span>เลขที่ <b>' + esc(s.no) + '</b></span></div></div>';
    h += '<h4>ข้อมูลสุขภาพ</h4><table class="rc-t"><thead><tr><th>ปีการศึกษา ' + esc(d.meta.year) + '</th><th>น้ำหนัก (กก.)</th><th>ส่วนสูง (ซม.)</th><th>BMI</th><th>แปลผลสุขภาพ</th></tr></thead><tbody>';
    [['ภาคเรียนที่ 1', hl.t1 || {}], ['ภาคเรียนที่ 2', hl.t2 || {}]].forEach(function (t) {
      var b = bmi(t[1].w, t[1].h);
      h += '<tr><td>' + t[0] + '</td><td>' + dash(t[1].w) + '</td><td>' + dash(t[1].h) + '</td><td>' + dash(b, 2) + '</td><td>' + dash(bmiText(b)) + '</td></tr>';
    });
    h += '</tbody></table>';

    h += '<div class="rc-cols" style="grid-template-columns:1.05fr 1fr"><div>';
    h += '<h4>ผลการประเมินตัวชี้วัด</h4><table class="rc-t"><thead><tr><th class="l">กลุ่มสาระการเรียนรู้</th><th>ตัวชี้วัด<br>ทั้งหมด</th><th>ตัวชี้วัด<br>ที่ผ่าน</th><th>สรุปผล</th></tr></thead><tbody>' +
      x.ind.map(function (i) { return '<tr><td class="l">' + esc(i.name) + '</td><td>' + dash(i.total) + '</td><td>' + dash(i.passed) + '</td><td>' + (i.total == null ? '–' : i.passed >= i.total ? 'ผ่าน' : 'ไม่ผ่าน') + '</td></tr>'; }).join('') +
      '<tr class="sum"><td>รวม/สรุป</td><td>' + x.indTot + '</td><td>' + x.indPassed + '</td><td>' + (x.res.ind == null ? '–' : x.res.ind ? 'ผ่าน' : 'ไม่ผ่าน') + '</td></tr></tbody></table>';
    var ch = s.characteristics || { items: [] };
    h += '<h4>ผลการประเมินคุณลักษณะอันพึงประสงค์</h4><table class="rc-t"><thead><tr><th class="l">คุณลักษณะอันพึงประสงค์</th><th style="width:22mm">สรุปผล</th></tr></thead><tbody>' +
      d.characteristicItems.map(function (n, i) { return '<tr><td class="l">' + (i + 1) + '. ' + esc(n) + '</td><td>' + dash(ch.items[i]) + '</td></tr>'; }).join('') +
      '<tr class="sum"><td>สรุป</td><td>' + dash(ch.summary) + '</td></tr></tbody></table></div>';
    var cp = s.competencies || [];
    h += '<div><h4>ผลการประเมินสมรรถนะสำคัญของผู้เรียน</h4><table class="rc-t"><thead><tr><th class="l">สมรรถนะของผู้เรียน</th><th style="width:20mm">สรุปผล</th></tr></thead><tbody>';
    d.competencyGroups.forEach(function (g, gi) {
      h += '<tr class="grp"><td colspan="2">' + (gi + 1) + '. ' + esc(g.name) + '</td></tr>';
      g.items.forEach(function (it, ii) { h += '<tr><td class="l">' + esc(it) + '</td><td>' + dash(cp[gi] && cp[gi][ii]) + '</td></tr>'; });
    });
    h += '</tbody></table></div></div>';
    h += '<h4>ความคิดเห็นเพิ่มเติมของครูประจำชั้น</h4><div class="rc-box" style="min-height:14mm">' + (hl.behavior ? esc(hl.behavior) : '<div class="rc-dots"></div><div class="rc-dots"></div>') + '</div>';
    h += '<div style="margin-top:auto;display:flex;justify-content:flex-end"><div style="width:62%">' + sign(rec, st, 'teacher', 'ครูประจำชั้น') + '</div></div>';
    h += '<div class="rc-foot">หน้า 2</div></div>';
    return h;
  }

  function page3(rec, st, x) {
    var d = rec.data, s = x.s, grad = d.meta.stage === 'ป' && d.meta.level === 6 || d.meta.stage === 'ม' && (d.meta.level === 3 || d.meta.level === 6);
    var h = '<div class="rc-page"><div class="rc-head"><p class="rc-title" style="font-size:14pt">สรุปผลการประเมิน และความคิดเห็นของผู้ปกครอง</p>' +
      '<div class="rc-who"><span>ชื่อ <b>' + esc(s.name) + '</b></span><span>ชั้น <b>' + esc(d.meta.className) + '</b></span><span>เลขที่ <b>' + esc(s.no) + '</b></span></div></div>';
    h += '<h4>สรุปผลการเรียน</h4><div class="rc-sumlist">' +
      '<div class="it"><span>1.</span><div>เวลาเรียนร้อยละ <b>' + dash(x.attPct, 2) + '</b><div class="opts">' + pf(x.res.att, 'ผ่านเกณฑ์เวลาเรียนทุกกลุ่มสาระการเรียนรู้', 'ไม่ผ่านเกณฑ์เวลาเรียนบางกลุ่มสาระการเรียนรู้') + '</div></div></div>' +
      '<div class="it"><span>2.</span><div>ผลการประเมินตัวชี้วัด (ผ่าน ' + x.indPassed + ' จาก ' + x.indTot + ' ตัวชี้วัด)<div class="opts">' + pf(x.res.ind, 'ผ่าน', 'ไม่ผ่าน') + '</div></div></div>' +
      '<div class="it"><span>3.</span><div>ผลการเรียนเฉลี่ย <b>' + dash(x.gpa, 2) + '</b><div class="opts">' + pf(x.res.grade, 'ผลการเรียนผ่านเกณฑ์ขั้นต่ำทุกกลุ่มสาระการเรียนรู้', 'ผลการเรียนไม่ผ่านเกณฑ์ขั้นต่ำบางกลุ่มสาระการเรียนรู้') + '</div></div></div>' +
      '<div class="it"><span>4.</span><div>ผลการประเมินการอ่าน คิดวิเคราะห์ และเขียน<div class="opts">' + pf(x.res.rtw, 'ผ่าน', 'ไม่ผ่าน') + '</div></div></div>' +
      '<div class="it"><span>5.</span><div>ผลการประเมินคุณลักษณะอันพึงประสงค์<div class="opts">' + pf(x.res.chars, 'ผ่าน', 'ไม่ผ่าน') + '</div></div></div>' +
      '<div class="it"><span>6.</span><div>ผลการประเมินกิจกรรมพัฒนาผู้เรียน<div class="opts">' + pf(x.res.acts, 'ผ่าน', 'ไม่ผ่าน') + '</div></div></div></div>';
    h += '<div class="rc-verdict"><div class="big">' + (grad ? pf(x.promote, 'เป็นผู้จบหลักสูตร', 'ยังไม่จบหลักสูตร') : pf(x.promote, 'ได้เลื่อนชั้น', 'ไม่ได้เลื่อนชั้น')) + '</div>' +
      (x.promote === true && d.meta.reason ? '<div style="margin-top:1.5mm">สาเหตุ: ' + esc(d.meta.reason) + '</div>' : '') +
      (x.promote == null ? '<div class="rc-note">ยังสรุปผลไม่ได้ เนื่องจากข้อมูลบางส่วนยังไม่ครบ</div>' : '') + '</div>';
    h += '<div class="rc-signs" style="margin-top:4mm">' + sign(rec, st, 'deputy') + sign(rec, st, 'director') + '</div>';
    h += '<h4 style="margin-top:6mm">ความคิดเห็นของผู้ปกครอง</h4><div class="rc-box" style="padding-top:0">' +
      '<div class="rc-dots"></div><div class="rc-dots"></div><div class="rc-dots"></div><div class="rc-dots"></div></div>' +
      '<div style="display:flex;justify-content:flex-end"><div class="rc-sign" style="width:60%;margin-top:6mm"><div class="ln">ลงชื่อ.......................................................ผู้ปกครอง</div><div>(.......................................................)</div><div>วันที่ ........ / ........ / ........</div></div></div>';
    h += '<div class="rc-foot">หน้า 3</div></div>';
    return h;
  }

  function pagesFor(rec, st, x, total) { return [page1(rec, st, x, total), page2(rec, st, x), page3(rec, st, x)]; }
  function blankPage() { return '<div class="rc-page rc-blank"></div>'; }

  // ---------- โหลดไลบรารีแบบเลื่อนเวลา ----------
  var libsReady = null;
  function loadLibs() {
    if (libsReady) return libsReady;
    libsReady = LIBS.reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = src; s.onload = res; s.onerror = function () { rej(new Error('โหลด ' + src + ' ไม่สำเร็จ')); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
    libsReady.catch(function () { libsReady = null; });
    return libsReady;
  }

  function stage() {
    var el = document.getElementById('rcStage');
    if (!el) { el = document.createElement('div'); el.id = 'rcStage'; document.body.appendChild(el); }
    return el;
  }
  function waitImages(el) {
    var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
    return Promise.all(imgs.map(function (i) { return i.complete ? 0 : new Promise(function (r) { i.onload = i.onerror = r; }); }));
  }

  async function capturePages(htmlList) {
    var el = stage();
    el.innerHTML = htmlList.join('');
    await waitImages(el);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    var out = [];
    var pages = el.querySelectorAll('.rc-page');
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].classList.contains('rc-blank')) { out.push(null); continue; }
      var canvas = await window.html2canvas(pages[i], { scale: 1.8, backgroundColor: '#ffffff', logging: false, useCORS: true });
      out.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    el.innerHTML = '';
    return out;
  }

  // วางภาพหน้าลง PDF ตามขนาดกระดาษ
  function addToPdf(pdf, imgs, paper, first) {
    var isFirst = first;
    if (paper === 'half') {
      if (imgs.length % 2) imgs = imgs.concat([null]);
      for (var i = 0; i < imgs.length; i += 2) {
        if (!isFirst) pdf.addPage('a4', 'landscape');
        isFirst = false;
        if (imgs[i]) pdf.addImage(imgs[i], 'JPEG', 0, 0, 148.5, 210);
        if (imgs[i + 1]) pdf.addImage(imgs[i + 1], 'JPEG', 148.5, 0, 148.5, 210);
        pdf.setDrawColor(170); pdf.setLineWidth(0.2);
        if (pdf.setLineDashPattern) pdf.setLineDashPattern([2, 2], 0);
        pdf.line(148.5, 4, 148.5, 206);
        if (pdf.setLineDashPattern) pdf.setLineDashPattern([], 0);
      }
    } else {
      imgs.forEach(function (img) {
        if (!isFirst) pdf.addPage('a4', 'portrait');
        isFirst = false;
        if (img) pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
      });
    }
  }
  function newPdf(paper) {
    var J = window.jspdf.jsPDF;
    return new J({ unit: 'mm', format: 'a4', orientation: paper === 'half' ? 'landscape' : 'portrait', compress: true });
  }
  function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(); }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function progress(p, text) {
    var bar = document.querySelector('.rc-progress'), t = document.querySelector('.rc-ptext');
    if (bar) { bar.classList.toggle('on', p != null); bar.firstChild.style.width = ((p || 0) * 100).toFixed(0) + '%'; }
    if (t) t.textContent = text || '';
  }

  async function makePdf(rec, mode, onlyKey) {
    if (busyRun) return;
    busyRun = true;
    var st = settingsOf(rec), m = rec.data.meta;
    var base = fileSafe(m.levelName + '-' + m.room + '_ใบรายงานผลการเรียน_ปี' + m.year + (st.paper === 'half' ? '_ครึ่งA4' : '_A4'));
    try {
      progress(0, 'กำลังเตรียมเครื่องมือสร้าง PDF...');
      await loadLibs();
      var all = computeAll(rec, st);
      var list = onlyKey != null ? all.filter(function (x) { return String(x.s.no) === String(onlyKey); }) : all;
      var pdf = mode === 'zip' ? null : newPdf(st.paper), zip = mode === 'zip' ? new window.JSZip() : null;
      for (var i = 0; i < list.length; i++) {
        var x = list[i];
        progress(i / list.length, 'กำลังสร้างใบรายงาน ' + (i + 1) + '/' + list.length + ' : ' + x.s.name);
        var imgs = await capturePages(pagesFor(rec, st, x, all.count));
        if (zip) {
          var one = newPdf(st.paper);
          addToPdf(one, imgs, st.paper, true);
          zip.file(fileSafe('เลขที่' + String(x.s.no).padStart(2, '0') + '_' + x.s.name) + '.pdf', one.output('arraybuffer'));
        } else {
          addToPdf(pdf, imgs, st.paper, i === 0);
        }
      }
      progress(1, 'กำลังบันทึกไฟล์...');
      if (zip) {
        var blob = await zip.generateAsync({ type: 'blob' });
        saveBlob(blob, base + '_แยกรายคน.zip');
      } else {
        var name = list.length === 1 ? fileSafe('เลขที่' + String(list[0].s.no).padStart(2, '0') + '_' + list[0].s.name + (st.paper === 'half' ? '_ครึ่งA4' : '_A4')) + '.pdf' : base + '_รวมทุกคน.pdf';
        saveBlob(pdf.output('blob'), name);
      }
      ctx.toast('สร้าง PDF เสร็จแล้ว (' + list.length + ' คน)', 'ok');
    } catch (e) {
      console.error(e);
      ctx.toast('สร้าง PDF ไม่สำเร็จ: ' + (e && e.message ? e.message : e), 'err');
    } finally {
      busyRun = false;
      setTimeout(function () { progress(null, ''); }, 1200);
    }
  }

  function printAll(rec, onlyNo) {
    var st = settingsOf(rec), all = computeAll(rec, st);
    var list = onlyNo != null ? all.filter(function (x) { return String(x.s.no) === String(onlyNo); }) : all;
    var root = document.getElementById('rcPrint');
    if (!root) { root = document.createElement('div'); root.id = 'rcPrint'; document.body.appendChild(root); }
    var html = '';
    list.forEach(function (x) {
      var pages = pagesFor(rec, st, x, all.count);
      if (st.paper === 'half') {
        if (pages.length % 2) pages.push(blankPage());
        for (var i = 0; i < pages.length; i += 2) html += '<div class="sheet half"><div class="slot">' + pages[i] + '</div><div class="slot">' + pages[i + 1] + '</div></div>';
      } else pages.forEach(function (p) { html += '<div class="sheet a4">' + p + '</div>'; });
    });
    root.innerHTML = html;
    var style = document.getElementById('rcPageStyle');
    if (!style) { style = document.createElement('style'); style.id = 'rcPageStyle'; document.head.appendChild(style); }
    style.textContent = '@media print{@page{size:A4 ' + (st.paper === 'half' ? 'landscape' : 'portrait') + ';margin:0}}';
    document.body.classList.add('rc-printing');
    var done = function () { document.body.classList.remove('rc-printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    // ล้างหลังพิมพ์เสร็จเท่านั้น (บางเบราว์เซอร์ print() ไม่รอจนปิดหน้าต่างพิมพ์)
    waitImages(root).then(function () { window.print(); });
  }

  // ---------- หน้าจอแท็บ "ใบรายงาน ปพ.6" ----------
  var preview = { no: null };

  function imgSelect(rec, role, value) {
    var d = rec.data, opts = '<option value="">ไม่ใช้รูป</option>';
    var named = { logo: 'โลโก้ (จากไฟล์)', teacher: 'ลายเซ็นครู (จากไฟล์)', deputy: 'ลายเซ็นรอง ผอ. (จากไฟล์)', director: 'ลายเซ็น ผอ. (จากไฟล์)' };
    Object.keys(d.images).forEach(function (k) { opts += '<option value="' + k + '"' + (value === k ? ' selected' : '') + '>' + named[k] + '</option>'; });
    d.allImages.forEach(function (u, i) { opts += '<option value="#' + i + '"' + (value === '#' + i ? ' selected' : '') + '>รูปที่ ' + (i + 1) + ' ในไฟล์</option>'; });
    var src = imgOf(rec, value);
    return '<div class="rc-sig-pick">' + (src ? '<img src="' + src + '" alt="">' : '') + '<select data-img="' + role + '">' + opts + '</select></div>';
  }

  function render(view, c) {
    ctx = c;
    var rec = ctx.pp6Record();
    var cls = ctx.className();
    if (!rec) {
      view.innerHTML = '<h2 class="sec">ใบรายงานผลการเรียนรายบุคคล (ปพ.6) ชั้น ' + esc(cls) + '</h2>' +
        '<div class="slot card empty" data-slot="pp6" tabindex="0" role="button" style="min-height:130px">' +
        '<div class="slot-h"><div class="slot-ic" style="background:#0b7285">6</div><div><div class="slot-n">อัปโหลดไฟล์ ปพ.6 ของห้องนี้</div>' +
        '<div class="slot-c">ไฟล์แบบรายงานการพัฒนาคุณภาพผู้เรียนรายบุคคล (.xlsx) ที่มีชีต "ผลสัมฤทธิ์ฯ เทอม 1"</div></div></div>' +
        '<div class="slot-empty-t">แตะเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่ ระบบจะจัดเข้าชั้น/ห้องตามข้อมูลในไฟล์</div></div>';
      return;
    }
    var d = rec.data, st = settingsOf(rec), all = computeAll(rec, st);
    var hasT2 = d.students.some(function (s) { return Object.keys(s.t2).some(function (k) { return s.t2[k]; }); });
    if (preview.no == null || !d.students.some(function (s) { return String(s.no) === String(preview.no); })) preview.no = d.students[0].no;

    var h = '<h2 class="sec">ใบรายงานผลการเรียนรายบุคคล (ปพ.6) ชั้น ' + esc(cls) + '</h2>';
    h += '<div class="card rc-panel"><div class="slot-h" style="margin-bottom:10px"><div class="slot-ic" style="background:#0b7285">6</div><div style="flex:1;min-width:0">' +
      '<div class="slot-n">' + esc(d.meta.className) + ' · ปีการศึกษา ' + esc(d.meta.year) + ' · ' + d.students.length + ' คน · ' + d.subjects.length + ' รายวิชา</div>' +
      '<div class="slot-f" style="margin-top:4px">📄 ' + esc(rec.fileName) + '</div></div></div>' +
      '<div class="slot-acts"><button class="btn" data-rc="replace">แทนที่ไฟล์</button><button class="btn" data-rc="dlx">ดาวน์โหลดไฟล์ Excel</button><button class="btn danger" data-rc="delete">ลบ</button></div>';
    if (!hasT2) h += '<p class="note" style="margin-top:12px">ไฟล์นี้ยังไม่มีคะแนนภาคเรียนที่ 2 (ในไฟล์ Excel เกรดจึงขึ้น #VALUE!) เลือกได้ว่าจะคิดระดับผลการเรียนจากคะแนนภาคเรียนที่ 1 ไปก่อน หรือเว้นว่างไว้จนกว่าจะมีคะแนนครบ</p>';
    h += '</div>';

    h += '<div class="card rc-panel"><h3>รูปแบบใบรายงาน</h3><div class="rc-row">' +
      '<div class="rc-opt"><span>ขนาดกระดาษ</span><div class="seg" data-set="paper">' +
      '<button data-v="a4" class="' + (st.paper === 'a4' ? 'on' : '') + '">เต็ม A4 (1 หน้า/แผ่น)</button>' +
      '<button data-v="half" class="' + (st.paper === 'half' ? 'on' : '') + '">ครึ่ง A4 (2 หน้า/แผ่น)</button></div></div>' +
      '<div class="rc-opt"><span>ระดับผลการเรียน</span><div class="seg" data-set="gradeMode">' +
      '<button data-v="year" class="' + (st.gradeMode === 'year' ? 'on' : '') + '">คิดเมื่อครบ 2 ภาค</button>' +
      '<button data-v="term1" class="' + (st.gradeMode === 'term1' ? 'on' : '') + '">คิดจากภาค 1 ไปก่อน</button></div></div>' +
      '<label class="chk"><input type="checkbox" data-chk="showLogo"' + (st.showLogo ? ' checked' : '') + '> แสดงโลโก้</label>' +
      '<label class="chk"><input type="checkbox" data-chk="showSign"' + (st.showSign ? ' checked' : '') + '> แสดงลายเซ็น</label></div>' +
      '<div class="rc-signers">' +
      '<div class="card"><b>ชื่อโรงเรียน (หัวกระดาษ)</b><input type="text" data-txt="school" value="' + esc(st.school) + '"><b>โลโก้</b>' + imgSelect(rec, 'logo', st.logo) + '</div>' +
      ['teacher', 'deputy', 'director'].map(function (k) {
        var lab = { teacher: 'ครูประจำชั้น', deputy: 'รองผู้อำนวยการ', director: 'ผู้อำนวยการ' }[k];
        return '<div class="card"><b>' + lab + '</b><input type="text" data-txt="' + k + '.name" value="' + esc(st[k].name) + '" placeholder="ชื่อ-สกุล">' +
          '<input type="text" data-txt="' + k + '.position" value="' + esc(st[k].position) + '" placeholder="ตำแหน่ง">' + imgSelect(rec, k, st[k].img) + '</div>';
      }).join('') + '</div>';
    h += '<div class="rc-actions"><button class="btn pri" data-rc="pdf-all">⬇ PDF รวมทุกคน</button>' +
      '<button class="btn pri" data-rc="pdf-zip">⬇ PDF แยกรายคน (ZIP)</button>' +
      '<button class="btn" data-rc="print-all">พิมพ์ทุกคน</button></div>' +
      '<div class="rc-progress"><i></i></div><div class="rc-ptext"></div></div>';

    // ตัวอย่างรายคน
    h += '<div class="rc-preview-bar"><button class="btn" data-rc="prev">‹</button><select id="rcStu" aria-label="เลือกนักเรียน">' +
      d.students.map(function (s) { return '<option value="' + s.no + '"' + (String(s.no) === String(preview.no) ? ' selected' : '') + '>' + s.no + '. ' + esc(s.name) + '</option>'; }).join('') +
      '</select><button class="btn" data-rc="next">›</button><button class="btn pri" data-rc="pdf-one">⬇ PDF คนนี้</button><button class="btn" data-rc="print-one">พิมพ์คนนี้</button></div>';
    var x = all.filter(function (y) { return String(y.s.no) === String(preview.no); })[0];
    var pages = pagesFor(rec, st, x, all.count);
    h += '<div class="rc-preview" id="rcPrev">' + pages.map(function (p) { return '<div class="rc-fit"><div class="rc-scale">' + p + '</div></div>'; }).join('') + '</div>';
    view.innerHTML = h;
    fitPreview();
    bind(view, rec);
  }

  function fitPreview() {
    var box = document.getElementById('rcPrev');
    if (!box) return;
    var page = box.querySelector('.rc-page');
    if (!page) return;
    var pw = page.offsetWidth, ph = page.offsetHeight;
    var avail = Math.min(box.clientWidth - 16, 820);
    var k = Math.min(1, avail / pw);
    Array.prototype.forEach.call(box.querySelectorAll('.rc-fit'), function (f) {
      f.style.width = (pw * k) + 'px'; f.style.height = (ph * k) + 'px';
      f.firstChild.style.transform = 'scale(' + k + ')';
    });
  }
  window.addEventListener('resize', function () { if (document.getElementById('rcPrev')) fitPreview(); });

  async function saveSetting(rec, path, value) {
    var s = rec.settings ? JSON.parse(JSON.stringify(rec.settings)) : {};
    var parts = path.split('.');
    if (parts.length === 2) { s[parts[0]] = s[parts[0]] || {}; s[parts[0]][parts[1]] = value; }
    else s[path] = value;
    rec.settings = s;
    await ctx.save(rec);
  }

  function bind(view, rec) {
    view.onclick = async function (e) {
      var seg = e.target.closest('.seg button');
      if (seg) { await saveSetting(rec, seg.parentNode.dataset.set, seg.dataset.v); ctx.rerender(); return; }
      var b = e.target.closest('[data-rc]');
      if (!b) return; // ช่องอัปโหลดว่างจัดการใน app.js
      var a = b.dataset.rc, d = rec.data;
      var idx = d.students.findIndex(function (s) { return String(s.no) === String(preview.no); });
      if (a === 'replace') ctx.pickFor('pp6');
      else if (a === 'dlx') ctx.download(rec);
      else if (a === 'delete') ctx.remove(rec);
      else if (a === 'prev' || a === 'next') {
        var n = d.students[idx + (a === 'next' ? 1 : -1)];
        if (n) { preview.no = n.no; ctx.rerender(); }
      }
      else if (a === 'pdf-all') makePdf(rec, 'all');
      else if (a === 'pdf-zip') makePdf(rec, 'zip');
      else if (a === 'pdf-one') makePdf(rec, 'all', preview.no);
      else if (a === 'print-all') printAll(rec);
      else if (a === 'print-one') printAll(rec, preview.no);
    };
    view.onchange = async function (e) {
      var t = e.target;
      if (t.id === 'rcStu') { preview.no = t.value; ctx.rerender(); return; }
      if (t.dataset.chk) { await saveSetting(rec, t.dataset.chk, t.checked); ctx.rerender(); return; }
      if (t.dataset.img) {
        var key = t.dataset.img === 'logo' ? 'logo' : t.dataset.img + '.img';
        await saveSetting(rec, key, t.value); ctx.rerender(); return;
      }
      if (t.dataset.txt) { await saveSetting(rec, t.dataset.txt, t.value); ctx.rerender(); }
    };
  }

  window.PP6Report = { render: render, compute: function (rec, c) { ctx = c; return computeAll(rec, settingsOf(rec)); } };
})();
