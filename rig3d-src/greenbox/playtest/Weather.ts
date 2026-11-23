/*
 * ☁ Weather + time of day for Play test: clear / cloudy / rain / storm / snow / fog, and day / sunset / night.
 * It sets the sky colour, the fog, the two lights, and draws rain streaks or snow flakes in a box that follows the
 * camera (cheap: one THREE.Points / LineSegments, moved on the GPU side by updating positions each frame).
 */
import * as THREE from 'three'

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog'
export type DayTime = 'day' | 'sunset' | 'night'

interface Look { sky: number, hemi: number, hemiGround: number, hemiI: number, sun: number, sunI: number }
const TIME: Record<DayTime, Look> = {
  day: { sky: 0x9fc6e8, hemi: 0xffffff, hemiGround: 0x6a7a5a, hemiI: 1.4, sun: 0xffffff, sunI: 2.2 },
  sunset: { sky: 0xf2a97a, hemi: 0xffd9b8, hemiGround: 0x5a4a4a, hemiI: 1.1, sun: 0xffa060, sunI: 1.7 },
  night: { sky: 0x1b2440, hemi: 0x8899cc, hemiGround: 0x20242e, hemiI: 0.55, sun: 0xa8b8ff, sunI: 0.45 }
}
/** what each weather does to the look: sky mixed toward grey, light scale, fog distance scale */
const WX: Record<WeatherKind, { grey: number, light: number, fog: number }> = {
  clear: { grey: 0, light: 1, fog: 1 },
  cloudy: { grey: 0.45, light: 0.8, fog: 0.85 },
  rain: { grey: 0.6, light: 0.65, fog: 0.6 },
  storm: { grey: 0.78, light: 0.45, fog: 0.45 },
  snow: { grey: 0.55, light: 0.85, fog: 0.55 },
  fog: { grey: 0.65, light: 0.75, fog: 0.22 }
}

export class Weather {
  public kind: WeatherKind = 'clear'
  public time: DayTime = 'day'
  /** fog distances are multiplied by this (the app sets near / far each frame from the camera distance) */
  public fog_scale = 1
  private drops: THREE.LineSegments | THREE.Points | null = null
  private vel: Float32Array = new Float32Array(0)
  private flash = 0
  private readonly box = 26 // metres around the camera

  constructor (private readonly scene: THREE.Scene, private readonly hemi: THREE.HemisphereLight, private readonly sun: THREE.DirectionalLight) {}

  public set (kind: WeatherKind, time: DayTime): void {
    this.kind = kind; this.time = time
    const t = TIME[time]; const w = WX[kind]
    const grey = new THREE.Color(time === 'night' ? 0x2a2f3a : 0x9aa3ad)
    const sky = new THREE.Color(t.sky).lerp(grey, w.grey)
    this.scene.background = sky
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(sky)
    this.hemi.color.setHex(t.hemi); this.hemi.groundColor.setHex(t.hemiGround); this.hemi.intensity = t.hemiI * w.light
    this.sun.color.setHex(t.sun); this.sun.intensity = t.sunI * w.light * (kind === 'clear' ? 1 : 0.7)
    this.sun.castShadow = kind === 'clear' || kind === 'cloudy'
    this.fog_scale = w.fog
    this.make_drops()
  }

  private make_drops (): void {
    if (this.drops !== null) { this.scene.remove(this.drops); this.drops.geometry.dispose(); (this.drops.material as THREE.Material).dispose(); this.drops = null }
    const rain = this.kind === 'rain' || this.kind === 'storm'; const snow = this.kind === 'snow'
    if (!rain && !snow) return
    const N = rain ? (this.kind === 'storm' ? 2600 : 1600) : 1400; const B = this.box
    const pos = new Float32Array(N * (rain ? 6 : 3)); this.vel = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * B * 2; const y = Math.random() * 18; const z = (Math.random() - 0.5) * B * 2
      if (rain) { pos.set([x, y, z, x + 0.05, y + 0.55, z], i * 6); this.vel[i] = 16 + Math.random() * 8 } else { pos.set([x, y, z], i * 3); this.vel[i] = 0.8 + Math.random() * 0.9 }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.drops = rain
      ? new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.55, fog: true }))
      : new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.13, transparent: true, opacity: 0.95, depthWrite: false, fog: true }))
    this.drops.frustumCulled = false; this.drops.name = 'Weather'; this.drops.userData.no_pick = true; this.drops.raycast = () => {}
    this.scene.add(this.drops)
  }

  /** every frame: drops fall and wrap round the camera; storms flash */
  public update (dt: number, cam: THREE.Vector3): void {
    if (this.drops !== null) {
      const a = this.drops.geometry.getAttribute('position') as THREE.BufferAttribute; const p = a.array as Float32Array
      const rain = this.drops instanceof THREE.LineSegments; const st = rain ? 6 : 3; const B = this.box; const t = performance.now() / 1000
      this.drops.position.set(0, 0, 0)
      for (let i = 0; i < this.vel.length; i++) {
        const o = i * st; let x = p[o]; let y = p[o + 1]; let z = p[o + 2]
        y -= this.vel[i] * dt
        if (!rain) { x += Math.sin(t * 0.9 + i) * 0.3 * dt; z += Math.cos(t * 0.7 + i * 1.3) * 0.3 * dt }
        // keep each drop within the box around the camera (it falls back in from the top)
        if (y < cam.y - 4) y = cam.y + 14 + Math.random() * 4
        if (x < cam.x - B) x += B * 2; else if (x > cam.x + B) x -= B * 2
        if (z < cam.z - B) z += B * 2; else if (z > cam.z + B) z -= B * 2
        p[o] = x; p[o + 1] = y; p[o + 2] = z
        if (rain) { p[o + 3] = x + 0.05; p[o + 4] = y + 0.55; p[o + 5] = z }
      }
      a.needsUpdate = true
    }
    if (this.kind === 'storm') {
      this.flash = Math.max(0, this.flash - dt * 4)
      if (this.flash <= 0 && Math.random() < dt * 0.25) this.flash = 1
      const base = TIME[this.time].hemiI * WX.storm.light
      this.hemi.intensity = base + this.flash * (this.flash > 0.6 ? 2.5 : 0.6)
    }
  }
}
