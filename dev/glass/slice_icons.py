"""Cuts a Higgsfield icon sheet (icons on black, N x N) into <out>/<name>.webp:
   black -> transparent (alpha from brightness, colour un-premultiplied so the glass glow stays), trimmed, square.
   The icons are found as blobs on the whole sheet (not by cutting the grid): a blob belongs to the cell its centre
   falls in, so a neighbour's glow / tip that crosses the grid line is left out, and an icon that crosses it is kept whole.
   python3 dev/glass/slice_icons.py sheet.png name1,name2,...('-' = skip) [out dir] [size] [grid=4]"""
import sys, pathlib
from collections import deque
from PIL import Image, ImageChops, ImageFilter
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / (sys.argv[3] if len(sys.argv) > 3 else 'rig3d/images/ui'); OUT.mkdir(parents=True, exist_ok=True)
SIZE = int(sys.argv[4]) if len(sys.argv) > 4 else 72; Q = 85 if SIZE > 72 else 58
N = int(sys.argv[5]) if len(sys.argv) > 5 else 4
sheet = Image.open(sys.argv[1]).convert('RGB'); names = sys.argv[2].split(',')
W, H = sheet.size
r, g, b = sheet.split()
bright = ImageChops.lighter(ImageChops.lighter(r, g), b)          # max(R, G, B)
alpha = bright.point(lambda m: max(0, min(255, int((m - 14) * 1.35))))

# blobs on a small mask (1/8), grown a little so the parts of one icon (sparkles, drops, sound waves) join up
S = 8; w, h = W // S, H // S
small = alpha.resize((w, h), Image.BOX).point(lambda v: 255 if v > 18 else 0).filter(ImageFilter.MaxFilter(5))
mk = small.load(); lab = [[0] * w for _ in range(h)]; blobs = []
for y in range(h):
    for x in range(w):
        if mk[x, y] == 0 or lab[y][x]: continue
        n = len(blobs) + 1; q = deque([(x, y)]); lab[y][x] = n; cnt = 0; sx = sy = 0; x0, y0, x1, y1 = x, y, x, y; wsum = 0
        while q:
            cx, cy = q.popleft(); cnt += 1; sx += cx; sy += cy
            x0, y0, x1, y1 = min(x0, cx), min(y0, cy), max(x1, cx), max(y1, cy)
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if 0 <= nx < w and 0 <= ny < h and mk[nx, ny] and not lab[ny][nx]: lab[ny][nx] = n; q.append((nx, ny))
        blobs.append({'n': n, 'cnt': cnt, 'c': (sx / cnt, sy / cnt), 'bb': (x0, y0, x1, y1)})

cw, chh = w / N, h / N
for i, name in enumerate(names):
    if name == '-': continue
    row, col = divmod(i, N)
    mine = [bl for bl in blobs if int(bl['c'][0] // cw) == col and int(bl['c'][1] // chh) == row]
    if not mine: print('empty', name); continue
    main = max(mine, key=lambda bl: bl['cnt'])
    # keep the main blob + small bits close to it (a detached sparkle); drop far specks
    keep = [bl for bl in mine if bl is main or (bl['cnt'] > 6 and abs(bl['c'][0] - main['c'][0]) < cw * 0.6 and abs(bl['c'][1] - main['c'][1]) < chh * 0.6)]
    ids = {bl['n'] for bl in keep}
    x0 = min(bl['bb'][0] for bl in keep); y0 = min(bl['bb'][1] for bl in keep); x1 = max(bl['bb'][2] for bl in keep); y1 = max(bl['bb'][3] for bl in keep)
    # the kept blobs as a full-size mask (everything else in the box -> transparent)
    m = Image.new('L', (w, h)); ml = m.load()
    for yy in range(y0, y1 + 1):
        for xx in range(x0, x1 + 1):
            if lab[yy][xx] in ids: ml[xx, yy] = 255
    pad = 2; box = (max(0, (x0 - pad) * S), max(0, (y0 - pad) * S), min(W, (x1 + 1 + pad) * S), min(H, (y1 + 1 + pad) * S))
    keepm = m.resize((W, H), Image.NEAREST).crop(box).filter(ImageFilter.GaussianBlur(3))
    rgb = sheet.crop(box); a = ImageChops.multiply(alpha.crop(box), keepm); br = bright.crop(box)
    px = rgb.load(); pa = a.load(); pb = br.load(); bw, bh = rgb.size
    out = Image.new('RGBA', (bw, bh)); po = out.load()
    for yy in range(bh):
        for xx in range(bw):
            av = pa[xx, yy]
            if av == 0: continue
            R, G, B = px[xx, yy]; k = 255 / max(pb[xx, yy], 1)
            po[xx, yy] = (min(255, int(R * k)), min(255, int(G * k)), min(255, int(B * k)), av)
    bb = out.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    if bb is None: print('empty', name); continue
    p2 = 6; bb = (max(0, bb[0] - p2), max(0, bb[1] - p2), min(bw, bb[2] + p2), min(bh, bb[3] + p2))
    ic = out.crop(bb); s = max(ic.size)
    sq = Image.new('RGBA', (s, s)); sq.paste(ic, ((s - ic.size[0]) // 2, (s - ic.size[1]) // 2))
    sq.resize((SIZE, SIZE), Image.LANCZOS).save(OUT / f'{name}.webp', 'WEBP', quality=Q, alpha_quality=Q + 4, method=6)
    print('ok', name, len(mine) - len(keep), 'bits dropped')
