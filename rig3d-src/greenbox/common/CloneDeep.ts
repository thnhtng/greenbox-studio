/** clone a model for placing a 2nd copy. A rigged model (SkinnedMesh) must get its own skeleton: Object3D.clone() keeps the
 *  copy bound to the ORIGINAL bones, so the copy is drawn where the original stands while its handles move somewhere else. */
import * as THREE from 'three'
import { clone as skeleton_clone } from 'three/examples/jsm/utils/SkeletonUtils.js'

export function clone_deep<T extends THREE.Object3D> (src: T): T {
  let skinned = false
  src.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh === true) skinned = true })
  if (!skinned) return src.clone(true)
  const c = skeleton_clone(src) as T
  c.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh === true) m.frustumCulled = false })
  return c
}
