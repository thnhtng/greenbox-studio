/*
 * Map editor for the play test, in the spirit of old real-time-strategy map editors:
 *   terrain   a height grid you raise / lower / flatten / smooth with a brush, painted with ground types
 *             (grass, dirt, sand, rock, snow, road, water bed); water fills everything under the water level
 *   objects   click to place trees, rocks, houses, towers, walls, fences, crates… (low-poly, built in code)
 *   file      autosaved in the browser; save / load .json; export .glb, or a Blender .py that rebuilds the map
 *             natively in Blender (terrain mesh with vertex colours + every object, named, in one collection)
 * The terrain and objects live in the World's props, so the character walks on hills, bumps into houses
 * and climbs walls with the existing play-test physics.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { M } from '../common/lang.ts'
import { type World } from './World.ts'
import { load_any_buffer } from '../common/AnyLoader.ts'
import { type CameraRig, type Shot, LOOK_UP } from './CameraRig.ts'
import { type Plan, KIND_INFO } from './PlanEditor.ts'
import { form_outline, pad_picture } from './PlanForms.ts'
import { layout_to_map, main_colours, DEFAULT_LEGEND, KIND_LABEL, type LegendItem, type LayoutKind } from './LayoutImport.ts'

export type MapTool = 'none' | 'select' | 'raise' | 'lower' | 'flatten' | 'smooth' | 'paint' | 'place' | 'erase' | 'dig' | 'pour'
export const GROUND: Array<{ id: string, color: number, en: string, vi: string }> = [
  { id: 'grass', color: 0x6fa84a, en: 'Grass', vi: 'Cỏ' },
  { id: 'dirt', color: 0x8a6a45, en: 'Dirt', vi: 'Đất' },
  { id: 'sand', color: 0xd8c48a, en: 'Sand', vi: 'Cát' },
  { id: 'rock', color: 0x7d7d7d, en: 'Rock', vi: 'Đá' },
  { id: 'snow', color: 0xeef2f5, en: 'Snow', vi: 'Tuyết' },
  { id: 'road', color: 0x4b4b4f, en: 'Road', vi: 'Đường' },
  { id: 'mud', color: 0x5b4a36, en: 'Water bed', vi: 'Đáy nước' }
]
export const OBJECTS: Array<{ id: string, icon: string, en: string, vi: string, grid: boolean }> = [
  { id: 'pine', icon: '🌲', en: 'Pine', vi: 'Thông', grid: false },
  { id: 'tree', icon: '🌳', en: 'Tree', vi: 'Cây', grid: false },
  { id: 'bush', icon: '🌿', en: 'Bush', vi: 'Bụi', grid: false },
  { id: 'rock', icon: '🪨', en: 'Rock', vi: 'Đá', grid: false },
  { id: 'house', icon: '🏠', en: 'House', vi: 'Nhà', grid: true },
  { id: 'tower', icon: '🗼', en: 'Tower', vi: 'Tháp', grid: true },
  { id: 'wall', icon: '🧱', en: 'Wall', vi: 'Tường', grid: true },
  { id: 'fence', icon: '🚧', en: 'Fence', vi: 'Hàng rào', grid: true },
  { id: 'crate', icon: '📦', en: 'Crate', vi: 'Thùng', grid: true },
  { id: 'barrel', icon: '🛢', en: 'Barrel', vi: 'Thùng tròn', grid: false },
  { id: 'flag', icon: '🚩', en: 'Flag / spawn', vi: 'Cờ / điểm xuất phát', grid: true }
]

/** extra data of plan blocks / flow wires: size (w, h, d), colour, label, shape id, the 3D look, wire style */
export interface MapExtra { pid?: string, size?: [number, number, number], color?: string, label?: string, form?: string, model?: string, mode?: string, role?: string, image?: string, price?: number }
export interface MapObject { kind: string, p: [number, number, number], r: number, s: number, x?: MapExtra }
/** water poured into a hole / channel: grid points under the water and its level */
export interface Pool { level: number, cells: number[] }
export interface MapData { version: 1, n: number, cell: number, water: number, sea?: boolean, heights: number[], types: number[], objects: MapObject[], pools?: Pool[], shots?: Shot[], plan?: Plan, wires_hidden?: boolean }
const FILE_DB = 'gb-playtest-files'
function fdb (): Promise<IDBDatabase> { return new Promise((res, rej) => { const r = indexedDB.open(FILE_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }

const KEY = 'gb.playtest.map'

function lambert (c: number): THREE.MeshLambertMaterial { return new THREE.MeshLambertMaterial({ color: c, flatShading: true }) }

/** low-poly object made of primitives; pivot at the bottom centre */
/** 3D files added to the object palette: kind "file:<name>" -> the loaded model (pivot at the bottom centre) */
export const CUSTOM = new Map<string, THREE.Object3D>()
export const CUSTOM_CLIPS = new Map<string, THREE.AnimationClip[]>()

/** a word on a dark tag, floating over a block */
function label_sprite (text: string, y: number): THREE.Sprite {
  const c = document.createElement('canvas'); const g = c.getContext('2d')!; g.font = '700 44px system-ui,sans-serif'
  const w = Math.min(1024, Math.ceil(g.measureText(text).width) + 40); c.width = w; c.height = 72
  g.fillStyle = 'rgba(15,20,30,.72)'; g.beginPath(); g.roundRect(0, 0, w, 72, 18); g.fill()
  g.font = '700 44px system-ui,sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 38)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.renderOrder = 40
  sp.scale.set(w / 72 * 0.55, 0.55, 1); sp.position.y = y; sp.name = 'label'; sp.raycast = () => {} // sprites need a camera to be picked; labels are never picked
  return sp
}

/** one block of a 2D plan: a box / slab / cylinder of its size and colour, or a palette object / your file fitted in */
function build_block (g: THREE.Group, x: MapExtra): void {
  const [w, h, d] = x.size ?? [2, 1, 2]; const col = new THREE.Color(x.color ?? '#9ca3af')
  const mat = new THREE.MeshLambertMaterial({ color: col })
  let top = h
  if (x.model !== undefined && x.model !== '') {
    const inner = build_object(x.model); inner.userData.map_kind = undefined
    inner.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(inner); const sz = b.getSize(new THREE.Vector3())
    const k = Math.min(w / Math.max(1e-3, sz.x), d / Math.max(1e-3, sz.z)); inner.scale.setScalar(k); g.add(inner); top = sz.y * k
    const clips = CUSTOM_CLIPS.get(x.model); if (clips !== undefined) g.userData.clips = clips
  } else {
    const o = form_outline(x.form ?? 'rect')
    let geo: THREE.BufferGeometry
    if (x.form === 'ellipse') geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    else if (o !== null) {
      // the plan outline, pulled up into a prism (unit size, centred like the box)
      const sh = new THREE.Shape(o.map(([u, v]) => new THREE.Vector2(u, -v)))
      geo = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.translate(0, -0.5, 0)
    } else geo = new THREE.BoxGeometry(1, 1, 1)
    const m = new THREE.Mesh(geo, mat); m.scale.set(w, h, d); m.position.y = h / 2; m.castShadow = h > 0.2; m.receiveShadow = true; g.add(m)
    // pads ($ unlock / upgrade, stacks): their picture lies on top
    if (x.role === 'unlock' || x.role === 'stack') {
      const tex = x.image !== undefined && x.image !== '' ? new THREE.TextureLoader().load(x.image) : new THREE.CanvasTexture(pad_picture(x.role, x.color ?? '#bbf7d0', x.role === 'unlock' ? x.price : undefined))
      tex.colorSpace = THREE.SRGBColorSpace
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, d * 0.96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
      pic.rotation.x = -Math.PI / 2; pic.position.y = h + 0.012; pic.renderOrder = 2; g.add(pic)
    }
  }
  if ((x.label ?? '') !== '') g.add(label_sprite(x.label!, top + 0.55))
}

/** a flow wire on the ground: a belt (items ride on it) or a dashed path with an arrow (the player carries) */
function build_wire (g: THREE.Group, x: MapExtra): void {
  const L = x.size?.[0] ?? 2; const belt = x.mode === 'belt'
  const col = belt ? 0x55606e : x.mode === 'unlock' ? 0x16a34a : 0xffd23f
  const mat = new THREE.MeshLambertMaterial({ color: col })
  if (belt) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, 0.8), mat); m.position.y = 0.06; m.receiveShadow = true; g.add(m)
    const cm = new THREE.MeshBasicMaterial({ color: 0xcbd5e1 })
    for (let u = -L / 2 + 0.6; u < L / 2 - 0.3; u += 0.9) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), cm); c.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); c.position.set(u, 0.13, 0); c.scale.z = 0.2; g.add(c) }
  } else {
    for (let u = -L / 2; u < L / 2 - 0.9; u += 0.8) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.02, 0.18), mat); m.position.set(u + 0.25, 0.03, 0); m.raycast = () => {}; g.add(m) }
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 3), mat); head.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); head.position.set(L / 2 - 0.4, 0.04, 0); head.scale.z = 0.1; head.raycast = () => {}; g.add(head)
  }
}

export function build_object (kind: string, extra?: MapExtra): THREE.Group {
  const g = new THREE.Group(); g.name = kind; g.userData.map_kind = kind
  if (kind === 'block' || kind === 'wire') { g.userData.map_extra = extra ?? {}; if (kind === 'block') build_block(g, extra ?? {}); else build_wire(g, extra ?? {}); return g }
  if (kind.startsWith('file:')) {
    const t = CUSTOM.get(kind)
    if (t !== undefined) g.add(t.clone(true))
    else { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xbbbbbb, wireframe: true })); m.position.y = 0.5; g.add(m); g.userData.placeholder = true }
    return g
  }
  const add = (geo: THREE.BufferGeometry, c: number, x = 0, y = 0, z = 0, ry = 0): THREE.Mesh => { const m = new THREE.Mesh(geo, lambert(c)); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m }
  switch (kind) {
    case 'pine': add(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), 0x6b4a2b, 0, 0.6); add(new THREE.ConeGeometry(1.1, 2.2, 7), 0x2f6b3a, 0, 2.0); add(new THREE.ConeGeometry(0.8, 1.6, 7), 0x377a43, 0, 3.0); break
    case 'tree': add(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6), 0x6b4a2b, 0, 0.8); add(new THREE.IcosahedronGeometry(1.3, 0), 0x4f9a3c, 0, 2.5); break
    case 'bush': add(new THREE.IcosahedronGeometry(0.6, 0), 0x4a8a36, 0, 0.45); add(new THREE.IcosahedronGeometry(0.45, 0), 0x56a03f, 0.5, 0.35, 0.2); break
    case 'rock': { const m = add(new THREE.DodecahedronGeometry(0.9, 0), 0x8a8a8a, 0, 0.55); m.scale.set(1.3, 0.75, 1); break }
    case 'house': add(new THREE.BoxGeometry(4, 2.6, 3.4), 0xd9c7a3, 0, 1.3); { const roof = add(new THREE.ConeGeometry(3.2, 1.8, 4), 0xa0442f, 0, 3.5, Math.PI / 4); roof.scale.set(1, 1, 0.85) } add(new THREE.BoxGeometry(0.9, 1.6, 0.1), 0x5a3b22, 0, 0.8, 1.72); break
    case 'tower': add(new THREE.CylinderGeometry(1.4, 1.7, 6, 8), 0xa7a29a, 0, 3); add(new THREE.CylinderGeometry(1.9, 1.9, 0.6, 8), 0x8f8a83, 0, 6.3); add(new THREE.ConeGeometry(2, 2, 8), 0x3d5a8a, 0, 7.6); break
    case 'wall': add(new THREE.BoxGeometry(4, 2.2, 0.6), 0x9b968e, 0, 1.1); for (let i = -1.5; i <= 1.5; i += 1) add(new THREE.BoxGeometry(0.6, 0.5, 0.7), 0x8b867e, i, 2.45); break
    case 'fence': for (let i = -1.5; i <= 1.5; i += 1) add(new THREE.BoxGeometry(0.15, 1.1, 0.15), 0x7a5634, i, 0.55); add(new THREE.BoxGeometry(3.4, 0.12, 0.08), 0x8a6640, 0, 0.75); add(new THREE.BoxGeometry(3.4, 0.12, 0.08), 0x8a6640, 0, 0.35); break
    case 'crate': add(new THREE.BoxGeometry(1.2, 1.2, 1.2), 0xb88a4a, 0, 0.6); break
    case 'barrel': add(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), 0x8a3d2b, 0, 0.55); break
    case 'flag': add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), 0xdddddd, 0, 1.3); add(new THREE.BoxGeometry(0.9, 0.55, 0.04), 0xe23d3d, 0.47, 2.25); add(new THREE.CylinderGeometry(0.7, 0.8, 0.12, 12), 0xe8d36a, 0, 0.06); break
    default: add(new THREE.BoxGeometry(1, 1, 1), 0xbbbbbb, 0, 0.5)
  }
  return g
}

/* deterministic value noise for the map presets */
function noise2 (seed: number): (x: number, y: number) => number {
  const h = (x: number, y: number): number => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s) }
  const sm = (t: number): number => t * t * (3 - 2 * t)
  return (x, y) => {
    const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = sm(x - x0); const fy = sm(y - y0)
    const a = h(x0, y0); const b = h(x0 + 1, y0); const c = h(x0, y0 + 1); const d = h(x0 + 1, y0 + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
}

export class MapEditor {
  public tool: MapTool = 'none'
  public ground = 0
  public object = 'pine'
  public radius = 3 // cells
  public strength = 0.5
  public n = 64
  public cell = 1.5
  public water = -0.4
  public sea = true // the water level fills everything under it (off: dug holes stay dry until you pour)
  private heights = new Float32Array(65 * 65)
  private types = new Uint8Array(65 * 65)
  private readonly terrain: THREE.Mesh
  private readonly water_mesh: THREE.Mesh
  private readonly objects = new THREE.Group()
  private readonly ring: THREE.Mesh
  private readonly ray = new THREE.Raycaster()
  private down = false
  private flatten_to = 0
  private last_ev: PointerEvent | null = null
  private raf = 0
  private panel: HTMLElement | null = null
  private save_timer = 0
  public rig: CameraRig | null = null
  public pending_shots: Shot[] | undefined
  public on_rebuild: ((size: number) => void) | null = null
  /** the character / car of the play test: carried up and down with the ground under them, like the props */
  public riders: (() => THREE.Object3D[]) | null = null
  /** called just before a click / drag changes the map (undo step) */
  public on_edit_start: (() => void) | null = null
  public status: ((t: string, warn?: boolean) => void) | null = null
  public dig_depth = 2 // m the dig tool goes below where the stroke started
  public pool_fill = 0.9 // how full a poured hole gets (1 = to the brim)
  public rot = 0 // turn of the next placed object (Z)
  private user_rot = false
  private pools: Pool[] = []
  private readonly pool_group = new THREE.Group()
  private readonly pool_mat = new THREE.MeshLambertMaterial({ color: 0x3f8fd0, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  private ghost: THREE.Object3D | null = null
  private ghost_kind = ''
  private erasing = false
  public legend: LegendItem[] = (() => { try { const l = JSON.parse(localStorage.getItem('gb.playtest.legend') ?? 'null'); return Array.isArray(l) ? l : DEFAULT_LEGEND.map(x => ({ ...x })) } catch { return DEFAULT_LEGEND.map(x => ({ ...x })) } })()
  private legend_active = 0
  private layout_img: HTMLImageElement | null = null
  private layout_tol = 140
  private layout_peak = 9
  private guide_on = false
  private guide_mat: THREE.MeshLambertMaterial | null = null
  private readonly terrain_mat: THREE.Material

  constructor (private readonly world: World, private readonly scene: THREE.Scene, private readonly camera: () => THREE.Camera, private readonly dom: HTMLElement) {
    this.terrain = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }))
    this.terrain.name = 'Terrain'; this.terrain.receiveShadow = true; this.terrain.userData.no_pick = true
    this.water_mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x3f8fd0, transparent: true, opacity: 0.72 }))
    this.water_mesh.name = 'Water'; this.water_mesh.rotation.x = -Math.PI / 2; this.water_mesh.userData.no_pick = true
    this.water_mesh.raycast = () => {} // you walk on the water bed, not on the water
    this.objects.name = 'Map objects'
    this.terrain_mat = this.terrain.material as THREE.Material
    this.pool_group.name = 'Pools'
    world.props.add(this.terrain)
    scene.add(this.water_mesh); scene.add(this.pool_group)
    void this.load_custom_files()
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }))
    this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 30; this.ring.visible = false; scene.add(this.ring)
    const saved = (() => { try { return localStorage.getItem(KEY) } catch { return null } })()
    if (saved !== null) { try { this.load(JSON.parse(saved) as MapData) } catch { this.preset('flat') } } else this.preset('flat')
    const cap = { capture: true }
    // window capture: runs before the play test's own canvas listeners (tap-to-move, prop selection)
    addEventListener('pointerdown', e => { if (e.target === this.dom) this.on_down(e) }, cap)
    addEventListener('pointermove', e => this.on_move(e), cap)
    addEventListener('pointerup', e => this.on_up(e), cap)
  }

  /* ---------------- terrain ---------------- */
  private idx (i: number, j: number): number { return j * (this.n + 1) + i }
  private half (): number { return this.n * this.cell / 2 }

  public height_at (x: number, z: number): number {
    const fx = (x + this.half()) / this.cell; const fz = (z + this.half()) / this.cell
    if (fx < 0 || fz < 0 || fx > this.n || fz > this.n) return 0
    const i = Math.min(this.n - 1, Math.floor(fx)); const j = Math.min(this.n - 1, Math.floor(fz)); const u = fx - i; const v = fz - j
    const h = this.heights
    return (h[this.idx(i, j)] * (1 - u) + h[this.idx(i + 1, j)] * u) * (1 - v) + (h[this.idx(i, j + 1)] * (1 - u) + h[this.idx(i + 1, j + 1)] * u) * v
  }

  public rebuild (): void {
    const n = this.n; const c = this.cell; const H = this.half()
    const pos: number[] = []; const col: number[] = []; const index: number[] = []; const uv: number[] = []
    const cs = GROUND.map(g => new THREE.Color(g.color))
    const tmp = new THREE.Color()
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const k = this.idx(i, j)
        pos.push(i * c - H, this.heights[k], j * c - H)
        tmp.copy(cs[this.types[k]] ?? cs[0])
        const shade = 0.94 + ((i * 7 + j * 13) % 5) * 0.03 // a little variation, like painted tiles
        col.push(tmp.r * shade, tmp.g * shade, tmp.b * shade)
        uv.push(i / n, 1 - j / n)
      }
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = this.idx(i, j); const b = this.idx(i + 1, j); const d = this.idx(i, j + 1); const e = this.idx(i + 1, j + 1); index.push(a, d, b, b, d, e) }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(index)
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere()
    this.terrain.geometry.dispose(); this.terrain.geometry = g
    this.water_mesh.scale.set(n * c, n * c, 1); this.water_mesh.position.y = this.water
    let wet = false; for (let k = 0; k < this.heights.length; k++) if (this.heights[k] < this.water) { wet = true; break }
    this.water_mesh.visible = wet && this.sea
    this.build_pools()
    this.on_rebuild?.(n * c)
    this.world.refresh()
    this.autosave()
  }

  /* ---------------- dug holes filled with water ---------------- */
  private build_pools (): void {
    for (const c of [...this.pool_group.children]) { (c as THREE.Mesh).geometry.dispose(); c.removeFromParent() }
    const n = this.n; const c = this.cell; const H = this.half()
    this.pools.forEach((p, pi) => {
      const on = new Set(p.cells); const pos: number[] = []
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        if (!on.has(this.idx(i, j)) && !on.has(this.idx(i + 1, j)) && !on.has(this.idx(i, j + 1)) && !on.has(this.idx(i + 1, j + 1))) continue
        const x0 = i * c - H; const z0 = j * c - H; const L = p.level
        pos.push(x0, L, z0, x0, L, z0 + c, x0 + c, L, z0, x0 + c, L, z0, x0, L, z0 + c, x0 + c, L, z0 + c)
      }
      if (pos.length === 0) return
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals()
      const m = new THREE.Mesh(g, this.pool_mat); m.name = `Pool_${pi + 1}`; m.raycast = () => {}; m.userData.no_pick = true
      this.pool_group.add(m)
    })
  }

  /**
   * Pour water at (x, z): it fills the hole / channel it lands in up to where it would spill over
   * (priority flood: grow from the lowest rim point until the next point is lower than the water already is),
   * times pool_fill. The map border counts as a rim (water runs off the edge there).
   */
  public pour (x: number, z: number): Pool | null {
    const n = this.n; const N1 = n + 1; const H = this.half()
    const i0 = Math.max(0, Math.min(n, Math.round((x + H) / this.cell))); const j0 = Math.max(0, Math.min(n, Math.round((z + H) / this.cell)))
    const h = this.heights; const k0 = this.idx(i0, j0)
    // the lowest point of the hole: walk downhill first
    let start = k0
    for (let guard = 0; guard < 200; guard++) {
      const si = start % N1; const sj = (start - si) / N1; let low = start
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = si + di; const b = sj + dj; if (a < 0 || b < 0 || a > n || b > n) continue; const q = this.idx(a, b); if (h[q] < h[low]) low = q }
      if (low === start) break; start = low
    }
    const heap: Array<[number, number]> = [[h[start], start]]; const seen = new Uint8Array(N1 * N1); seen[start] = 1
    const push = (v: [number, number]): void => { heap.push(v); let i = heap.length - 1; while (i > 0) { const pp = (i - 1) >> 1; if (heap[pp][0] <= heap[i][0]) break; [heap[pp], heap[i]] = [heap[i], heap[pp]]; i = pp } }
    const pop = (): [number, number] => { const top = heap[0]; const last = heap.pop()!; if (heap.length > 0) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1; const r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } } return top }
    let level = h[start]; let count = 0; let spill = Infinity
    while (heap.length > 0) {
      const [hv, k] = pop()
      if (hv < level - 1e-4) { spill = level; break } // past the rim: it would run out here
      level = Math.max(level, hv); count++
      const ki = k % N1; const kj = (k - ki) / N1
      if (ki === 0 || kj === 0 || ki === n || kj === n) { spill = level; break }
      if (count > N1 * N1 * 0.45) break
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = ki + di; const b = kj + dj; if (a < 0 || b < 0 || a > n || b > n) continue; const q = this.idx(a, b); if (seen[q] === 0) { seen[q] = 1; push([h[q], q]) } }
    }
    const bottom = h[start]
    if (!Number.isFinite(spill) || spill - bottom < 0.08) { this.status?.(M('No closed hole here: dig it deeper (🕳 Dig) or draw a channel with walls on both sides first.', 'Chỗ này không có hố kín: khoét sâu hơn (🕳 Khoét) hoặc kẻ rãnh có bờ hai bên trước.', '닫힌 구덩이가 없습니다: 더 깊게 파세요.'), true); return null }
    const L = bottom + (spill - bottom) * this.pool_fill
    // the water body: everything connected to the bottom that is under the level
    const cells: number[] = []; const st = [start]; const inside = new Uint8Array(N1 * N1); inside[start] = 1
    while (st.length > 0) {
      const k = st.pop()!; cells.push(k); const ki = k % N1; const kj = (k - ki) / N1
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = ki + di; const b = kj + dj; if (a < 0 || b < 0 || a > n || b > n) continue; const q = this.idx(a, b); if (inside[q] === 0 && h[q] < L) { inside[q] = 1; st.push(q) } }
    }
    // pouring into an existing pool replaces it
    this.pools = this.pools.filter(p => !p.cells.some(c => inside[c] === 1))
    const pool: Pool = { level: Math.round(L * 1000) / 1000, cells }
    this.pools.push(pool)
    for (const c of cells) if (h[c] < L - 0.05) this.types[c] = 6
    this.rebuild()
    this.status?.(M(`Water poured: ${cells.length} points, level ${L.toFixed(2)} m.`, `Đã đổ nước: ${cells.length} điểm, mực nước ${L.toFixed(2)} m.`, `물 채움: ${cells.length}점, 수위 ${L.toFixed(2)} m`))
    return pool
  }

  public preset (kind: 'flat' | 'hills' | 'island' | 'valley' | 'mountains'): void {
    const n = this.n; this.heights = new Float32Array((n + 1) * (n + 1)); this.types = new Uint8Array((n + 1) * (n + 1))
    const nz = noise2(Math.floor(Math.random() * 1000))
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = i / n - 0.5; const y = j / n - 0.5; const r = Math.hypot(x, y)
        const f = nz(i / 9, j / 9) * 0.65 + nz(i / 4, j / 4) * 0.35
        let h = 0
        if (kind === 'hills') h = (f - 0.45) * 5
        else if (kind === 'island') h = (0.42 - r) * 14 + (f - 0.5) * 3
        else if (kind === 'valley') h = Math.abs(x) * 16 - 1.5 + (f - 0.5) * 2.5
        else if (kind === 'mountains') h = Math.max(0, f - 0.42) * 26 + (f - 0.5) * 2
        if (Math.max(Math.abs(x), Math.abs(y)) < 0.06) h = 0 // flat start area
        const k = this.idx(i, j); this.heights[k] = h
        this.types[k] = h < this.water + 0.2 ? (h < this.water ? 6 : 2) : h > 9 ? 4 : h > 4.5 ? 3 : 0
      }
    }
    for (const o of [...this.objects.children]) this.remove_object(o)
    this.pools = []; this.sea = kind !== 'flat'
    this.rebuild(); this.refresh_panel()
  }

  private brush (hit: THREE.Vector3, first: boolean): void {
    const n = this.n; const c = this.cell; const H = this.half()
    const ci = (hit.x + H) / c; const cj = (hit.z + H) / c; const R = this.radius
    if (first && (this.tool === 'flatten' || this.tool === 'dig')) this.flatten_to = this.height_at(hit.x, hit.z)
    const old = this.tool === 'smooth' ? Float32Array.from(this.heights) : null
    // what stands on the ground (props, the character) moves with it instead of being buried / left floating
    const movers = this.tool === 'paint' ? [] : [...this.world.props.children.filter(o => o !== this.terrain && o !== this.objects), ...(this.riders?.() ?? [])]
    const was = movers.map(o => this.height_at(o.position.x, o.position.z))
    for (let j = Math.max(0, Math.floor(cj - R)); j <= Math.min(n, Math.ceil(cj + R)); j++) {
      for (let i = Math.max(0, Math.floor(ci - R)); i <= Math.min(n, Math.ceil(ci + R)); i++) {
        const d = Math.hypot(i - ci, j - cj) / R; if (d > 1) continue
        const f = (1 - d * d) * this.strength; const k = this.idx(i, j)
        if (this.tool === 'raise') this.heights[k] += f * 0.5
        else if (this.tool === 'lower') this.heights[k] -= f * 0.5
        else if (this.tool === 'flatten') this.heights[k] += (this.flatten_to - this.heights[k]) * Math.min(1, f * 1.5)
        else if (this.tool === 'smooth' && old !== null) {
          let s = 0; let m = 0
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di; const b = j + dj; if (a >= 0 && b >= 0 && a <= n && b <= n) { s += old[this.idx(a, b)]; m++ } }
          this.heights[k] += (s / m - this.heights[k]) * Math.min(1, f * 1.5)
        } else if (this.tool === 'dig') {
          // flat bottom, steep banks: a hole / trench / river bed
          const bottom = this.flatten_to - this.dig_depth; const w = d < 0.65 ? 1 : (1 - d) / 0.35
          const want = Math.min(this.heights[k], bottom * w + this.heights[k] * (1 - w))
          this.heights[k] += (want - this.heights[k]) * Math.min(1, 0.35 + this.strength)
          if (d < 0.9 && this.types[k] !== 6) this.types[k] = 1
        } else if (this.tool === 'paint' && d < 0.95) this.types[k] = this.ground
      }
    }
    // a pool whose hole was changed: keep only what is still under its level
    if (this.tool !== 'paint' && this.pools.length > 0) this.pools = this.pools.map(p => ({ level: p.level, cells: p.cells.filter(c => this.heights[c] < p.level) })).filter(p => p.cells.length > 0)
    this.rebuild()
    if (this.tool !== 'paint') for (const o of this.objects.children) o.position.y = this.height_at(o.position.x, o.position.z)
    movers.forEach((o, i) => { o.position.y += this.height_at(o.position.x, o.position.z) - was[i] })
  }

  /** one brush dab at (x, z) with the current tool (for the AI tools) */
  public sculpt_at (x: number, z: number): void { this.brush(new THREE.Vector3(x, 0, z), true) }

  /* ---------------- objects ---------------- */
  public add_object (kind: string, x: number, z: number, r = 0, s = 1, extra?: MapExtra): THREE.Object3D {
    const o = build_object(kind, extra)
    const info = OBJECTS.find(q => q.id === kind)
    if (info?.grid === true) { x = Math.round(x / this.cell) * this.cell; z = Math.round(z / this.cell) * this.cell }
    o.position.set(x, this.height_at(x, z), z); o.rotation.y = r; o.scale.setScalar(s)
    const k = this.objects.children.filter(c => c.userData.map_kind === kind).length + 1
    o.name = `${kind.replace(/^file:/, '').replace(/\.[^.]+$/, '')}_${k}`
    if (kind === 'block' && (extra?.label ?? '') !== '') o.name = extra!.label!
    if (kind === 'wire') o.name = `flow_${k}`
    this.objects.add(o); this.world.props.add(o) // in the world props so it is solid / walkable
    this.world.refresh(); this.autosave()
    return o
  }

  private remove_object (o: THREE.Object3D): void { this.objects.remove(o); o.removeFromParent(); this.world.refresh() }

  /** every prop of the map that can be erased (placed objects, dropped files, boxes) — not the terrain */
  private erasable (): THREE.Object3D[] { return this.world.props.children.filter(o => o !== this.terrain) }

  /** an empty flat map: no objects, files, boxes, water, shots, plan blocks */
  public clear_all (): void {
    for (const o of this.erasable()) { if (this.world.selected === o) this.world.select(null); o.removeFromParent() }
    this.preset('flat'); this.pools = []; this.rig?.set([]); this.on_cleared?.()
    this.rebuild()
  }

  public on_cleared: (() => void) | null = null

  public set_tool (t: MapTool): void { this.tool = t; if (t !== 'place') this.hide_ghost(); this.refresh_panel() }

  /** Z: turn the object about to be placed (Shift = the other way, Alt = 90°) */
  public turn_next (step: number): void { this.rot = Math.atan2(Math.sin(this.rot + step), Math.cos(this.rot + step)); this.user_rot = true; if (this.ghost !== null) this.ghost.rotation.y = this.rot }

  /* ---------------- ghost of the object about to be placed ---------------- */
  private show_ghost (p: THREE.Vector3): void {
    if (this.ghost === null || this.ghost_kind !== this.object) {
      this.hide_ghost()
      const g = build_object(this.object); g.userData.map_kind = undefined
      g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { const mt = (m.material as THREE.Material).clone() as THREE.MeshLambertMaterial; mt.transparent = true; mt.opacity = 0.5; mt.depthWrite = false; m.material = mt; m.castShadow = false; m.raycast = () => {} } })
      this.ghost = g; this.ghost_kind = this.object; this.scene.add(g)
    }
    let x = p.x; let z = p.z
    if (OBJECTS.find(q => q.id === this.object)?.grid === true) { x = Math.round(x / this.cell) * this.cell; z = Math.round(z / this.cell) * this.cell }
    this.ghost.position.set(x, this.height_at(x, z), z); this.ghost.rotation.y = this.rot; this.ghost.visible = true
  }

  private hide_ghost (): void { if (this.ghost !== null) { this.ghost.removeFromParent(); this.ghost = null; this.ghost_kind = '' } }

  /* ---------------- your own 3D files in the object palette ---------------- */
  public async add_custom_file (name: string, buf: ArrayBuffer, store = true): Promise<string> {
    const root = (await load_any_buffer(name, buf.slice(0))).scene
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.castShadow = true; m.receiveShadow = true } })
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const big = Math.max(size.x, size.y, size.z)
    if (big > 60 || big < 0.3) root.scale.multiplyScalar(8 / Math.max(1e-6, big))
    root.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(root)
    root.position.x -= (b2.min.x + b2.max.x) / 2; root.position.z -= (b2.min.z + b2.max.z) / 2; root.position.y -= b2.min.y
    const holder = new THREE.Group(); holder.add(root)
    const kind = 'file:' + name
    CUSTOM.set(kind, holder)
    const loaded_clips = (await load_any_buffer(name, buf.slice(0))).clips; if (loaded_clips.length > 0) CUSTOM_CLIPS.set(kind, loaded_clips)
    if (store) { try { const db = await fdb(); db.transaction('f', 'readwrite').objectStore('f').put(buf, name) } catch { /* private mode */ } }
    // swap the placeholders of a map loaded before the file
    for (const o of this.placed().filter(q => q.userData.map_kind === kind && q.userData.placeholder === true)) {
      const n = build_object(kind); n.position.copy(o.position); n.rotation.copy(o.rotation); n.scale.copy(o.scale); n.name = o.name
      this.remove_object(o); this.objects.add(n); this.world.props.add(n)
    }
    this.world.refresh(); this.render_custom()
    return kind
  }

  private async load_custom_files (): Promise<void> {
    try {
      const db = await fdb(); const st = db.transaction('f').objectStore('f')
      const all: Array<[string, ArrayBuffer]> = await new Promise(res => { const out: Array<[string, ArrayBuffer]> = []; const c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur === null) { res(out); return } out.push([String(cur.key), cur.value as ArrayBuffer]); cur.continue() }; c.onerror = () => res(out) })
      for (const [n, b] of all) { try { await this.add_custom_file(n, b, false) } catch { /* a broken file: skip */ } }
    } catch { /* no IndexedDB */ }
  }

  private async remove_custom (kind: string): Promise<void> {
    CUSTOM.delete(kind)
    try { const db = await fdb(); db.transaction('f', 'readwrite').objectStore('f').delete(kind.slice(5)) } catch { /* ignore */ }
    if (this.object === kind) { this.object = 'pine'; this.hide_ghost() }
    this.render_custom()
  }

  private render_custom (): void {
    const row = this.panel?.querySelector('[data-cobjs]'); if (row == null) return
    row.innerHTML = [...CUSTOM.keys()].map(k => `<span style="display:inline-flex"><button data-ob="${k}" title="${k.slice(5)}" style="flex:none;padding:4px 6px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📦 ${k.slice(5).replace(/\.[^.]+$/, '')}</button><button data-rmf="${k}" title="✕" style="flex:none;padding:2px 5px">✕</button></span>`).join('')
    this.refresh_panel()
  }

  private placed (): THREE.Object3D[] { return this.world.props.children.filter(o => o.userData.map_kind !== undefined) }

  /* ---------------- input ---------------- */
  private hit (e: { clientX: number, clientY: number }): THREE.Intersection | null {
    const r = this.dom.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera())
    return this.ray.intersectObject(this.terrain, false)[0] ?? null
  }

  /** eraser: the prop under the cursor and every prop inside the brush; a click on poured water drains it */
  private erase_at (e: { clientX: number, clientY: number }): void {
    const r = this.dom.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera())
    const gone = new Set<THREE.Object3D>()
    const h = this.ray.intersectObjects(this.erasable(), true)[0]
    if (h !== undefined) { let o: THREE.Object3D = h.object; while (o.parent !== null && o.parent !== this.world.props) o = o.parent; gone.add(o) }
    const t = this.hit(e)
    if (t !== null) {
      const R = Math.max(0.6, this.radius * this.cell * 0.5)
      for (const o of this.erasable()) { const dx = o.position.x - t.point.x; const dz = o.position.z - t.point.z; if (dx * dx + dz * dz < R * R) gone.add(o) }
      if (gone.size === 0 && this.pools.length > 0) {
        const k = this.idx(Math.round((t.point.x + this.half()) / this.cell), Math.round((t.point.z + this.half()) / this.cell))
        const before = this.pools.length; this.pools = this.pools.filter(p => !p.cells.includes(k))
        if (this.pools.length !== before) { this.rebuild(); return }
      }
    }
    for (const o of gone) { if (this.world.selected === o) this.world.select(null); if (o.userData.map_kind !== undefined) this.remove_object(o); else this.world.remove(o) }
    if (gone.size > 0) this.autosave()
  }

  private on_down (e: PointerEvent): void {
    if (this.tool === 'none' || this.tool === 'select' || e.button !== 0) return
    this.on_edit_start?.()
    if (this.tool === 'erase') { this.erasing = true; this.erase_at(e); e.stopImmediatePropagation(); e.preventDefault(); return }
    const h = this.hit(e); if (h === null) return
    e.stopImmediatePropagation(); e.preventDefault()
    if (this.tool === 'pour') { this.pour(h.point.x, h.point.z); return }
    if (this.tool === 'place') {
      const nature = !(OBJECTS.find(q => q.id === this.object)?.grid ?? false) && !this.object.startsWith('file:')
      const r = nature && !this.user_rot ? Math.random() * Math.PI * 2 : this.rot
      this.add_object(this.object, h.point.x, h.point.z, r, nature ? 0.8 + Math.random() * 0.45 : 1)
      return
    }
    this.down = true; this.brush(h.point, true)
  }

  private on_move (e: PointerEvent): void {
    const brushy = this.tool !== 'none' && this.tool !== 'select'
    if (brushy && e.target === this.dom) {
      const h = this.hit(e)
      this.ring.visible = h !== null && this.tool !== 'place'
      if (h !== null) { const R = this.tool === 'erase' ? Math.max(0.6, this.radius * this.cell * 0.5) : this.tool === 'pour' ? 0.8 : this.radius * this.cell; this.ring.scale.set(R, R, 1); this.ring.position.set(h.point.x, h.point.y + 0.08, h.point.z); (this.ring.material as THREE.MeshBasicMaterial).color.set(this.tool === 'erase' ? 0xff6b6b : this.tool === 'pour' ? 0x4da6ff : 0xffffff) }
      if (this.tool === 'place' && h !== null) this.show_ghost(h.point); else if (this.ghost !== null) this.ghost.visible = false
    } else if (!this.down) { this.ring.visible = false; if (this.ghost !== null && e.target !== this.dom) this.ghost.visible = false }
    if (this.erasing) { e.stopImmediatePropagation(); this.erase_at(e); return }
    if (!this.down) return
    e.stopImmediatePropagation()
    this.last_ev = e
    if (this.raf === 0) this.raf = requestAnimationFrame(() => { this.raf = 0; const ev = this.last_ev; if (ev === null) return; const h = this.hit(ev); if (h !== null) this.brush(h.point, false) })
  }

  private on_up (e: PointerEvent): void { this.erasing = false; if (this.down) { this.down = false; this.last_ev = null; e.stopImmediatePropagation() } }

  /* ---------------- save / load / export ---------------- */
  public data (): MapData {
    return {
      version: 1, n: this.n, cell: this.cell, water: this.water, sea: this.sea,
      heights: Array.from(this.heights, h => Math.round(h * 1000) / 1000), types: Array.from(this.types),
      objects: this.placed().map(o => ({ kind: o.userData.map_kind as string, p: [o.position.x, o.position.y, o.position.z].map(v => Math.round(v * 1000) / 1000) as [number, number, number], r: Math.round(o.rotation.y * 1000) / 1000, s: Math.round(o.scale.x * 1000) / 1000, ...(o.userData.map_extra !== undefined ? { x: o.userData.map_extra as MapExtra } : {}) })),
      pools: this.pools,
      ...(this.plan !== null ? { plan: this.plan } : {}),
      ...(!this.wires_visible ? { wires_hidden: true } : {}),
      shots: this.rig?.shots ?? []
    }
  }

  public autosave_now (): void { this.autosave() }

  public load (d: MapData): void {
    this.n = d.n; this.cell = d.cell; this.water = d.water; this.sea = d.sea !== false
    this.heights = Float32Array.from(d.heights); this.types = Uint8Array.from(d.types)
    this.pools = Array.isArray(d.pools) ? d.pools : []
    for (const o of this.placed()) this.remove_object(o)
    if (d.shots !== undefined) { if (this.rig !== null) this.rig.set(d.shots); else this.pending_shots = d.shots }
    this.rebuild()
    for (const o of d.objects) { const ob = this.add_object(o.kind, o.p[0], o.p[2], o.r, o.s, o.x); ob.position.y = o.p[1] }
    this.plan = d.plan ?? null; this.on_plan?.(this.plan)
    this.wires_visible = d.wires_hidden !== true; if (!this.wires_visible) this.show_wires(false)
  }

  /* ---------------- 2D plan -> 3D ---------------- */
  public plan: Plan | null = null
  public on_plan: ((p: Plan | null) => void) | null = null
  /** the 3D object of a plan shape */
  public plan_object (pid: string): THREE.Object3D | null { return this.placed().find(o => (o.userData.map_extra as MapExtra | undefined)?.pid === pid) ?? null }

  /** every shape -> a block, every wire -> a flow path on the ground (the previous plan build is replaced) */
  public build_plan (plan: Plan): void {
    this.plan = JSON.parse(JSON.stringify(plan))
    for (const o of this.placed()) if (o.userData.map_kind === 'block' || o.userData.map_kind === 'wire') this.remove_object(o)
    const byid = new Map(plan.shapes.map(s => [s.id, s]))
    // big zones first (floors), then what stands on them
    for (const s of [...plan.shapes].sort((a, b) => b.w * b.d - a.w * a.d)) {
      const h = s.kind === 'player' ? 0.03 : Math.max(0.02, s.height ?? KIND_INFO[s.kind].height)
      this.add_object('block', s.x, s.z, -s.r, 1, { pid: s.id, size: [s.w, h, s.d], color: s.color, label: s.kind === 'zone' || s.kind === 'player' ? (s.label !== '' ? s.label : '') : s.label, form: s.form, model: s.model, role: s.kind, image: s.image, price: s.price ?? (s.kind === 'unlock' ? 50 : undefined) })
    }
    for (const w of plan.wires) {
      const a = byid.get(w.from); const b = byid.get(w.to); if (a === undefined || b === undefined) continue
      const dx = b.x - a.x; const dz = b.z - a.z; const L = Math.hypot(dx, dz); if (L < 0.5) continue
      // from edge to edge, not centre to centre
      const ra = Math.min(a.w, a.d) / 2; const rb = Math.min(b.w, b.d) / 2; const u0 = Math.min(ra, L * 0.4); const u1 = Math.max(L - rb, L * 0.6)
      const mx = a.x + dx * (u0 + u1) / 2 / L; const mz = a.z + dz * (u0 + u1) / 2 / L
      const wo = this.add_object('wire', mx, mz, Math.atan2(-dz, dx), 1, { pid: w.id, size: [u1 - u0, 0.1, 0.8], mode: w.mode }); wo.visible = this.wires_visible
    }
    this.world.refresh(); this.autosave()
  }

  private autosave (): void {
    clearTimeout(this.save_timer)
    this.save_timer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(this.data())) } catch { /* private mode: no autosave */ } }, 400)
  }

  private download (blob: Blob, name: string): void {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  /** the map as a GLB: terrain, water, objects (hidden flow wires are left out), camera shots */
  public async glb_buffer (cameras = true): Promise<ArrayBuffer> {
    const sc = new THREE.Scene(); const g = new THREE.Group(); g.name = 'Greenbox Map'
    const ter = this.terrain.clone(); ter.material = this.terrain_mat; g.add(ter); if (this.water_mesh.visible) g.add(this.water_mesh.clone())
    for (const p of this.pool_group.children) g.add(p.clone())
    for (const o of this.placed()) if (o.visible) g.add(o.clone())
    // camera shots as glTF cameras (Unity / Blender / Godot import them)
    if (cameras) for (const c of this.shot_cameras()) g.add(c)
    sc.add(g)
    return await new GLTFExporter().parseAsync(sc, { binary: true }) as ArrayBuffer
  }

  public async export_glb (): Promise<void> {
    this.download(new Blob([await this.glb_buffer()], { type: 'model/gltf-binary' }), 'greenbox-map.glb')
  }

  /** the flow wires of the plan: shown while designing, hidden for the game (and the export) */
  public wires_visible = true
  public show_wires (on: boolean): void {
    this.wires_visible = on
    for (const o of this.placed()) if (o.userData.map_kind === 'wire') o.visible = on
    this.world.refresh(); this.autosave()
  }

  /** one camera per shot, placed where the shot starts, looking at its target (named "Shot 1 · name") */
  private shot_cameras (): THREE.PerspectiveCamera[] {
    if (this.rig === null) return []
    return this.rig.shots.map((s, i) => {
      const r = this.rig!.resolve(s)
      const c = new THREE.PerspectiveCamera(s.fov, 16 / 9, 0.05, 1000); c.name = `Shot_${i + 1}_${s.name.replace(/[^\w-]+/g, '_')}`
      c.position.copy(r.pos); c.lookAt(r.target); c.userData = { t: s.t, dur: s.dur, mode: s.mode, follow: s.follow }
      return c
    })
  }

  /** shots with their resolved start position / look-at point (for Blender / Unity) */
  private shot_data (): Array<Shot & { p0: number[], t0: number[], follow_p: number[] | null }> {
    if (this.rig === null) return []
    const R = (v: THREE.Vector3): number[] => [v.x, v.y, v.z].map(x => Math.round(x * 1000) / 1000)
    return this.rig.shots.map(s => {
      const r = this.rig!.resolve(s)
      const o = s.mode === 'fixed' ? null : (this.world.props.getObjectByName(s.follow) ?? null)
      return { ...s, p0: R(r.pos), t0: R(r.target), follow_p: o !== null ? R(o.getWorldPosition(new THREE.Vector3())) : null }
    })
  }

  /** a Python script that rebuilds the map inside Blender (Scripting › Open › Run Script) */
  public blender_script (): string {
    const d = this.data()
    const shots = this.shot_data()
    const cols = GROUND.map(g => { const c = new THREE.Color(g.color); return [c.r, c.g, c.b].map(v => +v.toFixed(3)) })
    return `# Greenbox map -> Blender. Scripting > Open this file > Run Script.
# Builds the terrain (vertex colours), the water and every object in the collection "Greenbox Map".
import bpy, bmesh, math, os, json
N, CELL, WATER = ${d.n}, ${d.cell}, ${d.water}
H = ${JSON.stringify(d.heights)}
T = ${JSON.stringify(d.types)}
COLORS = ${JSON.stringify(cols)}
OBJECTS = json.loads(${JSON.stringify(JSON.stringify(d.objects))})
POOLS = json.loads(${JSON.stringify(JSON.stringify(d.pools ?? []))})
SHOTS = json.loads(${JSON.stringify(JSON.stringify(shots))})
FPS = 30
# your own 3D files (kind "file:<name>") are imported from this folder; empty = the folder of the .blend
FILES_DIR = ""

col = bpy.data.collections.get("Greenbox Map") or bpy.data.collections.new("Greenbox Map")
if col.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(col)
for o in list(col.objects): bpy.data.objects.remove(o, do_unlink=True)

def mat(name, rgb, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1)
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.blend_method = "BLEND"
        except Exception: pass
    return m

# terrain: Blender is Z-up, so the map's (x, height, z) becomes (x, -z, height)
half = N * CELL / 2
verts = [(i * CELL - half, -(j * CELL - half), H[j * (N + 1) + i]) for j in range(N + 1) for i in range(N + 1)]
faces = [(j * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i + 1, (j + 1) * (N + 1) + i) for j in range(N) for i in range(N)]
me = bpy.data.meshes.new("Terrain"); me.from_pydata(verts, [], faces); me.update()
ca = me.color_attributes.new("Ground", "FLOAT_COLOR", "POINT")
for k in range(len(verts)):
    c = COLORS[T[k]] if T[k] < len(COLORS) else COLORS[0]
    ca.data[k].color = (c[0], c[1], c[2], 1)
tm = bpy.data.materials.new("Terrain"); tm.use_nodes = True
nodes = tm.node_tree.nodes; attr = nodes.new("ShaderNodeVertexColor"); attr.layer_name = "Ground"
tm.node_tree.links.new(attr.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
me.materials.append(tm)
ter = bpy.data.objects.new("Terrain", me); col.objects.link(ter)
if ${d.sea !== false ? 'True' : 'False'} and any(h < WATER for h in H):
    bpy.ops.mesh.primitive_plane_add(size=N * CELL, location=(0, 0, WATER))
    w = bpy.context.active_object; w.name = "Water"; w.data.materials.append(mat("Water", (0.25, 0.56, 0.82), 0.7))
    for c in w.users_collection: c.objects.unlink(w)
    col.objects.link(w)

# water poured into holes / channels
wm = None
for pi, p in enumerate(POOLS):
    on = set(p["cells"]); L = p["level"]; pv = []; pf = []
    for j in range(N):
        for i in range(N):
            ks = [j * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i, (j + 1) * (N + 1) + i + 1]
            if not any(k in on for k in ks): continue
            b = len(pv)
            pv += [(i * CELL - half, -(j * CELL - half), L), ((i + 1) * CELL - half, -(j * CELL - half), L), ((i + 1) * CELL - half, -((j + 1) * CELL - half), L), (i * CELL - half, -((j + 1) * CELL - half), L)]
            pf.append((b, b + 1, b + 2, b + 3))
    if not pv: continue
    pm = bpy.data.meshes.new("Pool_%d" % (pi + 1)); pm.from_pydata(pv, [], pf); pm.update()
    po = bpy.data.objects.new("Pool_%d" % (pi + 1), pm); col.objects.link(po)
    wm = wm or mat("Water", (0.25, 0.56, 0.82), 0.7); pm.materials.append(wm)
    bpy.context.view_layer.objects.active = po

def add(kind, prim, size, loc, rgb, scale=(1, 1, 1), rot=0, **kw):
    getattr(bpy.ops.mesh, "primitive_" + prim + "_add")(location=loc, **kw)
    o = bpy.context.active_object
    o.scale = (size * scale[0], size * scale[1], size * scale[2]); o.rotation_euler[2] = rot
    o.data.materials.append(mat(kind, rgb))
    for c in o.users_collection: c.objects.unlink(o)
    col.objects.link(o)
    return o

def build(kind, x, y, z, r, s, name, ex={}):
    parts = []
    P = lambda dx, dy, dz: (x + (dx * math.cos(r) - dz * math.sin(r)) * s, y - (dx * math.sin(r) + dz * math.cos(r)) * s, z + dy * s)
    if kind == "pine":
        parts += [add("Trunk", "cylinder", s, P(0, 0.6, 0), (0.42, 0.29, 0.17), (0.18, 0.18, 0.6), vertices=6)]
        parts += [add("Leaves", "cone", s, P(0, 2.0, 0), (0.18, 0.42, 0.23), (1.1, 1.1, 1.1), vertices=7)]
    elif kind == "tree":
        parts += [add("Trunk", "cylinder", s, P(0, 0.8, 0), (0.42, 0.29, 0.17), (0.2, 0.2, 0.8), vertices=6)]
        parts += [add("Leaves", "ico_sphere", s * 1.3, P(0, 2.5, 0), (0.31, 0.6, 0.24), subdivisions=1)]
    elif kind == "bush":
        parts += [add("Leaves", "ico_sphere", s * 0.6, P(0, 0.45, 0), (0.29, 0.54, 0.21), subdivisions=1)]
    elif kind == "rock":
        parts += [add("Rock", "ico_sphere", s * 0.9, P(0, 0.5, 0), (0.54, 0.54, 0.54), (1.3, 1, 0.75), subdivisions=1)]
    elif kind == "house":
        parts += [add("Walls", "cube", s, P(0, 1.3, 0), (0.85, 0.78, 0.64), (2, 1.7, 1.3), rot=r)]
        parts += [add("Roof", "cone", s, P(0, 3.5, 0), (0.63, 0.27, 0.18), (2.4, 2.0, 0.9), rot=r + math.pi / 4, vertices=4)]
    elif kind == "tower":
        parts += [add("Stone", "cylinder", s, P(0, 3, 0), (0.65, 0.63, 0.6), (1.6, 1.6, 3), vertices=8)]
        parts += [add("Roof", "cone", s, P(0, 7.6, 0), (0.24, 0.35, 0.54), (2, 2, 1), vertices=8)]
    elif kind == "wall":
        parts += [add("Stone", "cube", s, P(0, 1.1, 0), (0.61, 0.59, 0.56), (2, 0.3, 1.1), rot=r)]
    elif kind == "fence":
        parts += [add("Wood", "cube", s, P(0, 0.55, 0), (0.48, 0.34, 0.2), (1.7, 0.06, 0.55), rot=r)]
    elif kind == "crate":
        parts += [add("Wood", "cube", s, P(0, 0.6, 0), (0.72, 0.54, 0.29), (0.6, 0.6, 0.6), rot=r)]
    elif kind == "barrel":
        parts += [add("Barrel", "cylinder", s, P(0, 0.55, 0), (0.54, 0.24, 0.17), (0.45, 0.45, 0.55), vertices=10)]
    elif kind == "block":
        w, hh, d = ex.get("size", [2, 1, 2]); c = ex.get("color", "#999999").lstrip("#")
        rgb = tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))
        nv = {"ellipse": 32, "triangle": 3, "diamond": 4, "pentagon": 5, "hexagon": 6, "octagon": 8}.get(ex.get("form"), 0)
        if nv: parts += [add(name, "cylinder", 1, P(0, hh / 2, 0), rgb, (w / 2, d / 2, hh / 2), rot=r, vertices=nv)]
        else: parts += [add(name, "cube", 1, P(0, hh / 2, 0), rgb, (w / 2, d / 2, hh / 2), rot=r)]
    elif kind == "wire":
        L = ex.get("size", [2])[0]; rgb = (0.33, 0.38, 0.43) if ex.get("mode") == "belt" else ((0.09, 0.64, 0.29) if ex.get("mode") == "unlock" else (1, 0.82, 0.25))
        parts += [add("Flow", "cube", 1, P(0, 0.05, 0), rgb, (L / 2, 0.4, 0.05), rot=r)]
    elif kind.startswith("file:"):
        # your own model: imported from FILES_DIR when the file is there, else an empty marks the spot
        fn = kind[5:]; folder = FILES_DIR or (os.path.dirname(bpy.data.filepath) if bpy.data.filepath else "")
        path = os.path.join(folder, fn) if folder else fn
        if os.path.exists(path):
            before = set(bpy.data.objects)
            ext = fn.lower().rsplit(".", 1)[-1]
            try:
                if ext in ("glb", "gltf"): bpy.ops.import_scene.gltf(filepath=path)
                elif ext == "fbx": bpy.ops.import_scene.fbx(filepath=path)
                elif ext == "obj": bpy.ops.wm.obj_import(filepath=path)
            except Exception as e: print("could not import", path, e)
            new = [o for o in bpy.data.objects if o not in before]
            for o in new:
                for c in o.users_collection: c.objects.unlink(o)
                col.objects.link(o)
            tops = [o for o in new if o.parent is None]
            root = bpy.data.objects.new(name, None); col.objects.link(root); root.location = (x, y, z); root.rotation_euler[2] = r; root.scale = (s, s, s)
            for o in tops: o.parent = root
            return
        else: print("Greenbox map: put", fn, "next to the .blend (or set FILES_DIR) to import it")
    else:
        parts += [add(kind, "cube", s, P(0, 0.5, 0), (0.7, 0.7, 0.7), (0.5, 0.5, 0.5))]
    root = bpy.data.objects.new(name, None); col.objects.link(root); root.location = (x, y, z)
    for p in parts:
        mw = p.matrix_world.copy(); p.parent = root; p.matrix_world = mw

count = {}
for o in OBJECTS:
    count[o["kind"]] = count.get(o["kind"], 0) + 1
    x, h, z = o["p"]
    build(o["kind"], x, -z, h, -o["r"], o["s"], (o.get("x") or {}).get("label") or "%s_%d" % (o["kind"], count[o["kind"]]), o.get("x") or {})
print("Greenbox map:", len(OBJECTS), "objects")

# camera shots: cameras + Track To the followed object + timeline markers that switch the active camera
sc = bpy.context.scene
for m in list(sc.timeline_markers):
    if m.name.startswith("Shot"): sc.timeline_markers.remove(m)
def bl(v): return (v[0], -v[2], v[1])  # map (x, height, z) -> Blender (x, -z, height)
targets = {}
def target_of(name, at):
    if name in targets: return targets[name]
    o = bpy.data.objects.get(name)
    if o is None:
        o = bpy.data.objects.new(name if name != "player" else "Player", None); col.objects.link(o)
        o.location = bl(at); o.empty_display_type = "ARROWS"
    targets[name] = o
    return o
end = 0
for i, s in enumerate(SHOTS):
    cd = bpy.data.cameras.new("Shot_%d" % (i + 1)); cd.lens_unit = "FOV"; cd.sensor_fit = "VERTICAL"; cd.angle = math.radians(s["fov"])
    cam = bpy.data.objects.new("Shot_%d_%s" % (i + 1, s["name"]), cd); col.objects.link(cam)
    cam.location = bl(s["p0"])
    if s["mode"] != "fixed" and s.get("follow_p") is not None:
        t = target_of(s["follow"], s["follow_p"])
        if s["mode"] == "follow":
            cam.parent = t; cam.location = (s["offset"][0], -s["offset"][2], s["offset"][1])
        c = cam.constraints.new("TRACK_TO"); c.target = t; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"
    else:
        aim = bpy.data.objects.new("Shot_%d_target" % (i + 1), None); col.objects.link(aim); aim.location = bl(s["t0"]); aim.empty_display_size = 0.3
        c = cam.constraints.new("TRACK_TO"); c.target = aim; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"
    mk = sc.timeline_markers.new("Shot %d %s" % (i + 1, s["name"]), frame=int(round(s["t"] * FPS)) + 1); mk.camera = cam
    end = max(end, s["t"] + s["dur"])
if SHOTS:
    sc.render.fps = FPS; sc.frame_start = 1; sc.frame_end = int(round(end * FPS))
    sc.camera = bpy.data.objects.get("Shot_1_%s" % SHOTS[0]["name"])
    print("Greenbox map:", len(SHOTS), "camera shots (markers switch the camera; animate the 'Player' empty to move the followed shots)")
`
  }

  public export_blender (): void { this.download(new Blob([this.blender_script()], { type: 'text/x-python' }), 'greenbox-map.py') }

  /**
   * Unity: import greenbox-map.glb (glTFast / UnityGLTF — the shot cameras come with it), add this script to any
   * object: it plays the shots on the main camera (switching / blending by time, following / tracking the
   * object with the same name, "Player" = the object tagged Player).
   * glTF is right-handed, Unity left-handed: importers flip X, so positions are written with -x.
   */
  public unity_script (): string {
    const shots = this.shot_data()
    const v = (a: number[]): string => `new Vector3(${(-a[0]).toFixed(3)}f, ${a[1].toFixed(3)}f, ${a[2].toFixed(3)}f)`
    const rows = shots.map(s => `        new Shot { name = ${JSON.stringify(s.name)}, t = ${s.t}f, dur = ${s.dur}f, mode = "${s.mode}", pos = ${v(s.p0)}, target = ${v(s.t0)}, fov = ${s.fov}f, follow = ${JSON.stringify(s.follow)}, offset = ${v(s.offset)}, blend = ${s.blend}f },`).join('\n')
    return `// Greenbox play-test camera shots -> Unity. Add to any GameObject; press Play.
using UnityEngine;

public class GreenboxShots : MonoBehaviour
{
    [System.Serializable]
    public class Shot { public string name; public float t, dur, fov, blend; public string mode, follow; public Vector3 pos, target, offset; }

    public Camera cam;
    public bool loop = false;
    public Shot[] shots = new Shot[] {
${rows}
    };
    float t0; Vector3 lastPos, lastAim;

    void Start() { if (cam == null) cam = Camera.main; t0 = Time.time; }

    Transform Find(string n) {
        if (n == "player") { var p = GameObject.FindWithTag("Player"); if (p != null) return p.transform; n = "Player"; }
        var g = GameObject.Find(n); return g != null ? g.transform : null;
    }

    void LateUpdate() {
        if (cam == null || shots.Length == 0) return;
        float t = Time.time - t0, end = 0;
        foreach (var s in shots) end = Mathf.Max(end, s.t + s.dur);
        if (t > end) { if (!loop) return; t0 = Time.time; t = 0; }
        int i = 0; for (int k = 0; k < shots.Length; k++) if (shots[k].t <= t) i = k;
        var sh = shots[i]; var o = sh.mode == "fixed" ? null : Find(sh.follow);
        Vector3 pos = sh.pos, aim = sh.target;
        if (o != null && sh.mode == "follow") { pos = o.position + sh.offset; aim = o.position + Vector3.up * ${LOOK_UP}f; }
        else if (o != null && sh.mode == "look") aim = o.position + Vector3.up * ${LOOK_UP}f;
        float since = t - sh.t;
        if (sh.blend > 0 && since < sh.blend && i > 0) { float e = Mathf.SmoothStep(0, 1, since / sh.blend); pos = Vector3.Lerp(lastPos, pos, e); aim = Vector3.Lerp(lastAim, aim, e); }
        else if (i + 1 < shots.Length) { lastPos = pos; lastAim = aim; }
        cam.transform.position = pos; cam.transform.LookAt(aim); cam.fieldOfView = sh.fov;
    }
}
`
  }

  public export_unity (): void { this.download(new Blob([this.unity_script()], { type: 'text/plain' }), 'GreenboxShots.cs') }

  /* ---------------- 2D layout picture -> 3D map ---------------- */
  public generate_from_layout (): void {
    if (this.layout_img === null) return
    const res = layout_to_map(this.layout_img, this.legend, this.n, this.cell, this.water, { tol: this.layout_tol, mountain: this.layout_peak })
    this.heights = Float32Array.from(res.heights); this.types = Uint8Array.from(res.types); this.pools = []
    if ((res.counts.water ?? 0) > 0 || res.types.includes(6)) this.sea = true
    for (const o of this.placed()) this.remove_object(o)
    this.rebuild()
    for (const o of res.objects) this.add_object(o.kind, o.x, o.z, o.r, o.s)
    this.status?.(M(`Map built from the picture: ${res.note}. Edit it with the tools, it is a normal map now.`, `Đã dựng map từ ảnh: ${res.note}. Giờ là map thường, chỉnh tiếp bằng các công cụ.`, `그림으로 맵 생성: ${res.note}`))
    const out = this.panel?.querySelector('[data-lnote]'); if (out != null) out.textContent = res.note
  }

  private set_layout (img: HTMLImageElement): void {
    this.layout_img = img
    const tex = new THREE.Texture(img); tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace
    this.guide_mat?.map?.dispose(); this.guide_mat = new THREE.MeshLambertMaterial({ map: tex, flatShading: true })
    if (this.guide_on) this.terrain.material = this.guide_mat
    this.render_legend()
  }

  public show_guide (on: boolean): void { this.guide_on = on; this.terrain.material = on && this.guide_mat !== null ? this.guide_mat : this.terrain_mat }

  private save_legend (): void { try { localStorage.setItem('gb.playtest.legend', JSON.stringify(this.legend)) } catch { /* ignore */ } }

  private render_legend (): void {
    const box = this.panel?.querySelector('[data-legend]'); if (box == null) return
    const vi = M('en', 'vi', 'ko') === 'vi'
    const kinds = Object.keys(KIND_LABEL) as LayoutKind[]
    box.innerHTML = this.legend.map((l, i) => `<div class="row" style="gap:4px;${i === this.legend_active ? 'outline:1px solid #ffb020;border-radius:6px' : ''}"><input type="radio" name="lg-act" data-lact="${i}"${i === this.legend_active ? ' checked' : ''} title="${M('Click the picture to pick this colour', 'Bấm lên ảnh để lấy màu cho dòng này', '그림을 클릭해 색 선택')}"><input type="color" data-lcol="${i}" value="${l.color}" style="flex:none;width:34px;padding:0"><select data-lkind="${i}" style="flex:1;min-width:0">${kinds.map(k => `<option value="${k}"${l.kind === k ? ' selected' : ''}>${KIND_LABEL[k][vi ? 1 : 0]}</option>`).join('')}</select><button data-ldel="${i}" style="flex:none;padding:2px 6px">✕</button></div>`).join('')
    const cv = this.panel?.querySelector<HTMLCanvasElement>('[data-lprev]')
    if (cv != null) {
      if (this.layout_img === null) { cv.style.display = 'none'; return }
      cv.style.display = 'block'; const w = 220; const h = Math.round(w * this.layout_img.height / this.layout_img.width); cv.width = w; cv.height = h
      cv.getContext('2d')!.drawImage(this.layout_img, 0, 0, w, h)
    }
  }

  private wire_layout (sec: HTMLElement): void {
    const file = sec.querySelector<HTMLInputElement>('[data-k="layout"]')!
    file.onchange = () => {
      const f = file.files?.[0]; if (f === undefined) return
      const img = new Image(); img.onload = () => this.set_layout(img); img.src = URL.createObjectURL(f); file.value = ''
    }
    sec.querySelector<HTMLCanvasElement>('[data-lprev]')!.onclick = (e) => {
      const cv = e.currentTarget as HTMLCanvasElement; const r = cv.getBoundingClientRect()
      const px = cv.getContext('2d')!.getImageData(Math.floor((e.clientX - r.left) / r.width * cv.width), Math.floor((e.clientY - r.top) / r.height * cv.height), 1, 1).data
      const l = this.legend[this.legend_active]; if (l === undefined) return
      l.color = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join(''); this.save_legend(); this.render_legend()
    }
    sec.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement
      if (el.dataset.lact !== undefined) { this.legend_active = Number(el.dataset.lact); this.render_legend() }
      if (el.dataset.lcol !== undefined) { this.legend[Number(el.dataset.lcol)].color = el.value; this.save_legend() }
      if (el.dataset.lkind !== undefined) { this.legend[Number(el.dataset.lkind)].kind = el.value as LayoutKind; this.save_legend() }
    })
    sec.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (b === null) return
      if (b.dataset.ldel !== undefined) { this.legend.splice(Number(b.dataset.ldel), 1); this.legend_active = Math.min(this.legend_active, this.legend.length - 1); this.save_legend(); this.render_legend() }
      const x = b.dataset.lx
      if (x === 'pick') file.click()
      else if (x === 'add') { this.legend.push({ color: '#808080', kind: 'rock' }); this.legend_active = this.legend.length - 1; this.save_legend(); this.render_legend() }
      else if (x === 'auto' && this.layout_img !== null) {
        // the picture's main colours, each given the meaning of the nearest default colour
        const def = DEFAULT_LEGEND.map(d => ({ ...d, rgb: parseInt(d.color.slice(1), 16) }))
        const dist = (a: number, b: number): number => Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255))
        this.legend = main_colours(this.layout_img, 10).map(c => { const v = parseInt(c.slice(1), 16); const near = def.reduce((m, d) => dist(d.rgb, v) < dist(m.rgb, v) ? d : m); return { color: c, kind: near.kind } })
        this.legend_active = 0; this.save_legend(); this.render_legend()
      } else if (x === 'reset') { this.legend = DEFAULT_LEGEND.map(d => ({ ...d })); this.save_legend(); this.render_legend() }
      else if (x === 'gen') { if (this.layout_img === null) { file.click(); return } if (confirm(M('Replace the current map with the one from the picture?', 'Thay map hiện tại bằng map dựng từ ảnh?', '현재 맵을 그림 맵으로 바꿀까요?'))) this.generate_from_layout() }
      else if (x === 'tpl') this.download_layout_template()
    })
    sec.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement; const k = el.dataset.k
      if (k === 'ltol') this.layout_tol = Number(el.value)
      else if (k === 'lpeak') this.layout_peak = Number(el.value)
      else if (k === 'lsize') { this.cell = Number(el.value) / this.n; const o = sec.querySelector('[data-lsizev]'); if (o !== null) o.textContent = `${el.value} m`; this.rebuild() }
      else if (k === 'guide') this.show_guide(el.checked)
    })
  }

  /** a sample plan with every default colour, to draw over / show to an image AI */
  private download_layout_template (): void {
    const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d')!
    const col = (k: LayoutKind): string => DEFAULT_LEGEND.find(l => l.kind === k)?.color ?? '#fff'
    g.fillStyle = col('background'); g.fillRect(0, 0, 1024, 1024)
    g.fillStyle = col('grass'); g.fillRect(40, 40, 944, 944)
    g.fillStyle = col('water'); g.beginPath(); g.ellipse(760, 260, 170, 120, 0.3, 0, 7); g.fill()
    g.strokeStyle = col('water'); g.lineWidth = 46; g.beginPath(); g.moveTo(760, 360); g.bezierCurveTo(700, 560, 900, 700, 860, 984); g.stroke()
    g.fillStyle = col('sand'); g.beginPath(); g.ellipse(600, 200, 70, 40, 0.3, 0, 7); g.fill()
    g.fillStyle = col('mountain'); g.beginPath(); g.ellipse(230, 230, 170, 150, 0, 0, 7); g.fill()
    g.fillStyle = col('forest'); g.beginPath(); g.ellipse(250, 700, 180, 130, 0.4, 0, 7); g.fill()
    g.strokeStyle = col('road'); g.lineWidth = 40; g.beginPath(); g.moveTo(40, 520); g.lineTo(984, 520); g.moveTo(520, 520); g.lineTo(520, 984); g.stroke()
    g.fillStyle = col('house'); for (const [x, y, a] of [[450, 430, 0], [600, 430, 0], [600, 610, 0.5], [420, 640, -0.3]]) { g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-40, -28, 80, 56); g.restore() }
    g.fillStyle = col('tower'); g.beginPath(); g.arc(700, 800, 26, 0, 7); g.fill()
    g.strokeStyle = col('wall'); g.lineWidth = 12; g.beginPath(); g.moveTo(380, 380); g.lineTo(680, 380); g.lineTo(680, 720); g.stroke()
    g.fillStyle = col('flag'); g.beginPath(); g.arc(512, 512, 16, 0, 7); g.fill()
    c.toBlob(b => { if (b !== null) this.download(b, 'greenbox-layout-template.png') }, 'image/png')
  }
  public save_file (): void { this.download(new Blob([JSON.stringify(this.data())], { type: 'application/json' }), 'greenbox-map.json') }

  /* ---------------- panel ---------------- */
  public mount (parent: HTMLElement): void {
    const vi = M('en', 'vi', 'ko') === 'vi'
    const L = (o: { en: string, vi: string }): string => vi ? o.vi : o.en
    const sec = document.createElement('section'); sec.id = 'pt-mapedit'
    const tb = (t: MapTool, label: string, title: string): string => `<button data-mt="${t}" title="${title}">${label}</button>`
    sec.innerHTML = `
      <h3><b>🗺</b>${M('Map editor (build your level)', 'Thiết kế map (dựng màn chơi)', '맵 에디터')}</h3>
      <div class="row">${tb('none', M('🎮 Play', '🎮 Chơi', '🎮 플레이'), '')}${tb('select', '👆 ' + M('Select / move', 'Chọn / kéo', '선택/이동'), M('Click a house, tree, file… to get the move / turn / scale handles. Z turns it 15° (Shift+Z back, Alt+Z 90°). Delete removes it.', 'Bấm vào nhà, cây, file… để hiện tay kéo di chuyển / xoay / phóng to. Z xoay 15° (Shift+Z ngược, Alt+Z 90°). Delete để xoá.', '클릭해 이동/회전/크기 핸들 표시. Z 회전.'))}${tb('erase', '🧽 ' + M('Eraser', 'Gôm', '지우개'), M('Erase objects / files / boxes under the brush (drag). Click poured water to drain it.', 'Gôm vật thể / file / hộp dưới cọ (kéo được). Bấm vào nước đã đổ để rút nước.', '브러시 아래 오브젝트 삭제'))}</div>
      <div class="row">${tb('raise', '⛰ ' + M('Raise', 'Nâng', '올리기'), '')}${tb('lower', '⬇ ' + M('Lower', 'Hạ', '내리기'), '')}${tb('flatten', '▭ ' + M('Flatten', 'San phẳng', '평탄화'), '')}</div>
      <div class="row">${tb('smooth', '〰 ' + M('Smooth', 'Làm mịn', '부드럽게'), '')}${tb('paint', '🖌 ' + M('Paint', 'Tô đất', '칠하기'), '')}</div>
      <div class="row">${tb('dig', '🕳 ' + M('Dig hole / trench', 'Khoét hố / rãnh', '구덩이 파기'), M('Carves a flat-bottomed hole; drag to draw a channel / river bed', 'Khoét hố đáy phẳng; kéo để kẻ rãnh / lòng sông', '바닥이 평평한 구덩이'))}${tb('pour', '💧 ' + M('Pour water', 'Đổ nước', '물 붓기'), M('Click inside a dug hole / channel: it fills up to its rim', 'Bấm vào trong hố / rãnh đã khoét: nước dâng tới miệng', '구덩이를 클릭하면 물이 찹니다'))}</div>
      <label class="sm">${M('Dig depth', 'Độ sâu khoét', '파기 깊이')} <input type="range" data-k="dig" min="3" max="80" value="${this.dig_depth * 10}"></label>
      <label class="sm">${M('Water fill', 'Nước đầy', '물 채움')} <input type="range" data-k="fill" min="30" max="100" value="${this.pool_fill * 100}"></label>
      <div class="row" data-grounds>${GROUND.map((g, i) => `<button data-gr="${i}" title="${L(g)}" style="flex:none;width:30px;height:26px;padding:0;background:#${g.color.toString(16).padStart(6, '0')}"></button>`).join('')}</div>
      <div class="row" data-objs style="flex-wrap:wrap">${OBJECTS.map(o => `<button data-ob="${o.id}" title="${L(o)}" style="flex:none;padding:4px 6px">${o.icon}</button>`).join('')}</div>
      <div class="row" data-cobjs style="flex-wrap:wrap"></div>
      <div class="row"><button data-x="addfile" title="${M('Your own GLB / FBX / OBJ: it joins the palette, then click to place as many as you want (Z turns it before placing)', 'GLB / FBX / OBJ của bạn: vào bảng vật thể, rồi bấm để đặt bao nhiêu cái cũng được (Z xoay trước khi đặt)', '내 3D 파일을 팔레트에 추가')}">＋ ${M('3D file to the palette…', 'File 3D vào bảng vật…', '3D 파일 추가…')}</button></div>
      <input type="file" data-k="cfile" accept=".glb,.gltf,.fbx,.obj,.dae,.stl,.ply,.3mf,.zip" multiple hidden>
      <div class="sm">${M('Placing: Z turns the object 15° one way, X the other way (Alt = 90°).', 'Đang đặt: Z xoay vật 15° một chiều, X xoay ngược lại (giữ Alt = 90°).', '배치 중: Z/X로 회전.')}</div>
      <label class="sm">${M('Brush size', 'Cỡ cọ', '브러시 크기')} <input type="range" data-k="radius" min="1" max="12" value="${this.radius}"></label>
      <label class="sm">${M('Strength', 'Lực', '강도')} <input type="range" data-k="strength" min="5" max="100" value="${this.strength * 100}"></label>
      <label class="sm"><input type="checkbox" data-k="sea"${this.sea ? ' checked' : ''}> ${M('Sea level', 'Mực nước biển', '해수면')} <input type="range" data-k="water" min="-30" max="30" value="${this.water * 10}"></label>
      <div class="row"><button data-x="clear" title="${M('Remove every object, file, box, water and shot; flat ground (Ctrl+Z brings it back)', 'Xoá mọi vật, file, hộp, nước và shot; mặt đất phẳng (Ctrl+Z để lấy lại)', '모두 지우기')}">🗑 ${M('Clear everything', 'Xoá hết mọi thứ', '모두 지우기')}</button></div>
      <div class="row"><select data-k="preset" style="flex:1"><option value="">${M('New map…', 'Map mới…', '새 맵…')}</option><option value="flat">${M('Flat', 'Phẳng', '평지')}</option><option value="hills">${M('Hills', 'Đồi', '언덕')}</option><option value="island">${M('Island', 'Đảo', '섬')}</option><option value="valley">${M('Valley', 'Thung lũng', '계곡')}</option><option value="mountains">${M('Mountains', 'Núi', '산')}</option></select></div>
      <div class="row"><button data-x="save">💾 ${M('Save .json', 'Lưu .json', '저장')}</button><button data-x="load">📂 ${M('Open', 'Mở', '열기')}</button></div>
      <div class="row"><button data-x="glb" title="${M('Map + camera shots as glTF cameras (Unity, Godot, Blender)', 'Map + các shot camera (camera glTF cho Unity, Godot, Blender)', '맵 + 카메라')}">⬇ GLB</button><button data-x="blend" title="${M('A Python script that rebuilds this map in Blender, with the cameras and the markers that switch them', 'Script Python dựng lại map trong Blender, kèm camera và marker đổi camera', '블렌더 스크립트')}">⬇ Blender (.py)</button><button data-x="unity" title="${M('C# script: plays the camera shots in Unity (import the GLB first)', 'Script C#: phát các shot camera trong Unity (import GLB trước)', '유니티 C#')}">⬇ Unity (.cs)</button></div>
      <input type="file" data-k="file" accept=".json" hidden>
      <details data-layout style="margin-top:6px"><summary style="cursor:pointer;font-weight:600">🖼 ${M('2D layout picture → 3D map', 'Ảnh layout 2D → map 3D', '2D 레이아웃 → 3D 맵')}</summary>
        <div class="sm">${M('A top-down plan where colours mean things. Each colour blob is measured (place, size, direction) and becomes ground, water, mountains, houses, walls, forests…', 'Bản vẽ nhìn từ trên xuống, mỗi màu là một thứ. Từng mảng màu được đo (vị trí, kích thước, hướng) rồi thành đất, nước, núi, nhà, tường, rừng…', '색으로 그린 평면도를 3D 맵으로')}</div>
        <div class="row"><button data-lx="pick">⬆ ${M('Picture…', 'Chọn ảnh…', '그림…')}</button><button data-lx="tpl">⬇ ${M('Sample plan', 'Ảnh mẫu', '샘플')}</button></div>
        <input type="file" data-k="layout" accept="image/*" hidden>
        <canvas data-lprev style="display:none;width:100%;border-radius:6px;cursor:crosshair" title="${M('Click to take the colour for the selected legend row', 'Bấm để lấy màu cho dòng chú thích đang chọn', '클릭해 색 선택')}"></canvas>
        <div class="sm">${M('Legend (colour → meaning). Select a row, then click the picture to take its colour.', 'Chú thích (màu → nghĩa). Chọn một dòng rồi bấm lên ảnh để lấy đúng màu.', '범례')}</div>
        <div data-legend style="display:flex;flex-direction:column;gap:3px"></div>
        <div class="row"><button data-lx="add">＋ ${M('colour', 'màu', '색')}</button><button data-lx="auto">🎨 ${M('From the picture', 'Lấy màu từ ảnh', '그림에서')}</button><button data-lx="reset">↺</button></div>
        <label class="sm">${M('Colour tolerance', 'Độ lệch màu', '색 허용치')} <input type="range" data-k="ltol" min="40" max="300" value="${this.layout_tol}"></label>
        <label class="sm">${M('Mountain height', 'Độ cao núi', '산 높이')} <input type="range" data-k="lpeak" min="2" max="30" value="${this.layout_peak}"></label>
        <label class="sm">${M('Map size', 'Cỡ map', '맵 크기')} <input type="range" data-k="lsize" min="32" max="256" step="16" value="${this.n * this.cell}"> <span data-lsizev>${this.n * this.cell} m</span></label>
        <label class="row sm"><input type="checkbox" data-k="guide"> ${M('Show the picture on the ground', 'Hiện ảnh lên mặt đất', '지면에 그림 표시')}</label>
        <div class="row"><button data-lx="gen" class="pri">⚙ ${M('Build the 3D map', 'Dựng map 3D', '3D 맵 생성')}</button></div>
        <div class="sm" data-lnote></div>
      </details>
      <div class="sm">${M('Click / drag on the ground with a tool. Objects: pick one, click to place (houses snap to the grid). Right-drag turns the camera. Blender: Scripting › Open the .py › Run Script.', 'Bấm / kéo trên mặt đất với công cụ. Vật thể: chọn rồi bấm để đặt (nhà tự khớp lưới). Kéo chuột phải để xoay camera. Blender: Scripting › Open file .py › Run Script.', '도구로 지면을 클릭/드래그하세요.')}</div>`
    sec.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (b === null) return
      if (b.dataset.mt !== undefined) this.tool = b.dataset.mt as MapTool
      if (b.dataset.gr !== undefined) { this.ground = Number(b.dataset.gr); this.tool = 'paint' }
      if (b.dataset.ob !== undefined) { this.object = b.dataset.ob; this.tool = 'place'; this.user_rot = false; this.rot = 0 }
      if (b.dataset.rmf !== undefined) { void this.remove_custom(b.dataset.rmf); return }
      if (b.dataset.lx !== undefined || b.dataset.ldel !== undefined) return
      if (this.tool !== 'place') this.hide_ghost()
      const x = b.dataset.x
      if (x === 'addfile') { (sec.querySelector('[data-k="cfile"]') as HTMLInputElement).click(); return }
      if (x === 'unity') this.export_unity()
      if (x === 'clear' && confirm(M('Clear the whole map? (Ctrl+Z / Cmd+Z brings it back)', 'Xoá hết map? (Ctrl+Z / Cmd+Z để lấy lại)', '맵을 모두 지울까요?'))) this.clear_all()
      if (x === 'save') this.save_file()
      else if (x === 'load') (sec.querySelector('[data-k="file"]') as HTMLInputElement).click()
      else if (x === 'glb') void this.export_glb()
      else if (x === 'blend') this.export_blender()
      this.refresh_panel()
      document.dispatchEvent(new CustomEvent('gb-map-tool', { detail: this.tool }))
    })
    sec.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement; const k = el.dataset.k
      if (k === 'radius') this.radius = Number(el.value)
      else if (k === 'strength') this.strength = Number(el.value) / 100
      else if (k === 'water') { this.water = Number(el.value) / 10; this.rebuild() }
      else if (k === 'sea') { this.sea = el.checked; this.rebuild() }
      else if (k === 'dig') this.dig_depth = Number(el.value) / 10
      else if (k === 'fill') this.pool_fill = Number(el.value) / 100
    })
    sec.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement; const k = el.dataset.k
      if (k === 'preset' && el.value !== '') { if (confirm(M('Replace the current map?', 'Thay map hiện tại?', '현재 맵을 바꿀까요?'))) this.preset(el.value as any); el.value = '' }
      if (k === 'file') { const f = (el as HTMLInputElement).files?.[0]; if (f !== undefined) void f.text().then(t => this.load(JSON.parse(t) as MapData)); (el as HTMLInputElement).value = '' }
      if (k === 'cfile') {
        const fs = Array.from((el as HTMLInputElement).files ?? []); (el as HTMLInputElement).value = ''
        void (async () => { for (const f of fs) { try { const kind = await this.add_custom_file(f.name, await f.arrayBuffer()); this.object = kind; this.tool = 'place'; this.rot = 0; this.user_rot = false } catch (err) { this.status?.(String(err), true) } } this.refresh_panel(); document.dispatchEvent(new CustomEvent('gb-map-tool', { detail: this.tool })) })()
      }
    })
    parent.append(sec); this.panel = sec
    this.wire_layout(sec); this.render_legend(); this.render_custom()
    this.refresh_panel()
  }

  private refresh_panel (): void {
    const p = this.panel; if (p === null) return
    p.querySelectorAll<HTMLElement>('[data-mt]').forEach(b => b.classList.toggle('on', b.dataset.mt === this.tool))
    const sea = p.querySelector<HTMLInputElement>('[data-k="sea"]'); if (sea !== null) sea.checked = this.sea
    p.querySelectorAll<HTMLElement>('[data-gr]').forEach(b => { b.style.outline = this.tool === 'paint' && Number(b.dataset.gr) === this.ground ? '2px solid #fff' : 'none' })
    p.querySelectorAll<HTMLElement>('[data-ob]').forEach(b => b.classList.toggle('on', this.tool === 'place' && b.dataset.ob === this.object))
    if (this.tool === 'none') this.ring.visible = false
  }
}
