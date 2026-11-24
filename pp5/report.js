/* ใบรายงานผลการเรียนรายบุคคล (ปพ.6): แสดงตัวอย่าง พิมพ์ และดาวน์โหลด PDF (รวม / แยกรายคน, A4 / ครึ่ง A4) */
(function () {
  'use strict';

  var CHAR_PASS = ['ดีเยี่ยม', 'ดี', 'ผ่าน'];
  var LIBS = window.PP5_LIBS || ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jszip.min.js'];
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
    // ยึดตามที่ผู้ดูแลตั้ง: โลโก้ ชื่อโรงเรียน ชื่อ/ตำแหน่ง/ลายเซ็น ผอ. และรอง ผอ.
    var b = ctx && ctx.brand ? ctx.brand() : null;
    if (b) {
      if (b.school) out.school = b.school;
      if (b.logo) out.logo = '@logo';
      ['director', 'deputy'].forEach(function (k) {
        var x = b[k] || {};
        if (x.name) out[k].name = x.name;
        if (x.position) out[k].position = x.position;
        if (x.img) out[k].img = '@' + k;
        out[k].locked = !!(x.name || x.img);
      });
      out.logoLocked = !!b.logo;
    }
    // ลายเซ็นครูประจำชั้นที่อัปโหลดไว้ (ตามชื่อครู)
    if (ctx && ctx.sig && ctx.sig(out.teacher.name)) out.teacher.img = '@teacher:' + out.teacher.name;
    return out;
  }
  function imgOf(rec, key) {
    if (!key) return null;
    var d = rec.data;
    if (key.charAt(0) === '@') {
      if (key.indexOf('@teacher:') === 0) return ctx.sig ? ctx.sig(key.slice(9)) : null;
      var b = ctx.brand ? ctx.brand() : null;
      if (!b) return null;
      return key === '@logo' ? b.logo : (b[key.slice(1)] || {}).img || null;
    }
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
    // รุ่น Apps Script: เก็บสำเนาไว้ใน Google Drive ด้วย
    var store = window.PP5_STORE;
    if (store && store.saveOutput) {
      store.saveOutput(blob, name).then(function () {
        ctx.toast('บันทึกสำเนาไว้ใน Google Drive แล้ว (โฟลเดอร์ "PDF ใบรายงาน")', 'ok');
      }, function (e) {
        ctx.toast('บันทึกสำเนาลง Drive ไม่สำเร็จ: ' + (e && e.message ? e.message : e), 'err');
      });
    }
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

  // ลายเซ็นครูประจำชั้น: อัปโหลดรูปลายเซ็นของตัวเอง (เก็บตามชื่อครู ใช้ได้ทุกห้องที่ครูคนนั้นเป็นครูประจำชั้น)
  function teacherSigCard(rec, st) {
    var src = imgOf(rec, st.teacher.img), mine = st.teacher.img && st.teacher.img.indexOf('@teacher:') === 0;
    return '<div class="card"><b>ครูประจำชั้น</b><input type="text" data-txt="teacher.name" value="' + esc(st.teacher.name) + '" placeholder="ชื่อ-สกุล">' +
      '<input type="text" data-txt="teacher.position" value="' + esc(st.teacher.position) + '" placeholder="ตำแหน่ง">' +
      '<div class="rc-sig-pick">' + (src ? '<img src="' + src + '" alt="">' : '<span class="muted">ยังไม่มีลายเซ็น</span>') + '</div>' +
      (ctx.canSign && ctx.canSign()
        ? '<div class="slot-acts" style="margin-top:6px"><button class="btn pri" data-rc="sig-up">🖋 อัปโหลดลายเซ็น</button>' + (mine ? '<button class="btn" data-rc="sig-del">ลบลายเซ็น</button>' : '') + '</div>' +
          '<small class="muted">ถ่ายรูปลายเซ็นบนกระดาษขาว ระบบทำพื้นหลังให้โปร่งใสเอง</small><input type="file" id="rcSigFile" accept="image/*" hidden>'
        : '<small class="muted">ผู้ดูแลระบบปิดการอัปโหลดลายเซ็นไว้</small>') + '</div>';
  }

  // ---------- ตรวจความถูกต้อง: รายชื่อเทียบทะเบียน / คะแนนเทียบ ปพ.5 ----------
  function checkPanel(rec) {
    var h = '<div class="card rc-panel chk-panel"><h3>🔎 ตรวจสอบความถูกต้อง</h3><div class="chk-grid">';
    var c = rec.check;
    if (rec.virtual) h += rec.fromRoster ? chkItem(true, 'รายชื่อนักเรียน', 'ใช้รายชื่อจาก' + ctx.rosterLabel()) : chkItem(null, 'รายชื่อนักเรียน', 'ยังไม่มีทะเบียนรายชื่อของห้องนี้ในปีการศึกษานี้ จึงใช้รายชื่อจากไฟล์ ปพ.5');
    else if (!c) h += chkItem(null, 'รายชื่อนักเรียน', 'ยังไม่มีทะเบียนรายชื่อ (ไฟล์ Word) ให้เทียบ');
    else if (!c.issues) h += chkItem(true, 'รายชื่อนักเรียน', 'ตรงกับทะเบียนทั้ง ' + c.matched + ' คน');
    else {
      h += chkItem(false, 'รายชื่อนักเรียน', 'ไม่ตรงทะเบียน ' + c.issues + ' รายการ — ระบบใช้ชื่อและเลขที่ตามทะเบียนแล้ว',
        '<ul class="chk-list">' + c.diffs.map(function (d) { return '<li>เลขที่ ' + esc(d.no) + ' ' + esc(d.name) + ': ' + esc(d.items.join(', ')) + '</li>'; }).join('') +
        c.notInRoster.map(function (d) { return '<li class="bad">ไม่มีในทะเบียน: ' + esc(d.name) + (d.id ? ' (' + esc(d.id) + ')' : '') + '</li>'; }).join('') +
        c.missing.map(function (d) { return '<li class="bad">มีในทะเบียนแต่ไม่มีในไฟล์: เลขที่ ' + esc(d.no) + ' ' + esc(d.name) + '</li>'; }).join('') + '</ul>');
    }
    if (rec.virtual) h += chkItem(true, 'คะแนน', 'คำนวณจากไฟล์ ปพ.5 โดยตรง');
    else {
      var cmp = ctx.compare ? ctx.compare(rec) : null;
      if (!cmp) h += chkItem(null, 'คะแนนเทียบ ปพ.5', 'ยังไม่มีไฟล์ ปพ.5 ของห้องนี้ให้เทียบ');
      else if (!cmp.compared) h += chkItem(null, 'คะแนนเทียบ ปพ.5', 'ไม่พบรายวิชาที่ตรงกันระหว่าง ปพ.6 กับ ปพ.5');
      else if (!cmp.list.length) h += chkItem(true, 'คะแนนเทียบ ปพ.5', 'ตรงกันทั้งหมด (' + cmp.subjects.length + ' วิชา ' + cmp.compared + ' รายการ)');
      else {
        var subs = Object.keys(cmp.bySubject).map(function (k) { var n = (cmp.subjects.filter(function (x) { return x.code === k; })[0] || {}).name || k; return esc(n) + ' ' + cmp.bySubject[k]; }).join(' · ');
        h += chkItem(false, 'คะแนนเทียบ ปพ.5', 'ไม่ตรง ' + cmp.list.length + ' จุด จาก ' + cmp.compared + ' รายการ (' + cmp.subjects.length + ' วิชา) · ' + subs,
          '<p class="sub" style="margin:6px 0">ค่าจาก ปพ.5 คิดแบบ: คะแนนเก็บรายภาค = ตัวชี้วัดของภาคนั้นเทียบครึ่งหนึ่งของคะแนนเก็บ, คะแนนสอบ = ปลายภาคแบ่งครึ่ง (ถ้าครูแบ่งคะแนนสอบแต่ละภาคไม่เท่ากัน จะขึ้นว่าไม่ตรงได้)</p>' +
          '<div class="tbl-wrap" style="max-height:320px"><table><thead><tr><th>เลขที่</th><th class="l">ชื่อ-สกุล</th><th class="l">วิชา</th><th>ภาค</th><th>รายการ</th><th>ปพ.6</th><th>ปพ.5</th></tr></thead><tbody>' +
          cmp.list.slice(0, 300).map(function (x) {
            return '<tr><td>' + esc(x.no) + '</td><td class="l">' + esc(x.name) + '</td><td class="l">' + esc(x.subject || x.code) + '</td><td>' + x.term + '</td><td>' + (x.field === 'collect' ? 'คะแนนเก็บ' : 'คะแนนสอบ') + '</td><td><b>' + dash(x.pp6) + '</b></td><td>' + dash(x.pp5) + '</td></tr>';
          }).join('') + '</tbody></table></div>');
      }
    }
    return h + '</div></div>';
  }
  // ปุ่มกดใหญ่พร้อมคำอธิบาย (ปพ.6)
  function pp6Buttons(rec) {
    var ro = ctx.readOnly && ctx.readOnly();
    function b(attr, ic, t, sub, cls) { return '<button class="btn act-b ' + (cls || '') + '" ' + attr + '><span class="ab-ic">' + ic + '</span><span class="ab-t"><b>' + t + '</b><small>' + sub + '</small></span></button>'; }
    return '<div class="act-grid">' +
      (ro ? '' : b('data-act="edit" data-key="' + esc(rec.key) + '"', '✏️', 'แก้ไขในระบบ', 'กรอก/แก้คะแนน ปพ.6 บนเว็บ ระบบคิดเกรดให้ทันที', 'pri')) +
      b('data-rc="dlx"', '⬇', 'ดาวน์โหลด Excel', 'ไฟล์ ปพ.6 รูปแบบของโรงเรียน ไปพิมพ์หรือเก็บไว้') +
      (ro ? '' : b('data-rc="replace"', '⇪', 'อัปโหลดไฟล์ ปพ.6', 'ไฟล์ Excel ที่กรอกในคอม ระบบใช้ไฟล์นี้แทนของเดิม')) +
      b('data-rc="pdf-all"', '🖨', 'PDF ทั้งห้อง', 'ใบรายงานผลทุกคนในไฟล์เดียว') + '</div>';
  }
  function chkItem(ok, title, text, more) {
    var ic = ok === true ? '✅' : ok === false ? '⚠️' : 'ℹ️';
    return '<div class="chk-it ' + (ok === true ? 'ok' : ok === false ? 'bad' : '') + '"><div class="chk-h">' + ic + ' <b>' + esc(title) + '</b></div><div class="chk-t">' + text + '</div>' +
      (more ? '<details><summary>ดูรายละเอียด</summary>' + more + '</details>' : '') + '</div>';
  }

  function render(view, c) {
    ctx = c;
    var rec = ctx.pp6Record();
    var cls = ctx.className();
    if (!rec) {
      view.innerHTML = '<p class="sub">ยังไม่มีคะแนน ปพ.5 หรือไฟล์ ปพ.6 ของห้องนี้ · เมื่อมีคะแนน ปพ.5 ระบบจะสร้างใบรายงาน ปพ.6 ให้อัตโนมัติ</p>' +
        '<div class="slot card empty" data-slot="pp6" tabindex="0" role="button" style="min-height:130px">' +
        '<div class="slot-h"><div class="slot-ic" style="background:#0b7285">6</div><div><div class="slot-n">อัปโหลดไฟล์ ปพ.6 ของห้องนี้</div>' +
        '<div class="slot-c">ไฟล์แบบรายงานการพัฒนาคุณภาพผู้เรียนรายบุคคล (.xlsx) ที่มีชีต "ผลสัมฤทธิ์ฯ เทอม 1"</div></div></div>' +
        '<div class="slot-empty-t">ลากไฟล์มาวางที่นี่ หรือเลือกวิธีด้านล่าง</div>' +
        '<div class="slot-acts"><button class="btn pri" data-act="upload" data-slot="pp6">อัปโหลดไฟล์ ปพ.6</button>' +
        '<button class="btn" data-act="online" data-slot="pp6">กรอก ปพ.6 ในระบบ</button>' +
        '<button class="btn" data-act="template" data-slot="pp6">สร้างไฟล์ Excel ปพ.6</button></div></div>';
      return;
    }
    var d = rec.data, st = settingsOf(rec), all = computeAll(rec, st);
    var hasT2 = d.students.some(function (s) { return Object.keys(s.t2).some(function (k) { return s.t2[k]; }); });
    if (preview.no == null || !d.students.some(function (s) { return String(s.no) === String(preview.no); })) preview.no = d.students[0].no;

    var h = '';
    h += '<div class="card rc-panel"><div class="slot-h" style="margin-bottom:10px"><div class="slot-ic" style="background:#0b7285">6</div><div style="flex:1;min-width:0">' +
      '<div class="slot-n">' + esc(d.meta.className) + ' · ปีการศึกษา ' + esc(d.meta.year) + ' · ' + d.students.length + ' คน · ' + d.subjects.length + ' รายวิชา</div>' +
      '<div class="slot-f" style="margin-top:4px">' + (rec.virtual ? '⚙️ ' : '📄 ') + esc(rec.fileName) + '</div></div></div>' +
      (rec.virtual
        ? '<p class="note" style="margin:0 0 10px">ยังไม่มีไฟล์ ปพ.6 ของห้องนี้ ระบบจึง<b>สร้างให้อัตโนมัติ</b>จากคะแนน ปพ.5 ทุกวิชาที่มี และรายชื่อจากทะเบียนนักเรียน (คะแนนเก็บรายภาคคิดจากตัวชี้วัดของภาคนั้น คะแนนสอบปลายภาคแบ่งครึ่ง 2 ภาค) · ถ้าอัปโหลดไฟล์ ปพ.6 เข้ามา ระบบจะใช้ไฟล์นั้นแทน</p>' +
          '<div class="slot-acts"><button class="btn pri" data-rc="dlx">⬇ ดาวน์โหลด ปพ.6 (Excel รูปแบบต้นฉบับ)</button><button class="btn" data-act="edit" data-key="' + esc(rec.key) + '">แก้ไข/บันทึกเป็น ปพ.6</button><button class="btn" data-rc="replace">⇪ อัปโหลดไฟล์ ปพ.6 มาใช้แทน</button></div>'
        : '<div class="slot-acts"><button class="btn pri" data-act="edit" data-key="' + esc(rec.key) + '">แก้ไขในระบบ</button><button class="btn" data-rc="replace">อัปโหลดใหม่</button><button class="btn" data-rc="dlx">ดาวน์โหลดไฟล์ Excel</button><button class="btn danger" data-rc="delete">ลบ</button></div>');
    if (!hasT2) h += '<p class="note" style="margin-top:12px">ไฟล์นี้ยังไม่มีคะแนนภาคเรียนที่ 2 (ในไฟล์ Excel เกรดจึงขึ้น #VALUE!) เลือกได้ว่าจะคิดระดับผลการเรียนจากคะแนนภาคเรียนที่ 1 ไปก่อน หรือเว้นว่างไว้จนกว่าจะมีคะแนนครบ</p>';
    h += '</div>';
    h += pp6Buttons(rec) + checkPanel(rec);

    // ---- พิมพ์ / ดาวน์โหลด: ทั้งห้อง กับ รายคน แยกกันชัดเจน ----
    var cur = d.students.filter(function (s) { return String(s.no) === String(preview.no); })[0] || d.students[0];
    h += '<div class="card rc-panel rc-print"><h3>🖨 พิมพ์ / ดาวน์โหลดใบรายงาน</h3><div class="rc-print-grid">' +
      '<div class="rc-pbox"><div class="rc-pt">👥 ทั้งห้อง <span>' + d.students.length + ' คน</span></div>' +
      '<button class="btn pri big" data-rc="pdf-all">⬇ PDF รวมทุกคน (ไฟล์เดียว)</button>' +
      '<button class="btn big" data-rc="pdf-zip">⬇ PDF แยกไฟล์รายคน (ZIP)</button>' +
      '<button class="btn big" data-rc="print-all">🖨 พิมพ์ทุกคน</button></div>' +
      '<div class="rc-pbox"><div class="rc-pt">🧒 รายคน</div>' +
      '<div class="rc-pick"><button class="btn" data-rc="prev" aria-label="คนก่อนหน้า">‹</button><select id="rcStu" aria-label="เลือกนักเรียน">' +
      d.students.map(function (s) { return '<option value="' + s.no + '"' + (String(s.no) === String(preview.no) ? ' selected' : '') + '>เลขที่ ' + s.no + ' ' + esc(s.name) + '</option>'; }).join('') +
      '</select><button class="btn" data-rc="next" aria-label="คนถัดไป">›</button></div>' +
      '<button class="btn pri big" data-rc="pdf-one">⬇ PDF ของ ' + esc(cur ? cur.first || cur.name : '') + '</button>' +
      '<button class="btn big" data-rc="print-one">🖨 พิมพ์คนนี้</button></div></div>' +
      '<div class="rc-progress"><i></i></div><div class="rc-ptext"></div>' +
      '<div class="rc-row rc-opts">' +
      '<div class="rc-opt"><span>ขนาดกระดาษ</span><div class="seg" data-set="paper">' +
      '<button data-v="a4" class="' + (st.paper === 'a4' ? 'on' : '') + '">เต็ม A4</button>' +
      '<button data-v="half" class="' + (st.paper === 'half' ? 'on' : '') + '">ครึ่ง A4 (2 หน้า/แผ่น)</button></div></div>' +
      '<div class="rc-opt"><span>ระดับผลการเรียน</span><div class="seg" data-set="gradeMode">' +
      '<button data-v="year" class="' + (st.gradeMode === 'year' ? 'on' : '') + '">คิดเมื่อครบ 2 ภาค</button>' +
      '<button data-v="term1" class="' + (st.gradeMode === 'term1' ? 'on' : '') + '">คิดจากภาค 1 ไปก่อน</button></div></div>' +
      '<label class="chk"><input type="checkbox" data-chk="showLogo"' + (st.showLogo ? ' checked' : '') + '> แสดงโลโก้</label>' +
      '<label class="chk"><input type="checkbox" data-chk="showSign"' + (st.showSign ? ' checked' : '') + '> แสดงลายเซ็น</label></div></div>';

    // ---- ผู้ลงนาม: ผอ. / รอง ผอ. / โลโก้ ฟิกไว้ · ครูประจำชั้นอัปโหลดลายเซ็นเอง ----
    function fixed(lab, name, pos, src) {
      return '<div class="card rc-locked"><b>' + lab + '</b><div class="rc-sig-pick">' + (src ? '<img src="' + src + '" alt="">' : '<span class="muted">ยังไม่มีรูป</span>') + '</div>' +
        '<div class="rc-lock-n">' + esc(name || '-') + '</div><small>' + esc(pos || '') + '</small><small class="rc-lock">🔒 ฟิกไว้</small></div>';
    }
    h += '<div class="card rc-panel"><h3>✍️ ผู้ลงนามในใบรายงาน</h3><div class="rc-signers">' +
      teacherSigCard(rec, st) +
      fixed('รองผู้อำนวยการ', st.deputy.name, st.deputy.position, imgOf(rec, st.deputy.img)) +
      fixed('ผู้อำนวยการ', st.director.name, st.director.position, imgOf(rec, st.director.img)) +
      fixed('โรงเรียน / โลโก้', st.school, '', imgOf(rec, st.logo)) + '</div></div>';

    // ตัวอย่างรายคน
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
      else if (a === 'sig-up') { var fi = document.getElementById('rcSigFile'); fi.value = ''; fi.click(); }
      else if (a === 'sig-del') {
        if (!confirm('ลบลายเซ็นของ ' + settingsOf(rec).teacher.name + '?')) return;
        try { await ctx.saveSig(settingsOf(rec).teacher.name, null); ctx.toast('ลบลายเซ็นแล้ว', 'info'); ctx.rerender(); } catch (er) { ctx.toast(er.message, 'err'); }
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
      if (t.id === 'rcSigFile' && t.files[0]) {
        try { await ctx.saveSig(settingsOf(rec).teacher.name, t.files[0]); ctx.toast('บันทึกลายเซ็นแล้ว ใช้ในใบรายงานทุกห้องที่เป็นครูประจำชั้น', 'ok'); ctx.rerender(); }
        catch (er) { ctx.toast('อัปโหลดลายเซ็นไม่สำเร็จ: ' + er.message, 'err'); }
        return;
      }
      if (t.dataset.chk) { await saveSetting(rec, t.dataset.chk, t.checked); ctx.rerender(); return; }
      if (t.dataset.img) {
        var key = t.dataset.img === 'logo' ? 'logo' : t.dataset.img + '.img';
        await saveSetting(rec, key, t.value); ctx.rerender(); return;
      }
      if (t.dataset.txt) { await saveSetting(rec, t.dataset.txt, t.value); ctx.rerender(); }
    };
  }

  window.PP6Report = {
    render: render,
    compute: function (rec, c) { ctx = c; return computeAll(rec, settingsOf(rec)); },
    checkPanel: function (rec, c) { ctx = c; return checkPanel(rec); },
    computeWith: function (rec, c, over) { ctx = c; return computeAll(rec, Object.assign(settingsOf(rec), over || {})); }
  };
})();
