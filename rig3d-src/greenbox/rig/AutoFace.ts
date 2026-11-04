/*
 * 🧭 Turn the model to the blue forward arrow (+Z) by itself, on "Use Your Model" (people and animals).
 *   which axis: a body is wider across the shoulders / hips than front to back -> the narrow horizontal axis
 *   which way:  a skeleton's left / right bones when there is one; else the toes reach further forward than the heels
 *               go back (then the chest / belly vs the back; never the head: hair sticks out behind, nor a cape);
 *               an animal's head end is the higher one
 * It turns with the page's own 90° Y button (so the model is really turned, undo-able like a click) and runs once per
 * new model; the 🧭 button runs it again.
 */
import * as THREE from 'three'
import type { Mesh2MotionEngine } from '../../Mesh2MotionEngine.ts'
import { model_geometries } from './ModelAnalyzer.ts'
import { M } from '../common/lang.ts'

/** the way the model looks, as one of +X, -X, +Z, -Z (null: cannot tell) */
/** from a skeleton: the left bones are on the body's left, so forward = (left - right) × up; toes say it too */
export function facing_from_bones (root: THREE.Object3D): THREE.Vector3 | null {
  root.updateMatrixWorld(true)
  const L = new THREE.Vector3(); const R = new THREE.Vector3(); let nl = 0; let nr = 0
  root.traverse(o => {
    if ((o as THREE.Bone).isBone !== true) return
    const n = o.name; const left = /left|(^|[_.\-\s])l$|_l_|\.l\b/i.test(n); const right = /right|(^|[_.\-\s])r$|_r_|\.r\b/i.test(n)
    if (left === right) return
    const p = o.getWorldPosition(new THREE.Vector3()); if (left) { L.add(p); nl++ } else { R.add(p); nr++ }
  })
  if (nl < 2 || nr < 2) return null
  const side = L.divideScalar(nl).sub(R.divideScalar(nr)); side.y = 0; if (side.lengthSq() < 1e-10) return null
  const f = side.cross(new THREE.Vector3(0, 1, 0)).normalize() // left × up = forward
  const v = new THREE.Vector3(); if (Math.abs(f.x) > Math.abs(f.z)) v.x = Math.sign(f.x); else v.z = Math.sign(f.z)
  return v
}

/** the way the model looks, as one of +X, -X, +Z, -Z (null: cannot tell) */
export function facing (model: THREE.Object3D): THREE.Vector3 | null {
  const fb = facing_from_bones(model); if (fb !== null) return fb
  const P: THREE.Vector3[] = []
  for (const g of model_geometries(model)) { const pos = g.getAttribute('position'); const step = Math.max(1, Math.floor(pos.count / 20000)); for (let i = 0; i < pos.count; i += step) P.push(new THREE.Vector3().fromBufferAttribute(pos, i)) }
  if (P.length < 50) return null
  let y0 = Infinity; let y1 = -Infinity; for (const p of P) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
  const H = y1 - y0; if (H <= 0) return null
  const band = (a: number, b: number): THREE.Vector3[] => P.filter(p => p.y >= y0 + H * a && p.y <= y0 + H * b)
  const ext = (q: THREE.Vector3[], k: 'x' | 'z'): number => { let a = Infinity; let b = -Infinity; for (const p of q) { a = Math.min(a, p[k]); b = Math.max(b, p[k]) } return b - a }
  const mean = (q: THREE.Vector3[], k: 'x' | 'z'): number => q.reduce((s, p) => s + p[k], 0) / Math.max(1, q.length)
  // a standing body: narrower front-to-back than side-to-side; a long animal: longer front-to-back
  const torso = band(0.35, 0.8); if (torso.length < 20) return null
  const tall = H > Math.max(ext(P, 'x'), ext(P, 'z')) * 0.9
  const ax: 'x' | 'z' = tall ? (ext(torso, 'x') < ext(torso, 'z') ? 'x' : 'z') : (ext(P, 'x') > ext(P, 'z') ? 'x' : 'z')
  let s = 0
  if (tall) {
    // how far each side reaches from the middle: toes reach further forward than heels go back, chest / belly further
    // than the back (the head is left out: hair often sticks out behind)
    const reach = (q: THREE.Vector3[], c: number): number => { let lo = 0; let hi = 0; for (const p of q) { lo = Math.min(lo, p[ax] - c); hi = Math.max(hi, p[ax] - c) } return hi + lo }
    const feet = band(0, 0.05); const ankles = band(0.06, 0.16); const body = band(0.35, 0.55)
    // the feet decide when they can (a cape or a backpack makes the back of the body reach further than the chest)
    if (feet.length > 10 && ankles.length > 5) s = reach(feet, mean(ankles, ax))
    if (Math.abs(s) < H * 0.008 && body.length > 10) s = reach(body, mean(body, ax))
  } else {
    // an animal: the head end is higher and thicker than the tail end
    const c = mean(P, ax); const L = ext(P, ax)
    const end = (sg: number): number => { const q = P.filter(p => (p[ax] - c) * sg > L * 0.3); return q.length > 0 ? q.reduce((m, p) => m + p.y, 0) / q.length : 0 }
    s = end(1) - end(-1)
  }
  if (Math.abs(s) < 1e-6) return null
  const v = new THREE.Vector3(); v[ax] = Math.sign(s); return v
}

/** turn the model with the 90° Y button until it faces +Z; returns the number of turns, or -1 if it cannot tell */
export async function face_forward (engine: Mesh2MotionEngine): Promise<number> {
  const btn = document.getElementById('rotate-model-y-button') as HTMLButtonElement | null; if (btn === null) return -1
  for (let i = 0; i < 4; i++) {
    const f = facing(engine.load_model_step.model_meshes()); if (f === null) return -1
    if (f.z > 0.5) { if (i > 0) (document.getElementById('auto-align-model-button') as HTMLButtonElement | null)?.click(); return i }
    btn.click(); await new Promise(r => setTimeout(r, 200))
  }
  return 4
}

export function mount_auto_face (engine: Mesh2MotionEngine): void {
  const note = (t: string): void => { const s = document.getElementById('gb-face-note'); if (s !== null) s.textContent = t }
  const run = async (): Promise<void> => {
    const n = await face_forward(engine)
    note(n < 0 ? M('Could not tell which way it looks: turn it with Y.', 'Chưa nhận ra hướng: xoay bằng nút Y.', 'Y로 회전하세요.') : n === 0 ? M('✓ Already facing the blue arrow.', '✓ Đã nhìn đúng hướng mũi tên xanh.', '✓ 정면') : M(`✓ Turned ${n * 90}° to face the blue arrow.`, `✓ Đã xoay ${n * 90}° cho nhìn theo mũi tên xanh.`, `✓ ${n * 90}° 회전`))
  }
  // a 🧭 button beside the X / Y / Z turns
  const add = (): void => {
    const y = document.getElementById('rotate-model-y-button'); if (y === null || document.getElementById('gb-face-btn') !== null) return
    const b = document.createElement('button'); b.id = 'gb-face-btn'; b.type = 'button'; b.className = 'secondary-button'
    b.textContent = '🧭 ' + M('Face the arrow', 'Tự xoay theo mũi tên', '화살표 방향'); b.onclick = () => { void run() }
    const s = document.createElement('div'); s.id = 'gb-face-note'; s.style.cssText = 'font-size:12px;opacity:.8;margin-top:4px'
    y.parentElement?.after(b, s)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add()
  // once per new model, by itself (not while 🧬 Clone rig turns it to its rig file)
  let last = ''
  setInterval(() => {
    if (engine.process_step !== 'load-skeleton') return
    const m = engine.load_model_step.model_meshes(); const id = m?.uuid ?? ''; if (id === '' || id === last) return
    last = id
    if ((window as any).__gbCloneRig?.is_open?.() === true) return
    setTimeout(() => { void run() }, 500)
  }, 400)
}
