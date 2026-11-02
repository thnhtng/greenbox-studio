/*
 * Model analysis: find the anchor ("nail") points of ANY model so it can be rigged and skinned part by part —
 * people, animals, creatures with wings / tails / ears / capes, robots, props, vehicles.
 *
 * Algorithm (no template, works on any shape):
 *  1. Weld the mesh into a graph (points at the same place are one node). Separate pieces (hair, ears,
 *     a cape, a sword) are bridged to their nearest neighbour piece so everything is one graph.
 *  2. Core: the node closest to the centre of mass of the biggest piece. Geodesic distance (along the surface)
 *     from the core to every node (Dijkstra).
 *  3. Tips: nodes that are farther (geodesic) than every node around them, kept if they stick out enough
 *     (non-maximum suppression in space + a minimum distance from the core). Each tip is a limb / appendage.
 *  4. Branches: a second Dijkstra from all tips at once labels every node with its nearest tip; nodes close
 *     to the core stay "body". The branch of a tip is everything it labelled.
 *  5. Anchors: along each branch, cut slices by geodesic distance from the tip; the centre of each slice is a
 *     joint INSIDE the mesh (not on the skin). Root of the branch = where it meets the body.
 *  6. Naming: by where the tip is relative to the body frame (up = +Y, front = +Z, side = X):
 *     human (tall, 2 low tips = feet), quadruped (long, ≥4 low tips), vehicle (boxy, flat faces, round pieces
 *     at the bottom), else "object". Extra tips on a human / animal are accessories, named by position:
 *     on the head → ear / horn / hair, behind the back high and wide → wing, behind the back hanging down →
 *     cape, behind the hips → tail, at a hand → weapon / item.
 */
import * as THREE from 'three'

export type AnchorKind = 'head' | 'arm' | 'leg' | 'tail' | 'wing' | 'ear' | 'horn' | 'hair' | 'cape' | 'item' | 'wheel' | 'part' | 'spine'
export interface Branch { name: string, kind: AnchorKind, side: -1 | 0 | 1, tip: THREE.Vector3, joints: THREE.Vector3[], nodes: number, length: number }
export interface Analysis {
  type: 'humanoid' | 'quadruped' | 'vehicle' | 'object'
  core: THREE.Vector3
  size: THREE.Vector3
  branches: Branch[]
  /** per original vertex of each input mesh: branch index, or -1 = body */
  labels: Int32Array[]
  notes: string[]
}

export interface Graph { pos: Float32Array, nb: Array<Array<[number, number]>>, of: Int32Array[] }

export function build_graph (geos: THREE.BufferGeometry[], max_nodes = 25000, bridge = true): Graph {
  // weld on a grid so dense meshes stay fast; cell from the box size
  const box = new THREE.Box3()
  for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox!) }
  const size = box.getSize(new THREE.Vector3())
  let total = 0; for (const g of geos) total += g.getAttribute('position').count
  const cell = Math.max(size.length() / 2000, Math.cbrt(size.x * size.y * size.z / Math.max(1, Math.min(total, max_nodes))) * 0.6)
  const key = new Map<string, number>(); const P: number[] = []; const cnt: number[] = []
  const of: Int32Array[] = []
  for (const g of geos) {
    const pos = g.getAttribute('position'); const map = new Int32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i)
      const k = `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`
      let id = key.get(k)
      if (id === undefined) { id = cnt.length; key.set(k, id); P.push(0, 0, 0); cnt.push(0) }
      P[id * 3] += x; P[id * 3 + 1] += y; P[id * 3 + 2] += z; cnt[id]++
      map[i] = id
    }
    of.push(map)
  }
  const n = cnt.length; const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { pos[i * 3] = P[i * 3] / cnt[i]; pos[i * 3 + 1] = P[i * 3 + 1] / cnt[i]; pos[i * 3 + 2] = P[i * 3 + 2] / cnt[i] }
  const sets: Array<Set<number>> = Array.from({ length: n }, () => new Set())
  geos.forEach((g, gi) => {
    const idx = g.getIndex(); const m = of[gi]; const tc = idx !== null ? idx.count : g.getAttribute('position').count
    for (let t = 0; t + 2 < tc; t += 3) {
      const a = m[idx !== null ? idx.getX(t) : t]; const b = m[idx !== null ? idx.getX(t + 1) : t + 1]; const c = m[idx !== null ? idx.getX(t + 2) : t + 2]
      if (a !== b) { sets[a].add(b); sets[b].add(a) } if (b !== c) { sets[b].add(c); sets[c].add(b) } if (a !== c) { sets[a].add(c); sets[c].add(a) }
    }
  })
  const d = (a: number, b: number): number => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2])
  // close small gaps: nodes of different pieces that almost touch (eyes in their sockets, hair on the head,
  // a belt on the hips) get an edge, so geodesics do not take long detours
  const G = cell * 2.2; const grid = new Map<string, number[]>()
  const gk = (x: number, y: number, z: number): string => `${Math.floor(x / G)},${Math.floor(y / G)},${Math.floor(z / G)}`
  for (let i = 0; i < n; i++) { const k = gk(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i) }
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(pos[i * 3] / G); const gy = Math.floor(pos[i * 3 + 1] / G); const gz = Math.floor(pos[i * 3 + 2] / G)
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const j of grid.get(`${gx + a},${gy + b},${gz + c}`) ?? []) if (j > i && !sets[i].has(j) && d(i, j) < G) { sets[i].add(j); sets[j].add(i) }
    }
  }
  const nb = sets.map((s, a) => [...s].map(b => [b, d(a, b)] as [number, number]))
  // bridge separate pieces to the nearest node of another piece (so a cape / ear / sword is reachable)
  const comp = new Int32Array(n).fill(-1); const comps: number[][] = []
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue
    const list = [s]; comp[s] = comps.length
    for (let q = 0; q < list.length; q++) for (const [b] of nb[list[q]]) if (comp[b] < 0) { comp[b] = comps.length; list.push(b) }
    comps.push(list)
  }
  if (bridge && comps.length > 1) {
    const order = comps.map((c, i) => i).sort((a, b) => comps[b].length - comps[a].length)
    const joined = new Set<number>([order[0]])
    const pool: number[] = comps[order[0]].filter((_, i) => i % 3 === 0)
    for (const ci of order.slice(1)) {
      if (comps[ci].length < 3) continue
      let best: [number, number, number] = [-1, -1, Infinity]
      const mine = comps[ci].filter((_, i) => i % Math.max(1, Math.floor(comps[ci].length / 200)) === 0)
      for (const a of mine) for (const b of pool) { const dd = d(a, b); if (dd < best[2]) best = [a, b, dd] }
      if (best[0] >= 0) { nb[best[0]].push([best[1], best[2]]); nb[best[1]].push([best[0], best[2]]) }
      joined.add(ci); for (let i = 0; i < comps[ci].length; i += 3) pool.push(comps[ci][i])
    }
  }
  return { pos, nb, of }
}

/** Dijkstra from one or more sources; returns distance and which source reached each node */
export function dijkstra (g: Graph, src: number[]): { dist: Float32Array, from: Int32Array, prev: Int32Array } {
  const n = g.nb.length; const dist = new Float32Array(n).fill(Infinity); const from = new Int32Array(n).fill(-1); const prev = new Int32Array(n).fill(-1)
  // binary heap
  const hv: number[] = []; const hn: number[] = []
  const push = (v: number, d: number): void => { hv.push(d); hn.push(v); let i = hv.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= hv[i]) break; [hv[p], hv[i]] = [hv[i], hv[p]]; [hn[p], hn[i]] = [hn[i], hn[p]]; i = p } }
  const pop = (): number => {
    const top = hn[0]; const lv = hv.pop()!; const ln = hn.pop()!
    if (hv.length > 0) { hv[0] = lv; hn[0] = ln; let i = 0; for (;;) { const l = i * 2 + 1; const r = l + 1; let m = i; if (l < hv.length && hv[l] < hv[m]) m = l; if (r < hv.length && hv[r] < hv[m]) m = r; if (m === i) break; [hv[m], hv[i]] = [hv[i], hv[m]]; [hn[m], hn[i]] = [hn[i], hn[m]]; i = m } }
    return top
  }
  src.forEach((s, k) => { dist[s] = 0; from[s] = k; push(s, 0) })
  while (hv.length > 0) {
    const d0 = hv[0]; const a = pop(); if (d0 > dist[a]) continue
    for (const [b, w] of g.nb[a]) { const nd = d0 + w; if (nd < dist[b]) { dist[b] = nd; from[b] = from[a]; prev[b] = a; push(b, nd) } }
  }
  return { dist, from, prev }
}

const V = (p: Float32Array, i: number): THREE.Vector3 => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])

/** world-space geometries of a model (skinned meshes in their rest pose) */
export function model_geometries (roots: THREE.Object3D | THREE.Object3D[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  for (const r of Array.isArray(roots) ? roots : [roots]) {
    r.updateMatrixWorld(true)
    r.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh !== true || m.userData.__gb_wire === true || m.geometry?.getAttribute('position') === undefined) return
      const g = new THREE.BufferGeometry(); g.setAttribute('position', m.geometry.getAttribute('position').clone()); if (m.geometry.getIndex() !== null) g.setIndex(m.geometry.getIndex()!.clone())
      const sk = m as THREE.SkinnedMesh
      if (sk.isSkinnedMesh === true && sk.skeleton !== undefined) {
        // a skinned character: the points where they are on screen now (the pose of the playing animation),
        // so the anchors sit on the body you see, not on the bind pose
        sk.skeleton.update(); const pa = g.getAttribute('position'); const v = new THREE.Vector3()
        for (let i = 0; i < pa.count; i++) { sk.getVertexPosition(i, v); v.applyMatrix4(sk.matrixWorld); pa.setXYZ(i, v.x, v.y, v.z) }
        pa.needsUpdate = true
      } else g.applyMatrix4(m.matrixWorld)
      out.push(g)
    })
  }
  return out
}

export function analyze (geos: THREE.BufferGeometry[]): Analysis {
  const g = build_graph(geos)
  const n = g.nb.length
  const box = new THREE.Box3(); for (let i = 0; i < n; i++) box.expandByPoint(V(g.pos, i))
  const size = box.getSize(new THREE.Vector3()); const ctr = box.getCenter(new THREE.Vector3())
  const notes: string[] = []
  // core: node closest to the centre of mass of all nodes, pulled to the box centre in X (models are usually symmetric)
  const com = new THREE.Vector3(); for (let i = 0; i < n; i++) com.add(V(g.pos, i)); com.divideScalar(Math.max(1, n)); com.x = ctr.x
  let core = 0; let cd = Infinity
  for (let i = 0; i < n; i++) { const d = V(g.pos, i).distanceToSquared(com); if (d < cd && g.nb[i].length > 0) { cd = d; core = i } }
  const D = dijkstra(g, [core])
  let maxd = 0; for (let i = 0; i < n; i++) if (Number.isFinite(D.dist[i])) maxd = Math.max(maxd, D.dist[i])
  // tips = maxima of the geodesic distance that are "prominent": sweep the nodes from far to near, joining
  // neighbours (union-find); when two growing regions meet, the younger one dies, and its prominence is how far
  // its tip sticks out past the meeting point (topological persistence). Fingers, folds and noise die young.
  const order: number[] = []; for (let i = 0; i < n; i++) if (Number.isFinite(D.dist[i])) order.push(i)
  order.sort((a, b) => D.dist[b] - D.dist[a])
  const uf = new Int32Array(n).fill(-1); const birth = new Int32Array(n).fill(-1)
  const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x] } return x }
  const prom = new Map<number, number>()
  for (const i of order) {
    uf[i] = i; birth[i] = i
    const roots = new Set<number>(); for (const [b] of g.nb[i]) if (uf[b] >= 0) roots.add(find(b))
    if (roots.size === 0) continue
    const rs = [...roots].sort((a, b) => D.dist[birth[b]] - D.dist[birth[a]])
    const keep = rs[0]
    for (const r of rs.slice(1)) { prom.set(birth[r], D.dist[birth[r]] - D.dist[i]); uf[r] = keep }
    uf[i] = keep
  }
  const top = order[0]; if (top !== undefined) prom.set(top, Infinity)
  const thr = Math.max(maxd * 0.14, size.length() * 0.035)
  const tips = [...prom.entries()].filter(([t, p]) => p > thr && D.dist[t] > maxd * 0.2).sort((a, b) => D.dist[b[0]] - D.dist[a[0]]).slice(0, 16).map(([t]) => t)
  // branches
  const T = dijkstra(g, tips)
  const core_r = maxd * 0.22
  const label = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) if (T.from[i] >= 0 && D.dist[i] > core_r && T.dist[i] < D.dist[tips[T.from[i]]] - core_r * 0.6) label[i] = T.from[i]
  const branches: Branch[] = tips.map((t, k) => {
    const nodes: number[] = []; for (let i = 0; i < n; i++) if (label[i] === k) nodes.push(i)
    const len = nodes.reduce((m, i) => Math.max(m, T.dist[i]), 0)
    const slices = Math.max(2, Math.min(5, Math.round(len / (size.length() * 0.08))))
    const joints: THREE.Vector3[] = []
    for (let s = slices; s >= 0; s--) {
      const lo = len * s / (slices + 1); const hi = len * (s + 1) / (slices + 1)
      const c = new THREE.Vector3(); let m = 0
      for (const i of nodes) if (T.dist[i] >= lo && T.dist[i] <= hi) { c.add(V(g.pos, i)); m++ }
      if (m > 0) joints.push(c.divideScalar(m))
    }
    joints.push(V(g.pos, t))
    return { name: `branch_${k + 1}`, kind: 'part' as AnchorKind, side: 0 as -1 | 0 | 1, tip: V(g.pos, t), joints, nodes: nodes.length, length: len }
  }).filter(b => b.nodes > 0)
  // -------- what is it, and what is each branch --------
  const H = size.y
  const low = (b: Branch): boolean => b.tip.y < box.min.y + H * 0.15
  const lows = branches.filter(low)
  const flat = flat_ratio(geos)
  // which horizontal axis is "side to side": the one the high tips (arms, wings) spread along; else the narrower one
  const ups = branches.filter(b => !low(b))
  const spread = (ax: 'x' | 'z'): number => ups.reduce((m, b) => Math.max(m, Math.abs(b.tip[ax] - a_ctr(ax))), 0)
  function a_ctr (ax: 'x' | 'z'): number { return ctr[ax] }
  const sideAx: 'x' | 'z' = spread('x') >= spread('z') * 1.25 ? 'x' : spread('z') >= spread('x') * 1.25 ? 'z' : (size.x <= size.z ? 'x' : 'z')
  const depthAx: 'x' | 'z' = sideAx === 'x' ? 'z' : 'x'
  const W = size[sideAx]; const Lz = size[depthAx]
  let type: Analysis['type'] = 'object'
  if (flat > 0.55 && H < Math.max(Lz, W) * 0.85) type = 'vehicle'
  else if (lows.length >= 3 && Math.max(Lz, W) > H * 0.9 && lows.length >= 4) type = 'quadruped'
  else if (H > Math.max(W, Lz) * 0.75 && lows.length >= 1 && lows.length <= 3) type = 'humanoid'
  else if (lows.length >= 3) type = 'quadruped'
  notes.push(`size ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}, flat ${(flat * 100).toFixed(0)}%, side axis ${sideAx.toUpperCase()}`)
  const side = (p: THREE.Vector3): -1 | 0 | 1 => Math.abs(p[sideAx] - ctr[sideAx]) < W * 0.04 ? 0 : (p[sideAx] > ctr[sideAx] ? 1 : -1)
  const S = (b: Branch): string => b.side === 0 ? '' : b.side > 0 ? '_L' : '_R'
  branches.forEach(b => { b.side = side(b.tip) })
  if (type === 'humanoid') {
    const head = branches.filter(b => !low(b)).sort((a, b) => b.tip.y - a.tip.y)[0]
    const headY = head?.tip.y ?? box.max.y
    lows.forEach(b => { b.kind = 'leg' })
    branches.forEach(b => {
      if (b === head) { b.kind = 'head'; return }
      if (b.kind === 'leg') return
      const behind = Math.abs(b.tip[depthAx] - ctr[depthAx]) > Math.max(Lz * 0.3, H * 0.12) && Math.abs(b.tip[sideAx] - ctr[sideAx]) < W * 0.3
      const ext = Math.abs(b.tip[sideAx] - ctr[sideAx])
      if (b.tip.y > headY - H * 0.14 && ext < W * 0.35) b.kind = ext < W * 0.06 ? 'hair' : (b.length < H * 0.12 ? 'horn' : 'ear')
      else if (behind && b.tip.y < box.min.y + H * 0.5 && b.joints[0].y < box.min.y + H * 0.6) b.kind = b.joints[0].y > box.min.y + H * 0.62 ? 'cape' : 'tail'
      else if (behind && b.tip.y > box.min.y + H * 0.45) b.kind = 'wing'
      else if (behind) b.kind = 'cape'
      else b.kind = 'arm'
    })
    // more than 2 arms: the extra ones further from the shoulder line are items (sword, staff)
    const arms = branches.filter(b => b.kind === 'arm').sort((a, b) => a.length - b.length)
    if (arms.length > 2) arms.slice(0, arms.length - 2).forEach(b => { b.kind = 'item' })
  } else if (type === 'quadruped') {
    lows.forEach(b => { b.kind = 'leg' })
    const tops = branches.filter(b => b.kind !== 'leg')
    // the head is the highest tip at one end; the tail is at the other end
    const head = tops.slice().sort((a, b) => (b.tip.y + Math.abs(b.tip[depthAx] - ctr[depthAx]) * 0.5) - (a.tip.y + Math.abs(a.tip[depthAx] - ctr[depthAx]) * 0.5))[0]
    const fs = head !== undefined ? Math.sign(head.tip[depthAx] - ctr[depthAx]) || 1 : 1
    const front = (b: Branch): boolean => (b.tip[depthAx] - ctr[depthAx]) * fs > 0
    tops.forEach(b => {
      if (b === head) b.kind = 'head'
      else if (!front(b) && Math.abs(b.tip[depthAx] - ctr[depthAx]) > Lz * 0.25) b.kind = 'tail'
      else if (head !== undefined && b.tip.distanceTo(head.tip) < H * 0.45 && b.tip.y > head.tip.y - H * 0.1) b.kind = b.length < H * 0.15 ? 'horn' : 'ear'
      else if (b.tip.y > box.min.y + H * 0.7) b.kind = 'wing'
      else b.kind = 'part'
    })
  } else if (type === 'object' && branches.length >= 2) {
    // creatures that are neither people nor 4-legged (dragon, bird, fish, snake…): wide side tips are wings,
    // low tips are legs, the two ends along the body are head (the higher / thicker end) and tail
    branches.forEach(b => {
      if (Math.abs(b.tip[sideAx] - ctr[sideAx]) > W * 0.22 && b.length > H * 0.3) b.kind = 'wing'
      else if (low(b)) b.kind = 'leg'
    })
    const rest = branches.filter(b => b.kind === 'part')
    if (rest.length > 0) {
      const ends = rest.slice().sort((a, b) => a.tip[depthAx] - b.tip[depthAx])
      const e0 = ends[0]; const e1 = ends[ends.length - 1]
      const score = (b: Branch): number => b.tip.y - b.length * 0.3
      const head = rest.length === 1 ? e0 : (score(e0) > score(e1) ? e0 : e1)
      head.kind = 'head'
      if (rest.length > 1) (head === e0 ? e1 : e0).kind = 'tail'
    }
  } else if (type === 'vehicle') {
    branches.forEach(b => { b.kind = b.tip.y < box.min.y + H * 0.3 ? 'wheel' : 'part' })
    notes.push('vehicle: use the Vehicles tab (wheels, tracks, doors, turret…)')
  }
  // names: kind + side + number when needed
  const seen = new Map<string, number>()
  branches.forEach(b => {
    let base: string = b.kind
    if (b.kind === 'leg' && type === 'quadruped') { const head = branches.find(x => x.kind === 'head'); const fs = head !== undefined ? Math.sign(head.tip[depthAx] - ctr[depthAx]) || 1 : 1; base = (b.tip[depthAx] - ctr[depthAx]) * fs > 0 ? 'front_leg' : 'back_leg' }
    base += S(b)
    const k = (seen.get(base) ?? 0) + 1; seen.set(base, k)
    b.name = k > 1 ? `${base}_${k}` : base
  })
  const extras = branches.filter(b => ['tail', 'wing', 'ear', 'horn', 'hair', 'cape', 'item'].includes(b.kind))
  if (extras.length > 0) notes.push(`accessories: ${extras.map(b => b.name).join(', ')}`)
  // per vertex labels (branch index after filtering)
  const keep = tips.map((_t, k) => branches.findIndex(b => b.name !== undefined && b.tip.equals(V(g.pos, tips[k]))))
  const labels = g.of.map(m => { const out = new Int32Array(m.length); for (let i = 0; i < m.length; i++) out[i] = label[m[i]] >= 0 ? keep[label[m[i]]] : -1; return out })
  return { type, core: V(g.pos, core), size, branches, labels, notes }
}

/** share of the surface whose normal is along X, Y or Z (machines are boxy, creatures are not) */
function flat_ratio (geos: THREE.BufferGeometry[]): number {
  let flat = 0; let all = 0
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3(); const nrm = new THREE.Vector3()
  for (const g of geos) {
    const pos = g.getAttribute('position'); const idx = g.getIndex(); const tc = idx !== null ? idx.count : pos.count
    const step = Math.max(3, Math.floor(tc / 30000) * 3)
    for (let t = 0; t + 2 < tc; t += step) {
      a.fromBufferAttribute(pos, idx !== null ? idx.getX(t) : t); b.fromBufferAttribute(pos, idx !== null ? idx.getX(t + 1) : t + 1); c.fromBufferAttribute(pos, idx !== null ? idx.getX(t + 2) : t + 2)
      nrm.subVectors(b, a).cross(c.clone().sub(a)); const ar = nrm.length(); if (ar <= 0) continue
      nrm.divideScalar(ar)
      all += ar; if (Math.max(Math.abs(nrm.x), Math.abs(nrm.y), Math.abs(nrm.z)) > 0.97) flat += ar
    }
  }
  return all > 0 ? flat / all : 0
}

const KIND_COLOR: Record<AnchorKind, number> = { head: 0xff5d5d, arm: 0x4da6ff, leg: 0x3fbf7f, tail: 0xffa04d, wing: 0xd36bff, ear: 0xffe14d, horn: 0xffe14d, hair: 0xff6bd0, cape: 0x7a6bff, item: 0xbbbbbb, wheel: 0x4fc3f7, part: 0x9be15d, spine: 0xffffff }

/**
 * dots on every anchor (draggable: userData.branch / joint), lines along each branch, a label at each tip, and the
 * skin each branch covers as coloured points (pass the geometries; `focus` = the branch shown bright, others dim)
 */
export function draw_analysis (a: Analysis, geos?: THREE.BufferGeometry[], focus = -1): THREE.Group {
  const g = new THREE.Group(); g.name = 'Greenbox analysis'
  const r = a.size.length() * 0.007
  const dot = (p: THREE.Vector3, col: number, s = 1, ud: Record<string, number> = {}): void => { const m = new THREE.Mesh(new THREE.SphereGeometry(r * s, 10, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); m.position.copy(p); m.renderOrder = 20; Object.assign(m.userData, ud); g.add(m) }
  dot(a.core, 0xffffff, 1.6)
  if (geos !== undefined) {
    // the skin of each branch: a see-through coloured copy of the surface (grey = body)
    const c = new THREE.Color()
    geos.forEach((geo, gi) => {
      const lab = a.labels[gi]; const pa = geo.getAttribute('position'); if (lab === undefined) return
      const col = new Float32Array(pa.count * 3)
      for (let i = 0; i < pa.count; i++) {
        const bi = lab[i]
        if (bi < 0 || a.branches[bi] === undefined) c.setRGB(0.45, 0.45, 0.48); else { c.setHex(KIND_COLOR[a.branches[bi].kind]); if (a.branches[bi].side < 0) c.offsetHSL(0.06, 0, -0.12) }
        if (focus >= 0 && bi !== focus) c.multiplyScalar(0.3)
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', pa); if (geo.getIndex() !== null) sg.setIndex(geo.getIndex()); sg.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const skin = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
      skin.renderOrder = 18; skin.raycast = () => {}; skin.name = 'branch skin'; g.add(skin)
    })
  }
  a.branches.forEach((b, bi) => {
    const col = KIND_COLOR[b.kind]
    const pts = [a.core, ...b.joints]
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: focus >= 0 && focus !== bi ? 0.3 : 1 })); l.renderOrder = 19; l.raycast = () => {}; g.add(l)
    b.joints.forEach((p, i) => dot(p, col, i === b.joints.length - 1 ? 1.3 : 1, { branch: bi, joint: i }))
    const c = document.createElement('canvas'); c.width = 256; c.height = 64
    const x = c.getContext('2d')!; x.font = 'bold 34px system-ui'; x.fillStyle = '#000a'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#' + col.toString(16).padStart(6, '0'); x.fillText(b.name, 10, 44)
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }))
    sp.scale.set(a.size.length() * 0.12, a.size.length() * 0.03, 1); sp.position.copy(b.tip).add(new THREE.Vector3(0, a.size.length() * 0.03, 0)); sp.renderOrder = 21; sp.raycast = () => {}; g.add(sp)
  })
  return g
}
