"""🎬 AI Drama workflow demo: dev/drama/drama.template.html + the previz frames (shot*.webp) -> drama.html (one file).
   python3 dev/drama/build.py   (dev/release.py runs it and copies the page to the hand-in folder as ai-drama-demo.html)"""
import base64, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def build() -> pathlib.Path:
    html = (HERE / 'drama.template.html').read_text(encoding='utf-8')
    def emb(m: re.Match) -> str:
        f = HERE / m.group(1)
        return 'data:image/webp;base64,' + base64.b64encode(f.read_bytes()).decode()
    html = html.replace('{{studio.js}}', (HERE / 'studio.js').read_text(encoding='utf-8').replace('</script', '<\\/script'))
    out = ROOT / 'drama.html'
    out.write_text(re.sub(r'\{\{([\w.-]+\.webp)\}\}', emb, html), encoding='utf-8')
    return out


if __name__ == '__main__':
    p = build(); print(f'{p} {p.stat().st_size:,} B')
