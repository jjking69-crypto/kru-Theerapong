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
