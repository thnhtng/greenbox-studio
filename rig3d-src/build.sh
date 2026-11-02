#!/bin/bash
# Build Greenbox 3D (Mesh2Motion + rig3d-src/greenbox) and copy it into rig3d/.
#   1st time: M2M=~/gb-build/mesh2motion-app ./rig3d-src/build.sh --setup
#   then:     ./rig3d-src/build.sh            (edit files in $M2M/src/greenbox, or in rig3d-src/greenbox and pass --sync)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M2M="${M2M:-$HOME/gb-build/mesh2motion-app}"
VER="$(date +%Y%m%d%H%M)"

if [[ "${1:-}" == "--setup" ]]; then
  mkdir -p "$(dirname "$M2M")"
  [[ -d "$M2M" ]] || git clone https://github.com/Mesh2Motion/mesh2motion-app "$M2M"
  (cd "$M2M" && git tag -f gb-upstream && git apply "$ROOT/rig3d/greenbox-easyrig.patch" && npm ci --ignore-scripts)
fi
if [[ "${1:-}" == "--sync" ]]; then rsync -a "$ROOT/rig3d-src/greenbox/" "$M2M/src/greenbox/"; fi

(cd "$M2M" && npx vite build >/dev/null)

D="$M2M/dist"
rm -f "$ROOT/rig3d/assets/"*.js "$ROOT/rig3d/assets/"*.css
rsync -a --exclude '*.map' "$D/" "$ROOT/rig3d/"
# the exported playable's runtime: one self-contained script (three.js inside), pasted into playable .html files
(cd "$M2M" && npx vite build --config vite.playable.config.ts >/dev/null) && cp "$M2M/dist-playable/playable-runtime.js" "$ROOT/rig3d/playable-runtime.js"

# gb-base.js (paths when served from a sub folder) + gb-i18n.js (VI / EN / KO) on every page
python3 - "$ROOT/rig3d" "$VER" <<'EOF'
import sys, re, pathlib
root, ver = pathlib.Path(sys.argv[1]), sys.argv[2]
for p in [*root.glob('*.html'), root / 'retarget' / 'index.html']:
    s = p.read_text()
    pre = '../' if p.parent.name == 'retarget' else './'
    s = re.sub(r'<script src="[./]*gb-(base|i18n|theme)\.js[^"]*"></script>\s*', '', s)
    base = f'<script src="{pre}gb-base.js?v={ver}"></script>\n<script src="{pre}gb-theme.js?v={ver}"></script>\n'
    i18n = f'<script src="{pre}gb-i18n.js?v={ver}"></script>\n'
    s = re.sub(r'(<head[^>]*>\s*)', lambda m: m.group(1) + base, s, count=1)
    if p.stem in ('vehicle', 'playtest', 'mocap', 'mapedit'):
        s = s.replace('</body>', '  ' + i18n + '</body>', 1)
    else:
        s = s.replace('</head>', '  ' + i18n + '</head>', 1)
    p.write_text(s)
EOF

# readable copy of the Greenbox sources + the patch against Mesh2Motion
rsync -a --delete "$M2M/src/greenbox/" "$ROOT/rig3d-src/greenbox/"
(cd "$M2M" && git add -A && git diff --cached gb-upstream -- . ':(exclude)package-lock.json' > "$ROOT/rig3d/greenbox-easyrig.patch" && git reset -q)
echo "built $VER"
