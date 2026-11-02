/*
 * Rig + animations from a file: drop a rigged, animated model (a crocodile that already walks, a Mixamo
 * character…). Its mesh is thrown away; its skeleton is fitted into YOUR model, your model is skinned to it
 * (Greenbox cage weights work with any skeleton), and its animations play on your model.
 *
 *   fit        the source mesh's box is mapped onto your model's box (one uniform scale, feet on feet, centre on
 *              centre); the armature's own transform (FBX Z-up, a scaled Blender export) is baked into the
 *              top bones, so the skeleton handed to the joint editor has a plain identity armature
 *   clips      quaternion tracks keep the motion; position tracks are moved by the same transform, then shifted
 *              from the source rest pose to your edited joints (a joint you moved keeps its new place while it
 *              moves like the original); scale tracks are kept
 *   library    every file you use is saved in the browser ("my rigs"), to give the same rig + moves to other models
 */
import * as THREE from 'three'
import { model_geometries } from './ModelAnalyzer.ts'
import { points_of, body_frame, thicker_end, landmarks, tps } from './CloneFit.ts'

interface RestInfo { pos: THREE.Vector3 }
export const CUSTOM_RIG = {
  active: false,
  name: '',
  clips: [] as THREE.AnimationClip[],
  /** per bone name: local position in the fitted armature before any joint was moved */
  rest: new Map<string, RestInfo>(),
  /** names of the top bones (their tracks are in armature space) */
  top: new Set<string>(),
  /** the armature transform baked into the top bones: world = T + G * R * v */
  R: new THREE.Quaternion(), G: 1, T: new THREE.Vector3(),
  /** the bones of the final skin (set by the rig page) */
  final_bones: (): THREE.Bone[] => []
}

export const CLONE_FIT = { flip: false, warp: true, note: '', pairs: [] as Array<[number[], number[]]> }

/**
 * bones only: a clean copy of the armature, fitted into your model. With the model given (`model`): turned to
 * face the same way, scaled by the body lengths and warped onto its middle line and feet (CloneFit). Without it:
 * the rig file's body box is mapped onto `target`.
 */
export function prepare_custom_armature (scene: THREE.Object3D, clips: THREE.AnimationClip[], target: THREE.Box3, name: string, model?: THREE.Object3D): THREE.Object3D | null {
  scene.updateMatrixWorld(true)
  let first: THREE.Bone | null = null
  scene.traverse(o => { if (first === null && (o as THREE.Bone).isBone === true) first = o as THREE.Bone })
  if (first === null) return null
  const fb = first as THREE.Bone
  const A = fb.parent ?? fb
  // the source "meat": its box decides the fit (bones alone are smaller than the body)
  const src = new THREE.Box3()
  scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) src.expandByObject(m) })
  if (src.isEmpty()) { A.traverse(o => { if ((o as THREE.Bone).isBone === true) src.expandByPoint(o.getWorldPosition(new THREE.Vector3())) }) }
  const ss = src.getSize(new THREE.Vector3()); const ts = target.getSize(new THREE.Vector3())
  const k = ss.y > 1e-6 && ts.y > 1e-6 ? ts.y / ss.y : Math.max(ts.x, ts.y, ts.z) / Math.max(1e-6, ss.x, ss.y, ss.z)
  // W: source world -> your model (scale k around the bottom centre, then move onto the target's bottom centre)
  const sb = new THREE.Vector3((src.min.x + src.max.x) / 2, src.min.y, (src.min.z + src.max.z) / 2)
  const tb = new THREE.Vector3((target.min.x + target.max.x) / 2, target.min.y, (target.min.z + target.max.z) / 2)
  let W = new THREE.Matrix4().makeTranslation(tb.x, tb.y, tb.z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-sb.x, -sb.y, -sb.z))
  // ---- a different body: face the same way, same length, then warp (CloneFit) ----
  let warp: ((p: THREE.Vector3) => THREE.Vector3) | null = null
  CLONE_FIT.note = ''
  if (model !== undefined) {
    try {
      const sg = model_geometries(scene); const tg = model_geometries(model)
      const sp = points_of(sg); const tp = points_of(tg)
      // the rig file knows where its head is
      let headb: THREE.Object3D | null = null
      for (const re of [/^head(?!.*(leaf|end|top))/i, /head(?!.*(leaf|end|top))/i, /jaw/i, /neck/i]) { if (headb !== null) break; scene.traverse(o => { if (headb === null && (o as THREE.Bone).isBone === true && re.test(o.name)) headb = o }) }
      const sc = new THREE.Vector3(); sp.forEach(p => sc.add(p)); sc.divideScalar(Math.max(1, sp.length))
      const hpos = headb !== null ? (headb as THREE.Object3D).getWorldPosition(new THREE.Vector3()) : null
      const sf = body_frame(sp, f => hpos !== null ? hpos.clone().sub(sc).dot(f) : thicker_end(sp, f))
      // your model: small separate parts near one end (eyes, teeth) mark the head; else the thicker end
      const tc = new THREE.Vector3(); tp.forEach(p => tc.add(p)); tc.divideScalar(Math.max(1, tp.length))
      const sizes = tg.map(g => g.getAttribute('position').count); const big = Math.max(...sizes)
      const small = tg.filter((g, i) => sizes[i] < big * 0.5 && tg.length > 1)
      const tf = body_frame(tp, f => {
        let v = 0; let used = false
        for (const g of small) { const q = points_of([g], 300); const m = new THREE.Vector3(); q.forEach(p => m.add(p)); m.divideScalar(Math.max(1, q.length)); const d = m.clone().sub(tc).dot(f); v += Math.sign(d) * q.length; used = true }
        const r = used && v !== 0 ? v : thicker_end(tp, f)
        return CLONE_FIT.flip ? -r : r
      })
      // rigid: turn around Y so the forward axes meet, scale by the lengths, bottom centre on bottom centre
      const yaw = Math.atan2(sf.f.z, sf.f.x) - Math.atan2(tf.f.z, tf.f.x)
      const kk = tf.L / Math.max(1e-6, sf.L)
      W = new THREE.Matrix4().makeTranslation(tf.c.x, tf.c.y, tf.c.z).multiply(new THREE.Matrix4().makeScale(kk, kk, kk)).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeTranslation(-sf.c.x, -sf.c.y, -sf.c.z))
      if (CLONE_FIT.warp) {
        const lm = landmarks(sp, sg, sf, tp, tg, tf)
        const src = lm.src.map(p => p.clone().applyMatrix4(W))
        warp = tps(src, lm.dst)
        CLONE_FIT.pairs = src.map((p, i) => [p.toArray().map(v => +v.toFixed(2)), lm.dst[i].toArray().map(v => +v.toFixed(2))])
        CLONE_FIT.note = lm.note
      }
    } catch (e) { console.warn('Greenbox clone fit:', e) }
  }
  const WA = W.clone().multiply(A === fb ? new THREE.Matrix4() : A.matrixWorld)
  const T = new THREE.Vector3(); const R = new THREE.Quaternion(); const S = new THREE.Vector3(); WA.decompose(T, R, S)
  const G = (Math.abs(S.x) + Math.abs(S.y) + Math.abs(S.z)) / 3
  // copy the bone tree (no meshes), baking WA
  const arm = new THREE.Object3D(); arm.name = 'Custom rig'
  CUSTOM_RIG.rest.clear(); CUSTOM_RIG.top.clear()
  const copy = (b: THREE.Bone, top: boolean): THREE.Bone => {
    const n = new THREE.Bone(); n.name = b.name
    if (top) { n.position.copy(b.position).applyQuaternion(R).multiplyScalar(G).add(T); n.quaternion.copy(R).multiply(b.quaternion); CUSTOM_RIG.top.add(b.name) } else { n.position.copy(b.position).multiplyScalar(G); n.quaternion.copy(b.quaternion) }
    n.scale.copy(b.scale)
    CUSTOM_RIG.rest.set(b.name, { pos: n.position.clone() })
    b.children.forEach(c => { if ((c as THREE.Bone).isBone === true) n.add(copy(c as THREE.Bone, false)) })
    return n
  }
  const tops = A === fb ? [fb] : A.children.filter(c => (c as THREE.Bone).isBone === true) as THREE.Bone[]
  tops.forEach(t => arm.add(copy(t, true)))
  arm.updateMatrixWorld(true)
  if (warp !== null) {
    // every joint to its warped place, parents first (rotations kept)
    const order: THREE.Bone[] = []; arm.traverse(o => { if ((o as THREE.Bone).isBone === true) order.push(o as THREE.Bone) })
    const want = new Map(order.map(b => [b, warp!(b.getWorldPosition(new THREE.Vector3()))]))
    for (const b of order) { const p = b.parent ?? arm; p.updateMatrixWorld(true); b.position.copy(p.worldToLocal(want.get(b)!.clone())); b.updateMatrixWorld(true) }
  }
  CUSTOM_RIG.active = true; CUSTOM_RIG.name = name; CUSTOM_RIG.clips = clips; CUSTOM_RIG.R.copy(R); CUSTOM_RIG.G = G; CUSTOM_RIG.T.copy(T)
  return arm
}

/** the source clips, moved onto the fitted (and edited) skeleton */
export function custom_clips (): THREE.AnimationClip[] {
  const by = new Map(CUSTOM_RIG.final_bones().map(b => [b.name, b]))
  const { R, G, T } = CUSTOM_RIG
  return CUSTOM_RIG.clips.map(c => {
    const tracks: THREE.KeyframeTrack[] = []
    for (const tr of c.tracks) {
      const dot = tr.name.lastIndexOf('.'); const bone = tr.name.slice(0, dot); const prop = tr.name.slice(dot + 1)
      const top = CUSTOM_RIG.top.has(bone); const v = Float32Array.from(tr.values as ArrayLike<number>)
      if (prop === 'quaternion' && top) {
        const q = new THREE.Quaternion(); for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i); q.premultiply(R); q.toArray(v, i) }
      } else if (prop === 'position') {
        const rest = CUSTOM_RIG.rest.get(bone)?.pos; const now = by.get(bone)?.position
        const p = new THREE.Vector3()
        for (let i = 0; i < v.length; i += 3) {
          p.fromArray(v, i)
          if (top) p.applyQuaternion(R).multiplyScalar(G).add(T); else p.multiplyScalar(G)
          // the joint may have been moved to fit your model: keep the motion, not the old place
          if (rest !== undefined && now !== undefined) p.sub(rest).add(now)
          p.toArray(v, i)
        }
      }
      const K = tr.constructor as new (n: string, t: ArrayLike<number>, v: ArrayLike<number>) => THREE.KeyframeTrack
      tracks.push(new K(tr.name, tr.times, v))
    }
    return new THREE.AnimationClip(c.name !== '' ? c.name : 'animation', c.duration, tracks)
  })
}

/* ---------------- my rigs (kept in the browser) ---------------- */
const DB = 'gb-rigs'
function db (): Promise<IDBDatabase> { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
export async function save_rig_file (name: string, buf: ArrayBuffer): Promise<void> { try { const d = await db(); d.transaction('f', 'readwrite').objectStore('f').put(buf, name) } catch { /* private mode */ } }
export async function list_rig_files (): Promise<string[]> { try { const d = await db(); return await new Promise(res => { const r = d.transaction('f').objectStore('f').getAllKeys(); r.onsuccess = () => res(r.result.map(String)); r.onerror = () => res([]) }) } catch { return [] } }
export async function get_rig_file (name: string): Promise<ArrayBuffer | null> { try { const d = await db(); return await new Promise(res => { const r = d.transaction('f').objectStore('f').get(name); r.onsuccess = () => res((r.result as ArrayBuffer | undefined) ?? null); r.onerror = () => res(null) }) } catch { return null } }
export async function delete_rig_file (name: string): Promise<void> { try { const d = await db(); d.transaction('f', 'readwrite').objectStore('f').delete(name) } catch { /* ignore */ } }
