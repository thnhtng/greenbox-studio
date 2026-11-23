"""Puts the emerald glass layer into the pages (run again after editing the .css files: it replaces its own blocks).
   cockpit-glass.css -> Greenbox-Cockpit.html (last <style>, so it wins over the older theme layers)
   intro-glass.css   -> dev/axhero/intro.template.html (then intro.py rebuilds the page)
   page-glass.css    -> hpbar.html, sfx-bench.html (end of <head>) and rig3d/gb-theme.js (the 3D pages)"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).parent
FONTS = ('<link id="gb-glass-fonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap">'
         '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">')
FONT_URLS = ['https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap',
             'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css']


def put(path: pathlib.Path, block_id: str, css: str, where: str) -> None:
    s = path.read_text()
    block = f'<!--{block_id}-->{FONTS}<style id="{block_id}">\n{css}</style><!--/{block_id}-->'
    s, n = re.subn(rf'<!--{block_id}-->.*?<!--/{block_id}-->', lambda m: block, s, flags=re.S)
    if n == 0:
        i = s.rfind(where)
        assert i >= 0, f'{where} not found in {path.name}'
        s = s[:i] + block + s[i:]
    path.write_text(s)
    print(f'{path.name}: glass {"updated" if n else "added"}')


import base64
LOGO = 'data:image/webp;base64,' + base64.b64encode((HERE / 'logo-64.webp').read_bytes()).decode()
FAV = LOGO  # the same small webp (all current browsers take a webp favicon)
cockpit = (HERE / 'cockpit-glass.css').read_text().replace('__GB_LOGO__', LOGO)
page = (HERE / 'page-glass.css').read_text().replace('__GB_LOGO__', LOGO)
put(ROOT / 'Greenbox-Cockpit.html', 'gbc-glass', cockpit, '</body>')
for name in ['hpbar.html', 'sfx-bench.html']:
    put(ROOT / name, 'gb-glass', page, '</head>')
put(ROOT / 'dev/axhero/intro.template.html', 'intro-glass', (HERE / 'intro-glass.css').read_text().replace('__GB_LOGO__', LOGO), '</head>')

# line icons (Lucide) in place of emoji: gb-icons.js (python3 dev/glass/build_icons.py makes it)
import sys; sys.path.insert(0, str(HERE)); from build_icons import build as build_icons
# each page gets only the icons for the emoji it holds; the 3D pages: everything in the app's source
SRC3D = pathlib.Path.home() / 'gb-build/mesh2motion-app/src/greenbox'
TEXT3D = ''.join(f.read_text(errors='ignore') for f in [*SRC3D.rglob('*.ts'), *(ROOT / 'rig3d').glob('*.html'), ROOT / 'rig3d/gb-i18n.js'])
ICONS = build_icons(TEXT3D)
def put_js(path: pathlib.Path, block_id: str, js: str, where: str) -> None:
    s = path.read_text()
    block = f'<!--{block_id}--><script id="{block_id}">\n{js}</script><!--/{block_id}-->'
    s, n = re.subn(rf'<!--{block_id}-->.*?<!--/{block_id}-->', lambda m: block, s, flags=re.S)
    if n == 0:
        i = s.rfind(where); assert i >= 0, where
        s = s[:i] + block + s[i:]
    path.write_text(s); print(f'{path.name}: icons {"updated" if n else "added"}')
put_js(ROOT / 'dev/axhero/intro.template.html', 'intro-motion', (HERE / 'intro-motion.js').read_text(), '</body>')
put_js(ROOT / 'Greenbox-Cockpit.html', 'gbc-featjs', (HERE / 'cockpit-feat.js').read_text(), '</body>')
put_js(ROOT / 'Greenbox-Cockpit.html', 'gbc-tourjs', (HERE / 'cockpit-tour.js').read_text(), '</body>')
put_js(ROOT / 'Greenbox-Cockpit.html', 'gbc-introjs', (HERE / 'cockpit-intro.js').read_text(), '</body>')
put_js(ROOT / 'Greenbox-Cockpit.html', 'gbc-flowjs', (HERE / 'cockpit-flow.js').read_text(), '</body>')
FAVJS = "(function(){var l=document.querySelector('link[rel~=icon]');if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l)}l.type='image/webp';l.href=" + json.dumps(FAV) + "})();\n"
for name in ['Greenbox-Cockpit.html', 'hpbar.html', 'sfx-bench.html', 'dev/axhero/intro.template.html']:
    put_js(ROOT / name, 'gb-fav', FAVJS, '</body>')
for name, where in [('Greenbox-Cockpit.html', '</body>'), ('hpbar.html', '</body>'), ('sfx-bench.html', '</body>'), ('dev/axhero/intro.template.html', '</body>')]:
    put_js(ROOT / name, 'gb-icons', build_icons(re.sub(r'<!--gb-icons-->.*?<!--/gb-icons-->', '', (ROOT / name).read_text(), flags=re.S) + ((ROOT / 'gb-ai/chat.js').read_text() if name == 'Greenbox-Cockpit.html' else '') + ('' if 'intro' not in name else (ROOT / 'Greenbox-Cockpit.html').read_text()[(ROOT / 'Greenbox-Cockpit.html').read_text().find('const GROUPS=['):][:40000] + '🧩')), where)  # intro: + the layout cards (cockpit feature list)

# the 3D pages: gb-theme.js adds the same layer as one more <style> (+ the two fonts)
js = ROOT / 'rig3d/gb-theme.js'
s = js.read_text()
code = ('/*GLASS*/(function(){var d=document,h=d.head||d.documentElement,s=d.createElement("style");s.id="gb-glass";s.textContent='
        + json.dumps(page) + ';h.appendChild(s);' + ''.join(f'var l{i}=d.createElement("link");l{i}.rel="stylesheet";l{i}.href={json.dumps(u)};h.appendChild(l{i});' for i, u in enumerate(FONT_URLS))
        + '})();/*/GLASS*/\n')
s, n = re.subn(r'/\*GLASS\*/.*?/\*/GLASS\*/\n', lambda m: code, s, flags=re.S)
if n == 0: s = s + code
icode = '/*ICONS*/' + ICONS + FAVJS + '/*/ICONS*/\n'
s, k = re.subn(r'/\*ICONS\*/.*?/\*/ICONS\*/\n', lambda m: icode, s, flags=re.S)
if k == 0: s = s + icode
js.write_text(s)
print(f'gb-theme.js: glass {"updated" if n else "added"}')
