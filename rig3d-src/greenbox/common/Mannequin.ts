/*
 * A neutral test character built from Greenbox's standard human skeleton (rigs/rig-human.glb):
 * one rigid capsule per bone, skinned 100% to that bone. Used when no character is loaded yet
 * (video mocap preview, play test).
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const FINGER = /(thumb|index|middle|ring|pinky)/i

export async function build_mannequin (url = './rigs/rig-human.glb'): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(url)
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const bones: THREE.Bone[] = []
  root.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone) })
  const wp = (b: THREE.Object3D): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)
  const box = new THREE.Box3(); bones.forEach(b => box.expandByPoint(wp(b)))
  const H = Math.max(1e-3, box.max.y - box.min.y)
  const pieces: THREE.BufferGeometry[] = []
  bones.forEach((b, bi) => {
    const kids = b.children.filter((c): c is THREE.Bone => (c as THREE.Bone).isBone)
    if (kids.length === 0 || /^root$/i.test(b.name)) return
    // main child: the one continuing the chain (middle finger for the hand, spine for the pelvis)
    const kid = kids.find(k => /spine|neck|head|middle|lowerarm|hand|calf|foot|ball/i.test(k.name)) ?? kids[0]
    const a = wp(b); const c = wp(kid)
    const len = a.distanceTo(c); if (len < 1e-5) return
    let r = H * (FINGER.test(b.name) ? 0.008 : /pelvis|spine/i.test(b.name) ? 0.075 : /head/i.test(b.name) ? 0.07 : /thigh/i.test(b.name) ? 0.05 : /clavicle/i.test(b.name) ? 0.025 : 0.035)
    if (/hand/i.test(b.name)) r = H * 0.022
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r), 4, 10)
    g.translate(0, len / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize()))
    g.translate(a.x, a.y, a.z)
    const n = g.getAttribute('position').count
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_v, i) => i % 4 === 0 ? bi : 0), 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_v, i) => i % 4 === 0 ? 1 : 0), 4))
    pieces.push(g.index !== null ? g.toNonIndexed() : g)
  })
  const geo = mergeGeometries(pieces, false)
  geo.computeVertexNormals()
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xc9ccd6, roughness: 0.65, metalness: 0.05 }))
  mesh.name = 'Mannequin'; mesh.frustumCulled = false; mesh.castShadow = true
  const skeleton = new THREE.Skeleton(bones)
  root.add(mesh)
  mesh.bind(skeleton, new THREE.Matrix4())
  root.name = 'GreenboxMannequin'
  return root
}
