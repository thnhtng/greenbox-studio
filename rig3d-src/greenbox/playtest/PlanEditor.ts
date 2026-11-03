/*
 * 2D plan of a playable (top view, in metres): draw shapes, write what each one is, connect them with flow
 * wires, drag / resize / turn them, then build the 3D map from it and play it.
 *
 *   shapes   rectangle or ellipse = one 3D block. Its kind says what it does in the game:
 *              zone     floor area (a room, a field, a road) — flat, walkable
 *              block    a solid box (wall, table, decoration)
 *              source   gives an item while the player stands next to it (trees -> wood)
 *              machine  takes an item, after a while gives another one (wood -> plank)
 *              stack    a pile where items wait (output of a machine, a shelf)
 *              counter  takes an item, gives money (customers buy)
 *              unlock   "$" pad: pay money to unlock what its wires point to (a new room, a worker)
 *              player   where the player starts
 *   wires    flow from a shape to another: carry = the player brings the items, belt = they move by themselves
 *   picture  your 2D layout behind the shapes, to trace over; 🪄 finds its colour blocks and turns them into
 *            shapes (you then type what each one is)
 */
import { M } from '../common/lang.ts'
import { is_trackpad, pinch_factor } from '../common/MacTrackpad.ts'
import { main_colours, classify, majority, blobs } from './LayoutImport.ts'
import { type PlanForm, FORMS, SWATCHES, form_outline, in_outline, trace_form, pad_picture, user_image } from './PlanForms.ts'

export type PlanKind = 'zone' | 'block' | 'source' | 'machine' | 'stack' | 'counter' | 'unlock' | 'player'
export interface PlanShape {
  id: string, kind: PlanKind, form: PlanForm
  x: number, z: number, w: number, d: number, r: number // centre, size (m), turn (rad)
  label: string, color: string, height: number
  note?: string // shown in a bubble when the block is clicked in 3D (any language: Roboto)
  gives?: string, takes?: string, time?: number, price?: number
  model?: string // a palette object / your 3D file instead of a box ("house", "file:oven.glb")
  image?: string // pads: your picture (data URL) instead of the built-in one
}
export interface PlanWire { id: string, from: string, to: string, mode: 'carry' | 'belt' | 'unlock' }
export interface Plan { shapes: PlanShape[], wires: PlanWire[] }

export const KIND_INFO: Record<PlanKind, { color: string, height: number, en: string, vi: string }> = {
  zone: { color: '#e5e7eb', height: 0.05, en: 'Zone / room floor', vi: 'Khu / sàn phòng' },
  block: { color: '#9ca3af', height: 1, en: 'Block (solid)', vi: 'Khối (đặc)' },
  source: { color: '#22c55e', height: 1.6, en: 'Source (gives items)', vi: 'Nguồn (cho ra đồ)' },
  machine: { color: '#f59e0b', height: 1.4, en: 'Machine (A → B)', vi: 'Máy (A → B)' },
  stack: { color: '#ffffff', height: 0.1, en: 'Stack / pile', vi: 'Chỗ xếp đồ' },
  counter: { color: '#22d3ee', height: 1, en: 'Counter (sells for $)', vi: 'Quầy (bán ra $)' },
  unlock: { color: '#bbf7d0', height: 0.05, en: '$ Unlock pad', vi: 'Ô $ mở khoá' },
  player: { color: '#f97316', height: 0.05, en: 'Player start', vi: 'Nhân vật bắt đầu' }
}

let uid = 0
const nid = (p: string): string => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`

export class PlanEditor {
  public plan: Plan = { shapes: [], wires: [] }
  public on_build: ((p: Plan) => void) | null = null
  public on_play: ((p: Plan) => void) | null = null
  public on_change: ((p: Plan) => void) | null = null
  private root: HTMLDivElement | null = null
  private cv!: HTMLCanvasElement
  private g!: CanvasRenderingContext2D
  private tool: 'select' | 'wire' | 'text' | PlanForm = 'select'
  private sel: string | null = null // shape or wire id
  private scale = 8 // px per metre
  private ox = 0; private oy = 0 // screen position of the map centre
  private bg: HTMLImageElement | null = null
  private bg_alpha = 0.6
  private drag: { mode: 'move' | 'resize' | 'rotate' | 'new' | 'pan' | 'wire', sx: number, sy: number, x0: number, z0: number, s?: PlanShape, start?: PlanShape, orig?: PlanShape } | null = null
  private hover_wire_to: { x: number, z: number } | null = null
  private undo: string[] = []
  private redo: string[] = []

  constructor (private readonly size: () => number) {}

  /* ---------------- coordinates ---------------- */
  private to_screen (x: number, z: number): [number, number] { return [this.ox + x * this.scale, this.oy + z * this.scale] }
  private to_world (px: number, py: number): [number, number] { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale] }
  private fit (): void { const r = this.cv.getBoundingClientRect(); this.scale = Math.min(r.width, r.height) * 0.92 / this.size(); this.ox = r.width / 2; this.oy = r.height / 2 }

  /** point inside a shape (in its own turned frame) */
  private inside (s: PlanShape, x: number, z: number, pad = 0): boolean {
    const c = Math.cos(-s.r); const n = Math.sin(-s.r); const dx = x - s.x; const dz = z - s.z
    const u = dx * c - dz * n; const v = dx * n + dz * c
    if (s.form === 'ellipse') return (u / (s.w / 2 + pad)) ** 2 + (v / (s.d / 2 + pad)) ** 2 <= 1
    const o = form_outline(s.form); if (o !== null) return in_outline(o, u / (s.w + 2 * pad), v / (s.d + 2 * pad))
    return Math.abs(u) <= s.w / 2 + pad && Math.abs(v) <= s.d / 2 + pad
  }
  private shape_at (x: number, z: number): PlanShape | null {
    // smallest first: a machine inside a room is picked before the room
    const hits = this.plan.shapes.filter(s => this.inside(s, x, z)).sort((a, b) => a.w * a.d - b.w * b.d)
    return hits[0] ?? null
  }
  private corner (s: PlanShape, sx: number, sz: number): [number, number] { const c = Math.cos(s.r); const n = Math.sin(s.r); const u = sx * s.w / 2; const v = sz * s.d / 2; return [s.x + u * c - v * n, s.z + u * n + v * c] }
  private get (id: string | null): PlanShape | undefined { return this.plan.shapes.find(s => s.id === id) }

  /* ---------------- history (Ctrl+Z / Cmd+Z, Ctrl+Shift+Z / Cmd+Shift+Z while the editor is open) ---------------- */
  private snap (): void { this.undo.push(JSON.stringify(this.plan)); if (this.undo.length > 80) this.undo.shift(); this.redo = [] }
  private step (back: boolean): void {
    const from = back ? this.undo : this.redo; const to = back ? this.redo : this.undo
    const s = from.pop(); if (s === undefined) return
    to.push(JSON.stringify(this.plan)); this.plan = JSON.parse(s); this.sel = null; this.changed()
  }
  private changed (): void { this.on_change?.(this.plan); this.draw(); this.props() }

  /* ---------------- open / close ---------------- */
  public open (): void {
    if (this.root !== null) { this.root.style.display = 'flex'; this.fit(); this.draw(); this.props(); return }
    const d = document.createElement('div'); this.root = d
    d.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;background:#0d1117;color:#e8edf3;font:13px/1.4 system-ui,sans-serif'
    const T = (en: string, vi: string): string => M(en, vi, en)
    const tb = (t: string, label: string, title: string): string => `<button data-t="${t}" title="${title}" style="width:44px;height:40px;border-radius:8px;border:1px solid #2c3440;background:#1f2630;color:inherit;cursor:pointer;font-size:17px">${label}</button>`
    d.innerHTML = `
      <div style="width:108px;padding:8px 6px;display:grid;grid-template-columns:repeat(2,44px);grid-auto-rows:min-content;gap:6px;align-content:start;border-right:1px solid #2c3440;overflow:auto">
        ${tb('select', '➚', T('Pointer: select / move / resize / turn (V). Drag the round handle to turn. After drawing a shape the pointer comes back (hold Shift to keep drawing).', 'Con trỏ: chọn / kéo / đổi cỡ / xoay (V). Kéo nút tròn để xoay. Vẽ xong một khối là tự về con trỏ (giữ Shift để vẽ tiếp).'))}
        ${tb('rect', '▭', T('Draw a rectangle (R)', 'Vẽ hình chữ nhật (R)'))}
        ${tb('ellipse', '◯', T('Draw an ellipse (E)', 'Vẽ hình tròn / elip (E)'))}
        ${FORMS.filter(f => f[0] !== 'rect' && f[0] !== 'ellipse').map(f => tb(f[0], f[1], T(`Draw: ${f[2]}`, `Vẽ: ${f[3]}`))).join('')}
        ${tb('wire', '↝', T('Flow wire: drag from one shape to another (W)', 'Dây flow: kéo từ khối này sang khối kia (W)'))}
        ${tb('text', 'T', T('Click a shape to type what it is (T)', 'Bấm vào khối để ghi chữ nó là gì (T)'))}
        <button data-x="undo" title="Ctrl+Z / Cmd+Z" style="height:32px;border-radius:8px;border:1px solid #2c3440;background:#1f2630;color:inherit;cursor:pointer">↶</button>
        <button data-x="redo" title="Ctrl+Shift+Z / Cmd+Shift+Z" style="height:32px;border-radius:8px;border:1px solid #2c3440;background:#1f2630;color:inherit;cursor:pointer">↷</button>
      </div>
      <div style="flex:1;position:relative;min-width:0"><canvas style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair"></canvas>
        <div style="position:absolute;left:10px;bottom:8px;opacity:.6;font-size:12px">${T('Wheel: zoom · middle / Space + drag: pan · Delete: remove · Ctrl+D: copy · double-click a shape: type its name', 'Lăn: zoom · chuột giữa / Space + kéo: dời · Delete: xoá · Ctrl+D: nhân bản · bấm đúp vào khối: ghi tên')}</div></div>
      <div data-side style="width:290px;overflow:auto;padding:10px;border-left:1px solid #2c3440;display:flex;flex-direction:column;gap:8px"></div>`
    document.body.append(d)
    this.cv = d.querySelector('canvas')!; this.g = this.cv.getContext('2d')!
    d.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'); if (b === null) return
      if (b.dataset.t !== undefined) { this.tool = b.dataset.t as any; this.draw(); this.props() }
      const x = b.dataset.x
      if (x === 'undo') this.step(true); else if (x === 'redo') this.step(false)
    })
    new ResizeObserver(() => { const r = this.cv.getBoundingClientRect(); this.cv.width = r.width * devicePixelRatio; this.cv.height = r.height * devicePixelRatio; if (this.ox === 0) this.fit(); this.draw() }).observe(this.cv)
    this.bind()
    this.fit(); this.draw(); this.props()
  }

  public close (): void { if (this.root !== null) this.root.style.display = 'none' }
  public is_open (): boolean { return this.root !== null && this.root.style.display !== 'none' }
  public set_plan (p: Plan | undefined): void { this.plan = p !== undefined && Array.isArray(p.shapes) ? p : { shapes: [], wires: [] }; if (this.root !== null) { this.draw(); this.props() } }
  public set_background (img: HTMLImageElement | null): void { this.bg = img; if (this.root !== null) this.draw() }

  /* ---------------- input ---------------- */
  private bind (): void {
    const cv = this.cv; let space = false
    const P = (e: MouseEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    cv.addEventListener('wheel', e => {
      e.preventDefault()
      // Mac trackpad: two-finger swipe pans the map, pinch zooms smoothly; a mouse wheel zooms in steps
      if (is_trackpad(e)) { this.ox -= e.deltaX; this.oy -= e.deltaY; this.draw(); return }
      const [px, py] = P(e); const [wx, wz] = this.to_world(px, py)
      this.scale *= e.ctrlKey ? pinch_factor(e) : e.deltaY < 0 ? 1.12 : 1 / 1.12
      this.ox = px - wx * this.scale; this.oy = py - wz * this.scale; this.draw()
    }, { passive: false })
    cv.addEventListener('dblclick', e => { const [wx, wz] = this.to_world(...P(e)); const s = this.shape_at(wx, wz); if (s !== null) this.rename(s) })
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId)
      const [px, py] = P(e); const [x, z] = this.to_world(px, py)
      if (e.button === 1 || (e.button === 0 && space)) { this.drag = { mode: 'pan', sx: px, sy: py, x0: this.ox, z0: this.oy }; return }
      if (e.button !== 0) return
      const sel = this.get(this.sel)
      if (this.tool === 'select' && sel !== undefined) {
        // handles of the selected shape: corners resize, the dot above turns
        const [hx, hz] = this.corner(sel, 0, -1); const rx = hx + Math.sin(sel.r) * (1.2 + 14 / this.scale); const rz = hz - Math.cos(sel.r) * (1.2 + 14 / this.scale)
        if (Math.hypot(x - rx, z - rz) * this.scale < 9) { this.snap(); this.drag = { mode: 'rotate', sx: px, sy: py, x0: x, z0: z, s: sel }; return }
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [cx, cz] = this.corner(sel, a, b); if (Math.hypot(x - cx, z - cz) * this.scale < 8) { this.snap(); this.drag = { mode: 'resize', sx: a, sy: b, x0: x, z0: z, s: sel, orig: { ...sel } }; return } }
      }
      const hit = this.shape_at(x, z)
      if (this.tool === 'select') {
        const w = hit === null ? this.wire_at(x, z) : null
        this.sel = hit?.id ?? w?.id ?? null
        if (hit !== null) { this.snap(); this.drag = { mode: 'move', sx: px, sy: py, x0: x - hit.x, z0: z - hit.z, s: hit } }
        this.draw(); this.props(); return
      }
      if (this.tool === 'text') { if (hit !== null) { this.sel = hit.id; this.rename(hit) } return }
      if (this.tool === 'wire') { if (hit !== null) { this.drag = { mode: 'wire', sx: px, sy: py, x0: x, z0: z, start: hit } } return }
      // new rectangle / ellipse
      this.snap()
      const s: PlanShape = { id: nid('s'), kind: 'block', form: this.tool as PlanForm, x, z, w: 0.1, d: 0.1, r: 0, label: '', color: KIND_INFO.block.color, height: KIND_INFO.block.height }
      this.plan.shapes.push(s); this.sel = s.id
      this.drag = { mode: 'new', sx: px, sy: py, x0: x, z0: z, s }
    })
    cv.addEventListener('pointermove', e => {
      const [px, py] = P(e); const [x, z] = this.to_world(px, py); const d = this.drag
      if (d === null) return
      if (d.mode === 'pan') { this.ox = d.x0 + px - d.sx; this.oy = d.z0 + py - d.sy }
      else if (d.mode === 'move' && d.s !== undefined) { d.s.x = this.snapv(x - d.x0); d.s.z = this.snapv(z - d.z0) }
      else if (d.mode === 'new' && d.s !== undefined) { d.s.x = (d.x0 + x) / 2; d.s.z = (d.z0 + z) / 2; d.s.w = Math.max(0.2, Math.abs(x - d.x0)); d.s.d = Math.max(0.2, Math.abs(z - d.z0)); if (e.shiftKey) { const m = Math.max(d.s.w, d.s.d); d.s.w = d.s.d = m } }
      else if (d.mode === 'rotate' && d.s !== undefined) { let a = Math.atan2(x - d.s.x, -(z - d.s.z)); if (!e.altKey) a = Math.round(a / (Math.PI / 24)) * (Math.PI / 24); d.s.r = a }
      else if (d.mode === 'resize' && d.s !== undefined && d.orig !== undefined) {
        // the opposite corner stays where it is
        const o = d.orig; const c = Math.cos(o.r); const n = Math.sin(o.r)
        const ax = o.x - d.sx * o.w / 2 * c + d.sy * o.d / 2 * n; const az = o.z - d.sx * o.w / 2 * n - d.sy * o.d / 2 * c
        const dx = x - ax; const dz = z - az; const u = dx * c + dz * n; const v = -dx * n + dz * c
        d.s.w = Math.max(0.2, Math.abs(u)); d.s.d = Math.max(0.2, Math.abs(v))
        d.s.x = ax + (u / 2) * c - (v / 2) * n; d.s.z = az + (u / 2) * n + (v / 2) * c
      } else if (d.mode === 'wire') this.hover_wire_to = { x, z }
      this.draw()
    })
    const up = (e: PointerEvent): void => {
      const d = this.drag; this.drag = null
      if (d === null) return
      if (d.mode === 'new' && d.s !== undefined && d.s.w < 0.5 && d.s.d < 0.5) { d.s.w = 3; d.s.d = 3 }
      // a shape is drawn: back to the pointer to pick / move it (hold Shift to keep drawing)
      if ((d.mode === 'new' || d.mode === 'wire') && !e.shiftKey) { this.tool = 'select'; this.props() }
      if (d.mode === 'wire' && d.start !== undefined) {
        const [px, py] = (() => { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] })()
        const end = this.shape_at(...this.to_world(px, py))
        if (end !== null && end !== d.start && !this.plan.wires.some(w => w.from === d.start!.id && w.to === end.id)) {
          this.snap()
          const mode = d.start.kind === 'unlock' ? 'unlock' : 'carry'
          const w: PlanWire = { id: nid('w'), from: d.start.id, to: end.id, mode }
          this.plan.wires.push(w); this.sel = w.id
          // the receiving end takes what the giving end gives
          if (d.start.gives !== undefined && d.start.gives !== '' && (end.takes === undefined || end.takes === '') && ['machine', 'counter', 'stack'].includes(end.kind)) end.takes = d.start.gives
        }
        this.hover_wire_to = null
      }
      if (d.mode !== 'pan') this.changed(); else this.draw()
    }
    cv.addEventListener('pointerup', up)
    addEventListener('keydown', e => {
      if (!this.is_open()) return
      const t = e.target as HTMLElement; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) { if (typing) return; e.preventDefault(); e.stopImmediatePropagation(); this.step(!(e.shiftKey || e.code === 'KeyY')); return }
      if (typing) return
      e.stopImmediatePropagation() // the play test behind must not move / attack
      if (e.code === 'Space') { space = true; e.preventDefault() }
      if (e.code === 'Escape') this.close()
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.remove_selected() }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); this.duplicate() }
      if (!e.ctrlKey && !e.metaKey) { const k = ({ KeyV: 'select', KeyR: 'rect', KeyE: 'ellipse', KeyW: 'wire', KeyT: 'text' } as any)[e.code]; if (k !== undefined) { this.tool = k; this.props() } }
      if (e.code === 'KeyZ' || e.code === 'KeyX') { const s = this.get(this.sel); if (s !== undefined && !e.ctrlKey && !e.metaKey) { this.snap(); s.r += (e.code === 'KeyZ' ? 1 : -1) * (e.altKey ? Math.PI / 2 : Math.PI / 12); this.changed() } }
    }, true)
    addEventListener('keyup', e => { if (e.code === 'Space') space = false })
  }

  private snapv (v: number): number { return Math.round(v * 4) / 4 } // 25 cm grid while moving

  private wire_at (x: number, z: number): PlanWire | null {
    for (const w of this.plan.wires) {
      const a = this.get(w.from); const b = this.get(w.to); if (a === undefined || b === undefined) continue
      const vx = b.x - a.x; const vz = b.z - a.z; const L = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L))
      if (Math.hypot(a.x + vx * t - x, a.z + vz * t - z) * this.scale < 7) return w
    }
    return null
  }

  private rename (s: PlanShape): void {
    const v = prompt(M('What is this block? (e.g. Tree, Pizza maker, Counter, $ 2nd room)', 'Khối này là gì? (vd. Cây, Máy làm pizza, Quầy, $ phòng 2)', '이 블록은?'), s.label)
    if (v === null) return
    this.snap(); s.label = v.trim(); this.guess_kind(s); this.changed()
  }

  /** a name says a lot: "$ …" = unlock pad, "counter" = counter, "stack" = pile, "player" = start… */
  private guess_kind (s: PlanShape): void {
    const t = s.label.toLowerCase()
    const k: PlanKind | null = /^\$|unlock|mở khoá|hire|thuê/.test(t) ? 'unlock' : /player|nhân vật/.test(t) ? 'player' : /counter|quầy|cashier|thu ngân/.test(t) ? 'counter'
      : /stack|pile|xếp|chồng|shelf|kệ/.test(t) ? 'stack' : /maker|machine|máy|oven|lò|grinder|nghiền|press|mill/.test(t) ? 'machine'
        : /tree|cây|field|ruộng|mine|mỏ|volcano|farm|source|nguồn|rock|đá/.test(t) ? 'source' : /room|phòng|zone|khu|road|đường|drive/.test(t) ? 'zone' : null
    if (k === null || k === s.kind) return
    s.kind = k; s.height = KIND_INFO[k].height
    if (k === 'source' && (s.gives ?? '') === '') s.gives = (t.match(/cheese|wood|gỗ|stone|đá|pizza|burger|milk|sữa|egg|trứng/)?.[0]) ?? 'item'
    if (k === 'unlock' && s.price === undefined) s.price = 50
  }

  private remove_selected (): void {
    if (this.sel === null) return
    this.snap()
    this.plan.shapes = this.plan.shapes.filter(s => s.id !== this.sel)
    this.plan.wires = this.plan.wires.filter(w => w.id !== this.sel && w.from !== this.sel && w.to !== this.sel)
    this.sel = null; this.changed()
  }

  private duplicate (): void { const s = this.get(this.sel); if (s === undefined) return; this.snap(); const c = { ...s, id: nid('s'), x: s.x + 2, z: s.z + 2 }; this.plan.shapes.push(c); this.sel = c.id; this.changed() }

  /* ---------------- auto-detect the blocks of a picture ---------------- */
  public detect (): number {
    if (this.bg === null) return 0
    const img = this.bg; const S = 256; const size = this.size()
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d', { willReadFrequently: true })!
    const k = Math.min(S / img.width, S / img.height); const dw = img.width * k; const dh = img.height * k
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh)
    // the picture's main colours; close ones (a gradient, a shadow) count as one
    const hex = (h: string): number[] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    const cols: string[] = []
    for (const col of main_colours(img, 16)) { const v = hex(col); if (!cols.some(o => { const u = hex(o); return Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 42 })) cols.push(col) }
    let cls = classify(g.getImageData(0, 0, S, S).data, cols.map(col => ({ color: col, kind: 'block' })) as any, 95); cls = majority(cls, S, S)
    const mpp = size / S; let n = 0
    this.snap()
    cols.forEach((col, li) => {
      for (const b of blobs(cls, S, S, li, 90)) {
        // smallest box around the blob: try every turn (1.5° steps) — a square has no main axis, a box always has one
        const pts = b.px.length > 1500 ? b.px.filter((_, i) => i % Math.ceil(b.px.length / 1500) === 0) : b.px
        let best = { area: Infinity, a: 0, w: 0, d: 0, cx: 0, cy: 0 }
        let edge = false
        for (const p of b.px) { const x = p % S; const y = (p - x) / S; if (x === 0 || y === 0 || x === S - 1 || y === S - 1) { edge = true; break } }
        for (let deg = 0; deg < 90; deg += 1.5) {
          const a = deg * Math.PI / 180; const ca = Math.cos(a); const sa = Math.sin(a)
          let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity
          for (const p of pts) { const x = p % S; const y = (p - x) / S; const u = x * ca + y * sa; const v = -x * sa + y * ca; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v }
          const area = (u1 - u0 + 1) * (v1 - v0 + 1)
          if (area < best.area) { const cu = (u0 + u1) / 2; const cv = (v0 + v1) / 2; best = { area, a, w: u1 - u0 + 1, d: v1 - v0 + 1, cx: cu * ca - cv * sa, cy: cu * sa + cv * ca } }
        }
        const fill = b.area / best.area
        if (fill < 0.55) continue // a ragged piece (text, a gradient band, a shadow)
        if (edge && b.area > S * S * 0.2) continue // the paper / the grass around the plan
        const w = best.w * mpp; const d = best.d * mpp
        const round = fill > 0.68 && fill < 0.86 && Math.max(best.w, best.d) / Math.min(best.w, best.d) < 1.5 && b.area < S * S * 0.03
        const big = b.area > S * S * 0.04
        this.plan.shapes.push({ id: nid('s'), kind: big ? 'zone' : 'block', form: round ? 'ellipse' : 'rect', x: best.cx * mpp - size / 2, z: best.cy * mpp - size / 2, w, d, r: best.a > Math.PI / 4 ? best.a - Math.PI / 2 : best.a, label: '', color: col, height: big ? 0.05 : 1 })
        if (best.a > Math.PI / 4) { const s2 = this.plan.shapes[this.plan.shapes.length - 1]; [s2.w, s2.d] = [s2.d, s2.w] }
        n++
      }
    })
    // big zones first so the smaller blocks are drawn (and picked) on top
    this.plan.shapes.sort((a, b) => b.w * b.d - a.w * a.d)
    this.changed()
    return n
  }

  /* ---------------- drawing ---------------- */
  private draw (): void {
    if (this.root === null) return
    const g = this.g; const W = this.cv.width / devicePixelRatio; const H = this.cv.height / devicePixelRatio
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, W, H)
    const size = this.size(); const [x0, y0] = this.to_screen(-size / 2, -size / 2); const sp = size * this.scale
    g.fillStyle = '#5f8f45'; g.fillRect(x0, y0, sp, sp)
    if (this.bg !== null) { const k = Math.min(sp / this.bg.width, sp / this.bg.height); g.globalAlpha = this.bg_alpha; g.drawImage(this.bg, x0 + (sp - this.bg.width * k) / 2, y0 + (sp - this.bg.height * k) / 2, this.bg.width * k, this.bg.height * k); g.globalAlpha = 1 }
    // 1 m grid when zoomed in, 5 m otherwise
    const step = this.scale > 14 ? 1 : 5; g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; g.beginPath()
    for (let v = -size / 2; v <= size / 2 + 1e-6; v += step) { const [a, b] = this.to_screen(v, -size / 2); g.moveTo(a, b); g.lineTo(a, b + sp); const [c, d] = this.to_screen(-size / 2, v); g.moveTo(c, d); g.lineTo(c + sp, d) }
    g.stroke()
    for (const s of this.plan.shapes) this.draw_shape(s)
    for (const w of this.plan.wires) this.draw_wire(w)
    const d = this.drag
    if (d?.mode === 'wire' && d.start !== undefined && this.hover_wire_to !== null) this.arrow(d.start.x, d.start.z, this.hover_wire_to.x, this.hover_wire_to.z, '#ffd34d', true)
    const s = this.get(this.sel)
    if (s !== undefined && this.tool === 'select') {
      g.fillStyle = '#fff'; g.strokeStyle = '#2f6fde'; g.lineWidth = 2
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [cx, cz] = this.corner(s, a, b); const [px, py] = this.to_screen(cx, cz); g.fillRect(px - 5, py - 5, 10, 10); g.strokeRect(px - 5, py - 5, 10, 10) }
      const [hx, hz] = this.corner(s, 0, -1); const L = 1.2 + 14 / this.scale; const [p1, q1] = this.to_screen(hx, hz); const [p2, q2] = this.to_screen(hx + Math.sin(s.r) * L, hz - Math.cos(s.r) * L)
      g.beginPath(); g.moveTo(p1, q1); g.lineTo(p2, q2); g.stroke(); g.beginPath(); g.arc(p2, q2, 6, 0, 7); g.fill(); g.stroke()
    }
  }

  private draw_shape (s: PlanShape): void {
    const g = this.g; const [px, py] = this.to_screen(s.x, s.z); const w = s.w * this.scale; const h = s.d * this.scale
    g.save(); g.translate(px, py); g.rotate(s.r)
    trace_form(g, s.form, w, h)
    const pad = s.kind === 'unlock' || s.kind === 'stack'
    if (pad) {
      // pads are a picture (yours, or the built-in coin / crates), clipped to the shape
      const pic: CanvasImageSource | null = s.image !== undefined && s.image !== '' ? user_image(s.image, () => this.draw()) : pad_picture(s.kind, s.color, s.kind === 'unlock' ? (s.price ?? 50) : undefined)
      g.save(); g.clip(); if (pic !== null) g.drawImage(pic, -w / 2, -h / 2, w, h); g.restore(); trace_form(g, s.form, w, h)
    } else { g.fillStyle = s.color; g.globalAlpha = this.bg !== null ? 0.72 : 0.92; g.fill(); g.globalAlpha = 1 }
    g.lineWidth = s.id === this.sel ? 3 : 1.5; g.strokeStyle = s.id === this.sel ? '#2f6fde' : 'rgba(0,0,0,.55)'
    g.stroke()
    if (pad && s.label === '') { g.restore(); return }
    // label + a small tag with the kind
    const fs = Math.max(10, Math.min(18, Math.min(w, h) * 0.28)); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = `600 ${fs}px Roboto,system-ui,sans-serif`; if (s.label !== '') g.fillText(s.label + (s.note ? ' 📝' : ''), 0, 0, w * 0.95)
    g.font = `10px system-ui,sans-serif`; g.fillStyle = 'rgba(0,0,0,.6)'
    const tag = ({ zone: '', block: '', source: `↑ ${s.gives ?? ''}`, machine: `${s.takes ?? '?'} → ${s.gives ?? '?'}`, stack: '≡', counter: `${s.takes ?? '?'} → $`, unlock: `$${s.price ?? 0}`, player: '🙂' } as Record<PlanKind, string>)[s.kind]
    if (tag !== '') g.fillText(tag, 0, Math.min(h / 2 - 7, fs + 4))
    g.restore()
  }

  private edge (s: PlanShape, tx: number, tz: number): [number, number] {
    // where the line to (tx, tz) leaves the shape (bisection on "inside")
    let lo = 0; let hi = 1; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (this.inside(s, s.x + (tx - s.x) * m, s.z + (tz - s.z) * m)) lo = m; else hi = m }
    return [s.x + (tx - s.x) * lo, s.z + (tz - s.z) * lo]
  }

  private draw_wire (w: PlanWire): void {
    const a = this.get(w.from); const b = this.get(w.to); if (a === undefined || b === undefined) return
    const [ax, az] = this.edge(a, b.x, b.z); const [bx, bz] = this.edge(b, a.x, a.z)
    this.arrow(ax, az, bx, bz, w.mode === 'belt' ? '#64748b' : w.mode === 'unlock' ? '#16a34a' : '#ffd34d', w.mode !== 'belt', w.id === this.sel)
    const item = a.gives ?? ''; if (item !== '' && w.mode !== 'unlock') { const [mx, my] = this.to_screen((ax + bx) / 2, (az + bz) / 2); this.g.font = '11px system-ui'; this.g.fillStyle = '#fff'; this.g.textAlign = 'center'; this.g.fillText(item, mx, my - 8) }
  }

  private arrow (ax: number, az: number, bx: number, bz: number, col: string, dashed: boolean, sel = false): void {
    const g = this.g; const [p1, q1] = this.to_screen(ax, az); const [p2, q2] = this.to_screen(bx, bz)
    g.save(); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = sel ? 6 : 4; if (dashed) g.setLineDash([10, 6])
    g.beginPath(); g.moveTo(p1, q1); g.lineTo(p2, q2); g.stroke(); g.setLineDash([])
    const a = Math.atan2(q2 - q1, p2 - p1); g.beginPath(); g.moveTo(p2, q2); g.lineTo(p2 - 14 * Math.cos(a - 0.45), q2 - 14 * Math.sin(a - 0.45)); g.lineTo(p2 - 14 * Math.cos(a + 0.45), q2 - 14 * Math.sin(a + 0.45)); g.closePath(); g.fill()
    g.restore()
  }

  /* ---------------- side panel ---------------- */
  private props (): void {
    const side = this.root?.querySelector<HTMLElement>('[data-side]'); if (side == null) return
    this.root!.querySelectorAll<HTMLElement>('[data-t]').forEach(b => { b.style.background = b.dataset.t === this.tool ? '#2f6fde' : '#1f2630' })
    this.cv.style.cursor = this.tool === 'select' ? 'default' : this.tool === 'text' ? 'text' : 'crosshair'
    const T = (en: string, vi: string): string => M(en, vi, en)
    const s = this.get(this.sel); const w = this.plan.wires.find(x => x.id === this.sel)
    const inp = 'width:100%;box-sizing:border-box;padding:5px;border-radius:6px;border:1px solid #39424f;background:#0e1116;color:inherit'
    const btn = 'padding:7px 8px;border-radius:7px;border:1px solid #39424f;background:#1f2630;color:inherit;cursor:pointer'
    let html = `<b style="font-size:14px">📐 ${T('2D plan → 3D playable', 'Sơ đồ 2D → playable 3D')}</b>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button data-p="bg" style="${btn}">🖼 ${T('Picture…', 'Ảnh nền…')}</button><button data-p="detect" style="${btn}" title="${T('Find the colour blocks of the picture and make a shape of each', 'Tìm các khối màu trong ảnh và tạo shape cho từng khối')}">🪄 ${T('Find blocks', 'Tự nhận khối')}</button>
      <button data-p="clear" style="${btn}">🗑 ${T('Clear', 'Xoá hết')}</button></div>
      <label style="display:flex;gap:6px;align-items:center">${T('Picture', 'Độ rõ ảnh')} <input data-p="alpha" type="range" min="0" max="100" value="${this.bg_alpha * 100}" style="flex:1"></label>
      <input data-p="file" type="file" accept="image/*" hidden>`
    if (s !== undefined) {
      const kinds = (Object.keys(KIND_INFO) as PlanKind[]).map(k => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${M(KIND_INFO[k].en, KIND_INFO[k].vi, KIND_INFO[k].en)}</option>`).join('')
      html += `<div style="border-top:1px solid #2c3440;padding-top:8px;display:flex;flex-direction:column;gap:6px">
        <label>${T('Name (what it is)', 'Tên (khối gì)')}<input data-f="label" value="${s.label.replace(/"/g, '&quot;')}" style="${inp}"></label>
        <label>📝 ${T('Note (shows when the block is clicked in 3D)', 'Ghi chú (hiện khi bấm vào khối trong 3D)')}<textarea data-f="note" rows="3" style="${inp};font-family:Roboto,system-ui,sans-serif;resize:vertical" placeholder="${T('e.g. Pizza maker: 3 s per pizza, upgrade at $500', 'vd. Máy làm pizza: 3 giây / bánh, nâng cấp ở $500')}">${(s.note ?? '').replace(/</g, '&lt;')}</textarea></label>
        <label>${T('What it does', 'Vai trò trong game')}<select data-f="kind" style="${inp}">${kinds}</select></label>
        <label>${T('Shape', 'Hình')}<select data-f="form" style="${inp}">${FORMS.map(f => `<option value="${f[0]}"${s.form === f[0] ? ' selected' : ''}>${f[1]} ${T(f[2], f[3])}</option>`).join('')}</select></label>
        <div style="display:flex;flex-wrap:wrap;gap:3px">${SWATCHES.map(c => `<button data-sw="${c}" title="${c}" style="width:20px;height:20px;padding:0;border-radius:5px;border:${s.color.toLowerCase() === c ? '2px solid #fff' : '1px solid #39424f'};background:${c};cursor:pointer"></button>`).join('')}</div>
        ${s.kind === 'unlock' || s.kind === 'stack' ? `<div style="display:flex;gap:6px;align-items:center"><button data-p="padimg" style="${btn};flex:1">🖼 ${T('Pad picture…', 'Ảnh cho ô…')}</button>${s.image !== undefined && s.image !== '' ? `<button data-p="padimg0" style="${btn}" title="${T('Back to the built-in picture', 'Về ảnh mặc định')}">✕</button>` : ''}</div><input data-p="padfile" type="file" accept="image/*" hidden>` : ''}
        <div style="display:flex;gap:6px"><label style="flex:1">${T('Colour', 'Màu')}<input data-f="color" type="color" value="${s.color}" style="${inp};padding:0;height:30px"></label><label style="flex:1">${T('Height m', 'Cao (m)')}<input data-f="height" type="number" step="0.1" min="0.02" value="${s.height}" style="${inp}"></label></div>
        <div style="display:flex;gap:6px"><label style="flex:1">${T('Width m', 'Rộng (m)')}<input data-f="w" type="number" step="0.25" value="${+s.w.toFixed(2)}" style="${inp}"></label><label style="flex:1">${T('Depth m', 'Sâu (m)')}<input data-f="d" type="number" step="0.25" value="${+s.d.toFixed(2)}" style="${inp}"></label><label style="flex:1">${T('Turn °', 'Xoay °')}<input data-f="deg" type="number" step="15" value="${Math.round(s.r * 180 / Math.PI)}" style="${inp}"></label></div>
        ${['source', 'machine'].includes(s.kind) ? `<label>${T('Gives (item)', 'Cho ra (món)')}<input data-f="gives" value="${s.gives ?? ''}" placeholder="wood / pizza…" style="${inp}"></label>` : ''}
        ${['machine', 'counter', 'stack'].includes(s.kind) ? `<label>${T('Takes (item, empty = anything)', 'Nhận vào (món, trống = gì cũng được)')}<input data-f="takes" value="${s.takes ?? ''}" style="${inp}"></label>` : ''}
        ${['source', 'machine', 'counter'].includes(s.kind) ? `<label>${T('Seconds per item', 'Số giây mỗi món')}<input data-f="time" type="number" step="0.1" min="0.1" value="${s.time ?? (s.kind === 'source' ? 0.6 : 1.2)}" style="${inp}"></label>` : ''}
        ${['counter', 'unlock'].includes(s.kind) ? `<label>${s.kind === 'counter' ? T('$ per item', '$ mỗi món') : T('$ to unlock', '$ để mở khoá')}<input data-f="price" type="number" min="0" value="${s.price ?? (s.kind === 'counter' ? 5 : 50)}" style="${inp}"></label>` : ''}
        <label>${T('3D look', 'Hình 3D')}<select data-f="model" style="${inp}"><option value="">${T('Box in its colour', 'Khối hộp theo màu')}</option>${(window as any).__gbPlanModels?.().map((m: [string, string]) => `<option value="${m[0]}"${s.model === m[0] ? ' selected' : ''}>${m[1]}</option>`).join('') ?? ''}</select></label>
        <div style="display:flex;gap:6px"><button data-p="dup" style="${btn};flex:1">⧉ ${T('Copy', 'Nhân bản')}</button><button data-p="del" style="${btn};flex:1">🗑 ${T('Delete', 'Xoá')}</button></div>
      </div>`
    } else if (w !== undefined) {
      const a = this.get(w.from); const b = this.get(w.to)
      html += `<div style="border-top:1px solid #2c3440;padding-top:8px;display:flex;flex-direction:column;gap:6px">
        <b>↝ ${a?.label || '?'} → ${b?.label || '?'}</b>
        <label>${T('Flow', 'Kiểu dây')}<select data-w="mode" style="${inp}"><option value="carry"${w.mode === 'carry' ? ' selected' : ''}>${T('Player carries the items', 'Nhân vật mang đồ đi')}</option><option value="belt"${w.mode === 'belt' ? ' selected' : ''}>${T('Belt / rail: items move by themselves', 'Băng chuyền / ray: đồ tự chạy')}</option><option value="unlock"${w.mode === 'unlock' ? ' selected' : ''}>${T('Unlock: paying the pad shows this', 'Mở khoá: trả tiền ô $ thì hiện cái này')}</option></select></label>
        <button data-p="del" style="${btn}">🗑 ${T('Delete wire', 'Xoá dây')}</button></div>`
    } else html += `<div style="opacity:.7">${T('Draw shapes (▭ ◯), name them (T or double-click), connect them (↝). A name like "Tree", "Pizza maker", "Counter", "Stack", "$ 2nd room" or "Player" sets what it does; you can change it here.', 'Vẽ khối (▭ ◯), ghi tên (T hoặc bấm đúp), nối dây (↝). Tên như "Cây", "Máy làm pizza", "Quầy", "Stack", "$ phòng 2", "Player" tự đặt vai trò; đổi lại được ở đây.')}</div>`
    html += `<div style="border-top:1px solid #2c3440;padding-top:8px;display:flex;flex-direction:column;gap:6px">
      <div style="opacity:.7">${this.plan.shapes.length} ${T('shapes', 'khối')} · ${this.plan.wires.length} ${T('wires', 'dây')}</div>
      <button data-p="build" style="${btn};background:#2f6fde;border-color:#4d8cf5">⚙ ${T('Build the 3D map', 'Dựng map 3D')}</button>
      <button data-p="play" style="${btn};background:#16a34a;border-color:#22c55e">▶ ${T('Build and play it', 'Dựng và chơi luôn')}</button>
      <button data-p="close" style="${btn}">✕ ${T('Close (Esc)', 'Đóng (Esc)')}</button></div>`
    side.innerHTML = html
    side.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach(el => {
      el.addEventListener('focus', () => this.snap(), { once: true })
      el.addEventListener('change', () => {
        const sh = this.get(this.sel); if (sh === undefined) return; const f = el.dataset.f!; const v = el.value
        if (f === 'deg') sh.r = Number(v) * Math.PI / 180
        else if (['height', 'w', 'd', 'time', 'price'].includes(f)) (sh as any)[f] = Number(v)
        else (sh as any)[f] = v
        if (f === 'kind') { sh.height = KIND_INFO[sh.kind].height; if (sh.color === '' || Object.values(KIND_INFO).some(k => k.color === sh.color)) sh.color = KIND_INFO[sh.kind].color }
        if (f === 'label') this.guess_kind(sh)
        this.changed()
      })
    })
    side.querySelectorAll<HTMLButtonElement>('[data-sw]').forEach(b => { b.onclick = () => { const sh = this.get(this.sel); if (sh === undefined) return; this.snap(); sh.color = b.dataset.sw!; this.changed() } })
    const padfile = side.querySelector<HTMLInputElement>('[data-p="padfile"]')
    if (padfile !== null) {
      padfile.onchange = () => {
        const f = padfile.files?.[0]; const sh = this.get(this.sel); if (f === undefined || sh === undefined) return
        // kept small: the picture travels inside the map / the playable file
        const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); const k = Math.min(1, 256 / Math.max(img.width, img.height)); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); this.snap(); sh.image = c.toDataURL('image/png'); this.changed() }
        img.src = URL.createObjectURL(f)
      }
    }
    side.querySelectorAll<HTMLSelectElement>('[data-w]').forEach(el => { el.onchange = () => { const wi = this.plan.wires.find(x => x.id === this.sel); if (wi === undefined) return; this.snap(); wi.mode = el.value as any; this.changed() } })
    const file = side.querySelector<HTMLInputElement>('[data-p="file"]')!
    file.onchange = () => { const f = file.files?.[0]; if (f === undefined) return; const img = new Image(); img.onload = () => { this.bg = img; (window as any).__gbPlanBg?.(img); this.draw() }; img.src = URL.createObjectURL(f) }
    side.querySelector<HTMLInputElement>('[data-p="alpha"]')!.oninput = (e) => { this.bg_alpha = Number((e.target as HTMLInputElement).value) / 100; this.draw() }
    side.querySelectorAll<HTMLElement>('button[data-p]').forEach(b => {
      b.onclick = () => {
        const p = b.dataset.p
        if (p === 'padimg') side.querySelector<HTMLInputElement>('[data-p="padfile"]')?.click()
        else if (p === 'padimg0') { const sh = this.get(this.sel); if (sh !== undefined) { this.snap(); delete sh.image; this.changed() } }
        else if (p === 'bg') file.click()
        else if (p === 'detect') { if (this.bg === null) { file.click(); return } const n = this.detect(); alert(M(`${n} blocks found. Name each one (T or double-click) and connect them with wires.`, `Tìm được ${n} khối. Ghi tên từng khối (T hoặc bấm đúp) rồi nối dây flow.`, `${n}개 블록`)) }
        else if (p === 'clear') { if (confirm(M('Remove every shape and wire?', 'Xoá hết khối và dây?', '모두 지울까요?'))) { this.snap(); this.plan = { shapes: [], wires: [] }; this.sel = null; this.changed() } }
        else if (p === 'del') this.remove_selected()
        else if (p === 'dup') this.duplicate()
        else if (p === 'build') { this.on_build?.(this.plan); this.close() }
        else if (p === 'play') { this.on_play?.(this.plan); this.close() }
        else if (p === 'close') this.close()
      }
    })
  }
}
