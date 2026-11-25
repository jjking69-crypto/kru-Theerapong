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
