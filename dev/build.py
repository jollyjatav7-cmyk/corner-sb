"""Assemble the app from dev/src + dev/data into one index.html (plus sw.js, manifest, README).

Usage (from the repo root):  python3 -I dev/build.py [out_dir]
out_dir defaults to the repo root, which is what GitHub Pages serves.
"""
import os
import shutil
import sys

DEV = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(DEV, 'src')
DATA = os.path.join(DEV, 'data')
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(DEV)


def read(*p):
    return open(os.path.join(*p), encoding='utf-8').read()


model = read(DATA, 'model.json').strip()
core = read(SRC, 'model.js').replace('__MODEL__', model)
core = '\n'.join(l for l in core.split('\n') if not l.startswith("if (typeof module !== 'undefined') module.exports"))
html = read(SRC, 'app.html')
for key in ('__MODELJS__', '__VALTEXT__', '__HCAPTEXT__'):
    assert html.count(key) == 1, f'{key} must appear exactly once in app.html'
import re
ver = re.search(r"corner-sb-(v\d+)", read(SRC, 'sw.js')).group(1)   # 版本号跟着 sw.js 的快取名称
assert html.count('__APPVER__') == 1, '__APPVER__ must appear exactly once in app.html'
html = html.replace('__APPVER__', ver)
html = (html.replace('__MODELJS__', core)
            .replace('__VALTEXT__', read(DATA, 'valtext.txt').strip())
            .replace('__HCAPTEXT__', read(DATA, 'hcaptext.txt').strip()))
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)
for f in ('sw.js', 'manifest.webmanifest', 'README.md'):
    shutil.copy(os.path.join(SRC, f), os.path.join(OUT, f))
print('built', len(html), 'bytes ->', OUT)
