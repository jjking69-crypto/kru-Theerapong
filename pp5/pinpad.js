/*
 * แป้นกดรหัสแบบมือถือ (Android) ใช้ทั้งหน้าประกาศผลและหลังบ้าน
 *   PP5PinPad.ask({ title, sub, length, check }) -> Promise<string|null>
 *   check(pin) -> Promise<true | 'ข้อความผิดพลาด'>  (ไม่ใส่ = คืนค่าที่กดทันที)
 */
(function (root) {
  'use strict';
  var CSS = '' +
    '.pinpad-bg{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;animation:ppfade .15s}' +
    '@keyframes ppfade{from{opacity:0}to{opacity:1}}' +
    '.pinpad{background:#fff;color:#0f172a;border-radius:22px;width:100%;max-width:330px;padding:22px 20px 18px;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:Sarabun,"TH Sarabun New",sans-serif;text-align:center}' +
    '.pinpad h3{margin:2px 0 4px;font:600 20px Prompt,Sarabun,sans-serif}' +
    '.pinpad .pp-sub{margin:0 0 14px;color:#64748b;font-size:14px;min-height:20px}' +
    '.pinpad .pp-sub.err{color:#dc2626;font-weight:600}' +
    '.pp-dots{display:flex;justify-content:center;gap:12px;margin:6px 0 18px;min-height:16px}' +
    '.pp-dots i{width:14px;height:14px;border-radius:50%;border:2px solid #94a3b8;display:block;transition:.12s}' +
    '.pp-dots i.on{background:#1b3fae;border-color:#1b3fae;transform:scale(1.08)}' +
    '.pp-dots.shake{animation:ppshake .35s}' +
    '@keyframes ppshake{20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}' +
    '.pp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;justify-items:center}' +
    '.pp-k{width:72px;height:72px;border-radius:50%;border:0;background:#eef2f7;font:500 28px Prompt,Sarabun,sans-serif;color:#0f172a;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none}' +
    '.pp-k:active,.pp-k.hit{background:#c7d2fe}' +
    '.pp-k.fn{background:transparent;font-size:16px;color:#475569}' +
    '.pp-k.ok{background:#1b3fae;color:#fff;font-size:17px}' +
    '.pp-k.ok:disabled{background:#cbd5e1}' +
    '.pp-cancel{margin-top:14px;background:none;border:0;color:#64748b;font:15px Sarabun,sans-serif;cursor:pointer;padding:6px 14px}' +
    '@media (max-width:360px){.pp-k{width:62px;height:62px;font-size:24px}}';

  function injectCss() {
    if (document.getElementById('pinpad-css')) return;
    var st = document.createElement('style'); st.id = 'pinpad-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  function ask(o) {
    o = o || {};
    injectCss();
    var maxLen = o.length || 8;
    return new Promise(function (resolve) {
      var val = '', busy = false;
      var bg = document.createElement('div');
      bg.className = 'pinpad-bg';
      bg.innerHTML = '<div class="pinpad" role="dialog" aria-modal="true" aria-label="กรอกรหัส">' +
        '<h3>' + (o.title || 'กรอกรหัสผ่าน') + '</h3><p class="pp-sub">' + (o.sub || 'กดตัวเลขบนแป้น') + '</p>' +
        '<div class="pp-dots"></div><div class="pp-grid">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button type="button" class="pp-k" data-k="' + n + '">' + n + '</button>'; }).join('') +
        '<button type="button" class="pp-k fn" data-k="del" aria-label="ลบ">⌫</button><button type="button" class="pp-k" data-k="0">0</button>' +
        '<button type="button" class="pp-k ok" data-k="ok" disabled>ตกลง</button></div>' +
        '<button type="button" class="pp-cancel">ยกเลิก</button></div>';
      document.body.appendChild(bg);
      var dots = bg.querySelector('.pp-dots'), sub = bg.querySelector('.pp-sub'), okBtn = bg.querySelector('[data-k=ok]');
      function draw() {
        var n = Math.max(val.length, Math.min(maxLen, 6)), h = '';
        for (var i = 0; i < n; i++) h += '<i class="' + (i < val.length ? 'on' : '') + '"></i>';
        dots.innerHTML = h; okBtn.disabled = !val.length || busy;
      }
      function done(v) { document.removeEventListener('keydown', onKey); bg.remove(); resolve(v); }
      function fail(msg) {
        val = ''; sub.textContent = msg || 'รหัสไม่ถูกต้อง'; sub.classList.add('err');
        dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
        if (navigator.vibrate) try { navigator.vibrate(120); } catch (e) {}
        draw();
      }
      function submit() {
        if (!val || busy) return;
        if (!o.check) return done(val);
        busy = true; sub.textContent = 'กำลังตรวจสอบ...'; sub.classList.remove('err'); draw();
        Promise.resolve(o.check(val)).then(function (r) {
          busy = false;
          if (r === true) done(val); else fail(typeof r === 'string' ? r : '');
        }, function (e) { busy = false; fail(e && e.message ? e.message : 'ตรวจสอบไม่สำเร็จ'); });
      }
      function press(k) {
        if (busy) return;
        if (k === 'del') val = val.slice(0, -1);
        else if (k === 'ok') return submit();
        else if (val.length < maxLen + 4) val += k;
        sub.classList.remove('err'); sub.textContent = o.sub || 'กดตัวเลขบนแป้น';
        draw();
        if (o.autoSubmit !== false && o.length && val.length === o.length) submit();
      }
      function onKey(e) {
        if (/^[0-9]$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') press('del');
        else if (e.key === 'Enter') press('ok');
        else if (e.key === 'Escape') done(null);
        else return;
        e.preventDefault();
      }
      bg.addEventListener('click', function (e) {
        var b = e.target.closest('[data-k]');
        if (b) { b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 110); press(b.dataset.k); }
        else if (e.target.closest('.pp-cancel') || e.target === bg) done(null);
      });
      document.addEventListener('keydown', onKey);
      draw();
    });
  }
  root.PP5PinPad = { ask: ask };
})(typeof self !== 'undefined' ? self : this);
