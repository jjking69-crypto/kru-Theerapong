/**
 * ระบบประกาศผลการเรียน + ระบบหลังบ้าน ปพ.5 / ปพ.6 — Google Apps Script
 *
 *   หน้าแรก (ผู้ปกครอง):   URL ของเว็บแอป              → ค้นหาผลด้วยเลขประจำตัวนักเรียน
 *   หลังบ้าน (ครู):        URL ของเว็บแอป + ?page=admin → อัปโหลด / กรอก / สร้างไฟล์ ปพ.5 ปพ.6
 *
 * วิธีติดตั้งอยู่ใน README.md
 */

// ===== ตั้งค่า =====
// รหัสผ่านเข้าหลังบ้านของครู (แนะนำให้ตั้ง เพราะมีข้อมูลนักเรียน)
var ACCESS_PIN = '';
// โฟลเดอร์หลักใน Google Drive: ระบบจะสร้างไฟล์และโฟลเดอร์ทั้งหมด "ภายในโฟลเดอร์นี้เท่านั้น"
var ROOT_FOLDER_ID = '1HcYvW2C0e-sDZZ-fX7OpRIApfz6YiHSY';
// ชื่อบนแท็บเบราว์เซอร์ของหน้าหลังบ้าน
var ADMIN_TITLE = 'หลังบ้าน ปพ.5 / ปพ.6';

var DATA_FOLDER_NAME = '_ข้อมูลระบบ (ห้ามลบ)';
var PUB_FOLDER_NAME = '_ประกาศผล (ห้ามลบ)';
var PDF_FOLDER_NAME = 'PDF ใบรายงาน';
var TPL_FOLDER_NAME = '_แม่แบบ (ห้ามลบ)';
var ROSTER_FOLDER_NAME = 'รายชื่อนักเรียน';
var PROP_PREFIX = 'rec:';

function doGet(e) {
  var admin = e && e.parameter && e.parameter.page === 'admin';
  var cfg = admin ? null : getCfg_();
  return HtmlService.createTemplateFromFile(admin ? 'Index' : 'Public').evaluate()
    .setTitle(admin ? ADMIN_TITLE : (cfg.title || 'ประกาศผลการเรียน') + (cfg.school ? ' ' + cfg.school : ''))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** แทรกเนื้อหาไฟล์ HTML อื่น (Css, JsApp ฯลฯ) */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ===== ตัวช่วย =====
function checkPin_(pin) {
  if (ACCESS_PIN && String(pin || '') !== String(ACCESS_PIN)) throw new Error('PIN_REQUIRED');
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
  checkPin_(pin);
  var root = rootFolder_();
  return { ok: true, rootUrl: root.getUrl(), pin: !!ACCESS_PIN, publicUrl: webUrl_() };
}
function api_list(pin) { checkPin_(pin); return allEntries_(); }

/** บันทึกไฟล์ (อัปโหลด หรือที่ระบบสร้างจากการกรอกในระบบ) */
function api_save(pin, entry, fileB64, dataJson) {
  checkPin_(pin);
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
  checkPin_(pin);
  return withLock_(function () {
    var e = getEntry_(key);
    if (e) { trashById_(e.fileId); trashById_(e.dataId); }
    props_().deleteProperty(PROP_PREFIX + key);
    return true;
  });
}
function api_clear(pin) {
  checkPin_(pin);
  return withLock_(function () {
    allEntries_().forEach(function (e) { trashById_(e.fileId); trashById_(e.dataId); props_().deleteProperty(PROP_PREFIX + e.key); });
    return true;
  });
}
function api_saveOutput(pin, name, b64, mime) {
  checkPin_(pin);
  var folder = subFolder_(rootFolder_(), PDF_FOLDER_NAME);
  return folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime || 'application/pdf', safeName_(name))).getUrl();
}

// ===== แม่แบบรูปแบบต้นฉบับ (ปพ.5 ครูหนุ่ม / ปพ.6 ของโรงเรียน) =====
function tplInfo_() { var v = props_().getProperty('TPL_INFO'); return v ? JSON.parse(v) : {}; }
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
  if (kind !== 'pp5' && kind !== 'pp6') throw new Error('ชนิดแม่แบบไม่ถูกต้อง');
  return withLock_(function () {
    var info = tplInfo_(), old = info[kind];
    var folder = subFolder_(rootFolder_(), TPL_FOLDER_NAME);
    var ext = kind === 'pp5' ? '.xlsm' : '.xlsx';
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/octet-stream', 'แม่แบบ ' + (kind === 'pp5' ? 'ปพ.5' : 'ปพ.6') + ext));
    if (old) trashById_(old.fileId);
    info[kind] = { fileId: file.getId(), name: name, savedAt: Date.now() };
    props_().setProperty('TPL_INFO', JSON.stringify(info));
    return true;
  });
}

// ===== ทะเบียนรายชื่อนักเรียน (ไฟล์ Word) — เก็บทุกฉบับไว้เป็นประวัติ ใช้ฉบับล่าสุด =====
function api_saveRoster(pin, b64, fileName, dataJson, dateText) {
  checkPin_(pin);
  return withLock_(function () {
    var folder = subFolder_(rootFolder_(), ROSTER_FOLDER_NAME);
    var name = (dateText ? 'ข้อมูล ' + safeName_(dateText) + ' - ' : '') + safeName_(fileName);
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name));
    var old = props_().getProperty('ROSTER') ? JSON.parse(props_().getProperty('ROSTER')) : {};
    var dataId = writeText_(subFolder_(rootFolder_(), DATA_FOLDER_NAME), 'roster.json', old.dataId, dataJson);
    var info = { fileId: file.getId(), url: file.getUrl(), fileName: fileName, dataId: dataId, uploadedAt: Date.now() };
    props_().setProperty('ROSTER', JSON.stringify(info));
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
  checkPin_(pin);
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
  checkPin_(pin);
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
  checkPin_(pin);
  var cfg = JSON.parse(cfgJson);
  delete cfg.url;
  props_().setProperty('PUBLIC_CFG', JSON.stringify(cfg));
  return true;
}

// ===== API หน้าสาธารณะ (ไม่ต้องใช้รหัสผ่าน) =====
function api_publicInfo() {
  var cfg = getCfg_(), idx = readIndex_(), years = {};
  Object.keys(idx.classes).forEach(function (k) { years[idx.classes[k].year] = 1; });
  var u = webUrl_();
  return {
    title: cfg.title, school: cfg.school || '', announcement: cfg.announcement || '', verify: cfg.verify,
    years: Object.keys(years).sort().reverse().map(function (y) { var v = cfg.years[y] || { mid: true, final: true }; return { year: +y, mid: !!v.mid, final: !!v.final }; }),
    logo: readText_(props_().getProperty('PUB_LOGO_ID')),
    adminUrl: u ? u.replace(/\?.*$/, '') + '?page=admin' : ''
  };
}

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

  var cfg = getCfg_(), idx = readIndex_(), years = [], who = null;
  (idx.ids[id] || []).forEach(function (key) {
    var meta = idx.classes[key];
    if (!meta) return;
    var yc = cfg.years[meta.year] || { mid: true, final: true };
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
  if (!years.length) { c.put(fk, String(fails + 1), 600); return { notFound: true }; }
  return { id: id, name: who.name, first: who.first, years: years };
}

/** เรียกครั้งแรกจากหน้าแก้ไขสคริปต์ เพื่ออนุญาตสิทธิ์ และตรวจโฟลเดอร์หลัก */
function setup() {
  var f = rootFolder_();
  subFolder_(f, DATA_FOLDER_NAME);
  subFolder_(f, PUB_FOLDER_NAME);
  subFolder_(f, PDF_FOLDER_NAME);
  Logger.log('พร้อมใช้งาน โฟลเดอร์หลัก: ' + f.getName() + ' ' + f.getUrl());
}
