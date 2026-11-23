/*
 * Blender-style view panel on the 3D view (top right):
 *   axis gizmo   X / Y / Z balls (Blender colours, Z up): click = look along that axis, drag = orbit
 *   🔍 zoom      drag up / down on it (click = closer)
 *   ✋ pan       drag on it to slide the view
 *   🎥 camera    look through the cameras you placed (🎥 shots): 1st click = shot 1, next = shot 2…, after the last = the game camera
 *   ▦ persp     perspective ↔ near-orthographic (narrow lens, same framing)
 * Everything works on CameraRig's free camera, so middle-drag / wheel keep working the same way.
 */
import * as THREE from 'three'
import { M } from '../common/lang.ts'
import { type CameraRig } from './CameraRig.ts'

// Blender axis -> three.js direction (three is Y up; Blender is Z up, Y forward = three -Z)
const AXES: Array<{ k: string, v: THREE.Vector3, c: string, yaw: number, pitch: number }> = [
  { k: 'X', v: new THREE.Vector3(1, 0, 0), c: '#e8475a', yaw: Math.PI / 2, pitch: 0 },
  { k: 'Y', v: new THREE.Vector3(0, 0, -1), c: '#86c440', yaw: Math.PI, pitch: 0 },
  { k: 'Z', v: new THREE.Vector3(0, 1, 0), c: '#4a8ff0', yaw: 0, pitch: 1.5 }
]
const SVG = (d: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICON = {
  zoom: SVG('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>'),
  pan: SVG('<path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
  cam: SVG('<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/><circle cx="6" cy="3.5" r="1.5"/><circle cx="11.5" cy="3.5" r="1.5"/>'),
  persp: SVG('<path d="M4 20 8 4h8l4 16Z"/><path d="M6 12h12M5 16h14M7 8h10M10 4l-1 16M14 4l1 16"/>')
}

export class ViewGizmo {
  private readonly el: HTMLDivElement
  private readonly svg: SVGSVGElement
  private anim = 0
  private ortho = false
  private readonly q = new THREE.Quaternion()
  private readonly last = new THREE.Quaternion(0, 0, 0, 0)
  private last_free: boolean | null = null
  /** the placed camera being looked through (-1 = none) */
  private shot_i = -1
  private tip: HTMLDivElement | null = null
  private tip_t = 0

  constructor (parent: HTMLElement, private readonly camera: THREE.PerspectiveCamera, private readonly rig: CameraRig) {
    const el = document.createElement('div'); el.id = 'pt-vgiz'; this.el = el
    el.innerHTML = `<svg class="vg-axes" viewBox="-60 -60 120 120" width="112" height="112"></svg>
      <div class="vg-col">
        <button data-v="zoom" title="${M('Zoom: drag up / down (click = closer)', 'Thu phóng: kéo lên / xuống (bấm = lại gần)', '줌: 위아래로 드래그')}">${ICON.zoom}</button>
        <button data-v="pan" title="${M('Pan: drag to slide the view', 'Kéo dịch: kéo để trượt khung nhìn', '이동: 드래그')}">${ICON.pan}</button>
        <button data-v="cam" title="${M('Look through your placed cameras (click again: the next one, then back to the game camera)', 'Nhìn qua camera bạn đã đặt (bấm tiếp: camera kế, hết thì về camera game)', '배치한 카메라로 보기 (다시 클릭: 다음 카메라)')}">${ICON.cam}</button>
        <button data-v="persp" title="${M('Perspective / orthographic', 'Phối cảnh / trực giao', '원근 / 직교')}">${ICON.persp}</button>
      </div>`
    parent.appendChild(el)
    this.svg = el.querySelector('svg')!
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    this.style()
    // axis gizmo: click a ball = that view; drag = orbit
    let down: { x: number, y: number, moved: boolean } | null = null
    this.svg.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); down = { x: e.clientX, y: e.clientY, moved: false }; this.svg.setPointerCapture(e.pointerId) })
    this.svg.addEventListener('pointermove', e => {
      if (down === null) return
      const dx = e.clientX - down.x; const dy = e.clientY - down.y
      if (!down.moved && Math.hypot(dx, dy) < 3) return
      down.moved = true; down.x = e.clientX; down.y = e.clientY
      this.shot_i = -1
      this.rig.orbit(dx * 1.4, dy * 1.4)
    })
    this.svg.addEventListener('pointerup', e => {
      if (down === null) return
      const moved = down.moved; down = null
      if (moved) return
      const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-ax]') ?? null; if (b === null) return
      const a = AXES.find(x => x.k === b.getAttribute('data-ax')!.replace('-', '')); if (a === undefined) return
      const neg = b.getAttribute('data-ax')!.startsWith('-')
      this.shot_i = -1
      this.go(neg ? a.yaw + Math.PI : a.yaw, neg ? -a.pitch : a.pitch)
    })
    // drag-buttons (zoom, pan) and click-buttons (camera, perspective)
    el.querySelectorAll<HTMLButtonElement>('.vg-col button').forEach(b => {
      const v = b.dataset.v
      let st: { x: number, y: number, moved: boolean } | null = null
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation()
        if (v === 'zoom' || v === 'pan') { st = { x: e.clientX, y: e.clientY, moved: false }; b.setPointerCapture(e.pointerId); b.classList.add('on') }
      })
      b.addEventListener('pointermove', e => {
        if (st === null) return
        const dx = e.clientX - st.x; const dy = e.clientY - st.y; st.x = e.clientX; st.y = e.clientY
        if (Math.abs(dx) + Math.abs(dy) > 0) st.moved = true
        this.shot_i = -1
        if (v === 'zoom') this.rig.zoom_drag(dy); else this.rig.pan(dx * 1.6, dy * 1.6)
      })
      const end = (): void => { if (st === null) return; if (!st.moved && v === 'zoom') this.rig.zoom_drag(-30); st = null; b.classList.remove('on') }
      b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end)
      b.addEventListener('click', e => {
        e.stopPropagation()
        if (v === 'cam') this.next_camera()
        if (v === 'persp') this.set_ortho(!this.ortho)
      })
    })
    this.draw()
  }

  /** 🎥 look through the placed cameras one after another, then back to the game camera */
  private next_camera (): void {
    cancelAnimationFrame(this.anim)
    const shots = this.rig.shots
    this.ortho = false; this.el.querySelector('[data-v="persp"]')!.classList.remove('on')
    this.shot_i = shots.length === 0 ? -1 : this.shot_i + 1
    if (this.shot_i >= 0 && this.shot_i < shots.length) {
      const s = shots[this.shot_i]
      this.rig.view(s) // the shot's own place, aim and lens
      this.say(`🎥 ${s.name !== '' ? s.name : M('Camera', 'Camera', '카메라') + ' ' + (this.shot_i + 1)} · ${this.shot_i + 1}/${shots.length}`)
    } else {
      this.shot_i = -1
      this.rig.exit_free(); this.camera.fov = 50; this.camera.updateProjectionMatrix()
      this.say(shots.length === 0
        ? M('No camera placed yet: add one with 🎥 (Camera panel or C in the 2D plan). Game camera.', 'Chưa đặt camera nào: thêm bằng 🎥 (bảng Camera hoặc phím C trong sơ đồ 2D). Đang ở camera game.', '배치된 카메라 없음: 🎥로 추가하세요. 게임 카메라.')
        : M('Game camera (follows the player)', 'Camera game (theo nhân vật)', '게임 카메라'))
    }
    this.last.set(0, 0, 0, 0) // redraw the button state
  }

  /** a short glass note under the panel */
  private say (t: string): void {
    if (this.tip === null) { this.tip = document.createElement('div'); this.tip.className = 'vg-tip'; this.el.appendChild(this.tip) }
    this.tip.textContent = t; this.tip.classList.add('on')
    clearTimeout(this.tip_t); this.tip_t = window.setTimeout(() => this.tip?.classList.remove('on'), 2200)
  }

  /** smooth turn to a view (shortest way round) */
  private go (yaw: number, pitch: number): void {
    const v0 = this.rig.free ? this.rig.get_view() : null
    if (v0 === null) { this.rig.set_view(yaw, pitch); return }
    let dy = (yaw - v0.yaw) % (Math.PI * 2); if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2
    const t0 = performance.now(); const y0 = v0.yaw; const p0 = v0.pitch
    cancelAnimationFrame(this.anim)
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / 260); const e = 1 - Math.pow(1 - k, 3)
      this.rig.set_view(y0 + dy * e, p0 + (pitch - p0) * e)
      if (k < 1) this.anim = requestAnimationFrame(step)
    }
    step()
  }

  /** near-orthographic: a narrow lens from further away, the same framing */
  private set_ortho (on: boolean): void {
    if (on === this.ortho) return
    const f0 = this.camera.fov; const f1 = on ? 8 : 50
    if (!this.rig.free) this.rig.set_view(this.rig.get_view().yaw, this.rig.get_view().pitch)
    const v = this.rig.get_view()
    const k = Math.tan(THREE.MathUtils.degToRad(f0) / 2) / Math.tan(THREE.MathUtils.degToRad(f1) / 2)
    this.rig.set_view(v.yaw, v.pitch, v.dist * k)
    this.camera.fov = f1; this.camera.updateProjectionMatrix()
    this.ortho = on
    this.el.querySelector('[data-v="persp"]')!.classList.toggle('on', on)
  }

  /** every frame: the balls follow the view */
  public draw (): void {
    if (this.last.equals(this.camera.quaternion) && this.last_free === this.rig.free) return
    this.last.copy(this.camera.quaternion); this.last_free = this.rig.free
    this.q.copy(this.camera.quaternion).invert()
    const items = AXES.flatMap(a => [1, -1].map(s => {
      const p = a.v.clone().multiplyScalar(s).applyQuaternion(this.q)
      return { a, s, x: p.x * 38, y: -p.y * 38, z: p.z }
    })).sort((m, n) => m.z - n.z)
    let h = '<circle class="vg-bg" r="56"/>'
    for (const it of items) if (it.s > 0) h += `<line x1="0" y1="0" x2="${it.x.toFixed(1)}" y2="${it.y.toFixed(1)}" stroke="${it.a.c}" stroke-width="2.4" stroke-linecap="round"/>`
    for (const it of items) {
      const id = (it.s > 0 ? '' : '-') + it.a.k
      h += it.s > 0
        ? `<g data-ax="${id}" class="vg-b"><circle cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="11" fill="${it.a.c}"/><text x="${it.x.toFixed(1)}" y="${(it.y + 4.2).toFixed(1)}">${it.a.k}</text></g>`
        : `<g data-ax="${id}" class="vg-b"><circle cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="9.5" fill="${it.a.c}" fill-opacity=".18" stroke="${it.a.c}" stroke-width="2"/></g>`
    }
    this.svg.innerHTML = h
    if (!this.rig.free) this.shot_i = -1 // something else (Esc, a shot play, double middle-click) took the camera back
    this.el.querySelector('[data-v="cam"]')!.classList.toggle('on', this.shot_i >= 0)
  }

  public set_visible (on: boolean): void { this.el.style.display = on ? '' : 'none' }

  private style (): void {
    if (document.getElementById('pt-vgiz-css') !== null) return
    const s = document.createElement('style'); s.id = 'pt-vgiz-css'
    s.textContent = `#pt-vgiz{position:absolute;top:12px;right:14px;z-index:6;display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:none;user-select:none}
#pt-vgiz .vg-axes{pointer-events:auto;cursor:grab;overflow:visible}
#pt-vgiz .vg-axes:active{cursor:grabbing}
#pt-vgiz .vg-bg{fill:rgba(12,22,18,.0);transition:fill 150ms}
#pt-vgiz .vg-axes:hover .vg-bg{fill:rgba(20,40,32,.42)}
#pt-vgiz .vg-b{cursor:pointer}
#pt-vgiz .vg-b:hover circle{filter:brightness(1.25)}
#pt-vgiz text{font:800 12px/1 system-ui,sans-serif;fill:#0b0d0e;text-anchor:middle;pointer-events:none}
#pt-vgiz .vg-col{pointer-events:auto;display:flex;flex-direction:column;gap:6px;padding:7px;border-radius:999px;
  background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.04) 45%,rgba(47,233,139,.08)),rgba(14,26,21,.55);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);
  border:1px solid rgba(190,255,225,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 0 18px -6px rgba(47,233,139,.45),0 10px 24px -12px rgba(0,0,0,.7)}
#pt-vgiz .vg-col button{all:unset;box-sizing:border-box;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#eef6f2;cursor:pointer;
  transition:background 150ms cubic-bezier(.4,0,.4,1),color 150ms,transform 150ms cubic-bezier(0,0,.2,1)}
#pt-vgiz .vg-col button svg{width:21px;height:21px}
#pt-vgiz .vg-col button[data-v=zoom],#pt-vgiz .vg-col button[data-v=pan]{cursor:grab}
@media (hover:hover){#pt-vgiz .vg-col button:hover{background:rgba(255,255,255,.12)}}
#pt-vgiz .vg-col button:active{transform:scale(.94)}
#pt-vgiz .vg-col button.on{background:rgba(47,233,139,.22);color:#7dffbf;box-shadow:inset 0 0 0 1px rgba(47,233,139,.5)}
#pt-vgiz .vg-col button:focus-visible{outline:2px solid #2fe98b;outline-offset:2px}
#pt-vgiz .vg-tip{position:absolute;top:100%;right:0;margin-top:8px;max-width:240px;width:max-content;padding:7px 11px;border-radius:12px;font:600 12px/1.4 system-ui,sans-serif;color:#eef6f2;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.03)),rgba(14,26,21,.72);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(190,255,225,.22);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 8px 20px -10px rgba(0,0,0,.7);opacity:0;transform:translateY(-4px);transition:opacity 160ms,transform 160ms}
#pt-vgiz .vg-tip.on{opacity:1;transform:none}`
    document.head.appendChild(s)
  }
}
