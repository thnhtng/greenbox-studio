/*
 * Ready-made sample vehicles, built from simple shapes. Every moving piece is its own mesh with a telling name
 * (wheel_FL, door_FR, hood, trunk, turret, barrel, track_L, boom, arm, bucket, hook, cable, rotor_main,
 * forks, antenna…), so the vehicle page rigs them completely on its own: they show every feature and are
 * the "source" for 🧬 Clone vehicle rig (their part layout is laid onto your own model).
 *
 * Space: +Z = front, +Y = up, X = left/right, wheels standing on y = 0.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type SampleType = 'car' | 'truck' | 'tracked' | 'roller'
export interface SampleInfo { id: string, label: string, vi: string, type: SampleType, icon?: string, short?: string, vshort?: string }

export const SAMPLES: SampleInfo[] = [
  { id: 'car', label: 'Car (4 doors, hood, trunk)', vi: 'Xe con (4 cửa, capo, cốp)', type: 'car', icon: '🚗', short: 'Car', vshort: 'Xe con' },
  { id: 'sport', label: 'Sports car (gull-wing doors)', vi: 'Xe thể thao (cửa cánh chim)', type: 'car', icon: '🏎', short: 'Sports', vshort: 'Thể thao' },
  { id: 'pickup', label: 'Pickup truck (tailgate)', vi: 'Xe bán tải (bửng sau)', type: 'truck', icon: '🛻', short: 'Pickup', vshort: 'Bán tải' },
  { id: 'bus', label: 'Bus (6 wheels, folding door)', vi: 'Xe buýt (6 bánh, cửa gập)', type: 'truck', icon: '🚌', short: 'Bus', vshort: 'Xe buýt' },
  { id: 'mixer', label: 'Cement mixer (spinning drum)', vi: 'Xe trộn bê tông (bồn quay)', type: 'truck', icon: '🚛', short: 'Mixer', vshort: 'Trộn bê tông' },
  { id: 'crane', label: 'Crane truck (cab, boom, cable, hook)', vi: 'Xe cẩu (cabin, cần, cáp, móc)', type: 'truck', icon: '🏗', short: 'Crane', vshort: 'Xe cẩu' },
  { id: 'forklift', label: 'Forklift (forks go up)', vi: 'Xe nâng (càng nâng)', type: 'truck', icon: '🔼', short: 'Forklift', vshort: 'Xe nâng' },
  { id: 'tank', label: 'Tank (tracks, turret, gun)', vi: 'Xe tăng (xích, tháp pháo, nòng)', type: 'tracked', icon: '🪖', short: 'Tank', vshort: 'Xe tăng' },
  { id: 'dozer', label: 'Bulldozer (tracks, blade)', vi: 'Xe ủi (xích, lưỡi ủi)', type: 'tracked', icon: '🚜', short: 'Bulldozer', vshort: 'Xe ủi' },
  { id: 'excavator', label: 'Excavator (tracks, cab, boom, arm, bucket)', vi: 'Máy xúc (xích, cabin, cần, tay, gàu)', type: 'tracked', icon: '⛏', short: 'Excavator', vshort: 'Máy xúc' },
  { id: 'driller', label: 'Drill rig (tracks, mast, spinning drill)', vi: 'Xe khoan (xích, cột, mũi khoan quay)', type: 'tracked', icon: '🔩', short: 'Drill rig', vshort: 'Xe khoan' },
  { id: 'roller', label: 'Road roller (drum)', vi: 'Xe lu (trống lu)', type: 'roller', icon: '🛞', short: 'Roller', vshort: 'Xe lu' },
  { id: 'bike', label: 'Motorbike (2 wheels, front steers)', vi: 'Xe máy (2 bánh, bánh trước lái)', type: 'car', icon: '🏍', short: 'Motorbike', vshort: 'Xe máy' },
  { id: 'heli', label: 'Helicopter (main + tail rotor)', vi: 'Trực thăng (cánh quạt chính + đuôi)', type: 'car', icon: '🚁', short: 'Heli', vshort: 'Trực thăng' },
  { id: 'boat', label: 'Boat (propeller, radar)', vi: 'Tàu thuyền (chân vịt, radar)', type: 'car', icon: '🚤', short: 'Boat', vshort: 'Tàu' }
]

const mat = (c: number, r = 0.6, m = 0.1): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })
const TM = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s))

class Kit {
  public readonly g = new THREE.Group()
  private readonly m = { tyre: mat(0x1d1d1d, 0.9), rim: mat(0xb8bcc4, 0.35, 0.6), glass: mat(0x8fb7d9, 0.15), dark: mat(0x2c2c2c, 0.8), steel: mat(0x8a8f96, 0.4, 0.5), yellow: mat(0xf2b50f, 0.55) }
  constructor (public body: THREE.MeshStandardMaterial) {}
  /** one named mesh made of several shapes */
  part (name: string, shapes: Array<[THREE.BufferGeometry, THREE.Matrix4]>, m: THREE.Material = this.body): THREE.Mesh {
    const gs = shapes.map(([g, t]) => { const n = g.index !== null ? g.toNonIndexed() : g.clone(); n.deleteAttribute('uv'); n.applyMatrix4(t); return n })
    const mesh = new THREE.Mesh(gs.length === 1 ? gs[0] : mergeGeometries(gs, false), m); mesh.name = name
    this.g.add(mesh); return mesh
  }
  box (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m?: THREE.Material, rx = 0): THREE.Mesh {
    return this.part(name, [[new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w * 4)), Math.max(1, Math.round(h * 4)), Math.max(1, Math.round(d * 4))), TM(x, y, z, rx)]], m)
  }
  /** tyre + rim as ONE wheel mesh, axle along X */
  wheel (name: string, r: number, w: number, x: number, z: number, y = r): THREE.Mesh {
    const t: Array<[THREE.BufferGeometry, THREE.Matrix4]> = [
      [new THREE.CylinderGeometry(r, r, w, 28, 1), TM(x, y, z, 0, 0, Math.PI / 2)],
      [new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 1.04, 16, 1), TM(x, y, z, 0, 0, Math.PI / 2)]
    ]
    const mesh = this.part(name, t, this.m.tyre)
    return mesh
  }
  get mats (): Kit['m'] { return this.m }
  /** a caterpillar belt round wheels between z0..z1 at height y (wheel radius r), as ONE mesh */
  track (name: string, x: number, z0: number, z1: number, r: number, y: number, width: number): void {
    const shapes: Array<[THREE.BufferGeometry, THREE.Matrix4]> = []
    const half = (z1 - z0) / 2; const zc = (z0 + z1) / 2; const rr = r + 0.07
    const per = 2 * Math.PI * rr + 4 * half; const N = Math.max(40, Math.round(per / 0.12))
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N * per; let z: number; let yy: number; let a: number
      if (s < 2 * half) { z = -half + s; yy = y - rr; a = 0 } else if (s < 2 * half + Math.PI * rr) { const q = (s - 2 * half) / rr; z = half + Math.sin(q) * rr; yy = y - Math.cos(q) * rr; a = q } else if (s < 4 * half + Math.PI * rr) { z = half - (s - 2 * half - Math.PI * rr); yy = y + rr; a = Math.PI } else { const q = (s - 4 * half - Math.PI * rr) / rr; z = -half - Math.sin(q) * rr; yy = y + Math.cos(q) * rr; a = Math.PI + q }
      shapes.push([new THREE.BoxGeometry(width, 0.05, per / N * 0.9), TM(x, yy, zc + z, -a)])
    }
    this.part(name, shapes, this.m.dark)
  }
}

/** a sample vehicle as separate named meshes */
export function make_sample (id: string): { group: THREE.Group, type: SampleType, name: string } {
  const info = SAMPLES.find(s => s.id === id) ?? SAMPLES[0]
  const k = new Kit(mat(({ car: 0xd43d2f, sport: 0xf2b50f, pickup: 0x2f6fd4, bus: 0xe8a33a, mixer: 0xe6e6e6, crane: 0xf2b50f, forklift: 0xf28c0f, tank: 0x6b7a4a, dozer: 0xf2b50f, excavator: 0xf2b50f, roller: 0xf2b50f, bike: 0xc0262d, heli: 0x355d8a, boat: 0xf0f0f0 } as Record<string, number>)[info.id] ?? 0xd43d2f, 0.5))
  const M = k.mats
  switch (info.id) {
    case 'car': {
      k.box('body', 1.8, 0.55, 4.2, 0, 0.62, 0)
      k.box('cabin_glass', 1.56, 0.5, 2.0, 0, 1.15, -0.25, M.glass)
      k.box('door_FL', 0.06, 0.52, 1.0, 0.92, 0.72, 0.35); k.box('door_FR', 0.06, 0.52, 1.0, -0.92, 0.72, 0.35)
      k.box('door_RL', 0.06, 0.52, 0.9, 0.92, 0.72, -0.62); k.box('door_RR', 0.06, 0.52, 0.9, -0.92, 0.72, -0.62)
      k.box('hood', 1.6, 0.05, 1.15, 0, 0.92, 1.45); k.box('trunk', 1.6, 0.05, 0.8, 0, 0.92, -1.7)
      k.part('antenna', [[new THREE.CylinderGeometry(0.01, 0.015, 0.7, 6, 6), TM(-0.6, 1.75, -0.9)]], M.dark)
      for (const [n, x, z] of [['wheel_FL', 0.86, 1.3], ['wheel_FR', -0.86, 1.3], ['wheel_RL', 0.86, -1.35], ['wheel_RR', -0.86, -1.35]] as Array<[string, number, number]>) k.wheel(n, 0.36, 0.26, x, z)
      break
    }
    case 'sport': {
      k.box('body', 1.9, 0.42, 4.4, 0, 0.5, 0)
      k.box('cabin_glass', 1.5, 0.36, 1.5, 0, 0.88, -0.2, M.glass)
      k.box('door_L_gull', 0.05, 0.36, 1.1, 0.78, 0.88, -0.1); k.box('door_R_gull', 0.05, 0.36, 1.1, -0.78, 0.88, -0.1)
      k.box('hood', 1.7, 0.05, 1.3, 0, 0.73, 1.45); k.box('spoiler', 1.7, 0.05, 0.3, 0, 0.98, -2.05)
      for (const [n, x, z] of [['wheel_FL', 0.9, 1.4], ['wheel_FR', -0.9, 1.4], ['wheel_RL', 0.9, -1.4], ['wheel_RR', -0.9, -1.4]] as Array<[string, number, number]>) k.wheel(n, 0.36, 0.32, x, z)
      break
    }
    case 'pickup': {
      k.box('body', 1.95, 0.6, 5.2, 0, 0.8, 0)
      k.box('cabin_glass', 1.8, 0.6, 1.8, 0, 1.4, 0.5, M.glass)
      k.box('door_FL', 0.06, 0.6, 1.1, 1.0, 0.95, 0.75); k.box('door_FR', 0.06, 0.6, 1.1, -1.0, 0.95, 0.75)
      k.box('hood', 1.8, 0.05, 1.3, 0, 1.13, 1.9)
      k.box('bed', 1.9, 0.4, 2.1, 0, 1.3, -1.45, M.dark)
      k.box('tailgate', 1.8, 0.45, 0.06, 0, 1.3, -2.55)
      for (const [n, x, z] of [['wheel_FL', 0.9, 1.75], ['wheel_FR', -0.9, 1.75], ['wheel_RL', 0.9, -1.6], ['wheel_RR', -0.9, -1.6]] as Array<[string, number, number]>) k.wheel(n, 0.45, 0.32, x, z)
      break
    }
    case 'bus': {
      k.box('body', 2.5, 2.4, 11, 0, 1.75, 0)
      k.box('windows', 2.54, 0.7, 9.5, 0, 2.3, -0.3, M.glass)
      k.box('door_front', 0.06, 1.9, 1.1, -1.27, 1.55, 4.3)
      k.box('door_mid', 0.06, 1.9, 1.1, -1.27, 1.55, -0.5)
      for (const [n, x, z] of [['wheel_FL', 1.1, 3.6], ['wheel_FR', -1.1, 3.6], ['wheel_RL', 1.1, -3.0], ['wheel_RR', -1.1, -3.0], ['wheel_RL2', 1.1, -4.1], ['wheel_RR2', -1.1, -4.1]] as Array<[string, number, number]>) k.wheel(n, 0.52, 0.34, x, z)
      break
    }
    case 'mixer': {
      k.box('body', 2.3, 0.5, 7.5, 0, 1.15, 0, M.dark)
      k.box('cab', 2.3, 1.8, 1.9, 0, 2.2, 2.6)
      k.box('door_FL', 0.06, 1.0, 1.1, 1.17, 2.0, 2.6); k.box('door_FR', 0.06, 1.0, 1.1, -1.17, 2.0, 2.6)
      k.part('mixer_drum', [[new THREE.CylinderGeometry(0.75, 1.15, 3.8, 24, 6), TM(0, 2.55, -1.1, Math.PI / 2 - 0.2)]], k.body)
      for (const [n, x, z] of [['wheel_FL', 1.05, 2.6], ['wheel_FR', -1.05, 2.6], ['wheel_RL', 1.05, -1.4], ['wheel_RR', -1.05, -1.4], ['wheel_RL2', 1.05, -2.6], ['wheel_RR2', -1.05, -2.6]] as Array<[string, number, number]>) k.wheel(n, 0.52, 0.36, x, z)
      break
    }
    case 'crane': {
      k.box('body', 2.4, 0.6, 9, 0, 1.2, 0, M.dark)
      k.box('cab', 2.4, 1.5, 1.8, 0, 2.2, 3.5)
      k.box('door_FL', 0.06, 0.9, 1.0, 1.22, 2.1, 3.5); k.box('door_FR', 0.06, 0.9, 1.0, -1.22, 2.1, 3.5)
      k.part('turret', [[new THREE.CylinderGeometry(1.0, 1.1, 0.5, 24), TM(0, 1.75, -1.6)], [new THREE.BoxGeometry(1.2, 1.2, 1.4, 4, 4, 4), TM(0.55, 2.5, -1.4)]], k.body)
      k.part('boom', [[new THREE.BoxGeometry(0.5, 0.5, 6.5, 2, 2, 24), TM(-0.3, 2.9, 0.9, -0.22)]], M.yellow)
      k.part('cable', [[new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6, 10), TM(-0.3, 2.8, 4.0)]], M.dark)
      k.part('hook', [[new THREE.BoxGeometry(0.35, 0.35, 0.35, 2, 2, 2), TM(-0.3, 1.55, 4.0)], [new THREE.TorusGeometry(0.15, 0.04, 6, 14, Math.PI * 1.3), TM(-0.3, 1.25, 4.0)]], M.steel)
      for (const [n, x, z] of [['wheel_FL', 1.1, 3.3], ['wheel_FR', -1.1, 3.3], ['wheel_ML', 1.1, 2.1], ['wheel_MR', -1.1, 2.1], ['wheel_RL', 1.1, -2.6], ['wheel_RR', -1.1, -2.6], ['wheel_RL2', 1.1, -3.7], ['wheel_RR2', -1.1, -3.7]] as Array<[string, number, number]>) k.wheel(n, 0.55, 0.38, x, z)
      break
    }
    case 'forklift': {
      k.box('body', 1.2, 0.8, 2.2, 0, 0.75, -0.2)
      k.box('roof', 1.1, 0.06, 1.3, 0, 2.15, -0.2, M.dark)
      k.box('mast', 0.9, 2.3, 0.12, 0, 1.3, 1.05, M.dark)
      k.part('forks', [[new THREE.BoxGeometry(0.12, 0.06, 1.1, 1, 1, 4), TM(0.28, 0.25, 1.65)], [new THREE.BoxGeometry(0.12, 0.06, 1.1, 1, 1, 4), TM(-0.28, 0.25, 1.65)], [new THREE.BoxGeometry(0.9, 0.5, 0.06, 3, 2, 1), TM(0, 0.5, 1.13)]], M.steel)
      for (const [n, x, z, r] of [['wheel_FL', 0.55, 0.65, 0.33], ['wheel_FR', -0.55, 0.65, 0.33], ['wheel_RL', 0.55, -0.9, 0.27], ['wheel_RR', -0.55, -0.9, 0.27]] as Array<[string, number, number, number]>) k.wheel(n, r, 0.24, x, z)
      break
    }
    case 'tank': case 'dozer': case 'excavator': case 'driller': {
      const r = 0.36; const zs = info.id === 'tank' ? [-1.9, -0.95, 0, 0.95, 1.9] : [-1.4, -0.47, 0.47, 1.4]
      const tx = info.id === 'tank' ? 1.25 : 1.05; const wy = r + 0.12
      for (const s of [1, -1]) {
        zs.forEach((z, i) => k.wheel(`roadwheel_${s > 0 ? 'L' : 'R'}${i + 1}`, r, 0.3, s * tx, z, wy))
        k.track(`track_${s > 0 ? 'L' : 'R'}`, s * tx, zs[0], zs[zs.length - 1], r, wy, 0.46)
      }
      if (info.id === 'tank') {
        k.box('hull', 2.0, 0.7, 5.2, 0, 1.05, 0)
        k.box('fenders', 3.3, 0.06, 4.8, 0, 1.42, 0, M.dark)
        k.part('turret', [[new THREE.CylinderGeometry(0.85, 1.0, 0.55, 24, 2), TM(0, 1.72, -0.3)]], k.body)
        k.part('barrel', [[new THREE.CylinderGeometry(0.09, 0.11, 2.6, 12, 6), TM(0, 1.76, 1.6, Math.PI / 2)]], M.dark)
        k.part('hatch', [[new THREE.CylinderGeometry(0.25, 0.25, 0.05, 16), TM(0.35, 2.02, -0.55)]], M.dark)
      } else if (info.id === 'driller') {
        k.box('body', 1.6, 0.8, 2.8, 0, 1.1, -0.3)
        k.box('cab_glass', 1.2, 0.9, 1.0, 0.0, 1.95, -1.1, M.glass)
        k.box('mast', 0.35, 3.2, 0.35, 0, 2.7, 1.05, M.yellow)
        k.part('drill', [[new THREE.CylinderGeometry(0.12, 0.12, 2.2, 16, 8), TM(0, 1.25, 1.45)], [new THREE.ConeGeometry(0.16, 0.4, 16, 2), TM(0, 0.2, 1.45, Math.PI)], [new THREE.TorusGeometry(0.16, 0.035, 6, 16), TM(0, 0.6, 1.45, Math.PI / 2)], [new THREE.TorusGeometry(0.16, 0.035, 6, 16), TM(0, 1.1, 1.45, Math.PI / 2)], [new THREE.TorusGeometry(0.16, 0.035, 6, 16), TM(0, 1.6, 1.45, Math.PI / 2)]], M.steel)
      } else if (info.id === 'dozer') {
        k.box('body', 1.6, 0.9, 3.0, 0, 1.15, -0.2)
        k.box('cab_glass', 1.3, 1.0, 1.2, 0, 2.1, -0.7, M.glass)
        k.part('blade', [[new THREE.BoxGeometry(3.0, 1.0, 0.12, 8, 4, 1), TM(0, 0.55, 2.35, -0.15)], [new THREE.BoxGeometry(0.12, 0.12, 1.0, 1, 1, 3), TM(0.9, 0.8, 1.85)], [new THREE.BoxGeometry(0.12, 0.12, 1.0, 1, 1, 3), TM(-0.9, 0.8, 1.85)]], M.dark)
      } else {
        k.box('undercarriage', 1.2, 0.35, 2.6, 0, 0.6, 0, M.dark)
        k.part('turret', [[new THREE.BoxGeometry(2.2, 0.9, 2.8, 6, 3, 8), TM(0, 1.35, -0.3)], [new THREE.BoxGeometry(0.9, 1.0, 1.0, 3, 3, 3), TM(0.6, 2.25, 0.6)]], k.body)
        k.part('boom', [[new THREE.BoxGeometry(0.35, 0.4, 2.8, 1, 2, 10), TM(-0.3, 2.45, 1.95, -0.55)]], k.body)
        k.part('arm', [[new THREE.BoxGeometry(0.3, 0.3, 2.0, 1, 1, 8), TM(-0.3, 2.35, 3.95, 0.9)]], k.body)
        k.part('bucket', [[new THREE.BoxGeometry(0.8, 0.6, 0.5, 3, 2, 2), TM(-0.3, 1.45, 4.55, 0.3)]], M.dark)
      }
      break
    }
    case 'roller': {
      k.box('body', 1.6, 1.0, 2.6, 0, 1.2, -0.6)
      k.box('cab_glass', 1.3, 0.9, 1.1, 0, 2.15, -0.8, M.glass)
      k.box('frame', 2.0, 0.3, 0.6, 0, 1.45, 1.3, M.dark)
      k.part('roller_drum', [[new THREE.CylinderGeometry(0.62, 0.62, 1.9, 32, 2), TM(0, 0.62, 1.3, 0, 0, Math.PI / 2)]], M.steel)
      k.wheel('wheel_RL', 0.6, 0.45, 0.85, -1.2, 0.6); k.wheel('wheel_RR', 0.6, 0.45, -0.85, -1.2, 0.6)
      break
    }
    case 'bike': {
      k.box('body', 0.32, 0.4, 1.2, 0, 0.75, -0.05)
      k.box('seat', 0.3, 0.1, 0.6, 0, 1.0, -0.35, M.dark)
      k.part('front_frame', [[new THREE.BoxGeometry(0.06, 0.7, 0.06, 1, 3, 1), TM(0.1, 0.65, 0.68, -0.35)], [new THREE.BoxGeometry(0.06, 0.7, 0.06, 1, 3, 1), TM(-0.1, 0.65, 0.68, -0.35)], [new THREE.BoxGeometry(0.7, 0.05, 0.05, 3, 1, 1), TM(0, 1.05, 0.55)]], M.steel)
      k.wheel('wheel_F', 0.32, 0.12, 0, 0.82); k.wheel('wheel_R', 0.32, 0.16, 0, -0.75)
      break
    }
    case 'heli': {
      k.part('body', [[new THREE.SphereGeometry(0.9, 20, 14), TM(0, 1.3, 0.6)], [new THREE.CylinderGeometry(0.12, 0.35, 3.2, 10, 6), TM(0, 1.45, -1.7, Math.PI / 2)]], k.body)
      k.box('skids', 1.4, 0.06, 2.2, 0, 0.1, 0.5, M.dark)
      k.part('rotor_main', [[new THREE.BoxGeometry(5.6, 0.04, 0.22, 20, 1, 1), TM(0, 2.35, 0.5)], [new THREE.BoxGeometry(0.22, 0.04, 5.6, 1, 1, 20), TM(0, 2.35, 0.5)]], M.dark)
      k.part('rotor_tail', [[new THREE.BoxGeometry(0.04, 0.9, 0.12, 1, 4, 1), TM(0.16, 1.65, -3.25)], [new THREE.BoxGeometry(0.04, 0.12, 0.9, 1, 1, 4), TM(0.16, 1.65, -3.25)]], M.dark)
      break
    }
    case 'boat': {
      k.part('hull', [[new THREE.BoxGeometry(2.0, 0.9, 5.0, 6, 3, 14), TM(0, 0.85, 0)], [new THREE.ConeGeometry(1.0, 1.6, 4, 1), TM(0, 0.85, 3.3, Math.PI / 2, Math.PI / 4)]], k.body)
      k.box('cabin', 1.5, 1.0, 1.6, 0, 1.8, -0.6, M.glass)
      k.part('radar', [[new THREE.BoxGeometry(0.9, 0.1, 0.12, 4, 1, 1), TM(0, 2.5, -0.6)]], M.dark)
      k.part('propeller', [[new THREE.BoxGeometry(0.6, 0.1, 0.04, 3, 1, 1), TM(0, 0.4, -2.6)], [new THREE.BoxGeometry(0.1, 0.6, 0.04, 1, 3, 1), TM(0, 0.4, -2.6)]], M.steel)
      break
    }
  }
  return { group: k.g, type: info.type, name: info.label }
}

/* ---------------- what a part name means (samples, named game models, source rigs) ---------------- */
export type PartRole = { role: 'wheel' } | { role: 'body' } | { role: 'mech', kind: import('./Mechanics.ts').MechKind, hinge?: import('./Mechanics.ts').Hinge, axis?: import('./Mechanics.ts').MechAxis, angle?: number }

/** role of a part / bone from its name (null = unknown) */
export function role_of (raw: string): PartRole | null {
  const n = raw.toLowerCase()
  if (/steering|steer_?wheel/.test(n)) return { role: 'mech', kind: 'spin', axis: 'z', angle: 0 }
  if (/track|tread|crawler|caterpillar/.test(n) && !/found|frame|guard|cover|fender|base|grp$|group/.test(n)) return { role: 'mech', kind: 'track' }
  if ((/wheel|whell|tire|tyre|whl|roadwheel|roller_?drum|^drum/.test(n) || /(^|[^a-z])rims?([^a-z]|$)/.test(n)) && !/arch|well|cover|fender/.test(n)) return { role: 'wheel' }
  if (/gull/.test(n)) return { role: 'mech', kind: 'door', hinge: 'top', angle: 70 }
  if (/scissor|lambo/.test(n)) return { role: 'mech', kind: 'door', hinge: 'scissor', angle: 70 }
  if (/hood|bonnet/.test(n)) return { role: 'mech', kind: 'door', hinge: 'hood', angle: 60 }
  if (/trunk|boot|tailgate|hatchback|liftgate/.test(n)) return { role: 'mech', kind: 'door', hinge: 'trunk', angle: 60 }
  if (/door|hatch|lid|canopy/.test(n)) return { role: 'mech', kind: 'door', hinge: 'auto', angle: 70 }
  if (/turret|tower|upper_?house|slew/.test(n)) return { role: 'mech', kind: 'turret' }
  if (/barrel|cannon|(^|[^a-z])gun/.test(n)) return { role: 'mech', kind: 'barrel' }
  if (/bucket|scoop/.test(n)) return { role: 'mech', kind: 'bucket' }
  if (/drill|auger|(^|[^a-z])bit([^a-z]|$)|borer/.test(n)) return { role: 'mech', kind: 'spin', axis: 'long', angle: 150 }
  if (/blade|plow|plough|ladle/.test(n) && !/rotor/.test(n)) return { role: 'mech', kind: 'blade' }
  if (/boom|jib/.test(n)) return { role: 'mech', kind: 'boom' }
  if (/(^|[^a-z])arm([^a-z]|$)|stick|dipper/.test(n)) return { role: 'mech', kind: 'arm' }
  if (/hook/.test(n)) return { role: 'mech', kind: 'hook' }
  if (/rotor_?tail|tail_?rotor/.test(n)) return { role: 'mech', kind: 'spin', axis: 'x', angle: 160 }
  if (/rotor|heli/.test(n)) return { role: 'mech', kind: 'spin', axis: 'y', angle: 100 }
  if (/prop|screw/.test(n)) return { role: 'mech', kind: 'spin', axis: 'z', angle: 120 }
  if (/cable|rope|winch/.test(n)) return { role: 'mech', kind: 'cable' }
  if (/radar|fan|turbine/.test(n)) return { role: 'mech', kind: 'spin', axis: 'y', angle: 40 }
  if (/mixer|drum/.test(n)) return { role: 'mech', kind: 'spin', axis: 'z', angle: 30 }
  if (/fork|piston|ladder|slider|hydraul|(^|[^a-z])lift([^a-z]|$)/.test(n)) return { role: 'mech', kind: 'slide', axis: 'y', angle: 60 }
  if (/antenna|aerial|flag|whip/.test(n)) return { role: 'mech', kind: 'wobble', angle: 20 }
  if (/spoiler|wing/.test(n)) return { role: 'body' }
  if (/body|chassis|hull|frame|root|vehicle|car|armature|main|base|cab|glass|window|seat|skid|fender|bed|mast|roof/.test(n)) return { role: 'body' }
  return null
}
