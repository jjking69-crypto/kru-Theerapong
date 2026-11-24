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
  if (role !== 'admin' && flag && !flags_()[flag]) throw new Error('ปิดใช้งาน: ' + FLAG_DEFS[flag] + ' (ผู้ดูแลระบบปิดไว้)');
  return role;
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
  return { ok: true, rootUrl: role === 'admin' ? root.getUrl() : null, role: role, flags: flags_(), flagDefs: FLAG_DEFS, publicUrl: webUrl_(), curYear: curYear_(), curYearFixed: !!props_().getProperty('CUR_YEAR') };
}
/** จำนวนหลักของรหัส (ให้แป้นกดแสดงจุดครบ) — ไม่บอกตัวรหัส */
function api_pinInfo() { return { teacher: String(TEACHER_PIN || '').length, admin: String(ADMIN_PIN || '').length }; }
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
  need_(pin, entry && entry.origName === '(กรอกในระบบ)' ? 'allowEdit' : 'allowUpload');
  if (!entry || !entry.key) throw new Error('ข้อมูลไม่ครบ');
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
  var out = {};
  (keys || []).forEach(function (key) {
    var e = getEntry_(key);
    if (!e || !e.dataId) return;
    try { out[key] = DriveApp.getFileById(e.dataId).getBlob().getDataAsString('UTF-8'); } catch (err) { /* ไฟล์หาย */ }
  });
  return out;
}
function api_saveSettings(pin, key, settingsJson) {
  checkPin_(pin);
  return withLock_(function () {
    var e = getEntry_(key);
    if (!e) throw new Error('ไม่พบไฟล์นี้ในระบบ');
    e.settings = settingsJson ? JSON.parse(settingsJson) : null;
    putEntry_(e);
    return true;
  });
}
function api_delete(pin, key) {
  need_(pin, 'allowDelete');
  return withLock_(function () {
    var e = getEntry_(key);
    if (e) { trashById_(e.fileId); trashById_(e.dataId); }
    props_().deleteProperty(PROP_PREFIX + key);
    return true;
  });
}
function api_clear(pin) {
  need_(pin, 'allowDelete');
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

// ===== แม่แบบรูปแบบต้นฉบับ (ปพ.5 ครูหนุ่ม / ปพ.6 ของโรงเรียน) =====
// คีย์แม่แบบ: "pp5|ชั้น|วิชา" / "pp6|ชั้น" (แม่แบบของห้อง/วิชานั้นจากโฟลเดอร์ต้นฉบับ) หรือ "pp5" / "pp6" (ใช้ได้ทุกชั้น)
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
  checkPin_(pin);
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
