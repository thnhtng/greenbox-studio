/*
 * Caterpillar tracks (tank, bulldozer, excavator).
 *
 * Why the old rig only spun "the round blocks": a track is not a wheel, it is a belt that slides around the
 * wheels. Here a track becomes a chain of bones placed along the belt's loop (seen from the side); every point
 * of the belt is skinned to the two nearest chain bones. The animation moves each bone along the loop by the
 * distance the vehicle travels, turning it with the loop, so links climb over the sprocket, run along the
 * top and come down at the idler — and it exports to GLB / FBX / Blender like any bone animation.
 *
 * Finding the belt on a model that is one single block: per side, take the side view (Z, Y) of the wheels
 * found by the scan, build the hull around all wheel circles, and keep the points of that side that lie in a
 * thin band around the hull edge but not inside a wheel. Separate link pieces are taken whole.
 */
import * as THREE from 'three'

export type P2 = [number, number] // (z, y)

export function hull2 (pts: P2[]): P2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: P2, a: P2, b: P2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: P2[] = []; const up: P2[] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  lo.pop(); up.pop()
  return lo.concat(up) // counter-clockwise
}

function area (p: P2[]): number { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1] } return a / 2 }

/** rounder corners */
export function chaikin (p: P2[], n = 2): P2[] {
  let c = p
  for (let k = 0; k < n; k++) {
    const o: P2[] = []
    for (let i = 0; i < c.length; i++) {
      const a = c[i]; const b = c[(i + 1) % c.length]
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    c = o
  }
  return c
}

/** closed loop with arc length; oriented so that +s is the belt motion when driving forward (+Z): bottom runs backwards */
export class Loop {
  public readonly pts: P2[]
  public readonly cum: number[] = [0]
  public readonly len: number
  constructor (pts: P2[]) {
    this.pts = area(pts) > 0 ? pts.slice().reverse() : pts.slice() // clockwise in (z right, y up)
    for (let i = 0; i < this.pts.length; i++) {
      const a = this.pts[i]; const b = this.pts[(i + 1) % this.pts.length]
      this.cum.push(this.cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]))
    }
    this.len = this.cum[this.cum.length - 1]
  }

  /** point and tangent at arc length s (wraps) */
  public at (s: number): { p: P2, t: P2 } {
    s = ((s % this.len) + this.len) % this.len
    let lo = 0; let hi = this.pts.length - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.cum[m] <= s) lo = m; else hi = m - 1 }
    const a = this.pts[lo]; const b = this.pts[(lo + 1) % this.pts.length]
    const seg = Math.max(1e-9, this.cum[lo + 1] - this.cum[lo]); const f = (s - this.cum[lo]) / seg
    const tz = (b[0] - a[0]) / seg; const ty = (b[1] - a[1]) / seg
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [tz, ty] }
  }

  /** arc length of the closest loop point */
  public param (q: P2): number {
    let best = 0; let bd = Infinity
    for (let i = 0; i < this.pts.length; i++) {
      const a = this.pts[i]; const b = this.pts[(i + 1) % this.pts.length]
      const dz = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dz * dz + dy * dy || 1e-12
      let f = ((q[0] - a[0]) * dz + (q[1] - a[1]) * dy) / L2; f = Math.max(0, Math.min(1, f))
      const d = (a[0] + dz * f - q[0]) ** 2 + (a[1] + dy * f - q[1]) ** 2
      if (d < bd) { bd = d; best = this.cum[i] + f * (this.cum[i + 1] - this.cum[i]) }
    }
    return best
  }

  /** signed distance to the loop edge (negative inside) */
  public sdist (q: P2): number {
    let bd = Infinity; let inside = false
    for (let i = 0, j = this.pts.length - 1; i < this.pts.length; j = i++) {
      const a = this.pts[i]; const b = this.pts[j]
      if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
      const dz = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dz * dz + dy * dy || 1e-12
      let f = ((q[0] - a[0]) * dz + (q[1] - a[1]) * dy) / L2; f = Math.max(0, Math.min(1, f))
      bd = Math.min(bd, Math.hypot(a[0] + dz * f - q[0], a[1] + dy * f - q[1]))
    }
    return inside ? -bd : bd
  }
}

/** bone rotation (about X) that points the bone's +Z along the loop tangent (tz, ty) */
export function tangent_quat (t: P2): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(-t[1], t[0]))
}

export interface WheelLike { center: THREE.Vector3, radius: number }

/** the band around the wheels of one side where its belt must be */
export function wheel_band (wheels: WheelLike[]): { loop: Loop, thick: number, x0: number, x1: number } | null {
  if (wheels.length < 2) return null
  const pts: P2[] = []
  for (const w of wheels) for (let a = 0; a < 24; a++) pts.push([w.center.z + Math.cos(a / 24 * Math.PI * 2) * w.radius, w.center.y + Math.sin(a / 24 * Math.PI * 2) * w.radius])
  const r = wheels.reduce((s, w) => s + w.radius, 0) / wheels.length
  const xs = wheels.map(w => w.center.x)
  return { loop: new Loop(hull2(pts)), thick: r * 0.62, x0: Math.min(...xs) - r * 0.75, x1: Math.max(...xs) + r * 0.75 }
}

/** is this point (vehicle space) part of the belt around these wheels? */
export function on_belt (p: THREE.Vector3, wheels: WheelLike[], band: NonNullable<ReturnType<typeof wheel_band>>): boolean {
  if (p.x < band.x0 || p.x > band.x1) return false
  const d = band.loop.sdist([p.z, p.y])
  if (d > band.thick || d < -band.thick * 0.6) return false
  for (const w of wheels) if (Math.hypot(p.z - w.center.z, p.y - w.center.y) < w.radius * 0.92) return false
  return true
}

/** the loop a belt runs on, from its own points (side view hull, slightly rounded) */
export function belt_loop (pts: P2[]): Loop | null {
  if (pts.length < 8) return null
  // thin the cloud: hull only needs the extremes
  const h = hull2(pts)
  if (h.length < 3) return null
  return new Loop(chaikin(h, 2))
}
