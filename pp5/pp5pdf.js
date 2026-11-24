/*
 * ปพ.5 เป็น PDF ทั้งเล่ม (ทุกหน้า ไม่ตกขอบ)
 *   หน้าปก + สรุปผล · รายการตัวชี้วัด · คะแนนตามตัวชี้วัด (แยกภาคเรียน) · สรุปผลการเรียนรายคน
 *   ทุกหน้าย่อขนาดอัตโนมัติให้พอดีกระดาษ A4 (ตารางกว้าง = แนวนอน)
 *   PP5Pdf.subject(rec, ctx) · PP5Pdf.classBook(recs, ctx, fileName)
 *   ctx: { brand(), sig(name), toast(msg, kind), save(blob, name) }
 */
(function () {
  'use strict';
  var LIBS = window.PP5_LIBS || ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js'];
  var PX = { p: { w: 794, h: 1123 }, l: { w: 1123, h: 794 } }, PAD = 34;
  function esc(v) { return v == null ? '' : String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v, d) { if (v == null || v === '') return ''; if (typeof v !== 'number') return esc(v); return d != null ? v.toFixed(d) : String(Math.round(v * 100) / 100); }
  function chunk(a, k) { var o = []; for (var i = 0; i < a.length; i += k) o.push(a.slice(i, i + k)); return o.length ? o : [[]]; }

  var libsReady = null;
  function loadLibs() {
    if (window.html2canvas && window.jspdf) return Promise.resolve();
    if (libsReady) return libsReady;
    libsReady = LIBS.filter(function (s) { return !/jszip/.test(s); }).reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (res, rej) {
          var s = document.createElement('script'); s.src = src; s.onload = res;
          s.onerror = function () { rej(new Error('โหลด ' + src + ' ไม่สำเร็จ')); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
    libsReady.catch(function () { libsReady = null; });
    return libsReady;
  }

  var CSS = '#p5Stage{position:fixed;left:-20000px;top:0;z-index:-1}' +
    '.p5pg{background:#fff;color:#000;overflow:hidden;position:relative;box-sizing:border-box;font-family:Sarabun,"TH Sarabun New",sans-serif;font-size:14px;line-height:1.35}' +
    '.p5pg .p5fit{transform-origin:0 0;position:absolute;left:' + PAD + 'px;top:' + PAD + 'px}' +
    '.p5pg .p5hd{display:flex;justify-content:space-between;border-bottom:1.5px solid #000;padding-bottom:4px;margin-bottom:8px;font-size:13px;white-space:nowrap;gap:20px}' +
    '.p5pg .p5no{position:absolute;right:' + PAD + 'px;bottom:14px;font-size:12px;color:#333}' +
    '.p5pg h1{font-size:24px;text-align:center;margin:4px 0}.p5pg h2{font-size:18px;text-align:center;margin:2px 0 8px}' +
    '.p5pg table{border-collapse:collapse;width:100%}' +
    '.p5pg th,.p5pg td{border:1px solid #000;padding:2px 4px;text-align:center;vertical-align:middle}' +
    '.p5pg th{background:#eef2f7;font-weight:700}' +
    '.p5pg td.l,.p5pg th.l{text-align:left}.p5pg td.nm{text-align:left;white-space:nowrap}' +
    '.p5pg .sm{font-size:11px;font-weight:400}' +
    '.p5pg .cv{text-align:center;margin-top:10px}.p5pg .cv img{width:96px;height:96px;object-fit:contain}' +
    '.p5pg .cv-info{margin:14px auto;font-size:17px;line-height:1.9;text-align:left;width:88%}.p5pg .cv-info b{font-weight:700}' +
    '.p5pg .sigs{display:grid;grid-template-columns:1fr 1fr;gap:18px 30px;margin-top:22px;font-size:15px}' +
    '.p5pg .sig{text-align:center}.p5pg .sig .ln{height:46px;display:flex;align-items:flex-end;justify-content:center}.p5pg .sig img{max-height:46px;max-width:180px}' +
    '.p5pg .sig.full{grid-column:1/-1}.p5pg .appr{margin:6px 0;font-size:15px}' +
    '.p5pg .fail{color:#c00;font-weight:700}';
  function injectCss() { if (document.getElementById('p5pdf-css')) return; var s = document.createElement('style'); s.id = 'p5pdf-css'; s.textContent = CSS; document.head.appendChild(s); }

  // ---------- สร้างหน้า ----------
  function header(d) {
    var m = d.meta;
    return '<div class="p5hd"><span>ปพ.5 · ' + esc(m.code) + ' ' + esc(m.subject) + '</span><span>ชั้น' + esc(m.gradeName || ('ป.' + m.level)) + '/' + esc(m.room) + ' · ปีการศึกษา ' + esc(m.year) + '</span><span>' + esc(/^โรงเรียน/.test(m.school || '') ? m.school : 'โรงเรียน' + (m.school || '')) + '</span></div>';
  }
  function page(orient, body) { return { o: orient, html: body }; }
  function counts(list, f) { var o = {}; list.forEach(function (s) { var k = f(s); if (k != null && k !== '') o[k] = (o[k] || 0) + 1; }); return o; }
  function sigBlock(img, name, pos) {
    return '<div class="sig"><div class="ln">' + (img ? '<img src="' + img + '" alt="">' : '') + '</div>ลงชื่อ ..................................................<br>( ' + esc(name || '..................................................') + ' )<br>' + esc(pos || '') + '</div>';
  }
  function cover(d, ctx) {
    var m = d.meta, st = d.students, br = (ctx.brand && ctx.brand()) || {};
    var sex = counts(st, function (s) { return /หญิง|ญ/.test(s.prefix || s.sex || '') ? 'f' : 'm'; });
    var G = ['4', '3.5', '3', '2.5', '2', '1.5', '1', '0'], gc = counts(st, function (s) { var r = s.result || {}; if (r.rms) return r.rms; if (r.grade == null || r.grade === '') return null; var g = parseFloat(r.grade); return isFinite(g) ? String(g) : String(r.grade); });
    var tot = st.length || 1;
    var cols = G.concat(['ร', 'มส']);
    var gt = '<table><tr><th>ระดับผลการเรียน</th>' + cols.map(function (g) { return '<th>' + g + '</th>'; }).join('') + '<th>รวม</th></tr>' +
      '<tr><td>จำนวน (คน)</td>' + cols.map(function (g) { return '<td>' + (gc[g] || 0) + '</td>'; }).join('') + '<td>' + st.length + '</td></tr>' +
      '<tr><td>ร้อยละ</td>' + cols.map(function (g) { return '<td>' + ((gc[g] || 0) / tot * 100).toFixed(2) + '</td>'; }).join('') + '<td>100</td></tr></table>';
    var L = ['ดีเยี่ยม', 'ดี', 'ผ่าน', 'ไม่ผ่าน'];
    var ch = counts(st, function (s) { return s.characteristics && s.characteristics.text; }), rw = counts(st, function (s) { return s.rtw && s.rtw.text; });
    var et = '<table style="margin-top:10px"><tr><th>ผลการประเมิน</th>' + L.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr>' +
      '<tr><td class="l">คุณลักษณะอันพึงประสงค์</td>' + L.map(function (x) { return '<td>' + (ch[x] || 0) + '</td>'; }).join('') + '</tr>' +
      '<tr><td class="l">การอ่าน คิดวิเคราะห์ และเขียน</td>' + L.map(function (x) { return '<td>' + (rw[x] || 0) + '</td>'; }).join('') + '</tr></table>';
    var dir = br.director || {}, dep = br.deputy || {};
    var sig = function (nm) { return ctx.sig ? ctx.sig(nm) : null; };
    var school = /^โรงเรียน/.test(m.school || '') ? m.school : 'โรงเรียน' + (m.school || '');
    return page('p', '<div class="cv">' + (br.logo ? '<img src="' + br.logo + '" alt="">' : '') + '<h1>แบบบันทึกผลการพัฒนาคุณภาพผู้เรียนรายวิชา</h1><h2>(ปพ.5)</h2></div>' +
      '<div class="cv-info">' +
      '<div><b>' + esc(school) + '</b> ' + (m.district ? 'อำเภอ' + esc(m.district) + ' ' : '') + (m.province ? 'จังหวัด' + esc(m.province) : '') + '</div>' +
      (m.office ? '<div>' + esc(m.office) + '</div>' : '') +
      '<div>กลุ่มสาระการเรียนรู้ <b>' + esc(m.group || '-') + '</b></div>' +
      '<div>รายวิชา<b>' + esc(m.type || '') + '</b> รหัสวิชา <b>' + esc(m.code) + '</b> ชื่อวิชา <b>' + esc(m.subject) + '</b></div>' +
      '<div>ชั้น <b>' + esc(m.gradeName || ('ประถมศึกษาปีที่ ' + m.level)) + '/' + esc(m.room) + '</b> ปีการศึกษา <b>' + esc(m.year) + '</b></div>' +
      '<div>เวลาเรียน <b>' + n(m.hours) + '</b> ชั่วโมง/ปี · <b>' + n(m.credit, 1) + '</b> หน่วยกิต · ครูผู้สอน <b>' + esc(m.teacher || '-') + '</b></div>' +
      '<div>จำนวนนักเรียน <b>' + st.length + '</b> คน (ชาย ' + (sex.m || 0) + ' · หญิง ' + (sex.f || 0) + ')</div></div>' +
      '<div style="font-weight:700;margin:6px 0 4px">สรุปผลการเรียน</div>' + gt + et +
      '<div class="sigs">' + sigBlock(sig(m.teacher), m.teacher, 'ครูผู้สอน') + sigBlock(sig(dep.name), dep.name, dep.position || 'รองผู้อำนวยการโรงเรียน') +
      '<div class="sig full"><div class="appr">☐ อนุมัติ &nbsp;&nbsp;&nbsp; ☐ ไม่อนุมัติ</div>' + sigBlock(dir.img || sig(dir.name), dir.name, dir.position || 'ผู้อำนวยการโรงเรียน').replace(/^<div class="sig">|<\/div>$/g, '') + '</div></div>');
  }
  function indicatorPages(d) {
    var inds = d.indicators || [];
    if (!inds.length) return [];
    return chunk(inds, 16).map(function (part, i) {
      return page('p', header(d) + '<div style="font-weight:700;margin-bottom:6px">รายการตัวชี้วัด' + (i ? ' (ต่อ)' : '') + ' · ทั้งหมด ' + inds.length + ' ตัวชี้วัด</div>' +
        '<table><tr><th>ที่</th><th>ภาคเรียน</th><th>มาตรฐาน</th><th>ตัวชี้วัด</th><th class="l">รายละเอียด</th><th>คะแนนเต็ม</th></tr>' +
        part.map(function (x) { return '<tr><td>' + x.idx + '</td><td>' + esc(x.term || '') + '</td><td>' + esc(x.std) + '</td><td style="white-space:nowrap">' + esc(x.code) + '</td><td class="l">' + esc(x.text) + '</td><td>' + n(x.max) + '</td></tr>'; }).join('') + '</table>');
    });
  }
  function scorePages(d) {
    var inds = d.indicators || [], st = d.students, groups = {};
    inds.forEach(function (x) { var k = x.term || 0; (groups[k] = groups[k] || []).push(x); });
    var out = [];
    Object.keys(groups).sort().forEach(function (k) {
      var cols = chunk(groups[k], 15);
      cols.forEach(function (cs, ci) {
        var last = ci === cols.length - 1, all = groups[k];
        chunk(st, 30).forEach(function (rows, ri) {
          var title = 'คะแนนเก็บตามตัวชี้วัด' + (+k ? ' ภาคเรียนที่ ' + k : '') + (cols.length > 1 ? ' (ส่วนที่ ' + (ci + 1) + '/' + cols.length + ')' : '') + (ri ? ' (ต่อ)' : '');
          var maxSum = all.reduce(function (a, x) { return a + (x.max || 0); }, 0);
          out.push(page('l', header(d) + '<div style="font-weight:700;margin-bottom:6px">' + title + '</div>' +
            '<table><tr><th rowspan="2">เลขที่</th><th rowspan="2" class="l">ชื่อ - สกุล</th>' + cs.map(function (x) { return '<th>' + x.idx + '<div class="sm">' + esc(x.code) + '</div></th>'; }).join('') + (last ? '<th rowspan="2">รวม' + (+k ? '<br>ภาค ' + k : '') + '</th>' : '') + '</tr>' +
            '<tr>' + cs.map(function (x) { return '<th class="sm">' + n(x.max) + '</th>'; }).join('') + '</tr>' +
            rows.map(function (s) {
              var sum = null;
              if (last) all.forEach(function (x) { var v = s.scores && s.scores[x.idx]; if (typeof v === 'number') sum = (sum || 0) + v; });
              return '<tr><td>' + esc(s.no) + '</td><td class="nm">' + esc(s.name) + '</td>' + cs.map(function (x) { var v = s.scores && s.scores[x.idx]; return '<td>' + n(v) + '</td>'; }).join('') +
                (last ? '<td><b>' + n(sum) + '</b><span class="sm">/' + maxSum + '</span></td>' : '') + '</tr>';
            }).join('') + '</table>'));
        });
      });
    });
    return out;
  }
  function summaryPages(d) {
    var mx = d.maxima || {}, st = d.students;
    return chunk(st, 30).map(function (rows, ri) {
      return page('l', header(d) + '<div style="font-weight:700;margin-bottom:6px">สรุปผลการประเมินรายวิชา' + (ri ? ' (ต่อ)' : '') + '</div>' +
        '<table><tr><th rowspan="2">เลขที่</th><th rowspan="2">เลขประจำตัว</th><th rowspan="2" class="l">ชื่อ - สกุล</th>' +
        '<th>คะแนนตัวชี้วัด</th><th>คะแนนเก็บ</th><th>สอบปลายปี</th><th>รวม</th><th rowspan="2">ระดับ<br>ผลการเรียน</th>' +
        '<th colspan="2">ตัวชี้วัด</th><th colspan="3">เวลาเรียน (%)</th><th rowspan="2">คุณลักษณะ<br>อันพึงประสงค์</th><th rowspan="2">อ่าน คิด<br>วิเคราะห์ เขียน</th></tr>' +
        '<tr><th class="sm">' + n(mx.indTotal) + '</th><th class="sm">' + n(mx.collect) + '</th><th class="sm">' + n(mx.final) + '</th><th class="sm">' + n(mx.total) + '</th>' +
        '<th class="sm">ผ่าน</th><th class="sm">ไม่ผ่าน</th><th class="sm">ภาค 1</th><th class="sm">ภาค 2</th><th class="sm">ทั้งปี</th></tr>' +
        rows.map(function (s) {
          var r = s.result || {}, a = s.attendance || {}, is = s.indSummary || {}, g = r.rms || r.grade;
          var bad = g === '0' || g === 'ร' || g === 'มส';
          return '<tr><td>' + esc(s.no) + '</td><td>' + esc(s.id) + '</td><td class="nm">' + esc(s.name) + '</td><td>' + n(r.indTotal) + '</td><td>' + n(r.collect) + '</td><td>' + n(r.final) + '</td><td><b>' + n(r.total) + '</b></td>' +
            '<td' + (bad ? ' class="fail"' : '') + '><b>' + esc(g == null ? '' : g) + '</b></td><td>' + n(is.pass) + '</td><td>' + n(is.fail) + '</td>' +
            '<td>' + n(a.t1 && a.t1.pct, 0) + '</td><td>' + n(a.t2 && a.t2.pct, 0) + '</td><td>' + n(a.year && a.year.pct, 0) + '</td>' +
            '<td>' + esc(s.characteristics && s.characteristics.text) + '</td><td>' + esc(s.rtw && s.rtw.text) + '</td></tr>';
        }).join('') + '</table>');
    });
  }
  function pagesOf(rec, ctx) {
    var d = rec.data;
    if (window.PP5Model && PP5Model.fillPP5) { try { d = PP5Model.fillPP5(JSON.parse(JSON.stringify(d))); } catch (e) { d = rec.data; } }
    return [cover(d, ctx)].concat(indicatorPages(d), scorePages(d), summaryPages(d));
  }

  // ---------- จับภาพทีละหน้า (ย่อให้พอดีกระดาษ) ----------
  function stage() { var el = document.getElementById('p5Stage'); if (!el) { el = document.createElement('div'); el.id = 'p5Stage'; document.body.appendChild(el); } return el; }
  function fit(pg, o) {
    var f = pg.querySelector('.p5fit'), W = PX[o].w - PAD * 2, H = PX[o].h - PAD * 2 - 18, s = 1;
    f.style.width = W + 'px'; f.style.transform = '';
    for (var i = 0; i < 4; i++) {
      var sw = Math.max(f.scrollWidth, W / s), sh = f.scrollHeight;
      var ns = Math.min(1, W / sw * s, H / sh);
      if (Math.abs(ns - s) < 0.005) break;
      s = ns; f.style.width = (W / s) + 'px';
      if (f.scrollHeight * s <= H && f.scrollWidth * s <= W + 1) break;
    }
    if (f.scrollHeight * s > H) s = H / f.scrollHeight;
    if (s < 1) f.style.transform = 'scale(' + s.toFixed(4) + ')';
    return s;
  }
  async function render(pages, pdf, first, onPage) {
    injectCss();
    var el = stage(), isFirst = first;
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i], sz = PX[p.o];
      el.innerHTML = '<div class="p5pg" style="width:' + sz.w + 'px;height:' + sz.h + 'px"><div class="p5fit">' + p.html + '</div><div class="p5no">หน้า ' + (i + 1) + '/' + pages.length + '</div></div>';
      var imgs = el.querySelectorAll('img');
      await Promise.all(Array.prototype.map.call(imgs, function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); }));
      fit(el.firstChild, p.o);
      if (onPage) onPage(i, pages.length);
      var cv = await window.html2canvas(el.firstChild, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true, width: sz.w, height: sz.h, windowWidth: sz.w });
      var land = p.o === 'l';
      if (!isFirst) pdf.addPage('a4', land ? 'landscape' : 'portrait');
      isFirst = false;
      pdf.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, land ? 297 : 210, land ? 210 : 297);
    }
    el.innerHTML = '';
  }
  function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(); }
  function nameOf(rec) { var m = rec.data.meta; return fileSafe('ปพ.5_' + (m.levelName || 'ป.' + m.level) + '-' + m.room + '_' + m.code + '_' + m.subject + '_ปี' + m.year); }
  var busy = false;
  async function run(recs, ctx, fileName) {
    if (busy) return; busy = true;
    var ld = window.PP5PinPad && PP5PinPad.loading ? PP5PinPad.loading('กำลังเตรียมสร้าง PDF ปพ.5...') : { set: function () {}, done: function () {} };
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await loadLibs();
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }), first = true, total = 0;
      for (var r = 0; r < recs.length; r++) {
        var rec = recs[r], pages = pagesOf(rec, ctx), m = rec.data.meta;
        await render(pages, pdf, first, function (i, nn) { ld.set('กำลังสร้าง PDF ' + (recs.length > 1 ? '(' + (r + 1) + '/' + recs.length + ') ' : '') + m.subject + ' · หน้า ' + (i + 1) + '/' + nn); });
        first = false; total += pages.length;
      }
      var blob = pdf.output('blob');
      if (ctx.save) ctx.save(blob, fileName + '.pdf');
      if (ctx.toast) ctx.toast('สร้าง PDF ปพ.5 แล้ว ' + total + ' หน้า' + (recs.length > 1 ? ' (' + recs.length + ' วิชา)' : ''), 'ok');
    } catch (e) {
      console.error(e);
      if (ctx.toast) ctx.toast('สร้าง PDF ไม่สำเร็จ: ' + (e && e.message ? e.message : e), 'err');
    } finally { ld.done(); busy = false; }
  }
  window.PP5Pdf = {
    pagesOf: pagesOf, fit: fit, css: injectCss,
    subject: function (rec, ctx) { return run([rec], ctx, nameOf(rec)); },
    classBook: function (recs, ctx, name) { return run(recs, ctx, fileSafe(name || 'ปพ.5 ทุกวิชา')); }
  };
})();
