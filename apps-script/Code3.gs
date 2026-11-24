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
