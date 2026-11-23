#!/usr/bin/env python3
"""Put the current playable runtime (rig3d/playable-runtime.js) into a playable that was exported earlier.

A playable is one HTML file: <script>window.__GB_PLAYABLE={map, char, plan…}</script><script>RUNTIME</script>.
The game data stays as it is; the runtime (controls, HUD, sound, tutorial, end card) is replaced, so an old export
gets the new look without opening Greenbox and exporting again.

    python3 dev/replayable.py IN.html [OUT.html] [--title "Name"] [--lang vi|en|ko] [--limit SECONDS] [--cta URL]

OUT defaults to IN (the old file is kept beside it as IN.html.bak the first time).
"""
import argparse, html, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUNTIME = os.path.join(HERE, '..', 'rig3d', 'playable-runtime.js')
MARK = '<script>window.__GB_PLAYABLE='


def safe(t):  # same as PlaytestApp.playable_html
    import re
    return re.sub(r'</script', r'<\\/script', t, flags=re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out', nargs='?')
    ap.add_argument('--title'); ap.add_argument('--lang'); ap.add_argument('--limit', type=int); ap.add_argument('--cta')
    a = ap.parse_args()
    out = a.out or a.src
    s = open(a.src, encoding='utf-8').read()
    i = s.find(MARK)
    if i < 0: sys.exit('not a Greenbox playable: ' + a.src)
    j = s.find('</script>', i)
    data = json.loads(s[i + len(MARK):j].replace('<\\/script', '</script'))
    if a.title is not None: data['title'] = a.title
    if a.lang is not None: data['lang'] = a.lang
    if a.limit is not None: data['limit'] = a.limit
    if a.cta is not None: data['cta'] = a.cta
    title = data.get('title') or 'Greenbox playable'; lang = data.get('lang') or 'en'
    data['title'] = title; data['lang'] = lang
    runtime = open(RUNTIME, encoding='utf-8').read()
    page = ('<!doctype html><html lang="%s"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">'
            '<meta name="ad.size" content="width=320,height=480"><title>%s</title>'
            '<style>html,body{margin:0;height:100%%;overflow:hidden;background:#0e1522;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}</style>'
            '</head><body>' % (lang, html.escape(title))
            + MARK + safe(json.dumps(data, ensure_ascii=False, separators=(',', ':'))) + '</script><script>' + safe(runtime) + '</script></body></html>')
    if out == a.src and not os.path.exists(a.src + '.bak'): shutil.copyfile(a.src, a.src + '.bak')
    open(out, 'w', encoding='utf-8').write(page)
    print('%s: %d B (%.2f MB), title "%s", lang %s, limit %s s, cta %s' % (out, os.path.getsize(out), os.path.getsize(out) / 1048576, title, lang, data.get('limit', 0), data.get('cta') or '-'))


if __name__ == '__main__':
    main()
