/* กรอก ปพ.5 / ปพ.6 ในระบบ และสร้างไฟล์ Excel ไปกรอกในคอมพิวเตอร์ */
(function () {
  'use strict';

  var M = function () { return window.PP5Model; };
  var ed = null;   // { kind, data, oldKey, section, dirty, intent }
  var ctx = null;

  var PREFIX = ['', 'เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว'];
  var SEX = ['', 'ชาย', 'หญิง'];
  var STATUS = ['ปกติ', 'ย้ายออก', 'ออกกลางคัน', 'พักการเรียน'];
  var CHAR_OPT = ['', 'ดีเยี่ยม', 'ดี', 'ผ่าน', 'ไม่ผ่าน'];
  var COMP_OPT = ['', 'ดีเยี่ยม', 'ดี', 'พอใช้', 'ปรับปรุง'];
  var ACT_OPT = ['', 'ผ.', 'มผ.'];

  function esc(v) { return ctx.esc(v); }
  function norm(s) { return String(s || '').replace(/\s+/g, ''); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var SECTIONS = {
    pp5: [['info', 'ข้อมูลวิชา'], ['roster', 'นักเรียน'], ['ind', 'ตัวชี้วัด'], ['scores', 'คะแนน'], ['att', 'เวลาเรียน'], ['char', 'คุณลักษณะ'], ['rtw', 'อ่านคิดเขียน'], ['act', 'กิจกรรม']],
    pp6: [['info', 'ข้อมูลห้อง'], ['roster', 'นักเรียน'], ['subj', 'รายวิชา'], ['t1', 'คะแนนภาค 1'], ['t2', 'คะแนนภาค 2'], ['att', 'เวลาเรียน'], ['health', 'สุขภาพ/ความเห็นครู'], ['rtw', 'อ่านคิดเขียน'], ['char', 'คุณลักษณะ'], ['comp', 'สมรรถนะ']]
  };

  // ---------- เริ่มแก้ไข ----------
  function rosterFromClass(c) {
    var p6 = c.pp6Record();
    if (p6 && p6.data) return M().copyRoster(p6.data.students);
    var recs = c.classRecords().filter(function (r) { return r.data; });
    if (recs.length) return M().copyRoster(recs[0].data.students);
    return [];
  }
  function schoolOf(c) {
    var p6 = c.pp6Record();
    if (p6 && p6.data && p6.data.meta.school) return p6.data.meta.school;
    var r = c.classRecords().filter(function (x) { return x.data && x.data.meta.school; })[0];
    return r ? (/^โรงเรียน/.test(r.data.meta.school) ? r.data.meta.school : 'โรงเรียน' + r.data.meta.school) : '';
  }
  function teacherOf(c) { var p6 = c.pp6Record(); return p6 && p6.data ? p6.data.meta.teacher || '' : ''; }

  function open(opt, c) {
    ctx = c;
    var cls = c.classInfo(), data, oldKey = null;
    if (opt.key) {
      var rec = c.findRecord(opt.key);
      if (!rec || !rec.data) { c.toast('ไม่พบข้อมูลที่จะแก้ไข', 'err'); return; }
      data = clone(rec.data); oldKey = rec.key;
      if (opt.kind === 'pp5') data = M().fillPP5(data, false); else data = M().fillPP6(data, false);
    } else if (opt.kind === 'pp5') {
      var base = { year: cls.year, level: cls.level, room: cls.room, school: schoolOf(c), teacher: teacherOf(c), students: rosterFromClass(c) };
      var core = c.coreSlot(opt.slot);
      var d = core ? M().subjectDefaults(core.letter, core.tail, cls.level) : null;
      if (d) Object.assign(base, d, { subject: d.name, type: 'พื้นฐาน' });
      else Object.assign(base, { code: '', subject: '', credit: 1, hours: 40, type: 'เพิ่มเติม' });
      data = M().newPP5(base);
    } else {
      data = M().newPP6({ year: cls.year, level: cls.level, room: cls.room, school: schoolOf(c), teacher: teacherOf(c), students: rosterFromClass(c) });
    }
    ed = { kind: opt.kind, data: data, oldKey: oldKey, section: 'info', dirty: false, intent: opt.intent || 'online' };
    c.rerender();
    window.scrollTo({ top: 0 });
  }
  function close(force) {
    if (!force && ed && ed.dirty && !confirm('ยังไม่ได้บันทึกการแก้ไข ต้องการปิดหรือไม่?')) return;
    ed = null;
    ctx.rerender();
  }
  function recompute() {
    if (ed.kind === 'pp5') M().fillPP5(ed.data, true); else M().fillPP6(ed.data, true);
  }
  function touch() { ed.dirty = true; var b = document.getElementById('edDirty'); if (b) b.hidden = false; }

  // ---------- หน้าจอ ----------
  function render(view, c) {
    ctx = c;
    var d = ed.data, m = d.meta, isP5 = ed.kind === 'pp5';
    var title = isP5 ? 'ปพ.5 ' + (m.code || 'วิชาใหม่') + ' ' + (m.subject || '') : 'ปพ.6 ' + (m.className || '');
    var h = '<div class="ed-bar card"><div class="ed-t"><b>' + esc(title) + '</b><span>' + esc((m.levelName || '') + '/' + m.room + ' · ปีการศึกษา ' + m.year) +
      ' · <span class="badge warn" id="edDirty"' + (ed.dirty ? '' : ' hidden') + '>ยังไม่บันทึก</span></span></div>' +
      '<div class="ed-acts"><button class="btn pri" data-ed="save">บันทึกในระบบ</button><button class="btn" data-ed="excel">⬇ ดาวน์โหลด Excel</button><button class="btn" data-ed="close">ปิด</button></div></div>';
    if (ed.intent === 'excel') h += '<p class="note">ตรวจข้อมูล' + (isP5 ? 'วิชา รายชื่อ และตัวชี้วัด' : 'ห้อง รายชื่อ และรายวิชา') + ' แล้วกด <b>ดาวน์โหลด Excel</b> เพื่อนำไปกรอกในคอมพิวเตอร์ กรอกเสร็จแล้วอัปโหลดไฟล์กลับเข้าระบบได้เลย</p>';
    h += '<nav class="tabs ed-tabs">' + SECTIONS[ed.kind].map(function (s) { return '<button data-sec="' + s[0] + '" class="' + (ed.section === s[0] ? 'on' : '') + '">' + s[1] + '</button>'; }).join('') + '</nav>';
    h += '<div id="edBody"></div>';
    view.innerHTML = h;
    var body = document.getElementById('edBody');
    (isP5 ? P5 : P6)[ed.section](body);
    view.onclick = onClick;
    view.onchange = onFormChange;
  }

  function onClick(e) {
    var s = e.target.closest('[data-sec]');
    if (s) { ed.section = s.dataset.sec; ctx.rerender(); return; }
    var b = e.target.closest('[data-ed]');
    if (!b) return;
    var a = b.dataset.ed;
    if (a === 'close') close();
    else if (a === 'save') save();
    else if (a === 'excel') downloadExcel();
    else if (ACTIONS[a]) { ACTIONS[a](b); }
  }
  function onFormChange(e) {
    var t = e.target, path = t.dataset.f;
    if (!path) return;
    var v = t.type === 'number' ? (t.value === '' ? null : parseFloat(t.value)) : t.value;
    var obj = ed.data, parts = path.split('.');
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] = obj[parts[i]] || {};
    obj[parts[parts.length - 1]] = v;
    if (FORM_HOOK[path]) FORM_HOOK[path](v);
    recompute(); touch();
  }
  var FORM_HOOK = {
    'meta.hours': function (v) { if (v != null) { ed.data.hours.t1 = Math.round(v / 2); ed.data.hours.t2 = v - Math.round(v / 2); } },
    'meta.school': function (v) {
      var sg = ed.data.meta.signers;
      if (sg) { if (sg.deputy && /^รองผู้อำนวยการ/.test(sg.deputy.position)) sg.deputy.position = 'รองผู้อำนวยการ' + v; if (sg.director && /^ผู้อำนวยการ/.test(sg.director.position)) sg.director.position = 'ผู้อำนวยการ' + v; }
    },
    'meta.teacher': function (v) { if (ed.data.meta.signers) ed.data.meta.signers.teacher = { name: v, position: 'ครูประจำชั้น' }; }
  };

  function field(label, path, value, type, extra) {
    return '<label class="ed-f"><span>' + esc(label) + '</span><input data-f="' + path + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '"' + (extra || '') + '></label>';
  }
  function selectField(label, path, value, options) {
    return '<label class="ed-f"><span>' + esc(label) + '</span><select data-f="' + path + '">' + options.map(function (o) { return '<option' + (String(o) === String(value) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>';
  }
  function grid(el, opt) {
    opt.onChange = opt.onChange || function () { recompute(); touch(); };
    opt.onPaste = function (n) { ctx.toast('วางข้อมูลแล้ว ' + n + ' ช่อง', 'ok'); recompute(); touch(); grid(el, opt); };
    return new window.PP5Grid(el, opt);
  }
  function tools(html) { return '<div class="ed-tools">' + html + '</div>'; }
  function hint(t) { return '<p class="sub" style="margin:4px 0 10px">' + t + '</p>'; }

  // ---------- นักเรียน (ใช้ร่วมกัน) ----------
  function rosterSection(el) {
    var d = ed.data;
    el.innerHTML = tools('<button class="btn" data-ed="addStu" data-n="1">+ เพิ่ม 1 คน</button><button class="btn" data-ed="addStu" data-n="10">+ เพิ่ม 10 คน</button>' +
      '<button class="btn danger" data-ed="delStu">ลบคนสุดท้าย</button><button class="btn" data-ed="pullRoster">ดึงรายชื่อจากไฟล์อื่นของห้องนี้</button>') +
      hint('เลขประจำตัวนักเรียนใช้ค้นหาผลในหน้าประกาศผล · เลขบัตรประชาชน 4 ตัวท้ายใช้ยืนยันตัวตนผู้ปกครอง (ถ้าเปิดใช้) · คัดลอกหลายแถวจาก Excel มาวางได้') + '<div class="ed-g"></div>';
    grid(el.querySelector('.ed-g'), {
      corner: 'เลขที่', rows: d.students,
      cols: [
        { key: 'id', label: 'เลขประจำตัว', type: 'text', w: 96 },
        { key: 'nid4', label: 'บัตร ปชช.', sub: '4 ตัวท้าย', type: 'text', w: 74, set: function (s, v) { s.nid4 = String(v).replace(/\D/g, '').slice(-4); } },
        { key: 'prefix', label: 'คำนำหน้า', type: 'select', options: PREFIX, free: true, w: 92 },
        { key: 'first', label: 'ชื่อ', type: 'text', w: 120 },
        { key: 'last', label: 'นามสกุล', type: 'text', w: 130 },
        { key: 'sex', label: 'เพศ', type: 'select', options: SEX, w: 60 },
        { key: 'status', label: 'สถานะ', type: 'select', options: STATUS, free: true, w: 90 }
      ],
      onChange: function (s) { s.name = M().fullName(s); if (!s.sex && /^(เด็กชาย|นาย)$/.test(s.prefix)) s.sex = 'ชาย'; if (!s.sex && /^(เด็กหญิง|นางสาว|นาง)$/.test(s.prefix)) s.sex = 'หญิง'; touch(); }
    });
  }
  function newStudentFor(no) {
    var s = M().blankStudent(no);
    if (ed.kind === 'pp5') Object.assign(s, { scores: {}, levels: {}, result: { final: null, rms: '' }, attendance: { t1: {}, t2: {}, year: {} }, characteristics: { items: {} }, rtw: { t1: {}, t2: {} }, activities: { clubName: '', guidance: '', scout: '', club: '', social: '' } });
    else Object.assign(s, { t1: {}, t2: {}, attendance: { t1: {}, t2: {}, year: {} }, health: { t1: {}, t2: {}, behavior: '' }, rtw: { scores: [], total: null, result: '' }, characteristics: { items: [], summary: '' }, competencies: ed.data.competencyGroups.map(function (g) { return g.items.map(function () { return ''; }); }) });
    return s;
  }
  var ACTIONS = {
    addStu: function (b) {
      var n = +b.dataset.n, st = ed.data.students;
      for (var i = 0; i < n; i++) st.push(newStudentFor(st.length + 1));
      recompute(); touch(); ctx.rerender();
    },
    delStu: function () {
      var st = ed.data.students, last = st[st.length - 1];
      if (!last) return;
      if ((last.first || last.id) && !confirm('ลบ ' + (last.name || 'นักเรียนคนสุดท้าย') + ' และคะแนนของคนนี้?')) return;
      st.pop(); touch(); ctx.rerender();
    },
    pullRoster: function () {
      var src = rosterFromClass(ctx);
      if (!src.length) { ctx.toast('ยังไม่มีไฟล์อื่นของห้องนี้ให้ดึงรายชื่อ', 'info'); return; }
      if (!confirm('นำรายชื่อ ' + src.length + ' คนจากไฟล์อื่นของห้องนี้มาใช้? (คะแนนที่กรอกไว้จะจับคู่ตามเลขประจำตัว)')) return;
      var old = {}; ed.data.students.forEach(function (s) { old[s.id || norm(s.name)] = s; });
      ed.data.students = src.map(function (r, i) {
        var o = old[r.id || norm(r.name)] || newStudentFor(i + 1);
        return Object.assign(o, r, { no: i + 1 });
      });
      recompute(); touch(); ctx.rerender();
    },
    addInd: function (b) {
      var inds = ed.data.indicators, n = +b.dataset.n;
      for (var i = 0; i < n; i++) {
        var lastI = inds[inds.length - 1];
        inds.push({ idx: (lastI ? lastI.idx : 0) + 1, term: lastI ? lastI.term : 1, std: lastI ? lastI.std : '', code: '', text: '', max: lastI ? lastI.max : 10 });
      }
      recompute(); touch(); ctx.rerender();
    },
    delInd: function () {
      var inds = ed.data.indicators, x = inds[inds.length - 1];
      if (!x) return;
      var used = ed.data.students.some(function (s) { return s.scores[x.idx] != null; });
      if (used && !confirm('ตัวชี้วัดนี้มีคะแนนแล้ว ลบพร้อมคะแนน?')) return;
      inds.pop(); ed.data.students.forEach(function (s) { delete s.scores[x.idx]; delete s.levels[x.idx]; });
      recompute(); touch(); ctx.rerender();
    },
    addSubj: function () {
      ed.data.subjects.push({ code: '', name: '', credit: 1, hours: 40, basic: false });
      touch(); ctx.rerender();
    },
    delSubj: function () {
      var x = ed.data.subjects[ed.data.subjects.length - 1];
      if (!x || !confirm('ลบรายวิชา ' + (x.name || '') + ' และคะแนนของวิชานี้?')) return;
      ed.data.subjects.pop();
      ed.data.students.forEach(function (s) { delete s.t1[x.code]; delete s.t2[x.code]; });
      delete ed.data.indicatorTable[norm(x.name)];
      recompute(); touch(); ctx.rerender();
    },
    defSubj: function () {
      if (!confirm('ใช้รายวิชาพื้นฐานมาตรฐานของชั้นนี้แทนรายการปัจจุบัน?')) return;
      ed.data.subjects = M().defaultSubjects(ed.data.meta.level);
      ed.data.subjects.forEach(function (s) { if (s.basic && !ed.data.indicatorTable[norm(s.name)]) ed.data.indicatorTable[norm(s.name)] = { total: null, passed: null }; });
      recompute(); touch(); ctx.rerender();
    },
    fillHours: function () {
      var a = parseFloat(document.getElementById('edH1').value), b2 = parseFloat(document.getElementById('edH2').value);
      ed.data.students.forEach(function (s) {
        var at = s.attendance;
        if (isFinite(a)) { at.t1.total = a; if (at.t1.present == null) at.t1.present = a; }
        if (isFinite(b2)) { at.t2.total = b2; if (at.t2.present == null) at.t2.present = b2; }
      });
      recompute(); touch(); ctx.rerender();
    }
  };

  // ---------- ปพ.5 ----------
  var P5 = {
    info: function (el) {
      var m = ed.data.meta, d = ed.data;
      el.innerHTML = '<div class="card ed-form">' +
        field('รหัสวิชา', 'meta.code', m.code, 'text', ' placeholder="เช่น ค14101"') + field('ชื่อวิชา', 'meta.subject', m.subject) +
        field('กลุ่มสาระ', 'meta.group', m.group) + selectField('ประเภทวิชา', 'meta.type', m.type, ['พื้นฐาน', 'เพิ่มเติม']) +
        field('หน่วยกิต', 'meta.credit', m.credit, 'number', ' step="0.5" min="0"') + field('เวลาเรียนทั้งปี (ชม.)', 'meta.hours', m.hours, 'number') +
        field('เวลาเรียนภาค 1 (ชม.)', 'hours.t1', d.hours.t1, 'number') + field('เวลาเรียนภาค 2 (ชม.)', 'hours.t2', d.hours.t2, 'number') +
        field('คะแนนเก็บ (เต็ม)', 'meta.maxCollect', m.maxCollect, 'number') + field('คะแนนปลายภาค (เต็ม)', 'meta.maxFinal', m.maxFinal, 'number') +
        field('ครูผู้สอน', 'meta.teacher', m.teacher) + field('โรงเรียน', 'meta.school', m.school) + '</div>';
    },
    roster: rosterSection,
    ind: function (el) {
      el.innerHTML = tools('<button class="btn" data-ed="addInd" data-n="1">+ เพิ่ม 1 ตัวชี้วัด</button><button class="btn" data-ed="addInd" data-n="5">+ เพิ่ม 5</button><button class="btn danger" data-ed="delInd">ลบตัวสุดท้าย</button>') +
        hint('กำหนดตัวชี้วัดและคะแนนเต็มของแต่ละตัว คะแนนเก็บจะคิดเป็นสัดส่วนจากผลรวมคะแนนเต็ม') + '<div class="ed-g"></div>';
      grid(el.querySelector('.ed-g'), {
        corner: 'ลำดับ', rows: ed.data.indicators, rowLabel: function (x) { return x.idx; },
        cols: [
          { key: 'term', label: 'ภาคเรียน', type: 'select', options: [{ v: 1, t: '1' }, { v: 2, t: '2' }], w: 70, set: function (x, v) { x.term = +v; } },
          { key: 'std', label: 'มาตรฐาน', type: 'text', w: 80 },
          { key: 'code', label: 'ตัวชี้วัด', type: 'text', w: 80 },
          { key: 'text', label: 'คำอธิบาย', type: 'text', w: 380 },
          { key: 'max', label: 'คะแนนเต็ม', type: 'num', w: 70, min: 0 }
        ]
      });
    },
    scores: function (el) {
      var d = ed.data, inds = d.indicators, mx = d.maxima;
      if (!inds.length) { el.innerHTML = '<div class="card empty-state"><b>ยังไม่มีตัวชี้วัด</b>เพิ่มตัวชี้วัดในแท็บ "ตัวชี้วัด" ก่อน</div>'; return; }
      el.innerHTML = hint('กรอกคะแนนแต่ละตัวชี้วัดและคะแนนปลายภาค ระบบคำนวณคะแนนเก็บ รวม และเกรดให้ทันที · ช่องสีแดง = เกินคะแนนเต็ม') + '<div class="ed-g"></div>';
      var cols = inds.map(function (i) {
        return { label: i.code || ('#' + i.idx), sub: '/' + (i.max == null ? '?' : i.max), group: 'ภาคเรียนที่ ' + (i.term || 1), type: 'num', w: 54, max: i.max, min: 0,
          get: function (s) { return s.scores[i.idx]; }, set: function (s, v) { if (v == null) delete s.scores[i.idx]; else s.scores[i.idx] = v; } };
      });
      cols.push({ label: 'ปลายภาค', sub: '/' + mx.final, group: 'สรุป', type: 'num', w: 64, max: mx.final, min: 0, get: function (s) { return s.result.final; }, set: function (s, v) { s.result.final = v; } });
      cols.push({ label: 'ร/มส', group: 'สรุป', type: 'select', options: ['', 'ร', 'มส'], w: 56, get: function (s) { return s.result.rms; }, set: function (s, v) { s.result.rms = v; } });
      cols.push({ label: 'รวมตัวชี้วัด', sub: '/' + (mx.indTotal || 0), group: 'สรุป', type: 'ro', w: 64, get: function (s) { return s.result.indTotal; } });
      cols.push({ label: 'คะแนนเก็บ', sub: '/' + mx.collect, group: 'สรุป', type: 'ro', w: 64, get: function (s) { return s.result.collect; } });
      cols.push({ label: 'รวม', sub: '/' + mx.total, group: 'สรุป', type: 'ro', w: 54, cls: 'g-strong', get: function (s) { return s.result.total; } });
      cols.push({ label: 'เกรด', group: 'สรุป', type: 'ro', w: 50, cls: 'g-strong', get: function (s) { return s.result.rms || s.result.grade; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    att: function (el) {
      var d = ed.data;
      el.innerHTML = hint('เวลาเรียน ภาค 1 = ' + (d.hours.t1 || 0) + ' ชม. ภาค 2 = ' + (d.hours.t2 || 0) + ' ชม. (แก้ได้ในแท็บ "ข้อมูลวิชา") · กรอกเฉพาะชั่วโมงที่ ป่วย / ลา / ขาด ช่องว่าง = ไม่ขาด') + '<div class="ed-g"></div>';
      var cols = [];
      [['t1', 'ภาคเรียนที่ 1'], ['t2', 'ภาคเรียนที่ 2']].forEach(function (t) {
        [['sick', 'ป่วย'], ['leave', 'ลา'], ['absent', 'ขาด']].forEach(function (k) {
          cols.push({ label: k[1], group: t[1], type: 'num', w: 52, min: 0, get: function (s) { return s.attendance[t[0]][k[0]]; }, set: function (s, v) { s.attendance[t[0]][k[0]] = v; } });
        });
        cols.push({ label: 'มาเรียน', group: t[1], type: 'ro', w: 58, get: function (s) { return s.attendance[t[0]].present; } });
      });
      cols.push({ label: 'ร้อยละ', group: 'ทั้งปี', type: 'ro', w: 60, dec: 2, get: function (s) { return s.attendance.year.pct; } });
      cols.push({ label: 'ผล', group: 'ทั้งปี', type: 'ro', w: 64, get: function (s) { return s.attendance.result; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    char: function (el) {
      var d = ed.data;
      el.innerHTML = hint('ให้คะแนน 0-3 (3 = ดีเยี่ยม, 2 = ดี, 1 = ผ่าน, 0 = ไม่ผ่าน)') + '<div class="ed-g"></div>';
      var cols = d.characteristicItems.map(function (it) {
        return { label: String(it.no), sub: it.name, group: 'คุณลักษณะอันพึงประสงค์ข้อที่', type: 'num', w: 64, max: it.max, min: 0, get: function (s) { return s.characteristics.items[it.no]; }, set: function (s, v) { s.characteristics.items[it.no] = v; } };
      });
      cols.push({ label: 'เฉลี่ย', group: 'ผล', type: 'ro', w: 54, dec: 2, get: function (s) { return s.characteristics.avg; } });
      cols.push({ label: 'ผลประเมิน', group: 'ผล', type: 'ro', w: 72, get: function (s) { return s.characteristics.text; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    rtw: function (el) {
      var d = ed.data;
      el.innerHTML = hint('ให้คะแนน 0-3 แต่ละด้าน') + '<div class="ed-g"></div>';
      var cols = [];
      [['t1', 'ภาคเรียนที่ 1'], ['t2', 'ภาคเรียนที่ 2']].forEach(function (t) {
        [['read', 'อ่าน'], ['think', 'คิด'], ['write', 'เขียน']].forEach(function (k) {
          cols.push({ label: k[1], group: t[1], type: 'num', w: 52, max: 3, min: 0, get: function (s) { return s.rtw[t[0]][k[0]]; }, set: function (s, v) { s.rtw[t[0]][k[0]] = v; } });
        });
      });
      cols.push({ label: 'เฉลี่ย', group: 'ผล', type: 'ro', w: 54, dec: 2, get: function (s) { return s.rtw.avg; } });
      cols.push({ label: 'ผลประเมิน', group: 'ผล', type: 'ro', w: 72, get: function (s) { return s.rtw.text; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    act: function (el) {
      var d = ed.data;
      el.innerHTML = hint('ผ. = ผ่าน, มผ. = ไม่ผ่าน · ใช้ช่อง "ทั้งคอลัมน์" เพื่อใส่ค่าเดียวกันทุกคน') + '<div class="ed-g"></div>';
      var A = [['guidance', 'แนะแนว'], ['scout', 'ลูกเสือ-เนตรนารี'], ['club', 'ชุมนุม'], ['social', 'เพื่อสังคมฯ']];
      var cols = [{ label: 'ชื่อชุมนุม', type: 'text', w: 130, get: function (s) { return s.activities.clubName; }, set: function (s, v) { s.activities.clubName = v; } }]
        .concat(A.map(function (a) { return { label: a[1], type: 'select', options: ACT_OPT, fill: true, w: 96, get: function (s) { return s.activities[a[0]]; }, set: function (s, v) { s.activities[a[0]] = v; } }; }));
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    }
  };

  // ---------- ปพ.6 ----------
  var P6 = {
    info: function (el) {
      var m = ed.data.meta, sg = m.signers || {};
      el.innerHTML = '<div class="card ed-form">' +
        '<label class="ed-f"><span>ชั้น</span><input value="' + esc(m.className) + '" disabled></label>' +
        field('ครูประจำชั้น', 'meta.teacher', m.teacher) + field('โรงเรียน', 'meta.school', m.school, 'text', ' placeholder="เช่น โรงเรียนวัดทุ่งแฝก"') +
        field('รองผู้อำนวยการ (ชื่อ)', 'meta.signers.deputy.name', sg.deputy && sg.deputy.name) + field('ตำแหน่ง', 'meta.signers.deputy.position', sg.deputy && sg.deputy.position) +
        field('ผู้อำนวยการ (ชื่อ)', 'meta.signers.director.name', sg.director && sg.director.name) + field('ตำแหน่ง', 'meta.signers.director.position', sg.director && sg.director.position) +
        field('คะแนนเต็มต่อภาคเรียน', 'meta.termMax', m.termMax, 'number') +
        '<label class="ed-f wide"><span>สาเหตุที่ได้เลื่อนชั้น (แสดงในใบรายงาน)</span><input data-f="meta.reason" value="' + esc(m.reason || '') + '"></label></div>';
    },
    roster: rosterSection,
    subj: function (el) {
      var d = ed.data;
      el.innerHTML = tools('<button class="btn" data-ed="addSubj">+ เพิ่มรายวิชา</button><button class="btn danger" data-ed="delSubj">ลบวิชาสุดท้าย</button><button class="btn" data-ed="defSubj">ใช้รายวิชามาตรฐานของชั้นนี้</button>') +
        hint('จำนวนตัวชี้วัดใช้แสดงในใบรายงาน (ถ้าอัปโหลด ปพ.5 ของวิชานั้นไว้ ระบบจะใช้ผลจริงจาก ปพ.5 แทน)') + '<div class="ed-g"></div>';
      grid(el.querySelector('.ed-g'), {
        corner: 'ที่', rows: d.subjects,
        cols: [
          { key: 'code', label: 'รหัสวิชา', type: 'text', w: 90, set: function (s, v) {
            var old = s.code; s.code = v;
            if (old && old !== v) d.students.forEach(function (st) { ['t1', 't2'].forEach(function (t) { if (st[t][old] !== undefined) { st[t][v] = st[t][old]; delete st[t][old]; } }); });
          } },
          { key: 'name', label: 'ชื่อวิชา', type: 'text', w: 230, set: function (s, v) {
            var old = norm(s.name); s.name = v;
            if (d.indicatorTable[old]) { d.indicatorTable[norm(v)] = d.indicatorTable[old]; if (old !== norm(v)) delete d.indicatorTable[old]; }
          } },
          { key: 'credit', label: 'หน่วยกิต', type: 'num', w: 64, min: 0 },
          { key: 'hours', label: 'ชม./ปี', type: 'num', w: 64, min: 0 },
          { label: 'ประเภท', type: 'select', w: 90, options: [{ v: 'true', t: 'พื้นฐาน' }, { v: 'false', t: 'เพิ่มเติม' }], get: function (s) { return String(!!s.basic); }, set: function (s, v) {
            s.basic = v === 'true' || v === true;
            if (s.basic && !d.indicatorTable[norm(s.name)]) d.indicatorTable[norm(s.name)] = { total: null, passed: null };
          } },
          { label: 'ตัวชี้วัดทั้งหมด', type: 'num', w: 80, min: 0, get: function (s) { var x = d.indicatorTable[norm(s.name)]; return x ? x.total : null; }, set: function (s, v) { (d.indicatorTable[norm(s.name)] = d.indicatorTable[norm(s.name)] || {}).total = v; } },
          { label: 'ตัวชี้วัดที่ผ่าน', type: 'num', w: 80, min: 0, get: function (s) { var x = d.indicatorTable[norm(s.name)]; return x ? x.passed : null; }, set: function (s, v) { (d.indicatorTable[norm(s.name)] = d.indicatorTable[norm(s.name)] || {}).passed = v; } }
        ]
      });
    },
    t1: function (el) { termGrid(el, 't1'); },
    t2: function (el) { termGrid(el, 't2'); },
    att: function (el) {
      var d = ed.data;
      el.innerHTML = tools('ใส่เวลาเรียนให้ทุกคน: ภาค 1 <input id="edH1" type="number" class="ed-mini" placeholder="ชม."> ภาค 2 <input id="edH2" type="number" class="ed-mini" placeholder="ชม."> <button class="btn" data-ed="fillHours">ใช้กับทุกคน</button>') +
        hint('กรอกจำนวนชั่วโมงเรียนทั้งหมด และชั่วโมงที่มาเรียน') + '<div class="ed-g"></div>';
      var cols = [];
      [['t1', 'ภาคเรียนที่ 1'], ['t2', 'ภาคเรียนที่ 2']].forEach(function (t) {
        cols.push({ label: 'เวลาเรียน', group: t[1], type: 'num', w: 64, min: 0, get: function (s) { return s.attendance[t[0]].total; }, set: function (s, v) { s.attendance[t[0]].total = v; } });
        cols.push({ label: 'มาเรียน', group: t[1], type: 'num', w: 64, min: 0, get: function (s) { return s.attendance[t[0]].present; }, set: function (s, v) { s.attendance[t[0]].present = v; } });
      });
      cols.push({ label: 'ร้อยละ', group: 'ทั้งปี', type: 'ro', w: 64, dec: 2, get: function (s) { return s.attendance.year.pct; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    health: function (el) {
      var d = ed.data;
      el.innerHTML = hint('น้ำหนัก (กก.) ส่วนสูง (ซม.) และความคิดเห็นของครูประจำชั้น (แสดงในใบรายงานหน้า 2)') + '<div class="ed-g"></div>';
      var cols = [];
      [['t1', 'ภาคเรียนที่ 1'], ['t2', 'ภาคเรียนที่ 2']].forEach(function (t) {
        cols.push({ label: 'น้ำหนัก', group: t[1], type: 'num', w: 60, get: function (s) { return s.health[t[0]].w; }, set: function (s, v) { s.health[t[0]].w = v; } });
        cols.push({ label: 'ส่วนสูง', group: t[1], type: 'num', w: 60, get: function (s) { return s.health[t[0]].h; }, set: function (s, v) { s.health[t[0]].h = v; } });
      });
      cols.push({ label: 'ความคิดเห็นของครู', type: 'text', w: 420, get: function (s) { return s.health.behavior; }, set: function (s, v) { s.health.behavior = v; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    rtw: function (el) {
      var d = ed.data;
      el.innerHTML = hint('ผลรวม 80+ = ดีเยี่ยม, 70+ = ดี, 50+ = ผ่าน') + '<div class="ed-g"></div>';
      var cols = d.rtwItems.map(function (it, i) {
        return { label: it.short || it.name, sub: '/' + it.max, type: 'num', w: 80, max: it.max, min: 0, get: function (s) { return s.rtw.scores[i]; }, set: function (s, v) { s.rtw.scores[i] = v; } };
      });
      cols.push({ label: 'รวม', type: 'ro', w: 56, get: function (s) { return s.rtw.total; } });
      cols.push({ label: 'ผลประเมิน', type: 'ro', w: 76, get: function (s) { return s.rtw.result; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    char: function (el) {
      var d = ed.data;
      el.innerHTML = hint('ใช้ช่อง "ทั้งคอลัมน์" เพื่อใส่ค่าเดียวกันทุกคน แล้วค่อยแก้เฉพาะคน · สรุป = ค่าที่พบบ่อยที่สุด') + '<div class="ed-g"></div>';
      var cols = d.characteristicItems.map(function (n, i) {
        return { label: 'ข้อ ' + (i + 1), sub: n, type: 'select', options: CHAR_OPT, fill: true, w: 96, get: function (s) { return s.characteristics.items[i] || ''; }, set: function (s, v) { s.characteristics.items[i] = v; } };
      });
      cols.push({ label: 'สรุป', type: 'ro', w: 64, get: function (s) { return s.characteristics.summary; } });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    },
    comp: function (el) {
      var d = ed.data;
      el.innerHTML = hint('ใช้ช่อง "ทั้งคอลัมน์" เพื่อใส่ค่าเดียวกันทุกคน') + '<div class="ed-g"></div>';
      var cols = [];
      d.competencyGroups.forEach(function (g, gi) {
        g.items.forEach(function (it, ii) {
          cols.push({ label: it, group: g.name.replace('ความสามารถใน', ''), type: 'select', options: COMP_OPT, fill: true, w: 104,
            get: function (s) { return (s.competencies[gi] || [])[ii] || ''; }, set: function (s, v) { s.competencies[gi] = s.competencies[gi] || []; s.competencies[gi][ii] = v; } });
        });
      });
      grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
    }
  };
  function termGrid(el, t) {
    var d = ed.data, max = d.meta.termMax || 50;
    el.innerHTML = hint('คะแนนเก็บ + คะแนนสอบ ของภาคเรียนนี้ รวมไม่เกิน ' + max + ' คะแนนต่อวิชา (สองภาครวม ' + (max * 2) + ')') + '<div class="ed-g"></div>';
    var cols = [];
    d.subjects.forEach(function (sub) {
      var get = function (s, k) { var x = s[t][sub.code]; return x ? x[k] : null; };
      var set = function (s, k, v) { var x = s[t][sub.code] = s[t][sub.code] || {}; x[k] = v; };
      cols.push({ label: 'เก็บ', group: sub.name || sub.code, type: 'num', w: 50, min: 0, max: max, get: function (s) { return get(s, 'collect'); }, set: function (s, v) { set(s, 'collect', v); } });
      cols.push({ label: 'สอบ', group: sub.name || sub.code, type: 'num', w: 50, min: 0, max: max, get: function (s) { return get(s, 'exam'); }, set: function (s, v) { set(s, 'exam', v); } });
      cols.push({ label: 'รวม', group: sub.name || sub.code, type: 'ro', w: 46, cls: 'g-strong', get: function (s) { return get(s, 'total'); } });
    });
    grid(el.querySelector('.ed-g'), { corner: 'นักเรียน', rows: d.students, rowLabel: studentLabel, cols: cols });
  }
  function studentLabel(s) { return '<span class="g-name">' + s.no + '. ' + esc(s.first ? M().fullName(s) : '(ยังไม่มีชื่อ)') + '</span>'; }

  // ---------- บันทึก / ส่งออก ----------
  function cleaned() {
    var d = clone(ed.data);
    d.students = d.students.filter(function (s) { return s.first || s.last || s.id; });
    d.students.forEach(function (s, i) { s.no = i + 1; s.name = M().fullName(s); });
    if (ed.kind === 'pp5') {
      d.indicators = d.indicators.filter(function (i) { return i.max != null || i.code; });
      d.meta.levelName = d.meta.stage + '.' + d.meta.level;
      return M().fillPP5(d, true);
    }
    return M().fillPP6(d, true);
  }
  function validate(d) {
    var errs = [];
    if (ed.kind === 'pp5') {
      if (!d.meta.code) errs.push('ยังไม่ได้กรอกรหัสวิชา');
      if (!d.meta.subject) errs.push('ยังไม่ได้กรอกชื่อวิชา');
    } else if (!d.subjects.length) errs.push('ยังไม่มีรายวิชา');
    var ids = {}, dup = [];
    d.students.forEach(function (s) { if (s.id) { if (ids[s.id]) dup.push(s.id); ids[s.id] = 1; } });
    if (dup.length) errs.push('เลขประจำตัวซ้ำกัน: ' + dup.join(', '));
    return errs;
  }
  async function save() {
    var d = cleaned(), errs = validate(d);
    if (errs.length) { ctx.toast(errs.join(' · '), 'err'); return; }
    if (!d.students.length && !confirm('ยังไม่มีรายชื่อนักเรียน บันทึกต่อหรือไม่?')) return;
    var noId = d.students.filter(function (s) { return !s.id; }).length;
    try {
      ctx.setBusy('กำลังบันทึก...');
      var rec = await ctx.saveEdited(ed.kind, d, ed.oldKey);
      ed.oldKey = rec.key; ed.dirty = false;
      ctx.toast('บันทึกแล้ว' + (noId ? ' (มี ' + noId + ' คนที่ยังไม่มีเลขประจำตัว จะค้นหาผลในหน้าประกาศผลไม่ได้)' : ''), noId ? 'info' : 'ok');
      ed = null;
      ctx.rerender();
    } catch (e) {
      console.error(e);
      ctx.toast('บันทึกไม่สำเร็จ: ' + (e && e.message ? e.message : e), 'err');
    } finally { ctx.setBusy(''); }
  }
  function downloadExcel() {
    var d = cleaned();
    if (ed.kind === 'pp5' && !d.meta.code) { ctx.toast('กรอกรหัสวิชาก่อน', 'err'); ed.section = 'info'; ctx.rerender(); return; }
    var wb = ed.kind === 'pp5' ? M().exportPP5(d) : M().exportPP6(d);
    ctx.downloadBlob(M().toBlob(wb), ctx.fileNameFor(ed.kind, d.meta));
    ctx.toast('ดาวน์โหลดแล้ว กรอกเสร็จแล้วอัปโหลดกลับเข้าระบบได้เลย', 'ok');
  }

  window.PP5Editor = {
    open: open, close: close, render: render,
    active: function () { return !!ed; }
  };
})();
