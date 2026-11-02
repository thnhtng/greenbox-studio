/*
 * Forearm twist bones, the way pro rigs (Rigify, P2M, the Unreal mannequin) avoid the "candy wrapper":
 * when the hand turns, a wrist skinned only to the forearm or only to the hand pinches. A twist bone halfway down
 * the forearm takes half of the hand's turn around the forearm, and the forearm skin is shared between the
 * forearm (at the elbow) and the twist bone (towards the wrist), so the skin turns a little more at every step.
 *
 *   add_twist_bones     before skinning: lowerarm_twist_01_l / _r (Unreal names), child of the forearm, at 55 %
 *   split_twist         after the weights: forearm weight -> forearm / twist by position along the forearm
 *   add_twist_tracks    every animation gets a twist track = half of the hand's twist (swing-twist split)
 * Exported GLB / FBX keep the bone and its track, so engines play it with no constraint.
 */
import * as THREE from 'three'

export const TWIST = { enabled: true, share: 0.5, skeleton: (): THREE.Skeleton | null => null }
const SIDES = ['l', 'r']
export const twist_name = (s: string): string => `lowerarm_twist_01_${s}`

/** add the twist bones to an armature (human names); returns how many */
export function add_twist_bones (root: THREE.Object3D): number {
  if (!TWIST.enabled) return 0
  let n = 0
  for (const s of SIDES) {
    let fore: THREE.Bone | null = null; let hand: THREE.Bone | null = null
    root.traverse(o => { if ((o as THREE.Bone).isBone !== true) return; if (o.name === `lowerarm_${s}`) fore = o as THREE.Bone; if (o.name === `hand_${s}`) hand = o as THREE.Bone })
    if (fore === null || hand === null) continue
    const f = fore as THREE.Bone; const h = hand as THREE.Bone
    if (f.children.some(c => c.name === twist_name(s))) continue
    const t = new THREE.Bone(); t.name = twist_name(s); t.position.copy(h.position).multiplyScalar(0.55)
    f.add(t); n++
  }
  root.updateMatrixWorld(true)
  return n
}

/** share the forearm skin with its twist bone: nothing at the elbow, most of it towards the wrist */
export function split_twist (geo: THREE.BufferGeometry, bones: THREE.Bone[]): number {
  const si = geo.getAttribute('skinIndex'); const sw = geo.getAttribute('skinWeight'); const pos = geo.getAttribute('position')
  if (si === undefined || sw === undefined || pos === undefined) return 0
  const idx = new Map(bones.map((b, i) => [b.name, i])); let n = 0
  if (bones.length > 0) { let r: THREE.Object3D = bones[0]; while (r.parent !== null) r = r.parent; r.updateWorldMatrix(true, true) }
  const line = new THREE.Line3(); const p = new THREE.Vector3()
  for (const s of SIDES) {
    const fi = idx.get(`lowerarm_${s}`); const ti = idx.get(twist_name(s)); const hi = idx.get(`hand_${s}`)
    if (fi === undefined || ti === undefined || hi === undefined) continue
    line.set(bones[fi].getWorldPosition(new THREE.Vector3()), bones[hi].getWorldPosition(new THREE.Vector3()))
    for (let v = 0; v < pos.count; v++) {
      let k = -1; for (let j = 0; j < 4; j++) if (si.getComponent(v, j) === fi && sw.getComponent(v, j) > 0) k = j
      if (k < 0) continue
      p.fromBufferAttribute(pos, v); const t = line.closestPointToPointParameter(p, true)
      const e = Math.min(1, Math.max(0, (t - 0.2) / 0.7)); const share = e * e * (3 - 2 * e) // smoothstep 0.2 .. 0.9
      if (share <= 0.001) continue
      const w = sw.getComponent(v, k)
      // the twist bone takes a free slot (or the weakest one)
      let free = -1; for (let j = 0; j < 4; j++) if (j !== k && (sw.getComponent(v, j) <= 0 || si.getComponent(v, j) === ti)) { free = j; break }
      if (free < 0) { free = (k + 1) % 4; for (let j = 0; j < 4; j++) if (j !== k && sw.getComponent(v, j) < sw.getComponent(v, free)) free = j; const lost = sw.getComponent(v, free); sw.setComponent(v, k, w + lost) }
      const wk = sw.getComponent(v, k); const prev = si.getComponent(v, free) === ti ? sw.getComponent(v, free) : 0
      si.setComponent(v, free, ti); sw.setComponent(v, free, prev + wk * share); sw.setComponent(v, k, wk * (1 - share))
      n++
    }
  }
  if (n > 0) { si.needsUpdate = true; sw.needsUpdate = true }
  return n
}

/** half of the hand's turn around the forearm, as a track on the twist bone (replaces an older one) */
export function add_twist_tracks (clips: THREE.AnimationClip[]): void {
  const sk = TWIST.skeleton(); if (sk === null) return
  const bones = sk.bones
  // the bind pose (the bones themselves may be playing an animation right now)
  const rest_world = (i: number): THREE.Matrix4 => sk.boneInverses[i].clone().invert()
  for (const s of SIDES) {
    const ti = bones.findIndex(b => b.name === twist_name(s)); const hi = bones.findIndex(b => b.name === `hand_${s}`); const fi = bones.findIndex(b => b.name === `lowerarm_${s}`)
    if (ti < 0 || hi < 0 || fi < 0) continue
    const tw = bones[ti]; const hand = bones[hi]
    const local = rest_world(fi).invert().multiply(rest_world(hi)) // hand in forearm space, at rest
    const rp = new THREE.Vector3(); const rq = new THREE.Quaternion(); local.decompose(rp, rq, new THREE.Vector3())
    const axis = rp.normalize() // the forearm's direction in its own space
    const rqi = rq.clone().invert()
    const q = new THREE.Quaternion(); const t = new THREE.Quaternion(); const I = new THREE.Quaternion()
    for (const c of clips) {
      c.tracks = c.tracks.filter(tr => tr.name !== `${tw.name}.quaternion`)
      const ht = c.tracks.find(tr => tr.name === `${hand.name}.quaternion`); if (ht === undefined) continue
      const v = new Float32Array(ht.values.length)
      for (let i = 0; i < v.length; i += 4) {
        // how far the hand turned from its rest, in forearm space; swing-twist: the part around `axis`
        q.fromArray(ht.values as ArrayLike<number> as number[], i).multiply(rqi)
        const d = q.x * axis.x + q.y * axis.y + q.z * axis.z
        t.set(axis.x * d, axis.y * d, axis.z * d, q.w); if (t.lengthSq() < 1e-12) t.identity(); else t.normalize()
        I.identity().slerp(t, TWIST.share).toArray(v, i)
      }
      c.tracks.push(new THREE.QuaternionKeyframeTrack(`${tw.name}.quaternion`, Array.from(ht.times), Array.from(v)))
    }
  }
}
