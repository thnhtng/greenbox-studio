/*
 * MediaPipe landmarks -> a skeletal AnimationClip for any humanoid rig
 * (Greenbox / Unreal names, Mixamo, Rigify DEF-, VRoid…).
 *
 * Torso, chest and head get a full orientation from three landmarks each (no twist guessing); arms and legs
 * swing their rest direction onto the tracked direction, parent first, so twist stays where the rig had it.
 * Hips height comes from keeping the lowest foot on the floor; sideways travel and jumps from the 2D track.
 */
import * as THREE from 'three'
import { type PoseFrame, LM } from './PoseTracker.ts'

type Slot = 'hips' | 'spine1' | 'spine2' | 'chest' | 'neck' | 'head' |
  'shoulder_l' | 'upperarm_l' | 'forearm_l' | 'hand_l' | 'thigh_l' | 'calf_l' | 'foot_l' |
  'shoulder_r' | 'upperarm_r' | 'forearm_r' | 'hand_r' | 'thigh_r' | 'calf_r' | 'foot_r'

const norm = (n: string): string => n.toLowerCase().replace(/^.*:/, '').replace(/^mixamorig_?/, '').replace(/^def[-_]/, '').replace(/[\s_.-]/g, '')

/** candidate names per slot (normalised: lower case, no separators, no mixamorig:/DEF- prefix) */
const NAMES: Record<Slot, string[]> = {
  hips: ['pelvis', 'hips', 'hip', 'spine', 'jbipchips', 'root'],
  spine1: ['spine01', 'spine', 'spine001', 'jbipcspine'],
  spine2: ['spine02', 'spine1', 'spine002', 'jbipcchest'],
  chest: ['spine03', 'spine2', 'spine003', 'chest', 'upperchest', 'jbipcupperchest'],
  neck: ['neck01', 'neck', 'spine004', 'jbipcneck'],
  head: ['head', 'spine006', 'jbipchead'],
  shoulder_l: ['claviclel', 'leftshoulder', 'shoulderl', 'jbiplshoulder'],
  upperarm_l: ['upperarml', 'leftarm', 'upperarml', 'jbiplupperarm'],
  forearm_l: ['lowerarml', 'leftforearm', 'forearml', 'jbipllowerarm'],
  hand_l: ['handl', 'lefthand', 'jbiplhand'],
  thigh_l: ['thighl', 'leftupleg', 'jbiplupperleg'],
  calf_l: ['calfl', 'leftleg', 'shinl', 'jbipllowerleg'],
  foot_l: ['footl', 'leftfoot', 'jbiplfoot'],
  shoulder_r: ['clavicler', 'rightshoulder', 'shoulderr', 'jbiprshoulder'],
  upperarm_r: ['upperarmr', 'rightarm', 'jbiprupperarm'],
  forearm_r: ['lowerarmr', 'rightforearm', 'forearmr', 'jbiprlowerarm'],
  hand_r: ['handr', 'righthand', 'jbiprhand'],
  thigh_r: ['thighr', 'rightupleg', 'jbiprupperleg'],
  calf_r: ['calfr', 'rightleg', 'shinr', 'jbiprlowerleg'],
  foot_r: ['footr', 'rightfoot', 'jbiprfoot']
}

export interface Rig { root: THREE.Object3D, bones: THREE.Bone[], slot: Partial<Record<Slot, THREE.Bone>> }

export function find_rig (root: THREE.Object3D): Rig {
  const bones: THREE.Bone[] = []
  root.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone) })
  const by = new Map<string, THREE.Bone>()
  bones.forEach(b => { const k = norm(b.name); if (!by.has(k)) by.set(k, b) })
  const slot: Partial<Record<Slot, THREE.Bone>> = {}
  const used = new Set<THREE.Bone>()
  ;(Object.keys(NAMES) as Slot[]).forEach(s => {
    for (const n of NAMES[s]) { const b = by.get(n); if (b !== undefined && !used.has(b)) { slot[s] = b; used.add(b); break } }
  })
  return { root, bones, slot }
}

export interface RetargetOptions { fps: number, smooth: number, in_place: boolean, image_aspect: number, back_view?: boolean }

/** MediaPipe left/right landmark pairs */
const PAIRS: Array<[number, number]> = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]
/** the person has their back to the camera: the tracker labels them as facing it, so swap sides and turn around */
function from_behind (frames: PoseFrame[]): PoseFrame[] {
  const swap = (a: Float32Array, k: number): Float32Array => {
    const o = a.slice()
    PAIRS.forEach(([l, r]) => { for (let c = 0; c < k; c++) { o[l * k + c] = a[r * k + c]; o[r * k + c] = a[l * k + c] } })
    return o
  }
  return frames.map(f => {
    if (f.world === null) return f
    const w = swap(f.world, 3); for (let i = 0; i < 33; i++) { w[i * 3] = -w[i * 3]; w[i * 3 + 2] = -w[i * 3 + 2] }
    return { t: f.t, world: w, img: f.img === null ? null : swap(f.img, 2), vis: f.vis }
  })
}

/** gaussian smoothing of every landmark coordinate over time; frames without a person reuse their neighbours */
function smooth_frames (frames: PoseFrame[], sigma: number): PoseFrame[] {
  const n = frames.length
  let last: PoseFrame | null = null
  const filled = frames.map(f => { if (f.world !== null) last = f; return last ?? f })
  const firstGood = filled.find(f => f.world !== null)
  const ok = filled.map(f => (f.world !== null ? f : firstGood) ?? f)
  if (sigma <= 0.01 || firstGood === undefined) return ok
  const R = Math.ceil(sigma * 2.5)
  const w: number[] = []; for (let k = -R; k <= R; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)))
  const blur = (get: (f: PoseFrame) => Float32Array | null, len: number, i: number): Float32Array => {
    const out = new Float32Array(len); let ws = 0
    for (let k = -R; k <= R; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k)); const a = get(ok[j]); if (a === null) continue
      const wk = w[k + R]; ws += wk
      for (let c = 0; c < len; c++) out[c] += a[c] * wk
    }
    for (let c = 0; c < len; c++) out[c] /= Math.max(1e-9, ws)
    return out
  }
  return ok.map((f, i) => ({ t: frames[i].t, world: f.world === null ? null : blur(x => x.world, 99, i), img: f.img === null ? null : blur(x => x.img, 66, i), vis: f.vis }))
}

const P = (a: Float32Array, i: number): THREE.Vector3 => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])
const mid = (a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 => a.clone().add(b).multiplyScalar(0.5)

/** rotation that maps the frame (x, up) of `rest` onto the frame (x, up) of `now` */
function frame_quat (x: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const X = x.clone().normalize()
  const Y = up.clone().sub(X.clone().multiplyScalar(up.dot(X))).normalize()
  const Z = new THREE.Vector3().crossVectors(X, Y)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z))
}
function delta (rest_x: THREE.Vector3, rest_up: THREE.Vector3, x: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  return frame_quat(x, up).multiply(frame_quat(rest_x, rest_up).invert())
}

export function landmarks_to_clip (frames_in: PoseFrame[], rig: Rig, opt: RetargetOptions, name = 'Video_Mocap'): THREE.AnimationClip {
  const frames = smooth_frames(opt.back_view === true ? from_behind(frames_in) : frames_in, opt.smooth)
  const S = rig.slot
  const root = rig.root
  root.updateMatrixWorld(true)
  // ---- rest pose data ----
  const restW = new Map<THREE.Bone, THREE.Quaternion>(); const restP = new Map<THREE.Bone, THREE.Vector3>(); const restL = new Map<THREE.Bone, THREE.Quaternion>()
  rig.bones.forEach(b => { restW.set(b, b.getWorldQuaternion(new THREE.Quaternion())); restP.set(b, b.getWorldPosition(new THREE.Vector3())); restL.set(b, b.quaternion.clone()) })
  const rp = (s: Slot): THREE.Vector3 | null => S[s] !== undefined ? restP.get(S[s]!)!.clone() : null
  const rootQ = new THREE.Quaternion() // the model is shown upright facing +Z, the same space as the landmarks
  const parent_world = (b: THREE.Object3D, W: Map<THREE.Bone, THREE.Quaternion>): THREE.Quaternion => {
    const p = b.parent; if (p === null) return new THREE.Quaternion()
    if ((p as THREE.Bone).isBone && W.has(p as THREE.Bone)) return W.get(p as THREE.Bone)!.clone()
    return p.getWorldQuaternion(new THREE.Quaternion())
  }
  const RX = (a: Slot, b: Slot): THREE.Vector3 => (rp(a) !== null && rp(b) !== null ? rp(a)!.sub(rp(b)!) : new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ))
  const UP = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ)
  const rest_hips_x = RX('thigh_l', 'thigh_r'); const rest_chest_x = RX('upperarm_l', 'upperarm_r')
  const rest_torso_up = rp('neck') !== null && rp('hips') !== null ? rp('neck')!.sub(rp('hips')!) : UP.clone()
  const rest_head_x = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ)
  const rest_head_up = rp('head') !== null && rp('neck') !== null ? rp('head')!.sub(rp('neck')!) : UP.clone()
  // the child joint each limb aims at, in the rest pose
  const AIM: Array<[Slot, Slot | null, number, number]> = [
    ['upperarm_l', 'forearm_l', LM.shoulder_l, LM.elbow_l], ['forearm_l', 'hand_l', LM.elbow_l, LM.wrist_l], ['hand_l', null, LM.wrist_l, -1],
    ['upperarm_r', 'forearm_r', LM.shoulder_r, LM.elbow_r], ['forearm_r', 'hand_r', LM.elbow_r, LM.wrist_r], ['hand_r', null, LM.wrist_r, -2],
    ['thigh_l', 'calf_l', LM.hip_l, LM.knee_l], ['calf_l', 'foot_l', LM.knee_l, LM.ankle_l], ['foot_l', null, LM.ankle_l, LM.toe_l],
    ['thigh_r', 'calf_r', LM.hip_r, LM.knee_r], ['calf_r', 'foot_r', LM.knee_r, LM.ankle_r], ['foot_r', null, LM.ankle_r, LM.toe_r]
  ]
  const rest_dir = new Map<THREE.Bone, THREE.Vector3>() // in the bone's own rest frame
  AIM.forEach(([s, child]) => {
    const b = S[s]; if (b === undefined) return
    let d: THREE.Vector3 | null = null
    if (child !== null && S[child] !== undefined) d = restP.get(S[child]!)!.clone().sub(restP.get(b)!)
    else { const kid = b.children.find(c => (c as THREE.Bone).isBone) as THREE.Bone | undefined; if (kid !== undefined) d = restP.get(kid)!.clone().sub(restP.get(b)!) }
    if (d === null || d.lengthSq() < 1e-10) return
    rest_dir.set(b, d.normalize().applyQuaternion(restW.get(b)!.clone().invert()))
  })
  const aim_of = new Map<THREE.Bone, [number, number]>()
  AIM.forEach(([s, , a, b]) => { if (S[s] !== undefined) aim_of.set(S[s]!, [a, b]) })
  const slot_of = new Map<THREE.Bone, Slot>(); (Object.keys(S) as Slot[]).forEach(s => slot_of.set(S[s]!, s))

  // ---- scale: rig leg length vs tracked leg length ----
  const leg_rig = (rp('thigh_l') !== null && rp('calf_l') !== null && rp('foot_l') !== null) ? rp('thigh_l')!.distanceTo(rp('calf_l')!) + rp('calf_l')!.distanceTo(rp('foot_l')!) : 0.9
  const legs: number[] = []
  frames.forEach(f => { if (f.world === null) return; const w = f.world; legs.push(P(w, LM.hip_l).distanceTo(P(w, LM.knee_l)) + P(w, LM.knee_l).distanceTo(P(w, LM.ankle_l))) })
  legs.sort((a, b) => a - b)
  const scale = leg_rig / Math.max(1e-3, legs[Math.floor(legs.length / 2)] ?? 0.9)
  const hips_rest = rp('hips') ?? new THREE.Vector3()
  const floor_rest = Math.min(...(['foot_l', 'foot_r'] as Slot[]).map(s => rp(s)?.y ?? hips_rest.y - leg_rig))
  // 2D track for travel + jumps: the ground line is where the feet are lowest in the picture
  const foot2d = frames.map(f => f.img === null ? NaN : Math.max(f.img[LM.heel_l * 2 + 1], f.img[LM.heel_r * 2 + 1], f.img[LM.toe_l * 2 + 1], f.img[LM.toe_r * 2 + 1]))
  const ground2d = Math.max(...foot2d.filter(Number.isFinite))
  const hip2d0 = frames.find(f => f.img !== null)?.img ?? null
  const m_per_img = frames.map(f => {
    if (f.world === null || f.img === null) return NaN
    const d3 = P(f.world, LM.hip_l).distanceTo(P(f.world, LM.shoulder_l)) + P(f.world, LM.hip_r).distanceTo(P(f.world, LM.shoulder_r))
    const d2 = Math.hypot((f.img[LM.hip_l * 2] - f.img[LM.shoulder_l * 2]) * opt.image_aspect, f.img[LM.hip_l * 2 + 1] - f.img[LM.shoulder_l * 2 + 1]) + Math.hypot((f.img[LM.hip_r * 2] - f.img[LM.shoulder_r * 2]) * opt.image_aspect, f.img[LM.hip_r * 2 + 1] - f.img[LM.shoulder_r * 2 + 1])
    return d3 / Math.max(1e-4, d2)
  }).filter(Number.isFinite).sort((a, b) => a - b)
  const mpi = m_per_img[Math.floor(m_per_img.length / 2)] ?? 1

  // ---- tracks ----
  const times: number[] = []
  const qv = new Map<THREE.Bone, number[]>(); rig.bones.forEach(b => qv.set(b, []))
  const hipPos: number[] = []
  const order: THREE.Bone[] = []; root.traverse(o => { if ((o as THREE.Bone).isBone) order.push(o as THREE.Bone) })
  frames.forEach((f, fi) => {
    times.push(fi / opt.fps)
    const W = new Map<THREE.Bone, THREE.Quaternion>()
    if (f.world === null) { order.forEach(b => { W.set(b, restW.get(b)!.clone()) }) } else {
      const w = f.world
      const ls = P(w, LM.shoulder_l); const rs = P(w, LM.shoulder_r); const lh = P(w, LM.hip_l); const rh = P(w, LM.hip_r)
      const torso_up = mid(ls, rs).sub(mid(lh, rh))
      const q_hips = delta(rest_hips_x, rest_torso_up, lh.clone().sub(rh), torso_up)
      const q_chest = delta(rest_chest_x, rest_torso_up, ls.clone().sub(rs), torso_up)
      const ears = mid(P(w, LM.ear_l), P(w, LM.ear_r))
      const q_head = delta(rest_head_x, rest_head_up, P(w, LM.ear_l).sub(P(w, LM.ear_r)), ears.sub(mid(ls, rs)))
      const q_root = rootQ // tracked rotations are in the rig's own space
      const inR = (q: THREE.Quaternion): THREE.Quaternion => q_root.clone().multiply(q).multiply(q_root.clone().invert())
      const qh = inR(q_hips); const qc = inR(q_chest); const qd = inR(q_head)
      order.forEach(b => {
        const s = slot_of.get(b)
        const rw = restW.get(b)!
        const pw = parent_world(b, W)
        let world: THREE.Quaternion
        if (s === 'hips') world = qh.clone().multiply(rw)
        else if (s === 'spine1') world = qh.clone().slerp(qc, 0.33).multiply(rw)
        else if (s === 'spine2') world = qh.clone().slerp(qc, 0.66).multiply(rw)
        else if (s === 'chest') world = qc.clone().multiply(rw)
        else if (s === 'neck') world = qc.clone().slerp(qd, 0.5).multiply(rw)
        else if (s === 'head') world = qd.clone().multiply(rw)
        else if (aim_of.has(b) && rest_dir.has(b)) {
          const w0 = pw.clone().multiply(restL.get(b)!)
          const [a, z] = aim_of.get(b)!
          const from = P(w, a)
          const to = z === -1 ? mid(P(w, LM.index_l), P(w, LM.pinky_l)) : z === -2 ? mid(P(w, LM.index_r), P(w, LM.pinky_r)) : P(w, z)
          const target = to.sub(from).applyQuaternion(q_root)
          const cur = rest_dir.get(b)!.clone().applyQuaternion(w0)
          world = target.lengthSq() > 1e-10 ? new THREE.Quaternion().setFromUnitVectors(cur.normalize(), target.normalize()).multiply(w0) : w0
        } else world = pw.clone().multiply(restL.get(b)!)
        W.set(b, world)
        const local = pw.clone().invert().multiply(world)
        qv.get(b)!.push(local.x, local.y, local.z, local.w)
      })
    }
    if (f.world === null) order.forEach(b => { const q = restL.get(b)!; qv.get(b)!.push(q.x, q.y, q.z, q.w) })
    // hips position: lowest foot on the floor, plus jumps / sideways travel from the 2D track
    if (S.hips !== undefined) {
      let y = hips_rest.y; let x = hips_rest.x; const z = hips_rest.z
      if (f.world !== null) {
        const low = Math.min(P(f.world, LM.heel_l).y, P(f.world, LM.heel_r).y, P(f.world, LM.toe_l).y, P(f.world, LM.toe_r).y, P(f.world, LM.ankle_l).y, P(f.world, LM.ankle_r).y)
        y = floor_rest + (-low) * scale // the hips stand as high above the lowest foot as in the video
        const f2 = foot2d[fi]
        if (Number.isFinite(f2)) y += Math.max(0, (ground2d - f2) * mpi * scale)
        if (!opt.in_place && f.img !== null && hip2d0 !== null) {
          const hx = (f.img[LM.hip_l * 2] + f.img[LM.hip_r * 2]) / 2 - (hip2d0[LM.hip_l * 2] + hip2d0[LM.hip_r * 2]) / 2
          x = hips_rest.x + hx * opt.image_aspect * mpi * scale // the camera faces the person: image right = their left = +X
        }
      }
      const wpos = new THREE.Vector3(x, y, z)
      const par = S.hips.parent
      if (par !== null) par.worldToLocal(wpos)
      hipPos.push(wpos.x, wpos.y, wpos.z)
    }
  })
  const tracks: THREE.KeyframeTrack[] = []
  order.forEach(b => { const v = qv.get(b)!; if (v.length === times.length * 4) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v)) })
  if (S.hips !== undefined && hipPos.length === times.length * 3) tracks.push(new THREE.VectorKeyframeTrack(`${S.hips.name}.position`, times, hipPos))
  return new THREE.AnimationClip(name, times[times.length - 1] ?? 0, tracks)
}
