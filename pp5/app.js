/* ระบบวิเคราะห์ผลการเรียนจากไฟล์ ปพ.5 — ทำงานในเบราว์เซอร์ทั้งหมด เก็บข้อมูลใน IndexedDB */
(function () {
  'use strict';

  // เบราว์เซอร์รุ่นเก่า (Safari ก่อน 15.4 ฯลฯ) ไม่มี <dialog>.showModal → ทำแบบง่ายแทน
  (function () {
    var d = document.getElementById('modal');
    if (!d || typeof d.showModal === 'function') return;
    var scrim = null;
    d.showModal = function () { d.setAttribute('open', ''); d.classList.add('pp-dlg-open'); scrim = document.createElement('div'); scrim.className = 'pp-dlg-scrim'; scrim.onclick = function () { d.close(); }; document.body.appendChild(scrim); };
    d.close = function () { d.removeAttribute('open'); d.classList.remove('pp-dlg-open'); if (scrim) { scrim.remove(); scrim = null; } };
  })();


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
    { slot: 'eng',  letter: 'อ', name: 'ภาษาอังกฤษ',                       color: '#364fc7' },
    { slot: 'cor',  letter: 'ส', name: 'การป้องกันการทุจริต',              color: '#2f7d6b', extra: true }
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
    // คลังตัวชี้วัดที่เรียนรู้จากไฟล์ (รุ่นในเครื่อง)
    getLib: function () { try { return Promise.resolve(JSON.parse(localStorage.getItem('pp5-lib') || '{}')); } catch (e) { return Promise.resolve({}); } },
    saveLib: function (key, v) { var m = {}; try { m = JSON.parse(localStorage.getItem('pp5-lib') || '{}'); m[key] = v; localStorage.setItem('pp5-lib', JSON.stringify(m)); } catch (e) {} return Promise.resolve(true); },
    // โลโก้/ลายเซ็น (รุ่นในเครื่อง เก็บในเบราว์เซอร์)
    getBrand: function () { try { return Promise.resolve(JSON.parse(localStorage.getItem('pp5-brand') || 'null')); } catch (e) { return Promise.resolve(null); } },
    saveBrand: function (b) { try { localStorage.setItem('pp5-brand', JSON.stringify(b)); } catch (e) { return Promise.reject(new Error('พื้นที่เก็บในเบราว์เซอร์เต็ม')); } return Promise.resolve(true); },
    getSigs: function () { try { return Promise.resolve(JSON.parse(localStorage.getItem('pp5-sigs') || '{}')); } catch (e) { return Promise.resolve({}); } },
    saveSig: function (name, img) {
      var m = {}; try { m = JSON.parse(localStorage.getItem('pp5-sigs') || '{}'); } catch (e) {}
      if (img) m[name] = { img: img, at: Date.now() }; else delete m[name];
      try { localStorage.setItem('pp5-sigs', JSON.stringify(m)); } catch (e) { return Promise.reject(new Error('พื้นที่เก็บในเบราว์เซอร์เต็ม')); }
      return Promise.resolve(true);
    },
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
    if (/ทุจริต/.test(meta.subject || '')) return 'cor';
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
  // อัปโหลดรวม (ปุ่มด้านบน/ลากวางทั้งหน้า) และทะเบียนรายชื่อ = แอดมินเท่านั้น · ครูอัปโหลดทีละวิชาที่การ์ดวิชา
  function canManage() { return DB === LocalDB || DB.role === 'admin'; }
  async function handleFiles(files, expected) {
    files = Array.prototype.slice.call(files || []); // สำเนาไว้ก่อน (ช่องเลือกไฟล์ถูกล้างระหว่างรอ)
    if (DB.role === 'director') { toast('ผู้อำนวยการดูข้อมูลได้อย่างเดียว', 'info'); return; }
    if (!expected && !canManage()) { toast('อัปโหลดไฟล์ที่การ์ดของแต่ละวิชา (ปุ่ม ⇪ อัปโหลด) · อัปโหลดรวม/ทะเบียนรายชื่อทำที่ระบบแอดมิน', 'info'); return; }
    var docs = files.filter(function (f) { return /\.docx$/i.test(f.name); });
    if (docs.length && !canManage()) { toast('อัปโหลดทะเบียนรายชื่อได้ที่ระบบแอดมิน', 'info'); return; }
    if (docs.length) { await handleRoster(docs[0]); if (docs.length === files.length) return; }
    files = Array.prototype.filter.call(files, function (f) { return /\.(xlsm|xlsx|xls)$/i.test(f.name); });
    if (!files.length) { toast('กรุณาเลือกไฟล์ Excel (.xlsm / .xlsx)', 'err'); return; }
    if (typeof XLSX === 'undefined') { toast('ยังโหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต) กรุณารีเฟรชหน้าแล้วลองใหม่', 'err'); return; }
    var last = null, ok = 0, changedClasses = {}, yearOk = {}, oldYears = {};
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
        // ---- ตรวจปีการศึกษา: ไฟล์ต้องเป็นปีปัจจุบัน ถ้าไม่ใช่ต้องยืนยันก่อน (กันข้อมูลปีเก่าปนปีปัจจุบัน) ----
        var cy = curYear();
        if (!meta.year) {
          setBusy('');
          if (!confirm('⚠️ ไม่พบปีการศึกษาในไฟล์ "' + f.name + '"\n\nกด ตกลง = ใช้เป็นข้อมูลปีการศึกษาปัจจุบัน ' + cy + '\nกด ยกเลิก = ไม่นำเข้าไฟล์นี้')) { toast('ข้ามไฟล์ ' + f.name + ' (ไม่มีปีการศึกษา)', 'info'); continue; }
          meta.year = cy;
        } else if (+meta.year < cy && DB !== LocalDB && DB.role !== 'admin') {
          // ข้อมูลปีเก่า (ย้อนหลัง) นำเข้าได้ที่ระบบแอดมินเท่านั้น
          setBusy('');
          toast('ไฟล์ "' + f.name + '" เป็นปีการศึกษา ' + meta.year + ' (ปีเก่า) — นำเข้าข้อมูลย้อนหลังได้ที่ระบบแอดมิน ปุ่ม "นำเข้า ปพ.6 ย้อนหลัง"', 'err');
          continue;
        } else if (+meta.year !== cy && !yearOk[meta.year]) {
          setBusy('');
          var older = +meta.year < cy;
          if (!confirm('⚠️ ปีการศึกษาไม่ตรง!\n\nไฟล์ "' + f.name + '"\nเป็นข้อมูลปีการศึกษา ' + meta.year + (older ? ' (ปีเก่า)' : '') + '\nแต่ปีการศึกษาปัจจุบันคือ ' + cy +
            '\n\nกด ตกลง = นำเข้าเป็นข้อมูลปี ' + meta.year + ' (เก็บแยกไว้ ไม่ปนกับปี ' + cy + ' และไม่ใช้รายชื่อนักเรียนปี ' + cy + ')' +
            '\nกด ยกเลิก = ไม่นำเข้า (ถ้าไฟล์นี้ควรเป็นปี ' + cy + ' ให้แก้ปีการศึกษาในชีต "ตั้งค่า" ของไฟล์ก่อน)')) {
            toast('ไม่ได้นำเข้า ' + f.name + ' (ปีการศึกษา ' + meta.year + ' ไม่ตรงกับปีปัจจุบัน ' + cy + ')', 'err');
            continue;
          }
          yearOk[meta.year] = true;
        }
        if (+meta.year !== cy) oldYears[meta.year] = 1;
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
        if (!isPP6) learnLib(data, f.name);   // จำตัวชี้วัดของชั้น/วิชานี้ไว้ใช้ครั้งต่อไป
        var tk = window.PP5Templates ? PP5Templates.detect(wb.SheetNames) : null;
        if (tk) {
          // ไฟล์ต้นฉบับที่อัปโหลด = แม่แบบของห้อง/วิชานี้ (และเป็นแม่แบบทั่วไปถ้ายังไม่มี)
          var tkey = tplKey(tk, meta.level, isPP6 ? null : slot);
          try {
            if (!tplInfo[tkey]) await registerTemplate(tkey, u8, f.name, true);
            if (!tplInfo[tk]) await registerTemplate(tk, u8, f.name, true);
          } catch (te) { console.warn('template', te); }
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
    var oy = Object.keys(oldYears);
    if (oy.length) toast('ข้อมูลปีการศึกษา ' + oy.join(', ') + ' เก็บแยกไว้แล้ว (ไม่ปนกับปีปัจจุบัน ' + curYear() + ') · ดูได้โดยเลือกปีการศึกษาด้านบน', 'info');
    if (last && (+last.year === curYear() || +last.year === +state.year)) {
      state.year = last.year; state.level = last.level; state.room = last.room;
      if (ok > 0 && state.tab === 'student') state.student = null;
      saveUI();
    }
    render();
  }

  // ---------- ทะเบียนรายชื่อนักเรียน (ไฟล์ Word) ----------
  var roster = null; // { fileName, bytes?, url?, data, uploadedAt }
  var rosterVer = 0;  // เปลี่ยนเมื่อทะเบียนเปลี่ยน (ให้ตรวจ/ใช้ชื่อจากทะเบียนใหม่)
  async function handleRoster(file) {
    try {
      setBusy('กำลังอ่านไฟล์รายชื่อ...');
      var bytes = new Uint8Array(await readFile(file));
      var data = await PP5Roster.parseDocx(bytes);
      setBusy('');
      var newDate = data.date ? data.date.display : (data.dateText || 'ไม่ระบุวันที่');
      if (data.year && +data.year !== curYear() && !confirm('⚠️ ทะเบียนรายชื่อนี้เป็นปีการศึกษา ' + data.year + ' แต่ปีการศึกษาปัจจุบันคือ ' + curYear() + '\n\nรายชื่อในทะเบียนจะใช้เป็นข้อมูลหลักของปี ' + data.year + ' เท่านั้น\nต้องการนำเข้าต่อหรือไม่?')) return;
      if (roster && roster.data) {
        var oldDate = roster.data.date ? roster.data.date.display : (roster.data.dateText || '-');
        if (!confirm('อัปเดตทะเบียนรายชื่อ\nเดิม: ข้อมูลวันที่ ' + oldDate + ' (' + roster.data.total + ' คน)\nใหม่: ข้อมูลวันที่ ' + newDate + ' (' + data.total + ' คน)\n\nต้องการใช้ไฟล์ใหม่หรือไม่?')) return;
      }
      setBusy('กำลังบันทึกทะเบียนรายชื่อ...');
      var saved = await DB.putRoster({ fileName: file.name, bytes: bytes, data: data, uploadedAt: Date.now() });
      roster = Object.assign({ fileName: file.name, data: data, uploadedAt: Date.now() }, saved || {});
      if (DB !== LocalDB) roster.bytes = bytes;
      rosterVer++;
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
    if (DB !== LocalDB && !canManage()) { var rb0 = $('rosterBar'); if (rb0) { rb0.innerHTML = ''; rb0.hidden = true; } return; }   // ครู: ดูทะเบียนได้ที่เมนู "ทะเบียนรายชื่อ"
    var el = $('rosterBar');
    if (!el) return;
    el.hidden = false;
    if (!roster || !roster.data) {
      el.innerHTML = '<div class="card roster-bar empty"><span>📋 ยังไม่มีทะเบียนรายชื่อนักเรียน' + (canManage() ? '' : ' (แอดมินอัปโหลดได้ที่ระบบแอดมิน)') + '</span>' + (canManage() ? '<button class="btn pri" data-rb="up">อัปโหลดไฟล์รายชื่อ (.docx)</button>' : '') + '</div>';
      return;
    }
    var d = roster.data, dt = d.date ? d.date.display : (d.dateText || 'ไม่ระบุวันที่');
    el.innerHTML = '<div class="card roster-bar"><span class="rb-ic" aria-hidden="true"><i>✓</i>📄</span><div class="rb-t"><b>รายชื่อนักเรียนปีการศึกษา ' + esc(d.year || '') + ' อัปเดตตามข้อมูลวันที่ ' + esc(dt) + '</b>' +
      '<span>' + d.classes.length + ' ห้อง · ' + d.total + ' คน · ไฟล์ ' + esc(roster.fileName || '') + (d.warnings.length ? ' · <span class="badge warn">ข้อควรตรวจ ' + d.warnings.length + '</span>' : '') + '</span></div>' +
      '<div class="rb-a"><button class="btn" data-rb="view">ดูรายชื่อ</button><button class="btn" data-rb="dl">⬇ ดาวน์โหลดไฟล์</button>' + (canManage() ? '<button class="btn pri" data-rb="up">อัปโหลดรายชื่อใหม่</button>' : '') + '</div></div>';
  }

  // ---------- เลือกข้อมูลของห้องปัจจุบัน ----------
  // ปีการศึกษาปัจจุบัน (ตามวันที่: เปิดภาคเรียน พ.ค.)
  function curYear() { return DB.curYear || thaiYear(); }
  function years() {
    var ys = {};
    ys[curYear()] = 1;
    // ปีเก่าย้อนไปถึง 2560 เลือกได้เสมอ (เพิ่ม/อัปเดต ปพ.6 ปีเก่า เช่น นักเรียนย้ายมาจากโรงเรียนอื่น)
    for (var y0 = 2560; y0 < curYear(); y0++) ys[y0] = 1;
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
    // โครงสร้างห้องจากทะเบียน (ใช้ได้ทุกปี)
    if (roster && roster.data) roster.data.classes.forEach(function (c) { if (c.stage === 'ป' && c.level === level) rs[c.room] = 1; });
    var list = Object.keys(rs).map(Number).sort(function (a, b) { return a - b; });
    return list.length ? list : [1];
  }
  function classRecords() {
    applyRosterTo(recsOf(curClass()), curClass());
    return records.filter(function (r) { return r.slot !== 'pp6' && r.year === state.year && r.level === state.level && r.room === state.room; })
      .sort(function (a, b) { return slotOrder(a.slot) - slotOrder(b.slot) || a.data.meta.code.localeCompare(b.data.meta.code); });
  }
  // ---------- ทะเบียน = ข้อมูลหลัก: ใช้ชื่อ/เลขที่จากทะเบียนในไฟล์ ปพ. ทุกไฟล์ของห้อง ----------
  function applyRosterTo(recs, cls) {
    if (!window.PP5Reconcile) return;
    var rc = rosterClass(cls), list = rc ? rc.students : null;
    recs.forEach(function (r) {
      if (!r.data || r.virtual || r._rv === rosterVer) return;
      r._rv = rosterVer;
      r.check = list ? PP5Reconcile.applyRoster(r.data, list) : null;
    });
  }
  // ---------- ปพ.6: ใช้ไฟล์ที่อัปโหลด ถ้าไม่มีสร้างจาก ปพ.5 ของห้องให้อัตโนมัติ ----------
  var vcache = {};
  function vSettingsKey(key) { return 'pp5-vset:' + key; }
  function virtualPP6(cls, rs) {
    var real = rs.filter(function (r) { return r.slot === 'pp6'; })[0];
    if (real) return real;
    var p5 = rs.filter(function (r) { return r.slot !== 'pp6' && r.data; })
      .sort(function (a, b) { return slotOrder(a.slot) - slotOrder(b.slot); });
    if (!p5.length) return null;
    var key = classKey(cls.year, cls.level, cls.room) + '|pp6';
    var sig = rosterVer + '|' + p5.map(function (r) { return r.key + ':' + r.uploadedAt + ':' + (r.size || 0); }).join(',');
    if (vcache[key] && vcache[key].sig === sig) return vcache[key].rec;
    var rc = rosterClass(cls);
    var donor = records.filter(function (r) { return r.slot === 'pp6' && r.data; })[0];
    var school = 'โรงเรียน' + (window.PP5Teachers ? PP5Teachers.SCHOOL : 'วัดทุ่งแฝก');
    var hr = rc && rc.teachers.length ? rc.teachers[0] : '';
    if (hr && window.PP5Teachers) hr = PP5Teachers.fullName(hr);
    var data = PP5Model.pp6FromPP5({ year: cls.year, level: cls.level, room: cls.room, school: school, teacher: hr, students: rc ? rc.students : null, records: p5.map(function (r) { return r.data; }) });
    if (donor) {
      ['deputy', 'director'].forEach(function (k) { if (donor.data.meta.signers && donor.data.meta.signers[k]) data.meta.signers[k] = Object.assign({}, donor.data.meta.signers[k]); });
      if (donor.data.images) data.images = { logo: donor.data.images.logo, director: donor.data.images.director, deputy: donor.data.images.deputy };
    }
    var st = null; try { st = JSON.parse(localStorage.getItem(vSettingsKey(key)) || 'null'); } catch (e) { st = null; }
    var rec = { key: key, year: cls.year, level: cls.level, room: cls.room, slot: 'pp6', virtual: true, fromRoster: !!rc, data: data, settings: st || undefined,
      fileName: 'สร้างอัตโนมัติจาก ปพ.5 (' + p5.length + ' วิชา)', origName: '(สร้างจาก ปพ.5)', uploadedAt: Date.now() };
    vcache[key] = { sig: sig, rec: rec };
    return rec;
  }
  function pp6Record() {
    var cls = curClass(), rs = recsOf(cls);
    applyRosterTo(rs, cls);
    return virtualPP6(cls, rs);
  }
  // เทียบคะแนน ปพ.6 ที่อัปโหลด กับคะแนนที่คิดจาก ปพ.5
  function compareWithPP5(rec) {
    if (!rec || rec.virtual || !window.PP5Reconcile) return null;
    var cls = { year: rec.year, level: rec.level, room: rec.room };
    var p5 = recsOf(cls).filter(function (r) { return r.slot !== 'pp6' && r.data; });
    if (!p5.length) return null;
    var derived = PP5Model.pp6FromPP5({ year: cls.year, level: cls.level, room: cls.room, students: rec.data.students, records: p5.map(function (r) { return r.data; }) });
    return PP5Reconcile.compareScores(rec.data, derived);
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
    applyRosterTo(rs, cls);
    var subj = function () { return rs.filter(function (r) { return r.slot !== 'pp6'; }); };
    return {
      esc: esc, toast: toast, setBusy: setBusy, rerender: function () { render(); }, store: function () { return DB === LocalDB ? null : DB; },
      classInfo: function () { return cls; }, classRecords: subj,
      pp6Record: function () { return virtualPP6(cls, rs); },
      className: function () { return 'ป.' + cls.level + '/' + cls.room; },
      reportCtx: Object.assign({}, reportCtx, { classRecords: subj }),
      rosterById: function () { return roster && roster.data ? PP5Roster.byId(roster.data) : {}; },
      classRoster: function () { var rc = rosterClass(cls); return rc ? rc.students : null; },
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
    // หน้าประกาศผลอัปเดตโดยแอดมินเท่านั้น (ไม่อัปเดตอัตโนมัติเมื่อครูบันทึก)
    if (DB === LocalDB || !window.PP5Publish || true) return;
    var c = ctxFor(cls);
    c.withClass(cls).then(function (cc) { PP5Publish.autoPublish(cc, cls); });
  }
  function fileNameFor(kind, meta, ext) { var x = 'x' + (ext || '.xlsx'); return kind === 'pp6' ? pp6FileName(meta, x) : newFileName(meta, x); }

  // ---------- คลังตัวชี้วัด: คลังในระบบ + ที่เรียนรู้จากไฟล์ที่อัปโหลด + ไฟล์ในโฟลเดอร์ต้นฉบับ ----------
  var learned = {};
  function libEntryFrom(d, from) {
    var inds = (d.indicators || []).filter(function (i) { return i.text || i.code; });
    if (!inds.length) return null;
    var m = d.meta;
    return { code: m.code, subject: m.subject, type: m.type, group: m.group, hours: m.hours, credit: m.credit, maxCollect: m.maxCollect, maxFinal: m.maxFinal,
      indicators: inds.map(function (i) { return { idx: i.idx, term: i.term, std: i.std, code: i.code, text: i.text, max: i.max }; }),
      standards: (d.standards || []).filter(function (x) { return x.text; }), from: from || '', at: Date.now() };
  }
  function learnLib(d, from) {
    if (!d || !d.meta || !d.meta.level || !DB.saveLib) return;
    var slot = slotOf(d.meta), e = libEntryFrom(d, from);
    if (!e || /^x-/.test(slot) && !d.meta.code) return;
    var key = d.meta.level + '|' + slot;
    learned[key] = e;
    DB.saveLib(key, e).catch(function (er) { console.warn('lib', er); });
  }
  function libSync(level, slot) {
    var k = level + '|' + slot;
    if (learned[k]) return JSON.parse(JSON.stringify(learned[k]));
    return window.PP5Library ? PP5Library.get(level, slot) : null;
  }
  // หาในคลังก่อน ไม่พบ → อ่านไฟล์ ปพ.5 ชั้น/วิชาเดียวกันในโฟลเดอร์ต้นฉบับ แล้วจำไว้
  async function libFor(level, slot, room) {
    var hit = libSync(level, slot);
    if (hit) return Object.assign(hit, { via: hit.from ? 'คลังที่เรียนรู้จากไฟล์ ' + hit.from : 'คลังตัวชี้วัดของระบบ' });
    if (!DB.sourceList) return null;
    if (!srcList) { try { srcList = await DB.sourceList(); } catch (e) { srcList = []; } }
    var c = srcList.map(function (x) { return { x: x, s: srcScore(x, 'pp5', level, room, slot) }; })
      .filter(function (o) { return o.s >= 31; }).sort(function (a, b) { return b.s - a.s; });
    for (var i = 0; i < c.length && i < 3; i++) {
      try {
        var f = await DB.sourceFile(c[i].x.id);
        var d = PP5Parser.parseWorkbook(XLSX.read(f.bytes, { type: 'array' }));
        if (+d.meta.level !== +level || slotOf(d.meta) !== slot) continue;
        learnLib(d, f.name);
        return Object.assign(libSync(level, slot), { via: 'ไฟล์ต้นฉบับ ' + f.name });
      } catch (e) { console.warn('lib source', e); }
    }
    return null;
  }

  // ---------- แม่แบบรูปแบบต้นฉบับ (บังคับใช้เสมอ) ----------
  // ลำดับการหาแม่แบบ: ของห้อง/วิชานั้น → ไฟล์ต้นฉบับในโฟลเดอร์ของโรงเรียน (ชั้น/วิชาเดียวกันก่อน) → แม่แบบทั่วไป
  var tplInfo = {}, tplCache = {}, srcList = null;
  var SLOT_WORDS = { th: /ไทย/, ma: /คณิต/, sci: /วิทย/, soc: /สังคม/, his: /ประวัติ/, pe: /สุข|พละ|พลศึกษา/, art: /ศิลป/, work: /การงาน|งานอาชีพ/, eng: /อังกฤษ|eng/i, cor: /ทุจริต/ };
  function tplKey(kind, level, slot) { return kind + (level ? '|' + level + (kind === 'pp5' && slot ? '|' + slot : '') : ''); }
  async function registerTemplate(key, bytes, name, auto) {
    var kind = key.slice(0, 3);
    var blank = await PP5Templates.build(kind, bytes, null);
    await DB.putTemplate(key, blank, name);
    tplInfo[key] = { name: name, savedAt: Date.now() };
    tplCache[key] = blank;
    if (!auto) toast('ตั้งแม่แบบ ' + (kind === 'pp5' ? 'ปพ.5' : 'ปพ.6') + ' รูปแบบต้นฉบับแล้ว', 'ok');
    return blank;
  }
  async function loadTpl(key) {
    if (tplCache[key]) return tplCache[key];
    if (!tplInfo[key]) return null;
    var t = await DB.getTemplate(key);
    if (!t || !t.bytes) return null;
    tplCache[key] = t.bytes instanceof Uint8Array ? t.bytes : new Uint8Array(t.bytes);
    return tplCache[key];
  }
  // คะแนนความเหมือนของไฟล์ต้นฉบับกับ ชั้น/ห้อง/วิชา ที่ต้องการ
  function srcScore(x, kind, level, room, slot) {
    var p = (x.path + '/' + x.name).replace(/\s+/g, '');
    var is5 = /\.xlsm$/i.test(x.name) || /ปพ\.?5/.test(p), is6 = /ปพ\.?6/.test(p) && !/\.xlsm$/i.test(x.name);
    if (kind === 'pp5' ? !is5 : !is6) return -1;
    var sc = 1, lv = p.match(/ป\.?(\d)[-\/](\d)/) || p.match(/ป\.?(\d)/);
    if (lv && +lv[1] === +level) { sc += 10; if (lv[2] && +lv[2] === +room) sc += 2; }
    if (kind === 'pp5' && slot && SLOT_WORDS[slot] && SLOT_WORDS[slot].test(x.name)) sc += 20;
    if (kind === 'pp5' && slot === 'soc' && /ประวัติ/.test(x.name)) sc -= 25;
    return sc;
  }
  async function fromSource(kind, level, room, slot) {
    if (!DB.sourceList) return null;
    if (!srcList) { try { srcList = await DB.sourceList(); } catch (e) { console.warn('source', e); srcList = []; } }
    var c = srcList.map(function (x) { return { x: x, s: srcScore(x, kind, level, room, slot) }; })
      .filter(function (o) { return o.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 3);
    for (var i = 0; i < c.length; i++) {
      try {
        var f = await DB.sourceFile(c[i].x.id);
        var names = XLSX.read(f.bytes, { type: 'array', bookSheets: true }).SheetNames;
        if (PP5Templates.detect(names) !== kind) continue;
        return { bytes: f.bytes, name: (c[i].x.path ? c[i].x.path + '/' : '') + f.name };
      } catch (e) { console.warn('source file', e); }
    }
    return null;
  }
  async function getTemplateBytes(kind, meta) {
    meta = meta || {};
    var slot = kind === 'pp5' && meta.code != null ? slotOf(meta) : null;
    var exact = tplKey(kind, meta.level, slot), lvl = tplKey(kind, meta.level);
    var t = await loadTpl(exact);
    if (t) return t;
    var src = meta.level ? await fromSource(kind, meta.level, meta.room, slot) : null;
    if (src) { try { return await registerTemplate(exact, src.bytes, src.name, true); } catch (e) { console.warn(e); } }
    return (kind === 'pp6' ? null : await loadTpl(lvl)) || await loadTpl(kind) ||
      (await loadTpl(Object.keys(tplInfo).filter(function (k) { return k.slice(0, 3) === kind; })[0] || '-'));
  }
  // ไฟล์ ปพ.5 เดิมของห้อง/วิชานี้ (ที่ครูอัปโหลดหรือที่ระบบบันทึกไว้) — ใช้เป็นฐานเพื่อให้ข้อมูลใหม่ (เช่น เทอม 2) ทับลงไฟล์เดิม
  var ownCache = {};
  async function ownFile(kind, data) {
    if (kind !== 'pp5' || !data || !data.meta) return null;
    var key = recKey(data.meta), rec = records.filter(function (r) { return r.key === key; })[0];
    if (!rec) return null;
    var ck = key + '@' + rec.uploadedAt;
    if (ownCache[ck] !== undefined) return ownCache[ck];
    var bytes = null;
    try {
      if (rec.blob) bytes = new Uint8Array(await rec.blob.arrayBuffer());
      else if (DB.getFile) { var f = await DB.getFile(key); bytes = f && f.bytes; }
      if (bytes && PP5Templates.detect(XLSX.read(bytes, { type: 'array', bookSheets: true }).SheetNames) !== kind) bytes = null;
    } catch (e) { console.warn('own file', e); bytes = null; }
    ownCache[ck] = bytes;
    return bytes;
  }
  // คืน { blob, ext, original } — ใช้รูปแบบต้นฉบับเสมอ (มีชีตสารบัญ) · ถ้ามีไฟล์เดิมของวิชานี้ เขียนทับลงไฟล์เดิม
  async function buildFile(kind, data) {
    var own = await ownFile(kind, data), tpl = own || await getTemplateBytes(kind, data && data.meta);
    if (tpl) {
      var out = await PP5Templates.build(kind, tpl, data, own ? { update: true } : null);
      var macro = kind === 'pp5';
      return { blob: new Blob([out], { type: macro ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), ext: macro ? '.xlsm' : '.xlsx', original: true };
    }
    toast('ยังไม่พบไฟล์ต้นฉบับ ' + (kind === 'pp5' ? 'ปพ.5' : 'ปพ.6') + ' — อัปโหลดไฟล์ต้นฉบับสัก 1 ไฟล์ ระบบจะใช้เป็นแม่แบบให้อัตโนมัติ', 'err');
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
    if (kind === 'pp5') learnLib(data, 'กรอกในระบบ ' + (meta.levelName || '') + '/' + meta.room);
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
    findRecord: function (key) { var p6 = pp6Record(); return records.filter(function (r) { return r.key === key; })[0] || (p6 && p6.key === key ? p6 : undefined); },
    coreSlot: function (slot) { return CORE.filter(function (c) { return c.slot === slot; })[0] || null; },
    masterRoster: function () { var c = rosterClass(curClass()); return c ? { students: c.students, teachers: c.teachers, date: roster.data.date ? roster.data.date.display : roster.data.dateText } : null; },
    saveEdited: saveEdited, downloadBlob: downloadBlob, fileNameFor: fileNameFor,
    libSync: libSync, libFor: libFor, slotOf: function (m) { return slotOf(m); },
    buildFile: buildFile
  };
  // โลโก้ + ลายเซ็นผู้บริหาร (ผู้ดูแลตั้ง ใช้ทุกห้อง) และลายเซ็นครู
  var brand = null, sigs = {}, tplImgs = null, tplImgsLoading = false;
  // ผู้บริหาร/โลโก้ที่ใช้จริง: ที่ผู้ดูแลตั้ง → ค่าเริ่มต้นของโรงเรียน · รูปลายเซ็น: ที่ผู้ดูแลอัปโหลด → จากไฟล์ ปพ.6 ต้นฉบับ
  function effBrand() {
    var D = (window.PP5Teachers && PP5Teachers.BRAND) || {}, b = brand || {};
    var donor = records.filter(function (r) { return r.slot === 'pp6' && r.data && r.data.images && (r.data.images.director || r.data.images.deputy); })[0];
    var im = (donor && donor.data.images) || tplImgs || {};
    function pick(k) { var x = b[k] || {}, y = D[k] || {}; return { name: x.name || y.name || '', position: x.position || y.position || '', img: x.img || im[k] || null }; }
    if (!tplImgs && !donor && !tplImgsLoading) loadTplImgs();
    return { school: b.school || D.school || '', logo: b.logo || im.logo || null, director: pick('director'), deputy: pick('deputy') };
  }
  // ดึงโลโก้/ลายเซ็นผู้บริหารจากแม่แบบ ปพ.6 (ไฟล์ต้นฉบับของโรงเรียน)
  async function loadTplImgs() {
    tplImgsLoading = true;
    try {
      var bytes = await getTemplateBytes('pp6', { level: state.level, room: state.room });
      if (!bytes) return;
      var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      var d = PP6Parser.parse(XLSX.read(u8, { type: 'array' }), u8);
      tplImgs = d.images || {};
      vcache = {};
      if (state.tab === 'report') render();
    } catch (e) { console.warn('tpl images', e); tplImgs = {}; }
  }
  function normName(n) { return String(n || '').replace(/\s+/g, ' ').trim(); }
  // PDF ปพ.5: ดาวน์โหลด + เก็บสำเนาใน Drive (รุ่น Apps Script)
  var pdfCtx = {
    toast: function (m, k) { toast(m, k); },
    store: DB,
    build: async function (rec) { return (await buildFile('pp5', rec.data)).blob; },
    download: function (blob, name) { downloadBlob(blob, name); },
    brand: function () { return effBrand(); },
    sig: function (name) { var x = sigs[normName(name)]; return x ? x.img : null; },
    save: function (blob, name) {
      downloadBlob(blob, name);
      if (DB.saveOutput && !readOnly()) DB.saveOutput(blob, name).then(function () { toast('เก็บสำเนา PDF ไว้ใน Google Drive แล้ว (โฟลเดอร์ "PDF ใบรายงาน")', 'ok'); }, function () {});
    }
  };
  var reportCtx = {
    esc: esc, toast: toast,
    brand: function () { return effBrand(); },
    sig: function (name) { var x = sigs[normName(name)]; return x ? x.img : null; },
    canSign: function () { return DB === LocalDB || DB.role === 'admin' || !DB.flags || DB.flags.allowSignature !== false; },
    saveSig: async function (name, file) {
      name = normName(name);
      if (!name) throw new Error('กรุณาใส่ชื่อครูประจำชั้นก่อน');
      var img = file ? await PP5Img.prepare(file, { maxW: 600, maxH: 260, clearWhite: true }) : null;
      await DB.saveSig(name, img);
      if (img) sigs[name] = { img: img, at: Date.now() }; else delete sigs[name];
      vcache = {};
    },
    classRecords: function () { return classRecords(); },
    pp6Record: function () { return pp6Record(); },
    className: function () { return 'ป.' + state.level + '/' + state.room; },
    save: function (rec) {
      if (rec.virtual) { try { localStorage.setItem(vSettingsKey(rec.key), JSON.stringify(rec.settings || {})); } catch (e) {} return Promise.resolve(); }
      return DB.saveSettings ? DB.saveSettings(rec) : DB.put(rec);
    },
    compare: compareWithPP5,
    readOnly: function () { return readOnly(); },
    howTo: function (k) { return howTo(k); },
    rosterLabel: function () { return roster && roster.data ? 'ทะเบียนรายชื่อ (ข้อมูล ' + (roster.data.date ? roster.data.date.display : roster.data.dateText) + ')' : ''; },
    rerender: function () { render(); },
    pickFor: function (slot) { pickFor(slot); },
    download: async function (rec) {
      if (!rec.virtual) return download(rec);
      try { setBusy('กำลังสร้างไฟล์ ปพ.6...'); var f = await buildFile('pp6', rec.data); downloadBlob(f.blob, fileNameFor('pp6', rec.data.meta, f.ext)); }
      catch (e) { toast('สร้างไฟล์ไม่สำเร็จ: ' + e.message, 'err'); } finally { setBusy(''); }
    },
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
    $('yearSel').innerHTML = ys.map(function (y) { return '<option value="' + y + '"' + (y === state.year ? ' selected' : '') + '>' + y + (y === curYear() ? ' (ปีปัจจุบัน)' : y < curYear() ? ' (ปีเก่า)' : '') + '</option>'; }).join('');
    $('yearSel').classList.toggle('old-year', state.year !== curYear());

    // ชั้น/ห้อง รวมเป็นรายการเดียว (ห้องจากทะเบียนรายชื่อและไฟล์ที่มี)
    var opts = '';
    LEVELS.forEach(function (l) {
      var rooms = roomsOf(state.year, l).slice();
      if (!rooms.length) rooms = [1];
      if (l === state.level && rooms.indexOf(state.room) < 0) rooms.push(state.room);
      rooms.sort(function (a, b) { return a - b; }).forEach(function (r) {
        var n = records.filter(function (x) { return x.year === state.year && x.level === l && x.room === r; }).length;
        opts += '<option value="' + l + '/' + r + '"' + (l === state.level && r === state.room ? ' selected' : '') + '>ป.' + l + '/' + r + (n ? '  (มีข้อมูล ' + n + ' ไฟล์)' : '') + '</option>';
      });
    });
    $('classSel').innerHTML = opts;
    // ปุ่มเลือกห้อง: แถวละชั้น กดได้ทันที (จุดเขียว = มีข้อมูลแล้ว)
        function levelRow(l) {
      var rooms = roomsOf(state.year, l).slice();
      if (l === state.level && rooms.indexOf(state.room) < 0) rooms.push(state.room);
      rooms.sort(function (a, b) { return a - b; });
      rooms = rooms.filter(function (r) { return myClass(l, r); });   // ครูรายบุคคล: เฉพาะห้องที่สอน
      if (!rooms.length) return '';
      return '<div class="cls-row"><span class="cls-lv">ป.' + l + '</span>' + rooms.map(function (r) {
        var n = records.filter(function (x) { return x.year === state.year && x.level === l && x.room === r; }).length;
        var on = l === state.level && r === state.room;
        return '<button type="button" class="cls-b' + (on ? ' on' : '') + (n ? ' has' : '') + '" data-cls="' + l + '/' + r + '" role="tab" aria-selected="' + on + '" title="' + (n ? 'มีข้อมูล ' + n + ' ไฟล์' : 'ยังไม่มีข้อมูล') + '">ป.' + l + '/' + r + (on ? '<em class="ck">✓</em>' : n ? '<i>' + n + '</i>' : '') + '</button>';
      }).join('') + '</div>';
    }
    // แถบเลือกห้อง: พับไว้ (กดเพื่อเปลี่ยนห้อง) · ยังไม่เลือกห้อง = กางไว้
    var open = pickerOpen || !state.level;
    $('picker').classList.toggle('collapsed', !open);
    $('pkBar').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('pkCls').textContent = state.level ? 'ป.' + state.level + '/' + state.room : 'ยังไม่ได้เลือกห้อง — กดเพื่อเลือก';
    $('pkYear').textContent = 'ปีการศึกษา ' + (state.year || '') + (state.year === curYear() ? '' : ' (ปีเก่า)');
    // เรียงตามลำดับ ป.1 → ป.6 (อ่านซ้ายไปขวา บนลงล่าง) กล่องละชั้น
    $('classChips').innerHTML = LEVELS.map(function (l) { var r = levelRow(l); return r ? '<div class="cls-box">' + r + '</div>' : ''; }).join('') +
      (isKru() ? (kruSubs().length || kruPP6().length ? '' : '<div class="kru-none">ยังไม่ได้เลือกวิชาที่สอน</div>') + '<button type="button" class="cls-mine" data-kru="mine">⚙️ วิชาที่ฉันสอน<small>เพิ่ม/ลด วิชา · ห้อง · ปพ.6</small></button>' : '');

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
    renderSide();
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
    if (!state.level && state.tab !== 'track' && state.tab !== 'roster') {
      document.body.classList.remove('editing');
      $('banner').innerHTML = '<div class="bnr" style="--bc:#475569"><div class="bi">🏫</div><div class="bm"><div class="bk">ยังไม่ได้เลือกห้องเรียน</div><div class="bt">กรุณาเลือกห้องเรียนด้านบน</div><div class="bs">กดปุ่มห้อง เช่น ป.4/1 เพื่อเริ่มกรอกคะแนน ดูผล หรือพิมพ์ใบรายงาน</div></div></div>';
      view.onclick = view.onchange = null;
      view.innerHTML = '<div class="card empty-state no-class"><div class="nc-ic">👆</div><b>ยังไม่ได้เลือกห้องเรียน</b>กดเลือกห้องจากกล่อง "เลือกห้องเรียน / ระดับ" ด้านบนก่อน</div>';
      saveUI();
      return;
    }
    var cls = 'ป.' + state.level + '/' + state.room;
    document.body.classList.toggle('editing', !!(window.PP5Editor && PP5Editor.active()));
    renderBanner(cls);
    view.onclick = view.onchange = null;
    if (window.PP5Editor && PP5Editor.active()) { PP5Editor.render(view, editorCtx); saveUI(); return; }
    if (isKru() && /^(report|summary|student|publish)$/.test(state.tab) && !mySlot(state.level, state.room, 'pp6')) {
      kruLock({ report: 'ใบรายงาน ปพ.6', summary: 'สรุปผลทั้งห้อง', student: 'ผลรายบุคคล', publish: 'การประกาศผล' }[state.tab]); saveUI(); return;
    }
    if (state.tab === 'publish') { PP5Publish.render(view, publishCtx()); saveUI(); return; }
    if (state.tab === 'roster') { renderRosterTab(); saveUI(); return; }
    if (state.tab === 'track') { renderTrack(); saveUI(); return; }
    if (state.tab === 'check') { renderCheck(cls); saveUI(); return; }
    if (state.tab === 'subjects') renderSubjects(cls);
    else if (state.tab === 'summary') renderSummary(cls);
    else if (state.tab === 'report') PP6Report.render(view, reportCtx);
    else { renderStudent(cls); appendHistory(); }
    saveUI();
  }

  // ---------- แท็บ ติดตามงาน (ผู้อำนวยการ/แอดมิน): ทุกห้อง × ทุกวิชา ส่งแล้วหรือยัง ----------
  var TRACK_SLOTS = [['th', 'ไทย'], ['ma', 'คณิต'], ['sci', 'วิทย์'], ['soc', 'สังคม'], ['his', 'ประวัติ'], ['pe', 'สุขศึกษา'], ['art', 'ศิลปะ'], ['work', 'การงาน'], ['eng', 'อังกฤษ'], ['cor', 'ทุจริต']];
  function renderTrack() {
    var yr = state.year, cls = {}, list = [];
    function add(l, r, t) { var k = l + '/' + r; if (!cls[k]) { cls[k] = { level: l, room: r, teachers: t || [] }; list.push(cls[k]); } else if (t && t.length) cls[k].teachers = t; }
    if (roster && roster.data) roster.data.classes.forEach(function (c) { if (c.stage === 'ป' && (!c.year || +c.year === +yr)) add(c.level, c.room, c.teachers); });
    records.forEach(function (r) { if (r.year === yr) add(r.level, r.room); });
    list.sort(function (a, b) { return a.level - b.level || a.room - b.room; });
    var sent = 0, total = 0, full = 0;
    var rows = list.map(function (c) {
      var n = 0;
      var cells = TRACK_SLOTS.map(function (s) {
        total++;
        var r = records.filter(function (x) { return x.year === yr && x.level === c.level && x.room === c.room && x.slot === s[0]; })[0];
        var who = window.PP5Teachers ? (PP5Teachers.forClass(c.level, c.room, s[0])[0] || '') : '';
        if (!r) return '<td><button class="trk no" data-go="' + c.level + '/' + c.room + '/subjects" title="' + esc(who ? 'ผู้สอน: ' + who : '') + '">✗<small>ยังไม่ส่ง</small></button></td>';
        n++; sent++;
        var d = new Date(r.uploadedAt || 0);
        return '<td><button class="trk ok" data-go="' + c.level + '/' + c.room + '/subjects" title="' + esc((r.fileName || '') + (who ? ' · ผู้สอน: ' + who : '')) + '">✓<small>' + (r.uploadedAt ? d.getDate() + '/' + (d.getMonth() + 1) : 'ส่งแล้ว') + '</small></button></td>';
      });
      if (n === TRACK_SLOTS.length) full++;
      var p6 = records.filter(function (x) { return x.year === yr && x.level === c.level && x.room === c.room && x.slot === 'pp6'; })[0];
      var p6c = p6 ? '<button class="trk ok" data-go="' + c.level + '/' + c.room + '/report">✓<small>อัปโหลด</small></button>' : n ? '<button class="trk auto" data-go="' + c.level + '/' + c.room + '/report">⚙<small>สร้างจาก ปพ.5</small></button>' : '<button class="trk no" data-go="' + c.level + '/' + c.room + '/report">✗<small>-</small></button>';
      var pct = Math.round(n / TRACK_SLOTS.length * 100);
      return '<tr><th class="l"><b>ป.' + c.level + '/' + c.room + '</b><small>' + esc((c.teachers || []).map(function (t) { return 'ครู' + String(t).replace(/^ครู/, ''); }).join(', ')) + '</small></th>' + cells.join('') +
        '<td>' + p6c + '</td><td><div class="trk-p"><i style="width:' + pct + '%"></i></div><small>' + n + '/' + TRACK_SLOTS.length + '</small></td></tr>';
    }).join('');
    view.innerHTML = '<div class="tiles"><div class="tile"><div class="k">ส่ง ปพ.5 แล้ว</div><div class="v">' + sent + ' / ' + total + '</div><div class="s">ทุกห้อง ปีการศึกษา ' + esc(yr) + '</div></div>' +
      '<div class="tile"><div class="k">ห้องที่ส่งครบทุกวิชา</div><div class="v">' + full + ' / ' + list.length + '</div></div>' +
      '<div class="tile"><div class="k">ยังไม่ส่ง</div><div class="v" style="color:#b91c1c">' + (total - sent) + ' วิชา</div></div></div>' +
      '<p class="sub">กดช่องเพื่อเปิดดูข้อมูลของห้อง/วิชานั้น · ชี้ที่ช่องเพื่อดูชื่อครูผู้สอน</p>' +
      '<div class="tbl-wrap trk-wrap"><table class="trk-tbl"><thead><tr><th class="l">ห้อง</th>' + TRACK_SLOTS.map(function (s) { return '<th>' + s[1] + '</th>'; }).join('') + '<th>ปพ.6</th><th>ความคืบหน้า</th></tr></thead><tbody>' + (rows || '<tr><td colspan="13">ยังไม่มีข้อมูลห้องเรียน (อัปโหลดทะเบียนรายชื่อที่ระบบแอดมิน)</td></tr>') + '</tbody></table></div>';
    view.onclick = function (e) {
      var g = e.target.closest('[data-go]'); if (!g) return;
      var p = g.dataset.go.split('/'); state.level = +p[0]; state.room = +p[1]; state.tab = p[2]; state.student = null; render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  // ---------- แท็บ ตรวจสอบ: ห้องนี้ รายชื่อเทียบทะเบียน + คะแนนครบไหม + ปพ.6 เทียบ ปพ.5 ----------
  function renderCheck(cls) {
    var recs = classRecords();
    var h = '<div class="card rc-panel"><h3>📘 ปพ.5 แต่ละวิชา</h3>';
    if (!recs.length) h += '<p class="sub">ห้องนี้ยังไม่มีไฟล์ ปพ.5</p>';
    else h += '<div class="chk-rows">' + recs.map(function (r) {
      var d = r.data, m = d.meta, c = r.check, inds = d.indicators.length;
      var filled = d.students.length ? Math.min.apply(null, d.students.map(function (s) { return s.filled || 0; })) : 0;
      var rosterOk = !c ? null : !c.issues;
      var det = c && c.issues ? '<details><summary>ดูรายละเอียด ' + c.issues + ' รายการ</summary><ul class="chk-list">' +
        c.diffs.map(function (x) { return '<li>เลขที่ ' + esc(x.no) + ' ' + esc(x.name) + ': ' + esc(x.items.join(', ')) + '</li>'; }).join('') +
        c.notInRoster.map(function (x) { return '<li class="bad">ไม่มีในทะเบียน: ' + esc(x.name) + '</li>'; }).join('') +
        c.missing.map(function (x) { return '<li class="bad">ไม่มีในไฟล์: เลขที่ ' + esc(x.no) + ' ' + esc(x.name) + '</li>'; }).join('') + '</ul></details>' : '';
      return '<div class="chk-row"><div class="chk-sub"><b>' + esc(m.subject) + '</b><small>' + esc(m.code) + (m.teacher ? ' · ' + esc(m.teacher) : '') + '</small></div>' +
        '<div class="chk-st ' + (rosterOk === true ? 'ok' : rosterOk === false ? 'bad' : '') + '">' + (rosterOk === true ? '✅ รายชื่อตรงทะเบียน' : rosterOk === false ? '⚠️ ไม่ตรงทะเบียน ' + c.issues + ' รายการ' : 'ℹ️ ยังไม่มีทะเบียนให้เทียบ') + det + '</div>' +
        '<div class="chk-st ' + (filled >= inds && inds ? 'ok' : 'bad') + '">' + (filled >= inds && inds ? '✅ คะแนนครบทุกตัวชี้วัด' : '⚠️ กรอกแล้ว ' + filled + '/' + inds + ' ตัวชี้วัด') + '</div>' +
        '<button class="btn pri" data-act="open" data-key="' + esc(r.key) + '">👁 ดูคะแนน</button></div>';
    }).join('') + '</div>';
    h += '</div>';
    var p6 = pp6Record();
    h += p6 && window.PP6Report && PP6Report.checkPanel ? PP6Report.checkPanel(p6, reportCtx).replace('<h3>🔎 ตรวจสอบความถูกต้อง</h3>', '<h3>📗 ปพ.6 ใบรายงาน' + (p6.virtual ? ' (สร้างจาก ปพ.5)' : '') + '</h3>') : '<div class="card rc-panel"><h3>📗 ปพ.6</h3><p class="sub">ยังไม่มีข้อมูล ปพ.6 ของห้องนี้</p></div>';
    view.innerHTML = h;
  }

  // ผลการเรียนย้อนหลัง/จากโรงเรียนอื่นของนักเรียนที่เลือก (รุ่น Apps Script)
  function appendHistory() {
    if (!DB.studentHistory || !window.PP5History) return;
    var sid = String(state.student || '').indexOf('id:') === 0 ? String(state.student).slice(3) : '';
    var card = document.createElement('div');
    card.className = 'card hs-card';
    card.innerHTML = '<h3>📚 ผลการเรียนย้อนหลังทุกปี / เพิ่มผลจากโรงเรียนอื่น</h3><p class="sub">ดูว่านักเรียนมีผลในปีไหนบ้าง ตั้งแต่ ป.1 ถึงปีปัจจุบัน · ปีที่ย้ายมาจากโรงเรียนอื่นเพิ่มผลการเรียนได้</p><div class="hs-mount"></div>';
    view.appendChild(card);
    PP5History.mount(card.querySelector('.hs-mount'), { store: DB, toast: toast, id: sid });
  }

  // ---------- แบนเนอร์บอกส่วนที่กำลังทำ ----------
  var BANNERS = {
    track: { c: '#b45309', i: '📋', k: 'ติดตามการส่งงาน', t: 'ติดตามงานทุกห้อง', s: 'ดูว่าครูส่ง ปพ.5 / ปพ.6 ครบหรือยัง · กดช่องเพื่อเปิดดูข้อมูล' },
    check: { c: '#0f766e', i: '🔎', k: 'ตรวจสอบความถูกต้อง', t: 'ตรวจสอบข้อมูล ปพ.', s: 'รายชื่อเทียบทะเบียน และคะแนน ปพ.6 เทียบ ปพ.5 ของห้องนี้' },
    subjects: { c: '#1d5bd8', i: '📘', k: 'ปพ.5 · แบบบันทึกผลการพัฒนาคุณภาพผู้เรียนรายวิชา', t: 'รายวิชา (ปพ.5)', s: 'กรอกคะแนน อัปโหลด หรือดาวน์โหลด Excel ของแต่ละวิชา' },
    report: { c: '#0b7285', i: '📗', k: 'ปพ.6 · แบบรายงานผลการพัฒนาคุณภาพผู้เรียนรายบุคคล', t: 'ใบรายงาน (ปพ.6)', s: 'ใบรายงานผลของนักเรียนทุกคน พิมพ์/ดาวน์โหลด PDF และตรวจความถูกต้องกับ ปพ.5' },
    summary: { c: '#5f3dc4', i: '📊', k: 'ภาพรวมห้องเรียน', t: 'สรุปผลทั้งห้อง', s: 'เกรดเฉลี่ยและผลการเรียนทุกวิชาของทั้งห้อง' },
    student: { c: '#c2255c', i: '🧒', k: 'ผลการเรียนรายบุคคล', t: 'รายบุคคล', s: 'ดูคะแนนทุกวิชาของนักเรียนทีละคน' },
    publish: { c: '#2b8a3e', i: '📢', k: 'หน้าประกาศผลสำหรับผู้ปกครอง', t: 'ประกาศผล', s: 'ตั้งค่าและตรวจข้อมูลที่ผู้ปกครองจะเห็น' },
    roster: { c: '#495057', i: '📋', k: 'ข้อมูลหลักของระบบ', t: 'ทะเบียนรายชื่อนักเรียน', s: 'รายชื่อจากไฟล์ Word ใช้เป็นชื่อ-เลขที่หลักในทุกไฟล์ ปพ.' }
  };
  function renderBanner(cls) {
    var el = $('banner');
    if (!el) return;
    var b, extra = '';
    if (window.PP5Editor && PP5Editor.active()) {
      var ek = PP5Editor.kind ? PP5Editor.kind() : 'pp5';
      b = ek === 'pp6' ? { c: '#0b7285', i: '✎', k: 'กำลังกรอกข้อมูล ปพ.6', t: 'กรอก/แก้ไข ใบรายงาน ปพ.6', s: 'อย่าลืมกด "บันทึกในระบบ" ก่อนออก' }
        : { c: '#1d5bd8', i: '✎', k: 'กำลังกรอกข้อมูล ปพ.5', t: 'กรอก/แก้ไข ปพ.5 ' + (PP5Editor.title ? PP5Editor.title() : ''), s: 'อย่าลืมกด "บันทึกในระบบ" ก่อนออก' };
    } else b = BANNERS[state.tab] || BANNERS.subjects;
    if (state.tab === 'subjects' || (window.PP5Editor && PP5Editor.active())) { var n = classRecords().length; extra = '<div class="bx"><span class="bx-ic">💾</span><span>ข้อมูลที่กรอกแล้ว<b>' + n + ' วิชา</b></span></div>'; }
    else if (state.tab === 'report') { var p6 = pp6Record(); extra = '<div class="bx"><span class="bx-ic">📗</span><span>' + (p6 ? (p6.virtual ? 'สร้างจาก ปพ.5' : 'ไฟล์ที่อัปโหลด') + '<b>' + p6.data.students.length + ' คน</b>' : 'ยังไม่มีข้อมูล') + '</span></div>'; }
    var oldNote = state.year !== curYear() ? '<div class="old-note">📦 กำลังดูข้อมูล<b>ปีการศึกษา ' + esc(state.year) + '</b> ' + (state.year < curYear() ? '(ปีเก่า)' : '') + ' — ไม่ใช่ปีปัจจุบัน (' + curYear() + ') ' + (state.level && !readOnly() && state.year < curYear() && mySlot(state.level, state.room, 'pp6') ? '<button class="btn pri" data-old6ed="1">➕ เพิ่มนักเรียน / แก้ ปพ.6 ปีนี้</button> ' : '') + '<button class="btn" data-goyear="' + curYear() + '">กลับไปปี ' + curYear() + '</button></div>' : '';
    el.innerHTML = oldNote + '<div class="bnr" style="--bc:' + b.c + '"><div class="bi">' + b.i + '</div><div class="bm"><div class="bk">' + esc(b.k) + '</div>' +
      '<div class="bt">' + esc(b.t) + (state.tab === 'track' && !(window.PP5Editor && PP5Editor.active()) ? '' : ' · ชั้น ' + esc(cls)) + '</div><div class="bs">ปีการศึกษา ' + esc(state.year || '') + ' · ' + esc(b.s) + '</div></div>' + extra + '</div>';
  }

  // ---------- แท็บ: รายวิชา ----------
  function renderSubjects(cls) {
    var recs = classRecords();
    var bySlot = {};
    recs.forEach(function (r) { bySlot[r.slot] = r; });
    var slots = CORE.map(function (c) { return c.slot; });
    recs.forEach(function (r) { if (slots.indexOf(r.slot) < 0) slots.push(r.slot); });
    var kru = isKru(), others = 0;
    if (kru) { slots = slots.filter(function (sl) { var ok = mySlot(state.level, state.room, sl); if (!ok) others++; return ok; }); }

    var fl = DB.flags || {}, off = DB.role !== 'admin' ? Object.keys(DB.flagDefs || {}).filter(function (k) { return fl[k] === false && /^allow/.test(k); }) : [];
    var html = (off.length ? '<div class="flag-off-note">ผู้ดูแลระบบปิดไว้ชั่วคราว: ' + off.map(function (k) { return esc(DB.flagDefs[k]); }).join(', ') + '</div>' : '') +
      (kru ? '<div class="kru-note">👤 แสดงเฉพาะวิชาที่<b>' + esc(DB.me.name) + '</b>สอนในห้องนี้ (' + slots.length + ' วิชา' + (others ? ' · ซ่อนวิชาของครูท่านอื่น ' + others + ' วิชา' : '') + ') <button class="btn" data-kru="mine">⚙️ วิชาที่ฉันสอน</button></div>' : '') +
      '<div class="p5-bar"><p class="sub">มีข้อมูลแล้ว ' + recs.length + ' วิชา</p>' + (recs.length && window.PP5Pdf ? '<button class="btn pri" data-act="pdf5all">📄 PDF ปพ.5 ' + (kru ? 'ทุกวิชาที่ฉันสอน' : 'ทุกวิชา') + ' (ห้องนี้)</button>' : '') + '</div><div class="slots">';
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
        rosterChip(rec) +
        '<div class="slot-meta">' + (full ? '<span class="badge ok">คะแนนครบทุกตัวชี้วัด</span>' : '<span class="badge warn">กรอกคะแนนแล้ว ' + filledAll + '/' + d.indicators.length + ' ตัวชี้วัด</span>') +
        (dist.rest ? '' : '') + '</div>' +
        // ปุ่มหลัก 2 ปุ่มใหญ่ · ปุ่มอื่นแสดงครบเป็นปุ่มเล็กด้านล่าง
        '<div class="slot-acts slot-main">' +
        (readOnly() ? '' : '<button class="btn pri" data-act="edit" data-key="' + esc(rec.key) + '">✏️ กรอกคะแนน</button>') +
        '<button class="btn" data-act="open" data-key="' + esc(rec.key) + '">👁 ดูคะแนน</button></div>' +
        '<div class="more-list">' +
        '<button class="btn" data-act="pdf5" data-key="' + esc(rec.key) + '">📄 PDF ปพ.5' + (DB.xpdfStart ? ' ฉบับเต็ม' : '') + '</button>' +
        (DB.xpdfStart ? '<button class="btn" data-act="pdf5b" data-key="' + esc(rec.key) + '">🧾 PDF สรุปย่อ</button>' : '') +
        '<button class="btn" data-act="download" data-key="' + esc(rec.key) + '">⬇ ดาวน์โหลด Excel</button>' +
        (readOnly() ? '' : '<button class="btn" data-act="replace" data-slot="' + esc(slot) + '">⇪ อัปโหลดไฟล์ใหม่ทับ</button>' +
          '<button class="btn danger" data-act="delete" data-key="' + esc(rec.key) + '">🗑 ลบวิชานี้</button>') +
        '</div></div>';
    });
    if (!kru || mySlot(state.level, state.room, 'x-')) html += '<div class="slot card empty" data-slot="__extra" tabindex="0" role="button">' +
      '<div class="slot-h"><div class="slot-ic" style="background:' + EXTRA_COLOR + '">+</div><div><div class="slot-n">รายวิชาเพิ่มเติม</div><div class="slot-c">เช่น หน้าที่พลเมือง, คอมพิวเตอร์</div></div></div>' +
      '<div class="slot-empty-t">อัปโหลด กรอกในระบบ หรือสร้างไฟล์ Excel</div>' + startButtons('__extra') + '</div>';
    html += '</div>';
    view.innerHTML = html;
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

  function rosterChip(rec) {
    var c = rec.check;
    if (!c) return '';
    if (!c.issues) return '<div class="slot-meta"><span class="badge ok">✓ รายชื่อตรงกับทะเบียน</span></div>';
    var tip = [].concat(
      c.diffs.map(function (d) { return 'เลขที่ ' + d.no + ' ' + d.name + ': ' + d.items.join(', '); }),
      c.notInRoster.map(function (d) { return 'ไม่มีในทะเบียน: ' + d.name; }),
      c.missing.map(function (d) { return 'ไม่มีในไฟล์: เลขที่ ' + d.no + ' ' + d.name; })).join('\n');
    return '<div class="slot-meta"><span class="badge warn" title="' + esc(tip) + '">⚠ ไม่ตรงทะเบียน ' + c.issues + ' รายการ (ใช้ชื่อตามทะเบียนแล้ว)</span></div>';
  }
  // คำอธิบายสั้น ๆ ว่าแต่ละปุ่มใช้ทำอะไร
  function howTo(kind) {
    var items = kind === 'pp6'
      ? [['✏️', 'แก้ไขในระบบ', 'กรอก/แก้คะแนน ปพ.6 บนเว็บได้เลย ระบบคำนวณเกรดให้ทันที'], ['⬇', 'ดาวน์โหลด Excel', 'โหลดไฟล์ ปพ.6 รูปแบบของโรงเรียนไปพิมพ์หรือเก็บไว้'], ['⇪', 'อัปโหลด', 'ส่งไฟล์ ปพ.6 Excel ที่กรอกในคอม ระบบใช้ไฟล์นี้แทนของเดิม'], ['🖨', 'PDF / พิมพ์', 'ใบรายงานผลของนักเรียนทั้งห้องหรือรายคน']]
      : [['✏️', 'กรอกคะแนน', 'กรอกในระบบได้เลย ไม่ต้องใช้ Excel ระบบคิดคะแนนเก็บ รวม และเกรดให้ทันที'], ['⇪', 'อัปโหลด', 'ส่งไฟล์ ปพ.5 (Excel) ที่กรอกในคอมเข้าระบบ ไฟล์ใหม่ทับไฟล์เดิม (เช่น เพิ่มคะแนนเทอม 2)'], ['⬇', 'Excel', 'โหลดไฟล์ ปพ.5 รูปแบบต้นฉบับ (มีรายชื่อ+ตัวชี้วัดแล้ว) ไปกรอกในคอม']];
    return '<div class="howto">' + items.map(function (x) { return '<div class="ht-it"><span class="ht-ic">' + x[0] + '</span><div><b>' + x[1] + '</b><small>' + x[2] + '</small></div></div>'; }).join('') + '</div>';
  }
  // ปุ่มใหญ่มีคำอธิบายสั้น ๆ ใต้ชื่อปุ่ม
  function actBtn(act, slot, key, ic, label, sub, cls) {
    return '<button class="btn act-b ' + (cls || '') + '" data-act="' + act + '"' + (slot ? ' data-slot="' + esc(slot) + '"' : '') + (key ? ' data-key="' + esc(key) + '"' : '') + '><span class="ab-ic">' + ic + '</span><span class="ab-t"><b>' + label + '</b><small>' + sub + '</small></span></button>';
  }
  function readOnly() { return DB.role === 'director'; }
  // ---------- ครูรายบุคคล: ทำได้เฉพาะวิชา/ห้องที่ตัวเองสอน ----------
  function isKru() { return DB.role === 'kru' && !!DB.me; }
  function kruSubs() { return (DB.me && DB.me.subs) || []; }
  function kruPP6() { return (DB.me && DB.me.pp6) || []; }
  function mySlot(level, room, slot) {
    if (!isKru()) return true;
    var c = level + '/' + room;
    if (slot === 'pp6') return kruPP6().indexOf(c) >= 0;
    return kruSubs().indexOf(c + '|' + slot) >= 0 || (!CORE.some(function (x) { return x.slot === slot; }) && kruSubs().indexOf(c + '|+') >= 0);
  }
  function myClass(level, room) {
    if (!isKru()) return true;
    var c = level + '/' + room;
    return kruPP6().indexOf(c) >= 0 || kruSubs().some(function (x) { return x.indexOf(c + '|') === 0; });
  }
  function allClasses() {
    var out = [];
    LEVELS.forEach(function (l) { roomsOf(state.year || curYear(), l).forEach(function (r) { out.push(l + '/' + r); }); });
    return out;
  }
  // เข้าครั้งแรก: ตั้งวิชาตามตารางสอน + ห้องประจำชั้นตามทะเบียนรายชื่อ (แก้ไขได้ภายหลัง)
  async function kruFirstSetup() {
    if (!isKru() || DB.me.subs) return;
    var cls = allClasses(), name = DB.me.name;
    var subs = window.PP5Teachers ? PP5Teachers.subsOf(name, cls) : [];
    var home = roster && roster.data ? roster.data.classes.filter(function (c) {
      return c.stage === 'ป' && (c.teachers || []).some(function (t) { return PP5Teachers.same(PP5Teachers.fullName(t), name) || PP5Teachers.same(t, name); });
    }).map(function (c) { return c.level + '/' + c.room; }) : [];
    try { await DB.saveMe({ subs: subs, pp6: home }); toast('ตั้งวิชาที่สอนตามตารางสอนให้แล้ว ' + subs.length + ' วิชา' + (home.length ? ' · ห้องประจำชั้น ' + home.map(function (h) { return 'ป.' + h; }).join(', ') : '') + ' — แก้ไขได้ที่ "วิชาที่ฉันสอน"', 'ok'); }
    catch (e) { toast('ตั้งวิชาเริ่มต้นไม่สำเร็จ: ' + e.message, 'err'); }
  }
  var SHORT = { th: 'ไทย', ma: 'คณิต', sci: 'วิทย์', soc: 'สังคม', his: 'ประวัติ', pe: 'สุขศึกษา', art: 'ศิลปะ', work: 'การงาน', eng: 'อังกฤษ', cor: 'ทุจริต' };
  function openMine() {
    var subs = kruSubs().slice(), pp6 = kruPP6().slice(), cls = allClasses();
    kruSubs().concat(pp6).forEach(function (x) { var c = x.split('|')[0]; if (cls.indexOf(c) < 0) cls.push(c); });
    $('modalTitle').textContent = '📚 วิชาที่ฉันสอน · ' + (DB.me.name || '');
    function draw() {
      var head = '<tr><th class="l">ห้อง</th>' + CORE.map(function (c) { return '<th>' + esc(SHORT[c.slot] || c.name) + '</th>'; }).join('') + '<th title="รายวิชาเพิ่มเติม">เพิ่มเติม</th><th class="p6">ปพ.6<small>ประจำชั้น</small></th></tr>';
      var rows = cls.map(function (c) {
        var cb = function (v, on, extra) { return '<td' + (extra ? ' class="' + extra + '"' : '') + '><label class="mn-c"><input type="checkbox" data-mn="' + v + '"' + (on ? ' checked' : '') + '><span></span></label></td>'; };
        return '<tr><th class="l">ป.' + esc(c) + ' <button type="button" class="mn-row" data-mnrow="' + c + '" title="เลือกทุกวิชาของห้องนี้">ทั้งห้อง</button></th>' +
          CORE.map(function (x) { return cb(c + '|' + x.slot, subs.indexOf(c + '|' + x.slot) >= 0); }).join('') +
          cb(c + '|+', subs.indexOf(c + '|+') >= 0) + cb('p6:' + c, pp6.indexOf(c) >= 0, 'p6') + '</tr>';
      }).join('');
      $('modalBody').innerHTML = '<p class="sub">ติ๊กวิชาและห้องที่คุณสอน ระบบจะแสดงเฉพาะส่วนนี้ให้กรอก · ช่อง <b>ปพ.6</b> = ห้องที่คุณเป็นครูประจำชั้น (ทำใบรายงาน/ประกาศผล) · ระบบจำไว้ แก้ไขได้ตลอด</p>' +
        '<div class="tbl-wrap mn-wrap"><table class="mn-tbl"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="mn-acts"><button type="button" class="btn" data-mnact="tt">↺ ตั้งตามตารางสอน</button><span style="flex:1"></span><button type="button" class="btn" data-mnact="close">ยกเลิก</button><button type="button" class="btn pri" data-mnact="save">💾 บันทึก</button></div>';
    }
    function collect() {
      subs = []; pp6 = [];
      Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-mn]'), function (c) {
        if (!c.checked) return;
        if (c.dataset.mn.indexOf('p6:') === 0) pp6.push(c.dataset.mn.slice(3)); else subs.push(c.dataset.mn);
      });
    }
    draw();
    $('modalBody').onchange = null;
    $('modalBody').onclick = async function (e) {
      var row = e.target.closest('[data-mnrow]'), a = e.target.closest('[data-mnact]');
      if (row) {
        var bx = Array.prototype.filter.call($('modalBody').querySelectorAll('[data-mn^="' + row.dataset.mnrow + '|"]'), function (c) { return !/\|\+$/.test(c.dataset.mn); });
        var all = bx.every(function (c) { return c.checked; });
        bx.forEach(function (c) { c.checked = !all; });
        return;
      }
      if (!a) return;
      if (a.dataset.mnact === 'close') { $('modal').close(); return; }
      if (a.dataset.mnact === 'tt') { collect(); subs = window.PP5Teachers ? PP5Teachers.subsOf(DB.me.name, allClasses()) : []; draw(); toast('ตั้งตามตารางสอนแล้ว (ยังไม่บันทึก)', 'info'); return; }
      if (a.dataset.mnact === 'save') {
        collect();
        a.disabled = true;
        try { await DB.saveMe({ subs: subs, pp6: pp6 }); $('modal').close(); toast('บันทึกวิชาที่สอนแล้ว ' + subs.length + ' รายการ · ห้องประจำชั้น ' + (pp6.length ? pp6.map(function (h) { return 'ป.' + h; }).join(', ') : '-'), 'ok'); render(); }
        catch (er) { a.disabled = false; toast('บันทึกไม่สำเร็จ: ' + er.message, 'err'); }
      }
    };
    $('modal').showModal();
  }
  function kruLock(what) {
    var c = state.level + '/' + state.room;
    view.innerHTML = '<div class="card empty-state kru-lock"><div class="nc-ic">🔒</div><b>ป.' + esc(c) + ' ไม่ใช่ห้องประจำชั้นของคุณ</b>' + esc(what) + ' ทำได้เฉพาะห้องที่คุณเป็นครูประจำชั้น (ปพ.6)<br><br><button class="btn pri" data-kru="mine">⚙️ ตั้งห้องประจำชั้น / วิชาที่ฉันสอน</button></div>';
  }
  function startButtons(slot) {
    var f = DB.flags || {}, adm = DB.role === 'admin';
    var canEdit = adm || f.allowEdit !== false, canUp = adm || f.allowUpload !== false;
    if (readOnly()) return '<div class="slot-acts"><span class="ro-note">ยังไม่ได้ส่ง</span></div>';
    return '<div class="slot-acts slot-main">' +
      (canEdit ? '<button class="btn pri" data-act="online" data-slot="' + esc(slot) + '">✏️ เริ่มกรอกคะแนน</button>' : '') +
      (canUp ? '<button class="btn" data-act="upload" data-slot="' + esc(slot) + '">⇪ อัปโหลด Excel</button>' : '') + '</div>' +
      '<button class="link-btn" data-act="template" data-slot="' + esc(slot) + '">⬇ ดาวน์โหลดไฟล์ Excel เปล่าไปกรอกในคอม</button>';
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
    $('modalBody').onclick = $('modalBody').onchange = null;
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

    var h = '';
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
  $('fileOne').addEventListener('change', function (e) {
    var exp = pendingSlot && pendingSlot !== '__extra' ? { level: state.level, room: state.room, slot: pendingSlot } : null;
    handleFiles(e.target.files, exp);
  });

  // ลากวางทั้งหน้า / ลงช่องวิชา
  var dragDepth = 0;
  document.addEventListener('dragenter', function (e) { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
  document.addEventListener('click', function (e) { if (!e.target.closest('.sw-wrap')) Array.prototype.forEach.call(document.querySelectorAll('.sw-menu'), function (m) { m.hidden = true; }); });
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
  $('classSel').addEventListener('change', function (e) {
    if (!leaveEditor()) { renderPicker(); return; }
    var p = e.target.value.split('/');
    state.level = +p[0]; state.room = +p[1]; state.student = null;
    render();
  });
  $('banner').addEventListener('click', function (e) {
    var b = e.target.closest('[data-goyear]');
    if (b && leaveEditor()) { state.year = +b.dataset.goyear; state.student = null; render(); }
  });
  // หน้าจอโหลดตอนเปิดระบบ
  function bootDone() { var bl = document.getElementById('bootLoader'); if (bl) { bl.classList.add('done'); setTimeout(function () { bl.remove(); }, 400); } }
  var pickerOpen = false;
  $('pkBar').addEventListener('click', function () { pickerOpen = !$('picker').classList.contains('collapsed') ? false : true; if (!state.level) pickerOpen = true; renderPicker(); });
  $('classChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cls]');
    if (!b || !leaveEditor()) return;
    var p = b.dataset.cls.split('/');
    pickerOpen = false;   // เลือกแล้วพับแถบกลับ
    state.level = +p[0]; state.room = +p[1]; state.student = null;
    render();
  });
  $('upBtn').addEventListener('click', function () { $('fileAll').value = ''; $('fileAll').click(); });
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b && leaveEditor()) { state.tab = b.dataset.tab; render(); }
  });

  view.addEventListener('click', async function (e) {
    var a = e.target.closest('[data-act]');
    if (a) {
      var act = a.dataset.act, key = a.dataset.key;
      var rec = key && (records.filter(function (r) { return r.key === key; })[0] || editorCtx.findRecord(key));
      if (act === 'open') openSubject(key);
      else if (act === 'upload') pickFor(a.dataset.slot);
      else if (readOnly() && /^(online|edit|upload|replace|delete)$/.test(act)) toast('ผู้อำนวยการดูข้อมูลได้อย่างเดียว แก้ไขไม่ได้', 'info');
      else if (act === 'online' || act === 'template') PP5Editor.open({ kind: a.dataset.slot === 'pp6' ? 'pp6' : 'pp5', slot: a.dataset.slot, intent: act === 'template' ? 'excel' : 'online' }, editorCtx);
      else if (act === 'edit' && rec) PP5Editor.open({ kind: rec.slot === 'pp6' ? 'pp6' : 'pp5', key: rec.key }, editorCtx);
      else if (act === 'replace') pickFor(a.dataset.slot);
      else if (act === 'download' && rec) download(rec);
      // รุ่น Apps Script: PDF รูปแบบไฟล์ Excel ต้นฉบับ (ทุกชีต) · รุ่นในเครื่อง: เล่มสรุป
      else if (act === 'pdf5' && rec) { if (rec.data) { if (DB.xpdfStart) PP5Pdf.excel(rec, pdfCtx); else PP5Pdf.subject(rec, pdfCtx); } }
      else if (act === 'pdf5b' && rec) { if (rec.data) PP5Pdf.subject(rec, pdfCtx); }
      else if (act === 'pdf5all') {
        var mine = classRecords().filter(function (r) { return r.data && (!isKru() || mySlot(r.level, r.room, r.slot)); });
        var nm = 'ปพ.5_ป.' + state.level + '-' + state.room + '_ทุกวิชา_ปี' + state.year;
        if (mine.length) { if (DB.xpdfStart) PP5Pdf.excel(mine, pdfCtx, nm); else PP5Pdf.classBook(mine, pdfCtx, nm); }
      }
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
  if ($('clearAll')) $('clearAll').addEventListener('click', async function () {
    if (!records.length) { toast('ยังไม่มีข้อมูล', 'info'); return; }
    if (!confirm('ลบไฟล์และคะแนนทั้งหมด ' + records.length + ' ไฟล์' + (DB === LocalDB ? 'ออกจากเครื่องนี้' : 'ออกจากระบบ (ย้ายไฟล์ใน Drive ไปถังขยะ)') + '?')) return;
    await DB.clear();
    records = [];
    render();
    toast('ล้างข้อมูลแล้ว', 'info');
  });

  document.addEventListener('click', function (e) { var k = e.target.closest('[data-kru="mine"]'); if (k && isKru()) { e.preventDefault(); openMine(); } });

  // เปิดหน้ากรอก ปพ.6 ของห้อง/ปีที่เลือก ที่ขั้น "นักเรียน" (เพิ่มนักเรียนย้ายเข้า + แก้คะแนน)
  function openPP6Roster() {
    var p6 = pp6Record();
    if (p6) PP5Editor.open({ kind: 'pp6', key: p6.key }, editorCtx); else PP5Editor.open({ kind: 'pp6', slot: 'pp6', intent: 'online' }, editorCtx);
    setTimeout(function () { var b = document.querySelector('.ed-steps [data-sec="roster"]'); if (b) b.click(); }, 300);
    toast('เปิด ปพ.6 ป.' + state.level + '/' + state.room + ' ปีการศึกษา ' + state.year + ' · กด "+ เพิ่ม 1 คน" แล้วกรอกคะแนนภาค 1/2 และส่วนอื่น ๆ · อย่าลืมกด "บันทึกในระบบ"', 'info');
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-old6ed]') || !leaveEditor()) return;
    state.tab = 'report';
    var need = records.filter(function (r) { return r.year === state.year && r.level === state.level && r.room === state.room && !r.data; });
    if (need.length && DB.ensureData) DB.ensureData(need).then(function () { render(); openPP6Roster(); }, function () { render(); openPP6Roster(); });
    else { render(); openPP6Roster(); }
  });

  // สลับระบบ: แอดมิน = หน้าแยก (ถามรหัสแอดมิน) · ครู ↔ ผู้อำนวยการ = ล้างรหัสเดิมแล้วกดรหัสใหม่
  function switchTo(want) {
    var base = window.PP5_HOME || (DB.publicUrl || '').replace(/\?.*$/, '');
    var now = DB.role === 'admin' ? 'admin' : DB.role === 'director' ? 'director' : DB.role === 'kru' ? 'kru' : 'teacher';
    if (want === 'admin') { if (base) window.open(base + '?page=super', '_top'); return true; }
    if (want === now) return false;
    try { localStorage.removeItem('pp5-pin'); } catch (er) {}
    if (window.PP5_LOGOUT) PP5_LOGOUT(true); else location.reload();
    return true;
  }

  // ---------- แถบเมนูด้านซ้าย ----------
  var SIDE_TABS = [['track', '📋', 'ติดตามงาน'], ['check', '🔎', 'ตรวจสอบ'], ['subjects', '📘', 'รายวิชา (ปพ.5)'], ['report', '📗', 'ใบรายงาน (ปพ.6)'], ['summary', '📊', 'สรุปทั้งห้อง'], ['student', '🧒', 'รายบุคคล'], ['publish', '📢', 'ประกาศผล'], ['roster', '👥', 'ทะเบียนรายชื่อ']];
  function renderSide() {
    var el = $('sideNav');
    if (!el) return;
    document.body.classList.add('has-side');
    var adm = DB.role === 'admin', dir = DB.role === 'director';
    var home = window.PP5_HOME || (DB.publicUrl || '').replace(/\?.*$/, '');
    var logo = (typeof effBrand === 'function' && effBrand().logo) || '';
    var cls = state.level ? 'ป.' + state.level + '/' + state.room : 'ยังไม่เลือกห้อง';
    var kru = DB.role === 'kru';
    el.innerHTML = '<div class="sn-head">' + (logo ? '<img src="' + logo + '" alt="">' : '<span class="sn-logo">🏫</span>') + '<div><b>ระบบ ปพ.5 / ปพ.6</b><small>โรงเรียนวัดทุ่งแฝก</small></div></div>' +
      '<div class="sn-who">' + (adm ? '👑 แอดมิน' : dir ? '👔 ผู้อำนวยการ' : DB === LocalDB ? '💻 ใช้งานในเครื่อง' : kru ? '👤 ครู' + esc(String(DB.me && DB.me.name || '').replace(/^(นาย|นางสาว|นาง)/, '')) : '🏫 ระบบโรงเรียน') + '<span>ปี ' + esc(state.year || '') + ' · ' + esc(cls) + '</span></div>' +
      '<div class="sn-sec">เมนู</div>' +
      SIDE_TABS.filter(function (t) { return t[0] !== 'track' || adm || dir; }).map(function (t) {
        return '<button type="button" class="sn-i' + (state.tab === t[0] ? ' on' : '') + '" data-side="' + t[0] + '"><span>' + t[1] + '</span>' + t[2] + '</button>';
      }).join('') +
      (kru ? '<button type="button" class="sn-i" data-kru="mine"><span>⚙️</span>วิชาที่ฉันสอน</button>' : '') +
      (DB === LocalDB ? '' : '<div class="sn-sec">สลับระบบ</div>' +
        '<button type="button" class="sn-i' + (kru ? ' on2' : '') + '" data-sto="kru"><span>👤</span>ระบบครู (รายบุคคล)</button>' +
        '<button type="button" class="sn-i' + (!adm && !dir && !kru ? ' on2' : '') + '" data-sto="teacher"><span>🏫</span>ระบบโรงเรียน</button>' +
        '<button type="button" class="sn-i' + (dir ? ' on2' : '') + '" data-sto="director"><span>👔</span>ระบบผู้อำนวยการ</button>' +
        '<button type="button" class="sn-i" data-sto="admin"><span>🛡</span>ระบบแอดมิน</button>' +
        '<div class="sn-sec"></div>' +
        (home ? '<a class="sn-i" href="' + esc(home) + '" target="_top"><span>🏠</span>หน้าแรก (ประกาศผล)</a>' : '') +
        '<button type="button" class="sn-i out" data-sout="1"><span>↪</span>ออกจากระบบ</button>');
  }
  function sideDrawer(open) { document.body.classList.toggle('side-show', open); $('sideScrim').hidden = !open; }
  if ($('sideNav')) {
    $('sideNav').addEventListener('click', function (e) {
      var t = e.target.closest('[data-side]'), s = e.target.closest('[data-sto]'), o = e.target.closest('[data-sout]');
      if (e.target.closest('[data-kru]')) { sideDrawer(false); return; }
      if (t) { if (!leaveEditor()) return; state.tab = t.dataset.side; state.student = null; sideDrawer(false); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (s) { sideDrawer(false); switchTo(s.dataset.sto); }
      else if (o && confirm('ออกจากระบบ?')) { if (window.PP5_LOGOUT) PP5_LOGOUT(); }
    });
    $('sideOpen').addEventListener('click', function () { sideDrawer(!document.body.classList.contains('side-show')); });
    $('sideScrim').addEventListener('click', function () { sideDrawer(false); });
  }

  // ---------- ปุ่มมุมขวาบน: สิทธิ์ผู้ใช้ / ผู้ดูแลระบบหลัก / ออกจากระบบ ----------
  function renderTopActs() {
    var el = $('topActs');
    if (!el || DB === LocalDB) return;
    var adm = DB.role === 'admin', dir = DB.role === 'director';
    var home = window.PP5_HOME || (DB.publicUrl || '').replace(/\?.*$/, '');
    document.body.classList.toggle('ro', dir);
    Array.prototype.forEach.call(document.querySelectorAll('.track-tab'), function (t) { t.hidden = !(adm || dir); });
    if (dir && (state.tab === 'subjects' || !state.tab)) state.tab = 'track';
    var kru = DB.role === 'kru';
    var cur = adm ? '👑 แอดมิน (ในระบบครู)' : dir ? '👔 ผู้อำนวยการ' : kru ? '👤 ครู' + esc(String(DB.me && DB.me.name || '').replace(/^(นาย|นางสาว|นาง)/, '').split(/\s+/)[0]) : '🏫 ระบบโรงเรียน';
    el.innerHTML = (home ? '<a class="tb home-tb" href="' + esc(home) + '" target="_top">🏠 หน้าหลัก</a>' : '') +
      '<div class="sw-wrap"><button class="tb role sw-btn" data-top="switch" aria-haspopup="true">' + cur + ' <span aria-hidden="true">▾</span></button>' +
      '<div class="sw-menu" hidden><div class="sw-h">สลับไปใช้ระบบ</div>' +
      '<button data-to="kru"' + (kru ? ' class="on"' : '') + '>👤 ระบบครู (รายบุคคล)<small>เฉพาะวิชาที่ตัวเองสอน · รหัสเบอร์โทร 4 ตัวท้าย</small></button>' +
      '<button data-to="teacher"' + (!adm && !dir && !kru ? ' class="on"' : '') + '>🏫 ระบบโรงเรียน<small>แก้ได้ทุกชั้น ทุกวิชา (สอนแทน)</small></button>' +
      '<button data-to="director"' + (dir ? ' class="on"' : '') + '>👔 ระบบผู้อำนวยการ<small>ติดตามงาน · ดูอย่างเดียว</small></button>' +
      '<button data-to="admin">🛡 ระบบแอดมิน<small>ผู้ดูแลระบบ (ใช้รหัสแอดมิน)</small></button></div></div>' +
      '<button class="tb out-tb" data-top="logout">↪ ออกจากระบบ</button>';
    $('upBtn').hidden = !adm;   // ปุ่มอัปโหลดรวม: เฉพาะแอดมิน
  }
  function openFlags() {
    var defs = DB.flagDefs || {}, f = Object.assign({}, DB.flags || {});
    $('modalTitle').textContent = 'ผู้ดูแลระบบหลัก: เปิด-ปิดระบบ';
    $('modalBody').innerHTML = '<p class="sub">ปิดระบบใดแล้ว ครูทุกคนจะใช้ส่วนนั้นไม่ได้ (ผู้ดูแลระบบหลักยังใช้ได้เสมอ) · มีผลทันที</p><div class="flag-list">' +
      Object.keys(defs).map(function (k) {
        return '<label class="flag-row"><b>' + esc(defs[k]) + '</b><span class="sw"><input type="checkbox" data-flag="' + k + '"' + (f[k] !== false ? ' checked' : '') + '><span></span></span></label>';
      }).join('') + '</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" data-fl="all0">ปิดทั้งหมด</button><button class="btn" data-fl="all1">เปิดทั้งหมด</button></div>';
    var body = $('modalBody');
    async function save() {
      var nf = {};
      Array.prototype.forEach.call(body.querySelectorAll('[data-flag]'), function (c) { nf[c.dataset.flag] = c.checked; });
      try { await DB.setFlags(nf); toast('บันทึกการตั้งค่าระบบแล้ว', 'ok'); renderTopActs(); render(); }
      catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'err'); }
    }
    body.onchange = function (e) { if (e.target.dataset.flag) save(); };
    body.onclick = function (e) {
      var b = e.target.closest('[data-fl]');
      if (!b) return;
      Array.prototype.forEach.call(body.querySelectorAll('[data-flag]'), function (c) { c.checked = b.dataset.fl === 'all1'; });
      save();
    };
    $('modal').showModal();
  }
  if ($('topActs')) $('topActs').addEventListener('click', function (e) {
    var to = e.target.closest('[data-to]');
    if (to) { if (switchTo(to.dataset.to) === false) to.closest('.sw-menu').hidden = true; return; }
    var b = e.target.closest('[data-top]');
    if (!b) return;
    if (b.dataset.top === 'switch') { var mn = b.parentNode.querySelector('.sw-menu'); mn.hidden = !mn.hidden; return; }
    if (b.dataset.top === 'flags') openFlags();
    else if (b.dataset.top === 'logout' && confirm('ออกจากระบบ?')) { if (window.PP5_LOGOUT) PP5_LOGOUT(); }
  });

  // ---------- เริ่มทำงาน ----------
  (async function init() {
    try {
      await DB.open();
      renderTopActs();
      var bt = document.getElementById('bootText'); if (bt) bt.textContent = 'กำลังโหลดรายวิชาและรายชื่อนักเรียน...';
      records = await DB.all();
      if (DB.templateInfo) { try { tplInfo = (await DB.templateInfo()) || {}; } catch (te) { tplInfo = {}; } }
      if (DB.getRoster) { try { roster = (await DB.getRoster()) || null; } catch (re) { roster = null; } }
      if (DB.getLib) { try { learned = (await DB.getLib()) || {}; } catch (le) { learned = {}; } }
      if (DB.getBrand) { try { brand = await DB.getBrand(); sigs = (await DB.getSigs()) || {}; } catch (be) { console.warn('brand', be); } }
      rosterVer++;
      setTimeout(function () { var lg = effBrand().logo, im = $('topLogo'); if (lg && im) { im.src = lg; im.hidden = false; } }, 0);
    } catch (e) {
      console.error(e);
      if (DB === LocalDB) {
        toast('เบราว์เซอร์นี้เก็บข้อมูลในเครื่องไม่ได้ (อาจเป็นโหมดไม่ระบุตัวตน) ข้อมูลจะหายเมื่อปิดหน้า', 'err');
        DB.put = DB.del = DB.clear = function () { return Promise.resolve(); };
      } else {
        toast('เชื่อมต่อที่เก็บข้อมูลไม่สำเร็จ: ' + (e && e.message ? e.message : e), 'err');
      }
    }
    // เปิดระบบทุกครั้งเริ่มที่ปีการศึกษาปัจจุบัน (ไม่ค้างที่ปีเก่า)
    state.year = curYear();
    // เข้าระบบใหม่: ยังไม่เลือกห้อง ให้ครูกดเลือกห้องเอง
    state.level = null; state.room = null; state.student = null;
    if (DB.role !== 'director' && state.tab === 'track') state.tab = 'subjects';
    await kruFirstSetup();
    // มาจากระบบแอดมิน "อัปเดต ปพ.6 ปีเก่า": เปิดห้อง/ปีนั้น แล้วเปิดหน้ากรอก ปพ.6 ทันที
    var go = null;
    try { go = JSON.parse(localStorage.getItem('pp5-goto') || 'null'); localStorage.removeItem('pp5-goto'); } catch (ge) { go = null; }
    if (go && go.at > Date.now() - 600000 && go.year && go.level) {
      state.year = +go.year; state.level = +go.level; state.room = +go.room || 1; state.tab = 'report';
    } else go = null;
    render();
    bootDone();
    if (go && go.edit && window.PP5Editor) {
      var openGo = function () { openPP6Roster(); };
      var need = records.filter(function (r) { return r.year === state.year && r.level === state.level && r.room === state.room && !r.data; });
      if (need.length && DB.ensureData) DB.ensureData(need).then(function () { render(); openGo(); }, openGo); else openGo();
    }
  })();
})();
