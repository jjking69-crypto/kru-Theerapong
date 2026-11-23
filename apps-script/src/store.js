/* ที่เก็บข้อมูลรุ่น Apps Script: เรียกฟังก์ชันใน Code.gs ผ่าน google.script.run แล้วเก็บไฟล์ใน Google Drive */
(function () {
  'use strict';

  // ไลบรารีสร้าง PDF โหลดจาก CDN (Apps Script เก็บไฟล์ใหญ่ไม่สะดวก)
  window.PP5_LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  ];
  function b64ToBytes(b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  var PIN_KEY = window.PP5_PIN_KEY || 'pp5-pin';
  function getPin() { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return window.__pp5pin || ''; } }
  function setPin(v) { window.__pp5pin = v; try { localStorage.setItem(PIN_KEY, v); } catch (e) { /* ใช้ค่าในหน่วยความจำ */ } }

  function raw(fn, args) {
    return new Promise(function (res, rej) {
      var runner = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) {
        rej(e instanceof Error ? e : new Error(e && e.message ? e.message : String(e)));
      });
      runner[fn].apply(runner, [getPin()].concat(args || []));
    });
  }
  // ขอรหัสด้วยแป้นตัวเลขบนจอ (ครู 8 หลัก / ผู้ดูแลระบบหลัก)
  var asking = null;
  function askPin(msg) {
    if (asking) return asking;
    asking = window.PP5PinPad.ask({
      title: window.PP5_NEED_ADMIN ? 'เข้าสู่ระบบผู้ดูแล (แอดมิน)' : 'เข้าสู่ระบบสำหรับครู', sub: msg || 'กรอกรหัสผ่าน แล้วกด ตกลง', length: 12, autoSubmit: false,
      check: function (p) {
        return new Promise(function (res) {
          google.script.run.withSuccessHandler(function (r) {
            if (r && r.role && window.PP5_NEED_ADMIN && r.role !== 'admin') return res('รหัสนี้เป็นรหัสครู ใช้เข้าระบบครูเท่านั้น');
            res(r && r.role ? true : (r && r.locked ? 'ใส่รหัสผิดหลายครั้ง กรุณารอ 10 นาที' : 'รหัสไม่ถูกต้อง'));
          })
            .withFailureHandler(function () { res('เชื่อมต่อไม่สำเร็จ ลองใหม่'); }).api_checkPin(p);
        });
      }
    }).then(function (p) { asking = null; if (p == null) throw new Error('ต้องใส่รหัสผ่านเพื่อเข้าใช้งาน'); setPin(p); return p; });
    return asking;
  }
  function call(fn, args, tries) {
    return raw(fn, args).catch(function (err) {
      var m = err && err.message || '';
      if (/PIN_LOCKED/.test(m)) throw new Error('ใส่รหัสผิดหลายครั้ง ระบบพักการเข้าใช้ 10 นาที');
      if (/PIN_REQUIRED/.test(m) && (tries || 0) < 3) {
        return askPin(tries ? 'รหัสเดิมใช้ไม่ได้แล้ว กรุณากรอกใหม่' : '').then(function () { return call(fn, args, (tries || 0) + 1); });
      }
      throw err;
    });
  }
  window.PP5_LOGOUT = function () { setPin(''); try { localStorage.removeItem(PIN_KEY); } catch (e) {} location.reload(); };

  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).replace(/^data:[^,]*,/, '')); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  var MAX_UPLOAD = 40 * 1024 * 1024;

  window.PP5_STORE = {
    rootUrl: null,
    open: function () {
      var self = this;
      return call('api_ping').then(function (r) {
        self.rootUrl = r && r.rootUrl;
        self.role = r && r.role; self.flags = (r && r.flags) || {}; self.flagDefs = (r && r.flagDefs) || {};
        self.publicUrl = r && r.publicUrl;
        var link = document.getElementById('driveLink');
        if (link && self.rootUrl) { link.href = self.rootUrl; link.hidden = false; }
      });
    },
    all: function () { return call('api_list'); },
    put: async function (rec) {
      if (rec.size > MAX_UPLOAD) throw new Error('ไฟล์ใหญ่เกินไป (เกิน 40 MB)');
      var b64 = await blobToB64(rec.blob);
      var entry = {
        key: rec.key, year: rec.year, level: rec.level, room: rec.room, stage: rec.data && rec.data.meta.stage,
        slot: rec.slot, fileName: rec.fileName, origName: rec.origName, size: rec.size, uploadedAt: rec.uploadedAt,
        mime: rec.blob.type || 'application/octet-stream', school: rec.data && rec.data.meta.school || '',
        settings: rec.settings || null
      };
      var saved = await call('api_save', [entry, b64, JSON.stringify(rec.data)]);
      delete rec.blob; // ไฟล์อยู่ใน Drive แล้ว
      return saved;
    },
    ensureData: async function (recs) {
      var map = await call('api_getData', [recs.map(function (r) { return r.key; })]);
      recs.forEach(function (r) { if (map && map[r.key]) r.data = JSON.parse(map[r.key]); });
    },
    saveSettings: function (rec) { return call('api_saveSettings', [rec.key, JSON.stringify(rec.settings || {})]); },
    del: function (key) { return call('api_delete', [key]); },
    clear: function () { return call('api_clear'); },
    download: function (rec) {
      if (rec.url) window.open(rec.url, '_blank', 'noopener');
      else alert('ไม่พบลิงก์ไฟล์ใน Drive');
    },
    templateInfo: function () { return call('api_templateInfo'); },
    setFlags: function (f) { var self = this; return call('api_setFlags', [JSON.stringify(f)]).then(function (r) { self.flags = r; return r; }); },
    clearSourceCache: function () { return call('api_clearSourceCache'); },
    sourceList: function () { return call('api_sourceList'); },
    sourceFile: async function (id) { var t = await call('api_sourceFile', [id]); return { name: t.name, bytes: b64ToBytes(t.b64) }; },
    getRoster: async function () {
      var r = await call('api_getRoster');
      return r ? { fileName: r.fileName, url: r.url, uploadedAt: r.uploadedAt, data: JSON.parse(r.data) } : null;
    },
    putRoster: async function (r) {
      var d = r.data, dt = d.date ? d.date.display : (d.dateText || '');
      var info = await call('api_saveRoster', [await blobToB64(new Blob([r.bytes])), r.fileName, JSON.stringify(d), dt]);
      return { fileName: info.fileName, url: info.url, uploadedAt: info.uploadedAt, data: d };
    },
    getTemplate: async function (kind) {
      var t = await call('api_getTemplate', [kind]);
      return t ? { name: t.name, bytes: b64ToBytes(t.b64) } : null;
    },
    putTemplate: async function (kind, bytes, name) {
      return call('api_saveTemplate', [kind, await blobToB64(new Blob([bytes])), name]);
    },
    publish: function (key, pub) { return call('api_publish', [key, JSON.stringify(pub)]); },
    unpublish: function (key) { return call('api_unpublish', [key]); },
    publicStatus: function () { return call('api_publicStatus'); },
    getPublicCfg: function () { return call('api_getPublicCfg'); },
    savePublicCfg: function (cfg) { return call('api_savePublicCfg', [JSON.stringify(cfg)]); },
    saveOutput: async function (blob, name) {
      if (blob.size > MAX_UPLOAD) throw new Error('ไฟล์ใหญ่เกินกว่าจะเก็บสำเนาใน Drive อัตโนมัติ');
      return call('api_saveOutput', [name, await blobToB64(blob), blob.type || 'application/pdf']);
    }
  };
})();
