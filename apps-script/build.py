#!/usr/bin/env python3
"""สร้างไฟล์สำหรับ Google Apps Script จากโค้ดหน้าเว็บใน pp5/

ผลลัพธ์ (โฟลเดอร์ apps-script/):
  Code.gs          โค้ดฝั่งเซิร์ฟเวอร์ (คัดลอกจาก src/Code.gs)
  Index.html       โครงหน้าเว็บ (ดึงไฟล์อื่นเข้ามาด้วย include)
  Css.html         หน้าตา (CSS)
  JsStore.html     เชื่อมต่อ Google Drive
  JsParser.html    อ่านไฟล์ ปพ.5
  JsPP6Parser.html อ่านไฟล์ ปพ.6
  JsReport.html    ใบรายงาน ปพ.6 และ PDF
  JsApp.html       หน้าจอหลัก
  appsscript.json  ไฟล์ตั้งค่าโปรเจกต์ (สำหรับผู้ใช้ clasp)

วิธีใช้:  python3 apps-script/build.py
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
WEB = HERE.parent / 'pp5'
SRC = HERE / 'src'

CDN_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'


def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8')


def inline_js(code):
    # กัน </script> ในโค้ดปิดแท็กก่อนเวลา และกันแท็ก scriptlet ของ Apps Script
    return code.replace('</script', '<\\/script').replace('<?', '<\\?')


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit('หาไม่เจอหรือเจอซ้ำ: ' + old[:60])
    return text.replace(old, new)


def build():
    html = read(WEB / 'index.html')
    css = read(WEB / 'style.css') + '\n' + read(WEB / 'report.css') + '\n[hidden]{display:none!important}\n'

    html = replace_once(html, '<link rel="stylesheet" href="style.css">', "<?!= include('Css') ?>")
    (HERE / 'Css.html').write_text('<style>\n' + css + '</style>\n', encoding='utf-8')
    html = replace_once(html, '  <link rel="stylesheet" href="report.css">\n', '')
    html = re.sub(r'\s*<link rel="(icon|apple-touch-icon)"[^>]*>', '', html)
    html = re.sub(r'\s*<meta name="viewport"[^>]*>', '', html)  # Apps Script ใส่ให้ใน doGet
    html = replace_once(
        html,
        '<a class="home" href="../" title="กลับหน้าแอปห้องเรียน">‹</a>',
        '<a class="home" id="driveLink" href="#" target="_blank" rel="noopener" hidden title="เปิดโฟลเดอร์ใน Google Drive">📁</a>')
    html = replace_once(
        html,
        'ไฟล์และคะแนนเก็บไว้ในเบราว์เซอร์ของเครื่องนี้เท่านั้น ไม่ได้ส่งขึ้นอินเทอร์เน็ต ระบบไม่อ่านเลขประจำตัวประชาชน',
        'ไฟล์และคะแนนเก็บใน Google Drive ของผู้ดูแลระบบ (แตะ 📁 มุมบนเพื่อเปิดโฟลเดอร์) ระบบไม่อ่านเลขประจำตัวประชาชน')

    parts = [('JsStore', SRC / 'store.js'), ('JsParser', WEB / 'parser.js'), ('JsPP6Parser', WEB / 'pp6parser.js'),
             ('JsReport', WEB / 'report.js'), ('JsApp', WEB / 'app.js')]
    html = replace_once(html, '<script src="vendor/xlsx.full.min.js"></script>', '<script src="' + CDN_XLSX + '"></script>')
    html = re.sub(r'  <script src="(parser|pp6parser|report|app)\.js"></script>\n', '', html)
    if re.search(r'(src|href)="(?!https://|#)', html):
        raise SystemExit('ยังมีไฟล์ที่อ้างแบบ relative เหลืออยู่')
    html = replace_once(html, '</body>', ''.join("  <?!= include('%s') ?>\n" % n for n, _ in parts) + '</body>')
    for n, p in parts:
        (HERE / (n + '.html')).write_text('<script>\n' + inline_js(read(p)) + '\n</script>\n', encoding='utf-8')
    (HERE / 'Index.html').write_text(html, encoding='utf-8')
    (HERE / 'Code.gs').write_text(read(SRC / 'Code.gs'), encoding='utf-8')
    manifest = {
        'timeZone': 'Asia/Bangkok',
        'exceptionLogging': 'STACKDRIVER',
        'runtimeVersion': 'V8',
        'oauthScopes': ['https://www.googleapis.com/auth/drive'],
        'webapp': {'executeAs': 'USER_DEPLOYING', 'access': 'ANYONE'},
    }
    (HERE / 'appsscript.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Index.html', len(html.encode('utf-8')) // 1024, 'KB')


if __name__ == '__main__':
    build()
