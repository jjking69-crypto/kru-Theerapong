/*
 * เตรียมรูปลายเซ็น/โลโก้ก่อนอัปโหลด: ย่อขนาด และ (เลือกได้) ทำพื้นกระดาษสีขาวให้โปร่งใส
 *   PP5Img.prepare(file, { maxW: 600, maxH: 300, clearWhite: true }) -> Promise<dataURL png>
 */
(function (root) {
  'use strict';
  function load(file) {
    return new Promise(function (res, rej) {
      if (!/^image\//.test(file.type || '')) return rej(new Error('กรุณาเลือกไฟล์รูปภาพ (PNG / JPG)'));
      var fr = new FileReader();
      fr.onload = function () { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('เปิดรูปไม่ได้')); }; im.src = fr.result; };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(file);
    });
  }
  async function prepare(file, o) {
    o = o || {};
    var im = await load(file), maxW = o.maxW || 600, maxH = o.maxH || 300;
    var k = Math.min(1, maxW / im.width, maxH / im.height);
    var w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var g = cv.getContext('2d'); g.drawImage(im, 0, 0, w, h);
    if (o.clearWhite) {
      // พื้นขาว/เทาอ่อนของกระดาษ → โปร่งใส เหลือแต่เส้นหมึก
      var px = g.getImageData(0, 0, w, h), a = px.data;
      for (var i = 0; i < a.length; i += 4) {
        var l = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
        if (l > 200) a[i + 3] = 0;
        else if (l > 150) a[i + 3] = Math.round(a[i + 3] * (200 - l) / 50);
      }
      g.putImageData(px, 0, 0);
    }
    return cv.toDataURL('image/png');
  }
  root.PP5Img = { prepare: prepare };
})(typeof self !== 'undefined' ? self : this);
