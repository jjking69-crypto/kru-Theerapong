/* ระบบวิเคราะห์ผลการเรียนจากไฟล์ ปพ.5 — ทำงานในเบราว์เซอร์ทั้งหมด เก็บข้อมูลใน IndexedDB */
(function () {
  'use strict';

  // ---------- รายวิชาพื้นฐาน (ช่องอัปโหลด) ----------
  var CORE = [
    { slot: 'th',   letter: 'ท', name: 'ภาษาไทย',                         color: '#d9480f' },
    { slot: 'ma',   letter: 'ค', name: 'คณิตศาสตร์',                       color: '#1971c2' },
    { slot: 'sci',  letter: 'ว', name: 'วิทยาศาสตร์และเทคโนโลยี',           color: '#2b8a3e' },
    { slot: 'soc',  letter: 'ส', name: 'สังคมศึกษา ศาสนา และวัฒนธรรม',      color: '#e67700', tail: '01' },
    { slot: 'his',  letter: 'ส', name: 'ประวัติศาสตร์',                     color: '#a05a2c', tail: '02' },
    { slot: 'pe',   letter: 'พ', name: 'สุขศึกษาและพลศึกษา',               color: '#0c8599' },
    { slot: 'art',  letter: 'ศ', name: 'ศิลปะ',                            color: '#c2255c' },
    { slot: 'work', letter: 'ง', name: 'การงานอาชีพ',                      color: '#5f3dc4' },
    { slot: 'eng',  letter: 'อ', name: 'ภาษาอังกฤษ',                       color: '#364fc7' }
  ];
  var EXTRA_COLOR = '#495057';
  var LEVELS = [1, 2, 3, 4, 5, 6];
  var GRADE_ORDER = ['4', '3.5', '3', '2.5', '2', '1.5', '1', '0'];
  var GRADE_COLOR = { '4': '#0f8a4f', '3.5': '#2f9e5d', '3': '#4a9f2f', '2.5': '#8a9a12', '2': '#b88300', '1.5': '#cf6a10', '1': '#d24b1c', '0': '#c62f3a' };

  // ---------- ฐานข้อมูลในเครื่อง ----------
  // ที่เก็บข้อมูล: ค่าเริ่มต้นคือ IndexedDB ในเครื่อง; รุ่น Apps Script กำหนด window.PP5_STORE (เก็บใน Google Drive)
  var LocalDB = {
    db: null,
    open: function () {
      var self = this;
      return new Promise(function (res, rej) {
        var rq = indexedDB.open('pp5-analyzer', 3);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'kind' });
          if (!db.objectStoreNames.contains('roster')) db.createObjectStore('roster', { keyPath: 'key' });
        };
        rq.onsuccess = function () { self.db = rq.result; res(); };
        rq.onerror = function () { rej(rq.error); };
      });
    },
    tx: function (mode, fn, store) {
      var self = this;
      return new Promise(function (res, rej) {
        var t = self.db.transaction(store || 'files', mode), st = t.objectStore(store || 'files'), out;
        var r = fn(st);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    },
    all: function () { return this.tx('readonly', function (s) { return s.getAll(); }); },
    put: function (rec) { return this.tx('readwrite', function (s) { return s.put(rec); }); },
    del: function (key) { return this.tx('readwrite', function (s) { return s.delete(key); }); },
    clear: function () { return this.tx('readwrite', function (s) { return s.clear(); }); },
    // แม่แบบไฟล์รูปแบบต้นฉบับ (ปพ.5 / ปพ.6)
    getTemplate: function (kind) { return this.tx('readonly', function (s) { return s.get(kind); }, 'templates'); },
    putTemplate: function (kind, bytes, name) { return this.tx('readwrite', function (s) { return s.put({ kind: kind, bytes: bytes, name: name, savedAt: Date.now() }); }, 'templates'); },
    getRoster: function () { return this.tx('readonly', function (s) { return s.get('current'); }, 'roster'); },
    putRoster: function (r) { var o = Object.assign({ key: 'current' }, r); return this.tx('readwrite', function (s) { return s.put(o); }, 'roster').then(function () { return o; }); },
    templateInfo: function () {
      return this.tx('readonly', function (s) { return s.getAll(); }, 'templates').then(function (all) {
        var o = {}; (all || []).forEach(function (t) { o[t.kind] = { name: t.name, savedAt: t.savedAt }; }); return o;
      });
    }
  };
  var DB = window.PP5_STORE || LocalDB;

  // ---------- สถานะ ----------
  var records = [];           // ไฟล์ทั้งหมดที่อัปโหลด
  var state = { year: null, level: 4, room: 1, tab: 'subjects', student: null };
  try { Object.assign(state, JSON.parse(localStorage.getItem('pp5-ui') || '{}')); } catch (e) {}
  function saveUI() { try { localStorage.setItem('pp5-ui', JSON.stringify(state)); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var view = $('view');

  function esc(v) {
    return v == null ? '' : String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v, d) {
    if (v == null || v === '') return '<span class="empty-cell">–</span>';
    if (typeof v === 'number') return String(Math.round(v * Math.pow(10, d == null ? 2 : d)) / Math.pow(10, d == null ? 2 : d));
    return esc(v);
  }

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'err' ? 7000 : 4200);
  }

  var busy = document.createElement('div');
  busy.className = 'busy';
  document.body.appendChild(busy);
  function setBusy(text) { busy.textContent = text || ''; busy.classList.toggle('on', !!text); }

  // ---------- จัดไฟล์เข้าช่องวิชา ----------
  function slotOf(meta) {
    var code = meta.code || '';
    var m = code.match(/^([ก-ฮ])(\d)(\d)(\d)(\d\d)$/);
    var basic = m ? m[4] === '1' : meta.type === 'พื้นฐาน';
    if (basic) {
      var letter = m ? m[1] : null;
      var hits = CORE.filter(function (c) { return c.letter === letter; });
      if (hits.length === 1) return hits[0].slot;
      if (hits.length > 1) {
        // ส มีสองช่อง: ตัดสินจากชื่อวิชา (บางชั้นใช้รหัสซ้ำกัน เช่น ป.2 ประวัติศาสตร์ / การป้องกันการทุจริต = ส12102)
        if (/ประวัติ/.test(meta.subject)) return 'his';
        if (/สังคม/.test(meta.subject)) return 'soc';
        if (meta.subject) return 'x-' + code + '-' + meta.subject.replace(/\s+/g, '');
        var tail = m ? m[5] : '';
        var t = hits.filter(function (c) { return c.tail === tail; })[0];
        return t ? t.slot : hits[0].slot;
      }
      var byName = CORE.filter(function (c) { return meta.subject && meta.subject.indexOf(c.name) === 0; })[0];
      if (byName) return byName.slot;
    }
    return 'x-' + (code || meta.subject).replace(/\s+/g, '');
  }
  function slotInfo(slot, rec) {
    var c = CORE.filter(function (x) { return x.slot === slot; })[0];
    if (c) return c;
    var name = rec ? rec.data.meta.subject : 'รายวิชาเพิ่มเติม';
    return { slot: slot, letter: (rec && rec.data.meta.code ? rec.data.meta.code.charAt(0) : '+'), name: name, color: EXTRA_COLOR, extra: true };
  }
  function classKey(year, level, room) { return year + '|' + level + '|' + room; }
  function recKey(meta) { return classKey(meta.year, meta.level, meta.room) + '|' + slotOf(meta); }

  function newFileName(meta, original) {
    var ext = (original.match(/\.(xlsm|xlsx|xls)$/i) || ['.xlsm'])[0].toLowerCase();
    var name = [meta.levelName + '-' + meta.room, meta.code, meta.subject, 'ปี' + meta.year]
      .filter(Boolean).join('_');
    return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() + ext;
  }

  function pp6FileName(meta, original) {
    var ext = (original.match(/\.(xlsm|xlsx|xls)$/i) || ['.xlsx'])[0].toLowerCase();
    return (meta.levelName + '-' + meta.room + '_ปพ6_รายงานผลรายบุคคล_ปี' + meta.year).replace(/[\\/:*?"<>|]+/g, '-') + ext;
  }

  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  // expected = { level, room, slot } เมื่ออัปโหลดผ่านช่องวิชาโดยตรง
  async function handleFiles(files, expected) {
    var docs = Array.prototype.filter.call(files, function (f) { return /\.docx$/i.test(f.name); });
    if (docs.length) { await handleRoster(docs[0]); if (docs.length === files.length) return; }
    files = Array.prototype.filter.call(files, function (f) { return /\.(xlsm|xlsx|xls)$/i.test(f.name); });
    if (!files.length) { toast('กรุณาเลือกไฟล์ Excel (.xlsm / .xlsx)', 'err'); return; }
    if (typeof XLSX === 'undefined') { toast('ยังโหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต) กรุณารีเฟรชหน้าแล้วลองใหม่', 'err'); return; }
    var last = null, ok = 0, changedClasses = {};
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      setBusy('กำลังอ่านไฟล์ ' + (i + 1) + '/' + files.length + ' : ' + f.name);
      await new Promise(function (r) { setTimeout(r, 30); });
      try {
        var buf = await readFile(f);
        var u8 = new Uint8Array(buf);
        var wb = XLSX.read(u8, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false });
        var isPP6 = PP6Parser.isPP6(wb);
        var data = isPP6 ? PP5Model.fillPP6(PP6Parser.parse(wb, u8), false) : PP5Model.fillPP5(PP5Parser.parseWorkbook(wb), false);
        var meta = data.meta;
        var slot = isPP6 ? 'pp6' : slotOf(meta);
        var key = classKey(meta.year, meta.level, meta.room) + '|' + slot;
        var existed = records.filter(function (r) { return r.key === key; })[0];
        if (isPP6 && existed && existed.data && !Object.keys(data.images || {}).length && existed.data.images) {
          data.images = existed.data.images; data.allImages = existed.data.allImages || [];
        }
        var rec = {
          key: key, year: meta.year, level: meta.level, room: meta.room, slot: slot,
          fileName: isPP6 ? pp6FileName(meta, f.name) : newFileName(meta, f.name), origName: f.name, size: f.size,
          uploadedAt: Date.now(), blob: new Blob([buf], { type: f.type || 'application/vnd.ms-excel.sheet.macroEnabled.12' }),
          data: data, settings: existed && existed.settings ? existed.settings : undefined
        };
        var saved = await DB.put(rec);
        if (saved && typeof saved === 'object') Object.assign(rec, saved);
        records = records.filter(function (r) { return r.key !== key; }).concat([rec]);
        last = rec; ok++;
        var where = isPP6 ? meta.levelName + '/' + meta.room + ' ใบรายงาน ปพ.6' : meta.levelName + '/' + meta.room + ' วิชา ' + meta.code + ' ' + meta.subject;
        if (isPP6 && !expected) state.tab = 'report';
        var tk = window.PP5Templates ? PP5Templates.detect(wb.SheetNames) : null;
        if (tk && !tplInfo[tk]) {
          try { await registerTemplate(tk, u8, f.name, true); } catch (te) { console.warn('template', te); }
        }
        changedClasses[classKey(meta.year, meta.level, meta.room)] = { year: meta.year, level: meta.level, room: meta.room };
        if (expected && (expected.level !== meta.level || expected.room !== meta.room || expected.slot !== slot)) {
          toast('ไฟล์นี้เป็นของ ' + where + ' (ตามชีตตั้งค่า) จึงจัดเก็บไว้ที่ช่องนั้นแทน', 'info');
        } else {
          toast((existed ? 'แทนที่ไฟล์เดิม: ' : 'บันทึกแล้ว: ') + where + ' — ' + data.students.length + ' คน', 'ok');
        }
      } catch (err) {
        console.error(err);
        toast('อ่านไฟล์ "' + f.name + '" ไม่ได้: ' + (err && err.message ? err.message : err), 'err');
      }
    }
    setBusy('');
    Object.keys(changedClasses).forEach(function (k) { afterChange(changedClasses[k]); });
    if (last) {
      state.year = last.year; state.level = last.level; state.room = last.room;
      if (ok > 0 && state.tab === 'student') state.student = null;
      saveUI();
    }
    render();
  }

  // ---------- ทะเบียนรายชื่อนักเรียน (ไฟล์ Word) ----------
  var roster = null; // { fileName, bytes?, url?, data, uploadedAt }
  async function handleRoster(file) {
    try {
      setBusy('กำลังอ่านไฟล์รายชื่อ...');
      var bytes = new Uint8Array(await readFile(file));
      var data = await PP5Roster.parseDocx(bytes);
      setBusy('');
      var newDate = data.date ? data.date.display : (data.dateText || 'ไม่ระบุวันที่');
      if (roster && roster.data) {
        var oldDate = roster.data.date ? roster.data.date.display : (roster.data.dateText || '-');
        if (!confirm('อัปเดตทะเบียนรายชื่อ\nเดิม: ข้อมูลวันที่ ' + oldDate + ' (' + roster.data.total + ' คน)\nใหม่: ข้อมูลวันที่ ' + newDate + ' (' + data.total + ' คน)\n\nต้องการใช้ไฟล์ใหม่หรือไม่?')) return;
      }
      setBusy('กำลังบันทึกทะเบียนรายชื่อ...');
      var saved = await DB.putRoster({ fileName: file.name, bytes: bytes, data: data, uploadedAt: Date.now() });
      roster = Object.assign({ fileName: file.name, data: data, uploadedAt: Date.now() }, saved || {});
      if (DB !== LocalDB) roster.bytes = bytes;
      toast('อัปเดตรายชื่อนักเรียนตามข้อมูลวันที่ ' + newDate + ' แล้ว (' + data.classes.length + ' ห้อง ' + data.total + ' คน)' + (data.warnings.length ? ' · มีข้อควรตรวจ ' + data.warnings.length + ' รายการ' : ''), data.warnings.length ? 'info' : 'ok');
      if (data.year && years().indexOf(data.year) < 0) state.year = data.year;
      state.tab = 'roster';
    } catch (e) {
      console.error(e);
      toast('อ่านไฟล์รายชื่อไม่ได้: ' + (e && e.message ? e.message : e), 'err');
    } finally { setBusy(''); render(); }
  }
  function rosterClass(cls) { return roster && roster.data ? PP5Roster.findClass(roster.data, cls.year, 'ป', cls.level, cls.room) : null; }
  function downloadRoster() {
    if (!roster) return;
    if (roster.bytes) downloadBlob(new Blob([roster.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), roster.fileName || 'รายชื่อนักเรียน.docx');
    else if (roster.url) window.open(roster.url, '_blank', 'noopener');
  }
  function renderRosterBar() {
    var el = $('rosterBar');
    if (!el) return;
    if (!roster || !roster.data) {
      el.innerHTML = '<div class="card roster-bar empty"><span>📋 ยังไม่มีทะเบียนรายชื่อนักเรียน</span><button class="btn pri" data-rb="up">อัปโหลดไฟล์รายชื่อ (.docx)</button></div>';
      return;
    }
    var d = roster.data, dt = d.date ? d.date.display : (d.dateText || 'ไม่ระบุวันที่');
    el.innerHTML = '<div class="card roster-bar"><div class="rb-t">📋 <b>รายชื่อนักเรียนปีการศึกษา ' + esc(d.year || '') + ' อัปเดตตามข้อมูลวันที่ ' + esc(dt) + '</b>' +
      '<span>' + d.classes.length + ' ห้อง · ' + d.total + ' คน · ไฟล์ ' + esc(roster.fileName || '') + (d.warnings.length ? ' · <span class="badge warn">ข้อควรตรวจ ' + d.warnings.length + '</span>' : '') + '</span></div>' +
      '<div class="rb-a"><button class="btn" data-rb="view">ดูรายชื่อ</button><button class="btn" data-rb="dl">⬇ ดาวน์โหลดไฟล์</button><button class="btn pri" data-rb="up">อัปโหลดรายชื่อใหม่</button></div></div>';
  }

  // ---------- เลือกข้อมูลของห้องปัจจุบัน ----------
  function years() {
    var ys = {};
    records.forEach(function (r) { ys[r.year] = 1; });
    if (roster && roster.data && roster.data.year) ys[roster.data.year] = 1;
    var list = Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });
    if (!list.length) list = [thaiYear()];
    return list;
  }
  function thaiYear() {
    var d = new Date(), y = d.getFullYear() + 543;
    return d.getMonth() < 4 ? y - 1 : y; // ปีการศึกษาเริ่ม พ.ค.
  }
  function roomsOf(year, level) {
    var rs = {};
    records.forEach(function (r) { if (r.year === year && r.level === level) rs[r.room] = 1; });
    var list = Object.keys(rs).map(Number).sort(function (a, b) { return a - b; });
    return list.length ? list : [1];
  }
  function classRecords() {
    return records.filter(function (r) { return r.slot !== 'pp6' && r.year === state.year && r.level === state.level && r.room === state.room; })
      .sort(function (a, b) { return slotOrder(a.slot) - slotOrder(b.slot) || a.data.meta.code.localeCompare(b.data.meta.code); });
  }
  function pp6Record() {
    return records.filter(function (r) { return r.slot === 'pp6' && r.year === state.year && r.level === state.level && r.room === state.room; })[0] || null;
  }
  async function removeRecord(rec) {
    if (!confirm('ลบไฟล์ ' + rec.fileName + ' ออกจากระบบ?')) return;
    await DB.del(rec.key);
    records = records.filter(function (r) { return r.key !== rec.key; });
    toast('ลบแล้ว', 'info');
    afterChange({ year: rec.year, level: rec.level, room: rec.room });
    render();
  }

  // ---------- ตัวช่วยสำหรับ editor / ประกาศผล ----------
  function recsOf(cls) { return records.filter(function (r) { return r.year === cls.year && r.level === cls.level && r.room === cls.room; }); }
  function ctxFor(cls) {
    var rs = recsOf(cls);
    var subj = function () { return rs.filter(function (r) { return r.slot !== 'pp6'; }); };
    return {
      esc: esc, toast: toast, setBusy: setBusy, rerender: function () { render(); }, store: function () { return DB === LocalDB ? null : DB; },
      classInfo: function () { return cls; }, classRecords: subj,
      pp6Record: function () { return rs.filter(function (r) { return r.slot === 'pp6'; })[0] || null; },
      className: function () { return 'ป.' + cls.level + '/' + cls.room; },
      reportCtx: Object.assign({}, reportCtx, { classRecords: subj }),
      rosterById: function () { return roster && roster.data ? PP5Roster.byId(roster.data) : {}; },
      allYears: function () { return years(); },
      allClasses: function () {
        var seen = {}, out = [];
        records.forEach(function (r) { var k = classKey(r.year, r.level, r.room); if (!seen[k]) { seen[k] = 1; out.push({ year: r.year, level: r.level, room: r.room }); } });
        return out;
      },
      withClass: async function (c2) {
        var need = recsOf(c2).filter(function (r) { return !r.data; });
        if (need.length && DB.ensureData) await DB.ensureData(need);
        return ctxFor(c2);
      }
    };
  }
  function curClass() { return { year: state.year, level: state.level, room: state.room }; }
  function publishCtx() { return ctxFor(curClass()); }
  function afterChange(cls) {
    if (DB === LocalDB || !window.PP5Publish) return;
    var c = ctxFor(cls);
    c.withClass(cls).then(function (cc) { PP5Publish.autoPublish(cc, cls); });
  }
  function fileNameFor(kind, meta, ext) { var x = 'x' + (ext || '.xlsx'); return kind === 'pp6' ? pp6FileName(meta, x) : newFileName(meta, x); }

  // ---------- แม่แบบรูปแบบต้นฉบับ ----------
  var tplInfo = {}, tplCache = {};
  async function registerTemplate(kind, bytes, name, auto) {
    var blank = await PP5Templates.build(kind, bytes, null);
    await DB.putTemplate(kind, blank, name);
    tplInfo[kind] = { name: name, savedAt: Date.now() };
    tplCache[kind] = blank;
    toast((auto ? 'บันทึกแม่แบบ ' : 'ตั้งแม่แบบ ') + (kind === 'pp5' ? 'ปพ.5' : 'ปพ.6') + ' รูปแบบต้นฉบับแล้ว (ล้างข้อมูลนักเรียนออกจากแม่แบบแล้ว)', 'ok');
  }
  async function getTemplateBytes(kind) {
    if (tplCache[kind]) return tplCache[kind];
    var t = await DB.getTemplate(kind);
    if (!t || !t.bytes) return null;
    tplCache[kind] = t.bytes instanceof Uint8Array ? t.bytes : new Uint8Array(t.bytes);
    return tplCache[kind];
  }
  // คืน { blob, ext, original }
  async function buildFile(kind, data, format) {
    if (format !== 'system' && tplInfo[kind]) {
      var tpl = await getTemplateBytes(kind);
      if (tpl) {
        var out = await PP5Templates.build(kind, tpl, data);
        var macro = kind === 'pp5';
        return { blob: new Blob([out], { type: macro ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), ext: macro ? '.xlsm' : '.xlsx', original: true };
      }
    }
    return { blob: PP5Model.toBlob(kind === 'pp6' ? PP5Model.exportPP6(data) : PP5Model.exportPP5(data)), ext: '.xlsx', original: false };
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  async function saveEdited(kind, data, oldKey) {
    var meta = data.meta, slot = kind === 'pp6' ? 'pp6' : slotOf(meta);
    var key = classKey(meta.year, meta.level, meta.room) + '|' + slot;
    var existing = records.filter(function (r) { return r.key === key; })[0];
    var old = oldKey ? records.filter(function (r) { return r.key === oldKey; })[0] : null;
    if (existing && key !== oldKey && !confirm('มีข้อมูลวิชานี้อยู่แล้ว (' + existing.fileName + ') ต้องการแทนที่หรือไม่?')) throw new Error('ยกเลิกการบันทึก');
    var built = await buildFile(kind, data);
    var blob = built.blob;
    var rec = {
      key: key, year: meta.year, level: meta.level, room: meta.room, slot: slot,
      fileName: fileNameFor(kind, meta, built.ext), origName: '(กรอกในระบบ)', size: blob.size, uploadedAt: Date.now(), blob: blob,
      data: data, settings: (existing && existing.settings) || (old && old.settings) || undefined
    };
    var saved = await DB.put(rec);
    if (saved && typeof saved === 'object') Object.assign(rec, saved);
    records = records.filter(function (r) { return r.key !== key; }).concat([rec]);
    if (oldKey && oldKey !== key) { await DB.del(oldKey); records = records.filter(function (r) { return r.key !== oldKey; }); }
    afterChange({ year: meta.year, level: meta.level, room: meta.room });
    return rec;
  }
  var editorCtx = {
    esc: esc, toast: toast, setBusy: setBusy,
    rerender: function () { render(); },
    classInfo: curClass,
    classRecords: function () { return classRecords(); },
    pp6Record: function () { return pp6Record(); },
    findRecord: function (key) { return records.filter(function (r) { return r.key === key; })[0]; },
    coreSlot: function (slot) { return CORE.filter(function (c) { return c.slot === slot; })[0] || null; },
    masterRoster: function () { var c = rosterClass(curClass()); return c ? { students: c.students, teachers: c.teachers, date: roster.data.date ? roster.data.date.display : roster.data.dateText } : null; },
    saveEdited: saveEdited, downloadBlob: downloadBlob, fileNameFor: fileNameFor,
    buildFile: buildFile, hasTemplate: function (kind) { return !!tplInfo[kind]; }
  };
  var reportCtx = {
    esc: esc, toast: toast,
    classRecords: function () { return classRecords(); },
    pp6Record: function () { return pp6Record(); },
    className: function () { return 'ป.' + state.level + '/' + state.room; },
    save: function (rec) { return DB.saveSettings ? DB.saveSettings(rec) : DB.put(rec); },
    rerender: function () { render(); },
    pickFor: function (slot) { pickFor(slot); },
    download: function (rec) { download(rec); },
    remove: function (rec) { removeRecord(rec); }
  };
  function slotOrder(s) {
    for (var i = 0; i < CORE.length; i++) if (CORE[i].slot === s) return i;
    return 100;
  }

  // รวมนักเรียนจากทุกวิชา (จับคู่ด้วยเลขประจำตัวนักเรียน ถ้าไม่มีใช้ชื่อ)
  function studentKey(s) { return s.id ? 'id:' + s.id : 'nm:' + s.name.replace(/\s+/g, ''); }
  function classStudents(recs) {
    var map = {}, order = [];
    recs.forEach(function (rec) {
      rec.data.students.forEach(function (s) {
        var k = studentKey(s);
        if (!map[k]) { map[k] = { key: k, no: s.no, id: s.id, name: s.name, sex: s.sex, status: s.status, subjects: [] }; order.push(k); }
        map[k].subjects.push({ rec: rec, s: s });
      });
    });
    return order.map(function (k) { return map[k]; }).sort(function (a, b) { return a.no - b.no; });
  }

  function gradeOf(s) {
    var r = s && s.result;
    if (!r) return { label: '', num: null };
    if (r.rms) return { label: r.rms, num: null };
    var g = r.grade;
    if (g === '' || g == null) return { label: '', num: null };
    var n = parseFloat(g);
    return isFinite(n) ? { label: String(n), num: n } : { label: g, num: null };
  }
  function gradeChip(g) {
    if (!g.label) return '<span class="g g-none">–</span>';
    if (g.num == null) return '<span class="g g-x">' + esc(g.label) + '</span>';
    return '<span class="g g-' + String(g.num).replace('.', '') + '">' + esc(g.label) + '</span>';
  }
  function gpa(subjects) {
    var pts = 0, cr = 0;
    subjects.forEach(function (x) {
      var g = gradeOf(x.s), c = x.rec.data.meta.credit || 0;
      if (g.num != null && c) { pts += g.num * c; cr += c; }
    });
    return cr ? { gpa: Math.floor(pts / cr * 100) / 100, credits: cr } : { gpa: null, credits: 0 };
  }
  function incomplete(rec, s) {
    var total = rec.data.indicators.length;
    return { missing: s.filled < total, filled: s.filled, total: total, noFinal: !s.result || s.result.final == null };
  }

  // ---------- ส่วนควบคุมด้านบน ----------
  function renderPicker() {
    var ys = years();
    if (state.year == null || ys.indexOf(state.year) < 0) state.year = ys[0];
    $('yearSel').innerHTML = ys.map(function (y) { return '<option value="' + y + '"' + (y === state.year ? ' selected' : '') + '>' + y + '</option>'; }).join('');

    $('levelChips').innerHTML = LEVELS.map(function (l) {
      var has = records.some(function (r) { return r.year === state.year && r.level === l; });
      return '<button class="chip' + (l === state.level ? ' on' : '') + '" data-level="' + l + '" role="tab">ป.' + l + (has ? '<span class="dot"></span>' : '') + '</button>';
    }).join('');

    var rooms = roomsOf(state.year, state.level);
    var maxRoom = Math.max(6, rooms[rooms.length - 1]);
    if (rooms.indexOf(state.room) < 0 && !records.length) state.room = state.room || 1;
    else if (rooms.indexOf(state.room) < 0) state.room = rooms[0];
    var opts = '';
    for (var r = 1; r <= maxRoom; r++) {
      var has = rooms.indexOf(r) >= 0 && records.some(function (x) { return x.year === state.year && x.level === state.level && x.room === r; });
      opts += '<option value="' + r + '"' + (r === state.room ? ' selected' : '') + '>' + r + (has ? ' •' : '') + '</option>';
    }
    $('roomSel').innerHTML = opts;

    var withData = records.filter(function (r) { return r.data; });
    var any = classRecords().filter(function (r) { return r.data; })[0] || withData.filter(function (r) { return r.slot !== 'pp6'; })[0];
    if (any) {
      var m = any.data.meta;
      $('schoolLine').textContent = (/^โรงเรียน/.test(m.school || '') ? '' : 'โรงเรียน') + (m.school || '') + (m.district ? ' อ.' + m.district : '') + (m.province ? ' จ.' + m.province : '');
    } else if (withData[0]) {
      $('schoolLine').textContent = withData[0].data.meta.school || '';
    } else if (records[0] && records[0].school) {
      $('schoolLine').textContent = records[0].school;
    }

    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === state.tab);
    });
  }

  function render() {
    renderPicker();
    renderRosterBar();
    // รุ่นที่เก็บข้อมูลบนเซิร์ฟเวอร์: โหลดข้อมูลของห้องที่เลือกเมื่อจำเป็น
    if (DB.ensureData) {
      var need = records.filter(function (r) { return r.year === state.year && r.level === state.level && r.room === state.room && !r.data; });
      if (need.length) {
        view.innerHTML = '<div class="card empty-state"><b>กำลังโหลดข้อมูล ' + need.length + ' ไฟล์...</b>จาก Google Drive</div>';
        DB.ensureData(need).then(function () {
          if (need.every(function (r) { return r.data; })) render();
          else view.innerHTML = '<div class="card empty-state"><b>โหลดข้อมูลไม่ครบ</b>ลองรีเฟรชหน้าอีกครั้ง</div>';
        }, function (err) {
          view.innerHTML = '<div class="card empty-state"><b>โหลดข้อมูลไม่สำเร็จ</b>' + esc(err && err.message ? err.message : err) + '</div>';
        });
        return;
      }
    }
    var cls = 'ป.' + state.level + '/' + state.room;
    view.onclick = view.onchange = null;
    if (window.PP5Editor && PP5Editor.active()) { PP5Editor.render(view, editorCtx); saveUI(); return; }
    if (state.tab === 'publish') { PP5Publish.render(view, publishCtx()); saveUI(); return; }
    if (state.tab === 'roster') { renderRosterTab(); saveUI(); return; }
    if (state.tab === 'subjects') renderSubjects(cls);
    else if (state.tab === 'summary') renderSummary(cls);
    else if (state.tab === 'report') PP6Report.render(view, reportCtx);
    else renderStudent(cls);
    saveUI();
  }

  // ---------- แท็บ: รายวิชา ----------
  function renderSubjects(cls) {
    var recs = classRecords();
    var bySlot = {};
    recs.forEach(function (r) { bySlot[r.slot] = r; });
    var slots = CORE.map(function (c) { return c.slot; });
    recs.forEach(function (r) { if (slots.indexOf(r.slot) < 0) slots.push(r.slot); });

    var html = templateCard() + '<h2 class="sec">รายวิชาชั้น ' + esc(cls) + ' ปีการศึกษา ' + esc(state.year) + '</h2>' +
      '<p class="sub">มีข้อมูลแล้ว ' + recs.length + ' วิชา · แต่ละวิชาเลือกได้ว่าจะอัปโหลดไฟล์ ปพ.5 กรอกในระบบ หรือสร้างไฟล์ Excel ไปกรอกในคอม (ลากไฟล์มาวางบนช่องก็ได้)</p><div class="slots">';
    slots.forEach(function (slot) {
      var rec = bySlot[slot], info = slotInfo(slot, rec);
      var ic = '<div class="slot-ic" style="background:' + info.color + '">' + esc(info.letter) + '</div>';
      if (!rec) {
        html += '<div class="slot card empty" data-slot="' + esc(slot) + '" tabindex="0" role="button" aria-label="อัปโหลด ' + esc(info.name) + '">' +
          '<div class="slot-h">' + ic + '<div><div class="slot-n">' + esc(info.name) + '</div><div class="slot-c">รายวิชาพื้นฐาน</div></div></div>' +
          '<div class="slot-empty-t">ยังไม่มีข้อมูล</div>' + startButtons(slot) + '</div>';
        return;
      }
      var d = rec.data, m = d.meta, n = d.students.length;
      var filledAll = d.students.length ? Math.min.apply(null, d.students.map(function (s) { return s.filled; })) : 0;
      var full = filledAll >= d.indicators.length;
      var dist = gradeCounts(d.students);
      html += '<div class="slot card" data-slot="' + esc(slot) + '">' +
        '<div class="slot-h">' + ic + '<div><div class="slot-n">' + esc(m.subject) + '</div><div class="slot-c">' + esc(m.code) + ' · ' + esc(m.type || '') + ' · ' + fmt(m.credit) + ' หน่วยกิต</div></div></div>' +
        '<div class="slot-f" title="ชื่อไฟล์เดิม: ' + esc(rec.origName) + '">' + (d.source === 'online' ? '✏️ กรอกในระบบ · ' : '📄 ') + esc(rec.fileName) + '</div>' +
        '<div class="slot-meta"><span>' + n + ' คน</span><span>' + d.indicators.length + ' ตัวชี้วัด</span>' +
        (m.teacher ? '<span>ครู' + esc(String(m.teacher).replace(/^(นาย|นางสาว|นาง)/, '')) + '</span>' : '') + '</div>' +
        '<div class="slot-meta">' + (full ? '<span class="badge ok">คะแนนครบทุกตัวชี้วัด</span>' : '<span class="badge warn">กรอกคะแนนแล้ว ' + filledAll + '/' + d.indicators.length + ' ตัวชี้วัด</span>') +
        (dist.rest ? '' : '') + '</div>' +
        '<div class="slot-acts">' +
        '<button class="btn pri" data-act="open" data-key="' + esc(rec.key) + '">ดูคะแนน</button>' +
        '<button class="btn" data-act="edit" data-key="' + esc(rec.key) + '">แก้ไขในระบบ</button>' +
        '<button class="btn" data-act="replace" data-slot="' + esc(slot) + '">อัปโหลดใหม่</button>' +
        '<button class="btn" data-act="download" data-key="' + esc(rec.key) + '">ไฟล์ Excel</button>' +
        '<button class="btn danger" data-act="delete" data-key="' + esc(rec.key) + '">ลบ</button>' +
        '</div></div>';
    });
    html += '<div class="slot card empty" data-slot="__extra" tabindex="0" role="button">' +
      '<div class="slot-h"><div class="slot-ic" style="background:' + EXTRA_COLOR + '">+</div><div><div class="slot-n">รายวิชาเพิ่มเติม</div><div class="slot-c">เช่น หน้าที่พลเมือง, คอมพิวเตอร์</div></div></div>' +
      '<div class="slot-empty-t">อัปโหลด กรอกในระบบ หรือสร้างไฟล์ Excel</div>' + startButtons('__extra') + '</div>';
    html += '</div>';
    view.innerHTML = html;
  }

  function templateCard() {
    var t5 = tplInfo.pp5, t6 = tplInfo.pp6;
    var item = function (k, t, label) {
      return '<span class="tpl-it ' + (t ? 'ok' : '') + '">' + (t ? '✓ ' : '○ ') + label + (t ? ' <small title="' + esc(t.name) + '">จาก ' + esc(String(t.name).slice(0, 38)) + '</small>' : ' <small>ยังไม่มี</small>') + '</span>';
    };
    return '<div class="card tpl-card"><div><b>แม่แบบรูปแบบต้นฉบับ</b> ' + item('pp5', t5, 'ปพ.5 (ครูหนุ่ม)') + item('pp6', t6, 'ปพ.6 (โรงเรียน)') +
      '<div class="sub" style="margin:4px 0 0">ไฟล์ที่ระบบสร้าง (ปุ่ม "สร้างไฟล์ Excel" / "กรอกในระบบ") จะออกมาหน้าตาเหมือนไฟล์ต้นฉบับ · อัปโหลดไฟล์ต้นฉบับครั้งแรก ระบบจะเก็บเป็นแม่แบบให้เอง (ล้างข้อมูลนักเรียนออก)</div></div>' +
      '<button class="btn" data-act="tplUpload">ตั้งแม่แบบจากไฟล์…</button></div>';
  }
  var rosterSel = null;
  function renderRosterTab() {
    if (!roster || !roster.data) {
      view.innerHTML = '<div class="card empty-state"><b>ยังไม่มีทะเบียนรายชื่อนักเรียน</b>อัปโหลดไฟล์ Word รายชื่อนักเรียน (.docx) ด้วยปุ่มด้านบน หรือลากไฟล์มาวาง<br><br><button class="btn pri" data-rb="up">อัปโหลดไฟล์รายชื่อ</button></div>';
      return;
    }
    var d = roster.data, cur = rosterClass(curClass());
    if (!rosterSel || !d.classes.some(function (c) { return c.label === rosterSel; })) rosterSel = cur ? cur.label : d.classes[0].label;
    var c = d.classes.filter(function (x) { return x.label === rosterSel; })[0];
    var h = '<h2 class="sec">ทะเบียนรายชื่อนักเรียน ปีการศึกษา ' + esc(d.year || '') + '</h2>' +
      '<p class="sub">อัปเดตตามข้อมูลวันที่ ' + esc(d.date ? d.date.display : d.dateText) + ' · ' + d.total + ' คน · ใช้เป็นรายชื่อเริ่มต้นเมื่อสร้าง ปพ.5 / ปพ.6 ใหม่ และใช้เลขบัตร 4 ตัวท้ายยืนยันตัวตนผู้ปกครองในหน้าประกาศผล</p>';
    if (d.warnings.length) h += '<div class="note"><b>ข้อควรตรวจในไฟล์:</b><ul style="margin:4px 0 0;padding-left:18px">' + d.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="chips" style="margin:10px 0 14px">' + d.classes.map(function (x) {
      return '<button class="chip' + (x.label === rosterSel ? ' on' : '') + '" data-rc2="' + esc(x.label) + '">' + esc(x.label) + ' <small>(' + x.students.length + ')</small></button>';
    }).join('') + '</div>';
    h += '<div class="tiles">' + tileR('ชั้น', c.label, c.teachers.length ? 'ครู' + c.teachers.join(', ครู') : '') + tileR('นักเรียน', c.counts.total + ' คน', 'ชาย ' + c.counts.male + ' · หญิง ' + c.counts.female) + '</div>';
    // เทียบกับไฟล์ ปพ. ของห้องเดียวกันในระบบ
    if (c.stage === 'ป') {
      var cls = { year: c.year || d.year, level: c.level, room: c.room };
      var rs = records.filter(function (r) { return r.year === cls.year && r.level === cls.level && r.room === cls.room && r.data; });
      if (rs.length) {
        var inFiles = {}, inRoster = {};
        rs.forEach(function (r) { r.data.students.forEach(function (s) { if (s.id) inFiles[s.id] = s.name; }); });
        c.students.forEach(function (s) { if (s.id) inRoster[s.id] = s.name; });
        var notInRoster = Object.keys(inFiles).filter(function (id) { return !inRoster[id]; });
        var notInFiles = Object.keys(inRoster).filter(function (id) { return !inFiles[id]; });
        h += '<div class="card rc-panel"><b>เทียบกับไฟล์ ปพ. ของห้องนี้ในระบบ (' + rs.length + ' ไฟล์)</b>' +
          (!notInRoster.length && !notInFiles.length ? '<p class="sub" style="margin:6px 0 0">✓ รายชื่อตรงกันทั้งหมด</p>' :
            (notInFiles.length ? '<p style="margin:6px 0 2px">มีในทะเบียน แต่ยังไม่มีในไฟล์ ปพ.: ' + notInFiles.map(function (id) { return esc(inRoster[id]) + ' (' + id + ')'; }).join(', ') + '</p>' : '') +
            (notInRoster.length ? '<p style="margin:6px 0 2px">มีในไฟล์ ปพ. แต่ไม่มีในทะเบียน (อาจย้ายออก): ' + notInRoster.map(function (id) { return esc(inFiles[id]) + ' (' + id + ')'; }).join(', ') + '</p>' : '')) + '</div>';
      }
    }
    h += '<div class="tbl-wrap"><table><thead><tr><th>เลขที่</th><th>เลขประจำตัว</th><th class="l">ชื่อ-สกุล</th><th>เพศ</th><th>บัตร ปชช.</th></tr></thead><tbody>' +
      c.students.map(function (s) { return '<tr><td>' + s.no + '</td><td>' + esc(s.id) + '</td><td class="l">' + esc(s.name) + '</td><td>' + esc(s.sex) + '</td><td class="num">' + (s.nid4 ? '•••• ' + esc(s.nid4) : '–') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    view.innerHTML = h;
    view.onclick = function (e) {
      var b = e.target.closest('[data-rc2]');
      if (!b) return;
      rosterSel = b.dataset.rc2;
      var x = d.classes.filter(function (y) { return y.label === rosterSel; })[0];
      if (x && x.stage === 'ป') { state.year = x.year || d.year; state.level = x.level; state.room = x.room; }
      render();
    };
  }
  function tileR(k, v, s) { return '<div class="card tile"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>'; }

  function startButtons(slot) {
    return '<div class="slot-acts"><button class="btn pri" data-act="upload" data-slot="' + esc(slot) + '">อัปโหลดไฟล์</button>' +
      '<button class="btn" data-act="online" data-slot="' + esc(slot) + '">กรอกในระบบ</button>' +
      '<button class="btn" data-act="template" data-slot="' + esc(slot) + '">สร้างไฟล์ Excel</button></div>';
  }

  function gradeCounts(students) {
    var c = {}, rest = 0;
    GRADE_ORDER.forEach(function (g) { c[g] = 0; });
    students.forEach(function (s) {
      var g = gradeOf(s);
      if (g.num != null && c[g.label] != null) c[g.label]++;
      else rest++;
    });
    c.rest = rest;
    return c;
  }

  // ---------- หน้าต่าง: คะแนนตามตัวชี้วัดของวิชา ----------
  function openSubject(key) {
    var rec = records.filter(function (r) { return r.key === key; })[0];
    if (!rec) return;
    var d = rec.data, m = d.meta, inds = d.indicators, mx = d.maxima || {};
    $('modalTitle').textContent = m.code + ' ' + m.subject + ' · ' + m.levelName + '/' + m.room + ' · ปีการศึกษา ' + m.year;
    var terms = {};
    inds.forEach(function (i) { var t = i.term || 0; (terms[t] = terms[t] || []).push(i); });
    var termKeys = Object.keys(terms).sort();

    var h = '<div class="kv">' +
      '<div>ครูผู้สอน<b>' + esc(m.teacher || '-') + '</b></div>' +
      '<div>หน่วยกิต / เวลาเรียน<b>' + fmt(m.credit) + ' นก. · ' + fmt(m.hours) + ' ชม.</b></div>' +
      '<div>สัดส่วนคะแนน<b>เก็บ ' + fmt(mx.collect) + ' : ปลายภาค ' + fmt(mx.final) + '</b></div>' +
      '<div>ไฟล์<b style="font-size:14px;word-break:break-all">' + esc(rec.fileName) + '</b></div></div>';

    h += '<div class="tbl-wrap"><table><thead><tr><th class="stick l" rowspan="2">เลขที่ / ชื่อ-สกุล</th>';
    termKeys.forEach(function (t) { h += '<th class="grp" colspan="' + terms[t].length + '">ภาคเรียนที่ ' + esc(t) + '</th>'; });
    h += '<th rowspan="2">รวม<br>ตัวชี้วัด<br><small>' + fmt(mx.indTotal) + '</small></th><th rowspan="2">คะแนนเก็บ<br><small>' + fmt(mx.collect) + '</small></th><th rowspan="2">ปลายภาค<br><small>' + fmt(mx.final) + '</small></th><th rowspan="2">รวม<br><small>' + fmt(mx.total) + '</small></th><th rowspan="2">เกรด</th></tr><tr>';
    termKeys.forEach(function (t) {
      terms[t].forEach(function (i) {
        h += '<th title="' + esc(i.std + ' ' + i.code + ' ' + i.text) + '">' + esc(i.std) + '<br>' + esc(i.code) + '<br><small>/' + fmt(i.max) + '</small></th>';
      });
    });
    h += '</tr></thead><tbody>';
    d.students.forEach(function (s) {
      var r = s.result || {};
      h += '<tr><td class="stick l">' + s.no + '. ' + esc(s.name) + '</td>';
      termKeys.forEach(function (t) {
        terms[t].forEach(function (i) {
          var v = s.scores[i.idx];
          var lv = s.levels[i.idx];
          var low = v != null && i.max && v / i.max < 0.5;
          h += '<td class="num"' + (low ? ' style="color:var(--bad);font-weight:700"' : '') + (lv && lv.level != null ? ' title="ระดับ ' + lv.level + (lv.pass === false ? ' ไม่ผ่าน' : lv.pass ? ' ผ่าน' : '') + '"' : '') + '>' + fmt(v) + '</td>';
        });
      });
      h += '<td class="num">' + fmt(r.indTotal) + '</td><td class="num">' + fmt(r.collect) + '</td><td class="num">' + fmt(r.final) + '</td><td class="num"><b>' + fmt(r.total) + '</b></td><td>' + gradeChip(gradeOf(s)) + '</td></tr>';
    });
    // ค่าเฉลี่ยรายตัวชี้วัด
    h += '</tbody><tfoot><tr><td class="stick l">ค่าเฉลี่ย</td>';
    termKeys.forEach(function (t) {
      terms[t].forEach(function (i) { h += '<td class="num">' + fmt(avg(d.students.map(function (s) { return s.scores[i.idx]; })), 1) + '</td>'; });
    });
    ['indTotal', 'collect', 'final', 'total'].forEach(function (k) {
      h += '<td class="num">' + fmt(avg(d.students.map(function (s) { return s.result ? s.result[k] : null; })), 1) + '</td>';
    });
    h += '<td></td></tr></tfoot></table></div>';

    h += '<h3 style="margin:16px 0 8px;font-size:16px">รายการตัวชี้วัด</h3><div class="tbl-wrap"><table><thead><tr><th>ลำดับ</th><th>ภาคเรียน</th><th>มาตรฐาน</th><th>ตัวชี้วัด</th><th class="l">คำอธิบาย</th><th>เต็ม</th><th>เฉลี่ยห้อง</th></tr></thead><tbody>';
    inds.forEach(function (i) {
      var a = avg(d.students.map(function (s) { return s.scores[i.idx]; }));
      h += '<tr><td>' + i.idx + '</td><td>' + fmt(i.term) + '</td><td>' + esc(i.std) + '</td><td>' + esc(i.code) + '</td><td class="wrap-t">' + esc(i.text) + '</td><td>' + fmt(i.max) + '</td><td class="num">' + (a == null ? fmt(null) : fmt(a, 1) + bar(a, i.max)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    $('modalBody').innerHTML = h;
    $('modal').showModal();
  }

  function avg(arr) {
    var v = arr.filter(function (x) { return typeof x === 'number'; });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }
  function bar(v, max) {
    if (v == null || !max) return '';
    var p = Math.max(0, Math.min(100, v / max * 100));
    return '<span class="bar ' + (p < 50 ? 'low' : p < 70 ? 'mid' : '') + '"><i style="width:' + p.toFixed(0) + '%"></i></span>';
  }

  function emptyClass(cls) {
    return '<div class="card empty-state"><b>ยังไม่มีไฟล์ของชั้น ' + esc(cls) + '</b>อัปโหลดไฟล์ ปพ.5 ในแท็บ "รายวิชา" หรือลากไฟล์มาวางด้านบน</div>';
  }

  // ---------- แท็บ: สรุปทั้งห้อง ----------
  function renderSummary(cls) {
    var recs = classRecords();
    if (!recs.length) { view.innerHTML = emptyClass(cls); return; }
    var studs = classStudents(recs);
    var rows = studs.map(function (st) {
      var bySlot = {};
      st.subjects.forEach(function (x) { bySlot[x.rec.key] = x; });
      return { st: st, bySlot: bySlot, g: gpa(st.subjects) };
    });
    // อันดับตามเกรดเฉลี่ย
    var ranked = rows.filter(function (r) { return r.g.gpa != null; }).sort(function (a, b) { return b.g.gpa - a.g.gpa; });
    ranked.forEach(function (r, i) { r.rank = i > 0 && ranked[i - 1].g.gpa === r.g.gpa ? ranked[i - 1].rank : i + 1; });

    var classGpa = avg(rows.map(function (r) { return r.g.gpa; }));
    var incompleteCount = 0;
    recs.forEach(function (rec) { rec.data.students.forEach(function (s) { if (incomplete(rec, s).missing) incompleteCount++; }); });

    var h = '<h2 class="sec">สรุปผลการเรียนชั้น ' + esc(cls) + ' ปีการศึกษา ' + esc(state.year) + '</h2>';
    h += '<div class="tiles">' +
      tile('นักเรียน', studs.length + ' คน', sexCount(studs)) +
      tile('รายวิชาที่มีข้อมูล', recs.length + ' วิชา', 'รวม ' + recs.reduce(function (a, r) { return a + (r.data.meta.credit || 0); }, 0) + ' หน่วยกิต') +
      tile('เกรดเฉลี่ยทั้งห้อง', classGpa == null ? '–' : classGpa.toFixed(2), 'เฉลี่ยจาก GPA รายคน') +
      tile('คะแนนยังไม่ครบ', incompleteCount ? incompleteCount + ' รายการ' : 'ครบแล้ว', 'นับเป็นนักเรียน × วิชา') +
      '</div>';
    if (incompleteCount) h += '<p class="note">บางวิชายังกรอกคะแนนไม่ครบทุกตัวชี้วัดหรือยังไม่มีคะแนนปลายภาค เกรดที่แสดงคือค่าที่คำนวณในไฟล์ ณ ตอนนี้ จึงอาจยังไม่ใช่เกรดจริง</p>';

    h += '<div class="tbl-wrap"><table><thead><tr><th class="stick l">เลขที่ / ชื่อ-สกุล</th>';
    recs.forEach(function (rec) { h += '<th title="' + esc(rec.data.meta.subject) + '">' + esc(rec.data.meta.code) + '<br><small>' + esc(shortName(rec.data.meta.subject)) + '</small></th>'; });
    h += '<th>หน่วยกิต</th><th>เกรดเฉลี่ย</th><th>อันดับ</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr class="click" data-student="' + esc(r.st.key) + '"><td class="stick l">' + r.st.no + '. ' + esc(r.st.name) + '</td>';
      recs.forEach(function (rec) {
        var x = r.bySlot[rec.key];
        h += '<td>' + (x ? gradeChip(gradeOf(x.s)) + (incomplete(rec, x.s).missing ? '<sup title="คะแนนยังไม่ครบ" style="color:var(--warn)">*</sup>' : '') : '<span class="empty-cell">–</span>') + '</td>';
      });
      h += '<td class="num">' + (r.g.credits || '–') + '</td><td class="num"><b>' + (r.g.gpa == null ? '–' : r.g.gpa.toFixed(2)) + '</b></td><td class="num">' + (r.rank || '–') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td class="stick l">คะแนนรวมเฉลี่ย (เต็ม 100)</td>';
    recs.forEach(function (rec) { h += '<td class="num">' + fmt(avg(rec.data.students.map(function (s) { return s.result ? s.result.total : null; })), 1) + '</td>'; });
    h += '<td></td><td class="num">' + (classGpa == null ? '–' : classGpa.toFixed(2)) + '</td><td></td></tr></tfoot></table></div>';
    h += '<p class="sub" style="margin-top:8px">* = คะแนนยังไม่ครบทุกตัวชี้วัด · แตะชื่อนักเรียนเพื่อดูรายละเอียด</p>';

    // การกระจายเกรดรายวิชา
    h += '<h2 class="sec" style="margin-top:18px">การกระจายผลการเรียนรายวิชา</h2><div class="dist">';
    recs.forEach(function (rec) {
      var c = gradeCounts(rec.data.students), n = rec.data.students.length || 1;
      h += '<div class="card"><h3>' + esc(rec.data.meta.code + ' ' + rec.data.meta.subject) + '</h3>';
      GRADE_ORDER.forEach(function (g) {
        h += '<div class="hbar"><span>' + g + '</span><span class="tr"><i style="width:' + (c[g] / n * 100).toFixed(1) + '%;background:' + GRADE_COLOR[g] + '"></i></span><span class="num">' + c[g] + '</span></div>';
      });
      if (c.rest) h += '<div class="hbar"><span>อื่นๆ</span><span class="tr"><i style="width:' + (c.rest / n * 100).toFixed(1) + '%;background:#b26a00"></i></span><span class="num">' + c.rest + '</span></div>';
      h += '</div>';
    });
    h += '</div>';
    view.innerHTML = h;
  }

  function shortName(n) { return String(n || '').split(' ')[0]; }
  function tile(k, v, s) { return '<div class="card tile"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>'; }
  function sexCount(studs) {
    var m = studs.filter(function (s) { return s.sex === 'ชาย'; }).length, f = studs.filter(function (s) { return s.sex === 'หญิง'; }).length;
    return m || f ? 'ชาย ' + m + ' · หญิง ' + f : '';
  }

  // ---------- แท็บ: รายบุคคล ----------
  function renderStudent(cls) {
    var recs = classRecords();
    if (!recs.length) { view.innerHTML = emptyClass(cls); return; }
    var studs = classStudents(recs);
    var idx = studs.findIndex(function (s) { return s.key === state.student; });
    if (idx < 0) { idx = 0; state.student = studs[0].key; }
    var st = studs[idx];

    var h = '<div class="stu-bar"><button class="btn" data-act="prev"' + (idx === 0 ? ' disabled' : '') + '>‹ ก่อนหน้า</button>' +
      '<select id="stuSel" aria-label="เลือกนักเรียน">' + studs.map(function (s) {
        return '<option value="' + esc(s.key) + '"' + (s.key === st.key ? ' selected' : '') + '>' + s.no + '. ' + esc(s.name) + '</option>';
      }).join('') + '</select>' +
      '<button class="btn" data-act="next"' + (idx === studs.length - 1 ? ' disabled' : '') + '>ถัดไป ›</button>' +
      '<button class="btn pri" data-act="print">พิมพ์ / บันทึก PDF</button></div>';

    var m0 = recs[0].data.meta;
    h += '<div class="print-only" style="text-align:center;margin-bottom:8px"><b style="font-size:17px">รายงานผลการเรียนรายบุคคล ปีการศึกษา ' + esc(m0.year) + '</b><br>โรงเรียน' + esc(m0.school || '') + ' ' + esc(m0.office || '') + '</div>';
    h += '<div class="card profile"><div class="nm">' + esc(st.name) + '</div>' +
      '<span class="it">เลขที่ <b>' + st.no + '</b></span>' +
      (st.id ? '<span class="it">เลขประจำตัว <b>' + esc(st.id) + '</b></span>' : '') +
      '<span class="it">ชั้น <b>' + esc(cls) + '</b></span>' +
      '<span class="it">ปีการศึกษา <b>' + esc(state.year) + '</b></span>' +
      (st.status && st.status !== 'ปกติ' ? '<span class="badge warn">' + esc(st.status) + '</span>' : '') + '</div>';

    var g = gpa(st.subjects);
    var attPct = avg(st.subjects.map(function (x) { return x.s.attendance && x.s.attendance.year ? x.s.attendance.year.pct : null; }));
    var indPass = 0, indTot = 0;
    st.subjects.forEach(function (x) {
      var sm = x.s.indSummary;
      if (sm && sm.pass != null) { indPass += sm.pass; indTot += (sm.pass || 0) + (sm.fail || 0); }
    });
    var anyMissing = st.subjects.some(function (x) { return incomplete(x.rec, x.s).missing; });
    h += '<div class="tiles">' +
      tile('เกรดเฉลี่ย (GPA)', g.gpa == null ? '–' : g.gpa.toFixed(2), g.credits + ' หน่วยกิต') +
      tile('รายวิชา', st.subjects.length + ' วิชา', 'ผ่าน ' + st.subjects.filter(function (x) { var gg = gradeOf(x.s); return gg.num != null && gg.num >= 1; }).length + ' วิชา') +
      tile('ตัวชี้วัดที่ผ่าน', indTot ? indPass + '/' + indTot : '–', indTot ? (indPass / indTot * 100).toFixed(0) + '%' : '') +
      tile('เวลาเรียนเฉลี่ย', attPct == null ? '–' : attPct.toFixed(1) + '%', 'เกณฑ์ผ่าน 80%') +
      '</div>';
    if (anyMissing) h += '<p class="note">บางวิชายังกรอกคะแนนไม่ครบ เกรดที่แสดงเป็นค่าที่คำนวณในไฟล์ ณ ตอนนี้</p>';

    // ตารางสรุปรายวิชา
    h += '<h2 class="sec">ผลการเรียนรายวิชา</h2><div class="tbl-wrap"><table><thead><tr><th class="l">รหัส</th><th class="l">รายวิชา</th><th>หน่วยกิต</th><th>คะแนนเก็บ</th><th>ปลายภาค</th><th>รวม</th><th>เกรด</th><th>เวลาเรียน</th><th>ตัวชี้วัด</th><th>คุณลักษณะ</th><th>อ่านคิดเขียน</th></tr></thead><tbody>';
    st.subjects.forEach(function (x) {
      var m = x.rec.data.meta, r = x.s.result || {}, mx = x.rec.data.maxima || {};
      var att = x.s.attendance && x.s.attendance.year, sm = x.s.indSummary, ch = x.s.characteristics, rt = x.s.rtw;
      h += '<tr><td class="l">' + esc(m.code) + '</td><td class="l">' + esc(m.subject) + '</td><td class="num">' + fmt(m.credit) + '</td>' +
        '<td class="num">' + fmt(r.collect) + '<small style="color:var(--muted)">/' + fmt(mx.collect) + '</small></td>' +
        '<td class="num">' + fmt(r.final) + '<small style="color:var(--muted)">/' + fmt(mx.final) + '</small></td>' +
        '<td class="num"><b>' + fmt(r.total) + '</b></td><td>' + gradeChip(gradeOf(x.s)) + '</td>' +
        '<td class="num">' + (att && att.pct != null ? fmt(att.pct, 1) + '%' : fmt(null)) + '</td>' +
        '<td class="num">' + (sm && sm.pass != null ? sm.pass + '/' + ((sm.pass || 0) + (sm.fail || 0)) : fmt(null)) + '</td>' +
        '<td>' + (ch && ch.text ? esc(ch.text) : fmt(null)) + '</td>' +
        '<td>' + (rt && rt.text ? esc(rt.text) : rt && rt.t1 && rt.t1.avg != null ? 'ภาค 1: ' + fmt(rt.t1.avg) : fmt(null)) + '</td></tr>';
    });
    h += '</tbody></table></div>';

    // รายละเอียดตามตัวชี้วัด
    h += '<h2 class="sec" style="margin-top:18px">คะแนนตามตัวชี้วัด</h2>';
    st.subjects.forEach(function (x, i) {
      var rec = x.rec, d = rec.data, m = d.meta, s = x.s, r = s.result || {}, inc = incomplete(rec, s);
      h += '<details class="card subj"' + (i === 0 ? ' open' : '') + '><summary><span class="t">' + esc(m.code + ' ' + m.subject) +
        '<small>คะแนนตัวชี้วัด ' + fmt(r.indTotal) + '/' + fmt(d.maxima && d.maxima.indTotal) + ' · รวม ' + fmt(r.total) + '/' + fmt(d.maxima && d.maxima.total) + '</small></span>' +
        (inc.missing ? '<span class="badge warn">กรอก ' + inc.filled + '/' + inc.total + '</span>' : '<span class="badge ok">ครบ</span>') +
        gradeChip(gradeOf(s)) + '</summary><div class="subj-body">';
      h += '<div class="tbl-wrap"><table><thead><tr><th>ภาค</th><th>มาตรฐาน</th><th>ตัวชี้วัด</th><th class="l">คำอธิบาย</th><th>คะแนน</th><th>ระดับ</th><th>ผล</th></tr></thead><tbody>';
      d.indicators.forEach(function (ind) {
        var v = s.scores[ind.idx], lv = s.levels[ind.idx] || {};
        var res = lv.pass === true ? '<span class="badge ok">ผ่าน</span>' : lv.pass === false ? '<span class="badge bad">ไม่ผ่าน</span>' : '<span class="badge mute">–</span>';
        if (v == null) res = '<span class="badge mute">ยังไม่กรอก</span>';
        h += '<tr><td>' + fmt(ind.term) + '</td><td>' + esc(ind.std) + '</td><td>' + esc(ind.code) + '</td><td class="wrap-t">' + esc(ind.text) + '</td>' +
          '<td class="num" style="text-align:left">' + fmt(v) + '<small style="color:var(--muted)">/' + fmt(ind.max) + '</small>' + bar(v, ind.max) + '</td>' +
          '<td class="num">' + (v == null ? fmt(null) : fmt(lv.level)) + '</td><td>' + res + '</td></tr>';
      });
      h += '</tbody></table></div>';

      // คุณลักษณะ / เวลาเรียน / อ่านคิดเขียน ของวิชานี้
      var ch = s.characteristics, att = s.attendance, rt = s.rtw;
      h += '<div class="kv">';
      if (att && att.year) h += '<div>เวลาเรียนทั้งปี<b>' + fmt(att.year.present) + '/' + fmt(d.hours && d.hours.year) + ' ชม. (' + fmt(att.year.pct, 1) + '%)</b>ขาด ' + fmt(att.year.absent) + ' · ลา ' + fmt(att.year.leave) + ' · ป่วย ' + fmt(att.year.sick) + '</div>';
      if (ch) h += '<div>คุณลักษณะอันพึงประสงค์<b>' + esc(ch.text || '-') + (ch.avg != null ? ' (เฉลี่ย ' + fmt(ch.avg) + ')' : '') + '</b>' +
        d.characteristicItems.map(function (it) { return esc(it.name) + ' ' + fmt(ch.items[it.no]); }).join(' · ') + '</div>';
      if (rt) h += '<div>อ่าน คิดวิเคราะห์ เขียน<b>' + esc(rt.text || (rt.avg != null ? 'เฉลี่ย ' + rt.avg : 'ยังไม่ครบ')) + '</b>' +
        ['t1', 't2'].map(function (t, k) { var o = rt[t] || {}; return 'ภาค ' + (k + 1) + ': อ่าน ' + fmt(o.read) + ' คิด ' + fmt(o.think) + ' เขียน ' + fmt(o.write); }).join('<br>') + '</div>';
      h += '</div></div></details>';
    });

    // กิจกรรมพัฒนาผู้เรียน (ใช้จากไฟล์แรกที่มีข้อมูล)
    var act = null;
    st.subjects.some(function (x) { if (x.s.activities && (x.s.activities.guidance || x.s.activities.scout)) { act = x.s.activities; return true; } return false; });
    if (act) {
      h += '<h2 class="sec" style="margin-top:18px">กิจกรรมพัฒนาผู้เรียน</h2><div class="kv">' +
        actBox('แนะแนว', act.guidance) + actBox('ลูกเสือ-เนตรนารี', act.scout) + actBox('ชุมนุม' + (act.clubName ? ' (' + act.clubName + ')' : ''), act.club) + actBox('กิจกรรมเพื่อสังคมฯ', act.social) + '</div>';
    }
    view.innerHTML = h;
  }
  function actBox(k, v) {
    var t = !v ? '–' : /^ผ/.test(v) ? 'ผ่าน' : /^มผ/.test(v) ? 'ไม่ผ่าน' : v;
    return '<div>' + esc(k) + '<b>' + esc(t) + '</b></div>';
  }

  // ---------- เหตุการณ์ ----------
  var pendingSlot = null;
  function pickFor(slot) {
    pendingSlot = slot;
    $('fileOne').value = '';
    $('fileOne').click();
  }

  $('fileAll').addEventListener('change', function (e) { handleFiles(e.target.files); e.target.value = ''; });
  $('fileRoster').addEventListener('change', function (e) { if (e.target.files[0]) handleRoster(e.target.files[0]); e.target.value = ''; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rb]');
    if (!b) return;
    if (b.dataset.rb === 'up') $('fileRoster').click();
    else if (b.dataset.rb === 'dl') downloadRoster();
    else if (b.dataset.rb === 'view' && leaveEditor()) { state.tab = 'roster'; render(); }
  });
  $('fileTpl').addEventListener('change', async function (e) {
    var f = e.target.files[0];
    if (!f) return;
    try {
      setBusy('กำลังตั้งแม่แบบ...');
      var u8 = new Uint8Array(await readFile(f));
      var wb = XLSX.read(u8, { type: 'array', bookSheets: true });
      var kind = PP5Templates.detect(wb.SheetNames);
      if (!kind) throw new Error('ไฟล์นี้ไม่ใช่ ปพ.5 (โปรแกรมครูหนุ่ม) หรือ ปพ.6 ของโรงเรียน');
      await registerTemplate(kind, u8, f.name, false);
    } catch (err) { toast('ตั้งแม่แบบไม่สำเร็จ: ' + err.message, 'err'); }
    finally { setBusy(''); render(); }
  });
  $('fileOne').addEventListener('change', function (e) {
    var exp = pendingSlot && pendingSlot !== '__extra' ? { level: state.level, room: state.room, slot: pendingSlot } : null;
    handleFiles(e.target.files, exp);
  });

  // ลากวางทั้งหน้า / ลงช่องวิชา
  var dragDepth = 0;
  document.addEventListener('dragenter', function (e) { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    var slot = e.target.closest && e.target.closest('.slot');
    Array.prototype.forEach.call(document.querySelectorAll('.slot.over'), function (s) { if (s !== slot) s.classList.remove('over'); });
    if (slot) slot.classList.add('over');
  });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    var slot = e.target.closest && e.target.closest('.slot');
    Array.prototype.forEach.call(document.querySelectorAll('.slot.over'), function (s) { s.classList.remove('over'); });
    var sl = slot && slot.dataset.slot;
    var exp = sl && sl !== '__extra' && e.dataTransfer.files.length === 1 ? { level: state.level, room: state.room, slot: sl } : null;
    handleFiles(e.dataTransfer.files, exp);
  });
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }

  function leaveEditor() {
    if (!window.PP5Editor || !PP5Editor.active()) return true;
    PP5Editor.close();
    return !PP5Editor.active();
  }
  $('yearSel').addEventListener('change', function (e) { if (!leaveEditor()) { renderPicker(); return; } state.year = +e.target.value; state.student = null; render(); });
  $('roomSel').addEventListener('change', function (e) { if (!leaveEditor()) { renderPicker(); return; } state.room = +e.target.value; state.student = null; render(); });
  $('levelChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-level]');
    if (!b || !leaveEditor()) return;
    state.level = +b.dataset.level;
    var rooms = roomsOf(state.year, state.level);
    state.room = rooms[0];
    state.student = null;
    render();
  });
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b && leaveEditor()) { state.tab = b.dataset.tab; render(); }
  });

  view.addEventListener('click', async function (e) {
    var a = e.target.closest('[data-act]');
    if (a) {
      var act = a.dataset.act, key = a.dataset.key;
      var rec = key && records.filter(function (r) { return r.key === key; })[0];
      if (act === 'open') openSubject(key);
      else if (act === 'upload') pickFor(a.dataset.slot);
      else if (act === 'tplUpload') { $('fileTpl').value = ''; $('fileTpl').click(); }
      else if (act === 'online' || act === 'template') PP5Editor.open({ kind: a.dataset.slot === 'pp6' ? 'pp6' : 'pp5', slot: a.dataset.slot, intent: act === 'template' ? 'excel' : 'online' }, editorCtx);
      else if (act === 'edit' && rec) PP5Editor.open({ kind: rec.slot === 'pp6' ? 'pp6' : 'pp5', key: rec.key }, editorCtx);
      else if (act === 'replace') pickFor(a.dataset.slot);
      else if (act === 'download' && rec) download(rec);
      else if (act === 'delete' && rec) {
        removeRecord(rec);
      } else if (act === 'prev' || act === 'next') {
        var studs = classStudents(classRecords());
        var i = studs.findIndex(function (s) { return s.key === state.student; }) + (act === 'next' ? 1 : -1);
        if (studs[i]) { state.student = studs[i].key; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      } else if (act === 'print') printReport();
      return;
    }
    var slot = e.target.closest('.slot.empty');
    if (slot && !e.target.closest('button')) { pickFor(slot.dataset.slot); return; }
    var tr = e.target.closest('[data-student]');
    if (tr) { state.student = tr.dataset.student; state.tab = 'student'; render(); window.scrollTo({ top: 0 }); }
  });
  view.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('empty')) { e.preventDefault(); pickFor(e.target.dataset.slot); }
  });
  view.addEventListener('change', function (e) {
    if (e.target.id === 'stuSel') { state.student = e.target.value; render(); }
  });

  function printReport() {
    var opened = Array.prototype.filter.call(document.querySelectorAll('details.subj'), function (d) { return !d.open; });
    opened.forEach(function (d) { d.open = true; });
    window.print();
    opened.forEach(function (d) { d.open = false; });
  }

  function download(rec) {
    if (DB.download) return DB.download(rec);
    var url = URL.createObjectURL(rec.blob);
    var a = document.createElement('a');
    a.href = url; a.download = rec.fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  $('modalClose').addEventListener('click', function () { $('modal').close(); });
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) $('modal').close(); });
  $('clearAll').addEventListener('click', async function () {
    if (!records.length) { toast('ยังไม่มีข้อมูล', 'info'); return; }
    if (!confirm('ลบไฟล์และคะแนนทั้งหมด ' + records.length + ' ไฟล์' + (DB === LocalDB ? 'ออกจากเครื่องนี้' : 'ออกจากระบบ (ย้ายไฟล์ใน Drive ไปถังขยะ)') + '?')) return;
    await DB.clear();
    records = [];
    render();
    toast('ล้างข้อมูลแล้ว', 'info');
  });

  // ---------- เริ่มทำงาน ----------
  (async function init() {
    try {
      await DB.open();
      records = await DB.all();
      if (DB.templateInfo) { try { tplInfo = (await DB.templateInfo()) || {}; } catch (te) { tplInfo = {}; } }
      if (DB.getRoster) { try { roster = (await DB.getRoster()) || null; } catch (re) { roster = null; } }
    } catch (e) {
      console.error(e);
      if (DB === LocalDB) {
        toast('เบราว์เซอร์นี้เก็บข้อมูลในเครื่องไม่ได้ (อาจเป็นโหมดไม่ระบุตัวตน) ข้อมูลจะหายเมื่อปิดหน้า', 'err');
        DB.put = DB.del = DB.clear = function () { return Promise.resolve(); };
      } else {
        toast('เชื่อมต่อที่เก็บข้อมูลไม่สำเร็จ: ' + (e && e.message ? e.message : e), 'err');
      }
    }
    if (records.length && !records.some(function (r) { return r.year === state.year && r.level === state.level && r.room === state.room; })) {
      var r0 = records[0];
      state.year = r0.year; state.level = r0.level; state.room = r0.room;
    }
    render();
  })();
})();
