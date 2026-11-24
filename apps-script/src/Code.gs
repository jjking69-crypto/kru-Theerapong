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
  return { ok: true, rootUrl: root.getUrl(), role: role, flags: flags_(), flagDefs: FLAG_DEFS, publicUrl: webUrl_() };
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
      if (/\.xls[xm]$/i.test(n)) out.push({ id: f.getId(), name: n, path: path, size: f.getSize() });
    }
    if (depth > 4) return;
    var subs = folder.getFolders();
    while (subs.hasNext()) { var s = subs.next(); walk(s, path ? path + '/' + s.getName() : s.getName(), depth + 1); }
  }
  try { walk(DriveApp.getFolderById(SOURCE_FOLDER_ID), '', 0); } catch (e) { throw new Error('เปิดโฟลเดอร์ไฟล์ต้นฉบับไม่ได้ (SOURCE_FOLDER_ID) กรุณาตรวจสิทธิ์การเข้าถึง'); }
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
  checkPin_(pin);
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
  need_(pin, 'allowRoster');
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
  need_(pin, 'allowPublish');
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
  need_(pin, 'allowPublish');
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
  need_(pin, 'allowPublish');
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
    adminUrl: adminUrl_(), superUrl: superUrl_(), pinLen: api_pinInfo()
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
  var cfg = getCfg_(), idx = readIndex_(), years = [], who = null;
  (idx.ids[id] || []).forEach(function (key) {
    var meta = idx.classes[key];
    if (!meta) return;
    var yc0 = cfg.years[meta.year] || { mid: true, final: true }, yc = { mid: yc0.mid && fl.showMid, final: yc0.final && fl.showFinal };
    if (!yc.mid && !yc.final) return;
    var t = readText_(meta.fileId);
    if (!t) return;
    var pub = JSON.parse(t), s = null;
    for (var i = 0; i < pub.students.length; i++) if (String(pub.students[i].id) === id) { s = pub.students[i]; break; }
    if (!s) return;
    if (cfg.verify === 'id+nid4' && (!s.nid4 || code !== String(s.nid4))) return;
    who = who || s;
    years.push({ year: pub.year, className: pub.className, no: s.no, school: pub.school, mid: yc.mid ? s.mid : null, final: yc.final ? s.final : null });
  });
  if (!years.length) {
    // ยังไม่มีผลที่ประกาศ แต่มีชื่อในทะเบียนนักเรียน: แสดงข้อมูลนักเรียนพร้อมสถานะ "รอประกาศผล" (ไม่ขึ้นว่าไม่พบ)
    var rs = rosterStudent_(id);
    if (rs && !(cfg.verify === 'id+nid4' && (!rs.s.nid4 || code !== String(rs.s.nid4)))) {
      who = { name: ((rs.s.prefix || '') + (rs.s.first || '') + ' ' + (rs.s.last || '')).trim(), first: rs.s.first || '' };
      years.push({ year: rs.c.year, className: 'ประถมศึกษาปีที่ ' + rs.c.level + '/' + rs.c.room, no: rs.s.no, school: cfg.school || '', mid: null, final: null, pending: true });
    }
  }
  if (!years.length) { c.put(fk, String(fails + 1), 600); return { notFound: true }; }
  return { id: id, name: who.name, first: who.first, years: years };
}

function rosterStudent_(id) {
  var c = cache_(), t = c.get('rosterIdx');
  if (!t) {
    var v = props_().getProperty('ROSTER');
    if (!v) return null;
    var d = JSON.parse(readText_(JSON.parse(v).dataId) || '{}'), m = {};
    (d.classes || []).forEach(function (cl) {
      (cl.students || []).forEach(function (s) {
        if (s.id) m[s.id] = { s: { no: s.no, prefix: s.prefix, first: s.first, last: s.last, nid4: s.nid4 }, c: { year: cl.year || d.year, level: cl.level, room: cl.room } };
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
