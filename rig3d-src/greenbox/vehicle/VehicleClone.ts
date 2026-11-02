/*
 * 🧬 Clone a vehicle rig: take the moving parts (wheels, steering, doors, tracks, turret, boom…) and the
 * animations of a rigged vehicle (or a sample) and lay them onto another vehicle model.
 *
 * Why not the creature clone (skeleton warp): a car rig is not a body. Its bones are hinges and axles that
 * must stay where the target's own wheels / doors are, and every target vertex must belong to exactly one
 * rigid part. So instead:
 *   1. both vehicles are put in the same frame (length along Z, front at +Z) and squeezed into a unit box,
 *   2. every target vertex takes the part ("driver") of the nearest source vertex in that box,
 *   3. driver names say what each part is (wheel_FL, door, turret… see role_of), round low parts are wheels,
 *   4. the source animations are replayed as rotations / moves relative to each part's rest pose, turned
 *      into the target frame, so they work whatever the source bones' own axes were.
 */
import * as THREE from 'three'
import { role_of, type PartRole } from './Samples.ts'

export interface Driver {
  name: string
  node: THREE.Object3D
  role: PartRole
  animated: boolean
  /** joint position (canonical frame) and whether it is a real joint (inside / next to its part) */
  pos: THREE.Vector3
  real_pivot: boolean
  /** front / rear from the name (wheels): 1 front, -1 rear, 0 unknown */
  fr: number
  /** rest pose for the animation transfer */
  q0: THREE.Quaternion, p0: THREE.Vector3, P: THREE.Quaternion, Pm: THREE.Matrix3
  box: THREE.Box3 // canonical
}
export interface CloneSource {
  drivers: Driver[]
  /** normalized (0..1 box) sample points and the driver of each */
  pts: Float32Array, drv: Int32Array
  /** source world -> canonical rotation, canonical size */
  C: THREE.Quaternion, size: THREE.Vector3, min: THREE.Vector3
  clips: THREE.AnimationClip[]
  /** animated nodes that hold no skin (steering knuckles, the whole-vehicle root) -> what they carry */
  carriers: Array<{ name: string, wheel: number, root: boolean, q0: THREE.Quaternion, p0: THREE.Vector3, P: THREE.Quaternion, Pm: THREE.Matrix3 }>
  note: string
}

const track_node = (track: THREE.KeyframeTrack): string => THREE.PropertyBinding.parseTrackName(track.name).nodeName

function front_rear (name: string): number {
  const n = name.toLowerCase(); const tok = n.split(/[^a-z0-9]+/)
  if (n.includes('front') || tok.some(t => t === 'f' || t === 'fl' || t === 'fr' || t === 'fd')) return 1
  if (n.includes('rear') || n.includes('back') || tok.some(t => t === 'rl' || t === 'rr' || t === 'bl' || t === 'br' || t === 'b')) return -1
  if (/(front|f)(left|right|l|r)\d*$/.test(n)) return 1
  if (/(rear|back|b)(left|right|l|r)\d*$/.test(n) || /r(l|r)\d*$/.test(n)) return -1
  return 0
}

/** read a rigged vehicle (or a sample built from named meshes) */
export function read_source (root: THREE.Object3D, clips: THREE.AnimationClip[], flip: boolean): CloneSource | null {
  root.updateMatrixWorld(true)
  const animated = new Set<string>(); clips.forEach(c => c.tracks.forEach(t => animated.add(track_node(t))))
  const meshes: THREE.Mesh[] = []
  root.traverse(o => { if ((o as THREE.Mesh).isMesh === true && (o as THREE.Mesh).geometry?.getAttribute('position') !== undefined) meshes.push(o as THREE.Mesh) })
  if (meshes.length === 0) return null
  // the vehicle is where its wheels are: keep what sits around them (a showroom, a road, a bridge are not it)
  const wnodes: THREE.Object3D[] = []; root.traverse(o => { if (role_of(o.name)?.role === 'wheel') wnodes.push(o) })
  const wboxes = wnodes.map(o => new THREE.Box3().setFromObject(o)).filter(b => !b.isEmpty())
  if (wboxes.length > 0) {
    const cs = wboxes.map(b => b.getCenter(new THREE.Vector3())); const c = cs.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(cs.length)
    let spread = 0; cs.forEach(a => cs.forEach(b => { spread = Math.max(spread, a.distanceTo(b)) }))
    const r = Math.max(...wboxes.map(b => b.getSize(new THREE.Vector3()).length() / 2))
    const R = Math.max(spread * 1.6, r * 8)
    for (let i = meshes.length - 1; i >= 0; i--) {
      const b = new THREE.Box3().setFromObject(meshes[i]); const mc = b.getCenter(new THREE.Vector3())
      if (Math.hypot(mc.x - c.x, mc.z - c.z) > R || b.getSize(new THREE.Vector3()).length() > R * 3) meshes.splice(i, 1)
    }
  } else drop_scenery(meshes)
  if (meshes.length === 0) return null
  let total = 0; meshes.forEach(m => { total += m.geometry.getAttribute('position').count })
  // about 80k points, but every mesh (a small rim, a door handle) keeps at least a few hundred
  const step_of = (n: number): number => Math.max(1, Math.min(Math.floor(total / 80000), Math.floor(n / 300)))
  const nodes: THREE.Object3D[] = []; const index = new Map<THREE.Object3D, number>()
  const id_of = (o: THREE.Object3D): number => { let i = index.get(o); if (i === undefined) { i = nodes.length; nodes.push(o); index.set(o, i) } return i }
  const significant = (o: THREE.Object3D): boolean => { if (animated.has(o.name)) return true; const r = role_of(o.name); return r !== null && r.role !== 'body' }
  const W: number[] = []; const D: number[] = []
  const v = new THREE.Vector3()
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position')
    const sk = (m as THREE.SkinnedMesh).isSkinnedMesh === true ? m as THREE.SkinnedMesh : null
    const si = sk !== null ? m.geometry.getAttribute('skinIndex') : undefined; const sw = sk !== null ? m.geometry.getAttribute('skinWeight') : undefined
    // a plain mesh moves with its nearest significant ancestor (or itself)
    let own: THREE.Object3D = m
    if (sk === null) { let o: THREE.Object3D | null = m; while (o !== null && o !== root && !significant(o)) o = o.parent; own = o !== null && o !== root ? o : m }
    // a skinned mesh's points belong to its bones: the mesh itself is not a part (else it shows up as an empty one)
    const own_id = sk === null ? id_of(own) : -1
    const step = step_of(pos.count)
    for (let i = 0; i < pos.count; i += step) {
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld)
      let d = own_id
      if (sk !== null && si !== undefined && sw !== undefined) {
        let best = 0; let bw = -1
        for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c) } }
        const b = sk.skeleton.bones[best]; d = id_of(b !== undefined ? b : m)
      }
      if (d < 0) d = id_of(m)
      W.push(v.x, v.y, v.z); D.push(d)
    }
  }
  // canonical frame: length along Z
  const wb = new THREE.Box3(); for (let i = 0; i < W.length; i += 3) wb.expandByPoint(v.set(W[i], W[i + 1], W[i + 2]))
  const ws = wb.getSize(new THREE.Vector3())
  const C = new THREE.Quaternion()
  if (ws.x > ws.z * 1.1) C.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  const canon = (p: THREE.Vector3): THREE.Vector3 => p.clone().applyQuaternion(C)
  // front at +Z: from wheel names (front wheels ahead of the rear ones)
  const node_box = nodes.map(() => new THREE.Box3())
  for (let i = 0; i < D.length; i++) node_box[D[i]].expandByPoint(canon(v.set(W[i * 3], W[i * 3 + 1], W[i * 3 + 2])))
  let fz = 0; let fn = 0; let rz = 0; let rn = 0
  nodes.forEach((o, i) => {
    if (role_of(o.name)?.role !== 'wheel' || node_box[i].isEmpty()) return
    const f = front_rear(o.name); const z = node_box[i].getCenter(v).z
    if (f > 0) { fz += z; fn++ } else if (f < 0) { rz += z; rn++ }
  })
  let named_front = false
  if (fn > 0 && rn > 0) { named_front = true; if (fz / fn < rz / rn) C.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)) }
  if (flip) C.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))
  // points in the final frame, normalized
  const box = new THREE.Box3(); const P3: THREE.Vector3[] = []
  for (let i = 0; i < D.length; i++) { const p = canon(v.set(W[i * 3], W[i * 3 + 1], W[i * 3 + 2])); P3.push(p); box.expandByPoint(p) }
  const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-6, 1e-6, 1e-6))
  const pts = new Float32Array(D.length * 3)
  const boxes = nodes.map(() => new THREE.Box3())
  P3.forEach((p, i) => { pts[i * 3] = (p.x - box.min.x) / size.x; pts[i * 3 + 1] = (p.y - box.min.y) / size.y; pts[i * 3 + 2] = (p.z - box.min.z) / size.z; boxes[D[i]].expandByPoint(p) })
  // drivers
  const rest = (o: THREE.Object3D): { q0: THREE.Quaternion, p0: THREE.Vector3, P: THREE.Quaternion, Pm: THREE.Matrix3 } => {
    const P = new THREE.Quaternion(); const Pm = new THREE.Matrix3()
    if (o.parent !== null) { o.parent.getWorldQuaternion(P); Pm.setFromMatrix4(o.parent.matrixWorld) }
    return { q0: o.quaternion.clone(), p0: o.position.clone(), P, Pm }
  }
  const drivers: Driver[] = nodes.map((o, i) => {
    const b = boxes[i]; const s = b.getSize(new THREE.Vector3()); const c = b.getCenter(new THREE.Vector3())
    let role = role_of(o.name)
    if (role === null || role.role === 'body') {
      // a round, low, thin part standing on its edge is a wheel whatever its name
      const round = s.y > 0 && s.z / s.y > 0.7 && s.z / s.y < 1.4 && s.x < s.y * 0.95
      if (!b.isEmpty() && round && b.min.y < box.min.y + size.y * 0.12 && s.y > size.y * 0.12 && s.y < size.y * 0.85) role = { role: 'wheel' }
    }
    if (role === null) role = animated.has(o.name) && o !== root ? { role: 'mech', kind: 'bone' } : { role: 'body' }
    const wp = canon(o.getWorldPosition(new THREE.Vector3()))
    const near = !b.isEmpty() && b.distanceToPoint(wp) < Math.max(s.length() * 0.35, size.length() * 0.02)
    return { name: o.name, node: o, role, animated: animated.has(o.name), pos: wp, real_pivot: near && o.type !== 'Mesh' && o.type !== 'SkinnedMesh', fr: front_rear(o.name), ...rest(o), box: b }
  })
  // animated nodes without skin: a steering knuckle above a wheel, or the whole vehicle's root
  const carriers: CloneSource['carriers'] = []
  // the driver holding most of the skin is the body (a moving one bounces the body)
  { const share = new Map<number, number>(); D.forEach(d => share.set(d, (share.get(d) ?? 0) + 1))
    share.forEach((n, i) => { const d = drivers[i]; if (n >= D.length * 0.25 && d.role.role === 'mech' && d.role.kind === 'bone') d.role = { role: 'body' } }) }
  // a driver that carries most of the others is the vehicle itself (it moves the whole car): body + root motion
  drivers.forEach((d, i) => {
    if (d.role.role !== 'mech' || d.role.kind !== 'bone') return
    let n = 0; d.node.traverse(c => { const j = index.get(c); if (j !== undefined && j !== i) n++ })
    if (n >= Math.max(2, (drivers.length - 1) * 0.6)) { d.role = { role: 'body' }; if (d.animated) carriers.push({ name: d.name, wheel: -1, root: true, q0: d.q0, p0: d.p0, P: d.P, Pm: d.Pm }) }
  })
  // parts that ended up holding no point (empty) are not parts
  drivers.forEach(d => { if (d.box.isEmpty() && d.role.role !== 'body') d.role = { role: 'body' } })
  const seen = new Set(nodes); const named = new Set(carriers.map(c => c.name))
  root.traverse(o => {
    // one carrier per name: FBX files repeat names (the mesh object and its bone)
    if (seen.has(o) || !animated.has(o.name) || named.has(o.name)) return
    const wheels = new Set<number>(); let n = 0
    o.traverse(c => { const i = index.get(c); if (i === undefined) return; n++; if (drivers[i].role.role === 'wheel') wheels.add(i) })
    if (n === 0) return
    // above two wheels or more (or most parts) = the whole vehicle moving; above one wheel = its steering knuckle
    const carries_all = wheels.size >= 2 || n >= Math.max(2, drivers.length * 0.6) || /^(root|armature|rig)$/i.test(o.name)
    if (carries_all || wheels.size === 1) { carriers.push({ name: o.name, wheel: carries_all ? -1 : [...wheels][0], root: carries_all, ...rest(o) }); named.add(o.name) }
  })
  const nw = drivers.filter(d => d.role.role === 'wheel').length; const nm = drivers.filter(d => d.role.role === 'mech').length
  const note = `${nw} wheel(s), ${nm} moving part(s)` + (clips.length > 0 ? `, ${clips.length} animation(s)` : ', animations made for these parts') + (named_front ? '' : ' · front not named: check the arrow')
  return { drivers, pts, drv: Int32Array.from(D), C, size, min: box.min.clone(), clips, carriers, note }
}

/**
 * Files often show the vehicle on a stand / road / bridge. Keep the vehicle: drop a big flat sheet at the
 * bottom, then group meshes by touching boxes and keep the group with the most vertices.
 */
function drop_scenery (meshes: THREE.Mesh[]): void {
  if (meshes.length < 2) return
  const boxes = meshes.map(m => new THREE.Box3().setFromObject(m))
  const all = new THREE.Box3(); boxes.forEach(b => all.union(b)); const A = all.getSize(new THREE.Vector3())
  const cnt = meshes.map(m => m.geometry.getAttribute('position').count)
  const keep = meshes.map((_m, i) => i).filter(i => { const z = boxes[i].getSize(new THREE.Vector3()); return !(z.y < 0.02 * Math.max(z.x, z.z) && boxes[i].max.y <= all.min.y + A.y * 0.05 && z.x * z.z > A.x * A.z * 0.25) })
  const parent = new Map<number, number>(); keep.forEach(i => parent.set(i, i))
  const find = (a: number): number => { while (parent.get(a) !== a) a = parent.get(a)!; return a }
  const grow = A.length() * 0.005
  for (let a = 0; a < keep.length; a++) for (let b = a + 1; b < keep.length; b++) if (boxes[keep[a]].clone().expandByScalar(grow).intersectsBox(boxes[keep[b]])) parent.set(find(keep[a]), find(keep[b]))
  const w = new Map<number, number>(); keep.forEach(i => { const r = find(i); w.set(r, (w.get(r) ?? 0) + cnt[i]) })
  let best = -1; let bw = -1; w.forEach((v, r) => { if (v > bw) { bw = v; best = r } })
  // the vehicle group, plus any small group touching its box (a mirror, an antenna)
  const vb = new THREE.Box3(); keep.forEach(i => { if (find(i) === best) vb.union(boxes[i]) })
  const vs = vb.getSize(new THREE.Vector3())
  const stay = new Set(keep.filter(i => find(i) === best || (vb.clone().expandByScalar(vs.length() * 0.02).containsBox(boxes[i]))))
  for (let i = meshes.length - 1; i >= 0; i--) if (!stay.has(i)) meshes.splice(i, 1)
}

/** for every target point (normalized 0..1, xyz packed) the nearest source driver */
export function nearest_drivers (src: CloneSource, tgt: Float32Array): Int32Array {
  const G = 24; const cells = new Map<number, number[]>()
  const key = (x: number, y: number, z: number): number => (x * G + y) * G + z
  const cell = (u: number): number => Math.min(G - 1, Math.max(0, Math.floor(u * G)))
  const n = src.pts.length / 3
  for (let i = 0; i < n; i++) { const k = key(cell(src.pts[i * 3]), cell(src.pts[i * 3 + 1]), cell(src.pts[i * 3 + 2])); let a = cells.get(k); if (a === undefined) { a = []; cells.set(k, a) } a.push(i) }
  const out = new Int32Array(tgt.length / 3).fill(-1)
  for (let t = 0; t < out.length; t++) {
    const x = tgt[t * 3]; const y = tgt[t * 3 + 1]; const z = tgt[t * 3 + 2]
    const cx = cell(x); const cy = cell(y); const cz = cell(z)
    let best = -1; let bd = Infinity
    for (let r = 0; r < G; r++) {
      for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) for (let k = cz - r; k <= cz + r; k++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy), Math.abs(k - cz)) !== r) continue
        const a = cells.get(key(i, j, k)); if (a === undefined) continue
        for (const s of a) { const dx = src.pts[s * 3] - x; const dy = src.pts[s * 3 + 1] - y; const dz = src.pts[s * 3 + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = s } }
      }
      // every point of ring r+1 is at least r cells away
      if (best >= 0 && bd <= (r / G) * (r / G)) break
    }
    out[t] = best >= 0 ? src.drv[best] : -1
  }
  return out
}

/**
 * The source clips on the target bones. `target(name)` gives the target bone name for a source node and its
 * rest position (local), or null to skip that node. `k` = target size / source size.
 */
export function retarget_clips (src: CloneSource, target: (node: string, prop: string) => Array<{ bone: string, rest: THREE.Vector3 }>, k: number): THREE.AnimationClip[] {
  const restOf = new Map<string, { q0: THREE.Quaternion, p0: THREE.Vector3, P: THREE.Quaternion, Pm: THREE.Matrix3 }>()
  src.drivers.forEach(d => restOf.set(d.name, d)); src.carriers.forEach(c => restOf.set(c.name, c))
  const C = src.C; const Ci = C.clone().invert()
  const out: THREE.AnimationClip[] = []
  for (const clip of src.clips) {
    const tracks: THREE.KeyframeTrack[] = []
    for (const tr of clip.tracks) {
      const pb = THREE.PropertyBinding.parseTrackName(tr.name)
      const r = restOf.get(pb.nodeName); if (r === undefined) continue
      for (const tg of target(pb.nodeName, pb.propertyName)) {
      if (pb.propertyName === 'quaternion') {
        // the clip's first frame is the rest when the file's own rest pose is far from it (Sketchfab exports)
        const qf = new THREE.Quaternion().fromArray(tr.values, 0)
        const q0i = (qf.angleTo(r.q0) > 0.35 ? qf : r.q0).clone().invert()
        const v = new Float32Array(tr.values.length); const q = new THREE.Quaternion(); const Pi = r.P.clone().invert()
        for (let i = 0; i < tr.values.length; i += 4) {
          q.fromArray(tr.values, i)
          // rotation of the part relative to its rest, seen in the parent's rest frame, then in the target frame
          const d = r.P.clone().multiply(q).multiply(q0i).multiply(Pi)
          const t = C.clone().multiply(d).multiply(Ci).normalize()
          t.toArray(v, i)
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${tg.bone}.quaternion`, Array.from(tr.times), Array.from(v)))
      } else if (pb.propertyName === 'position') {
        const v = new Float32Array(tr.values.length); const p = new THREE.Vector3()
        const pf = new THREE.Vector3().fromArray(tr.values, 0); const p0 = pf.distanceTo(r.p0) > src.size.length() * 0.1 / Math.max(1e-9, new THREE.Vector3().setFromMatrix3Column(r.Pm, 0).length()) ? pf : r.p0
        for (let i = 0; i < tr.values.length; i += 3) {
          p.fromArray(tr.values, i).sub(p0).applyMatrix3(r.Pm).applyQuaternion(C).multiplyScalar(k).add(tg.rest)
          p.toArray(v, i)
        }
        tracks.push(new THREE.VectorKeyframeTrack(`${tg.bone}.position`, Array.from(tr.times), Array.from(v)))
      }
      }
    }
    if (tracks.length > 0) out.push(new THREE.AnimationClip(`SRC_${clip.name.replace(/[^\w-]+/g, '_')}`, clip.duration, tracks))
  }
  return out
}
