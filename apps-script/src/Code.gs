/**
 * ระบบประกาศผลการเรียน + ระบบหลังบ้าน ปพ.5 / ปพ.6 — Google Apps Script
 *
 *   หน้าแรก (ผู้ปกครอง):   URL ของเว็บแอป              → ค้นหาผลด้วยเลขประจำตัวนักเรียน
 *   หลังบ้าน (ครู):        URL ของเว็บแอป + ?page=admin → อัปโหลด / กรอก / สร้างไฟล์ ปพ.5 ปพ.6
 *
 * วิธีติดตั้งอยู่ใน README.md
 */

// ===== ตั้งค่า =====
// รหัสผ่านเข้าหลังบ้าน: ครู / ผู้ดูแลระบบหลัก (เปิด-ปิดทุกระบบได้)
var TEACHER_PIN = '72030101';
var ADMIN_PIN = '555666';
// ผู้อำนวยการ: ดู/ติดตามงานได้ทุกห้อง แต่แก้ไขอะไรไม่ได้
var DIRECTOR_PIN = '9987';
// โฟลเดอร์หลักใน Google Drive: ระบบจะสร้างไฟล์และโฟลเดอร์ทั้งหมด "ภายในโฟลเดอร์นี้เท่านั้น"
var ROOT_FOLDER_ID = '1HcYvW2C0e-sDZZ-fX7OpRIApfz6YiHSY';
// โฟลเดอร์ไฟล์ต้นฉบับ ปพ.5 / ปพ.6 ปีที่แล้ว: ระบบ "อ่านอย่างเดียว" เพื่อใช้เป็นแม่แบบของแต่ละห้อง/วิชา
var SOURCE_FOLDER_ID = '16yXoxARn6S6KbfJalxv8i5Lk04arN8ZG';
// โฟลเดอร์ต้นฉบับเพิ่มเติม (อ่านอย่างเดียว) เช่น โฟลเดอร์ส่ง ปพ.5 ของครูแต่ละปี — ระบบดึงตัวชี้วัด/แม่แบบจากไฟล์ในนี้ด้วย
var SOURCE_FOLDER_IDS = [SOURCE_FOLDER_ID, '1s-ekHBDg_BvrfXOJ7owVmclT0nnMJ9Yb'];
// ชื่อบนแท็บเบราว์เซอร์ของหน้าหลังบ้าน
var ADMIN_TITLE = 'หลังบ้าน ปพ.5 / ปพ.6';

var DATA_FOLDER_NAME = '_ข้อมูลระบบ (ห้ามลบ)';
var PUB_FOLDER_NAME = '_ประกาศผล (ห้ามลบ)';
var PDF_FOLDER_NAME = 'PDF ใบรายงาน';
var TPL_FOLDER_NAME = '_แม่แบบ (ห้ามลบ)';
var ROSTER_FOLDER_NAME = 'รายชื่อนักเรียน';
var SIG_FOLDER_NAME = '_โลโก้และลายเซ็น (ห้ามลบ)';
var PROP_PREFIX = 'rec:';

function doGet(e) {
  var page = e && e.parameter && e.parameter.page;
  var admin = page === 'admin', sup = page === 'super';
  var cfg = admin || sup ? null : getCfg_();
  var t = HtmlService.createTemplateFromFile(sup ? 'Super' : admin ? 'Index' : 'Public');
  t.homeUrl = webUrl_().replace(/\?.*$/, '');   // ปุ่ม "กลับหน้าแรก" ในหน้าครู/แอดมิน
  return t.evaluate()
    .setTitle(sup ? 'ระบบผู้ดูแล (แอดมิน)' : admin ? ADMIN_TITLE : (cfg.title || 'ประกาศผลการเรียน') + (cfg.school ? ' ' + cfg.school : ''))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** แทรกเนื้อหาไฟล์ HTML อื่น (Css, JsApp ฯลฯ) */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ===== ตัวช่วย =====
// ระบบที่ผู้ดูแลหลักเปิด/ปิดได้ (ค่าเริ่มต้น = เปิดทั้งหมด)
var FLAG_DEFS = {
  publicOpen: 'หน้าประกาศผล (ผู้ปกครองดูผลการเรียน)',
  showMid: 'แสดงผลกลางปี (ภาคเรียนที่ 1)',
  showFinal: 'แสดงผลปลายปี (เกรด)',
  allowUpload: 'อัปโหลดไฟล์ ปพ.5 / ปพ.6',
  allowEdit: 'กรอกคะแนนในระบบ',
  allowDelete: 'ลบไฟล์ / ล้างข้อมูล',
  allowRoster: 'อัปโหลดรายชื่อนักเรียน',
  allowPublish: 'เผยแพร่ / ตั้งค่าหน้าประกาศผล',
  allowReport: 'สร้างใบรายงาน PDF',
  allowSignature: 'อัปโหลดลายเซ็นครู'
};
function flags_() {
  var v = {}; try { v = JSON.parse(props_().getProperty('FLAGS') || '{}'); } catch (e) {}
  var out = {}; Object.keys(FLAG_DEFS).forEach(function (k) { out[k] = v[k] !== false; });
  return out;
}
function roleOf_(pin) {
  pin = String(pin || '');
  if (ADMIN_PIN && pin === String(ADMIN_PIN)) return 'admin';
  if (TEACHER_PIN && pin === String(TEACHER_PIN)) return 'teacher';
  if (DIRECTOR_PIN && pin === String(DIRECTOR_PIN)) return 'director';
  if (kruOf_(pin)) return 'kru';
  if (!TEACHER_PIN && !ADMIN_PIN) return 'admin';
  return null;
}
function checkPin_(pin) {
  var role = roleOf_(pin);
  if (!role) {
    // กันการเดารหัส: ผิดเกิน 20 ครั้งใน 10 นาที พักทั้งระบบชั่วคราว
    var c = cache_(), k = 'pinfail', n = +(c.get(k) || 0);
    if (n >= 20) throw new Error('PIN_LOCKED');
    if (pin) c.put(k, String(n + 1), 600);
    throw new Error('PIN_REQUIRED');
  }
  return role;
}
/** ตรวจรหัส + ระบบนั้นต้องเปิดอยู่ (ผู้ดูแลหลักทำได้เสมอ) */
function need_(pin, flag) {
  var role = checkPin_(pin);
  if (role === 'director') throw new Error('ผู้อำนวยการดูข้อมูลได้อย่างเดียว แก้ไขไม่ได้');
  if (role !== 'admin' && flag && !flags_()[flag]) throw new Error('ปิดใช้งาน: ' + FLAG_DEFS[flag] + ' (ผู้ดูแลระบบปิดไว้)');
  return role;
}
// ===== ครูรายบุคคล (รหัส = เบอร์โทร 4 ตัวท้าย) — ทำได้เฉพาะวิชา/ห้องที่ตัวเองสอน =====
// รายชื่อครูและรหัสเก็บใน Script Properties (ตั้งที่ระบบแอดมิน) ไม่เขียนไว้ในโค้ด
var KRU_CORE = ['th', 'ma', 'sci', 'soc', 'his', 'pe', 'art', 'work', 'eng', 'cor'];
function kruList_() { try { var v = JSON.parse(props_().getProperty('KRU') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function kruOf_(pin) {
  pin = String(pin || '');
  if (!/^\d{4,6}$/.test(pin)) return null;
  return kruList_().filter(function (k) { return String(k.pin) === pin; })[0] || null;
}
function kruCan_(k, level, room, slot) {
  if (!k) return false;
  var c = level + '/' + room, subs = k.subs || [];
  if (slot === 'pp6') return (k.pp6 || []).indexOf(c) >= 0;
  return subs.indexOf(c + '|' + slot) >= 0 || (KRU_CORE.indexOf(String(slot)) < 0 && subs.indexOf(c + '|+') >= 0);
}
/** need_ + ครูรายบุคคลต้องเป็นวิชา/ห้องของตัวเอง */
function needScope_(pin, flag, level, room, slot) {
  var role = need_(pin, flag);
  if (role === 'kru' && !kruCan_(kruOf_(pin), level, room, slot))
    throw new Error(slot === 'pp6' ? 'ห้องนี้ไม่ใช่ห้องประจำชั้น (ปพ.6) ของคุณ — กด "วิชาที่ฉันสอน" เพื่อเพิ่ม' : 'วิชา/ห้องนี้ไม่อยู่ในรายการที่คุณสอน — กด "วิชาที่ฉันสอน" เพื่อเพิ่ม');
  return role;
}
function noKru_(role) { if (role === 'kru') throw new Error('ส่วนนี้ใช้ได้เฉพาะระบบโรงเรียน/แอดมิน'); return role; }
function kruPublic_(k) { return k ? { id: k.id, name: k.name, subs: k.subs || null, pp6: k.pp6 || [] } : null; }
/** ครูแก้รายการวิชา/ห้องที่ตัวเองสอน และห้องประจำชั้น (ปพ.6) */
function api_saveMe(pin, json) {
  if (checkPin_(pin) !== 'kru') throw new Error('สำหรับครูรายบุคคลเท่านั้น');
  var v = JSON.parse(json || '{}');
  var okSub = function (x) { return /^[1-6]\/\d{1,2}\|[A-Za-z0-9_+\-]{1,40}$/.test(x); }, okCls = function (x) { return /^[1-6]\/\d{1,2}$/.test(x); };
  return withLock_(function () {
    var list = kruList_(), me = kruOf_(pin);
    list.forEach(function (k) {
      if (k.id !== me.id) return;
      if (Array.isArray(v.subs)) k.subs = v.subs.filter(okSub).slice(0, 300);
      if (Array.isArray(v.pp6)) k.pp6 = v.pp6.filter(okCls).slice(0, 30);
      me = k;
    });
    props_().setProperty('KRU', JSON.stringify(list));
    return kruPublic_(me);
  });
}
/** แอดมิน: รายชื่อครูและรหัส */
function api_kruList(pin) { if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก'); return kruList_(); }
function api_kruSave(pin, json) {
  if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก');
  var v = JSON.parse(json || '[]'), seen = {}, out = [];
  var fixed = [TEACHER_PIN, ADMIN_PIN, DIRECTOR_PIN].map(String);
  v.forEach(function (k, i) {
    var name = String(k.name || '').trim().slice(0, 80), p = String(k.pin || '').trim();
    if (!name) return;
    if (!/^\d{4}$/.test(p)) throw new Error('รหัสของ ' + name + ' ต้องเป็นตัวเลข 4 หลัก');
    if (fixed.indexOf(p) >= 0) throw new Error('รหัสของ ' + name + ' ซ้ำกับรหัสระบบ (ผอ./ระบบโรงเรียน/แอดมิน)');
    if (seen[p]) throw new Error('รหัส ' + p + ' ซ้ำกัน: ' + seen[p] + ' และ ' + name);
    seen[p] = name;
    out.push({ id: String(k.id || ('k' + Date.now().toString(36) + i)), name: name, pin: p, subs: Array.isArray(k.subs) ? k.subs : null, pp6: Array.isArray(k.pp6) ? k.pp6 : [] });
  });
  props_().setProperty('KRU', JSON.stringify(out));
  return out;
}
function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }

function rootFolder_() {
  try {
    return DriveApp.getFolderById(ROOT_FOLDER_ID);
  } catch (e) {
    throw new Error('เปิดโฟลเดอร์หลักใน Google Drive ไม่ได้ (ROOT_FOLDER_ID) กรุณาตรวจว่าบัญชีที่ติดตั้งสคริปต์มีสิทธิ์ "แก้ไข" โฟลเดอร์นั้น');
  }
}
function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function classFolder_(entry) {
  var year = subFolder_(rootFolder_(), 'ปีการศึกษา ' + entry.year);
  return subFolder_(year, (entry.stage || 'ป') + '.' + entry.level + '-' + entry.room);
}
function safeName_(s) { return String(s).replace(/[\\/:*?"<>|#%]+/g, '-'); }
function trashById_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ไม่มีไฟล์แล้ว */ }
}
function getEntry_(key) { var v = props_().getProperty(PROP_PREFIX + key); return v ? JSON.parse(v) : null; }
function putEntry_(entry) { props_().setProperty(PROP_PREFIX + entry.key, JSON.stringify(entry)); }
function allEntries_() {
  var all = props_().getProperties(), out = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(PROP_PREFIX) === 0) { try { out.push(JSON.parse(all[k])); } catch (e) { /* ข้าม */ } }
  });
  return out;
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function webUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

// ===== ไฟล์ข้อความใน Drive (พร้อมแคช) =====
function readText_(id) {
  if (!id) return null;
  var c = cache_(), k = 'f:' + id, v = c.get(k);
  if (v != null) return v;
  try { v = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'); } catch (e) { return null; }
  try { if (v.length < 95000) c.put(k, v, 600); } catch (e) { /* แคชเต็ม */ }
  return v;
}
function writeText_(folder, name, id, text) {
  var file = null;
  if (id) { try { file = DriveApp.getFileById(id); if (file.isTrashed()) file = null; } catch (e) { file = null; } }
  if (file) file.setContent(text);
  else file = folder.createFile(name, text, 'application/json');
  try { cache_().remove('f:' + file.getId()); } catch (e) { /* ไม่เป็นไร */ }
  return file.getId();
}

// ===== API หลังบ้าน =====
function api_ping(pin) {
  var role = checkPin_(pin);
  var root = rootFolder_();
  return { ok: true, rootUrl: role === 'admin' ? root.getUrl() : null, role: role, flags: flags_(), flagDefs: FLAG_DEFS, publicUrl: webUrl_(), curYear: curYear_(), curYearFixed: !!props_().getProperty('CUR_YEAR'), me: role === 'kru' ? kruPublic_(kruOf_(pin)) : null };
}
/** จำนวนหลักของรหัส (ให้แป้นกดแสดงจุดครบ) — ไม่บอกตัวรหัส */
function api_pinInfo() { return { teacher: String(TEACHER_PIN || '').length, admin: String(ADMIN_PIN || '').length, director: String(DIRECTOR_PIN || '').length, kru: 4 }; }
/** ตรวจรหัสจากแป้นตัวเลข (หน้าแรก/หลังบ้าน) */
function api_checkPin(pin) {
  try { return { role: checkPin_(pin) }; } catch (e) { return { role: null, locked: /LOCKED/.test(e.message) }; }
}
function api_getFlags(pin) { checkPin_(pin); return { flags: flags_(), defs: FLAG_DEFS }; }
function api_setFlags(pin, json) {
  if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก');
  var v = JSON.parse(json || '{}'), out = {};
  Object.keys(FLAG_DEFS).forEach(function (k) { out[k] = v[k] !== false; });
  props_().setProperty('FLAGS', JSON.stringify(out));
  return out;
}
function api_list(pin) { checkPin_(pin); return allEntries_(); }

/** บันทึกไฟล์ (อัปโหลด หรือที่ระบบสร้างจากการกรอกในระบบ) */
function api_save(pin, entry, fileB64, dataJson) {
  if (!entry || !entry.key) throw new Error('ข้อมูลไม่ครบ');
  needScope_(pin, entry.origName === '(กรอกในระบบ)' ? 'allowEdit' : 'allowUpload', entry.level, entry.room, entry.slot);
  return withLock_(function () {
    var old = getEntry_(entry.key);
    var file = null;
    if (fileB64) {
      var blob = Utilities.newBlob(Utilities.base64Decode(fileB64), entry.mime || 'application/octet-stream', safeName_(entry.fileName));
      file = classFolder_(entry).createFile(blob);
    }
    var dataFolder = subFolder_(rootFolder_(), DATA_FOLDER_NAME);
    var dataFile = dataFolder.createFile(safeName_(entry.key) + '.json', dataJson, 'application/json');
    // เก็บฉบับก่อนหน้าไว้ย้อนกลับได้ (5 ฉบับล่าสุด) แทนการทิ้งทันที
    var hist = (old && old.hist) || [];
    if (old && old.dataId) {
      hist.unshift({ dataId: old.dataId, fileId: file ? old.fileId : null, fileName: old.fileName, origName: old.origName, at: old.uploadedAt || 0, by: old.by || '' });
      while (hist.length > HIST_MAX) { var x = hist.pop(); trashById_(x.dataId); trashById_(x.fileId); }
    } else if (old && file) trashById_(old.fileId);
    var saved = {
      key: entry.key, year: entry.year, level: entry.level, room: entry.room, stage: entry.stage || 'ป',
      slot: entry.slot, fileName: entry.fileName, origName: entry.origName, size: entry.size,
      uploadedAt: entry.uploadedAt || Date.now(), school: entry.school || '',
      fileId: file ? file.getId() : (old && old.fileId) || null, url: file ? file.getUrl() : (old && old.url) || null,
      dataId: dataFile.getId(), settings: old && old.settings ? old.settings : (entry.settings || null),
      by: whoOf_(pin), hist: hist
    };
    putEntry_(saved);
    logAct_(pin, entry.origName === '(กรอกในระบบ)' ? (entry.auto ? 'บันทึกอัตโนมัติ' : 'บันทึก (กรอกในระบบ)') : 'อัปโหลดไฟล์ ' + (entry.origName || ''), entry.key);
    return saved;
  });
}
function api_getData(pin, keys) {
  checkPin_(pin);
  var out = {}, list = [];
  (keys || []).forEach(function (key) { var e = getEntry_(key); if (e && e.dataId) list.push({ key: key, id: e.dataId }); });
  // อ่านหลายไฟล์พร้อมกัน (เร็วกว่าอ่านทีละไฟล์) · ไม่สำเร็จ → อ่านแบบปกติ
  try {
    var tok = ScriptApp.getOAuthToken();
    for (var b = 0; b < list.length; b += 15) {
      var part = list.slice(b, b + 15);
      UrlFetchApp.fetchAll(part.map(function (x) { return { url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(x.id) + '?alt=media', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }; }))
        .forEach(function (rs, k) { if (rs.getResponseCode() === 200) out[part[k].key] = rs.getContentText('UTF-8'); });
    }
  } catch (e) { /* ไม่มีสิทธิ์เรียกภายนอก → ใช้ DriveApp */ }
  list.forEach(function (x) {
    if (out[x.key] != null) return;
    try { out[x.key] = DriveApp.getFileById(x.id).getBlob().getDataAsString('UTF-8'); } catch (err) { /* ไฟล์หาย */ }
  });
  return out;
}
function api_saveSettings(pin, key, settingsJson) {
  need_(pin, null);
  return withLock_(function () {
    var e = getEntry_(key);
    if (!e) throw new Error('ไม่พบไฟล์นี้ในระบบ');
    needScope_(pin, null, e.level, e.room, e.slot);
    e.settings = settingsJson ? JSON.parse(settingsJson) : null;
    putEntry_(e);
    return true;
  });
}
// ===== ฉบับก่อนหน้า (ย้อนกลับได้) =====
var HIST_MAX = 5;
/** รายการฉบับก่อนหน้าของวิชา/ห้องนี้ (ใหม่ → เก่า) */
function api_versions(pin, key) {
  var e = getEntry_(key);
  if (!e) return [];
  needScope_(pin, null, e.level, e.room, e.slot);
  return (e.hist || []).map(function (x, i) { return { i: i, at: x.at, by: x.by || '', origName: x.origName || '', fileName: x.fileName || '' }; });
}
/** ย้อนกลับไปใช้ฉบับที่ i · ฉบับปัจจุบันถูกเก็บไว้ในรายการแทน (ย้อนกลับมาได้อีก) */
function api_restore(pin, key, i) {
  need_(pin, 'allowEdit');
  return withLock_(function () {
    var e = getEntry_(key);
    if (!e) throw new Error('ไม่พบข้อมูลนี้ในระบบ');
    needScope_(pin, 'allowEdit', e.level, e.room, e.slot);
    var hist = e.hist || [], v = hist[i];
    if (!v) throw new Error('ไม่พบฉบับที่เลือก');
    hist.splice(i, 1);
    hist.unshift({ dataId: e.dataId, fileId: v.fileId ? e.fileId : null, fileName: e.fileName, origName: e.origName, at: e.uploadedAt || 0, by: e.by || '' });
    e.dataId = v.dataId;
    if (v.fileId) { e.fileId = v.fileId; try { e.url = DriveApp.getFileById(v.fileId).getUrl(); } catch (er) { /* ไม่เป็นไร */ } }
    e.fileName = v.fileName || e.fileName; e.origName = v.origName || e.origName; e.uploadedAt = Date.now(); e.by = whoOf_(pin);
    e.hist = hist.slice(0, HIST_MAX);
    putEntry_(e);
    logAct_(pin, 'ย้อนกลับฉบับก่อนหน้า (' + fmtTh_(v.at) + ')', key);
    return e;
  });
}

// ===== ประวัติการแก้ไข (ใคร ทำอะไร เมื่อไร) — เก็บในไฟล์ log.json ในโฟลเดอร์หลัก (1,500 รายการล่าสุด) =====
var LOG_MAX = 1500;
function whoOf_(pin) {
  var role = roleOf_(pin);
  if (role === 'kru') { var k = kruOf_(pin); return 'ครู' + String(k && k.name || '').replace(/^(นาย|นางสาว|นาง|น\.ส\.)\s*/, ''); }
  return { admin: 'แอดมิน', teacher: 'ระบบโรงเรียน', director: 'ผู้อำนวยการ' }[role] || '';
}
function fmtTh_(t) { if (!t) return '-'; var d = new Date(t); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + (d.getFullYear() + 543) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function logAct_(pin, what, key) {
  try {
    var id = props_().getProperty('LOG_ID'), list = [];
    try { list = JSON.parse(readText_(id) || '[]'); } catch (e) { list = []; }
    list.unshift({ at: Date.now(), by: whoOf_(pin), what: String(what || '').slice(0, 120), key: key || '' });
    if (list.length > LOG_MAX) list.length = LOG_MAX;
    props_().setProperty('LOG_ID', writeText_(rootFolder_(), 'ประวัติการแก้ไข (log).json', id, JSON.stringify(list)));
  } catch (e) { /* บันทึกประวัติไม่ได้ ไม่ให้กระทบงานหลัก */ }
}
/** ประวัติการแก้ไขล่าสุด (ระบบโรงเรียน/แอดมิน/ผอ.) */
function api_log(pin, n) {
  var role = checkPin_(pin);
  if (role === 'kru') throw new Error('ส่วนนี้ใช้ได้เฉพาะระบบโรงเรียน/แอดมิน');
  var list = []; try { list = JSON.parse(readText_(props_().getProperty('LOG_ID')) || '[]'); } catch (e) { list = []; }
  return list.slice(0, Math.min(+n || 300, LOG_MAX));
}
function api_delete(pin, key) {
  need_(pin, 'allowDelete');
  return withLock_(function () {
    var e = getEntry_(key);
    if (e) needScope_(pin, 'allowDelete', e.level, e.room, e.slot);
    if (e) { trashById_(e.fileId); trashById_(e.dataId); (e.hist || []).forEach(function (x) { trashById_(x.fileId); trashById_(x.dataId); }); }
    props_().deleteProperty(PROP_PREFIX + key);
    logAct_(pin, 'ลบ', key);
    return true;
  });
}
function api_clear(pin) {
  noKru_(need_(pin, 'allowDelete'));
  return withLock_(function () {
    allEntries_().forEach(function (e) { trashById_(e.fileId); trashById_(e.dataId); (e.hist || []).forEach(function (x) { trashById_(x.fileId); trashById_(x.dataId); }); props_().deleteProperty(PROP_PREFIX + e.key); });
    logAct_(pin, 'ล้างข้อมูลทั้งหมด', '');
    return true;
  });
}
function api_saveOutput(pin, name, b64, mime) {
  need_(pin, 'allowReport');
  var folder = subFolder_(rootFolder_(), PDF_FOLDER_NAME);
  return folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime || 'application/pdf', safeName_(name))).getUrl();
}

// ===== แม่แบบรูปแบบต้นฉบับ (ปพ.5 ครูหนุ่ม / ปพ.6 ของโรงเรียน) =====
// คีย์แม่แบบ: "pp5|ชั้น|วิชา" / "pp6|ชั้น" (แม่แบบของห้อง/วิชานั้นจากโฟลเดอร์ต้นฉบับ) หรือ "pp5" / "pp6" (ใช้ได้ทุกชั้น)
// ===== ปพ.5 เป็น PDF "รูปแบบไฟล์ Excel ต้นฉบับ" (แปลงไฟล์ผ่าน Google Sheets แล้วส่งออกทีละหน้า) =====
//   ต้องเปิด "บริการ Drive API" ในโปรเจกต์ Apps Script (เมนู บริการ + → Drive API) — ใช้แปลง .xlsm เป็น Google Sheets ชั่วคราว
var XPDF_FOLDER_NAME = '_ไฟล์ชั่วคราว PDF (ลบได้)';
function api_xpdfStart(pin, b64, name) {
  checkPin_(pin);
  if (typeof Drive === 'undefined' || !Drive.Files) throw new Error('NEED_DRIVE_API');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/vnd.ms-excel.sheet.macroEnabled.12', safeName_(name || 'pp5.xlsm'));
  var folder = subFolder_(rootFolder_(), XPDF_FOLDER_NAME);
  var f = Drive.Files.create({ name: 'ชั่วคราว ' + safeName_(name || 'ปพ.5'), mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folder.getId()] }, blob);
  var id = f.id || f.getId && f.getId();
  cache_().put('xpdf:' + id, '1', 3600);
  var sheets = {};
  SpreadsheetApp.openById(id).getSheets().forEach(function (sh) { sheets[sh.getName()] = { gid: sh.getSheetId(), rows: sh.getMaxRows(), cols: sh.getMaxColumns() }; });
  return { id: id, sheets: sheets };
}
/** ส่งออกหลายหน้าพร้อมกัน (เร็วกว่าทีละหน้ามาก): jobs = [{ gid, ranges:[[r1,c1,r2,c2]...], portrait }] → [[b64...], ...] ตามลำดับ */
function xpdfUrl_(id, gid, r, portrait) {
  return 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/export?format=pdf&gid=' + (+gid) +
    '&r1=' + (+r[0]) + '&c1=' + (+r[1]) + '&r2=' + (+r[2]) + '&c2=' + (+r[3]) +
    '&size=A4&portrait=' + (portrait === false ? 'false' : 'true') + '&scale=2&gridlines=false&printtitle=false&sheetnames=false' +
    '&pagenum=UNDEFINED&fzr=false&horizontal_alignment=CENTER&top_margin=0.3&bottom_margin=0.3&left_margin=0.25&right_margin=0.25';
}
function api_xpdfRun(pin, id, jobs) {
  checkPin_(pin);
  if (!cache_().get('xpdf:' + id)) throw new Error('หมดเวลาสร้าง PDF กรุณาลองใหม่');
  var tok = ScriptApp.getOAuthToken(), reqs = [], where = [];
  (jobs || []).slice(0, 40).forEach(function (j, ji) {
    (j.ranges || []).slice(0, 30).forEach(function (r, ri) {
      reqs.push({ url: xpdfUrl_(id, j.gid, r, j.portrait), headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
      where.push([ji, ri]);
    });
  });
  var out = (jobs || []).map(function (j) { return (j.ranges || []).map(function () { return null; }); });
  var todo = reqs.map(function (q, i) { return i; }), BATCH = 6;
  for (var round = 0; round < 6 && todo.length; round++) {
    var next = [];
    for (var b = 0; b < todo.length; b += BATCH) {
      var idx = todo.slice(b, b + BATCH), res = UrlFetchApp.fetchAll(idx.map(function (i) { return reqs[i]; }));
      res.forEach(function (rs, k) {
        var i = idx[k];
        if (rs.getResponseCode() === 200) out[where[i][0]][where[i][1]] = Utilities.base64Encode(rs.getBlob().getBytes());
        else next.push(i);   // ส่งออกถี่เกินไป (429) → ลองใหม่รอบถัดไป
      });
    }
    todo = next;
    if (todo.length) Utilities.sleep(1500 * (round + 1));
  }
  if (todo.length) throw new Error('ส่งออก PDF ไม่สำเร็จ ' + todo.length + ' หน้า (Google ตอบช้า ลองใหม่อีกครั้ง)');
  return out;
}
// เก็บ PDF ที่สร้างแล้วของแต่ละวิชา: ข้อมูลไม่เปลี่ยน (stamp เดิม) → ส่งไฟล์เดิมทันที ไม่ต้องสร้างใหม่
function api_xpdfCacheGet(pin, key, stamp) {
  checkPin_(pin);
  var v = props_().getProperty('xpdfc:' + key);
  if (!v) return null;
  try {
    v = JSON.parse(v);
    if (v.stamp !== String(stamp)) return null;
    var f = DriveApp.getFileById(v.fileId);
    if (f.isTrashed()) return null;
    return { name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()), url: f.getUrl() };
  } catch (e) { return null; }
}
function api_xpdfCachePut(pin, key, stamp, b64, name) {
  checkPin_(pin);
  var folder = subFolder_(rootFolder_(), PDF_FOLDER_NAME);
  var old = props_().getProperty('xpdfc:' + key);
  var f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', safeName_(name)));
  if (old) try { trashById_(JSON.parse(old).fileId); } catch (e) {}
  props_().setProperty('xpdfc:' + key, JSON.stringify({ stamp: String(stamp), fileId: f.getId() }));
  return f.getUrl();
}
/** ส่งออกหลายช่วงของชีตเดียว: ranges = [[r1,c1,r2,c2], ...] (เริ่ม 0, ไม่รวมตัวท้าย) → PDF base64 ทีละช่วง */
function api_xpdfPart(pin, id, gid, ranges, portrait) {
  checkPin_(pin);
  if (!cache_().get('xpdf:' + id)) throw new Error('หมดเวลาสร้าง PDF กรุณาลองใหม่');
  var tok = ScriptApp.getOAuthToken(), out = [];
  (ranges || []).slice(0, 30).forEach(function (r) {
    var url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/export?format=pdf&gid=' + (+gid) +
      '&r1=' + (+r[0]) + '&c1=' + (+r[1]) + '&r2=' + (+r[2]) + '&c2=' + (+r[3]) +
      '&size=A4&portrait=' + (portrait === false ? 'false' : 'true') + '&scale=2&gridlines=false&printtitle=false&sheetnames=false' +
      '&pagenum=UNDEFINED&fzr=false&horizontal_alignment=CENTER&top_margin=0.3&bottom_margin=0.3&left_margin=0.25&right_margin=0.25';
    var res = null;
    for (var t = 0; t < 5; t++) {
      res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
      if (res.getResponseCode() === 200) break;
      Utilities.sleep(1200 * (t + 1));   // ส่งออกถี่เกินไป (429) → รอแล้วลองใหม่
    }
    if (res.getResponseCode() !== 200) throw new Error('ส่งออก PDF ไม่สำเร็จ (รหัส ' + res.getResponseCode() + ')');
    out.push(Utilities.base64Encode(res.getBlob().getBytes()));
  });
  return out;
}
/** ฟอนต์ TH Sarabun New ที่ผู้ใช้อัปโหลดไว้ใน Google Drive (ไฟล์ THSarabunNew.ttf / THSarabunNew Bold.ttf) */
function api_fontTTF(pin) {
  checkPin_(pin);
  function get(name) {
    var it = DriveApp.getFilesByName(name);
    while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return Utilities.base64Encode(f.getBlob().getBytes()); }
    return null;
  }
  return { regular: get('THSarabunNew.ttf'), bold: get('THSarabunNew Bold.ttf') };
}
/** อ่าน Google Sheets ทั้งไฟล์เป็น .xlsx (base64) — ใช้นำเข้าคะแนนสอบทั้งโรงเรียน (ระบบโรงเรียน/แอดมิน) */
function api_sheetXlsx(pin, id) {
  noKru_(need_(pin));
  id = String(id || '');
  var m = id.match(/\/d\/([A-Za-z0-9_\-]{20,})/); if (m) id = m[1];
  if (!/^[A-Za-z0-9_\-]{20,}$/.test(id)) throw new Error('ลิงก์ Google Sheets ไม่ถูกต้อง');
  var r = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('เปิดไฟล์ไม่ได้ (รหัส ' + r.getResponseCode() + ') — ตรวจว่าบัญชีที่ติดตั้งระบบเปิดไฟล์นี้ได้');
  return Utilities.base64Encode(r.getContent());
}
function api_xpdfEnd(pin, id) {
  checkPin_(pin);
  if (cache_().get('xpdf:' + id)) { trashById_(id); cache_().remove('xpdf:' + id); }
  return true;
}

var TPL_KEY_RE = /^pp[56](\|\d{1,2}(\|[A-Za-z0-9_\-]{1,40})?)?$/;
function tplInfo_() {
  var all = props_().getProperties(), out = {};
  if (all.TPL_INFO) { try { var old = JSON.parse(all.TPL_INFO); Object.keys(old).forEach(function (k) { out[k] = old[k]; }); } catch (e) {} }
  Object.keys(all).forEach(function (k) { if (k.indexOf('tpl:') === 0) { try { out[k.slice(4)] = JSON.parse(all[k]); } catch (e) {} } });
  return out;
}
function api_templateInfo(pin) {
  checkPin_(pin);
  var info = tplInfo_(), out = {};
  Object.keys(info).forEach(function (k) { out[k] = { name: info[k].name, savedAt: info[k].savedAt }; });
  return out;
}
function api_getTemplate(pin, kind) {
  checkPin_(pin);
  var t = tplInfo_()[kind];
  if (!t) return null;
  try { return { name: t.name, b64: Utilities.base64Encode(DriveApp.getFileById(t.fileId).getBlob().getBytes()) }; } catch (e) { return null; }
}
function api_saveTemplate(pin, kind, b64, name) {
  noKru_(need_(pin, null));
  if (!TPL_KEY_RE.test(String(kind))) throw new Error('ชนิดแม่แบบไม่ถูกต้อง');
  return withLock_(function () {
    var old = tplInfo_()[kind];
    var folder = subFolder_(rootFolder_(), TPL_FOLDER_NAME);
    var ext = kind.indexOf('pp5') === 0 ? '.xlsm' : '.xlsx';
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/octet-stream', 'แม่แบบ ' + kind.replace('pp5', 'ปพ.5').replace('pp6', 'ปพ.6').replace(/\|/g, ' ') + ext));
    if (old && old.fileId) trashById_(old.fileId);
    props_().setProperty('tpl:' + kind, JSON.stringify({ fileId: file.getId(), name: String(name || '').slice(0, 200), savedAt: Date.now() }));
    return true;
  });
}

// ===== ไฟล์ต้นฉบับของโรงเรียน (อ่านอย่างเดียว ไม่สร้าง/แก้ไขอะไรในโฟลเดอร์นี้) =====
// ใช้เป็นแม่แบบรูปแบบต้นฉบับของแต่ละห้อง/วิชาโดยอัตโนมัติ
function api_sourceList(pin) {
  checkPin_(pin);
  var c = cache_().get('srcList');
  if (c) return JSON.parse(c);
  var out = [];
  function walk(folder, path, depth) {
    var files = folder.getFiles();
    while (files.hasNext() && out.length < 400) {
      var f = files.next(), n = f.getName();
      if (/\.xls[xm]$/i.test(n)) var up = 0; try { up = f.getLastUpdated().getTime(); } catch (e) {}
        out.push({ id: f.getId(), name: n, path: path, size: f.getSize(), updated: up });
    }
    if (depth > 4) return;
    var subs = folder.getFolders();
    while (subs.hasNext()) { var s = subs.next(); walk(s, path ? path + '/' + s.getName() : s.getName(), depth + 1); }
  }
  var okAny = false;
  SOURCE_FOLDER_IDS.forEach(function (fid) {
    try { var f = DriveApp.getFolderById(fid); walk(f, f.getName(), 0); okAny = true; } catch (e) { /* เปิดโฟลเดอร์นี้ไม่ได้ ข้ามไป */ }
  });
  if (!okAny) throw new Error('เปิดโฟลเดอร์ไฟล์ต้นฉบับไม่ได้ กรุณาตรวจสิทธิ์การเข้าถึง');
  // ไฟล์ปีล่าสุดมาก่อน (ใช้ตัวชี้วัดชุดใหม่ที่สุด)
  out.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  try { cache_().put('srcList', JSON.stringify(out), 21600); } catch (e) {}
  return out;
}
function api_clearSourceCache(pin) {
  if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก');
  try { cache_().remove('srcList'); } catch (e) {}
  return api_sourceList(pin).length;
}
function api_sourceFile(pin, id) {
  checkPin_(pin);
  var list = api_sourceList(pin), hit = list.filter(function (x) { return x.id === id; })[0];
  if (!hit) throw new Error('ไม่พบไฟล์นี้ในโฟลเดอร์ต้นฉบับ');
  return { name: hit.name, b64: Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()) };
}

// ===== โลโก้โรงเรียน + ลายเซ็น ผอ./รอง ผอ. (ผู้ดูแลตั้งครั้งเดียว ใช้ทุกห้อง) และลายเซ็นครู =====
var IMG_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/;
function sigFolder_() { return subFolder_(rootFolder_(), SIG_FOLDER_NAME); }
function brand_() { try { return JSON.parse(props_().getProperty('BRAND') || '{}'); } catch (e) { return {}; } }
function saveImg_(name, oldId, dataUrl) {
  if (dataUrl === null) { trashById_(oldId); return null; }        // ลบรูป
  if (dataUrl === undefined) return oldId || null;                  // ไม่เปลี่ยน
  if (!IMG_RE.test(dataUrl) || dataUrl.length > 1500000) throw new Error('ไฟล์รูปไม่ถูกต้องหรือใหญ่เกินไป');
  return writeText_(sigFolder_(), name, oldId, dataUrl);
}
function api_getBrand(pin) {
  checkPin_(pin);
  var b = brand_(), out = { school: b.school || '' };
  out.logo = readText_(b.logoId);
  ['director', 'deputy'].forEach(function (k) { var x = b[k] || {}; out[k] = { name: x.name || '', position: x.position || '', img: readText_(x.imgId) }; });
  return out;
}
function api_saveBrand(pin, json) {
  if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก');
  var v = JSON.parse(json || '{}');
  return withLock_(function () {
    var b = brand_();
    if (v.school != null) b.school = String(v.school).slice(0, 120);
    b.logoId = saveImg_('logo.txt', b.logoId, v.logo);
    ['director', 'deputy'].forEach(function (k) {
      var x = b[k] = b[k] || {}, y = v[k] || {};
      if (y.name != null) x.name = String(y.name).slice(0, 120);
      if (y.position != null) x.position = String(y.position).slice(0, 160);
      x.imgId = saveImg_(k + '.txt', x.imgId, y.img);
    });
    props_().setProperty('BRAND', JSON.stringify(b));
    if (b.logoId) props_().setProperty('PUB_LOGO_ID', b.logoId);   // โลโก้หน้าประกาศผลใช้โลโก้เดียวกัน
    return true;
  });
}
function sigs_() { try { return JSON.parse(props_().getProperty('SIGS') || '{}'); } catch (e) { return {}; } }
function api_getSigs(pin) {
  checkPin_(pin);
  var m = sigs_(), out = {};
  Object.keys(m).forEach(function (k) { var t = readText_(m[k].id); if (t) out[k] = { img: t, at: m[k].at }; });
  return out;
}
function api_saveSig(pin, name, dataUrl) {
  need_(pin, 'allowSignature');
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 120) throw new Error('กรุณาใส่ชื่อครู');
  return withLock_(function () {
    var m = sigs_(), old = m[name];
    var id = saveImg_('ลายเซ็น ' + safeName_(name) + '.txt', old && old.id, dataUrl === null ? null : dataUrl);
    if (id) m[name] = { id: id, at: Date.now() }; else delete m[name];
    props_().setProperty('SIGS', JSON.stringify(m));
    return true;
  });
}

// ===== คลังตัวชี้วัดที่ระบบเรียนรู้จากไฟล์ ปพ.5 ที่ครูอัปโหลด (ชั้น|วิชา → ตัวชี้วัด มาตรฐาน) =====
function lib_() { var t = readText_(props_().getProperty('LIB_ID')); try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; } }
function api_getLib(pin) { checkPin_(pin); return lib_(); }
function api_saveLib(pin, key, json) {
  if (checkPin_(pin) === 'director') return false;
  if (!/^\d{1,2}\|[A-Za-z0-9_\-]{1,40}$/.test(String(key))) throw new Error('คีย์คลังไม่ถูกต้อง');
  var v = JSON.parse(json || 'null');
  if (!v || !v.indicators || !v.indicators.length || json.length > 200000) throw new Error('ข้อมูลตัวชี้วัดไม่ถูกต้อง');
  return withLock_(function () {
    var all = lib_(); all[key] = v;
    props_().setProperty('LIB_ID', writeText_(subFolder_(rootFolder_(), DATA_FOLDER_NAME), 'library.json', props_().getProperty('LIB_ID'), JSON.stringify(all)));
    return true;
  });
}

// ===== ทะเบียนรายชื่อนักเรียน (ไฟล์ Word) — เก็บทุกฉบับไว้เป็นประวัติ ใช้ฉบับล่าสุด =====
function api_saveRoster(pin, b64, fileName, dataJson, dateText) {
  noKru_(need_(pin, 'allowRoster'));
  return withLock_(function () {
    var folder = subFolder_(rootFolder_(), ROSTER_FOLDER_NAME);
    var name = (dateText ? 'ข้อมูล ' + safeName_(dateText) + ' - ' : '') + safeName_(fileName);
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name));
    var old = props_().getProperty('ROSTER') ? JSON.parse(props_().getProperty('ROSTER')) : {};
    var dataId = writeText_(subFolder_(rootFolder_(), DATA_FOLDER_NAME), 'roster.json', old.dataId, dataJson);
    var info = { fileId: file.getId(), url: file.getUrl(), fileName: fileName, dataId: dataId, uploadedAt: Date.now() };
    props_().setProperty('ROSTER', JSON.stringify(info));
    try { cache_().remove('rosterIdx'); } catch (e) {}
    return info;
  });
}
function api_getRoster(pin) {
  checkPin_(pin);
  var v = props_().getProperty('ROSTER');
  if (!v) return null;
  var info = JSON.parse(v);
  var t = readText_(info.dataId);
  return t ? { fileName: info.fileName, url: info.url, uploadedAt: info.uploadedAt, data: t } : null;
}

// ===== ประกาศผล =====
function getCfg_() {
  var v = props_().getProperty('PUBLIC_CFG');
  var cfg = v ? JSON.parse(v) : {};
  cfg.title = cfg.title || 'ประกาศผลการเรียน';
  cfg.verify = cfg.verify || 'id';
  cfg.years = cfg.years || {};
  return cfg;
}
function pubFolder_() { return subFolder_(rootFolder_(), PUB_FOLDER_NAME); }
function readIndex_() {
  var t = readText_(props_().getProperty('PUB_INDEX_ID'));
  var idx = t ? JSON.parse(t) : {};
  idx.ids = idx.ids || {}; idx.classes = idx.classes || {};
  return idx;
}
function saveIndex_(idx) {
  var id = writeText_(pubFolder_(), 'index.json', props_().getProperty('PUB_INDEX_ID'), JSON.stringify(idx));
  props_().setProperty('PUB_INDEX_ID', id);
}

/** เผยแพร่ข้อมูลผลการเรียนของหนึ่งห้อง (pubJson = ผลรายคนที่หน้าเว็บรวบรวมแล้ว) */
function api_publish(pin, key, pubJson) {
  if (checkPin_(pin) !== 'admin') throw new Error('การอัปเดตหน้าประกาศผลทำได้ที่ระบบแอดมิน');
  return withLock_(function () {
    var pub = JSON.parse(pubJson);
    if (pub.logo) {
      if (!props_().getProperty('PUB_LOGO_ID')) props_().setProperty('PUB_LOGO_ID', writeText_(pubFolder_(), 'logo.txt', null, pub.logo));
      delete pub.logo;
    }
    var idx = readIndex_(), old = idx.classes[key];
    var fileId = writeText_(pubFolder_(), safeName_(key) + '.json', old && old.fileId, JSON.stringify(pub));
    Object.keys(idx.ids).forEach(function (id) {
      idx.ids[id] = idx.ids[id].filter(function (k) { return k !== key; });
      if (!idx.ids[id].length) delete idx.ids[id];
    });
    pub.students.forEach(function (s) { (idx.ids[s.id] = idx.ids[s.id] || []).push(key); });
    idx.classes[key] = {
      fileId: fileId, year: pub.year, className: pub.className, count: pub.students.length, updatedAt: Date.now(),
      mid: pub.students.filter(function (s) { return s.mid; }).length, final: pub.students.filter(function (s) { return s.final; }).length
    };
    saveIndex_(idx);
    return idx.classes[key];
  });
}
function api_unpublish(pin, key) {
  if (checkPin_(pin) !== 'admin') throw new Error('การอัปเดตหน้าประกาศผลทำได้ที่ระบบแอดมิน');
  return withLock_(function () {
    var idx = readIndex_(), old = idx.classes[key];
    if (!old) return true;
    trashById_(old.fileId);
    delete idx.classes[key];
    Object.keys(idx.ids).forEach(function (id) {
      idx.ids[id] = idx.ids[id].filter(function (k) { return k !== key; });
      if (!idx.ids[id].length) delete idx.ids[id];
    });
    saveIndex_(idx);
    return true;
  });
}
function api_publicStatus(pin) { checkPin_(pin); return readIndex_().classes; }
function api_getPublicCfg(pin) {
  checkPin_(pin);
  var cfg = getCfg_();
  var u = webUrl_();
  cfg.url = u ? u.replace(/\?.*$/, '') : '';
  return cfg;
}
function api_savePublicCfg(pin, cfgJson) {
  noKru_(need_(pin, 'allowPublish'));
  var cfg = JSON.parse(cfgJson);
  delete cfg.url;
  props_().setProperty('PUBLIC_CFG', JSON.stringify(cfg));
  return true;
}

// ===== API หน้าสาธารณะ (ไม่ต้องใช้รหัสผ่าน) =====
function api_publicInfo() {
  var fl = flags_();
  if (!fl.publicOpen) return { closed: true, title: getCfg_().title, school: getCfg_().school || '', adminUrl: adminUrl_(), superUrl: superUrl_(), pinLen: api_pinInfo() };
  var cfg = getCfg_(), idx = readIndex_(), years = {};
  Object.keys(idx.classes).forEach(function (k) { years[idx.classes[k].year] = 1; });
  var u = webUrl_();
  return {
    title: cfg.title, school: cfg.school || '', announcement: cfg.announcement || '', verify: cfg.verify,
    years: Object.keys(years).sort().reverse().map(function (y) { var v = cfg.years[y] || { mid: true, final: true }; return { year: +y, mid: !!v.mid && fl.showMid, final: !!v.final && fl.showFinal }; }),
    logo: readText_(props_().getProperty('PUB_LOGO_ID')),
    adminUrl: adminUrl_(), superUrl: superUrl_(), pinLen: api_pinInfo(), curYear: curYear_()
  };
}
function adminUrl_() { var u = webUrl_(); return u ? u.replace(/\?.*$/, '') + '?page=admin' : ''; }
function superUrl_() { var u = webUrl_(); return u ? u.replace(/\?.*$/, '') + '?page=super' : ''; }

/** ค้นหาผลของนักเรียน 1 คน (คืนเฉพาะข้อมูลของคนนั้น ไม่คืนทั้งห้อง) */
function api_lookup(id, code) {
  id = String(id || '').replace(/\s+/g, '');
  code = String(code || '').replace(/\D/g, '');
  if (!id || id.length > 20) return { notFound: true };
  var c = cache_(), fk = 'rlf:' + id, fails = +(c.get(fk) || 0);
  if (fails >= 8) throw new Error('TRY_LATER');
  var gk = 'rlg:' + Math.floor(Date.now() / 60000), g = +(c.get(gk) || 0);
  if (g > 600) throw new Error('TRY_LATER');
  c.put(gk, String(g + 1), 120);
  var fl = flags_();
  if (!fl.publicOpen) throw new Error('CLOSED');
  var r = timeline_(id, { code: code, publicView: true });
  if (!r) { c.put(fk, String(fails + 1), 600); return { notFound: true }; }
  return r;
}
/** ประวัติผลการเรียนทุกปี (สำหรับครู/แอดมิน ไม่ต้องยืนยันเลขบัตร) */
function api_studentHistory(pin, id) {
  checkPin_(pin);
  id = String(id || '').replace(/\s+/g, '');
  return timeline_(id, { publicView: false }) || { notFound: true };
}

/**
 * ไทม์ไลน์ผลการเรียนของนักเรียน: ปีปัจจุบัน → ย้อนไปถึงตอน ป.1
 *   ปีที่มีผลในระบบ = ผลจริง · ปีที่ครู/แอดมินเพิ่มผลจากโรงเรียนอื่น = external · ไม่มีทั้งคู่ = missing (ไม่ได้เรียนที่โรงเรียนนี้)
 */
function timeline_(id, o) {
  var fl = flags_(), cfg = getCfg_(), idx = readIndex_(), years = [], who = null, verified = !o.publicView || cfg.verify !== 'id+nid4';
  var ext = external_()[id] || {};
  (idx.ids[id] || []).forEach(function (key) {
    var meta = idx.classes[key];
    if (!meta) return;
    var yc0 = cfg.years[meta.year] || { mid: true, final: true };
    var yc = o.publicView ? { mid: yc0.mid && fl.showMid, final: yc0.final && fl.showFinal } : { mid: true, final: true };
    if (!yc.mid && !yc.final) return;
    var t = readText_(meta.fileId);
    if (!t) return;
    var pub = JSON.parse(t), s = null;
    for (var i = 0; i < pub.students.length; i++) if (String(pub.students[i].id) === id) { s = pub.students[i]; break; }
    if (!s) return;
    if (o.publicView && cfg.verify === 'id+nid4') { if (!s.nid4 || o.code !== String(s.nid4)) return; verified = true; }
    who = who || s;
    var lv = +String(key).split('|')[1] || pub.level;
    years.push({ year: +pub.year, level: lv, className: pub.className, no: s.no, school: pub.school, mid: yc.mid ? s.mid : null, final: yc.final ? s.final : null, updatedAt: meta.updatedAt || null });
  });
  var rs = rosterStudent_(id);
  if (rs && o.publicView && cfg.verify === 'id+nid4') { if (rs.s.nid4 && o.code === String(rs.s.nid4)) verified = true; else if (!years.length) rs = null; }
  if (rs && !who) who = { name: ((rs.s.prefix || '') + (rs.s.first || '') + ' ' + (rs.s.last || '')).trim(), first: rs.s.first || '' };
  if (!who || !verified) return null;
  // ตำแหน่งอ้างอิง: ชั้นปัจจุบันจากทะเบียน หรือปีล่าสุดที่มีผล
  var cur = curYear_(), have = {};
  years.forEach(function (y) { have[y.year] = y; });
  var anchor = rs && rs.c.stage !== 'อ' ? { year: +rs.c.year, level: +rs.c.level, room: rs.c.room } : null;
  if (!anchor && years.length) { var lt = years.slice().sort(function (a, b) { return b.year - a.year; })[0]; anchor = { year: lt.year, level: lt.level }; }
  if (anchor && anchor.level >= 1 && anchor.level <= 6) {
    var first = anchor.year - (anchor.level - 1), last = Math.min(Math.max(anchor.year, cur), anchor.year + (6 - anchor.level));
    for (var y = first; y <= last; y++) {
      var lv = anchor.level - (anchor.year - y);
      if (lv < 1 || lv > 6 || have[y]) continue;
      if (y > cur && !(rs && y === anchor.year)) continue;   // ไม่แสดงปีอนาคต (ยกเว้นปีของทะเบียนรายชื่อ)
      if (ext[y]) years.push({ year: y, level: lv, className: ext[y].className || ('ประถมศึกษาปีที่ ' + lv), school: ext[y].school || '', external: ext[y] });
      else if (y === anchor.year && rs) years.push({ year: y, level: lv, className: 'ประถมศึกษาปีที่ ' + lv + '/' + rs.c.room, no: rs.s.no, school: cfg.school || '', mid: null, final: null, pending: true });
      else years.push({ year: y, level: lv, className: 'ประถมศึกษาปีที่ ' + lv, missing: true, school: cfg.school || 'โรงเรียนวัดทุ่งแฝก' });
    }
  }
  // ผลจากโรงเรียนอื่นในปีที่อยู่นอกช่วง (เช่น ย้ายมาตอน ป.4 แต่ครูเพิ่มผล ป.3 จากโรงเรียนเดิม)
  Object.keys(ext).forEach(function (y) { y = +y; if (!years.some(function (x) { return x.year === y; })) years.push({ year: y, level: ext[y].level, className: ext[y].className || '', school: ext[y].school || '', external: ext[y] }); });
  years.sort(function (a, b) { return b.year - a.year; });
  return { id: id, name: who.name, first: who.first, years: years, curYear: cur };
}

// ===== ผลการเรียนจากโรงเรียนอื่น (นักเรียนย้ายเข้า) — ครู/แอดมินเพิ่มได้ =====
function external_() { var t = readText_(props_().getProperty('EXT_ID')); try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; } }
function api_saveExternal(pin, id, year, json) {
  need_(pin, 'allowEdit');
  id = String(id || '').replace(/\s+/g, ''); year = +year;
  if (!id || !(year > 2500 && year < 2700)) throw new Error('ข้อมูลไม่ถูกต้อง');
  var v = json ? JSON.parse(json) : null;
  if (v && JSON.stringify(v).length > 20000) throw new Error('ข้อมูลยาวเกินไป');
  return withLock_(function () {
    var all = external_(), m = all[id] || {};
    if (v) { v.savedAt = Date.now(); m[year] = v; } else delete m[year];
    if (Object.keys(m).length) all[id] = m; else delete all[id];
    props_().setProperty('EXT_ID', writeText_(subFolder_(rootFolder_(), DATA_FOLDER_NAME), 'external.json', props_().getProperty('EXT_ID'), JSON.stringify(all)));
    return true;
  });
}

// ===== ปีการศึกษาปัจจุบัน: ตามวันที่ (เปิดภาคเรียน พ.ค.) หรือที่แอดมินตั้ง =====
// ===== วันเปิด-ปิดภาคเรียน (แอดมินกำหนดรายปี) → ครูเลือกวันที่สอน ระบบคิดชั่วโมงให้ =====
//   { "2569": { t1: { s: "2026-05-16", e: "2026-10-10" }, t2: { s, e }, off: ["2026-07-28", ...] } }
function terms_() { try { return JSON.parse(props_().getProperty('TERMS') || '{}'); } catch (e) { return {}; } }
function api_getTerms(pin) { checkPin_(pin); return terms_(); }
function api_saveTerms(pin, year, json) {
  if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก');
  var all = terms_(), v = json ? JSON.parse(json) : null, ok = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); };
  if (!v) delete all[year];
  else all[+year] = { t1: { s: ok(v.t1 && v.t1.s) ? v.t1.s : '', e: ok(v.t1 && v.t1.e) ? v.t1.e : '' }, t2: { s: ok(v.t2 && v.t2.s) ? v.t2.s : '', e: ok(v.t2 && v.t2.e) ? v.t2.e : '' }, off: (v.off || []).filter(ok).slice(0, 120) };
  props_().setProperty('TERMS', JSON.stringify(all));
  return all;
}
function curYear_() {
  var v = +props_().getProperty('CUR_YEAR');
  if (v > 2500) return v;
  var now = new Date(), y = +Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy') + 543, m = +Utilities.formatDate(now, 'Asia/Bangkok', 'M');
  return m < 5 ? y - 1 : y;
}
function api_setCurYear(pin, year) {
  if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก');
  year = +year;
  if (year && !(year > 2500 && year < 2700)) throw new Error('ปีไม่ถูกต้อง');
  if (year) props_().setProperty('CUR_YEAR', String(year)); else props_().deleteProperty('CUR_YEAR');
  return curYear_();
}

// ===== ที่เก็บไฟล์ใน Drive (แสดงเฉพาะหน้าแอดมิน) =====
function api_folderLinks(pin) {
  if (checkPin_(pin) !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบหลัก');
  var root = rootFolder_(), out = { root: root.getUrl(), years: [], other: [] };
  var it = root.getFolders();
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (/^ปีการศึกษา /.test(n)) {
      var y = { name: n, url: f.getUrl(), classes: [] }, ci = f.getFolders();
      while (ci.hasNext()) { var cf = ci.next(); y.classes.push({ name: cf.getName(), url: cf.getUrl() }); }
      y.classes.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      out.years.push(y);
    } else out.other.push({ name: n, url: f.getUrl() });
  }
  out.years.sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  return out;
}
/** ไฟล์ Excel เดิมของห้อง/วิชา (ใช้เป็นฐานเมื่อกรอกในระบบแล้วดาวน์โหลด — ข้อมูลใหม่ทับลงไฟล์เดิม) */
function api_getFile(pin, key) {
  checkPin_(pin);
  var e = getEntry_(key);
  if (!e || !e.fileId) return null;
  try { var f = DriveApp.getFileById(e.fileId); return { name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()) }; } catch (er) { return null; }
}

function rosterStudent_(id) {
  var c = cache_(), t = c.get('rosterIdx');
  if (!t) {
    var v = props_().getProperty('ROSTER');
    if (!v) return null;
    var d = JSON.parse(readText_(JSON.parse(v).dataId) || '{}'), m = {};
    (d.classes || []).forEach(function (cl) {
      (cl.students || []).forEach(function (s) {
        if (s.id) m[s.id] = { s: { no: s.no, prefix: s.prefix, first: s.first, last: s.last, nid4: s.nid4 }, c: { year: cl.year || d.year, level: cl.level, room: cl.room, stage: cl.stage } };
      });
    });
    t = JSON.stringify(m);
    try { c.put('rosterIdx', t, 600); } catch (e) {}
  }
  return JSON.parse(t)[id] || null;
}

/** เรียกครั้งแรกจากหน้าแก้ไขสคริปต์ เพื่ออนุญาตสิทธิ์ และตรวจโฟลเดอร์หลัก */
function setup() {
  var f = rootFolder_();
  subFolder_(f, DATA_FOLDER_NAME);
  subFolder_(f, PUB_FOLDER_NAME);
  subFolder_(f, PDF_FOLDER_NAME);
  Logger.log('พร้อมใช้งาน โฟลเดอร์หลัก: ' + f.getName() + ' ' + f.getUrl());
}
