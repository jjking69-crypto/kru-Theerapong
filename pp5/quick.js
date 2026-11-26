/*
 * โหมด "กรอกทีละช่อง" (ใช้ง่ายบนมือถือ): เลือกตัวชี้วัด/รายการทีละอัน แล้วกรอกไล่ทีละคน
 * ใช้คำนิยามคอลัมน์ชุดเดียวกับตาราง (PP5Grid): { cols, rows, rowLabel, onChange }
 *   - คะแนนช่วงเล็ก (0–4) และตัวเลือก (ผ./มผ.) → ปุ่มกดใหญ่
 *   - คะแนนอื่น → ช่องตัวเลขใหญ่ + ปุ่ม "เต็ม" · Enter = ไปคนถัดไป
 */
(function () {
  'use strict';
  function esc(v) {
    return v == null ? '' : String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  var memory = {};   // จำว่าแต่ละหน้ากำลังกรอกคอลัมน์ไหนอยู่

  function Quick(el, o) {
    this.el = el; this.o = o;
    this.edit = o.cols.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.type !== 'ro'; });
    this.ro = o.cols.filter(function (c) { return c.type === 'ro'; });
    var strong = this.ro.filter(function (c) { return /g-strong/.test(c.cls || ''); });
    this.sum = (strong.length ? strong : this.ro.slice(-2));
    this.key = o.cols.map(function (c) { return c.group + c.label; }).join('|');
    this.cur = Math.min(memory[this.key] || 0, Math.max(0, this.edit.length - 1));
    this.render();
  }
  Quick.prototype.get = function (row, col) { return col.get ? col.get(row) : row[col.key]; };
  Quick.prototype.filled = function (col) {
    var self = this;
    return this.o.rows.filter(function (r) { var v = self.get(r, col); return v != null && v !== ''; }).length;
  };
  Quick.prototype.kindOf = function (col) {
    if (col.type === 'select') return 'btn';
    if (col.type === 'num' && col.max != null && col.max <= 4 && (col.min == null || col.min >= 0) && Math.floor(col.max) === col.max) return 'btn';
    return col.type === 'num' ? 'num' : 'text';
  };
  Quick.prototype.options = function (col) {
    if (col.type === 'select') return (col.options || []).filter(function (x) { var v = typeof x === 'object' ? x.v : x; return v !== '' && v != null; })
      .map(function (x) { return typeof x === 'object' ? x : { v: x, t: x }; });
    var out = []; for (var n = col.min || 0; n <= col.max; n++) out.push({ v: n, t: String(n) });
    return out.reverse();   // เลขมากอยู่ซ้าย (กดง่ายกว่าเมื่อส่วนใหญ่ได้คะแนนเต็ม)
  };
  Quick.prototype.summary = function (row) {
    var self = this;
    return this.sum.map(function (c) {
      var v = self.get(row, c);
      if (typeof v === 'number' && c.dec != null) v = Math.round(v * Math.pow(10, c.dec)) / Math.pow(10, c.dec);
      return '<span>' + esc(c.label) + ' <b>' + (v == null || v === '' ? '–' : esc(v)) + '</b></span>';
    }).join('');
  };
  Quick.prototype.cell = function (row, ri, col) {
    var v = this.get(row, col), k = this.kindOf(col);
    if (k === 'btn') {
      return '<div class="qk-btns">' + this.options(col).map(function (op) {
        return '<button type="button" class="qk-b' + (String(v) === String(op.v) && v !== '' && v != null ? ' on' : '') + '" data-r="' + ri + '" data-v="' + esc(op.v) + '">' + esc(op.t) + '</button>';
      }).join('') + '<button type="button" class="qk-b clr" data-r="' + ri + '" data-v="" aria-label="ล้าง">–</button></div>';
    }
    var over = k === 'num' && typeof v === 'number' && col.max != null && v > col.max;
    return '<div class="qk-inp"><input class="qk-i' + (over ? ' over' : '') + '" data-r="' + ri + '" ' + (k === 'num' ? 'type="text" inputmode="decimal" enterkeyhint="next"' : 'type="text" enterkeyhint="next"') +
      ' value="' + esc(v == null ? '' : v) + '" placeholder="' + (k === 'num' && col.max != null ? '0–' + col.max : '') + '" aria-label="' + esc(col.label) + '">' +
      (k === 'num' && col.max != null ? '<button type="button" class="qk-full" data-r="' + ri + '" data-v="' + col.max + '">เต็ม</button>' : '') + '</div>';
  };
  Quick.prototype.render = function () {
    var self = this, o = this.o;
    if (!this.edit.length) { this.el.innerHTML = '<p class="sub">ส่วนนี้ไม่มีช่องให้กรอก</p>'; return; }
    var cur = this.edit[this.cur].c, n = o.rows.length, lastGroup = null;
    var chips = this.edit.map(function (x, i) {
      var f = self.filled(x.c), g = x.c.group && x.c.group !== lastGroup ? '<span class="qk-g">' + esc(x.c.group) + '</span>' : '';
      lastGroup = x.c.group;
      return g + '<button type="button" class="qk-c' + (i === self.cur ? ' on' : '') + (f >= n && n ? ' done' : '') + '" data-c="' + i + '">' +
        '<b>' + esc(x.c.label) + '</b>' + (x.c.sub ? '<small>' + esc(x.c.sub) + '</small>' : '') + '<i>' + f + '/' + n + '</i></button>';
    }).join('');
    var k = this.kindOf(cur);
    var h = '<div class="qk">' +
      '<div class="qk-cols" role="tablist">' + chips + '</div>' +
      '<div class="qk-head"><button type="button" class="qk-nav" data-nav="-1" aria-label="ก่อนหน้า"' + (this.cur ? '' : ' disabled') + '>‹</button>' +
      '<div class="qk-t"><small>' + esc(cur.group || '') + ' · ' + (this.cur + 1) + '/' + this.edit.length + '</small><b>' + esc(cur.label) + (cur.sub ? ' <span>' + esc(cur.sub) + '</span>' : '') + '</b>' +
      '<small>กรอกแล้ว ' + this.filled(cur) + ' จาก ' + n + ' คน</small></div>' +
      '<button type="button" class="qk-nav" data-nav="1" aria-label="ถัดไป"' + (this.cur < this.edit.length - 1 ? '' : ' disabled') + '>›</button></div>' +
      '<div class="qk-tools">' +
      (k === 'num' && cur.max != null ? '<button type="button" class="btn" data-all="' + cur.max + '">ใส่ ' + cur.max + ' (เต็ม) คนที่ยังว่าง</button>' : '') +
      (k === 'btn' ? this.options(cur).slice(0, 3).map(function (op) { return '<button type="button" class="btn" data-all="' + esc(op.v) + '">ใส่ "' + esc(op.t) + '" คนที่ยังว่าง</button>'; }).join('') : '') +
      '<button type="button" class="btn ghost" data-clear="1">ล้างช่องนี้ทั้งหมด</button></div>' +
      '<div class="qk-list">' + o.rows.map(function (row, ri) {
        return '<div class="qk-row" data-row="' + ri + '"><div class="qk-who">' + (o.rowLabel ? o.rowLabel(row, ri) : esc(ri + 1)) +
          (self.sum.length ? '<div class="qk-sum">' + self.summary(row) + '</div>' : '') + '</div>' + self.cell(row, ri, cur) + '</div>';
      }).join('') + '</div>' +
      (this.cur < this.edit.length - 1 ? '<button type="button" class="btn pri qk-next" data-nav="1">ช่องถัดไป: ' + esc(this.edit[this.cur + 1].c.label) + ' ›</button>' : '') + '</div>';
    this.el.innerHTML = h;
    this.bind();
  };
  Quick.prototype.set = function (ri, raw) {
    var o = this.o, col = this.edit[this.cur].c, row = o.rows[ri], v;
    var s = String(raw == null ? '' : raw).trim();
    if (col.type === 'num') { if (s === '') v = null; else { v = parseFloat(s.replace(/,/g, '')); if (!isFinite(v)) return false; } }
    else if (col.type === 'select') v = s === '' ? '' : (this.options(col).filter(function (x) { return String(x.v) === s; })[0] || { v: s }).v;
    else v = s;
    if (col.set) col.set(row, v); else row[col.key] = v;
    if (o.onChange) o.onChange(row, col);
    this.refreshRow(ri);
    return true;
  };
  Quick.prototype.refreshRow = function (ri) {
    var rowEl = this.el.querySelector('.qk-row[data-row="' + ri + '"]'), row = this.o.rows[ri], col = this.edit[this.cur].c;
    if (!rowEl) return;
    var sum = rowEl.querySelector('.qk-sum'); if (sum) sum.innerHTML = this.summary(row);
    var v = this.get(row, col);
    Array.prototype.forEach.call(rowEl.querySelectorAll('.qk-b'), function (b) { b.classList.toggle('on', b.dataset.v !== '' && String(v) === b.dataset.v && v !== '' && v != null); });
    var inp = rowEl.querySelector('.qk-i');
    if (inp) { if (document.activeElement !== inp) inp.value = v == null ? '' : v; inp.classList.toggle('over', typeof v === 'number' && col.max != null && v > col.max); }
    var chip = this.el.querySelector('.qk-c[data-c="' + this.cur + '"]'), f = this.filled(col), n = this.o.rows.length;
    if (chip) { chip.querySelector('i').textContent = f + '/' + n; chip.classList.toggle('done', f >= n && n > 0); }
    var t = this.el.querySelector('.qk-t small:last-child'); if (t) t.textContent = 'กรอกแล้ว ' + f + ' จาก ' + n + ' คน';
  };
  Quick.prototype.go = function (i) {
    this.cur = Math.max(0, Math.min(this.edit.length - 1, i));
    memory[this.key] = this.cur;
    this.render();
    var chip = this.el.querySelector('.qk-c.on'); if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: 'nearest', inline: 'center' });
    var first = this.el.querySelector('.qk-i'); if (first && window.innerWidth > 700) first.focus();
  };
  Quick.prototype.bind = function () {
    var self = this, el = this.el;
    el.onclick = function (e) {
      var c = e.target.closest('[data-c]'); if (c) { self.go(+c.dataset.c); return; }
      var nv = e.target.closest('[data-nav]'); if (nv) { self.go(self.cur + +nv.dataset.nav); el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      var b = e.target.closest('.qk-b, .qk-full'); if (b) { self.set(+b.dataset.r, b.dataset.v); return; }
      var all = e.target.closest('[data-all]');
      if (all) {
        var col = self.edit[self.cur].c, n = 0;
        self.o.rows.forEach(function (row, ri) { var v = self.get(row, col); if (v == null || v === '') { self.set(ri, all.dataset.all); n++; } });
        self.render(); return;
      }
      if (e.target.closest('[data-clear]')) {
        if (!confirm('ล้างค่าในช่องนี้ของทุกคน?')) return;
        self.o.rows.forEach(function (row, ri) { self.set(ri, ''); }); self.render();
      }
    };
    el.onchange = function (e) { if (e.target.classList.contains('qk-i')) { e.stopPropagation(); self.set(+e.target.dataset.r, e.target.value); } };
    el.onkeydown = function (e) {
      if (e.key !== 'Enter' || !e.target.classList.contains('qk-i')) return;
      e.preventDefault();
      self.set(+e.target.dataset.r, e.target.value);
      var next = el.querySelector('.qk-i[data-r="' + (+e.target.dataset.r + 1) + '"]');
      if (next) { next.focus(); next.select(); } else e.target.blur();
    };
  };
  window.PP5Quick = Quick;
})();
