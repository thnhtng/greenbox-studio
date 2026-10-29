/*
 * Greenbox 3D — Vehicle rig.
 * Load a car/truck (GLB/FBX) -> point it forward -> find the wheels (separate parts, or a best guess on a
 * single welded mesh) -> fix the wheel areas with + / − brushes -> 20 ready-made animations -> export GLB/FBX.
 *
 * No mesh is cut: every vertex is skinned 100% to either the body bone or one wheel bone, so the file stays
 * one model and works in Blender / Unity / Unreal. Wheels sit under the root (not the body), so body roll and
 * pitch never lift the wheels off the ground.
 */
import { mount_view_buttons } from '../common/ViewButtons'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import { M } from '../common/lang.ts'
import { type Mech, type MechKind, type MechPose, type Hinge, type MechAxis, MECH_ICON, default_angle, mech_pose, mech_parent, mech_clips } from './Mechanics.ts'

interface Part { mesh: THREE.Mesh, owner: Int16Array } // owner per vertex: -1 = body, k = wheel k, DOOR0 + j = door j
interface Wheel { name: string, center: THREE.Vector3, radius: number, front: boolean, guessed: boolean, axle?: THREE.Vector3 } // axle: the wheel's own spin axis
const DOOR0 = 100 // owner codes from here on are mechanical parts (doors, turret, boom, hook…)
type VehicleType = 'car' | 'truck' | 'tracked' | 'roller'
type Tool = 'add' | 'remove' | 'box_add' | 'box_remove' | 'piece_add' | 'piece_remove' | 'lasso_add' | 'lasso_remove' | 'pen_add' | 'pen_remove' | null
const TOOL_BUTTONS: Array<[Exclude<Tool, null>, string]> = [['add', 'vh-add'], ['remove', 'vh-remove'], ['box_add', 'vh-box-add'], ['box_remove', 'vh-box-remove'], ['piece_add', 'vh-piece-add'], ['piece_remove', 'vh-piece-remove'], ['lasso_add', 'vh-lasso-add'], ['lasso_remove', 'vh-lasso-remove'], ['pen_add', 'vh-pen-add'], ['pen_remove', 'vh-pen-remove']]

/** eigenvalues / unit eigenvectors of a symmetric 3x3 matrix (Jacobi rotations) */
function eigen3 (m: number[][]): { vals: number[], vecs: THREE.Vector3[] } {
  const a = m.map(r => r.slice()); const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q]
    if (off < 1e-20) break
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)); const c = 1 / Math.sqrt(t * t + 1); const s = t * c
        for (let k = 0; k < 3; k++) { const akp = a[k][p]; const akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq }
        for (let k = 0; k < 3; k++) { const apk = a[p][k]; const aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk }
        for (let k = 0; k < 3; k++) { const vkp = v[k][p]; const vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq }
      }
    }
  }
  return { vals: [a[0][0], a[1][1], a[2][2]], vecs: [0, 1, 2].map(i => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize()) }
}

/** ready-made parts: one click creates the part with the right pivot rule, then you select its area */
interface Preset { icon: string, label: string, kind: MechKind | 'wheel', hinge?: Hinge, axis?: MechAxis, angle?: number }
const PRESETS: Preset[] = [
  { icon: '🛞', label: 'Wheel', kind: 'wheel' },
  { icon: '🛢', label: 'Roller drum', kind: 'wheel' },
  { icon: '🚪', label: 'Door', kind: 'door', hinge: 'front' },
  { icon: '🚪', label: 'Suicide door', kind: 'door', hinge: 'back' },
  { icon: '🦅', label: 'Gull-wing', kind: 'door', hinge: 'top' },
  { icon: '✂', label: 'Scissor door', kind: 'door', hinge: 'scissor' },
  { icon: '🔼', label: 'Hood', kind: 'door', hinge: 'hood' },
  { icon: '🔽', label: 'Trunk', kind: 'door', hinge: 'trunk' },
  { icon: '🔄', label: 'Turret / cab', kind: 'turret' },
  { icon: '💥', label: 'Gun barrel', kind: 'barrel' },
  { icon: '🚜', label: 'Dozer blade', kind: 'blade' },
  { icon: '🏗', label: 'Boom', kind: 'boom' },
  { icon: '🦾', label: 'Digger arm', kind: 'arm' },
  { icon: '🪣', label: 'Bucket', kind: 'bucket' },
  { icon: '🪝', label: 'Hook', kind: 'hook' },
  { icon: '〰', label: 'Cable', kind: 'cable' },
  { icon: '🌀', label: 'Propeller', kind: 'spin', axis: 'z', angle: 100 },
  { icon: '🚁', label: 'Rotor', kind: 'spin', axis: 'y', angle: 100 },
  { icon: '📡', label: 'Radar / fan', kind: 'spin', axis: 'y', angle: 40 },
  { icon: '🥁', label: 'Mixer drum', kind: 'spin', axis: 'z', angle: 30 },
  { icon: '↕', label: 'Piston / forks', kind: 'slide', axis: 'y', angle: 60 },
  { icon: '🪜', label: 'Ladder', kind: 'slide', axis: 'z', angle: 80 },
  { icon: '📶', label: 'Antenna / flag', kind: 'wobble', angle: 20 }
]

/* status lines in the cockpit language (static labels are translated by gb-i18n.js) */
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const WHEEL_COLORS = [0x4fc3f7, 0xffb74d, 0xba68c8, 0x81c784, 0xf06292, 0x4db6ac, 0xffd54f, 0x9575cd]
const DOOR_COLORS = [0xff7043, 0x26c6da, 0xd4e157, 0xec407a, 0x7e57c2, 0x66bb6a]

class VehicleApp {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000)
  private readonly controls: OrbitControls
  private readonly holder = new THREE.Group() // model lives here (baked, canonical: +Z forward, +Y up, on the floor)
  private parts: Part[] = []
  private wheels: Wheel[] = []
  private size = new THREE.Vector3(1, 1, 1)
  private mechs: Mech[] = []
  private vtype: VehicleType = 'car'
  private active = 0 // owner code of the selected part: k = wheel k, DOOR0 + j = door j, -1 = none
  private brush_mode: Tool = null
  private box_start: { x: number, y: number } | null = null
  private poly: Array<{ x: number, y: number }> = [] // lasso / pen points (client px)
  private lassoing = false
  private down_at: { x: number, y: number } | null = null
  private brush_radius_pct = 6
  private painting = false
  private show_regions = true
  private original_materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private region_material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  // rig + playback
  private rig: { root: THREE.Bone, body: THREE.Bone, wheels: THREE.Bone[], steers: Array<THREE.Bone | null>, mechs: Array<{ bone: THREE.Bone, pose: MechPose, kind: MechKind, rest: THREE.Vector3, parent: number }>, skinned: THREE.SkinnedMesh[] } | null = null
  private mixer: THREE.AnimationMixer | null = null
  private clips: THREE.AnimationClip[] = []
  private current: THREE.AnimationAction | null = null
  private readonly clock = new THREE.Clock()
  private markers = new THREE.Group()
  private front_arrow: THREE.ArrowHelper | null = null
  private readonly hinge_marker = new THREE.Group()

  constructor () {
    const view = $('vh-view')
    view.appendChild(this.renderer.domElement)
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio)) // retina at 2x costs 4x the pixels: 1.5 looks the same while working
    this.scene.background = new THREE.Color(0x393939)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 6, 4); this.scene.add(sun)
    const grid = new THREE.GridHelper(40, 80, 0x5a5a5a, 0x474747); this.scene.add(grid)
    this.scene.add(this.holder); this.scene.add(this.markers); this.scene.add(this.hinge_marker)
    this.camera.position.set(4, 3, 6)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    addEventListener('resize', () => this.resize()); this.resize()
    if (getComputedStyle(view).position === 'static') view.style.position = 'relative'
    mount_view_buttons(view, { camera: () => this.camera, controls: () => this.controls })
    this.bind_ui()
    this.renderer.setAnimationLoop(() => {
      const dt = this.clock.getDelta()
      this.mixer?.update(dt * Number(($('vh-speed') as HTMLInputElement).value) / 100)
      this.renderer.render(this.scene, this.camera)
    })
    this.load_demo()
  }

  private resize (): void {
    const v = $('vh-view'); const w = v.clientWidth; const h = v.clientHeight
    this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix()
  }

  private status (txt: string, warn = false): void {
    const s = $('vh-status'); s.textContent = txt; s.className = warn ? 'warn' : ''
  }

  /* ------------------------------------------------ loading ------------------------------------------------ */
  private bind_ui (): void {
    const pr = document.getElementById('vh-presets')
    if (pr !== null) {
      pr.innerHTML = PRESETS.map((p, i) => `<button type="button" class="vh-preset" data-i="${i}" title="${p.label}"><span>${p.icon}</span>${p.label}</button>`).join('')
      pr.querySelectorAll<HTMLButtonElement>('.vh-preset').forEach(b => {
        b.onclick = () => {
          const p = PRESETS[Number(b.dataset.i)]
          if (p.kind === 'wheel') this.new_wheel()
          else this.new_mech(p.kind, { hinge: p.hinge ?? 'auto', axis: p.axis ?? 'auto', ...(p.angle !== undefined ? { angle: p.angle } : {}) })
        }
      })
    }
    ;($('vh-axis') as HTMLSelectElement).onchange = (e) => { const d = this.mechs[this.active - DOOR0]; if (d !== undefined) { d.axis = (e.target as HTMLSelectElement).value as MechAxis; this.clear_rig(); this.draw_hinge() } }
    const file = $('vh-file') as HTMLInputElement
    $('vh-upload').onclick = () => file.click()
    file.onchange = () => { const f = file.files?.[0]; if (f !== undefined) void this.load_file(f); file.value = '' }
    $('vh-demo').onclick = () => this.load_demo()
    $('vh-rotate').onclick = () => this.rotate_model(Math.PI / 2)
    $('vh-flip').onclick = () => this.rotate_model(Math.PI)
    $('vh-scan').onclick = () => this.scan_wheels()
    TOOL_BUTTONS.forEach(([t, id]) => { const b = document.getElementById(id); if (b !== null) b.onclick = () => this.set_brush(this.brush_mode === t ? null : t) })
    $('vh-new-wheel').onclick = () => this.new_wheel()
    $('vh-new-door').onclick = () => this.new_mech((($('vh-part-kind') as HTMLSelectElement).value as MechKind))
    ;($('vh-type') as HTMLSelectElement).onchange = (e) => { this.vtype = (e.target as HTMLSelectElement).value as VehicleType; this.clear_rig() }
    ;($('vh-part-flip') as HTMLInputElement).onchange = (e) => { const d = this.mechs[this.active - DOOR0]; if (d !== undefined) { d.flip = (e.target as HTMLInputElement).checked; this.clear_rig(); this.draw_hinge() } }
    $('vh-del-wheel').onclick = () => this.delete_selected()
    ;($('vh-hinge') as HTMLSelectElement).onchange = (e) => { const d = this.mechs[this.active - DOOR0]; if (d !== undefined) { d.hinge = (e.target as HTMLSelectElement).value as Hinge; this.clear_rig(); this.draw_hinge() } }
    ;($('vh-door-angle') as HTMLInputElement).oninput = (e) => { const d = this.mechs[this.active - DOOR0]; if (d !== undefined) { d.angle = Number((e.target as HTMLInputElement).value); $('vh-door-angle-val').textContent = this.amount_label(d); this.clear_rig(); this.draw_hinge() } }
    $('vh-door-test').onclick = () => this.test_door()
    addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement
      if (t !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.delete_selected() }
      if (e.key === 'Escape') this.set_brush(null)
      if (e.key === 'Enter' && this.poly.length >= 3) this.finish_poly()
    })
    ;($('vh-brush') as HTMLInputElement).oninput = (e) => { this.brush_radius_pct = Number((e.target as HTMLInputElement).value) }
    ;($('vh-regions') as HTMLInputElement).onchange = (e) => { this.show_regions = (e.target as HTMLInputElement).checked; this.refresh_colors() }
    ;($('vh-wheel-select') as HTMLSelectElement).onchange = (e) => { this.select(Number((e.target as HTMLSelectElement).value)) }
    $('vh-build').onclick = () => this.build_rig()
    $('vh-export-glb').onclick = () => { void this.export('glb') }
    $('vh-export-fbx').onclick = () => { void this.export('fbx') }
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      this.down_at = { x: e.clientX, y: e.clientY }
      if (this.brush_mode === 'add' || this.brush_mode === 'remove') { this.painting = true; this.paint(e) }
      else if (this.brush_mode === 'box_add' || this.brush_mode === 'box_remove') { this.box_start = { x: e.clientX, y: e.clientY }; this.draw_box(e) }
      else if (this.brush_mode === 'lasso_add' || this.brush_mode === 'lasso_remove') { this.lassoing = true; this.poly = [{ x: e.clientX, y: e.clientY }]; this.draw_poly() }
      else if (this.brush_mode === 'pen_add' || this.brush_mode === 'pen_remove') {
        const p0 = this.poly[0]
        // click near the first point (or double-click) closes the shape
        if (this.poly.length >= 3 && (e.detail >= 2 || (p0 !== undefined && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) < 10))) this.finish_poly()
        else { this.poly.push({ x: e.clientX, y: e.clientY }); this.draw_poly() }
      }
    })
    el.addEventListener('pointermove', (e) => {
      if (this.painting) this.paint(e)
      else if (this.box_start !== null) this.draw_box(e)
      else if (this.lassoing) { const l = this.poly[this.poly.length - 1]; if (l === undefined || Math.hypot(e.clientX - l.x, e.clientY - l.y) > 4) { this.poly.push({ x: e.clientX, y: e.clientY }); this.draw_poly() } }
      else if ((this.brush_mode === 'pen_add' || this.brush_mode === 'pen_remove') && this.poly.length > 0) this.draw_poly({ x: e.clientX, y: e.clientY })
    })
    addEventListener('pointerup', (e) => {
      if (this.painting) { this.painting = false; this.after_paint() }
      else if (this.box_start !== null) { this.finish_box(e) }
      else if (this.lassoing) { this.lassoing = false; this.finish_poly() }
      else if ((this.brush_mode === 'piece_add' || this.brush_mode === 'piece_remove') && e.button === 0 && this.down_at !== null && e.target === el && Math.hypot(e.clientX - this.down_at.x, e.clientY - this.down_at.y) < 4) this.click_piece(e)
      else if (e.button === 0 && this.down_at !== null && e.target === el && Math.hypot(e.clientX - this.down_at.x, e.clientY - this.down_at.y) < 4) this.pick(e)
      this.down_at = null
    })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    // drop a file anywhere
    addEventListener('dragover', (e) => e.preventDefault())
    addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f !== undefined) void this.load_file(f) })
  }

  private async load_file (f: File): Promise<void> {
    const url = URL.createObjectURL(f)
    try {
      let root: THREE.Object3D
      if (/\.fbx$/i.test(f.name)) root = await new FBXLoader().loadAsync(url)
      else root = (await new GLTFLoader().loadAsync(url)).scene
      this.set_model(root, f.name)
    } catch (err) {
      this.status(M('Could not read this file: ', 'Không đọc được file: ', '파일을 읽을 수 없습니다: ') + String(err), true)
    } finally { URL.revokeObjectURL(url) }
  }

  private load_demo (): void {
    // a simple boxy car so the page is never empty
    const g = new THREE.Group()
    const red = new THREE.MeshStandardMaterial({ color: 0xd43d2f, roughness: 0.5 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 })
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fb7d9, roughness: 0.2 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 4, 9, 4, 24), red); body.position.y = 0.6; g.add(body)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2, 8, 3, 12), glass); cab.position.set(0, 1.15, -0.2); g.add(cab)
    for (const x of [-0.85, 0.85]) {
      for (const z of [1.3, -1.3]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 24), dark)
        w.rotation.z = Math.PI / 2; w.position.set(x, 0.38, z); g.add(w)
      }
    }
    this.set_model(g, 'demo car')
  }

  /** bake every mesh into world space, center it, put it on the floor, longest side along Z */
  private set_model (root: THREE.Object3D, name: string): void {
    this.comp_cache.clear()
    this.clear_rig()
    this.holder.clear(); this.parts = []; this.wheels = []; this.mechs = []; this.original_materials.clear()
    root.updateMatrixWorld(true)
    const meshes: THREE.Mesh[] = []
    root.traverse((o) => { const m = o as THREE.Mesh; if ((m.isMesh ?? false) && m.geometry !== undefined) meshes.push(m) })
    if (meshes.length === 0) { this.status(M('No mesh found in this file.', 'File không có mesh nào.', '이 파일에 메시가 없습니다.'), true); return }
    for (const m of meshes) {
      let g = m.geometry.clone()
      if ((m as THREE.SkinnedMesh).isSkinnedMesh ?? false) { g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight') }
      g.applyMatrix4(m.matrixWorld)
      if (g.getAttribute('normal') === undefined) g.computeVertexNormals()
      const mesh = new THREE.Mesh(g, m.material)
      mesh.name = m.name !== '' ? m.name : 'part'
      this.holder.add(mesh)
      this.original_materials.set(mesh, m.material)
      this.parts.push({ mesh, owner: new Int16Array(g.getAttribute('position').count).fill(-1) })
    }
    const dropped = this.drop_extras()
    this.align_long_axis()
    this.recenter()
    const extra = dropped.length > 0 ? M(` Ignored ${dropped.length} object(s) that are not the vehicle: ${dropped.join(', ')}.`, ` Đã bỏ ${dropped.length} vật không phải xe: ${dropped.join(', ')}.`, ` 차량이 아닌 오브젝트 ${dropped.length}개 제외: ${dropped.join(', ')}.`) : ''
    this.status(M(`Loaded ${name}: ${this.parts.length} mesh(es). Check that the arrow points to the FRONT.`, `Đã nạp ${name}: ${this.parts.length} mesh. Kiểm tra mũi tên xanh chỉ về ĐẦU xe.`, `${name} 불러옴: 메시 ${this.parts.length}개. 초록 화살표가 차량 앞쪽을 가리키는지 확인하세요.`) + extra)
    this.frame()
    this.scan_wheels()
    this.doors_from_names()
    // the scan writes its own status line: keep the "ignored ground / lamp" note visible after it
    if (extra !== '') { const st = $('vh-status'); st.textContent = (st.textContent ?? '') + extra }
  }

  /**
   * Files often come with a scene around the vehicle (a ground plane, a street lamp…). Those would make the
   * vehicle look huge and put the guessed wheels in the air. Keep only the vehicle:
   *   - a big flat sheet at the very bottom is the ground,
   *   - meshes are grouped by touching boxes; the biggest group is the vehicle, the rest is scenery.
   */
  private drop_extras (): string[] {
    if (this.parts.length < 2) return []
    const boxes = this.parts.map(p => { p.mesh.geometry.computeBoundingBox(); return p.mesh.geometry.boundingBox!.clone() })
    const all = new THREE.Box3(); boxes.forEach(b => all.union(b))
    const A = all.getSize(new THREE.Vector3())
    const drop = new Set<number>()
    // ground: flat, at the bottom, and wider than everything that is not flat
    const solid = new THREE.Box3()
    boxes.forEach(b => { const z = b.getSize(new THREE.Vector3()); if (z.y > 0.03 * Math.max(z.x, z.z)) solid.union(b) })
    const S = solid.isEmpty() ? A : solid.getSize(new THREE.Vector3())
    boxes.forEach((b, i) => {
      const z = b.getSize(new THREE.Vector3())
      const flat = z.y < 0.02 * Math.max(z.x, z.z, 1e-9)
      const bottom = b.max.y <= all.min.y + A.y * 0.03
      const wide = z.x > S.x * 0.9 && z.z > S.z * 0.9
      if (flat && bottom && wide) drop.add(i)
    })
    // group the rest by touching (slightly grown) boxes
    const keep = boxes.map((_b, i) => i).filter(i => !drop.has(i))
    if (keep.length === 0) return []
    const parent = new Map<number, number>(); keep.forEach(i => parent.set(i, i))
    const find = (a: number): number => { while (parent.get(a) !== a) a = parent.get(a)!; return a }
    const grow = A.length() * 0.01
    for (let a = 0; a < keep.length; a++) {
      for (let b = a + 1; b < keep.length; b++) {
        if (boxes[keep[a]].clone().expandByScalar(grow).intersectsBox(boxes[keep[b]])) parent.set(find(keep[a]), find(keep[b]))
      }
    }
    const groups = new Map<number, { box: THREE.Box3, items: number[] }>()
    keep.forEach(i => { const r = find(i); const g = groups.get(r) ?? { box: new THREE.Box3(), items: [] }; g.box.union(boxes[i]); g.items.push(i); groups.set(r, g) })
    if (groups.size > 1) {
      // the vehicle: most "stuff" (vertices) — a lamp post or a sign is thin and light next to a car body
      const weight = (g: { items: number[] }): number => g.items.reduce((acc, i) => acc + this.parts[i].owner.length, 0)
      const best = [...groups.values()].sort((x, y) => weight(y) - weight(x))[0]
      const bs = best.box.getSize(new THREE.Vector3())
      const gap = (a: THREE.Box3, b: THREE.Box3): number => {
        const d = (lo1: number, hi1: number, lo2: number, hi2: number): number => Math.max(0, lo2 - hi1, lo1 - hi2)
        return Math.hypot(d(a.min.x, a.max.x, b.min.x, b.max.x), d(a.min.y, a.max.y, b.min.y, b.max.y), d(a.min.z, a.max.z, b.min.z, b.max.z))
      }
      // scenery = clearly apart from the vehicle, or a pole / sign: taller than the vehicle with a tiny footprint.
      // Parts floating a little off the body (a boom above the cab) stay.
      groups.forEach(g => {
        if (g === best) return
        const z = g.box.getSize(new THREE.Vector3())
        const far = gap(g.box, best.box) > bs.length() * 0.15
        const pole = z.y > bs.y * 1.3 && z.x * z.z < bs.x * bs.z * 0.1
        if (far || pole) g.items.forEach(i => drop.add(i))
      })
    }
    if (drop.size === 0 || drop.size >= this.parts.length) return []
    const names: string[] = []
    this.parts = this.parts.filter((p, i) => {
      if (!drop.has(i)) return true
      names.push(p.mesh.name); this.holder.remove(p.mesh); this.original_materials.delete(p.mesh); p.mesh.geometry.dispose()
      return false
    })
    return names
  }

  /** turn the vehicle so its length runs along Z, even when the file has it at an odd angle */
  private align_long_axis (): void {
    let n = 0; let mx = 0; let mz = 0
    const pts: Array<[number, number]> = []
    this.parts.forEach(p => {
      const pos = p.mesh.geometry.getAttribute('position'); const step = Math.max(1, Math.floor(pos.count / 4000))
      for (let i = 0; i < pos.count; i += step) { pts.push([pos.getX(i), pos.getZ(i)]); mx += pos.getX(i); mz += pos.getZ(i); n++ }
    })
    if (n < 3) return
    mx /= n; mz /= n
    let xx = 0; let zz = 0; let xz = 0
    for (const [x, z] of pts) { xx += (x - mx) ** 2; zz += (z - mz) ** 2; xz += (x - mx) * (z - mz) }
    // angle of the main horizontal direction (from +X towards +Z)
    const ang = 0.5 * Math.atan2(2 * xz, xx - zz)
    const l1 = (xx + zz) / 2 + Math.sqrt(((xx - zz) / 2) ** 2 + xz * xz); const l2 = (xx + zz) / 2 - Math.sqrt(((xx - zz) / 2) ** 2 + xz * xz)
    if (l1 < l2 * 1.15) { // nearly round from above: fall back to the box
      const s = this.box().getSize(new THREE.Vector3()); if (s.x > s.z * 1.05) this.bake_rotation(Math.PI / 2)
      return
    }
    // rotate about Y so that direction (cos ang, sin ang) lands on +Z; snap tiny angles away
    let r = Math.PI / 2 + ang
    const snap = Math.round(r / (Math.PI / 2)) * (Math.PI / 2)
    if (Math.abs(r - snap) < 2 * Math.PI / 180) r = snap
    if (Math.abs(r) > 1e-6) this.bake_rotation(r)
  }

  /** parts whose name says door / hood / trunk become doors straight away (common in game car models) */
  private doors_from_names (): void {
    const RE = /door|hood|bonnet|trunk|boot|hatch|tailgate|lid|gull|canopy/i
    let found = 0
    this.parts.forEach(p => {
      if (!RE.test(p.mesh.name)) return
      if (Array.from(p.owner).some(o => o >= 0 && o < DOOR0)) return // it already holds a wheel
      const j = this.mechs.length
      this.mechs.push({ kind: 'door', name: '', hinge: 'auto', flip: false, angle: /hood|bonnet|trunk|boot|hatch|tailgate|lid/i.test(p.mesh.name) ? 60 : 70 })
      p.owner.fill(DOOR0 + j); found++
    })
    if (found > 0) {
      this.name_parts(); this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
      this.status(M(`Found ${found} door/hood part(s) by name. Pick one to check its hinge.`, `Tìm thấy ${found} cửa/nắp theo tên. Chọn từng cái để kiểm tra bản lề.`, `이름으로 문/후드 ${found}개를 찾았습니다. 하나씩 선택해 경첩을 확인하세요.`))
    }
  }

  private box (): THREE.Box3 { const b = new THREE.Box3(); this.parts.forEach(p => b.expandByObject(p.mesh)); return b }

  private bake_rotation (angle: number): void {
    const m = new THREE.Matrix4().makeRotationY(angle)
    this.parts.forEach(p => { p.mesh.geometry.applyMatrix4(m) })
    this.wheels.forEach(w => { w.center.applyMatrix4(m); w.axle?.applyMatrix4(m) })
  }

  private recenter (): void {
    const b = this.box(); const c = b.getCenter(new THREE.Vector3())
    const t = new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z)
    this.parts.forEach(p => { p.mesh.geometry.applyMatrix4(t); p.mesh.geometry.computeBoundingBox(); p.mesh.geometry.computeBoundingSphere() })
    this.wheels.forEach(w => w.center.applyMatrix4(t))
    this.size = this.box().getSize(new THREE.Vector3())
    this.draw_arrow()
  }

  private rotate_model (angle: number): void {
    this.clear_rig()
    this.bake_rotation(angle); this.recenter()
    this.wheels.forEach(w => { w.front = w.center.z > 0.1 * this.size.z })
    this.name_parts(); this.refresh_colors(); this.draw_markers(); this.refresh_part_select()
  }

  private draw_arrow (): void {
    if (this.front_arrow !== null) this.scene.remove(this.front_arrow)
    const L = Math.max(this.size.z, 0.01)
    this.front_arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, this.size.y + L * 0.08, L * 0.15), L * 0.45, 0x3cdc8c, L * 0.12, L * 0.07)
    this.scene.add(this.front_arrow)
  }

  private frame (): void {
    const b = this.box(); const c = b.getCenter(new THREE.Vector3()); const r = b.getSize(new THREE.Vector3()).length() * 0.5
    const d = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2) * 1.05
    this.controls.target.copy(c)
    this.camera.position.copy(c).add(new THREE.Vector3(0.9, 0.55, 0.9).normalize().multiplyScalar(d))
    this.camera.near = d / 500; this.camera.far = d * 50; this.camera.updateProjectionMatrix(); this.controls.update()
  }

  /* ------------------------------------------------ wheels ------------------------------------------------ */
  /** connected pieces of each mesh (shared positions count as connected) */
  private components (p: Part): Int32Array {
    const pos = p.mesh.geometry.getAttribute('position'); const n = pos.count
    const key = new Map<string, number>(); const rep = new Int32Array(n)
    const q = Math.max(this.size.x, this.size.y, this.size.z) * 1e-5
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos.getX(i) / q)},${Math.round(pos.getY(i) / q)},${Math.round(pos.getZ(i) / q)}`
      const r = key.get(k); if (r === undefined) { key.set(k, i); rep[i] = i } else rep[i] = r
    }
    const parent = new Int32Array(n); for (let i = 0; i < n; i++) parent[i] = rep[i]
    const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
    const unite = (a: number, b: number): void => { a = find(a); b = find(b); if (a !== b) parent[a] = b }
    const idx = p.mesh.geometry.getIndex()
    const tri = idx !== null ? idx.count : n
    for (let t = 0; t + 2 < tri; t += 3) {
      const a = idx !== null ? idx.getX(t) : t; const b = idx !== null ? idx.getX(t + 1) : t + 1; const c = idx !== null ? idx.getX(t + 2) : t + 2
      unite(rep[a], rep[b]); unite(rep[b], rep[c])
    }
    const out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = find(rep[i])
    return out
  }

  public scan_wheels (): void {
    this.clear_rig()
    // wheels are re-found; doors the user marked stay
    this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) if (p.owner[i] < DOOR0) p.owner[i] = -1 })
    const S = this.size; const H = S.y; const W = S.x
    interface Cand { part: number, comp: number, box: THREE.Box3 }
    const cands: Cand[] = []
    const comps: Int32Array[] = []
    this.parts.forEach((p, pi) => {
      const comp = this.components(p); comps.push(comp)
      const boxes = new Map<number, THREE.Box3>()
      const pos = p.mesh.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        let b = boxes.get(comp[i]); if (b === undefined) { b = new THREE.Box3(); boxes.set(comp[i], b) }
        b.expandByPoint(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)))
      }
      boxes.forEach((b, c) => {
        const s = b.getSize(new THREE.Vector3())
        const low = b.min.y < H * 0.12
        const big = s.y > H * 0.12 && s.y < H * 0.85
        const cc = b.getCenter(new THREE.Vector3())
        // normal: axle along X. A vehicle that lies sideways has its axles along Z: accept those too,
        // finish_wheels() then turns the whole vehicle round.
        const roundX = s.y > 0 && s.z / s.y > 0.7 && s.z / s.y < 1.4 && s.x < s.y * 0.9 && Math.abs(cc.x) > W * 0.15
        const roundZ = s.y > 0 && s.x / s.y > 0.7 && s.x / s.y < 1.4 && s.z < s.y * 0.9 && Math.abs(cc.z) > S.z * 0.15
        const round = s.y > 0 && s.z / s.y > 0.7 && s.z / s.y < 1.4
        // a road-roller drum: round, low, as wide as the machine and in the middle
        const drum = round && low && big && Math.abs(cc.x) <= W * 0.15 && s.x >= s.y * 0.9 && s.x > W * 0.5
        if ((low && big && (roundX || roundZ)) || drum) cands.push({ part: pi, comp: c, box: b })
      })
    })
    // merge tyre + rim + hub pieces that share a centre
    const groups: Array<{ items: Cand[], box: THREE.Box3 }> = []
    for (const c of cands) {
      const cc = c.box.getCenter(new THREE.Vector3())
      const g = groups.find(gr => gr.box.getCenter(new THREE.Vector3()).distanceTo(cc) < gr.box.getSize(new THREE.Vector3()).y * 0.35)
      if (g !== undefined) { g.items.push(c); g.box.union(c.box) } else groups.push({ items: [c], box: c.box.clone() })
    }
    // a full separate body would also look "round" for tiny toys; ignore groups that are as big as the car
    const wheels = groups.filter(g => g.box.getSize(new THREE.Vector3()).z < S.z * 0.6)
    if (wheels.length >= 2) {
      this.wheels = wheels.map(g => {
        const s = g.box.getSize(new THREE.Vector3())
        return { name: '', center: g.box.getCenter(new THREE.Vector3()), radius: Math.max(s.y, s.z) / 2, front: false, guessed: false }
      })
      wheels.forEach((g, k) => g.items.forEach(c => {
        const comp = comps[c.part]; const own = this.parts[c.part].owner
        for (let i = 0; i < comp.length; i++) if (comp[i] === c.comp && own[i] < DOOR0) own[i] = k
      }))
      this.finish_wheels(M(`Found ${wheels.length} separate wheels. They will spin cleanly.`, `Tìm thấy ${wheels.length} bánh rời. Bánh sẽ quay sạch, không kéo thân xe.`, `분리된 바퀴 ${wheels.length}개 발견. 깔끔하게 회전합니다.`))
      return
    }
    // welded mesh: best guess at the four corners, using the outer side of the car
    const r = Math.min(H * 0.42, S.z * 0.16)
    const zf = S.z / 2 - r * 1.35
    const xs = W / 2 - Math.min(W * 0.14, r * 0.45)
    this.wheels = []
    for (const z of [zf, -zf]) for (const x of [xs, -xs]) this.wheels.push({ name: '', center: new THREE.Vector3(x, r, z), radius: r, front: false, guessed: true })
    this.parts.forEach(p => {
      const pos = p.mesh.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i)
        this.wheels.forEach((w, k) => {
          const dyz = Math.hypot(y - w.center.y, z - w.center.z)
          if (p.owner[i] < DOOR0 && dyz < w.radius * 1.02 && Math.sign(x) === Math.sign(w.center.x) && Math.abs(x) > W / 2 - Math.min(W * 0.3, r * 0.9)) p.owner[i] = k
        })
      }
    })
    // refine twice: re-centre each guessed wheel on what it actually caught, then catch again
    for (let pass = 0; pass < 2; pass++) {
      this.wheels.forEach((w, k) => {
        const b = new THREE.Box3()
        this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (p.owner[i] === k) b.expandByPoint(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))) })
        if (b.isEmpty()) return
        const s2 = b.getSize(new THREE.Vector3()); const c2 = b.getCenter(new THREE.Vector3())
        w.radius = Math.min(w.radius, Math.max(s2.y, s2.z) / 2); w.center.set(c2.x, Math.max(w.radius, c2.y), c2.z)
      })
      this.parts.forEach(p => {
        const pos = p.mesh.geometry.getAttribute('position')
        for (let i = 0; i < pos.count; i++) if (p.owner[i] < DOOR0) p.owner[i] = -1
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i)
          if (p.owner[i] >= DOOR0) continue
          this.wheels.forEach((w, k) => {
            if (Math.hypot(y - w.center.y, z - w.center.z) < w.radius * 1.03 && Math.sign(x) === Math.sign(w.center.x) && Math.abs(x) > W / 2 - Math.min(W * 0.3, w.radius * 0.9)) p.owner[i] = k
          })
        }
      })
    }
    this.finish_wheels(M('Wheels are welded to the body: their position is a GUESS. Paint with + / − to fix each wheel (yellow = torn seam).', 'Bánh dính liền thân xe: vị trí bánh là ĐOÁN. Dùng ＋ / － tô lại từng bánh (vàng = chỗ sẽ bị rách).', '바퀴가 차체와 붙어 있어 위치는 추정값입니다. ＋ / －로 각 바퀴를 칠해 고치세요 (노랑 = 찢어질 이음새).'), true)
  }

  private auto_turned = false
  private finish_wheels (msg: string, warn = false): void {
    this.wheels.forEach((w, k) => { w.axle = this.wheel_axle(k) })
    // the wheels' own axles say which way the vehicle really points: axles along Z = the car lies sideways
    const real = this.wheels.filter(w => !w.guessed && w.axle !== undefined)
    if (!this.auto_turned && real.length >= 2) {
      const ax = real.reduce((a, w) => a + Math.abs(w.axle!.x), 0); const az = real.reduce((a, w) => a + Math.abs(w.axle!.z), 0)
      if (az > ax * 1.3) {
        this.auto_turned = true
        this.rotate_model(Math.PI / 2)
        this.scan_wheels()
        this.auto_turned = false
        return
      }
    }
    this.wheels.forEach(w => { w.front = w.center.z > 0.05 * this.size.z })
    this.name_parts()
    this.active = this.wheels.length > 0 ? 0 : -1
    this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
    const seams = this.seam_report()
    this.status(msg + (seams !== '' ? ' ' + seams : ''), warn || seams !== '')
    // show it straight away: the wheels roll for a moment so you can see the scan worked
    if (this.wheels.length > 0 && !warn) this.preview_spin()
  }

  /** build the rig and roll slowly forward (any edit clears it again) */
  private preview_spin (): void {
    if (this.parts.length === 0 || this.wheels.length === 0) return
    const keep = $('vh-status').textContent ?? ''
    this.build_rig()
    const i = this.clips.findIndex(c => /^03_Drive_Slow/.test(c.name))
    if (i >= 0) this.play(i)
    $('vh-status').textContent = keep + ' ' + M('▶ Wheels rolling as a preview.', '▶ Bánh đang lăn thử để xem.', '▶ 미리보기로 바퀴가 굴러갑니다.')
  }

  /**
   * a wheel's spin axis = the direction its vertices spread least (a tyre is a flat disc). Works whatever way the
   * file was turned. Pointed to +X (the vehicle's left) so "forward" spins the same way for every wheel.
   */
  private wheel_axle (k: number): THREE.Vector3 | undefined {
    const P: THREE.Vector3[] = []
    this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (p.owner[i] === k) P.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))) })
    if (P.length < 12) return undefined
    const c = new THREE.Vector3(); P.forEach(v => c.add(v)); c.multiplyScalar(1 / P.length)
    const C = [0, 0, 0, 0, 0, 0] // xx xy xz yy yz zz
    P.forEach(v => { const x = v.x - c.x; const y = v.y - c.y; const z = v.z - c.z; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z })
    // a wheel is round around its axle: of the 3 main directions of the point cloud, the axle is the one whose
    // two other directions spread the same (works for thin tyres and for wide road-roller drums alike)
    const { vals, vecs } = eigen3([[C[0], C[1], C[2]], [C[1], C[3], C[4]], [C[2], C[4], C[5]]])
    let best = 0; let bd = Infinity
    for (let i = 0; i < 3; i++) {
      const o = [0, 1, 2].filter(j => j !== i).map(j => vals[j])
      const d = Math.abs(o[0] - o[1]) / Math.max(1e-12, o[0] + o[1])
      if (d < bd) { bd = d; best = i }
    }
    const v = vecs[best].clone()
    if (Math.abs(v.y) > 0.7) return undefined // flat lying thing, not a wheel on its edge: keep the default
    if (v.x < 0 || (Math.abs(v.x) < 1e-3 && v.z < 0)) v.negate()
    return v
  }

  private name_parts (): void {
    this.name_wheels()
    const S = this.size
    this.mechs.forEach((d, j) => {
      const b = this.part_box(DOOR0 + j)
      if (d.kind !== 'door') { d.name = d.kind; return }
      if (b.isEmpty()) { d.name = `door_${j + 1}`; return }
      const c = b.getCenter(new THREE.Vector3())
      const mid = Math.abs(c.x) < S.x * 0.18
      if (mid) d.name = c.z > 0 ? 'hood' : 'trunk'
      else d.name = `door_${c.z > S.z * 0.12 ? 'F' : c.z < -S.z * 0.12 ? 'R' : ''}${c.x >= 0 ? 'L' : 'R'}`
    })
    const seen = new Map<string, number>()
    this.mechs.forEach(d => { const n = (seen.get(d.name) ?? 0) + 1; seen.set(d.name, n); if (n > 1) d.name += String(n) })
  }

  /** bounding box of every vertex owned by one part (owner code) */
  private part_box (code: number): THREE.Box3 {
    const b = new THREE.Box3(); const v = new THREE.Vector3()
    this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (p.owner[i] === code) b.expandByPoint(v.set(pos.getX(i), pos.getY(i), pos.getZ(i))) })
    return b
  }

  private name_wheels (): void {
    const S = this.size
    this.wheels.forEach((w) => {
      const fb = w.center.z > 0.05 * S.z ? 'F' : w.center.z < -0.05 * S.z ? 'R' : 'M'
      // a centred, full-width roller is a drum, not a left/right wheel
      if (Math.abs(w.center.x) < S.x * 0.15) { w.name = `drum_${fb}`; return }
      const lr = w.center.x >= 0 ? 'L' : 'R'
      w.name = `wheel_${fb}${lr}`
    })
    const seen = new Map<string, number>()
    this.wheels.forEach(w => { const n = (seen.get(w.name) ?? 0) + 1; seen.set(w.name, n); if (n > 1) w.name += String(n) })
  }

  /** triangles that mix a wheel and the body tear when the wheel spins */
  private seam_count (): Map<number, number> {
    const per = new Map<number, number>()
    this.parts.forEach(p => {
      const idx = p.mesh.geometry.getIndex(); const n = idx !== null ? idx.count : p.owner.length
      for (let t = 0; t + 2 < n; t += 3) {
        const a = p.owner[idx !== null ? idx.getX(t) : t]; const b = p.owner[idx !== null ? idx.getX(t + 1) : t + 1]; const c = p.owner[idx !== null ? idx.getX(t + 2) : t + 2]
        if (a === b && b === c) continue
        for (const o of new Set([a, b, c])) if (o >= 0) per.set(o, (per.get(o) ?? 0) + 1)
      }
    })
    return per
  }

  private part_name (code: number): string {
    return code >= DOOR0 ? (this.mechs[code - DOOR0]?.name ?? '?') : (this.wheels[code]?.name ?? '?')
  }

  private seam_report (): string {
    const s = this.seam_count()
    const bad: Array<{ name: string }> = []
    s.forEach((n, code) => { if (n > 40) bad.push({ name: this.part_name(code) }) })
    if (bad.length === 0) return ''
    return M(`Torn seams on ${bad.map(w => w.name).join(', ')}: paint − on the yellow ring (fender/body) or + on the tyre until yellow is minimal.`, `Chỗ rách ở ${bad.map(w => w.name).join(', ')}: tô － lên viền vàng (vè/thân) hoặc ＋ lên lốp cho tới khi còn ít vàng nhất.`, `${bad.map(w => w.name).join(', ')} 이음새 찢어짐: 노란 테두리(펜더/차체)에 － 또는 타이어에 ＋를 칠해 노랑을 최소화하세요.`)
  }

  private refresh_part_select (): void {
    const sel = $('vh-wheel-select') as HTMLSelectElement
    sel.innerHTML = this.wheels.map((w, k) => `<option value="${k}">🛞 ${w.name}${w.guessed ? M(' (guess)', ' (đoán)', ' (추정)') : ''}</option>`).join('') +
      this.mechs.map((d, j) => `<option value="${DOOR0 + j}">${MECH_ICON[d.kind]} ${d.name}</option>`).join('')
    if (this.part_name(this.active) === '?') this.active = this.wheels.length > 0 ? 0 : this.mechs.length > 0 ? DOOR0 : -1
    sel.value = String(this.active)
    $('vh-wheel-count').textContent = String(this.wheels.length)
    $('vh-door-count').textContent = String(this.mechs.length)
    const door = this.mechs[this.active - DOOR0]
    $('vh-door-box').style.display = door !== undefined ? 'flex' : 'none'
    if (door !== undefined) {
      $('vh-hinge-row').style.display = door.kind === 'door' ? '' : 'none'
      $('vh-axis-row').style.display = door.kind === 'spin' || door.kind === 'slide' ? '' : 'none'
      ;($('vh-axis') as HTMLSelectElement).value = door.axis ?? 'auto'
      ;($('vh-part-flip') as HTMLInputElement).checked = door.flip
      ;($('vh-hinge') as HTMLSelectElement).value = door.hinge
      ;($('vh-door-angle') as HTMLInputElement).value = String(door.angle)
      $('vh-door-angle-val').textContent = this.amount_label(door)
    }
    this.draw_hinge()
  }

  /** choose a wheel or door (from the list, a click on the model, or after creating it) */
  private select (code: number): void {
    this.active = code
    this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
  }

  private color_of (code: number): number {
    return code >= DOOR0 ? DOOR_COLORS[(code - DOOR0) % DOOR_COLORS.length] : WHEEL_COLORS[code % WHEEL_COLORS.length]
  }

  private refresh_colors (): void {
    this.parts.forEach(p => {
      const g = p.mesh.geometry; const n = p.owner.length
      if (!this.show_regions) { p.mesh.material = this.original_materials.get(p.mesh) ?? p.mesh.material; return }
      // seam vertices in yellow
      const seam = new Uint8Array(n)
      const idx = g.getIndex(); const cnt = idx !== null ? idx.count : n
      for (let t = 0; t + 2 < cnt; t += 3) {
        const ia = idx !== null ? idx.getX(t) : t; const ib = idx !== null ? idx.getX(t + 1) : t + 1; const ic = idx !== null ? idx.getX(t + 2) : t + 2
        if (p.owner[ia] !== p.owner[ib] || p.owner[ib] !== p.owner[ic]) { seam[ia] = seam[ib] = seam[ic] = 1 }
      }
      const col = new Float32Array(n * 3); const c = new THREE.Color()
      for (let i = 0; i < n; i++) {
        const o = p.owner[i]
        if (seam[i] === 1 && o >= 0) c.set(0xffe14d)
        else if (o >= 0) { c.set(this.color_of(o)); if (o !== this.active) c.lerp(new THREE.Color(0x9a9a9a), 0.35) }
        else c.set(0x9a9a9a)
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      p.mesh.material = this.region_material
    })
  }

  private draw_markers (): void {
    this.markers.clear()
    this.wheels.forEach((w, k) => {
      const on = k === this.active
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w.radius * 1.08, w.radius * (on ? 0.07 : 0.04), 8, 40), new THREE.MeshBasicMaterial({ color: WHEEL_COLORS[k % WHEEL_COLORS.length], depthTest: false, transparent: true, opacity: on ? 1 : 0.6 }))
      // the ring lies in the wheel's own plane (around its axle), pushed a little outwards
      const ax = w.axle ?? new THREE.Vector3(1, 0, 0)
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax)
      ring.position.copy(w.center).addScaledVector(ax, Math.sign(w.center.dot(ax) || 1) * this.size.x * 0.02)
      ring.renderOrder = 10
      this.markers.add(ring)
    })
  }

  private set_brush (m: Tool): void {
    this.brush_mode = m
    TOOL_BUTTONS.forEach(([t, id]) => { document.getElementById(id)?.classList.toggle('on', m === t) })
    this.poly = []; this.lassoing = false; this.draw_poly()
    this.renderer.domElement.style.cursor = m === null ? '' : 'crosshair'
    if (m !== null && !this.show_regions) { this.show_regions = true; ($('vh-regions') as HTMLInputElement).checked = true; this.refresh_colors() }
    if (m === null) this.hide_box()
  }

  private ndc (e: { clientX: number, clientY: number }): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private paint (e: PointerEvent): void {
    if (this.active < 0 && this.brush_mode === 'add') return
    const ray = new THREE.Raycaster()
    ray.setFromCamera(this.ndc(e), this.camera)
    const hit = ray.intersectObjects(this.parts.map(p => p.mesh), false)[0]
    if (hit === undefined) return
    const rad = Math.max(this.size.x, this.size.y, this.size.z) * this.brush_radius_pct / 100
    const val = this.brush_mode === 'add' ? this.active : -1
    this.parts.forEach(p => {
      const pos = p.mesh.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - hit.point.x; const dy = pos.getY(i) - hit.point.y; const dz = pos.getZ(i) - hit.point.z
        if (dx * dx + dy * dy + dz * dz < rad * rad) {
          if (this.brush_mode === 'remove' && p.owner[i] !== this.active) continue // − only removes from the chosen part
          p.owner[i] = val
        }
      }
    })
    this.refresh_colors()
  }

  /* ---- box select: drag a rectangle; only the surface you can SEE (plus the part's thickness) is taken ---- */
  private box_el (): HTMLElement {
    let el = document.getElementById('vh-box-rect')
    if (el === null) {
      el = document.createElement('div'); el.id = 'vh-box-rect'
      el.style.cssText = 'position:absolute;border:1.5px dashed #f5a623;background:rgba(245,166,35,.12);pointer-events:none;display:none;z-index:5'
      $('vh-view').appendChild(el)
    }
    return el
  }

  private hide_box (): void { this.box_el().style.display = 'none'; this.box_start = null }

  private draw_box (e: PointerEvent): void {
    if (this.box_start === null) return
    const v = $('vh-view').getBoundingClientRect(); const el = this.box_el()
    const x0 = Math.min(this.box_start.x, e.clientX) - v.left; const y0 = Math.min(this.box_start.y, e.clientY) - v.top
    el.style.left = `${x0}px`; el.style.top = `${y0}px`
    el.style.width = `${Math.abs(e.clientX - this.box_start.x)}px`; el.style.height = `${Math.abs(e.clientY - this.box_start.y)}px`
    el.style.display = 'block'
    el.style.borderColor = this.brush_mode === 'box_remove' ? '#ef5350' : '#f5a623'
  }

  private finish_box (e: PointerEvent): void {
    const st = this.box_start!; this.hide_box()
    if (Math.abs(e.clientX - st.x) < 4 || Math.abs(e.clientY - st.y) < 4) return
    const x0 = Math.min(st.x, e.clientX); const x1 = Math.max(st.x, e.clientX); const y0 = Math.min(st.y, e.clientY); const y1 = Math.max(st.y, e.clientY)
    this.select_screen(this.brush_mode === 'box_add', [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }])
  }

  /* ---- lasso (drag a free shape) and pen (click corners, click the first point / double-click / Enter to close) ---- */
  private poly_svg (): SVGSVGElement {
    let el = document.getElementById('vh-poly') as unknown as SVGSVGElement | null
    if (el === null) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.id = 'vh-poly'
      el.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5')
      $('vh-view').appendChild(el)
    }
    return el
  }

  private draw_poly (hover?: { x: number, y: number }): void {
    const svg = this.poly_svg()
    if (this.poly.length === 0) { svg.innerHTML = ''; return }
    const v = $('vh-view').getBoundingClientRect()
    const pts = [...this.poly, ...(hover !== undefined ? [hover] : [])].map(p => `${p.x - v.left},${p.y - v.top}`).join(' ')
    const red = this.brush_mode === 'lasso_remove' || this.brush_mode === 'pen_remove'
    const col = red ? '#ef5350' : '#f5a623'
    svg.innerHTML = `<polygon points="${pts}" fill="${red ? 'rgba(239,83,80,.12)' : 'rgba(245,166,35,.12)'}" stroke="${col}" stroke-width="1.5" stroke-dasharray="5 3"/>` +
      (this.brush_mode?.startsWith('pen') === true ? this.poly.map((p, i) => `<circle cx="${p.x - v.left}" cy="${p.y - v.top}" r="${i === 0 ? 6 : 3.5}" fill="${i === 0 ? col : '#fff'}" stroke="${col}"/>`).join('') : '') 
  }

  private finish_poly (): void {
    const pts = this.poly; this.poly = []; this.draw_poly()
    if (pts.length < 3) return
    this.select_screen(this.brush_mode === 'lasso_add' || this.brush_mode === 'pen_add', pts)
  }

  /**
   * add / remove every vertex whose screen position is inside the polygon (client px). Only the surface you can
   * SEE is taken (plus the part's thickness), unless "select through" is on.
   */
  private select_screen (add: boolean, poly: Array<{ x: number, y: number }>): void {
    if (add && this.active < 0) { this.status(M('Pick or create a wheel / part first.', 'Chọn hoặc tạo bánh / bộ phận trước đã.', '먼저 바퀴/부품을 선택하거나 만드세요.'), true); return }
    const P = poly.map(p => this.ndc({ clientX: p.x, clientY: p.y }))
    const a = new THREE.Vector2(Math.min(...P.map(p => p.x)), Math.min(...P.map(p => p.y)))
    const b = new THREE.Vector2(Math.max(...P.map(p => p.x)), Math.max(...P.map(p => p.y)))
    const inside = (x: number, y: number): boolean => {
      let c = false
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if (((P[i].y > y) !== (P[j].y > y)) && (x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x)) c = !c
      }
      return c
    }
    // depth of the visible surface inside the shape, on a coarse grid of rays
    const G = 24; const depth = new Float32Array(G * G).fill(Infinity)
    const ray = new THREE.Raycaster(); const meshes = this.parts.map(p => p.mesh)
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        ray.setFromCamera(new THREE.Vector2(a.x + (b.x - a.x) * (gx + 0.5) / G, a.y + (b.y - a.y) * (gy + 0.5) / G), this.camera)
        const h = ray.intersectObjects(meshes, false)[0]
        if (h !== undefined) depth[gy * G + gx] = h.distance
      }
    }
    // a cell with no hit borrows its neighbours' depth (thin rims, gaps between spokes)
    const near = (gx: number, gy: number): number => {
      let m = Infinity
      for (let r = 0; r <= 2 && !Number.isFinite(m); r++) {
        for (let yy = Math.max(0, gy - r); yy <= Math.min(G - 1, gy + r); yy++) for (let xx = Math.max(0, gx - r); xx <= Math.min(G - 1, gx + r); xx++) m = Math.min(m, depth[yy * G + xx])
      }
      return m
    }
    const through = ($('vh-box-through') as HTMLInputElement).checked
    const tol = Math.max(this.size.x, this.size.z) * 0.12
    const v = new THREE.Vector3(); const cam = this.camera.position
    let changed = 0
    this.parts.forEach(p => {
      const pos = p.mesh.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
        const d = v.distanceTo(cam)
        v.project(this.camera)
        if (v.z > 1 || v.x < a.x || v.x > b.x || v.y < a.y || v.y > b.y || !inside(v.x, v.y)) continue
        if (!through) {
          const gx = Math.min(G - 1, Math.floor((v.x - a.x) / Math.max(1e-9, b.x - a.x) * G)); const gy = Math.min(G - 1, Math.floor((v.y - a.y) / Math.max(1e-9, b.y - a.y) * G))
          if (d > near(gx, gy) + tol) continue // hidden behind the visible surface (the far side of the car)
        }
        if (add) { if (p.owner[i] !== this.active) { p.owner[i] = this.active; changed++ } } else if (p.owner[i] === this.active || (this.active < 0 && p.owner[i] >= 0)) { p.owner[i] = -1; changed++ }
      }
    })
    this.refresh_colors(); this.after_paint()
    if (changed === 0) this.status(M('Nothing changed in that area.', 'Vùng vừa chọn không đổi gì.', '그 영역에서 바뀐 것이 없습니다.'))
  }

  /* ---- piece: one click takes / gives back a whole separate piece of the model (a hubcap, a mirror, a rotor blade) ---- */
  private comp_cache = new Map<Part, Int32Array>()
  private click_piece (e: PointerEvent): void {
    if (this.rig !== null) this.clear_rig()
    const add = this.brush_mode === 'piece_add'
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const h = ray.intersectObjects(this.parts.map(p => p.mesh), false)[0]
    if (h === undefined || h.face == null) return
    const p = this.parts.find(x => x.mesh === h.object); if (p === undefined) return
    let comp = this.comp_cache.get(p); if (comp === undefined) { comp = this.components(p); this.comp_cache.set(p, comp) }
    const id = comp[h.face.a]
    // removing: the piece goes back to whatever part owns it (or to the body)
    const owner_here = p.owner[h.face.a]
    if (add && this.active < 0) { this.status(M('Pick or create a wheel / part first.', 'Chọn hoặc tạo bánh / bộ phận trước đã.', '먼저 바퀴/부품을 선택하거나 만드세요.'), true); return }
    let n = 0
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] !== id) continue
      if (add) { if (p.owner[i] !== this.active) { p.owner[i] = this.active; n++ } } else if (p.owner[i] >= 0) { p.owner[i] = -1; n++ }
    }
    const total = comp.reduce((acc, c) => acc + (c === id ? 1 : 0), 0)
    if (total > p.owner.length * 0.6) this.status(M('That piece is most of the model (it is welded in one piece): use box, lasso or pen instead.', 'Mảnh này gần như là cả model (dính liền một khối): dùng khung, lasso hoặc pen thay thế.', '이 조각은 모델 대부분입니다 (한 덩어리): 박스, 올가미, 펜을 쓰세요.'), true)
    if (!add && owner_here >= 0) this.active = owner_here
    this.refresh_colors(); this.after_paint()
    if (n === 0) this.status(M('Nothing changed: that piece already belongs there.', 'Không đổi: mảnh đó đã thuộc phần này rồi.', '변화 없음: 이미 그 부분에 속해 있습니다.'))
  }

  /** click (no drag) on the model selects the wheel / door under the cursor */
  private pick (e: PointerEvent): void {
    if (this.brush_mode !== null) return
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const hits = ray.intersectObjects(this.rig !== null ? this.rig.skinned : this.parts.map(p => p.mesh), false)
    const h = hits[0]; if (h === undefined || h.face == null) return
    const pi = this.rig !== null ? this.rig.skinned.indexOf(h.object as THREE.SkinnedMesh) : this.parts.findIndex(p => p.mesh === h.object)
    const p = this.parts[pi]; if (p === undefined) return
    const o = [h.face.a, h.face.b, h.face.c].map(i => p.owner[i]).find(x => x >= 0) ?? -1
    if (o < 0) { this.status(M('That is the body. Click a coloured wheel or door to select it.', 'Đó là thân xe. Bấm vào bánh hoặc cửa có màu để chọn.', '차체입니다. 색칠된 바퀴나 문을 클릭하세요.')); return }
    this.select(o)
    this.status(M(`Selected ${this.part_name(o)}. Delete key removes it.`, `Đã chọn ${this.part_name(o)}. Bấm phím Delete để xoá.`, `${this.part_name(o)} 선택됨. Delete 키로 삭제합니다.`))
  }

  /** after painting: the wheel's pivot follows the painted area; doors re-check their hinge */
  private after_paint (): void {
    this.clear_rig()
    const k = this.active; const w = this.wheels[k]
    if (k >= 0 && k < DOOR0 && w !== undefined) {
      const b = this.part_box(k)
      if (!b.isEmpty()) { const s = b.getSize(new THREE.Vector3()); w.center.copy(b.getCenter(new THREE.Vector3())); w.radius = Math.max(s.y, s.z) / 2; w.guessed = false; w.axle = this.wheel_axle(k) }
    }
    this.wheels.forEach(x => { x.front = x.center.z > 0.05 * this.size.z })
    this.name_parts(); this.refresh_part_select(); this.draw_markers()
    const seams = this.seam_report(); this.status(seams === '' ? M('Areas look clean.', 'Các vùng đã sạch.', '영역이 깔끔합니다.') : seams, seams !== '')
  }

  private new_wheel (): void {
    this.wheels.push({ name: 'wheel_new', center: new THREE.Vector3(0, this.size.y * 0.2, 0), radius: this.size.y * 0.2, front: false, guessed: true })
    // wheel codes are 0..n-1: nothing to shift because doors live at DOOR0+
    this.active = this.wheels.length - 1
    this.name_parts(); this.refresh_part_select(); this.set_brush('box_add')
    this.status(M('New wheel: drag a box around it (or paint with +). The pivot follows what you select.', 'Bánh mới: kéo khung quanh bánh (hoặc tô ＋). Tâm xoay tự theo vùng chọn.', '새 바퀴: 바퀴 주위로 박스를 드래그하세요 (또는 ＋로 칠하기). 회전 중심은 선택 영역을 따라갑니다.'))
  }

  private new_mech (kind: MechKind, extra: Partial<Mech> = {}): void {
    this.mechs.push({ kind, name: kind, hinge: 'auto', angle: default_angle(kind), flip: false, axis: 'auto', ...extra })
    this.active = DOOR0 + this.mechs.length - 1
    this.name_parts(); this.refresh_part_select(); this.set_brush('box_add')
    this.status(M(`New ${kind}: drag a box over it (side view is easiest), then check the orange pivot bar.`, `Phần mới (${kind}): kéo khung lên nó (nhìn ngang dễ nhất), rồi kiểm tra thanh trục màu cam.`, `새 부품 (${kind}): 박스로 감싸세요 (옆에서 보면 쉬움). 그다음 주황색 축을 확인하세요.`))
  }

  private amount_label (d: Mech): string {
    if (d.kind === 'spin') return M(`${(d.angle / 100).toFixed(2)} turns / s`, `${(d.angle / 100).toFixed(2)} vòng / giây`, `초당 ${(d.angle / 100).toFixed(2)}회전`)
    if (d.kind === 'slide') return M(`${d.angle}% of its length`, `${d.angle}% chiều dài`, `길이의 ${d.angle}%`)
    if (d.kind === 'hook' || d.kind === 'cable') return M(`${d.angle}% of the height`, `${d.angle}% chiều cao`, `높이의 ${d.angle}%`)
    return `${d.angle}°`
  }

  /** remove the selected wheel or door (its area goes back to the body) */
  private delete_selected (): void {
    const k = this.active
    if (k < 0 || this.part_name(k) === '?') return
    const name = this.part_name(k)
    const isDoor = k >= DOOR0
    this.parts.forEach(p => {
      for (let i = 0; i < p.owner.length; i++) {
        const o = p.owner[i]
        if (o === k) p.owner[i] = -1
        else if (isDoor && o > k) p.owner[i]--
        else if (!isDoor && o > k && o < DOOR0) p.owner[i]--
      }
    })
    if (isDoor) this.mechs.splice(k - DOOR0, 1); else this.wheels.splice(k, 1)
    this.active = this.wheels.length > 0 ? 0 : this.mechs.length > 0 ? DOOR0 : -1
    this.clear_rig(); this.name_parts(); this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
    this.status(M(`Deleted ${name}.`, `Đã xoá ${name}.`, `${name} 삭제됨.`))
  }

  /* ------------------------------------------------ doors ------------------------------------------------ */
  /** pivot + motion of mechanical part j (doors, turret, barrel, blade, boom, hook, cable) */
  private door_pose (j: number): MechPose | null {
    const m = this.mechs[j]; if (m === undefined) return null
    let drop = 0
    if (m.kind === 'cable') {
      const h = this.mechs.findIndex(x => x.kind === 'hook')
      if (h >= 0) { const hp = mech_pose(this.mechs[h], this.part_box(DOOR0 + h), this.size); drop = hp !== null ? -hp.slide.y : 0 }
    }
    const pose = mech_pose(m, this.part_box(DOOR0 + j), this.size, drop)
    // a hook swings from where it hangs (top of its cable, or the underside of the boom), like a pendulum
    if (pose !== null && m.kind === 'hook') {
      const ci = this.mechs.findIndex(x => x.kind === 'cable')
      const bi = this.mechs.findIndex(x => x.kind === 'boom')
      if (ci >= 0) { const cb = this.part_box(DOOR0 + ci); if (!cb.isEmpty()) pose.pivot.set(pose.pivot.x, cb.max.y, pose.pivot.z) } else if (bi >= 0) { const bb = this.part_box(DOOR0 + bi); if (!bb.isEmpty()) pose.pivot.y = bb.min.y }
    }
    return pose
  }

  /** a short orange bar on the hinge line of the selected door */
  private draw_hinge (): void {
    this.hinge_marker.clear()
    const j = this.active - DOOR0; const pose = this.door_pose(j); if (pose === null) return
    const b = this.part_box(this.active); const s = b.getSize(new THREE.Vector3())
    const len = pose.axis.y !== 0 ? s.y : pose.axis.z !== 0 ? s.z : s.x
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.03 + 0.002, len * 0.03 + 0.002, len * 1.1, 10), new THREE.MeshBasicMaterial({ color: 0xf5a623, depthTest: false }))
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.axis); bar.position.copy(pose.pivot); bar.renderOrder = 12
    this.hinge_marker.add(bar)
    const lbl: Record<string, string> = { front: M('hinge: front edge', 'bản lề: mép trước', '경첩: 앞쪽'), back: M('hinge: back edge', 'bản lề: mép sau', '경첩: 뒤쪽'), top: M('hinge: top (gull-wing)', 'bản lề: mép trên (cánh chim)', '경첩: 위 (걸윙)'), scissor: M('scissor (opens up)', 'cắt kéo (mở lên)', '시저 (위로 열림)'), hood: M('hood', 'nắp capo', '후드'), trunk: M('trunk', 'cốp sau', '트렁크') }
    $('vh-hinge-used').textContent = lbl[pose.used] ?? pose.used
  }

  /** build (if needed) and play the selected door's open animation */
  private test_door (): void {
    const j = this.active - DOOR0; if (this.mechs[j] === undefined) return
    if (this.rig === null) this.build_rig()
    const m = this.mechs[j]
    const want = m.kind === 'door' ? [`D_${m.name}_Open`] : ({ turret: ['M_Turret_Scan'], barrel: ['M_Turn_Aim_Fire', 'M_Fire'], blade: ['M_Blade_Raise'], boom: ['M_Dig_Cycle', 'M_Boom_Raise', 'M_Crane_Cycle'], arm: ['M_Dig_Cycle', 'M_Arm_In'], bucket: ['M_Dig_Cycle', 'M_Bucket_Curl'], hook: ['M_Crane_Cycle', 'M_Hook_Lower'], cable: ['M_Hook_Lower'], spin: ['M_Spin'], slide: ['M_Slide_Pump'], wobble: ['M_Wobble_Hit'] } as Record<string, string[]>)[m.kind] ?? []
    const i = this.clips.findIndex(c => want.includes(c.name))
    if (i >= 0) this.play(i)
  }

  /* ------------------------------------------------ rig + animations ------------------------------------------------ */
  private clear_rig (): void {
    if (this.rig === null) return
    this.mixer?.stopAllAction(); this.mixer = null; this.current = null
    this.rig.skinned.forEach(m => this.holder.remove(m))
    this.holder.remove(this.rig.root)
    this.parts.forEach(p => { p.mesh.visible = true })
    this.rig = null
    $('vh-anims').innerHTML = ''
    $('vh-anim-box').classList.add('disabled')
  }

  public build_rig (): void {
    if (this.parts.length === 0) return
    this.clear_rig()
    const S = this.size
    const axleY = this.wheels.length > 0 ? this.wheels.reduce((a, w) => a + w.center.y, 0) / this.wheels.length : S.y * 0.25
    const root = new THREE.Bone(); root.name = 'root'
    const body = new THREE.Bone(); body.name = 'body'; body.position.set(0, axleY, 0); root.add(body)
    const wheels: THREE.Bone[] = []; const steers: Array<THREE.Bone | null> = []
    this.wheels.forEach(w => {
      const wb = new THREE.Bone(); wb.name = w.name
      if (w.front && this.vtype !== 'tracked') {
        const st = new THREE.Bone(); st.name = w.name.startsWith('wheel_') ? w.name.replace('wheel_', 'steer_') : `steer_${w.name}`; st.position.copy(w.center); root.add(st); st.add(wb)
        steers.push(st)
      } else { wb.position.copy(w.center); root.add(wb); steers.push(null) }
      wheels.push(wb)
    })
    // mechanical parts hang on the body (or on each other: barrel on turret, hook on boom) and turn on their pivot
    const mechs: Array<{ bone: THREE.Bone, pose: MechPose, kind: MechKind, rest: THREE.Vector3, parent: number }> = []; const door_bone: Array<THREE.Bone | null> = []
    const poses = this.mechs.map((_m, j) => this.door_pose(j))
    const boxes = this.mechs.map((_m, j) => this.part_box(DOOR0 + j))
    const parent_of = this.mechs.map((_m, j) => mech_parent(j, this.mechs, poses, boxes))
    const made = new Map<number, THREE.Bone>()
    const make_bone = (j: number, depth = 0): THREE.Bone | null => {
      if (made.has(j)) return made.get(j)!
      const pose = poses[j]; if (pose === null || depth > 8) return null
      const pj = parent_of[j]
      const parent = pj >= 0 ? make_bone(pj, depth + 1) : null
      const pb = parent ?? body
      const pivot_parent = parent !== null ? poses[pj]!.pivot : body.position
      const db = new THREE.Bone(); db.name = this.mechs[j].name; db.position.copy(pose.pivot).sub(pivot_parent); pb.add(db)
      made.set(j, db)
      // index (in `mechs`) of the parent part, so hooks can stay hanging straight down when the boom moves
      const parent_index = parent !== null ? mechs.findIndex(x => x.bone === parent) : -1
      mechs.push({ bone: db, pose, kind: this.mechs[j].kind, rest: db.position.clone(), parent: parent_index })
      return db
    }
    this.mechs.forEach((_m, j) => { door_bone.push(make_bone(j)) })
    this.holder.add(root); root.updateMatrixWorld(true)
    const bones: THREE.Bone[] = [root, body, ...steers.filter((s): s is THREE.Bone => s !== null), ...wheels, ...mechs.map(d => d.bone)]
    const skeleton = new THREE.Skeleton(bones)
    const bi = (b: THREE.Bone): number => bones.indexOf(b)
    const skinned: THREE.SkinnedMesh[] = []
    this.parts.forEach(p => {
      const g = p.mesh.geometry.clone(); g.deleteAttribute('color')
      const n = p.owner.length
      const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const o = p.owner[i]
        const b = o >= DOOR0 ? (door_bone[o - DOOR0] ?? body) : o >= 0 ? (wheels[o] ?? body) : body
        si[i * 4] = bi(b); sw[i * 4] = 1
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
      const m = new THREE.SkinnedMesh(g, this.original_materials.get(p.mesh) ?? p.mesh.material)
      m.name = p.mesh.name; m.frustumCulled = false
      m.bind(skeleton)
      this.holder.add(m); skinned.push(m)
      p.mesh.visible = false
    })
    this.rig = { root, body, wheels, steers, mechs, skinned }
    this.clips = this.make_clips()
    this.mixer = new THREE.AnimationMixer(this.holder)
    this.render_anim_list()
    $('vh-anim-box').classList.remove('disabled')
    this.play(0)
    const st = steers.filter(s => s !== null).length
    this.status(M(`Rig ready: body + ${wheels.length} wheels (${st} steering) + ${mechs.length} parts. ${this.clips.length} animations.`, `Đã gắn xương: thân + ${wheels.length} bánh (${st} bánh lái) + ${mechs.length} bộ phận. ${this.clips.length} animation.`, `리그 완료: 차체 + 바퀴 ${wheels.length}개 (조향 ${st}개) + 부품 ${mechs.length}개. 애니메이션 ${this.clips.length}개.`))
  }

  private render_anim_list (): void {
    $('vh-anims').innerHTML = this.clips.map((c, i) => `<button class="vh-anim" data-i="${i}">${c.name}</button>`).join('')
    $('vh-anims').querySelectorAll('.vh-anim').forEach(b => { (b as HTMLButtonElement).onclick = () => this.play(Number((b as HTMLElement).dataset.i)) })
  }

  private play (i: number): void {
    if (this.mixer === null) return
    this.current?.stop()
    this.current = this.mixer.clipAction(this.clips[i]); this.current.reset().play()
    $('vh-anims').querySelectorAll('.vh-anim').forEach((b, k) => b.classList.toggle('on', k === i))
  }

  /** the built-in clips for this vehicle type, sampled at 30 fps so long wheel spins never take the short way round */
  private make_clips (): THREE.AnimationClip[] {
    const R = this.rig!; const S = this.size; const L = S.z; const H = S.y
    const fps = 30
    const wr = this.wheels.map(w => Math.max(1e-4, w.radius))
    const front_axle = this.wheels.filter(w => w.front).reduce((a, w, _i, arr) => a + w.center.z / arr.length, 0) || L * 0.3
    const rear_axle = this.wheels.filter(w => !w.front).reduce((a, w, _i, arr) => a + w.center.z / arr.length, 0) || -L * 0.3
    const body0 = R.body.position.clone()
    // `R.mechs` follows the creation order of bones, so map it back to the part index
    const order = R.mechs.map(m => this.mechs.findIndex(x => x.name === m.bone.name))
    interface Pose { speed: number, steer: number, bodyPos: THREE.Vector3, bodyRot: THREE.Euler, rootPos: THREE.Vector3, rootRot: THREE.Euler, pivot?: THREE.Vector3, mech?: (j: number) => { rot: number, slide: number }, wheel?: (k: number) => number }
    let clip_dur = 2 // read by idle_mech so spinners loop cleanly
    this.idle_mech = (j: number, t: number, speed: number): { rot: number, slide: number } => {
      const m = this.mechs[j]; if (m === undefined) return { rot: 0, slide: 0 }
      if (m.kind === 'spin') { const turns = Math.max(1, Math.round(Math.max(0.1, m.angle / 100) * clip_dur)) / clip_dur; return { rot: turns * t, slide: 0 } }
      if (m.kind === 'wobble') { const k = Math.min(1, Math.abs(speed) / Math.max(1e-6, L * 1.6)); return { rot: (0.12 + 0.35 * k) * Math.sin(t * Math.PI * 2 * (clip_dur > 0 ? Math.round(1.5 * clip_dur) / clip_dur : 1.5)), slide: 0 } }
      return { rot: 0, slide: 0 }
    }
    const noise = (t: number, f: number, seed: number): number => Math.sin(t * f * 6.283 + seed) * 0.6 + Math.sin(t * f * 2.7 * 6.283 + seed * 1.7) * 0.4
    const make = (name: string, dur: number, fn: (t: number) => Partial<Pose>): THREE.AnimationClip => {
      clip_dur = dur
      const n = Math.round(dur * fps) + 1
      const times = new Float32Array(n)
      const wheelAng = this.wheels.map(() => 0)
      const tracks: Record<string, number[]> = {}
      const push = (k: string, ...v: number[]): void => { (tracks[k] ??= []).push(...v) }
      let prevT = 0
      for (let f = 0; f < n; f++) {
        const t = f / fps; times[f] = t
        const p = fn(t)
        const speed = p.speed ?? 0 // metres (model units) per second along +Z
        R.wheels.forEach((wb, k) => {
          wheelAng[k] += ((p.wheel?.(k) ?? speed) / wr[k]) * (t - prevT)
          const q = new THREE.Quaternion().setFromAxisAngle(this.wheels[k]?.axle ?? new THREE.Vector3(1, 0, 0), wheelAng[k])
          push(wb.name + '.quaternion', q.x, q.y, q.z, q.w)
        })
        R.steers.forEach((st) => {
          if (st === null) return
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.steer ?? 0)
          push(st.name + '.quaternion', q.x, q.y, q.z, q.w)
        })
        const mech_q: THREE.Quaternion[] = []
        R.mechs.forEach((d, j) => {
          const f = p.mech?.(j) ?? this.idle_mech(order[j], t, p.speed ?? 0)
          const q = new THREE.Quaternion().setFromAxisAngle(d.pose.axis, d.pose.open * f.rot)
          mech_q[j] = q.clone()
          // hooks and cables hang straight down: undo the boom's tilt (gravity), keep their own swing
          if ((d.kind === 'hook' || d.kind === 'cable') && d.parent >= 0 && R.mechs[d.parent].kind === 'boom') q.premultiply(mech_q[d.parent].clone().invert())
          push(d.bone.name + '.quaternion', q.x, q.y, q.z, q.w)
          const pos = d.rest.clone().addScaledVector(d.pose.slide, d.kind === 'cable' ? 0 : f.slide)
          push(d.bone.name + '.position', pos.x, pos.y, pos.z)
          const sy = 1 + (d.pose.stretch - 1) * f.slide
          push(d.bone.name + '.scale', 1, sy, 1)
        })
        const bp = body0.clone().add(p.bodyPos ?? new THREE.Vector3())
        const bq = new THREE.Quaternion().setFromEuler(p.bodyRot ?? new THREE.Euler())
        push('body.position', bp.x, bp.y, bp.z); push('body.quaternion', bq.x, bq.y, bq.z, bq.w)
        // root rotation about an optional pivot (wheelie / stoppie keep the axle on the ground)
        const rr = new THREE.Quaternion().setFromEuler(p.rootRot ?? new THREE.Euler())
        const rp = (p.rootPos ?? new THREE.Vector3()).clone()
        if (p.pivot !== undefined) rp.add(p.pivot.clone().sub(p.pivot.clone().applyQuaternion(rr)))
        push('root.position', rp.x, rp.y, rp.z); push('root.quaternion', rr.x, rr.y, rr.z, rr.w)
        prevT = t
      }
      const out: THREE.KeyframeTrack[] = []
      for (const [k, v] of Object.entries(tracks)) {
        out.push(k.endsWith('.quaternion') ? new THREE.QuaternionKeyframeTrack(k, times, v) : new THREE.VectorKeyframeTrack(k, times, v))
      }
      return new THREE.AnimationClip(name, dur, out)
    }
    const V = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z)
    const E = (x = 0, y = 0, z = 0): THREE.Euler => new THREE.Euler(x, y, z, 'YXZ')
    const deg = Math.PI / 180
    // "normal" speed in body lengths per second: heavy machines are slow
    const cruise = L * ({ car: 1.6, truck: 1.0, tracked: 0.6, roller: 0.3 } as Record<VehicleType, number>)[this.vtype]
    const ease = (x: number): number => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x)
    const decay = (t: number, k: number): number => Math.exp(-t * k)
    // mechanical parts (doors, turret, barrel, blade, boom, hook…): clip specs from Mechanics.ts.
    const extra: THREE.AnimationClip[] = mech_clips(this.mechs).map(c => make(c.name, c.dur, t => {
      const b = c.body?.(t) ?? {}
      return {
        mech: k => c.frame(t, order[k]),
        speed: (b.speed ?? 0) * cruise,
        bodyPos: V(0, H * (b.lift ?? 0), 0),
        bodyRot: E((b.pitch ?? 0) * deg, 0, (b.roll ?? 0) * deg)
      }
    }))
    // tracked vehicles (tank, bulldozer): turn on the spot by running the two sides in opposite directions
    if (this.vtype === 'tracked') {
      const side = this.wheels.map(w => (w.center.x >= 0 ? 1 : -1))
      const spin = (dir: number) => (t: number) => { const k = ease(t / 0.4) * (1 - ease((t - 2.1) / 0.4)); return { wheel: (i: number) => side[i] * dir * cruise * 0.35 * k, rootRot: E(0, dir * Math.PI / 2 * ease(t / 2.5), 0), bodyRot: E(0, 0, -dir * 0.8 * deg * k) } }
      extra.push(make('T_Pivot_Turn_Left', 2.5, spin(1)), make('T_Pivot_Turn_Right', 2.5, spin(-1)))
      extra.push(make('T_Track_Grind', 2, t => ({ speed: cruise * 0.6, bodyPos: V(0, H * 0.006 * Math.abs(Math.sin(t * 17)), 0), bodyRot: E(0.4 * deg * Math.sin(t * 9), 0, 0.3 * deg * Math.sin(t * 7)) })))
    }
    if (this.vtype === 'tracked') {
      // steering by running one track faster than the other (no steering wheels)
      const side = this.wheels.map(w => (w.center.x >= 0 ? 1 : -1))
      const turn = (dir: number) => (t: number) => { const k = ease(t / 0.5); return { speed: cruise * 0.7, wheel: (i: number) => cruise * 0.7 * (1 + side[i] * dir * 0.45 * k), rootRot: E(0, dir * 40 * deg * ease(t / 2.5), 0), bodyRot: E(0, 0, -dir * 0.6 * deg * k) } }
      extra.push(make('T_Turn_Left', 2.5, turn(1)), make('T_Turn_Right', 2.5, turn(-1)))
    }
    if (this.vtype === 'truck') {
      extra.push(make('K_Heavy_Start', 2.5, t => ({ speed: cruise * ease(t / 2), bodyRot: E(-1.5 * deg * Math.sin(Math.min(1, t / 0.8) * Math.PI) + 0.3 * deg * Math.sin(t * 7) * decay(t, 1.5), 0, 0) })))
      extra.push(make('K_Air_Brake', 2, t => ({ speed: cruise * (1 - ease(t / 1.2)), bodyRot: E(2.5 * deg * Math.sin(Math.min(1, t / 1.2) * Math.PI / 2) * decay(Math.max(0, t - 1.2), 2.5), 0, 0), bodyPos: V(0, -H * 0.012 * ease((t - 1.2) / 0.2) * decay(Math.max(0, t - 1.4), 3), 0) })))
      extra.push(make('K_Load_Bounce', 2, t => ({ speed: cruise * 0.5, bodyPos: V(0, H * 0.012 * Math.sin(t * 9) * (0.6 + 0.4 * Math.sin(t * 2)), 0), bodyRot: E(0.5 * deg * Math.sin(t * 7), 0, 0.4 * deg * Math.sin(t * 5)) })))
    }
    if (this.vtype === 'roller') {
      // road roller: crawls, vibrates the drum to compact, goes back and forth
      extra.push(make('R_Compact_Vibrate', 2, t => ({ speed: cruise * 0.6, bodyPos: V(0, H * 0.003 * Math.sin(t * 2 * Math.PI * 25), 0), bodyRot: E(0.12 * deg * Math.sin(t * 2 * Math.PI * 21), 0, 0.1 * deg * Math.sin(t * 2 * Math.PI * 17)) })))
      extra.push(make('R_Back_And_Forth', 6, t => { const v = t < 2.5 ? ease(t / 0.6) * (1 - ease((t - 1.9) / 0.6)) : -ease((t - 3) / 0.6) * (1 - ease((t - 5.4) / 0.6)); return { speed: cruise * v, rootPos: V(0, 0, 0), bodyRot: E(-0.6 * deg * v, 0, 0) } }))
      extra.push(make('R_Turn_Left', 3, t => ({ speed: cruise * 0.7, steer: 18 * deg * ease(t / 0.8), bodyRot: E(0, 0, -0.8 * deg * ease(t / 0.8)) })))
      extra.push(make('R_Turn_Right', 3, t => ({ speed: cruise * 0.7, steer: -18 * deg * ease(t / 0.8), bodyRot: E(0, 0, 0.8 * deg * ease(t / 0.8)) })))
    }
    const all = [
      make('01_Idle_Jiggle', 2, t => ({ bodyPos: V(0, H * 0.004 * noise(t, 9, 1), 0), bodyRot: E(0.15 * deg * noise(t, 7, 2), 0, 0.2 * deg * noise(t, 6, 3)) })),
      make('02_Idle_Rev', 2, t => { const rev = Math.max(0, Math.sin(t * Math.PI)) ; return { bodyPos: V(0, H * 0.01 * rev * noise(t, 14, 1), 0), bodyRot: E(-1.5 * deg * rev, 0, (0.6 + 2 * rev) * deg * noise(t, 11, 4)) } }),
      make('03_Drive_Slow', 2, t => ({ speed: cruise * 0.4, bodyPos: V(0, H * 0.004 * noise(t, 3, 1), 0) })),
      make('04_Drive', 2, t => ({ speed: cruise, bodyPos: V(0, H * 0.006 * noise(t, 4, 1), 0), bodyRot: E(0.3 * deg * noise(t, 2, 5), 0, 0) })),
      make('05_Drive_Fast', 2, t => ({ speed: cruise * 3, bodyPos: V(0, H * 0.008 * noise(t, 12, 1), 0), bodyRot: E(-1.2 * deg + 0.4 * deg * noise(t, 10, 2), 0, 0.3 * deg * noise(t, 9, 3)) })),
      make('06_Reverse', 2, t => ({ speed: -cruise * 0.5, bodyPos: V(0, H * 0.004 * noise(t, 3, 2), 0) })),
      make('07_Accelerate', 2.5, t => ({ speed: cruise * 2.5 * ease(t / 2), bodyRot: E(-4 * deg * Math.sin(Math.min(1, t / 1.2) * Math.PI) * (t < 1.2 ? 1 : 0.4), 0, 0) })),
      make('08_Brake_Hard', 2, t => ({ speed: cruise * 2 * (1 - ease(t / 0.8)), bodyRot: E(5 * deg * Math.sin(Math.min(1, t / 0.8) * Math.PI / 2) * decay(Math.max(0, t - 0.8), 3) - (t > 0.8 ? 1.2 * deg * Math.sin((t - 0.8) * 9) * decay(t - 0.8, 4) : 0), 0, 0) })),
      make('09_Turn_Left', 2, t => ({ speed: cruise, steer: 25 * deg * ease(t / 0.4), bodyRot: E(0, 0, -3 * deg * ease(t / 0.5)) })),
      make('10_Turn_Right', 2, t => ({ speed: cruise, steer: -25 * deg * ease(t / 0.4), bodyRot: E(0, 0, 3 * deg * ease(t / 0.5)) })),
      make('11_Drift_Left', 2.5, t => { const k = ease(t / 0.5); return { speed: cruise * 2.5, steer: -18 * deg * k, rootRot: E(0, 32 * deg * k, 0), bodyRot: E(0, 0, -5 * deg * k + 0.6 * deg * noise(t, 12, 1)), bodyPos: V(0, H * 0.006 * noise(t, 14, 2), 0) } }),
      make('12_Drift_Right', 2.5, t => { const k = ease(t / 0.5); return { speed: cruise * 2.5, steer: 18 * deg * k, rootRot: E(0, -32 * deg * k, 0), bodyRot: E(0, 0, 5 * deg * k + 0.6 * deg * noise(t, 12, 1)), bodyPos: V(0, H * 0.006 * noise(t, 14, 2), 0) } }),
      make('13_Bump', 1.5, t => ({ speed: cruise, bodyPos: V(0, H * 0.06 * Math.sin(Math.min(1, t / 0.5) * Math.PI) * decay(Math.max(0, t - 0.5), 4), 0), bodyRot: E(-3 * deg * Math.sin(Math.min(1, t / 0.5) * Math.PI * 2) * decay(t, 2), 0, 0) })),
      make('14_Jump', 2, t => { const air = t < 1 ? Math.sin(t * Math.PI) : 0; const land = t >= 1 ? Math.sin((t - 1) * 12) * decay(t - 1, 5) : 0; return { speed: cruise * 1.5, rootPos: V(0, H * 0.9 * air, 0), rootRot: E(-6 * deg * Math.sin(t * Math.PI) * (t < 1 ? 1 : 0), 0, 0), bodyPos: V(0, -H * 0.06 * land, 0) } }),
      make('15_Nitro_Boost', 2, t => ({ speed: cruise * 4 * ease(t / 0.6), bodyRot: E(-6 * deg * ease(t / 0.3) + 0.8 * deg * noise(t, 16, 1), 0, 0.8 * deg * noise(t, 15, 2)), bodyPos: V(0, H * 0.01 * noise(t, 18, 3), 0) })),
      make('16_Wheelie', 2.5, t => ({ speed: cruise, rootRot: E(-22 * deg * Math.sin(Math.min(1, t / 2.5) * Math.PI), 0, 0), pivot: V(0, 0, rear_axle) })),
      make('17_Stoppie', 2, t => ({ speed: cruise * (1 - ease(t / 0.6)), rootRot: E(16 * deg * Math.sin(Math.min(1, t / 2) * Math.PI), 0, 0), pivot: V(0, 0, front_axle) })),
      make('18_Spin_Out', 2, t => ({ speed: cruise * 1.5 * (1 - ease(t / 2)), rootRot: E(0, 2 * Math.PI * ease(t / 1.8), 0), bodyRot: E(0, 0, 6 * deg * Math.sin(t * Math.PI)) })),
      make('19_Crash_Hit', 1.5, t => ({ bodyPos: V(0, 0, -L * 0.04 * Math.sin(Math.min(1, t / 0.15) * Math.PI / 2) * decay(Math.max(0, t - 0.15), 4)), bodyRot: E(-5 * deg * Math.sin(t * 22) * decay(t, 5), 0, 3 * deg * Math.sin(t * 17) * decay(t, 5)) })),
      make('20_Lowrider_Hop', 2, t => { const hop = Math.abs(Math.sin(t * Math.PI * 2)); return { bodyPos: V(0, H * 0.18 * hop, 0), bodyRot: E(-8 * deg * Math.sin(t * Math.PI * 2), 0, 0) } })
    ]
    // stunts only make sense for cars: a bulldozer does not drift, wheelie or hit nitro
    const KEEP: Record<VehicleType, string[] | null> = {
      car: null,
      truck: ['01', '02', '03', '04', '06', '07', '08', '09', '10', '13', '19'],
      tracked: ['01', '02', '03', '04', '06', '08', '13', '19'],
      roller: ['01', '02', '03', '06', '19']
    }
    const keep = KEEP[this.vtype]
    return [...all.filter(c => keep === null || keep.includes(c.name.slice(0, 2))), ...extra]
  }

  /** what a mechanical part does in the driving clips (spinners keep spinning, antennas sway) — set in make_clips */
  private idle_mech: (j: number, t: number, speed: number) => { rot: number, slide: number } = () => ({ rot: 0, slide: 0 })

  /* ------------------------------------------------ export ------------------------------------------------ */
  private async export (fmt: 'glb' | 'fbx'): Promise<void> {
    if (this.rig === null) this.build_rig()
    if (this.rig === null) return
    this.current?.stop(); this.mixer?.stopAllAction()
    this.rig.root.updateMatrixWorld(true)
    const scene = new THREE.Scene()
    const group = new THREE.Group(); group.name = 'Vehicle'
    // move (not clone) the rig into the export scene, then put it back
    this.rig.skinned.forEach(m => group.add(m)); group.add(this.rig.root); scene.add(group)
    try {
      this.status(M(`Exporting ${fmt.toUpperCase()}…`, `Đang xuất ${fmt.toUpperCase()}…`, `${fmt.toUpperCase()} 내보내는 중…`))
      let blob: Blob
      if (fmt === 'glb') {
        const buf = await new GLTFExporter().parseAsync(scene, { binary: true, animations: this.clips, onlyVisible: false })
        blob = new Blob([buf as ArrayBuffer], { type: 'model/gltf-binary' })
      } else {
        scene.animations = this.clips
        const u8 = await new FBXExporter().parseAsync(scene, { preset: 'unity' as any, includeAnimations: true, animations: this.clips, onlyVisible: false, embedTextures: true } as any)
        blob = new Blob([u8 as any], { type: 'application/octet-stream' })
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `vehicle-rig.${fmt}`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      this.status(M(`Saved vehicle-rig.${fmt} (${this.clips.length} animations).`, `Đã lưu vehicle-rig.${fmt} (${this.clips.length} animation).`, `vehicle-rig.${fmt} 저장됨 (애니메이션 ${this.clips.length}개).`))
    } catch (e) {
      this.status(M('Export failed: ', 'Xuất lỗi: ', '내보내기 실패: ') + String(e), true)
    } finally {
      this.rig.skinned.forEach(m => this.holder.add(m)); this.holder.add(this.rig.root)
      this.play(0)
    }
  }
}

;(window as any).__vehicle = new VehicleApp()
