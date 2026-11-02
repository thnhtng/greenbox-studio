/*
 * PoseControls (Greenbox): pose the rigged character by hand with an IK / FK switch per arm and leg, the same
 * controls the Blender export gets (sidebar N > Greenbox on the Rigify rig).
 *   FK: rings on shoulder / elbow / wrist (hip / knee / ankle): click one, turn it.
 *   IK: drag the box at the hand / foot, the elbow / knee bends by itself; the small ball sets which way it bends.
 * Switching keeps the pose. While posing, the animation list stops driving the bones.
 */
import * as THREE from 'three'
import { type Bone } from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { type Mesh2MotionEngine } from '../../Mesh2MotionEngine.ts'

export type Limb = 'arm.L' | 'arm.R' | 'leg.L' | 'leg.R'
export type LimbMode = 'IK' | 'FK'
export const LIMBS: Limb[] = ['arm.L', 'arm.R', 'leg.L', 'leg.R']
const CHAIN: Record<Limb, [string, string, string]> = {
  'arm.L': ['upperarm_l', 'lowerarm_l', 'hand_l'],
  'arm.R': ['upperarm_r', 'lowerarm_r', 'hand_r'],
  'leg.L': ['thigh_l', 'calf_l', 'foot_l'],
  'leg.R': ['thigh_r', 'calf_r', 'foot_r']
}

const W = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3())
const WQ = (o: THREE.Object3D): THREE.Quaternion => o.getWorldQuaternion(new THREE.Quaternion())

/** turn bone `b` (in world space) by `q` */
function rotate_world (b: THREE.Object3D, q: THREE.Quaternion): void {
  const parent = b.parent !== null ? WQ(b.parent) : new THREE.Quaternion()
  const world = q.clone().multiply(WQ(b))
  b.quaternion.copy(parent.invert().multiply(world))
  b.updateMatrixWorld(true)
}

/** give bone `b` this world rotation */
function set_world_quat (b: THREE.Object3D, q: THREE.Quaternion): void {
  const parent = b.parent !== null ? WQ(b.parent) : new THREE.Quaternion()
  b.quaternion.copy(parent.invert().multiply(q))
  b.updateMatrixWorld(true)
}

interface LimbRig { a: Bone, b: Bone, c: Bone, target: THREE.Mesh, pole: THREE.Mesh, rings: THREE.Mesh[] }

export class PoseControls {
  public modes: Record<Limb, LimbMode> = { 'arm.L': 'FK', 'arm.R': 'FK', 'leg.L': 'IK', 'leg.R': 'IK' }
  public active = false
  public touched = false // the user changed the pose: export it as "Greenbox_Pose"
  public on_change: (() => void) | null = null
  private gizmo: TransformControls | null = null
  private helper: THREE.Object3D | null = null
  private readonly group = new THREE.Group()
  private limbs = new Map<Limb, LimbRig>()
  private attached: { kind: 'target' | 'pole' | 'fk', limb: Limb, bone?: Bone } | null = null
  private handle_mode: 'translate' | 'rotate' = 'translate'
  private down: ((e: PointerEvent) => void) | null = null

  constructor (private readonly engine: Mesh2MotionEngine) { this.group.name = 'Greenbox pose controls' }

  private bones (): Map<string, Bone> {
    const m = new Map<string, Bone>()
    const sk = this.engine.animations_listing_step.active_skinned_meshes()[0]?.skeleton
    sk?.bones.forEach(b => m.set(b.name, b))
    return m
  }

  public available (): boolean { const m = this.bones(); return LIMBS.some(l => CHAIN[l].every(n => m.has(n))) }

  /* ---------------- on / off ---------------- */
  public enter (): void {
    if (this.active) return
    const B = this.bones()
    this.active = true
    this.engine.animations_listing_step.pose_hold = true
    this.engine.scene.add(this.group)
    const cam = this.engine.camera; const dom = this.engine.renderer.domElement
    if (this.gizmo === null) {
      this.gizmo = new TransformControls(cam, dom)
      this.gizmo.setSize(0.8)
      this.gizmo.setSpace('local')
      this.helper = (this.gizmo as any).getHelper?.() ?? this.gizmo
      this.gizmo.addEventListener('dragging-changed', (e: any) => { this.engine.enable_orbit_controls(!(e.value as boolean)) })
      this.gizmo.addEventListener('objectChange', () => this.on_drag())
    }
    if (this.helper !== null) this.engine.scene.add(this.helper)
    this.gizmo.enabled = true
    // the skin's size sets the handle size
    const box = new THREE.Box3(); this.engine.animations_listing_step.active_skinned_meshes().forEach(m => box.expandByObject(m))
    const H = Math.max(0.01, box.getSize(new THREE.Vector3()).y)
    this.limbs.clear(); this.group.clear()
    for (const l of LIMBS) {
      const [an, bn, cn] = CHAIN[l]; const a = B.get(an); const b = B.get(bn); const c = B.get(cn)
      if (a === undefined || b === undefined || c === undefined) continue
      const arm = l.startsWith('arm')
      const col = arm ? 0x3cdc8c : 0x4fa3ff
      const target = new THREE.Mesh(new THREE.BoxGeometry(H * 0.05, H * 0.05, H * 0.05), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.85 }))
      target.renderOrder = 20; target.userData = { gb: 'target', limb: l }
      const pole = new THREE.Mesh(new THREE.SphereGeometry(H * 0.018, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false }))
      pole.renderOrder = 20; pole.userData = { gb: 'pole', limb: l }
      const rings = [a, b, c].map(bone => {
        const r = new THREE.Mesh(new THREE.TorusGeometry(H * (arm ? 0.035 : 0.045), H * 0.005, 6, 32), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.9 }))
        r.renderOrder = 20; r.userData = { gb: 'fk', limb: l, bone }
        return r
      })
      this.group.add(target, pole, ...rings)
      this.limbs.set(l, { a, b, c, target, pole, rings })
      this.snap_ik(l)
    }
    this.refresh()
    this.down = (e: PointerEvent) => this.pointer(e)
    dom.addEventListener('pointerdown', this.down, true)
  }

  public exit (): void {
    if (!this.active) return
    this.active = false
    this.gizmo?.detach(); if (this.gizmo !== null) this.gizmo.enabled = false
    if (this.helper !== null) this.engine.scene.remove(this.helper)
    this.engine.scene.remove(this.group)
    if (this.down !== null) this.engine.renderer.domElement.removeEventListener('pointerdown', this.down, true)
    this.engine.enable_orbit_controls(true)
    this.engine.animations_listing_step.pose_hold = false
    this.attached = null
  }

  /* ---------------- modes ---------------- */
  public set_mode (l: Limb, m: LimbMode): void {
    if (this.modes[l] === m) return
    if (m === 'IK') this.snap_ik(l) // the box jumps to where the hand / foot is now: nothing moves
    this.modes[l] = m
    if (this.attached?.limb === l) { this.gizmo?.detach(); this.attached = null }
    this.refresh()
    this.on_change?.()
  }

  public set_handle_mode (m: 'translate' | 'rotate'): void {
    this.handle_mode = m
    if (this.attached?.kind === 'target') this.gizmo?.setMode(m)
  }

  /** back to the rest pose (T-pose) */
  public reset (): void {
    this.engine.animations_listing_step.active_skinned_meshes().forEach(m => m.skeleton.pose())
    LIMBS.forEach(l => this.snap_ik(l)); this.refresh(); this.touched = true
  }

  /** IK box on the hand / foot, pole ball in front of the elbow / behind the knee */
  private snap_ik (l: Limb): void {
    const r = this.limbs.get(l); if (r === undefined) return
    r.a.updateMatrixWorld(true)
    r.target.position.copy(W(r.c)); r.target.quaternion.copy(WQ(r.c))
    const A = W(r.a); const B = W(r.b); const C = W(r.c)
    const ac = C.clone().sub(A); const mid = A.clone().addScaledVector(ac, 0.5)
    let bend = B.clone().sub(mid); bend.sub(ac.clone().normalize().multiplyScalar(bend.dot(ac.clone().normalize())))
    if (bend.lengthSq() < 1e-10) bend = l.startsWith('arm') ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1) // straight limb: elbows back, knees forward
    r.pole.position.copy(B).addScaledVector(bend.normalize(), A.distanceTo(B) * 0.8)
  }

  /** show the handles of each limb's current mode, and keep them on the bones */
  private refresh (): void {
    this.limbs.forEach((r, l) => {
      const ik = this.modes[l] === 'IK'
      r.target.visible = ik; r.pole.visible = ik
      r.rings.forEach((ring, i) => {
        ring.visible = !ik
        const bone = [r.a, r.b, r.c][i]
        ring.position.copy(W(bone))
        // the ring stands across the bone, so it reads as "turn here"
        const child = bone.children.find(c => (c as Bone).isBone === true)
        const dir = child !== undefined ? W(child).sub(W(bone)) : W(bone).sub(W(bone.parent!))
        if (dir.lengthSq() > 1e-12) ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize())
      })
    })
  }

  /* ---------------- picking + dragging ---------------- */
  private pointer (e: PointerEvent): void {
    if (!this.active || e.button !== 0 || this.gizmo === null) return
    if ((this.gizmo as any).axis !== null && (this.gizmo as any).axis !== undefined) return // on a gizmo handle
    const r = this.engine.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.engine.camera)
    const pick = this.group.children.filter(o => o.visible)
    const hit = ray.intersectObjects(pick, false)[0]
    if (hit === undefined) return
    e.stopPropagation(); e.preventDefault()
    const d = hit.object.userData as { gb: 'target' | 'pole' | 'fk', limb: Limb, bone?: Bone }
    this.attached = { kind: d.gb, limb: d.limb, bone: d.bone }
    if (d.gb === 'fk' && d.bone !== undefined) { this.gizmo.setMode('rotate'); this.gizmo.setSpace('local'); this.gizmo.attach(d.bone) }
    else { this.gizmo.setMode(d.gb === 'pole' ? 'translate' : this.handle_mode); this.gizmo.setSpace(d.gb === 'pole' ? 'world' : 'local'); this.gizmo.attach(hit.object) }
  }

  private on_drag (): void {
    const at = this.attached; if (at === null) return
    this.touched = true
    if (at.kind !== 'fk') this.solve(at.limb)
    // moving an upper bone moves the rings below it, and IK boxes of the other limbs stay where they are
    this.refresh()
    this.on_change?.()
  }

  /** two-bone IK: shoulder stays, hand goes to the box, elbow bends toward the pole ball */
  public solve (l: Limb): void {
    const r = this.limbs.get(l); if (r === undefined) return
    r.a.updateMatrixWorld(true)
    const A = W(r.a); const B = W(r.b); const C = W(r.c)
    const la = A.distanceTo(B); const lb = B.distanceTo(C)
    const T = r.target.getWorldPosition(new THREE.Vector3())
    const toT = T.clone().sub(A); const d = Math.min(la + lb - 1e-5, Math.max(Math.abs(la - lb) + 1e-5, toT.length()))
    const n = toT.normalize()
    let m = r.pole.getWorldPosition(new THREE.Vector3()).sub(A); m.sub(n.clone().multiplyScalar(m.dot(n)))
    if (m.lengthSq() < 1e-12) m = B.clone().sub(A).sub(n.clone().multiplyScalar(B.clone().sub(A).dot(n)))
    m.normalize()
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d); const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
    const E = A.clone().addScaledVector(n, la * cosA).addScaledVector(m, la * sinA)
    const Tend = A.clone().addScaledVector(n, d)
    // upper bone: aim at the new elbow; lower bone: aim at the hand
    rotate_world(r.a, new THREE.Quaternion().setFromUnitVectors(B.clone().sub(A).normalize(), E.clone().sub(A).normalize()))
    const B2 = W(r.b); const C2 = W(r.c)
    rotate_world(r.b, new THREE.Quaternion().setFromUnitVectors(C2.clone().sub(B2).normalize(), Tend.clone().sub(B2).normalize()))
    // the hand / foot takes the box's rotation
    set_world_quat(r.c, r.target.getWorldQuaternion(new THREE.Quaternion()))
  }

  /* ---------------- export ---------------- */
  /** the current pose as a one-frame clip (every bone), for the GLB → Blender kit */
  public pose_clip (): THREE.AnimationClip {
    const tracks: THREE.KeyframeTrack[] = []
    const seen = new Set<string>()
    this.engine.animations_listing_step.active_skinned_meshes().forEach(m => m.skeleton.bones.forEach(b => {
      if (seen.has(b.name)) return; seen.add(b.name)
      const q = b.quaternion
      tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1 / 30], [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w]))
      if (/^(pelvis|hips)$/i.test(b.name)) { const p = b.position; tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, [0, 1 / 30], [p.x, p.y, p.z, p.x, p.y, p.z])) }
    }))
    return new THREE.AnimationClip('Greenbox_Pose', 1 / 30, tracks)
  }
}
