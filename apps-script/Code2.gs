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
