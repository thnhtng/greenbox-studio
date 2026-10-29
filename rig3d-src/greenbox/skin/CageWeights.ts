/*
 * CageWeights (Greenbox): anatomical skin weights from an invisible "cage".
 *
 * Every bone that has a child gets one tapered capsule (bone joint -> its main child joint), sized from the
 * model's own surface. A vertex belongs to the capsule that holds it most tightly (distance / local radius),
 * so thigh flesh stays on the thigh even when the belly capsule is close, and an arm hanging along the ribs
 * does not steal chest skin. Near a joint the vertex is shared 50/50 with the neighbouring segment and eased
 * out over a short band, which keeps elbows, knees and hips smooth.
 *
 * The cage only exists while rigging. What gets exported is a plain skinned mesh (works in every engine).
 */
import * as THREE from 'three'
import { type Bone, type BufferGeometry } from 'three'

export interface Capsule {
  bone: Bone // the bone this capsule drives
  child: Bone // the joint where it ends
  a: THREE.Vector3 // world start (the bone's joint)
  b: THREE.Vector3 // world end (the child's joint)
  r0: number
  r1: number
  blend: number // fraction of the length used to blend with neighbours at each end
}

/** shared settings: written by the edit step UI, read by the skinning solver */
export const CAGE = {
  enabled: true,
  radii: new Map<string, [number, number]>(), // measured radius at start / end, per bone name
  scale: new Map<string, number>(), // user thickness multiplier, per bone name
  blend: 1 // joint softness multiplier: higher = wider, smoother bends at elbows / knees / spine
}

const SIDE = /(_l$|_r$|\.l$|\.r$|left|right|_l_|_r_)/i
const world = (o: THREE.Object3D): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)

function subtree_size (b: THREE.Object3D): number {
  let n = 0; b.traverse(o => { if (o instanceof THREE.Bone) n++ }); return n
}

/** pick the child joint a capsule should run to */
function main_child (bone: Bone): Bone | null {
  const kids = bone.children.filter((c): c is Bone => c instanceof THREE.Bone)
  if (kids.length === 0) return null
  if (kids.length === 1) return kids[0]
  // a centre bone (spine/pelvis) continues into a centre child (spine/neck), not into an arm or leg
  if (!SIDE.test(bone.name)) {
    const centre = kids.filter(k => !SIDE.test(k.name))
    if (centre.length > 0) return centre.sort((x, y) => subtree_size(y) - subtree_size(x))[0]
  }
  // otherwise the child closest to the average of all children (middle finger for a hand)
  const mean = new THREE.Vector3(); kids.forEach(k => mean.add(world(k))); mean.multiplyScalar(1 / kids.length)
  return kids.sort((x, y) => world(x).distanceTo(mean) - world(y).distanceTo(mean))[0]
}

export function build_capsules (bones: Bone[]): Capsule[] {
  if (bones.length > 0) { let top: THREE.Object3D = bones[0]; while (top.parent !== null) top = top.parent; top.updateMatrixWorld(true) }
  const caps: Capsule[] = []
  for (const bone of bones) {
    if (bone.name.toLowerCase() === 'root') continue
    const child = main_child(bone)
    if (child === null) continue
    const a = world(bone); const b = world(child)
    const len = a.distanceTo(b)
    if (len < 1e-6) continue
    const is_spine = /spine|pelvis|hips|chest|neck/i.test(bone.name)
    caps.push({ bone, child, a, b, r0: len * 0.25, r1: len * 0.25, blend: is_spine ? 0.35 : 0.2 })
  }
  return caps
}

function seg_param (p: THREE.Vector3, c: Capsule): { t: number, d: number } {
  const ab = c.b.clone().sub(c.a); const L2 = ab.lengthSq()
  let t = L2 > 0 ? p.clone().sub(c.a).dot(ab) / L2 : 0
  const tc = Math.min(1, Math.max(0, t))
  const q = c.a.clone().add(ab.multiplyScalar(tc))
  if (t < 0 || t > 1) t = tc
  return { t, d: p.distanceTo(q) }
}

/** measure each capsule from the surface: 80th percentile distance of the points that are nearest to it */
export function estimate_radii (caps: Capsule[], points: THREE.Vector3[], normals?: THREE.Vector3[]): void {
  // Look outward from the bone axis in 12 directions (front half and back half of the bone separately):
  // the FIRST outward-facing skin in each direction is this bone's own surface. Whatever lies behind it
  // (the chest behind a hanging arm, the other leg) is farther away in that direction and gets ignored.
  const SECT = 12
  const qv = new THREE.Vector3(); const rv = new THREE.Vector3()
  caps.forEach(c => {
    const len = c.a.distanceTo(c.b)
    const ax = c.b.clone().sub(c.a).normalize()
    const u = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(ax).normalize() : new THREE.Vector3(1, 0, 0).cross(ax).normalize()
    const v = ax.clone().cross(u)
    const TB = 4 // slices per half: a round head is narrow at the top, so each height is measured on its own
    const mins = [new Array(SECT * TB).fill(Infinity), new Array(SECT * TB).fill(Infinity)]
    for (let pi = 0; pi < points.length; pi++) {
      const p = points[pi]
      const t = p.clone().sub(c.a).dot(ax) / Math.max(1e-9, len)
      if (t < 0.05 || t > 0.95) continue
      qv.copy(c.a).addScaledVector(ax, t * len)
      rv.copy(p).sub(qv); const d = rv.length(); if (d < 1e-9) continue
      const nn = normals?.[pi]
      if (nn !== undefined && nn.lengthSq() > 0 && nn.dot(rv) <= 0) continue // faces the axis: not this bone's skin
      const ang = Math.atan2(rv.dot(v), rv.dot(u))
      const sct = Math.min(SECT - 1, Math.floor((ang + Math.PI) / (2 * Math.PI) * SECT))
      const half = t < 0.5 ? 0 : 1
      const tb = Math.min(TB - 1, Math.floor(((t - 0.05) / 0.9 * 2 - half) * TB))
      const cell = sct * TB + Math.max(0, tb)
      if (d < mins[half][cell]) mins[half][cell] = d
    }
    const med = (arr: number[]): number => {
      let f = arr.filter(Number.isFinite).sort((x, y) => x - y)
      if (f.length < 3) return NaN
      // directions where this bone has no skin of its own see something far away: drop those
      const lo = f[Math.floor(f.length * 0.25)]; f = f.filter(x => x <= lo * 2.5)
      return f[Math.floor(f.length * 0.7)]
    }
    const r0 = med(mins[0]); const r1 = med(mins[1])
    const fb = Number.isFinite(r0) ? r0 : Number.isFinite(r1) ? r1 : len * 0.25
    c.r0 = Math.max(len * 0.06, Number.isFinite(r0) ? r0 : fb)
    c.r1 = Math.max(len * 0.06, Number.isFinite(r1) ? r1 : fb)
  })
  // a capsule can't be absurdly fat for its length (stray far points from overlapping clothes)
  caps.forEach(c => {
    const cap = c.a.distanceTo(c.b) * 3
    c.r0 = Math.min(c.r0, cap); c.r1 = Math.min(c.r1, cap)
  })
}

/** apply stored radii + user thickness to freshly built capsules */
export function apply_settings (caps: Capsule[]): void {
  caps.forEach(c => {
    const r = CAGE.radii.get(c.bone.name)
    if (r !== undefined) { c.r0 = r[0]; c.r1 = r[1] }
    const s = CAGE.scale.get(c.bone.name) ?? 1
    c.r0 *= s; c.r1 *= s
    c.blend = Math.min(0.49, c.blend * CAGE.blend)
  })
}


/**
 * Per-vertex normals that really point OUT of the body.
 * Many exports are inside-out (flipped winding, or no normals at all). For each connected piece we check
 * whether most normals point away from the piece's centre; if not, the whole piece is flipped.
 */
const NORMAL_CACHE = new WeakMap<BufferGeometry, Float32Array>()
export function outward_normals (geometry: BufferGeometry): Float32Array {
  const hit = NORMAL_CACHE.get(geometry); if (hit !== undefined) return hit
  const pos = geometry.getAttribute('position'); const n = pos.count
  let nrm = geometry.getAttribute('normal')
  if (nrm === undefined) { const g2 = geometry.clone(); g2.computeVertexNormals(); nrm = g2.getAttribute('normal') }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { out[i * 3] = nrm.getX(i); out[i * 3 + 1] = nrm.getY(i); out[i * 3 + 2] = nrm.getZ(i) }
  // union-find over triangles + welded positions
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x] } return x }
  const uni = (a: number, b: number): void => { a = find(a); b = find(b); if (a !== b) par[a] = b }
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute)
  const q = Math.max(1e-9, box.getSize(new THREE.Vector3()).length() * 1e-6)
  const key = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) / q)},${Math.round(pos.getY(i) / q)},${Math.round(pos.getZ(i) / q)}`
    const r = key.get(k); if (r === undefined) key.set(k, i); else uni(i, r)
  }
  const index = geometry.getIndex(); const tri = index !== null ? index.count : n
  for (let t = 0; t + 2 < tri; t += 3) {
    const a = index !== null ? index.getX(t) : t; const b = index !== null ? index.getX(t + 1) : t + 1; const c = index !== null ? index.getX(t + 2) : t + 2
    uni(a, b); uni(b, c)
  }
  const cen = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const r = find(i); const c = cen.get(r) ?? [0, 0, 0, 0]; c[0] += pos.getX(i); c[1] += pos.getY(i); c[2] += pos.getZ(i); c[3]++; cen.set(r, c) }
  const vote = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const r = find(i); const c = cen.get(r)!
    const dx = pos.getX(i) - c[0] / c[3]; const dy = pos.getY(i) - c[1] / c[3]; const dz = pos.getZ(i) - c[2] / c[3]
    const d = dx * out[i * 3] + dy * out[i * 3 + 1] + dz * out[i * 3 + 2]
    vote.set(r, (vote.get(r) ?? 0) + Math.sign(d))
  }
  for (let i = 0; i < n; i++) if ((vote.get(find(i)) ?? 0) < 0) { out[i * 3] *= -1; out[i * 3 + 1] *= -1; out[i * 3 + 2] *= -1 }
  NORMAL_CACHE.set(geometry, out)
  return out
}

/**
 * Points spread evenly over the SURFACE (area-weighted), each with an outward normal.
 * Vertices alone are too sparse on low-poly / boxy models to measure a limb's thickness.
 * `matrix` (optional) moves them to world space.
 */
export function sample_points (geometry: BufferGeometry, max = 40000, matrix?: THREE.Matrix4): [THREE.Vector3[], THREE.Vector3[]] {
  const pos = geometry.getAttribute('position'); const n = pos.count
  const ON = outward_normals(geometry)
  const index = geometry.getIndex(); const tc = index !== null ? index.count : n
  const at = (t: number): number => index !== null ? index.getX(t) : t
  const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3(); const fn = new THREE.Vector3()
  const cum = new Float64Array(Math.floor(tc / 3)); let tot = 0
  for (let f = 0; f < cum.length; f++) {
    A.fromBufferAttribute(pos as THREE.BufferAttribute, at(f * 3)); B.fromBufferAttribute(pos as THREE.BufferAttribute, at(f * 3 + 1)); C.fromBufferAttribute(pos as THREE.BufferAttribute, at(f * 3 + 2))
    tot += B.sub(A).cross(C.sub(A)).length() * 0.5; cum[f] = tot
  }
  const out: THREE.Vector3[] = []; const nor: THREE.Vector3[] = []
  if (tot <= 0) return [out, nor]
  const nm = matrix !== undefined ? new THREE.Matrix3().getNormalMatrix(matrix) : undefined
  let seed = 98765
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let k = 0; k < max; k++) {
    const r = rnd() * tot; let lo = 0; let hi = cum.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid }
    const i0 = at(lo * 3); const i1 = at(lo * 3 + 1); const i2 = at(lo * 3 + 2)
    A.fromBufferAttribute(pos as THREE.BufferAttribute, i0); B.fromBufferAttribute(pos as THREE.BufferAttribute, i1); C.fromBufferAttribute(pos as THREE.BufferAttribute, i2)
    let u = rnd(); let v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v }
    const p = A.clone().addScaledVector(B.clone().sub(A), u).addScaledVector(C.clone().sub(A), v)
    // flat face normal, turned to agree with the (outward-fixed) vertex normals
    fn.copy(B).sub(A).cross(C.clone().sub(A)).normalize()
    const sx = ON[i0 * 3] + ON[i1 * 3] + ON[i2 * 3]; const sy = ON[i0 * 3 + 1] + ON[i1 * 3 + 1] + ON[i2 * 3 + 1]; const sz = ON[i0 * 3 + 2] + ON[i1 * 3 + 2] + ON[i2 * 3 + 2]
    if (fn.x * sx + fn.y * sy + fn.z * sz < 0) fn.negate()
    const nn = fn.clone()
    if (matrix !== undefined) { p.applyMatrix4(matrix); nn.applyMatrix3(nm!).normalize() }
    out.push(p); nor.push(nn)
  }
  return [out, nor]
}

/** tiny binary heap for Dijkstra */
class Heap {
  private readonly d: number[] = []; private readonly v: number[] = []
  get size (): number { return this.v.length }
  push (dist: number, node: number): void {
    const d = this.d; const v = this.v; let i = v.length; d.push(dist); v.push(node)
    while (i > 0) { const p = (i - 1) >> 1; if (d[p] <= d[i]) break; [d[p], d[i]] = [d[i], d[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p }
  }
  pop (): [number, number] {
    const d = this.d; const v = this.v; const top: [number, number] = [d[0], v[0]]
    const ld = d.pop()!; const lv = v.pop()!
    if (v.length > 0) {
      d[0] = ld; v[0] = lv; let i = 0
      for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i
        if (l < v.length && d[l] < d[m]) m = l
        if (r < v.length && d[r] < d[m]) m = r
        if (m === i) break
        [d[m], d[i]] = [d[i], d[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m }
    }
    return top
  }
}

/**
 * skinIndex / skinWeight (4 per vertex) using the cage.
 * `bones` must be the same ordered list the skinned mesh is bound with.
 *
 * 1. Seeds: skin that clearly wraps a capsule (inside its core AND facing away from its axis).
 *    A trouser vertex touching the hand faces TOWARD the hand axis, so it can never seed the hand.
 * 2. Every other vertex takes the label of the nearest seed measured ALONG THE SURFACE (geodesic).
 *    Going from the trousers to the hand means walking all the way round the arm, so the trousers stay
 *    with the thigh even when the hand rests on them.
 * 3. Separate pieces with no seed (buttons, eyes, a hat) move rigidly with the capsule most of them sit in.
 * 4. Near each joint the skin is shared with the neighbouring segment for smooth bending.
 */
export function cage_weights (bones: Bone[], geometry: BufferGeometry, caps: Capsule[]): [number[], number[]] {
  const idx = new Map<Bone, number>(); bones.forEach((b, i) => idx.set(b, i))
  const cap_of = new Map<Bone, Capsule>(); caps.forEach(c => cap_of.set(c.bone, c))
  const pos = geometry.getAttribute('position'); const n = pos.count
  const NO = outward_normals(geometry)
  const nrm = { getX: (i: number) => NO[i * 3], getY: (i: number) => NO[i * 3 + 1], getZ: (i: number) => NO[i * 3 + 2] }
  const P: THREE.Vector3[] = new Array(n)
  for (let i = 0; i < n; i++) P[i] = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
  const box = new THREE.Box3(); P.forEach(p => box.expandByPoint(p))
  const q = Math.max(1e-9, box.getSize(new THREE.Vector3()).length() * 1e-6)

  // ---- weld duplicates (UV seams) so the surface graph is connected ----
  const key = new Map<string, number>(); const rep = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[i].x / q)},${Math.round(P[i].y / q)},${Math.round(P[i].z / q)}`
    const r = key.get(k); if (r === undefined) { key.set(k, i); rep[i] = i } else rep[i] = r
  }
  // ---- surface graph (CSR) ----
  const index = geometry.getIndex(); const tri = index !== null ? index.count : n
  const ea: number[] = []; const eb: number[] = []
  for (let t = 0; t + 2 < tri; t += 3) {
    const a = rep[index !== null ? index.getX(t) : t]; const b = rep[index !== null ? index.getX(t + 1) : t + 1]; const c = rep[index !== null ? index.getX(t + 2) : t + 2]
    ea.push(a, b, c, b, c, a); eb.push(b, c, a, a, b, c)
  }
  const start = new Int32Array(n + 1); for (const a of ea) start[a + 1]++
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const fill = start.slice(0, n); const nb = new Int32Array(ea.length)
  for (let e = 0; e < ea.length; e++) nb[fill[ea[e]]++] = eb[e]

  // ---- per-vertex best capsule (normalized distance) + seed test ----
  const best_c = new Int32Array(n).fill(-1); const best_t = new Float32Array(n)
  const label = new Int32Array(n).fill(-1); const dist = new Float64Array(n).fill(Infinity)
  const heap = new Heap()
  const nv = new THREE.Vector3(); const qv = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    if (rep[i] !== i) continue
    let bs = Infinity; let bc = -1; let bt = 0
    for (let k = 0; k < caps.length; k++) {
      const { t, d } = seg_param(P[i], caps[k])
      const s = d / Math.max(1e-6, caps[k].r0 + (caps[k].r1 - caps[k].r0) * t)
      if (s < bs) { bs = s; bc = k; bt = t }
    }
    best_c[i] = bc; best_t[i] = bt
    if (bc < 0 || bs > 1.15) continue
    const c = caps[bc]
    const short = c.a.distanceTo(c.b) < 1e-9 ? true : false
    if (!short && (bt < 0.06 || bt > 0.94)) continue // joints are decided by the neighbours, not seeded
    // the skin must wrap the axis: its normal points away from the closest axis point
    nv.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i))
    qv.copy(c.a).lerp(c.b, Math.min(1, Math.max(0, bt)))
    if (nv.lengthSq() > 0 && nv.dot(qv.sub(P[i])) > 0) continue
    label[i] = bc; dist[i] = 0; heap.push(0, i)
  }
  // ---- geodesic flood from the seeds ----
  while (heap.size > 0) {
    const [d0, u] = heap.pop()
    if (d0 > dist[u]) continue
    for (let e = start[u]; e < start[u + 1]; e++) {
      const v = nb[e]; const nd = d0 + P[u].distanceTo(P[v])
      if (nd < dist[v]) { dist[v] = nd; label[v] = label[u]; heap.push(nd, v) }
    }
  }
  // ---- pieces nothing reached: move them rigidly with their majority capsule ----
  const comp_vote = new Map<number, Map<number, number>>()
  const root_of = (i: number): number => i // reps that were never reached share no edges with seeds
  const unreached: number[] = []
  for (let i = 0; i < n; i++) if (rep[i] === i && label[i] < 0) unreached.push(i)
  if (unreached.length > 0) {
    // connected components among the unreached reps
    const comp = new Int32Array(n).fill(-1); let cid = 0
    for (const s0 of unreached) {
      if (comp[s0] >= 0) continue
      const stack = [s0]; comp[s0] = cid; const votes = new Map<number, number>()
      while (stack.length > 0) {
        const u = stack.pop()!
        if (best_c[u] >= 0) votes.set(best_c[u], (votes.get(best_c[u]) ?? 0) + 1)
        for (let e = start[u]; e < start[u + 1]; e++) { const v = nb[e]; if (comp[v] < 0 && label[v] < 0) { comp[v] = cid; stack.push(v) } }
      }
      comp_vote.set(cid, votes); cid++
    }
    for (const u of unreached) {
      const votes = comp_vote.get(comp[u])!
      let bk = best_c[u]; let bn = -1
      votes.forEach((cnt, k) => { if (cnt > bn) { bn = cnt; bk = k } })
      label[u] = bk
    }
  }
  void root_of

  // ---- weights with joint blending ----
  const indices: number[] = []; const weights: number[] = []
  const smooth = (x: number): number => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
  for (let i = 0; i < n; i++) {
    const lab = label[rep[i]]
    const w = new Map<number, number>()
    const add = (b: Bone | null | undefined, v: number): void => {
      if (b == null || v <= 0) return
      const k = idx.get(b); if (k === undefined) return
      w.set(k, (w.get(k) ?? 0) + v)
    }
    if (lab < 0) { add(bones[0], 1) } else {
      const c = caps[lab]; const B = c.bone; const bl = c.blend
      const bt = seg_param(P[i], c).t
      if (bt < bl && B.parent instanceof THREE.Bone && cap_of.has(B.parent)) {
        const wb = 0.5 + 0.5 * smooth(bt / bl)
        add(B, wb); add(B.parent, 1 - wb)
      } else if (bt > 1 - bl && cap_of.has(c.child)) {
        const wc = 0.5 * smooth((bt - (1 - bl)) / bl)
        add(B, 1 - wc); add(c.child, wc)
      } else add(B, 1)
    }
    const top = [...w.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
    const sum = top.reduce((a, e) => a + e[1], 0) || 1
    for (let k = 0; k < 4; k++) {
      indices.push(top[k] !== undefined ? top[k][0] : 0)
      weights.push(top[k] !== undefined ? top[k][1] / sum : 0)
    }
  }
  return [indices, weights]
}
