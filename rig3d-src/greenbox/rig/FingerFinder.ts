import * as THREE from 'three'
import { build_graph, dijkstra } from './ModelAnalyzer'

/**
 * Fingers of a character, read from the mesh around each wrist.
 *
 *  1. cut out the hand: triangles within R of the wrist, in front of it (along the forearm → hand direction);
 *  2. geodesic distance over that surface from the wrist ring;
 *  3. finger tips = far points that stick out (topological persistence, as in ModelAnalyzer) — a finger's
 *     prominence is how far its tip reaches past the web where it joins the palm, i.e. its length;
 *  4. each finger's joints = centroids of the surface rings at 100 / 55 / 25 % of that length from the tip
 *     (centroids of a ring sit inside the finger, where the bone belongs);
 *  5. names: the thumb is the finger that joins the palm much closer to the wrist; the others are ordered
 *     across the palm starting next to the thumb (index, middle, ring, pinky). The template's own
 *     index → pinky order decides the side when no thumb sticks out.
 *
 * refine_finger_weights() then re-skins the hand: every hand / finger point goes to the finger segment it is
 * nearest to, blended at the knuckles, so a finger bends alone and does not drag its neighbour or the palm.
 */
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
export type FingerName = typeof FINGERS[number]
export interface Finger { name: FingerName, joints: THREE.Vector3[], length: number }
export interface HandScan { fingers: Finger[], note: string, debug?: number[][] }

const V = (p: Float32Array, i: number): THREE.Vector3 => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])

function hand_region (geos: THREE.BufferGeometry[], wrist: THREE.Vector3, dir: THREE.Vector3, R: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3()
  const inside = (p: THREE.Vector3): boolean => p.distanceTo(wrist) < R && p.clone().sub(wrist).dot(dir) > -R * 0.08
  for (const g of geos) {
    const pos = g.getAttribute('position'); const idx = g.getIndex(); const n = idx !== null ? idx.count : pos.count
    const keep: number[] = []
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = idx !== null ? idx.getX(t) : t; const i1 = idx !== null ? idx.getX(t + 1) : t + 1; const i2 = idx !== null ? idx.getX(t + 2) : t + 2
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2)
      if (inside(a) && inside(b) && inside(c)) keep.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    }
    if (keep.length > 0) { const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); out.push(o) }
  }
  return out
}

/**
 * @param geos world-space geometries of the model (rest pose)
 * @param wrist wrist joint (world)
 * @param dir unit vector forearm → hand
 * @param R radius that holds the whole hand (a little more than wrist → longest finger tip)
 * @param tpl template finger bases (world), used to tell index from pinky when no thumb sticks out
 */
export function find_fingers (geos: THREE.BufferGeometry[], wrist: THREE.Vector3, dir: THREE.Vector3, R: number, tpl?: Partial<Record<FingerName, THREE.Vector3>>): HandScan {
  const region = hand_region(geos, wrist, dir, R)
  if (region.length === 0) return { fingers: [], note: 'no mesh around the wrist' }
  const g = build_graph(region, 20000, false)
  const n = g.nb.length
  if (n < 30) return { fingers: [], note: 'hand too small / too few points' }
  // sources: the ring of points at the wrist (the cut), so distances run "out of the sleeve"
  const along = (i: number): number => (g.pos[i * 3] - wrist.x) * dir.x + (g.pos[i * 3 + 1] - wrist.y) * dir.y + (g.pos[i * 3 + 2] - wrist.z) * dir.z
  let amin = Infinity; for (let i = 0; i < n; i++) amin = Math.min(amin, along(i))
  const src: number[] = []; for (let i = 0; i < n; i++) if (along(i) < amin + R * 0.06) src.push(i)
  // keep only what is connected to the wrist (a thigh the hand rests on is another piece)
  const D = dijkstra(g, src)
  let maxd = 0; for (let i = 0; i < n; i++) if (Number.isFinite(D.dist[i])) maxd = Math.max(maxd, D.dist[i])
  if (maxd <= 0) return { fingers: [], note: 'hand not connected' }
  // persistence of the far points
  const order: number[] = []; for (let i = 0; i < n; i++) if (Number.isFinite(D.dist[i])) order.push(i)
  order.sort((x, y) => D.dist[y] - D.dist[x])
  const uf = new Int32Array(n).fill(-1); const birth = new Int32Array(n).fill(-1)
  const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x] } return x }
  const prom = new Map<number, number>()
  for (const i of order) {
    uf[i] = i; birth[i] = i
    const roots = new Set<number>(); for (const [b] of g.nb[i]) if (uf[b] >= 0) roots.add(find(b))
    if (roots.size === 0) continue
    const rs = [...roots].sort((x, y) => D.dist[birth[y]] - D.dist[birth[x]])
    for (const r of rs.slice(1)) { prom.set(birth[r], D.dist[birth[r]] - D.dist[i]); uf[r] = rs[0] }
    uf[i] = rs[0]
  }
  // the farthest tip never dies: its "length" is measured against the second one's merge level
  const top = order[0]
  const sorted = [...prom.entries()].filter(([, p]) => p > maxd * 0.1).sort((x, y) => y[1] - x[1])
  const second_merge = sorted.length > 0 ? Math.max(...sorted.slice(0, 4).map(([t, p]) => D.dist[t] - p)) : maxd * 0.5
  prom.set(top, D.dist[top] - Math.min(second_merge, D.dist[top] * 0.75))
  const debug = [...prom.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t, p]) => [+(D.dist[t] / maxd).toFixed(3), +(p / maxd).toFixed(3), +g.pos[t * 3].toFixed(3), +g.pos[t * 3 + 1].toFixed(3), +g.pos[t * 3 + 2].toFixed(3)])
  const tips = [...prom.entries()]
    .filter(([t, p]) => p > maxd * 0.12 && D.dist[t] > maxd * 0.25) // the thumb tip can be close to the wrist
    .sort((x, y) => y[1] - x[1]).slice(0, 5).map(([t]) => t)
  if (tips.length < 2) return { fingers: [], note: tips.length === 1 ? 'one tip: mitten / closed hand, kept the template fingers' : 'no fingers sticking out' }
  // each finger: rings of points at a given distance from its own tip
  const T = dijkstra(g, tips)
  const len = tips.map(t => prom.get(t)!)
  // where each finger joins the rest of the hand (geodesic distance from the wrist): the thumb joins far lower
  const merge = tips.map((t, k) => D.dist[t] - len[k])
  // the shortest path from each tip back to the wrist, as [distance from the tip, node]
  const path = tips.map(t => { const out: Array<[number, number]> = []; let x = t; while (x >= 0) { out.push([D.dist[t] - D.dist[x], x]); x = D.prev[x] } return out })
  /** centroid of the surface ring at distance d from tip k, kept near the path (not spilling over the palm) */
  const ring = (k: number, d: number, w: number): THREE.Vector3 | null => {
    const on = path[k].reduce((m, e) => Math.abs(e[0] - d) < Math.abs(m[0] - d) ? e : m, path[k][0])
    const P = V(g.pos, on[1]); const lim = Math.max(len[k] * 0.45, w * 3)
    // a low-poly finger has few points: widen the ring until it catches some
    for (let ww = w; ww <= Math.max(w, len[k] * 0.5); ww *= 2) {
      const c = new THREE.Vector3(); let m = 0
      for (let i = 0; i < n; i++) if (T.from[i] === k && Math.abs(T.dist[i] - d) <= ww && V(g.pos, i).distanceTo(P) < lim) { c.add(V(g.pos, i)); m++ }
      if (m >= 3 || (m > 0 && ww * 2 > len[k] * 0.5)) return c.divideScalar(m)
    }
    return d > 0 ? P : null // the surface point on the way back to the wrist
  }
  const raw = tips.map((t, k) => {
    const L = len[k]
    const tip = ring(k, 0, L * 0.06) ?? V(g.pos, t)
    const j = [1, 0.55, 0.25].map(f => ring(k, L * f, L * 0.08))
    return { k, L, base: j[0] ?? tip, joints: [j[0] ?? tip, j[1] ?? tip, j[2] ?? tip, tip] }
  })
  // thumb: joins the hand much nearer the wrist than the others (its merge level in the sweep above)
  const a_of = (p: THREE.Vector3): number => p.clone().sub(wrist).dot(dir)
  const ms = [...merge].sort((x, y) => x - y)
  const med = ms[Math.floor(ms.length / 2)]
  let thumb = -1
  if (raw.length >= 3) {
    const lo = raw.reduce((m, r) => merge[r.k] < merge[m.k] ? r : m)
    if (merge[lo.k] < med - maxd * 0.15 || raw.length === 5) thumb = lo.k
  }
  // across the palm: main axis of the other finger bases, perpendicular to the hand direction
  const others = raw.filter(r => r.k !== thumb)
  const lat = (p: THREE.Vector3): THREE.Vector3 => p.clone().sub(wrist).sub(dir.clone().multiplyScalar(a_of(p)))
  const mean = new THREE.Vector3(); others.forEach(r => mean.add(lat(r.base))); mean.divideScalar(Math.max(1, others.length))
  let axis = new THREE.Vector3()
  if (others.length >= 2) {
    const far = others.reduce((m, r) => lat(r.base).distanceTo(mean) > lat(m.base).distanceTo(mean) ? r : m)
    axis = lat(far.base).sub(mean)
  }
  if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1).cross(dir)
  axis.normalize()
  // orientation: the thumb side first; without a thumb, the template's index side
  if (thumb >= 0) { if (lat(raw[thumb].base).sub(mean).dot(axis) < 0) axis.negate() } else if (tpl?.index !== undefined && tpl?.pinky !== undefined) { if (lat(tpl.index).sub(lat(tpl.pinky)).dot(axis) < 0) axis.negate() }
  others.sort((x, y) => lat(y.base).dot(axis) - lat(x.base).dot(axis))
  const names: FingerName[] = others.length >= 4 ? ['index', 'middle', 'ring', 'pinky'] : others.length === 3 ? ['index', 'middle', 'ring'] : ['index', 'middle']
  const fingers: Finger[] = []
  if (thumb >= 0) {
    // the thumb's real root is near the wrist: stretch its chain back past the web
    const r = raw[thumb]; const L = r.L * 1.3
    const j = [1, 0.6, 0.3].map(f => ring(r.k, L * f, L * 0.08))
    fingers.push({ name: 'thumb', length: L, joints: [j[0] ?? r.joints[0], j[1] ?? r.joints[1], j[2] ?? r.joints[2], r.joints[3]] })
  }
  others.forEach((r, i) => { if (i < names.length) {
    // the knuckle sits a little behind the web between fingers
    const back = r.joints[0].clone().sub(dir.clone().multiplyScalar(r.L * 0.18))
    fingers.push({ name: names[i], length: r.L, joints: [back, r.joints[1], r.joints[2], r.joints[3]] })
  } })
  const note = `${fingers.length} ${fingers.length === 1 ? 'finger' : 'fingers'}: ${fingers.map(f => f.name).join(', ')}${thumb < 0 ? ' (no separate thumb)' : ''}`
  return { fingers, note, debug }
}

/* ---------------- weights ---------------- */
const BLEND = 0.2
/**
 * Re-skin the hands of one geometry after the automatic weights: points that belong to a hand (mostly hand /
 * finger bones) are split between the palm and the finger segments they are nearest to.
 * Bones are found by name (Mesh2Motion: hand_l, index_01_l … index_04_leaf_l). Geometry and bones must be in
 * the same space (the bind pose).
 */
export function refine_finger_weights (geo: THREE.BufferGeometry, bones: THREE.Bone[]): number {
  const si = geo.getAttribute('skinIndex'); const sw = geo.getAttribute('skinWeight'); const pos = geo.getAttribute('position')
  if (si === undefined || sw === undefined || pos === undefined) return 0
  const by = new Map<string, number>(); bones.forEach((b, i) => by.set(b.name.toLowerCase(), i))
  if (bones.length > 0) { let r: THREE.Object3D = bones[0]; while (r.parent !== null) r = r.parent; r.updateWorldMatrix(true, true) }
  const wp = bones.map(b => b.getWorldPosition(new THREE.Vector3()))
  let changed = 0
  for (const side of ['l', 'r']) {
    const hand = by.get(`hand_${side}`); if (hand === undefined) continue
    // chains: [owner bone, from point, to point]
    const segs: Array<{ chain: number[], s: number, a: THREE.Vector3, b: THREE.Vector3 }> = []
    const set = new Set<number>([hand])
    for (const f of FINGERS) {
      const ids = ['01', '02', '03', '04_leaf'].map(x => by.get(`${f}_${x}_${side}`))
      if (ids[0] === undefined) continue
      const chain = [hand, ...ids.filter((x): x is number => x !== undefined)]
      chain.forEach(c => set.add(c))
      for (let s = 0; s + 1 < chain.length; s++) segs.push({ chain, s, a: wp[chain[s]], b: wp[chain[s + 1]] })
    }
    if (segs.length === 0) continue
    // hand size: wrist → farthest finger joint
    let reach = 0; set.forEach(b => { reach = Math.max(reach, wp[b].distanceTo(wp[hand])) })
    const line = new THREE.Line3(); const q = new THREE.Vector3(); const p = new THREE.Vector3()
    for (let v = 0; v < pos.count; v++) {
      let share = 0
      for (let k = 0; k < 4; k++) if (set.has(si.getComponent(v, k))) share += sw.getComponent(v, k)
      if (share < 0.5) continue
      p.fromBufferAttribute(pos, v)
      if (p.distanceTo(wp[hand]) > reach * 1.6) continue
      let best = segs[0]; let bd = Infinity; let bt = 0
      for (const sg of segs) {
        line.set(sg.a, sg.b); const t = line.closestPointToPointParameter(p, true); line.at(t, q)
        const d = q.distanceToSquared(p); if (d < bd) { bd = d; best = sg; bt = t }
      }
      // owner of a segment = the bone at its start; blend with the previous / next owner near the joints
      const own = new Map<number, number>()
      const add = (b: number, w: number): void => { own.set(b, (own.get(b) ?? 0) + w) }
      const c = best.chain; const s = best.s; const last = c.length - 2 // last segment ends at the leaf
      if (bt < BLEND && s > 0) { const x = (BLEND - bt) / (2 * BLEND); add(c[s - 1], x); add(c[s], 1 - x) } else if (bt > 1 - BLEND && s < last) { const x = (bt - (1 - BLEND)) / (2 * BLEND); add(c[s + 1], x); add(c[s], 1 - x) } else add(c[s], 1)
      // keep the non-hand bones (forearm near the wrist) as they were, scale the new hand part to the old share
      const keep: Array<[number, number]> = []
      for (let k = 0; k < 4; k++) { const b = si.getComponent(v, k); const w = sw.getComponent(v, k); if (w > 0 && !set.has(b)) keep.push([b, w]) }
      own.forEach((w, b) => keep.push([b, w * share]))
      keep.sort((x, y) => y[1] - x[1])
      const top = keep.slice(0, 4); const sum = top.reduce((m, x) => m + x[1], 0) || 1
      for (let k = 0; k < 4; k++) { si.setComponent(v, k, top[k]?.[0] ?? 0); sw.setComponent(v, k, (top[k]?.[1] ?? 0) / sum) }
      changed++
    }
  }
  if (changed > 0) { si.needsUpdate = true; sw.needsUpdate = true }
  return changed
}

/** global switch read by the skinning step (on by default) */
export const FINGER_WEIGHTS = { enabled: true, last: 0 }

/**
 * Hands whose fingers do not stick out (a fist, a mitten, fingers glued together, a chibi hand): measure the hand
 * and lay the fingers on it.
 *   axis      wrist -> centre of the hand's points (follows a bent wrist), with the forearm direction mixed in
 *   size      length = how far the hand reaches along the axis; width / thickness from the palm's points (PCA
 *             of the points across the axis: the widest direction is across the knuckles, the thinnest the palm
 *             normal); the thumb side is the side of the template's thumb
 *   fingers   4 bands across the width (index next to the thumb … pinky); each tip = the farthest point of its band;
 *             joints at 0 / 45 / 75 / 100 % from the knuckle line (45 % of the hand), centred in the thickness
 *   thumb     from near the wrist on the thumb side to the farthest point there
 */
export function palm_fit (geos: THREE.BufferGeometry[], wrist: THREE.Vector3, dir: THREE.Vector3, R: number, tpl?: Partial<Record<FingerName, THREE.Vector3>>): HandScan & { width: number, length: number, ridges?: number } {
  const pts: THREE.Vector3[] = []
  for (const g of hand_region(geos, wrist, dir, R)) { const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i)) }
  if (pts.length < 20) return { fingers: [], note: 'no hand points', width: 0, length: 0 }
  const c = new THREE.Vector3(); pts.forEach(p => c.add(p)); c.divideScalar(pts.length)
  const a = c.clone().sub(wrist).normalize().add(dir).normalize()
  const T = (p: THREE.Vector3): number => p.clone().sub(wrist).dot(a)
  const ts = pts.map(T).sort((x, y) => x - y); const Lh = ts[Math.floor(ts.length * 0.97)]
  if (Lh <= 0) return { fingers: [], note: 'hand behind the wrist', width: 0, length: 0 }
  // across the axis: the widest direction (knuckles) and the thinnest (palm normal)
  const palm = pts.filter(p => { const t = T(p) / Lh; return t > 0.3 && t < 0.75 })
  const use = palm.length > 10 ? palm : pts
  const m = new THREE.Vector3(); use.forEach(p => m.add(p)); m.divideScalar(use.length)
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const p of use) { const d = p.clone().sub(m); d.sub(a.clone().multiplyScalar(d.dot(a))); const v = [d.x, d.y, d.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += v[i] * v[j] }
  // power iteration for the main axis across
  let w = new THREE.Vector3(1, 0.3, 0.2); w.sub(a.clone().multiplyScalar(w.dot(a))).normalize()
  for (let k = 0; k < 30; k++) { const v = new THREE.Vector3(cov[0][0] * w.x + cov[0][1] * w.y + cov[0][2] * w.z, cov[1][0] * w.x + cov[1][1] * w.y + cov[1][2] * w.z, cov[2][0] * w.x + cov[2][1] * w.y + cov[2][2] * w.z); v.sub(a.clone().multiplyScalar(v.dot(a))); if (v.lengthSq() < 1e-20) break; w = v.normalize() }
  // thumb side positive
  if (tpl?.thumb !== undefined) { if (tpl.thumb.clone().sub(wrist).dot(w) < 0) w.negate() } else if (tpl?.index !== undefined && tpl?.pinky !== undefined && tpl.index.clone().sub(tpl.pinky).dot(w) < 0) w.negate()
  const n = new THREE.Vector3().crossVectors(a, w).normalize()
  const S = (p: THREE.Vector3): number => p.clone().sub(wrist).dot(w); const N = (p: THREE.Vector3): number => p.clone().sub(wrist).dot(n)
  const ss = use.map(S).sort((x, y) => x - y); const s_lo = ss[Math.floor(ss.length * 0.05)]; const s_hi = ss[Math.floor(ss.length * 0.95)]
  const W = Math.max(1e-4, s_hi - s_lo); const s0 = (s_lo + s_hi) / 2
  const at = (t: number, s: number, band: number): THREE.Vector3 => {
    // centre of the thickness there (mean of n of the points nearby)
    let nn = 0; let k = 0
    for (const p of pts) { if (Math.abs(T(p) - t) < Lh * 0.07 && Math.abs(S(p) - s) < band) { nn += N(p); k++ } }
    const nc = k > 0 ? nn / k : N(m)
    return wrist.clone().add(a.clone().multiplyScalar(t)).add(w.clone().multiplyScalar(s)).add(n.clone().multiplyScalar(nc))
  }
  const fingers: Finger[] = []
  const names: FingerName[] = ['index', 'middle', 'ring', 'pinky']
  const tk = Lh * 0.45; const band = W * 0.13
  const lanes = finger_lanes(pts.filter(p => T(p) > Lh * 0.6).map(p => [S(p), T(p) / Lh]), W)
  names.forEach((name, i) => {
    // the finger's lane: a ridge across the finger zone, else index next to the thumb and the 4 fingers
    // sharing 85 % of the palm width
    const si = lanes !== null ? lanes[i] : s0 + (0.375 - 0.25 * i) * W * 0.85
    const tt = pts.filter(p => Math.abs(S(p) - si) < band && T(p) > tk).map(T).sort((x, y) => x - y)
    const tip = tt.length > 0 ? tt[Math.floor(tt.length * 0.97)] : Lh * (i === 1 ? 1 : 0.94)
    const L = Math.max(tip - tk, Lh * 0.2)
    fingers.push({ name, length: L, joints: [at(tk, si, band), at(tk + L * 0.45, si, band), at(tk + L * 0.75, si, band), at(tk + L * 0.97, si, band)] })
  })
  // thumb: the farthest point on the thumb side, from a base near the wrist
  // thumb: beyond the index finger's lane, on the thumb side
  const sIdx = lanes !== null ? lanes[0] : s0 + W * 0.32
  const base = at(Lh * 0.12, Math.max(s0 + W * 0.2, sIdx - W * 0.05), W * 0.2)
  let side = pts.filter(p => S(p) > sIdx + band * 0.9 && T(p) < Lh * 0.85)
  if (side.length < 12) side = pts.filter(p => S(p) > s0 + W * 0.2 && T(p) < Lh * 0.7)
  const tipP = side.length > 0 ? side.reduce((b, p) => p.distanceTo(base) > b.distanceTo(base) ? p : b, side[0]) : at(Lh * 0.55, s0 + W * 0.6, W * 0.2)
  const tipT = T(tipP); const tipS = S(tipP)
  const mid = (f: number): THREE.Vector3 => at(Lh * 0.12 + (tipT - Lh * 0.12) * f, s0 + W * 0.3 + (tipS - s0 - W * 0.3) * f, W * 0.12)
  fingers.unshift({ name: 'thumb', length: tipP.distanceTo(base), joints: [base, mid(0.4), mid(0.72), mid(0.95)] })
  return { fingers, note: 'measured hand (fingers not separate): thumb + 4 fingers laid on the hand', width: W, length: Lh, ridges: LAST_RIDGES }
}

/**
 * Where the fingers run across the hand: how far the hand reaches at each sideways position. Fingers are
 * bumps of that profile and the gaps between them dips (works whatever the vertex density).
 * 4 lanes, thumb side (largest s) first, or null when unclear.
 */
let LAST_RIDGES = 0
function finger_lanes (st: number[][], W: number): number[] | null {
  LAST_RIDGES = 0
  if (st.length < 40) return null
  const sorted = st.map(x => x[0]).sort((x, y) => x - y); const lo = sorted[Math.floor(sorted.length * 0.01)]; const hi = sorted[Math.floor(sorted.length * 0.99)]
  const span = hi - lo; if (span < W * 0.3) return null
  const NB = 40; const h: number[] = Array(NB).fill(0.6)
  for (const [v, t] of st) { const i = Math.floor((v - lo) / span * NB); if (i >= 0 && i < NB) h[i] = Math.max(h[i], t) }
  const sm = h.map((_, i) => (h[i - 1] ?? h[i]) * 0.25 + h[i] * 0.5 + (h[i + 1] ?? h[i]) * 0.25)
  // only where the hand reaches far: the thumb (and a drooping edge) reaches less and must not get a finger lane
  const reach = Math.max(...sm); let b0 = 0; let b1 = NB - 1
  while (b0 < NB - 1 && sm[b0] < reach - (reach - 0.6) * 0.45) b0++
  while (b1 > 0 && sm[b1] < reach - (reach - 0.6) * 0.45) b1--
  const lo2 = lo + b0 / NB * span; const hi2 = lo + (b1 + 1) / NB * span; const span2 = Math.max(hi2 - lo2, span * 0.3)
  const peaks: Array<{ s: number, v: number }> = []
  for (let i = b0; i <= b1; i++) if (sm[i] > 0.62 && sm[i] >= (sm[i - 1] ?? 0) && sm[i] >= (sm[i + 1] ?? 0)) peaks.push({ s: lo + (i + 0.5) / NB * span, v: sm[i] })
  // farthest-reaching first, keep the ones apart from each other
  peaks.sort((x, y) => y.v - x.v)
  const keep: Array<{ s: number, v: number }> = []
  for (const p of peaks) if (keep.every(k => Math.abs(k.s - p.s) > span2 * 0.17)) keep.push(p)
  const top = keep.slice(0, 4).sort((x, y) => y.s - x.s)
  LAST_RIDGES = top.length
  if (top.length === 4) return top.map(p => p.s)
  if (top.length === 3) { const g = (top[0].s - top[2].s) / 2; return [...top.map(p => p.s), top[2].s - g] }
  // no bumps (mitten): share the width the fingers reach over
  return [0, 1, 2, 3].map(i => hi2 - span2 * (0.125 + 0.25 * i))
}

/** fingers found by their tips are trusted only when there are 4+ of them, spread over the hand */
export function fingers_ok (scan: HandScan, width: number, wrist?: THREE.Vector3, length = 0): boolean {
  const f = scan.fingers.filter(x => x.name !== 'thumb')
  if (f.length < 3 || width <= 0) return false
  if (wrist !== undefined && length > 0) {
    // every finger runs away from the wrist joint by joint, starts inside the hand and is a real length
    for (const x of scan.fingers) {
      const d = x.joints.map(j => j.distanceTo(wrist))
      if (d[1] < d[0] - length * 0.02 || d[2] < d[1] - length * 0.02 || d[3] < d[2] - length * 0.02) return false
      if (x.name !== 'thumb' && (d[0] > length * 0.8 || d[3] - d[0] < length * 0.18)) return false
    }
  }
  const tips = f.map(x => x.joints[3])
  let spread = 0; for (const p of tips) for (const q of tips) spread = Math.max(spread, p.distanceTo(q))
  let close = Infinity; for (let i = 0; i < tips.length; i++) for (let j = i + 1; j < tips.length; j++) close = Math.min(close, tips[i].distanceTo(tips[j]))
  return spread > width * 0.4 && close > width * 0.1
}

/**
 * How far the hand reaches: start from the template's reach and grow until the region holds the whole hand
 * (few points left at its edge). Chibi hands are much bigger than the template's. Capped at `cap`.
 */
export function hand_reach (geos: THREE.BufferGeometry[], wrist: THREE.Vector3, dir: THREE.Vector3, R0: number, cap: number): number {
  let R = R0
  for (let k = 0; k < 8 && R < cap; k++) {
    let n = 0; let edge = 0; let tip = 0
    for (const g of hand_region(geos, wrist, dir, R)) {
      const p = g.getAttribute('position'); const v = new THREE.Vector3()
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); n++; if (v.distanceTo(wrist) > R * 0.88) edge++ }
    }
    // how far the hand goes along the forearm line, from every vertex (not only whole triangles: long low-poly
    // finger triangles cross the edge of the region and would be missed)
    for (const g of geos) {
      const p = g.getAttribute('position'); const v = new THREE.Vector3()
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).sub(wrist); if (v.length() > R * 1.05) continue
        const t = v.dot(dir); if (t > tip && v.sub(dir.clone().multiplyScalar(t)).length() < R * 0.5) tip = t
      }
    }
    if (n === 0 || (edge / n < 0.015 && tip < R * 0.9)) break
    R = Math.min(cap, R * 1.3)
  }
  return R
}
