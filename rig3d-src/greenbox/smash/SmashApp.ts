/**
 * SMASH DOWN blockout (game genre: shoot a stacked wall of boxes / cans off a table).
 *   1. draw the wall: a grid of cells, each empty or one of 4 colours (presets: wall, pyramid, towers, checker, random)
 *   2. play it: click / tap to shoot from the gun in the middle — real physics (cannon-es), the blocks tumble off the table
 *   3. record a 9:16 blockout video (the view + ammo / score HUD + the tapping hand), or let ⚡ auto shoot play it
 *   4. restyle it with an AI video model (Seedance video-to-video): the page writes the prompt for the chosen theme
 * The view is a 720×1280 2D canvas (what is recorded); the 3D renders off screen into it every frame.
 */
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { M, on_lang_change } from '../common/lang.ts'

type Shape = 'box' | 'can'
/** a piece placed by hand in the 3D view: grid cell (x column, y row, z layer), colour 1..4, shape */
interface Piece { x: number, y: number, z: number, c: number, s: Shape }
interface Layout { cols: number, rows: number, depth: number, cells: number[], shape: Shape, size: number, power: number, ammo: number, look: string, hand: boolean, style: string, extra: Piece[], showAmmo: boolean, showScore: boolean, newShape: Shape, base: string, baseSpeed: number, baseColor: string }
interface Block { mesh: THREE.Mesh, body: CANNON.Body, home: number, cell: [number, number, number], src: number } // src: -1 = drawn grid, k = extra[k]
const COLORS = [0, 0xe53935, 0x2457d6, 0x2fbf4f, 0xffc21a]
const KEY = 'gb.smash.v1'
const RW = 720, RH = 1280 // recorded size (9:16)
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

const STYLES: Record<string, [string, string, string]> = {
  candy: ['a pastel candy factory: pink and white checker floor, giant lollipops and gumball machines around, the boxes become stacked cans and jars of sweets, the ball becomes a green tennis ball', 'nhà máy kẹo pastel', '캔디 공장'],
  market: ['a bright supermarket aisle: the boxes become stacked food cans and cereal boxes on a shop display, shelves in the background, the ball becomes an orange', 'siêu thị', '슈퍼마켓'],
  toys: ['a cosy kids toy room: the boxes become wooden toy blocks with letters, plush toys around, warm light, the ball becomes a red rubber ball', 'phòng đồ chơi', '장난감 방'],
  build: ['a sunny construction site: the boxes become bricks and crates on a pallet, cranes behind, dust when they fall, the ball becomes a wrecking cannonball', 'công trường', '공사장'],
  scifi: ['a neon sci-fi lab: the boxes become glowing energy cubes, holograms around, sparks on hits, the ball becomes a plasma orb', 'phòng thí nghiệm sci-fi', 'SF 연구소']
}

function preset (name: string, cols: number, rows: number): number[] {
  const c = new Array(cols * rows).fill(0)
  const set = (x: number, y: number, v: number): void => { if (x >= 0 && x < cols && y >= 0 && y < rows) c[y * cols + x] = v }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (name === 'wall') set(x, y, y % 2 === 0 ? 1 : 2)
      else if (name === 'pyramid') { if (x >= y / 2 && x < cols - y / 2) set(x, y, (x + y) % 2 === 0 ? 1 : 2) }
      else if (name === 'towers') { if (x % 3 !== 2 || y < 2) set(x, y, [1, 2, 4][Math.floor(x / 3) % 3]) }
      else if (name === 'checker') set(x, y, (x + y) % 2 === 0 ? 1 : 2)
      else if (name === 'random') { if (y === 0 || c[(y - 1) * cols + x] > 0) { if (Math.random() < 0.85) set(x, y, 1 + Math.floor(Math.random() * 4)) } }
    }
  }
  return c
}
function defaults (): Layout { const cols = 8, rows = 9; return { cols, rows, depth: 1, cells: preset('wall', cols, rows), shape: 'can', size: 0.42, power: 16, ammo: 30, look: 'grey', hand: true, style: 'candy', extra: [], showAmmo: true, showScore: true, newShape: 'box', base: 'table', baseSpeed: 0.6, baseColor: '#ffffff' } }

class SmashApp {
  L: Layout
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(52, RW / RH, 0.05, 200)
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })
  blocks: Block[] = []
  balls: Array<{ mesh: THREE.Mesh, body: CANNON.Body, t: number }> = []
  gun = new THREE.Group()
  view = document.createElement('canvas')
  g: CanvasRenderingContext2D
  top = 1 // table top height
  tableZ = -4.2
  ammo = 0
  aim = new THREE.Vector3(0, 1.5, -4.2)
  recoil = 0
  hand = { x: RW / 2, y: RH * 0.7, t: -10 }
  auto = false; autoT = 0
  rec: MediaRecorder | null = null; parts: Blob[] = []; recT0 = 0
  recMax = 10 // seconds, then it stops and saves by itself (0 = only the ■ button)
  brush = 1
  edit = false // ✏️ place / remove pieces in the 3D view (physics paused)
  ghost: THREE.Mesh | null = null
  supT = 0
  plat: CANNON.Body | null = null // the moving base (turntable / slider), kinematic
  platMesh: THREE.Object3D | null = null
  platT = 0
  foot = { w: 1, d: 1, r: 1, round: false } // the top of the base, for 'still on it?'
  floorMat = new THREE.MeshStandardMaterial({ color: 0xd9dce2 })
  last = performance.now()

  constructor () {
    this.L = (() => { try { const d = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return d !== null ? Object.assign(defaults(), d) : defaults() } catch { return defaults() } })()
    this.renderer.setSize(RW, RH, false); this.renderer.setPixelRatio(1)
    this.renderer.shadowMap.enabled = true
    this.view.width = RW; this.view.height = RH; this.view.id = 'sm-canvas'
    this.g = this.view.getContext('2d') as CanvasRenderingContext2D
    $('sm-stage').appendChild(this.view)
    this.world.allowSleep = true
    ;(this.world.solver as any).iterations = 20
    this.world.defaultContactMaterial.friction = 0.45; this.world.defaultContactMaterial.restitution = 0.05
    this.build_scene(); this.reset()
    this.view.addEventListener('contextmenu', e => e.preventDefault())
    this.view.addEventListener('pointerdown', e => { const p = this.pos(e); if (this.edit) this.edit_click(p.x, p.y, e.button === 2 || e.altKey || this.brush === 0); else this.shoot_at(p.x, p.y) })
    this.view.addEventListener('pointermove', e => { const p = this.pos(e); if (this.edit) this.edit_hover(p.x, p.y); else this.aim_at(p.x, p.y) })
    this.panel(); on_lang_change(() => this.panel())
    requestAnimationFrame(t => this.frame(t))
  }

  save (): void { try { localStorage.setItem(KEY, JSON.stringify(this.L)) } catch { /* full */ } }
  pos (e: PointerEvent): { x: number, y: number } { const r = this.view.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * RW, y: (e.clientY - r.top) / r.height * RH } }

  /* ---------------- the room, the table, the gun ---------------- */
  build_scene (): void {
    const s = this.scene
    s.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9a, 1.1))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 8, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024)
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 }); s.add(sun)
    // floor: a checker so motion reads well in the blockout
    const tex = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d') as CanvasRenderingContext2D; x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#e6e8ec'; x.fillRect(0, 0, 64, 64); x.fillRect(64, 64, 64, 64); return c })())
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(20, 20); tex.colorSpace = THREE.SRGBColorSpace
    this.floorMat.map = tex
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor)
    this.world.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0) }))
    // the gun: a chunky toy blaster in the middle at the bottom of the frame
    const blue = new THREE.MeshStandardMaterial({ color: 0x2457d6, roughness: 0.4 }); const orange = new THREE.MeshStandardMaterial({ color: 0xff8a1a, roughness: 0.4 }); const yellow = new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.4 })
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 24), blue); barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.25
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 12, 24), orange); ring.position.z = -0.62
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.24, 24), yellow); body.rotation.x = Math.PI / 2; body.position.z = 0.04
    this.gun.add(barrel, ring, body); this.gun.traverse(o => { (o as THREE.Mesh).castShadow = true }); s.add(this.gun)
    this.apply_look()
  }
  apply_look (): void {
    const look = this.L.look
    this.scene.background = new THREE.Color(look === 'night' ? 0x141a2b : look === 'pastel' ? 0xffe3ef : 0xcfd6df)
    this.floorMat.color.set(look === 'night' ? 0x3a4258 : look === 'pastel' ? 0xffd0e2 : 0xffffff)
  }

  /* ---------------- the wall on the table ---------------- */
  reset (): void {
    for (const b of [...this.blocks, ...this.balls]) { this.scene.remove(b.mesh); this.world.removeBody(b.body) }
    this.blocks = []; this.balls = []
    for (const o of this.scene.children.filter(o => o.userData.table === true)) this.scene.remove(o)
    for (const b of this.world.bodies.filter(b => (b as any).table === true)) this.world.removeBody(b)
    const L = this.L, s = L.size
    const w = L.cols * s + 0.5, d = L.depth * s + 0.35
    this.top = 1.0
    this.build_base(w, d)
    const mats = COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }))
    const geos = { can: new THREE.CylinderGeometry(s * 0.46, s * 0.46, s * 0.96, 20), box: new THREE.BoxGeometry(s * 0.96, s * 0.96, s * 0.96) }
    const add = (x: number, y: number, z: number, c: number, shape: Shape, src: number): void => {
      const mesh = new THREE.Mesh(geos[shape], mats[c]); mesh.castShadow = mesh.receiveShadow = true
      const sh = shape === 'can' ? new CANNON.Cylinder(s * 0.46, s * 0.46, s * 0.96, 12) : new CANNON.Box(new CANNON.Vec3(s * 0.48, s * 0.48, s * 0.48))
      const p = this.cell_pos(x, y, z), body = new CANNON.Body({ mass: 0.4, shape: sh, position: new CANNON.Vec3(p.x, p.y, p.z) })
      body.allowSleep = true; body.sleepSpeedLimit = 0.12; body.sleepTimeLimit = 0.4; body.linearDamping = 0.05; body.angularDamping = 0.1
      body.sleep() // the stack stays put until something hits it (support_check wakes what lost its support)
      mesh.position.copy(p); this.world.addBody(body); this.scene.add(mesh); this.blocks.push({ mesh, body, home: p.y, cell: [x, y, z], src })
    }
    for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) { const v = L.cells[y * L.cols + x]; if (v > 0) for (let z = 0; z < L.depth; z++) add(x, y, z, v, L.shape, -1) }
    L.extra.forEach((q, k) => add(q.x, q.y, q.z, q.c, q.s, k))
    this.ammo = L.ammo
    // camera: behind the gun, the whole wall in view
    const H = L.rows * s, mid = this.top + H * 0.5
    const dist = Math.max(4.6, (H * 0.5 + 0.8) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.9, (w * 0.5 + 0.4) / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect))
    this.camera.position.set(0, mid - H * 0.12 + 0.3, this.tableZ + dist); this.camera.lookAt(0, mid - H * 0.18, this.tableZ)
    this.gun.position.copy(this.camera.position).add(new THREE.Vector3(0, -0.86, -1.9).applyQuaternion(this.camera.quaternion)); this.gun.scale.setScalar(0.8)
    this.aim.set(0, mid, this.tableZ)
  }

  /* ---------------- the base under the stack ---------------- */
  /** table · pedestal · podium steps · floating island · ⟳ turntable · ⇆ slider */
  build_base (w: number, d: number): void {
    const L = this.L, top = this.top, kind = L.base
    const main = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.baseColor), roughness: 0.55 }), red = new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.5 })
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.baseColor).multiplyScalar(0.72), roughness: 0.6 })
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.userData.table = true; (parent ?? this.scene).add(m); return m }
    const body = (shape: CANNON.Shape, x: number, y: number, z: number): CANNON.Body => { const b = new CANNON.Body({ mass: 0, shape, position: new CANNON.Vec3(x, y, z) }); (b as any).table = true; this.world.addBody(b); return b }
    const Z = this.tableZ, r = Math.max(w, d) / 2 + 0.12
    this.plat = null; this.platMesh = null; this.platT = 0
    this.foot = { w, d, r, round: kind === 'pedestal' || kind === 'spin' }
    if (kind === 'pedestal') {
      mesh(new THREE.CylinderGeometry(r, r, 0.14, 48), main, 0, top - 0.07, Z)
      mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.05, 48), red, 0, top - 0.16, Z)
      mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.62, top - 0.3, 32), dark, 0, (top - 0.3) / 2 + 0.12, Z)
      mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.9, 0.12, 40), main, 0, 0.06, Z)
      body(new CANNON.Cylinder(r, r, 0.14, 24), 0, top - 0.07, Z); body(new CANNON.Cylinder(r * 0.62, r * 0.62, top - 0.14, 16), 0, (top - 0.14) / 2, Z)
    } else if (kind === 'steps') {
      const h = top / 3
      for (let i = 0; i < 3; i++) { const ww = w + i * 0.8, dd = d + i * 0.8, y = top - (i + 0.5) * h; mesh(new THREE.BoxGeometry(ww, h, dd), i % 2 ? red : main, 0, y, Z); body(new CANNON.Box(new CANNON.Vec3(ww / 2, h / 2, dd / 2)), 0, y, Z) }
    } else if (kind === 'float') {
      mesh(new THREE.BoxGeometry(w, 0.22, d), main, 0, top - 0.11, Z)
      const rock = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.48, 1.0, 7), dark, 0, top - 0.72, Z); rock.rotation.x = Math.PI; rock.scale.z = d / Math.max(w, d) + 0.35
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.32, 0.02, 32), new THREE.MeshBasicMaterial({ color: 0x7dfcb0, transparent: true, opacity: 0.35 })); glow.position.set(0, 0.02, Z); glow.userData.table = true; this.scene.add(glow)
      body(new CANNON.Box(new CANNON.Vec3(w / 2, 0.11, d / 2)), 0, top - 0.11, Z)
    } else if (kind === 'spin') {
      mesh(new THREE.CylinderGeometry(0.14, 0.14, top - 0.16, 16), dark, 0, (top - 0.16) / 2, Z); mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.5, 0.1, 32), red, 0, 0.05, Z)
      body(new CANNON.Cylinder(0.14, 0.14, top - 0.16, 12), 0, (top - 0.16) / 2, Z)
      const g = new THREE.Group(); g.position.set(0, top - 0.07, Z); g.userData.table = true; this.scene.add(g)
      mesh(new THREE.CylinderGeometry(r, r, 0.14, 56), main, 0, 0, 0, g)
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, m = mesh(new THREE.BoxGeometry(0.1, 0.02, r * 0.3), i % 2 ? red : dark, Math.sin(a) * r * 0.82, 0.08, Math.cos(a) * r * 0.82, g); m.rotation.y = a } // stripes: the turn shows
      this.plat = body(new CANNON.Cylinder(r, r, 0.14, 32), 0, top - 0.07, Z); this.platMesh = g
    } else if (kind === 'slide') {
      const A = 0.9, len = w + A * 2 + 0.4
      mesh(new THREE.BoxGeometry(len, 0.1, 0.24), dark, 0, top - 0.2, Z)
      for (const x of [-len / 2 + 0.1, len / 2 - 0.1]) { mesh(new THREE.BoxGeometry(0.12, top - 0.25, 0.12), dark, x, (top - 0.25) / 2, Z); mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), red, x, 0.03, Z) }
      body(new CANNON.Box(new CANNON.Vec3(len / 2, 0.05, 0.12)), 0, top - 0.2, Z)
      const g = new THREE.Group(); g.position.set(0, top - 0.07, Z); g.userData.table = true; this.scene.add(g)
      mesh(new THREE.BoxGeometry(w, 0.14, d), main, 0, 0, 0, g); mesh(new THREE.BoxGeometry(w + 0.04, 0.04, 0.06), red, 0, -0.05, d / 2, g)
      this.plat = body(new CANNON.Box(new CANNON.Vec3(w / 2, 0.07, d / 2)), 0, top - 0.07, Z); this.platMesh = g
    } else { // table
      mesh(new THREE.BoxGeometry(w, 0.12, d), main, 0, top - 0.06, Z); mesh(new THREE.BoxGeometry(w + 0.04, 0.04, 0.06), red, 0, top - 0.1, Z + d / 2)
      mesh(new THREE.BoxGeometry(0.12, top - 0.12, 0.12), main, 0, (top - 0.12) / 2, Z); mesh(new THREE.BoxGeometry(0.7, 0.08, 0.5), red, 0, 0.04, Z)
      body(new CANNON.Box(new CANNON.Vec3(w / 2, 0.06, d / 2)), 0, top - 0.06, Z); body(new CANNON.Box(new CANNON.Vec3(0.06, (top - 0.12) / 2, 0.06)), 0, (top - 0.12) / 2, Z)
    }
  }
  /** is this point over the top of the base (wherever the moving base is now)? */
  on_base (p: CANNON.Vec3, margin = 0.25): boolean {
    const cx = this.plat?.position.x ?? 0, f = this.foot
    if (f.round) return Math.hypot(p.x - cx, p.z - this.tableZ) < f.r + margin
    return Math.abs(p.x - cx) < f.w / 2 + margin && Math.abs(p.z - this.tableZ) < f.d / 2 + margin + 0.15
  }
  /** the turntable / slider: a static body moved by hand (a moving kinematic body would wake the whole stack) */
  base_pre (dt: number): { q: CANNON.Quaternion, p: CANNON.Vec3 } | null {
    const b = this.plat; if (b === null) return null
    const was = { q: b.quaternion.clone(), p: b.position.clone() }
    this.platT += dt; const w = this.L.baseSpeed
    if (this.L.base === 'spin') b.quaternion = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), w * dt).mult(was.q)
    else b.position.x = 0.9 * Math.sin(this.platT * w * 1.6)
    b.aabbNeedsUpdate = true
    return was
  }
  /** after the step: the stack rides along (untouched and settling pieces); pieces knocked flying fall by themselves */
  base_post (was: { q: CANNON.Quaternion, p: CANNON.Vec3 } | null): void {
    const b = this.plat; if (b === null || was === null) return
    const dq = b.quaternion.mult(was.q.conjugate()), dp = b.position.vsub(was.p), f = this.foot
    for (const k of this.blocks) {
      // the stack rides along: sleeping pieces and pieces that are only settling (slow); a piece knocked flying is free
      const slow = k.body.velocity.length() < 0.6 && k.body.angularVelocity.length() < 2
      if ((k.body.sleepState !== CANNON.Body.SLEEPING && !slow) || k.body.position.y < this.top - 0.1) continue
      const rel = k.body.position.vsub(was.p)
      if (f.round ? Math.hypot(rel.x, rel.z) > f.r + 0.1 : Math.abs(rel.x) > f.w / 2 + 0.1 || Math.abs(rel.z) > f.d / 2 + 0.25) continue
      k.body.position.copy(was.p.vadd(dq.vmult(rel)).vadd(dp)); k.body.quaternion.copy(dq.mult(k.body.quaternion)); k.body.aabbNeedsUpdate = true
      if (k.body.sleepState !== CANNON.Body.SLEEPING) k.body.velocity.copy(dq.vmult(k.body.velocity))
    }
    if (this.platMesh !== null) { this.platMesh.position.set(b.position.x, b.position.y, b.position.z); this.platMesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w) }
  }
  cell_pos (x: number, y: number, z: number): THREE.Vector3 { const L = this.L, s = L.size; return new THREE.Vector3((x - (L.cols - 1) / 2) * s, this.top + s * 0.48 + y * s * 0.985, this.tableZ - (z - (L.depth - 1) / 2) * s) }
  /** a sleeping block whose support is gone (shot away) must fall: wake it */
  support_check (): void {
    const s = this.L.size
    for (const b of this.blocks) {
      if (b.body.sleepState !== CANNON.Body.SLEEPING) continue
      const p = b.body.position
      if (p.y < this.top + s * 0.6 && this.on_base(p)) continue // on the base
      const held = this.blocks.some(o => o !== b && o.body.position.y < p.y - s * 0.4 && p.y - o.body.position.y < s * 1.25 && Math.abs(o.body.position.x - p.x) < s * 0.85 && Math.abs(o.body.position.z - p.z) < s * 0.85)
      if (!held) b.body.wakeUp()
    }
  }

  /* ---------------- ✏️ place pieces by hand in the 3D view ---------------- */
  edit_target (x: number, y: number): { add: [number, number, number] | null, hit: Block | null } {
    const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(x / RW * 2 - 1, -(y / RH) * 2 + 1), this.camera)
    const h = r.intersectObjects(this.blocks.map(b => b.mesh), false)[0]
    if (h !== undefined) {
      const b = this.blocks.find(q => q.mesh === h.object) as Block, n = (h.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone()
      const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2
      const c: [number, number, number] = [...b.cell]; if (ax === 0) c[0] += Math.sign(n.x); else if (ax === 1) c[1] += Math.sign(n.y); else c[2] -= Math.sign(n.z)
      return { add: c[1] >= 0 ? c : null, hit: b }
    }
    // on the table top: the first row of that column
    const t = (this.top - r.ray.origin.y) / r.ray.direction.y; if (!(t > 0)) return { add: null, hit: null }
    const p = r.ray.origin.clone().addScaledVector(r.ray.direction, t), s = this.L.size
    const cx = Math.round(p.x / s + (this.L.cols - 1) / 2), cz = Math.round(-(p.z - this.tableZ) / s + (this.L.depth - 1) / 2)
    if (Math.abs(p.x) > this.L.cols * s / 2 + 0.3 || Math.abs(p.z - this.tableZ) > this.L.depth * s / 2 + 0.3) return { add: null, hit: null }
    return { add: [cx, 0, Math.max(0, Math.min(this.L.depth - 1, cz))], hit: null }
  }
  edit_hover (x: number, y: number): void {
    const t = this.edit_target(x, y), del = this.brush === 0
    if (this.ghost === null) { this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4fed89, transparent: true, opacity: 0.45, depthWrite: false })); this.scene.add(this.ghost) }
    const s = this.L.size, g = this.ghost
    if (del && t.hit !== null) { g.visible = true; g.position.copy(t.hit.mesh.position); g.scale.setScalar(s * 1.04); (g.material as THREE.MeshBasicMaterial).color.set(0xff4a3a) }
    else if (!del && t.add !== null) { g.visible = true; g.position.copy(this.cell_pos(...t.add)); g.scale.setScalar(s * 0.98); (g.material as THREE.MeshBasicMaterial).color.set(COLORS[this.brush] || 0x4fed89) }
    else g.visible = false
    this.hand.x = x; this.hand.y = y
  }
  edit_click (x: number, y: number, remove: boolean): void {
    const t = this.edit_target(x, y), L = this.L
    if (remove) {
      if (t.hit === null) return
      if (t.hit.src >= 0) L.extra.splice(t.hit.src, 1); else L.cells[t.hit.cell[1] * L.cols + t.hit.cell[0]] = 0
    } else {
      if (t.add === null || this.brush === 0) return
      const [cx, cy, cz] = t.add
      if (cx >= 0 && cx < L.cols && cy < L.rows && L.depth === 1 && cz === 0 && L.cells[cy * L.cols + cx] === 0) L.cells[cy * L.cols + cx] = this.brush // inside the drawn grid: it is a grid cell
      else L.extra.push({ x: cx, y: cy, z: cz, c: this.brush, s: L.newShape })
    }
    this.save(); this.reset(); this.edit_hover(x, y); this.grid()
  }

  knocked (): number { return this.blocks.filter(b => b.body.position.y < this.top - 0.15 || !this.on_base(b.body.position, 0.4)).length }

  /* ---------------- shooting ---------------- */
  ray (x: number, y: number): THREE.Vector3 {
    const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(x / RW * 2 - 1, -(y / RH) * 2 + 1), this.camera)
    const hit = r.intersectObjects(this.blocks.map(b => b.mesh), false)[0]
    if (hit !== undefined) return hit.point
    const t = (this.tableZ - r.ray.origin.z) / r.ray.direction.z
    return r.ray.origin.clone().addScaledVector(r.ray.direction, t > 0 ? t : 6)
  }
  aim_at (x: number, y: number): void { this.aim.copy(this.ray(x, y)); this.hand.x = x; this.hand.y = y }
  shoot_at (x: number, y: number): void {
    if (this.ammo <= 0 || this.edit) return
    this.aim_at(x, y); this.hand.t = performance.now() / 1000
    const muzzle = new THREE.Vector3(0, 0, -0.7).applyMatrix4(this.gun.matrixWorld)
    const to = this.aim.clone(), dist = to.distanceTo(muzzle), speed = this.L.power, t = dist / speed
    const v = to.sub(muzzle).divideScalar(t); v.y += 0.5 * 9.82 * t // aim so gravity brings it onto the point
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), new THREE.MeshStandardMaterial({ color: 0xb8f24a, roughness: 0.5 })); mesh.castShadow = true
    const body = new CANNON.Body({ mass: 2.2, shape: new CANNON.Sphere(0.16), position: new CANNON.Vec3(muzzle.x, muzzle.y, muzzle.z), velocity: new CANNON.Vec3(v.x, v.y, v.z) })
    this.world.addBody(body); this.scene.add(mesh); this.balls.push({ mesh, body, t: 0 })
    this.ammo--; this.recoil = 1
  }
  /** ⚡ auto shoot: aims at a standing block, low on the wall, about twice a second */
  auto_step (dt: number): void {
    this.autoT -= dt; if (this.autoT > 0 || this.ammo <= 0) return
    this.autoT = 0.55 + Math.random() * 0.35
    const up = this.blocks.filter(b => b.body.position.y > this.top && b.body.position.y < this.top + this.L.rows * this.L.size * 0.7)
    const b = up[Math.floor(Math.random() * up.length)]; if (b === undefined) return
    const p = b.mesh.position.clone().project(this.camera)
    this.shoot_at((p.x + 1) / 2 * RW, (1 - p.y) / 2 * RH)
  }

  /* ---------------- loop: physics, render, HUD, hand ---------------- */
  frame (now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now
    if (this.auto) this.auto_step(dt)
    if (!this.edit) { const was = this.base_pre(dt); this.world.fixedStep(1 / 60, dt); this.base_post(was); this.supT -= dt; if (this.supT <= 0) { this.supT = 0.2; this.support_check() } }
    for (const b of this.blocks) { b.mesh.position.copy(b.body.position as any); b.mesh.quaternion.copy(b.body.quaternion as any) }
    for (const b of this.balls) { b.t += dt; b.mesh.position.copy(b.body.position as any); b.mesh.quaternion.copy(b.body.quaternion as any) }
    for (const b of this.balls.filter(q => q.t > 6)) { this.scene.remove(b.mesh); this.world.removeBody(b.body) }
    this.balls = this.balls.filter(q => q.t <= 6)
    // the gun turns to the aim and kicks back on a shot
    // turns only a little (like a first-person gun): the camera never sees its back end
    const d = this.aim.clone().sub(this.gun.position), yaw = THREE.MathUtils.clamp(Math.atan2(d.x, -d.z), -0.42, 0.42), pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.12, 0.4)
    this.gun.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, -yaw, 0, 'YXZ')), Math.min(1, dt * 14))
    this.recoil = Math.max(0, this.recoil - dt * 6)
    this.gun.children.forEach(c => { c.position.z += ((c.userData.z0 ??= c.position.z) + this.recoil * 0.12 - c.position.z) })
    this.renderer.render(this.scene, this.camera)
    const g = this.g; g.drawImage(this.renderer.domElement, 0, 0)
    // HUD: ammo (top left), knocked (top right)
    const pill = (x: number, w: number, txt: string, ball: boolean): void => {
      g.save(); g.fillStyle = 'rgba(200,30,40,.92)'; g.strokeStyle = '#ffcf3a'; g.lineWidth = 6; g.beginPath(); g.roundRect(x, 34, w, 74, 37); g.fill(); g.stroke()
      if (ball) { g.fillStyle = '#b8f24a'; g.beginPath(); g.arc(x + 42, 71, 24, 0, 7); g.fill() }
      g.fillStyle = '#fff'; g.font = '900 44px Roboto, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = '#7a1018'; g.strokeText(txt, x + w / 2 + (ball ? 20 : 0), 73); g.fillText(txt, x + w / 2 + (ball ? 20 : 0), 73); g.restore()
    }
    if (this.L.showAmmo) pill(30, 190, String(this.ammo), true)
    if (this.L.showScore) pill(RW - 230, 200, `${this.knocked()}/${this.blocks.length}`, false)
    // the tapping hand (shows where the shots go; part of the video)
    if (this.L.hand && !this.edit) {
      const k = Math.max(0, 1 - (now / 1000 - this.hand.t) / 0.25), s = 1 - 0.18 * k
      g.save(); g.translate(this.hand.x + 26, this.hand.y + 40); g.scale(s, s); g.font = '96px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('👆', 0, 0); g.restore()
      if (k > 0) { g.save(); g.strokeStyle = `rgba(255,255,255,${k})`; g.lineWidth = 6; g.beginPath(); g.arc(this.hand.x, this.hand.y, 50 * (1.4 - k), 0, 7); g.stroke(); g.restore() }
    }
    if (this.rec !== null) { const sec = (now - this.recT0) / 1000; const t = document.getElementById('sm-rectime'); if (t !== null) t.textContent = `● REC ${sec.toFixed(1)}s`; if (this.recMax > 0 && sec >= this.recMax) this.stop_record() }
    requestAnimationFrame(t => this.frame(t))
  }

  /* ---------------- record the blockout video ---------------- */
  /** ● start recording the 9:16 view (■ stop_record or the time limit saves the file) */
  record (): void {
    if (this.rec !== null) return
    try {
      const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m))
      if (mime === undefined || typeof (this.view as any).captureStream !== 'function') throw new Error('no recorder')
      const rec = new MediaRecorder(this.view.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 }); this.parts = []
      rec.ondataavailable = e => { if (e.data.size > 0) this.parts.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(this.parts, { type: mime.split(';')[0] }); this.rec = null; this.rec_ui()
        if (blob.size === 0) { this.status(M('Nothing was recorded.', 'Chưa ghi được gì.', '녹화된 내용 없음'), true); return }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `smash_blockout_${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000)
        this.status(M(`Saved the blockout video (${(blob.size / 1048576).toFixed(1)} MB). Next: upload it to Seedance (video → video) with the prompt below.`, `Đã lưu video blockout (${(blob.size / 1048576).toFixed(1)} MB) vào thư mục Tải về. Tiếp theo: đưa video lên Seedance (video → video) với prompt bên dưới.`, '저장됨'))
      }
      rec.start(250); this.rec = rec; this.recT0 = performance.now(); this.rec_ui()
      this.status(M('Recording… shoot now (or ⚡ auto shoot). ■ Stop & save when done.', 'Đang ghi… bắn đi (hoặc ⚡ bắn tự động). Xong thì bấm ■ Dừng & xuất.', '녹화 중…'))
    } catch (e) {
      this.rec = null; this.rec_ui()
      this.status(M('This browser cannot record the view. Use Chrome or Edge.', 'Trình duyệt này không ghi được khung hình. Hãy dùng Chrome hoặc Edge.', 'Chrome / Edge를 사용하세요'), true)
    }
  }
  /** ■ stop and save the video */
  stop_record (): void { if (this.rec !== null && this.rec.state !== 'inactive') this.rec.stop() }
  rec_ui (): void {
    const on = this.rec !== null, r = document.getElementById('sm-rec') as HTMLButtonElement | null, st = document.getElementById('sm-stop') as HTMLButtonElement | null, t = document.getElementById('sm-rectime')
    if (r !== null) r.disabled = on
    if (st !== null) st.disabled = !on
    if (t !== null) t.textContent = on ? '● REC 0.0s' : ''
  }

  status (t: string, warn = false): void { const s = $('sm-status'); s.textContent = t; s.classList.toggle('warn', warn) }

  /* ---------------- side panel ---------------- */
  prompt (): string {
    const st = STYLES[this.L.style] ?? STYLES.candy
    return `Use the input video as the exact motion and layout reference (video-to-video). Keep the camera, the timing, every hit and how each block falls exactly the same. Restyle the scene into ${st[0]}. Bright, colourful mobile-game ad look, soft studio lighting, vertical 9:16, sharp details, no text, no watermark. The gun at the bottom stays a toy blaster; the tapping hand stays a white cartoon hand; keep the ammo counter top left.`
  }
  panel (): void {
    const L = this.L, side = $('sm-side')
    side.innerHTML = `
      <div id="sm-status">${M('Draw the wall, then click the view to shoot. Record the run as a 9:16 blockout video for an AI video model.', 'Vẽ bức tường khối, rồi bấm vào khung để bắn. Quay lại thành video blockout 9:16 để đưa qua AI làm đẹp.', '벽을 그리고 클릭해 쏘세요.')}</div>
      <section><h3><b>1</b>${M('Draw the stack', 'Vẽ khối xếp', '블록 그리기')}</h3>
        <div class="row">${['wall', 'pyramid', 'towers', 'checker', 'random'].map(p => `<button data-pre="${p}">${({ wall: M('Wall', 'Tường', '벽'), pyramid: M('Pyramid', 'Kim tự tháp', '피라미드'), towers: M('Towers', 'Tháp', '타워'), checker: M('Checker', 'Caro', '체크'), random: M('Random', 'Ngẫu nhiên', '랜덤') } as any)[p]}</button>`).join('')}</div>
        <div class="row sm-pal">${[1, 2, 3, 4, 0].map(v => `<button data-brush="${v}" class="${this.brush === v ? 'on' : ''}" style="${v > 0 ? `background:#${COLORS[v].toString(16).padStart(6, '0')};` : ''}width:34px;height:28px">${v === 0 ? '⌫' : ''}</button>`).join('')}</div>
        <canvas id="sm-grid" width="300" height="300"></canvas>
        <div class="sm">${M('Click / drag to paint cells (bottom row sits on the table). Right click = erase.', 'Bấm / kéo để tô ô (hàng dưới cùng nằm trên bàn). Chuột phải = xoá.', '클릭/드래그로 칠하기')}</div>
        <label class="sm">${M('Columns', 'Số cột', '열')} <input type="range" id="sm-cols" min="3" max="14" value="${L.cols}"> ${L.cols}</label>
        <label class="sm">${M('Rows', 'Số hàng', '행')} <input type="range" id="sm-rows" min="2" max="16" value="${L.rows}"> ${L.rows}</label>
        <div class="row"><button id="sm-edit" class="${this.edit ? 'on' : ''}">✏️ ${this.edit ? M('Done placing', 'Xong — chơi', '완료') : M('Place pieces in the map', 'Xếp khối trong map', '맵에서 배치')}</button>
          <label class="sm">${M('New piece', 'Khối mới', '새 블록')} <select id="sm-new"><option value="box"${L.newShape === 'box' ? ' selected' : ''}>■ ${M('Box', 'Vuông', '상자')}</option><option value="can"${L.newShape === 'can' ? ' selected' : ''}>● ${M('Can', 'Tròn (lon)', '캔')}</option></select></label></div>
        ${this.edit ? `<div class="sm">${M('Click a face of a piece to stack the next one there (colour = the brush above), click the table to start a column. Right click / Alt + click or ⌫ = remove. Physics waits until you press Done.', 'Bấm vào mặt một khối để xếp khối mới sát mặt đó (màu = màu đang chọn ở trên), bấm lên bàn để đặt khối đầu tiên. Chuột phải / Alt + bấm hoặc ⌫ = xoá. Vật lý tạm dừng tới khi bấm Xong.', '면 클릭 = 쌓기, 우클릭 = 삭제')}</div>` : ''}
        ${L.extra.length ? `<div class="row sm">${L.extra.length} ${M('pieces placed by hand', 'khối xếp tay', '수동 블록')} <button id="sm-clear-extra">✕ ${M('Clear them', 'Xoá hết', '삭제')}</button></div>` : ''}
        <div class="row"><label class="sm">${M('Depth', 'Số lớp sâu', '깊이')} <select id="sm-depth">${[1, 2, 3].map(d => `<option${L.depth === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="sm">${M('Shape', 'Hình', '모양')} <select id="sm-shape"><option value="can"${L.shape === 'can' ? ' selected' : ''}>${M('Cans', 'Lon', '캔')}</option><option value="box"${L.shape === 'box' ? ' selected' : ''}>${M('Boxes', 'Hộp', '상자')}</option></select></label></div>
      </section>
      <section><h3><b>⬓</b>${M('Base', 'Đế', '받침')}</h3>
        <div class="row" style="flex-wrap:wrap">${([['table', M('Table', 'Bàn', '테이블')], ['pedestal', M('Round pedestal', 'Bệ tròn', '원형 받침')], ['steps', M('Podium steps', 'Bục bậc thang', '계단 단상')], ['float', M('Floating island', 'Đảo nổi', '떠 있는 섬')], ['spin', M('⟳ Turntable', '⟳ Đế xoay', '⟳ 회전판')], ['slide', M('⇆ Slider', '⇆ Đế trượt', '⇆ 슬라이더')]] as Array<[string, string]>).map(([k, t]) => `<button data-base="${k}" class="${L.base === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        ${L.base === 'spin' || L.base === 'slide' ? `<label class="sm">${M('Speed', 'Tốc độ', '속도')} <input type="range" id="sm-bspeed" min="0" max="30" value="${Math.round(L.baseSpeed * 10)}"> <span id="sm-bspeedv">${L.baseSpeed.toFixed(1)}</span></label><div class="sm">${M('The untouched stack rides on it; pieces you hit fall off by themselves.', 'Khối chưa bị bắn đi theo đế; khối bị bắn trúng tự rơi theo vật lý.', '맞지 않은 블록은 함께 움직입니다')}</div>` : ''}
        <div class="row">${['#ffffff', '#e53935', '#2457d6', '#c08a52', '#3a4258', '#4fed89'].map(c => `<button data-bcol="${c}" title="${c}" style="width:30px;height:24px;background:${c};${L.baseColor === c ? 'outline:2px solid #fff;' : ''}"></button>`).join('')}</div>
      </section>
      <section><h3><b>2</b>${M('Play it', 'Chơi thử', '플레이')}</h3>
        <div class="row"><button id="sm-reset">↺ ${M('Rebuild the stack', 'Dựng lại khối', '다시')}</button><button id="sm-auto" class="${this.auto ? 'on' : ''}">⚡ ${M('Auto shoot', 'Bắn tự động', '자동 사격')}</button></div>
        <label class="sm">${M('Shot power', 'Lực bắn', '파워')} <input type="range" id="sm-power" min="8" max="30" value="${L.power}"></label>
        <label class="sm">${M('Balls', 'Số đạn', '탄')} <input type="range" id="sm-ammo" min="5" max="60" value="${L.ammo}"> ${L.ammo}</label>
        <div class="row"><label class="sm">${M('Look', 'Nền', '배경')} <select id="sm-look"><option value="grey"${L.look === 'grey' ? ' selected' : ''}>${M('Grey blockout', 'Xám blockout', '회색')}</option><option value="pastel"${L.look === 'pastel' ? ' selected' : ''}>${M('Pastel', 'Pastel', '파스텔')}</option><option value="night"${L.look === 'night' ? ' selected' : ''}>${M('Night', 'Tối', '밤')}</option></select></label>
        </div>
        <div class="row"><label class="sm"><input type="checkbox" id="sm-hand"${L.hand ? ' checked' : ''}> 👆 ${M('Pointer (hand)', 'Con trỏ (bàn tay)', '포인터')}</label>
          <label class="sm"><input type="checkbox" id="sm-sa"${L.showAmmo ? ' checked' : ''}> ${M('Ammo count', 'Số đạn', '탄 수')}</label>
          <label class="sm"><input type="checkbox" id="sm-ss"${L.showScore ? ' checked' : ''}> ${M('Knocked count', 'Số khối đổ', '쓰러진 수')}</label></div>
      </section>
      <section><h3><b>3</b>${M('Blockout video', 'Video blockout', '블록아웃 영상')}</h3>
        <div class="row"><button id="sm-rec" class="pri">● ${M('Record', 'Ghi', '녹화')}</button><button id="sm-stop" style="background:#e53935;border-color:#9a1f1d;color:#fff">■ ${M('Stop & save', 'Dừng & xuất', '정지·저장')}</button><b id="sm-rectime" style="color:#ff5a4f;font-size:12px"></b></div>
        <label class="sm">${M('Stop by itself after', 'Tự dừng sau', '자동 정지')} <select id="sm-recmax">${[0, 5, 10, 15, 20, 30].map(v => `<option value="${v}"${this.recMax === v ? ' selected' : ''}>${v === 0 ? M('never (■ button)', 'không (bấm ■)', '안 함') : v + ' s'}</option>`).join('')}</select></label>
        <div class="sm">${M('Records the 9:16 view (720×1280) with the HUD and hand. Tip: ↺ rebuild, ● record, ⚡ auto shoot, ■ stop.', 'Quay khung 9:16 (720×1280) kèm HUD và bàn tay. Mẹo: ↺ dựng lại, ● quay, ⚡ bắn tự động, ■ dừng.', '9:16 녹화')}</div>
      </section>
      <section><h3><b>4</b>${M('AI restyle (Seedance)', 'AI làm đẹp (Seedance)', 'AI 리스타일')}</h3>
        <label class="sm">${M('Theme', 'Chủ đề', '테마')} <select id="sm-style">${Object.entries(STYLES).map(([k, v]) => `<option value="${k}"${L.style === k ? ' selected' : ''}>${M(k, v[1], v[2])}</option>`).join('')}</select></label>
        <textarea id="sm-prompt" rows="7" style="width:100%;font:12px/1.4 system-ui;border-radius:8px;padding:6px">${this.prompt()}</textarea>
        <button id="sm-copy">📋 ${M('Copy prompt', 'Copy prompt', '프롬프트 복사')}</button>
        <div class="sm">${M('Seedance (video → video): upload the blockout MP4, paste the prompt. The blockout keeps the motion right; the AI only paints the look. Check the result — fix the stack and re-shoot if a hit looks wrong.', 'Seedance (video → video): tải video blockout MP4 lên, dán prompt. Blockout giữ đúng chuyển động; AI chỉ vẽ lại hình. Người kiểm tra lại kết quả — sai chỗ nào thì sửa khối và quay lại.', '블록아웃 업로드 후 프롬프트 붙여넣기')}</div>
      </section>`
    const ch = (): void => { this.save(); this.reset(); this.panel() }
    side.querySelectorAll<HTMLButtonElement>('[data-pre]').forEach(b => { b.onclick = () => { L.cells = preset(b.dataset.pre as string, L.cols, L.rows); ch() } })
    side.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach(b => { b.onclick = () => { this.brush = Number(b.dataset.brush); this.panel() } })
    const resize = (cols: number, rows: number): void => { const c = new Array(cols * rows).fill(0); for (let y = 0; y < Math.min(rows, L.rows); y++) for (let x = 0; x < Math.min(cols, L.cols); x++) c[y * cols + x] = L.cells[y * L.cols + x]; L.cols = cols; L.rows = rows; L.cells = c; ch() }
    ;($('sm-cols') as HTMLInputElement).onchange = e => resize(Number((e.target as HTMLInputElement).value), L.rows)
    ;($('sm-rows') as HTMLInputElement).onchange = e => resize(L.cols, Number((e.target as HTMLInputElement).value))
    ;($('sm-depth') as HTMLSelectElement).onchange = e => { L.depth = Number((e.target as HTMLSelectElement).value); ch() }
    ;($('sm-shape') as HTMLSelectElement).onchange = e => { L.shape = (e.target as HTMLSelectElement).value as Shape; ch() }
    ;($('sm-power') as HTMLInputElement).oninput = e => { L.power = Number((e.target as HTMLInputElement).value); this.save() }
    ;($('sm-ammo') as HTMLInputElement).onchange = e => { L.ammo = Number((e.target as HTMLInputElement).value); ch() }
    ;($('sm-look') as HTMLSelectElement).onchange = e => { L.look = (e.target as HTMLSelectElement).value; this.save(); this.apply_look() }
    ;($('sm-hand') as HTMLInputElement).onchange = e => { L.hand = (e.target as HTMLInputElement).checked; this.save() }
    ;($('sm-sa') as HTMLInputElement).onchange = e => { L.showAmmo = (e.target as HTMLInputElement).checked; this.save() }
    ;($('sm-ss') as HTMLInputElement).onchange = e => { L.showScore = (e.target as HTMLInputElement).checked; this.save() }
    ;($('sm-new') as HTMLSelectElement).onchange = e => { L.newShape = (e.target as HTMLSelectElement).value as Shape; this.save() }
    $('sm-edit').onclick = () => { this.edit = !this.edit; this.auto = false; this.reset(); if (!this.edit && this.ghost !== null) this.ghost.visible = false; this.panel() }
    document.getElementById('sm-clear-extra')?.addEventListener('click', () => { L.extra = []; ch() })
    side.querySelectorAll<HTMLButtonElement>('[data-base]').forEach(b => { b.onclick = () => { L.base = b.dataset.base as string; ch() } })
    side.querySelectorAll<HTMLButtonElement>('[data-bcol]').forEach(b => { b.onclick = () => { L.baseColor = b.dataset.bcol as string; ch() } })
    document.getElementById('sm-bspeed')?.addEventListener('input', e => { L.baseSpeed = Number((e.target as HTMLInputElement).value) / 10; const v = document.getElementById('sm-bspeedv'); if (v !== null) v.textContent = L.baseSpeed.toFixed(1); this.save() })
    $('sm-reset').onclick = () => { this.reset() }
    $('sm-auto').onclick = () => { this.auto = !this.auto; this.panel() }
    $('sm-rec').onclick = () => { this.record() }
    $('sm-stop').onclick = () => { this.stop_record() }
    ;($('sm-recmax') as HTMLSelectElement).onchange = e => { this.recMax = Number((e.target as HTMLSelectElement).value) }
    this.rec_ui()
    ;($('sm-style') as HTMLSelectElement).onchange = e => { L.style = (e.target as HTMLSelectElement).value; this.save(); ($('sm-prompt') as HTMLTextAreaElement).value = this.prompt() }
    $('sm-copy').onclick = () => { void navigator.clipboard.writeText(($('sm-prompt') as HTMLTextAreaElement).value).then(() => this.status(M('Prompt copied.', 'Đã copy prompt.', '복사됨'))) }
    this.grid()
  }
  /** the paint grid: row 0 is drawn at the bottom (it sits on the table) */
  grid (): void {
    const c = $('sm-grid') as HTMLCanvasElement, L = this.L, cell = Math.floor(Math.min(300 / L.cols, 300 / L.rows))
    c.width = cell * L.cols; c.height = cell * L.rows; const g = c.getContext('2d') as CanvasRenderingContext2D
    const draw = (): void => {
      g.fillStyle = '#1b2230'; g.fillRect(0, 0, c.width, c.height)
      for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) { const v = L.cells[y * L.cols + x]; const X = x * cell, Y = (L.rows - 1 - y) * cell; g.fillStyle = v > 0 ? '#' + COLORS[v].toString(16).padStart(6, '0') : '#262f40'; g.fillRect(X + 1, Y + 1, cell - 2, cell - 2) }
    }
    draw()
    let painting = -1
    const at = (e: PointerEvent): number => { const r = c.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * L.cols), y = L.rows - 1 - Math.floor((e.clientY - r.top) / r.height * L.rows); return x >= 0 && x < L.cols && y >= 0 && y < L.rows ? y * L.cols + x : -1 }
    c.oncontextmenu = e => e.preventDefault()
    c.onpointerdown = e => { painting = e.button === 2 ? 0 : this.brush; const i = at(e); if (i >= 0) { L.cells[i] = painting; draw() } c.setPointerCapture(e.pointerId) }
    c.onpointermove = e => { if (painting < 0) return; const i = at(e); if (i >= 0 && L.cells[i] !== painting) { L.cells[i] = painting; draw() } }
    c.onpointerup = () => { if (painting >= 0) { painting = -1; this.save(); this.reset() } }
  }
}

const app = new SmashApp()
;(window as any).__smash = {
  shoot: (x: number, y: number) => app.shoot_at(x * RW, y * RH), auto: (on: boolean) => { app.auto = on; app.panel() }, reset: () => app.reset(),
  preset: (p: string) => { app.L.cells = preset(p, app.L.cols, app.L.rows); app.save(); app.reset(); app.panel() }, base: (kind: string, speed?: number, color?: string) => { app.L.base = kind; if (speed !== undefined) app.L.baseSpeed = speed; if (color !== undefined) app.L.baseColor = color; app.save(); app.reset(); app.panel() }, record: () => app.record(), stop: () => app.stop_record(), state: () => ({ ammo: app.ammo, knocked: app.knocked(), blocks: app.blocks.length }), layout: () => app.L
}
