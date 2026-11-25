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

// ===== เลขประจำตัวจากชื่อ (ไฟล์ ปพ. รุ่นเก่าที่ช่องเลขประจำตัวว่าง) =====
//   รวมจากผลที่ประกาศแล้วทุกปี + ทะเบียนรายชื่อ · ชื่อซ้ำแต่เลขต่างกัน = ไม่เดา
function stuKey_(n) { return String(n || '').replace(/\s+/g, '').replace(/^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นาย|นางสาว|นาง)/, ''); }
function api_nameIds(pin) {
  checkPin_(pin);
  var c = cache_(), hit = c.get('nameIds');
  if (hit) return JSON.parse(hit);
  var map = {}, bad = {};
  function add(name, id) {
    var k = stuKey_(name); id = String(id == null ? '' : id).trim();
    if (!k || !id) return;
    if (map[k] && map[k] !== id) bad[k] = 1; else map[k] = id;
  }
  var idx = readIndex_();
  Object.keys(idx.classes).forEach(function (key) {
    var t = readText_(idx.classes[key].fileId);
    if (t) try { (JSON.parse(t).students || []).forEach(function (s) { add(s.name, s.id); }); } catch (e) {}
  });
  var v = props_().getProperty('ROSTER');
  if (v) try { (JSON.parse(readText_(JSON.parse(v).dataId) || '{}').classes || []).forEach(function (cl) { (cl.students || []).forEach(function (s) { add((s.first || '') + (s.last || ''), s.id); }); }); } catch (e) {}
  Object.keys(bad).forEach(function (k) { delete map[k]; });
  var out = JSON.stringify(map);
  if (out.length < 95000) try { c.put('nameIds', out, 600); } catch (e) {}
  return map;
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
