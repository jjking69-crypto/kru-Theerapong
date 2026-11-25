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
    if (old) { if (file) trashById_(old.fileId); trashById_(old.dataId); }
    var saved = {
      key: entry.key, year: entry.year, level: entry.level, room: entry.room, stage: entry.stage || 'ป',
      slot: entry.slot, fileName: entry.fileName, origName: entry.origName, size: entry.size,
      uploadedAt: entry.uploadedAt || Date.now(), school: entry.school || '',
      fileId: file ? file.getId() : (old && old.fileId) || null, url: file ? file.getUrl() : (old && old.url) || null,
      dataId: dataFile.getId(), settings: old && old.settings ? old.settings : (entry.settings || null)
    };
    putEntry_(saved);
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
function api_delete(pin, key) {
  need_(pin, 'allowDelete');
  return withLock_(function () {
    var e = getEntry_(key);
    if (e) needScope_(pin, 'allowDelete', e.level, e.room, e.slot);
    if (e) { trashById_(e.fileId); trashById_(e.dataId); }
    props_().deleteProperty(PROP_PREFIX + key);
    return true;
  });
}
function api_clear(pin) {
  noKru_(need_(pin, 'allowDelete'));
  return withLock_(function () {
    allEntries_().forEach(function (e) { trashById_(e.fileId); trashById_(e.dataId); props_().deleteProperty(PROP_PREFIX + e.key); });
    return true;
  });
}
function api_saveOutput(pin, name, b64, mime) {
  need_(pin, 'allowReport');
  var folder = subFolder_(rootFolder_(), PDF_FOLDER_NAME);
  return folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime || 'application/pdf', safeName_(name))).getUrl();
}
