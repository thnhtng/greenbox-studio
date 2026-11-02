"""AX Hero service intro page: intro.template.html with its pictures (dev/axhero/shots) and demo videos (dev/axhero/videos) embedded -> ax-hero/introduction.html"""
import base64, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'ax-hero' / 'introduction.html'
MIME = {'.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4'}
s = (HERE / 'intro.template.html').read_text()
s = re.sub(r'\{\{([\w.-]+)\}\}', lambda m: 'data:%s;base64,%s' % (MIME[pathlib.Path(m.group(1)).suffix], base64.b64encode(((HERE / 'videos') if m.group(1).endswith('.mp4') else (HERE / 'shots')).joinpath(m.group(1)).read_bytes()).decode()), s)
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(s)
print('%s: %.2f MB' % (OUT, OUT.stat().st_size / 1048576))
