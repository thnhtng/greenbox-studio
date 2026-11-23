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
import { clone_deep } from '../common/CloneDeep.ts'
import * as THREE from 'three'
import type { WeatherKind, DayTime } from './Weather.ts'
import { tile, tile_grid } from '../common/Tiles.ts'
import { BEHAVIOURS, DEFAULT_BEHAVIOURS } from './unity/Behaviours.ts'
import { build_unitypackage, type PackageLayout, type PackObject } from './unity/UnityPackage.ts'
import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { M } from '../common/lang.ts'
import { type World } from './World.ts'
import { load_any_buffer } from '../common/AnyLoader.ts'
import { type CameraRig, type Shot, type ShotMode, LOOK_UP } from './CameraRig.ts'
import { type Plan, KIND_INFO } from './PlanEditor.ts'
import { form_outline, pad_picture } from './PlanForms.ts'
import { layout_to_map, main_colours, DEFAULT_LEGEND, KIND_LABEL, type LegendItem, type LayoutKind } from './LayoutImport.ts'

export type MapTool = 'none' | 'select' | 'raise' | 'lower' | 'flatten' | 'smooth' | 'paint' | 'place' | 'erase' | 'dig' | 'pour' | 'grab' | 'crease' | 'noise' | 'terrace'
/** ✋ sculpt tools (Blender-like, on the terrain) */
export const SCULPT_TOOLS: MapTool[] = ['grab', 'crease', 'noise', 'terrace']
export const GROUND: Array<{ id: string, color: number, en: string, vi: string }> = [
  { id: 'grass', color: 0x6fa84a, en: 'Grass', vi: 'Cỏ' },
  { id: 'dirt', color: 0x8a6a45, en: 'Dirt', vi: 'Đất' },
  { id: 'sand', color: 0xd8c48a, en: 'Sand', vi: 'Cát' },
  { id: 'rock', color: 0x7d7d7d, en: 'Rock', vi: 'Đá' },
  { id: 'snow', color: 0xeef2f5, en: 'Snow', vi: 'Tuyết' },
  { id: 'road', color: 0x4b4b4f, en: 'Road', vi: 'Đường' },
  { id: 'mud', color: 0x5b4a36, en: 'Water bed', vi: 'Đáy nước' }
]
/** objects drawn as a run (press-drag-release along the grid) */
export const RUN_KINDS = ['fence', 'wall', 'hwall', 'door', 'window']
/** wall pieces that close a room (a roof is fitted inside them) */
export const HOUSE_WALLS = ['wall', 'hwall', 'door', 'window']
/** house wall height (the castle wall is 2.2 m) */
const HWALL_H = 2.6
/** 🏢 one storey: a 2.6 m wall + a 0.2 m floor slab; levels 0..MAX_LEVEL-1 (shown as 1..5) */
export const LEVEL_H = 2.8
export const MAX_LEVEL = 5
const SLAB = 0.2
/** stairs: 14 steps x 0.2 m = one storey, 1 cell wide, 3 cells (4.5 m) long, rising towards local +Z */
const STAIR_N = 14; const STAIR_W = 1.5; const STAIR_L = 4.5
/** the storey of a placed object (0 = ground floor; old maps have none) */
export function lv_of (o: THREE.Object3D): number { return (o.userData.map_extra as MapExtra | undefined)?.lv ?? 0 }
/** how high above the ground an object of this kind sits on storey lv */
function lift (kind: string, lv: number): number { return lv * LEVEL_H + (kind === 'floor' && lv === 0 ? 0.04 : 0) }
export const OBJECTS: Array<{ id: string, icon: string, en: string, vi: string, grid: boolean }> = [
  { id: 'pine', icon: '🌲', en: 'Pine', vi: 'Thông', grid: false },
  { id: 'tree', icon: '🌳', en: 'Tree', vi: 'Cây', grid: false },
  { id: 'bush', icon: '🌿', en: 'Bush', vi: 'Bụi', grid: false },
  { id: 'rock', icon: '🪨', en: 'Rock', vi: 'Đá', grid: false },
  { id: 'house', icon: '🏠', en: 'House', vi: 'Nhà', grid: true },
  { id: 'tower', icon: '🗼', en: 'Tower', vi: 'Tháp', grid: true },
  { id: 'wall', icon: '🧱', en: 'Wall', vi: 'Tường', grid: true },
  { id: 'fence', icon: '🚧', en: 'Fence', vi: 'Hàng rào', grid: true },
  { id: 'hwall', icon: '🟫', en: 'House wall', vi: 'Tường nhà', grid: true },
  { id: 'door', icon: '🚪', en: 'Door', vi: 'Cửa', grid: true },
  { id: 'window', icon: '🪟', en: 'Window', vi: 'Cửa sổ', grid: true },
  { id: 'roof', icon: '🛖', en: 'Roof', vi: 'Mái', grid: false },
  { id: 'floor', icon: '🟨', en: 'Floor', vi: 'Sàn', grid: false },
  { id: 'stairs', icon: '🪜', en: 'Stairs', vi: 'Cầu thang', grid: false },
  { id: 'crate', icon: '📦', en: 'Crate', vi: 'Thùng', grid: true },
  { id: 'barrel', icon: '🛢', en: 'Barrel', vi: 'Thùng tròn', grid: false },
  { id: 'flag', icon: '🚩', en: 'Flag / spawn', vi: 'Cờ / điểm xuất phát', grid: true },
  { id: 'node', icon: '⬚', en: 'Node cell (drop zone)', vi: 'Ô node (nét đứt)', grid: true },
  { id: 'money', icon: '💵', en: 'Money pile', vi: 'Đống tiền', grid: false },
  { id: 'table', icon: '🪵', en: 'Table', vi: 'Bàn', grid: true },
  { id: 'grass', icon: '🌾', en: 'Tall grass', vi: 'Bụi cỏ', grid: false },
  { id: 'saw', icon: '🪚', en: 'Saw', vi: 'Máy cưa', grid: false }
]

/** extra data of plan blocks / flow wires: size (w, h, d), colour, label, shape id, the 3D look, wire style */
export interface MapExtra { mb?: Array<{ t: string, o?: Record<string, string | number | boolean> }>, lv?: number, holes?: number[][], pid?: string, size?: [number, number, number], color?: string, label?: string, form?: string, model?: string, mode?: string, role?: string, image?: string, price?: number, note?: string }
export interface MapObject { kind: string, p: [number, number, number], r: number, s: number, x?: MapExtra }
/** water poured into a hole / channel: grid points under the water and its level */
export interface Pool { level: number, cells: number[] }
export interface MapData { version: 1, n: number, cell: number, water: number, sea?: boolean, heights: number[], types: number[], paint?: number[], objects: MapObject[], pools?: Pool[], shots?: Shot[], plan?: Plan, wires_hidden?: boolean, weather?: [WeatherKind, DayTime] }
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

/**
 * 🎨 export: every material gets a name that says its colour — GB_rrggbb, GB_rrggbb_aa (see-through, aa = alpha %),
 * GB_Water_rrggbb_aa, GB_Terrain (vertex colours) — on copies, so the editor's own materials are untouched.
 * Unity's FBX import merges materials with the same name (they were all "Material" → everything white); the
 * package builder also rebuilds the colours from these names.
 */
/** a playable is one small file: opaque textures go in as JPEG (the exporter writes PNG, 3-6× bigger) */
export function jpeg_textures (root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh; if (m.isMesh !== true) return
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      if (mt.transparent === true || mt.alphaTest > 0) continue
      for (const t of [mt.map, mt.normalMap, mt.roughnessMap, mt.metalnessMap, mt.aoMap, mt.emissiveMap]) if (t != null && t.userData.mimeType === undefined) t.userData.mimeType = 'image/jpeg'
    }
  })
}
export function name_materials_for_export (root: THREE.Object3D): void {
  const cache = new Map<string, THREE.Material>()
  root.traverse(o => {
    const m = o as THREE.Mesh; if (m.isMesh !== true) return
    const conv = (mt: THREE.Material): THREE.Material => {
      const src = mt as THREE.MeshLambertMaterial
      const vc = src.vertexColors === true && m.geometry.getAttribute('color') !== undefined
      const water = /^(Water|Pool)/.test(o.name) || /^(Water|Pool)/.test(o.parent?.name ?? '')
      // see-through: water keeps its opacity; other parts use their own (glass), never the editor's cut-away fade
      const a = water ? src.opacity : ((m.userData.base_opacity as number | undefined) ?? 1)
      const hex = (src.color ?? new THREE.Color(1, 1, 1)).getHexString()
      const pa = Math.round(a * 100)
      // a textured material is its own (keying by colour alone gave every white textured model the first one's picture)
      const tex = (src as THREE.MeshStandardMaterial).map ?? null
      const name = (vc ? 'GB_Terrain' : water ? `GB_Water_${hex}_${pa}` : pa < 100 ? `GB_${hex}_${pa}` : `GB_${hex}`) + (tex !== null ? `_${tex.uuid.slice(0, 8)}` : '') + (src.type !== 'MeshLambertMaterial' && tex !== null ? `_${src.type.replace(/^Mesh|Material$/g, '')}` : '')
      let out = cache.get(name)
      if (out === undefined) { out = src.clone(); out.name = name; out.opacity = a; out.transparent = a < 1; out.depthWrite = a >= 1; cache.set(name, out) }
      return out
    }
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material)
  })
}

/** a gable roof over a w x d room whose walls are h tall (pivot: the floor centre); the ridge runs along the longer side */
function build_roof (g: THREE.Group, x: MapExtra): void {
  const [w, h, d] = x.size ?? [6, HWALL_H, 6]
  const o = 0.4; const along_x = w >= d
  const short = (along_x ? d : w) + 2 * o; const long = (along_x ? w : d) + 2 * o
  const rise = Math.max(0.8, short * 0.32)
  const sh = new THREE.Shape(); sh.moveTo(-short / 2, 0); sh.lineTo(short / 2, 0); sh.lineTo(0, rise); sh.closePath()
  const geo = new THREE.ExtrudeGeometry(sh, { depth: long, bevelEnabled: false }); geo.translate(0, 0, -long / 2)
  if (along_x) geo.rotateY(Math.PI / 2)
  const roof = new THREE.Mesh(geo, lambert(0xa0442f)); roof.position.y = h; roof.castShadow = true; roof.receiveShadow = true
  // the gable ends in wall colour, a hair inside the roof ends
  const gsh = new THREE.Shape(); gsh.moveTo(-short / 2 + o, 0); gsh.lineTo(short / 2 - o, 0); gsh.lineTo(0, rise * (short - 2 * o) / short); gsh.closePath()
  for (const sgn of [-1, 1]) {
    const gg = new THREE.ShapeGeometry(gsh); if (along_x) gg.rotateY(Math.PI / 2)
    const m = new THREE.Mesh(gg, lambert(0xe6dac2)); (m.material as THREE.Material).side = THREE.DoubleSide
    const off = (long / 2 - o) * sgn; if (along_x) m.position.set(off, h, 0); else m.position.set(0, h, off)
    g.add(m)
  }
  g.add(roof)
  g.traverse(m => { m.userData.roof = true })
}

/** a floor slab w x d, top at the pivot, `t` thick, with rectangular holes [x0, z0, x1, z1] (local) for stairs */
function build_floor (g: THREE.Group, x: MapExtra): void {
  const [w, t, d] = x.size ?? [6, SLAB, 6]
  const sh = new THREE.Shape(); sh.moveTo(-w / 2, -d / 2); sh.lineTo(w / 2, -d / 2); sh.lineTo(w / 2, d / 2); sh.lineTo(-w / 2, d / 2); sh.closePath()
  for (const [x0, z0, x1, z1] of x.holes ?? []) { const hp = new THREE.Path(); hp.moveTo(x0, z0); hp.lineTo(x0, z1); hp.lineTo(x1, z1); hp.lineTo(x1, z0); hp.closePath(); sh.holes.push(hp) }
  const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }); geo.rotateX(Math.PI / 2) // shape y -> world z, the depth goes down
  const m = new THREE.Mesh(geo, lambert(0xc9a77c)); m.castShadow = true; m.receiveShadow = true; g.add(m)
}

/** straight stairs: STAIR_N solid steps rising towards +Z, with two side stringers */
function build_stairs (g: THREE.Group): void {
  const r = LEVEL_H / STAIR_N; const T = STAIR_L / STAIR_N
  for (let k = 0; k < STAIR_N; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(STAIR_W - 0.1, (k + 1) * r, T), lambert(k % 2 === 0 ? 0xb88a5a : 0xad8052))
    m.position.set(0, (k + 1) * r / 2, -STAIR_L / 2 + (k + 0.5) * T); m.castShadow = true; m.receiveShadow = true; g.add(m)
  }
  const len = Math.hypot(STAIR_L, LEVEL_H); const a = Math.atan2(LEVEL_H, STAIR_L)
  for (const sgn of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, len), lambert(0x7a4a2a)); m.rotation.x = -a
    m.position.set(sgn * (STAIR_W / 2 - 0.03), LEVEL_H / 2 + 0.5, 0); m.castShadow = true; g.add(m)
  }
}

export function build_object (kind: string, extra?: MapExtra): THREE.Group {
  const g = new THREE.Group(); g.name = kind; g.userData.map_kind = kind
  if (extra !== undefined) g.userData.map_extra = extra // the storey (lv) of walls, fences, props…
  if (kind === 'roof') { g.userData.map_extra = extra ?? {}; build_roof(g, extra ?? {}); return g }
  if (kind === 'floor') { g.userData.map_extra = extra ?? {}; build_floor(g, extra ?? {}); return g }
  if (kind === 'stairs') { build_stairs(g); return g }
  if (kind === 'block' || kind === 'wire') { g.userData.map_extra = extra ?? {}; if (kind === 'block') build_block(g, extra ?? {}); else build_wire(g, extra ?? {}); return g }
  if (kind.startsWith('file:')) {
    const t = CUSTOM.get(kind)
    if (t !== undefined) g.add(clone_deep(t))
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
    case 'fence': for (let i = -1.5; i <= 1.5; i += 1) add(new THREE.BoxGeometry(0.15, 1.1, 0.15), 0x7a5634, i, 0.55); add(new THREE.BoxGeometry(3.0, 0.12, 0.08), 0x8a6640, 0, 0.75); add(new THREE.BoxGeometry(3.0, 0.12, 0.08), 0x8a6640, 0, 0.35); break
    // house walls: 3 m along X between two grid posts (+0.1 each end so corners close), 0.2 m thick
    case 'hwall': add(new THREE.BoxGeometry(3.2, HWALL_H, 0.2), 0xe6dac2, 0, HWALL_H / 2); break
    case 'door': {
      const sw = 1.1; const side = (sgn: number): void => { add(new THREE.BoxGeometry(sw, HWALL_H, 0.2), 0xe6dac2, sgn * (1.6 - sw / 2), HWALL_H / 2) }
      side(-1); side(1); add(new THREE.BoxGeometry(1.0, HWALL_H - 2.1, 0.2), 0xe6dac2, 0, 2.1 + (HWALL_H - 2.1) / 2)
      add(new THREE.BoxGeometry(0.92, 2.04, 0.06), 0x7a4a2a, -0.5, 1.02, 0.5, Math.PI / 2) // the door leaf, standing open
      break
    }
    case 'window': {
      add(new THREE.BoxGeometry(3.2, 0.9, 0.2), 0xe6dac2, 0, 0.45); add(new THREE.BoxGeometry(3.2, HWALL_H - 2.0, 0.2), 0xe6dac2, 0, 2.0 + (HWALL_H - 2.0) / 2)
      for (const sgn of [-1, 1]) add(new THREE.BoxGeometry(1.1, 1.1, 0.2), 0xe6dac2, sgn * 1.05, 1.45)
      const gl = add(new THREE.BoxGeometry(1.0, 1.1, 0.04), 0x9fd3f0, 0, 1.45); const gm = gl.material as THREE.MeshLambertMaterial; gm.transparent = true; gm.opacity = 0.4; gl.userData.base_opacity = 0.4; gl.castShadow = false
      add(new THREE.BoxGeometry(1.0, 0.06, 0.24), 0x8a6640, 0, 0.93)
      break
    }
    case 'crate': add(new THREE.BoxGeometry(1.2, 1.2, 1.2), 0xb88a4a, 0, 0.6); break
    case 'barrel': add(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), 0x8a3d2b, 0, 0.55); break
    case 'flag': add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), 0xdddddd, 0, 1.3); add(new THREE.BoxGeometry(0.9, 0.55, 0.04), 0xe23d3d, 0.47, 2.25); add(new THREE.CylinderGeometry(0.7, 0.8, 0.12, 12), 0xe8d36a, 0, 0.06); break
    case 'node': { // a dashed square on the ground (2.4 m): where a stack is dropped / picked up
      const S = 2.4; const dash = 0.34; const gap = 0.18; const w = 0.09
      for (let side = 0; side < 4; side++) {
        for (let t = -S / 2 + dash / 2; t < S / 2; t += dash + gap) {
          const along_x = side % 2 === 0
          const m = add(new THREE.BoxGeometry(dash, 0.03, w), 0xffffff, along_x ? t : (side === 1 ? S / 2 : -S / 2), 0.03, along_x ? (side === 0 ? S / 2 : -S / 2) : t, along_x ? 0 : Math.PI / 2)
          m.castShadow = false
        }
      }
      const f = add(new THREE.BoxGeometry(S - 0.1, 0.01, S - 0.1), 0x2fe98b, 0, 0.01); const fm = f.material as THREE.MeshLambertMaterial; fm.transparent = true; fm.opacity = 0.18; f.castShadow = false
      break
    }
    case 'money': for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.62, 0.1, 0.32), k % 2 === 0 ? 0x3fae5a : 0x4cc46a, (i % 2 - 0.5) * 0.7, 0.05 + k * 0.105, (Math.floor(i / 2) - 0.5) * 0.4, (k % 2) * 0.06); break
    case 'table': add(new THREE.BoxGeometry(2.4, 0.12, 1.4), 0xb07a46, 0, 0.9); for (const [x, z] of [[-1.05, -0.55], [1.05, -0.55], [-1.05, 0.55], [1.05, 0.55]]) add(new THREE.BoxGeometry(0.12, 0.84, 0.12), 0x8a5a32, x, 0.42, z); break
    case 'grass': for (let i = 0; i < 11; i++) { const a = i * 2.39; const r = 0.15 + (i % 4) * 0.12; const m = add(new THREE.ConeGeometry(0.07, 0.75 + (i % 3) * 0.2, 4), i % 2 === 0 ? 0x5fb048 : 0x4e9a3c, Math.cos(a) * r, 0.38 + (i % 3) * 0.1, Math.sin(a) * r); m.rotation.z = Math.cos(a) * 0.12; m.rotation.x = Math.sin(a) * 0.12 } break
    case 'saw': {
      add(new THREE.BoxGeometry(0.5, 0.9, 0.4), 0x555d66, 0, 0.45)
      const blade = new THREE.Group(); blade.name = 'blade'; blade.position.set(0, 1.3, 0); g.add(blade)
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.04, 24), lambert(0xc9ced4)); disc.rotation.x = Math.PI / 2; blade.add(disc)
      for (let i = 0; i < 16; i++) { const tth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 3), lambert(0xe2e6ea)); const a = i / 16 * Math.PI * 2; tth.position.set(Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0); tth.rotation.z = a - Math.PI / 2; blade.add(tth) }
      blade.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) m.castShadow = true })
      break
    }
    default: add(new THREE.BoxGeometry(1, 1, 1), 0xbbbbbb, 0, 0.5)
  }
  // 🏢 a house wall on floor 2+: a 0.2 m band under it fills the slab gap down to the wall below (no light slit)
  if ((kind === 'hwall' || kind === 'door' || kind === 'window') && (extra?.lv ?? 0) > 0) add(new THREE.BoxGeometry(3.2, SLAB, 0.2), 0xe6dac2, 0, -SLAB / 2)
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
  /** ✋ grab: the heights and mouse height at the press */
  private grab0: { h: Float32Array, y: number, ci: number, cj: number } | null = null
  /** ⟶ drawing a fence / wall run: start post (on a grid point), the ghost segments, the last end point */
  private run: { kind: string, ax: number, az: number, bx: number, bz: number, ghost: THREE.Group } | null = null
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
  /** ✋ a click on a placed prop while placing: the play test grabs it instead of dropping a new one (true = taken) */
  public grab_hook: ((e: PointerEvent) => boolean) | null = null

  /* ---------------- 🖌 smooth ground paint: round soft strokes on a 1024² canvas over the terrain (the grid colours stay underneath for export) ---------------- */
  private readonly splat = document.createElement('canvas')
  private readonly splat_tex!: THREE.CanvasTexture
  /** every paint stroke, in map metres: x, z, radius, ground index (saved with the map, redrawn when the map size changes) */
  private strokes: number[] = []
  private splat_span = 0
  private make_terrain_mat (): THREE.MeshLambertMaterial {
    this.splat.width = this.splat.height = 1024
    const tex = new THREE.CanvasTexture(this.splat); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
    ;(this as any).splat_tex = tex
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.splatMap = { value: tex }
      sh.vertexShader = 'varying vec2 vSplatUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vSplatUv = uv;')
      sh.fragmentShader = 'uniform sampler2D splatMap;\nvarying vec2 vSplatUv;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  vec4 sp = texture2D(splatMap, vSplatUv);\n  diffuseColor.rgb = mix(diffuseColor.rgb, sp.rgb, sp.a);')
    }
    m.customProgramCacheKey = () => 'gb-terrain-splat'
    return m
  }
  /** one soft round dab at map (x, z), radius r metres, in ground colour g */
  private dab (x: number, z: number, r: number, g: number): void {
    const span = this.n * this.cell; const S = this.splat.width; const ctx = this.splat.getContext('2d'); if (ctx === null) return
    const px = (x + span / 2) / span * S; const py = (z + span / 2) / span * S; const pr = r / span * S
    const hx = GROUND[g]?.color ?? 0x888888; const rgb = `${(hx >> 16) & 255},${(hx >> 8) & 255},${hx & 255}` // the canvas is sRGB (THREE.Color keeps linear values)
    const grd = ctx.createRadialGradient(px, py, pr * 0.55, px, py, pr)
    grd.addColorStop(0, `rgba(${rgb},1)`); grd.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill()
  }
  private paint_stroke (x: number, z: number, r: number, g: number): void {
    this.strokes.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(r * 100) / 100, g)
    if (this.strokes.length > 4 * 20000) this.strokes.splice(0, 4 * 2000)
    this.dab(x, z, r, g); this.splat_tex.needsUpdate = true
  }
  /** redraw every stroke (after a load / a map size change) */
  private redraw_splat (): void {
    const ctx = this.splat.getContext('2d'); if (ctx === null) return
    ctx.clearRect(0, 0, this.splat.width, this.splat.height)
    for (let i = 0; i + 3 < this.strokes.length; i += 4) this.dab(this.strokes[i], this.strokes[i + 1], this.strokes[i + 2], this.strokes[i + 3])
    this.splat_span = this.n * this.cell; this.splat_tex.needsUpdate = true
  }
  /** a tool that rewrites the ground types (preset, clear) forgets the paint */
  private clear_paint (): void { this.strokes = []; this.redraw_splat() }
  private ghost_top: THREE.Vector3 | null = null
  /** ⇧ snap step for free objects: half a map cell (roads, props line up) */
  public snap_step (): number { return Math.max(0.25, this.cell / 2) }
  public grabbing = false
  public status: ((t: string, warn?: boolean) => void) | null = null
  public dig_depth = 2 // m the dig tool goes below where the stroke started
  public pool_fill = 0.9 // how full a poured hole gets (1 = to the brim)
  public rot = 0 // turn of the next placed object (Z)
  private user_rot = false
  /** 🎲 how different each placed tree / rock / bush is (0 = identical, 1 = very varied): turn around Z's direction + size */
  public variety = 0.7
  /** 📏 size of the next placed object (1 = its normal size) */
  public place_size = 1
  /** ☁ weather + time of day (the app draws them) */
  public wx: WeatherKind = 'clear'
  public daytime: DayTime = 'day'
  public on_weather: ((w: WeatherKind, t: DayTime) => void) | null = null
  public set_weather (w: WeatherKind, t: DayTime): void { this.wx = w; this.daytime = t; this.on_weather?.(w, t); this.autosave() }
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
    this.terrain = new THREE.Mesh(new THREE.BufferGeometry(), this.make_terrain_mat())
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
    if (Math.abs(this.splat_span - n * c) > 1e-6) this.redraw_splat()
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

  /** the whole ground square to `size` m (same cell size): grows with flat ground around it, or is cut to its middle; what is built stays where it is */
  public resize (size: number): void {
    const o = this.n; const n = Math.max(8, 2 * Math.round(size / this.cell / 2)); if (n === o) return
    this.on_edit_start?.()
    const d = (n - o) / 2; const N0 = o + 1; const N1 = n + 1
    const h = new Float32Array(N1 * N1); const t = new Uint8Array(N1 * N1)
    const map = (k: number): number => { const i = k % N0 + d; const j = Math.floor(k / N0) + d; return i < 0 || j < 0 || i > n || j > n ? -1 : j * N1 + i }
    for (let k = 0; k < N0 * N0; k++) { const m = map(k); if (m >= 0) { h[m] = this.heights[k]; t[m] = this.types[k] } }
    this.n = n; this.heights = h; this.types = t
    this.pools = this.pools.map(p => ({ level: p.level, cells: p.cells.map(map).filter(c => c >= 0) })).filter(p => p.cells.length > 0)
    const H = this.half(); let gone = 0
    for (const ob of this.placed()) if (Math.abs(ob.position.x) > H || Math.abs(ob.position.z) > H) { this.remove_object(ob); gone++ }
    this.rebuild(); this.refresh_panel()
    this.status?.(M(`Map size ${(n * this.cell).toFixed(0)} m${gone > 0 ? ` (${gone} objects outside removed)` : ''}.`, `Cỡ map ${(n * this.cell).toFixed(0)} m${gone > 0 ? ` (bỏ ${gone} vật nằm ngoài)` : ''}.`, `맵 크기 ${(n * this.cell).toFixed(0)} m`))
  }

  public preset (kind: 'flat' | 'hills' | 'island' | 'valley' | 'mountains'): void {
    this.clear_paint()
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
    if (this.tool === 'paint') this.paint_stroke(hit.x, hit.z, Math.max(0.5, this.radius * c), this.ground)
    const ci = (hit.x + H) / c; const cj = (hit.z + H) / c; const R = this.radius
    if (first && (this.tool === 'flatten' || this.tool === 'dig')) this.flatten_to = this.height_at(hit.x, hit.z)
    const old = this.tool === 'smooth' ? Float32Array.from(this.heights) : null
    // ✋ grab: the area under the first press follows the mouse up / down (from the heights at the press)
    if (this.tool === 'grab') {
      const ev = this.last_ev
      if (first || this.grab0 === null) this.grab0 = { h: Float32Array.from(this.heights), y: ev?.clientY ?? 0, ci, cj }
      const g = this.grab0; const dy = ((g.y - (ev?.clientY ?? g.y)) * 0.03) * (0.4 + this.strength)
      const was0 = this.world.props.children.filter(o => o !== this.terrain && o !== this.objects)
      for (let j = Math.max(0, Math.floor(g.cj - R)); j <= Math.min(n, Math.ceil(g.cj + R)); j++) {
        for (let i = Math.max(0, Math.floor(g.ci - R)); i <= Math.min(n, Math.ceil(g.ci + R)); i++) {
          const d = Math.hypot(i - g.ci, j - g.cj) / R; if (d > 1) continue
          const k = this.idx(i, j); const f = 1 - d * d; this.heights[k] = g.h[k] + dy * f * (2 - f)
        }
      }
      void was0
      this.rebuild()
      for (const o of this.objects.children) o.position.y = this.height_at(o.position.x, o.position.z)
      return
    }
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
        } else if (this.tool === 'crease') {
          // a sharp ridge: steep falloff, so the middle rises much more than the sides
          const sharp = Math.pow(1 - d, 3); this.heights[k] += sharp * this.strength * 0.9
        } else if (this.tool === 'noise') {
          // rough ground: value noise at two sizes, more in the middle of the brush
          const nv = (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1; const nv2 = (Math.sin(Math.floor(i / 3) * 39.3 + Math.floor(j / 3) * 11.7) * 9631.17) % 1
          this.heights[k] += (nv * 0.6 + nv2 * 0.4) * f * 0.35
        } else if (this.tool === 'terrace') {
          // steps of 0.5 m: each point moves toward its step level
          const step = 0.5; const want = Math.round(this.heights[k] / step) * step
          this.heights[k] += (want - this.heights[k]) * Math.min(1, f * 1.2)
        } else if (this.tool === 'paint' && d < 0.6) this.types[k] = this.ground
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
    o.position.set(x, this.height_at(x, z) + lift(kind, extra?.lv ?? 0), z); o.rotation.y = r; o.scale.setScalar(s)
    // 🧩 Unity behaviours this kind gets by default (the user can change them on the selected object)
    { const ex = (o.userData.map_extra ?? {}) as MapExtra; const dk = kind === 'block' && extra?.role !== undefined && DEFAULT_BEHAVIOURS['role:' + extra.role] !== undefined ? 'role:' + extra.role : kind; if (ex.mb === undefined && DEFAULT_BEHAVIOURS[dk] !== undefined) o.userData.map_extra = { ...ex, mb: DEFAULT_BEHAVIOURS[dk].map(t => ({ t, o: Object.fromEntries((BEHAVIOURS.find(b => b.type === t)?.options ?? []).map(op => [op.key, op.def])) })) } }
    // a unique name per object (Unity / the package builder find objects by name): wall_1, wall_2…
    const base = kind.replace(/^file:/, '').replace(/\.[^.]+$/, '')
    const taken = new Set(this.placed().map(c => c.name)); let k = 1; while (taken.has(`${base}_${k}`)) k++
    o.name = `${base}_${k}`
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
  public turn_next (step: number): void { const square = this.object === 'stairs' || RUN_KINDS.includes(this.object) || (OBJECTS.find(q => q.id === this.object)?.grid ?? false); if (square && this.tool === 'place') { step = Math.sign(step) * Math.PI / 2; this.rot = Math.round(this.rot / (Math.PI / 2)) * (Math.PI / 2) } this.rot = Math.atan2(Math.sin(this.rot + step), Math.cos(this.rot + step)); this.user_rot = true; if (this.ghost !== null) { if (this.ghost_at !== null && this.ghost.visible) this.show_ghost(this.ghost_at); else this.ghost.rotation.y = this.rot } }

  /* ---------------- house: roof over a closed room, see-through walls / roofs ---------------- */
  /**
   * 🛖 the room around (x, z): grid cells reachable without crossing a wall piece (flood fill).
   * Closed -> a gable roof over the room's bounding box (an old roof there is replaced). Open -> a message.
   */
  /**
   * 🛖 the closed room around (x, z) on storey lv: grid cells reachable without crossing a wall piece of that storey
   * (flood fill; edge keys h:i:j / v:i:j). null = open (more than 1600 cells). h = the walls' height.
   */
  private room_at (x: number, z: number, lv: number): { x0: number, x1: number, z0: number, z1: number, h: number, rect: boolean } | null {
    const c = this.cell; const blocked = new Set<string>(); let h = 0
    for (const o of this.placed()) {
      const k = o.userData.map_kind as string; if (!HOUSE_WALLS.includes(k) || lv_of(o) !== lv) continue
      const along_x = Math.abs(Math.sin(o.rotation.y)) < 0.5
      const s0 = Math.round(((along_x ? o.position.x : o.position.z) - 1.5 * o.scale.x) / c); const n = Math.max(1, Math.round(3 * o.scale.x / c))
      const line = Math.round((along_x ? o.position.z : o.position.x) / c)
      for (let i = 0; i < n; i++) blocked.add(along_x ? `h:${s0 + i}:${line}` : `v:${line}:${s0 + i}`)
      h = Math.max(h, (k === 'wall' ? 2.2 : HWALL_H) * o.scale.y)
    }
    const i0 = Math.floor(x / c); const j0 = Math.floor(z / c)
    const seen = new Set<string>([`${i0}:${j0}`]); const todo: Array<[number, number]> = [[i0, j0]]
    let mi = i0; let Mi = i0; let mj = j0; let Mj = j0
    while (todo.length > 0) {
      const [i, j] = todo.pop()!
      mi = Math.min(mi, i); Mi = Math.max(Mi, i); mj = Math.min(mj, j); Mj = Math.max(Mj, j)
      const go = (ni: number, nj: number, edge: string): void => { const key = `${ni}:${nj}`; if (blocked.has(edge) || seen.has(key)) return; seen.add(key); todo.push([ni, nj]) }
      go(i + 1, j, `v:${i + 1}:${j}`); go(i - 1, j, `v:${i}:${j}`); go(i, j + 1, `h:${i}:${j + 1}`); go(i, j - 1, `h:${i}:${j}`)
      if (seen.size > 1600) return null
    }
    return { x0: mi * c, x1: (Mi + 1) * c, z0: mj * c, z1: (Mj + 1) * c, h, rect: seen.size === (Mi - mi + 1) * (Mj - mj + 1) }
  }

  /** the house wall piece under the cursor: its storey and the point on its wall line (null = none) */
  private wall_under (e: { clientX: number, clientY: number }): { lv: number, x: number, z: number, dist: number, o: THREE.Object3D } | null {
    const r = this.dom.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera())
    const walls = this.placed().filter(o => HOUSE_WALLS.includes(o.userData.map_kind as string))
    if (walls.length === 0) return null
    const h = this.ray.intersectObjects(walls, true)[0]; if (h === undefined) return null
    let o: THREE.Object3D = h.object; while (o.parent !== null && o.parent !== this.world.props) o = o.parent
    // the point on the wall's centre line (the hit is on its face, 0.1 m off)
    const along_x = Math.abs(Math.sin(o.rotation.y)) < 0.5
    return { lv: lv_of(o), x: along_x ? h.point.x : o.position.x, z: along_x ? o.position.z : h.point.z, dist: h.distance, o }
  }

  /**
   * 🏢 placing wall pieces: hovering an existing house wall builds on the floor above it (floor 2 on a floor-1 wall,
   * floor 3 on a floor-2 wall…); hovering the ground goes back to the floor picked with the buttons.
   */
  private auto_level (e: { clientX: number, clientY: number }): void {
    if (this.tool !== 'place' || !HOUSE_WALLS.includes(this.object)) return
    const w = this.wall_under(e)
    // 🚪 a door / window goes INTO the wall under the cursor (same floor); a wall piece goes on top of it
    const opening = this.object === 'door' || this.object === 'window'
    this.hover_piece = opening && w !== null && w.o.userData.map_kind !== this.object ? w.o : null
    const lv = w !== null ? (opening ? w.lv : Math.min(MAX_LEVEL - 1, w.lv + 1)) : this.base_level
    if (lv === this.level) return
    this.level = lv; this.refresh_panel()
    this.status?.(w !== null && opening ? M(`Floor ${lv + 1}: click to put the ${this.object} into this wall piece.`, `Tầng ${lv + 1}: bấm để khoét ${this.object === 'door' ? 'cửa' : 'cửa sổ'} vào tấm tường này.`, `${lv + 1}층`) : w !== null ? M(`Floor ${lv + 1}: on top of the wall under the cursor. Press and drag along it.`, `Tầng ${lv + 1}: xây lên trên bức tường dưới chuột. Nhấn và kéo dọc theo tường.`, `${lv + 1}층`) : M(`Floor ${lv + 1}.`, `Tầng ${lv + 1}.`, `${lv + 1}층`), false)
  }

  /** 🚪 the wall piece a door / window would replace (hovered) */
  private hover_piece: THREE.Object3D | null = null

  /** 🚪 put a door / window in place of a wall piece: same spot, direction and floor */
  public swap_piece (o: THREE.Object3D, kind: string): THREE.Object3D {
    const x = o.position.x; const z = o.position.z; const r = o.rotation.y; const lv = lv_of(o); const y = o.position.y
    if (this.world.selected === o) this.world.select(null)
    this.remove_object(o)
    const n = this.add_object(kind, x, z, r, 1, lv > 0 ? { lv } : undefined); n.position.y = y
    this.status?.(M(`${kind === 'door' ? 'Door' : 'Window'} put into the wall (floor ${lv + 1}).`, `Đã khoét ${kind === 'door' ? 'cửa' : 'cửa sổ'} vào tường (tầng ${lv + 1}).`, '교체'), false)
    return n
  }

  /** the floor picked with the 🏢 buttons (hovering a wall raises `level` above it for a while) */
  private base_level = 0

  /** extra for an object placed on the current storey */
  private lvx (): MapExtra | undefined { return this.level > 0 ? { lv: this.level } : undefined }

  /** 🛖 a gable roof over the closed room at (x, z) on storey lv (the current one); an old roof there is replaced */
  public add_roof_at (x: number, z: number, lv = this.level): THREE.Object3D | null {
    const R = this.room_at(x, z, lv)
    if (R === null) {
      this.status?.(M(`No closed room here on floor ${lv + 1}: close the walls all around (doors and windows count as walls), then click inside.`, `Chỗ này chưa phải phòng kín ở tầng ${lv + 1}: dựng tường khép kín xung quanh (cửa và cửa sổ cũng tính là tường), rồi bấm vào bên trong.`, '닫힌 방이 아닙니다'), true)
      return null
    }
    const cx = (R.x0 + R.x1) / 2; const cz = (R.z0 + R.z1) / 2
    for (const o of this.placed()) if (o.userData.map_kind === 'roof' && lv_of(o) === lv && Math.abs(o.position.x - cx) < 0.05 && Math.abs(o.position.z - cz) < 0.05) this.remove_object(o)
    const r = this.add_object('roof', cx, cz, 0, 1, { size: [R.x1 - R.x0, R.h, R.z1 - R.z0], ...(lv > 0 ? { lv } : {}) })
    this.status?.(M(`Roof placed on floor ${lv + 1} (${(R.x1 - R.x0).toFixed(1)} × ${(R.z1 - R.z0).toFixed(1)} m).${R.rect ? '' : ' The room is not a rectangle: the roof covers its bounding box.'} It turns see-through when the character is inside.`,
      `Đã gắn mái trên tầng ${lv + 1} (${(R.x1 - R.x0).toFixed(1)} × ${(R.z1 - R.z0).toFixed(1)} m).${R.rect ? '' : ' Phòng không phải hình chữ nhật: mái phủ theo khung bao ngoài.'} Mái tự mờ đi khi nhân vật vào trong nhà.`, '지붕 배치'), false)
    return r
  }

  /**
   * 🟨 a floor over the closed room at (x, z). Floor 1: a thin wooden floor on the ground. Floor 2+: a 0.2 m slab on
   * top of the walls of the floor below (its room), with holes over the stairs that come up through it.
   */
  public add_floor_at (x: number, z: number, lv = this.level): THREE.Object3D | null {
    const R = lv > 0 ? (this.room_at(x, z, lv - 1) ?? this.room_at(x, z, lv)) : this.room_at(x, z, 0)
    if (R === null) {
      this.status?.(M(lv > 0 ? `No closed room under this spot: close the walls of floor ${lv} first, then click inside on floor ${lv + 1}.` : 'No closed room here: close the walls first, then click inside.', lv > 0 ? `Dưới chỗ này chưa có phòng kín: dựng tường khép kín ở tầng ${lv} trước, rồi bấm vào bên trong ở tầng ${lv + 1}.` : 'Chỗ này chưa phải phòng kín: dựng tường khép kín trước rồi bấm vào bên trong.', '닫힌 방이 아닙니다'), true)
      return null
    }
    const cx = (R.x0 + R.x1) / 2; const cz = (R.z0 + R.z1) / 2; const pad = lv > 0 ? 0.09 : -0.1 // a slab covers the wall tops (just inside the band under the upper walls), a ground floor stays inside
    for (const o of this.placed()) if (o.userData.map_kind === 'floor' && lv_of(o) === lv && Math.abs(o.position.x - cx) < 0.05 && Math.abs(o.position.z - cz) < 0.05) this.remove_object(o)
    const f = this.add_object('floor', cx, cz, 0, 1, { size: [R.x1 - R.x0 + 2 * pad, lv > 0 ? SLAB : 0.04, R.z1 - R.z0 + 2 * pad], holes: [], ...(lv > 0 ? { lv } : {}) })
    this.refresh_holes()
    this.status?.(M(`Floor placed on floor ${lv + 1}.${lv > 0 ? ' Put stairs on the floor below to walk up.' : ''}`, `Đã đặt sàn ở tầng ${lv + 1}.${lv > 0 ? ' Đặt cầu thang ở tầng dưới để đi bộ lên.' : ''}`, '바닥 배치'), false)
    return f
  }

  /** where stairs go for the cursor at (x, z): 1 x 3 cells on the grid, turned in 90° steps (Z) */
  private stairs_spot (x: number, z: number): { x: number, z: number, r: number } {
    const c = this.cell; const q = ((Math.round(this.rot / (Math.PI / 2)) % 4) + 4) % 4; const long_x = q % 2 === 1
    const sx = (Math.floor(x / c) + 0.5) * c; const sz = (Math.floor(z / c) + 0.5) * c
    const lx = (Math.round(x / c - 1.5) + 1.5) * c; const lz = (Math.round(z / c - 1.5) + 1.5) * c
    return long_x ? { x: lx, z: sz, r: q * Math.PI / 2 } : { x: sx, z: lz, r: q * Math.PI / 2 }
  }

  /** 🪜 stairs from the current floor up to the next one; the slab above gets a hole */
  public add_stairs_at (x: number, z: number, lv = this.level): THREE.Object3D {
    const q = this.stairs_spot(x, z)
    const o = this.add_object('stairs', q.x, q.z, q.r, 1, lv > 0 ? { lv } : undefined)
    this.refresh_holes()
    const up = this.placed().some(f => f.userData.map_kind === 'floor' && lv_of(f) === lv + 1)
    this.status?.(M(`Stairs placed from floor ${lv + 1} to floor ${lv + 2} (they go up the way the ghost shows; Z turns them 90°).${up ? '' : ' Now add a Floor on floor ' + (lv + 2) + ' over this room.'}`, `Đã đặt cầu thang từ tầng ${lv + 1} lên tầng ${lv + 2} (hướng đi lên như bóng mờ; Z xoay 90°).${up ? '' : ' Giờ đặt Sàn ở tầng ' + (lv + 2) + ' phủ phòng này.'}`, '계단 배치'), false)
    return o
  }

  /** every floor slab gets a hole over each stairs coming up through it (stairs of the floor below) */
  private refresh_holes (): void {
    const stairs = this.placed().filter(o => o.userData.map_kind === 'stairs')
    for (const f of this.placed()) {
      if (f.userData.map_kind !== 'floor') continue
      const ex = f.userData.map_extra as MapExtra; const lv = lv_of(f); if (lv === 0) continue
      const [w, , d] = ex.size ?? [6, SLAB, 6]; const e = 0.02
      const holes: number[][] = []
      for (const st of stairs) {
        if (lv_of(st) !== lv - 1) continue
        const long_x = Math.abs(Math.sin(st.rotation.y)) > 0.5; const hx = (long_x ? STAIR_L : STAIR_W) / 2; const hz = (long_x ? STAIR_W : STAIR_L) / 2
        const x0 = Math.max(-w / 2 + e, st.position.x - hx - f.position.x); const x1 = Math.min(w / 2 - e, st.position.x + hx - f.position.x)
        const z0 = Math.max(-d / 2 + e, st.position.z - hz - f.position.z); const z1 = Math.min(d / 2 - e, st.position.z + hz - f.position.z)
        if (x1 - x0 > 0.1 && z1 - z0 > 0.1) holes.push([x0, z0, x1, z1].map(v => Math.round(v * 1000) / 1000))
      }
      if (JSON.stringify(holes) === JSON.stringify(ex.holes ?? [])) continue
      ex.holes = holes
      f.clear(); build_floor(f as THREE.Group, ex); this.faded.delete(f)
    }
    this.world.refresh(); this.autosave()
  }

  /** what is faded now (object -> opacity) */
  private readonly faded = new Map<THREE.Object3D, number>()
  /** 🏢 the storey being built (0 = floor 1) */
  public level = 0
  private fade (o: THREE.Object3D, a: number): void {
    if ((this.faded.get(o) ?? 1) === a) return
    if (a >= 1) this.faded.delete(o); else this.faded.set(o, a)
    o.traverse(q => {
      const m = q as THREE.Mesh; if (m.isMesh !== true) return
      const mt = m.material as THREE.MeshLambertMaterial; const base = (m.userData.base_opacity as number | undefined) ?? 1
      mt.opacity = Math.min(base, a); mt.transparent = mt.opacity < 1; mt.depthWrite = mt.opacity >= 1; mt.needsUpdate = true
    })
  }

  /**
   * every frame: a roof over the character (or every roof while you build a house) and the wall pieces
   * between the camera and the character turn see-through, so you can always see inside.
   */
  public cutaway (target: THREE.Vector3 | null, cam: THREE.Vector3): void {
    const house_tool = this.tool === 'place' && (HOUSE_WALLS.includes(this.object) || ['roof', 'floor', 'stairs'].includes(this.object))
    // building / erasing on a storey: everything above it turns see-through (and can't be clicked)
    const by_level = this.tool === 'place' || this.tool === 'erase'
    const from = target ?? cam; const ray = new THREE.Ray(from.clone(), cam.clone().sub(from)); const dist = cam.distanceTo(from); ray.direction.normalize()
    const hit = new THREE.Vector3()
    // the character's storey, and is it under a roof / a floor (inside a house)?
    const tl = target === null ? 0 : Math.max(0, Math.floor((target.y - this.height_at(target.x, target.z) - 0.5) / LEVEL_H))
    const over = (o: THREE.Object3D, p: THREE.Vector3): boolean => { const [w, , d] = (o.userData.map_extra as MapExtra | undefined)?.size ?? [6, 0, 6]; return Math.abs(p.x - o.position.x) < w / 2 + 0.3 && Math.abs(p.z - o.position.z) < d / 2 + 0.3 }
    const placed = this.placed()
    const indoor = target !== null && placed.some(o => (o.userData.map_kind === 'roof' || (o.userData.map_kind === 'floor' && lv_of(o) > tl)) && over(o, target))
    for (const o of placed) {
      const k = o.userData.map_kind as string; const lv = lv_of(o); let a = 1
      if (by_level && lv > this.level) a = 0.12
      if (indoor && lv > tl) a = Math.min(a, 0.12)
      if (k === 'roof' && (house_tool || (target !== null && over(o, target)))) a = Math.min(a, 0.12)
      else if (HOUSE_WALLS.includes(k) && target !== null && a === 1) {
        let b = o.userData.cut_box as THREE.Box3 | undefined; const key = `${o.position.x},${o.position.y},${o.position.z},${o.rotation.y},${o.scale.x}`
        if (b === undefined || o.userData.cut_key !== key) { b = new THREE.Box3().setFromObject(o).expandByScalar(0.05); o.userData.cut_box = b; o.userData.cut_key = key }
        const p = ray.intersectBox(b, hit)
        if (p !== null && p.distanceTo(target) < dist && !b.containsPoint(target)) a = 0.25
      }
      this.fade(o, a)
    }
  }

  /* ---------------- ghost of the object about to be placed ---------------- */
  private show_ghost (p: THREE.Vector3): void {
    if (this.object === 'stairs') {
      if (this.ghost === null || this.ghost_kind !== 'stairs') { this.hide_ghost(); const g = build_object('stairs'); g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { const mt = (m.material as THREE.Material).clone() as THREE.MeshLambertMaterial; mt.transparent = true; mt.opacity = 0.5; mt.depthWrite = false; m.material = mt; m.castShadow = false; m.raycast = () => {} } }); this.ghost = g; this.ghost_kind = 'stairs'; this.scene.add(g) }
      const q = this.stairs_spot(p.x, p.z); this.ghost.position.set(q.x, this.height_at(q.x, q.z) + this.level * LEVEL_H, q.z); this.ghost.rotation.y = q.r; this.ghost.visible = true; this.ghost_at = p.clone(); return
    }
    if ((this.object === 'door' || this.object === 'window') && this.hover_piece !== null && this.hover_piece.parent !== null) {
      if (this.ghost === null || this.ghost_kind !== this.object) {
        this.hide_ghost(); const g = build_object(this.object); g.userData.map_kind = undefined
        g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { const mt = (m.material as THREE.Material).clone() as THREE.MeshLambertMaterial; mt.transparent = true; mt.opacity = 0.6; mt.depthWrite = false; m.material = mt; m.castShadow = false; m.raycast = () => {} } })
        this.ghost = g; this.ghost_kind = this.object; this.scene.add(g)
      }
      const hp = this.hover_piece; this.ghost.position.copy(hp.position).y += 0.01; this.ghost.rotation.y = hp.rotation.y; this.ghost.visible = true; this.ghost_at = p.clone(); return
    }
    if (this.object === 'roof' || this.object === 'floor') { this.hide_ghost(); this.ring.visible = true; this.ring.scale.set(0.8, 0.8, 1); this.ring.position.set(p.x, p.y + 0.08, p.z); return }
    if (this.ghost === null || this.ghost_kind !== this.object) {
      this.hide_ghost()
      const g = build_object(this.object); g.userData.map_kind = undefined
      g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { const mt = (m.material as THREE.Material).clone() as THREE.MeshLambertMaterial; mt.transparent = true; mt.opacity = 0.5; mt.depthWrite = false; m.material = mt; m.castShadow = false; m.raycast = () => {} } })
      this.ghost = g; this.ghost_kind = this.object; this.scene.add(g)
    }
    let x = p.x; let z = p.z
    if (OBJECTS.find(q => q.id === this.object)?.grid === true) { x = Math.round(x / this.cell) * this.cell; z = Math.round(z / this.cell) * this.cell }
    let r = this.rot
    if (RUN_KINDS.includes(this.object)) {
      // fence / wall: the ghost starts with its end post on the grid point (where a click / a run puts it), along X or Z
      const v = Math.abs(Math.sin(this.rot)) > 0.5
      if (v) { z += this.cell; r = Math.PI / 2 } else { x += this.cell; r = 0 }
    }
    this.ghost.position.set(x, this.height_at(x, z) + this.level * LEVEL_H, z); this.ghost.rotation.y = r; this.ghost.visible = true; if (!(OBJECTS.find(q => q.id === this.object)?.grid ?? false)) this.ghost.scale.setScalar(this.place_size)
    if (this.ghost_top !== null) this.world.set_bottom(this.ghost, this.ghost_top.y)
    this.ghost_at = p.clone()
  }

  private ghost_at: THREE.Vector3 | null = null
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
    // 🏢 wall pieces over an existing wall of the floor below: snap onto that wall's line
    if (this.tool === 'place' && HOUSE_WALLS.includes(this.object)) {
      const w = this.wall_under(e)
      if (w !== null && w.lv + 1 === this.level) return { distance: w.dist, point: new THREE.Vector3(w.x, this.height_at(w.x, w.z) + this.level * LEVEL_H, w.z), object: this.terrain } as THREE.Intersection
    }
    const t = this.ray.intersectObject(this.terrain, false)[0] ?? null
    if (t === null || this.tool !== 'place' || this.level === 0) return t
    // 🏢 building upstairs: the point on the storey's floor plane under the cursor (not the ground far behind it)
    let y = t.point.y + this.level * LEVEL_H; const p = new THREE.Vector3()
    for (let i = 0; i < 2; i++) { if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) === null) return t; y = this.height_at(p.x, p.z) + this.level * LEVEL_H }
    return { ...t, point: p.clone(), distance: this.ray.ray.origin.distanceTo(p) }
  }

  /** eraser: the prop under the cursor and every prop inside the brush; a click on poured water drains it */
  private erase_at (e: { clientX: number, clientY: number }): void {
    const r = this.dom.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera())
    const gone = new Set<THREE.Object3D>()
    const root = (q: THREE.Object3D): THREE.Object3D => { let o = q; while (o.parent !== null && o.parent !== this.world.props) o = o.parent; return o }
    const h = this.ray.intersectObjects(this.erasable(), true).find(i => lv_of(root(i.object)) <= this.level) // storeys above are see-through: not hit
    if (h !== undefined) gone.add(root(h.object))
    const t = this.hit(e)
    if (t !== null) {
      const R = Math.max(0.6, this.radius * this.cell * 0.5)
      for (const o of this.erasable()) { const dx = o.position.x - t.point.x; const dz = o.position.z - t.point.z; if (dx * dx + dz * dz < R * R && lv_of(o) === this.level) gone.add(o) }
      if (gone.size === 0 && this.pools.length > 0) {
        const k = this.idx(Math.round((t.point.x + this.half()) / this.cell), Math.round((t.point.z + this.half()) / this.cell))
        const before = this.pools.length; this.pools = this.pools.filter(p => !p.cells.includes(k))
        if (this.pools.length !== before) { this.rebuild(); return }
      }
    }
    for (const o of gone) { if (this.world.selected === o) this.world.select(null); if (o.userData.map_kind !== undefined) this.remove_object(o); else this.world.remove(o) }
    if ([...gone].some(o => o.userData.map_kind === 'stairs' || o.userData.map_kind === 'floor')) this.refresh_holes()
    if (gone.size > 0) this.autosave()
  }

  private on_down (e: PointerEvent): void {
    if (this.tool === 'none' || this.tool === 'select' || e.button !== 0) return
    this.on_edit_start?.()
    if (this.tool === 'place' && (this.object === 'floor' || this.object === 'stairs')) {
      const h = this.hit(e); if (h !== null) { e.stopImmediatePropagation(); e.preventDefault(); if (this.object === 'floor') this.add_floor_at(h.point.x, h.point.z); else this.add_stairs_at(h.point.x, h.point.z) }
      return
    }
    if (this.tool === 'place' && this.object === 'roof') { const h = this.hit(e); if (h !== null) { e.stopImmediatePropagation(); e.preventDefault(); this.add_roof_at(h.point.x, h.point.z) } return }
    if (this.tool === 'place' && !RUN_KINDS.includes(this.object) && e.altKey && this.grab_hook?.(e) === true) { if (this.ghost !== null) this.ghost.visible = false; e.stopImmediatePropagation(); e.preventDefault(); return }
    if (this.tool === 'place' && (this.object === 'door' || this.object === 'window')) {
      const w = this.wall_under(e)
      if (w !== null && w.o.userData.map_kind !== this.object) { e.stopImmediatePropagation(); e.preventDefault(); this.hide_ghost(); this.swap_piece(w.o, this.object); return }
    }
    if (this.tool === 'erase') { this.erasing = true; this.erase_at(e); e.stopImmediatePropagation(); e.preventDefault(); return }
    const h = this.hit(e); if (h === null) return
    e.stopImmediatePropagation(); e.preventDefault()
    if (this.tool === 'pour') { this.pour(h.point.x, h.point.z); return }
    if (this.tool === 'place' && RUN_KINDS.includes(this.object)) {
      // fence / wall: press = the first post on the nearest grid point; drag = a straight run; release = place it
      const c = this.cell; const ax = Math.round(h.point.x / c) * c; const az = Math.round(h.point.z / c) * c
      const g = new THREE.Group(); this.scene.add(g)
      this.run = { kind: this.object, ax, az, bx: ax, bz: az, ghost: g }
      this.hide_ghost()
      return
    }
    if (this.tool === 'place') {
      const nature = !(OBJECTS.find(q => q.id === this.object)?.grid ?? false) && !this.object.startsWith('file:')
      // nature: Z / X set the main direction, every copy still turns and sizes a little differently (🎲 variety)
      const v = this.variety
      const r = nature ? (this.user_rot ? this.rot + (Math.random() * 2 - 1) * Math.PI * 0.5 * v : (v > 0 ? Math.random() * Math.PI * 2 * v : 0)) : this.rot
      const sz = (nature ? 1 + (Math.random() * 2 - 1) * 0.3 * v : 1) * this.place_size
      const grid = OBJECTS.find(q => q.id === this.object)?.grid ?? false
      // 📚 the cursor on top of a prop (a table, a crate): the new object stands on it
      const top = grid ? null : this.world.prop_top(this.ray.ray)
      let px = top?.x ?? h.point.x; let pz = top?.z ?? h.point.z
      if (e.shiftKey && !grid) { const g = this.snap_step(); px = Math.round(px / g) * g; pz = Math.round(pz / g) * g } // ⇧ = on the grid
      const o = this.add_object(this.object, px, pz, e.shiftKey ? Math.round(r / (Math.PI / 12)) * (Math.PI / 12) : r, sz, this.lvx())
      if (top !== null) { this.world.set_bottom(o, top.y); this.world.refresh(); this.autosave() }
      return
    }
    this.last_ev = e; this.grab0 = null; this.down = true; this.brush(h.point, true)
  }

  private on_move (e: PointerEvent): void {
    if (this.grabbing) { this.ring.visible = false; if (this.ghost !== null) this.ghost.visible = false; return }
    if (this.run === null) this.auto_level(e)
    if (this.run !== null) {
      e.stopImmediatePropagation()
      const h = this.hit(e)
      if (h !== null) { const c = this.cell; this.run.bx = Math.round(h.point.x / c) * c; this.run.bz = Math.round(h.point.z / c) * c; this.draw_run() }
      return
    }
    const brushy = this.tool !== 'none' && this.tool !== 'select'
    if (brushy && e.target === this.dom) {
      const h = this.hit(e)
      this.ring.visible = h !== null && this.tool !== 'place'
      if (h !== null) { const R = this.tool === 'erase' ? Math.max(0.6, this.radius * this.cell * 0.5) : this.tool === 'pour' ? 0.8 : this.radius * this.cell; this.ring.scale.set(R, R, 1); this.ring.position.set(h.point.x, h.point.y + 0.08, h.point.z); (this.ring.material as THREE.MeshBasicMaterial).color.set(this.tool === 'erase' ? 0xff6b6b : this.tool === 'pour' ? 0x4da6ff : 0xffffff) }
      if (this.tool === 'place' && h !== null) { this.ghost_top = (OBJECTS.find(q => q.id === this.object)?.grid ?? false) ? null : this.world.prop_top(this.ray.ray, this.ghost); this.show_ghost(this.ghost_top ?? h.point) } else if (this.ghost !== null) this.ghost.visible = false
    } else if (!this.down) { this.ring.visible = false; if (this.ghost !== null && e.target !== this.dom) this.ghost.visible = false }
    if (this.erasing) { e.stopImmediatePropagation(); this.erase_at(e); return }
    if (!this.down) return
    e.stopImmediatePropagation()
    this.last_ev = e
    if (this.raf === 0) this.raf = requestAnimationFrame(() => { this.raf = 0; const ev = this.last_ev; if (ev === null) return; const h = this.hit(ev); if (h !== null) this.brush(h.point, false) })
  }

  /** the run from its start post to the grid point under the cursor: along X or Z (the longer way), whole segments */
  private run_segments (): Array<{ x: number, z: number, r: number }> {
    const R = this.run; if (R === null) return []
    const seg = 2 * this.cell // a fence is post-to-post 2 cells long
    const dx = R.bx - R.ax; const dz = R.bz - R.az
    const along_x = Math.abs(dx) >= Math.abs(dz)
    const d = along_x ? dx : dz; const n = Math.round(Math.abs(d) / seg); const sg = Math.sign(d) || 1
    const out: Array<{ x: number, z: number, r: number }> = []
    for (let i = 0; i < n; i++) {
      const m = (i + 0.5) * seg * sg
      out.push(along_x ? { x: R.ax + m, z: R.az, r: 0 } : { x: R.ax, z: R.az + m, r: Math.PI / 2 })
    }
    return out
  }

  private draw_run (): void {
    const R = this.run; if (R === null) return
    R.ghost.clear()
    for (const sgm of this.run_segments()) {
      const g = build_object(R.kind); g.userData.map_kind = undefined
      g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { const mt = (m.material as THREE.Material).clone() as THREE.MeshLambertMaterial; mt.transparent = true; mt.opacity = 0.55; mt.depthWrite = false; m.material = mt; m.castShadow = false; m.raycast = () => {} } })
      g.position.set(sgm.x, this.height_at(sgm.x, sgm.z) + this.level * LEVEL_H, sgm.z); g.rotation.y = sgm.r; R.ghost.add(g)
    }
  }

  /** place the run (a segment that is already there, same place and direction, is skipped) */
  private end_run (): void {
    const R = this.run; if (R === null) return
    let segs = this.run_segments() // before `run` is cleared: the segments are read from it
    this.run = null; R.ghost.removeFromParent()
    if (segs.length === 0) { // a click: one segment from this grid point, turned by Z (along X or along Z)
      const v = Math.abs(Math.sin(this.rot)) > 0.5
      segs = [{ x: R.ax + (v ? 0 : this.cell), z: R.az + (v ? this.cell : 0), r: v ? Math.PI / 2 : 0 }]
    }
    const at = (o: THREE.Object3D, q: { x: number, z: number, r: number }): boolean => lv_of(o) === this.level && Math.abs(o.position.x - q.x) < 0.05 && Math.abs(o.position.z - q.z) < 0.05 && Math.abs(Math.sin(o.rotation.y - q.r)) < 0.05
    const same = (o: THREE.Object3D, q: { x: number, z: number, r: number }): boolean => o.userData.map_kind === R.kind && at(o, q)
    segs = segs.filter(q => !this.placed().some(o => same(o, q)))
    // a door / window / wall piece dropped on another wall piece swaps it
    if (HOUSE_WALLS.includes(R.kind)) for (const q of segs) for (const o of this.placed()) if (o.userData.map_kind !== R.kind && HOUSE_WALLS.includes(o.userData.map_kind as string) && at(o, q)) this.remove_object(o)
    for (const q of segs) this.add_object(R.kind, q.x, q.z, q.r, 1, this.lvx())
    this.status?.(M(`${segs.length} ${R.kind} segment(s) placed: start the next run from a corner post for a clean corner.`, `Đã đặt ${segs.length} đoạn: kéo đoạn tiếp theo từ cột ở góc để góc khớp.`, `${segs.length}개 배치`), false)
  }

  private on_up (e: PointerEvent): void { if (this.run !== null) { this.end_run(); e.stopImmediatePropagation(); return } this.erasing = false; if (this.down) { this.down = false; this.last_ev = null; e.stopImmediatePropagation() } }

  /* ---------------- save / load / export ---------------- */
  public data (): MapData {
    return {
      version: 1, n: this.n, cell: this.cell, water: this.water, sea: this.sea,
      heights: Array.from(this.heights, h => Math.round(h * 1000) / 1000), types: Array.from(this.types),
      ...(this.strokes.length > 0 ? { paint: this.strokes.slice() } : {}),
      ...(this.wx !== 'clear' || this.daytime !== 'day' ? { weather: [this.wx, this.daytime] as [WeatherKind, DayTime] } : {}),
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
    this.strokes = Array.isArray(d.paint) ? d.paint.slice() : []; this.splat_span = -1
    this.wx = d.weather?.[0] ?? 'clear'; this.daytime = d.weather?.[1] ?? 'day'; this.on_weather?.(this.wx, this.daytime)
    this.pools = Array.isArray(d.pools) ? d.pools : []
    for (const o of this.placed()) this.remove_object(o)
    if (d.shots !== undefined) { if (this.rig !== null) this.rig.set(d.shots); else this.pending_shots = d.shots }
    this.rebuild()
    for (const o of d.objects) { const ob = this.add_object(o.kind, o.p[0], o.p[2], o.r, o.s, o.x); ob.position.y = o.p[1] }
    this.refresh_holes()
    this.plan = d.plan ?? null; this.on_plan?.(this.plan)
    this.wires_visible = d.wires_hidden !== true; if (!this.wires_visible) this.show_wires(false)
    this.refresh_panel()
  }

  /* ---------------- 2D plan -> 3D ---------------- */
  public plan: Plan | null = null
  public on_plan: ((p: Plan | null) => void) | null = null
  /** the 3D object of a plan shape */
  public plan_object (pid: string): THREE.Object3D | null { return this.placed().find(o => (o.userData.map_extra as MapExtra | undefined)?.pid === pid) ?? null }

  /**
   * a plan block (ore, skip, $ pad, a model on a block…) moved / turned / resized in 3D → written back into the 2D plan,
   * else the next ▶ Play / Build rebuilds it from the plan and it jumps back. Returns true when the plan changed.
   */
  public sync_plan_from_3d (only?: THREE.Object3D | null): boolean {
    if (this.plan === null) return false
    const byid = new Map(this.plan.shapes.map(s => [s.id, s])); let changed = false
    const x1 = new THREE.Vector3()
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3
    for (const o of this.placed()) {
      if (only != null && o !== only) continue
      const ex = o.userData.map_extra as MapExtra | undefined; if (ex?.pid === undefined || o.userData.map_kind !== 'block') continue
      const s = byid.get(ex.pid); if (s === undefined) continue
      x1.set(1, 0, 0).applyQuaternion(o.quaternion); const yaw = Math.atan2(-x1.z, x1.x)
      const size = ex.size ?? [s.w, s.height, s.d]
      const nx = +o.position.x.toFixed(3); const nz = +o.position.z.toFixed(3); const nr = +(-yaw).toFixed(4)
      const nw = +(size[0] * Math.abs(o.scale.x)).toFixed(3); const nd = +(size[2] * Math.abs(o.scale.z)).toFixed(3)
      const nh = Math.abs(o.scale.y - 1) > 1e-3 ? +(size[1] * Math.abs(o.scale.y)).toFixed(3) : s.height // the build clamps tiny heights: only a real scale changes it
      if (near(s.x, nx) && near(s.z, nz) && near(Math.atan2(Math.sin(s.r - nr), Math.cos(s.r - nr)), 0) && near(s.w, nw) && near(s.d, nd) && near(s.height, nh)) continue
      s.x = nx; s.z = nz; s.r = nr; s.w = nw; s.d = nd; s.height = nh
      changed = true
    }
    if (changed) { this.on_plan?.(this.plan); this.autosave_now() }
    return changed
  }

  /** every shape -> a block, every wire -> a flow path on the ground (the previous plan build is replaced) */
  public build_plan (plan: Plan): void {
    this.plan = JSON.parse(JSON.stringify(plan))
    // the selected plan block is rebuilt: the handles follow the new one (not the removed one)
    const sel = this.world.selected; const sel_pid = sel !== null && sel.userData.map_kind === 'block' ? (sel.userData.map_extra as MapExtra | undefined)?.pid : undefined
    for (const o of this.placed()) if (o.userData.map_kind === 'block' || o.userData.map_kind === 'wire') { if (this.world.selected === o) this.world.select(null); this.remove_object(o) }
    const byid = new Map(plan.shapes.map(s => [s.id, s]))
    // big zones first (floors), then what stands on them
    for (const s of [...plan.shapes].sort((a, b) => b.w * b.d - a.w * a.d)) {
      if (s.kind === 'camera') continue // a 🎥 camera is a shot, not a block (below)
      const h = s.kind === 'player' ? 0.03 : Math.max(0.02, s.height ?? KIND_INFO[s.kind].height)
      this.add_object('block', s.x, s.z, -s.r, 1, { pid: s.id, size: [s.w, h, s.d], color: s.color, label: s.kind === 'zone' || s.kind === 'player' ? (s.label !== '' ? s.label : '') : s.label, form: s.form, model: s.model, role: s.kind, image: s.image, price: s.price ?? (s.kind === 'unlock' ? 50 : undefined), note: s.note })
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
    if (sel_pid !== undefined && this.world.gizmo.enabled) { const n = this.plan_object(sel_pid); if (n !== null) this.world.select(n) }
    this.plan_shots(plan)
  }

  /** every 🎥 camera of the plan -> a shot (in plan order, one after another); the ones of the previous build are replaced */
  private plan_shots (plan: Plan): void {
    const rig = this.rig; if (rig === null) return
    const cams = plan.shapes.filter(s => s.kind === 'camera')
    const own = rig.shots.filter(s => s.pid === undefined)
    if (cams.length === 0 && own.length === rig.shots.length) return
    const player = plan.shapes.find(s => s.kind === 'player')
    let t = own.reduce((m, s) => Math.max(m, s.t + s.dur), 0)
    const made: Shot[] = cams.map(c => {
      const h = Math.max(0.3, c.height ?? 3); const tr = c.track ?? ''
      const obj = tr === '' || tr === 'player' ? null : this.plan_object(tr)
      const tp = tr === 'player' ? (player !== undefined ? new THREE.Vector3(player.x, LOOK_UP, player.z) : new THREE.Vector3(0, LOOK_UP, 0))
        : obj !== null ? obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, LOOK_UP, 0)) : null
      // straight ahead: the plan's turn handle points the way the camera looks (screen up = -Z at 0°)
      const ahead = new THREE.Vector3(c.x + Math.sin(c.r) * 8, Math.max(0.8, h * 0.35), c.z - Math.cos(c.r) * 8)
      const target = tp ?? ahead
      const mode: ShotMode = tr === '' ? 'fixed' : c.cmode === 'follow' ? 'follow' : 'look'
      const follow = tr === 'player' ? 'player' : obj?.name ?? 'player'
      const base = tp !== null ? tp.clone().sub(new THREE.Vector3(0, LOOK_UP, 0)) : ahead
      const dur = Math.max(0.5, c.time ?? 3)
      const s: Shot = { name: c.label !== '' ? c.label : 'Cam', t, dur, mode, pos: [c.x, h, c.z], target: [target.x, target.y, target.z], fov: c.fov ?? 50, follow, offset: [c.x - base.x, h - base.y, c.z - base.z], blend: 0, pid: c.id }
      t += dur
      return s
    })
    rig.set([...own, ...made]); rig.on_change?.()
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
  public async glb_buffer (cameras = true, playable = false): Promise<ArrayBuffer> {
    const sc = new THREE.Scene(); const g = new THREE.Group(); g.name = 'Greenbox Map'
    const ter = this.terrain.clone(); ter.material = this.terrain_mat; g.add(ter); if (this.water_mesh.visible) g.add(this.water_mesh.clone())
    for (const p of this.pool_group.children) g.add(p.clone())
    // a playable takes every plan block, also the ones hidden behind a $ pad while it plays (the game shows them), never the plan wires
    for (const o of this.placed()) {
      const pid = (o.userData.map_extra as MapExtra | undefined)?.pid
      if (playable && (o.userData.map_kind === 'wire' || /^flow_/.test(o.name))) continue
      if (o.visible || (playable && pid !== undefined)) { const c = clone_deep(o); c.traverse(q => { if (playable) q.visible = true; if (q.userData.clips !== undefined) { q.userData = { ...q.userData }; delete q.userData.clips } }); g.add(c) } // clips are not glTF extras
    }
    // camera shots as glTF cameras (Unity / Blender / Godot import them)
    if (cameras) for (const c of this.shot_cameras()) g.add(c)
    sc.add(g); name_materials_for_export(g)
    if (playable) jpeg_textures(g)
    return await new GLTFExporter().parseAsync(sc, { binary: true }) as ArrayBuffer
  }

  /** 📦 Unity package: the map as FBX + the picked MonoBehaviours + a builder (Greenbox ▸ Build map in scene) */
  public async export_unitypackage (layout: PackageLayout): Promise<string[]> {
    const sc = new THREE.Scene(); const g = new THREE.Group(); g.name = 'Greenbox Map'
    const ter = this.terrain.clone(); ter.material = this.terrain_mat; ter.name = 'Terrain'; g.add(ter)
    const objects: PackObject[] = []
    const water: THREE.Object3D[] = []
    if (this.water_mesh.visible) { const w = this.water_mesh.clone(); w.name = 'Water'; g.add(w); water.push(w) }
    this.pool_group.children.forEach((p, i) => { const c = p.clone(); c.name = `Pool_${i + 1}`; g.add(c); water.push(c) })
    for (const w of water) objects.push({ name: w.name, behaviours: [{ type: 'WaterSplash', options: { drops: 40 } }] })
    for (const o of this.placed()) {
      if (!o.visible || o.userData.map_kind === 'wire') continue
      g.add(o.clone())
      const mb = (o.userData.map_extra as MapExtra | undefined)?.mb ?? []
      objects.push({ name: o.name, behaviours: mb.map(m => ({ type: m.t, options: m.o ?? {} })) })
    }
    sc.add(g); sc.updateMatrixWorld(true)
    name_materials_for_export(g) // 🎨 colours survive Unity's import (unique material names)
    const fbx = await new FBXExporter().parseAsync(sc, { preset: 'unity' as any, onlyVisible: false, embedTextures: true } as any) as unknown
    const { blob, files } = await build_unitypackage(layout, fbx instanceof Uint8Array ? fbx : new Uint8Array(fbx as ArrayBuffer), JSON.stringify(this.data()), objects, await this.terrain_png())
    this.download(blob, 'GreenboxMap.unitypackage')
    return files
  }

  /**
   * 🎨 the terrain's colours as a picture laid on its uv (u = i / n, v = 1 - j / n), in sRGB: for engines whose
   * default shader ignores vertex colours (Unity URP / Lit). Bilinear between the grid points, like the vertex colours.
   */
  public async terrain_png (): Promise<Uint8Array> {
    const col = this.terrain.geometry.getAttribute('color'); const n = this.n
    const res = Math.min(1024, Math.max(64, n * 8))
    const cv = document.createElement('canvas'); cv.width = cv.height = res
    const cx = cv.getContext('2d')!; const img = cx.createImageData(res, res)
    const s = (x: number): number => Math.round(255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)))
    for (let py = 0; py < res; py++) {
      const fj = (py + 0.5) / res * n; const j = Math.min(n - 1, Math.floor(fj)); const v = fj - j
      for (let px = 0; px < res; px++) {
        const fi = (px + 0.5) / res * n; const i = Math.min(n - 1, Math.floor(fi)); const u = fi - i
        const a = this.idx(i, j); const b = this.idx(i + 1, j); const c = this.idx(i, j + 1); const d = this.idx(i + 1, j + 1)
        const o = (py * res + px) * 4
        for (let ch = 0; ch < 3; ch++) {
          const val = (col.getComponent(a, ch) * (1 - u) + col.getComponent(b, ch) * u) * (1 - v) + (col.getComponent(c, ch) * (1 - u) + col.getComponent(d, ch) * u) * v
          img.data[o + ch] = s(val)
        }
        img.data[o + 3] = 255
      }
    }
    cx.putImageData(img, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => cv.toBlob(b => { if (b !== null) resolve(b); else reject(new Error('png')) }, 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
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
        parts += [add("Wood", "cube", s, P(0, 0.55, 0), (0.48, 0.34, 0.2), (1.5, 0.06, 0.55), rot=r)]
    elif kind == "hwall" or kind == "door" or kind == "window":
        parts += [add("Wall", "cube", s, P(0, 1.3, 0), (0.9, 0.85, 0.76), (1.6, 0.1, 1.3), rot=r)]
    elif kind == "roof":
        w, hh, d = ex.get("size", [6, 2.6, 6]); o = 0.4
        ax = w >= d; sh = (d if ax else w) + 2 * o; ln = (w if ax else d) + 2 * o; rise = max(0.8, sh * 0.32)
        hs = sh / 2; hl = ln / 2
        vv = [(-hl, -hs, 0), (hl, -hs, 0), (hl, hs, 0), (-hl, hs, 0), (-hl, 0, rise), (hl, 0, rise)] if ax else [(-hs, -hl, 0), (hs, -hl, 0), (hs, hl, 0), (-hs, hl, 0), (0, -hl, rise), (0, hl, rise)]
        vv = [(x + a, y - b, z + hh + c) for a, b, c in vv]
        ff = [(0, 1, 2, 3), (0, 1, 5, 4), (3, 2, 5, 4), (0, 3, 4), (1, 2, 5)] if ax else [(0, 1, 2, 3), (0, 3, 5, 4), (1, 2, 5, 4), (0, 1, 4), (3, 2, 5)]
        rm = bpy.data.meshes.new(name); rm.from_pydata(vv, [], ff); rm.update(); ro = bpy.data.objects.new(name, rm); col.objects.link(ro)
        rm.materials.append(mat("Roof", (0.63, 0.27, 0.18))); parts += [ro]
    elif kind == "floor":
        w, t, d = ex.get("size", [6, 0.2, 6])
        parts += [add("Floor", "cube", 1, P(0, -t / 2, 0), (0.79, 0.65, 0.49), (w / 2, d / 2, t / 2), rot=r)]
    elif kind == "stairs":
        T = 4.5 / 14
        for k in range(14):
            parts += [add("Step", "cube", 1, P(0, (k + 1) * 0.1, -2.25 + (k + 0.5) * T), (0.72, 0.54, 0.35), (0.7, T / 2, (k + 1) * 0.1), rot=r)]
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
      <div class="row" data-sculpt>${tb('grab', '✋ ' + M('Grab', 'Kéo đất', '잡아끌기'), M('Press and drag up / down: the ground under the brush follows the mouse', 'Giữ chuột rồi kéo lên / xuống: cả vùng đất trong cọ đi theo chuột', '눌러서 위아래로 끌기'))}${tb('crease', '⛰ ' + M('Ridge', 'Sống núi', '능선'), M('A sharp ridge: the middle rises much more than the sides', 'Đắp gờ nhọn: giữa nhô cao hơn hẳn hai bên', '날카로운 능선'))}${tb('noise', '🎲 ' + M('Rough', 'Gồ ghề', '거칠게'), M('Natural bumps', 'Làm mặt đất sần tự nhiên', '자연스러운 요철'))}${tb('terrace', '🪜 ' + M('Terraces', 'Bậc thang', '계단식'), M('Cuts the slope into 0.5 m steps', 'Cắt sườn thành bậc 0.5 m', '0.5 m 계단'))}</div>
      <div class="row">${tb('dig', '🕳 ' + M('Dig hole / trench', 'Khoét hố / rãnh', '구덩이 파기'), M('Carves a flat-bottomed hole; drag to draw a channel / river bed', 'Khoét hố đáy phẳng; kéo để kẻ rãnh / lòng sông', '바닥이 평평한 구덩이'))}${tb('pour', '💧 ' + M('Pour water', 'Đổ nước', '물 붓기'), M('Click inside a dug hole / channel: it fills up to its rim', 'Bấm vào trong hố / rãnh đã khoét: nước dâng tới miệng', '구덩이를 클릭하면 물이 찹니다'))}</div>
      <label class="sm">${M('Dig depth', 'Độ sâu khoét', '파기 깊이')} <input type="range" data-k="dig" min="3" max="80" value="${this.dig_depth * 10}"></label>
      <label class="sm">${M('Water fill', 'Nước đầy', '물 채움')} <input type="range" data-k="fill" min="30" max="100" value="${this.pool_fill * 100}"></label>
      <div class="row" data-grounds>${GROUND.map((g, i) => `<button data-gr="${i}" title="${L(g)}" style="flex:none;width:30px;height:26px;padding:0;--sw:#${g.color.toString(16).padStart(6, '0')};background:var(--sw)"></button>`).join('')}</div>
      <div class="row" data-levels style="align-items:center;gap:4px;flex-wrap:wrap" title="${M('The floor you build on: walls, doors, windows, floors, stairs and objects go on this floor; the floors above turn see-through', 'Tầng đang xây: tường, cửa, cửa sổ, sàn, cầu thang và vật thể được đặt lên tầng này; các tầng phía trên tự mờ đi', '짓는 층')}"><span class="sm">🏢 ${M('Floor', 'Tầng', '층')}</span>${Array.from({ length: MAX_LEVEL }, (_, i) => `<button data-lv="${i}" style="flex:none;min-width:30px;padding:4px 8px">${i + 1}</button>`).join('')}</div>
      <div class="row" data-objs style="flex-wrap:wrap">${OBJECTS.map(o => `<button data-ob="${o.id}" title="${L(o)}" style="flex:none;padding:4px 6px">${o.icon}</button>`).join('')}</div>
      <div class="row" data-cobjs style="flex-wrap:wrap"></div>
      <div class="row"><button data-x="addfile" title="${M('Your own GLB / FBX / OBJ: it joins the palette, then click to place as many as you want (Z turns it before placing)', 'GLB / FBX / OBJ của bạn: vào bảng vật thể, rồi bấm để đặt bao nhiêu cái cũng được (Z xoay trước khi đặt)', '내 3D 파일을 팔레트에 추가')}">＋ ${M('3D file to the palette…', 'File 3D vào bảng vật…', '3D 파일 추가…')}</button></div>
      <input type="file" data-k="cfile" accept=".glb,.gltf,.fbx,.obj,.dae,.stl,.ply,.3mf,.zip" multiple hidden>
      <div class="sm">${M('Placing: Z / X turn the object. Fences, walls, house pieces: 90° (they stay on the grid). Trees, rocks, bushes: 15°, and every copy still differs (🎲 below).', 'Đang đặt: Z / X xoay vật. Hàng rào, tường, nhà: 90° (luôn khớp lưới). Cây, đá, bụi: 15°, mỗi cây vẫn khác nhau một chút (🎲 bên dưới).', '배치 중: Z/X 회전. 울타리·벽 90°, 나무·바위 15° + 변화.')}</div>
      <label class="sm" title="${M('0 = every copy the same, 100 = each one turned and sized differently', '0 = mọi bản giống hệt, 100 = mỗi bản xoay và to nhỏ khác nhau', '0 = 동일, 100 = 다양')}">🎲 ${M('Variety (trees, rocks, bushes)', 'Độ đa dạng (cây, đá, bụi)', '다양성')} <input type="range" data-k="variety" min="0" max="100" value="${Math.round(this.variety * 100)}"></label>
      <label class="sm" title="${M('Size of the object you place next (also: select a placed one in Edit map and use the size buttons / S handles)', 'Kích thước vật sắp đặt (vật đã đặt: chọn trong Sửa map rồi dùng nút kích thước / tay kéo S)', '배치할 크기')}">📏 ${M('Size', 'Kích thước', '크기')} <input type="range" data-k="psize" min="20" max="400" step="5" value="${Math.round(this.place_size * 100)}"> <span data-psizev>${Math.round(this.place_size * 100)}%</span></label>
      <div class="row" style="gap:6px"><label class="sm" style="flex:1">☁ ${M('Weather', 'Thời tiết', '날씨')} <select data-wx>${([['clear', 'Clear', 'Nắng'], ['cloudy', 'Cloudy', 'Nhiều mây'], ['rain', 'Rain', 'Mưa'], ['storm', 'Storm', 'Giông bão'], ['snow', 'Snow', 'Tuyết'], ['fog', 'Fog', 'Sương mù']] as const).map(([v, en, vi]) => `<option value="${v}"${this.wx === v ? ' selected' : ''}>${M(en, vi, en)}</option>`).join('')}</select></label>
      <label class="sm" style="flex:1">🕒 ${M('Time', 'Giờ', '시간')} <select data-daytime>${([['day', 'Day', 'Ban ngày'], ['sunset', 'Sunset', 'Hoàng hôn'], ['night', 'Night', 'Ban đêm']] as const).map(([v, en, vi]) => `<option value="${v}"${this.daytime === v ? ' selected' : ''}>${M(en, vi, en)}</option>`).join('')}</select></label></div>
      <div class="sm mut" style="font-size:11.5px;opacity:.75">${M('Click on a table / crate = put it on top · Alt+click = pick a placed object up · ⇧ = snap to the grid', 'Bấm lên bàn / thùng = đặt lên trên · Alt+bấm = nhấc vật đã đặt · ⇧ Shift = căn theo lưới', '위에 놓기 · Alt = 집기 · ⇧ = 격자')}</div>
      <label class="sm" title="${M('The whole ground square: bigger adds flat ground around it, smaller cuts it to the middle (Ctrl+Z brings it back)', 'Cả ô đất vuông: lớn hơn thì thêm đất phẳng xung quanh, nhỏ hơn thì cắt lấy phần giữa (Ctrl+Z để lấy lại)', '전체 바닥 크기')}">⬛ ${M('Map size', 'Cỡ map tổng', '맵 크기')} <input type="range" data-k="msize" min="24" max="300" step="6" value="${Math.round(this.n * this.cell)}"> <span data-msizev>${Math.round(this.n * this.cell)} m</span></label>
      <label class="sm">${M('Brush size', 'Cỡ cọ', '브러시 크기')} <input type="range" data-k="radius" min="1" max="12" value="${this.radius}"></label>
      <label class="sm">${M('Strength', 'Lực', '강도')} <input type="range" data-k="strength" min="5" max="100" value="${this.strength * 100}"></label>
      <label class="sm"><input type="checkbox" data-k="sea"${this.sea ? ' checked' : ''}> ${M('Sea level', 'Mực nước biển', '해수면')} <input type="range" data-k="water" min="-30" max="30" value="${this.water * 10}"></label>
      <div class="row"><button data-x="clear" title="${M('Remove every object, file, box, water and shot; flat ground (Ctrl+Z brings it back)', 'Xoá mọi vật, file, hộp, nước và shot; mặt đất phẳng (Ctrl+Z để lấy lại)', '모두 지우기')}">🗑 ${M('Clear everything', 'Xoá hết mọi thứ', '모두 지우기')}</button></div>
      <div class="row"><select data-k="preset" style="flex:1"><option value="">${M('New map…', 'Map mới…', '새 맵…')}</option><option value="flat">${M('Flat', 'Phẳng', '평지')}</option><option value="hills">${M('Hills', 'Đồi', '언덕')}</option><option value="island">${M('Island', 'Đảo', '섬')}</option><option value="valley">${M('Valley', 'Thung lũng', '계곡')}</option><option value="mountains">${M('Mountains', 'Núi', '산')}</option></select></div>
      <div class="row"><button data-x="save">💾 ${M('Save .json', 'Lưu .json', '저장')}</button><button data-x="load">📂 ${M('Open', 'Mở', '열기')}</button></div>
      <div class="row"><button data-x="glb" title="${M('Map + camera shots as glTF cameras (Unity, Godot, Blender)', 'Map + các shot camera (camera glTF cho Unity, Godot, Blender)', '맵 + 카메라')}">⬇ GLB</button><button data-x="blend" title="${M('A Python script that rebuilds this map in Blender, with the cameras and the markers that switch them', 'Script Python dựng lại map trong Blender, kèm camera và marker đổi camera', '블렌더 스크립트')}">⬇ Blender (.py)</button><button data-x="unity" title="${M('C# script: plays the camera shots in Unity (import the GLB first)', 'Script C#: phát các shot camera trong Unity (import GLB trước)', '유니티 C#')}">⬇ Unity (.cs)</button></div>
      <div class="row"><button data-x="unitypkg" class="pri" title="${M('A .unitypackage for the devs: the map (FBX), the MonoBehaviours you picked on the objects, and a builder (menu Greenbox ▸ Build map in scene). You choose the folders.', 'Gói .unitypackage cho dev: map (FBX), các MonoBehaviour bạn đã gắn vào vật, và script dựng map (menu Greenbox ▸ Build map in scene). Bạn chọn thư mục.', 'Unity 패키지')}">📦 ${M('Unity package (.unitypackage)', 'Gói Unity (.unitypackage)', 'Unity 패키지')}</button></div>
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
    // picture tiles instead of emoji buttons: the tools, then the objects
    tile_grid([...sec.querySelectorAll<HTMLElement>('[data-mt]')].filter(b => !SCULPT_TOOLS.includes(b.dataset.mt as MapTool)), b => 'tool-' + (b.dataset.mt ?? ''))
    { // ✋ sculpt: its own group with a title, under the terrain tools
      const sb = [...sec.querySelectorAll<HTMLElement>('[data-mt]')].filter(b => SCULPT_TOOLS.includes(b.dataset.mt as MapTool))
      const g = tile_grid(sb, b => 'tool-' + (b.dataset.mt ?? ''))
      const t = document.createElement('div'); t.className = 'gb-grouptitle'; t.textContent = M('Sculpt (like Blender)', 'Điêu khắc địa hình (như Blender)', '스컬프트'); g.before(t)
    }
    tile_grid(['addfile', 'save', 'load', 'clear'].map(k => sec.querySelector<HTMLElement>(`[data-x="${k}"]`)).filter((b): b is HTMLElement => b !== null), b => 'x-' + (b.dataset.x ?? ''), true)
    const objs = sec.querySelector<HTMLElement>('[data-objs]')
    if (objs !== null) { objs.className = 'gb-tiles'; objs.removeAttribute('style'); objs.querySelectorAll<HTMLElement>('[data-ob]').forEach(b => { const o = OBJECTS.find(q => q.id === b.dataset.ob); tile(b, 'obj-' + (b.dataset.ob ?? ''), o !== undefined ? L(o) : undefined) }) }
    sec.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (b === null) return
      if (b.dataset.mt !== undefined) this.tool = b.dataset.mt as MapTool
      if (b.dataset.gr !== undefined) { this.ground = Number(b.dataset.gr); this.tool = 'paint' }
      if (b.dataset.ob !== undefined) {
        this.object = b.dataset.ob; this.tool = 'place'; this.user_rot = false; this.rot = 0
        // 🏠 building a house: how the pieces go together
        if (this.object === 'hwall') this.status?.(M('House wall: press on a grid point and drag a straight run (3 m pieces); start the next run from a corner post. Close the room, then add doors, windows and a roof.', 'Tường nhà: nhấn vào một điểm lưới rồi kéo thành dãy thẳng (mỗi tấm 3 m); kéo dãy tiếp theo từ cột ở góc. Khép kín phòng rồi gắn cửa, cửa sổ và mái.', '집 벽: 드래그로 배치'), false)
        else if (this.object === 'door' || this.object === 'window') this.status?.(M('Click a wall piece (where its run starts) to swap it, or drag a run. Z turns it to go along Z.', 'Bấm vào đầu một tấm tường để thay nó, hoặc kéo thành dãy. Z để xoay sang trục dọc.', '벽 조각을 클릭해 교체'), false)
        else if (this.object === 'floor') this.status?.(M('Floor: pick the floor number above, then click inside a closed room. Floor 2+ = a slab on top of the walls of the floor below (holes are cut over stairs).', 'Sàn: chọn số tầng ở trên, rồi bấm vào trong một phòng kín. Tầng 2 trở lên = tấm sàn đặt trên tường tầng dưới (tự khoét lỗ chỗ cầu thang).', '바닥: 닫힌 방 안 클릭'), false)
        else if (this.object === 'stairs') this.status?.(M('Stairs: go from the floor you are building on to the next one (4.5 m long, 1.5 m wide). Z turns them 90°; the ghost shows the way up. Leave room at the top end.', 'Cầu thang: đi từ tầng đang xây lên tầng kế (dài 4.5 m, rộng 1.5 m). Z xoay 90°; bóng mờ cho thấy hướng đi lên. Chừa chỗ trống ở đầu trên.', '계단: Z로 90° 회전'), false)
        else if (this.object === 'roof') this.status?.(M('Roof: click inside a closed room (walls, doors and windows all around). The roof fits the room and turns see-through when the character is inside.', 'Mái: bấm vào bên trong một phòng đã khép kín (tường, cửa, cửa sổ bao quanh). Mái tự khớp theo phòng và mờ đi khi nhân vật ở trong nhà.', '지붕: 닫힌 방 안을 클릭'), false)
      }
      if (b.dataset.lv !== undefined) {
        this.level = Number(b.dataset.lv); this.base_level = this.level; this.hide_ghost()
        this.status?.(M(`Building on floor ${this.level + 1}. Floors above it turn see-through while you build.${this.level > 0 ? ' Walls go on top of the walls below; then a Floor over the room below, and Stairs on the floor below to walk up.' : ''}`, `Đang xây tầng ${this.level + 1}. Các tầng phía trên mờ đi khi đang xây.${this.level > 0 ? ' Tường đặt lên trên tường tầng dưới; rồi đặt Sàn phủ phòng bên dưới, và Cầu thang ở tầng dưới để đi lên.' : ''}`, `${this.level + 1}층`), false)
      }
      if (b.dataset.rmf !== undefined) { void this.remove_custom(b.dataset.rmf); return }
      if (b.dataset.lx !== undefined || b.dataset.ldel !== undefined) return
      if (this.tool !== 'place') this.hide_ghost()
      const x = b.dataset.x
      if (x === 'addfile') { (sec.querySelector('[data-k="cfile"]') as HTMLInputElement).click(); return }
      if (x === 'unity') this.export_unity()
      if (x === 'unitypkg') {
        void (async () => {
          const { ask_layout } = await import('./unity/BehaviourPanel.ts')
          const L = await ask_layout(); if (L === null) return
          this.status?.(M('Building the Unity package…', 'Đang tạo gói Unity…', 'Unity 패키지 만드는 중…'), false)
          try { const files = await this.export_unitypackage(L); this.status?.(M(`GreenboxMap.unitypackage saved (${files.length} files). In Unity: Assets › Import Package › Custom Package, then menu Greenbox › Build map in scene.`, `Đã lưu GreenboxMap.unitypackage (${files.length} file). Trong Unity: Assets › Import Package › Custom Package, rồi menu Greenbox › Build map in scene.`, 'Unity 패키지 저장됨'), false) } catch (err) { this.status?.(String(err), true) }
        })()
      }
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
      else if (k === 'variety') this.variety = Number(el.value) / 100
      else if (k === 'psize') { this.place_size = Number(el.value) / 100; const o = this.panel?.querySelector("[data-psizev]"); if (o) o.textContent = el.value + '%'; if (this.ghost) this.ghost.scale.setScalar(this.place_size) }
      else if (k === 'water') { this.water = Number(el.value) / 10; this.rebuild() }
      else if (k === 'sea') { this.sea = el.checked; this.rebuild() }
      else if (k === 'dig') this.dig_depth = Number(el.value) / 10
      else if (k === 'fill') this.pool_fill = Number(el.value) / 100
      else if (k === 'msize') { const v = sec.querySelector('[data-msizev]'); if (v !== null) v.textContent = `${el.value} m` }
    })
    sec.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement; const k = el.dataset.k
      if (k === 'msize') this.resize(Number(el.value))
      if (el.dataset.wx !== undefined || el.dataset.daytime !== undefined) { const q = (x: string): string => (sec.querySelector(x) as HTMLSelectElement).value; this.set_weather(q('[data-wx]') as WeatherKind, q('[data-daytime]') as DayTime) }
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
    p.querySelectorAll<HTMLElement>('[data-lv]').forEach(b => b.classList.toggle('on', Number(b.dataset.lv) === this.level))
    const ms = p.querySelector<HTMLInputElement>('[data-k="msize"]'); const mv = p.querySelector('[data-msizev]'); const sz = Math.round(this.n * this.cell); if (ms !== null && document.activeElement !== ms) ms.value = String(sz); if (mv !== null) mv.textContent = `${sz} m`
    if (this.tool === 'none') this.ring.visible = false
  }
}
