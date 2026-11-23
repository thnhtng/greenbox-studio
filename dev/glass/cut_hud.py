"""Cuts the Higgsfield HUD sheet (gold + emerald frames on white, black insides) into the HP bar / inventory skin:
   ui/skin/bossFrame, barFrame, avatarFrame, invFrame (transparent outside, inside cleared), hpFill / mpFill / bossFill
   (tileable bar fills, the green one recoloured). python3 dev/glass/cut_hud.py dev/glass/icons/sheet-hud.png"""
import sys, pathlib, colorsys
from collections import deque
from PIL import Image, ImageFilter, ImageOps

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'ui/skin'; OUT.mkdir(parents=True, exist_ok=True)
sheet = Image.open(sys.argv[1]).convert('RGB')


def gold (p): r, g, b = p[:3]; return r > 110 and r > b + 45 and g > 60
def white (p): return min(p[:3]) > 215


def flood (img, seeds, ok, mark):
    w, h = img.size; px = img.load(); q = deque()
    for s in seeds:
        if 0 <= s[0] < w and 0 <= s[1] < h and ok(px[s]) and not mark[s[1]][s[0]]: mark[s[1]][s[0]] = True; q.append(s)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not mark[ny][nx] and ok(px[nx, ny]):
                mark[ny][nx] = True; q.append((nx, ny))


def piece (box, inside_seeds, inside_alpha=0):
    """crop; white outside → transparent; the inside (not gold, reached from the seeds) → inside_alpha"""
    img = sheet.crop(box); w, h = img.size
    out_m = [[False] * w for _ in range(h)]
    flood(img, [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)], white, out_m)
    in_m = [[False] * w for _ in range(h)]
    flood(img, inside_seeds, lambda p: not gold(p) and not white(p), in_m)
    a = Image.new('L', (w, h), 255); ap = a.load()
    for y in range(h):
        for x in range(w):
            if out_m[y][x]: ap[x, y] = 0
            elif in_m[y][x]: ap[x, y] = inside_alpha
    a = a.filter(ImageFilter.GaussianBlur(1.2))
    rgba = img.convert('RGBA'); rgba.putalpha(a)
    if inside_alpha:  # a dark glassy inside (the inventory panel)
        px = rgba.load()
        for y in range(h):
            for x in range(w):
                if in_m[y][x]: px[x, y] = (10, 20, 16, inside_alpha)
    return rgba.crop(rgba.getbbox())


def save (im, name, size=None):
    if size: im = im.resize(size, Image.LANCZOS)
    im.save(OUT / f'{name}.webp', 'WEBP', quality=88, alpha_quality=92, method=6); print(name, im.size)


# boss bar: the whole top bar, inside (black + the green fill) cleared
A = (24, 40, 2024, 224); cy = (A[3] - A[1]) // 2
boss = piece(A, [(x, cy) for x in range(200, 1800, 40)])
save(boss, 'bossFrame', (1004, round(1004 * boss.height / boss.width)))

# HP bar frame: the long bar left of the ring, made symmetric (left half + its mirror) at about 4.3 : 1
B = (60, 236, 1640, 516)
bar = piece(B, [(x, (B[3] - B[1]) // 2) for x in range(150, 1400, 40)])
hh = bar.height; half = min(bar.width, round(hh * 4.3 / 2))
left = bar.crop((0, 0, half, hh)); sym = Image.new('RGBA', (half * 2, hh)); sym.paste(left, (0, 0)); sym.paste(ImageOps.mirror(left), (half, 0))
save(sym, 'barFrame', (640, round(640 * hh / (half * 2))))

# avatar ring
C = (56, 524, 564, 1064)
ring = piece(C, [((C[2] - C[0]) // 2, (C[3] - C[1]) // 2 + 20)])
save(ring, 'avatarFrame', (224, round(224 * ring.height / ring.width)))

# inventory panel: a dark glassy inside
F = (44, 1056, 2004, 2032)
panel = piece(F, [((F[2] - F[0]) // 2, (F[3] - F[1]) // 2)], inside_alpha=205)
save(panel, 'invFrame', (980, round(980 * panel.height / panel.width)))

# bar fills from the green glow inside the boss bar: a strip made tileable (cross-fade of its two ends)
inner = sheet.crop((A[0] + 230, A[1] + 62, A[0] + 830, A[3] - 62)).convert('RGB')
w, h = inner.size; half = w // 2
tile = Image.new('RGB', (half, h))
for x in range(half):
    t = x / (half - 1)
    a = inner.crop((x, 0, x + 1, h)); b = inner.crop((x + half, 0, x + half + 1, h))
    tile.paste(Image.blend(a, b, 0.5 - 0.5 * abs(2 * t - 1) if False else t), (x, 0))
tile = tile.resize((256, 48), Image.LANCZOS)


def hue (im, to):
    px = im.load(); w, h = im.size; o = Image.new('RGB', (w, h)); po = o.load()
    for y in range(h):
        for x in range(w):
            r, g, b = [v / 255 for v in px[x, y]]; hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
            r2, g2, b2 = colorsys.hls_to_rgb(to, ll, ss); po[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255))
    return o


save(tile.convert('RGBA'), 'hpFill')
save(hue(tile, 0.58).convert('RGBA'), 'mpFill')
save(hue(tile, 0.0).convert('RGBA'), 'bossFill')
