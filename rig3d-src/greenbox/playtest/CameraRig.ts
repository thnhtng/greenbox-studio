/*
 * Play-test camera: a free camera on the middle mouse button, and camera shots.
 *
 *   free      middle-drag orbits around a pivot, Shift + middle-drag pans, the wheel dollies; F (or 🎯) goes
 *             back to following the player
 *   shots     saved camera angles on a timeline: from second t for dur seconds, either
 *               fixed   the saved position, looking at the saved point,
 *               look    the saved position, turning to keep an object (or the player) in view,
 *               follow  the saved offset from an object (or the player), riding along with it;
 *             cut or blend into the next one. ▶ plays them (and records them for ad footage);
 *             they are saved with the map and exported to GLB (glTF cameras), Blender (cameras + Track To +
 *             timeline markers that switch the active camera) and Unity (a C# script that switches the shots)
 */
import * as THREE from 'three'
import { M } from '../common/lang.ts'

export type ShotMode = 'fixed' | 'look' | 'follow'
type V3a = [number, number, number]
export interface Shot { name: string, t: number, dur: number, mode: ShotMode, pos: V3a, target: V3a, fov: number, follow: string, offset: V3a, blend: number }

const r3 = (v: THREE.Vector3): V3a => [v.x, v.y, v.z].map(x => Math.round(x * 1000) / 1000) as V3a
const v3 = (a: V3a): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2])
export const LOOK_UP = 1.2 // look at the chest of a followed object, not its feet

export class CameraRig {
  public free = false
  public shots: Shot[] = []
  public on_change: (() => void) | null = null
  public on_done: (() => void) | null = null
  private readonly pivot = new THREE.Vector3()
  private yaw = 0
  private pitch = 0.4
  private dist = 6
  private drag: { x: number, y: number, pan: boolean } | null = null
  private play_t0 = -1
  private panel: HTMLElement | null = null
  private readonly prev = { pos: new THREE.Vector3(), target: new THREE.Vector3() }
  private readonly look = new THREE.Vector3()

  constructor (
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    /** object by name: 'player' = the character / vehicle, else a map prop */
    private readonly find: (name: string) => THREE.Object3D | null,
    private readonly names: () => string[],
    /** where the follow camera looks right now */
    private readonly follow_target: () => THREE.Vector3
  ) {
    dom.addEventListener('pointerdown', e => {
      if (e.button !== 1) return
      e.preventDefault(); e.stopPropagation()
      if (!this.free) this.enter_free()
      this.drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey }
      dom.setPointerCapture(e.pointerId)
    })
    dom.addEventListener('pointermove', e => {
      if (this.drag === null) return
      const dx = e.clientX - this.drag.x; const dy = e.clientY - this.drag.y
      this.drag.x = e.clientX; this.drag.y = e.clientY
      if (this.drag.pan || e.shiftKey) {
        const k = this.dist * 0.0016
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
        this.pivot.addScaledVector(right, -dx * k).addScaledVector(up, dy * k)
      } else {
        this.yaw -= dx * 0.008
        this.pitch = Math.min(1.5, Math.max(-0.6, this.pitch + dy * 0.006))
      }
    })
    addEventListener('pointerup', e => { if (e.button === 1) this.drag = null })
    dom.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault() })
    // double middle-click: back to following
    let last = 0
    dom.addEventListener('pointerdown', e => { if (e.button !== 1) return; const now = performance.now(); if (now - last < 300) this.exit_free(); last = now })
  }

  /* ---------------- free camera ---------------- */
  public enter_free (): void {
    this.stop()
    this.pivot.copy(this.follow_target())
    const off = this.camera.position.clone().sub(this.pivot)
    this.dist = Math.max(0.5, off.length())
    this.yaw = Math.atan2(off.x, off.z)
    this.pitch = Math.asin(Math.max(-1, Math.min(1, off.y / this.dist)))
    this.free = true
    this.refresh_panel()
  }

  public exit_free (): void { this.free = false; this.refresh_panel() }

  /** how far the camera is from what it looks at (fog follows it) */
  public view_dist (): number { return this.free ? this.dist : this.camera.position.distanceTo(this.look) }

  /** the wheel, while the free camera is on */
  public dolly (sign: number): void { this.dist = Math.min(400, Math.max(0.4, this.dist * (1 + sign * 0.1))) }

  /** frame a point (F on a selected prop) */
  public focus (p: THREE.Vector3, size = 4): void { if (!this.free) this.enter_free(); this.pivot.copy(p); this.dist = Math.max(2, size * 2.2) }

  /* ---------------- shots ---------------- */
  /** what the camera looks at now (free pivot, or the follow target) */
  private current_target (): THREE.Vector3 { return this.free ? this.pivot.clone() : this.follow_target() }

  public add_shot (): Shot {
    const last = this.shots[this.shots.length - 1]
    const s: Shot = {
      name: `Shot ${this.shots.length + 1}`, t: last !== undefined ? +(last.t + last.dur).toFixed(2) : 0, dur: 3, mode: 'fixed',
      pos: r3(this.camera.position), target: r3(this.current_target()), fov: Math.round(this.camera.fov), follow: 'player', offset: [0, 0, 0], blend: 0
    }
    this.capture(s)
    this.shots.push(s); this.changed()
    return s
  }

  /** store the current view in a shot (offset from the followed object for "follow") */
  public capture (s: Shot): void {
    s.pos = r3(this.camera.position); s.target = r3(this.current_target()); s.fov = Math.round(this.camera.fov)
    const o = this.find(s.follow)
    s.offset = o !== null ? r3(this.camera.position.clone().sub(o.getWorldPosition(new THREE.Vector3()))) : [0, 2, 5]
  }

  /** camera position + look-at point of a shot right now */
  public resolve (s: Shot): { pos: THREE.Vector3, target: THREE.Vector3 } {
    const o = s.mode === 'fixed' ? null : this.find(s.follow)
    const op = o?.getWorldPosition(new THREE.Vector3())
    if (s.mode === 'follow' && op !== undefined) return { pos: op.clone().add(v3(s.offset)), target: op.clone().add(new THREE.Vector3(0, LOOK_UP, 0)) }
    if (s.mode === 'look' && op !== undefined) return { pos: v3(s.pos), target: op.clone().add(new THREE.Vector3(0, LOOK_UP, 0)) }
    return { pos: v3(s.pos), target: v3(s.target) }
  }

  public view (s: Shot): void {
    const r = this.resolve(s); this.free = true
    this.pivot.copy(r.target); const off = r.pos.clone().sub(r.target)
    this.dist = Math.max(0.3, off.length()); this.yaw = Math.atan2(off.x, off.z); this.pitch = Math.asin(Math.max(-1, Math.min(1, off.y / this.dist)))
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix()
    this.refresh_panel()
  }

  public total (): number { return this.shots.reduce((m, s) => Math.max(m, s.t + s.dur), 0) }
  public playing (): boolean { return this.play_t0 >= 0 }
  public play (): void { if (this.shots.length === 0) return; this.play_t0 = performance.now(); this.refresh_panel() }
  public stop (): void { if (this.play_t0 < 0) return; this.play_t0 = -1; this.camera.fov = 50; this.camera.updateProjectionMatrix(); this.refresh_panel(); this.on_done?.() }

  /** drive the camera; false = not ours this frame (the follow camera runs) */
  public update (dt: number): boolean {
    if (this.play_t0 >= 0) {
      const t = (performance.now() - this.play_t0) / 1000
      if (t > this.total()) { this.stop(); return false }
      const sorted = [...this.shots].sort((a, b) => a.t - b.t)
      let i = -1; for (let k = 0; k < sorted.length; k++) if (sorted[k].t <= t) i = k
      if (i < 0) i = 0
      const s = sorted[i]; const r = this.resolve(s)
      const since = t - s.t
      if (s.blend > 0 && since < s.blend && i > 0) {
        // blend from where the previous shot left the camera
        const k = since / s.blend; const e = k * k * (3 - 2 * k)
        this.camera.position.copy(this.prev.pos).lerp(r.pos, e); this.look.copy(this.prev.target).lerp(r.target, e)
      } else {
        this.camera.position.copy(r.pos); this.look.copy(r.target)
        if (i + 1 < sorted.length) { this.prev.pos.copy(r.pos); this.prev.target.copy(r.target) }
      }
      if (this.camera.fov !== s.fov) { this.camera.fov = s.fov; this.camera.updateProjectionMatrix() }
      this.camera.lookAt(this.look)
      const el = this.panel?.querySelector('[data-now]'); if (el != null) el.textContent = `${t.toFixed(1)} / ${this.total().toFixed(1)} s · ${s.name}`
      return true
    }
    if (this.free) {
      const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist)
      this.camera.position.lerp(this.pivot.clone().add(off), 1 - Math.exp(-14 * dt))
      this.camera.lookAt(this.pivot)
      return true
    }
    return false
  }

  public set (shots: Shot[] | undefined): void { this.shots = Array.isArray(shots) ? shots : []; this.render() }
  private changed (): void { this.on_change?.(); this.render() }

  /* ---------------- panel ---------------- */
  public mount (parent: HTMLElement): void {
    const d = document.createElement('div'); d.id = 'pt-shots'
    parent.append(d); this.panel = d
    d.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'); if (b === null) return
      const i = Number(b.dataset.i); const a = b.dataset.a
      if (a === 'free') { if (this.free) this.exit_free(); else this.enter_free() }
      else if (a === 'add') this.add_shot()
      else if (a === 'play') { if (this.playing()) this.stop(); else this.play() }
      else if (a === 'go') this.view(this.shots[i])
      else if (a === 'cap') { this.capture(this.shots[i]); this.changed() }
      else if (a === 'del') { this.shots.splice(i, 1); this.changed() }
      else if (a === 'up' && i > 0) { [this.shots[i - 1], this.shots[i]] = [this.shots[i], this.shots[i - 1]]; this.changed() }
    })
    d.addEventListener('change', e => {
      const el = e.target as HTMLInputElement | HTMLSelectElement; const i = Number(el.dataset.i); const f = el.dataset.f; if (f === undefined) return
      const s = this.shots[i] as any
      s[f] = ['t', 'dur', 'fov', 'blend'].includes(f) ? Number(el.value) : el.value
      if (f === 'follow' || f === 'mode') { if (s.mode === 'follow') this.capture(s) }
      this.changed()
    })
    this.render()
  }

  private render (): void {
    const d = this.panel; if (d === null) return
    const opts = ['player', ...this.names()]
    const mode = (m: ShotMode): string => ({ fixed: M('Fixed', 'Cố định', '고정'), look: M('Track (turns to look)', 'Bám theo (xoay nhìn)', '추적(회전)'), follow: M('Follow (rides along)', 'Đi theo (chạy cùng)', '따라가기') })[m]
    const who = (n: string): string => n === 'player' ? M('player', 'nhân vật', '플레이어') : n
    d.innerHTML = `
      <div class="row"><button data-a="free">${this.free ? '🎯 ' + M('Follow the player (F)', 'Theo nhân vật (F)', '플레이어 따라가기 (F)') : '🕊 ' + M('Free camera', 'Camera tự do', '자유 카메라')}</button></div>
      <div class="sm">${M('Middle-drag: free camera (orbit) · Shift + middle-drag: pan · wheel: zoom · double middle-click or F: back to the player · Q / E turn the follow camera', 'Kéo chuột giữa: camera tự do (xoay quanh) · Shift + kéo chuột giữa: dời · lăn: zoom · bấm đúp chuột giữa hoặc F: về theo nhân vật · Q / E xoay camera theo', '가운데 드래그: 자유 카메라 · Shift+가운데: 이동 · 휠: 줌 · 가운데 더블클릭/F: 복귀')}</div>
      <h4 style="margin:8px 0 4px;font-size:12px">🎥 ${M('Camera shots', 'Các góc camera (shot)', '카메라 샷')} <span data-now class="sm"></span></h4>
      <div class="row"><button data-a="add">📌 ${M('Save this view as a shot', 'Lưu góc đang nhìn thành shot', '현재 시점 저장')}</button><button data-a="play"${this.shots.length === 0 ? ' disabled' : ''}>${this.playing() ? '⏹ ' + M('Stop', 'Dừng', '정지') : '▶ ' + M('Play shots', 'Phát shot', '샷 재생')}</button></div>
      ${this.shots.map((s, i) => `<div class="shot" style="border:1px solid var(--line,#333);border-radius:8px;padding:5px;margin:4px 0;display:flex;flex-direction:column;gap:3px;font-size:12px">
        <div class="row" style="gap:4px"><input data-i="${i}" data-f="name" value="${s.name.replace(/"/g, '&quot;')}" style="flex:1;min-width:0"><button data-a="go" data-i="${i}" title="${M('Look through it', 'Xem góc này', '보기')}">👁</button><button data-a="cap" data-i="${i}" title="${M('Replace with the current view', 'Thay bằng góc đang nhìn', '현재 시점으로')}">⟳</button><button data-a="up" data-i="${i}" title="↑">↑</button><button data-a="del" data-i="${i}">✕</button></div>
        <div class="row" style="gap:4px">${M('from', 'từ', '시작')} <input type="number" step="0.1" min="0" data-i="${i}" data-f="t" value="${s.t}" style="width:52px">s · ${M('for', 'dài', '길이')} <input type="number" step="0.1" min="0.1" data-i="${i}" data-f="dur" value="${s.dur}" style="width:48px">s · FOV <input type="number" min="10" max="120" data-i="${i}" data-f="fov" value="${s.fov}" style="width:44px"></div>
        <div class="row" style="gap:4px"><select data-i="${i}" data-f="mode" style="flex:1;min-width:0">${(['fixed', 'look', 'follow'] as ShotMode[]).map(m => `<option value="${m}"${s.mode === m ? ' selected' : ''}>${mode(m)}</option>`).join('')}</select>
          ${s.mode !== 'fixed' ? `<select data-i="${i}" data-f="follow" style="flex:1;min-width:0">${opts.map(n => `<option value="${n}"${s.follow === n ? ' selected' : ''}>${who(n)}</option>`).join('')}</select>` : ''}</div>
        <div class="row" style="gap:4px">${M('Into it', 'Vào shot', '전환')}: <select data-i="${i}" data-f="blend" style="flex:1"><option value="0"${s.blend === 0 ? ' selected' : ''}>${M('cut', 'cắt thẳng', '컷')}</option><option value="0.6"${s.blend > 0 && s.blend < 1 ? ' selected' : ''}>${M('blend 0.6 s', 'lướt 0.6 s', '블렌드 0.6s')}</option><option value="1.5"${s.blend >= 1 ? ' selected' : ''}>${M('slow blend 1.5 s', 'lướt chậm 1.5 s', '느린 블렌드')}</option></select></div>
      </div>`).join('')}
      <div class="sm">${M('Shots are saved with the map and exported: GLB (cameras), Blender (cameras, Track To, markers that switch the camera), Unity (C# script).', 'Shot được lưu cùng map và xuất ra: GLB (camera), Blender (camera, Track To, marker tự đổi camera theo giây), Unity (script C#).', '샷은 맵과 함께 저장·내보내기 됩니다.')}</div>`
  }

  public refresh_panel (): void { this.render() }
}
