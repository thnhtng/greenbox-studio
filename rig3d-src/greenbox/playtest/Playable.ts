/*
 * The plan as a small idle-arcade playable (the kind of ad where you carry stacks between machines):
 *   source   stand next to it: items pop onto your back (up to CAP); with a belt wire it feeds the belt itself
 *   machine  walk past with the items it takes: they fly in; every `time` s it makes what it gives — onto its belt,
 *            into the stack it is wired to, or onto a pile beside it
 *   stack    a pile: walk past to pick its items up (or drop yours if it takes them)
 *   counter  takes items, gives $ (onto the money stack it is wired to, or a pile beside it); pick the money up
 *   unlock   stand on the $ pad: your money pays it; when paid, what its wires point to appears
 *   belt     items ride along the wire to the next shape by themselves
 * A yellow arrow over the player points to what to do next. Machines made from your own animated 3D file play
 * their animation while they work.
 */
import * as THREE from 'three'
import { type Plan, type PlanShape } from './PlanEditor.ts'
import { M } from '../common/lang.ts'

const CAP = 12
const REACH = 1.3 // m outside a shape that still counts as "next to it"
interface Item { name: string, mesh: THREE.Mesh }
interface Station { s: PlanShape, obj: THREE.Object3D | null, pile: Item[], inq: string[], t: number, on: boolean, paid: number, mixer: THREE.AnimationMixer | null, action: THREE.AnimationAction | null, label: THREE.Sprite | null }
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

  constructor (private readonly plan: Plan, private readonly scene: THREE.Scene, private readonly find: (pid: string) => THREE.Object3D | null, private readonly player: () => THREE.Object3D | null, view: HTMLElement, on_exit: () => void) {
    this.group.name = 'Playable'; scene.add(this.group)
    for (const s of plan.shapes) this.st.set(s.id, { s, obj: find(s.id), pile: [], inq: [], t: 0, on: true, paid: 0, mixer: null, action: null, label: null })
    // things behind an unlock pad start hidden
    for (const w of plan.wires) if (w.mode === 'unlock') { const t = this.st.get(w.to); if (t !== undefined) { t.on = false; this.show(t, false) } }
    for (const t of this.st.values()) {
      const clips = t.obj?.userData.clips as THREE.AnimationClip[] | undefined
      if (t.obj !== null && clips !== undefined && clips.length > 0) { t.mixer = new THREE.AnimationMixer(t.obj); t.action = t.mixer.clipAction(clips[0]); t.action.play(); t.mixer.timeScale = 0 }
      if (t.s.kind === 'unlock') t.label = this.text_sprite(`$${t.s.price ?? 50}`, t)
    }
    // guide arrow over the player + a ring on the target
    this.arrow = new THREE.Group()
    const am = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true })
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.7), am); shaft.position.z = 0.35
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), am); head.rotation.x = Math.PI / 2; head.position.z = 0.85
    this.arrow.add(shaft, head); this.arrow.renderOrder = 50; this.group.add(this.arrow)
    this.target_mark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }))
    this.target_mark.rotation.x = -Math.PI / 2; this.target_mark.renderOrder = 49; this.group.add(this.target_mark)
    // money HUD
    this.hud = document.createElement('div')
    this.hud.style.cssText = 'position:absolute;left:12px;top:12px;z-index:20;display:flex;gap:8px;align-items:center;font:800 22px system-ui,sans-serif;color:#fff;text-shadow:0 2px 4px #000a'
    this.hud.innerHTML = `<span data-m>💵 0</span><span data-c style="font-size:15px;opacity:.85"></span><button data-exit style="font:600 13px system-ui;padding:6px 10px;border-radius:8px;border:0;background:#1f2630cc;color:#fff;cursor:pointer">✕ ${M('Stop playable', 'Thoát playable', '종료')}</button>`
    view.append(this.hud)
    this.hud.querySelector<HTMLButtonElement>('[data-exit]')!.onclick = () => on_exit()
    // start where the plan says
    const start = plan.shapes.find(s => s.kind === 'player'); const p = player()
    if (start !== undefined && p !== null) { p.position.x = start.x; p.position.z = start.z }
  }

  /* ---------------- helpers ---------------- */
  private mat (name: string): THREE.MeshLambertMaterial { let m = this.mats.get(name); if (m === undefined) { m = new THREE.MeshLambertMaterial({ color: item_color(name) }); this.mats.set(name, m) } return m }
  private make (name: string, at: THREE.Vector3): Item { const mesh = new THREE.Mesh(this.geo, this.mat(name)); mesh.position.copy(at); mesh.castShadow = true; this.group.add(mesh); return { name, mesh } }
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
  private back_spot (n: number): THREE.Vector3 {
    const p = this.player(); if (p === null) return new THREE.Vector3()
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
    for (const t of this.st.values()) {
      if (!t.on) continue
      const s = t.s; const here = this.near(t, pos)
      if (s.kind === 'source') {
        const belts = this.wires_out(t, 'belt')
        const time = s.time ?? 0.6; const give = s.gives ?? 'item'
        if (belts.length > 0) { t.t += dt; if (t.t >= time * 1.5) { t.t = 0; this.send(this.make(give, this.center(t).setY(0.5)), t, belts[0]) } }
        else if (here && this.back.length < CAP && (carry === '' || carry === give)) { t.t += dt; if (t.t >= time) { t.t = 0; this.to_back(this.make(give, this.center(t).setY(1))) } }
      } else if (s.kind === 'machine' || s.kind === 'counter') {
        // load what the player carries
        if (here && tick && carry !== '' && this.accepts(t, carry)) { const it = this.back.pop()!; this.fly(it, () => this.center(t).setY(s.height + 0.2), () => { this.group.remove(it.mesh); t.inq.push(it.name) }) }
        // work
        if (t.inq.length > 0) {
          t.t += dt; if (t.mixer !== null) t.mixer.timeScale = 1
          if (t.t >= (s.time ?? 1.2)) {
            t.t = 0; t.inq.shift()
            const out = s.kind === 'counter' ? '$' : (s.gives ?? 'item')
            const n = s.kind === 'counter' ? Math.max(1, Math.round((s.price ?? 5) / 5)) : 1
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
        if (top.name === '$') { t.pile.pop(); this.fly(top, () => pos.clone().setY(pos.y + 1), () => { this.group.remove(top.mesh); this.money += 5 }) }
        else if ((carry === '' || carry === top.name) && this.back.length < CAP) { t.pile.pop(); this.to_back(top) }
      } else if (s.kind === 'stack' && here && tick && t.pile.length === 0 && carry !== '' && (s.takes ?? '') !== '' && this.accepts(t, carry)) {
        const it = this.back.pop()!; this.add_pile(t, it)
      }
      if (s.kind === 'unlock' && here && tick && this.money > 0 && t.paid < (s.price ?? 50)) {
        const pay = Math.min(this.money, Math.max(1, Math.ceil((s.price ?? 50) / 25))); this.money -= pay; t.paid += pay
        const coin = this.make('$', pos.clone().setY(pos.y + 1)); this.fly(coin, () => this.center(t).setY(0.2), () => this.group.remove(coin.mesh))
        t.label?.userData.draw(`$${Math.max(0, (s.price ?? 50) - t.paid)}`)
        if (t.paid >= (s.price ?? 50)) this.unlock(t)
      }
      t.mixer?.update(dt)
    }
    this.move_items(dt)
    this.guide(pos, carry)
    ;(this.hud.querySelector('[data-m]') as HTMLElement).textContent = `💵 ${this.money}`
    ;(this.hud.querySelector('[data-c]') as HTMLElement).textContent = this.back.length > 0 ? `${this.back[0].name} ×${this.back.length}` : ''
  }

  private to_back (it: Item): void { const n = this.back.length; this.back.push(it); this.fly(it, () => this.back_spot(n), () => {}) }

  private send (it: Item, from: Station, to: Station): void {
    const a = this.center(from).setY(0.35); const b = this.center(to).setY(0.35)
    this.riding.push({ it, a, b, d: 0, len: a.distanceTo(b), to })
  }

  private unlock (t: Station): void {
    t.on = false; this.show(t, false); t.label?.removeFromParent()
    for (const w of this.plan.wires) if (w.from === t.s.id && w.mode === 'unlock') { const x = this.st.get(w.to); if (x !== undefined) { x.on = true; this.show(x, true); x.obj?.scale.setScalar(0.01); (x.obj as any).__grow = 0 } }
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
    // unlocked things pop up
    for (const t of this.st.values()) { const o = t.obj as any; if (o !== null && o.__grow !== undefined) { o.__grow = Math.min(1, o.__grow + dt * 2.5); const k = 1 - Math.pow(1 - o.__grow, 3); o.scale.setScalar(Math.max(0.01, k * (1 + 0.15 * Math.sin(o.__grow * Math.PI)))); if (o.__grow >= 1) { o.scale.setScalar(1); delete o.__grow } } }
  }

  /** what to do next: bring the carried items where they are taken; else collect money / items; else a source; else pay a pad */
  private guide (pos: THREE.Vector3, carry: string): void {
    const on = [...this.st.values()].filter(t => t.on)
    const dist = (t: Station): number => Math.hypot(t.s.x - pos.x, t.s.z - pos.z)
    const best = (l: Station[]): Station | undefined => l.sort((a, b) => dist(a) - dist(b))[0]
    let target: Station | undefined
    if (carry !== '') target = best(on.filter(t => t.s.kind !== 'stack' && this.accepts(t, carry))) ?? best(on.filter(t => this.accepts(t, carry)))
    if (target === undefined) target = best(on.filter(t => t.pile.some(i => i.name === '$')))
    if (target === undefined && this.back.length < CAP) target = best(on.filter(t => t.pile.length > 0 && (carry === '' || t.pile[t.pile.length - 1].name === carry)))
    if (target === undefined) { const pads = on.filter(t => t.s.kind === 'unlock'); target = best(pads.filter(t => this.money >= Math.min(10, (t.s.price ?? 50) - t.paid))) }
    if (target === undefined && carry === '') target = best(on.filter(t => t.s.kind === 'source' && this.wires_out(t, 'belt').length === 0))
    const show = target !== undefined && !this.near(target, pos)
    this.arrow.visible = show; this.target_mark.visible = target !== undefined
    if (target === undefined) return
    const bob = Math.sin(this.time * 6) * 0.08
    this.target_mark.position.set(target.s.x, 0.08, target.s.z); const sc = Math.max(target.s.w, target.s.d) * 0.6 + 0.3 + bob; this.target_mark.scale.set(sc, sc, 1)
    if (show) { this.arrow.position.set(pos.x, pos.y + 2.4 + this.back.length * 0.23 + bob, pos.z); this.arrow.rotation.y = Math.atan2(target.s.x - pos.x, target.s.z - pos.z) }
  }

  public dispose (): void {
    this.group.removeFromParent(); this.hud.remove()
    for (const t of this.st.values()) { this.show(t, true); t.mixer?.stopAllAction(); const o = t.obj as any; if (o !== null && o.__grow !== undefined) { o.scale.setScalar(1); delete o.__grow } }
  }
}
