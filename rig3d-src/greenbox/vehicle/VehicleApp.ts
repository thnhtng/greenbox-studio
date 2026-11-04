import { WeightPaint } from '../skin/WeightPaint.ts'
/*
 * Greenbox 3D — Vehicle rig.
 * Load a car/truck (GLB/FBX) -> point it forward -> find the wheels (separate parts, or a best guess on a
 * single welded mesh) -> fix the wheel areas with + / − brushes -> 20 ready-made animations -> export GLB/FBX.
 *
 * No mesh is cut: every vertex is skinned 100% to either the body bone or one wheel bone, so the file stays
 * one model and works in Blender / Unity / Unreal. Wheels sit under the root (not the body), so body roll and
 * pitch never lift the wheels off the ground.
 */
import { load_any_files } from '../common/AnyLoader.ts'
import { Loop, belt_loop, wheel_band, on_belt, tangent_quat, type P2 } from './Tracks.ts'
import { split_by_vertices, subset } from '../common/MeshSplit.ts'
import { analyze, draw_analysis, type Analysis } from '../rig/ModelAnalyzer.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mount_view_buttons } from '../common/ViewButtons'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { IS_MAC } from '../common/MacTrackpad.ts'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import { M } from '../common/lang.ts'
import { History } from '../common/UndoKeys.ts'
import { type Mech, type MechKind, type MechPose, type Hinge, type MechAxis, MECH_ICON, default_angle, mech_pose, mech_parent, mech_clips } from './Mechanics.ts'
import { SAMPLES, make_sample, role_of } from './Samples.ts'
import { read_source, nearest_drivers, retarget_clips, type CloneSource } from './VehicleClone.ts'
import { get_rig_file } from '../rig/CustomRig.ts'
import { signature, nbox, box_of, iou, remember, recall, load_mem, export_mem, import_mem, MIN_SCORE, type PartRec, type RecType } from './RigMemory.ts'

interface Part { mesh: THREE.Mesh, owner: Int16Array } // owner per vertex: -1 = body, k = wheel k, DOOR0 + j = door j
interface Wheel { name: string, center: THREE.Vector3, radius: number, front: boolean, guessed: boolean, axle?: THREE.Vector3, locked?: boolean } // locked: 🔒 the axle was set by hand // axle: the wheel's own spin axis
const DOOR0 = 100 // owner codes from here on are mechanical parts (doors, turret, boom, hook…)
interface TrackRig { links: THREE.Bone[], s0: number[], loop: Loop, x: number, pivot: THREE.Vector3, side: number }
type VehicleType = 'car' | 'truck' | 'tracked' | 'roller'
/** one undo step: which mesh pieces there are and who owns each vertex, the wheels, the parts / bones, the type */
interface VState { parts: Part[], owners: Int16Array[], json: string }
type Tool = 'add' | 'remove' | 'box_add' | 'box_remove' | 'piece_add' | 'piece_remove' | 'lasso_add' | 'lasso_remove' | 'pen_add' | 'pen_remove' | 'quad' | 'circle' | null
const TOOL_BUTTONS: Array<[Exclude<Tool, null>, string]> = [['quad', 'vh-quad'], ['circle', 'vh-circle'], ['add', 'vh-add'], ['remove', 'vh-remove'], ['box_add', 'vh-box-add'], ['box_remove', 'vh-box-remove'], ['piece_add', 'vh-piece-add'], ['piece_remove', 'vh-piece-remove'], ['lasso_add', 'vh-lasso-add'], ['lasso_remove', 'vh-lasso-remove'], ['pen_add', 'vh-pen-add'], ['pen_remove', 'vh-pen-remove']]

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

/**
 * How round each piece really is, seen along X (the axle): the share of its points that lie outside the circle
 * that fits its side-view box. A wheel or drum has ~0 (a circle fills its box only up to the edge), a bucket,
 * a cab or a frame has its box corners filled (up to 1.41 × the radius).
 */
function off_circle (pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, comp: Int32Array, boxes: Map<number, THREE.Box3>, use?: (i: number) => boolean): Map<number, number> {
  const far = new Map<number, number>(); const tot = new Map<number, number>()
  const geo = new Map<number, [number, number, number]>()
  boxes.forEach((b, id) => geo.set(id, [(b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2, Math.max(b.max.y - b.min.y, b.max.z - b.min.z) / 2]))
  for (let i = 0; i < comp.length; i++) {
    const g = geo.get(comp[i]); if (g === undefined || (use !== undefined && !use(i))) continue
    tot.set(comp[i], (tot.get(comp[i]) ?? 0) + 1)
    if (Math.hypot(pos.getY(i) - g[0], pos.getZ(i) - g[1]) > g[2] * 1.12) far.set(comp[i], (far.get(comp[i]) ?? 0) + 1)
  }
  const out = new Map<number, number>(); tot.forEach((n, id) => out.set(id, (far.get(id) ?? 0) / n)); return out
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

/** the "what is this part?" menu: plain words, most used first (number keys 1–8) */
const CHOICES: Array<{ k: string, icon: string, en: string, vi: string, preset: Preset }> = [
  { k: 'hood', icon: '🔼', en: 'Hood', vi: 'Mui xe (capo)', preset: { icon: '🔼', label: 'Hood', kind: 'door', hinge: 'hood', angle: 60 } },
  { k: 'wheel', icon: '🛞', en: 'Wheel', vi: 'Bánh xe', preset: { icon: '🛞', label: 'Wheel', kind: 'wheel' } },
  { k: 'door', icon: '🚪', en: 'Door (with its window)', vi: 'Cửa xe (kèm kính)', preset: { icon: '🚪', label: 'Door', kind: 'door', hinge: 'front', angle: 70 } },
  { k: 'trunk', icon: '🔽', en: 'Trunk', vi: 'Cốp xe', preset: { icon: '🔽', label: 'Trunk', kind: 'door', hinge: 'trunk', angle: 60 } },
  { k: 'track', icon: '⛓', en: 'Track (caterpillar)', vi: 'Bánh xích', preset: { icon: '⛓', label: 'Track', kind: 'track' } },
  { k: 'drill', icon: '🔩', en: 'Drill', vi: 'Mũi khoan', preset: { icon: '🔩', label: 'Drill', kind: 'spin', axis: 'long', angle: 150 } },
  { k: 'blade', icon: '🚜', en: 'Blade / bucket', vi: 'Lưỡi ủi / gàu', preset: { icon: '🚜', label: 'Blade', kind: 'blade' } },
  { k: 'turret', icon: '🔄', en: 'Turning cab / turret', vi: 'Cabin xoay / tháp pháo', preset: { icon: '🔄', label: 'Turret / cab', kind: 'turret' } },
  // a character on this tab too: an arm / leg cut off becomes its own piece on a bone, swinging from its top (shoulder / hip)
  { k: 'limb', icon: '🦾', en: 'Arm / leg (swings)', vi: 'Tay / chân (đung đưa)', preset: { icon: '🦾', label: 'Limb', kind: 'door', hinge: 'top', angle: 45 } }
]
/** a part's name in plain words (the bone keeps its technical name for the export) */
function nice_name (n: string, kind?: string): string {
  // FL = front left … ; one letter: a wheel's F / R is front / rear, a door's L / R is left / right
  const where = (c: string, door: boolean): [string, string] => {
    let fb = ''; let lr = ''
    if (c.length >= 2) { fb = c[0]; lr = c[1] } else if (door) lr = c; else fb = c
    const FB: Record<string, [string, string]> = { F: ['front', 'trước'], M: ['middle', 'giữa'], R: ['rear', 'sau'] }
    const LR: Record<string, [string, string]> = { L: ['left', 'trái'], R: ['right', 'phải'] }
    const a = FB[fb] ?? ['', '']; const b = LR[lr] ?? ['', '']
    return [`${a[0]} ${b[0]}`.trim(), `${a[1]} ${b[1]}`.trim()]
  }
  let m = /^wheel_([FMR]?[LR]?)(\d*)$/.exec(n)
  if (m !== null) { const [en, vi] = where(m[1], false); return M(`${en} wheel ${m[2]}`.trim(), `Bánh ${vi} ${m[2]}`.trim(), n) }
  m = /^door_([FMR]?[LR]?)(\d*)$/.exec(n)
  if (m !== null) { const [en, vi] = where(m[1], true); return M(`${en} door ${m[2]}`.trim(), `Cửa ${vi} ${m[2]}`.trim(), n) }
  if (/^drum/.test(n)) return M('Roller drum', 'Trống lu', n)
  if (/^hood/.test(n)) return M('Hood', 'Mui xe (capo)', n)
  if (/^(trunk|tailgate)/.test(n)) return M('Trunk', 'Cốp xe', n)
  m = /^track_([LR])/.exec(n); if (m !== null) return M(`Track ${m[1] === 'L' ? 'left' : 'right'}`, `Bánh xích ${m[1] === 'L' ? 'trái' : 'phải'}`, n)
  const K: Record<string, [string, string]> = { turret: ['Turning cab', 'Cabin xoay'], barrel: ['Gun barrel', 'Nòng'], blade: ['Blade', 'Lưỡi ủi'], boom: ['Boom', 'Cần'], arm: ['Digger arm', 'Tay cần'], bucket: ['Bucket', 'Gàu'], hook: ['Hook', 'Móc cẩu'], cable: ['Cable', 'Cáp'], slide: ['Piston / forks', 'Piston / càng nâng'], wobble: ['Antenna', 'Ăng-ten'] }
  if (/drill/.test(n)) return M('Drill', 'Mũi khoan', n)
  if (kind === 'spin') return M(`Spinning part (${n})`, `Bộ phận quay (${n})`, n)
  if (kind !== undefined && K[kind] !== undefined) return M(K[kind][0], K[kind][1], n)
  return n
}

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
  private shift_sel = false // a ⇧ Shift + left drag / click selection is under way
  private drag_grab = false // a selected piece is being pulled off with the mouse held down
  private down_at: { x: number, y: number } | null = null
  private brush_radius_pct = 6
  private painting = false
  private show_regions = true
  private original_materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private region_material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  // rig + playback
  private rig: { root: THREE.Bone, body: THREE.Bone, wheels: THREE.Bone[], steers: Array<THREE.Bone | null>, mechs: Array<{ bone: THREE.Bone, pose: MechPose, kind: MechKind, rest: THREE.Vector3, parent: number }>, skinned: THREE.SkinnedMesh[], tracks: TrackRig[] } | null = null
  private bone_helper: THREE.SkeletonHelper | null = null
  private show_bones_on = false
  private placing = false
  private last_bone = ''
  private readonly bone_marks = new THREE.Group()
  private mixer: THREE.AnimationMixer | null = null
  private clips: THREE.AnimationClip[] = []
  private current: THREE.AnimationAction | null = null
  private readonly timer = new THREE.Timer()
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
    this.scene.add(this.holder); this.scene.add(this.markers); this.scene.add(this.hinge_marker); this.scene.add(this.bone_marks)
    this.camera.position.set(4, 3, 6)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    addEventListener('resize', () => this.resize()); this.resize()
    if (getComputedStyle(view).position === 'static') view.style.position = 'relative'
    if (IS_MAC) $('vh-hint').textContent = M('Trackpad: two-finger swipe = rotate · Shift + swipe = pan · pinch = zoom · click: select part · ⬚ 4 points: cut', 'Trackpad: vuốt 2 ngón = xoay · Shift + vuốt = dời · chụm = zoom · bấm: chọn bộ phận · ⬚ 4 điểm: cắt', 'Trackpad')
    mount_view_buttons(view, { camera: () => this.camera, controls: () => this.controls, model: () => this.holder, extra: [{ label: '🦴 Bones', title: 'Show the bones (B)', toggle: (on) => this.show_bones(on) }] })
    this.bind_ui()
    this.make_history()
    this.renderer.setAnimationLoop(() => {
      this.markers.children.forEach(r => { const f = r.userData.face as THREE.Vector3 | undefined; if (f === undefined) return; const m = (r as THREE.Mesh).material as THREE.MeshBasicMaterial; const near = this.camera.position.clone().sub(r.position).dot(f) > 0; m.depthTest = !near /* the far side (even the picked wheel) never shows through the body */ })
      this.timer.update()
      const dt = this.timer.getDelta()
      this.mixer?.update(dt * Number(($('vh-speed') as HTMLInputElement).value) / 100)
      this.renderer.render(this.scene, this.camera)
    })
    this.load_demo()
  }

  /* ---------------- undo / redo (Ctrl+Z / Cmd+Z, Ctrl+Shift+Z / Cmd+Shift+Z) ---------------- */
  public history!: History<VState>
  private make_history (): void {
    const take = (): VState => ({ parts: [...this.parts], owners: this.parts.map(p => Int16Array.from(p.owner)), json: JSON.stringify({ w: this.wheels, m: this.mechs, t: this.vtype, a: this.active, b: this.last_bone }) })
    const same = (a: VState, b: VState): boolean => a.json === b.json && a.parts.length === b.parts.length && a.parts.every((p, i) => p === b.parts[i] && a.owners[i].length === b.owners[i].length && a.owners[i].every((o, k) => o === b.owners[i][k]))
    const apply = (st: VState): void => {
      this.clear_rig()
      // mesh pieces (a separation or a new model can be undone too)
      for (const p of this.parts) if (!st.parts.includes(p)) this.holder.remove(p.mesh)
      st.parts.forEach((p, i) => { p.owner = Int16Array.from(st.owners[i]); if (p.mesh.parent !== this.holder) this.holder.add(p.mesh) })
      this.parts = [...st.parts]; this.comp_cache.clear()
      const d = JSON.parse(st.json)
      const v = (o: any): THREE.Vector3 | undefined => o == null ? undefined : new THREE.Vector3(o.x, o.y, o.z)
      this.wheels = d.w.map((w: any) => ({ ...w, center: v(w.center)!, axle: v(w.axle) }))
      this.mechs = d.m; this.vtype = d.t; this.active = d.a; this.last_bone = d.b
      ;($('vh-type') as HTMLSelectElement).value = this.vtype
      this.qsel.clear(); this.name_parts(); this.refresh_part_select(); this.refresh_colors(); this.draw_markers(); this.refresh_objects()
    }
    const h = new History<VState>(take, apply, same, 40)
    this.history = h
    const aside = document.querySelector('aside'); if (aside !== null) h.watch(aside as HTMLElement)
    h.watch_canvas(this.renderer.domElement, () => this.brush_mode !== null || this.placing)
    addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Enter') h.begin() }, true)
    addEventListener('keyup', () => h.commit_soon())
    h.bind_keys(() => !(this.wpaint?.active ?? false)) // while painting weights, Ctrl+Z belongs to the paint tool
    $('vh-undo').onclick = () => h.undo(); $('vh-redo').onclick = () => h.redo()
    const upd = (): void => { ($('vh-undo') as HTMLButtonElement).disabled = !h.can_undo(); ($('vh-redo') as HTMLButtonElement).disabled = !h.can_redo() }
    h.on_change = upd; upd()
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
    file.onchange = () => { if (file.files !== null && file.files.length > 0) void this.load_file(file.files); file.value = '' }
    document.getElementById('vh-demo')?.addEventListener('click', () => this.load_demo())
    document.getElementById('vh-demo-tank')?.addEventListener('click', () => this.load_demo_tank())
    const vi = document.documentElement.lang === 'vi' || /vi/i.test(localStorage.getItem('gb-lang') ?? '')
    const opts = SAMPLES.map(sm => `<option value="${sm.id}">${vi ? sm.vi : sm.label}</option>`).join('')
    ;($('vh-sample') as HTMLSelectElement).innerHTML = opts + `<option value="tank1">${vi ? 'Xe tăng hàn liền 1 khối (khó)' : 'Tank welded into one mesh (hard case)'}</option>`
    ;($('vh-clone-sample') as HTMLSelectElement).innerHTML = `<option value="">${vi ? '— file nguồn đã tải —' : '— uploaded source file —'}</option>` + opts
    $('vh-sample-load').onclick = () => { const v = ($('vh-sample') as HTMLSelectElement).value; if (v === 'tank1') this.load_demo_tank(); else this.load_sample(v) }
    const cf = $('vh-clone-file') as HTMLInputElement
    $('vh-clone-src').onclick = () => cf.click()
    cf.onchange = () => { if (cf.files !== null && cf.files.length > 0) { ($('vh-clone-sample') as HTMLSelectElement).value = ''; void this.clone_source_file(cf.files) } cf.value = '' }
    $('vh-clone-apply').onclick = () => { this.apply_clone() }
    $('vh-clone-target').onclick = () => file.click()
    ;($('vh-clone-sample') as HTMLSelectElement).onchange = (e) => { const v = (e.target as HTMLSelectElement).value; this.mark_cards(); if (v !== '') this.clone_from_sample(v) }
    const cards = $('vh-sample-cards')
    cards.innerHTML = SAMPLES.map(sm => `<button type="button" class="vh-card" data-sid="${sm.id}" title="${vi ? sm.vi : sm.label}"><span>${sm.icon ?? '🚗'}</span>${vi ? (sm.vshort ?? sm.vi) : (sm.short ?? sm.label)}</button>`).join('')
    cards.querySelectorAll<HTMLButtonElement>('[data-sid]').forEach(b => { b.onclick = () => { const sel = $('vh-clone-sample') as HTMLSelectElement; sel.value = b.dataset.sid!; this.clone_pending = null; sel.dispatchEvent(new Event('change')) } })
    $('vh-clone-none').onclick = () => { ($('vh-clone-sample') as HTMLSelectElement).value = ''; this.clone_pending = null; this.mark_cards(); this.clone_state(); $('vh-clone-note').textContent = M('No rig to copy: upload your vehicle, its wheels are found by themselves; fix parts with ⬚ 4 points.', 'Không copy rig: tải xe lên, bánh tự được dò; chỉnh bộ phận bằng ⬚ 4 điểm.', '복사 없음') }
    // sent here by the 🧬 Clone rig guide (a sample id, or a rigged vehicle file kept in the browser)
    const take = (): void => {
      let sid: string | null = null; let rig: string | null = null
      const h = location.hash.match(/^#clone(?:=([\w-]+)|Rig=(.+))?$/)
      if (h !== null) { sid = h[1] ?? null; rig = h[2] !== undefined ? decodeURIComponent(h[2]) : null; history.replaceState(null, '', location.pathname + location.search); (document.getElementById('vh-clone-box') as HTMLDetailsElement | null)?.setAttribute('open', '') }
      try { const P = window.parent as any; if (P !== window) { if (P.__gbVehicleClone) { sid = P.__gbVehicleClone; P.__gbVehicleClone = null } if (P.__gbVehicleCloneRig) { rig = P.__gbVehicleCloneRig; P.__gbVehicleCloneRig = null } } } catch { /* not in the cockpit */ }
      if (sid !== null) { ($('vh-clone-sample') as HTMLSelectElement).value = sid; this.clone_from_sample(sid) }
      if (rig !== null) void (async () => { const buf = await get_rig_file(rig!); if (buf !== null) { ($('vh-clone-sample') as HTMLSelectElement).value = ''; await this.clone_source_file([new File([buf], rig!)]) } })()
    }
    setTimeout(take, 0); setInterval(take, 800) // after the demo car of the constructor
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
    $('vh-find-tracks').onclick = () => this.find_tracks()
    $('vh-autocut').onclick = () => this.auto_cut()
    // ⚡ one click: learned rig (if this shape was rated before) + shape scan + bones + keyframed animations
    document.getElementById('vh-autorig')?.addEventListener('click', () => { this.auto_rig() })
    document.querySelectorAll<HTMLButtonElement>('[data-vh-star]').forEach(b => { b.onclick = () => this.rate(Number(b.dataset.vhStar)) })
    document.getElementById('vh-mem-export')?.addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(export_mem()); a.download = 'greenbox-rig-memory.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) })
    document.getElementById('vh-mem-import')?.addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f === undefined) return; void f.text().then(t => { try { const n = import_mem(t); this.status(M(`Rig memory: ${n} rigs added.`, `Bộ nhớ rig: đã thêm ${n} rig.`, `리그 메모리: ${n}개 추가`)); this.mem_info() } catch (err) { this.status(String(err), true) } }); (e.target as HTMLInputElement).value = '' })
    this.mem_info()
    // track: how many link bones run round the loop (0 = auto: one per separate link piece, else by length)
    ;($('vh-links') as HTMLInputElement).oninput = (e) => { const d = this.mechs[this.active - DOOR0]; if (d === undefined) return; const n = Number((e.target as HTMLInputElement).value); if (n < 4) delete d.links; else d.links = n; $('vh-links-val').textContent = n < 4 ? M('auto', 'tự động', '자동') : String(n); this.clear_rig() }
    ;($('vh-links') as HTMLInputElement).onchange = () => { this.build_rig(); const k = this.clips.findIndex(c => /drive|forward/i.test(c.name)); this.play(k >= 0 ? k : 0) }
    document.getElementById('vh-analyze')?.addEventListener('click', () => { this.analyze_model(true) })
    $('vh-place-bones').onclick = () => this.set_placing(!this.placing)
    $('vh-mirror-bones').onclick = () => this.mirror_bones()
    // the same 🧬 Clone rig guide as for creatures (wheels count as the feet on the floor when fitting)
    $('vh-clone-rig').onclick = () => { $('vh-step1').scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    $('vh-wpaint').onclick = () => { this.paint_weights(!(this.wpaint?.active ?? false)) }
    document.addEventListener('gb-weightpaint-closed', () => this.paint_weights(false))
    $('vh-separate').onclick = () => this.separate_selected()
    $('vh-pause').onclick = () => this.pause_toggle()
    $('vh-stop').onclick = () => this.stop_anim()
    ;($('vh-part-name') as HTMLInputElement).onchange = (e) => {
      const d = this.mechs[this.active - DOOR0]; if (d === undefined) return
      const v = (e.target as HTMLInputElement).value.trim().replace(/\s+/g, '_'); if (v === '' || this.mechs.some(m => m !== d && m.name === v)) return
      this.mechs.forEach(m => { if (m.parent === d.name) m.parent = v })
      if (this.last_bone === d.name) this.last_bone = v
      d.name = v; (d as any).named = true; this.clear_rig(); this.refresh_part_select()
    }
    ;($('vh-part-parent') as HTMLSelectElement).onchange = (e) => { const d = this.mechs[this.active - DOOR0]; if (d === undefined) return; const v = (e.target as HTMLSelectElement).value; if (v === '') delete d.parent; else d.parent = v; this.clear_rig(); this.refresh_part_select() }
    addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement
      if (t !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.closest('#vh-qmenu, #vh-axle') === null) return
      if (this.grab !== null) { if (e.key === 'Escape') this.q_grab_end(false); if (e.key === 'Enter') this.q_grab_end(true); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (this.q_count() > 0) this.q_delete(); else this.delete_selected() }
      if (e.key === 'Escape') { if (this.q_count() > 0) this.q_clear(); this.set_brush(null); if (this.placing) this.set_placing(false) }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const dig = /^Digit([1-9])$/.exec(e.code)
        if (dig !== null && this.q_count() > 0) { e.preventDefault(); const c = CHOICES[Number(dig[1]) - 1]; if (c !== undefined) this.q_choose(c.k) }
        if (e.code === 'KeyX' && this.q_count() > 0) { e.preventDefault(); this.history.begin(); this.q_detach(e.shiftKey ? 'wheel' : 'part'); this.history.commit_soon() }
        if (e.code === 'KeyZ' && this.active >= 0 && this.active < DOOR0 && this.q_count() === 0) { e.preventDefault(); this.set_axle(e.shiftKey ? 'flip' : 'next') }
        if (e.code === 'KeyG' && this.q_count() === 0 && this.active >= 0) { this.parts.forEach(p => { let q: Uint8Array | undefined; for (let i = 0; i < p.owner.length; i++) if (p.owner[i] === this.active) { if (q === undefined) { q = this.qsel.get(p) ?? new Uint8Array(p.owner.length); this.qsel.set(p, q) } q[i] = 1 } }) } // G on a picked part: take all of it
        if (e.code === 'KeyG' && this.q_count() > 0) { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur?.(); this.history.begin(); if (this.rig !== null) this.clear_rig(); this.q_grab_start() }
        if (e.code === 'BracketLeft' || e.code === 'BracketRight') { this.ring_scale = Math.min(2, Math.max(0.15, this.ring_scale * (e.code === 'BracketLeft' ? 0.8 : 1.25))); this.draw_markers() }
        if (e.code === 'KeyO') this.markers.visible = !this.markers.visible
      }
      if (e.key === ' ' && this.mixer !== null) { e.preventDefault(); this.pause_toggle() }
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
      const ae = document.activeElement as HTMLElement | null; if (ae !== null && ae !== document.body && ae !== el) ae.blur() // keys (G, X, Z…) go to the view again
      if (e.button !== 0) return
      this.down_at = { x: e.clientX, y: e.clientY }; this.q_menu_at = { x: e.clientX, y: e.clientY }
      // a pink (selected) piece under the mouse: left-drag pulls it off the body, release = drop it there
      if (this.brush_mode === null && this.grab === null && !this.placing && this.q_count() > 0 && this.on_selection(e)) { this.history.begin(); this.q_grab_start(); this.grab_from(e); this.drag_grab = true; return }
      // ⇧ Shift + left, no tool needed: drag = a free selection shape, click = the whole separate piece
      if (e.shiftKey && this.brush_mode === null && this.grab === null && !this.placing && this.parts.length > 0) { if (this.rig !== null) this.clear_rig(); this.shift_sel = true; this.lassoing = true; this.poly = [{ x: e.clientX, y: e.clientY }]; this.draw_poly(); return }
      if (this.brush_mode === 'add' || this.brush_mode === 'remove') { this.painting = true; this.paint(e) }
      else if (this.brush_mode === 'box_add' || this.brush_mode === 'box_remove') { this.box_start = { x: e.clientX, y: e.clientY }; this.draw_box(e) }
      else if (this.brush_mode === 'lasso_add' || this.brush_mode === 'lasso_remove') { this.lassoing = true; this.poly = [{ x: e.clientX, y: e.clientY }]; this.draw_poly() }
      else if (this.grab !== null) { this.q_grab_end(true); return }
      else if (this.brush_mode === 'quad') { this.poly.push({ x: e.clientX, y: e.clientY }); this.draw_poly(); if (this.poly.length >= 4) { const pts = this.poly; this.poly = []; this.draw_poly(); this.select_screen(true, pts, true) } }
      else if (this.brush_mode === 'circle') { this.box_start = { x: e.clientX, y: e.clientY }; this.draw_circle(e) }
      else if (this.brush_mode === 'pen_add' || this.brush_mode === 'pen_remove') {
        const p0 = this.poly[0]
        // click near the first point (or double-click) closes the shape
        if (this.poly.length >= 3 && (e.detail >= 2 || (p0 !== undefined && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) < 10))) this.finish_poly()
        else { this.poly.push({ x: e.clientX, y: e.clientY }); this.draw_poly() }
      }
    })
    el.addEventListener('pointermove', (e) => {
      if (this.grab !== null) { this.q_grab_move(e); return }
      if (this.painting) this.paint(e)
      else if (this.box_start !== null && this.brush_mode === 'circle') this.draw_circle(e)
      else if (this.box_start !== null) this.draw_box(e)
      else if (this.lassoing) { const l = this.poly[this.poly.length - 1]; if (l === undefined || Math.hypot(e.clientX - l.x, e.clientY - l.y) > 4) { this.poly.push({ x: e.clientX, y: e.clientY }); this.draw_poly() } }
      else if ((this.brush_mode === 'pen_add' || this.brush_mode === 'pen_remove' || this.brush_mode === 'quad') && this.poly.length > 0) this.draw_poly({ x: e.clientX, y: e.clientY })
    })
    addEventListener('pointerup', (e) => {
      if (this.drag_grab) { this.drag_grab = false; this.q_grab_end(true); this.q_menu_at = { x: e.clientX, y: e.clientY }; this.q_hint(); this.down_at = null; return }
      if (this.painting) { this.painting = false; this.after_paint() }
      else if (this.box_start !== null && this.brush_mode === 'circle') { this.q_menu_at = { x: e.clientX, y: e.clientY }; this.finish_circle(e) }
      else if (this.box_start !== null) { this.finish_box(e) }
      else if (this.shift_sel) {
        this.shift_sel = false; this.lassoing = false; const pts = this.poly; this.poly = []; this.draw_poly(); this.q_menu_at = { x: e.clientX, y: e.clientY }
        if (pts.length < 3 || (this.down_at !== null && Math.hypot(e.clientX - this.down_at.x, e.clientY - this.down_at.y) < 5)) this.q_piece(e, true)
        else this.select_screen(true, pts, true)
      }
      else if (this.lassoing) { this.lassoing = false; this.finish_poly() }
      else if ((this.brush_mode === 'piece_add' || this.brush_mode === 'piece_remove') && e.button === 0 && this.down_at !== null && e.target === el && Math.hypot(e.clientX - this.down_at.x, e.clientY - this.down_at.y) < 4) this.click_piece(e)
      else if (this.placing && e.button === 0 && this.down_at !== null && e.target === el && Math.hypot(e.clientX - this.down_at.x, e.clientY - this.down_at.y) < 4) this.place_bone(e)
      else if (e.button === 0 && this.down_at !== null && e.target === el && Math.hypot(e.clientX - this.down_at.x, e.clientY - this.down_at.y) < 4) this.pick(e)
      this.down_at = null
    })
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.grab !== null) this.q_grab_end(false) })
    // drop a file anywhere
    addEventListener('dragover', (e) => e.preventDefault())
    addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files; if (f !== undefined && f !== null && f.length > 0) void this.load_file(f) })
  }

  public async load_file (f: ArrayLike<File>): Promise<void> {
    try {
      const r = await load_any_files(f)
      this.plain_type(); this.set_model(r.scene, r.name); this.own_model = true; this.model_name = r.name; this.clone_state()
      // a clone source is waiting: the rig goes straight onto this vehicle
      if (($('vh-clone-auto') as HTMLInputElement | null)?.checked !== false && (this.clone_pending !== null || ($('vh-clone-sample') as HTMLSelectElement).value !== '')) this.apply_clone()
      if (r.warnings.length > 0) { const st = $('vh-status'); st.textContent = (st.textContent ?? '') + ' ' + r.warnings.join(' ') }
    } catch (err) {
      this.status((err as Error).message ?? String(err), true)
    }
  }

  private load_demo (): void {
    this.own_model = false
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
    this.vtype = 'car'; ($('vh-type') as HTMLSelectElement).value = 'car'
    this.set_model(g, 'demo car')
  }

  /** a tank modelled as ONE mesh (hull, turret, gun, road wheels and both tracks welded together): the hard case */
  public load_demo_tank (): void {
    const parts: THREE.BufferGeometry[] = []
    const add = (g: THREE.BufferGeometry, m: THREE.Matrix4): void => { const n = g.toNonIndexed(); n.deleteAttribute('uv'); n.applyMatrix4(m); parts.push(n) }
    const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1))
    add(new THREE.BoxGeometry(1.9, 0.7, 5.2, 4, 2, 10), T(0, 1.05, 0))
    add(new THREE.BoxGeometry(3.3, 0.06, 4.8, 6, 1, 10), T(0, 1.42, 0)) // fenders over the tracks
    add(new THREE.CylinderGeometry(0.85, 1.0, 0.55, 20), T(0, 1.68, -0.3))
    add(new THREE.CylinderGeometry(0.09, 0.11, 2.6, 10), T(0, 1.72, 1.0, Math.PI / 2))
    const R0 = 0.36; const zs = [-1.9, -0.95, 0, 0.95, 1.9]
    for (const x of [-1.25, 1.25]) {
      for (const z of zs) add(new THREE.CylinderGeometry(R0, R0, 0.32, 18), T(x, R0 + 0.12, z, 0, 0, Math.PI / 2))
      // the belt: a stadium loop round the wheels, 72 links with small grousers, welded into the same mesh
      const N = 72; const r = R0 + 0.1; const half = 1.9; const per = 2 * Math.PI * r + 4 * half
      for (let i = 0; i < N; i++) {
        const s = (i + 0.5) / N * per; let z: number; let y: number; let a: number
        if (s < 2 * half) { z = -half + s; y = R0 + 0.12 - r; a = 0 } else if (s < 2 * half + Math.PI * r) { const q = (s - 2 * half) / r; z = half + Math.sin(q) * r; y = R0 + 0.12 - Math.cos(q) * r; a = q } else if (s < 4 * half + Math.PI * r) { z = half - (s - 2 * half - Math.PI * r); y = R0 + 0.12 + r; a = Math.PI } else { const q = (s - 4 * half - Math.PI * r) / r; z = -half - Math.sin(q) * r; y = R0 + 0.12 + Math.cos(q) * r; a = Math.PI + q }
        add(new THREE.BoxGeometry(0.46, 0.06, per / N * 0.92), T(x, y, z, -a))
        add(new THREE.BoxGeometry(0.46, 0.05, 0.05), T(x, y - Math.cos(a) * 0.05, z + Math.sin(a) * 0.05, -a))
      }
    }
    const g = mergeGeometries(parts, false)
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6b7a4a, roughness: 0.8 }))
    const grp = new THREE.Group(); grp.add(mesh)
    this.vtype = 'tracked'; ($('vh-type') as HTMLSelectElement).value = 'tracked'
    this.set_model(grp, 'demo tank (one block)')
  }

  /** bake every mesh into world space, center it, put it on the floor, longest side along Z */
  /** a file with several vehicles: the mesh names of each, and which one is used */
  private vehicle_groups: string[][] = []
  private pick_group = 0
  private last_model: { root: THREE.Object3D, name: string } | null = null
  public use_vehicle (k: number): void { if (this.last_model === null) return; this.pick_group = k; this.set_model(this.last_model.root, this.last_model.name, true) }
  /** a new file of the user starts as a plain vehicle: tracks found on it make it 'tracked' (not the last file's type) */
  private plain_type (): void { this.vtype = 'car'; ($('vh-type') as HTMLSelectElement).value = 'car' }
  private set_model (root: THREE.Object3D, name: string, again = false): void {
    if (!again) { this.pick_group = 0; this.last_model = { root, name } }
    this.vehicle_groups = []
    this.comp_cache.clear()
    this.clear_rig()
    this.holder.clear(); this.parts = []; this.wheels = []; this.mechs = []; this.original_materials.clear(); this.dropped = []; this.qsel.clear()
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
      // generic mesh names (pCube6, polySurface7, Geom3D, mesh_0): the meaning is in a parent's name ("track_grp", "wheel_stuff")
      if (role_of(mesh.name) === null) { let o: THREE.Object3D | null = m.parent; while (o !== null && o !== root) { const r = role_of(o.name); if (r !== null && r.role !== 'body') { mesh.userData.role_name = o.name; break } o = o.parent } }
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
    this.refresh_objects()
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
    // a PACK of vehicles (several big bodies far apart): one group per body, every other piece joins the body
    // around it (or the nearest one). Touching boxes would join cars parked at an angle next to each other.
    { const len = (i: number): number => boxes[i].getSize(new THREE.Vector3()).length()
      const cnt = (i: number): number => this.parts[i].owner.length
      const L0 = Math.max(...keep.map(len)); const C0 = Math.max(...keep.map(cnt))
      const bodies = keep.filter(i => len(i) > L0 * 0.45 && cnt(i) > C0 * 0.3)
      const ctr = (i: number): THREE.Vector3 => boxes[i].getCenter(new THREE.Vector3())
      const apart = bodies.length >= 2 && bodies.every((a, x) => bodies.every((b, y) => x === y || ctr(a).distanceTo(ctr(b)) > Math.max(len(a), len(b)) * 0.45))
      // two tracks or two sides of ONE machine look like two bodies too: a piece touching both (the hull between them) joins them
      const bridged = (): boolean => keep.some(i => !bodies.includes(i) && bodies.filter(b => boxes[i].clone().expandByScalar(len(b) * 0.02).intersectsBox(boxes[b])).length >= 2)
      if (apart && !bridged()) {
        const groups = bodies.map(b => [b])
        keep.forEach(i => {
          if (bodies.includes(i)) return
          const c = ctr(i); let best = -1; let bd = Infinity
          bodies.forEach((b, k) => { const inside = boxes[b].clone().expandByScalar(len(b) * 0.08).containsPoint(c); const d = c.distanceTo(ctr(b)) * (inside ? 0.25 : 1); if (d < bd) { bd = d; best = k } })
          if (best >= 0 && bd < len(bodies[best]) * 0.8) groups[best].push(i); else drop.add(i)
        })
        const order = groups.map((g, k) => ({ g, k, w: g.reduce((a2, i) => a2 + cnt(i), 0) })).sort((x, y) => y.w - x.w)
        this.vehicle_groups = order.map(o => o.g.map(i => this.parts[i].mesh.name))
        const pick = order[Math.min(this.pick_group, order.length - 1)].g
        keep.forEach(i => { if (!pick.includes(i)) drop.add(i) })
        const names: string[] = []
        this.parts = this.parts.filter((p, i) => { if (!drop.has(i)) return true; names.push(p.mesh.name); this.holder.remove(p.mesh); this.dropped.push(p); return false })
        return names
      } }
    const parent = new Map<number, number>(); keep.forEach(i => parent.set(i, i))
    const find = (a: number): number => { while (parent.get(a) !== a) a = parent.get(a)!; return a }
    // touching = boxes closer than a small part of a typical piece (a whole-scene share would join the cars of a pack)
    const sizes = keep.map(i => boxes[i].getSize(new THREE.Vector3()).length()).sort((a, b) => a - b)
    const grow = Math.min(A.length() * 0.01, (sizes[Math.floor(sizes.length / 2)] ?? 0) * 0.15)
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
      const ranked = [...groups.values()].sort((x, y) => weight(y) - weight(x))
      // a pack of vehicles: every group nearly as big as the biggest is a vehicle you can pick
      const cars = ranked.filter(g => weight(g) > weight(ranked[0]) * 0.35 && g.items.length >= 2)
      this.vehicle_groups = cars.length > 1 ? cars.map(g => g.items.map(i => this.parts[i].mesh.name)) : []
      const best = cars.length > 1 ? cars[Math.min(this.pick_group, cars.length - 1)] : ranked[0]
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
      names.push(p.mesh.name); this.holder.remove(p.mesh); this.dropped.push(p) // kept: 🧹 can bring it back
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
    // the long axis has no direction: take the smaller turn (a file that already runs along Z stays as it is)
    while (r > Math.PI / 2 + 1e-6) r -= Math.PI
    while (r <= -Math.PI / 2 + 1e-6) r += Math.PI
    const snap = Math.round(r / (Math.PI / 2)) * (Math.PI / 2)
    if (Math.abs(r - snap) < 2 * Math.PI / 180) r = snap
    if (Math.abs(r) > 1e-6) this.bake_rotation(r)
  }

  /**
   * Parts whose name says what they are become that part straight away (common in game models, and how the
   * sample vehicles are made): wheel_*, door / hood / trunk, turret, barrel, track_L, boom, arm, bucket, hook,
   * cable, rotor, propeller, forks, antenna…
   */
  private doors_from_names (): void {
    let found = 0
    // a wheel by its name must stand on its edge, low down: a spare tyre lying on the roof / in the trunk is body
    const named_wheels = this.parts.filter(p => {
      if (role_of(p.mesh.userData.role_name ?? p.mesh.name)?.role !== 'wheel') return false
      p.mesh.geometry.computeBoundingBox(); const b = p.mesh.geometry.boundingBox!; const z = b.getSize(new THREE.Vector3())
      return z.y > Math.max(z.x, z.z) * 0.6 && b.min.y < this.size.y * 0.3
    })
    // the scan only guessed (or missed a bike's centred wheels): the named wheels win
    if (named_wheels.length > 0 && (this.wheels.length === 0 || this.wheels.every(w => w.guessed) || named_wheels.length > this.wheels.length)) {
      this.wheels = []; this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) if (p.owner[i] < DOOR0) p.owner[i] = -1 })
      named_wheels.forEach(p => {
        p.mesh.geometry.computeBoundingBox(); const b = p.mesh.geometry.boundingBox!; const sz = b.getSize(new THREE.Vector3())
        const r = Math.max(sz.y, sz.z) / 2; const c = b.getCenter(new THREE.Vector3())
        this.wheels.push({ name: '', center: new THREE.Vector3(c.x, Math.max(r, c.y), c.z), radius: r, front: false, guessed: false })
        p.owner.fill(this.wheels.length - 1)
      })
      this.wheels.forEach((w, k) => { w.axle = this.wheel_axle(k); w.front = w.center.z > 0.05 * this.size.z })
      found += named_wheels.length
    }
    this.parts.forEach(p => {
      const r = role_of(p.mesh.userData.role_name ?? p.mesh.name); if (r === null || r.role !== 'mech') return
      if (Array.from(p.owner).some(o => o >= 0 && o < DOOR0 && this.wheels[o]?.guessed !== true)) return // it already holds a real wheel
      for (let i = 0; i < p.owner.length; i++) if (p.owner[i] >= 0 && p.owner[i] < DOOR0) p.owner[i] = -1 // a guessed wheel gives it back
      const j = this.mechs.length
      const name = String(p.mesh.userData.role_name ?? p.mesh.name).replace(/[^\w-]+/g, '_')
      this.mechs.push({ kind: r.kind, name, hinge: r.hinge ?? 'auto', flip: false, axis: r.axis ?? 'auto', angle: r.angle ?? default_angle(r.kind) })
      if (r.kind !== 'door' && r.kind !== 'track') (this.mechs[j] as any).named = true
      p.owner.fill(DOOR0 + j); found++
      if (r.kind === 'track' && this.vtype !== 'tracked') { this.vtype = 'tracked'; ($('vh-type') as HTMLSelectElement).value = 'tracked' }
    })
    // tracks by name: the guessed corner wheels of a car make no sense under them
    if (this.mechs.some(m => m.kind === 'track') && this.wheels.length > 0 && this.wheels.every(w => w.guessed)) {
      this.wheels = []; this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) if (p.owner[i] >= 0 && p.owner[i] < DOOR0) p.owner[i] = -1 })
    }
    found += this.road_wheels_in_tracks()
    if (found > 0) {
      this.clear_rig()
      this.name_parts(); this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
      this.status(M(`Found ${found} part(s) by their names (${this.wheels.length} wheels, ${this.mechs.length} moving parts).`, `Nhận ${found} bộ phận theo tên (${this.wheels.length} bánh, ${this.mechs.length} bộ phận chuyển động).`, `이름으로 부품 ${found}개 인식.`))
    }
  }

  /** tracked vehicle: the round road wheels / sprockets inside each track loop spin with it */
  private road_wheels_in_tracks (): number {
    const tracks = this.mechs.map((m, j) => m.kind === 'track' ? this.part_box(DOOR0 + j) : null).filter((b): b is THREE.Box3 => b !== null && !b.isEmpty())
    if (tracks.length === 0) return 0
    let made = 0; const v = new THREE.Vector3()
    for (const p of this.parts) {
      let comp = this.comp_cache.get(p); if (comp === undefined) { comp = this.components(p); this.comp_cache.set(p, comp) }
      const pos = p.mesh.geometry.getAttribute('position'); const boxes = new Map<number, THREE.Box3>()
      for (let i = 0; i < comp.length; i++) { if (p.owner[i] !== -1) continue; let b = boxes.get(comp[i]); if (b === undefined) { b = new THREE.Box3(); boxes.set(comp[i], b) } b.expandByPoint(v.fromBufferAttribute(pos, i)) }
      const offc = off_circle(pos, comp, boxes, i => p.owner[i] === -1)
      boxes.forEach((b, id) => {
        if ((offc.get(id) ?? 1) > 0.06) return
        const z = b.getSize(new THREE.Vector3()); const tb = tracks.find(t => t.clone().expandByScalar(t.getSize(new THREE.Vector3()).y * 0.1).containsBox(b)); if (tb === undefined) return
        const th = tb.getSize(new THREE.Vector3()).y
        // round seen from the side, thinner than tall, and a real size inside the loop
        if (!(z.y > th * 0.25 && z.z / z.y > 0.75 && z.z / z.y < 1.33 && z.x < z.y * 1.2)) return
        const k = this.wheels.length
        this.wheels.push({ name: '', center: b.getCenter(new THREE.Vector3()), radius: Math.max(z.y, z.z) / 2, front: false, guessed: false })
        for (let i = 0; i < comp!.length; i++) if (comp![i] === id && p.owner[i] === -1) p.owner[i] = k
        made++
      })
    }
    this.wheels.forEach((w, k) => { w.axle = this.wheel_axle(k); w.front = w.center.z > 0.05 * this.size.z })
    return made
  }

  /* ------------------------------------------------ samples + 🧬 clone vehicle rig ------------------------------------------------ */
  /** a ready-made, fully rigged sample vehicle */
  public load_sample (id: string): void {
    this.own_model = false
    const s = make_sample(id)
    this.vtype = s.type; ($('vh-type') as HTMLSelectElement).value = s.type
    this.set_model(s.group, s.name)
    this.square_up(); this.unify_axles()
    // helicopters and boats have no wheels: drop the scan's corner guess
    if (!s.group.children.some(o => role_of(o.name)?.role === 'wheel')) { this.wheels = []; this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) if (p.owner[i] < DOOR0) p.owner[i] = -1 }); this.name_parts(); this.refresh_part_select(); this.refresh_colors(); this.draw_markers() }
    this.build_rig()
    this.clone_state()
    const pick = this.clips.findIndex(c => /M_Dig_Cycle|M_Crane_Cycle|M_Turn_Aim_Fire|D_All_Open|M_Spin|M_Slide_Pump|M_Blade_Raise/.test(c.name))
    if (pick >= 0) this.play(pick)
  }

  private clone_src: CloneSource | null = null
  /** source node -> target part: wheel index, part (mech) name, or the body / root */
  private clone_map = new Map<string, { wheel?: number, wheels?: number[], mech?: string, steer?: number, root?: boolean, body?: boolean }>()

  /** read the source (a rigged file or a sample) */
  public async clone_source_file (f: ArrayLike<File>): Promise<void> {
    try {
      const r = await load_any_files(f)
      let bones = 0; let named = 0
      r.scene.traverse(o => { if ((o as THREE.Bone).isBone === true) bones++; const ro = role_of(o.name); if (ro !== null && ro.role !== 'body') named++ })
      void named
      if (bones === 0 && (r.clips ?? []).length === 0) {
        // no bones, no animation: nothing to copy from it, so it is the NEW vehicle, not a source
        this.plain_type(); this.set_model(r.scene, r.name); this.own_model = true; this.model_name = r.name
        const ready = ($('vh-clone-sample') as HTMLSelectElement).value !== '' || this.clone_pending !== null
        if (ready) this.apply_clone()
        this.clone_state()
        $('vh-clone-note').textContent = M(`${r.name} has no rig: it is used as the NEW vehicle (②).` + (ready ? '' : ' Now pick a source in ①.'), `${r.name} chưa có rig: dùng làm xe MỚI (②).` + (ready ? '' : ' Giờ chọn nguồn ở ①.'), `${r.name}: 리그 없음 → 새 차량으로 사용.`)
        return
      }
      this.clone_pending = { root: r.scene, clips: r.clips ?? [], name: r.name }
      ;(document.getElementById('vh-clone-box') as HTMLDetailsElement | null)?.setAttribute('open', '')
      if (this.own_model) this.apply_clone(); else this.clone_ready_note()
    } catch (err) { this.status((err as Error).message ?? String(err), true) }
  }

  private clone_pending: { root: THREE.Object3D, clips: THREE.AnimationClip[], name: string } | null = null
  private own_model = false // a file of the user is loaded (not a demo / sample)
  private model_name = ''

  /** a sample picked as the clone source: shown animated while you have no model, its rig goes onto the next car you upload */
  public clone_from_sample (id: string): void {
    (document.getElementById('vh-clone-box') as HTMLDetailsElement | null)?.setAttribute('open', '')
    if (!this.own_model) this.load_sample(id)
    else { this.apply_clone(); return }
    this.clone_ready_note()
  }
  /** ① source / ② new vehicle lines of the clone box */
  private clone_state (): void {
    const sid = ($('vh-clone-sample') as HTMLSelectElement).value
    const src = sid !== '' ? '✓ ' + (SAMPLES.find(x => x.id === sid)?.label ?? sid) : this.clone_pending !== null ? '✓ ' + this.clone_pending.name : M('— pick a sample or upload a rigged source', '— chọn xe mẫu hoặc tải file xe ĐÃ có rig', '— 소스 선택')
    $('vh-clone-src-st').textContent = src
    $('vh-clone-tgt-st').textContent = this.own_model ? '✓ ' + this.model_name : M('— not uploaded yet (the car on screen is the preview)', '— chưa tải (xe đang hiện là bản xem thử)', '— 아직 없음')
  }
  private mark_cards (): void {
    const v = ($('vh-clone-sample') as HTMLSelectElement).value
    document.querySelectorAll<HTMLElement>('#vh-sample-cards [data-sid]').forEach(b => b.classList.toggle('on', b.dataset.sid === v))
  }
  private clone_ready_note (): void {
    this.clone_state()
    const n = M('Source ready. Now ⬆ upload YOUR vehicle (step 1): the rig and animations go onto it at once.', 'Đã có nguồn. Giờ ⬆ tải xe CỦA BẠN lên (bước 1): rig và animation sẽ được gắn vào ngay.', '소스 준비됨. 내 차량을 업로드하면 바로 적용됩니다.')
    $('vh-clone-note').textContent = n; this.status(n)
  }

  /** lay the source's parts (and animations) onto the loaded model */
  public apply_clone (): boolean {
    if (this.parts.length === 0) return false
    let pend = this.clone_pending
    const sid = ($('vh-clone-sample') as HTMLSelectElement).value
    if (pend === null || sid !== '') {
      if (sid === '' && pend === null) { this.status(M('Pick a sample or upload a rigged vehicle first.', 'Chọn xe mẫu hoặc tải xe có rig trước.', '샘플 또는 리그된 차량을 먼저 고르세요.'), true); return false }
      if (sid !== '') { const s = make_sample(sid); pend = { root: s.group, clips: [], name: s.name } }
    }
    const src = read_source(pend!.root, pend!.clips, ($('vh-clone-flip') as HTMLInputElement).checked)
    if (src === null) { this.status(M('The source has no mesh.', 'Nguồn không có mesh.', '소스에 메시가 없습니다.'), true); return false }
    this.history.begin()
    this.clear_rig()
    // target points in the unit box
    const box = this.box(); const S = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-6, 1e-6, 1e-6))
    const offs: number[] = []; let n = 0; this.parts.forEach(p => { offs.push(n); n += p.owner.length })
    const tgt = new Float32Array(n * 3)
    this.parts.forEach((p, pi) => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) { const o = (offs[pi] + i) * 3; tgt[o] = (pos.getX(i) - box.min.x) / S.x; tgt[o + 1] = (pos.getY(i) - box.min.y) / S.y; tgt[o + 2] = (pos.getZ(i) - box.min.z) / S.z } })
    const drv = nearest_drivers(src, tgt)
    const to_target = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3((p.x - src.min.x) / src.size.x * S.x + box.min.x, (p.y - src.min.y) / src.size.y * S.y + box.min.y, (p.z - src.min.z) / src.size.z * S.z + box.min.z)
    const D = src.drivers; this.clone_map.clear()
    // wheels: keep the target's own separate wheels when it has them, else take the source's wheel areas
    const swheels = D.map((d, i) => d.role.role === 'wheel' ? i : -1).filter(i => i >= 0)
    const keep_wheels = this.wheels.length >= 2 && this.wheels.every(w => !w.guessed)
    this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) if (p.owner[i] >= DOOR0 || !keep_wheels) p.owner[i] = -1 })
    this.mechs = []
    if (keep_wheels) {
      const used = new Set<number>()
      swheels.forEach(i => {
        const b = D[i].box; const c = to_target(b.getCenter(new THREE.Vector3()))
        // one source node for both rims of an axle: the two target wheels on that axle
        if (b.min.x < src.min.x + src.size.x * 0.35 && b.max.x > src.min.x + src.size.x * 0.65) {
          const pair = this.wheels.map((w, k) => ({ k, d: Math.abs(w.center.z - c.z) + (Math.abs(w.center.x) < this.size.x * 0.15 ? 1e9 : 0) })).filter(o => !used.has(o.k)).sort((a, b) => a.d - b.d)
          const l = pair.find(o => this.wheels[o.k].center.x >= 0); const r = pair.find(o => this.wheels[o.k].center.x < 0)
          const ks = [l, r].filter((o): o is { k: number, d: number } => o !== undefined && o.d < 1e8).map(o => o.k)
          if (ks.length > 0) { ks.forEach(k => used.add(k)); this.clone_map.set(D[i].name, { wheels: ks }); return }
        }
        let best = -1; let bd = Infinity
        this.wheels.forEach((w, k) => { if (used.has(k)) return; const d = w.center.distanceTo(c); if (d < bd) { bd = d; best = k } })
        if (best >= 0) { used.add(best); this.clone_map.set(D[i].name, { wheel: best }) }
      })
      // a source that animates only one side's rims: the twin on the other side turns with it
      this.clone_map.forEach(v => {
        if (v.wheel === undefined) return
        const w = this.wheels[v.wheel]
        const twin = this.wheels.map((o, k) => ({ o, k })).filter(({ o, k }) => !used.has(k) && Math.sign(o.center.x) === -Math.sign(w.center.x) && Math.abs(o.center.z - w.center.z) < w.radius)
        if (twin.length > 0) { used.add(twin[0].k); v.wheels = [v.wheel, twin[0].k]; delete v.wheel }
      })
    } else if (swheels.length > 0) {
      this.wheels = []
      swheels.forEach(i => { this.clone_map.set(D[i].name, { wheel: this.wheels.length }); this.wheels.push({ name: '', center: new THREE.Vector3(), radius: 0, front: false, guessed: false }) })
    }
    // moving parts
    D.forEach((d, i) => {
      if (d.role.role !== 'mech') return
      const r = d.role; const name = d.name.replace(/[^\w-]+/g, '_') || `part_${i}`
      const m: Mech = { kind: r.kind, name, hinge: r.hinge ?? 'auto', flip: false, axis: r.axis ?? 'auto', angle: r.angle ?? default_angle(r.kind) }
      ;(m as any).named = true
      // the source's own joint is the hinge when it sits on its part (a real rig); a sample's origin is not
      if (d.real_pivot) { const pv = to_target(d.pos); if (r.kind === 'bone') m.pivot = [pv.x, pv.y, pv.z]; else (m as any).clone_pivot = [pv.x, pv.y, pv.z] }
      this.clone_map.set(d.name, { mech: name })
      this.mechs.push(m)
    })
    D.forEach(d => { if (d.role.role === 'body' && !this.clone_map.has(d.name)) this.clone_map.set(d.name, { body: true }) })
    // every target vertex takes its nearest source part, but a separate PIECE moves as one: it takes the part
    // most of its points chose (else a frame bar half on a wheel tears when the wheel spins). Only a piece that is
    // most of a welded mesh is split point by point.
    const code_of = (d: number, cur: number): number => {
      const t = this.clone_map.get(D[d].name); if (t === undefined) return cur
      if (t.mech !== undefined) { const j = this.mechs.findIndex(m => m.name === t.mech); return j >= 0 && (cur < 0 || !keep_wheels) ? DOOR0 + j : cur }
      if (t.wheel !== undefined && !keep_wheels) return t.wheel
      return keep_wheels ? cur : -1
    }
    this.comp_cache.clear()
    const total = this.parts.reduce((n, p) => n + p.owner.length, 0)
    this.parts.forEach((p, pi) => {
      const comp = this.components(p); const sizes = new Map<number, number>()
      for (let i = 0; i < comp.length; i++) sizes.set(comp[i], (sizes.get(comp[i]) ?? 0) + 1)
      const votes = new Map<number, Map<number, number>>()
      for (let i = 0; i < p.owner.length; i++) {
        const d = drv[offs[pi] + i]; if (d < 0) continue
        const c = code_of(d, p.owner[i])
        if ((sizes.get(comp[i]) ?? 0) > total * 0.3) { p.owner[i] = c; continue } // most of the whole vehicle welded in one piece
        let v = votes.get(comp[i]); if (v === undefined) { v = new Map(); votes.set(comp[i], v) }
        v.set(c, (v.get(c) ?? 0) + 1)
      }
      const pick = new Map<number, number>()
      votes.forEach((v, id) => { let best = -1; let bn = -1; v.forEach((n, c) => { if (n > bn) { bn = n; best = c } }); pick.set(id, best) })
      for (let i = 0; i < p.owner.length; i++) { const c = pick.get(comp[i]); if (c !== undefined && (c >= 0 || !keep_wheels || p.owner[i] >= DOOR0)) p.owner[i] = c }
    })
    // a wheel is round: a piece that went to a wheel but is a bar, a plate or a frame stays on the body
    if (!keep_wheels) {
      const v = new THREE.Vector3()
      this.parts.forEach(p => {
        const comp = this.components(p); const pos = p.mesh.geometry.getAttribute('position'); const boxes = new Map<number, THREE.Box3>()
        for (let i = 0; i < comp.length; i++) { if (p.owner[i] < 0 || p.owner[i] >= DOOR0) continue; let b = boxes.get(comp[i]); if (b === undefined) { b = new THREE.Box3(); boxes.set(comp[i], b) } b.expandByPoint(v.fromBufferAttribute(pos, i)) }
        const offc = off_circle(pos, comp, boxes, i => p.owner[i] >= 0 && p.owner[i] < DOOR0)
        const welded = (_: Part, id: number): boolean => { let c = 0; for (let i = 0; i < comp.length; i++) if (comp[i] === id) c++; return c > total * 0.3 } // a wheel area inside one big welded mesh has no clean outline
        boxes.forEach((b, id) => {
          // round seen from the side AND near the ground (a bucket in front or the cab is neither)
          const z = b.getSize(new THREE.Vector3()); const round = z.y > 0 && z.z / z.y > 0.6 && z.z / z.y < 1.65 && z.x < Math.max(z.y, z.z) * 1.3 && ((offc.get(id) ?? 1) < 0.06 || welded(p, id)) && b.min.y < this.size.y * 0.2
          if (!round) for (let i = 0; i < comp.length; i++) if (comp[i] === id && p.owner[i] >= 0 && p.owner[i] < DOOR0) p.owner[i] = -1
        })
      })
    }
    if (!keep_wheels) {
      this.wheels.forEach((w, k) => {
        const b = this.part_box(k); if (b.isEmpty()) return
        const s = b.getSize(new THREE.Vector3()); const c = b.getCenter(new THREE.Vector3())
        w.radius = Math.max(s.y, s.z) / 2; w.center.set(c.x, Math.max(w.radius, c.y), c.z)
      })
      // one source node for BOTH rims of an axle (common in Sketchfab cars): split it left / right
      const W2 = this.size.x
      const n0 = this.wheels.length
      for (let k = 0; k < n0; k++) {
        const b = this.part_box(k); if (b.isEmpty() || !(b.min.x < -W2 * 0.15 && b.max.x > W2 * 0.15)) continue
        const kr = this.wheels.length
        this.wheels.push({ name: '', center: new THREE.Vector3(), radius: 0, front: false, guessed: false })
        this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < p.owner.length; i++) if (p.owner[i] === k && pos.getX(i) < 0) p.owner[i] = kr })
        this.clone_map.forEach(v => { if (v.wheel === k) v.wheels = [k, kr] })
        for (const q of [k, kr]) {
          const bb = this.part_box(q); if (bb.isEmpty()) continue
          const s2 = bb.getSize(new THREE.Vector3()); const c2 = bb.getCenter(new THREE.Vector3())
          this.wheels[q].radius = Math.max(s2.y, s2.z) / 2; this.wheels[q].center.set(c2.x, Math.max(this.wheels[q].radius, c2.y), c2.z)
        }
      }
      // wheels the target has no room for are dropped (their vertices stay on the body)
      const live = this.wheels.map((w, k) => w.radius > 0 ? k : -1).filter(k => k >= 0)
      if (live.length < this.wheels.length) {
        const remap = new Map<number, number>(); live.forEach((k, i) => remap.set(k, i))
        this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) { const o = p.owner[i]; if (o >= 0 && o < DOOR0) p.owner[i] = remap.get(o) ?? -1 } })
        this.clone_map.forEach(v => {
          if (v.wheel !== undefined) { const k = remap.get(v.wheel); if (k === undefined) delete v.wheel; else v.wheel = k }
          if (v.wheels !== undefined) v.wheels = v.wheels.map(k => remap.get(k) ?? -1).filter(k => k >= 0)
        })
        this.wheels = live.map(k => this.wheels[k])
      }
      this.wheels.forEach((w, k) => { w.axle = this.wheel_axle(k); w.front = w.center.z > 0.05 * this.size.z })
    }
    // steering knuckles and the whole-vehicle root of the source
    src.carriers.forEach(c => { if (this.clone_map.has(c.name) && this.clone_map.get(c.name)!.body !== true) return // a wheel / part of the same name keeps its own mapping
      if (c.root) this.clone_map.set(c.name, { root: true }); else { const w = this.clone_map.get(D[c.wheel].name)?.wheel; if (w !== undefined) this.clone_map.set(c.name, { steer: w }) } })
    // parts of the NEW vehicle that say what they are (its own tracks, a drill…) and that the source has nothing for
    this.parts.forEach(p => {
      const r = role_of(p.mesh.userData.role_name ?? p.mesh.name); if (r === null || r.role !== 'mech') return
      if (r.kind !== 'track' && this.mechs.some(m => m.kind === r.kind)) return
      // a track takes its whole mesh back (the nearest-part copy may have given bits of it to wheels)
      if (r.kind !== 'track' && !Array.from(p.owner).every(o => o === -1)) return
      const j = this.mechs.length
      this.mechs.push({ kind: r.kind, name: r.kind === 'track' ? 'track' : String(p.mesh.userData.role_name ?? p.mesh.name).replace(/[^\w-]+/g, '_'), hinge: r.hinge ?? 'auto', flip: false, axis: r.axis ?? 'auto', angle: r.angle ?? default_angle(r.kind) })
      p.owner.fill(DOOR0 + j)
    })
    if (this.mechs.some(m => m.kind === 'track')) { this.vtype = 'tracked'; ($('vh-type') as HTMLSelectElement).value = 'tracked' }
    this.clone_src = src.clips.length > 0 ? src : null
    this.name_parts(); this.active = this.wheels.length > 0 ? 0 : this.mechs.length > 0 ? DOOR0 : -1
    this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
    // a moving part welded to the body (a track inside one big mesh) would stretch its seam triangles:
    // cut it out into its own mesh with the holes filled, so it moves clean
    this.cut_torn_parts()
    this.history.commit_soon()
    this.build_rig()
    const first = this.clips.findIndex(c => c.name.startsWith('SRC_')); if (first >= 0) this.play(first)
    const msg = M(`🧬 Cloned from ${pend!.name}: ${src.note}. Now: ${this.wheels.length} wheels, ${this.mechs.length} parts${this.clone_src !== null ? ', source animations = SRC_…' : ''}. Fix any area with the tools, then export.`,
      `🧬 Đã clone từ ${pend!.name}: ${src.note}. Xe này: ${this.wheels.length} bánh, ${this.mechs.length} bộ phận${this.clone_src !== null ? ', animation gốc = SRC_…' : ''}. Sửa vùng nào sai bằng công cụ, rồi xuất file.`,
      `🧬 ${pend!.name}에서 복제: 바퀴 ${this.wheels.length}개, 부품 ${this.mechs.length}개.`)
    this.status(msg); $('vh-clone-note').textContent = '✓ ' + src.note; this.clone_state()
    return true
  }

  /** every part that shares triangles with another part is cut out (holes filled), so animating it cannot tear */
  private cut_torn_parts (skip_guessed = false): number {
    const keep = this.active; let n = 0
    for (const [code, cnt] of [...this.seam_count()]) {
      if (cnt === 0 || (skip_guessed && code < DOOR0 && this.wheels[code]?.guessed === true)) continue // a guessed wheel on a welded car: check it first
      this.active = code; this.separate_selected(); n++
      // the rest of each cut mesh keeps copies of the border points: they stay on the body
      for (const p of this.parts) { if (p.owner.some(o => o !== code) && p.owner.some(o => o === code)) for (let i = 0; i < p.owner.length; i++) if (p.owner[i] === code) p.owner[i] = -1 }
    }
    this.active = keep
    if (n > 0) { this.comp_cache.clear(); this.refresh_colors() }
    return n
  }

  /** the source animations on the built rig */
  private clone_clips (): THREE.AnimationClip[] {
    const src = this.clone_src; const R = this.rig; if (src === null || R === null) return []
    const k = this.size.z / Math.max(1e-6, src.size.z)
    const bone = (n: string): THREE.Bone | undefined => R.root.getObjectByName(n) as THREE.Bone | undefined
    return retarget_clips(src, (node, prop) => {
      const t = this.clone_map.get(node); if (t === undefined) return []
      let bs: Array<THREE.Bone | null | undefined> = []
      if (t.root === true) bs = [R.root]
      else if (t.body === true) bs = [prop === 'position' ? R.root : R.body] // the body driving along moves the whole vehicle
      else if (t.wheels !== undefined) bs = t.wheels.map(w => R.wheels[w])
      else if (t.wheel !== undefined) bs = [R.wheels[t.wheel]]
      else if (t.steer !== undefined) bs = [R.steers[t.steer]]
      else if (t.mech !== undefined) bs = [bone(t.mech)]
      return bs.filter((b): b is THREE.Bone => b !== null && b !== undefined).map(b => ({ bone: b.name, rest: b.position.clone() }))
    }, k)
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
    interface Cand { part: number, comp: number, box: THREE.Box3, z: boolean }
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
      const offc = off_circle(pos, comp, boxes)
      boxes.forEach((b, c) => {
        const s = b.getSize(new THREE.Vector3())
        if ((offc.get(c) ?? 1) > 0.04) return // corners filled: a bucket, a cab, a step, not a wheel
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
        if ((low && big && (roundX || roundZ)) || drum) cands.push({ part: pi, comp: c, box: b, z: roundZ && !roundX && !drum })
      })
    })
    // round along Z (a sideways vehicle's wheels) only counts when nothing is round along X: else it is an
    // exhaust pipe or a lamp pointing backwards
    if (cands.filter(c => !c.z).length >= 2) { for (let i = cands.length - 1; i >= 0; i--) if (cands[i].z) cands.splice(i, 1) }
    // merge tyre + rim + hub pieces that share a centre
    const groups: Array<{ items: Cand[], box: THREE.Box3 }> = []
    for (const c of cands) {
      const cc = c.box.getCenter(new THREE.Vector3())
      const g = groups.find(gr => gr.box.getCenter(new THREE.Vector3()).distanceTo(cc) < gr.box.getSize(new THREE.Vector3()).y * 0.35)
      if (g !== undefined) { g.items.push(c); g.box.union(c.box) } else groups.push({ items: [c], box: c.box.clone() })
    }
    // a full separate body would also look "round" for tiny toys; ignore groups that are as big as the car
    let wheels = groups.filter(g => g.box.getSize(new THREE.Vector3()).z < S.z * 0.6)
    // brake discs, calipers, bolts and exhaust pipes look round too: a small group inside a big wheel joins it,
    // other small ones are not wheels
    if (wheels.length > 2) {
      const rad = (g: { box: THREE.Box3 }): number => { const s = g.box.getSize(new THREE.Vector3()); return Math.max(s.y, s.z) / 2 }
      const big = [...wheels].sort((a, b) => rad(b) - rad(a)); const ref = rad(big[Math.min(3, big.length - 1)])
      const keep = wheels.filter(g => rad(g) >= ref * 0.6)
      wheels.filter(g => !keep.includes(g)).forEach(g => {
        const c = g.box.getCenter(new THREE.Vector3())
        const host = keep.find(h => { const hc = h.box.getCenter(new THREE.Vector3()); return Math.sign(hc.x) === Math.sign(c.x) && Math.hypot(hc.y - c.y, hc.z - c.z) < rad(h) * 1.05 && Math.abs(hc.x - c.x) < rad(h) * 1.2 })
        if (host !== undefined) { host.items.push(...g.items); host.box.union(g.box) }
      })
      if (keep.length >= 2) wheels = keep
    }
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
    this.square_up()
    setTimeout(() => { this.unify_axles(); this.draw_markers() }, 0) // once, after the scan sets the axles (each wheel is free after that)
    if (this.vtype === 'tracked') setTimeout(() => { if (!this.mechs.some(m => m.kind === 'track')) this.find_tracks() }, 0)
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
   * a wheel's spin axis: which way its round side faces (a tyre is a flat disc), made level so the wheel stands
   * upright, pointed to +X (the vehicle's left) so every wheel spins the same way.
   */
  private wheel_axle (k: number): THREE.Vector3 | undefined {
    const lw = this.wheels[k]; if (lw?.locked === true && lw.axle !== undefined) return lw.axle // 🔒 set by hand
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
    // a wheel stands upright: its axle is level (a caliper or a hub cap tilting the measured axis up / down is
    // dropped), but keeps the way the wheel really faces sideways (a model turned a few degrees spins true, no wobble)
    v.y = 0; if (v.lengthSq() < 1e-8) return new THREE.Vector3(1, 0, 0)
    v.normalize(); if (v.x < 0 || (Math.abs(v.x) < 1e-3 && v.z < 0)) v.negate()
    return v
  }

  private name_parts (): void {
    this.name_wheels()
    const S = this.size
    const was = this.mechs.map(d => d.name) // parts that hang on a renamed part follow the new name
    this.mechs.forEach((d, j) => {
      const b = this.part_box(DOOR0 + j)
      if (d.kind === 'bone' || (d as any).named === true) return // the user named it
      if (d.kind === 'track') { const c = b.isEmpty() ? 0 : b.getCenter(new THREE.Vector3()).x; d.name = c >= 0 ? 'track_L' : 'track_R'; return }
      if (d.kind !== 'door') { d.name = d.kind; return }
      if (b.isEmpty()) { d.name = `door_${j + 1}`; return }
      const c = b.getCenter(new THREE.Vector3())
      const mid = Math.abs(c.x) < S.x * 0.18
      if (mid) d.name = c.z > 0 ? 'hood' : 'trunk'
      else d.name = `door_${c.z > S.z * 0.12 ? 'F' : c.z < -S.z * 0.12 ? 'R' : ''}${c.x >= 0 ? 'L' : 'R'}`
    })
    const seen = new Map<string, number>()
    this.mechs.forEach(d => { const n = (seen.get(d.name) ?? 0) + 1; seen.set(d.name, n); if (n > 1) d.name += String(n) })
    this.mechs.forEach(d => { if (d.parent === undefined) return; const k = was.indexOf(d.parent); if (k >= 0) d.parent = this.mechs[k].name })
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
      if (Math.abs(w.center.x) < S.x * 0.15) {
        // a wide roller is a drum; a thin centred wheel is a bike's
        const wb = this.part_box(this.wheels.indexOf(w)); const wide = wb.isEmpty() || wb.getSize(new THREE.Vector3()).x > w.radius * 0.8
        w.name = wide ? `drum_${fb}` : `wheel_${fb}`; return
      }
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
    sel.innerHTML = this.wheels.map((w, k) => `<option value="${k}">🛞 ${nice_name(w.name)}${w.guessed ? M(' (guess)', ' (đoán)', ' (추정)') : ''}</option>`).join('') +
      this.mechs.map((d, j) => `<option value="${DOOR0 + j}">${MECH_ICON[d.kind]} ${nice_name(d.name, d.kind)}</option>`).join('')
    if (this.part_name(this.active) === '?') this.active = this.wheels.length > 0 ? 0 : this.mechs.length > 0 ? DOOR0 : -1
    sel.value = String(this.active)
    $('vh-wheel-count').textContent = String(this.wheels.length)
    $('vh-door-count').textContent = String(this.mechs.length)
    const door = this.mechs[this.active - DOOR0]
    $('vh-door-box').style.display = door !== undefined ? 'flex' : 'none'
    if (door !== undefined) {
      $('vh-hinge-row').style.display = door.kind === 'door' ? '' : 'none'
      $('vh-axis-row').style.display = door.kind === 'spin' || door.kind === 'slide' || door.kind === 'bone' ? '' : 'none'
      $('vh-angle-row').style.display = door.kind === 'track' ? 'none' : ''
      $('vh-links-row').style.display = door.kind === 'track' ? '' : 'none'
      ;($('vh-links') as HTMLInputElement).value = String(door.links ?? 0)
      $('vh-links-val').textContent = door.links !== undefined ? String(door.links) : M(`auto${(door as any).found_links !== undefined ? ' (' + String((door as any).found_links) + ')' : ''}`, `tự động${(door as any).found_links !== undefined ? ' (' + String((door as any).found_links) + ')' : ''}`, '자동')
      ;($('vh-part-name') as HTMLInputElement).value = door.name
      const par = $('vh-part-parent') as HTMLSelectElement
      par.innerHTML = `<option value="">${M('auto (body)', 'tự động (thân)', '자동 (차체)')}</option>` + this.mechs.filter(x => x !== door).map(x => `<option value="${x.name}">${MECH_ICON[x.kind]} ${x.name}</option>`).join('')
      par.value = door.parent ?? ''
      ;($('vh-axis') as HTMLSelectElement).value = door.axis ?? 'auto'
      ;($('vh-part-flip') as HTMLInputElement).checked = door.flip
      ;($('vh-hinge') as HTMLSelectElement).value = door.hinge
      ;($('vh-door-angle') as HTMLInputElement).value = String(door.angle)
      $('vh-door-angle-val').textContent = this.amount_label(door)
    }
    this.draw_hinge()
    this.draw_bone_marks()
  }

  /** free bones before the rig is built: a dot on each joint and a line to its parent */
  private draw_bone_marks (): void {
    this.bone_marks.clear()
    const S = this.size.length() || 1
    const pv = (m: Mech): THREE.Vector3 | null => m.pivot !== undefined ? new THREE.Vector3(...m.pivot) : null
    this.mechs.forEach((m, j) => {
      const p = pv(m); if (p === null) return
      const on = DOOR0 + j === this.active
      const dot = new THREE.Mesh(new THREE.SphereGeometry(S * (on ? 0.012 : 0.008), 12, 8), new THREE.MeshBasicMaterial({ color: on ? 0xffd34d : 0x7ad7ff, depthTest: false }))
      dot.position.copy(p); dot.renderOrder = 14; this.bone_marks.add(dot)
      const par = m.parent !== undefined ? this.mechs.find(x => x.name === m.parent) : undefined
      const pp = par !== undefined ? pv(par) : null
      if (pp !== null) {
        const g = new THREE.BufferGeometry().setFromPoints([pp, p])
        const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x7ad7ff, depthTest: false })); l.renderOrder = 13; this.bone_marks.add(l)
      }
    })
  }

  /* ------------------------------------------------ bones view, place bones, tracks, separate ------------------------------------------------ */
  private show_bones (on: boolean): void {
    this.show_bones_on = on
    if (this.bone_helper !== null) { this.scene.remove(this.bone_helper); this.bone_helper.dispose(); this.bone_helper = null }
    if (on && this.rig === null && this.parts.length > 0) this.build_rig()
    if (on && this.rig !== null) {
      const h = new THREE.SkeletonHelper(this.rig.root)
      ;(h.material as THREE.LineBasicMaterial).depthTest = false; (h.material as THREE.LineBasicMaterial).linewidth = 2
      h.renderOrder = 15; this.scene.add(h); this.bone_helper = h
    }
    this.bone_marks.visible = true
  }

  private set_placing (on: boolean): void {
    this.placing = on
    if (on) this.set_brush(null)
    $('vh-place-bones').classList.toggle('on', on)
    if (on) this.status(M('Click the model to put a bone joint there. Shift+click: the next bone hangs on the previous one (a chain). Ctrl+click: also take the clicked piece. Then select its area with the tools below.', 'Bấm lên model để đặt khớp xương. Shift+bấm: xương tiếp theo nối vào xương trước (thành chuỗi). Ctrl+bấm: lấy luôn khối vừa bấm. Sau đó chọn vùng của nó bằng các công cụ bên dưới.', '모델을 클릭해 본 관절을 놓으세요. Shift+클릭: 이전 본에 연결. Ctrl+클릭: 클릭한 조각도 포함.'))
  }

  /** a free bone at the clicked point (half way into the model, so it sits inside the part) */
  /**
   * Symmetry for free bones: every bone on one side (the side with more bones, +X = left on a tie) gets a twin on
   * the other side, mirrored across the model's middle; twins that exist already are moved to the mirrored spot.
   * Names follow: arm / arm_L -> arm_R, wing.L -> wing.R, LeftEar -> RightEar; parents are mirrored too.
   */
  public mirror_bones (): number {
    const box = new THREE.Box3(); this.parts.forEach(p => box.expandByObject(p.mesh)); if (box.isEmpty()) return 0
    const c = box.getCenter(new THREE.Vector3()).x; const eps = Math.max(1e-4, this.size.x * 0.03)
    const bones = this.mechs.filter(m => m.kind === 'bone' && m.pivot !== undefined)
    const side = (m: Mech): number => { const d = m.pivot![0] - c; return d > eps ? 1 : d < -eps ? -1 : 0 }
    const src = bones.filter(m => side(m) > 0).length >= bones.filter(m => side(m) < 0).length ? 1 : -1
    const SW: Array<[RegExp, string, string]> = [[/_L$/, '_L', '_R'], [/_R$/, '_R', '_L'], [/\.L$/, '.L', '.R'], [/\.R$/, '.R', '.L'], [/_l$/, '_l', '_r'], [/_r$/, '_r', '_l'], [/^Left/, 'Left', 'Right'], [/^Right/, 'Right', 'Left'], [/^left/, 'left', 'right'], [/^right/, 'right', 'left']]
    const twin = (n: string): string | null => { for (const [re, , b] of SW) if (re.test(n)) return n.replace(re, b); return null }
    const rename = new Map<string, string>()
    // bones without a side in their name get one
    for (const m of bones) if (side(m) === src && twin(m.name) === null) { const n = m.name + (src > 0 ? '_L' : '_R'); rename.set(m.name, n) }
    for (const m of this.mechs) { const r = rename.get(m.name); if (r !== undefined) m.name = r; if (m.parent !== undefined && rename.has(m.parent)) m.parent = rename.get(m.parent) }
    let n = 0
    for (const m of bones.filter(b => side(b) === src)) {
      const tn = twin(m.name)!; const p = m.pivot!
      const parent = m.parent !== undefined ? (twin(m.parent) !== null && this.mechs.some(x => x.name === m.parent && side(x) === src) ? twin(m.parent)! : m.parent) : undefined
      const t = this.mechs.find(x => x.name === tn)
      const piv: [number, number, number] = [2 * c - p[0], p[1], p[2]]
      if (t !== undefined) { t.pivot = piv; if (parent !== undefined) t.parent = parent } else this.mechs.push({ ...m, name: tn, pivot: piv, ...(parent !== undefined ? { parent } : {}) })
      n++
    }
    if (n > 0) { this.clear_rig(); this.name_parts(); this.refresh_part_select(); this.draw_bone_marks(); this.draw_markers() }
    this.status(M(`Mirrored ${n} bone(s) to the other side.`, `Đã đối xứng ${n} xương sang bên kia.`, `${n}개 본 대칭`))
    return n
  }

  private place_bone (e: PointerEvent): void {
    if (this.rig !== null) this.clear_rig()
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const meshes = this.parts.map(p => p.mesh)
    const hits = ray.intersectObjects(meshes, false)
    const h = hits[0]; if (h === undefined) return
    const dir = ray.ray.direction
    const exit = hits.find(x => x.distance > h.distance + 1e-4 && x.face !== null && x.face !== undefined && x.face.normal.clone().transformDirection(x.object.matrixWorld).dot(dir) > 0)
    const P = exit !== undefined && exit.distance - h.distance < this.size.length() * 0.4 ? h.point.clone().add(exit.point).multiplyScalar(0.5) : h.point.clone()
    const input = $('vh-bone-name') as HTMLInputElement
    let name = input.value.trim().replace(/\s+/g, '_')
    if (name === '' || this.mechs.some(m => m.name === name)) { let k = this.mechs.filter(m => m.kind === 'bone').length + 1; while (this.mechs.some(m => m.name === `bone_${k}`)) k++; name = name === '' ? `bone_${k}` : `${name}_${k}` }
    const parent = e.shiftKey && this.mechs.some(m => m.name === this.last_bone) ? this.last_bone : undefined
    this.mechs.push({ kind: 'bone', name, hinge: 'auto', angle: default_angle('bone'), flip: false, axis: 'auto', pivot: [P.x, P.y, P.z], ...(parent !== undefined ? { parent } : {}) })
    this.last_bone = name
    this.active = DOOR0 + this.mechs.length - 1
    if (e.ctrlKey || e.metaKey) {
      const part = this.parts.find(p => p.mesh === h.object)
      if (part !== undefined && h.face !== null && h.face !== undefined) {
        const comp = this.components(part); const c = comp[h.face.a]
        for (let i = 0; i < comp.length; i++) if (comp[i] === c) part.owner[i] = this.active
      }
    }
    input.value = ''
    this.name_parts(); this.refresh_part_select(); this.refresh_colors()
    this.status(M(`Bone "${name}"${parent !== undefined ? ` (child of ${parent})` : ''}. Select its area (Piece / Box / Lasso / Brush), or keep clicking.`, `Xương "${name}"${parent !== undefined ? ` (con của ${parent})` : ''}. Chọn vùng của nó (Khối / Khung / Lasso / Cọ), hoặc bấm tiếp.`, `본 "${name}". 영역을 선택하세요.`))
  }

  /**
   * Caterpillar belts: per side, the points in a thin band around the hull of that side's wheels that are not
   * inside a wheel (works when the whole tank is one block). Separate link pieces are taken whole.
   */
  public find_tracks (): number {
    let made = 0
    for (const side of [1, -1]) {
      if (this.mechs.some(m => m.kind === 'track' && (m.name.endsWith('_L') ? 1 : -1) === side)) continue
      const ws = this.wheels.filter(w => (w.center.x >= 0 ? 1 : -1) === side && Math.abs(w.center.x) > this.size.x * 0.12)
      const band = wheel_band(ws); if (band === null) continue
      const code = DOOR0 + this.mechs.length
      let n = 0; const v = new THREE.Vector3()
      for (const p of this.parts) {
        const pos = p.mesh.geometry.getAttribute('position')
        const comp = this.components(p)
        const tot = new Map<number, number>(); const hit = new Map<number, number>()
        const ok = new Uint8Array(pos.count)
        for (let i = 0; i < pos.count; i++) {
          tot.set(comp[i], (tot.get(comp[i]) ?? 0) + 1)
          if (p.owner[i] !== -1) continue
          v.fromBufferAttribute(pos, i)
          if (on_belt(v, ws, band)) { ok[i] = 1; hit.set(comp[i], (hit.get(comp[i]) ?? 0) + 1) }
        }
        for (let i = 0; i < pos.count; i++) {
          if (p.owner[i] !== -1) continue
          const c = comp[i]; const whole = (hit.get(c) ?? 0) / (tot.get(c) ?? 1) > 0.6 && (tot.get(c) ?? 0) < pos.count * 0.4
          if (whole || ok[i] === 1) { p.owner[i] = code; n++ }
        }
      }
      // a belt goes all the way round: most of the loop (including the run under the wheels) must have points
      const bins = new Uint8Array(24)
      this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (p.owner[i] === code) bins[Math.min(23, Math.floor(band.loop.param([pos.getZ(i), pos.getY(i)]) / band.loop.len * 24))] = 1 })
      const cover = bins.reduce((a, b) => a + b, 0) / 24
      if (n < 30 || cover < 0.75) { this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) if (p.owner[i] === code) p.owner[i] = -1 }); continue }
      this.mechs.push({ kind: 'track', name: side > 0 ? 'track_L' : 'track_R', hinge: 'auto', angle: 0, flip: false })
      made++
    }
    if (made > 0) {
      if (this.vtype !== 'tracked') { this.vtype = 'tracked'; ($('vh-type') as HTMLSelectElement).value = 'tracked' }
      this.clear_rig(); this.active = DOOR0 + this.mechs.length - 1
      this.name_parts(); this.refresh_part_select(); this.refresh_colors()
    }
    this.status(made > 0
      ? M(`Found ${made} track(s). They run round the wheels in the drive animations. Fix the area with the tools if needed.`, `Tìm thấy ${made} dải xích. Xích sẽ chạy vòng quanh bánh trong animation chạy. Sửa vùng bằng công cụ nếu cần.`, `트랙 ${made}개 발견.`)
      : M('No track found: mark the wheels first (at least 2 per side), or make a ⛓ Track part and select it yourself.', 'Không thấy xích: cần có bánh trước (ít nhất 2 bánh mỗi bên), hoặc tạo phần ⛓ Xích rồi tự chọn vùng.', '트랙 없음: 먼저 바퀴를 표시하세요.'), made === 0)
    return made
  }

  /**
   * 🪄 Auto cut: finds the parts by their SHAPE (what the samples and test vehicles taught):
   *   wheels   separate round pieces near the ground on the sides (a bucket or a cab is not round)
   *   tracks   a belt round 2+ wheels in a row on each side
   *   blade / bucket  a wide low piece sticking out in front of (or behind) the body; long bars from the body to it = its arms (boom)
   *   turret + gun    a tracked vehicle: a piece on top of the hull with a long thin gun in it
   *   rotor    a flat wide disc at the very top (helicopter)
   * Each found piece becomes its own part; parts welded to the body are cut out with the holes filled.
   */
  public auto_cut (): string[] {
    if (this.parts.length === 0) return []
    this.history.begin()
    this.scan_wheels()
    const cmemo = new Map<Part, Int32Array>() // pieces do not change while parts are only re-owned
    const comps = (p: Part): Int32Array => { let c = cmemo.get(p); if (c === undefined) { c = this.components(p); cmemo.set(p, c) } return c }
    const found: string[] = []
    if (this.wheels.length > 0) found.push(M(`${this.wheels.length} wheels`, `${this.wheels.length} bánh`, `바퀴 ${this.wheels.length}`))
    const S = this.size; const side_n = (sd: number): number => this.wheels.filter(w => Math.sign(w.center.x) === sd && Math.abs(w.center.x) > S.x * 0.12).length
    if (!this.mechs.some(m => m.kind === 'track') && side_n(1) >= 2 && side_n(-1) >= 2) {
      const m0 = this.mechs.length
      this.find_tracks()
      // a real belt runs along the ground between its wheels and is its own pieces next to them; a car's side or an open frame only looks like one
      for (let j = this.mechs.length - 1; j >= m0; j--) {
        const code = DOOR0 + j; let own = 0; let local = 0
        this.parts.forEach(p => {
          const comp = comps(p); const pos = p.mesh.geometry.getAttribute('position'); const wide = new Map<number, [number, number]>()
          for (let i = 0; i < comp.length; i++) { const x = pos.getX(i); const r = wide.get(comp[i]); if (r === undefined) wide.set(comp[i], [x, x]); else { r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x) } }
          for (let i = 0; i < comp.length; i++) { if (p.owner[i] !== code) continue; own++; const r = wide.get(comp[i])!; if (r[1] - r[0] < S.x * 0.35) local++ }
        })
        // …or a belt welded into the hull: it runs along the ground UNDER and between the wheels (a car has air there)
        const ws = this.wheels.filter(w => Math.sign(w.center.x) === (this.mechs[j].name.endsWith('_L') ? 1 : -1))
        const r = ws.reduce((a, w) => a + w.radius, 0) / Math.max(1, ws.length)
        const z0 = Math.min(...ws.map(w => w.center.z)); const z1 = Math.max(...ws.map(w => w.center.z)); const bins = new Uint8Array(16)
        this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < p.owner.length; i++) { if (p.owner[i] !== code) continue; const z = pos.getZ(i); if (pos.getY(i) < r * 0.15 && z > z0 && z < z1) bins[Math.min(15, Math.floor((z - z0) / (z1 - z0 || 1) * 16))] = 1 } })
        const ground = bins.reduce((a, b) => a + b, 0) / 16
        if (own === 0 || ground < 0.7 || (local / own < 0.7 && ground < 0.8)) {
          this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) { if (p.owner[i] === code) p.owner[i] = -1; else if (p.owner[i] > code) p.owner[i]-- } })
          this.mechs.splice(j, 1)
        }
      }
      const n = this.mechs.length - m0
      if (n > 0) found.push(M(`${n} tracks`, `${n} dải xích`, `트랙 ${n}`))
      else if (!this.mechs.some(m => m.kind === 'track')) { this.vtype = 'car'; ($('vh-type') as HTMLSelectElement).value = 'car' }
    }
    // the separate pieces still on the body
    interface Piece { p: Part, c: number, box: THREE.Box3, n: number }
    const pieces: Piece[] = []; const v = new THREE.Vector3()
    this.parts.forEach(p => {
      const comp = comps(p); const pos = p.mesh.geometry.getAttribute('position'); const m = new Map<number, Piece>()
      for (let i = 0; i < comp.length; i++) { if (p.owner[i] !== -1) continue; let e = m.get(comp[i]); if (e === undefined) { e = { p, c: comp[i], box: new THREE.Box3(), n: 0 }; m.set(comp[i], e) } e.box.expandByPoint(v.fromBufferAttribute(pos, i)); e.n++ }
      m.forEach(e => pieces.push(e))
    })
    if (pieces.length < 2) {
      this.after_auto(found)
      return found
    }
    const vol = (b: THREE.Box3): number => { const z = b.getSize(new THREE.Vector3()); return z.x * z.y * z.z }
    const core = pieces.reduce((a, b) => vol(b.box) > vol(a.box) ? b : a)
    const cb = core.box; const cs = cb.getSize(new THREE.Vector3())
    const take = (list: Piece[], kind: MechKind, name: string, extra: Partial<Mech> = {}): void => {
      if (list.length === 0) return
      let nm = name; while (this.mechs.some(m => m.name === nm)) nm += '_'
      const code = DOOR0 + this.mechs.length
      this.mechs.push({ kind, name: nm, hinge: 'auto', angle: default_angle(kind), flip: false, axis: 'auto', ...extra })
      ;(this.mechs[this.mechs.length - 1] as any).named = true
      const comp_of = new Map<Part, Int32Array>()
      list.forEach(e => { let comp = comp_of.get(e.p); if (comp === undefined) { comp = comps(e.p); comp_of.set(e.p, comp) } for (let i = 0; i < comp.length; i++) if (comp[i] === e.c && e.p.owner[i] === -1) e.p.owner[i] = code })
      list.forEach(e => pieces.splice(pieces.indexOf(e), 1))
    }
    // front / back tool: wide, low, sticking out past the body
    let tool: Piece | null = null; let tool_end = 0
    for (const end of this.mechs.some(m => m.kind === 'blade' || m.kind === 'bucket') ? [] : [1, -1]) { // the file already names its blade / bucket
      const out = pieces.filter(e => e !== core && (end > 0 ? e.box.max.z > cb.max.z + cs.z * 0.05 && e.box.getCenter(v).z > cb.max.z - cs.z * 0.1 : e.box.min.z < cb.min.z - cs.z * 0.05 && e.box.getCenter(v).z < cb.min.z + cs.z * 0.1) &&
        e.box.getSize(new THREE.Vector3()).x > S.x * 0.55 && e.box.min.y < S.y * 0.35)
      const best = out.sort((a, b) => b.box.getSize(v).x - a.box.getSize(v).x)[0]
      if (best !== undefined && (tool === null || best.box.getSize(new THREE.Vector3()).x > tool.box.getSize(new THREE.Vector3()).x)) { tool = best; tool_end = end }
    }
    if (tool !== null) {
      // a bucket is often several plates: every piece touching it out there joins it
      const group = [tool]; const tb = tool.box.clone()
      for (let grow = true; grow;) {
        grow = false
        for (const e of pieces) {
          if (group.includes(e) || e === core) continue
          const c = e.box.getCenter(new THREE.Vector3()); const past = tool_end > 0 ? c.z > cb.max.z - cs.z * 0.05 : c.z < cb.min.z + cs.z * 0.05
          if (past && e.box.intersectsBox(tb.clone().expandByScalar(S.length() * 0.01))) { group.push(e); tb.union(e.box); grow = true }
        }
      }
      tb.expandByScalar(S.length() * 0.03)
      // its arms: long bars along the length that reach from the body to the tool
      const arms = pieces.filter(e => { if (group.includes(e) || e === core) return false; const z = e.box.getSize(new THREE.Vector3()); return z.z > Math.max(z.x, z.y) * 2.5 && (this.vtype === 'tracked' || (e.box.max.y > S.y * 0.35 && z.z > S.z * 0.25)) && e.box.intersectsBox(tb) && e.box.clone().expandByScalar(S.length() * 0.02).intersectsBox(cb) })
      const end = tool_end > 0 ? '' : '_rear'
      if (arms.length > 0) {
        take(arms, 'boom', 'lift_arms' + end)
        take(group, 'bucket', 'bucket' + end, { parent: this.mechs[this.mechs.length - 1].name })
        found.push(M('bucket + lift arms', 'gàu xúc + tay nâng', '버킷 + 리프트 암'))
      } else if (this.vtype === 'tracked') { take(group, 'blade', 'blade' + end); found.push(M('blade', 'lưỡi ủi', '블레이드')) }
    }
    // turret + gun (tracked): a long thin piece in the upper half, and the piece it sits in
    if (this.vtype === 'tracked' && !this.mechs.some(m => m.kind === 'turret')) {
      const gun = pieces.filter(e => { const z = e.box.getSize(new THREE.Vector3()); return e !== core && z.z > S.z * 0.25 && z.x < z.z * 0.2 && z.y < z.z * 0.2 && e.box.min.y > S.y * 0.4 }).sort((a, b) => b.box.getSize(v).z - a.box.getSize(v).z)[0]
      if (gun !== undefined) {
        const gb = gun.box.clone().expandByScalar(S.length() * 0.02)
        const tur = pieces.filter(e => { const z = e.box.getSize(new THREE.Vector3()); return e !== gun && e !== core && e.box.intersectsBox(gb) && z.x > S.x * 0.3 && z.x / z.z > 0.5 && z.x / z.z < 2 && e.box.min.y > S.y * 0.3 }).sort((a, b) => vol(b.box) - vol(a.box))[0]
        if (tur !== undefined) {
          take([tur], 'turret', 'turret'); take([gun], 'barrel', 'barrel', { parent: 'turret' })
          found.push(M('turret + gun', 'tháp pháo + nòng', '포탑 + 포신'))
        }
      }
    }
    // rotor: a flat wide disc at the very top
    const rotor = pieces.filter(e => { const z = e.box.getSize(new THREE.Vector3()); return e !== core && e.box.max.y > S.y * 0.92 && z.y < Math.max(z.x, z.z) * 0.12 && Math.max(z.x, z.z) > S.z * 0.5 })[0]
    if (rotor !== undefined && !this.mechs.some(m => m.kind === 'spin')) { take([rotor], 'spin', 'rotor', { axis: 'y', angle: 100 }); found.push(M('rotor', 'cánh quạt', '로터')) }
    this.after_auto(found)
    return found
  }

  /* ---------------- ⚡ auto rig + keyframes, and learning from rated rigs ---------------- */
  private sig (): number[] { return signature(this.parts.map(p => p.mesh.geometry), this.size) }
  /** box of every part (wheel k / DOOR0 + j) in vehicle space */
  private owner_boxes (): Map<number, THREE.Box3> {
    const m = new Map<number, THREE.Box3>(); const v = new THREE.Vector3()
    this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < p.owner.length; i++) { const o = p.owner[i]; if (o < 0) continue; let b = m.get(o); if (b === undefined) { b = new THREE.Box3(); m.set(o, b) } b.expandByPoint(v.fromBufferAttribute(pos, i)) } })
    return m
  }
  /** body vertices inside the box become part `code`; returns how many */
  private claim (box: THREE.Box3, code: number): number {
    let n = 0; const v = new THREE.Vector3(); const b = box.clone().expandByScalar(this.size.length() * 0.01)
    this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < p.owner.length; i++) if (p.owner[i] === -1 && b.containsPoint(v.fromBufferAttribute(pos, i))) { p.owner[i] = code; n++ } })
    return n
  }

  /** ⚡ Auto rig: what was learned for this shape + the shape scan → bones and all the animations in one click */
  public auto_rig (): string[] {
    if (this.parts.length === 0) return []
    const hit = recall(this.sig())
    if (hit !== null) { this.vtype = hit.rec.type as VehicleType; ($('vh-type') as HTMLSelectElement).value = this.vtype }
    const found = this.auto_cut()
    if (hit === null) { this.status(M(`⚡ Auto rig: ${found.join(', ') || 'nothing found by shape'} + ${this.clips.length} animations. Rate it below (★) — rigs rated 4–5 ★ teach the next auto rig.`, `⚡ Tự rig: ${found.join(', ') || 'không tìm được theo hình dạng'} + ${this.clips.length} animation. Chấm điểm bên dưới (★) — rig được 4–5 ★ sẽ dạy cho lần tự rig sau.`, `⚡ 자동 리그 + 애니메이션 ${this.clips.length}개`), found.length === 0); return found }
    // what the scan missed, and the settings people tuned on that shape
    this.history.begin()
    const S = this.size; const have = this.owner_boxes(); const added: string[] = []; let tuned = 0
    for (const pr of hit.rec.parts) {
      const want = box_of(pr.box, S)
      if (pr.kind === 'wheel') {
        const c = new THREE.Vector3(pr.wheel!.c[0] * S.x, pr.wheel!.c[1] * S.y, pr.wheel!.c[2] * S.z); const r = pr.wheel!.r * S.y
        if (this.wheels.some(w => w.center.distanceTo(c) < Math.max(r, w.radius) * 0.6)) continue
        const k = this.wheels.length
        if (this.claim(want, k) === 0) continue
        this.wheels.push({ name: pr.name, center: c, radius: r, front: pr.wheel!.front, guessed: false }); added.push(pr.name)
      } else {
        const j = this.mechs.findIndex((m, jj) => m.kind === pr.kind && iou(have.get(DOOR0 + jj) ?? new THREE.Box3(), want) > 0.25)
        if (j >= 0) { Object.assign(this.mechs[j], pr.mech); if (pr.mech?.parent !== undefined && !this.mechs.some(m => m.name === pr.mech!.parent)) delete this.mechs[j].parent; tuned++; continue }
        const code = DOOR0 + this.mechs.length
        if (this.claim(want, code) === 0) continue
        let nm = pr.name; while (this.mechs.some(m => m.name === nm)) nm += '_'
        this.mechs.push({ kind: pr.kind as MechKind, name: nm, hinge: 'auto', angle: default_angle(pr.kind as MechKind), flip: false, axis: 'auto', ...pr.mech })
        ;(this.mechs[this.mechs.length - 1] as any).named = true
        added.push(nm)
      }
    }
    // a parent that is not on this vehicle would break the bone tree
    this.mechs.forEach(m => { if (m.parent !== undefined && !this.mechs.some(q => q.name === m.parent)) delete m.parent })
    this.after_auto(found)
    this.status(M(`⚡ Auto rig used what was learned from "${hit.rec.file}" (★${hit.rec.score}, ${Math.round(hit.sim * 100)}% same shape): type ${hit.rec.type}${added.length > 0 ? `, + ${added.join(', ')}` : ''}${tuned > 0 ? `, ${tuned} part settings` : ''}. ${this.clips.length} animations ready. Rate this one too (★).`,
      `⚡ Tự rig đã dùng điều học được từ "${hit.rec.file}" (★${hit.rec.score}, giống hình ${Math.round(hit.sim * 100)}%): loại ${hit.rec.type}${added.length > 0 ? `, thêm ${added.join(', ')}` : ''}${tuned > 0 ? `, chỉnh ${tuned} bộ phận` : ''}. Có ${this.clips.length} animation. Chấm điểm rig này nữa nhé (★).`, `⚡ 학습된 리그 사용 (★${hit.rec.score})`))
    return found
  }

  /** the user's score for the rig on screen: stored with the shape so the next auto rig can use it */
  private rate (score: number): void {
    if (this.parts.length === 0 || (this.wheels.length === 0 && this.mechs.length === 0)) { this.status(M('Rig the vehicle first, then rate it.', 'Rig xe trước rồi mới chấm điểm.', '먼저 리그하세요.'), true); return }
    const S = this.size; const boxes = this.owner_boxes(); const parts: PartRec[] = []
    this.wheels.forEach((w, k) => { const b = boxes.get(k); if (b === undefined) return; parts.push({ kind: 'wheel', name: w.name, box: nbox(b, S), wheel: { c: [+(w.center.x / S.x).toFixed(4), +(w.center.y / S.y).toFixed(4), +(w.center.z / S.z).toFixed(4)], r: +(w.radius / S.y).toFixed(4), front: w.front } }) })
    this.mechs.forEach((m, j) => { const b = boxes.get(DOOR0 + j); if (b === undefined) return; const { pivot: _p, name: _n, kind: _k, ...rest } = m; parts.push({ kind: m.kind, name: m.name, box: nbox(b, S), mech: JSON.parse(JSON.stringify(rest)) }) })
    const good = remember({ file: this.model_name || 'vehicle', score, type: this.vtype as RecType, sig: this.sig(), parts })
    document.querySelectorAll<HTMLButtonElement>('[data-vh-star]').forEach(b => { b.textContent = Number(b.dataset.vhStar) <= score ? '★' : '☆' })
    this.status(score >= MIN_SCORE
      ? M(`★${score} saved. ${good} good rigs in memory: the next vehicle of this shape is rigged like this one by ⚡ Auto rig.`, `Đã lưu ★${score}. Bộ nhớ có ${good} rig tốt: lần sau xe có hình dạng giống sẽ được ⚡ Tự rig theo rig này.`, `★${score} 저장`)
      : M(`★${score} saved. Only rigs rated ${MIN_SCORE}–5 ★ are used for the next ones — fix the parts and rate again.`, `Đã lưu ★${score}. Chỉ rig được ${MIN_SCORE}–5 ★ mới được dùng cho lần sau — sửa bộ phận rồi chấm lại.`, `★${score} 저장`))
    this.mem_info()
  }
  private mem_info (): void {
    const el = document.getElementById('vh-mem-info'); if (el === null) return
    const all = load_mem(); const good = all.filter(r => r.score >= MIN_SCORE).length
    el.textContent = M(`Memory: ${all.length} rated rigs, ${good} used for learning (4–5 ★).`, `Bộ nhớ: ${all.length} rig đã chấm, ${good} rig dùng để học (4–5 ★).`, `메모리: ${all.length}개, 학습용 ${good}개`)
  }

  private after_auto (found: string[]): void {
    this.clear_rig(); this.name_parts(); this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
    const cut = this.cut_torn_parts(true)
    this.history.commit_soon()
    if (this.wheels.length > 0 || this.mechs.length > 0) { this.build_rig(); const k = this.clips.findIndex(c => /drive|forward|cruise/i.test(c.name)); if (this.clips.length > 0) this.play(k >= 0 ? k : 0) }
    this.status(found.length > 0
      ? M(`🪄 Auto cut found: ${found.join(', ')}${cut > 0 ? ` (${cut} cut out of the body, holes filled)` : ''}. Wrong? Click the part and press another number (1–8), or ⬚ 4 points.`, `🪄 Tự cắt đã tìm thấy: ${found.join(', ')}${cut > 0 ? ` (${cut} phần được cắt khỏi thân, đã vá lỗ)` : ''}. Sai chỗ nào: bấm vào phần đó rồi chọn lại (phím 1–8), hoặc ⬚ 4 điểm.`, `🪄 자동 분할: ${found.join(', ')}.`)
      : M('🪄 Nothing found by shape: the model is one welded block. Use ⬚ 4 points on each part.', '🪄 Không tìm được theo hình dạng: model là một khối dính liền. Dùng ⬚ 4 điểm cho từng phần.', '🪄 형태로 찾지 못했습니다.'), found.length === 0)
  }

  private analysis_view: THREE.Group | null = null
  /**
   * Any model (creature, robot, prop…): find its anchors and make a chain of free bones along every branch
   * (tail, wings, ears, cape, legs…). Vehicles get the wheel / track scan instead.
   */
  public analyze_model (make_bones = true): Analysis | null {
    if (this.parts.length === 0) return null
    if (this.rig !== null) this.clear_rig()
    const a = analyze(this.parts.map(p => p.mesh.geometry))
    if (this.analysis_view !== null) this.scene.remove(this.analysis_view)
    this.analysis_view = draw_analysis(a); this.scene.add(this.analysis_view)
    if (a.type === 'vehicle') {
      this.scan_wheels()
      this.status(M(`Analysis: vehicle. ${a.branches.length} anchor(s). Wheels scanned; for tanks press ⛓ Find tracks.`, `Phân tích: xe. ${a.branches.length} điểm neo. Đã quét bánh; xe xích bấm ⛓ Tìm xích.`, `분석: 차량.`))
      return a
    }
    if (make_bones) {
      // not a vehicle: the automatic wheel scan only found round-ish lumps, give them back to the body
      if (this.wheels.length > 0) {
        this.parts.forEach(p => { for (let i = 0; i < p.owner.length; i++) { const o = p.owner[i]; if (o >= 0 && o < DOOR0) p.owner[i] = -1 } })
        this.wheels = []; this.draw_markers()
      }
      for (const b of a.branches) {
        const pts = b.joints.slice(0, -1) // joints along the branch, tip excluded: each is a bone's pivot
        if (pts.length === 0) continue
        let parent: string | undefined
        const codes: number[] = []
        pts.forEach((p, i) => {
          let name = i === 0 ? b.name : `${b.name}_${i + 1}`
          while (this.mechs.some(m => m.name === name)) name += '_'
          this.mechs.push({ kind: 'bone', name, hinge: 'auto', angle: default_angle('bone'), flip: false, axis: 'auto', pivot: [p.x, p.y, p.z], ...(parent !== undefined ? { parent } : {}) })
          parent = name; codes.push(DOOR0 + this.mechs.length - 1)
        })
        const seg = [...pts, b.tip]
        const bi = a.branches.indexOf(b)
        const ln = new THREE.Line3(); const q = new THREE.Vector3(); const v = new THREE.Vector3()
        this.parts.forEach((part, pi) => {
          const lab = a.labels[pi]; const pos = part.mesh.geometry.getAttribute('position')
          for (let i = 0; i < pos.count; i++) {
            if (lab[i] !== bi || part.owner[i] !== -1) continue
            v.fromBufferAttribute(pos, i)
            let best = 0; let bd = Infinity
            for (let k = 0; k < codes.length; k++) { ln.set(seg[k], seg[k + 1]); ln.closestPointToPoint(v, true, q); const d = q.distanceToSquared(v); if (d < bd) { bd = d; best = k } }
            part.owner[i] = codes[best]
          }
        })
      }
      this.active = this.mechs.length > 0 ? DOOR0 + this.mechs.length - 1 : this.active
      this.name_parts(); this.refresh_part_select(); this.refresh_colors()
    }
    const kinds = a.branches.map(b => b.name).join(', ')
    this.status(M(`Analysis: ${a.type}, ${a.branches.length} branch(es): ${kinds}. ${make_bones ? 'A bone chain was made on each; check them, then ⚙ Build rig.' : ''}`,
      `Phân tích: ${({ humanoid: 'người', quadruped: 'thú 4 chân', object: 'vật thể', vehicle: 'xe' } as Record<string, string>)[a.type]}, ${a.branches.length} nhánh: ${kinds}. ${make_bones ? 'Đã tạo chuỗi xương cho từng nhánh; kiểm tra rồi bấm ⚙ Gắn xương.' : ''}`,
      `분석: ${a.type}, 가지 ${a.branches.length}개: ${kinds}.`))
    return a
  }

  /** cut the selected part out into its own mesh and close the holes on both sides */
  public separate_selected (): void {
    const k = this.active; if (k < 0) return
    if (this.rig !== null) this.clear_rig()
    const out: Part[] = []; let holes = 0; let cut = 0
    for (const p of this.parts) {
      const any = p.owner.some(o => o === k); const all = p.owner.every(o => o === k)
      if (!any || all) { out.push(p); continue }
      const g = p.mesh.geometry
      g.setAttribute('gbowner', new THREE.BufferAttribute(Float32Array.from(p.owner), 1))
      const r = split_by_vertices(g, i => p.owner[i] === k, true)
      g.deleteAttribute('gbowner')
      holes += r.holes; cut++
      const mk = (geo: THREE.BufferGeometry, name: string): Part => {
        const own = geo.getAttribute('gbowner'); const o = new Int16Array(own.count)
        for (let i = 0; i < own.count; i++) o[i] = Math.round(own.getX(i))
        geo.deleteAttribute('gbowner'); geo.computeBoundingBox(); geo.computeBoundingSphere()
        const m = new THREE.Mesh(geo, p.mesh.material); m.name = name
        this.original_materials.set(m, this.original_materials.get(p.mesh) ?? p.mesh.material)
        this.holder.add(m)
        return { mesh: m, owner: o }
      }
      this.holder.remove(p.mesh)
      out.push(mk(r.outside, p.mesh.name), mk(r.inside, this.part_name(k)))
    }
    this.parts = out; this.comp_cache.clear()
    this.refresh_colors()
    this.status(cut === 0
      ? M('Nothing to cut: select an area for this part first.', 'Chưa có gì để tách: chọn vùng cho phần này trước.', '자를 영역이 없습니다.')
      : M(`Separated "${this.part_name(k)}" into its own mesh, ${holes} hole(s) filled.`, `Đã tách "${this.part_name(k)}" thành mesh riêng, đã fill ${holes} lỗ.`, `"${this.part_name(k)}" 분리, 구멍 ${holes}개 채움.`))
  }

  private pause_toggle (): void {
    if (this.mixer === null) return
    this.mixer.timeScale = this.mixer.timeScale === 0 ? 1 : 0
    $('vh-pause').textContent = this.mixer.timeScale === 0 ? M('▶ Play', '▶ Chạy', '▶ 재생') : M('⏸ Pause', '⏸ Tạm dừng', '⏸ 일시정지')
  }

  private stop_anim (): void {
    if (this.mixer === null) return
    this.current?.stop(); this.mixer.stopAllAction(); this.current = null; this.mixer.timeScale = 1
    $('vh-anims').querySelectorAll('.vh-anim').forEach(b => b.classList.remove('on'))
    $('vh-pause').textContent = M('⏸ Pause', '⏸ Tạm dừng', '⏸ 일시정지')
  }

  /** choose a wheel or door (from the list, a click on the model, or after creating it) */
  private select (code: number): void {
    this.active = code
    this.refresh_part_select(); this.refresh_colors(); this.draw_markers()
  }

  /* ---------------- 🛞 axle panel: which way the picked wheel turns (its pink ring), lock it, turn the wheel with it ---------------- */
  private axle_panel (): void {
    let el = document.getElementById('vh-axle')
    const k = this.active; const w = k >= 0 && k < DOOR0 ? this.wheels[k] : undefined
    if (w === undefined) { if (el !== null) el.style.display = 'none'; return }
    if (el === null) {
      el = document.createElement('div'); el.id = 'vh-axle'
      el.style.cssText = 'position:absolute;left:8px;top:48px;z-index:15;display:flex;flex-direction:column;gap:5px;padding:8px 10px;border-radius:10px;background:rgba(20,22,26,.92);border:1px solid #ff2bd6;font-size:12px;max-width:300px'
      $('vh-view').appendChild(el)
      el.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ax],[data-axr],[data-axa]'); if (b === null) return
        if (b.dataset.ax !== undefined) this.set_axle(b.dataset.ax)
        if (b.dataset.axr !== undefined) this.turn_wheel(b.dataset.axr as 'x' | 'y' | 'z')
        if (b.dataset.axa === 'lock') this.lock_axle()
      })
    }
    const a = w.axle ?? new THREE.Vector3(1, 0, 0); const on = (v: string): string => (v === 'x' && Math.abs(a.x) > 0.9) || (v === 'y' && Math.abs(a.y) > 0.9) || (v === 'z' && Math.abs(a.z) > 0.9) ? 'background:#ff2bd6;color:#fff' : ''
    const B = (attr: string, t: string, tip: string, st = ''): string => `<button type="button" ${attr} title="${tip}" style="font-size:12px;padding:3px 7px;${st}">${t}</button>`
    el.innerHTML = `<b style="color:#ff7be6">🛞 ${this.part_name(k)} — ${M('spin axle (pink ring)', 'trục quay (khung hồng)', '회전축')}</b>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${B('data-ax="x"', 'X', M('Axle along X', 'Trục theo X', 'X'), on('x'))}${B('data-ax="y"', 'Y', M('Axle along Y', 'Trục theo Y', 'Y'), on('y'))}${B('data-ax="z"', 'Z', M('Axle along Z', 'Trục theo Z', 'Z'), on('z'))}${B('data-ax="next"', '⟲ (Z)', M('Turn the ring to the next axis (key Z)', 'Xoay khung sang trục kế (phím Z)', '다음 축 (Z)'))}${B('data-ax="flip"', '⇄', M('Spin the other way', 'Quay chiều ngược lại', '반대'))}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center"><span>${M('Turn wheel + ring 90°', 'Xoay bánh + khung 90°', '바퀴+링 90°')}</span>${B('data-axr="x"', '↻X', 'X')}${B('data-axr="y"', '↻Y', 'Y')}${B('data-axr="z"', '↻Z', 'Z')}</div>
      ${B('data-axa="lock"', w.locked === true ? '🔒 ' + M('Grouped (click to unlock)', 'Đã gom (bấm để mở)', '고정됨') : '🔗 ' + M('Group wheel + ring (lock the axle)', 'Gom bánh + khung (khoá trục)', '바퀴+링 고정'), M('The axle stays as you set it: auto scans and fixes leave it alone', 'Trục giữ đúng như bạn chỉnh: tự quét / tự sửa không đụng vào', '자동으로 바뀌지 않음'), w.locked === true ? 'background:#2a6f3a;color:#fff' : 'border-color:#ff2bd6')}`
    el.style.display = 'flex'
  }
  /** the picked wheel's axle: 'x' | 'y' | 'z', 'next' (the next axis round, also key Z) or 'flip' */
  public set_axle (how: string): void {
    const k = this.active; const w = this.wheels[k]; if (w === undefined || k >= DOOR0) return
    this.history.begin(); this.clear_rig()
    const a = w.axle?.clone() ?? new THREE.Vector3(1, 0, 0)
    if (how === 'flip') a.negate()
    else if (how === 'next') { const i = Math.abs(a.x) > 0.9 ? 0 : Math.abs(a.z) > 0.9 ? 1 : 2; const n = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)][i]; a.copy(n) }
    else a.set(how === 'x' ? 1 : 0, how === 'y' ? 1 : 0, how === 'z' ? 1 : 0)
    w.axle = a; w.locked = true // set by hand: the auto passes keep it
    this.draw_markers(); this.history.commit_soon()
  }
  public lock_axle (): void { const w = this.wheels[this.active]; if (w === undefined || this.active >= DOOR0) return; this.history.begin(); w.locked = w.locked !== true; this.axle_panel(); this.history.commit_soon() }
  /** turn the picked wheel's mesh and its axle together by 90° round its centre (to fit it on the vehicle) */
  public turn_wheel (axis: 'x' | 'y' | 'z'): void {
    const k = this.active; const w = this.wheels[k]; if (w === undefined || k >= DOOR0) return
    this.history.begin(); this.clear_rig()
    const R = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), Math.PI / 2)
    const c = w.center.clone(); const v = new THREE.Vector3()
    // fresh meshes for the ones that change, so Ctrl+Z gets the old ones back
    this.parts = this.parts.map(p => {
      if (!p.owner.some(o => o === k)) return p
      const m = new THREE.Mesh(p.mesh.geometry.clone(), p.mesh.material); m.name = p.mesh.name
      this.original_materials.set(m, this.original_materials.get(p.mesh) ?? p.mesh.material)
      this.holder.remove(p.mesh); this.holder.add(m)
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) if (p.owner[i] === k) { v.fromBufferAttribute(pos, i).sub(c).applyMatrix4(R).add(c); pos.setXYZ(i, v.x, v.y, v.z) }
      pos.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere()
      return { mesh: m, owner: Int16Array.from(p.owner) }
    })
    this.comp_cache.clear()
    if (w.axle !== undefined) w.axle = w.axle.clone().applyMatrix4(R).normalize()
    w.locked = true
    this.refresh_colors(); this.draw_markers(); this.history.commit_soon()
  }

  private color_of (code: number): number {
    return code >= DOOR0 ? DOOR_COLORS[(code - DOOR0) % DOOR_COLORS.length] : WHEEL_COLORS[code % WHEEL_COLORS.length]
  }

  private refresh_colors (): void {
    this.parts.forEach(p => {
      const g = p.mesh.geometry; const n = p.owner.length
      const q = this.qsel.get(p)
      if (!this.show_regions && q === undefined) { p.mesh.material = this.original_materials.get(p.mesh) ?? p.mesh.material; return }
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
        if (q !== undefined && q[i] === 1) c.set(0xff2bd6)
        else if (!this.show_regions) c.set(0xb4b4b4)
        else if (seam[i] === 1 && o >= 0) c.set(0xffe14d)
        else if (o >= 0) { c.set(this.color_of(o)); if (o !== this.active) c.lerp(new THREE.Color(0x9a9a9a), 0.35) }
        else c.set(0x9a9a9a)
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      p.mesh.material = this.region_material
    })
  }

  /** wheel rings: [ smaller, ] bigger, O hide / show */
  private ring_scale = 1
  private draw_markers (): void {
    this.axle_panel()
    this.markers.clear()
    this.wheels.forEach((w, k) => {
      const on = k === this.active
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w.radius * 1.08 * this.ring_scale, w.radius * (on ? 0.07 : 0.04) * Math.min(1, this.ring_scale * 1.5), 8, 40), new THREE.MeshBasicMaterial({ color: WHEEL_COLORS[k % WHEEL_COLORS.length], depthTest: false, transparent: true, opacity: on ? 1 : 0.6 }))
      // the ring lies in the wheel's own plane (around its axle), pushed a little outwards
      const ax = w.axle ?? new THREE.Vector3(1, 0, 0)
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax)
      // on the wheel's own outer face (snug on the wheel / its track), whichever side it is on
      const side = Math.sign(w.center.dot(ax) || 1); const wb = this.part_box(k)
      const half = wb.isEmpty() ? 0 : Math.abs(wb.getSize(new THREE.Vector3()).dot(ax)) / 2
      ring.position.copy(w.center).addScaledVector(ax, side * (half + this.size.x * 0.01))
      ring.userData.face = ax.clone().multiplyScalar(side) // which way this ring looks (to the outside)
      ring.renderOrder = 10; ring.userData.on = on
      this.markers.add(ring)
    })
  }

  private set_brush (m: Tool): void {
    if (m !== null && this.placing) { this.placing = false; document.getElementById('vh-place-bones')?.classList.remove('on') }
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
      (this.brush_mode?.startsWith('pen') === true || this.brush_mode === 'quad' ? this.poly.map((p, i) => `<circle cx="${p.x - v.left}" cy="${p.y - v.top}" r="${i === 0 ? 6 : 3.5}" fill="${i === 0 ? col : '#fff'}" stroke="${col}"/>`).join('') : '')
  }

  private finish_poly (): void {
    const pts = this.poly; this.poly = []; this.draw_poly()
    if (pts.length < 3) return
    this.select_screen(this.brush_mode === 'lasso_add' || this.brush_mode === 'pen_add', pts)
  }

  /* ---------------- ✂ quick cut: select a piece (click, 4 points, circle), then X detach · G drag out · Delete remove ---------------- */
  private readonly qsel = new Map<Part, Uint8Array>()
  private grab: { start: THREE.Vector3, plane: THREE.Plane, orig: Map<Part, Float32Array> } | null = null
  private q_count (): number { let n = 0; this.qsel.forEach(q => { for (let i = 0; i < q.length; i++) n += q[i] }); return n }
  public q_clear (): void { this.qsel.clear(); this.refresh_colors(); this.q_menu_hide() }
  /** after a selection: a small menu at the mouse — what is it? (wheel, door, hood, trunk…) */
  private q_menu_at: { x: number, y: number } | null = null
  private q_menu_hide (): void { const el = document.getElementById('vh-qmenu'); if (el !== null) el.style.display = 'none' }
  private q_menu (): void {
    let el = document.getElementById('vh-qmenu')
    if (el === null) {
      el = document.createElement('div'); el.id = 'vh-qmenu'
      el.style.cssText = 'position:absolute;z-index:20;display:none;flex-direction:column;gap:4px;padding:8px;border-radius:10px;background:rgba(28,28,28,.96);border:1px solid #ff2bd6;box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:12px;max-width:250px'
      $('vh-view').appendChild(el)
    }
    if (this.q_count() === 0 || this.q_menu_at === null) { el.style.display = 'none'; return }
    const b = (c: typeof CHOICES[number], k: string): string => `<button type="button" data-qc="${c.k}" style="font-size:12px;padding:5px 6px;display:flex;gap:5px;align-items:center;text-align:left"><span style="font-size:15px">${c.icon}</span>${M(c.en, c.vi, c.en)}<i style="opacity:.55;font-style:normal;margin-left:auto">${k}</i></button>`
    el.innerHTML = `<div style="color:#ff7be6;font-weight:700">${M('What is this part?', 'Đây là bộ phận gì?', '이 부품은?')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${CHOICES.map((c, n) => b(c, String(n + 1))).join('')}</div>
      <select data-qmore style="font-size:12px"><option value="">${M('Something else…', 'Bộ phận khác…', '기타…')}</option>${PRESETS.map((p, i) => `<option value="${i}">${p.icon} ${p.label}</option>`).join('')}<option value="bone">🦴 ${M('Free bone', 'Xương tự do', '자유 본')}</option></select>
      <select data-qattach style="font-size:12px"><option value="">🔗 ${M('Attach to a part…', 'Gắn vào bộ phận…', '부품에 붙이기…')}</option><option value="-1">${M('Body (no animation)', 'Thân xe (không animation)', '차체')}</option>${this.wheels.map((_w, i) => `<option value="${i}">🛞 ${this.part_name(i)}</option>`).join('')}${this.mechs.map((_m, i) => `<option value="${DOOR0 + i}">⚙ ${this.part_name(DOOR0 + i)}</option>`).join('')}</select>
      <div style="display:flex;gap:4px"><button type="button" data-qa="g" style="flex:1;font-size:12px;padding:4px">✋ ${M('Drag out', 'Kéo ra', '끌기')} (G)</button><button type="button" data-qa="del" style="flex:1;font-size:12px;padding:4px">🗑 ${M('Remove', 'Xoá', '삭제')}</button><button type="button" data-qa="x" style="font-size:12px;padding:4px">✕</button></div>`
    const v = $('vh-view').getBoundingClientRect()
    // it fits in the view (taller than the room: it scrolls), next to the mouse
    const visTop = Math.max(0, -v.top); const visH = Math.min(v.height, innerHeight - v.top) - visTop // the part of the view on the screen
    el.style.maxHeight = `${Math.max(160, visH - 16)}px`; el.style.overflowY = 'auto'; el.style.display = 'flex'
    const h = el.offsetHeight
    el.style.left = `${Math.min(v.width - 260, Math.max(4, this.q_menu_at.x - v.left + 14))}px`; el.style.top = `${Math.max(visTop + 8, Math.min(visTop + visH - h - 8, this.q_menu_at.y - v.top + 14))}px`
    el.querySelectorAll<HTMLButtonElement>('[data-qc]').forEach(x => { x.onclick = () => { this.q_choose(x.dataset.qc!) } })
    ;(el.querySelector('[data-qmore]') as HTMLSelectElement).onchange = (e) => { const v2 = (e.target as HTMLSelectElement).value; if (v2 === '') return; this.history.begin(); this.q_detach('part', v2 === 'bone' ? { icon: '🦴', label: 'Bone', kind: 'bone' } : PRESETS[Number(v2)]); this.history.commit_soon() }
    ;(el.querySelector('[data-qattach]') as HTMLSelectElement).onchange = (e) => { const v2 = (e.target as HTMLSelectElement).value; if (v2 !== '') this.q_attach(Number(v2)) }
    el.querySelectorAll<HTMLButtonElement>('[data-qa]').forEach(x => { x.onclick = () => { const a = x.dataset.qa; if (a === 'g') { this.history.begin(); this.q_grab_start() } else if (a === 'del') this.q_delete(); else this.q_clear(); this.q_menu_hide() } })
  }
  /** a choice of the "what is this part?" menu (or its number key) */
  public q_choose (k: string): void {
    const c = CHOICES.find(x => x.k === k); if (c === undefined || this.q_count() === 0) return
    this.history.begin()
    // a door / hood / trunk takes its window glass and handles with it (separate pieces inside its outline)
    if (c.preset.kind === 'door') this.q_grow_inside()
    this.q_detach('part', c.preset)
    if (c.preset.kind === 'track' && this.vtype !== 'tracked') { this.vtype = 'tracked'; ($('vh-type') as HTMLSelectElement).value = 'tracked' }
    this.history.commit_soon()
    this.rig_and_show(c.preset.kind)
  }
  /** 🔗 the selection joins a part that is already there (a hubcap back onto its wheel, a mirror onto its door) and moves with it */
  public q_attach (code: number): void {
    if (this.q_count() === 0) return
    this.history.begin(); this.q_menu_hide(); this.clear_rig()
    this.qsel.forEach((q, p) => { for (let i = 0; i < q.length; i++) if (q[i] === 1) p.owner[i] = code })
    this.qsel.clear(); this.active = code
    this.after_paint(); this.refresh_colors(); this.history.commit_soon()
    this.status(M(`Attached to ${code < 0 ? 'the body' : this.part_name(code)}. Ctrl+Z / Cmd+Z undoes it.`, `Đã gắn vào ${code < 0 ? 'thân xe' : this.part_name(code)}. Ctrl+Z / Cmd+Z để hoàn tác.`, '붙였습니다.'))
    if (code >= 0) this.rig_and_show(code < DOOR0 ? 'wheel' : this.mechs[code - DOOR0]?.kind ?? '')
  }
  /** after a cut / attach: build the rig and play the animation that shows that kind of part move */
  private rig_and_show (kind: string): void {
    setTimeout(() => {
      try { this.build_rig() } catch (e) { console.warn('Greenbox vehicle rig:', e); return }
      const want: Record<string, RegExp> = { wheel: /^04_Drive$|Drive/, door: /door|open/i, track: /Drive/, spin: /drill|spin|work/i, turret: /turret|turn|aim/i, blade: /blade|dig|lift/i, boom: /boom|lift|crane/i, arm: /dig|arm|bucket/i, bucket: /dig|bucket/i, barrel: /fire|shoot|recoil/i }
      const re = want[kind] ?? /Drive/
      const i = this.clips.findIndex(c => re.test(c.name)); this.play(i >= 0 ? i : 0)
    }, 60)
  }
  /** add every separate piece that lies inside the selection's box (glass of a door, its handle, its mirror) */
  private q_grow_inside (): void {
    const b = new THREE.Box3(); const v = new THREE.Vector3()
    this.qsel.forEach((q, p) => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < q.length; i++) if (q[i] === 1) b.expandByPoint(v.fromBufferAttribute(pos, i)) })
    if (b.isEmpty()) return
    const big = b.clone().expandByVector(b.getSize(new THREE.Vector3()).multiplyScalar(0.06))
    let added = 0
    this.parts.forEach(p => {
      let comp = this.comp_cache.get(p); if (comp === undefined) { comp = this.components(p); this.comp_cache.set(p, comp) }
      const pos = p.mesh.geometry.getAttribute('position'); const boxes = new Map<number, THREE.Box3>()
      for (let i = 0; i < comp.length; i++) { let cb = boxes.get(comp[i]); if (cb === undefined) { cb = new THREE.Box3(); boxes.set(comp[i], cb) } cb.expandByPoint(v.fromBufferAttribute(pos, i)) }
      let q = this.qsel.get(p)
      boxes.forEach((cb, id) => {
        if (!big.containsBox(cb)) return
        if (q === undefined) { q = new Uint8Array(p.owner.length); this.qsel.set(p, q) }
        for (let i = 0; i < comp!.length; i++) if (comp![i] === id && q[i] === 0) { q[i] = 1; added++ }
      })
    })
    if (added > 0) this.refresh_colors()
  }
  private q_hint (): void {
    this.q_menu()
    const n = this.q_count()
    this.status(n === 0 ? M('Nothing selected.', 'Chưa chọn gì.', '선택 없음.')
      : M(`${n} points selected (pink). Pick what it is in the menu (it gets a rig and plays its animation) or 🔗 attach it to a part · drag it (or G) = pull it off · Delete = remove · Shift+drag / Shift+click = add more · Ctrl/Cmd+Z = undo · Esc = clear`,
        `Đã chọn ${n} điểm (màu hồng). Chọn nó là gì trong menu (tự gắn rig và chạy animation) hoặc 🔗 gắn vào bộ phận có sẵn · kéo nó (hoặc G) = kéo đứt ra · Delete = xoá · Shift+kéo / Shift+bấm = chọn thêm · Ctrl/Cmd+Z = hoàn tác · Esc = bỏ chọn`,
        `${n}개 선택. X 분리 · Shift+X 바퀴 · G 끌기 · Delete 삭제 · Esc 해제`))
  }
  /** click: the connected piece under the cursor (Shift adds) */
  private q_piece (e: PointerEvent, add: boolean): void {
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const h = ray.intersectObjects(this.parts.map(p => p.mesh), false)[0]
    if (!add) this.qsel.clear()
    if (h === undefined || h.face == null) { this.refresh_colors(); return }
    const p = this.parts.find(x => x.mesh === h.object); if (p === undefined) return
    let comp = this.comp_cache.get(p); if (comp === undefined) { comp = this.components(p); this.comp_cache.set(p, comp) }
    const id = comp[h.face.a]; let q = this.qsel.get(p); if (q === undefined) { q = new Uint8Array(p.owner.length); this.qsel.set(p, q) }
    let n = 0
    // a part found already (a wheel = tyre + rim + hub, a door…): one click takes all of it, in every mesh
    const own = [h.face.a, h.face.b, h.face.c].map(i => p.owner[i]).find(o => o >= 0)
    if (own !== undefined) {
      this.parts.forEach(pp => { let qq = this.qsel.get(pp); for (let i = 0; i < pp.owner.length; i++) if (pp.owner[i] === own) { if (qq === undefined) { qq = new Uint8Array(pp.owner.length); this.qsel.set(pp, qq) } qq[i] = 1; n++ } })
      this.refresh_colors(); this.q_hint(); return
    }
    for (let i = 0; i < comp.length; i++) if (comp[i] === id) { q[i] = 1; n++ }
    this.refresh_colors(); this.q_hint()
    if (n > p.owner.length * 0.6 && this.parts.length === 1) this.status(M('That piece is the whole welded model: cut a part out with ⬚ 4 points or ◯ circle instead.', 'Mảnh này là cả model dính liền: hãy cắt bằng ⬚ 4 điểm hoặc ◯ khoanh tròn.', '모델 전체입니다: 4점 / 원으로 자르세요.'), true)
  }
  /** cut the selection out of its meshes (holes filled): returns the new pieces, fully selected */
  private q_cut (): void {
    const out: Part[] = []; const nsel = new Map<Part, Uint8Array>()
    for (const p of this.parts) {
      const q = this.qsel.get(p); if (q === undefined || !q.some(v => v === 1)) { out.push(p); continue }
      if (q.every(v => v === 1)) { out.push(p); nsel.set(p, q); continue }
      const g = p.mesh.geometry
      g.setAttribute('gbowner', new THREE.BufferAttribute(Float32Array.from(p.owner), 1))
      const r = split_by_vertices(g, i => q[i] === 1, true)
      g.deleteAttribute('gbowner')
      const mk = (geo: THREE.BufferGeometry, name: string): Part => {
        const own = geo.getAttribute('gbowner'); const o = new Int16Array(own.count)
        for (let i = 0; i < own.count; i++) o[i] = Math.round(own.getX(i))
        geo.deleteAttribute('gbowner'); geo.computeBoundingBox(); geo.computeBoundingSphere()
        const m = new THREE.Mesh(geo, p.mesh.material); m.name = name
        this.original_materials.set(m, this.original_materials.get(p.mesh) ?? p.mesh.material)
        this.holder.add(m); return { mesh: m, owner: o }
      }
      this.holder.remove(p.mesh)
      const a = mk(r.outside, p.mesh.name); const b = mk(r.inside, p.mesh.name + '_cut')
      out.push(a, b); nsel.set(b, new Uint8Array(b.owner.length).fill(1))
    }
    this.parts = out; this.comp_cache.clear(); this.qsel.clear(); nsel.forEach((v, k) => this.qsel.set(k, v))
  }
  /** X: the selection becomes its own part (kind from the list), cut out with its holes filled. Shift+X: a wheel */
  public q_detach (as: 'part' | 'wheel', preset?: Preset): void {
    if (this.q_count() === 0) return
    this.q_menu_hide()
    this.clear_rig(); this.q_cut()
    let code: number
    let was = -2; let same = true; this.qsel.forEach((q, p) => { for (let i = 0; i < q.length; i++) if (q[i] === 1) { if (was === -2) was = p.owner[i]; else if (p.owner[i] !== was) same = false } })
    if ((as === 'wheel' || preset?.kind === 'wheel') && same && was >= 0 && was < DOOR0) code = was // it is that wheel already
    else if (as === 'wheel' || preset?.kind === 'wheel') { this.wheels.push({ name: 'wheel_new', center: new THREE.Vector3(), radius: 0.1, front: false, guessed: false }); code = this.wheels.length - 1 }
    else {
      const kind = (preset?.kind as MechKind | undefined) ?? ((($('vh-part-kind') as HTMLSelectElement).value as MechKind) || 'bone')
      this.mechs.push({ kind, name: preset?.label === 'Drill' ? 'drill' : kind, hinge: preset?.hinge ?? 'auto', angle: preset?.angle ?? default_angle(kind), flip: false, axis: preset?.axis ?? 'auto' }); code = DOOR0 + this.mechs.length - 1
      if (preset?.label === 'Drill') (this.mechs[this.mechs.length - 1] as any).named = true
    }
    this.qsel.forEach((q, p) => { for (let i = 0; i < q.length; i++) if (q[i] === 1) p.owner[i] = code })
    this.qsel.clear(); this.active = code
    if (code < DOOR0) { const w = this.wheels[code]; const b = this.part_box(code); if (w !== undefined && !b.isEmpty()) { const sz = b.getSize(new THREE.Vector3()); w.center.copy(b.getCenter(new THREE.Vector3())); w.radius = Math.max(sz.y, sz.z) / 2; w.guessed = false; w.axle = this.wheel_axle(code); w.front = w.center.z > 0.05 * this.size.z; this.name_wheels() } }
    this.after_paint(); this.refresh_colors(); this.draw_markers()
    this.status(M(`Detached as ${this.part_name(code)} (its own mesh, holes filled). Change its kind / pivot below, or press G to drag it.`, `Đã tách thành ${this.part_name(code)} (mesh riêng, đã fill lỗ). Đổi loại / trục bên dưới, hoặc bấm G để kéo.`, `${this.part_name(code)}(으)로 분리.`))
  }
  /** Delete: the selected triangles leave the model (a lamp post, a house, the floor, a sign…) */
  public q_delete (): void {
    if (this.q_count() === 0) return
    this.history.begin(); this.clear_rig()
    const out: Part[] = []; let gone = 0
    for (const p of this.parts) {
      const q = this.qsel.get(p); if (q === undefined || !q.some(v => v === 1)) { out.push(p); continue }
      const g = p.mesh.geometry; const idx = g.getIndex()
      const vtx = (t: number, k: number): number => idx !== null ? idx.getX(t * 3 + k) : t * 3 + k
      g.setAttribute('gbowner', new THREE.BufferAttribute(Float32Array.from(p.owner), 1))
      const ng = subset(g, t => !(q[vtx(t, 0)] === 1 && q[vtx(t, 1)] === 1 && q[vtx(t, 2)] === 1))
      g.deleteAttribute('gbowner')
      this.holder.remove(p.mesh); gone++
      const own = ng.getAttribute('gbowner'); if (own === undefined || own.count === 0) continue
      const o = new Int16Array(own.count); for (let i = 0; i < own.count; i++) o[i] = Math.round(own.getX(i))
      ng.deleteAttribute('gbowner'); ng.computeBoundingBox(); ng.computeBoundingSphere()
      const m = new THREE.Mesh(ng, p.mesh.material); m.name = p.mesh.name
      this.original_materials.set(m, this.original_materials.get(p.mesh) ?? p.mesh.material)
      this.holder.add(m); out.push({ mesh: m, owner: o })
    }
    this.parts = out; this.comp_cache.clear(); this.qsel.clear()
    this.refresh_colors(); this.refresh_objects(); this.history.commit_soon()
    this.status(M(`Removed from the model (${gone} mesh(es) changed). Ctrl+Z brings it back.`, `Đã xoá khỏi model (${gone} mesh). Ctrl+Z để lấy lại.`, `삭제됨. Ctrl+Z로 복구.`))
  }
  /** G: drag the selected piece away from the body (cut out first), click / Enter = OK, Esc / right-click = cancel */
  private q_grab_start (): void {
    if (this.q_count() === 0) return
    this.clear_rig(); this.q_cut()
    // fresh geometry so Ctrl+Z gets the old place back
    const sel = new Map<Part, Uint8Array>()
    this.parts = this.parts.map(p => {
      const q = this.qsel.get(p); if (q === undefined) return p
      const m = new THREE.Mesh(p.mesh.geometry.clone(), p.mesh.material); m.name = p.mesh.name
      this.original_materials.set(m, this.original_materials.get(p.mesh) ?? p.mesh.material)
      this.holder.remove(p.mesh); this.holder.add(m); const np: Part = { mesh: m, owner: Int16Array.from(p.owner) }; sel.set(np, q); return np
    })
    this.qsel.clear(); sel.forEach((v, k) => this.qsel.set(k, v)); this.comp_cache.clear()
    const c = new THREE.Vector3(); let n = 0; const orig = new Map<Part, Float32Array>()
    this.qsel.forEach((q, p) => { const pos = p.mesh.geometry.getAttribute('position'); orig.set(p, Float32Array.from(pos.array as ArrayLike<number>)); for (let i = 0; i < q.length; i++) if (q[i] === 1) { c.x += pos.getX(i); c.y += pos.getY(i); c.z += pos.getZ(i); n++ } })
    c.divideScalar(Math.max(1, n))
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), c)
    this.grab = { start: c, plane, orig }; this.refresh_colors()
    this.status(M('Move the mouse to drag the piece · click / Enter = OK · Esc / right-click = cancel', 'Rê chuột để kéo mảnh · bấm / Enter = xong · Esc / chuột phải = huỷ', '마우스로 끌기 · 클릭 확인 · Esc 취소'))
  }
  /** is the mouse on a selected (pink) bit of the model? */
  private on_selection (e: PointerEvent): boolean {
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const h = ray.intersectObjects(this.parts.map(p => p.mesh), false)[0]; if (h === undefined || h.face == null) return false
    const p = this.parts.find(x => x.mesh === h.object); const q = p !== undefined ? this.qsel.get(p) : undefined
    return q !== undefined && (q[h.face.a] === 1 || q[h.face.b] === 1 || q[h.face.c] === 1)
  }
  /** the drag starts where the mouse is (the piece does not jump to it) */
  private grab_from (e: PointerEvent): void {
    const g = this.grab; if (g === null) return
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const hit = ray.ray.intersectPlane(g.plane, new THREE.Vector3()); if (hit !== null) g.start.copy(hit)
    this.status(M('Pulling it off: release the mouse to drop it · Ctrl/Cmd+Z puts it back', 'Đang kéo ra: thả chuột để đặt · Ctrl/Cmd+Z để gắn lại chỗ cũ', '떼어내는 중: 놓으면 배치 · Ctrl/Cmd+Z 복구'))
  }
  private q_grab_move (e: PointerEvent): void {
    const g = this.grab; if (g === null) return
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const hit = ray.ray.intersectPlane(g.plane, new THREE.Vector3()); if (hit === null) return
    const d = hit.sub(g.start)
    this.qsel.forEach((q, p) => {
      const pos = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute; const o = g.orig.get(p)!
      for (let i = 0; i < q.length; i++) if (q[i] === 1) pos.setXYZ(i, o[i * 3] + d.x, o[i * 3 + 1] + d.y, o[i * 3 + 2] + d.z)
      pos.needsUpdate = true; p.mesh.geometry.computeBoundingBox(); p.mesh.geometry.computeBoundingSphere()
    })
  }
  private q_grab_end (ok: boolean): void {
    const g = this.grab; if (g === null) return
    if (!ok) this.qsel.forEach((_q, p) => { const pos = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute; pos.array.set(g.orig.get(p)!); pos.needsUpdate = true; p.mesh.geometry.computeBoundingBox(); p.mesh.geometry.computeBoundingSphere() })
    this.grab = null; this.history.commit_soon()
    // wheels that moved keep their rings and pivots on them
    this.wheels.forEach((w, k) => { const b = this.part_box(k); if (!b.isEmpty()) w.center.copy(b.getCenter(new THREE.Vector3())) })
    this.after_paint(); this.refresh_colors()
    this.status(ok ? M('Moved. Ctrl+Z puts it back.', 'Đã kéo ra. Ctrl+Z để trả lại chỗ cũ.', '이동됨.') : M('Cancelled.', 'Đã huỷ.', '취소됨.'))
  }
  /** circle tool: drag from the centre */
  private draw_circle (e: PointerEvent): void {
    if (this.box_start === null) return
    const v = $('vh-view').getBoundingClientRect(); const el = this.box_el(); const r = Math.hypot(e.clientX - this.box_start.x, e.clientY - this.box_start.y)
    el.style.left = `${this.box_start.x - r - v.left}px`; el.style.top = `${this.box_start.y - r - v.top}px`; el.style.width = el.style.height = `${2 * r}px`
    el.style.borderRadius = '50%'; el.style.borderColor = '#ff2bd6'; el.style.display = 'block'
  }
  private finish_circle (e: PointerEvent): void {
    const st = this.box_start!; this.hide_box(); this.box_el().style.borderRadius = '0'
    const r = Math.hypot(e.clientX - st.x, e.clientY - st.y); if (r < 4) return
    const pts = Array.from({ length: 36 }, (_, i) => ({ x: st.x + Math.cos(i / 36 * Math.PI * 2) * r, y: st.y + Math.sin(i / 36 * Math.PI * 2) * r }))
    this.select_screen(true, pts, true)
  }

  /* ---------------- 🧹 objects of the file: remove what is not the vehicle (or bring back what was dropped) ---------------- */
  private dropped: Part[] = []
  public refresh_objects (): void {
    const el = document.getElementById('vh-objects'); if (el === null) return
    const row = (p: Part, i: number, gone: boolean): string => `<div class="row" style="gap:4px;flex-wrap:nowrap"><span class="sm" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${gone ? 'text-decoration:line-through;opacity:.6' : ''}" title="${p.mesh.name}">${p.mesh.name || 'mesh'} · ${p.owner.length}</span>${gone ? `<button data-obj-back="${i}" title="Bring back">↺</button>` : `<button data-obj-sel="${i}" title="Select (then X / G / Delete)">◎</button><button data-obj-del="${i}" title="Remove">✕</button>`}</div>`
    el.innerHTML = this.parts.map((p, i) => row(p, i, false)).join('') + this.dropped.map((p, i) => row(p, i, true)).join('')
    el.querySelectorAll<HTMLButtonElement>('[data-obj-del]').forEach(b => { b.onclick = () => { const p = this.parts[Number(b.dataset.objDel)]; if (p === undefined) return; this.history.begin(); this.clear_rig(); this.holder.remove(p.mesh); this.parts = this.parts.filter(x => x !== p); this.dropped.push(p); this.comp_cache.clear(); this.refresh_objects(); this.history.commit_soon() } })
    el.querySelectorAll<HTMLButtonElement>('[data-obj-back]').forEach(b => { b.onclick = () => { const p = this.dropped[Number(b.dataset.objBack)]; if (p === undefined) return; this.history.begin(); this.dropped = this.dropped.filter(x => x !== p); this.holder.add(p.mesh); this.parts.push(p); this.comp_cache.clear(); this.refresh_colors(); this.refresh_objects(); this.history.commit_soon() } })
    el.querySelectorAll<HTMLButtonElement>('[data-obj-sel]').forEach(b => { b.onclick = () => { const p = this.parts[Number(b.dataset.objSel)]; if (p === undefined) return; this.qsel.clear(); this.qsel.set(p, new Uint8Array(p.owner.length).fill(1)); this.refresh_colors(); this.q_hint() } })
    const cnt = document.getElementById('vh-objects-count'); if (cnt !== null) cnt.textContent = String(this.parts.length)
    const vg = document.getElementById('vh-vehicles')
    if (vg !== null) {
      vg.style.display = this.vehicle_groups.length > 1 ? '' : 'none'
      vg.innerHTML = this.vehicle_groups.length > 1 ? `<div class="sm">${M(`This file holds ${this.vehicle_groups.length} vehicles. Rig which one?`, `File này có ${this.vehicle_groups.length} xe. Rig chiếc nào?`, `차량 ${this.vehicle_groups.length}대`)}</div><div class="row">${this.vehicle_groups.map((g, k) => `<button type="button" data-vg="${k}" class="${k === this.pick_group ? 'on' : ''}" title="${g.join(', ')}">🚗 ${(g.find(n => /body/i.test(n)) ?? g[0]).replace(/_?body/i, '') || k + 1}</button>`).join('')}</div>` : ''
      vg.querySelectorAll<HTMLButtonElement>('[data-vg]').forEach(b => { b.onclick = () => this.use_vehicle(Number(b.dataset.vg)) })
    }
  }

  /**
   * add / remove every vertex whose screen position is inside the polygon (client px). Only the surface you can
   * SEE is taken (plus the part's thickness), unless "select through" is on.
   */
  private select_screen (add: boolean, poly: Array<{ x: number, y: number }>, quick = false): void {
    if (!quick && add && this.active < 0) { this.status(M('Pick or create a wheel / part first.', 'Chọn hoặc tạo bánh / bộ phận trước đã.', '먼저 바퀴/부품을 선택하거나 만드세요.'), true); return }
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
        if (quick) { let q = this.qsel.get(p); if (q === undefined) { q = new Uint8Array(p.owner.length); this.qsel.set(p, q) } if (q[i] === 0) { q[i] = 1; changed++ } continue }
        if (add) { if (p.owner[i] !== this.active) { p.owner[i] = this.active; changed++ } } else if (p.owner[i] === this.active || (this.active < 0 && p.owner[i] >= 0)) { p.owner[i] = -1; changed++ }
      }
    })
    if (quick) { this.refresh_colors(); this.q_hint(); return }
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
    if (this.rig === null) this.q_piece(e, e.shiftKey)
    const ray = new THREE.Raycaster(); ray.setFromCamera(this.ndc(e), this.camera)
    const hits = ray.intersectObjects(this.rig !== null ? this.rig.skinned : this.parts.map(p => p.mesh), false)
    const h = hits[0]; if (h === undefined || h.face == null) return
    const pi = this.rig !== null ? this.rig.skinned.indexOf(h.object as THREE.SkinnedMesh) : this.parts.findIndex(p => p.mesh === h.object)
    const p = this.parts[pi]; if (p === undefined) return
    const o = [h.face.a, h.face.b, h.face.c].map(i => p.owner[i]).find(x => x >= 0) ?? -1
    if (o < 0) { if (this.rig !== null) this.status(M('That is the body. Click a coloured wheel or door to select it.', 'Đó là thân xe. Bấm vào bánh hoặc cửa có màu để chọn.', '차체입니다. 색칠된 바퀴나 문을 클릭하세요.')); return }
    this.select(o)
    if (this.rig === null) { this.q_hint(); return }
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
    // cloned from a real rig: its hinge
    const cp = (m as any).clone_pivot as [number, number, number] | undefined
    if (pose !== null && cp !== undefined && m.kind !== 'track') pose.pivot.set(cp[0], cp[1], cp[2])
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
  /* ---------------- paint skin weights on the built rig (same tool as for characters) ---------------- */
  private wpaint: WeightPaint | null = null
  public paint_weights (on: boolean): boolean {
    if (this.wpaint === null) {
      this.wpaint = new WeightPaint({ camera: () => this.camera, dom: this.renderer.domElement, scene: this.scene, meshes: () => this.rig?.skinned ?? [], pause: (p) => { if (this.mixer !== null) this.mixer.timeScale = p ? 0 : 1 } })
    }
    const b = document.getElementById('vh-wpaint')
    if (on && this.rig === null && this.parts.length > 0) this.build_rig()
    if (!on || this.rig === null) { this.wpaint.stop(); if (b !== null) b.textContent = '🖌 ' + M('Paint skin weights', 'Paint skin weight', '스킨 웨이트 페인트'); return false }
    if (this.brush_mode !== null) this.set_brush(null)
    const ok = this.wpaint.start()
    if (b !== null) b.textContent = ok ? '✓ ' + M('Done painting', 'Xong paint', '페인트 완료') : '🖌 ' + M('Paint skin weights', 'Paint skin weight', '스킨 웨이트 페인트')
    if (!ok) this.status(M('Build the rig first (⚙).', 'Dựng rig trước (⚙).', '먼저 리그를 만드세요.'), true)
    return ok
  }

  private clear_rig (): void {
    this.wpaint?.stop()
    if (this.rig === null) return
    this.mixer?.stopAllAction(); this.mixer = null; this.current = null
    this.rig.skinned.forEach(m => this.holder.remove(m))
    this.holder.remove(this.rig.root)
    this.parts.forEach(p => { p.mesh.visible = true })
    this.rig = null
    if (this.bone_helper !== null) { this.scene.remove(this.bone_helper); this.bone_helper = null }
    $('vh-anims').innerHTML = ''
    $('vh-anim-box').classList.add('disabled')
  }

  /** (once, when the wheels are found) every wheel of a vehicle turns on the same axle direction: level and square to the line the wheels run along
   *  (from all the wheel centres), so a model placed a few degrees off still rolls straight along its tracks */
  /** a vehicle set a few degrees off the forward arrow (its wheel rows not along Z) drives off to one side:
   *  turn the whole model so the rows run straight along the arrow (only small turns: a big one is left to the person) */
  private square_up (): boolean {
    const W = this.wheels.filter(w => !w.guessed); if (W.length < 3) return false
    const c = new THREE.Vector3(); W.forEach(w => c.add(w.center)); c.divideScalar(W.length)
    let xx = 0; let zz = 0; let xz = 0; W.forEach(w => { const dx = w.center.x - c.x; const dz = w.center.z - c.z; xx += dx * dx; zz += dz * dz; xz += dx * dz })
    const a0 = 0.5 * Math.atan2(2 * xz, xx - zz); let f = new THREE.Vector3(Math.cos(a0), 0, Math.sin(a0))
    if (Math.abs(f.z) < Math.abs(f.x)) f = new THREE.Vector3(-f.z, 0, f.x)
    if (f.z < 0) f.negate()
    const a = Math.atan2(f.x, f.z); const deg = Math.abs(THREE.MathUtils.radToDeg(a))
    if (deg < 0.5 || deg > 20) return false
    this.rotate_model(-a)
    this.status(M(`Turned ${deg.toFixed(1)}° so the wheels run straight along the arrow (it was drifting to one side).`, `Đã xoay ${deg.toFixed(1)}° cho hàng bánh chạy thẳng theo mũi tên (trước đó xe bị quẹo lệch).`, `${deg.toFixed(1)}° 정렬`))
    return true
  }

  private unify_axles (): void {
    const W = this.wheels; if (W.length < 3) return
    const c = new THREE.Vector3(); W.forEach(w => c.add(w.center)); c.divideScalar(W.length)
    let xx = 0; let zz = 0; let xz = 0; W.forEach(w => { const dx = w.center.x - c.x; const dz = w.center.z - c.z; xx += dx * dx; zz += dz * dz; xz += dx * dz })
    const a = 0.5 * Math.atan2(2 * xz, xx - zz); let f = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) // the long way of the wheel layout
    // a vehicle's wheels spread front-to-back more than side-to-side; if not (a wide 4-wheel layout), take the axis nearer Z
    if (Math.abs(f.z) < Math.abs(f.x)) f = new THREE.Vector3(-f.z, 0, f.x)
    const ax = new THREE.Vector3(f.z, 0, -f.x).normalize(); if (ax.x < 0) ax.negate()
    for (const w of W) { if (w.locked === true) continue; const own = w.axle; if (own === undefined || Math.abs(own.dot(ax)) > Math.cos(THREE.MathUtils.degToRad(35))) w.axle = ax.clone() } // a wheel turned on purpose (steered, sideways) keeps its own
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
    // caterpillar belts: a chain of bones round the loop, each belt point skinned to its two nearest links
    const tracks: TrackRig[] = []
    const belt = new Map<Part, { a: Int32Array, b: Int32Array, w: Float32Array }>()
    const wr = this.wheels.length > 0 ? this.wheels.reduce((a, w) => a + w.radius, 0) / this.wheels.length : S.y * 0.2
    this.mechs.forEach((m, j) => {
      const tb = door_bone[j]; if (m.kind !== 'track' || tb === null) return
      const code = DOOR0 + j; const pts: P2[] = []; let xs = 0
      this.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (p.owner[i] === code) { pts.push([pos.getZ(i), pos.getY(i)]); xs += pos.getX(i) } })
      const loop = belt_loop(pts); if (loop === null) return
      const x = xs / pts.length
      // a belt made of separate link pieces: one bone per link, the piece rides it rigidly (blending a link
      // between two bones bends it round the sprocket = jagged, torn-looking teeth)
      const pieces = new Map<string, { p: Part, c: number, z: number, y: number, n: number }>()
      this.parts.forEach(p => {
        if (!p.owner.includes(code)) return
        const pos = p.mesh.geometry.getAttribute('position')
        let comp = this.comp_cache.get(p); if (comp === undefined || comp.length !== pos.count) { comp = this.components(p); this.comp_cache.set(p, comp) }
        for (let i = 0; i < pos.count; i++) {
          if (p.owner[i] !== code) continue
          const key = `${this.parts.indexOf(p)}:${comp[i]}`; let e = pieces.get(key); if (e === undefined) { e = { p, c: comp[i], z: 0, y: 0, n: 0 }; pieces.set(key, e) }
          e.z += pos.getZ(i); e.y += pos.getY(i); e.n++
        }
      })
      const plist = [...pieces.values()].map(e => ({ ...e, s: loop.param([e.z / e.n, e.y / e.n]) })).sort((a, b) => a.s - b.s)
      const rigid = m.links === undefined && plist.length >= 12 && plist.length <= 200 && plist.every(e => e.n < pts.length * 0.1)
      const N = rigid ? plist.length : m.links ?? Math.max(16, Math.min(64, Math.round(loop.len / (wr * 0.4))))
      const pivot = poses[j]!.pivot
      const links: THREE.Bone[] = []; const s0: number[] = []
      for (let i = 0; i < N; i++) {
        const s = rigid ? plist[i].s : i * loop.len / N; const at = loop.at(s)
        const b = new THREE.Bone(); b.name = `${m.name}_${String(i).padStart(2, '0')}`
        b.position.set(x - pivot.x, at.p[1] - pivot.y, at.p[0] - pivot.z); b.quaternion.copy(tangent_quat(at.t))
        tb.add(b); links.push(b); s0.push(s)
      }
      tracks.push({ links, s0, loop, x, pivot, side: x >= 0 ? 1 : -1 })
      const piece_of = new Map<string, number>(); plist.forEach((e, k) => piece_of.set(`${this.parts.indexOf(e.p)}:${e.c}`, k))
      ;(m as any).found_links = N
      this.parts.forEach(p => {
        const pos = p.mesh.geometry.getAttribute('position')
        let e = belt.get(p)
        for (let i = 0; i < pos.count; i++) {
          if (p.owner[i] !== code) continue
          if (e === undefined) { e = { a: new Int32Array(pos.count).fill(-1), b: new Int32Array(pos.count), w: new Float32Array(pos.count) }; belt.set(p, e) }
          if (rigid) { const k = piece_of.get(`${this.parts.indexOf(p)}:${this.comp_cache.get(p)![i]}`) ?? 0; e.a[i] = e.b[i] = this.bone_slot(links[k]); e.w[i] = 0; continue }
          const f = loop.param([pos.getZ(i), pos.getY(i)]) / loop.len * N
          const i0 = Math.floor(f) % N
          e.a[i] = this.bone_slot(links[i0]); e.b[i] = this.bone_slot(links[(i0 + 1) % N]); e.w[i] = f - Math.floor(f)
        }
      })
    })
    this.holder.add(root); root.updateMatrixWorld(true)
    const bones: THREE.Bone[] = [root, body, ...steers.filter((s): s is THREE.Bone => s !== null), ...wheels, ...mechs.map(d => d.bone), ...tracks.flatMap(t => t.links)]
    const link_bone = (id: number): THREE.Bone => this.slot_bones[id]
    const skeleton = new THREE.Skeleton(bones)
    const bi = (b: THREE.Bone): number => bones.indexOf(b)
    const skinned: THREE.SkinnedMesh[] = []
    this.parts.forEach(p => {
      const g = p.mesh.geometry.clone(); g.deleteAttribute('color')
      const n = p.owner.length
      const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const o = p.owner[i]
        const e = belt.get(p)
        if (e !== undefined && e.a[i] >= 0) { si[i * 4] = bi(link_bone(e.a[i])); sw[i * 4] = 1 - e.w[i]; si[i * 4 + 1] = bi(link_bone(e.b[i])); sw[i * 4 + 1] = e.w[i]; continue }
        const b = o >= DOOR0 ? (door_bone[o - DOOR0] ?? body) : o >= 0 ? (wheels[o] ?? body) : body
        si[i * 4] = bi(b); sw[i * 4] = 1
        // free bones are organic (tail, wing, ear, cape): blend with the parent around the joint
        const j = o - DOOR0
        if (o >= DOOR0 && this.mechs[j]?.kind === 'bone' && poses[j] !== null) {
          const pj = parent_of[j]; const pb = pj >= 0 ? door_bone[pj] : body
          const joint = poses[j]!.pivot; const from = pj >= 0 && poses[pj] !== null ? poses[pj]!.pivot : body.position
          const dir = joint.clone().sub(from); const L = dir.length()
          if (pb !== null && pb !== undefined && L > 1e-6) {
            dir.divideScalar(L)
            const pos = p.mesh.geometry.getAttribute('position')
            const x = (pos.getX(i) - joint.x) * dir.x + (pos.getY(i) - joint.y) * dir.y + (pos.getZ(i) - joint.z) * dir.z
            const r = L * 0.3; const t = Math.min(1, Math.max(0, (x + r) / (2 * r))); const ws = t * t * (3 - 2 * t)
            if (ws < 0.999) { sw[i * 4] = ws; si[i * 4 + 1] = bi(pb); sw[i * 4 + 1] = 1 - ws }
          }
        }
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
      const m = new THREE.SkinnedMesh(g, this.original_materials.get(p.mesh) ?? p.mesh.material)
      m.name = p.mesh.name; m.frustumCulled = false
      m.bind(skeleton)
      this.holder.add(m); skinned.push(m)
      p.mesh.visible = false
    })
    this.slot_bones = []
    this.rig = { root, body, wheels, steers, mechs, skinned, tracks }
    if (this.show_bones_on) this.show_bones(true)
    this.clips = [...this.make_clips(), ...this.clone_clips()]
    this.mixer = new THREE.AnimationMixer(this.holder)
    this.render_anim_list()
    $('vh-anim-box').classList.remove('disabled')
    this.play(0)
    const st = steers.filter(s => s !== null).length
    this.status(M(`Rig ready: body + ${wheels.length} wheels (${st} steering) + ${mechs.length} parts. ${this.clips.length} animations.`, `Đã gắn xương: thân + ${wheels.length} bánh (${st} bánh lái) + ${mechs.length} bộ phận. ${this.clips.length} animation.`, `리그 완료: 차체 + 바퀴 ${wheels.length}개 (조향 ${st}개) + 부품 ${mechs.length}개. 애니메이션 ${this.clips.length}개.`))
  }

  /** bones referenced before the skeleton exists (belt links), by a small id */
  private slot_bones: THREE.Bone[] = []
  private bone_slot (b: THREE.Bone): number { let i = this.slot_bones.indexOf(b); if (i < 0) { i = this.slot_bones.length; this.slot_bones.push(b) } return i }

  private render_anim_list (): void {
    $('vh-anims').innerHTML = this.clips.map((c, i) => `<button class="vh-anim" data-i="${i}">${c.name}</button>`).join('')
    $('vh-anims').querySelectorAll('.vh-anim').forEach(b => { (b as HTMLButtonElement).onclick = () => this.play(Number((b as HTMLElement).dataset.i)) })
  }

  private play (i: number): void {
    if (this.mixer === null || this.clips[i] === undefined) return
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
      const beltDist = R.tracks.map(() => 0)
      const beltWheel = R.tracks.map(tr => this.wheels.findIndex(w => (w.center.x >= 0 ? 1 : -1) === tr.side))
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
        R.tracks.forEach((tr, k) => {
          const wi = beltWheel[k]
          beltDist[k] += (wi >= 0 ? (p.wheel?.(wi) ?? speed) : speed) * (t - prevT)
          tr.links.forEach((lb, i) => {
            const at = tr.loop.at(tr.s0[i] + beltDist[k]); const q = tangent_quat(at.t)
            push(lb.name + '.position', tr.x - tr.pivot.x, at.p[1] - tr.pivot.y, at.p[0] - tr.pivot.z)
            push(lb.name + '.quaternion', q.x, q.y, q.z, q.w)
          })
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
