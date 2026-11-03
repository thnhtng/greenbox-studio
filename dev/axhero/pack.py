"""AX Hero mockup: the whole Greenbox tool in a ZIP under 5 MB that opens by double-clicking (no server).

  python3 dev/axhero/pack.py            -> ax-hero/Greenbox-Mockup.zip (+ the unzipped folder next to it)

What it does (see GREENBOX-HANDOFF.md, round 14):
  * the 3D pages (rig3d/*.html) run ES modules, which a browser refuses from file://. All their code is bundled with
    esbuild into ONE classic script, gb3d.js; each page says which part to start (window.__GB_PAGE).
  * fetch() from file:// is refused too, so the models / rigs / animations the pages load are embedded in
    gb3d-files.js and served by a small fetch shim. Animation sets are cut to the most useful clips and every 2nd key.
  * the cockpit's built-in pictures are re-encoded smaller (WebP).
  * pictures shown with <img> (rig references, icons) stay normal files: they load from file:// fine.
"""
import base64, json, os, re, shutil, subprocess, sys, zipfile, pathlib, io

ROOT = pathlib.Path(__file__).resolve().parents[2]
R3 = ROOT / 'rig3d'
M2M = pathlib.Path(os.environ.get('M2M', str(pathlib.Path.home() / 'gb-build/mesh2motion-app')))
OUT = ROOT / 'ax-hero'
DST = OUT / 'Greenbox-Mockup'
TRIM = ROOT / 'dev/axhero/glb_trim.py'
CONVERT = shutil.which('convert') or '/opt/ImageMagick/bin/convert'
LIMIT = 4_900_000  # under 5 MB however it is counted (5 000 000 or 5 MiB), with a little room

# clips kept per animation set (exact names); every set also gets every 2nd key and 16-bit rotations
KEEP = {
    'human-base-animations.glb': 'Idle_A,Jog,Walk,Sprint,Jump_Start,Jump_air,Jump_Land,Dance_Simple,Crouch_Walk,Hit_Chest,Death_D,Punch_Jab,Sword_Regular_Combo,Spell_Simple_Shoot,Roll',
    'human-addon-animations.glb': 'Backflip,Fighting Idle,Greeting,Dodge_left',
    'human-mocap-animations.glb': 'Salute',
    'fox-animations.glb': 'Idle,Walk,Run,Bite,Rest Pose',
    'horse-animations.glb': 'Idle,Walk,Run,Rear,Rest_Pose',
    'kaiju-animations.glb': 'Idle,Walk,Roar,Attack,Rest Pose',
    'spider-animations.glb': 'Idle,Walk,Attack,Rest Pose',
    'dragon-animations.glb': 'Idle,Walk,Fly Flap,Rest Pose',
    'shark-animations.glb': 'Idle,Swim Horizontal,Bite,Rest Pose',
    'snake-animations.glb': 'Idle,Side winding,Bite,Rest Pose',
    'xphero-animations.glb': 'Idle 3,Move 2,Jump,Landing,Attack_Sword_Bash1,Attack_Gun,SK_Slash,Hit 1,Die 2,Idle_Sword',
}
PAGES = {'create.html': 'create', 'index.html': 'index', 'mocap.html': 'mocap', 'playtest.html': 'playtest', 'vehicle.html': 'vehicle', 'smash.html': 'smash', 'retarget/index.html': 'retarget'}
ENTRY = {'create': 'create-', 'index': 'main-', 'mocap': 'mocap-', 'playtest': 'playtest-', 'vehicle': 'vehicle-', 'smash': 'smash-', 'retarget': 'retarget-'}
MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/'

SHIM = r'''/* Greenbox mockup: files the 3D pages fetch(), embedded (a browser does not fetch from file://) */
(function () {
  var F = window.__GB_FILES || {};
  var MIME = { mp4: 'video/mp4', glb: 'model/gltf-binary', png: 'image/png', webp: 'image/webp', json: 'application/json', js: 'text/javascript', css: 'text/css' };
  var cache = {};
  function key (u) {
    var s = String(u).split('#')[0].split('?')[0];
    try { s = decodeURIComponent(s); } catch (e) {}
    for (var k in F) if (s === k || s.slice(-k.length - 1) === '/' + k) return k;
    return null;
  }
  function bytes (k) {
    if (cache[k]) return cache[k];
    var b = atob(F[k]), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return (cache[k] = u);
  }
  var real = window.fetch && window.fetch.bind(window);
  window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && (input.href || input.url)) || '';
    var k = key(u);
    if (k) return Promise.resolve(new Response(bytes(k).slice(0), { status: 200, headers: { 'Content-Type': MIME[k.split('.').pop()] || 'application/octet-stream' } }));
    // a file this mockup does not carry: a clean "not found" instead of a browser error
    if (location.protocol === 'file:' && !/^(https?|data|blob):/i.test(u) && !/^(https?|data|blob):/i.test(String(new URL(u, location.href)))) {
      return Promise.resolve(new Response('', { status: 404, statusText: 'not in the mockup' }));
    }
    return real(input, init);
  };
})();
'''


def log(*a):
    print(*a, flush=True)


def sh(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise SystemExit(' '.join(map(str, cmd)) + '\n' + r.stdout + r.stderr)
    return r.stdout


def bundle_3d():
    entry = DST / '_entry.js'
    lines = ['const P = window.__GB_PAGE']
    for i, (page, pre) in enumerate(ENTRY.items()):
        f = next((R3 / 'assets').glob(pre + '*.js'))
        lines.append(('if' if i == 0 else 'else if') + f" (P === '{page}') import({json.dumps(str(f))})")
    entry.write_text('\n'.join(lines) + '\n')
    out = DST / 'rig3d' / 'gb3d.js'
    sh(['npx', 'esbuild', str(entry), '--bundle', '--format=iife', '--minify', '--target=es2022', '--outfile=' + str(out), '--log-level=error', '--loader:.css=empty'], cwd=str(M2M))
    entry.unlink()
    s = out.read_text()
    # the pose model (24 MB) comes from the internet in the mockup
    s = s.replace('./vendor/mediapipe-pose/', MEDIAPIPE_CDN).replace('vendor/mediapipe-pose/', MEDIAPIPE_CDN)
    out.write_text(s)
    return out


def trimmed(name):
    src = R3 / 'animations' / name
    tmp = OUT / '_tmp' / name
    tmp.parent.mkdir(parents=True, exist_ok=True)
    # people keep every 2nd key; animals (slower, smoother moves) every 3rd
    step = '2' if name.startswith(('human', 'xphero')) else '3'
    args = [sys.executable, str(TRIM), str(src), str(tmp), '--step', step, '--quant', '--nomesh']
    if name in KEEP:
        args += ['--keep', KEEP[name]]
    sh(args)
    return tmp.read_bytes()


def files_js():
    F = {}
    for p in sorted((R3 / 'rigs').glob('*.glb')): F['rigs/' + p.name] = p.read_bytes()
    for p in sorted((R3 / 'models').glob('*.glb')): F['models/' + p.name] = p.read_bytes()
    for p in sorted((R3 / 'animations').glob('*.glb')): F['animations/' + p.name] = trimmed(p.name)
    # XP Hero weapons (the default props of that rig)
    for p in sorted((R3 / 'props').glob('weapon_xp_*.glb')): F['props/' + p.name] = p.read_bytes()
    # the sample clip of Video mocap (smaller copy)
    tmp = OUT / '_tmp' / 'mocap-sample.mp4'; tmp.parent.mkdir(parents=True, exist_ok=True)
    sh(['ffmpeg', '-v', 'error', '-y', '-i', str(R3 / 'samples/mocap-sample.mp4'), '-vf', 'scale=288:-2,fps=24', '-c:v', 'libx264', '-crf', '38', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', str(tmp)])
    F['samples/mocap-sample.mp4'] = tmp.read_bytes()
    js = 'window.__GB_FILES={' + ','.join(json.dumps(k) + ':"' + base64.b64encode(v).decode() + '"' for k, v in F.items()) + '};\n' + SHIM
    out = DST / 'rig3d' / 'gb3d-files.js'
    out.write_text(js)
    return out, {k: len(v) for k, v in F.items()}


def pages():
    css_cache = {}
    for rel, page in PAGES.items():
        src = (R3 / rel).read_text()
        pre = '../' if '/' in rel else './'
        def inline_css(m):
            href = m.group(1).split('?')[0].replace('../', '').replace('./', '')
            if href not in css_cache: css_cache[href] = (R3 / href).read_text()
            return '<style>' + css_cache[href] + '</style>'
        s = re.sub(r'<link rel="stylesheet" crossorigin href="([^"]+)">', inline_css, src)
        s = re.sub(r'<script type="module" crossorigin src="[^"]+"></script>',
                   f'<script>window.__GB_PAGE={json.dumps(page)}</script><script defer src="{pre}gb3d-files.js"></script><script defer src="{pre}gb3d.js"></script>', s)
        s = re.sub(r'<link rel="modulepreload"[^>]*>', '', s)
        d = DST / 'rig3d' / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        d.write_text(s)
    for f in ['gb-base.js', 'gb-i18n.js', 'gb-theme.js']: shutil.copy(R3 / f, DST / 'rig3d' / f)
    # pictures shown with <img> / TextureLoader: plain files
    for d in ['images', 'rigs/reference']:
        shutil.copytree(R3 / d, DST / 'rig3d' / d, dirs_exist_ok=True)
    # they are only shown as small thumbnails: 300 px, 128 colours
    for f in list((DST / 'rig3d').glob('rigs/reference/*.png')) + list((DST / 'rig3d').glob('images/*.png')):
        if f.stat().st_size > 15000: sh([CONVERT, str(f), '-resize', '300x300>', '-colors', '128', 'PNG8:' + str(f)])
    fav = next((R3 / 'assets').glob('favicon*'), None)
    if fav: (DST / 'rig3d/assets').mkdir(exist_ok=True); shutil.copy(fav, DST / 'rig3d/assets' / fav.name)


def webp(data, mime, max_side, q=80):
    """re-encode an embedded picture as a smaller WebP (keeps transparency)"""
    tmp = OUT / '_tmp'; tmp.mkdir(parents=True, exist_ok=True)
    i = tmp / ('in.' + mime.split('/')[-1]); o = tmp / 'out.webp'
    i.write_bytes(data)
    sh([CONVERT, str(i), '-resize', f'{max_side}x{max_side}>', '-quality', str(q), '-define', 'webp:alpha-quality=90', str(o)])
    out = o.read_bytes()
    return out if len(out) < len(data) else None


def cockpit():
    s = (ROOT / 'Greenbox-Cockpit.html').read_text()
    saved = [0]
    def re_enc(m):
        mime, b64 = m.group(1), m.group(2)
        data = base64.b64decode(b64)
        if not mime.startswith('image/') or len(data) < 30000: return m.group(0)
        side = 768 if len(data) > 150000 and mime == 'image/webp' else 360
        new = webp(data, mime, side)
        if new is None: return m.group(0)
        saved[0] += len(data) - len(new)
        return 'data:image/webp;base64,' + base64.b64encode(new).decode()
    s = re.sub(r'data:(image/[a-z+]+);base64,([A-Za-z0-9+/=]+)', re_enc, s)
    # ▶ demo clip per feature (top bar button): tiny copies of the intro recordings
    V = ROOT / 'dev/axhero/videos'; (DST / 'demo').mkdir(exist_ok=True); demo = {}
    for fid, src, sec in [(k, V / 'feat' / (k + '.mp4'), 6) for k in ['joy', 'evo', 'stone', 'money', 'fuel', 'hpbar', 'countdown', 'vfx', 'wheel', 'gseq', 'gpick', 'gbag', 'gchest', 'endcard', 'gcar', 'sfx']] + [('smash', V / 'smash_ba.mp4', 5)] + \
            [('rig', V / 'chibi/rig.mp4', 8), ('clonerig', V / 'feat/croc.mp4', 8), ('playtest', V / 'chibi/playtest.mp4', 8), ('mocap', V / 'chibi/mocap.mp4', 8), ('vehicle', V / 'vehicle.mp4', 8)]:
        if not src.exists(): continue
        dur = float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(src)]).strip() or 6)
        sp = max(1.0, dur / sec)
        sh(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-vf', f'setpts=PTS/{sp:.3f},fps=8,scale=432:-2', '-t', str(sec), '-c:v', 'libx264', '-crf', '42', '-preset', 'veryslow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', str(DST / 'demo' / (fid + '.mp4'))])
        demo[fid] = 'demo/' + fid + '.mp4'
    s = s.replace('</head>', '<script>window.__GB_DEMO=' + json.dumps(demo) + '</script></head>', 1)
    log('demo clips: %d, %d KB' % (len(demo), sum((DST / v).stat().st_size for v in demo.values()) // 1024))
    # the mockup's 3D pages are bundled to run from file:// (classic script + embedded files): no "use the server" note
    guard = "if(location.protocol==='file:'){ fileNote(); return; }"
    assert guard in s, 'cockpit file:// guard not found'
    s = s.replace(guard, '')
    (DST / 'Greenbox-Cockpit.html').write_text(s)
    log('cockpit pictures: %d KB smaller' % (saved[0] // 1024))
    for f in ['hpbar.html', 'sfx-bench.html', 'gb-xp.js', 'gb-endcard.js']:  # arcade.html: Arena on hold
        shutil.copy(ROOT / f, DST / f)


README = '''GREENBOX STUDIO - service mockup (AX Hero)

Mo: bam dup "Greenbox-Cockpit.html" (Chrome hoac Edge).
Open: double-click "Greenbox-Cockpit.html" (Chrome or Edge).

- Overlay gameplay, Lai xe, Gacha / Endcard, HP bar, Video FX, Gan SFX: chay ngay, khong can mang.
- 3D (gan xuong, xe, choi thu): chay ngay voi model mau co san trong ban nay; tha file GLB/FBX cua ban vao de thu.
- Mocap tu video: bam "Try the sample video" (clip kickboxing co san), can Internet de tai model nhan dang nguoi.
- Ban day du (thu vien 178 animation, 30 model mau): mo bang Mo-Greenbox tu ban goc.
'''


def main():
    if DST.exists(): shutil.rmtree(DST)
    (DST / 'rig3d').mkdir(parents=True)
    log('bundling the 3D code…'); bundle_3d()
    log('embedding models / rigs / animations…'); _, sizes = files_js()
    pages(); cockpit()
    (DST / 'README.txt').write_text(README)
    shutil.rmtree(OUT / '_tmp', ignore_errors=True)
    z = OUT / 'Greenbox-Mockup.zip'
    if z.exists(): z.unlink()
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in sorted(DST.rglob('*')):
            if p.is_file(): zf.write(p, 'Greenbox-Mockup/' + str(p.relative_to(DST)))
        info = [(i.filename, i.compress_size) for i in zf.infolist()]
    info.sort(key=lambda x: -x[1])
    log('largest in the zip:'); [log('  %6d KB  %s' % (c // 1024, n)) for n, c in info[:8]]
    size = z.stat().st_size
    log('animations kept: ' + ', '.join('%s %d KB' % (k.split('/')[-1], v // 1024) for k, v in sizes.items() if k.startswith('animations/')))
    log('%s: %.2f MB %s' % (z.name, size / 1048576, 'OK (< 5 MB)' if size < LIMIT else 'TOO BIG'))
    return 0 if size < LIMIT else 1


if __name__ == '__main__':
    sys.exit(main())
