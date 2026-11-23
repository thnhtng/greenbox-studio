/*
 * ⬚ Free Transform for joints (like Photoshop Ctrl+T), on the rig page (Easy mode):
 *   a box round the selected joints (all joints when none are selected)
 *   drag inside       move
 *   corner / edge     scale (Shift: keep proportions = the same in all 3 axes · Alt: from the centre)
 *   round knob / drag just outside a corner   rotate round the view axis (Shift: 15° steps)
 *   Enter / ✓ / click outside the box = apply · Esc / ✕ = cancel (back to where the joints were)
 * Works in the camera's view plane, so it follows the view you look from (front / side / top / any angle);
 * right-drag still turns the view while the box is up.
 */
import * as THREE from 'three'

type Bone = THREE.Bone
export interface FTHost {
  camera: () => THREE.Camera
  canvas: () => HTMLCanvasElement
  bones: () => Bone[]
  /** the joints to transform (the selection + its children when they follow; every joint when nothing is selected) */
  moving: () => Set<Bone>
  apply: (targets: Map<Bone, THREE.Vector3>) => void
  begin_undo: () => void
  done: () => void
  orbit: (on: boolean) => void
  mirror: (moved: Set<Bone>) => void
  lang: () => 'en' | 'vi' | 'ko'
  /** joints that follow the moving ones by themselves (mirror side): drawn inside the box too */
  extra?: (moving: Set<Bone>) => Bone[]
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Gesture = { kind: 'move' | 'rotate' | 'scale', h?: Handle, x0: number, y0: number, start: Map<Bone, THREE.Vector3>, R: THREE.Vector3, U: THREE.Vector3, F: THREE.Vector3, C: THREE.Vector3, plane: THREE.Plane, hit0: THREE.Vector3 | null, box: { x0: number, y0: number, x1: number, y1: number } }

const T = (l: 'en' | 'vi' | 'ko', en: string, vi: string, ko?: string): string => l === 'vi' ? vi : l === 'ko' ? (ko ?? en) : en

export class FreeTransform {
  public active = false
  private moving = new Set<Bone>()
  private session = new Map<Bone, THREE.Vector3>() // where every joint was when the box opened (Esc goes back here)
  private g: Gesture | null = null
  private el: HTMLDivElement | null = null
  private raf = 0
  private box = { x0: 0, y0: 0, x1: 0, y1: 0 }

  constructor (private readonly host: FTHost) {}

  /* ---------------- open / apply / cancel ---------------- */
  public open (): boolean {
    if (this.active) return true
    this.moving = this.host.moving()
    if (this.moving.size === 0) return false
    this.host.begin_undo()
    this.session.clear()
    this.host.bones().forEach(b => this.session.set(b, b.getWorldPosition(new THREE.Vector3())))
    this.active = true
    this.build()
    const loop = (): void => { if (!this.active) return; if (this.g === null) this.layout(); this.raf = requestAnimationFrame(loop) }
    loop()
    addEventListener('keydown', this.on_key, true)
    return true
  }

  public commit (): void {
    if (!this.active) return
    this.close()
    this.host.done()
  }

  public cancel (): void {
    if (!this.active) return
    const t = new Map<Bone, THREE.Vector3>(); this.session.forEach((v, b) => t.set(b, v.clone()))
    this.host.apply(t)
    this.close()
    this.host.done()
  }

  private close (): void {
    this.active = false; this.g = null
    cancelAnimationFrame(this.raf)
    removeEventListener('keydown', this.on_key, true)
    this.el?.remove(); this.el = null
    this.host.orbit(true)
  }

  private readonly on_key = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null
    if (t !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); this.commit() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.cancel() }
  }

  /* ---------------- screen box ---------------- */
  private screen (p: THREE.Vector3): { x: number, y: number, behind: boolean } {
    const r = this.host.canvas().getBoundingClientRect()
    const v = p.clone().project(this.host.camera())
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, behind: v.z > 1 }
  }

  private layout (): void {
    if (this.el === null) return
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
    const w = new THREE.Vector3()
    const shown = new Set([...this.moving, ...(this.host.extra?.(this.moving) ?? [])])
    shown.forEach(b => { const s = this.screen(b.getWorldPosition(w)); if (s.behind) return; x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y) })
    if (!isFinite(x0)) { this.el.style.display = 'none'; return }
    const pad = 16
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
    if (x1 - x0 < 48) { const c = (x0 + x1) / 2; x0 = c - 24; x1 = c + 24 }
    if (y1 - y0 < 48) { const c = (y0 + y1) / 2; y0 = c - 24; y1 = c + 24 }
    this.box = { x0, y0, x1, y1 }
    const b = this.el.querySelector('.ft-box') as HTMLElement
    this.el.style.display = ''
    b.style.left = x0 + 'px'; b.style.top = y0 + 'px'; b.style.width = (x1 - x0) + 'px'; b.style.height = (y1 - y0) + 'px'
    const bar = this.el.querySelector('.ft-bar') as HTMLElement
    const bw = bar.offsetWidth || 300
    bar.style.left = Math.min(Math.max(8, (x0 + x1) / 2 - bw / 2), innerWidth - bw - 8) + 'px'
    bar.style.top = Math.min(y1 + 14, innerHeight - 52) + 'px'
  }

  private build (): void {
    const l = this.host.lang()
    const el = document.createElement('div'); el.id = 'gb-ft'
    const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    el.innerHTML = `<div class="ft-box"><div class="ft-move" title="${T(l, 'Drag to move', 'Kéo để dời', '드래그: 이동')}"></div>` +
      ['nw', 'ne', 'se', 'sw'].map(c => `<div class="ft-rot ft-rot-${c}" data-rot="1"></div>`).join('') +
      handles.map(h => `<div class="ft-h ft-${h}" data-h="${h}"></div>`).join('') +
      `<div class="ft-stem"></div><div class="ft-knob" data-rot="1" title="${T(l, 'Drag to rotate (Shift: 15° steps)', 'Kéo để xoay (Shift: từng 15°)', '드래그: 회전')}">⟳</div></div>
      <div class="ft-bar"><b>⬚ ${T(l, 'Free transform', 'Free transform', '자유 변형')}</b><span class="ft-n">${this.moving.size} ${T(l, 'joints', 'khớp', '관절')}</span>
      <span class="ft-tip">${T(l, 'Shift: proportional · Alt: from centre', 'Shift: giữ tỉ lệ · Alt: từ tâm', 'Shift: 비율 · Alt: 중심')}</span>
      <button type="button" data-x="cancel">✕ ${T(l, 'Cancel', 'Huỷ', '취소')} <kbd>Esc</kbd></button><button type="button" data-x="ok" class="ft-ok">✓ ${T(l, 'Apply', 'Áp dụng', '적용')} <kbd>Enter</kbd></button></div>`
    document.body.appendChild(el); this.el = el
    this.style()
    el.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement
      const x = t.closest('[data-x]') as HTMLElement | null
      if (x !== null) { e.preventDefault(); if (x.dataset.x === 'ok') this.commit(); else this.cancel(); return }
      if (e.button !== 0) return
      const kind: Gesture['kind'] | null = t.dataset.h !== undefined ? 'scale' : t.dataset.rot !== undefined ? 'rotate' : t.classList.contains('ft-move') ? 'move' : null
      if (kind === null) return
      e.preventDefault(); e.stopPropagation()
      this.begin(kind, t.dataset.h as Handle | undefined, e)
      t.setPointerCapture(e.pointerId)
    })
    el.addEventListener('pointermove', e => { if (this.g !== null) { e.preventDefault(); this.drag(e) } })
    const end = (): void => { if (this.g === null) return; this.g = null; this.host.orbit(true); this.layout() }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
    el.addEventListener('dblclick', e => { if ((e.target as HTMLElement).classList.contains('ft-move')) this.commit() })
    this.layout()
  }

  /* ---------------- gestures ---------------- */
  private begin (kind: Gesture['kind'], h: Handle | undefined, e: PointerEvent): void {
    const cam = this.host.camera(); cam.updateMatrixWorld()
    const R = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize()
    const U = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize()
    const F = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize().negate()
    const start = new Map<Bone, THREE.Vector3>(); this.host.bones().forEach(b => start.set(b, b.getWorldPosition(new THREE.Vector3())))
    const bb = new THREE.Box3(); this.moving.forEach(b => bb.expandByPoint(start.get(b)!))
    const C = bb.getCenter(new THREE.Vector3())
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(F, C)
    this.g = { kind, h, x0: e.clientX, y0: e.clientY, start, R, U, F, C, plane, hit0: this.hit(e, plane), box: { ...this.box } }
    this.host.orbit(false)
  }

  private hit (e: { clientX: number, clientY: number }, plane: THREE.Plane): THREE.Vector3 | null {
    const r = this.host.canvas().getBoundingClientRect()
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.host.camera())
    return rc.ray.intersectPlane(plane, new THREE.Vector3())
  }

  private drag (e: PointerEvent): void {
    const g = this.g; if (g === null) return
    const out = new Map<Bone, THREE.Vector3>()
    g.start.forEach((v, b) => out.set(b, v.clone()))
    if (g.kind === 'move') {
      const h = this.hit(e, g.plane); if (h === null || g.hit0 === null) return
      const d = h.sub(g.hit0)
      this.moving.forEach(b => out.get(b)!.add(d))
    } else if (g.kind === 'rotate') {
      const cs = this.screen(g.C)
      let a = Math.atan2(e.clientY - cs.y, e.clientX - cs.x) - Math.atan2(g.y0 - cs.y, g.x0 - cs.x)
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
      // screen y points down: a clockwise turn on screen is a negative turn round the view axis F (pointing away)
      this.moving.forEach(b => { const v = g.start.get(b)!.clone().sub(g.C).applyAxisAngle(g.F, a); out.set(b, g.C.clone().add(v)) })
    } else {
      const B = g.box; const h = g.h!
      const sxIdx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0
      const syIdx = h.includes('s') ? 1 : h.includes('n') ? -1 : 0
      const cx = (B.x0 + B.x1) / 2; const cy = (B.y0 + B.y1) / 2
      // pivot: the opposite side (Alt: the centre)
      const px = e.altKey || sxIdx === 0 ? cx : (sxIdx > 0 ? B.x0 : B.x1)
      const py = e.altKey || syIdx === 0 ? cy : (syIdx > 0 ? B.y0 : B.y1)
      const hx = sxIdx > 0 ? B.x1 : sxIdx < 0 ? B.x0 : cx; const hy = syIdx > 0 ? B.y1 : syIdx < 0 ? B.y0 : cy
      const nx = hx + (e.clientX - g.x0); const ny = hy + (e.clientY - g.y0)
      let sx = sxIdx !== 0 && Math.abs(hx - px) > 1 ? (nx - px) / (hx - px) : 1
      let sy = syIdx !== 0 && Math.abs(hy - py) > 1 ? (ny - py) / (hy - py) : 1
      let sz = 1
      if (e.shiftKey) { // proportional: one factor for x, y and the depth
        const s = sxIdx !== 0 && syIdx !== 0 ? (Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy) : (sxIdx !== 0 ? sx : sy)
        sx = s; sy = s; sz = s
      }
      sx = Math.max(-20, Math.min(20, sx)); sy = Math.max(-20, Math.min(20, sy)); sz = Math.max(0.02, Math.min(20, sz))
      const pivot = this.hit({ clientX: px, clientY: py }, g.plane) ?? g.C
      this.moving.forEach(b => {
        const v = g.start.get(b)!.clone().sub(pivot)
        const a = v.dot(g.R); const bU = v.dot(g.U); const c = v.dot(g.F)
        out.set(b, pivot.clone().addScaledVector(g.R, a * sx).addScaledVector(g.U, bU * sy).addScaledVector(g.F, c * sz))
      })
    }
    this.host.apply(out)
    this.host.mirror(this.moving)
    this.layout()
  }

  private style (): void {
    if (document.getElementById('gb-ft-css') !== null) return
    const s = document.createElement('style'); s.id = 'gb-ft-css'
    s.textContent = `#gb-ft{position:fixed;inset:0;z-index:60;pointer-events:none}
#gb-ft .ft-box{position:fixed;border:1.5px solid #5ff2a8;box-shadow:0 0 0 1px rgba(0,0,0,.35),0 0 18px -4px rgba(47,233,139,.7);border-radius:4px;pointer-events:none}
#gb-ft .ft-move{position:absolute;inset:0;pointer-events:auto;cursor:move;background:rgba(47,233,139,.05)}
#gb-ft .ft-h{position:absolute;width:12px;height:12px;margin:-7px 0 0 -7px;background:#fff;border:1.5px solid #2fe98b;border-radius:3px;pointer-events:auto;box-shadow:0 1px 4px rgba(0,0,0,.4)}
#gb-ft .ft-nw{left:0;top:0;cursor:nwse-resize}#gb-ft .ft-n{left:50%;top:0;cursor:ns-resize}#gb-ft .ft-ne{left:100%;top:0;cursor:nesw-resize}#gb-ft .ft-e{left:100%;top:50%;cursor:ew-resize}
#gb-ft .ft-se{left:100%;top:100%;cursor:nwse-resize}#gb-ft .ft-s{left:50%;top:100%;cursor:ns-resize}#gb-ft .ft-sw{left:0;top:100%;cursor:nesw-resize}#gb-ft .ft-w{left:0;top:50%;cursor:ew-resize}
#gb-ft .ft-rot{position:absolute;width:26px;height:26px;pointer-events:auto;cursor:alias}
#gb-ft .ft-rot-nw{left:-26px;top:-26px}#gb-ft .ft-rot-ne{right:-26px;top:-26px}#gb-ft .ft-rot-se{right:-26px;bottom:-26px}#gb-ft .ft-rot-sw{left:-26px;bottom:-26px}
#gb-ft .ft-stem{position:absolute;left:50%;top:-30px;width:1.5px;height:30px;background:#5ff2a8;transform:translateX(-50%)}
#gb-ft .ft-knob{position:absolute;left:50%;top:-52px;width:24px;height:24px;margin-left:-12px;border-radius:50%;pointer-events:auto;cursor:grab;display:flex;align-items:center;justify-content:center;font:700 14px/1 system-ui;color:#03140b;
  background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.2) 50%),#2fe98b;border:1px solid #fff;box-shadow:0 0 12px rgba(47,233,139,.7)}
#gb-ft .ft-bar{position:fixed;display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:calc(100vw - 16px);padding:7px 8px 7px 12px;border-radius:14px;pointer-events:auto;color:#eef6f2;font:12.5px/1.3 system-ui,sans-serif;
  background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.03)),rgba(12,20,17,.85);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid rgba(170,255,214,.24);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 10px 26px -12px rgba(0,0,0,.8)}
#gb-ft .ft-n{opacity:.7}#gb-ft .ft-tip{opacity:.6;font-size:11.5px}
#gb-ft .ft-bar button{font:600 12px/1 system-ui;padding:7px 10px;border-radius:10px;cursor:pointer;color:#eef6f2;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08)}
#gb-ft .ft-bar .ft-ok{color:#03140b;background:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,.12) 50%),#2fe98b;border-color:rgba(255,255,255,.7)}
#gb-ft kbd{font:600 10px/1 ui-monospace,monospace;opacity:.65;margin-left:3px}`
    document.head.appendChild(s)
  }
}
