/**
 * Target smash blockout (game genre: shoot a stacked wall of boxes / cans off a table).
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
interface Layout { cols: number, rows: number, depth: number, cells: number[], shape: Shape, size: number, power: number, ammo: number, look: string, hand: boolean, style: string, extra: Piece[], showAmmo: boolean, showScore: boolean, newShape: Shape }
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
function defaults (): Layout { const cols = 8, rows = 9; return { cols, rows, depth: 1, cells: preset('wall', cols, rows), shape: 'can', size: 0.42, power: 16, ammo: 30, look: 'grey', hand: true, style: 'candy', extra: [], showAmmo: true, showScore: true, newShape: 'box' } }

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
  brush = 1
  edit = false // ✏️ place / remove pieces in the 3D view (physics paused)
  ghost: THREE.Mesh | null = null
  supT = 0
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
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), red = new THREE.MeshStandardMaterial({ color: 0xe53935 })
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), mat); slab.position.set(0, this.top - 0.06, this.tableZ); slab.castShadow = slab.receiveShadow = true; slab.userData.table = true
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.04, 0.06), red); rim.position.set(0, this.top - 0.1, this.tableZ + d / 2); rim.userData.table = true
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, this.top - 0.12, 0.12), mat); pole.position.set(0, (this.top - 0.12) / 2, this.tableZ); pole.castShadow = true; pole.userData.table = true
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.5), red); foot.position.set(0, 0.04, this.tableZ); foot.userData.table = true
    this.scene.add(slab, rim, pole, foot)
    const tb = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, 0.06, d / 2)), position: new CANNON.Vec3(0, this.top - 0.06, this.tableZ) }); (tb as any).table = true; this.world.addBody(tb)
    const pb = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.06, (this.top - 0.12) / 2, 0.06)), position: new CANNON.Vec3(0, (this.top - 0.12) / 2, this.tableZ) }); (pb as any).table = true; this.world.addBody(pb)
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
  cell_pos (x: number, y: number, z: number): THREE.Vector3 { const L = this.L, s = L.size; return new THREE.Vector3((x - (L.cols - 1) / 2) * s, this.top + s * 0.48 + y * s * 0.985, this.tableZ - (z - (L.depth - 1) / 2) * s) }
  /** a sleeping block whose support is gone (shot away) must fall: wake it */
  support_check (): void {
    const s = this.L.size, half = this.L.cols * s / 2 + 0.25
    for (const b of this.blocks) {
      if (b.body.sleepState !== CANNON.Body.SLEEPING) continue
      const p = b.body.position
      if (p.y < this.top + s * 0.6 && Math.abs(p.x) < half) continue // on the table
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

  knocked (): number { return this.blocks.filter(b => b.body.position.y < this.top - 0.15 || Math.abs(b.body.position.z - this.tableZ) > this.L.depth * this.L.size + 0.4).length }

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
    if (!this.edit) { this.world.fixedStep(1 / 60, dt); this.supT -= dt; if (this.supT <= 0) { this.supT = 0.2; this.support_check() } }
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
    if (this.rec !== null) { const sec = (now - this.recT0) / 1000; $('sm-rec').textContent = '■ ' + M('Stop', 'Dừng', '정지') + ` ${sec.toFixed(1)}s` }
    requestAnimationFrame(t => this.frame(t))
  }

  /* ---------------- record the blockout video ---------------- */
  record (): void {
    if (this.rec !== null) { this.rec.stop(); return }
    const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m))
    if (mime === undefined) { this.status(M('This browser cannot record video.', 'Trình duyệt này không quay được video.', '녹화 불가'), true); return }
    const rec = new MediaRecorder(this.view.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 }); this.parts = []
    rec.ondataavailable = e => { if (e.data.size > 0) this.parts.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(this.parts, { type: mime.split(';')[0] }); this.rec = null; $('sm-rec').textContent = '● ' + M('Record video', 'Quay video', '녹화')
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `smash_blockout_${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      this.status(M(`Saved the blockout video (${(blob.size / 1048576).toFixed(1)} MB). Next: upload it to Seedance (video → video) with the prompt below.`, `Đã lưu video blockout (${(blob.size / 1048576).toFixed(1)} MB). Tiếp theo: đưa video lên Seedance (video → video) với prompt bên dưới.`, '저장됨'))
    }
    rec.start(250); this.rec = rec; this.recT0 = performance.now()
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
        <button id="sm-rec" class="pri">● ${M('Record video', 'Quay video', '녹화')}</button>
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
    $('sm-reset').onclick = () => { this.reset() }
    $('sm-auto').onclick = () => { this.auto = !this.auto; this.panel() }
    $('sm-rec').onclick = () => { this.record() }
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
  preset: (p: string) => { app.L.cells = preset(p, app.L.cols, app.L.rows); app.save(); app.reset(); app.panel() }, record: () => app.record(), state: () => ({ ammo: app.ammo, knocked: app.knocked(), blocks: app.blocks.length }), layout: () => app.L
}
