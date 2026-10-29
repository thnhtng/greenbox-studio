/*
 * Drive a vehicle rigged in Greenbox's Vehicles tab (bones: root, body, wheel_* / drum_*, clips 01_Idle…):
 *   W / S  throttle / brake + reverse · A / D steer · Space handbrake
 * The code moves the vehicle; the clips only animate it (wheel spin, body roll), picked by speed and steering.
 */
import * as THREE from 'three'

export function is_vehicle (model: THREE.Object3D, clips: THREE.AnimationClip[]): boolean {
  let body = false; let wheels = 0
  model.traverse(o => { if (o.name === 'body') body = true; if (/^(wheel|drum)_/.test(o.name)) wheels++ })
  return body && wheels > 0 && clips.some(c => /^0\d_(Idle|Drive)/.test(c.name))
}

export interface DriveInput { throttle: number, steer: number, brake: boolean }

export class VehicleDriver {
  public readonly root = new THREE.Group()
  public yaw = 0
  public speed = 0 // m/s, + forward
  public ground_at: ((x: number, z: number, y: number) => number) | null = null
  public move_filter: ((from: THREE.Vector3, to: THREE.Vector3) => void) | null = null
  private readonly mixer: THREE.AnimationMixer
  private readonly by = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private readonly max_speed: number
  private readonly tracked: boolean

  constructor (model: THREE.Object3D, clips: THREE.AnimationClip[], private readonly length: number) {
    this.root.add(model)
    this.mixer = new THREE.AnimationMixer(model)
    clips.forEach(c => this.by.set(c.name.replace(/^\d\d_/, ''), this.mixer.clipAction(c)))
    this.tracked = clips.some(c => /^T_Pivot/.test(c.name))
    const heavy = this.tracked || clips.some(c => /^(R_|K_)/.test(c.name))
    this.max_speed = length * (heavy ? 2 : 5)
    this.play('Idle_Jiggle')
  }

  public state (): string { return `${(this.speed * 3.6).toFixed(0)} km/h` }

  private play (name: string, fade = 0.3, scale = 1): void {
    const a = this.by.get(name) ?? this.by.get('Idle_Jiggle'); if (a === undefined) return
    a.timeScale = scale
    if (a === this.current) return
    a.reset().play()
    if (this.current !== null) this.current.crossFadeTo(a, fade, false)
    this.current = a
  }

  public update (dt: number, input: DriveInput): void {
    const acc = this.max_speed * (this.tracked ? 0.5 : 0.8)
    if (input.brake) this.speed *= Math.exp(-4 * dt)
    else if (input.throttle !== 0) {
      const braking = Math.sign(input.throttle) !== Math.sign(this.speed) && Math.abs(this.speed) > 0.3
      this.speed += input.throttle * acc * (braking ? 2.2 : 1) * dt
    } else this.speed *= Math.exp(-0.9 * dt)
    this.speed = Math.max(-this.max_speed * 0.35, Math.min(this.max_speed, this.speed))
    // turning: cars need speed to turn, tracked vehicles turn on the spot
    const turn = this.tracked ? 1.0 : 1.1 * Math.min(1, Math.abs(this.speed) / (this.length * 1.2))
    this.yaw += -input.steer * turn * dt * (this.speed < -0.05 && !this.tracked ? -1 : 1)
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    const next = this.root.position.clone().addScaledVector(fwd, this.speed * dt)
    if (this.move_filter !== null) this.move_filter(this.root.position, next)
    if (next.distanceTo(this.root.position) < Math.abs(this.speed * dt) * 0.5) this.speed *= 0.3 // hit something
    this.root.position.copy(next)
    const floor = this.ground_at !== null ? this.ground_at(next.x, next.z, next.y) : 0
    this.root.position.y += (floor - this.root.position.y) * (1 - Math.exp(-12 * dt))
    this.root.rotation.y = this.yaw
    // animation
    const v = Math.abs(this.speed) / this.max_speed
    const k = Math.max(0.3, Math.min(2.5, Math.abs(this.speed) / (this.length * 1.6)))
    if (this.tracked && Math.abs(this.speed) < 0.3 && input.steer !== 0) this.play(input.steer < 0 ? 'T_Pivot_Turn_Left' : 'T_Pivot_Turn_Right')
    else if (Math.abs(this.speed) < 0.2) this.play(input.throttle !== 0 ? 'Idle_Rev' : 'Idle_Jiggle')
    else if (this.speed < 0) this.play('Reverse', 0.3, k)
    else if (input.steer !== 0 && v > 0.15 && (this.by.has('Turn_Left') || this.by.has('T_Turn_Left'))) {
      const n = this.by.has('Turn_Left') ? 'Turn' : 'T_Turn'
      this.play(input.steer < 0 ? `${n}_Left` : `${n}_Right`, 0.3, k)
    }
    else if (v > 0.7 && this.by.has('Drive_Fast')) this.play('Drive_Fast', 0.3, k / 3)
    else if (v > 0.25) this.play('Drive', 0.3, k)
    else this.play(this.by.has('Drive_Slow') ? 'Drive_Slow' : 'Drive', 0.3, k / 0.4)
    this.mixer.update(dt)
  }
}
