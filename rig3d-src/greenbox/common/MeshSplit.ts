/*
 * Cut a mesh in two along a vertex selection, and close the holes the cut leaves ("auto fill").
 * Works on any BufferGeometry (indexed or not, any attributes, material groups kept).
 */
import * as THREE from 'three'

function tri_index (g: THREE.BufferGeometry): Uint32Array {
  const idx = g.getIndex()
  if (idx !== null) return Uint32Array.from(idx.array as ArrayLike<number>)
  const n = g.getAttribute('position').count
  return Uint32Array.from({ length: n - (n % 3) }, (_, i) => i)
}

function group_of (g: THREE.BufferGeometry, tri: number): number {
  for (const gr of g.groups) if (tri * 3 >= gr.start && tri * 3 < gr.start + gr.count) return gr.materialIndex ?? 0
  return 0
}

/** a new geometry with only the triangles `keep(t)` says yes to (same vertex buffers, compacted) */
export function subset (g: THREE.BufferGeometry, keep: (t: number) => boolean): THREE.BufferGeometry {
  const T = tri_index(g)
  const used = new Int32Array(g.getAttribute('position').count).fill(-1)
  const order: number[] = []
  const by_group = new Map<number, number[]>()
  for (let t = 0; t < T.length / 3; t++) {
    if (!keep(t)) continue
    const mi = g.groups.length > 0 ? group_of(g, t) : 0
    const list = by_group.get(mi) ?? by_group.set(mi, []).get(mi)!
    for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (used[v] < 0) { used[v] = order.length; order.push(v) } list.push(used[v]) }
  }
  const out = new THREE.BufferGeometry()
  for (const [name, a] of Object.entries(g.attributes)) {
    const at = a as THREE.BufferAttribute
    const arr = new (at.array.constructor as any)(order.length * at.itemSize)
    for (let i = 0; i < order.length; i++) for (let k = 0; k < at.itemSize; k++) arr[i * at.itemSize + k] = at.getComponent(order[i], k)
    out.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize, at.normalized))
  }
  const index: number[] = []
  for (const [mi, list] of [...by_group.entries()].sort((a, b) => a[0] - b[0])) {
    if (g.groups.length > 0) out.addGroup(index.length, list.length, mi)
    for (const x of list) index.push(x) // a spread of a big list overflows the call stack
  }
  out.setIndex(index)
  return out
}

/**
 * Close every open border with a fan around its centre. Returns how many holes were closed.
 * Points at the same position are treated as one (UV seams are not holes).
 */
const pkey = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number): string => `${a.getX(i).toFixed(5)},${a.getY(i).toFixed(5)},${a.getZ(i).toFixed(5)}`

/** borders that are already open in a mesh (by position), so a cut only closes the holes it made */
export function open_borders (g: THREE.BufferGeometry): Set<string> {
  const pos = g.getAttribute('position'); const T = tri_index(g)
  const cnt = new Map<string, number>()
  const ek = (a: string, b: string): string => a < b ? `${a}|${b}` : `${b}|${a}`
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const e = ek(pkey(pos, T[t + k]), pkey(pos, T[t + (k + 1) % 3])); cnt.set(e, (cnt.get(e) ?? 0) + 1) }
  const out = new Set<string>(); cnt.forEach((c, e) => { if (c === 1) out.add(e) })
  return out
}

export function fill_holes (g: THREE.BufferGeometry, max_holes = 500, skip?: Set<string>): number {
  const pos = g.getAttribute('position')
  const n = pos.count
  const rep = new Int32Array(n); const key = new Map<string, number>()
  for (let i = 0; i < n; i++) { const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`; const r = key.get(k); if (r === undefined) { key.set(k, i); rep[i] = i } else rep[i] = r }
  const T = tri_index(g)
  const count = new Map<string, number>()
  const ek = (a: number, b: number): string => a < b ? `${a}_${b}` : `${b}_${a}`
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = rep[T[t + k]]; const b = rep[T[t + (k + 1) % 3]]; count.set(ek(a, b), (count.get(ek(a, b)) ?? 0) + 1) }
  // directed border edges a→b (as the triangle walks them); the cap walks them the other way
  const next = new Map<number, number>()
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = rep[T[t + k]]; const b = rep[T[t + (k + 1) % 3]]; if (a !== b && count.get(ek(a, b)) === 1) next.set(b, a) }
  if (next.size === 0) return 0
  const seen = new Set<number>(); const loops: number[][] = []
  for (const s of next.keys()) {
    if (seen.has(s)) continue
    const loop: number[] = []; let v = s; let guard = 0
    while (!seen.has(v) && guard++ < 100000) { seen.add(v); loop.push(v); const nx = next.get(v); if (nx === undefined) break; v = nx }
    let old = 0
    if (skip !== undefined) for (let i = 0; i < loop.length; i++) { const a = pkey(pos, loop[i]); const b = pkey(pos, loop[(i + 1) % loop.length]); if (skip.has(a < b ? `${a}|${b}` : `${b}|${a}`)) old++ }
    if (loop.length >= 3 && v === s && old < loop.length * 0.5) loops.push(loop)
    if (loops.length >= max_holes) break
  }
  if (loops.length === 0) return 0
  // grow every attribute by the cap vertices: loop points (copied) + one centre per loop
  const extra = loops.reduce((a, l) => a + l.length + 1, 0)
  const attrs = Object.entries(g.attributes) as Array<[string, THREE.BufferAttribute]>
  const grown = new Map<string, any>()
  for (const [name, at] of attrs) { const arr = new (at.array.constructor as any)((n + extra) * at.itemSize); arr.set(at.array); grown.set(name, arr) }
  const index = Array.from(T)
  let w = n
  const P = (v: number): THREE.Vector3 => new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v))
  const cap_start = index.length
  for (const loop of loops) {
    const c = new THREE.Vector3(); loop.forEach(v => c.add(P(v))); c.divideScalar(loop.length)
    const nor = new THREE.Vector3() // Newell normal of the cap
    for (let i = 0; i < loop.length; i++) { const a = P(loop[i]); const b = P(loop[(i + 1) % loop.length]); nor.x += (a.y - b.y) * (a.z + b.z); nor.y += (a.z - b.z) * (a.x + b.x); nor.z += (a.x - b.x) * (a.y + b.y) }
    nor.normalize()
    const base = w
    const copy = (dst: number, src: number): void => { for (const [name, at] of attrs) { const arr = grown.get(name); for (let k = 0; k < at.itemSize; k++) arr[dst * at.itemSize + k] = at.getComponent(src, k) } }
    loop.forEach((v, i) => copy(base + i, v))
    copy(base + loop.length, loop[0])
    const pa = grown.get('position'); pa[(base + loop.length) * 3] = c.x; pa[(base + loop.length) * 3 + 1] = c.y; pa[(base + loop.length) * 3 + 2] = c.z
    const na = grown.get('normal')
    if (na !== undefined) for (let i = 0; i <= loop.length; i++) { na[(base + i) * 3] = nor.x; na[(base + i) * 3 + 1] = nor.y; na[(base + i) * 3 + 2] = nor.z }
    for (let i = 0; i < loop.length; i++) index.push(base + loop.length, base + i, base + (i + 1) % loop.length)
    w += loop.length + 1
  }
  for (const [name, at] of attrs) g.setAttribute(name, new THREE.BufferAttribute(grown.get(name), at.itemSize, at.normalized))
  g.setIndex(index)
  if (g.groups.length > 0) g.addGroup(cap_start, index.length - cap_start, g.groups[0].materialIndex ?? 0)
  g.computeBoundingBox(); g.computeBoundingSphere()
  return loops.length
}

/** split by a per-vertex flag: triangles with all three (or, with `loose`, any two) flagged corners go to `inside` */
export function split_by_vertices (g: THREE.BufferGeometry, flag: (v: number) => boolean, fill = true): { inside: THREE.BufferGeometry, outside: THREE.BufferGeometry, holes: number } {
  const T = tri_index(g)
  const isin = (t: number): boolean => { let c = 0; for (let k = 0; k < 3; k++) if (flag(T[t * 3 + k])) c++; return c >= 2 }
  const inside = subset(g, isin); const outside = subset(g, t => !isin(t))
  let holes = 0
  if (fill) { const was = open_borders(g); holes += fill_holes(inside, 500, was); holes += fill_holes(outside, 500, was) }
  return { inside, outside, holes }
}
