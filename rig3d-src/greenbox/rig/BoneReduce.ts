/*
 * BoneReduce (Greenbox): fewer bones for hyper-casual characters.
 *
 * The user marks joints "off" while rigging. Nothing changes in the editable skeleton (so turning a joint
 * back on is free). When the skin is computed, the copy of the skeleton used for skinning gets every "off"
 * bone merged into its parent:
 *   - its children are re-parented to the parent without moving,
 *   - its skin goes to the parent (the skin solver simply never sees the bone),
 *   - its animation is baked into its children (rotation composed, and a position track so the child still
 *     swings around the removed joint), so a 3-bone spine turned into 1 still bends the whole way.
 * Leaf bones (finger tips, toes, fingers) are just dropped; their tracks are ignored on export.
 */
import * as THREE from 'three'
import { type AnimationClip, type Bone, type Object3D } from 'three'

/** names of the joints the user turned off (shared by the edit UI, the skin step and the animation step) */
export const BONES_OFF = new Set<string>()

/** joints that must never be removed: the root and the bone that carries root motion */
export const KEEP_ALWAYS = /^(root|pelvis|hips|armature)$/i

interface MergeRecord {
  name: string // removed bone
  parent: string // the bone that took over
  pos: THREE.Vector3 // removed bone local position (in parent space) at merge time
  quat: THREE.Quaternion // removed bone rest rotation
  children: Array<{ name: string, pos: THREE.Vector3, quat: THREE.Quaternion }> // child rest, in the removed bone's space
}

/** merges done on the last skinning skeleton, in order; replayed on the animation clips */
let merges: MergeRecord[] = []

export function can_turn_off (bone: Bone): boolean {
  return !KEEP_ALWAYS.test(bone.name) && bone.parent instanceof THREE.Bone
}

/** merge every "off" bone of this armature copy into its parent (parents first). Returns how many were removed. */
export function merge_off_bones (armature: Object3D): number {
  merges = []
  if (BONES_OFF.size === 0) return 0
  const order: Bone[] = []
  armature.traverse(o => { if (o instanceof THREE.Bone && BONES_OFF.has(o.name) && can_turn_off(o)) order.push(o) })
  for (const x of order) {
    const p = x.parent as Bone
    const rec: MergeRecord = { name: x.name, parent: p.name, pos: x.position.clone(), quat: x.quaternion.clone(), children: [] }
    const kids = x.children.filter((c): c is Bone => c instanceof THREE.Bone)
    for (const c of kids) {
      rec.children.push({ name: c.name, pos: c.position.clone(), quat: c.quaternion.clone() })
      // same place in the world, now hanging from the parent
      c.position.copy(c.position.clone().multiply(x.scale).applyQuaternion(x.quaternion).add(x.position))
      c.quaternion.premultiply(x.quaternion)
      p.add(c)
    }
    x.children.filter(c => !(c instanceof THREE.Bone)).forEach(c => p.attach(c))
    p.remove(x)
    merges.push(rec)
  }
  armature.updateMatrixWorld(true)
  return order.length
}

function track_of (clip: AnimationClip, bone: string, prop: string): THREE.KeyframeTrack | undefined {
  return clip.tracks.find(t => t.name === `${bone}.${prop}`)
}

function sampler (track: THREE.KeyframeTrack | undefined, fallback: number[]): (t: number) => number[] {
  if (track === undefined) return () => fallback
  const it = track.createInterpolant() as THREE.Interpolant
  return (t: number) => Array.from(it.evaluate(t))
}

/** replay the merges on animation clips (in place). Safe to call on clips that were already baked. */
export function bake_clips (clips: AnimationClip[]): void {
  if (merges.length === 0) return
  for (const clip of clips) {
    if ((clip.userData as any)?.gb_reduced === true) continue
    for (const m of merges) {
      const xq = track_of(clip, m.name, 'quaternion')
      const xp = track_of(clip, m.name, 'position') // set when an earlier merge (a chain) baked into this bone
      const sx = sampler(xq, m.quat.toArray())
      const sxp = sampler(xp, m.pos.toArray())
      for (const ch of m.children) {
        const cq = track_of(clip, ch.name, 'quaternion')
        const cp = track_of(clip, ch.name, 'position')
        const sc = sampler(cq, ch.quat.toArray())
        const scp = sampler(cp, ch.pos.toArray())
        const keys = [...new Set([...(xq?.times ?? []), ...(xp?.times ?? []), ...(cq?.times ?? []), ...(cp?.times ?? [])])].sort((a, b) => a - b)
        if (keys.length === 0) continue
        // a product of two rotations does not interpolate like the two did: sample at least 30 times a second
        const times: number[] = []
        for (let i = 0; i < keys.length; i++) {
          times.push(keys[i])
          const next = keys[i + 1]; if (next === undefined) break
          const steps = Math.floor((next - keys[i]) * 30)
          for (let k = 1; k <= steps; k++) times.push(keys[i] + (next - keys[i]) * k / (steps + 1))
        }
        const qv: number[] = []; const pv: number[] = []
        const qx = new THREE.Quaternion(); const qc = new THREE.Quaternion(); const pc = new THREE.Vector3(); const px = new THREE.Vector3()
        for (const t of times) {
          qx.fromArray(sx(t)); qc.fromArray(sc(t)); pc.fromArray(scp(t)); px.fromArray(sxp(t))
          qc.premultiply(qx)
          pc.applyQuaternion(qx).add(px)
          qv.push(qc.x, qc.y, qc.z, qc.w); pv.push(pc.x, pc.y, pc.z)
        }
        clip.tracks = clip.tracks.filter(t => t !== cq && t !== cp)
        clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${ch.name}.quaternion`, times, qv))
        if (xq !== undefined || xp !== undefined) clip.tracks.push(new THREE.VectorKeyframeTrack(`${ch.name}.position`, times, pv))
      }
      clip.tracks = clip.tracks.filter(t => !t.name.startsWith(`${m.name}.`))
    }
    clip.userData = { ...(clip.userData ?? {}), gb_reduced: true }
  }
}

/* ---------------- human presets ---------------- */
export type SpineCount = 3 | 2 | 1
export type FingerMode = 'all' | 'three' | 'mitten' | 'none'

const FINGER = /^(thumb|index|middle|ring|pinky)_/i

/** the joints a human preset turns off (only names present in the skeleton) */
export function human_preset (names: string[], o: { spine: SpineCount, neck: boolean, shoulders: boolean, toes: boolean, fingers: FingerMode }): string[] {
  const off: string[] = []
  const has = (n: string): boolean => names.includes(n)
  if (o.spine <= 2 && has('spine_02')) off.push('spine_02')
  if (o.spine <= 1 && has('spine_03')) off.push('spine_03')
  if (!o.neck) names.filter(n => /^neck/i.test(n)).forEach(n => off.push(n))
  if (!o.shoulders) names.filter(n => /^clavicle/i.test(n)).forEach(n => off.push(n))
  if (!o.toes) names.filter(n => /^(ball|toe)/i.test(n)).forEach(n => off.push(n))
  names.filter(n => FINGER.test(n)).forEach(n => {
    const keep = o.fingers === 'all' ||
      (o.fingers === 'three' && /^(thumb|index|middle)_/i.test(n)) ||
      (o.fingers === 'mitten' && /^(thumb|middle)_01/i.test(n))
    if (!keep) off.push(n)
  })
  return off
}
