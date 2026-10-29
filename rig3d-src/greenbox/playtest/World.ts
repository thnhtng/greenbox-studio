/*
 * Play-test map: props you can walk on, bump into and climb, plus a small editor to drop your own GLB/FBX
 * (a mountain, a house, a bridge…) into the map and move / turn / scale / copy / delete it.
 *
 * Physics is deliberately simple (good enough for ad footage):
 *   floor   = the highest up-facing surface under the feet that is at most STEP above them
 *   wall    = something at knee height in the direction of travel
 *   ledge   = a wall whose top is at most CLIMB_MAX above the feet -> the character climbs it
 */
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

export const STEP = 0.45 // m the character steps up without jumping
export const CLIMB_MAX = 2.6 // m highest ledge it climbs
const RADIUS = 0.3

export type EditMode = 'translate' | 'rotate' | 'scale'

export class World {
  public readonly props = new THREE.Group() // everything walkable / solid
  public selected: THREE.Object3D | null = null
  public on_change: (() => void) | null = null
  private readonly gizmo: TransformControls
  private readonly ray = new THREE.Raycaster()
  private solids: THREE.Mesh[] = []

  constructor (private readonly scene: THREE.Scene, camera: THREE.Camera, dom: HTMLElement) {
    this.props.name = 'Map props'
    scene.add(this.props)
    this.gizmo = new TransformControls(camera, dom)
    this.gizmo.setSize(0.9)
    const helper = (this.gizmo as any).getHelper?.() ?? this.gizmo // three r169+: the gizmo is drawn by a helper
    scene.add(helper)
    this.gizmo.addEventListener('objectChange', () => { if (this.gizmo.mode !== 'translate' || this.snap) this.drop_to_ground(this.selected); this.refresh() })
  }

  public snap = true // keep props sitting on the ground / on other props

  /** true while the user is dragging a gizmo handle (the camera must not turn then) */
  public dragging (): boolean { return (this.gizmo as any).dragging === true }

  public refresh (): void {
    this.solids = []
    this.props.updateMatrixWorld(true)
    this.props.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true && m.visible) this.solids.push(m) })
    this.on_change?.()
  }

  /* ---------------- adding props ---------------- */
  public add_box (pos: THREE.Vector3, size: THREE.Vector3, color: number, name = 'Box'): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshLambertMaterial({ color }))
    m.geometry.translate(0, size.y / 2, 0) // pivot at the bottom: easy to put on the ground
    m.position.copy(pos); m.castShadow = true; m.receiveShadow = true; m.name = name
    this.props.add(m); this.refresh()
    return m
  }

  /** a GLB / FBX with no animation: becomes a prop. Huge or tiny files are brought to a sensible size. */
  public async add_file (buf: ArrayBuffer, name: string, at: THREE.Vector3): Promise<THREE.Object3D> {
    let root: THREE.Object3D
    if (/\.fbx$/i.test(name)) root = new FBXLoader().parse(buf, '')
    else root = (await new GLTFLoader().parseAsync(buf, '')).scene
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.castShadow = true; m.receiveShadow = true } })
    const holder = new THREE.Group(); holder.name = name.replace(/\.[^.]+$/, '')
    holder.add(root)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3()); const big = Math.max(size.x, size.y, size.z)
    if (big > 60 || big < 0.3) root.scale.multiplyScalar(8 / Math.max(1e-6, big))
    root.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(root)
    // pivot at the bottom centre
    root.position.x -= (b2.min.x + b2.max.x) / 2; root.position.z -= (b2.min.z + b2.max.z) / 2; root.position.y -= b2.min.y
    holder.position.copy(at)
    this.props.add(holder)
    this.refresh()
    return holder
  }

  public duplicate (o: THREE.Object3D): THREE.Object3D {
    const c = o.clone(true)
    c.position.x += 1.5
    this.props.add(c); this.refresh()
    return c
  }

  public remove (o: THREE.Object3D): void {
    if (this.selected === o) this.select(null)
    o.removeFromParent(); this.refresh()
  }

  /* ---------------- editor ---------------- */
  public set_editing (on: boolean): void {
    this.gizmo.enabled = on
    if (!on) this.select(null)
  }

  public set_mode (m: EditMode): void { this.gizmo.setMode(m) }

  public select (o: THREE.Object3D | null): void {
    this.selected = o
    if (o === null) this.gizmo.detach(); else this.gizmo.attach(o)
  }

  /** the top-level prop under a screen point */
  public pick (ndc: THREE.Vector2, camera: THREE.Camera): THREE.Object3D | null {
    this.ray.setFromCamera(ndc, camera)
    const h = this.ray.intersectObjects(this.solids, false)[0]
    if (h === undefined) return null
    let o: THREE.Object3D = h.object
    while (o.parent !== null && o.parent !== this.props) o = o.parent
    return o.parent === this.props ? o : null
  }

  /** put a prop on whatever is under it (ground or another prop) */
  public drop_to_ground (o: THREE.Object3D | null): void {
    if (o === null || !this.snap) return
    o.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(o)
    const others = this.solids.filter(m => { let p: THREE.Object3D | null = m; while (p !== null) { if (p === o) return false; p = p.parent } return true })
    const c = b.getCenter(new THREE.Vector3())
    this.ray.set(new THREE.Vector3(c.x, b.min.y + 0.01, c.z), new THREE.Vector3(0, -1, 0))
    const h = this.ray.intersectObjects(others, false)[0]
    const floor = h !== undefined ? h.point.y : 0
    o.position.y += floor - b.min.y
  }

  /* ---------------- physics queries ---------------- */
  /** highest up-facing surface under (x, z) at most STEP above y (0 = the flat ground) */
  public ground_at (x: number, z: number, y: number): number {
    if (this.solids.length === 0) return 0
    this.ray.set(new THREE.Vector3(x, y + STEP, z), new THREE.Vector3(0, -1, 0))
    this.ray.far = y + STEP + 50
    const h = this.ray.intersectObjects(this.solids, false).find(i => i.face == null || i.face.normal.clone().transformDirection(i.object.matrixWorld).y > 0.2)
    this.ray.far = Infinity
    return Math.max(0, h !== undefined ? h.point.y : 0)
  }

  /** top of whatever stands at (x, z), looking down from `from_y` (null = nothing there) */
  private top_at (x: number, z: number, from_y: number): number | null {
    this.ray.set(new THREE.Vector3(x, from_y, z), new THREE.Vector3(0, -1, 0))
    const h = this.ray.intersectObjects(this.solids, false)[0]
    return h !== undefined ? h.point.y : null
  }

  /**
   * moving from `a` to `b` (feet positions): if a wall is in the way, `b` is pulled back to `a`.
   * Returns the ledge top to climb (world point on top, a bit past the edge) when the wall is low enough.
   */
  public block (a: THREE.Vector3, b: THREE.Vector3, scale = 1): THREE.Vector3 | null {
    if (this.solids.length === 0) return null
    const d = new THREE.Vector3(b.x - a.x, 0, b.z - a.z); const len = d.length()
    if (len < 1e-6) return null
    d.divideScalar(len)
    let hit: THREE.Intersection | undefined
    for (const k of [STEP * scale + 0.05, 1.0 * scale, 1.6 * scale]) {
      this.ray.set(new THREE.Vector3(a.x, a.y + k, a.z), d); this.ray.far = len + RADIUS * scale
      hit = this.ray.intersectObjects(this.solids, false)[0]
      if (hit !== undefined) break
    }
    this.ray.far = Infinity
    if (hit === undefined) return null
    b.x = a.x; b.z = a.z // blocked
    // how high is it? look down from just above the climb limit, a little past the wall face
    const past = hit.point.clone().addScaledVector(d, 0.45 * scale)
    const top = this.top_at(past.x, past.z, a.y + CLIMB_MAX * scale + 0.05)
    if (top === null || top <= a.y + STEP * scale) return null
    if (top - a.y > CLIMB_MAX * scale) return null
    // is there room on top? (nothing right above the ledge)
    this.ray.set(new THREE.Vector3(past.x, top + 0.05, past.z), new THREE.Vector3(0, 1, 0)); this.ray.far = 1.6 * scale
    const roof = this.ray.intersectObjects(this.solids, false)[0]; this.ray.far = Infinity
    if (roof !== undefined) return null
    return new THREE.Vector3(past.x, top, past.z)
  }
}
