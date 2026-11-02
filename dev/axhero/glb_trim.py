"""Make an animation GLB smaller for the AX Hero mockup: keep only some clips and every Nth keyframe.

  python3 glb_trim.py in.glb out.glb [--keep "Idle,Walk,..."] [--max N] [--step 2]

--keep   clip names to keep (case-insensitive; "Name*" = every clip starting with Name); default: all
--max    keep at most N clips (after --keep)
--step   keep every Nth key of each animation channel (first and last always stay)
--quant  rotations as 16-bit normalized numbers (half the size)
--nomesh drop the meshes, skins and textures (an animation file only needs its clips)
A channel that never moves keeps one key.
Meshes, skins and images are copied as they are.
"""
import json, struct, sys, argparse

COMP = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1), 5122: ('h', 2), 5120: ('b', 1)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(p):
    b = open(p, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    o = 20 + jl
    bin_ = b''
    if o < len(b):
        bl = struct.unpack('<I', b[o:o + 4])[0]
        bin_ = b[o + 8:o + 8 + bl]
    return j, bin_


def acc_values(j, bin_, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]; n = NCOMP[a['type']]
    stride = bv.get('byteStride', size * n); base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for k in range(a['count']):
        out.append(struct.unpack_from('<%d%s' % (n, fmt), bin_, base + k * stride))
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--keep', default=''); ap.add_argument('--max', type=int, default=0); ap.add_argument('--step', type=int, default=1); ap.add_argument('--quant', action='store_true'); ap.add_argument('--nomesh', action='store_true')
    a = ap.parse_args()
    j, bin_ = read_glb(a.src)
    anims = j.get('animations', [])
    if a.keep:
        want = [w.strip().lower() for w in a.keep.split(',') if w.strip()]
        def ok(n):
            n = n.lower(); return any(n == w or (w.endswith('*') and n.startswith(w[:-1])) for w in want)
        anims = [x for x in anims if ok(x.get('name', ''))]
    if a.max:
        anims = anims[:a.max]
    j['animations'] = anims
    if a.nomesh:  # only the clips are read from an animation file: its character mesh, skin and textures go
        for n in j.get('nodes', []):
            n.pop('mesh', None); n.pop('skin', None)
        for k in ('meshes', 'skins', 'materials', 'textures', 'images', 'samplers'):
            j.pop(k, None)
    anim_acc = set()
    for an in anims:
        for s in an['samplers']:
            anim_acc.add(s['input']); anim_acc.add(s['output'])
    # accessors used by anything else
    other = set()
    for m in j.get('meshes', []):
        for p in m['primitives']:
            other.update(p['attributes'].values())
            if 'indices' in p: other.add(p['indices'])
            for t in p.get('targets', []): other.update(t.values())
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: other.add(s['inverseBindMatrices'])
    other_views = set(j['accessors'][i]['bufferView'] for i in other if 'bufferView' in j['accessors'][i])
    other_views.update(im['bufferView'] for im in j.get('images', []) if 'bufferView' in im)
    out = bytearray(); views = []; vmap = {}

    def add_view(data, target=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        out.extend(data); views.append(v); return len(views) - 1

    for vi in sorted(other_views):
        bv = j['bufferViews'][vi]; o = bv.get('byteOffset', 0)
        nv = add_view(bin_[o:o + bv['byteLength']], bv.get('target'))
        if 'byteStride' in bv: views[nv]['byteStride'] = bv['byteStride']
        vmap[vi] = nv
    accs = []; amap = {}
    for i in sorted(other):
        acc = dict(j['accessors'][i])
        if 'bufferView' in acc: acc['bufferView'] = vmap[acc['bufferView']]
        amap[i] = len(accs); accs.append(acc)
    # animation channels: decimate keys (same picks for a sampler's input and output)
    done = {}; times = {}
    for an in anims:
        for s in an['samplers']:
            key = (s['input'], s['output'], s.get('interpolation', 'LINEAR'))
            if key in done:
                s['input'], s['output'] = done[key]; continue
            t = acc_values(j, bin_, s['input']); v = acc_values(j, bin_, s['output'])
            n = len(t); per = len(v) // max(1, n)  # CUBICSPLINE has 3 values per key
            step = a.step if s.get('interpolation', 'LINEAR') != 'CUBICSPLINE' else 1
            pick = list(range(0, n, step))
            if pick[-1] != n - 1: pick.append(n - 1)
            if per == 1 and all(max(abs(x - y) for x, y in zip(v[k], v[0])) < 1e-5 for k in range(n)):
                pick = [0]  # a channel that never moves: one key
            ta = j['accessors'][s['input']]; va = j['accessors'][s['output']]
            tdat = b''.join(struct.pack('<f', t[k][0]) for k in pick)
            fmt, _ = COMP[va['componentType']]; ctype = va['componentType']; norm = va.get('normalized', False)
            path = next((c['target']['path'] for c in an['channels'] if an['samplers'][c['sampler']] is s), '')
            if path == 'rotation' and ctype == 5126 and a.quant:  # rotations as normalized shorts (core glTF allows it)
                vdat = b''.join(struct.pack('<4h', *[max(-32767, min(32767, round(x * 32767))) for x in v[k * per + q]]) for k in pick for q in range(per)); ctype = 5122; norm = True
            else:
                vdat = b''.join(struct.pack('<%d%s' % (len(v[0]), fmt), *v[k * per + q]) for k in pick for q in range(per))
            tkey = (s['input'], step)  # the key times are shared by every channel of a clip: write them once
            if tkey not in times:
                times[tkey] = len(accs); accs.append({'bufferView': add_view(tdat), 'componentType': 5126, 'count': len(pick), 'type': 'SCALAR', 'min': [t[pick[0]][0]], 'max': [t[pick[-1]][0]]})
            ti = times[tkey]
            vacc = {'bufferView': add_view(vdat), 'componentType': ctype, 'count': len(pick) * per, 'type': va['type']}
            if norm: vacc['normalized'] = True
            oi = len(accs); accs.append(vacc)
            s['input'], s['output'] = ti, oi; done[key] = (ti, oi)
    for m in j.get('meshes', []):
        for p in m['primitives']:
            p['attributes'] = {k: amap[x] for k, x in p['attributes'].items()}
            if 'indices' in p: p['indices'] = amap[p['indices']]
            if 'targets' in p: p['targets'] = [{k: amap[x] for k, x in t.items()} for t in p['targets']]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = amap[s['inverseBindMatrices']]
    for im in j.get('images', []):
        if 'bufferView' in im: im['bufferView'] = vmap[im['bufferView']]
    j['accessors'] = accs; j['bufferViews'] = views
    while len(out) % 4: out.append(0)
    j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(out)) + b'BIN\x00' + bytes(out)
    open(a.dst, 'wb').write(glb)
    print('%s: %d clips, %d KB' % (a.dst, len(anims), len(glb) // 1024))


if __name__ == '__main__':
    main()
