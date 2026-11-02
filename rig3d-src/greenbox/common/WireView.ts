/*
 * "See the mesh": a wireframe drawn over any model (people, animals, vehicles, props), skinned or not.
 * The overlay shares the geometry, so it follows animation and later weight edits.
 */
import * as THREE from 'three'

const TAG = '__gb_wire'
const mat = new THREE.MeshBasicMaterial({ color: 0x0b0f14, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false })
const mat_light = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false })

export function set_wire (roots: THREE.Object3D | THREE.Object3D[], on: boolean, light = false): void {
  const add: THREE.Mesh[] = []
  for (const root of Array.isArray(roots) ? roots : [roots]) root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh !== true || m.userData[TAG] === true) return
    const old = m.children.find(c => c.userData[TAG] === true)
    if (old !== undefined) m.remove(old)
    if (on) add.push(m)
  })
  for (const m of add) {
    let w: THREE.Mesh
    const sk = m as THREE.SkinnedMesh
    if (sk.isSkinnedMesh === true) {
      const s = new THREE.SkinnedMesh(m.geometry, light ? mat_light : mat)
      s.bind(sk.skeleton, sk.bindMatrix); s.bindMode = sk.bindMode
      w = s
    } else w = new THREE.Mesh(m.geometry, light ? mat_light : mat)
    w.userData[TAG] = true; w.name = 'wireframe'; w.renderOrder = 2
    w.raycast = () => {} // never picked
    w.frustumCulled = false
    m.add(w)
  }
}

export function has_wire (roots: THREE.Object3D | THREE.Object3D[]): boolean {
  let on = false
  for (const root of Array.isArray(roots) ? roots : [roots]) root.traverse(o => { if (o.userData[TAG] === true) on = true })
  return on
}
