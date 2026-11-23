"""Cuts a Higgsfield sheet of items drawn on black tiles (4 x 4, white or black gutters) into transparent PNG / WebP:
   each cell's tile is found, then the near-black background is flood-filled from the tile's edges only, so dark
   objects (a bomb, a helmet's shadow) keep their body. Trimmed, centred on a square, resized.
   python3 dev/glass/cut_tiles.py sheet.png name1,name2,... out_dir [size=256] [grid=4]"""
import sys, pathlib
from collections import deque
from PIL import Image, ImageFilter

src, names, out = sys.argv[1], sys.argv[2].split(','), pathlib.Path(sys.argv[3])
SIZE = int(sys.argv[4]) if len(sys.argv) > 4 else 256
N = int(sys.argv[5]) if len(sys.argv) > 5 else 4
out.mkdir(parents=True, exist_ok=True)
sheet = Image.open(src).convert('RGB'); W, H = sheet.size
cw, ch = W / N, H / N
for k, name in enumerate(names):
    if name == '-' or k >= N * N:
        continue
    cx, cy = k % N, k // N
    cell = sheet.crop((int(cx * cw), int(cy * ch), int((cx + 1) * cw), int((cy + 1) * ch)))
    w, h = cell.size; px = cell.load()
    # the tile = the dark area of the cell (white gutters are left out)
    dark = lambda p: max(p) < 60
    xs = [x for x in range(w) if dark(px[x, h // 2])]; ys = [y for y in range(h) if dark(px[w // 2, y])]
    x0, x1 = (min(xs), max(xs)) if xs else (0, w - 1); y0, y1 = (min(ys), max(ys)) if ys else (0, h - 1)
    tile = cell.crop((x0, y0, x1 + 1, y1 + 1)).convert('RGBA'); tw, th = tile.size; tp = tile.load()
    # flood the near-black background from every edge pixel of the tile
    bg = [[False] * tw for _ in range(th)]; q = deque()
    near = lambda p: max(p[:3]) < 22
    for x in range(tw):
        for y in (0, th - 1):
            if near(tp[x, y]) and not bg[y][x]: bg[y][x] = True; q.append((x, y))
    for y in range(th):
        for x in (0, tw - 1):
            if near(tp[x, y]) and not bg[y][x]: bg[y][x] = True; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < tw and 0 <= ny < th and not bg[ny][nx] and near(tp[nx, ny]):
                bg[ny][nx] = True; q.append((nx, ny))
    # white rounded-corner gutter: flood it from the edges too
    white = lambda p: min(p[:3]) > 200
    for x in range(tw):
        for y in (0, th - 1):
            if white(tp[x, y]) and not bg[y][x]: bg[y][x] = True; q.append((x, y))
    for y in range(th):
        for x in (0, tw - 1):
            if white(tp[x, y]) and not bg[y][x]: bg[y][x] = True; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < tw and 0 <= ny < th and not bg[ny][nx] and white(tp[nx, ny]):
                bg[ny][nx] = True; q.append((nx, ny))
    # holes closed by the object (inside a bow, a ring, a key's bow): pure black pockets bigger than a speck
    seen = [[False] * tw for _ in range(th)]
    pure = lambda p: max(p[:3]) < 10
    for sy in range(th):
        for sx in range(tw):
            if bg[sy][sx] or seen[sy][sx] or not pure(tp[sx, sy]): continue
            comp = []; q.append((sx, sy)); seen[sy][sx] = True
            while q:
                x, y = q.popleft(); comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < tw and 0 <= ny < th and not seen[ny][nx] and not bg[ny][nx] and pure(tp[nx, ny]):
                        seen[ny][nx] = True; q.append((nx, ny))
            if len(comp) > 150:
                for x, y in comp: bg[y][x] = True
    mask = Image.new('L', (tw, th), 255); mp = mask.load()
    for y in range(th):
        for x in range(tw):
            if bg[y][x]: mp[x, y] = 0
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    tile.putalpha(mask)
    bb = tile.getbbox()
    if bb: tile = tile.crop(bb)
    s = max(tile.size); sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.paste(tile, ((s - tile.width) // 2, (s - tile.height) // 2))
    sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
    sq.save(out / f'{name}.webp', 'WEBP', quality=86, alpha_quality=90, method=6)
    print(name, sq.size)
