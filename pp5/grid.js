/* ตารางกรอกข้อมูลแบบ spreadsheet: วางจาก Excel ได้, Enter/ลูกศรเลื่อนช่อง, เลือกค่าเดียวกันทั้งคอลัมน์ */
(function () {
  'use strict';

  function esc(v) {
    return v == null ? '' : String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function parseVal(col, raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (col.type === 'num') {
      if (s === '') return null;
      var n = parseFloat(s.replace(/,/g, ''));
      return isFinite(n) ? n : undefined;
    }
    if (col.type === 'select') {
      if (s === '') return '';
      var opts = col.options || [];
      for (var i = 0; i < opts.length; i++) { var o = opts[i]; var v = typeof o === 'object' ? o.v : o; if (String(v) === s || String(typeof o === 'object' ? o.t : o) === s) return v; }
      return col.free ? s : undefined;
    }
    return s;
  }
  function show(v, col) {
    if (v == null) return '';
    if (typeof v === 'number' && col && col.dec != null) return String(Math.round(v * Math.pow(10, col.dec)) / Math.pow(10, col.dec));
    return String(v);
  }

  /*
   * opts: { cols:[{key,label,sub,w,type:'num'|'text'|'select'|'ro',options,max,min,get(row),set(row,v),dec,fill,cls,group}],
   *         rows:[...], onChange(row, col), rowLabel(row,i) }
   */
  // จำตำแหน่งเลื่อนของแต่ละตาราง (กันเด้งกลับซ้ายเมื่อหน้าจอวาดใหม่ / แท็บเล็ตเลื่อนเองตอนแตะช่อง)
  var MEM = {};
  function Grid(el, opts) {
    this.el = el; this.o = opts;
    this.key = opts.cols.map(function (c) { return (c.group || '') + c.label; }).join('|');
    this.render();
    this.bind();
  }
  Grid.prototype.get = function (row, col) { return col.get ? col.get(row) : row[col.key]; };
  Grid.prototype.render = function () {
    var o = this.o, self = this, h = '<div class="g-wrap"><table class="g-tbl"><thead>';
    var groups = o.cols.some(function (c) { return c.group; });
    if (groups) {
      h += '<tr><th class="g-rh" rowspan="2">' + esc(o.corner || '') + '</th>';
      var i = 0;
      while (i < o.cols.length) {
        var g = o.cols[i].group || '', n = 1;
        while (i + n < o.cols.length && (o.cols[i + n].group || '') === g && g) n++;
        h += g ? '<th class="g-grp" colspan="' + n + '">' + esc(g) + '</th>' : '<th rowspan="2" class="g-h">' + head(o.cols[i], i) + '</th>';
        i += n;
      }
      h += '</tr><tr>';
      o.cols.forEach(function (c, ci) { if (c.group) h += '<th class="g-h">' + head(c, ci) + '</th>'; });
      h += '</tr>';
    } else {
      h += '<tr><th class="g-rh">' + esc(o.corner || '') + '</th>' + o.cols.map(function (c, ci) { return '<th class="g-h">' + head(c, ci) + '</th>'; }).join('') + '</tr>';
    }
    h += '</thead><tbody>';
    o.rows.forEach(function (row, r) {
      h += '<tr><th class="g-rh">' + (o.rowLabel ? o.rowLabel(row, r) : r + 1) + '</th>';
      o.cols.forEach(function (c, ci) { h += self.cellHtml(row, r, c, ci); });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    var old = this.el.querySelector('.g-wrap'), mem = MEM[this.key];
    var keepL = old ? old.scrollLeft : mem ? mem.l : 0, keepT = old ? old.scrollTop : mem ? mem.t : 0;
    this.el.innerHTML = h;
    var wrap = this.el.querySelector('.g-wrap');
    if (wrap && (keepL || keepT)) { wrap.scrollLeft = keepL; wrap.scrollTop = keepT; }
    this.paintSel();
    function head(c, ci) {
      var t = esc(c.label) + (c.sub ? '<small>' + esc(c.sub) + '</small>' : '');
      if (c.fill && c.type === 'select') {
        t += '<select class="g-fill" data-fill="' + ci + '" title="ใส่ค่าเดียวกันทั้งคอลัมน์"><option value="">ทั้งคอลัมน์…</option>' +
          c.options.map(function (op) { var v = typeof op === 'object' ? op.v : op, tt = typeof op === 'object' ? op.t : op; return v === '' ? '' : '<option value="' + esc(v) + '">' + esc(tt) + '</option>'; }).join('') + '</select>';
      }
      return t;
    }
  };
  Grid.prototype.cellHtml = function (row, r, c, ci) {
    var v = this.get(row, c), st = c.w ? ' style="min-width:' + c.w + 'px;width:' + c.w + 'px"' : '';
    if (c.type === 'ro') return '<td class="g-ro ' + (c.cls || '') + '" data-r="' + r + '" data-c="' + ci + '"' + st + '>' + esc(show(v, c)) + '</td>';
    var bad = c.type === 'num' && v != null && ((c.max != null && v > c.max) || (c.min != null && v < c.min));
    var inner;
    if (c.type === 'select') {
      inner = '<select data-r="' + r + '" data-c="' + ci + '">' + c.options.map(function (op) {
        var ov = typeof op === 'object' ? op.v : op, t = typeof op === 'object' ? op.t : op;
        return '<option value="' + esc(ov) + '"' + (String(ov) === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('') + '</select>';
    } else {
      inner = '<input data-r="' + r + '" data-c="' + ci + '" value="' + esc(show(v, c)) + '"' + (c.type === 'num' ? ' inputmode="decimal"' : '') + ' autocomplete="off">';
    }
    var req = c.req && (v == null || v === '');   // ช่องที่ยังต้องกรอก (เตือนว่ายังไม่ครบ)
    return '<td class="g-in ' + (bad ? 'g-bad ' : '') + (req ? 'g-req ' : '') + (c.cls || '') + '" data-tr="' + r + '" data-tc="' + ci + '"' + st + '>' + inner + '</td>';
  };
  Grid.prototype.refresh = function () {
    var self = this, o = this.o;
    // ช่องกรอกที่ระบบคำนวณให้ด้วย (live) เช่น คะแนนเก็บ: อัปเดตค่าที่แสดง (ยกเว้นช่องที่กำลังพิมพ์)
    Array.prototype.forEach.call(this.el.querySelectorAll('input[data-c]'), function (inp) {
      var c = o.cols[+inp.dataset.c];
      if (!c || !c.live || inp === document.activeElement) return;
      var v = self.get(o.rows[+inp.dataset.r], c);
      inp.value = show(v, c);
      inp.parentNode.classList.toggle('g-req', !!c.req && (v == null || v === ''));
    });
    Array.prototype.forEach.call(this.el.querySelectorAll('td.g-ro'), function (td) {
      var r = +td.dataset.r, c = o.cols[+td.dataset.c];
      td.textContent = show(self.get(o.rows[r], c), c);
    });
  };
  Grid.prototype.setCell = function (r, ci, raw) {
    var o = this.o, c = o.cols[ci], row = o.rows[r];
    if (!c || !row || c.type === 'ro') return false;
    var v = parseVal(c, raw);
    if (v === undefined) return false;
    if (c.set) c.set(row, v); else row[c.key] = v;
    return true;
  };
  // เลื่อนตารางเท่าที่จำเป็นให้เห็นช่อง (ไม่ให้เบราว์เซอร์เลื่อนเอง)
  Grid.prototype.reveal = function (el) {
    var wrap = this.el.querySelector('.g-wrap');
    if (!wrap || !el) return;
    var wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
    var rh = wrap.querySelector('tbody .g-rh'), stick = rh ? rh.getBoundingClientRect().width : 0;
    if (r.left < wr.left + stick) wrap.scrollLeft -= (wr.left + stick - r.left) + 8;
    else if (r.right > wr.right) wrap.scrollLeft += (r.right - wr.right) + 8;
    var head = wrap.querySelector('thead'), hh = head ? head.getBoundingClientRect().height : 0;
    if (r.top < wr.top + hh) wrap.scrollTop -= (wr.top + hh - r.top) + 4;
    else if (r.bottom > wr.bottom) wrap.scrollTop += (r.bottom - wr.bottom) + 4;
  };
  Grid.prototype.focus = function (r, ci) {
    var el = this.el.querySelector('[data-r="' + r + '"][data-c="' + ci + '"]');
    if (el && el.tagName !== 'TD') {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      this.reveal(el);
      if (el.select) el.select();
    }
  };

  // ---------- ลากเมาส์คลุมหลายช่อง (แบบ Excel) ----------
  // ลากคลุม → พิมพ์ค่าแล้วกด Enter = ใส่ทุกช่องที่เลือก · Delete = ล้าง · Ctrl+C / Ctrl+V ได้ · แถบลอยด้านล่างมีปุ่มค่าให้กด
  Grid.prototype.selCells = function () {
    var s = this.sel, out = [];
    if (!s) return out;
    var r1 = Math.min(s.r0, s.r1), r2 = Math.max(s.r0, s.r1), c1 = Math.min(s.c0, s.c1), c2 = Math.max(s.c0, s.c1);
    for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) if (this.o.cols[c] && this.o.cols[c].type !== 'ro' && this.o.rows[r]) out.push([r, c]);
    return out;
  };
  Grid.prototype.multi = function () { var s = this.sel; return !!s && (s.r0 !== s.r1 || s.c0 !== s.c1); };
  Grid.prototype.paintSel = function () {
    var self = this, s = this.sel;
    Array.prototype.forEach.call(this.el.querySelectorAll('td.g-sel'), function (td) { td.classList.remove('g-sel'); });
    if (this.multi()) {
      this.selCells().forEach(function (rc) { var td = self.el.querySelector('td[data-tr="' + rc[0] + '"][data-tc="' + rc[1] + '"]'); if (td) td.classList.add('g-sel'); });
    }
    this.selBar();
  };
  Grid.prototype.clearSel = function () { if (!this.sel) return; this.sel = null; this.paintSel(); };
  Grid.prototype.fillSel = function (raw) {
    var self = this, o = this.o, n = 0;
    this.selCells().forEach(function (rc) { if (self.setCell(rc[0], rc[1], raw)) { n++; if (o.onChange) o.onChange(o.rows[rc[0]], o.cols[rc[1]]); } });
    var s = this.sel;
    this.busy = true;   // กัน change/blur ของช่องที่ถูกลบออกตอนวาดใหม่
    try { this.render(); } finally { this.busy = false; }
    if (s) this.focus(Math.min(s.r0, s.r1), Math.min(s.c0, s.c1));
    if (o.onFill) o.onFill(n, raw);
    return n;
  };
  Grid.prototype.selBar = function () {
    var self = this, bar = document.getElementById('gSelBar');
    if (!this.multi() || !document.body.contains(this.el)) { if (bar && bar._g === this) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'gSelBar'; bar.className = 'g-selbar'; document.body.appendChild(bar); }
    bar._g = this;
    var cells = this.selCells(), cols = {}, o = this.o;
    cells.forEach(function (rc) { cols[rc[1]] = 1; });
    var ks = Object.keys(cols), c0 = o.cols[+ks[0]], opts = '';
    var same = ks.every(function (k) { var c = o.cols[+k]; return c.type === 'select' && JSON.stringify(c.options) === JSON.stringify(c0.options); });
    if (same) opts = c0.options.map(function (op) { var v = typeof op === 'object' ? op.v : op, t = typeof op === 'object' ? op.t : op; return v === '' ? '' : '<button type="button" data-gv="' + esc(v) + '">' + esc(t) + '</button>'; }).join('');
    else {
      var mx = ks.map(function (k) { return o.cols[+k]; }).filter(function (c) { return c.type === 'num' && c.max != null; });
      var allNum = ks.every(function (k) { return o.cols[+k].type === 'num'; });
      opts = '<input type="text" class="g-sv" placeholder="' + (allNum ? 'ตัวเลข' : 'ข้อความ') + '" inputmode="' + (allNum ? 'decimal' : 'text') + '"><button type="button" data-gok="1">ใส่ทุกช่อง</button>' +
        (allNum && mx.length === ks.length && mx.every(function (c) { return c.max === mx[0].max; }) ? '<button type="button" data-gv="' + mx[0].max + '">เต็ม ' + mx[0].max + '</button>' : '');
    }
    bar.innerHTML = '<b>เลือก ' + cells.length + ' ช่อง</b>' + opts + '<button type="button" class="g-clr" data-gclr="1">ล้าง</button><button type="button" class="g-x" data-gx="1" title="ยกเลิกการเลือก (Esc)">✕</button>';
    bar.onmousedown = function (e) { if (e.target.tagName !== 'INPUT') e.preventDefault(); };
    bar.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.gx) return self.clearSel();
      if (b.dataset.gclr) return self.fillSel('');
      if (b.dataset.gok) { var v = bar.querySelector('.g-sv').value; if (v !== '') self.fillSel(v); return; }
      if (b.dataset.gv != null) self.fillSel(b.dataset.gv);
    };
    var sv = bar.querySelector('.g-sv');
    if (sv) sv.onkeydown = function (e) { if (e.key === 'Enter' && sv.value !== '') { e.preventDefault(); self.fillSel(sv.value); } else if (e.key === 'Escape') self.clearSel(); };
  };
  Grid.prototype.bindSel = function () {
    var self = this, o = this.o, drag = null;
    function cellAt(x, y) {
      var el = document.elementFromPoint(x, y), td = el && el.closest && el.closest('td[data-tr],td.g-ro[data-r]');
      if (!td || !self.el.contains(td)) return null;
      return td.dataset.tr != null ? [+td.dataset.tr, +td.dataset.tc] : [+td.dataset.r, +td.dataset.c];
    }
    this.el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var rc = cellAt(e.clientX, e.clientY);
      if (!rc) return;
      if (e.shiftKey && self.sel) { e.preventDefault(); self.sel.r1 = rc[0]; self.sel.c1 = rc[1]; self.paintSel(); return; }
      self.sel = { r0: rc[0], c0: rc[1], r1: rc[0], c1: rc[1] }; self.paintSel();
      var t = e.target, isSel = t.tagName === 'SELECT';
      // ช่องแบบเลือก (dropdown): กันเมนูเด้งตอนเริ่มลาก ถ้าไม่ได้ลากค่อยเปิดเมนูตอนปล่อยเมาส์
      if (isSel && document.activeElement !== t) { e.preventDefault(); try { t.focus({ preventScroll: true }); } catch (x) { t.focus(); } }
      drag = { sel: isSel && document.activeElement === t ? t : null, moved: false, prevented: isSel };
      function mv(ev) {
        if (!(ev.buttons & 1)) return up();
        var c = cellAt(ev.clientX, ev.clientY);
        if (!c || (c[0] === self.sel.r1 && c[1] === self.sel.c1)) return;
        drag.moved = true; self.sel.r1 = c[0]; self.sel.c1 = c[1];
        ev.preventDefault(); var ws = window.getSelection && window.getSelection(); if (ws) ws.removeAllRanges();
        self.paintSel();
      }
      function up() {
        document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true);
        var d = drag; drag = null;
        if (!d) return;
        if (d.moved) {
          var a = self.el.querySelector('[data-r="' + self.sel.r0 + '"][data-c="' + self.sel.c0 + '"]');
          if (a && a.tagName === 'INPUT') { try { a.focus({ preventScroll: true }); } catch (x) { a.focus(); } a.select(); }
        } else if (d.prevented && d.sel && d.sel.showPicker) { try { d.sel.showPicker(); } catch (x) { } }
      }
      document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true);
    });
    this.el.addEventListener('keydown', function (e) {
      if (!self.multi()) return;
      var t = e.target;
      if (e.key === 'Escape') { self.clearSel(); return; }
      if (t.dataset.r == null) return;
      if (e.key === 'Enter' && t.tagName === 'INPUT') { e.preventDefault(); e.stopImmediatePropagation(); self.fillSel(t.value); return; }
      if (e.key === 'Delete' || (e.key === 'Backspace' && t.tagName === 'INPUT' && t.selectionStart === 0 && t.selectionEnd === t.value.length)) {
        e.preventDefault(); e.stopImmediatePropagation(); self.fillSel('');
      }
    }, true);
    this.el.addEventListener('change', function (e) {
      var t = e.target;
      if (self.busy) { e.stopImmediatePropagation(); return; }
      if (t.tagName !== 'SELECT' || t.dataset.r == null || !self.multi()) return;
      e.stopImmediatePropagation(); self.fillSel(t.value);
    }, true);
    this.el.addEventListener('copy', function (e) {
      if (!self.multi()) return;
      var s = self.sel, r1 = Math.min(s.r0, s.r1), r2 = Math.max(s.r0, s.r1), c1 = Math.min(s.c0, s.c1), c2 = Math.max(s.c0, s.c1), lines = [];
      for (var r = r1; r <= r2; r++) { var a = []; for (var c = c1; c <= c2; c++) a.push(show(self.get(o.rows[r], o.cols[c]), o.cols[c])); lines.push(a.join('\t')); }
      e.clipboardData.setData('text/plain', lines.join('\n')); e.preventDefault();
    });
    // วางค่าเดียวลงหลายช่องที่เลือก
    this.el.addEventListener('paste', function (e) {
      if (!self.multi()) return;
      var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\r/g, '').replace(/\n$/, '');
      if (text.indexOf('\t') >= 0 || text.indexOf('\n') >= 0) return;
      e.preventDefault(); e.stopImmediatePropagation(); self.fillSel(text);
    }, true);
  };
  Grid.prototype.bind = function () {
    var self = this, o = this.o;
    this.bindSel();
    // กันแท็บเล็ต/มือถือเลื่อนตารางกลับซ้ายเองตอนแตะช่อง: จำตำแหน่งก่อนแตะ แล้วคืนค่าถ้าช่องนั้นมองเห็นอยู่แล้ว
    var anchor = null;
    function wrapEl() { return self.el.querySelector('.g-wrap'); }
    this.el.addEventListener('scroll', function (e) {
      if (e.target.classList && e.target.classList.contains('g-wrap')) MEM[self.key] = { l: e.target.scrollLeft, t: e.target.scrollTop };
    }, true);
    function mark() { var w = wrapEl(); if (w) anchor = { l: w.scrollLeft, t: w.scrollTop }; }
    this.el.addEventListener('pointerdown', mark, true);
    this.el.addEventListener('touchstart', mark, { capture: true, passive: true });
    this.el.addEventListener('focusin', function (e) {
      var w = wrapEl(), t = e.target;
      if (!w || !anchor || t.dataset.r == null) return;
      var a = anchor; anchor = null;
      function fix() {
        if (Math.abs(w.scrollLeft - a.l) < 2 && Math.abs(w.scrollTop - a.t) < 2) return;
        var cur = w.scrollLeft, wr = w.getBoundingClientRect(), r = t.getBoundingClientRect();
        var left = r.left - wr.left + cur;   // ตำแหน่งช่องในตาราง
        if (left + r.width > a.l && left < a.l + w.clientWidth) { w.scrollLeft = a.l; w.scrollTop = a.t; }   // ช่องที่แตะมองเห็นอยู่แล้ว → คืนตำแหน่งเดิม
      }
      requestAnimationFrame(fix); setTimeout(fix, 60); setTimeout(fix, 350);
    });
    function changed(t) {
      var r = +t.dataset.r, ci = +t.dataset.c, c = o.cols[ci];
      var ok = self.setCell(r, ci, t.value);
      var td = t.parentNode, v = self.get(o.rows[r], c);
      if (ok && c.type === 'num' && v != null && c.max != null && v > c.max && o.onOver) o.onOver(c, v);
      td.classList.toggle('g-bad', !ok || (c.type === 'num' && v != null && ((c.max != null && v > c.max) || (c.min != null && v < c.min))));
      td.classList.toggle('g-req', !!c.req && (v == null || v === ''));
      if (o.onChange) o.onChange(o.rows[r], c);
      if (c.rerender) { self.render(); self.focus(r, ci); } else self.refresh();   // คอลัมน์ที่เปลี่ยนหลายช่องในแถว (เช่น "ทั้งแถว")
    }
    this.el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.classList.contains('g-fill')) {
        var ci = +t.dataset.fill, val = t.value;
        if (val === '') return;
        o.rows.forEach(function (row, r) { self.setCell(r, ci, val); if (o.onChange) o.onChange(row, o.cols[ci]); });
        t.value = '';
        self.render();
        return;
      }
      if (t.dataset.r != null) changed(t);
    });
    this.el.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.dataset.r == null) return;
      var r = +t.dataset.r, ci = +t.dataset.c;
      var mv = { Enter: [1, 0], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
      if (t.tagName === 'INPUT' && (e.key === 'ArrowRight' && t.selectionStart === t.value.length || e.key === 'ArrowLeft' && t.selectionStart === 0)) mv = [0, e.key === 'ArrowRight' ? 1 : -1];
      if (!mv || (t.tagName === 'SELECT' && e.key !== 'Enter')) return;
      e.preventDefault();
      if (t.tagName === 'INPUT') changed(t);
      var nr = r + mv[0], nc = ci + mv[1];
      while (o.cols[nc] && o.cols[nc].type === 'ro') nc += mv[1] || 1;
      self.focus(Math.max(0, Math.min(o.rows.length - 1, nr)), Math.max(0, Math.min(o.cols.length - 1, nc)));
    });
    // วางข้อมูลหลายช่องจาก Excel / Google Sheets
    this.el.addEventListener('paste', function (e) {
      var t = e.target;
      if (t.dataset.r == null) return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || (text.indexOf('\t') < 0 && text.indexOf('\n') < 0)) return;
      e.preventDefault();
      var lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
      var r0 = +t.dataset.r, c0 = +t.dataset.c, n = 0;
      lines.forEach(function (line, i) {
        var cells = line.split('\t'), ci = c0;
        cells.forEach(function (val) {
          while (o.cols[ci] && o.cols[ci].type === 'ro') ci++;
          if (self.setCell(r0 + i, ci, val)) { n++; if (o.onChange) o.onChange(o.rows[r0 + i], o.cols[ci]); }
          ci++;
        });
      });
      self.render();
      if (o.onPaste) o.onPaste(n);
    });
  };

  // คลิกนอกตาราง → ยกเลิกช่องที่เลือก
  document.addEventListener('mousedown', function (e) {
    var bar = document.getElementById('gSelBar');
    if (!bar || !bar._g || bar.contains(e.target) || bar._g.el.contains(e.target)) return;
    bar._g.clearSel();
  }, true);

  window.PP5Grid = Grid;
})();
