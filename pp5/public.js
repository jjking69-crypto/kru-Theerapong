/* หน้าประกาศผลการเรียนสำหรับผู้ปกครอง: แสดงผลกลางปี (คะแนน) และปลายปี (เกรด) ของนักเรียนหนึ่งคน */
(function () {
  'use strict';

  function esc(v) {
    return v == null ? '' : String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function d(v, n) {
    if (v == null || v === '') return '<span class="pub-mute">–</span>';
    if (typeof v === 'number') return n != null ? v.toFixed(n) : String(Math.round(v * 100) / 100);
    return esc(v);
  }
  function gradeChip(g) {
    if (g == null || g === '') return '<span class="pub-g pub-g-none">–</span>';
    var n = typeof g === 'number' ? g : parseFloat(g);
    if (!isFinite(n)) return '<span class="pub-g pub-g-x">' + esc(g) + '</span>';
    return '<span class="pub-g pub-g-' + String(n).replace('.', '') + '">' + (n % 1 ? n.toFixed(1) : n) + '</span>';
  }
  function pctBar(p) {
    if (p == null) return '';
    var w = Math.max(0, Math.min(100, p));
    return '<span class="pub-bar"><i style="width:' + w.toFixed(0) + '%" class="' + (w < 50 ? 'low' : w < 70 ? 'mid' : '') + '"></i></span>';
  }
  // ระดับผลภาคเรียนที่ 1 (เต็ม 50): ร้อยละ 80 ขึ้นไป ดีมาก · 60–79 ดี · ต่ำกว่า 60 พัฒนา
  function lv50(total, max) {
    if (total == null || !max) return '';
    var p = total / max * 100, t = p >= 80 ? ['ดีมาก', 'a'] : p >= 60 ? ['ดี', 'b'] : ['พัฒนา', 'c'];
    return '<span class="pub-lv pub-lv-' + t[1] + '">' + t[0] + '</span>';
  }
  var VIEW = 'grid';   // grid = การ์ดวิชาเรียงแนวนอน (สั้น อ่านง่าย) · table = ตาราง
  function short(n) { return String(n || '').replace('สังคมศึกษา ศาสนา และวัฒนธรรม', 'สังคมศึกษาฯ').replace('วิทยาศาสตร์และเทคโนโลยี', 'วิทยาศาสตร์ฯ').replace('ภาษาอังกฤษพื้นฐาน', 'ภาษาอังกฤษ').replace('สุขศึกษาและพลศึกษา', 'สุขศึกษาฯ'); }
  function midGrid(mid) {
    return '<div class="pub-sgrid">' + mid.subjects.map(function (s) {
      var tot = s.total != null ? s.total : (s.collect != null || s.exam != null ? (s.collect || 0) + (s.exam || 0) : null);
      return '<div class="pub-sc"><div class="pub-sc-n" title="' + esc(s.name) + '">' + esc(short(s.name)) + '</div>' +
        '<div class="pub-sc-v">' + d(tot) + '<small>/' + mid.max + '</small></div>' + (lv50(tot, mid.max) || '<span class="pub-lv">–</span>') +
        '<div class="pub-sc-s">เก็บ ' + d(s.collect) + ' · สอบ ' + d(s.exam) + '</div></div>';
    }).join('') + '</div>';
  }
  function finalGrid(f) {
    return '<div class="pub-sgrid">' + f.subjects.map(function (s) {
      return '<div class="pub-sc' + (s.basic === false ? ' extra' : '') + '"><div class="pub-sc-n" title="' + esc(s.name) + '">' + esc(short(s.name)) + '</div>' +
        '<div class="pub-sc-g">' + gradeChip(s.grade) + '</div>' +
        '<div class="pub-sc-s">' + (s.total != null ? 'รวม ' + d(s.total) + '/100' : 'รวม –') + (s.credit ? ' · ' + d(s.credit, 1) + ' นก.' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  function tile(k, v, s, cls) { return '<div class="pub-tile ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s || '') + '</div></div>'; }

  function midView(mid) {
    if (!mid) return '<div class="pub-empty"><div class="ic">🕒</div><b>ยังไม่ประกาศผลกลางปี</b>กรุณาติดตามประกาศจากโรงเรียน</div>';
    var h = mid.partial ? '<p class="pub-note">บางวิชาครูยังกรอกคะแนนไม่ครบ (แสดงเป็น –)</p>' : '';
    var tot = 0, max = 0;
    if (mid.source === 'pp6') {
      mid.subjects.forEach(function (s) { if (s.total != null) { tot += s.total; max += mid.max; } });
      var avg = max ? tot / max * 100 : null;
      h += '<div class="pub-tiles">' + tile('คะแนนรวม', d(tot) + '<small>/' + max + '</small>', 'จาก ' + mid.subjects.filter(function (s) { return s.total != null; }).length + ' วิชา') +
        tile('คิดเป็นร้อยละ', d(avg, 1), pctBar(avg)) +
        tile('เวลาเรียน', mid.attendance && mid.attendance.pct != null ? d(mid.attendance.pct, 1) + '<small>%</small>' : d(null), mid.attendance && mid.attendance.total ? 'มาเรียน ' + d(mid.attendance.present) + ' จาก ' + d(mid.attendance.total) + ' ชม.' : '') + '</div>';
      if (VIEW === 'grid') h += midGrid(mid);
      else h += '<div class="pub-tbl-wrap"><table class="pub-tbl"><thead><tr><th class="l">รายวิชา</th><th>คะแนนเก็บ</th><th>คะแนนสอบ</th><th>รวม<small>เต็ม ' + mid.max + '</small></th><th>ผลการเรียน</th></tr></thead><tbody>' +
        mid.subjects.map(function (s) {
          var tot = s.total != null ? s.total : (s.collect != null || s.exam != null ? (s.collect || 0) + (s.exam || 0) : null);
          return '<tr><td class="l"><b>' + esc(s.name) + '</b><small>' + esc(s.code) + '</small></td><td data-l="คะแนนเก็บ">' + d(s.collect) + '</td><td data-l="คะแนนสอบ">' + d(s.exam) + '</td>' +
            '<td class="pub-strong" data-l="รวม (เต็ม ' + mid.max + ')">' + d(tot) + pctBar(tot == null ? null : tot / mid.max * 100) + '</td><td data-l="ผลการเรียน">' + (lv50(tot, mid.max) || d(null)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      h += '<p class="pub-legend">ภาคเรียนที่ 1 เต็ม ' + mid.max + ' (คะแนนเก็บ + คะแนนสอบ) · <span class="pub-lv pub-lv-a">ดีมาก</span> 40 ขึ้นไป · <span class="pub-lv pub-lv-b">ดี</span> 30–39 · <span class="pub-lv pub-lv-c">พัฒนา</span> ต่ำกว่า 30</p>';
    } else {
      h += '<div class="pub-tbl-wrap"><table class="pub-tbl"><thead><tr><th class="l">รายวิชา</th><th>คะแนนเก็บภาคเรียนที่ 1</th><th>ร้อยละ</th></tr></thead><tbody>' +
        mid.subjects.map(function (s) {
          var p = s.collect == null || !s.collectMax ? null : s.collect / s.collectMax * 100;
          return '<tr><td class="l"><b>' + esc(s.name) + '</b><small>' + esc(s.code) + '</small></td><td class="pub-strong" data-l="คะแนนเก็บ">' + d(s.collect) + '<small> / ' + d(s.collectMax) + '</small></td><td data-l="ร้อยละ">' + d(p, 0) + pctBar(p) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      if (mid.attendance && mid.attendance.pct != null) h += '<p class="pub-note">เวลาเรียนภาคเรียนที่ 1 ร้อยละ ' + d(mid.attendance.pct, 1) + '</p>';
    }
    return h;
  }

  function evalsHtml(f) {
    var h = '';
    var ev = [];
    if (f.ind) ev.push(['ผลการประเมินตัวชี้วัด', f.ind.total ? 'ผ่าน ' + f.ind.passed + ' จาก ' + f.ind.total + ' ตัวชี้วัด' : '–', f.ind.total ? f.ind.passed >= f.ind.total : null]);
    if (f.chars) ev.push(['คุณลักษณะอันพึงประสงค์', f.chars, ['ดีเยี่ยม', 'ดี', 'ผ่าน'].indexOf(f.chars) >= 0]);
    if (f.rtw) ev.push(['การอ่าน คิดวิเคราะห์ และเขียน', f.rtw, f.rtw !== 'ไม่ผ่าน']);
    (f.acts || []).forEach(function (a) { ev.push([a[0], a[1] || '–', a[1] ? a[1] === 'ผ่าน' : null]); });
    if (ev.length) {
      h += '<h3 class="pub-h3">ผลการประเมินด้านอื่น ๆ</h3><div class="pub-evals">' + ev.map(function (e) {
        return '<div class="pub-eval ' + (e[2] === true ? 'ok' : e[2] === false ? 'bad' : '') + '"><span>' + esc(e[0]) + '</span><b>' + esc(e[1]) + '</b></div>';
      }).join('') + '</div>';
    }
    return h;
  }

  function finalView(f) {
    if (!f) return '<div class="pub-empty"><div class="ic">🎓</div><b>ยังไม่ประกาศผลปลายปี</b>ผลการเรียนปลายปีพร้อมระดับผลการเรียนจะแสดงเมื่อโรงเรียนประกาศผล</div>';
    var pr = f.promote === true ? (f.grad ? 'จบหลักสูตร' : 'ได้เลื่อนชั้น') : f.promote === false ? (f.grad ? 'ยังไม่จบหลักสูตร' : 'ยังไม่ผ่านเกณฑ์') : 'รอสรุปผล';
    var h = '<div class="pub-tiles">' +
      tile('ผลการเรียนเฉลี่ย (GPA)', d(f.gpa, 2), f.credits ? 'จาก ' + f.credits + ' หน่วยกิต' : '', 'pub-hl') +
      tile('คะแนนเฉลี่ยร้อยละ', d(f.pct, 2), pctBar(f.pct)) +
      tile('เวลาเรียน', f.attPct != null ? d(f.attPct, 1) + '<small>%</small>' : d(null), f.attPct == null ? '' : f.attPct >= 80 ? 'ผ่านเกณฑ์ 80%' : 'ไม่ถึงเกณฑ์ 80%') +
      tile('ผลการตัดสิน', pr, f.promote === true ? '✓ ' + 'ผ่านเกณฑ์ทุกด้าน' : '', f.promote === true ? 'pub-ok' : f.promote === false ? 'pub-bad' : '') + '</div>';
    if (f.partial) h += '<p class="pub-note">ผลบางวิชายังไม่ครบ (แสดงเป็น –) ระดับผลการเรียนเฉลี่ยและผลการตัดสินจะแสดงเมื่อครบทุกวิชา</p>';
    if (VIEW === 'grid') { h += finalGrid(f); return h + evalsHtml(f); }
    var showTerms = f.subjects.some(function (s) { return s.t1 != null || s.t2 != null; });
    var showCE = !showTerms && f.subjects.some(function (s) { return s.collect != null || s.exam != null; });
    var ncol = 4 + (showTerms || showCE ? 2 : 0);
    h += '<div class="pub-tbl-wrap"><table class="pub-tbl"><thead><tr><th class="l">รายวิชา</th><th>หน่วยกิต</th>' + (showTerms ? '<th class="pub-term">ภาค 1</th><th class="pub-term">ภาค 2</th>' : '') + (showCE ? '<th class="pub-term">คะแนนเก็บ</th><th class="pub-term">คะแนนสอบ</th>' : '') + '<th>รวม<small>เต็ม 100</small></th><th>เกรด</th></tr></thead><tbody>';
    [['รายวิชาพื้นฐาน', true], ['รายวิชาเพิ่มเติม', false]].forEach(function (g) {
      var rows = f.subjects.filter(function (s) { return (s.basic !== false) === g[1]; });
      if (!rows.length) return;
      h += '<tr class="pub-grp"><td colspan="' + ncol + '">' + g[0] + '</td></tr>';
      rows.forEach(function (s) {
        h += '<tr><td class="l"><b>' + esc(s.name) + '</b><small>' + esc(s.code) + '</small></td><td data-l="หน่วยกิต">' + d(s.credit, 1) + '</td>' +
          (showTerms ? '<td class="pub-term" data-l="ภาค 1">' + d(s.t1) + '</td><td class="pub-term" data-l="ภาค 2">' + d(s.t2) + '</td>' : '') + (showCE ? '<td class="pub-term" data-l="คะแนนเก็บ">' + d(s.collect) + '</td><td class="pub-term" data-l="คะแนนสอบ">' + d(s.exam) + '</td>' : '') + '<td class="pub-strong" data-l="รวม (เต็ม 100)">' + d(s.total) + '</td><td data-l="เกรด">' + gradeChip(s.grade) + '</td></tr>';
      });
    });
    h += '</tbody></table></div>';
    h += evalsHtml(f);
    return h;
  }

  // result: { name, id, no, years:[{ year, className, no, school, mid, final }] }
  // ปีที่นักเรียนไม่ได้เรียนที่โรงเรียนนี้ / ผลจากโรงเรียนอื่น
  function missingView(y, school) {
    return '<div class="pub-empty pub-miss"><div class="ic">🏫</div><b>ไม่มีคะแนนจาก' + esc(school || 'โรงเรียนวัดทุ่งแฝก') + '</b>' +
      'เนื่องจากนักเรียนไม่ได้เรียนที่โรงเรียนนี้ในปีการศึกษา ' + esc(y.year) + (y.level ? ' (ชั้น ป.' + esc(y.level) + ')' : '') +
      '<small>หากมีผลการเรียนจากโรงเรียนเดิม ครูหรือแอดมินสามารถเพิ่มเข้าระบบได้</small></div>';
  }
  function externalView(y) {
    var x = y.external || {};
    var h = '<div class="pub-ext"><span class="pub-ext-tag">ผลการเรียนจากโรงเรียนอื่น</span><b>' + esc(x.school || '') + '</b>' + (x.className ? '<small>' + esc(x.className) + '</small>' : '') + '</div>';
    h += '<div class="pub-tiles">' + tile('ผลการเรียนเฉลี่ย (GPA)', d(x.gpa == null ? null : +x.gpa, 2), '', 'pub-hl') + tile('ผลการตัดสิน', esc(x.result || '–'), '') + '</div>';
    if (x.subjects && x.subjects.length) {
      h += '<div class="pub-sgrid">' + x.subjects.map(function (s) {
        return '<div class="pub-sc"><div class="pub-sc-n">' + esc(short(s.name)) + '</div><div class="pub-sc-g">' + gradeChip(s.grade === '' ? null : (isFinite(+s.grade) ? +s.grade : s.grade)) + '</div>' + (s.credit != null ? '<div class="pub-sc-s">' + d(+s.credit, 1) + ' นก.</div>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (x.note) h += '<p class="pub-note">หมายเหตุ: ' + esc(x.note) + '</p>';
    return h;
  }
  function yearState(y, cur) {
    if (y.missing) return ['miss', 'ไม่ได้เรียนที่นี่'];
    if (y.external) return ['ext', 'โรงเรียนเดิม'];
    if (y.pending) return ['wait', 'รอประกาศผล'];
    if (+y.year === +cur) return ['cur', 'ปีปัจจุบัน'];
    return ['ok', y.final ? 'ผลปลายปี' : 'ผลกลางปี'];
  }

  // result: { name, id, years:[{ year, level, className, no, school, mid, final, missing?, external?, pending? }], curYear }
  function renderStudent(el, res, opt) {
    opt = opt || {};
    var years = (res.years || []).slice().sort(function (a, b) { return b.year - a.year; });
    var cur = res.curYear || (years[0] && years[0].year);
    var st = { y: Math.max(0, years.findIndex(function (x) { return +x.year === +cur; })), tab: null };
    try { VIEW = localStorage.getItem('pp5-view') || 'grid'; } catch (e) { VIEW = 'grid'; }
    var drawerBox = opt.drawer ? document.getElementById(opt.drawer) : null;
    function yearList() {
      return years.map(function (x, i) {
        var s = yearState(x, cur);
        return '<button type="button" class="pv-yi ' + s[0] + (i === st.y ? ' on' : '') + '" data-yi="' + i + '"><b>ปีการศึกษา ' + esc(x.year) + '</b><span>' + (x.level ? 'ป.' + esc(x.level) + ' · ' : '') + s[1] + '</span></button>';
      }).join('');
    }
    function draw() {
      var narrow = VIEW === 'table' && window.innerWidth < 640;
      el.classList.toggle('pub-narrow', narrow);
      if (opt.page !== false) document.body.classList.add('pub-has-result');
      var y = years[st.y] || {};
      if (!st.tab) st.tab = y.final ? 'final' : 'mid';
      var hist = years.length > 1;
      var h = '<div class="pv-rwrap' + (hist ? ' has-side' : '') + '">';
      if (hist) h += '<aside class="pv-side"><div class="pv-side-h">📚 ผลการเรียนย้อนหลัง</div>' + yearList() + '</aside>';
      h += '<div class="pv-rmain">';
      h += '<div class="pub-card pub-student"><div class="pub-av">' + esc((res.first || res.name || '?').replace(/^(เด็กชาย|เด็กหญิง|นาย|นางสาว|นาง)/, '').charAt(0)) + '</div>' +
        '<div class="pub-who"><div class="nm">' + esc(res.name) + '</div><div class="meta">' + esc(y.className || (y.level ? 'ป.' + y.level : '')) + (y.no ? ' · เลขที่ ' + esc(y.no) : '') + ' · เลขประจำตัว ' + esc(res.id) + '</div>' +
        (y.school && !y.missing ? '<div class="meta">' + esc(y.school) + '</div>' : '') + '</div>' +
        '<div class="pub-yr">ปีการศึกษา ' + esc(y.year) + (+y.year === +cur ? '<small>ปีปัจจุบัน</small>' : '') + '</div></div>';
      if (hist) h += '<button type="button" class="pv-histbtn" data-p="hist">📚 ดูผลการเรียนย้อนหลัง (' + years.length + ' ปี) <i>›</i></button>';
      if (y.missing) h += '<div class="pub-card pub-body">' + missingView(y, y.school) + '</div>';
      else if (y.external) h += '<div class="pub-card pub-body">' + externalView(y) + '</div>';
      else {
        h += '<div class="pub-seg" role="tablist"><button data-t="mid" class="' + (st.tab === 'mid' ? 'on' : '') + '">ผลกลางปี<small>ภาคเรียนที่ 1 · คะแนน</small></button>' +
          '<button data-t="final" class="' + (st.tab === 'final' ? 'on' : '') + '">ผลปลายปี<small>ทั้งปี · เกรด</small></button></div>';
        if (y.pending) h += '<div class="pub-card pub-body"><p class="pub-note" style="margin:0">พบชื่อนักเรียนในทะเบียนแล้ว แต่ครูยังไม่ได้บันทึกคะแนนเข้าระบบ กรุณาตรวจสอบอีกครั้งภายหลัง</p></div>';
        h += '<div class="pub-card pub-body">' + (st.tab === 'mid' ? midView(y.mid) : finalView(y.final)) + '</div>';
      }
      if (opt.actions !== false) h += '<div class="pub-actions">' + (y.missing || y.external ? '' : '<button class="pub-btn ghost" data-p="view">' + (VIEW === 'grid' ? '📋 ดูแบบตาราง' : '🔲 ดูแบบการ์ด') + '</button>') + '<button class="pub-btn ghost" data-p="print">🖨 พิมพ์ / บันทึก PDF</button>' + (opt.onBack ? '<button class="pub-btn ghost" data-p="back">ค้นหาคนอื่น</button>' : '') + '</div>';
      el.innerHTML = h + '</div></div>';
      if (drawerBox) { drawerBox.hidden = !hist; drawerBox.innerHTML = hist ? '<div class="pv-dsep">📚 ผลการเรียนย้อนหลัง</div>' + yearList() : ''; }
    }
    function pick(i) { st.y = i; st.tab = null; draw(); if (opt.closeDrawer) opt.closeDrawer(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    el.onclick = function (e) {
      var yi = e.target.closest('[data-yi]'); if (yi) { pick(+yi.dataset.yi); return; }
      var t = e.target.closest('[data-t]');
      if (t) { st.tab = t.dataset.t; draw(); return; }
      var p = e.target.closest('[data-p]');
      if (p && p.dataset.p === 'print') window.print();
      if (p && p.dataset.p === 'hist' && opt.openDrawer) opt.openDrawer();
      if (p && p.dataset.p === 'view') { VIEW = VIEW === 'grid' ? 'table' : 'grid'; try { localStorage.setItem('pp5-view', VIEW); } catch (e2) {} draw(); return; }
      if (p && p.dataset.p === 'back' && opt.onBack) opt.onBack();
    };
    if (drawerBox) drawerBox.onclick = function (e) { var yi = e.target.closest('[data-yi]'); if (yi) pick(+yi.dataset.yi); };
    draw();
  }

  // ---------- หน้าเว็บสาธารณะ (Apps Script) ----------
  function call(fn, args) {
    return new Promise(function (res, rej) {
      var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) { rej(e instanceof Error ? e : new Error(e && e.message ? e.message : String(e))); });
      r[fn].apply(r, args || []);
    });
  }
  async function boot() {
    var $ = function (id) { return document.getElementById(id); };
    var info = {};
    try { info = await call('api_publicInfo'); } catch (e) { info = {}; }
    if (info.title) { if (info.title !== 'ประกาศผลการเรียน') $('pubTitle').textContent = info.title; document.title = info.title; }
    if (info.school) $('pubSchool').textContent = info.school;
    // เมนู ☰ ด้านซ้าย
    var dr = $('pubDrawer'), scrim = $('pubScrim');
    function drawer(open) { if (!dr) return; dr.hidden = !open; scrim.hidden = !open; document.body.classList.toggle('pv-dopen', open); }
    if ($('pubMenuBtn')) $('pubMenuBtn').addEventListener('click', function () { drawer(true); });
    if ($('pubDrawerClose')) $('pubDrawerClose').addEventListener('click', function () { drawer(false); });
    if (scrim) scrim.addEventListener('click', function () { drawer(false); });
    if (dr) dr.addEventListener('click', function (e) {
      var g = e.target.closest('[data-go]');
      if (g) { drawer(false); if (typeof back === 'function' && !$('pubResult').hidden && g.dataset.go === 'search') back(); window.scrollTo({ top: g.dataset.go === 'home' ? 0 : $('pubSearch').offsetTop - 10, behavior: 'smooth' }); }
      if (e.target.closest('[data-login]')) drawer(false);
    });
    if (info.logo) { $('pubLogo').src = info.logo; $('pubLogo').hidden = false; }
    if (info.announcement) { $('pubAnn').textContent = info.announcement; $('pubAnn').hidden = false; }
    if (info.verify === 'id+nid4') $('pubNidRow').hidden = false;
    // มุมขวาบน: แท็บ "ครู" และ "แอดมิน" แยกกัน แต่ละแท็บรับเฉพาะรหัสของตัวเอง
    function login(want) {
      var url = want === 'admin' ? (info.superUrl || '') : (info.adminUrl || '');
      if (!window.PP5PinPad) { if (url) window.open(url, '_top'); return; }
      PP5PinPad.ask({
        title: want === 'admin' ? '🛡 เข้าสู่ระบบแอดมิน' : '👩‍🏫 เข้าสู่ระบบครู',
        digits: (info.pinLen && info.pinLen[want]) || 0,
        sub: want === 'admin' ? 'กดรหัสผู้ดูแลระบบ' + (info.pinLen && info.pinLen.admin ? ' ' + info.pinLen.admin + ' หลัก' : '') : 'กดรหัสครู' + (info.pinLen && info.pinLen.teacher ? ' ' + info.pinLen.teacher + ' หลัก' : ''), length: 12, autoSubmit: false,
        check: function (p) {
          return call('api_checkPin', [p]).then(function (r) {
            var role = r && r.role;
            if (!role) return r && r.locked ? 'ใส่รหัสผิดหลายครั้ง กรุณารอ 10 นาที' : 'รหัสไม่ถูกต้อง';
            if (want === 'admin' && role !== 'admin') return 'รหัสนี้เป็นรหัสครู กรุณาเลือกเข้าสู่ระบบแบบ "ครู"';
            return true;
          });
        }
      }).then(function (p) {
        if (p == null) return;
        try { localStorage.setItem(want === 'admin' ? 'pp5-admin-pin' : 'pp5-pin', p); } catch (e) {}
        if (PP5PinPad.loading) PP5PinPad.loading(want === 'admin' ? 'กำลังเปิดระบบแอดมิน...' : 'กำลังเปิดระบบครู...');
        if (url) window.open(url, '_top');
      });
    }
    var lb = $('pubLoginBtn'), lm = $('pubLoginMenu');
    function menu(open) { if (!lm) return; lm.hidden = !open; if (lb) lb.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    if (lb) lb.addEventListener('click', function (e) { e.stopPropagation(); menu(lm.hidden); });
    document.addEventListener('click', function (e) { if (lm && !lm.hidden && !e.target.closest('.pub-login')) menu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu(false); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-login]'), function (b) {
      b.addEventListener('click', function () { menu(false); login(b.dataset.login); });
    });
    if (info.closed) {
      $('pubSearch').innerHTML = '<div class="pub-card pub-closed"><span class="ic">🔒</span><h2>ปิดระบบประกาศผลชั่วคราว</h2><p>ขณะนี้โรงเรียนยังไม่เปิดให้ดูผลการเรียน กรุณากลับมาใหม่ภายหลัง</p></div>';
      return;
    }
    var yrs = (info.years || []).filter(function (y) { return y.mid || y.final; });
    var cy = yrs.filter(function (y) { return +y.year === +info.curYear; })[0] || yrs[0];
    if ($('pubStatus')) $('pubStatus').innerHTML = '<span>📅</span> ปี ' + esc(info.curYear || (cy && cy.year) || '') + ' : ' + (cy ? [cy.mid ? 'ผลกลางปี' : '', cy.final ? 'ผลปลายปี' : ''].filter(Boolean).join(' - ') || 'ยังไม่ประกาศผล' : 'ผลกลางปี - ผลปลายปี');

    var form = $('pubForm'), out = $('pubResult'), err = $('pubErr');
    function back() { document.body.classList.remove('pub-has-result'); if ($('pubDrawerYears')) $('pubDrawerYears').hidden = true; out.hidden = true; out.innerHTML = ''; $('pubSearch').hidden = false; $('pubId').value = ''; if ($('pubNid')) $('pubNid').value = ''; $('pubId').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = $('pubId').value.trim(), nid = $('pubNid') ? $('pubNid').value.trim() : '';
      err.hidden = true;
      if (!id) { err.textContent = 'กรุณากรอกเลขประจำตัวนักเรียน'; err.hidden = false; return; }
      if (info.verify === 'id+nid4' && !/^\d{4}$/.test(nid)) { err.textContent = 'กรุณากรอกเลขบัตรประชาชนของนักเรียน 4 ตัวท้าย'; err.hidden = false; return; }
      var btn = form.querySelector('button'); btn.disabled = true; btn.classList.add('busy');
      try {
        var r = await call('api_lookup', [id, nid]);
        if (!r || r.notFound) { err.textContent = info.verify === 'id+nid4' ? 'ไม่พบข้อมูล กรุณาตรวจสอบเลขประจำตัวนักเรียนและเลขบัตรประชาชน 4 ตัวท้าย' : 'ไม่พบข้อมูล กรุณาตรวจสอบเลขประจำตัวนักเรียน'; err.hidden = false; return; }
        $('pubSearch').hidden = true; out.hidden = false;
        renderStudent(out, r, { onBack: back, drawer: 'pubDrawerYears', openDrawer: function () { drawer(true); }, closeDrawer: function () { drawer(false); } });
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e2) {
        err.textContent = /TRY_LATER/.test(e2.message) ? 'ค้นหาผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่' : /CLOSED/.test(e2.message) ? 'ขณะนี้ปิดระบบประกาศผลชั่วคราว' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
        err.hidden = false;
      } finally { btn.disabled = false; btn.classList.remove('busy'); }
    });
  }

  window.PP5Public = { renderStudent: renderStudent, boot: boot };
})();
