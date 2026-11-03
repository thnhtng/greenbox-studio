/*
 * Fitting a rig taken from one body into ANOTHER body (two crocodiles of different length, pose, proportions,
 * facing different ways). Used by CustomRig / 🧬 Clone rig.
 *
 *   1. body frame of each mesh: up = +Y; forward = the long horizontal axis (principal axis of the points), its
 *      sign pointing to the head — the rig file knows its head (a bone called head / jaw / neck); for a model
 *      without bones: the end with small separate parts (eyes, teeth), else the thicker end (tails taper)
 *   2. rigid fit: turn the rig file around Y so its forward meets the model's, scale by the body lengths,
 *      bottom centre on bottom centre
 *   3. matching landmarks, by their place in each body frame (u = tail -> head 0..1, s = right -> left):
 *        the body's middle line (centroids of 12 slices, legs left out), every foot (the separate islands of
 *        points touching the floor, paired front / back, left / right), the head tip and the tail tip
 *   4. thin-plate-spline warp (3D, kernel |r|, plus an affine part) from the rig file's landmarks to the model's,
 *      applied to every joint: the legs go where this body's legs are, the spine follows this body's back, the jaw
 *      and toes follow their part
 * Bone rotations are kept: the animations (rotations) still move the same parts; position keys are shifted to the
 * new joints (CustomRig.custom_clips).
 */
import * as THREE from 'three'
import { build_graph } from './ModelAnalyzer.ts'

export interface Frame { c: THREE.Vector3, f: THREE.Vector3, l: THREE.Vector3, L: number, W: number, minY: number, H: number, u0: number }
const Y = new THREE.Vector3(0, 1, 0)

export function points_of (geos: THREE.BufferGeometry[], max = 30000): THREE.Vector3[] {
  let n = 0; for (const g of geos) n += g.getAttribute('position').count
  const step = Math.max(1, Math.floor(n / max)); const out: THREE.Vector3[] = []
  for (const g of geos) { const p = g.getAttribute('position'); for (let i = 0; i < p.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(p, i)) }
  return out
}

/** principal horizontal axis, signed towards `head` (or the hint), with extents */
export function body_frame (pts: THREE.Vector3[], head: (f: THREE.Vector3) => number): Frame {
  const m = new THREE.Vector3(); pts.forEach(p => m.add(p)); m.divideScalar(Math.max(1, pts.length))
  let xx = 0; let zz = 0; let xz = 0
  for (const p of pts) { const dx = p.x - m.x; const dz = p.z - m.z; xx += dx * dx; zz += dz * dz; xz += dx * dz }
  const a = 0.5 * Math.atan2(2 * xz, xx - zz)
  let f = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
  const mk = (ff: THREE.Vector3): Frame => {
    const l = new THREE.Vector3().crossVectors(Y, ff).normalize() // left of the forward direction
    let u0 = Infinity; let u1 = -Infinity; let s0 = Infinity; let s1 = -Infinity; let minY = Infinity; let maxY = -Infinity
    for (const p of pts) { const u = p.dot(ff); const s = p.dot(l); u0 = Math.min(u0, u); u1 = Math.max(u1, u); s0 = Math.min(s0, s); s1 = Math.max(s1, s); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
    const c = ff.clone().multiplyScalar((u0 + u1) / 2).add(l.clone().multiplyScalar((s0 + s1) / 2)); c.y = minY
    return { c, f: ff, l, L: u1 - u0, W: s1 - s0, minY, H: maxY - minY, u0 }
  }
  let fr = mk(f)
  if (head(f) < 0) { f = f.negate(); fr = mk(f) }
  return fr
}

/** position of p in the body: u 0 (tail) .. 1 (head), s (left +, in body lengths), h (height, in body lengths) */
/** back from body place (u, s, h) to a point */
export const unlocal = (fr: Frame, q: THREE.Vector3): THREE.Vector3 => fr.f.clone().multiplyScalar(q.x * fr.L + fr.u0).add(fr.l.clone().multiplyScalar(q.y * fr.L + fr.c.dot(fr.l))).add(new THREE.Vector3(0, q.z * fr.L + fr.minY, 0))
export const local = (fr: Frame, p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3((p.dot(fr.f) - fr.u0) / fr.L, p.clone().sub(fr.c).dot(fr.l) / fr.L, (p.y - fr.minY) / fr.L)

/** the thicker end is the head (tails taper): + if the +f end is thicker */
export function thicker_end (pts: THREE.Vector3[], f: THREE.Vector3): number {
  let u0 = Infinity; let u1 = -Infinity; for (const p of pts) { const u = p.dot(f); u0 = Math.min(u0, u); u1 = Math.max(u1, u) }
  const L = u1 - u0; const spread = (lo: number, hi: number): number => {
    const sel = pts.filter(p => { const t = (p.dot(f) - u0) / L; return t >= lo && t <= hi }); if (sel.length < 4) return 0
    const c = new THREE.Vector3(); sel.forEach(p => c.add(p)); c.divideScalar(sel.length)
    let v = 0; for (const p of sel) { const d = p.clone().sub(c); v += d.lengthSq() - Math.pow(d.dot(f), 2) } return v / sel.length
  }
  return spread(0.85, 0.97) - spread(0.03, 0.15)
}

/** the body's middle line: centroid of each slice along u, without the points near the floor (legs) */
export function midline (pts: THREE.Vector3[], fr: Frame, n = 12): Array<{ t: number, p: THREE.Vector3 }> {
  const out: Array<{ t: number, p: THREE.Vector3 }> = []
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n; const lo = i / n; const hi = (i + 1) / n
    const c = new THREE.Vector3(); let k = 0
    for (const p of pts) { const q = local(fr, p); if (q.x >= lo && q.x < hi && p.y > fr.minY + fr.H * 0.18) { c.add(p); k++ } }
    if (k === 0) for (const p of pts) { const q = local(fr, p); if (q.x >= lo && q.x < hi) { c.add(p); k++ } }
    if (k > 0) out.push({ t, p: c.divideScalar(k) })
  }
  return out
}

/** the body's middle point around u = t (a slice `w` long), without the points near the floor (legs) */
export function slice_mid (pts: THREE.Vector3[], fr: Frame, t: number, w: number): THREE.Vector3 | null {
  const c = new THREE.Vector3(); let k = 0
  for (const p of pts) { const q = local(fr, p); if (Math.abs(q.x - t) <= w / 2 && p.y > fr.minY + fr.H * 0.18) { c.add(p); k++ } }
  if (k === 0) for (const p of pts) { const q = local(fr, p); if (Math.abs(q.x - t) <= w / 2) { c.add(p); k++ } }
  return k > 0 ? c.divideScalar(k) : null
}

export interface Foot { tip: THREE.Vector3, top: THREE.Vector3, at: THREE.Vector3 } // at = (u, s) place in the body
/** feet: separate islands of the surface near the floor (tries a few heights, keeps the one giving ~`want` feet) */
export function feet (geos: THREE.BufferGeometry[], fr: Frame, want = 4): Foot[] {
  const g = build_graph(geos, 20000, false); const n = g.nb.length
  const P = (i: number): THREE.Vector3 => new THREE.Vector3(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2])
  let best: Foot[] = []
  for (const k of [0.06, 0.1, 0.14, 0.2]) {
    const low = new Uint8Array(n); for (let i = 0; i < n; i++) if (g.pos[i * 3 + 1] < fr.minY + fr.H * k) low[i] = 1
    const seen = new Uint8Array(n); const comps: number[][] = []
    for (let s = 0; s < n; s++) {
      if (low[s] === 0 || seen[s] === 1) continue
      const c = [s]; seen[s] = 1
      for (let q = 0; q < c.length; q++) for (const [b] of g.nb[c[q]]) if (low[b] === 1 && seen[b] === 0) { seen[b] = 1; c.push(b) }
      comps.push(c)
    }
    const total = comps.reduce((a, c) => a + c.length, 0)
    const big = comps.filter(c => c.length > total * 0.04).sort((a, b) => b.length - a.length)
    // one island much bigger than the rest = the belly on the floor: not a foot
    const parts = big.filter(c => c.length < total * 0.6 || big.length === 1)
    const fs: Foot[] = parts.slice(0, 6).map(c => {
      const top = new THREE.Vector3(); c.forEach(i => top.add(P(i))); top.divideScalar(c.length)
      const tip = c.map(P).reduce((m, p) => p.y < m.y ? p : m, P(c[0])).clone(); tip.x = top.x; tip.z = top.z
      return { tip, top, at: local(fr, top) }
    })
    if (Math.abs(fs.length - want) < Math.abs(best.length - want) || best.length === 0) best = fs
    if (fs.length === want) break
  }
  return best
}

/** pair two small sets by their (u, s) place: greedy nearest */
export function pair<T extends { at: THREE.Vector3 }> (a: T[], b: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = []; const used = new Set<number>()
  const cand: Array<[number, number, number]> = []
  a.forEach((x, i) => b.forEach((y, j) => cand.push([i, j, Math.hypot(x.at.x - y.at.x, (x.at.y - y.at.y) * 2)])))
  cand.sort((p, q) => p[2] - q[2]); const ua = new Set<number>()
  for (const [i, j] of cand) { if (ua.has(i) || used.has(j)) continue; ua.add(i); used.add(j); out.push([a[i], b[j]]) }
  return out
}

/** 3D thin-plate spline: f(p) = A p + t + Σ w_i |p - c_i| ; exact at the landmarks (small smoothing) */
export function tps (src: THREE.Vector3[], dst: THREE.Vector3[], smooth = 1e-6): (p: THREE.Vector3) => THREE.Vector3 {
  const n = src.length; const N = n + 4
  if (n < 4) { const d = dst[0]?.clone().sub(src[0] ?? new THREE.Vector3()) ?? new THREE.Vector3(); return p => p.clone().add(d) }
  const M: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = i === j ? smooth : src[i].distanceTo(src[j])
    M[i][n] = 1; M[i][n + 1] = src[i].x; M[i][n + 2] = src[i].y; M[i][n + 3] = src[i].z
    M[n][i] = 1; M[n + 1][i] = src[i].x; M[n + 2][i] = src[i].y; M[n + 3][i] = src[i].z
  }
  const solve = (b: number[]): number[] => {
    const A = M.map((r, i) => [...r, b[i]])
    for (let c = 0; c < N; c++) {
      let piv = c; for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
      ;[A[c], A[piv]] = [A[piv], A[c]]; const d = A[c][c]; if (Math.abs(d) < 1e-12) continue
      for (let r = 0; r < N; r++) { if (r === c) continue; const k = A[r][c] / d; if (k !== 0) for (let q = c; q <= N; q++) A[r][q] -= k * A[c][q] }
    }
    return A.map((r, i) => Math.abs(r[i]) < 1e-12 ? 0 : r[N] / r[i])
  }
  const wx = solve([...dst.map(p => p.x), 0, 0, 0, 0]); const wy = solve([...dst.map(p => p.y), 0, 0, 0, 0]); const wz = solve([...dst.map(p => p.z), 0, 0, 0, 0])
  return (p: THREE.Vector3): THREE.Vector3 => {
    const ev = (w: number[]): number => { let v = w[n] + w[n + 1] * p.x + w[n + 2] * p.y + w[n + 3] * p.z; for (let i = 0; i < n; i++) v += w[i] * p.distanceTo(src[i]); return v }
    return new THREE.Vector3(ev(wx), ev(wy), ev(wz))
  }
}

/** the landmark pairs of two bodies (both in their own world space): middle line, feet, head and tail tips */
export function landmarks (sp: THREE.Vector3[], sg: THREE.BufferGeometry[], sf: Frame, tp: THREE.Vector3[], tg: THREE.BufferGeometry[], tf: Frame, body_line = true): { src: THREE.Vector3[], dst: THREE.Vector3[], note: string } {
  const src: THREE.Vector3[] = []; const dst: THREE.Vector3[] = []
  const fs = feet(sg, sf); const ft = feet(tg, tf, fs.length)
  const pairs = pair(fs, ft)
  // along the body, the feet are the anchors: a hip stays over its hind feet even when the tails (or necks) differ in length
  const anc: Array<[number, number]> = [[0, 0] as [number, number], ...pairs.map(([a, b]) => [a.at.x, b.at.x] as [number, number]), [1, 1] as [number, number]].sort((a, b) => a[0] - b[0])
  const mono: Array<[number, number]> = []; for (const q of anc) { const l = mono[mono.length - 1]; if (l === undefined || (q[0] > l[0] + 0.02 && q[1] > l[1] + 0.02)) mono.push(q) }
  if (mono[mono.length - 1][0] < 1) mono.push([1, 1])
  const umap = (t: number): number => { for (let i = 1; i < mono.length; i++) { const [a0, b0] = mono[i - 1]; const [a1, b1] = mono[i]; if (t <= a1) return b0 + (b1 - b0) * (t - a0) / Math.max(1e-6, a1 - a0) } return t }
  const ms = midline(sp, sf)
  if (body_line) for (const a of ms) { const b = slice_mid(tp, tf, umap(a.t), 1 / 12); if (b !== null) { src.push(a.p); dst.push(b) } }
  for (const [a, b] of pairs) { src.push(a.tip, a.top); dst.push(b.tip, b.top) }
  // the very ends (snout tip, tail tip): the extreme points of the middle band
  const end = (pts: THREE.Vector3[], fr: Frame, head: boolean): THREE.Vector3 => {
    let best = pts[0]; let bu = head ? -Infinity : Infinity
    for (const p of pts) { if (p.y < fr.minY + fr.H * 0.15) continue; const u = p.dot(fr.f); if (head ? u > bu : u < bu) { bu = u; best = p } }
    return best.clone()
  }
  src.push(end(sp, sf, true), end(sp, sf, false)); dst.push(end(tp, tf, true), end(tp, tf, false))
  return { src, dst, note: `${ms.length} body points, ${pairs.length} feet matched (${fs.length} → ${ft.length}), ${mono.length - 2} along-body anchors` }
}
