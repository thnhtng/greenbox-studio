/*
 * Play-test map: props you can walk on, bump into and climb, plus a small editor to drop your own GLB/FBX
 * (a mountain, a house, a bridge…) into the map and move / turn / scale / copy / delete it.
 *
 * Physics is deliberately simple (good enough for ad footage):
 *   floor   = the highest up-facing surface under the feet that is at most STEP above them
 *   wall    = something at knee height in the direction of travel
 *   ledge   = a wall whose top is at most CLIMB_MAX above the feet -> the character climbs it
 */
import { load_any_buffer } from '../common/AnyLoader.ts'
import { clone_deep } from '../common/CloneDeep.ts'
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
  public readonly gizmo: TransformControls
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
    if (this.selected !== null) { let p: THREE.Object3D | null = this.selected; while (p !== null && p !== this.props) p = p.parent; if (p === null) this.select(null) } // the selected prop was rebuilt / removed: no handles on a ghost
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
    const root: THREE.Object3D = (await load_any_buffer(name, buf)).scene
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
    const c = clone_deep(o)
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

  public on_select: ((o: THREE.Object3D | null) => void) | null = null
  public select (o: THREE.Object3D | null): void {
    this.selected = o; this.on_select?.(o)
    if (o === null) this.gizmo.detach(); else this.gizmo.attach(o)
  }

  /* ---------------- ✋ grab: hold a prop and slide it over the map, a liquid glass halo under it ---------------- */
  public held: THREE.Object3D | null = null
  private readonly grab_off = new THREE.Vector2()
  private grab_moved = false
  private halo: THREE.Group | null = null
  private halo_t = 0

  /** emerald glass disc + a white rim + a soft green glow ring (drawn over the ground, never picked) */
  private make_halo (): THREE.Group {
    const g = new THREE.Group(); g.name = 'grab halo'
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshPhysicalMaterial({
      color: 0x8dffc8, transparent: true, opacity: 0.34, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
      sheen: 1, sheenColor: new THREE.Color(0xffffff), emissive: 0x2fe98b, emissiveIntensity: 0.22, depthWrite: false
    }))
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 12, 96), new THREE.MeshPhysicalMaterial({
      color: 0xffffff, emissive: 0xe9fff4, emissiveIntensity: 0.6, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92, depthWrite: false
    }))
    const glow = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.32, 96), new THREE.MeshBasicMaterial({ color: 0x2fe98b, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }))
    const hi = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.68, 64, 1, Math.PI * 0.15, Math.PI * 0.55), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }))
    for (const m of [glass, rim, glow, hi]) { m.rotation.x = -Math.PI / 2; m.userData.no_pick = true; m.renderOrder = 10; g.add(m) }
    g.visible = false
    this.scene.add(g)
    return g
  }

  private place_halo (o: THREE.Object3D): void {
    if (this.halo === null) this.halo = this.make_halo()
    const b = new THREE.Box3().setFromObject(o); const s = b.getSize(new THREE.Vector3())
    this.halo.scale.setScalar(Math.max(0.6, Math.hypot(s.x, s.z) * 0.58))
    this.halo.position.set((b.min.x + b.max.x) / 2, b.min.y + 0.05, (b.min.z + b.max.z) / 2)
    this.halo.visible = true
  }

  /** where the cursor ray meets the map (ground / other props), skipping the held prop; the y = 0 plane as a fallback */
  private grab_point (ndc: THREE.Vector2, camera: THREE.Camera, skip: THREE.Object3D): THREE.Vector3 | null {
    this.ray.setFromCamera(ndc, camera)
    const inside = (m: THREE.Object3D): boolean => { let p: THREE.Object3D | null = m; while (p !== null) { if (p === skip) return true; p = p.parent } return false }
    const h = this.ray.intersectObjects(this.solids.filter(m => !inside(m) && m.userData.no_pick !== true), false)[0]
    this.grab_top = h !== undefined && this.faces_up(h) ? h.point.y : null
    if (h !== undefined) return h.point.clone()
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
  }

  /** the top of another prop under the cursor while holding one (a keyboard over a table) — null over the ground */
  private grab_top: number | null = null
  private faces_up (h: THREE.Intersection): boolean { return h.face != null && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.5 }

  /** 📚 the up-facing top of a prop under this ray (to put a new object ON a table, a crate…), or null */
  public prop_top (ray: THREE.Ray, skip?: THREE.Object3D | null): THREE.Vector3 | null {
    this.ray.set(ray.origin, ray.direction)
    const inside = (m: THREE.Object3D): boolean => { let p: THREE.Object3D | null = m; while (p !== null) { if (p === skip) return true; p = p.parent } return false }
    const h = this.ray.intersectObjects(this.solids.filter(m => m.userData.no_pick !== true && !inside(m)), false)[0]
    return h !== undefined && this.faces_up(h) ? h.point.clone() : null
  }

  /** put o's bottom at height y (stacking) */
  public set_bottom (o: THREE.Object3D, y: number): void { o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); o.position.y += y - b.min.y; o.updateMatrixWorld(true) }

  public grab_start (o: THREE.Object3D, ndc: THREE.Vector2, camera: THREE.Camera): void {
    const p = this.grab_point(ndc, camera, o)
    this.held = o; this.grab_moved = false
    ;((this.gizmo as any).getHelper?.() ?? this.gizmo).visible = false // the arrows would only get in the way while holding
    this.grab_off.set(p === null ? 0 : o.position.x - p.x, p === null ? 0 : o.position.z - p.z)
    this.place_halo(o)
  }

  public grab_move (ndc: THREE.Vector2, camera: THREE.Camera): void {
    const o = this.held; if (o === null) return
    const p = this.grab_point(ndc, camera, o); if (p === null) return
    o.position.x = p.x + this.grab_off.x; o.position.z = p.z + this.grab_off.y
    if (this.grid_step > 0 && this.shift) { o.position.x = Math.round(o.position.x / this.grid_step) * this.grid_step; o.position.z = Math.round(o.position.z / this.grid_step) * this.grid_step }
    if (this.snap && this.grab_top !== null) this.set_bottom(o, this.grab_top); else if (this.snap) this.drop_to_ground(o); else o.position.y = p.y
    o.updateMatrixWorld(true)
    this.grab_moved = true
    this.place_halo(o)
  }

  /** true when the prop really moved (worth an autosave) */
  public grab_end (): boolean {
    const moved = this.grab_moved
    this.held = null; this.grab_moved = false
    if (this.halo !== null) this.halo.visible = false
    ;((this.gizmo as any).getHelper?.() ?? this.gizmo).visible = true
    if (moved) this.refresh()
    return moved
  }

  /** the halo breathes a little while held (every frame) */
  public tick_halo (dt: number): void {
    if (this.halo === null || !this.halo.visible) return
    this.halo_t += dt
    const k = 0.5 + 0.5 * Math.sin(this.halo_t * 4)
    ;((this.halo.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.25 * k
    this.halo.children[3].rotation.z = this.halo_t * 0.9
  }

  /**
   * the top-level prop under a screen point. A thin model (a sword, a fence, a plant) is easy to miss by a few pixels, and the click
   * then landed on whatever stood behind it (a plan block, a see-through placeholder): the handles jumped there and "the model stayed".
   * So: see-through wireframes never win over something real, and a smaller prop whose box the ray enters first wins over the big thing behind.
   */
  public pick (ndc: THREE.Vector2, camera: THREE.Camera): THREE.Object3D | null {
    this.ray.setFromCamera(ndc, camera)
    const top = (q: THREE.Object3D): THREE.Object3D | null => { let o = q; while (o.parent !== null && o.parent !== this.props) o = o.parent; return o.parent === this.props ? o : null }
    const wire = (m: THREE.Material): boolean => (m as any).wireframe === true || m.visible === false || (m.transparent && m.opacity < 0.08)
    const real = (q: THREE.Object3D): boolean => {
      if (q.userData.no_pick === true) return false
      const mat = (q as THREE.Mesh).material; if (mat !== undefined && (Array.isArray(mat) ? mat.every(wire) : wire(mat))) return false
      for (let p: THREE.Object3D | null = q; p !== null; p = p.parent) if (!p.visible) return false
      return true
    }
    const hits = this.ray.intersectObjects(this.solids, false)
    const ground = hits.find(i => i.object.userData.no_pick === true)?.distance ?? Infinity // nothing behind the terrain is picked through it
    const h = hits.find(i => i.distance <= ground + 0.05 && real(i.object)) ?? hits.find(i => i.distance <= ground + 0.05 && i.object.userData.no_pick !== true)
    const under = h !== undefined ? top(h.object) : null
    const near = this.pick_box(h !== undefined ? h.distance : ground + 0.05, under)
    return near ?? under
  }

  /**
   * a click in the gaps of a sparse prop (grass tuft, coin pile, fence) still picks it: the nearest prop box on the ray, in front of `max`.
   * With a real hit `under` behind it, only a clearly smaller prop wins (a sword in front of a block: yes; a house around a chair: no).
   */
  private pick_box (max = Infinity, under: THREE.Object3D | null = null): THREE.Object3D | null {
    let best: THREE.Object3D | null = null; let bd = max; const v = new THREE.Vector3(); const s = new THREE.Vector3()
    const vol = (o: THREE.Object3D): number => { const q = new THREE.Box3().setFromObject(o).getSize(s); return Math.max(q.x, 0.05) * Math.max(q.y, 0.05) * Math.max(q.z, 0.05) }
    const limit = under !== null ? vol(under) * 0.6 : Infinity
    for (const o of this.props.children) {
      if (o === under || !o.visible || o.userData.no_pick === true) continue
      const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) continue
      b.getSize(s); if (Math.max(s.x, s.z) > 30) continue // terrain-size things (a map file) need a real hit
      if (Math.max(s.x, 0.05) * Math.max(s.y, 0.05) * Math.max(s.z, 0.05) > limit) continue
      b.expandByScalar(0.12)
      if (b.containsPoint(this.ray.ray.origin)) continue // the camera stands inside it
      if (this.ray.ray.intersectBox(b, v) !== null) { const d = v.distanceTo(this.ray.ray.origin); if (d < bd) { bd = d; best = o } }
    }
    return best
  }

  /** ⇧ held while dragging: snap to this grid step (m); set by the app */
  public grid_step = 1
  public shift = false

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
    return h !== undefined ? h.point.y : 0 // terrain can go below 0 (valleys, river beds)
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
