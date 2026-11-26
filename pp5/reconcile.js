/*
 * ทะเบียนรายชื่อนักเรียน (ไฟล์ Word) = ข้อมูลหลักของระบบ
 *   - จับคู่นักเรียนในไฟล์ ปพ.5 / ปพ.6 กับทะเบียนด้วย "ชื่อ" เป็นหลัก (เลขประจำตัวในไฟล์อาจพิมพ์ผิด)
 *     ถ้าชื่อไม่ตรงใคร (เช่น สะกดต่าง) จึงใช้เลขประจำตัวช่วย
 *   - ใช้เลขประจำตัว เลขที่ ชื่อ จากทะเบียนแทนของในไฟล์เสมอ และรายงานว่าแก้อะไรไปบ้าง
 *   - เทียบคะแนนใน ปพ.6 กับคะแนนที่คำนวณจาก ปพ.5
 */
(function (root) {
  'use strict';
  function nk(s) { return String(s || '').replace(/\s+/g, '').replace(/^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นาย|นางสาว|นาง)/, ''); }
  function full(s) { return s.name || ((s.prefix || '') + (s.first || '') + ' ' + (s.last || '')).trim(); }
  function idOf(s) { return s && s.id != null ? String(s.id).replace(/\s+/g, '') : ''; }

  function key(r) { return idOf(r) || nk(full(r)); }
  // used = คนในทะเบียนที่จับคู่ไปแล้ว (กันคนเดียวถูกจับซ้ำ)
  function match(list, s, used) {
    used = used || {};
    var n = nk(full(s)), id = idOf(s);
    var free = function (x) { return !used[key(x)]; };
    if (n) { var h = list.filter(function (x) { return free(x) && nk(full(x)) === n; })[0]; if (h) return h; }
    if (id) { var h2 = list.filter(function (x) { return free(x) && idOf(x) === id; })[0]; if (h2) return h2; }
    return null;
  }
  // จับคู่ทั้งห้อง: รอบแรกด้วยชื่อ (ทุกคน) แล้วรอบสองด้วยเลขประจำตัว (คนที่ชื่อไม่ตรง)
  function pairAll(students, roster) {
    var used = {}, pairs = students.map(function () { return null; });
    students.forEach(function (s, i) { var n = nk(full(s)); if (!n) return; var r = roster.filter(function (x) { return !used[key(x)] && nk(full(x)) === n; })[0]; if (r) { pairs[i] = r; used[key(r)] = 1; } });
    students.forEach(function (s, i) { if (pairs[i] || !idOf(s)) return; var r = roster.filter(function (x) { return !used[key(x)] && idOf(x) === idOf(s); })[0]; if (r) { pairs[i] = r; used[key(r)] = 1; } });
    return { pairs: pairs, used: used };
  }

  // ตรวจรายชื่อในไฟล์เทียบกับทะเบียน (ไม่แก้ข้อมูล)
  function rosterCheck(students, roster) {
    var res = { total: students.length, matched: 0, diffs: [], notInRoster: [], missing: [] };
    if (!roster || !roster.length) return null;
    var pa = pairAll(students, roster), used = pa.used;
    students.forEach(function (s, i) {
      var r = pa.pairs[i];
      if (!r) { res.notInRoster.push({ no: s.no, id: idOf(s), name: full(s) }); return; }
      res.matched++;
      var d = [];
      if (+s.no !== +r.no) d.push('เลขที่ ' + (s.no == null ? '-' : s.no) + ' → ' + r.no);
      if (nk(full(s)) !== nk(full(r))) d.push('ชื่อ "' + full(s) + '" → "' + full(r) + '"');
      else if (full(s).replace(/\s+/g, '') !== full(r).replace(/\s+/g, '')) d.push('คำนำหน้า "' + full(s) + '" → "' + full(r) + '"');
      if (!idOf(s) && idOf(r)) d.push('เพิ่มเลขประจำตัว ' + idOf(r));
      else if (idOf(s) && idOf(r) && idOf(s) !== idOf(r)) d.push('เลขประจำตัว ' + idOf(s) + ' → ' + idOf(r));
      if (d.length) res.diffs.push({ no: r.no, id: idOf(r), name: full(r), items: d });
    });
    roster.forEach(function (r) { if (!used[key(r)]) res.missing.push({ no: r.no, id: idOf(r), name: full(r) }); });
    res.issues = res.diffs.length + res.notInRoster.length + res.missing.length;
    return res;
  }

  // ใช้ข้อมูลจากทะเบียน (เลขที่ เลขประจำตัว ชื่อ) แทนข้อมูลในไฟล์ แล้วคืนผลตรวจ (ก่อนแก้)
  function applyRoster(data, roster) {
    if (!data || !data.students || !roster || !roster.length) return null;
    var chk = rosterCheck(data.students, roster), pa = pairAll(data.students, roster);
    data.students.forEach(function (s, i) {
      var r = pa.pairs[i];
      if (!r) { s.inRoster = false; return; }
      s.inRoster = true;
      if (s.noInFile == null && +s.no !== +r.no) s.noInFile = s.no;
      if (s.nameInFile == null && nk(full(s)) !== nk(full(r))) s.nameInFile = full(s);
      if (s.idInFile == null && idOf(s) && idOf(r) && idOf(s) !== idOf(r)) s.idInFile = idOf(s);
      s.no = r.no; s.id = idOf(r) || s.id;
      s.prefix = r.prefix || s.prefix; s.first = r.first || s.first; s.last = r.last || s.last;
      s.name = full({ prefix: r.prefix, first: r.first, last: r.last, name: r.name });
      if (r.nid4 && !s.nid4) s.nid4 = r.nid4;
      if (r.sex && !s.sex) s.sex = r.sex;
    });
    data.students.sort(function (a, b) { return (a.inRoster === false) - (b.inRoster === false) || (a.no || 0) - (b.no || 0); });
    return chk;
  }

  // เทียบคะแนน ปพ.6 (ไฟล์ที่อัปโหลด) กับ ปพ.6 ที่คำนวณจาก ปพ.5
  function compareScores(p6, derived) {
    var out = { compared: 0, subjects: [], list: [], bySubject: {} };
    if (!p6 || !derived) return out;
    var subMap = {};
    derived.subjects.forEach(function (ds) {
      var hit = p6.subjects.filter(function (x) { return x.code === ds.code; })[0] ||
        p6.subjects.filter(function (x) { return nk(x.name) === nk(ds.name); })[0];
      if (hit) { subMap[ds.code] = hit.code; out.subjects.push({ code: hit.code, name: hit.name }); }
    });
    derived.students.forEach(function (ds) {
      var s = match(p6.students, ds);
      if (!s) return;
      Object.keys(subMap).forEach(function (dc) {
        var pc = subMap[dc];
        ['t1', 't2'].forEach(function (t) {
          var a = ds[t] && ds[t][dc], b = s[t] && s[t][pc];
          if (!a) return;
          out.compared++;
          var bad = [];
          ['collect', 'exam'].forEach(function (f) {
            var va = a[f], vb = b ? b[f] : null;
            if (va == null) return;
            if (vb == null || Math.abs(va - vb) > 0.01) bad.push({ field: f, pp6: vb, pp5: va });
          });
          if (bad.length) {
            out.bySubject[pc] = (out.bySubject[pc] || 0) + 1;
            bad.forEach(function (x) { out.list.push({ no: s.no, name: full(s), code: pc, subject: (p6.subjects.filter(function (q) { return q.code === pc; })[0] || {}).name, term: t === 't1' ? 1 : 2, field: x.field, pp6: x.pp6, pp5: x.pp5 }); });
          }
        });
      });
    });
    return out;
  }

  var api = { match: match, rosterCheck: rosterCheck, applyRoster: applyRoster, compareScores: compareScores, nameKey: nk };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PP5Reconcile = api;
})(typeof self !== 'undefined' ? self : this);
