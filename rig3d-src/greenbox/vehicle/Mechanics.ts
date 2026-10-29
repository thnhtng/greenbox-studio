/*
 * Mechanical parts of a vehicle (all rigid, no skin blending — the right look for low-poly machines):
 *   door    hinge on an edge (front / back / top / scissor / hood / trunk)
 *   turret  turns around its vertical axis (tank turret, crane cab)
 *   barrel  aims up/down from its rear end + recoil (tank gun)
 *   blade   lifts and tilts (bulldozer blade, loader bucket)
 *   boom    raises from the end nearest the vehicle (crane boom, excavator arm)
 *   hook    drops on a cable and swings (crane hook)
 *   cable   stretches with the hook
 *   arm     excavator stick: swings from its top end, rides the boom
 *   bucket  curls from its top end, rides the arm (or the boom)
 *   spin    keeps turning around an axis (propeller, rotor, fan, radar, mixer drum, drill)
 *   slide   moves in a straight line (piston, forklift forks, ladder, tipper)
 *   wobble  sways from its base (antenna, flag, whip)
 * Everything is worked out from the part's own box in the vehicle's canonical space (+Z forward, +Y up, on the floor).
 */
import * as THREE from 'three'

export type MechKind = 'door' | 'turret' | 'barrel' | 'blade' | 'boom' | 'arm' | 'bucket' | 'hook' | 'cable' | 'spin' | 'slide' | 'wobble'
export type MechAxis = 'auto' | 'x' | 'y' | 'z'
export type Hinge = 'auto' | 'front' | 'back' | 'top' | 'scissor' | 'hood' | 'trunk'
export interface Mech { kind: MechKind, name: string, hinge: Hinge, angle: number, flip: boolean, axis?: MechAxis }
export interface MechPose {
  used: string // the pivot rule actually used (for the UI)
  pivot: THREE.Vector3 // world, rest pose
  axis: THREE.Vector3 // rotation axis
  open: number // radians at "fully open / raised"
  slide: THREE.Vector3 // translation at "fully open" (blade lift, hook drop, barrel recoil)
  stretch: number // cable: Y scale at full drop (1 = none)
}

export const MECH_KINDS: MechKind[] = ['door', 'turret', 'barrel', 'blade', 'boom', 'arm', 'bucket', 'hook', 'cable', 'spin', 'slide', 'wobble']
export const MECH_ICON: Record<MechKind, string> = { door: '🚪', turret: '🔄', barrel: '💥', blade: '🚜', boom: '🏗', arm: '🦾', bucket: '🪣', hook: '🪝', cable: '〰', spin: '🌀', slide: '↔', wobble: '〽' }
export function default_angle (k: MechKind): number {
  return ({ door: 70, turret: 90, barrel: 15, blade: 60, boom: 40, arm: 50, bucket: 70, hook: 60, cable: 60, spin: 100, slide: 60, wobble: 20 } as Record<MechKind, number>)[k]
}

const V = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z)

/** the part's axis: chosen by the user, or guessed from its box ('thin' = thinnest side, e.g. a propeller disc; 'long' = longest side, e.g. a piston) */
export function mech_axis (m: Mech, s: THREE.Vector3, guess: 'thin' | 'long'): THREE.Vector3 {
  const a = m.axis ?? 'auto'
  if (a === 'x') return V(1, 0, 0)
  if (a === 'y') return V(0, 1, 0)
  if (a === 'z') return V(0, 0, 1)
  const d = [s.x, s.y, s.z]
  const i = guess === 'thin' ? d.indexOf(Math.min(...d)) : d.indexOf(Math.max(...d))
  return [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)][i]
}

/** how far a hook drops: the "amount" slider as % of the vehicle height, but never through the floor */
export function hook_drop_for (m: Mech, b: THREE.Box3, S: THREE.Vector3): number {
  return Math.min(S.y * (m.angle / 100), Math.max(0, b.min.y - S.y * 0.03))
}

/** pivot, axis and motion of one part. `S` = whole vehicle size, `hook_drop` = how far the hook goes (for its cable) */
export function mech_pose (m: Mech, b: THREE.Box3, S: THREE.Vector3, hook_drop = 0): MechPose | null {
  if (b.isEmpty()) return null
  const c = b.getCenter(V()); const s = b.getSize(V())
  const A = m.angle * Math.PI / 180
  const flip = m.flip ? -1 : 1
  const base = (used: string, pivot: THREE.Vector3, axis: THREE.Vector3, open: number, slide = V(), stretch = 1): MechPose => ({ used, pivot, axis, open, slide, stretch })
  switch (m.kind) {
    case 'door': {
      const side = c.x >= 0 ? 1 : -1
      const mid = Math.abs(c.x) < S.x * 0.18
      let used = m.hinge === 'auto' ? (mid ? (c.z > 0 ? 'hood' : 'trunk') : 'front') : m.hinge
      if (mid && (used === 'front' || used === 'back' || used === 'top')) used = c.z > 0 ? 'hood' : 'trunk'
      const outer = side > 0 ? b.max.x : b.min.x
      switch (used) {
        case 'back': return base(used, V(outer, c.y, b.min.z), V(0, 1, 0), side * A)
        case 'top': return base(used, V(side > 0 ? b.min.x : b.max.x, b.max.y, c.z), V(0, 0, 1), side * A)
        case 'scissor': return base(used, V(c.x, c.y, b.max.z), V(1, 0, 0), A)
        case 'hood': return base(used, V(c.x, b.max.y, b.min.z), V(1, 0, 0), -A)
        case 'trunk': return base(used, V(c.x, b.max.y, b.max.z), V(1, 0, 0), A)
        default: return base('front', V(outer, c.y, b.max.z), V(0, 1, 0), -side * A)
      }
    }
    case 'turret': return base('turret', V(c.x, b.min.y, c.z), V(0, 1, 0), A * flip)
    case 'barrel': {
      // the muzzle is the end farther from the vehicle centre; it turns around the other end
      const muzzle_front = Math.abs(b.max.z) >= Math.abs(b.min.z) ? 1 : -1
      const f = muzzle_front * flip
      const rear = f > 0 ? b.min.z : b.max.z
      return base('barrel', V(c.x, c.y, rear), V(1, 0, 0), -f * A, V(0, 0, -f * s.z * 0.25))
    }
    case 'blade': {
      const front = c.z >= 0 ? 1 : -1
      const pivot = V(c.x, c.y, front > 0 ? b.min.z : b.max.z)
      return base('blade', pivot, V(1, 0, 0), -front * A * 0.15 * flip, V(0, s.y * 0.9 * (m.angle / 60), 0))
    }
    case 'boom': {
      const along_z = s.z >= s.y
      if (along_z) {
        const near_end = Math.abs(b.min.z) < Math.abs(b.max.z) ? b.min.z : b.max.z
        const far_dir = near_end === b.min.z ? 1 : -1
        return base('boom', V(c.x, c.y, near_end), V(1, 0, 0), -far_dir * A * flip)
      }
      return base('boom', V(c.x, b.min.y, c.z), V(1, 0, 0), -A * flip)
    }
    case 'arm': {
      // a stick hanging from the boom tip turns around its top; a level one around the end nearer the cab
      if (s.y >= s.z) return base('arm', V(c.x, b.max.y, c.z), V(1, 0, 0), A * flip)
      const near_end = Math.abs(b.min.z) < Math.abs(b.max.z) ? b.min.z : b.max.z
      return base('arm', V(c.x, c.y, near_end), V(1, 0, 0), (near_end === b.min.z ? -1 : 1) * A * flip)
    }
    case 'bucket': return base('bucket', V(c.x, b.max.y, c.z), V(1, 0, 0), (c.z >= 0 ? 1 : -1) * A * flip)
    case 'spin': {
      const ax = mech_axis(m, s, 'thin')
      // "amount" = turns per second x 100 (100 = 1 turn / s); one clip second = `open` radians
      return base('spin', c, ax, 2 * Math.PI * flip)
    }
    case 'slide': {
      const ax = mech_axis(m, s, 'long')
      const len = Math.abs(ax.dot(s))
      return base('slide', c, ax, 0, ax.clone().multiplyScalar(len * (m.angle / 100) * flip))
    }
    case 'wobble': return base('wobble', V(c.x, b.min.y, c.z), V(1, 0, 0), A * flip)
    case 'hook': return base('hook', V(c.x, b.max.y, c.z), V(1, 0, 0), 0.18 * flip, V(0, -hook_drop_for(m, b, S), 0))
    case 'cable': {
      const drop = hook_drop > 0 ? hook_drop : Math.min(S.y * (m.angle / 100), Math.max(0, b.min.y - S.y * 0.05))
      return base('cable', V(c.x, b.max.y, c.z), V(1, 0, 0), 0.18 * flip, V(), (s.y + drop) / Math.max(1e-4, s.y))
    }
  }
}

/** which part a part hangs on: barrels/booms ride the turret, hooks/cables hang from the boom */
export function mech_parent (j: number, mechs: Mech[], poses: Array<MechPose | null>, boxes: THREE.Box3[]): number {
  const k = mechs[j].kind; const p = poses[j]; if (p === null) return -1
  const find = (want: MechKind, near: (i: number) => boolean): number => {
    let best = -1; let bd = Infinity
    mechs.forEach((m, i) => {
      if (i === j || m.kind !== want || poses[i] === null || !near(i)) return
      const d = boxes[i].getCenter(V()).distanceTo(p.pivot)
      if (d < bd) { bd = d; best = i }
    })
    return best
  }
  const inside = (i: number, grow: number): boolean => boxes[i].clone().expandByScalar(boxes[i].getSize(V()).length() * grow).containsPoint(p.pivot)
  if (k === 'barrel' || k === 'boom') return find('turret', i => inside(i, 0.25))
  if (k === 'arm') return find('boom', i => inside(i, 0.35))
  if (k === 'bucket') { const a = find('arm', i => inside(i, 0.35)); return a >= 0 ? a : find('boom', i => inside(i, 0.35)) }
  if (k === 'spin' || k === 'slide' || k === 'wobble') {
    // a spinner / piston / antenna mounted on a moving part rides it (radar on a turret, forks on a boom)
    let best = -1; let bv = Infinity
    mechs.forEach((m, i) => {
      if (i === j || poses[i] === null || m.kind === 'door' || m.kind === 'cable' || m.kind === 'hook') return
      if (!inside(i, 0.05)) return
      const vol = boxes[i].getSize(V()); const v = vol.x * vol.y * vol.z
      if (v < bv && v > boxes[j].getSize(V()).x * boxes[j].getSize(V()).y * boxes[j].getSize(V()).z) { bv = v; best = i }
    })
    return best
  }
  if (k === 'hook' || k === 'cable') {
    const boom = find('boom', () => true); if (boom >= 0) return boom
    return find('turret', () => true)
  }
  return -1
}

/** the clips the marked parts add. `rot`/`slide` are 0..1 (can go negative) per part */
export interface MechFrame { rot: number, slide: number }
export interface MechClip { name: string, dur: number, frame: (t: number, j: number) => MechFrame, body?: (t: number) => { lift?: number, pitch?: number, roll?: number, speed?: number } }

const ease = (x: number): number => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x)
const pulse = (t: number, a: number, b: number): number => t < a ? 0 : t < b ? ease((t - a) / (b - a)) : 1

export function mech_clips (mechs: Mech[]): MechClip[] {
  const has = (k: MechKind): boolean => mechs.some(m => m.kind === k)
  const of = (k: MechKind) => (j: number): boolean => mechs[j].kind === k
  const out: MechClip[] = []
  const Z: MechFrame = { rot: 0, slide: 0 }
  // doors
  mechs.forEach((m, j) => {
    if (m.kind !== 'door') return
    const open = (t: number, d: number): number => { const x = Math.min(1, t / d); return x < 1 ? 1 - Math.pow(1 - x, 3) + 0.06 * Math.sin(x * Math.PI) : 1 + 0.03 * Math.sin((t - d) * 14) * Math.exp(-(t - d) * 6) }
    const slam = (t: number): number => t < 0.45 ? 0 : Math.sin((t - 0.45) * 30) * Math.exp(-(t - 0.45) * 9)
    out.push({ name: `D_${m.name}_Open`, dur: 1.4, frame: (t, i) => i === j ? { rot: open(t, 0.8), slide: 0 } : Z })
    out.push({ name: `D_${m.name}_Close`, dur: 1.2, frame: (t, i) => i === j ? { rot: Math.max(0, 1 - Math.min(1, t / 0.45) ** 2), slide: 0 } : Z, body: t => ({ lift: -0.006 * slam(t), roll: 0.5 * slam(t) }) })
    out.push({ name: `D_${m.name}_Hold_Open`, dur: 1, frame: (_t, i) => i === j ? { rot: 1, slide: 0 } : Z })
  })
  if (mechs.filter(m => m.kind === 'door').length > 1) {
    out.push({ name: 'D_All_Open', dur: 1.6, frame: (t, j) => of('door')(j) ? { rot: pulse(t, j * 0.08, 0.8 + j * 0.08), slide: 0 } : Z })
    out.push({ name: 'D_All_Close', dur: 1.4, frame: (t, j) => of('door')(j) ? { rot: 1 - pulse(t, j * 0.06, 0.45 + j * 0.06), slide: 0 } : Z })
  }
  if (has('turret')) {
    out.push({ name: 'M_Turret_Left', dur: 1.6, frame: (t, j) => of('turret')(j) ? { rot: pulse(t, 0, 1.2), slide: 0 } : Z })
    out.push({ name: 'M_Turret_Right', dur: 1.6, frame: (t, j) => of('turret')(j) ? { rot: -pulse(t, 0, 1.2), slide: 0 } : Z })
    out.push({ name: 'M_Turret_Scan', dur: 4, frame: (t, j) => of('turret')(j) ? { rot: 0.5 * Math.sin(t / 4 * Math.PI * 2), slide: 0 } : Z })
  }
  if (has('barrel')) {
    const kick = (t: number): number => t < 0.05 ? t / 0.05 : Math.max(0, 1 - (t - 0.05) / 0.5)
    out.push({ name: 'M_Barrel_Aim_Up', dur: 1.2, frame: (t, j) => of('barrel')(j) ? { rot: pulse(t, 0, 0.9), slide: 0 } : Z })
    out.push({ name: 'M_Fire', dur: 1, frame: (t, j) => of('barrel')(j) ? { rot: 0, slide: kick(t) } : Z, body: t => ({ pitch: -2.5 * kick(t) * Math.cos(t * 18) }) })
    if (has('turret')) {
      out.push({ name: 'M_Turn_Aim_Fire', dur: 2.6, frame: (t, j) => of('turret')(j) ? { rot: -pulse(t, 0, 0.9) * 0.6, slide: 0 } : of('barrel')(j) ? { rot: pulse(t, 0.6, 1.2) * 0.6, slide: t > 1.5 ? kick(t - 1.5) : 0 } : Z, body: t => ({ pitch: t > 1.5 ? -2.5 * kick(t - 1.5) * Math.cos((t - 1.5) * 18) : 0 }) })
    }
  }
  if (has('blade')) {
    out.push({ name: 'M_Blade_Raise', dur: 1.2, frame: (t, j) => of('blade')(j) ? { rot: pulse(t, 0, 1), slide: pulse(t, 0, 1) } : Z })
    out.push({ name: 'M_Blade_Lower', dur: 1.2, frame: (t, j) => of('blade')(j) ? { rot: 1 - pulse(t, 0, 1), slide: 1 - pulse(t, 0, 1) } : Z })
    out.push({ name: 'M_Blade_Push', dur: 2.5, frame: (_t, j) => of('blade')(j) ? { rot: -0.3, slide: 0 } : Z, body: t => ({ speed: 0.5, pitch: 1.2 + 0.5 * Math.sin(t * 13), lift: 0.004 * Math.sin(t * 21) }) })
  }
  if (has('boom')) {
    out.push({ name: 'M_Boom_Raise', dur: 2, frame: (t, j) => of('boom')(j) ? { rot: pulse(t, 0, 1.7), slide: 0 } : Z })
    out.push({ name: 'M_Boom_Lower', dur: 2, frame: (t, j) => of('boom')(j) ? { rot: 1 - pulse(t, 0, 1.7), slide: 0 } : Z })
  }
  if (has('arm')) {
    out.push({ name: 'M_Arm_In', dur: 1.6, frame: (t, j) => of('arm')(j) ? { rot: pulse(t, 0, 1.3), slide: 0 } : Z })
    out.push({ name: 'M_Arm_Out', dur: 1.6, frame: (t, j) => of('arm')(j) ? { rot: 1 - pulse(t, 0, 1.3), slide: 0 } : Z })
  }
  if (has('bucket')) {
    out.push({ name: 'M_Bucket_Curl', dur: 1.2, frame: (t, j) => of('bucket')(j) ? { rot: pulse(t, 0, 0.9), slide: 0 } : Z })
    out.push({ name: 'M_Bucket_Dump', dur: 1.4, frame: (t, j) => of('bucket')(j) ? { rot: 1 - pulse(t, 0, 0.5) * 1.5, slide: 0 } : Z, body: t => ({ roll: 0.4 * Math.sin(t * 20) * Math.exp(-t * 4) }) })
  }
  if (has('boom') && (has('arm') || has('bucket'))) {
    // excavator: dig, lift, swing, dump, swing back
    const tur = has('turret')
    out.push({
      name: 'M_Dig_Cycle',
      dur: tur ? 9 : 6,
      frame: (t, j) => {
        const k = mechs[j].kind
        if (k === 'boom') return { rot: 0.3 - pulse(t, 0, 1.2) * 0.8 + pulse(t, 2.6, 3.8) * 1.1 - (tur ? pulse(t, 7.5, 8.6) * 0.6 : pulse(t, 4.8, 5.8) * 0.6), slide: 0 }
        if (k === 'arm') return { rot: pulse(t, 1, 2.4) - pulse(t, tur ? 5.4 : 3.8, tur ? 6.2 : 4.6) * 0.8, slide: 0 }
        if (k === 'bucket') return { rot: pulse(t, 1.4, 2.6) - pulse(t, tur ? 5.6 : 4, tur ? 6.4 : 4.8) * 1.4 + pulse(t, tur ? 7 : 5.2, tur ? 7.8 : 5.8) * 0.4, slide: 0 }
        if (k === 'turret' && tur) return { rot: pulse(t, 3.6, 5.2) - pulse(t, 6.8, 8.6), slide: 0 }
        return Z
      },
      body: t => ({ pitch: (t > 1.2 && t < 2.6 ? 0.8 * Math.sin((t - 1.2) * 9) * Math.exp(-(t - 1.2) * 2) : 0) })
    })
  }
  if (has('spin')) {
    const turns = (j: number): number => Math.max(0.1, (mechs[j].angle ?? 100) / 100) // turns per second
    // whole turns per loop: the clip loops without a jump
    out.push({ name: 'M_Spin', dur: 2, frame: (t, j) => of('spin')(j) ? { rot: Math.round(turns(j) * 2) / 2 * t, slide: 0 } : Z })
    out.push({ name: 'M_Spin_Up', dur: 3, frame: (t, j) => of('spin')(j) ? { rot: turns(j) * (t < 2 ? t * t / 4 : 1 + (t - 2)), slide: 0 } : Z })
    out.push({ name: 'M_Spin_Down', dur: 3, frame: (t, j) => of('spin')(j) ? { rot: turns(j) * (t < 2 ? t - t * t / 4 : 1), slide: 0 } : Z })
  }
  if (has('slide')) {
    out.push({ name: 'M_Slide_Out', dur: 1.2, frame: (t, j) => of('slide')(j) ? { rot: 0, slide: pulse(t, 0, 1) } : Z })
    out.push({ name: 'M_Slide_In', dur: 1.2, frame: (t, j) => of('slide')(j) ? { rot: 0, slide: 1 - pulse(t, 0, 1) } : Z })
    out.push({ name: 'M_Slide_Pump', dur: 2, frame: (t, j) => of('slide')(j) ? { rot: 0, slide: 0.5 - 0.5 * Math.cos(t * Math.PI) } : Z })
  }
  if (has('wobble')) {
    out.push({ name: 'M_Wobble', dur: 2, frame: (t, j) => of('wobble')(j) ? { rot: 0.6 * Math.sin(t * Math.PI * 2) + 0.25 * Math.sin(t * Math.PI * 6), slide: 0 } : Z })
    out.push({ name: 'M_Wobble_Hit', dur: 2, frame: (t, j) => of('wobble')(j) ? { rot: Math.sin(t * 14) * Math.exp(-t * 2.2), slide: 0 } : Z })
  }
  if (has('hook') || has('cable')) {
    const hook = (j: number): boolean => of('hook')(j) || of('cable')(j)
    out.push({ name: 'M_Hook_Lower', dur: 2, frame: (t, j) => hook(j) ? { rot: 0.15 * Math.sin(t * 5) * (1 - pulse(t, 1.4, 2)), slide: pulse(t, 0, 1.6) } : Z })
    out.push({ name: 'M_Hook_Raise', dur: 2, frame: (t, j) => hook(j) ? { rot: 0.15 * Math.sin(t * 5) * (1 - pulse(t, 1.4, 2)), slide: 1 - pulse(t, 0, 1.6) } : Z })
    out.push({ name: 'M_Hook_Swing', dur: 2, frame: (t, j) => hook(j) ? { rot: Math.sin(t / 2 * Math.PI * 2), slide: 0.5 } : Z })
  }
  if (has('turret') && (has('hook') || has('cable'))) {
    // a full crane cycle: lower hook, lift, slew 90°, set down
    out.push({
      name: 'M_Crane_Cycle',
      dur: 8,
      frame: (t, j) => {
        const m = mechs[j].kind
        if (m === 'turret') return { rot: pulse(t, 3, 5.2) * 1, slide: 0 }
        if (m === 'boom') return { rot: pulse(t, 2.2, 3) * 0.5 - pulse(t, 6, 7) * 0.2, slide: 0 }
        if (m === 'hook' || m === 'cable') return { rot: m === 'hook' ? 0.12 * Math.sin(t * 4) : 0, slide: pulse(t, 0, 1.6) - pulse(t, 1.8, 3) + pulse(t, 5.4, 7) }
        return Z
      }
    })
  }
  return out
}
