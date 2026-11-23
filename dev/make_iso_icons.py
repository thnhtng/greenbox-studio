#!/usr/bin/env python3
"""Draw the green-glass tile pictures that were never generated (Play test: 4 sculpt tools + 11 objects).

Same look as the other rig3d/images/ui/*.webp tiles (72 px, green glass, lit from the top left), but drawn here from
small 3D shapes, so no image generator is needed. Existing pictures are kept unless --force.

    python3 dev/make_iso_icons.py [--force] [--sheet out.png]
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'rig3d', 'images', 'ui')
S = 6; N = 72 * S
DARK = (10, 92, 52); MID = (38, 190, 112); LIGHT = (150, 255, 200); EDGE = (205, 255, 228)
VIEW = (1, 1, 1); SUN = (0.25, 0.55, 0.8)


def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def unit(a): l = math.sqrt(dot(a, a)) or 1; return (a[0] / l, a[1] / l, a[2] / l)
def mix(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def box(x0, y0, z0, x1, y1, z1):
    p = lambda x, y, z: (x, y, z)
    return [
        [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)],  # top
        [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)],  # +x
        [p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)],  # +y
    ]


def prism(pts, y0, y1):
    """a shape drawn in the x-z plane (list of (x, z), counter-clockwise seen from +y), pushed from y0 to y1"""
    f = [[(x, y1, z) for x, z in pts]]
    for i in range(len(pts)):
        a = pts[i]; b = pts[(i + 1) % len(pts)]
        f.append([(a[0], y1, a[1]), (a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1])])
    return f


def prism_x(pts, x0, x1):
    """a shape drawn in the y-z plane (list of (y, z)), pushed from x0 to x1"""
    f = [[(x1, y, z) for y, z in pts]]
    for i in range(len(pts)):
        a = pts[i]; b = pts[(i + 1) % len(pts)]
        f.append([(x1, a[0], a[1]), (x1, b[0], b[1]), (x0, b[0], b[1]), (x0, a[0], a[1])])
    return f


def disc(cx, cy, z0, z1, r, n=20):
    ring = [(cx + r * math.cos(i * 2 * math.pi / n), cy + r * math.sin(i * 2 * math.pi / n)) for i in range(n)]
    f = [[(x, y, z1) for x, y in ring]]
    for i in range(n):
        a = ring[i]; b = ring[(i + 1) % n]
        f.append([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)])
    return f


def heights(h):
    """a small height field (rows of heights) as smooth-ish faces"""
    f = []; n = len(h) - 1; s = 2.0 / n
    P = lambda i, j: (-1 + i * s, -1 + j * s, h[j][i])
    for j in range(n):
        for i in range(n):
            f.append([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)])
    # skirt on the two near sides
    for i in range(n):
        a = P(i, n); b = P(i + 1, n); f.append([(a[0], a[1], -0.25), a, b, (b[0], b[1], -0.25)])
        a = P(n, i); b = P(n, i + 1); f.append([(a[0], a[1], -0.25), (b[0], b[1], -0.25), b, a])
    return f


def render(faces, scale=1.0, dz=0.0):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    k = N * 0.27 * scale; c30 = math.cos(math.radians(30))
    def P(p): return (N / 2 + (p[0] - p[1]) * c30 * k, N * 0.56 + ((p[0] + p[1]) * 0.5 - p[2] + dz) * k)
    vis = []
    for f in faces:
        n = unit(cross(sub(f[1], f[0]), sub(f[2], f[0])))
        if dot(n, VIEW) < 0: n = (-n[0], -n[1], -n[2])
        cen = tuple(sum(p[i] for p in f) / len(f) for i in range(3))
        vis.append((dot(cen, VIEW), f, n, cen))
    vis.sort(key=lambda v: v[0])
    sun = unit(SUN)
    for _, f, n, cen in vis:
        t = max(0.0, min(1.0, 1.25 * max(0.0, dot(n, sun)) ** 1.6 - 0.02))
        col = mix(DARK, MID, t * 2) if t < 0.5 else mix(MID, LIGHT, (t - 0.5) * 2)
        pts = [P(p) for p in f]
        d.polygon(pts, fill=col + (236,))
        d.line(pts + [pts[0]], fill=EDGE + ((70,) if len(faces) > 60 else (170,)), width=max(2, S // 2), joint='curve')
    small = img.resize((72, 72), Image.LANCZOS)
    glow = small.filter(ImageFilter.GaussianBlur(3)); a = glow.split()[3].point(lambda v: int(v * 0.35)); glow.putalpha(a)
    out = Image.new('RGBA', (72, 72), (0, 0, 0, 0)); out.alpha_composite(glow); out.alpha_composite(small)
    return out


def arrow_up(x, y, z0, z1, w=0.16):
    return box(x - w, y - w, z0, x + w, y + w, z1 - 0.3) + prism([(x - 0.42, z1 - 0.3), (x + 0.42, z1 - 0.3), (x, z1 + 0.15)], y - w, y + w)


def mound(peak, n=8, sharp=False, noise=False):
    import random; r = random.Random(7); h = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            x = -1 + 2 * i / n; y = -1 + 2 * j / n
            if noise: v = 0.1 + 0.32 * (math.sin(x * 5.1 + 1) * math.cos(y * 4.3) * 0.5 + 0.5) + r.random() * 0.22
            elif sharp: v = max(0.0, peak * (1 - abs(y) * 1.05))
            else: v = peak * math.exp(-(x * x + y * y) * 2.4)
            row.append(v)
        h.append(row)
    return heights(h)


def icons():
    I = {}
    I['tool-grab'] = (mound(0.95) + arrow_up(0, 0, 1.15, 1.95), 0.86, 0.35)
    I['tool-terrace'] = (box(-1, -1, -0.25, 1, 1, 0.1) + box(-1, -1, 0.1, 0.35, 1, 0.5) + box(-1, -1, 0.5, -0.3, 1, 0.9), 0.95, 0.1)
    I['tool-noise'] = (mound(0, n=7, noise=True), 1.0, 0.0)
    I['tool-crease'] = (mound(1.0, n=8, sharp=True), 0.95, 0.2)
    I['obj-hwall'] = (box(-1.1, -0.12, 0, 1.1, 0.12, 1.5) + box(-1.25, -0.2, 0, -0.95, 0.2, 1.7) + box(0.95, -0.2, 0, 1.25, 0.2, 1.7), 0.92, 0.75)
    door = box(-0.75, -0.1, 0, -0.55, 0.1, 2.0) + box(0.55, -0.1, 0, 0.75, 0.1, 2.0) + box(-0.75, -0.1, 2.0, 0.75, 0.1, 2.2)
    door += box(-0.55, -0.04, 0, 0.55, 0.04, 2.0) + box(0.25, 0.04, 0.95, 0.4, 0.14, 1.1)
    I['obj-door'] = (door, 0.84, 1.05)
    win = box(-0.95, -0.1, 0, 0.95, 0.1, 0.22) + box(-0.95, -0.1, 1.5, 0.95, 0.1, 1.72) + box(-0.95, -0.1, 0.22, -0.73, 0.1, 1.5) + box(0.73, -0.1, 0.22, 0.95, 0.1, 1.5)
    win += box(-0.06, -0.05, 0.22, 0.06, 0.05, 1.5) + box(-0.73, -0.05, 0.8, 0.73, 0.05, 0.92)
    I['obj-window'] = (win, 0.95, 0.85)
    floor = box(-1.1, -1.1, 0, 1.1, 1.1, 0.16)
    for i in range(3):
        for j in range(3): floor += box(-1.02 + i * 0.7, -1.02 + j * 0.7, 0.16, -1.02 + i * 0.7 + 0.64, -1.02 + j * 0.7 + 0.64, 0.2)
    I['obj-floor'] = (floor, 0.95, 0.0)
    I['obj-roof'] = (prism_x([(-1.1, 0), (1.1, 0), (0, 1.05)], -1.0, 1.0) + box(-1.0, -1.1, -0.12, 1.0, 1.1, 0), 0.9, 0.35)
    st = []
    for i in range(5): st += box(-0.6, -1 + i * 0.4, 0, 0.6, -1 + (i + 1) * 0.4, 1.5 - i * 0.3)
    I['obj-stairs'] = (st, 0.92, 0.6)
    I['obj-node'] = (disc(0, 0, 0, 0.1, 0.95, 24) + disc(0, 0, 0.1, 1.0, 0.1, 10) + disc(0, 0, 1.0, 1.55, 0.42, 16), 0.95, 0.6)
    tb = box(-1, -0.7, 0.9, 1, 0.7, 1.08)
    for x, y in ((-0.88, -0.58), (0.74, -0.58), (-0.88, 0.44), (0.74, 0.44)): tb += box(x, y, 0, x + 0.14, y + 0.14, 0.9)
    I['obj-table'] = (tb, 0.95, 0.5)
    mo = []
    for i in range(4): mo += box(-0.9, -0.5, i * 0.2, 0.9, 0.5, i * 0.2 + 0.16)
    mo += box(-0.2, -0.5, 0.8, 0.2, 0.5, 0.84) + disc(0.55, 1.0, 0, 0.14, 0.42, 18) + disc(0.55, 1.0, 0.16, 0.3, 0.42, 18)
    I['obj-money'] = (mo, 0.95, 0.3)
    gr = disc(0, 0, 0, 0.08, 0.95, 20)
    for k, (x, y, hgt, lean) in enumerate(((-0.45, -0.3, 1.5, -0.25), (-0.05, -0.1, 1.9, 0.05), (0.35, 0.05, 1.45, 0.3), (-0.25, 0.35, 1.2, -0.35), (0.15, 0.45, 1.3, 0.2), (0.6, -0.35, 1.0, 0.4))):
        gr += prism([(x - 0.17, 0.08), (x + 0.17, 0.08), (x + lean, hgt)], y - 0.04, y + 0.04)
    I['obj-grass'] = (gr, 0.95, 0.7)
    teeth = []
    for i in range(24):
        a = i * 2 * math.pi / 24; r = 1.0 if i % 2 == 0 else 0.78
        teeth.append((r * math.cos(a), 1.0 + r * math.sin(a)))
    saw = prism(teeth, -0.05, 0.05) + prism([(0.22 * math.cos(i * math.pi / 6), 1.0 + 0.22 * math.sin(i * math.pi / 6)) for i in range(12)], 0.05, 0.14) + box(-0.9, -0.45, -0.3, 0.9, 0.45, 0.0)
    I['obj-saw'] = (saw, 0.82, 0.8)
    return I


def main():
    force = '--force' in sys.argv; sheet = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    made = []; pics = []
    for name, (faces, scale, dz) in icons().items():
        p = os.path.join(OUT, name + '.webp'); im = render(faces, scale, dz); pics.append(im)
        if os.path.exists(p) and not force: continue
        im.save(p, 'WEBP', quality=90, method=6); made.append('%s %d B' % (name, os.path.getsize(p)))
    if sheet:
        W = Image.new('RGBA', (len(pics) * 144, 144), (20, 26, 36, 255))
        for k, im in enumerate(pics): W.alpha_composite(im.resize((144, 144), Image.LANCZOS), (k * 144, 0))
        W.save(sheet)
    print('made %d: %s' % (len(made), ', '.join(made) or '-'))


if __name__ == '__main__':
    main()
