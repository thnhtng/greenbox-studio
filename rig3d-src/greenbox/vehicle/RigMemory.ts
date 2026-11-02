/**
 * Rig memory: the vehicle rigs people rated, used to rig the next vehicle of the same shape.
 *
 *   rate      the user gives the finished rig 1–5 stars → one record: the model's shape signature + every part
 *             (wheel / door / bucket…) as a box in size-relative space, with the settings they tuned (hinge, angle…)
 *   recall    a new vehicle: its signature is compared with the records rated 4–5 stars; the closest one (if it is
 *             close enough) gives its vehicle type, the parts the shape scan missed and the tuned settings
 *
 * Kept in this browser (localStorage); Export / Import a .json to share it with the team. Higher scores win:
 * among records of nearly the same shape only the best rated is used, and a newer equal score replaces an older one.
 */
import * as THREE from 'three'
import type { Mech, MechKind } from './Mechanics.ts'

export type RecType = 'car' | 'truck' | 'tracked' | 'roller'
/** a box in size-relative space: x / size.x, y / size.y, z / size.z (the vehicle is centred on x, z, standing on y = 0) */
export type NBox = [number, number, number, number, number, number]
export interface PartRec {
  kind: 'wheel' | MechKind
  name: string
  box: NBox
  wheel?: { c: [number, number, number], r: number, front: boolean }
  mech?: Omit<Mech, 'pivot' | 'name' | 'kind'>
}
export interface RigRec { id: string, file: string, score: number, date: number, type: RecType, sig: number[], parts: PartRec[] }

const KEY = 'gb.vehicle.rigmem'
const MAX = 80
export const MIN_SCORE = 4 // only rigs rated this or better are used for the next ones
export const MIN_SIM = 0.82 // and only when the shape is at least this close

export function load_mem (): RigRec[] { try { const a = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }
function save_mem (a: RigRec[]): void { try { localStorage.setItem(KEY, JSON.stringify(a)) } catch { /* full or blocked */ } }

/**
 * shape signature (every value 0..1): proportions, mesh detail, and two coarse silhouettes
 * (side view 10×5 and top view 10×4: how full each cell is), so a dozer looks like a dozer whatever its size
 */
export function signature (geos: THREE.BufferGeometry[], size: THREE.Vector3): number[] {
  const side = new Float32Array(50); const top = new Float32Array(40); let n = 0
  const sx = Math.max(size.x, 1e-6); const sy = Math.max(size.y, 1e-6); const sz = Math.max(size.z, 1e-6)
  for (const g of geos) {
    const pos = g.getAttribute('position'); const step = Math.max(1, Math.floor(pos.count / 20000))
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i) / sx + 0.5; const y = pos.getY(i) / sy; const z = pos.getZ(i) / sz + 0.5
      const zi = Math.min(9, Math.max(0, Math.floor(z * 10)))
      side[zi * 5 + Math.min(4, Math.max(0, Math.floor(y * 5)))] = 1
      top[zi * 4 + Math.min(3, Math.max(0, Math.floor(x * 4)))] = 1
      n++
    }
  }
  const verts = geos.reduce((a, g) => a + g.getAttribute('position').count, 0)
  return [Math.min(1, sx / sz), Math.min(1, sy / sz), Math.min(1, Math.log10(verts + 1) / 6), ...side, ...top].map(v => +v.toFixed(3))
}

/** 0..1: 1 = same shape */
export function similarity (a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  // proportions count more than single silhouette cells
  let d = 0; let w = 0
  for (let i = 0; i < a.length; i++) { const k = i < 2 ? 8 : i === 2 ? 2 : 1; d += Math.abs(a[i] - b[i]) * k; w += k }
  return 1 - d / w
}

export function nbox (b: THREE.Box3, size: THREE.Vector3): NBox {
  const r = (v: number, s: number): number => +(v / Math.max(s, 1e-6)).toFixed(4)
  return [r(b.min.x, size.x), r(b.min.y, size.y), r(b.min.z, size.z), r(b.max.x, size.x), r(b.max.y, size.y), r(b.max.z, size.z)]
}
export function box_of (n: NBox, size: THREE.Vector3): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(n[0] * size.x, n[1] * size.y, n[2] * size.z), new THREE.Vector3(n[3] * size.x, n[4] * size.y, n[5] * size.z))
}
/** overlap / union of two boxes (0 = apart, 1 = the same) */
export function iou (a: THREE.Box3, b: THREE.Box3): number {
  const i = a.clone().intersect(b); if (i.isEmpty()) return 0
  const v = (x: THREE.Box3): number => { const s = x.getSize(new THREE.Vector3()); return Math.max(s.x, 1e-9) * Math.max(s.y, 1e-9) * Math.max(s.z, 1e-9) }
  return v(i) / (v(a) + v(b) - v(i))
}

/** store a rated rig; returns how many usable (4–5 ★) rigs the memory now has */
export function remember (rec: Omit<RigRec, 'id' | 'date'>): number {
  const all = load_mem()
  const same = all.findIndex(r => r.file === rec.file && similarity(r.sig, rec.sig) > 0.98)
  const full: RigRec = { ...rec, id: Math.random().toString(36).slice(2, 10), date: Date.now() }
  if (same >= 0) all.splice(same, 1)
  all.push(full)
  // over the limit: drop the lowest scores first, then the oldest
  all.sort((p, q) => q.score - p.score || q.date - p.date)
  save_mem(all.slice(0, MAX))
  return all.filter(r => r.score >= MIN_SCORE).length
}

/** the best rated record whose shape is close enough (null = nothing learned for this shape yet) */
export function recall (sig: number[]): { rec: RigRec, sim: number } | null {
  let best: { rec: RigRec, sim: number } | null = null
  for (const rec of load_mem()) {
    if (rec.score < MIN_SCORE) continue
    const sim = similarity(sig, rec.sig); if (sim < MIN_SIM) continue
    // nearly the same shape: the higher score wins, else the closer shape
    if (best === null || (Math.abs(sim - best.sim) < 0.03 ? rec.score > best.rec.score || (rec.score === best.rec.score && rec.date > best.rec.date) : sim > best.sim)) best = { rec, sim }
  }
  return best
}

export function export_mem (): Blob { return new Blob([JSON.stringify({ greenbox_rig_memory: 1, rigs: load_mem() }, null, 1)], { type: 'application/json' }) }
/** merge a shared memory file in; returns how many rigs were added */
export function import_mem (text: string): number {
  const d = JSON.parse(text); const list: RigRec[] = Array.isArray(d) ? d : d.rigs
  if (!Array.isArray(list)) throw new Error('not a rig memory file')
  const all = load_mem(); let n = 0
  for (const r of list) { if (!Array.isArray(r.sig) || !Array.isArray(r.parts) || all.some(q => q.id === r.id)) continue; all.push(r); n++ }
  all.sort((p, q) => q.score - p.score || q.date - p.date); save_mem(all.slice(0, MAX))
  return n
}
