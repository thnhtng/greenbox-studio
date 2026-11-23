"""ONE command after any change: rebuild everything the user hands in, so the AX Hero folder is never stale.

  python3 dev/release.py            build 3D → glass / icons → mockup zip → introduction.html → full zip → copy to the AX Hero folder
  python3 dev/release.py --no-full  same, without the 101 MB full-tool zip (faster)
  python3 dev/release.py --check    only say whether the AX Hero folder is older than the sources (exit 1 = stale)

The project Stop hook (.claude/settings.json → dev/check_release.sh) runs the check at the end of every Claude turn
and makes Claude run this script when something changed, whichever account / session is working.
"""
import pathlib, shutil, subprocess, sys, time, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]                       # Greenbox Studio
SRC3D = pathlib.Path.home() / 'gb-build/mesh2motion-app/src'               # the 3D source (built into rig3d/)
SUBMIT = ROOT.parent / 'AX Hero - nop bai'                                  # what the user hands in
ZIP_LIMIT, INTRO_LIMIT = 9_000_000, 9_000_000   # master: keep both at most 9 MB (10/11/2026)

# what goes into the mockup / intro / full zip (generated files such as rig3d/assets are left out on purpose)
WATCH_DIRS = [SRC3D, ROOT / 'dev/glass', ROOT / 'dev/axhero', ROOT / 'gb-ai', ROOT / 'ui', ROOT / 'dev/drama']
WATCH_FILES = [ROOT / f for f in ['Greenbox-Cockpit.html', 'hpbar.html', 'sfx-bench.html', 'gb-xp.js', 'gb-endcard.js', 'gb-layouts.js',
                                  'rig3d/gb-base.js', 'rig3d/gb-i18n.js', 'rig3d-src/build.sh']]
SKIP = {'__pycache__', 'node_modules', '.DS_Store'}


def newest_source() -> tuple[float, str]:
    best = (0.0, '')
    files = list(WATCH_FILES)
    for d in WATCH_DIRS:
        if d.exists(): files += [p for p in d.rglob('*') if p.is_file() and not (set(p.parts) & SKIP)]
    for p in files:
        try:
            t = p.stat().st_mtime
            if t > best[0]: best = (t, str(p))
        except OSError: pass
    return best


def released_at() -> float:
    ts = [p.stat().st_mtime for p in [SUBMIT / 'Greenbox-Mockup.zip', SUBMIT / 'introduction.html'] if p.exists()]
    return min(ts) if len(ts) == 2 else 0.0


def stale() -> tuple[bool, str]:
    t, path = newest_source()
    r = released_at()
    return t > r + 2, path


def run(cmd: list[str], **kw) -> str:
    print('›', ' '.join(cmd), flush=True)
    p = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, **kw)
    out = (p.stdout or '') + (p.stderr or '')
    if p.returncode != 0 and 'TOO BIG' not in out:
        print(out[-3000:]); raise SystemExit(f'✗ failed: {" ".join(cmd)}')
    return out


def main() -> int:
    if '--check' in sys.argv:
        s, path = stale()
        print(f'STALE: {path} is newer than the AX Hero folder' if s else 'up to date')
        return 1 if s else 0
    t0 = time.time()
    run(['./rig3d-src/build.sh'])
    run([sys.executable, 'dev/glass/build_icons.py'])
    run([sys.executable, 'dev/glass/apply.py'])
    run([sys.executable, 'dev/drama/build.py'])   # 🎬 AI Drama workflow demo -> drama.html
    out = run([sys.executable, 'dev/axhero/pack.py'])
    z = ROOT / 'ax-hero/Greenbox-Mockup.zip'
    if z.stat().st_size >= ZIP_LIMIT:
        print(out[-1500:]); raise SystemExit(f'✗ mockup zip {z.stat().st_size:,} B is over {ZIP_LIMIT:,}: trim something, nothing was copied')
    run([sys.executable, 'dev/axhero/intro.py'])
    intro = ROOT / 'ax-hero/introduction.html'
    if intro.stat().st_size >= INTRO_LIMIT:
        raise SystemExit(f'✗ introduction.html {intro.stat().st_size:,} B is over {INTRO_LIMIT:,}: trim something, nothing was copied')
    if '--no-full' not in sys.argv: run([sys.executable, 'dev/axhero/pack_full.py'])
    # hand-in folder: the zip, its unpacked copy, the intro
    SUBMIT.mkdir(exist_ok=True)
    shutil.copy2(z, SUBMIT / z.name); shutil.copy2(intro, SUBMIT / intro.name)
    shutil.copy2(ROOT / 'drama.html', SUBMIT / 'ai-drama-demo.html')
    for f in [SUBMIT / z.name, SUBMIT / intro.name]: f.touch()   # the copy time = the release time (the check compares it)
    shutil.rmtree(SUBMIT / 'Greenbox-Mockup', ignore_errors=True)
    with zipfile.ZipFile(SUBMIT / z.name) as zf: zf.extractall(SUBMIT)
    full = ROOT.parent / 'Greenbox-Studio-full.zip'
    print('\n✓ released in %ds' % (time.time() - t0))
    print('  mockup zip    %s B (limit %s)' % (f'{z.stat().st_size:,}', f'{ZIP_LIMIT:,}'))
    print('  intro         %s B (limit %s)' % (f'{intro.stat().st_size:,}', f'{INTRO_LIMIT:,}'))
    if full.exists(): print('  full zip      %.0f MB  %s' % (full.stat().st_size / 1048576, full))
    print('  copied to     %s' % SUBMIT)
    print('  → add the round to GREENBOX-HANDOFF.md (what changed, sizes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
