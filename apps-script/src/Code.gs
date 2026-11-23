/**
 * ระบบวิเคราะห์ผลการเรียน ปพ.5 / ใบรายงาน ปพ.6 — รุ่น Google Apps Script
 *
 * วิธีติดตั้งโดยย่อ (รายละเอียดใน README):
 *   1) สร้างโปรเจกต์ Apps Script ใหม่ วางไฟล์นี้ใน Code.gs
 *      แล้วสร้างไฟล์ HTML 7 ไฟล์: Index, Css, JsStore, JsParser, JsPP6Parser, JsReport, JsApp
 *   2) ตั้งรหัสผ่านด้านล่าง (ACCESS_PIN) เพื่อกันคนอื่นเปิดดูคะแนนนักเรียน
 *   3) ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > เว็บแอป
 *      ดำเนินการในฐานะ: ฉัน   ผู้มีสิทธิ์เข้าถึง: ทุกคนที่มีบัญชี Google (หรือทุกคน)
 *
 * ไฟล์ Excel ที่อัปโหลดจะถูกเปลี่ยนชื่อและเก็บใน Google Drive ของเจ้าของสคริปต์
 * โฟลเดอร์ "ระบบวิเคราะห์ผล ปพ.5-ปพ.6" แยกตามปีการศึกษาและชั้น/ห้อง
 */

// ===== ตั้งค่า =====
// รหัสผ่านสำหรับเข้าระบบ (เว้นว่าง '' = ไม่ใช้รหัสผ่าน ไม่แนะนำ เพราะมีข้อมูลนักเรียน)
var ACCESS_PIN = '';
// ชื่อโฟลเดอร์หลักใน Google Drive
var ROOT_FOLDER_NAME = 'ระบบวิเคราะห์ผล ปพ.5-ปพ.6';
// ชื่อที่แสดงบนแท็บเบราว์เซอร์
var APP_TITLE = 'วิเคราะห์ผลการเรียน ปพ.5 / ปพ.6';

var DATA_FOLDER_NAME = '_ข้อมูลระบบ (ห้ามลบ)';
var PDF_FOLDER_NAME = 'PDF ใบรายงาน';
var PROP_PREFIX = 'rec:';

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** แทรกเนื้อหาไฟล์ HTML อื่น (Css, JsApp ฯลฯ) เข้าไปใน Index */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ===== ตัวช่วย =====
function checkPin_(pin) {
  if (ACCESS_PIN && String(pin || '') !== String(ACCESS_PIN)) throw new Error('PIN_REQUIRED');
}

function props_() { return PropertiesService.getScriptProperties(); }

function rootFolder_() {
  var p = props_(), id = p.getProperty('ROOT_ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* ถูกลบไปแล้ว สร้างใหม่ */ }
  }
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  p.setProperty('ROOT_ID', folder.getId());
  return folder;
}

function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function classFolder_(entry) {
  var stage = entry.stage || 'ป';
  var year = subFolder_(rootFolder_(), 'ปีการศึกษา ' + entry.year);
  return subFolder_(year, stage + '.' + entry.level + '-' + entry.room);
}

function safeName_(s) { return String(s).replace(/[\\/:*?"<>|#%]+/g, '-'); }

function trashById_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ไม่มีไฟล์แล้ว */ }
}

function getEntry_(key) {
  var v = props_().getProperty(PROP_PREFIX + key);
  return v ? JSON.parse(v) : null;
}

function putEntry_(entry) {
  props_().setProperty(PROP_PREFIX + entry.key, JSON.stringify(entry));
}

function allEntries_() {
  var all = props_().getProperties(), out = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(PROP_PREFIX) === 0) {
      try { out.push(JSON.parse(all[k])); } catch (e) { /* ข้าม */ }
    }
  });
  return out;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ===== API ที่หน้าเว็บเรียกใช้ =====
function api_ping(pin) {
  checkPin_(pin);
  var root = rootFolder_();
  return { ok: true, rootUrl: root.getUrl(), pin: !!ACCESS_PIN };
}

function api_list(pin) {
  checkPin_(pin);
  return allEntries_();
}

/**
 * บันทึกไฟล์ที่อัปโหลด
 * entry: { key, year, level, room, stage, slot, fileName, origName, size, mime, school }
 * fileB64: เนื้อไฟล์ Excel แบบ base64, dataJson: ผลการถอดข้อมูล (JSON)
 */
function api_save(pin, entry, fileB64, dataJson) {
  checkPin_(pin);
  if (!entry || !entry.key) throw new Error('ข้อมูลไม่ครบ');
  return withLock_(function () {
    var old = getEntry_(entry.key);
    var folder = classFolder_(entry);
    var blob = Utilities.newBlob(Utilities.base64Decode(fileB64), entry.mime || 'application/octet-stream', safeName_(entry.fileName));
    var file = folder.createFile(blob);
    var dataFolder = subFolder_(rootFolder_(), DATA_FOLDER_NAME);
    var dataFile = dataFolder.createFile(safeName_(entry.key) + '.json', dataJson, 'application/json');
    if (old) { trashById_(old.fileId); trashById_(old.dataId); }
    var saved = {
      key: entry.key, year: entry.year, level: entry.level, room: entry.room, stage: entry.stage || 'ป',
      slot: entry.slot, fileName: entry.fileName, origName: entry.origName, size: entry.size,
      uploadedAt: entry.uploadedAt || Date.now(), school: entry.school || '',
      fileId: file.getId(), url: file.getUrl(), dataId: dataFile.getId(),
      settings: old && old.settings ? old.settings : (entry.settings || null)
    };
    putEntry_(saved);
    return saved;
  });
}

/** คืนข้อมูลที่ถอดแล้ว (JSON string) ของหลายไฟล์ */
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
    allEntries_().forEach(function (e) {
      trashById_(e.fileId); trashById_(e.dataId);
      props_().deleteProperty(PROP_PREFIX + e.key);
    });
    return true;
  });
}

/** เก็บสำเนา PDF/ZIP ที่สร้างไว้ใน Drive */
function api_saveOutput(pin, name, b64, mime) {
  checkPin_(pin);
  var folder = subFolder_(rootFolder_(), PDF_FOLDER_NAME);
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime || 'application/pdf', safeName_(name)));
  return file.getUrl();
}

/** เรียกครั้งแรกจากหน้าแก้ไขสคริปต์ เพื่ออนุญาตสิทธิ์ Drive และสร้างโฟลเดอร์ */
function setup() {
  var f = rootFolder_();
  subFolder_(f, DATA_FOLDER_NAME);
  subFolder_(f, PDF_FOLDER_NAME);
  Logger.log('พร้อมใช้งาน โฟลเดอร์: ' + f.getUrl());
}
