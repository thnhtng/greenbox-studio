/*
 * BodyScan (Greenbox): read a humanoid mesh and find where its joints are.
 * Works on the shape itself, not on "average human" proportions, so dwarves, chibis and
 * big-head characters get joints where THEIR legs split, arms point and neck narrows.
 *
 * Assumptions (same as Mesh2Motion's): model stands on +Y, faces +Z, roughly symmetric in X.
 * Arms can be in T-pose, A-pose or anywhere in between.
 */
import * as THREE from 'three'

type V3 = THREE.Vector3
export interface SideLandmarks {
  clavicle: V3, shoulder: V3, elbow: V3, wrist: V3, hand_tip: V3
  thigh: V3, knee: V3, ankle: V3, ball: V3, toe: V3
}
export interface BodyLandmarks {
  pelvis: V3, spine1: V3, spine2: V3, spine3: V3, neck: V3, head: V3, head_top: V3
  left: SideLandmarks // side with +x
  right: SideLandmarks // side with -x
  arm_drop: number // radians the arms hang below horizontal (0 = T-pose, ~0.7 = A-pose)
  neck_y: number
  head_share: number // head height / total height (big for chibi)
  debug: string
}

/** area-weighted random points on every triangle of every mesh (vertices alone fail on low-poly models) */
function sample_surface (root: THREE.Object3D, count: number): V3[] {
  const tris: Array<[V3, V3, V3]> = []
  const areas: number[] = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!(m.isMesh ?? false) || m.geometry === undefined) return
    const g = m.geometry as THREE.BufferGeometry
    const pos = g.getAttribute('position')
    if (pos === undefined) return
    const idx = g.getIndex()
    const n = idx !== null ? idx.count : pos.count
    const get = (i: number): V3 => new THREE.Vector3().fromBufferAttribute(pos as THREE.BufferAttribute, idx !== null ? idx.getX(i) : i).applyMatrix4(m.matrixWorld)
    for (let i = 0; i + 2 < n; i += 3) {
      const a = get(i); const b = get(i + 1); const c = get(i + 2)
      const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() * 0.5
      if (area > 0) { tris.push([a, b, c]); areas.push(area) }
    }
  })
  if (tris.length === 0) return []
  const cum: number[] = []; let tot = 0
  for (const a of areas) { tot += a; cum.push(tot) }
  let seed = 12345
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const pts: V3[] = []
  for (let k = 0; k < count; k++) {
    const r = rnd() * tot
    let lo = 0; let hi = cum.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid }
    const [a, b, c] = tris[lo]
    let u = rnd(); let v = rnd()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    pts.push(a.clone().add(b.clone().sub(a).multiplyScalar(u)).add(c.clone().sub(a).multiplyScalar(v)))
  }
  return pts
}

function median (a: number[]): number {
  if (a.length === 0) return 0
  const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]
}

/** split points of one slice into groups separated by empty gaps along X */
function clusters_x (pts: V3[], gap: number): Array<{ x0: number, x1: number, pts: V3[] }> {
  const s = [...pts].sort((a, b) => a.x - b.x)
  const out: Array<{ x0: number, x1: number, pts: V3[] }> = []
  for (const p of s) {
    const last = out[out.length - 1]
    if (last === undefined || p.x - last.x1 > gap) out.push({ x0: p.x, x1: p.x, pts: [p] })
    else { last.x1 = p.x; last.pts.push(p) }
  }
  return out.filter(c => c.pts.length >= 3)
}

function center_of (pts: V3[]): V3 {
  if (pts.length === 0) return new THREE.Vector3()
  return new THREE.Vector3(median(pts.map(p => p.x)), median(pts.map(p => p.y)), median(pts.map(p => p.z)))
}
function mid_z (pts: V3[]): number {
  if (pts.length === 0) return 0
  let a = Infinity; let b = -Infinity
  for (const p of pts) { a = Math.min(a, p.z); b = Math.max(b, p.z) }
  return (a + b) / 2
}

/** principal axis of a point cloud (power iteration on the covariance) */
function principal_axis (pts: V3[]): { c: V3, d: V3 } {
  const c = new THREE.Vector3(); pts.forEach(p => c.add(p)); c.multiplyScalar(1 / pts.length)
  const m = [0, 0, 0, 0, 0, 0] // xx xy xz yy yz zz
  for (const p of pts) {
    const x = p.x - c.x; const y = p.y - c.y; const z = p.z - c.z
    m[0] += x * x; m[1] += x * y; m[2] += x * z; m[3] += y * y; m[4] += y * z; m[5] += z * z
  }
  let d = new THREE.Vector3(1, 0.3, 0.1).normalize()
  for (let i = 0; i < 40; i++) {
    d = new THREE.Vector3(m[0] * d.x + m[1] * d.y + m[2] * d.z, m[1] * d.x + m[3] * d.y + m[4] * d.z, m[2] * d.x + m[4] * d.y + m[5] * d.z).normalize()
  }
  return { c, d }
}

export function scan_humanoid (root: THREE.Object3D): BodyLandmarks | null {
  const P = sample_surface(root, 150000)
  if (P.length < 500) return null
  const box = new THREE.Box3(); P.forEach(p => box.expandByPoint(p))
  const minY = box.min.y; const maxY = box.max.y; const H = maxY - minY
  if (!(H > 0)) return null
  const cx = (box.min.x + box.max.x) / 2
  const N = 120; const dy = H / N
  const slices: V3[][] = Array.from({ length: N }, () => [])
  P.forEach(p => { slices[Math.min(N - 1, Math.max(0, Math.floor((p.y - minY) / dy)))].push(p) })
  let gap = H * 0.022
  const ys = (i: number): number => minY + (i + 0.5) * dy
  const notes: string[] = []

  /* ---- legs / crotch: the legs are two separate blobs left and right of the centre line ---- */
  const split = (i: number): boolean => {
    const cl = clusters_x(slices[i], gap)
    return cl.length >= 2 && !cl.some(c => c.x0 < cx && c.x1 > cx) && cl.some(c => c.x1 < cx) && cl.some(c => c.x0 > cx)
  }
  const find_crotch = (): number => {
    let ci = -1; let started = false
    for (let i = 0; i < N * 0.7; i++) {
      if (split(i)) { started = true; ci = i } else if (started && i - ci > 2) break
    }
    return ci
  }
  let crotch_i = find_crotch()
  if (crotch_i <= 2) {
    // chibi legs often stand almost touching: retry with a much finer gap
    const g0 = gap; gap = H * 0.005
    crotch_i = find_crotch()
    gap = g0
    if (crotch_i > 2) notes.push('legs close together')
  }
  let crotchY: number
  if (crotch_i > 2) { crotchY = minY + (crotch_i + 1) * dy; notes.push('legs split') } else { crotchY = minY + 0.42 * H; notes.push('legs merged: guessed') }

  /* ---- torso half width just above the crotch (below any arm) ---- */
  const torso_half: number[] = []
  const c0 = Math.ceil((crotchY - minY) / dy) + 1
  for (let i = c0; i < Math.min(N, c0 + Math.ceil(N * 0.08)); i++) {
    const cl = clusters_x(slices[i], gap).find(c => c.x0 <= cx && c.x1 >= cx)
    if (cl !== undefined) torso_half.push(Math.max(cx - cl.x0, cl.x1 - cx))
  }
  // where the arms hang free (a blob left AND right of the torso), that middle blob IS the torso.
  // Prefer it: hands resting on the hips would otherwise make the hips look as wide as the arms.
  const free_half: number[] = []
  for (let i = c0; i < Math.min(N, c0 + Math.ceil(N * 0.45)); i++) {
    const cl = clusters_x(slices[i], gap)
    const mid = cl.find(c => c.x0 <= cx && c.x1 >= cx)
    if (mid === undefined) continue
    if (cl.some(c => c.x1 < mid.x0) && cl.some(c => c.x0 > mid.x1)) free_half.push(Math.max(cx - mid.x0, mid.x1 - cx))
  }
  let halfW = torso_half.length > 0 ? median(torso_half) : (box.max.x - box.min.x) * 0.2
  if (free_half.length >= 3) { const f = median(free_half); if (f < halfW) { halfW = f; notes.push('torso from free arms') } }

  /* ---- neck first: narrowest centre column between the torso and the top (works for big heads) ---- */
  const width_at = (i: number): number => {
    const cl = clusters_x(slices[i], gap).find(c => c.x0 <= cx && c.x1 >= cx)
    return cl === undefined ? Infinity : cl.x1 - cl.x0
  }
  const up0 = Math.ceil((crotchY + (maxY - crotchY) * 0.2 - minY) / dy)
  const up1 = Math.floor((maxY - (maxY - crotchY) * 0.08 - minY) / dy)
  let neck_i = Math.min(N - 1, Math.max(0, Math.floor((crotchY + (maxY - crotchY) * 0.7 - minY) / dy)))
  { const W: number[] = []
    for (let i = 0; i < N; i++) W[i] = (i >= up0 && i <= Math.min(up1, N - 1)) ? width_at(i) : Infinity
    // a neck has something clearly WIDER above it (the head). The top of a round chibi head is narrow
    // too, but nothing wider sits above it, so it can no longer win.
    const wider_above: number[] = Array(N).fill(0)
    let mx = 0
    for (let i = Math.min(up1, N - 1); i >= up0; i--) { wider_above[i] = mx; if (Number.isFinite(W[i])) mx = Math.max(mx, W[i]) }
    let best = Infinity; let found = false
    for (let i = up0; i <= up1 && i < N; i++) {
      const w = W[i]
      if (!Number.isFinite(w) || wider_above[i] < w * 1.12) continue
      if (w <= best * 1.02) { if (w < best) best = w; neck_i = i; found = true }
    }
    if (!found) {
      best = Infinity
      // prefer the highest of near-equal minima: the neck sits above the waist
      for (let i = up0; i <= up1 && i < N; i++) { const w = W[i]; if (w <= best * 1.02) { if (w < best) best = w; neck_i = i } }
    } }
  const neckY = ys(neck_i)

  /* ---- front/back centre of the body at a height: only the middle of the centre blob counts, so arms reaching
     forward (zombie) or a big belly ring do not drag the spine out of the body ---- */
  const zc_cache = new Map<number, number>()
  const zc = (y: number): number => {
    const i = Math.min(N - 1, Math.max(0, Math.floor((y - minY) / dy)))
    const hit = zc_cache.get(i); if (hit !== undefined) return hit
    const cl = clusters_x(slices[i], gap).find(c => c.x0 <= cx && c.x1 >= cx)
    let z = (box.min.z + box.max.z) / 2
    if (cl !== undefined) {
      const core = cl.pts.filter(p => Math.abs(p.x - cx) < Math.max(halfW * 0.6, (cl.x1 - cl.x0) * 0.2))
      z = mid_z(core.length >= 5 ? core : cl.pts)
    }
    zc_cache.set(i, z)
    return z
  }
  // torso half depth (front to back) low on the belly, below where arms usually are
  const depth: number[] = []
  for (let i = c0; i < Math.min(N, c0 + Math.ceil(N * 0.12)); i++) {
    const core = slices[i].filter(p => Math.abs(p.x - cx) < halfW * 0.7)
    if (core.length < 5) continue
    let a = Infinity; let b = -Infinity; for (const p of core) { a = Math.min(a, p.z); b = Math.max(b, p.z) }
    depth.push((b - a) / 2)
  }
  const halfD = depth.length > 0 ? median(depth) : (box.max.z - box.min.z) * 0.25

  /* ---- arms: everything between crotch and neck that sticks out sideways past the torso ---- */
  const side_arm = (s: number): { shoulder: V3, elbow: V3, wrist: V3, tip: V3, top: number } | null => {
    // outside the torso: further out than its side, OR in front of / behind it (arms reaching forward)
    const out_of_torso = (p: V3): boolean => (p.x - cx) * s > halfW * 1.12 || ((p.x - cx) * s > halfW * 0.35 && Math.abs(p.z - zc(p.y)) > halfD * 1.35)
    const A = P.filter(p => p.y > crotchY + 0.02 * H && p.y < neckY - dy && out_of_torso(p))
    if (A.length < P.length * 0.01) return null
    const { c, d } = principal_axis(A)
    let tmin = Infinity; let tmax = -Infinity
    const ends = (): void => { tmin = Infinity; tmax = -Infinity; for (const p of A) { const t = p.clone().sub(c).dot(d); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t) } }
    ends()
    // orient the axis from the torso outward: the hand end is the one farther from the body's centre line
    const away = (t0: number): number => {
      const band = (tmax - tmin) * 0.1; let sum = 0; let n = 0
      for (const p of A) { const t = p.clone().sub(c).dot(d); if (Math.abs(t - t0) < band) { sum += Math.hypot(p.x - cx, p.z - zc(p.y)); n++ } }
      return n > 0 ? sum / n : 0
    }
    if (away(tmin) > away(tmax)) { d.negate(); ends() }
    const near_root = c.clone().add(d.clone().multiplyScalar(tmin))
    const tip = c.clone().add(d.clone().multiplyScalar(tmax))
    // arm thickness from distances to the axis
    const dist = A.slice(0, 4000).map(p => { const v = p.clone().sub(c); return v.sub(d.clone().multiplyScalar(v.dot(d))).length() })
    const th = median(dist) * 2
    // shoulder: the inner end of the arm, pulled just inside the torso edge
    const topY = Math.max(...A.filter(p => (p.x - cx) * s < halfW * 1.6).map(p => p.y), near_root.y)
    const shoulder = near_root.clone()
    // T-pose: the shoulder ball sits just inside the torso edge. Arms hanging down: it sits on top of the
    // arm column itself (otherwise the upper arm bone runs through the ribs and steals the chest).
    const hang = Math.min(1, Math.max(0, (Math.abs(d.y) - 0.5) / 0.4))
    // arms reaching forward / back: the shoulder sits on the arm's line, at the depth of the chest
    const reach = Math.min(1, Math.max(0, (Math.abs(d.z) - 0.4) / 0.4))
    const col = Math.max(hang, reach)
    shoulder.x = cx + s * (halfW * 0.85 + (Math.max(halfW * 0.85, Math.abs(near_root.x - cx)) - halfW * 0.85) * col)
    shoulder.z = near_root.z + (shoulder.z - near_root.z) * (1 - hang)
    if (reach > 0) shoulder.z = shoulder.z + (zc(near_root.y) - shoulder.z) * reach
    shoulder.y = Math.min(near_root.y + Math.abs(d.x) * 0 , topY - th * 0.45, neckY - dy * 2)
    const L = tip.distanceTo(shoulder)
    const dir = tip.clone().sub(shoulder).normalize()
    // elbow / wrist: on the line, then moved to the middle of the arm's cross-section there (bent or thick arms)
    const centre_at = (k: number): V3 => {
      const q = shoulder.clone().add(dir.clone().multiplyScalar(L * k))
      const band = Math.max(L * 0.05, th * 0.35)
      const pts = A.filter(p => Math.abs(p.clone().sub(q).dot(dir)) < band && p.distanceTo(q) < Math.max(th * 2.5, L * 0.25))
      if (pts.length < 8) return q
      const bb = new THREE.Box3(); pts.forEach(p => bb.expandByPoint(p))
      const m = bb.getCenter(new THREE.Vector3())
      // keep the joint's position along the arm, take the centre across it
      const across = m.sub(q); across.sub(dir.clone().multiplyScalar(across.dot(dir)))
      return q.add(across)
    }
    return {
      shoulder,
      elbow: centre_at(0.44),
      wrist: centre_at(0.80),
      tip,
      top: topY
    }
  }
  const armL = side_arm(1); const armR = side_arm(-1)
  notes.push(armL !== null && armR !== null ? 'arms found' : 'arms not separated: guessed')

  let shoulderY: number
  if (armL !== null && armR !== null) shoulderY = (armL.shoulder.y + armR.shoulder.y) / 2
  else shoulderY = crotchY + (neckY - crotchY) * 0.85


  /* ---- spine ---- */
  const pelvisY = crotchY + (shoulderY - crotchY) * 0.12
  const chestTop = shoulderY - (shoulderY - crotchY) * 0.05
  const at = (y: number): V3 => new THREE.Vector3(cx, y, zc(y))
  const pelvis = at(pelvisY)
  const spine1 = at(pelvisY + (chestTop - pelvisY) * 0.25)
  const spine2 = at(pelvisY + (chestTop - pelvisY) * 0.52)
  const spine3 = at(pelvisY + (chestTop - pelvisY) * 0.80)
  const neck = at(Math.min(neckY, shoulderY + (neckY - shoulderY) * 0.5 + 0.0) )
  const head = at(neckY + (maxY - neckY) * 0.12)
  const head_top = new THREE.Vector3(cx, maxY - (maxY - neckY) * 0.02, head.z)

  /* ---- legs ---- */
  const legLen = crotchY - minY
  const leg = (s: number): { thigh: V3, knee: V3, ankle: V3, ball: V3, toe: V3 } => {
    const L = P.filter(p => p.y < crotchY && (p.x - cx) * s > 0)
    const at_y = (y: number, band: number): V3 => {
      const pts = L.filter(p => Math.abs(p.y - y) < band)
      if (pts.length < 5) return new THREE.Vector3(cx + s * halfW * 0.5, y, (box.min.z + box.max.z) / 2)
      const c = center_of(pts); return new THREE.Vector3(c.x, y, mid_z(pts))
    }
    const band = Math.max(dy * 1.5, legLen * 0.04)
    const knee = at_y(minY + legLen * 0.50, band)
    const ankle = at_y(minY + legLen * 0.10, band)
    // near the crotch the leg sits under the hip: ignore hands/sleeves resting beside it
    const thighP = (() => {
      const pts = L.filter(p => Math.abs(p.y - (crotchY - legLen * 0.08)) < band && (p.x - cx) * s < halfW * 1.05)
      return pts.length < 5 ? at_y(crotchY - legLen * 0.08, band) : new THREE.Vector3(center_of(pts).x, crotchY - legLen * 0.08, mid_z(pts))
    })()
    const thigh = new THREE.Vector3(thighP.x, pelvisY, (thighP.z + pelvis.z) / 2)
    const foot = L.filter(p => p.y < minY + Math.max(legLen * 0.12, dy * 2))
    let toeZ = ankle.z + legLen * 0.2
    if (foot.length > 5) toeZ = Math.max(...foot.map(p => p.z))
    const toe = new THREE.Vector3(ankle.x, minY + legLen * 0.02, toeZ)
    const ball = new THREE.Vector3(ankle.x, minY + legLen * 0.03, ankle.z + (toeZ - ankle.z) * 0.62)
    return { thigh, knee, ankle, ball, toe }
  }

  /* ---- fallback arms from the torso when they are not separated ---- */
  const guess_arm = (s: number): { shoulder: V3, elbow: V3, wrist: V3, tip: V3, top: number } => {
    const sh = new THREE.Vector3(cx + s * halfW * 0.85, shoulderY, zc(shoulderY))
    const down = new THREE.Vector3(s * 0.25, -1, 0).normalize()
    const L = (shoulderY - crotchY) * 1.0
    return { shoulder: sh, elbow: sh.clone().add(down.clone().multiplyScalar(L * 0.44)), wrist: sh.clone().add(down.clone().multiplyScalar(L * 0.8)), tip: sh.clone().add(down.clone().multiplyScalar(L)), top: shoulderY }
  }
  const aL = armL ?? guess_arm(1); const aR = armR ?? guess_arm(-1)
  const lL = leg(1); const lR = leg(-1)

  const side = (a: typeof aL, l: typeof lL, s: number): SideLandmarks => ({
    clavicle: new THREE.Vector3(cx + s * halfW * 0.18, a.shoulder.y + (neckY - a.shoulder.y) * 0.05, spine3.z + (a.shoulder.z - spine3.z) * 0.3 + 0.0),
    shoulder: a.shoulder, elbow: a.elbow, wrist: a.wrist, hand_tip: a.tip,
    thigh: l.thigh, knee: l.knee, ankle: l.ankle, ball: l.ball, toe: l.toe
  })
  const left = side(aL, lL, 1); const right = side(aR, lR, -1)

  // make both sides mirror images of their average (the editor's mirror mode expects symmetry)
  const keys = Object.keys(left) as Array<keyof SideLandmarks>
  for (const k of keys) {
    const a = left[k]; const b = right[k]
    const x = ((a.x - cx) + (cx - b.x)) / 2; const y = (a.y + b.y) / 2; const z = (a.z + b.z) / 2
    left[k] = new THREE.Vector3(cx + x, y, z); right[k] = new THREE.Vector3(cx - x, y, z)
  }

  const dirL = left.wrist.clone().sub(left.shoulder)
  const arm_drop = Math.max(0, Math.atan2(-dirL.y, Math.abs(dirL.x) + 1e-9))
  return { pelvis, spine1, spine2, spine3, neck, head, head_top, left, right, arm_drop, neck_y: neckY, head_share: (maxY - neckY) / H, debug: notes.join(', ') }
}
