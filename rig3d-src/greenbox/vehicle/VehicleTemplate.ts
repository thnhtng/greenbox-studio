/*
 * 🦴 Ready-made vehicle skeletons, fitted by hand like the human rig: a vehicle with no rig of its own (and no
 * rig to copy) gets a template (car, truck, tracked, bulldozer). Its joints are shown on the model; drag them
 * onto the real wheels / blade, set the size, then ✅ Apply: every point inside a wheel's circle becomes that
 * wheel, inside the blade's box the blade, and the rest is the body.
 *
 * Vehicle space (as VehicleApp keeps it): centre at x = z = 0, ground at y = 0, front at +Z, width along X.
 */
import * as THREE from 'three'

export type TemplateId = 'car' | 'truck' | 'tracked' | 'dozer'
export interface Joint {
  kind: 'wheel' | 'blade'
  name: string
  p: THREE.Vector3 // wheel: centre · blade: centre of its box
  r: number // wheel radius
  size: THREE.Vector3 // blade box size (wheels: unused)
  twin: number // the mirrored joint on the other side (-1 none)
}

export const TEMPLATES: Array<{ id: TemplateId, icon: string, en: string, vi: string }> = [
  { id: 'car', icon: '🚗', en: 'Car · 4 wheels', vi: 'Xe con · 4 bánh' },
  { id: 'truck', icon: '🚚', en: 'Truck · 6 wheels', vi: 'Xe tải · 6 bánh' },
  { id: 'tracked', icon: '⛓', en: 'Tracked · 2 tracks', vi: 'Xe xích · 2 dải xích' },
  { id: 'dozer', icon: '🚜', en: 'Bulldozer · tracks + blade', vi: 'Máy ủi · xích + lưỡi ủi' }
]

/** the template joints for a vehicle of this size */
export function make_joints (id: TemplateId, S: THREE.Vector3): Joint[] {
  const out: Joint[] = []
  const pair = (name: string, x: number, z: number, r: number): void => {
    const i = out.length
    out.push({ kind: 'wheel', name: `${name}_L`, p: new THREE.Vector3(x, r, z), r, size: new THREE.Vector3(), twin: i + 1 })
    out.push({ kind: 'wheel', name: `${name}_R`, p: new THREE.Vector3(-x, r, z), r, size: new THREE.Vector3(), twin: i })
  }
  const L = S.z; const W = S.x; const H = S.y
  if (id === 'car' || id === 'truck') {
    const r = Math.min(H * (id === 'car' ? 0.22 : 0.2), L * (id === 'car' ? 0.13 : 0.1))
    const x = W / 2 - r * 0.45
    const zs = id === 'car' ? [0.32, -0.32] : [0.34, -0.18, -0.36]
    zs.forEach((z, k) => pair(`wheel_${k === 0 ? 'F' : zs.length === 2 ? 'B' : `B${k}`}`, x, z * L, r))
  } else {
    // a track runs round its road wheels: 4 per side, the belt is found round them
    const z0 = id === 'dozer' ? -0.36 : -0.38; const z1 = id === 'dozer' ? 0.22 : 0.38
    const r = Math.min(H * 0.13, L * 0.09); const x = W / 2 - r * 0.9
    for (let k = 0; k < 4; k++) pair(`road_${k}`, x, (z0 + (z1 - z0) * k / 3) * L, r)
    if (id === 'dozer') out.push({ kind: 'blade', name: 'blade', p: new THREE.Vector3(0, H * 0.2, L * 0.44), r: 0, size: new THREE.Vector3(W, H * 0.4, L * 0.12), twin: -1 })
  }
  return out
}

/**
 * Which template fits a vehicle no part was found on: a belt touches the ground along most of the
 * length (tracks), a car only at its wheels; a long vehicle is a truck; a low wide piece in front is a blade.
 */
export function guess_template (geos: THREE.BufferGeometry[], S: THREE.Vector3): TemplateId {
  const bins = new Uint8Array(20); const front = { n: 0, wide: 0 }
  const v = new THREE.Vector3()
  for (const g of geos) {
    const pos = g.getAttribute('position'); const step = Math.max(1, Math.floor(pos.count / 20000))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i)
      if (v.y < S.y * 0.06) bins[Math.min(19, Math.max(0, Math.floor((v.z / S.z + 0.5) * 20)))] = 1
      if (v.z > S.z * 0.36 && v.y < S.y * 0.45) { front.n++; if (Math.abs(v.x) > S.x * 0.4) front.wide++ }
    }
  }
  const ground = bins.reduce((a, b) => a + b, 0) / 20
  if (ground > 0.55) return front.n > 0 && front.wide / front.n > 0.15 ? 'dozer' : 'tracked'
  return S.z > S.x * 2.6 ? 'truck' : 'car'
}

/** are these vehicle-space points inside the joint's area (what it takes when applied) */
export function in_wheel (j: Joint, x: number, y: number, z: number): boolean {
  const s = Math.sign(j.p.x) || 1
  // the circle seen from the side, from a little inside the wheel's centre to the outside of the vehicle
  return (y - j.p.y) ** 2 + (z - j.p.z) ** 2 < j.r * j.r && s * x > s * j.p.x - j.r * 0.55
}
export function in_blade (j: Joint, x: number, y: number, z: number): boolean {
  return Math.abs(x - j.p.x) < j.size.x / 2 && Math.abs(y - j.p.y) < j.size.y / 2 && Math.abs(z - j.p.z) < j.size.z / 2
}

/** the joints drawn on the model: a ball at each joint, the wheel's circle, the blade's box, lines to the body */
export class TemplateView {
  readonly group = new THREE.Group()
  joints: Joint[] = []
  sel = 0
  mirror = true
  private balls: THREE.Mesh[] = []
  constructor (private readonly scale: () => number) { this.group.renderOrder = 20 }

  set (joints: Joint[]): void { this.joints = joints; this.sel = 0; this.draw() }
  clear (): void { this.joints = []; this.draw() }

  draw (): void {
    this.group.clear(); this.balls = []
    if (this.joints.length === 0) return
    const S = this.scale()
    const body = new THREE.Vector3(0, this.joints.reduce((a, j) => Math.max(a, j.kind === 'wheel' ? j.p.y + j.r : 0), 0) * 1.1 + S * 0.02, 0)
    const mat = (c: number): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 })
    const root = new THREE.Mesh(new THREE.OctahedronGeometry(S * 0.016), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }))
    root.position.copy(body); root.renderOrder = 22; this.group.add(root)
    this.joints.forEach((j, i) => {
      const on = i === this.sel
      const col = j.kind === 'blade' ? 0xffa53a : on ? 0xffd34d : 0x7ad7ff
      const ball = new THREE.Mesh(new THREE.SphereGeometry(S * (on ? 0.016 : 0.012), 14, 10), new THREE.MeshBasicMaterial({ color: col, depthTest: false }))
      ball.position.copy(j.p); ball.renderOrder = 23; ball.userData.joint = i; this.group.add(ball); this.balls.push(ball)
      const bone = new THREE.Line(new THREE.BufferGeometry().setFromPoints([body, j.p]), mat(0xffffff)); bone.renderOrder = 21; this.group.add(bone)
      if (j.kind === 'wheel') {
        const pts: THREE.Vector3[] = []
        for (let a = 0; a <= 48; a++) { const t = a / 48 * Math.PI * 2; pts.push(new THREE.Vector3(j.p.x, j.p.y + Math.sin(t) * j.r, j.p.z + Math.cos(t) * j.r)) }
        const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat(col)); ring.renderOrder = 21; this.group.add(ring)
      } else {
        const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(j.size.x, j.size.y, j.size.z)), mat(col))
        box.position.copy(j.p); box.renderOrder = 21; this.group.add(box)
      }
    })
  }

  /** the joint ball under the mouse */
  hit (ray: THREE.Raycaster): number {
    const h = ray.intersectObjects(this.balls, false)[0]
    if (h !== undefined) return h.object.userData.joint as number
    // forgiving: the nearest ball within a few % of the screen
    let best = -1; let bd = Infinity
    this.balls.forEach((b, i) => { const d = ray.ray.distanceToPoint(b.position); if (d < bd) { bd = d; best = i } })
    return bd < this.scale() * 0.03 ? best : -1
  }

  /** move a joint (and its mirror twin) */
  move (i: number, p: THREE.Vector3): void {
    const j = this.joints[i]; if (j === undefined) return
    j.p.copy(p); if (j.kind === 'wheel') j.p.y = Math.max(j.p.y, j.r * 0.5)
    if (j.kind === 'blade') j.p.x = 0
    const t = this.joints[j.twin]
    if (this.mirror && t !== undefined) t.p.set(-j.p.x, j.p.y, j.p.z)
    this.draw()
  }

  /** wheel radius / blade size, times k (the twin follows) */
  resize (i: number, k: number): void {
    const j = this.joints[i]; if (j === undefined) return
    const f = (o: Joint): void => { if (o.kind === 'wheel') o.r *= k; else o.size.multiplyScalar(k) }
    f(j); const t = this.joints[j.twin]; if (this.mirror && t !== undefined) f(t)
    this.draw()
  }
}
