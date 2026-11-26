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
