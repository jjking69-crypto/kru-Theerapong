/*
 * แก้ไขค่าในไฟล์ Excel (.xlsx / .xlsm) โดยไม่ทำลายรูปแบบเดิม:
 * คงสูตร มาโคร (VBA) รูปภาพ การจัดหน้า และสไตล์ไว้ทั้งหมด แก้เฉพาะค่าในเซลล์ที่กำหนด
 * ใช้ JSZip เปิดไฟล์แล้วแก้ XML ของแต่ละชีตโดยตรง
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.XlsxFill = factory(root.JSZip);
})(typeof self !== 'undefined' ? self : this, function (JSZip) {
  'use strict';

  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function xmlUnesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&'); }
  function colNum(letters) { var n = 0; for (var i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64; return n; }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  function split(addr) { var m = /^([A-Z]+)(\d+)$/.exec(addr); return { c: colNum(m[1]), r: +m[2] }; }
  function attr(attrs, name) { var m = new RegExp('\\b' + name + '="([^"]*)"').exec(attrs); return m ? m[1] : null; }
  function setAttr(attrs, name, val) {
    var re = new RegExp('\\s' + name + '="[^"]*"');
    if (val == null) return attrs.replace(re, '');
    return re.test(attrs) ? attrs.replace(re, ' ' + name + '="' + val + '"') : attrs + ' ' + name + '="' + val + '"';
  }
  function resolve(base, target) {
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = base.split('/'); parts.pop();
    target.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
    return parts.join('/');
  }
  function rels(xml) {
    var out = {}, re = /<Relationship\b[^>]*>/g, m;
    while ((m = re.exec(xml || ''))) {
      var id = attr(m[0], 'Id'), t = attr(m[0], 'Target');
      if (id && t) out[id] = t;
    }
    return out;
  }

  // ---------- ชีต ----------
  function Sheet(book, path, xml) {
    this.book = book; this.path = path; this.dirty = false;
    var i0 = xml.indexOf('<sheetData'), i1 = xml.indexOf('</sheetData>');
    if (i0 < 0) { this.head = xml; this.tail = ''; this.rows = {}; this.selfClosing = true; return; }
    var openEnd = xml.indexOf('>', i0);
    var selfClose = xml.charAt(openEnd - 1) === '/';
    this.head = xml.slice(0, selfClose ? i0 : openEnd + 1);
    this.tail = selfClose ? xml.slice(openEnd + 1) : xml.slice(i1);
    this.selfClosing = selfClose;
    var body = selfClose ? '' : xml.slice(openEnd + 1, i1);
    this.rows = {};
    var re = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, m;
    while ((m = re.exec(body))) {
      var r = +attr(m[1], 'r');
      var row = { attrs: m[1], cells: {} };
      var cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = cre.exec(m[2] || ''))) {
        var a = attr(cm[1], 'r');
        row.cells[split(a).c] = { attrs: cm[1], inner: cm[2] || '' };
      }
      this.rows[r] = row;
    }
  }
  Sheet.prototype.cell = function (addr) {
    var p = split(addr), row = this.rows[p.r];
    return row ? row.cells[p.c] || null : null;
  };
  Sheet.prototype.isFormula = function (addr) { var c = this.cell(addr); return !!(c && /<f[\s>\/]/.test(c.inner)); };
  Sheet.prototype.get = function (addr) {
    var c = this.cell(addr);
    if (!c) return null;
    var t = attr(c.attrs, 't');
    if (t === 'inlineStr') { var im = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c.inner); return im ? xmlUnesc(im[1]) : ''; }
    var vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(c.inner);
    if (!vm) return null;
    if (t === 's') return this.book.sst[+vm[1]];
    if (t === 'str' || t === 'e') return xmlUnesc(vm[1]);
    var n = parseFloat(vm[1]);
    return isFinite(n) ? n : vm[1];
  };
  // เขียนค่า (null = ล้างค่า แต่คงรูปแบบเซลล์) ข้ามเซลล์สูตร เว้นแต่ force
  Sheet.prototype.set = function (addr, value, force) {
    var p = split(addr);
    var row = this.rows[p.r] || (this.rows[p.r] = { attrs: ' r="' + p.r + '"', cells: {} });
    var c = row.cells[p.c];
    if (c && /<f[\s>\/]/.test(c.inner) && !force) return false;
    var attrs = c ? c.attrs : ' r="' + addr + '"';
    attrs = setAttr(attrs, 't', null);
    var inner = '';
    if (value === null || value === undefined || value === '') inner = '';
    else if (typeof value === 'number' && isFinite(value)) inner = '<v>' + value + '</v>';
    else { attrs = setAttr(attrs, 't', 'inlineStr'); inner = '<is><t xml:space="preserve">' + xmlEsc(value) + '</t></is>'; }
    row.cells[p.c] = { attrs: attrs, inner: inner };
    this.dirty = true;
    return true;
  };
  Sheet.prototype.clear = function (addr) { return this.set(addr, null); };
  // ล้างค่าทุกเซลล์ที่ไม่ใช่สูตร ในช่วงคอลัมน์/แถวที่กำหนด
  Sheet.prototype.clearRange = function (c0, c1, r0, r1) {
    for (var r = r0; r <= r1; r++) {
      var row = this.rows[r];
      if (!row) continue;
      for (var c = c0; c <= c1; c++) if (row.cells[c] && !/<f[\s>\/]/.test(row.cells[c].inner) && row.cells[c].inner) this.set(colName(c) + r, null);
    }
  };
  Sheet.prototype.stripCachedFormulas = function () {
    var self = this;
    Object.keys(this.rows).forEach(function (r) {
      var cells = self.rows[r].cells;
      Object.keys(cells).forEach(function (c) {
        var x = cells[c];
        if (!/<f[\s>\/]/.test(x.inner)) return;
        var inner = x.inner.replace(/<v\b[^>]*>[\s\S]*?<\/v>/, '').replace(/<v\/>/, '');
        if (inner !== x.inner || attr(x.attrs, 't')) { x.inner = inner; x.attrs = setAttr(x.attrs, 't', null); self.dirty = true; }
      });
    });
  };
  Sheet.prototype.xml = function () {
    var self = this, keys = Object.keys(this.rows).map(Number).sort(function (a, b) { return a - b; });
    var body = keys.map(function (r) {
      var row = self.rows[r], ck = Object.keys(row.cells).map(Number).sort(function (a, b) { return a - b; });
      var cells = ck.map(function (c) { var x = row.cells[c]; return '<c' + x.attrs + (x.inner ? '>' + x.inner + '</c>' : '/>'); }).join('');
      var ra = setAttr(row.attrs, 'spans', null);
      return '<row' + ra + (cells ? '>' + cells + '</row>' : '/>');
    }).join('');
    if (this.selfClosing) return this.head + '<sheetData>' + body + '</sheetData>' + this.tail;
    return this.head + body + this.tail;
  };

  // ---------- สมุดงาน ----------
  function Book(zip) { this.zip = zip; this.sheets = {}; this.paths = {}; this.sst = []; }
  Book.prototype.init = async function () {
    var wbXml = await this.zip.file('xl/workbook.xml').async('string');
    this.wbXml = wbXml;
    var wbRels = rels(await this.zip.file('xl/_rels/workbook.xml.rels').async('string'));
    var re = /<sheet\b[^>]*>/g, m;
    this.order = [];
    while ((m = re.exec(wbXml))) {
      var name = xmlUnesc(attr(m[0], 'name')), rid = attr(m[0], 'r:id');
      if (wbRels[rid]) { this.paths[name] = resolve('xl/workbook.xml', wbRels[rid]); this.order.push(name); }
    }
    var sstFile = this.zip.file('xl/sharedStrings.xml');
    if (sstFile) {
      var sx = await sstFile.async('string'), sre = /<si>([\s\S]*?)<\/si>/g, sm;
      while ((sm = sre.exec(sx))) {
        var txt = '', tre = /<t[^>]*>([\s\S]*?)<\/t>/g, tm;
        var inner = sm[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
        while ((tm = tre.exec(inner))) txt += xmlUnesc(tm[1]);
        this.sst.push(txt);
      }
      this.sstXml = sx;
    }
    return this;
  };
  Book.prototype.has = function (name) { return !!this.paths[name]; };
  Book.prototype.sheet = async function (name) {
    if (this.sheets[name]) return this.sheets[name];
    var p = this.paths[name];
    if (!p) return null;
    var s = new Sheet(this, p, await this.zip.file(p).async('string'));
    this.sheets[name] = s;
    return s;
  };
  Book.prototype.loadAll = async function () { for (var i = 0; i < this.order.length; i++) await this.sheet(this.order[i]); };
  Book.prototype.drawingOf = async function (name) {
    var p = this.paths[name];
    if (!p) return null;
    var relPath = p.replace(/([^/]+)$/, '_rels/$1.rels'), rf = this.zip.file(relPath);
    if (!rf) return null;
    var r = rels(await rf.async('string'));
    for (var k in r) if (/drawings\//.test(r[k])) return resolve(p, r[k]);
    return null;
  };
  // สไตล์ (s) ของเซลล์ในชีตอื่น เพื่อให้ชีตใหม่ใช้ฟอนต์/กรอบเดียวกับไฟล์ต้นฉบับ
  Book.prototype.styleOf = async function (sheetName, addr) {
    var ws = await this.sheet(sheetName);
    var c = ws && ws.cell(addr);
    return c ? attr(c.attrs, 's') : null;
  };
  // เพิ่มชีตใหม่ไว้ท้ายสุด (ไม่กระทบลำดับชีตเดิม มาโคร และพื้นที่พิมพ์) และให้เปิดไฟล์มาที่ชีตนี้
  Book.prototype.addSheet = async function (name, sheetXml, makeActive) {
    if (this.paths[name]) return false;
    var n = 1;
    while (this.zip.file('xl/worksheets/sheet' + n + '.xml')) n++;
    var path = 'xl/worksheets/sheet' + n + '.xml';
    this.zip.file(path, sheetXml);
    var ct = await this.zip.file('[Content_Types].xml').async('string');
    ct = ct.replace('</Types>', '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    this.zip.file('[Content_Types].xml', ct);
    var relsPath = 'xl/_rels/workbook.xml.rels', rx = await this.zip.file(relsPath).async('string');
    var id = 1;
    while (rx.indexOf('Id="rId' + id + '"') >= 0) id++;
    rx = rx.replace('</Relationships>', '<Relationship Id="rId' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/></Relationships>');
    this.zip.file(relsPath, rx);
    var maxId = 0, re = /<sheet\b[^>]*sheetId="(\d+)"/g, m;
    while ((m = re.exec(this.wbXml))) maxId = Math.max(maxId, +m[1]);
    this.wbXml = this.wbXml.replace('</sheets>', '<sheet name="' + xmlEsc(name) + '" sheetId="' + (maxId + 1) + '" r:id="rId' + id + '"/></sheets>');
    var index = this.order.length;
    this.order.push(name); this.paths[name] = path;
    if (makeActive) {
      if (/<workbookView\b[^>]*activeTab="/.test(this.wbXml)) this.wbXml = this.wbXml.replace(/(<workbookView\b[^>]*activeTab=")\d+"/, '$1' + index + '"');
      else this.wbXml = this.wbXml.replace(/<workbookView\b/, '<workbookView activeTab="' + index + '"');
      this.wbXml = this.wbXml.replace(/(<workbookView\b[^>]*?)\sfirstSheet="\d+"/, '$1');
      await this.loadAll();
      var self = this;
      this.order.forEach(function (nm) {
        var sh = self.sheets[nm];
        if (sh && sh.path !== path && /tabSelected="1"/.test(sh.head)) { sh.head = sh.head.replace(/\s*tabSelected="1"/g, ''); sh.dirty = true; }
      });
    }
    this.sheets[name] = new Sheet(this, path, sheetXml);
    return true;
  };

  // ส่งออก: ลบค่าแคชของสูตร ให้ Excel คำนวณใหม่ตอนเปิด และลดตาราง sharedStrings ให้เหลือเฉพาะที่ใช้
  Book.prototype.output = async function () {
    await this.loadAll();
    var self = this;
    this.order.forEach(function (n) { self.sheets[n].stripCachedFormulas(); });
    if (this.sstXml != null) {
      var used = {}, list = [];
      this.order.forEach(function (n) {
        var rows = self.sheets[n].rows;
        Object.keys(rows).forEach(function (r) {
          var cells = rows[r].cells;
          Object.keys(cells).forEach(function (c) {
            var x = cells[c];
            if (attr(x.attrs, 't') !== 's') return;
            var vm = /<v>(\d+)<\/v>/.exec(x.inner);
            if (!vm) return;
            var old = +vm[1];
            if (used[old] == null) { used[old] = list.length; list.push(old); }
            x.inner = x.inner.replace(/<v>\d+<\/v>/, '<v>' + used[old] + '</v>');
            self.sheets[n].dirty = true;
          });
        });
      });
      var sis = [], sre = /<si>[\s\S]*?<\/si>/g, sm;
      while ((sm = sre.exec(this.sstXml))) sis.push(sm[0]);
      var head = this.sstXml.slice(0, this.sstXml.indexOf('>', this.sstXml.indexOf('<sst')) + 1)
        .replace(/\scount="\d+"/, '').replace(/\suniqueCount="\d+"/, '').replace(/<sst\b/, '<sst count="' + list.length + '" uniqueCount="' + list.length + '"');
      this.zip.file('xl/sharedStrings.xml', head + list.map(function (i) { return sis[i]; }).join('') + '</sst>');
    }
    this.order.forEach(function (n) { var s = self.sheets[n]; if (s.dirty) self.zip.file(s.path, s.xml()); });
    var wb = this.wbXml;
    if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)(\/?)>/, function (m, a, sl) { return '<calcPr' + setAttr(a, 'fullCalcOnLoad', '1') + sl + '>'; });
    else wb = wb.replace(/(<\/definedNames>|<\/sheets>)(?![\s\S]*(<\/definedNames>))/, '$1<calcPr fullCalcOnLoad="1"/>');
    this.zip.file('xl/workbook.xml', wb);
    // calcChain อาจอ้างเซลล์ที่ไม่มีค่าแล้ว ลบทิ้งให้ Excel สร้างใหม่
    if (this.zip.file('xl/calcChain.xml')) {
      this.zip.remove('xl/calcChain.xml');
      var ct = await this.zip.file('[Content_Types].xml').async('string');
      this.zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''));
      var wr = await this.zip.file('xl/_rels/workbook.xml.rels').async('string');
      this.zip.file('xl/_rels/workbook.xml.rels', wr.replace(/<Relationship[^>]*calcChain[^>]*\/>/, ''));
    }
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  };

  async function open(bytes) {
    var Z = JSZip || (typeof window !== 'undefined' && window.JSZip);
    var zip = await Z.loadAsync(bytes);
    return new Book(zip).init();
  }

  return { open: open, colName: colName, colNum: colNum, split: split, xmlEsc: xmlEsc };
});
