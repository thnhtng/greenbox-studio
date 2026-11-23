/*
 * The plan as a small idle-arcade playable (the kind of ad where you carry stacks between machines):
 *   source   stand next to it: items pop onto your back (up to CAP); with a belt wire it feeds the belt itself
 *   machine  walk past with the items it takes: they fly in; every `time` s it makes what it gives — onto its belt,
 *            into the stack it is wired to, or onto a pile beside it
 *   stack    a pile: walk past to pick its items up (or drop yours if it takes them)
 *   counter  takes items, gives $ (onto the money stack it is wired to, or a pile beside it); pick the money up
 *   unlock   stand on the $ pad: your money pays it; when paid, what its wires point to appears
 *   belt     items ride along the wire to the next shape by themselves
 *   ore      drive / walk into it: it shakes, chips fly and its items (gems) burst out and land on your back; after
 *            `hp` items it crumbles and grows back after `respawn` s. `price` = what one of its items sells for
 *   evolve   a block behind a $ pad: when paid, the player turns into that model and digs faster (drill level up)
 * A yellow arrow over the player points to what to do next. Machines made from your own animated 3D file play
 * their animation while they work.
 */
import { clone_deep } from '../common/CloneDeep.ts'
import * as THREE from 'three'
import { type Plan, type PlanShape } from './PlanEditor.ts'
import { M } from '../common/lang.ts'

const CAP = 12
const REACH = 1.3 // m outside a shape that still counts as "next to it"
interface Item { name: string, mesh: THREE.Object3D }
interface Chip { m: THREE.Mesh, v: THREE.Vector3, life: number }
interface Station { s: PlanShape, obj: THREE.Object3D | null, pile: Item[], inq: string[], t: number, on: boolean, paid: number, mixer: THREE.AnimationMixer | null, action: THREE.AnimationAction | null, last_in?: string, label: THREE.Sprite | null }
interface Flying { it: Item, from: THREE.Vector3, to: () => THREE.Vector3, t: number, done: () => void }
interface Riding { it: Item, a: THREE.Vector3, b: THREE.Vector3, d: number, len: number, to: Station }

function item_color (name: string): number {
  if (name === '$') return 0x2fbf4a
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55).getHex()
}

export class Playable {
  public money = 0
  private readonly st = new Map<string, Station>()
  private readonly group = new THREE.Group()
  private readonly back: Item[] = []
  private readonly flying: Flying[] = []
  private readonly riding: Riding[] = []
  private readonly geo = new THREE.BoxGeometry(0.34, 0.22, 0.34)
  private readonly mats = new Map<string, THREE.MeshLambertMaterial>()
  private readonly arrow: THREE.Group
  private readonly target_mark: THREE.Mesh
  private hud: HTMLDivElement
  private tick_t = 0
  private time = 0
  /** ⛏ drill level: each evolution digs faster and carries more */
  public drill_lv = 0
  private dig_speed = 1
  private cap = CAP
  /** true while the player is digging an ore (the player's Dig animation) */
  public drilling = false
  /** the player became another model (evolve pad paid): the app can swap animations too */
  public on_evolve: ((s: PlanShape, obj: THREE.Object3D | null) => void) | null = null
  /** something solid appeared / went (an ore crumbled, a block was unlocked): the app rebuilds its collision */
  public on_world: (() => void) | null = null
  private dig_target: Station | null = null
  /** the item's own 3D look (an ore's `item` model, e.g. its small stone), by item name; else a gem / bill / box */
  public readonly item_models = new Map<string, THREE.Object3D>()
  /** a vehicle carries its load IN its bin (local to the player: centre, cells across × along, cell size); null = on the back */
  public bed: { x: number, y: number, z: number, cols: number, rows: number, step: number } | null | undefined = undefined
  private toast_t = 0
  /** juice hook (sound, floating text, shake…): kind = hit | crumble | pickup | money | drop | sell | pay | unlock | evolve | locked */
  public on_fx: ((kind: string, at: THREE.Vector3, n: number) => void) | null = null
  /** what the guide points at right now (the objective line of a playable reads it) */
  public goal: { kind: 'dig' | 'take' | 'sell' | 'deliver' | 'money' | 'collect' | 'pay', label: string, left: number, price: number, at: THREE.Vector3 } | null = null
  /** every $ pad is paid (a playable shows its end card) */
  public done = false
  /** money earned since the start (spent or not) */
  public earned = 0
  private shown_money = 0
  private fx (kind: string, at: THREE.Vector3, n = 0): void { this.on_fx?.(kind, at, n) }
  public carried (): { name: string, n: number, cap: number, color: number } { const name = this.back.length > 0 ? this.back[0].name : ''; return { name, n: this.back.length, cap: this.cap, color: this.item_color_of.get(name) ?? item_color(name) } }
  private readonly chips: Chip[] = []
  private readonly item_color_of = new Map<string, number>()
  private readonly item_value = new Map<string, number>()
  private readonly gem_geo = new THREE.OctahedronGeometry(0.2, 0)
  private readonly bill_geo = new THREE.BoxGeometry(0.42, 0.06, 0.24)
  private readonly chip_geo = new THREE.DodecahedronGeometry(0.09, 0)

  constructor (private readonly plan: Plan, private readonly scene: THREE.Scene, private readonly find: (pid: string) => THREE.Object3D | null, private readonly player: () => THREE.Object3D | null, view: HTMLElement, on_exit: () => void) {
    this.group.name = 'Playable'; scene.add(this.group)
    for (const s of plan.shapes) if ((s.kind === 'ore' || s.kind === 'source') && (s.gives ?? '') !== '') { this.item_color_of.set(s.gives!, new THREE.Color(s.color).getHex()); if (s.price !== undefined) this.item_value.set(s.gives!, s.price) }
    for (const s of plan.shapes.filter(x => x.kind !== 'camera')) this.st.set(s.id, { s, obj: find(s.id), pile: [], inq: [], t: 0, on: true, paid: 0, mixer: null, action: null, label: null })
    // things behind an unlock pad start hidden
    for (const w of plan.wires) if (w.mode === 'unlock') { const t = this.st.get(w.to); if (t !== undefined) { t.on = false; this.show(t, false) } }
    for (const t of this.st.values()) {
      const clips = (t.obj?.userData.clips as THREE.AnimationClip[] | undefined)?.filter(c => c instanceof THREE.AnimationClip) // a GLB turns them into plain data
      if (t.obj !== null && clips !== undefined && clips.length > 0) { t.mixer = new THREE.AnimationMixer(t.obj); t.action = t.mixer.clipAction(clips[0]); t.action.play(); t.mixer.timeScale = 0 }
      if (t.s.kind === 'unlock') t.label = this.text_sprite(`$${t.s.price ?? 50}`, t)
    }
    // guide arrow over the player + a ring on the target
    this.arrow = new THREE.Group()
    const am = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true })
    // three flat chevrons on the ground, running towards the target (read at a glance from a top-down camera)
    const chev = new THREE.Shape(); chev.moveTo(0, 0.34); chev.lineTo(0.42, -0.1); chev.lineTo(0.42, -0.34); chev.lineTo(0, 0.1); chev.lineTo(-0.42, -0.34); chev.lineTo(-0.42, -0.1); chev.closePath()
    const cg = new THREE.ShapeGeometry(chev); cg.rotateX(Math.PI / 2) // +y of the shape -> +z (forward)
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(cg, am.clone()); (m.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide; m.position.z = i * 0.62; m.renderOrder = 50; this.arrow.add(m) }
    this.arrow.renderOrder = 50; this.group.add(this.arrow)
    this.target_mark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }))
    this.target_mark.rotation.x = -Math.PI / 2; this.target_mark.renderOrder = 49; this.group.add(this.target_mark)
    // money HUD
    this.hud = document.createElement('div')
    this.hud.style.cssText = 'position:absolute;left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));z-index:20;display:flex;gap:8px;align-items:center;font:800 20px system-ui,-apple-system,sans-serif;color:#fff'
    const pill = 'display:flex;align-items:center;gap:7px;height:38px;padding:0 14px 0 6px;border-radius:999px;background:linear-gradient(#222c3de8,#111824e8);border:1.5px solid #ffffff30;box-shadow:0 4px 14px #0006,inset 0 1px 0 #ffffff26'
    this.hud.innerHTML = `<div data-pill style="${pill}"><span style="width:27px;height:27px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe98a,#f5b400 60%,#c98a00);box-shadow:inset 0 -2px 0 #0003,0 1px 2px #0006;display:grid;place-items:center;font:900 16px system-ui;color:#7a4a00">$</span><span data-m style="min-width:22px;font-variant-numeric:tabular-nums;letter-spacing:.2px">0</span></div><div data-c style="${pill};padding:0 12px 0 10px;font-size:15px;display:none"><span data-cd style="width:13px;height:13px;border-radius:4px;transform:rotate(45deg);box-shadow:inset 0 0 0 1.5px #fff8"></span><span data-ct style="font-variant-numeric:tabular-nums"></span></div><button data-exit style="font:600 13px system-ui;padding:6px 10px;border-radius:8px;border:0;background:#1f2630cc;color:#fff;cursor:pointer;pointer-events:auto">✕ ${M('Stop playable', 'Thoát playable', '종료')}</button>`
    view.append(this.hud)
    this.hud.querySelector<HTMLButtonElement>('[data-exit]')!.onclick = () => on_exit()
    // start where the plan says
    const start = plan.shapes.find(s => s.kind === 'player'); const p = player()
    if (start !== undefined && p !== null) { p.position.x = start.x; p.position.z = start.z }
  }

  /* ---------------- helpers ---------------- */
  private mat (name: string): THREE.MeshLambertMaterial { let m = this.mats.get(name); if (m === undefined) { const c = this.item_color_of.get(name); m = c !== undefined ? new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.1, flatShading: true }) as any : new THREE.MeshLambertMaterial({ color: item_color(name) }); this.mats.set(name, m!) } return m }
  private make (name: string, at: THREE.Vector3): Item {
    const tm = this.item_models.get(name)
    if (tm !== undefined) {
      const o = clone_deep(tm); o.traverse(q => { const m = q as THREE.Mesh; if (m.isMesh === true) m.castShadow = true })
      const b = new THREE.Box3().setFromObject(o); const k = 0.34 / Math.max(1e-3, b.getSize(new THREE.Vector3()).length() / Math.sqrt(3)); o.scale.multiplyScalar(k)
      const w = new THREE.Group(); const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); o.position.sub(c); w.add(o); w.position.copy(at); this.group.add(w); return { name, mesh: w }
    }
    return this.make_simple(name, at)
  }
  private make_simple (name: string, at: THREE.Vector3): Item { const gem = this.item_color_of.has(name) && [...this.st.values()].some(t => t.s.kind === 'ore' && t.s.gives === name); const mesh = new THREE.Mesh(name === '$' ? this.bill_geo : gem ? this.gem_geo : this.geo, this.mat(name)); mesh.position.copy(at); mesh.castShadow = true; this.group.add(mesh); return { name, mesh } }
  private center (t: Station): THREE.Vector3 { return new THREE.Vector3(t.s.x, 0, t.s.z) }
  private show (t: Station, on: boolean): void { t.obj?.traverse(o => { o.visible = on }) }
  private near (t: Station, p: THREE.Vector3): boolean {
    const s = t.s; const c = Math.cos(-s.r); const n = Math.sin(-s.r); const dx = p.x - s.x; const dz = p.z - s.z
    const u = Math.abs(dx * c - dz * n) - s.w / 2; const v = Math.abs(dx * n + dz * c) - s.d / 2
    return Math.max(u, v) < REACH
  }
  private wires_out (t: Station, mode?: string): Station[] { return this.plan.wires.filter(w => w.from === t.s.id && (mode === undefined || w.mode === mode)).map(w => this.st.get(w.to)).filter((x): x is Station => x !== undefined && x.on) }
  private accepts (t: Station, name: string): boolean { return t.on && ['machine', 'counter', 'stack'].includes(t.s.kind) && ((t.s.takes ?? '') === '' ? name !== '$' : t.s.takes === name) }
  /** where a station's output goes: a stack it is wired to, else its own pile */
  private output (t: Station): Station { return this.wires_out(t).find(x => x.s.kind === 'stack') ?? t }
  /** world spot of the n-th item on a pile (columns of 6, beside the shape) */
  private pile_spot (t: Station, n: number): THREE.Vector3 {
    const s = t.s; const own = t.s.kind === 'stack'
    const col = Math.floor(n / 6); const row = n % 6
    const lx = own ? (col % 3 - 1) * 0.4 : s.w / 2 + 0.45 + (col % 2) * 0.4; const lz = own ? (Math.floor(col / 3) - 0.5) * 0.4 : 0
    const c = Math.cos(s.r); const sn = Math.sin(s.r)
    const base = own ? 0.12 : 0
    return new THREE.Vector3(s.x + lx * c - lz * sn, base + 0.11 + row * 0.23, s.z + lx * sn + lz * c)
  }
  /** a player with no skeleton is a vehicle: its bin is the back half of its top (computed from its look) */
  private bed_from (p: THREE.Object3D): void {
    let skin = false; p.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh === true) skin = true })
    if (skin) { this.bed = null; return }
    const inv = new THREE.Matrix4().copy(p.matrixWorld).invert(); const b = new THREE.Box3()
    p.updateMatrixWorld(true)
    p.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh !== true || !o.visible || this.back.some(i => i.mesh === o)) return; let vis = true; for (let q: THREE.Object3D | null = o; q !== null && q !== p; q = q.parent) if (!q.visible) vis = false; if (!vis) return; m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))) })
    if (b.isEmpty()) { this.bed = null; return }
    const sz = b.getSize(new THREE.Vector3())
    const step = Math.max(0.18, Math.min(sz.x / 3.4, 0.42))
    this.bed = { x: (b.min.x + b.max.x) / 2, y: b.min.y + sz.y * 0.58, z: b.min.z + sz.z * 0.24, cols: 3, rows: 2, step }
  }
  private back_spot (n: number): THREE.Vector3 {
    const p = this.player(); if (p === null) return new THREE.Vector3()
    if (this.bed === undefined) this.bed_from(p)
    if (this.bed !== null && this.bed !== undefined) {
      const B = this.bed; const per = B.cols * B.rows; const layer = Math.floor(n / per); const k = n % per
      const local = new THREE.Vector3(B.x + (k % B.cols - (B.cols - 1) / 2) * B.step, B.y + layer * B.step * 0.75, B.z + (Math.floor(k / B.cols) - (B.rows - 1) / 2) * B.step)
      return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation.y).add(p.position)
    }
    const yaw = p.rotation.y; const off = new THREE.Vector3(0, 0, -0.38).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    return p.position.clone().add(off).setY(p.position.y + 0.95 + n * 0.23)
  }
  private fly (it: Item, to: () => THREE.Vector3, done: () => void): void { this.flying.push({ it, from: it.mesh.position.clone(), to, t: 0, done }) }
  private add_pile (t: Station, it: Item): void { const n = t.pile.length; t.pile.push(it); this.fly(it, () => this.pile_spot(t, n), () => {}) }
  private text_sprite (text: string, t: Station): THREE.Sprite {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d')!
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }))
    sp.userData.draw = (s: string) => { g.clearRect(0, 0, 256, 96); g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(8, 8, 240, 80, 20); g.fill(); g.fillStyle = '#7CFC8a'; g.font = '800 54px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, 128, 50); (sp.material.map as THREE.CanvasTexture).needsUpdate = true }
    sp.userData.draw(text); sp.scale.set(2, 0.75, 1); sp.position.set(t.s.x, 1.6, t.s.z); sp.renderOrder = 60; this.group.add(sp)
    return sp
  }

  /* ---------------- the game ---------------- */
  public update (dt: number): void {
    this.time += dt
    const p = this.player(); if (p === null) return
    const pos = p.position
    this.tick_t += dt; const tick = this.tick_t > 0.12; if (tick) this.tick_t = 0
    const carry = this.back.length > 0 ? this.back[0].name : ''
    this.drilling = false
    // ⛏ only the nearest ore in reach is dug (a wall of ores is dug one block at a time)
    {
      let bd = Infinity; this.dig_target = null
      for (const t of this.st.values()) { if (t.s.kind !== 'ore' || !t.on || (t.obj as any)?.__gone === true || !this.near(t, pos)) continue; const d = Math.hypot(t.s.x - pos.x, t.s.z - pos.z); if (d < bd) { bd = d; this.dig_target = t } }
      const dt0 = this.dig_target
      if (dt0 !== null && (dt0.s.need ?? 0) > this.drill_lv) { this.toast_t -= dt; if (this.toast_t <= 0) { this.toast(M('🔒 Upgrade the drill to dig this!', '🔒 Nâng cấp mũi khoan để đào khối này!', '🔒 드릴을 업그레이드하세요!')); this.toast_t = 2; this.fx('locked', this.center(dt0), 0) } this.dig_target = null }
    }
    for (const t of this.st.values()) {
      if (!t.on) continue
      const s = t.s; const here = this.near(t, pos)
      if (s.kind === 'source') {
        const belts = this.wires_out(t, 'belt')
        const time = s.time ?? 0.6; const give = s.gives ?? 'item'
        if (belts.length > 0) { t.t += dt; if (t.t >= time * 1.5) { t.t = 0; this.send(this.make(give, this.center(t).setY(0.5)), t, belts[0]) } }
        else if (here && this.back.length < this.cap && (carry === '' || carry === give)) { t.t += dt; if (t.t >= time) { t.t = 0; this.to_back(this.make(give, this.center(t).setY(1))); this.fx('pickup', this.center(t).setY(1), this.back.length) } }
      } else if (s.kind === 'ore') {
        const o = t.obj as any
        if (o?.__gone === true) { // crumbled: grows back
          o.__back = (o.__back ?? 0) + dt
          if ((s.respawn ?? 4) > 0 && o.__back >= (s.respawn ?? 4)) { o.__gone = false; o.__back = 0; t.paid = 0; this.show(t, true); o.scale.setScalar(0.01); o.__grow = 0; this.on_world?.() }
        } else if (t === this.dig_target && this.back.length < this.cap && (carry === '' || carry === (s.gives ?? 'gem'))) {
          this.drilling = true
          t.t += dt * this.dig_speed
          if (t.obj !== null) { const k = 0.06; t.obj.rotation.z = (Math.random() - 0.5) * k; t.obj.rotation.x = (Math.random() - 0.5) * k } // it shakes under the drill
          if (Math.random() < dt * 22) this.chip(this.center(t).setY(Math.max(0.4, s.height * 0.6)), new THREE.Color(s.color).multiplyScalar(0.55).getHex())
          if (t.t >= (s.time ?? 0.5)) {
            t.t = 0; t.paid++; this.fx('hit', this.center(t).setY(Math.max(0.6, s.height)), this.back.length + 1)
            // the gem bursts out in an arc, then lands on the back
            const it = this.make(s.gives ?? 'gem', this.center(t).setY(Math.max(0.6, s.height)))
            const n = this.back.length; this.back.push(it)
            const from = it.mesh.position.clone(); const side = new THREE.Vector3((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 2.4)
            const top = from.clone().add(side).setY(from.y + 1.6)
            this.fly(it, () => top, () => { this.fly(it, () => this.back_spot(n), () => {}) })
            for (let k = 0; k < 5; k++) this.chip(this.center(t).setY(Math.max(0.5, s.height * 0.8)), new THREE.Color(s.color).getHex())
            if (t.paid >= (s.hp ?? 6)) { // crumbles
              for (let k = 0; k < 18; k++) this.chip(this.center(t).setY(0.5), new THREE.Color(s.color).multiplyScalar(0.5).getHex())
              if (t.obj !== null) { t.obj.rotation.set(0, t.obj.rotation.y, 0); (t.obj as any).__gone = true; this.show(t, false); this.on_world?.() }
              this.fx('crumble', this.center(t).setY(0.6), 0)
            }
          }
        } else if (t.obj !== null && o?.__grow === undefined) { t.obj.rotation.x = 0; t.obj.rotation.z = 0 }
      } else if (s.kind === 'machine' || s.kind === 'counter') {
        // load what the player carries
        if (here && tick && carry !== '' && this.accepts(t, carry)) { const it = this.back.pop()!; this.fly(it, () => this.center(t).setY(s.height + 0.2), () => { this.group.remove(it.mesh); t.inq.push(it.name) }); this.fx('drop', this.center(t).setY(s.height + 0.2), this.back.length) }
        // work
        if (t.inq.length > 0) {
          t.t += dt; if (t.mixer !== null) t.mixer.timeScale = 1
          if (t.t >= (s.time ?? 1.2)) {
            t.t = 0; t.last_in = t.inq.shift()
            const out = s.kind === 'counter' ? '$' : (s.gives ?? 'item')
            const n = s.kind === 'counter' ? Math.max(1, Math.round((this.item_value.get(t.last_in ?? '') ?? s.price ?? 5) / 5)) : 1
            if (s.kind === 'counter') this.fx('sell', this.center(t).setY(s.height + 0.4), n * 5)
            for (let k = 0; k < n; k++) {
              const it = this.make(out, this.center(t).setY(s.height + 0.3))
              const belt = s.kind === 'machine' ? this.wires_out(t, 'belt')[0] : undefined
              if (belt !== undefined) this.send(it, t, belt); else this.add_pile(this.output(t), it)
            }
          }
        } else if (t.mixer !== null) t.mixer.timeScale = 0
      }
      // piles: pick up (money always; items when the hands are free or hold the same)
      if (here && tick && t.pile.length > 0) {
        const top = t.pile[t.pile.length - 1]
        if (top.name === '$') { t.pile.pop(); this.fly(top, () => pos.clone().setY(pos.y + 1), () => { this.group.remove(top.mesh); this.money += 5; this.earned += 5; this.fx('money', pos.clone().setY(pos.y + 1.4), 5) }) }
        else if ((carry === '' || carry === top.name) && this.back.length < this.cap) { t.pile.pop(); this.to_back(top); this.fx('pickup', pos.clone().setY(pos.y + 1), this.back.length) }
      } else if (s.kind === 'stack' && here && tick && t.pile.length === 0 && carry !== '' && (s.takes ?? '') !== '' && this.accepts(t, carry)) {
        const it = this.back.pop()!; this.add_pile(t, it)
      }
      if (s.kind === 'unlock' && here && tick && this.money > 0 && t.paid < (s.price ?? 50)) {
        const pay = Math.min(this.money, Math.max(1, Math.ceil((s.price ?? 50) / 25))); this.money -= pay; t.paid += pay
        const coin = this.make('$', pos.clone().setY(pos.y + 1)); this.fly(coin, () => this.center(t).setY(0.2), () => this.group.remove(coin.mesh))
        t.label?.userData.draw(`$${Math.max(0, (s.price ?? 50) - t.paid)}`); this.fx('pay', this.center(t).setY(0.4), pay)
        if (t.paid >= (s.price ?? 50)) this.unlock(t)
      }
      t.mixer?.update(dt)
    }
    this.move_items(dt)
    this.guide(pos, carry)
    // HUD: the money counts up and bumps, the load shows as n / cap in the item's colour
    if (this.shown_money !== this.money) {
      const d = this.money - this.shown_money; const step = Math.sign(d) * Math.max(1, Math.round(Math.abs(d) * Math.min(1, dt * 12)))
      const up = d > 0; this.shown_money += Math.abs(step) > Math.abs(d) ? d : step
      const m = this.hud.querySelector('[data-m]') as HTMLElement; m.textContent = String(this.shown_money)
      if (up && tick) (this.hud.querySelector('[data-pill]') as HTMLElement).animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' })
    }
    const c = this.hud.querySelector('[data-c]') as HTMLElement
    if (this.back.length > 0) { const k = this.carried(); c.style.display = 'flex'; (c.querySelector('[data-cd]') as HTMLElement).style.background = '#' + k.color.toString(16).padStart(6, '0'); const ct = c.querySelector('[data-ct]') as HTMLElement; ct.textContent = `${k.n}/${k.cap}`; ct.style.color = k.n >= k.cap ? '#ffd23f' : '#fff' } else c.style.display = 'none'
  }

  private to_back (it: Item): void { const n = this.back.length; this.back.push(it); this.fly(it, () => this.back_spot(n), () => {}) }

  private send (it: Item, from: Station, to: Station): void {
    const a = this.center(from).setY(0.35); const b = this.center(to).setY(0.35)
    this.riding.push({ it, a, b, d: 0, len: a.distanceTo(b), to })
  }

  private unlock (t: Station): void {
    t.on = false; this.show(t, false); t.label?.removeFromParent()
    for (const w of this.plan.wires) if (w.from === t.s.id && w.mode === 'unlock') {
      const x = this.st.get(w.to); if (x === undefined) continue
      if (x.s.evolve === true) { this.evolve(x); continue }
      x.on = true; this.show(x, true); x.obj?.scale.setScalar(0.01); (x.obj as any).__grow = 0
    }
    this.on_world?.()
    this.fx('unlock', this.center(t).setY(0.6), 0)
    const pads = [...this.st.values()].filter(x => x.s.kind === 'unlock')
    this.done = pads.length > 0 && pads.every(x => x.paid >= (x.s.price ?? 50))
  }

  private toast (text: string): void {
    let el = this.hud.querySelector<HTMLElement>('[data-toast]')
    if (el === null) { el = document.createElement('div'); el.dataset.toast = '1'; el.style.cssText = 'position:absolute;left:50%;top:18%;transform:translateX(-50%);background:rgba(15,20,30,.82);color:#fff;font:800 17px system-ui,sans-serif;padding:10px 16px;border-radius:14px;white-space:nowrap;transition:opacity .3s'; this.hud.append(el) }
    el.textContent = text; el.style.opacity = '1'; clearTimeout((el as any).__t); (el as any).__t = setTimeout(() => { el!.style.opacity = '0' }, 1400)
  }

  /** ⛏ the player turns into the evolve block's model: digs twice as fast, carries more; a burst of chips round it */
  private evolve (x: Station): void {
    this.drill_lv++; this.dig_speed *= 2; this.cap += 6
    const p = this.player()
    if (p !== null && x.obj !== null) {
      const model = clone_deep(x.obj.children.find(c => c.type !== 'Sprite' && c.name !== 'label') ?? x.obj)
      const old = new THREE.Box3().setFromObject(p); const os = old.getSize(new THREE.Vector3())
      p.children.forEach(c => { if ((c as any).__evolved !== true) c.visible = false })
      p.children.filter(c => (c as any).__evolved === true).forEach(c => c.removeFromParent())
      model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); (model as any).__evolved = true; model.visible = true
      model.traverse(o => { o.visible = true })
      p.add(model); model.updateMatrixWorld(true)
      const nb = new THREE.Box3().setFromObject(model); const ns = nb.getSize(new THREE.Vector3())
      const k = Math.max(os.x, os.z) / Math.max(1e-3, Math.max(ns.x, ns.z)) * 1.15; model.scale.multiplyScalar(k)
      model.updateMatrixWorld(true); const nb2 = new THREE.Box3().setFromObject(model); model.position.y -= nb2.min.y - p.position.y
      ;(model as any).__pop = 0
      for (let k2 = 0; k2 < 30; k2++) this.chip(p.position.clone().setY(1), 0xffd23f)
    }
    this.bed = undefined // the new vehicle's bin
    this.on_evolve?.(x.s, x.obj)
    if (p !== null) this.fx('evolve', p.position.clone().setY(p.position.y + 1.2), this.drill_lv)
  }

  private chip (at: THREE.Vector3, color: number): void {
    const mat = this.mats.get('chip' + color) ?? new THREE.MeshLambertMaterial({ color }); this.mats.set('chip' + color, mat)
    const m = new THREE.Mesh(this.chip_geo, mat); m.position.copy(at); this.group.add(m)
    this.chips.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5), life: 0.7 + Math.random() * 0.4 })
  }

  private move_items (dt: number): void {
    // flying items (ease in), the back stack follows the player, belts move at 2.2 m/s
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i]; f.t = Math.min(1, f.t + dt * 4)
      const to = f.to(); const k = f.t * f.t * (3 - 2 * f.t)
      f.it.mesh.position.lerpVectors(f.from, to, k); f.it.mesh.position.y += Math.sin(Math.PI * f.t) * 0.8
      if (f.t >= 1) { this.flying.splice(i, 1); f.done() }
    }
    this.back.forEach((it, n) => { if (!this.flying.some(f => f.it === it)) it.mesh.position.copy(this.back_spot(n)); const p = this.player(); if (p !== null) it.mesh.rotation.y = p.rotation.y })
    for (let i = this.riding.length - 1; i >= 0; i--) {
      const r = this.riding[i]; r.d += dt * 2.2
      if (r.d >= r.len) { this.riding.splice(i, 1); this.group.remove(r.it.mesh); if (r.to.s.kind === 'stack') this.add_pile(r.to, this.make(r.it.name, r.b.clone())); else r.to.inq.push(r.it.name); continue }
      r.it.mesh.position.lerpVectors(r.a, r.b, r.d / Math.max(1e-6, r.len))
    }
    for (let i = this.chips.length - 1; i >= 0; i--) { const c = this.chips[i]; c.life -= dt; c.v.y -= 14 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += dt * 9; if (c.m.position.y < 0.05) { c.m.position.y = 0.05; c.v.multiplyScalar(0.4); c.v.y = Math.abs(c.v.y) * 0.3 } if (c.life <= 0) { this.group.remove(c.m); this.chips.splice(i, 1) } }
    // the evolved model pops in
    const pl = this.player(); pl?.children.forEach(c => { const a = c as any; if (a.__pop !== undefined && a.__pop < 1) { a.__pop = Math.min(1, a.__pop + dt * 2.5); const s0 = a.__s0 ?? (a.__s0 = c.scale.x); const k = 1 - Math.pow(1 - a.__pop, 3); c.scale.setScalar(s0 * Math.max(0.05, k * (1 + 0.2 * Math.sin(a.__pop * Math.PI)))) } })
    // unlocked things pop up
    for (const t of this.st.values()) { const o = t.obj as any; if (o !== null && o.__grow !== undefined) { o.__grow = Math.min(1, o.__grow + dt * 2.5); const k = 1 - Math.pow(1 - o.__grow, 3); o.scale.setScalar(Math.max(0.01, k * (1 + 0.15 * Math.sin(o.__grow * Math.PI)))); if (o.__grow >= 1) { o.scale.setScalar(1); delete o.__grow } } }
  }

  /** what to do next: bring the carried items where they are taken; else collect money / items; else a source; else pay a pad */
  private filling = true
  private guide (pos: THREE.Vector3, carry: string): void {
    const on = [...this.st.values()].filter(t => t.on)
    const dist = (t: Station): number => Math.hypot(t.s.x - pos.x, t.s.z - pos.z)
    const best = (l: Station[]): Station | undefined => l.sort((a, b) => dist(a) - dist(b))[0]
    const diggable = (t: Station): boolean => t.s.kind === 'ore' && (t.obj as any)?.__gone !== true && (t.s.need ?? 0) <= this.drill_lv && (carry === '' || carry === (t.s.gives ?? 'gem'))
    let target: Station | undefined
    // a miner fills its load before it goes to sell (not one gem at a time)
    // (and once it is on its way to sell it unloads everything: no turning back at half a load)
    if (carry === '') this.filling = true; else if (this.back.length >= this.cap) this.filling = false
    if (carry !== '' && this.filling) { target = best(on.filter(diggable)); if (target === undefined) this.filling = false }
    if (target === undefined && carry !== '') target = best(on.filter(t => t.s.kind !== 'stack' && this.accepts(t, carry))) ?? best(on.filter(t => this.accepts(t, carry)))
    if (target === undefined) target = best(on.filter(t => t.pile.some(i => i.name === '$')))
    if (target === undefined && this.back.length < this.cap) target = best(on.filter(t => t.pile.length > 0 && (carry === '' || t.pile[t.pile.length - 1].name === carry)))
    if (target === undefined) { const pads = on.filter(t => t.s.kind === 'unlock'); target = best(pads.filter(t => this.money >= Math.min(10, (t.s.price ?? 50) - t.paid))) }
    if (target === undefined && this.back.length < this.cap) target = best(on.filter(t => (t.s.kind === 'source' && this.wires_out(t, 'belt').length === 0 && carry === '') || diggable(t)))
    const show = target !== undefined && !this.near(target, pos)
    this.arrow.visible = show; this.target_mark.visible = target !== undefined
    if (target === undefined) { this.goal = null; return }
    const k = target.s.kind; const has_money = target.pile.some(i => i.name === '$')
    this.goal = { kind: k === 'unlock' ? 'pay' : k === 'ore' ? 'dig' : k === 'source' ? 'take' : has_money ? 'money' : (carry !== '' && this.accepts(target, carry)) ? (k === 'counter' ? 'sell' : 'deliver') : 'collect', label: target.s.label, left: Math.max(0, (target.s.price ?? 50) - target.paid), price: target.s.price ?? 50, at: this.center(target) }
    const bob = Math.sin(this.time * 6) * 0.08
    this.target_mark.position.set(target.s.x, pos.y + 0.08, target.s.z); const sc = Math.max(target.s.w, target.s.d) * 0.6 + 0.3 + bob; this.target_mark.scale.set(sc, sc, 1)
    if (show) {
      const yaw = Math.atan2(target.s.x - pos.x, target.s.z - pos.z)
      // just outside the player's own footprint, on the ground; the chevrons light up one after the other
      if ((this.arrow.userData.r as number | undefined) === undefined || this.arrow.userData.for !== this.player()?.children.length) { const p = this.player()!; const sz = new THREE.Box3().setFromObject(p).getSize(new THREE.Vector3()); this.arrow.userData.r = Math.min(3, Math.max(0.7, Math.max(sz.x, sz.z) * 0.62)); this.arrow.userData.for = p.children.length }
      const r = this.arrow.userData.r as number; const gap = Math.max(0.5, Math.min(dist(target) - r - 0.6, 1.9)) / 1.9
      this.arrow.position.set(pos.x + Math.sin(yaw) * (r + 0.35), pos.y + 0.12, pos.z + Math.cos(yaw) * (r + 0.35)); this.arrow.rotation.y = yaw; this.arrow.scale.set(1.25, 1, 1.25 * gap)
      this.arrow.children.forEach((c, i) => { ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 7 - i * 1.1)) })
    }
  }

  public dispose (): void {
    this.group.removeFromParent(); this.hud.remove()
    for (const t of this.st.values()) { this.show(t, true); t.mixer?.stopAllAction(); const o = t.obj as any; if (o !== null && o.__grow !== undefined) { o.scale.setScalar(1); delete o.__grow } }
  }
}
