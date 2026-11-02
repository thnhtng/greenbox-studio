/*
 * One loader for every Greenbox 3D page: GLB, GLTF (+ .bin / textures picked together), FBX, OBJ (+ .mtl),
 * DAE, STL, PLY, 3MF, or a .zip holding any of those.
 *
 * Why files "did not show": OBJ was not accepted at all, a .gltf needs its .bin next to it, old ASCII FBX
 * (version < 7000, FBX 2011 and earlier) is not readable by three.js, and loader errors were only written
 * to the console. Here every failure comes back as a readable message, and the result is cleaned up
 * (normals, NaN vertices, broken materials) so it always renders.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js'
import JSZip from 'jszip'
import { M } from './lang.ts'

export const MODEL_ACCEPT = '.glb,.gltf,.fbx,.obj,.mtl,.dae,.stl,.ply,.3mf,.zip,.bin,.png,.jpg,.jpeg,.tga,.webp'
const MODEL_EXT = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'stl', 'ply', '3mf']

export interface AnyResult { scene: THREE.Group, clips: THREE.AnimationClip[], name: string, warnings: string[] }

interface Src { name: string, data: ArrayBuffer }

const ext = (n: string): string => (n.split('.').pop() ?? '').toLowerCase()
const base = (n: string): string => (n.split(/[\\/]/).pop() ?? n).toLowerCase()

/** true when one of the files is a model we can open (used by drop zones) */
export function has_model (files: ArrayLike<File>): boolean {
  return Array.from(files).some(f => MODEL_EXT.includes(ext(f.name)) || ext(f.name) === 'zip')
}

export async function load_any_files (files: ArrayLike<File>): Promise<AnyResult> {
  const list: Src[] = []
  for (const f of Array.from(files)) list.push({ name: f.name, data: await f.arrayBuffer() })
  return await load_any(list)
}

export async function load_any_buffer (name: string, data: ArrayBuffer): Promise<AnyResult> {
  return await load_any([{ name, data }])
}

async function unzip (src: Src): Promise<Src[]> {
  const zip = await JSZip.loadAsync(src.data)
  const out: Src[] = []
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path.startsWith('__MACOSX')) continue
    out.push({ name: path, data: await entry.async('arraybuffer') })
  }
  return out
}

/** FBX: refuse early with a clear reason instead of a cryptic parser error */
function check_fbx (data: ArrayBuffer): string | null {
  const head = new Uint8Array(data, 0, Math.min(data.byteLength, 4096))
  const magic = 'Kaydara FBX Binary'
  let bin = true
  for (let i = 0; i < magic.length; i++) if (head[i] !== magic.charCodeAt(i)) { bin = false; break }
  let version = 0
  if (bin) version = new DataView(data).getUint32(23, true)
  else {
    const txt = new TextDecoder().decode(head)
    const m = txt.match(/FBXVersion:\s*(\d+)/)
    if (m !== null) version = Number(m[1])
  }
  if (version > 0 && version < 7000) {
    return M(`This FBX is version ${version} (too old). Re-export it as FBX 2013 or newer (Binary) — in Blender: File › Export › FBX; in Maya/Max choose "FBX 2013+".`,
      `FBX này là bản ${version} (quá cũ). Xuất lại thành FBX 2013 trở lên (Binary) — Blender: File › Export › FBX; Maya/Max chọn "FBX 2013+".`,
      `이 FBX는 버전 ${version}(너무 오래됨)입니다. FBX 2013 이상(Binary)으로 다시 내보내세요.`)
  }
  return null
}

export async function load_any (input: Src[]): Promise<AnyResult> {
  let files: Src[] = []
  for (const s of input) files.push(...(ext(s.name) === 'zip' ? await unzip(s) : [s]))
  files = files.filter(f => f.data.byteLength > 0)
  const order = ['glb', 'gltf', 'fbx', 'obj', 'dae', '3mf', 'stl', 'ply']
  const main = files.filter(f => MODEL_EXT.includes(ext(f.name))).sort((a, b) => order.indexOf(ext(a.name)) - order.indexOf(ext(b.name)))[0]
  if (main === undefined) {
    throw new Error(M('No 3D model in what you picked (supported: GLB, GLTF, FBX, OBJ, DAE, STL, PLY, 3MF, ZIP).',
      'Không thấy model 3D trong file đã chọn (hỗ trợ: GLB, GLTF, FBX, OBJ, DAE, STL, PLY, 3MF, ZIP).',
      '선택한 파일에 3D 모델이 없습니다 (GLB, GLTF, FBX, OBJ, DAE, STL, PLY, 3MF, ZIP 지원).'))
  }
  const warnings: string[] = []
  // side files (textures, .bin, .mtl) are found by file name, whatever folder the model points at
  const urls = new Map<string, string>()
  for (const f of files) if (f !== main) urls.set(base(f.name), URL.createObjectURL(new Blob([f.data])))
  const missing = new Set<string>()
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url
    const key = base(decodeURIComponent(url.split('?')[0]))
    const hit = urls.get(key)
    if (hit !== undefined) return hit
    missing.add(key)
    return url
  })
  manager.addHandler(/\.tga$/i, new TGALoader(manager))
  const text = (): string => new TextDecoder().decode(main.data)
  let scene: THREE.Group = new THREE.Group()
  let clips: THREE.AnimationClip[] = []
  try {
    switch (ext(main.name)) {
      case 'glb': case 'gltf': {
        const g = await new GLTFLoader(manager).parseAsync(ext(main.name) === 'glb' ? main.data : text(), '')
        scene.add(g.scene); clips = g.animations; break
      }
      case 'fbx': {
        const why = check_fbx(main.data)
        if (why !== null) throw new Error(why)
        const f = new FBXLoader(manager).parse(main.data, '')
        scene.add(f); clips = f.animations; break
      }
      case 'obj': {
        const obj = new OBJLoader(manager)
        const mtl = files.find(f => ext(f.name) === 'mtl')
        if (mtl !== undefined) {
          const mats = new MTLLoader(manager).parse(new TextDecoder().decode(mtl.data), '')
          mats.preload(); obj.setMaterials(mats)
        }
        scene.add(obj.parse(text())); break
      }
      case 'dae': {
        const c = new ColladaLoader(manager).parse(text(), '')
        if (c === null) throw new Error('DAE')
        scene.add(c.scene); clips = c.scene.animations ?? []; break
      }
      case 'stl': scene.add(new THREE.Mesh(new STLLoader(manager).parse(main.data), new THREE.MeshStandardMaterial({ color: 0xb0b4bb }))); break
      case 'ply': {
        const g = new PLYLoader(manager).parse(main.data)
        scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb0b4bb, vertexColors: g.getAttribute('color') !== undefined }))); break
      }
      case '3mf': scene.add(new ThreeMFLoader(manager).parse(main.data)); break
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(M(`Could not read ${main.name}: ${msg}`, `Không đọc được ${main.name}: ${msg}`, `${main.name}을(를) 읽을 수 없습니다: ${msg}`))
  }
  // textures load after parse: give them a moment so "missing" is accurate
  await new Promise(r => setTimeout(r, 50))
  if (ext(main.name) === 'gltf' && [...missing].some(m => m.endsWith('.bin'))) {
    throw new Error(M('This .gltf needs its .bin file: pick both together (or zip the folder).',
      'File .gltf này cần file .bin đi kèm: chọn cả 2 file cùng lúc (hoặc nén cả thư mục thành .zip).',
      '이 .gltf는 .bin 파일이 필요합니다: 함께 선택하세요(또는 폴더를 zip으로).'))
  }
  if (missing.size > 0) {
    warnings.push(M(`Missing textures (shown grey): ${[...missing].slice(0, 4).join(', ')}. Pick them together with the model, or zip the folder.`,
      `Thiếu texture (hiện màu xám): ${[...missing].slice(0, 4).join(', ')}. Chọn chúng cùng lúc với model, hoặc nén cả thư mục thành .zip.`,
      `텍스처 없음(회색 표시): ${[...missing].slice(0, 4).join(', ')}.`))
  }
  const fixed = sanitize(scene, missing.size > 0)
  if (fixed > 0) warnings.push(M(`Repaired ${fixed} mesh(es).`, `Đã sửa ${fixed} mesh lỗi.`, `메시 ${fixed}개 복구.`))
  let meshes = 0
  scene.traverse(o => { if ((o as THREE.Mesh).isMesh === true) meshes++ })
  if (meshes === 0) {
    throw new Error(M(`${main.name} has no mesh (only bones / empties?).`, `${main.name} không có mesh nào (chỉ có xương / empty?).`, `${main.name}에 메시가 없습니다.`))
  }
  setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 30000)
  return { scene, clips, name: main.name, warnings }
}

/**
 * Make anything renderable: NaN vertices → 0, missing normals, materials that point at missing textures,
 * fully transparent materials, invisible meshes. Returns how many meshes needed a fix.
 */
export function sanitize (root: THREE.Object3D, textures_missing = false): number {
  let fixed = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh !== true || m.geometry === undefined) return
    let bad = false
    const pos = m.geometry.getAttribute('position')
    if (pos === undefined) return
    const a = pos.array as Float32Array
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { a[i] = 0; bad = true }
    if (bad) pos.needsUpdate = true
    if (m.geometry.getAttribute('normal') === undefined) { m.geometry.computeVertexNormals(); bad = true }
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    const out = mats.map((mat) => {
      if (mat === undefined || mat === null) { bad = true; return new THREE.MeshStandardMaterial({ color: 0xb0b4bb }) }
      const s = mat as THREE.MeshStandardMaterial
      if (s.opacity !== undefined && s.opacity < 0.05 && s.transparent) { s.opacity = 1; s.transparent = false; bad = true }
      if (textures_missing && s.map !== undefined && s.map !== null && s.map.image === undefined) { s.map = null; s.needsUpdate = true }
      return mat
    })
    m.material = Array.isArray(m.material) ? out : out[0]
    if (!m.visible) { m.visible = true; bad = true }
    m.frustumCulled = false
    if (bad) fixed++
  })
  return fixed
}
