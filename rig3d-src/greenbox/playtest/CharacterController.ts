/*
 * Game-style character controller for the play-test tab: moves a rigged model on the ground and picks the
 * animation for what it is doing (idle / walk / run / sprint / jump / roll / attack combo / block / crouch / hit).
 * The model is moved by code, so clips are used in place (horizontal root motion is removed on load).
 */
import * as THREE from 'three'
import { type Action, type ClipTable } from './ClipMap.ts'

export interface Input {
  move: THREE.Vector2 // x = right, y = forward (camera relative), length 0..1
  sprint: boolean
  walk: boolean
  jump: boolean // pressed this frame
  roll: boolean // pressed this frame
  attack: boolean // pressed this frame
  block: boolean // held
  crouch_toggle: boolean // pressed this frame
  hit_test: boolean // pressed this frame
}

type Busy = 'none' | 'jump' | 'land' | 'roll' | 'attack' | 'hit' | 'climb'

export class CharacterController {
  public readonly root = new THREE.Group() // moves + turns; the model sits inside
  public speed_scale = 1 // world units per "metre" (characters are normalised to 1.8 m)
  public yaw = 0
  public on_hit_frame: ((reach: number) => void) | null = null
  public on_footstep: (() => void) | null = null
  /** floor height under (x, z) that can be reached from height y (props, hills); null = flat ground at 0 */
  public ground_at: ((x: number, z: number, y: number) => number) | null = null
  /** may pull `to` back (walls) before the character moves there */
  public move_filter: ((from: THREE.Vector3, to: THREE.Vector3) => void) | null = null

  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<Action, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private current_name: Action | null = null
  private vel = new THREE.Vector3()
  private vy = 0
  private on_ground = true
  private busy: Busy = 'none'
  private busy_t = 0
  private busy_len = 0
  private combo = 0
  private combo_queued = false
  private hit_done = false
  private crouch = false
  private roll_dir = new THREE.Vector3()
  private block_held = false
  private climb: { from: THREE.Vector3, to: THREE.Vector3, wall: number, up: number } | null = null

  constructor (model: THREE.Object3D, private readonly clips: ClipTable) {
    this.root.add(model)
    this.mixer = new THREE.AnimationMixer(model)
    ;(Object.keys(clips) as Action[]).forEach(a => {
      const c = clips[a]; if (c === undefined) return
      const act = this.mixer.clipAction(c)
      act.enabled = true
      this.actions.set(a, act)
    })
    this.play('idle', 0)
  }

  public has (a: Action): boolean { return this.actions.has(a) }
  public state (): string { return this.busy !== 'none' ? this.busy : (this.current_name ?? '') }

  private play (a: Action, fade = 0.2, once = false, time_scale = 1): number {
    const act = this.actions.get(a)
    if (act === undefined) return 0
    if (this.current_name === a && !once) { act.timeScale = time_scale; return act.getClip().duration }
    act.reset()
    act.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    act.clampWhenFinished = once
    act.timeScale = time_scale
    act.play()
    if (this.current !== null && this.current !== act) this.current.crossFadeTo(act, fade, false)
    else act.fadeIn(fade)
    this.current = act; this.current_name = a
    return act.getClip().duration / Math.max(0.01, time_scale)
  }

  private start_busy (b: Busy, len: number): void { this.busy = b; this.busy_t = 0; this.busy_len = Math.max(0.05, len) }

  public update (dt: number, input: Input, cam_yaw: number): void {
    const S = this.speed_scale
    const g = 9.8 * 2.2 * S
    if (this.busy === 'climb' && this.climb !== null) { this.update_climb(dt); this.mixer.update(dt); return }
    // ---- intent ----
    const want = new THREE.Vector3(input.move.x, 0, -input.move.y)
    if (want.lengthSq() > 1) want.normalize()
    want.applyAxisAngle(new THREE.Vector3(0, 1, 0), cam_yaw)
    const moving = want.lengthSq() > 0.01
    if (input.crouch_toggle) this.crouch = !this.crouch
    this.block_held = input.block && this.busy === 'none' && this.on_ground

    // ---- one-shot actions ----
    if (this.busy === 'none' || this.busy === 'land') {
      if (input.jump && this.on_ground) {
        this.vy = Math.sqrt(2 * g * 1.0 * S); this.on_ground = false; this.crouch = false
        if (this.has('jump_start')) this.play('jump_start', 0.08, true, 1.3)
        else this.play('jump', 0.08, true)
        this.start_busy('jump', 99)
      } else if (input.roll && this.on_ground && this.has('roll')) {
        this.roll_dir.copy(moving ? want : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))).normalize()
        this.yaw = Math.atan2(this.roll_dir.x, this.roll_dir.z)
        const len = this.play('roll', 0.08, true, 1.25)
        this.start_busy('roll', len * 0.9); this.crouch = false
      } else if (input.attack && this.on_ground) {
        this.combo = 0; this.attack()
      } else if (input.hit_test && this.has('hit')) {
        this.start_busy('hit', this.play('hit', 0.06, true))
      }
    } else if (this.busy === 'attack' && input.attack) {
      this.combo_queued = true
    }

    // ---- movement ----
    let speed = 0
    if (this.busy === 'roll') {
      speed = 4 * S * (1 - Math.max(0, this.busy_t / this.busy_len - 0.6) * 2.2)
      this.vel.copy(this.roll_dir).multiplyScalar(Math.max(0, speed))
    } else {
      const base = this.crouch ? 1.3 : input.walk ? 1.7 : input.sprint ? 7 : 4.2
      const slow = this.busy === 'attack' || this.busy === 'hit' ? 0.15 : this.block_held ? 0.35 : this.busy === 'land' ? 0.5 : 1
      const target = moving ? want.clone().multiplyScalar(base * S * slow) : new THREE.Vector3()
      const acc = this.on_ground ? 12 : 3
      this.vel.lerp(target, 1 - Math.exp(-acc * dt))
      speed = this.vel.length()
      if (moving && this.busy !== 'attack') {
        const yaw_t = Math.atan2(want.x, want.z)
        let d = yaw_t - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d))
        this.yaw += d * (1 - Math.exp(-14 * dt))
      }
    }
    const next = this.root.position.clone().addScaledVector(this.vel, dt)
    if (this.move_filter !== null) this.move_filter(this.root.position, next)
    this.root.position.copy(next)
    // floor: flat ground, or the top of a prop / hill under the feet
    const p = this.root.position
    const floor = this.ground_at !== null ? this.ground_at(p.x, p.z, p.y) : 0
    if (this.on_ground && this.vy === 0) {
      if (p.y - floor > 0.12 * S) this.on_ground = false // walked off an edge: fall
      else p.y = floor // follow slopes and small steps
    }
    // gravity
    if (!this.on_ground || this.vy !== 0) {
      this.vy -= g * dt
      this.root.position.y += this.vy * dt
      if (this.root.position.y <= floor) {
        this.root.position.y = floor; this.vy = 0
        if (!this.on_ground) {
          this.on_ground = true
          if (this.has('jump_land')) { this.play('jump_land', 0.06, true, 1.4); this.start_busy('land', 0.28) } else { this.busy = 'none' }
        }
      } else if (this.busy === 'jump' && this.vy < 0.4 * Math.sqrt(2 * g * S) && this.has('jump_air') && this.current_name !== 'jump_air') {
        this.play('jump_air', 0.15)
      }
    }
    this.root.rotation.y = this.yaw

    // ---- timers / transitions ----
    if (this.busy !== 'none' && this.busy !== 'jump') {
      this.busy_t += dt
      if (this.busy === 'attack' && !this.hit_done && this.busy_t > this.busy_len * 0.4) { this.hit_done = true; this.on_hit_frame?.(1.3 * S) }
      if (this.busy_t >= this.busy_len) {
        if (this.busy === 'attack' && this.combo_queued) { this.combo = (this.combo + 1) % 3; this.attack() } else this.busy = 'none'
      }
    }
    if (this.busy === 'none' && this.on_ground) this.locomotion(speed / S)
    this.mixer.update(dt)
  }

  public is_climbing (): boolean { return this.busy === 'climb' }
  public is_on_ground (): boolean { return this.on_ground && this.busy !== 'climb' }

  /**
   * climb onto a ledge whose top is `to` (world). Tall walls: "climb wall" loop up to arm's reach, then the
   * "climb up" clip pulls the body over the edge. The code moves the character; the clips are kept in place.
   */
  public start_climb (to: THREE.Vector3): void {
    if (this.busy === 'climb') return
    const S = this.speed_scale
    const from = this.root.position.clone()
    const h = to.y - from.y
    const wall_rise = this.has('climb_wall') && h > 1.4 * S ? h - 1.0 * S : 0
    const wall = wall_rise / (1.3 * S) // seconds on the wall
    const up = this.has('climb_up') ? Math.max(0.6, this.actions.get('climb_up')!.getClip().duration / 1.2) : 0.55
    this.climb = { from, to: to.clone(), wall, up }
    this.vel.set(0, 0, 0); this.vy = 0; this.on_ground = false; this.crouch = false
    this.yaw = Math.atan2(to.x - from.x, to.z - from.z)
    this.root.rotation.y = this.yaw
    if (wall > 0) this.play('climb_wall', 0.15)
    else if (this.has('climb_up')) this.play('climb_up', 0.1, true, 1.2)
    else this.play(this.has('jump_start') ? 'jump_start' : 'jump', 0.08, true)
    this.start_busy('climb', wall + up)
  }

  private update_climb (dt: number): void {
    const c = this.climb!; const S = this.speed_scale
    this.busy_t += dt
    const t = this.busy_t; const p = this.root.position
    const smooth = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k) }
    if (t < c.wall) {
      p.set(c.from.x, c.from.y + (c.to.y - c.from.y - 1.0 * S) * (t / c.wall), c.from.z)
      return
    }
    if (c.wall > 0 && this.current_name === 'climb_wall') {
      if (this.has('climb_up')) this.play('climb_up', 0.12, true, 1.2); else this.play('jump', 0.1, true)
    }
    const u = (t - c.wall) / c.up
    const y0 = c.wall > 0 ? c.to.y - 1.0 * S : c.from.y
    p.set(c.from.x + (c.to.x - c.from.x) * smooth((u - 0.45) / 0.55), y0 + (c.to.y - y0) * smooth(u / 0.7), c.from.z + (c.to.z - c.from.z) * smooth((u - 0.45) / 0.55))
    if (u >= 1) {
      p.copy(c.to); this.climb = null; this.busy = 'none'; this.on_ground = true; this.vy = 0
      this.play('idle', 0.2)
    }
  }

  private attack (): void {
    const order: Action[] = ['attack1', 'attack2', 'attack3']
    let a = order[this.combo]
    if (!this.has(a)) a = 'attack1'
    if (!this.has(a)) return
    this.combo_queued = false; this.hit_done = false
    this.start_busy('attack', this.play(a, 0.08, true, 1.15) * 0.92)
  }

  private locomotion (speed: number): void {
    if (this.block_held && this.has('block')) {
      if (this.current_name !== 'block') this.play('block', 0.12, true)
      // hold the guard pose: stop once the clip reaches its "shield up" part
      const act = this.actions.get('block')!
      if (act.time > act.getClip().duration * 0.4) act.timeScale = 0
      return
    }
    if (this.crouch && this.has('crouch_idle')) {
      if (speed > 0.25 && this.has('crouch_walk')) this.play('crouch_walk', 0.2, false, Math.min(1.4, Math.max(0.6, speed / 1.3)))
      else this.play('crouch_idle', 0.2)
      return
    }
    if (speed < 0.25) this.play('idle', 0.25)
    else if (speed < 2.6 && this.has('walk')) this.play('walk', 0.2, false, Math.min(1.4, Math.max(0.7, speed / 1.7)))
    else if (speed < 5.6 || !this.has('sprint')) this.play(this.has('run') ? 'run' : 'walk', 0.2, false, Math.min(1.5, Math.max(0.7, speed / 4.2)))
    else this.play('sprint', 0.2, false, Math.min(1.4, Math.max(0.8, speed / 7)))
  }
}

/** the climb-up clip lifts the hips by itself; the controller moves the character instead, so flatten that rise */
export function strip_vertical_motion (clip: THREE.AnimationClip, model: THREE.Object3D): void {
  const depth = new Map<string, number>()
  model.traverse(o => { if ((o as THREE.Bone).isBone) { let d = 0; let p = o.parent; while (p !== null) { if ((p as THREE.Bone).isBone) d++; p = p.parent } depth.set(o.name, d) } })
  const pos = clip.tracks.filter(t => t.name.endsWith('.position') && depth.has(t.name.slice(0, -9)))
  if (pos.length === 0) return
  const minD = Math.min(...pos.map(t => depth.get(t.name.slice(0, -9))!))
  pos.filter(t => depth.get(t.name.slice(0, -9))! <= minD + 1).forEach(t => {
    const v = t.values; const n = v.length / 3; if (n < 2) return
    const dy = v[(n - 1) * 3 + 1] - v[1]
    for (let i = 0; i < n; i++) v[i * 3 + 1] -= dy * (i / (n - 1))
  })
}

/** keep clips in place: remove the horizontal drift of the top-most moving bone (root / hips) */
export function strip_root_motion (clips: THREE.AnimationClip[], model: THREE.Object3D): void {
  const bones: string[] = []
  model.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o.name) })
  const depth = new Map<string, number>()
  model.traverse(o => { if ((o as THREE.Bone).isBone) { let d = 0; let p = o.parent; while (p !== null) { if ((p as THREE.Bone).isBone) d++; p = p.parent } depth.set(o.name, d) } })
  clips.forEach(c => {
    const pos = c.tracks.filter(t => t.name.endsWith('.position') && depth.has(t.name.slice(0, -9)))
    if (pos.length === 0) return
    const minD = Math.min(...pos.map(t => depth.get(t.name.slice(0, -9))!))
    pos.filter(t => depth.get(t.name.slice(0, -9))! <= minD + 1).forEach(t => {
      const v = t.values; if (v.length < 6) return
      const n = v.length / 3; const x0 = v[0]; const z0 = v[2]
      const dx = v[(n - 1) * 3] - x0; const dz = v[(n - 1) * 3 + 2] - z0
      const span = Math.hypot(dx, dz)
      // only clips that travel (walk/roll root motion); idle sway stays
      let moved = 0; for (let i = 0; i < n; i++) moved = Math.max(moved, Math.hypot(v[i * 3] - x0, v[i * 3 + 2] - z0))
      if (span < 1e-4 && moved < 1e-3) return
      for (let i = 0; i < n; i++) {
        const t01 = n > 1 ? i / (n - 1) : 0
        v[i * 3] -= dx * t01; v[i * 3 + 2] -= dz * t01
      }
    })
  })
}
