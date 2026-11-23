"""The full Greenbox Studio (no size limit, glass pictures included) -> ~/Desktop/Greenbox/Greenbox-Studio-full.zip.
   Upload it somewhere (Google Drive, GitHub Releases…) and put the link in dev/axhero/download.json: the intro page's
   download button uses it. Open after unzipping: Mo-Greenbox.command (Mac) / Mo-Greenbox.bat (Windows)."""
import pathlib, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT.parent / 'Greenbox-Studio-full.zip'
SKIP_DIRS = {'dev', 'ax-hero', '_tmp_shot', 'rig3d-src', '.github', '.git', 'node_modules', '__pycache__'}
SKIP_FILES = {'.DS_Store', 'GREENBOX-HANDOFF.md', 'CLAUDE.md', 'greenbox-easyrig.patch', '.gitignore', '.nojekyll'}
n = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in sorted(ROOT.rglob('*')):
        rel = p.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts) or p.name in SKIP_FILES or p.name.startswith('.bridge') or p.is_dir() or p.is_symlink(): continue
        z.write(p, 'Greenbox Studio/' + rel.as_posix()); n += 1
print(f'{OUT}: {n} files, {OUT.stat().st_size / 1048576:.0f} MB')
