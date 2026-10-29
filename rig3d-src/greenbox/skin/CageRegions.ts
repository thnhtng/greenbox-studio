/*
 * Body regions of the anatomy cage (human skeleton, UE5 Manny-style bone names) and the
 * "skin regions" preview: the model painted with the colour of the bone that will move each vertex.
 */
import * as THREE from 'three'
import { type Bone } from 'three'
import { BONES_OFF, KEEP_ALWAYS } from '../rig/BoneReduce'
import { CAGE, build_capsules, apply_settings, cage_weights } from './CageWeights'

export interface CageRegion { id: string, label: string, re: RegExp, color: number }

/** labels are English: gb-i18n.js translates them on screen */
export const CAGE_REGIONS: CageRegion[] = [
  { id: 'head', label: 'Head', re: /^head/i, color: 0xff5d5d },
  { id: 'neck', label: 'Neck', re: /^neck/i, color: 0xffa04d },
  { id: 'chest', label: 'Chest / spine', re: /^spine/i, color: 0xffe14d },
  { id: 'hips', label: 'Hips', re: /^pelvis|^hips/i, color: 0x9be15d },
  { id: 'shoulder', label: 'Shoulder', re: /^clavicle/i, color: 0x4dd2c3 },
  { id: 'upperarm', label: 'Upper arm', re: /^upperarm/i, color: 0x4da6ff },
  { id: 'forearm', label: 'Forearm', re: /^lowerarm|^forearm/i, color: 0x7a6bff },
  { id: 'hand', label: 'Hand', re: /^hand/i, color: 0xd36bff },
  { id: 'finger', label: 'Fingers', re: /^(thumb|index|middle|ring|pinky)/i, color: 0xff6bd0 },
  { id: 'thigh', label: 'Thigh', re: /^thigh/i, color: 0x3fbf7f },
  { id: 'calf', label: 'Calf', re: /^calf|^shin/i, color: 0x2f8fbf },
  { id: 'foot', label: 'Foot', re: /^foot|^ball|^toe/i, color: 0xbf8f2f }
]

export function region_of (bone_name: string): CageRegion | undefined { return CAGE_REGIONS.find(r => r.re.test(bone_name)) }

/** bones of the skeleton in a region */
export function region_bones (bones: Bone[], id: string): Bone[] {
  const r = CAGE_REGIONS.find(x => x.id === id); return r === undefined ? [] : bones.filter(b => r.re.test(b.name))
}

/** average measured diameter of a region's capsules (model units), NaN if not measured yet */
export function region_diameter (bones: Bone[], id: string): number {
  const ds = region_bones(bones, id).map(b => CAGE.radii.get(b.name)).filter((r): r is [number, number] => r !== undefined)
    .map(([a, b]) => a + b) // (r0 + r1) / 2 * 2
  return ds.length === 0 ? NaN : ds.reduce((a, b) => a + b, 0) / ds.length
}

function bone_color (b: Bone): THREE.Color {
  // a joint that is turned off gives its skin to the first parent that stays
  while (BONES_OFF.has(b.name) && b.parent instanceof THREE.Bone && !KEEP_ALWAYS.test(b.name)) b = b.parent
  const r = region_of(b.name)
  const c = new THREE.Color(r?.color ?? 0x999999)
  if (/_r$|\.r$|right/i.test(b.name)) c.offsetHSL(0.04, 0, -0.12) // right side a bit darker so L / R read apart
  return c
}

/**
 * Coloured copies of the model meshes (world space) showing which bone owns which skin, with the same
 * weights the export will use. Joints show the blend between the two colours.
 */
export function build_region_preview (bones: Bone[], meshes: THREE.Mesh[]): THREE.Group {
  const group = new THREE.Group(); group.name = 'Greenbox skin regions'
  const caps = build_capsules(bones); apply_settings(caps)
  if (caps.length === 0) return group
  const cols = bones.map(bone_color)
  for (const m of meshes) {
    const g = m.geometry.clone()
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
    g.applyMatrix4(m.matrixWorld)
    const [idx, w] = cage_weights(bones, g, caps)
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3); const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      c.setRGB(0, 0, 0)
      for (let k = 0; k < 4; k++) { const wk = w[i * 4 + k]; if (wk > 0) { const bc = cols[idx[i * 4 + k]]; c.r += bc.r * wk; c.g += bc.g * wk; c.b += bc.b * wk } }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }))
    group.add(mesh)
  }
  return group
}

export function dispose_group (g: THREE.Group): void {
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } })
  g.clear()
}
