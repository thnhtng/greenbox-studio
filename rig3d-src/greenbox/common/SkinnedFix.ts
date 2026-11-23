/**
 * glTF skinned meshes: the spec says the transform of a skinned mesh's node (and of its parents) MUST be ignored;
 * only the joints place the vertices. three.js still applies it, so a Blender export whose mesh sits under an
 * "Armature" scaled 0.01 (centimetres) shows a 2 m person 2 cm tall (invisible). This moves such meshes to the
 * root of the loaded scene with an identity transform (and an identity bind matrix), which renders exactly what the
 * spec asks for. Files whose skinned meshes already have an identity world transform are not touched.
 */
import * as THREE from 'three'

function is_identity (m: THREE.Matrix4, eps = 1e-5): boolean {
  const e = m.elements; const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  for (let i = 0; i < 16; i++) if (Math.abs(e[i] - I[i]) > eps * (i === 12 || i === 13 || i === 14 ? 100 : 1)) return false
  return true
}

/** returns how many skinned meshes were moved */
export function fix_gltf_skinned_parents (root: THREE.Object3D): number {
  root.updateMatrixWorld(true)
  const root_inv = root.matrixWorld.clone().invert()
  const list: THREE.SkinnedMesh[] = []
  root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh === true) list.push(o as THREE.SkinnedMesh) })
  let n = 0
  for (const sk of list) {
    // the mesh's transform relative to the loaded scene (the scene itself may sit anywhere)
    const rel = root_inv.clone().multiply(sk.matrixWorld)
    if (is_identity(rel)) continue
    // only the GLTFLoader case: bound with an identity bind matrix, so three draws model x (joints x inverse binds)
    if (!is_identity(sk.bindMatrix)) continue
    root.add(sk)
    sk.position.set(0, 0, 0); sk.quaternion.identity(); sk.scale.set(1, 1, 1)
    sk.updateMatrixWorld(true)
    sk.bind(sk.skeleton, new THREE.Matrix4())
    n++
  }
  if (n > 0) console.info(`Greenbox: ${n} skinned mesh(es) were under a moved / scaled node; placed by their joints as glTF says`)
  return n
}
