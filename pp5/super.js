/* ระบบผู้ดูแล (แอดมิน) — แยกจากระบบครู: เปิด-ปิดระบบ ภาพรวมทุกห้อง ทะเบียนนักเรียน แม่แบบ */
(function () {
  'use strict';
  var DB = window.PP5_STORE, $ = function (id) { return document.getElementById(id); };
  function esc(v) { return v == null ? '' : String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || 'info'); t.textContent = msg;
    $('toasts').appendChild(t); setTimeout(function () { t.remove(); }, 4200);
  }
  function fmtDate(ms) { if (!ms) return '-'; var d = new Date(ms); return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); }
  var S = { entries: [], pub: {}, roster: null, tpl: {}, brand: null, sigs: {}, links: null };
  var SLOT_NAME = { th: 'ไทย', ma: 'คณิต', sci: 'วิทย์', soc: 'สังคม', his: 'ประวัติ', pe: 'สุขศึกษา', art: 'ศิลปะ', work: 'การงาน', eng: 'อังกฤษ', cor: 'ทุจริต' };

  function acts() {
    var base = window.PP5_HOME || (DB.publicUrl || '').replace(/\?.*$/, '');
    $('supActs').innerHTML = (base ? '<a class="tb home-tb" href="' + esc(base) + '" target="_top">⬅ กลับหน้าแรก</a>' : '') +
      '<span class="role">🛡 ระบบแอดมิน</span>' +
      (base ? '<a class="tb" href="' + esc(base) + '?page=admin" target="_top">👩‍🏫 ไปที่ระบบครู</a>' : '') +
      '<button class="tb" id="supOut">ออกจากระบบ</button>';
    $('supOut').onclick = function () { if (confirm('ออกจากระบบผู้ดูแล?')) window.PP5_LOGOUT(); };
  }

  function flagsCard() {
    var defs = DB.flagDefs || {}, f = DB.flags || {};
    var groups = [['หน้าประกาศผล (ผู้ปกครอง)', ['publicOpen', 'showMid', 'showFinal']], ['ระบบครู', ['allowUpload', 'allowEdit', 'allowDelete', 'allowRoster', 'allowPublish', 'allowReport', 'allowSignature']]];
    return '<section class="card sup-card"><h2>⚙️ เปิด-ปิดระบบ</h2><p class="sub">มีผลทันทีกับทุกคน (ผู้ดูแลระบบใช้ได้ทุกอย่างเสมอ) · ระบบตรวจที่เซิร์ฟเวอร์ด้วย</p>' +
      groups.map(function (g) {
        return '<h3 class="sup-h3">' + g[0] + '</h3><div class="flag-list">' + g[1].filter(function (k) { return defs[k]; }).map(function (k) {
          return '<label class="flag-row"><b>' + esc(defs[k]) + '</b><span class="sw"><input type="checkbox" data-flag="' + k + '"' + (f[k] !== false ? ' checked' : '') + '><span></span></span></label>';
        }).join('') + '</div>';
      }).join('') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn" data-fl="all0">ปิดทั้งหมด</button><button class="btn" data-fl="all1">เปิดทั้งหมด</button></div></section>';
  }

  function overviewCard() {
    var cls = {};
    S.entries.forEach(function (e) {
      var k = e.year + '|' + e.level + '|' + e.room;
      var c = cls[k] = cls[k] || { year: e.year, level: e.level, room: e.room, p5: [], p6: null, last: 0 };
      if (e.slot === 'pp6') c.p6 = e; else c.p5.push(e);
      c.last = Math.max(c.last, e.uploadedAt || 0);
    });
    Object.keys(S.pub).forEach(function (k) { if (!cls[k]) { var p = k.split('|'); cls[k] = { year: +p[0], level: +p[1], room: +p[2], p5: [], p6: null, last: 0 }; } });
    var keys = Object.keys(cls).sort(function (a, b) { var x = cls[a], y = cls[b]; return y.year - x.year || x.level - y.level || x.room - y.room; });
    var rows = keys.map(function (k) {
      var c = cls[k], p = S.pub[k];
      return '<tr><td><b>ป.' + c.level + '/' + c.room + '</b></td><td>' + c.year + '</td><td class="l">' + (c.p5.length ? '<b>' + c.p5.length + '</b> วิชา <small>(' + c.p5.map(function (e) { return SLOT_NAME[e.slot] || 'เพิ่มเติม'; }).join(', ') + ')</small>' : '<span class="muted">-</span>') + '</td>' +
        '<td>' + (c.p6 ? '📄 อัปโหลดแล้ว' : c.p5.length ? '⚙️ สร้างจาก ปพ.5' : '-') + '</td>' +
        '<td>' + (p ? p.count + ' คน <small>(กลางปี ' + (p.mid || 0) + ' · ปลายปี ' + (p.final || 0) + ')</small>' : '<span class="muted">ยังไม่เผยแพร่</span>') + '</td><td><small>' + fmtDate(Math.max(c.last, p ? p.updatedAt : 0)) + '</small></td></tr>';
    }).join('');
    var nP5 = S.entries.filter(function (e) { return e.slot !== 'pp6'; }).length;
    return '<section class="card sup-card"><h2>📊 ภาพรวมข้อมูลทุกห้อง</h2>' +
      '<div class="tiles"><div class="tile"><div class="k">ห้องที่มีข้อมูล</div><div class="v">' + keys.length + '</div></div><div class="tile"><div class="k">ไฟล์ ปพ.5</div><div class="v">' + nP5 + '</div></div>' +
      '<div class="tile"><div class="k">ประกาศผลแล้ว</div><div class="v">' + Object.keys(S.pub).reduce(function (a, k) { return a + (S.pub[k].count || 0); }, 0) + ' คน</div></div></div>' +
      (rows ? '<div class="tbl-wrap"><table><thead><tr><th>ชั้น</th><th>ปี</th><th class="l">ปพ.5</th><th>ปพ.6</th><th>หน้าประกาศผล</th><th>อัปเดตล่าสุด</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="sub">ยังไม่มีข้อมูลในระบบ</p>') + '</section>';
  }

  function rosterCard() {
    var r = S.roster, d = r && r.data;
    return '<section class="card sup-card"><h2>📋 ทะเบียนรายชื่อนักเรียน (ข้อมูลหลักของระบบ)</h2>' +
      '<p class="sub">ชื่อ เลขที่ และเลขประจำตัวในทะเบียนนี้ใช้เป็นข้อมูลหลักของทุกไฟล์ ปพ.5 / ปพ.6 และหน้าประกาศผล</p>' +
      (d ? '<div class="tiles"><div class="tile"><div class="k">ข้อมูลวันที่</div><div class="v" style="font-size:20px">' + esc(d.date ? d.date.display : d.dateText) + '</div></div>' +
        '<div class="tile"><div class="k">นักเรียน</div><div class="v">' + d.total + ' คน</div><div class="s">' + d.classes.length + ' ห้อง · ปีการศึกษา ' + esc(d.year || '') + '</div></div></div>' +
        (d.warnings && d.warnings.length ? '<div class="note"><b>ข้อควรตรวจ:</b> ' + d.warnings.map(esc).join(' · ') + '</div>' : '') +
        '<div class="chips" style="margin:10px 0">' + d.classes.map(function (c) { return '<span class="chip">' + esc(c.label) + ' <small>(' + c.students.length + ')</small></span>'; }).join('') + '</div>'
        : '<p class="note">ยังไม่มีทะเบียนรายชื่อ</p>') +
      '<div class="slot-acts"><button class="btn pri" id="supRosterUp">⇪ อัปโหลดทะเบียนรายชื่อ (.docx)</button>' + (r && r.url ? '<a class="btn" href="' + esc(r.url) + '" target="_blank" rel="noopener">⬇ เปิดไฟล์ปัจจุบัน</a>' : '') + '</div>' +
      '<input type="file" id="supRosterFile" accept=".docx" hidden></section>';
  }

  // โลโก้ + ผู้บริหาร: ตั้งครั้งเดียว ยึดใช้ในใบรายงาน ปพ.6 ทุกห้อง (ครูแก้ไม่ได้)
  function brandCard() {
    var D = (window.PP5Teachers && PP5Teachers.BRAND) || {}, b = S.brand || {};
    function fb(x, y) { x = x || {}; y = y || {}; return { name: x.name || y.name || '', position: x.position || y.position || '', img: x.img }; }
    var d = fb(b.director, D.director), p = fb(b.deputy, D.deputy);
    function pic(src, key, label) {
      return '<div class="sup-pic"><div class="sup-pic-box">' + (src ? '<img src="' + src + '" alt="">' : '<span class="muted">ยังไม่มี</span>') + '</div>' +
        '<button class="btn" data-up="' + key + '">🖼 ' + (src ? 'เปลี่ยน' : 'อัปโหลด') + label + '</button>' + (src ? '<button class="btn" data-rm="' + key + '">ลบ</button>' : '') + '</div>';
    }
    function person(k, x, lab) {
      return '<div class="sup-person"><h3 class="sup-h3">' + lab + '</h3><input type="text" data-b="' + k + '.name" value="' + esc(x.name || '') + '" placeholder="ชื่อ-สกุล">' +
        '<input type="text" data-b="' + k + '.position" value="' + esc(x.position || '') + '" placeholder="ตำแหน่ง">' + pic(x.img, k, 'ลายเซ็น') + '</div>';
    }
    var names = Object.keys(S.sigs || {});
    return '<section class="card sup-card"><h2>🖋 โลโก้โรงเรียน และลายเซ็นผู้บริหาร</h2>' +
      '<p class="sub">ฟิกไว้ใช้ใน<b>ใบรายงาน ปพ.6 ทุกห้อง</b> และหน้าประกาศผล — ครูแก้ไม่ได้ · ถ้ายังไม่อัปโหลดลายเซ็น/โลโก้ ระบบใช้รูปจากไฟล์ ปพ.6 ต้นฉบับของโรงเรียน · ลายเซ็นครูประจำชั้น ครูอัปโหลดเองในแท็บ ใบรายงาน (ปพ.6)</p>' +
      '<div class="sup-brand"><div class="sup-person"><h3 class="sup-h3">โรงเรียน</h3><input type="text" data-b="school" value="' + esc(b.school || D.school || 'โรงเรียนวัดทุ่งแฝก') + '" placeholder="ชื่อโรงเรียน">' + pic(b.logo, 'logo', 'โลโก้') + '</div>' +
      person('director', d, 'ผู้อำนวยการ') + person('deputy', p, 'รองผู้อำนวยการ') + '</div>' +
      '<div class="slot-acts"><button class="btn pri" id="supBrandSave">💾 บันทึกชื่อและตำแหน่ง</button></div>' +
      '<h3 class="sup-h3" style="margin-top:16px">ลายเซ็นครูที่อัปโหลดแล้ว (' + names.length + ')</h3>' +
      (names.length ? '<div class="sup-sigs">' + names.map(function (n) { return '<div class="sup-sig"><img src="' + S.sigs[n].img + '" alt=""><small>' + esc(n) + '</small></div>'; }).join('') + '</div>' : '<p class="sub">ยังไม่มี</p>') +
      '<input type="file" id="supImgFile" accept="image/*" hidden></section>';
  }

  function tplCard() {
    var ks = Object.keys(S.tpl).sort();
    return '<section class="card sup-card"><h2>🗂 แม่แบบรูปแบบต้นฉบับ</h2><p class="sub">ระบบหยิบไฟล์ต้นฉบับจากโฟลเดอร์ของโรงเรียนให้อัตโนมัติเมื่อครูดาวน์โหลด Excel ครั้งแรกของแต่ละชั้น/วิชา</p>' +
      (ks.length ? '<ul class="sup-list">' + ks.map(function (k) { return '<li><b>' + esc(k.replace('pp5', 'ปพ.5').replace('pp6', 'ปพ.6').replace(/\|/g, ' · ')) + '</b> <small>จาก ' + esc(String(S.tpl[k].name || '').slice(0, 70)) + ' · ' + fmtDate(S.tpl[k].savedAt) + '</small></li>'; }).join('') + '</ul>' : '<p class="sub">ยังไม่มีแม่แบบ</p>') +
      '<button class="btn" id="supSrc">🔄 อ่านรายการไฟล์ในโฟลเดอร์ต้นฉบับใหม่</button></section>';
  }

  // ปีการศึกษาปัจจุบัน (ระบบคิดจากวันที่ หรือแอดมินกำหนดเอง — รองรับการใช้งานต่อเนื่องหลายปี)
  // ---------- อัปเดต / เพิ่ม ปพ.6 ปีเก่า (เช่น นักเรียนย้ายมาจากโรงเรียนอื่น) ----------
  function oldPP6Card() {
    var cy = DB.curYear || 2569, ys = []; for (var y = cy; y >= 2560; y--) ys.push(y);
    var cls = [];
    if (S.roster && S.roster.data) S.roster.data.classes.forEach(function (c) { if (c.stage === 'ป') cls.push(c.level + '/' + c.room); });
    if (!cls.length) for (var l = 1; l <= 6; l++) cls.push(l + '/1', l + '/2');
    var have = {}; S.entries.forEach(function (e) { if (e.slot === 'pp6') have[e.year + '|' + e.level + '/' + e.room] = 1; });
    var oy = S.oldY || cy - 1;
    return '<section class="card sup-card" id="supOld6"><h2>✏️ อัปเดต ปพ.6 ปีเก่า</h2>' +
      '<p class="sub">เพิ่มรายชื่อนักเรียน (เช่น ย้ายมาจากโรงเรียนอื่น) และแก้คะแนน เวลาเรียน คุณลักษณะ ฯลฯ ใน ปพ.6 ของปีที่ผ่านมา · บันทึกแล้วหน้าประกาศผลอัปเดตตาม · ยังไม่มีไฟล์ของห้องนั้น = สร้างใหม่ได้</p>' +
      '<div class="old6"><label>ปีการศึกษา<select id="supOldY">' + ys.map(function (y) { return '<option' + (y === +oy ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></label>' +
      '<div class="old6-c">' + cls.map(function (c) { var h = have[oy + '|' + c]; return '<button class="btn' + (h ? ' has' : '') + '" data-old6="' + c + '" title="' + (h ? 'มีไฟล์ ปพ.6 แล้ว — เปิดแก้ไข' : 'ยังไม่มี — สร้างใหม่') + '">ป.' + c + (h ? ' ✓' : '') + '</button>'; }).join('') + '</div></div>' +
      '<p class="sub" style="margin-top:6px">✓ = มี ปพ.6 ในระบบแล้ว · กดห้องเพื่อเปิดหน้ากรอก ปพ.6 (เปิดในระบบครูด้วยสิทธิ์แอดมิน)</p></section>';
  }
  function openOld6(c) {
    var p = c.split('/'), y = +(S.oldY || $('supOldY').value);
    try {
      localStorage.setItem('pp5-goto', JSON.stringify({ year: y, level: +p[0], room: +p[1], edit: true, section: 'roster', at: Date.now() }));
      var ap = localStorage.getItem('pp5-admin-pin'); if (ap) localStorage.setItem('pp5-pin', ap);
    } catch (e) {}
    var base = window.PP5_HOME || '';
    if (base) window.open(base + '?page=admin', '_top'); else toast('ไม่พบลิงก์ระบบครู', 'err');
  }
  function yearCard() {
    var fixed = DB.curYearFixed;
    return '<section class="card sup-card"><h2>📅 ปีการศึกษาปัจจุบัน</h2><p class="sub">ระบบเปลี่ยนปีให้เองทุกวันที่ 1 พ.ค. (รองรับการใช้งานต่อไปอีกหลายปี) · ถ้าต้องการเปลี่ยนก่อน/หลังกำหนด ตั้งเองได้</p>' +
      '<div class="tiles"><div class="tile"><div class="k">ปีปัจจุบันของระบบ</div><div class="v">' + esc(DB.curYear || '-') + '</div><div class="s">' + (fixed ? 'ตั้งเองโดยแอดมิน' : 'อัตโนมัติตามวันที่') + '</div></div></div>' +
      '<div class="slot-acts"><input id="supYear" inputmode="numeric" placeholder="เช่น 2570" style="width:120px"><button class="btn pri" id="supYearSet">ตั้งปีนี้</button>' + (fixed ? '<button class="btn" id="supYearAuto">กลับเป็นอัตโนมัติ</button>' : '') + '</div></section>';
  }
  // ที่เก็บไฟล์ ปพ.5 / ปพ.6 ใน Google Drive (เฉพาะแอดมิน)
  function driveCard() {
    var L = S.links, files = {};
    S.entries.forEach(function (e) { var k = e.year + '|' + e.level + '|' + e.room; (files[k] = files[k] || []).push(e); });
    return '<section class="card sup-card"><h2>📁 ที่เก็บไฟล์ ปพ.5 / ปพ.6 ใน Google Drive</h2><p class="sub">ไฟล์ทุกห้องที่ครูอัปโหลดหรือระบบสร้างให้ (แสดงเฉพาะหน้าแอดมิน) · ค้นหาด้วยชั้น/ชื่อวิชาได้</p>' +
      (L ? '<div class="slot-acts"><a class="btn pri" href="' + esc(L.root) + '" target="_blank" rel="noopener">📂 เปิดโฟลเดอร์หลัก</a>' + (L.other || []).map(function (o) { return '<a class="btn" href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.name) + '</a>'; }).join('') + '</div>' : '<p class="sub">กำลังโหลดลิงก์...</p>') +
      '<input id="supFileQ" placeholder="🔎 ค้นหา เช่น ป.4-2 หรือ คณิต" style="width:100%;margin:10px 0">' +
      '<div class="sup-files">' + (L ? L.years.map(function (y) {
        return '<div class="sup-fy"><a href="' + esc(y.url) + '" target="_blank" rel="noopener"><b>📂 ' + esc(y.name) + '</b></a><div class="sup-fc">' + y.classes.map(function (c) {
          var m = /(\d)-(\d+)/.exec(c.name), yr = (/(\d{4})/.exec(y.name) || [])[1], fs = m ? files[yr + '|' + m[1] + '|' + m[2]] || [] : [];
          return '<div class="sup-cls" data-q="' + esc((c.name + ' ' + fs.map(function (f) { return f.fileName; }).join(' ')).toLowerCase()) + '"><a href="' + esc(c.url) + '" target="_blank" rel="noopener"><b>' + esc(c.name) + '</b></a> ' +
            fs.map(function (f) { return f.url ? '<a class="chip" href="' + esc(f.url) + '" target="_blank" rel="noopener" title="' + esc(f.fileName) + '">' + (f.slot === 'pp6' ? '📗 ปพ.6' : '📘 ' + esc(SLOT_NAME[f.slot] || 'เพิ่มเติม')) + '</a>' : ''; }).join('') + '</div>';
        }).join('') + '</div></div>';
      }).join('') : '') + '</div></section>';
  }
  // คลังตัวชี้วัด: ชั้นไหน/วิชาไหนมีแล้ว + ดึงจากโฟลเดอร์ต้นฉบับทั้งหมดในครั้งเดียว
  var SLOTS = [['th', 'ไทย'], ['ma', 'คณิต'], ['sci', 'วิทย์'], ['soc', 'สังคม'], ['his', 'ประวัติ'], ['pe', 'สุขศึกษา'], ['art', 'ศิลปะ'], ['work', 'การงาน'], ['eng', 'อังกฤษ'], ['cor', 'ทุจริต']];
  function libEntry(l, s) { var k = l + '|' + s; return (S.lib && S.lib[k]) ? { e: S.lib[k], src: 'file' } : (window.PP5Library && PP5Library.get(l, s) ? { e: PP5Library.get(l, s), src: 'built' } : null); }
  function libCard() {
    var miss = 0, rows = '';
    for (var l = 1; l <= 6; l++) {
      rows += '<tr><th>ป.' + l + '</th>' + SLOTS.map(function (sl) {
        var x = libEntry(l, sl[0]);
        if (!x) { miss++; return '<td class="lib-no">✗</td>'; }
        return '<td class="lib-ok" title="' + esc((x.e.subject || '') + ' · ' + (x.src === 'file' ? 'จากไฟล์ ' + (x.e.from || '') : 'คลังในระบบ')) + '">✓<small>' + x.e.indicators.length + '</small></td>';
      }).join('') + '</tr>';
    }
    return '<section class="card sup-card"><h2>📚 คลังตัวชี้วัด</h2><p class="sub">✓ = มีตัวชี้วัดแล้ว (ตัวเลข = จำนวนตัวชี้วัด) · ✗ = ยังไม่มี · ครูกด "กรอกคะแนน" วิชาที่มีแล้ว ระบบใส่ตัวชี้วัดให้เอง · ยังไม่มี <b>' + miss + '</b> จาก 60</p>' +
      '<div class="tbl-wrap"><table class="lib-tbl"><thead><tr><th></th>' + SLOTS.map(function (s) { return '<th>' + s[1] + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="slot-acts" style="margin-top:10px"><button class="btn pri" id="supLibScan">🔄 ดึงตัวชี้วัดจากโฟลเดอร์ต้นฉบับทั้งหมด</button><span class="sub" id="supLibMsg"></span></div></section>';
  }
  async function scanLib() {
    var msg = $('supLibMsg'), btn = $('supLibScan');
    btn.disabled = true;
    try {
      msg.textContent = 'กำลังอ่านรายการไฟล์...';
      await DB.clearSourceCache();
      var list = (await DB.sourceList()).filter(function (x) { return /\.xlsm$/i.test(x.name) || /ปพ\.?5/.test(x.path + x.name); });
      var added = 0, seen = 0;
      for (var i = 0; i < list.length; i++) {
        msg.textContent = 'อ่านไฟล์ ' + (i + 1) + '/' + list.length + ' : ' + list[i].name;
        try {
          var f = await DB.sourceFile(list[i].id);
          var d = PP5Parser.parseWorkbook(XLSX.read(f.bytes, { type: 'array' }));
          var lv = +d.meta.level, sl = PP5Library.slotOf(d.meta);
          if (!lv || !sl) continue;
          seen++;
          var inds = (d.indicators || []).filter(function (x) { return x.text || x.code; });
          if (!inds.length || (S.lib && S.lib[lv + '|' + sl])) continue;
          var m = d.meta, e = { code: m.code, subject: m.subject, type: m.type, group: m.group, hours: m.hours, credit: m.credit, maxCollect: m.maxCollect, maxFinal: m.maxFinal,
            indicators: inds.map(function (x) { return { idx: x.idx, term: x.term, std: x.std, code: x.code, text: x.text, max: x.max }; }),
            standards: (d.standards || []).filter(function (x) { return x.text; }), from: f.name, at: Date.now() };
          await DB.saveLib(lv + '|' + sl, e);
          S.lib = S.lib || {}; S.lib[lv + '|' + sl] = e; added++;
        } catch (er) { console.warn('scan', list[i].name, er); }
      }
      toast('อ่านไฟล์ ปพ.5 ' + seen + ' ไฟล์ · เพิ่มตัวชี้วัดใหม่ ' + added + ' วิชา', added ? 'ok' : 'info');
      render();
    } catch (e) { toast('ดึงไม่สำเร็จ: ' + e.message, 'err'); btn.disabled = false; msg.textContent = ''; }
  }
  // ===== นำเข้า ปพ.6 ย้อนหลัง (ปีการศึกษาเก่า) — เฉพาะแอดมิน =====
  var IMP = { rows: [] };
  function importCard() {
    var byYear = {};
    S.entries.filter(function (e) { return e.slot === 'pp6'; }).forEach(function (e) { (byYear[e.year] = byYear[e.year] || []).push('ป.' + e.level + '/' + e.room); });
    var yrs = Object.keys(byYear).sort().reverse();
    return '<section class="card sup-card imp-card"><h2>📤 อัปโหลดไฟล์ ปพ.5 / ปพ.6 · นำเข้าย้อนหลัง</h2>' +
      '<p class="sub">อัปโหลดไฟล์ ปพ.5 / ปพ.6 ปีปัจจุบัน หรือ ปพ.6 ปีเก่า (2560–2568) ให้นักเรียนดูย้อนหลังได้ถึง ป.1 · เลือกได้ทีละหลายไฟล์ ระบบอ่านปี/ชั้น/ห้อง/วิชาจากในไฟล์ เก็บแยกตามปี และขึ้นหน้าประกาศผลให้เอง · ทะเบียนรายชื่อ (.docx) อัปโหลดที่การ์ด "ทะเบียนรายชื่อนักเรียน"</p>' +
      '<div class="slot-acts"><button class="btn pri imp-btn" id="supImpBtn">📂 เลือกไฟล์ ปพ.5 / ปพ.6 (เลือกได้หลายไฟล์)</button></div>' +
      '<input type="file" id="supImpFile" accept=".xlsx,.xlsm,.xls" multiple hidden>' +
      (IMP.rows.length ? '<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th class="l">ไฟล์</th><th>ปีการศึกษา</th><th>ชั้น</th><th>นักเรียน</th><th class="l">ผล</th></tr></thead><tbody>' +
        IMP.rows.map(function (r) { return '<tr><td class="l">' + esc(r.name) + '</td><td>' + esc(r.year || '-') + '</td><td>' + esc(r.cls || '-') + '</td><td>' + esc(r.n == null ? '-' : r.n) + '</td><td class="l ' + (r.ok ? 'imp-ok' : r.busy ? '' : 'imp-bad') + '">' + esc(r.msg) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      '<h3 class="sup-h3" style="margin-top:14px">ปพ.6 ที่มีในระบบแล้ว</h3>' +
      (yrs.length ? '<div class="imp-years">' + yrs.map(function (y) { return '<div><b>ปี ' + esc(y) + '</b> ' + byYear[y].sort().map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div>'; }).join('') + '</div>' : '<p class="sub">ยังไม่มี</p>') + '</section>';
  }
  // ใช้ทะเบียนรายชื่อเป็นหลัก: จับคู่ด้วยชื่อ แล้วแก้เลขประจำตัว/เลขที่ให้ตรงทะเบียน
  function rosterFix(all, rec) {
    if (!window.PP5Reconcile || !S.roster || !S.roster.data || !window.PP5Roster) return 0;
    var c = PP5Roster.findClass(S.roster.data, rec.year, 'ป', rec.level, rec.room);
    if (!c || !c.students || !c.students.length) return 0;
    var n = 0;
    all.forEach(function (x) { if (x.data && x._rf !== 1) { var chk = PP5Reconcile.applyRoster(x.data, c.students); x._rf = 1; if (chk) n += chk.diffs.length; } });
    return n;
  }
  // อัปเดตหน้าประกาศผลของห้อง (ปพ.5 ทุกวิชา + ปพ.6) → จำนวนนักเรียนที่ค้นหาได้
  async function publishCls(year, level, room) {
    var all = S.entries.filter(function (e) { return e.year === year && e.level === level && e.room === room; })
      .map(function (e) { return { key: e.key, slot: e.slot, year: e.year, level: e.level, room: e.room }; });
    if (!all.length) return 0;
    await DB.ensureData(all);
    all = all.filter(function (x) { return x.data; });
    if (!all.length) return 0;
    rosterFix(all, all[0]);
    var pub = PP5Publish.compileClass(impCtx(all[0], all));
    if (pub.students.length) { var st = await DB.publish(pub.key, pub); S.pub[pub.key] = st || { count: pub.students.length, updatedAt: Date.now() }; }
    return pub.students.length;
  }
  function pubCard() {
    var cy = DB.curYear || 2569, y = S.pubY || cy, ys = {};
    S.entries.forEach(function (e) { ys[e.year] = 1; }); ys[cy] = 1;
    var yl = Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });
    var cls = {};
    S.entries.filter(function (e) { return e.year === y; }).forEach(function (e) {
      var k = e.year + '|' + e.level + '|' + e.room, c = cls[k] = cls[k] || { level: e.level, room: e.room, n: 0, last: 0 };
      c.n++; c.last = Math.max(c.last, e.uploadedAt || 0);
    });
    var keys = Object.keys(cls).sort(function (a, b) { var x = cls[a], z = cls[b]; return x.level - z.level || x.room - z.room; });
    var stale = keys.filter(function (k) { var p = S.pub[k]; return !p || (cls[k].last && cls[k].last > (p.updatedAt || 0)); });
    return '<section class="card sup-card" id="supPub"><h2>📢 อัปเดตหน้าประกาศผล</h2>' +
      '<p class="sub">ครูบันทึก/อัปโหลดแล้ว หน้าประกาศผลยังไม่เปลี่ยนจนกว่าแอดมินกดอัปเดตที่นี่ · ระบบใช้ทะเบียนรายชื่อเป็นหลัก (แก้เลขประจำตัว/เลขที่ให้ตรงชื่อในทะเบียนให้อัตโนมัติ)</p>' +
      '<div class="pubc-top"><label>ปีการศึกษา <select id="supPubY">' + yl.map(function (v) { return '<option' + (v === +y ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></label>' +
      (keys.length ? '<button class="btn pri" data-pubc="stale"' + (stale.length ? '' : ' disabled') + '>🔄 อัปเดตห้องที่มีข้อมูลใหม่ (' + stale.length + ')</button><button class="btn" data-pubc="all">อัปเดตทุกห้อง (' + keys.length + ')</button>' : '') + '</div>' +
      (keys.length ? '<div class="pubc-list">' + keys.map(function (k) {
        var c = cls[k], p = S.pub[k], isStale = stale.indexOf(k) >= 0;
        return '<div class="pubc' + (isStale ? ' stale' : '') + '"><b>ป.' + c.level + '/' + c.room + '</b><small>' + c.n + ' ไฟล์ · ' +
          (p ? 'ประกาศ ' + (p.count || 0) + ' คน · ' + fmtDate(p.updatedAt) : 'ยังไม่เคยประกาศ') + '</small>' +
          (isStale ? '<span class="pubc-new">มีข้อมูลใหม่</span>' : '<span class="pubc-ok">✓ ล่าสุดแล้ว</span>') +
          '<button class="btn' + (isStale ? ' pri' : '') + '" data-pubc="' + k + '">อัปเดต</button></div>';
      }).join('') + '</div>' : '<p class="sub">ยังไม่มีไฟล์ ปพ. ของปีนี้</p>') +
      '<div class="pubc-msg" id="supPubMsg"></div></section>';
  }
  async function pubRun(keys) {
    var msg = $('supPubMsg'), ok = 0, ppl = 0;
    for (var i = 0; i < keys.length; i++) {
      var p = keys[i].split('|');
      if (msg) msg.textContent = 'กำลังอัปเดต ป.' + p[1] + '/' + p[2] + ' (' + (i + 1) + '/' + keys.length + ')...';
      try { ppl += await publishCls(+p[0], +p[1], +p[2]); ok++; } catch (e) { toast('ป.' + p[1] + '/' + p[2] + ': ' + e.message, 'err'); }
    }
    try { S.pub = await DB.publicStatus(); } catch (e) {}
    toast('อัปเดตหน้าประกาศผลแล้ว ' + ok + ' ห้อง (' + ppl + ' คน)', 'ok');
    render(); var c = $('supPub'); if (c) c.scrollIntoView({ block: 'start' });
  }
  function impCtx(rec, all) {
    all = all || [rec];
    var cls = { year: rec.year, level: rec.level, room: rec.room };
    var p5 = all.filter(function (x) { return x.slot !== 'pp6'; }), p6 = all.filter(function (x) { return x.slot === 'pp6'; })[0] || null;
    var rc = { esc: esc, toast: toast, classRecords: function () { return p5; }, pp6Record: function () { return p6; }, brand: function () { return null; }, sig: function () { return null; } };
    return { esc: esc, toast: toast, store: function () { return DB; }, classInfo: function () { return cls; }, classRecords: function () { return p5; }, pp6Record: function () { return p6; },
      className: function () { return 'ป.' + cls.level + '/' + cls.room; }, reportCtx: rc,
      rosterById: function () { return S.roster && S.roster.data && window.PP5Roster ? PP5Roster.byId(S.roster.data) : {}; },   // เลขบัตร 4 ตัวท้ายจากทะเบียน (ยืนยันตัวตนผู้ปกครอง)
      classRoster: function () { var c = S.roster && S.roster.data && window.PP5Roster ? PP5Roster.findClass(S.roster.data, cls.year, 'ป', cls.level, cls.room) : null; return c ? c.students : null; } };
  }
  async function importFiles(files) {
    IMP.rows = Array.prototype.map.call(files, function (f) { return { name: f.name, msg: 'รอ...', busy: true }; });
    render();
    for (var i = 0; i < files.length; i++) {
      var f = files[i], row = IMP.rows[i];
      row.msg = 'กำลังอ่าน...'; render();
      try {
        var u8 = new Uint8Array(await f.arrayBuffer());
        var wb = XLSX.read(u8, { type: 'array' });
        var is6 = PP6Parser.isPP6(wb), data, m, slot, fname;
        if (is6) { data = PP5Model.fillPP6(PP6Parser.parse(wb, u8), false); m = data.meta; slot = 'pp6'; fname = (m.levelName || ('ป.' + m.level)) + '-' + m.room + '_ปพ6_รายงานผลรายบุคคล_ปี' + m.year + '.xlsx'; }
        else {
          data = PP5Model.fillPP5(PP5Parser.parseWorkbook(wb), false); m = data.meta;
          slot = PP5Library.slotOf(m) || ('x-' + String(m.code || m.subject || 'วิชา').replace(/\s+/g, ''));
          fname = (m.levelName || ('ป.' + m.level)) + '-' + m.room + '_' + (m.code || '') + '_' + (m.subject || '') + '_ปี' + m.year + '.xlsm';
        }
        if (!m.year || !m.level || !m.room) throw new Error('ไม่พบปีการศึกษา/ชั้น/ห้องในไฟล์');
        row.year = m.year; row.cls = 'ป.' + m.level + '/' + m.room + (is6 ? ' · ปพ.6' : ' · ' + (m.subject || '')); row.n = data.students.length;
        var key = m.year + '|' + m.level + '|' + m.room + '|' + slot, old = S.entries.filter(function (e) { return e.key === key; })[0];
        var rec = { key: key, year: m.year, level: m.level, room: m.room, slot: slot, data: data, origName: f.name, size: f.size, uploadedAt: Date.now(),
          fileName: fname.replace(/[\\/:*?"<>|]+/g, '-'), blob: new Blob([u8], { type: f.type || 'application/octet-stream' }) };
        row.msg = 'กำลังบันทึก...'; render();
        var saved = await DB.put(rec);
        S.entries = S.entries.filter(function (e) { return e.key !== key; }).concat([saved || rec]);
        row.msg = 'กำลังขึ้นหน้าประกาศผล...'; render();
        // รวมทุกไฟล์ของห้องนี้ (ปพ.5 ทุกวิชา + ปพ.6) แล้วประกาศผลของห้อง
        var cls = S.entries.filter(function (e) { return e.year === m.year && e.level === m.level && e.room === m.room && e.key !== key; }).map(function (e) { return { key: e.key, slot: e.slot, year: e.year, level: e.level, room: e.room }; });
        if (cls.length) await DB.ensureData(cls);
        cls.push(rec);
        rosterFix(cls, rec);
        var pub = PP5Publish.compileClass(impCtx(rec, cls.filter(function (x) { return x.data; })));
        if (pub.students.length) await DB.publish(pub.key, pub);
        row.ok = true; row.busy = false; row.msg = (old ? '✓ แทนที่ของเดิม' : '✓ นำเข้าแล้ว') + ' · ประกาศผล ' + pub.students.length + ' คน';
      } catch (e) { row.ok = false; row.busy = false; row.msg = '✗ ' + (e && e.message ? e.message : e); }
      render();
    }
    try { S.pub = await DB.publicStatus(); } catch (e) {}
    var ok = IMP.rows.filter(function (r) { return r.ok; }).length;
    toast('นำเข้า ปพ.6 ย้อนหลังแล้ว ' + ok + ' จาก ' + IMP.rows.length + ' ไฟล์', ok === IMP.rows.length ? 'ok' : 'info');
    render();
  }
  // ===== ข้อมูลในระบบ: ที่เก็บไฟล์ + ล้างข้อมูลทั้งหมด (ย้ายมาจากหน้าครู) =====
  function dataCard() {
    return '<section class="card sup-card"><h2>🗄 ข้อมูลในระบบ</h2>' +
      '<p class="sub">ไฟล์และคะแนนทั้งหมดเก็บใน Google Drive ของผู้ดูแลระบบ · ระบบเก็บเฉพาะเลขบัตรประชาชน 4 ตัวท้าย (ใช้ยืนยันตัวตนผู้ปกครอง)</p>' +
      '<div class="slot-acts">' + (S.links ? '<a class="btn pri" href="' + esc(S.links.root) + '" target="_blank" rel="noopener">📂 เปิดโฟลเดอร์ใน Google Drive</a>' : '') +
      '<button class="btn danger" id="supClearAll">🗑 ล้างข้อมูลทั้งหมด</button></div>' +
      '<p class="sub" style="margin-top:6px">ล้างข้อมูลทั้งหมด = ลบไฟล์ ปพ.5 / ปพ.6 และคะแนนทุกห้องออกจากระบบ (ไฟล์ใน Drive ย้ายไปถังขยะ กู้คืนได้ภายใน 30 วัน) · ทะเบียนรายชื่อ โลโก้ และลายเซ็นไม่ถูกลบ</p></section>';
  }
  function histCard() {
    return '<section class="card sup-card"><h2>📚 ผลการเรียนย้อนหลังรายคน / ผลจากโรงเรียนอื่น</h2><p class="sub">ค้นด้วยเลขประจำตัวนักเรียน เห็นทุกปีตั้งแต่ ป.1 ถึงปีปัจจุบัน · ปีที่นักเรียนยังไม่ได้เรียนที่นี่ (ย้ายมา) เพิ่มผลการเรียนจากโรงเรียนเดิมได้</p><div id="supHist"></div></section>';
  }
  function pinCard() {
    return '<section class="card sup-card"><h2>🔑 รหัสเข้าใช้</h2><p class="sub">รหัสระบบโรงเรียน (แก้ได้ทุกชั้นทุกวิชา) รหัสผู้อำนวยการ และรหัสแอดมิน ตั้งไว้ใน Code.gs (TEACHER_PIN / DIRECTOR_PIN / ADMIN_PIN) · รหัสครูรายบุคคลตั้งที่การ์ด "ครูรายบุคคล" ด้านบน</p></section>';
  }

  // ---------- ครูรายบุคคล (ชื่อ + รหัสเบอร์โทร 4 ตัวท้าย) ----------
  function normName(n) { return String(n || '').replace(/^\s*(น\.ส\.|นส\.)\s*/, 'นางสาว').replace(/^\s*(นาย|นางสาว|นาง)\s+/, '$1').replace(/\s+/g, ' ').trim(); }
  function sameName(a, b) { return window.PP5Teachers ? PP5Teachers.same(a, b) : normName(a) === normName(b); }
  // อ่านรายชื่อที่วางมา (เช่น "1. ชื่อ-สกุล / อีเมล / เบอร์โทร 10 หลัก") → [{ name, pin }] เก็บเฉพาะ 4 ตัวท้ายของเบอร์
  function parseKru(text) {
    var out = [], cur = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var t = line.trim(); if (!t) return;
      var m = t.match(/^\d{1,3}\s*[.)]\s*(.+)$/);
      if (m && !/@/.test(m[1]) && !/^[\d\s\-]+$/.test(m[1])) { cur = { name: normName(m[1]), pin: '' }; out.push(cur); return; }
      var d = t.replace(/[\s\-]/g, '');
      if (cur && !cur.pin && /^0\d{8,9}$/.test(d)) cur.pin = d.slice(-4);
    });
    return out;
  }
  function kruCard() {
    var L = S.kru || [];
    return '<section class="card sup-card" id="supKru"><h2>👩‍🏫 ครูรายบุคคล <small class="muted">(' + L.length + ' คน)</small></h2>' +
      '<p class="sub">ครูแต่ละคนเข้าระบบด้วย <b>เบอร์โทร 4 ตัวท้าย</b> แล้วทำได้เฉพาะวิชา/ห้องที่ตัวเองสอน (ตั้งตามตารางสอนให้อัตโนมัติเมื่อเข้าครั้งแรก ครูเพิ่ม/ลดเองได้) · ปพ.6 ครูเลือกห้องประจำชั้นเอง · ระบบเก็บแค่ชื่อและรหัส 4 หลัก ไม่เก็บอีเมล/เบอร์เต็ม</p>' +
      '<div class="tbl-wrap"><table class="kru-tbl"><thead><tr><th>#</th><th class="l">ชื่อครู</th><th>รหัส (4 หลัก)</th><th>วิชาที่สอน</th><th>ปพ.6 ประจำชั้น</th><th></th></tr></thead><tbody>' +
      L.map(function (k, i) {
        return '<tr><td>' + (i + 1) + '</td><td class="l"><input data-kn="' + i + '" value="' + esc(k.name) + '"></td><td><input class="kru-pin" data-kp="' + i + '" value="' + esc(k.pin) + '" inputmode="numeric" maxlength="4"></td>' +
          '<td>' + (k.subs ? k.subs.length + ' วิชา' : '<span class="muted">ตั้งตามตารางสอนเมื่อเข้าครั้งแรก</span>') + '</td><td>' + ((k.pp6 || []).map(function (c) { return 'ป.' + esc(c); }).join(', ') || '-') + '</td>' +
          '<td><button class="btn" data-kreset="' + i + '" title="ให้ระบบตั้งวิชาตามตารางสอนใหม่ตอนครูเข้าครั้งถัดไป">↺</button> <button class="btn danger" data-kdel="' + i + '">ลบ</button></td></tr>';
      }).join('') + (L.length ? '' : '<tr><td colspan="6">ยังไม่มีครู — วางรายชื่อด้านล่าง หรือกด "+ เพิ่มครู"</td></tr>') + '</tbody></table></div>' +
      '<div class="slot-acts"><button class="btn" id="supKruAdd">+ เพิ่มครู</button><button class="btn pri" id="supKruSave">💾 บันทึกรายชื่อครู</button></div>' +
      '<details class="kru-imp"' + (L.length ? '' : ' open') + '><summary>📋 วางรายชื่อครูทีเดียว (ชื่อ + เบอร์โทร)</summary>' +
      '<p class="sub">วางข้อความรายชื่อแบบ "1. ชื่อ-สกุล" ตามด้วยอีเมล/เบอร์โทรในบรรทัดถัดไป ระบบจะดึงชื่อและ 4 ตัวท้ายของเบอร์โทรให้ (อีเมลไม่ถูกเก็บ) · ชื่อที่มีอยู่แล้วจะอัปเดตรหัส</p>' +
      '<textarea id="supKruTxt" rows="7" placeholder="1. นายสมชาย ใจดี&#10;somchai@gmail.com&#10;0812345678"></textarea>' +
      '<div class="slot-acts"><button class="btn pri" id="supKruParse">อ่านรายชื่อ</button></div></details></section>';
  }
  function kruFromForm() {
    return (S.kru || []).map(function (k, i) {
      var n = document.querySelector('[data-kn="' + i + '"]'), p = document.querySelector('[data-kp="' + i + '"]');
      return Object.assign({}, k, { name: n ? normName(n.value) : k.name, pin: p ? p.value.trim() : k.pin });
    });
  }
  async function kruSave(list, msg) {
    try { S.kru = await DB.kruSave(list); toast(msg || 'บันทึกรายชื่อครูแล้ว', 'ok'); render(); var c = $('supKru'); if (c) c.scrollIntoView({ block: 'start' }); }
    catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'err'); }
  }
  function kruClick(e) {
    var t = e.target;
    if (t.id === 'supKruAdd') { S.kru = kruFromForm().concat([{ name: '', pin: '', subs: null, pp6: [] }]); render(); var c = $('supKru'); if (c) { c.scrollIntoView({ block: 'start' }); var ins = c.querySelectorAll('[data-kn]'); if (ins.length) ins[ins.length - 1].focus(); } return true; }
    if (t.id === 'supKruSave') { kruSave(kruFromForm().filter(function (k) { return k.name; })); return true; }
    if (t.dataset && t.dataset.kdel != null) { var L = kruFromForm(), k = L[+t.dataset.kdel]; if (confirm('ลบครู ' + (k.name || '') + ' ออกจากระบบ? (ไฟล์ที่ครูทำไว้ยังอยู่)')) { L.splice(+t.dataset.kdel, 1); kruSave(L, 'ลบแล้ว'); } return true; }
    if (t.dataset && t.dataset.kreset != null) { var L2 = kruFromForm(); L2[+t.dataset.kreset].subs = null; kruSave(L2, 'จะตั้งวิชาตามตารางสอนใหม่เมื่อครูเข้าระบบครั้งถัดไป'); return true; }
    if (t.id === 'supKruParse') {
      var got = parseKru($('supKruTxt').value);
      if (!got.length) { toast('ไม่พบรายชื่อ — ใช้รูปแบบ "1. ชื่อ-สกุล" แล้วตามด้วยเบอร์โทร', 'err'); return true; }
      var L3 = kruFromForm(), add = 0, upd = 0, miss = [];
      got.forEach(function (g) {
        if (!g.pin) miss.push(g.name);
        var old = L3.filter(function (k) { return sameName(k.name, g.name); })[0];
        if (old) { if (g.pin) { old.pin = g.pin; upd++; } }
        else { L3.push({ name: g.name, pin: g.pin, subs: null, pp6: [] }); add++; }
      });
      if (miss.length) { S.kru = L3; render(); toast('ไม่พบเบอร์โทรของ: ' + miss.join(', ') + ' — ใส่รหัสในตารางแล้วกดบันทึก', 'err'); return true; }
      kruSave(L3, 'เพิ่มครู ' + add + ' คน · อัปเดตรหัส ' + upd + ' คน');
      return true;
    }
    return false;
  }

  function render() {
    $('sup').innerHTML = '<div class="bnr" style="--bc:#7f1d1d"><div class="bi">🛡</div><div><div class="bk">เฉพาะผู้ดูแลระบบหลัก</div><div class="bt">ระบบผู้ดูแล (แอดมิน)</div><div class="bs">แยกจากระบบครู · ครูไม่เห็นหน้านี้</div></div></div>' +
      pubCard() + oldPP6Card() + '<div class="sup-grid">' + flagsCard() + rosterCard() + '</div>' + kruCard() + importCard() + libCard() + histCard() + driveCard() + yearCard() + brandCard() + overviewCard() + tplCard() + dataCard() + pinCard();
    if (window.PP5History) PP5History.mount($('supHist'), { store: DB, toast: toast });
    var main = $('sup');
    main.oninput = function (e) {
      if (e.target.id !== 'supFileQ') return;
      var q = e.target.value.trim().toLowerCase();
      Array.prototype.forEach.call(main.querySelectorAll('.sup-cls'), function (c) { c.hidden = q && c.dataset.q.indexOf(q) < 0; });
    };
    main.onchange = async function (e) {
      if (e.target.dataset.flag) return saveFlags();
      if (e.target.id === 'supPubY') { S.pubY = +e.target.value; render(); var cp = $('supPub'); if (cp) cp.scrollIntoView({ block: 'start' }); return; }
      if (e.target.id === 'supOldY') { S.oldY = +e.target.value; render(); var c6 = $('supOld6'); if (c6) c6.scrollIntoView({ block: 'start' }); return; }
      if (e.target.id === 'supRosterFile' && e.target.files[0]) return uploadRoster(e.target.files[0]);
      if (e.target.id === 'supImgFile' && e.target.files[0]) return uploadImg(e.target.files[0]);
      if (e.target.id === 'supImpFile' && e.target.files.length) { var fl = Array.prototype.slice.call(e.target.files); e.target.value = ''; return importFiles(fl); }
    };
    main.onclick = function (e) {
      if (kruClick(e)) return;
      var o6 = e.target.closest('[data-old6]'); if (o6) { openOld6(o6.dataset.old6); return; }
      var pc = e.target.closest('[data-pubc]');
      if (pc) {
        var v = pc.dataset.pubc, y = S.pubY || DB.curYear, ks;
        Array.prototype.forEach.call(document.querySelectorAll('[data-pubc]'), function (b) { b.disabled = true; });
        if (v === 'all' || v === 'stale') {
          var set = {}; S.entries.filter(function (x) { return x.year === +y; }).forEach(function (x) { var k = x.year + '|' + x.level + '|' + x.room; set[k] = Math.max(set[k] || 0, x.uploadedAt || 0); });
          ks = Object.keys(set).filter(function (k) { return v === 'all' || !S.pub[k] || set[k] > (S.pub[k].updatedAt || 0); });
        } else ks = [v];
        pubRun(ks); return;
      }
      var b = e.target.closest('[data-fl]');
      if (b) { Array.prototype.forEach.call(main.querySelectorAll('[data-flag]'), function (c) { c.checked = b.dataset.fl === 'all1'; }); saveFlags(); return; }
      var up = e.target.closest('[data-up]'), rm = e.target.closest('[data-rm]');
      if (up) { pendingImg = up.dataset.up; $('supImgFile').value = ''; $('supImgFile').click(); return; }
      if (rm && confirm('ลบรูปนี้?')) { saveBrand(imgPatch(rm.dataset.rm, null), 'ลบรูปแล้ว'); return; }
      if (e.target.id === 'supLibScan') { scanLib(); return; }
      if (e.target.closest('#supImpBtn')) { $('supImpFile').value = ''; $('supImpFile').click(); return; }
      if (e.target.id === 'supClearAll') {
        if (!confirm('ล้างข้อมูลทั้งหมด?\nไฟล์ ปพ.5 / ปพ.6 และคะแนนทุกห้อง ' + S.entries.length + ' ไฟล์จะถูกลบออกจากระบบ')) return;
        if (prompt('พิมพ์คำว่า ลบทั้งหมด เพื่อยืนยัน') !== 'ลบทั้งหมด') { toast('ยกเลิกแล้ว', 'info'); return; }
        DB.clear().then(function () { S.entries = []; toast('ล้างข้อมูลแล้ว', 'info'); render(); }, function (er) { toast(er.message, 'err'); });
        return;
      }
      if (e.target.id === 'supYearSet') { var y = +$('supYear').value; if (!(y > 2500)) { toast('ใส่ปี พ.ศ. เช่น 2570', 'err'); return; } DB.setCurYear(y).then(function () { DB.curYearFixed = true; toast('ตั้งปีการศึกษาปัจจุบันเป็น ' + y + ' แล้ว', 'ok'); render(); }, function (er) { toast(er.message, 'err'); }); return; }
      if (e.target.id === 'supYearAuto') { DB.setCurYear(0).then(function () { DB.curYearFixed = false; toast('กลับเป็นอัตโนมัติตามวันที่แล้ว', 'ok'); render(); }, function (er) { toast(er.message, 'err'); }); return; }
      if (e.target.id === 'supBrandSave') { saveBrand(textPatch(), 'บันทึกชื่อและตำแหน่งแล้ว'); return; }
      if (e.target.id === 'supRosterUp') { $('supRosterFile').value = ''; $('supRosterFile').click(); }
      if (e.target.id === 'supSrc') { DB.clearSourceCache().then(function (n) { toast('อ่านโฟลเดอร์ต้นฉบับใหม่แล้ว พบ ' + n + ' ไฟล์', 'ok'); }, function (er) { toast(er.message, 'err'); }); }
    };
  }
  var pendingImg = null;
  function imgPatch(key, img) { var p = {}; if (key === 'logo') p.logo = img; else p[key] = { img: img }; return p; }
  function textPatch() {
    var p = { director: {}, deputy: {} };
    Array.prototype.forEach.call(document.querySelectorAll('[data-b]'), function (i) {
      var k = i.dataset.b.split('.');
      if (k.length === 1) p[k[0]] = i.value.trim(); else p[k[0]][k[1]] = i.value.trim();
    });
    return p;
  }
  async function uploadImg(file) {
    try {
      var logo = pendingImg === 'logo';
      var img = await PP5Img.prepare(file, logo ? { maxW: 400, maxH: 400 } : { maxW: 600, maxH: 260, clearWhite: true });
      await saveBrand(Object.assign(textPatch(), imgPatch(pendingImg, img)), logo ? 'บันทึกโลโก้แล้ว' : 'บันทึกลายเซ็นแล้ว');
    } catch (e) { toast('อัปโหลดไม่สำเร็จ: ' + e.message, 'err'); }
  }
  async function saveBrand(patch, msg) {
    try { await DB.saveBrand(patch); S.brand = await DB.getBrand(); toast(msg, 'ok'); render(); }
    catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'err'); }
  }
  async function saveFlags() {
    var nf = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-flag]'), function (c) { nf[c.dataset.flag] = c.checked; });
    try { await DB.setFlags(nf); toast('บันทึกการเปิด-ปิดระบบแล้ว', 'ok'); } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'err'); }
  }
  async function uploadRoster(file) {
    try {
      var bytes = new Uint8Array(await file.arrayBuffer());
      var data = await PP5Roster.parseDocx(bytes);
      var nd = data.date ? data.date.display : (data.dateText || 'ไม่ระบุวันที่');
      if (!confirm('ใช้ทะเบียนรายชื่อข้อมูลวันที่ ' + nd + ' (' + data.total + ' คน ' + data.classes.length + ' ห้อง) เป็นข้อมูลหลักของระบบ?')) return;
      S.roster = await DB.putRoster({ fileName: file.name, bytes: bytes, data: data });
      toast('อัปเดตทะเบียนรายชื่อแล้ว', 'ok'); render();
    } catch (e) { toast('อ่านไฟล์ไม่ได้: ' + e.message, 'err'); }
  }

  function bootDone() { var bl = document.getElementById('bootLoader'); if (bl) { bl.classList.add('done'); setTimeout(function () { bl.remove(); }, 400); } }
  async function boot() {
    try {
      await DB.open();
      if (DB.role !== 'admin') { bootDone(); $('sup').innerHTML = '<div class="card empty-state"><b>หน้านี้สำหรับผู้ดูแลระบบหลักเท่านั้น</b></div>'; return; }
      acts();
      var bt = document.getElementById('bootText'); if (bt) bt.textContent = 'กำลังโหลดข้อมูลทุกห้อง...';
      var r = await Promise.all([DB.all(), DB.publicStatus().catch(function () { return {}; }), DB.getRoster().catch(function () { return null; }), DB.templateInfo().catch(function () { return {}; }),
        DB.getBrand().catch(function () { return null; }), DB.getSigs().catch(function () { return {}; }), DB.getLib().catch(function () { return {}; }), DB.kruList ? DB.kruList().catch(function () { return []; }) : []]);
      S.entries = r[0] || []; S.pub = r[1] || {}; S.roster = r[2]; S.tpl = r[3] || {}; S.brand = r[4]; S.sigs = r[5] || {}; S.lib = r[6] || {}; S.kru = r[7] || [];
      render();
      bootDone();
      DB.folderLinks().then(function (l) { S.links = l; render(); }, function (er) { console.warn('links', er); });
    } catch (e) { bootDone(); $('sup').innerHTML = '<div class="card empty-state"><b>เข้าระบบไม่สำเร็จ</b>' + esc(e.message) + '</div>'; }
  }
  boot();
})();
