/*
 * Weight painting on a skinned model, Blender style but simpler.
 *
 *  - Pick a bone (click it in the list, or click the skin with the Pick tool / Ctrl+click): the skin shows how
 *    much that bone moves each point (grey = not at all, blue → green → yellow → red = 100 %).
 *  - Brush adds, Eraser removes, Smooth softens the border. Radius / strength sliders, [ and ] change the radius.
 *  - Select points / edges / faces / whole pieces (Shift = add, Alt = remove, drag = box) to limit the brush,
 *    or to set / remove the bone on the selection in one click.
 *
 * The rule that fixes "the arm drags the thigh" (A-pose): when weight is REMOVED from a bone, the point gives
 * it back to the other bones it already had (proportionally). If it had none, it goes to the nearest bone that
 * is not the painted bone or one of its children. So erasing the arm colour on the thigh hands the thigh its
 * skin back, and nothing else changes. Weight ADDED to a bone is taken from the others proportionally. Points
 * that share a position (UV seams) are always edited together, so painting never tears the mesh.
 */
import * as THREE from 'three'
import { undo_action } from '../common/UndoKeys.ts'
import { M } from '../common/lang.ts'

export type PaintTool = 'pick' | 'brush' | 'erase' | 'smooth' | 'select'
export type SelMode = 'vertex' | 'edge' | 'face' | 'island'

export interface PaintHost {
  camera: () => THREE.Camera
  dom: HTMLElement
  scene: THREE.Scene
  meshes: () => THREE.SkinnedMesh[]
  /** called when the weights changed (exporters, previews) */
  changed?: () => void
  /** stop / restart the animation player while painting */
  pause?: (on: boolean) => void
}

interface MeshData {
  mesh: THREE.SkinnedMesh
  idx: THREE.BufferAttribute
  w: THREE.BufferAttribute
  rep: Int32Array // welded representative of each vertex
  members: Map<number, number[]> // representative -> all vertices at that position
  nb: Map<number, Set<number>> // representative -> neighbour representatives
  tri: Int32Array // triangle vertex indices
  island: Int32Array // representative -> piece id
  color: THREE.BufferAttribute
  material: THREE.Material | THREE.Material[]
  sel: Set<number> // selected representatives
  world: Float32Array // posed world positions (refreshed per stroke)
  normal: Float32Array
}

const TURBO = [[0.19, 0.07, 0.23], [0.27, 0.41, 0.95], [0.1, 0.78, 0.83], [0.35, 0.95, 0.42], [0.85, 0.92, 0.2], [0.98, 0.55, 0.13], [0.8, 0.12, 0.05]]
function heat (t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.9999, Math.max(0, t)) * (TURBO.length - 1)
  const i = Math.floor(x); const f = x - i; const a = TURBO[i]; const b = TURBO[i + 1]
  return out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)
}

export function mirror_name (n: string): string {
  const swaps: Array<[RegExp, string]> = [[/_l$/i, '_r'], [/_r$/i, '_l'], [/\.l$/i, '.R'], [/\.r$/i, '.L'], [/left/i, 'Right'], [/right/i, 'Left'], [/^l_/i, 'R_'], [/^r_/i, 'L_']]
  for (const [re, to] of swaps) {
    if (re.test(n)) {
      const m = n.match(re)?.[0] ?? ''
      const t = m === m.toUpperCase() ? to.toUpperCase() : m === m.toLowerCase() ? to.toLowerCase() : to
      return n.replace(re, t)
    }
  }
  return n
}

export class WeightPaint {
  public active = false
  public tool: PaintTool = 'pick'
  public sel_mode: SelMode = 'vertex'
  public radius_px = 40
  public strength = 0.5
  public mirror = false
  public front_only = true
  public mask_selection = false
  public view: 'one' | 'all' = 'one'
  public bend = 0
  public bend_axis: 0 | 1 | 2 = 2
  public bone = -1

  private data: MeshData[] = []
  private bones: THREE.Bone[] = []
  private bind_head: THREE.Vector3[] = []
  private bind_tail: THREE.Vector3[] = []
  private undo: Array<Array<{ d: MeshData, i: Float32Array, w: Float32Array }>> = []
  private redo: Array<Array<{ d: MeshData, i: Float32Array, w: Float32Array }>> = []
  private painting = false
  private box_start: { x: number, y: number } | null = null
  private moved = false
  private cursor: HTMLDivElement
  private boxel: HTMLDivElement
  private panel: HTMLDivElement | null = null
  private readonly heat_mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
  private readonly ray = new THREE.Raycaster()
  private prev_before_render: THREE.Scene['onBeforeRender'] | null = null
  private last_ev: PointerEvent | null = null
  private raf = 0
  /* the skeleton drawn over the skin while painting; the bone being painted is yellow and named */
  private readonly bone_lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }))
  private readonly bone_sel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true, opacity: 0.85 }))
  private readonly joint_pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffffff, size: 7, sizeAttenuation: false, depthTest: false }))
  private bone_tag: HTMLDivElement | null = null
  public show_bones = true
  /** points painted by hand (kept by bone name when the skin is computed again) */
  private readonly edited = new Map<MeshData, Set<number>>()

  constructor (private readonly host: PaintHost) {
    this.cursor = document.createElement('div')
    this.cursor.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #000a;display:none;z-index:50'
    this.boxel = document.createElement('div')
    this.boxel.style.cssText = 'position:fixed;pointer-events:none;border:1px dashed #fff;background:#4da6ff22;display:none;z-index:50'
    document.body.append(this.cursor, this.boxel)
    const cap = { capture: true }
    window.addEventListener('pointerdown', e => this.down(e), cap)
    window.addEventListener('pointermove', e => this.move(e), cap)
    window.addEventListener('pointerup', e => this.up(e), cap)
    window.addEventListener('keydown', e => this.key(e), cap)
  }

  /* ---------------- start / stop ---------------- */
  public start (): boolean {
    const meshes = this.host.meshes().filter(m => m.isSkinnedMesh && m.geometry.getAttribute('skinWeight') !== undefined)
    if (meshes.length === 0) return false
    this.data = meshes.map(m => this.prepare(m))
    this.used_cache = null; this.mirror_cache.clear()
    this.bones = meshes[0].skeleton.bones
    this.compute_bind_segments(meshes[0].skeleton)
    if (this.bone < 0 || this.bone >= this.bones.length) this.bone = this.guess_start_bone()
    for (const d of this.data) { d.material = d.mesh.material; d.mesh.material = this.heat_mat }
    // paint on a still model: bind pose (+ the optional test bend), drawn just before every frame
    this.prev_before_render = this.host.scene.onBeforeRender
    this.host.scene.onBeforeRender = (...a) => { this.pose(); (this.prev_before_render as any)?.(...a) }
    this.active = true
    this.host.pause?.(true)
    for (const o of [this.bone_lines, this.bone_sel, this.joint_pts]) { o.renderOrder = 999; o.frustumCulled = false; this.host.scene.add(o) }
    this.bone_tag = document.createElement('div')
    this.bone_tag.style.cssText = 'position:fixed;z-index:45;pointer-events:none;padding:2px 7px;border-radius:6px;background:#ffd23fee;color:#111;font:700 12px system-ui,sans-serif;display:none'
    document.body.append(this.bone_tag)
    this.recolor()
    this.build_panel()
    return true
  }

  public stop (): void {
    if (!this.active) return
    this.active = false
    this.host.pause?.(false)
    for (const d of this.data) { d.mesh.material = d.material; d.mesh.geometry.deleteAttribute('color') }
    this.host.scene.onBeforeRender = this.prev_before_render ?? (() => {})
    this.panel?.remove(); this.panel = null
    this.cursor.style.display = 'none'
    for (const o of [this.bone_lines, this.bone_sel, this.joint_pts]) o.removeFromParent()
    this.bone_tag?.remove(); this.bone_tag = null
    this.data = []
  }

  private guess_start_bone (): number {
    const i = this.bones.findIndex(b => /upperarm_l|upper_arm\.l|leftarm|arm_l/i.test(b.name))
    return i >= 0 ? i : 0
  }

  private prepare (mesh: THREE.SkinnedMesh): MeshData {
    const g = mesh.geometry
    const pos = g.getAttribute('position')
    const n = pos.count
    // skin attributes as float so we can write fractional values freely
    let idx = g.getAttribute('skinIndex') as THREE.BufferAttribute
    let w = g.getAttribute('skinWeight') as THREE.BufferAttribute
    if (!(w.array instanceof Float32Array)) { w = new THREE.BufferAttribute(Float32Array.from(w.array as ArrayLike<number>), 4); g.setAttribute('skinWeight', w) }
    if (!(idx.array instanceof Uint16Array)) { idx = new THREE.Uint16BufferAttribute(Uint16Array.from(idx.array as ArrayLike<number>), 4); g.setAttribute('skinIndex', idx) }
    // weld by position
    const rep = new Int32Array(n)
    const members = new Map<number, number[]>()
    const key = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`
      const r = key.get(k)
      if (r === undefined) { key.set(k, i); rep[i] = i; members.set(i, [i]) } else { rep[i] = r; members.get(r)!.push(i) }
    }
    const index = g.getIndex()
    const tri = index !== null ? Int32Array.from(index.array as ArrayLike<number>) : Int32Array.from({ length: n - (n % 3) }, (_, i) => i)
    const nb = new Map<number, Set<number>>()
    const link = (a: number, b: number): void => { if (a === b) return; (nb.get(a) ?? nb.set(a, new Set()).get(a)!).add(b) }
    for (let t = 0; t + 2 < tri.length; t += 3) {
      const a = rep[tri[t]]; const b = rep[tri[t + 1]]; const c = rep[tri[t + 2]]
      link(a, b); link(b, a); link(b, c); link(c, b); link(a, c); link(c, a)
    }
    // pieces (islands) over the welded graph
    const island = new Int32Array(n).fill(-1)
    let id = 0
    for (const r of members.keys()) {
      if (island[r] >= 0) continue
      const st = [r]; island[r] = id
      while (st.length > 0) { const x = st.pop()!; for (const y of nb.get(x) ?? []) if (island[y] < 0) { island[y] = id; st.push(y) } }
      id++
    }
    const color = new THREE.BufferAttribute(new Float32Array(n * 3), 3)
    g.setAttribute('color', color)
    return { mesh, idx, w, rep, members, nb, tri, island, color, material: mesh.material, sel: new Set(), world: new Float32Array(n * 3), normal: new Float32Array(n * 3) }
  }

  private compute_bind_segments (sk: THREE.Skeleton): void {
    // bind pose world matrix of bone i = inverse(boneInverses[i]) (in the skinned mesh's bind space)
    const bm = this.data[0].mesh.bindMatrix; const mw = this.data[0].mesh.matrixWorld
    const bmi = this.data[0].mesh.bindMatrixInverse
    this.bind_head = sk.bones.map((_, i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[i]).invert()).applyMatrix4(bmi).applyMatrix4(mw))
    this.bind_tail = sk.bones.map((b, i) => {
      const kids = b.children.map(c => sk.bones.indexOf(c as THREE.Bone)).filter(k => k >= 0)
      if (kids.length === 0) {
        const p = b.parent !== null ? sk.bones.indexOf(b.parent as THREE.Bone) : -1
        return p >= 0 ? this.bind_head[i].clone().sub(this.bind_head[p]).multiplyScalar(0.5).add(this.bind_head[i]) : this.bind_head[i].clone()
      }
      const t = new THREE.Vector3(); kids.forEach(k => t.add(this.bind_head[k])); return t.divideScalar(kids.length)
    })
    void bm
  }

  /* ---------------- pose while painting ---------------- */
  private pose (): void {
    if (!this.active || this.data.length === 0) return
    const sk = this.data[0].mesh.skeleton
    sk.pose()
    if (this.bend !== 0 && this.bone >= 0) {
      const b = this.bones[this.bone]
      const ax = new THREE.Vector3(); ax.setComponent(this.bend_axis, 1)
      b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, THREE.MathUtils.degToRad(this.bend)))
      // mirror bone bends the same way so a symmetric fix can be checked at once
      if (this.mirror) {
        const mi = this.mirror_bone(this.bone)
        if (mi >= 0 && mi !== this.bone) this.bones[mi].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, THREE.MathUtils.degToRad(-this.bend)))
      }
    }
    let root: THREE.Object3D = sk.bones[0]
    while (root.parent !== null && (root.parent as THREE.Bone).isBone === true) root = root.parent
    root.updateMatrixWorld(true)
    this.draw_bones()
  }

  /** bone i as a segment (head -> tail) in the current pose */
  private segment (i: number): [THREE.Vector3, THREE.Vector3] {
    const b = this.bones[i]; const h = b.getWorldPosition(new THREE.Vector3())
    const kids = b.children.filter(c => (c as THREE.Bone).isBone === true)
    if (kids.length > 0) { const t = new THREE.Vector3(); kids.forEach(c => t.add(c.getWorldPosition(new THREE.Vector3()))); return [h, t.divideScalar(kids.length)] }
    const p = b.parent as THREE.Bone | null
    if (p !== null && p.isBone === true) { const ph = p.getWorldPosition(new THREE.Vector3()); return [h, h.clone().add(h.clone().sub(ph).multiplyScalar(0.4))] }
    return [h, h.clone()]
  }

  private draw_bones (): void {
    const on = this.show_bones
    this.bone_lines.visible = on; this.joint_pts.visible = on; this.bone_sel.visible = on && this.bone >= 0
    if (!on) { if (this.bone_tag !== null) this.bone_tag.style.display = 'none'; return }
    const pos: number[] = []; const col: number[] = []; const pts: number[] = []
    const c = new THREE.Color()
    this.bones.forEach((_, i) => {
      const [a, b] = this.segment(i); pts.push(a.x, a.y, a.z)
      if (a.distanceToSquared(b) < 1e-12) return
      c.setHSL((i * 0.618034) % 1, 0.75, 0.6); if (this.bone >= 0 && i !== this.bone) c.multiplyScalar(0.55)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, c.r, c.g, c.b)
    })
    const g = this.bone_lines.geometry; g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    this.joint_pts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    if (this.bone >= 0) {
      const [a, b] = this.segment(this.bone); const L = Math.max(1e-4, a.distanceTo(b))
      this.bone_sel.position.copy(a).add(b).multiplyScalar(0.5)
      this.bone_sel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
      this.bone_sel.scale.set(L * 0.07, L, L * 0.07)
      if (this.bone_tag !== null) {
        const r = this.host.dom.getBoundingClientRect(); const p = this.bone_sel.position.clone().project(this.host.camera())
        if (p.z < 1) { this.bone_tag.style.display = 'block'; this.bone_tag.textContent = this.bones[this.bone].name; this.bone_tag.style.left = `${r.left + (p.x + 1) / 2 * r.width + 12}px`; this.bone_tag.style.top = `${r.top + (1 - p.y) / 2 * r.height - 10}px` } else this.bone_tag.style.display = 'none'
      }
    }
  }

  /** the bone drawn nearest to a click (within 10 px), or -1 */
  private bone_near (e: { clientX: number, clientY: number }): number {
    if (!this.show_bones) return -1
    const r = this.host.dom.getBoundingClientRect(); const cam = this.host.camera()
    const S = (v: THREE.Vector3): [number, number, number] => { const p = v.clone().project(cam); return [(p.x + 1) / 2 * r.width + r.left, (1 - p.y) / 2 * r.height + r.top, p.z] }
    let best = -1; let bd = 10
    this.bones.forEach((_, i) => {
      const [a, b] = this.segment(i); const A = S(a); const B = S(b); if (A[2] > 1 || B[2] > 1) return
      const vx = B[0] - A[0]; const vy = B[1] - A[1]; const L = vx * vx + vy * vy || 1
      const t = Math.max(0, Math.min(1, ((e.clientX - A[0]) * vx + (e.clientY - A[1]) * vy) / L))
      const d = Math.hypot(A[0] + vx * t - e.clientX, A[1] + vy * t - e.clientY); if (d < bd) { bd = d; best = i }
    })
    return best
  }

  /** what was painted by hand, per mesh: vertex -> [bone name, weight][] */
  public export_manual (): Array<Map<number, Array<[string, number]>>> {
    return this.data.map(d => {
      const out = new Map<number, Array<[string, number]>>(); const set = this.edited.get(d)
      set?.forEach(r => { for (const m of d.members.get(r) ?? [r]) { const l: Array<[string, number]> = []; for (let k = 0; k < 4; k++) { const w = d.w.getComponent(m, k); if (w > 1e-4) l.push([this.bones[d.idx.getComponent(m, k)]?.name ?? '', w]) } out.set(m, l) } })
      return out
    })
  }
  public has_manual (): boolean { for (const s of this.edited.values()) if (s.size > 0) return true; return false }

  private mirror_bone (i: number): number {
    const n = mirror_name(this.bones[i].name)
    return n === this.bones[i].name ? -1 : this.bones.findIndex(b => b.name.toLowerCase() === n.toLowerCase())
  }

  /* ---------------- weights ---------------- */
  private get_w (d: MeshData, v: number, b: number): number {
    for (let k = 0; k < 4; k++) if (d.idx.getComponent(v, k) === b) return d.w.getComponent(v, k)
    return 0
  }

  private subtree (skip: number): Set<number> {
    const banned = new Set<number>()
    const st = [this.bones[skip]]
    while (st.length > 0) { const b = st.pop()!; banned.add(this.bones.indexOf(b)); b.children.forEach(c => { if ((c as THREE.Bone).isBone === true) st.push(c as THREE.Bone) }) }
    return banned
  }

  /**
   * Who gets the skin when bone `skip` is erased from a point that had nothing else:
   *  1. the bone the surrounding skin already uses most (up to 4 rings around the point), so the patch
   *     blends into its neighbourhood — erasing arm on the thigh gives it to the thigh;
   *  2. else the nearest bone that skins something (never a helper like "root"), outside skip's sub-tree.
   */
  private fallback_bone (p: THREE.Vector3, skip: number, d?: MeshData, r?: number): number {
    const banned = this.subtree(skip)
    if (d !== undefined && r !== undefined) {
      let ring = new Set<number>([r]); const seen = new Set<number>([r])
      for (let step = 0; step < 4; step++) {
        const next = new Set<number>()
        ring.forEach(x => d.nb.get(x)?.forEach(y => { if (!seen.has(y)) { seen.add(y); next.add(y) } }))
        const score = new Map<number, number>()
        next.forEach(y => { for (let k = 0; k < 4; k++) { const bi = d.idx.getComponent(y, k); const wk = d.w.getComponent(y, k); if (wk > 0.01 && !banned.has(bi)) score.set(bi, (score.get(bi) ?? 0) + wk) } })
        if (score.size > 0) return [...score.entries()].sort((a, b) => b[1] - a[1])[0][0]
        ring = next
      }
    }
    const used = this.used_bones()
    let best = -1; let bd = Infinity
    const seg = new THREE.Line3(); const q = new THREE.Vector3()
    for (let i = 0; i < this.bones.length; i++) {
      if (banned.has(i) || (used.size > 0 && !used.has(i))) continue
      seg.set(this.bind_head[i], this.bind_tail[i]); seg.closestPointToPoint(p, true, q)
      const dd = q.distanceToSquared(p)
      if (dd < bd) { bd = dd; best = i }
    }
    return best
  }

  private used_cache: Set<number> | null = null
  /** bones that skin at least one point (computed once per paint session) */
  private used_bones (): Set<number> {
    if (this.used_cache !== null) return this.used_cache
    const u = new Set<number>()
    for (const d of this.data) for (let v = 0; v < d.w.count; v++) for (let k = 0; k < 4; k++) if (d.w.getComponent(v, k) > 0.01) u.add(d.idx.getComponent(v, k))
    this.used_cache = u
    return u
  }

  /** set bone b's weight on welded point r to x, keeping the sum at 1 (see rule at the top) */
  private set_w (d: MeshData, r: number, b: number, x: number, locked?: Set<number>): void {
    x = Math.min(1, Math.max(0, x))
    const v = r
    const I = [0, 1, 2, 3].map(k => d.idx.getComponent(v, k)); const W = [0, 1, 2, 3].map(k => d.w.getComponent(v, k))
    let k = I.findIndex((bi, j) => bi === b && W[j] > 0)
    if (k < 0) k = I.findIndex((bi) => bi === b)
    const cur = k >= 0 ? W[k] : 0
    if (Math.abs(cur - x) < 1e-5) return
    if (k < 0) {
      if (x <= 0) return
      // take the emptiest slot
      k = 0; for (let j = 1; j < 4; j++) if (W[j] < W[k]) k = j
      I[k] = b; W[k] = 0
    }
    // locked (held) bones keep their weight, like Maya's "Hold"
    const held = (j: number): boolean => j !== k && locked !== undefined && locked.has(I[j]) && W[j] > 0
    let heldSum = 0; for (let j = 0; j < 4; j++) if (held(j)) heldSum += W[j]
    x = Math.min(x, Math.max(0, 1 - heldSum))
    W[k] = x
    let others = 0; for (let j = 0; j < 4; j++) if (j !== k && !held(j)) others += W[j]
    const rest = 1 - x - heldSum
    if (others > 1e-6) { const s = rest / others; for (let j = 0; j < 4; j++) if (j !== k && !held(j)) W[j] *= s } else if (rest > 1e-6) {
      // bind-pose position: bones are measured in bind pose too
      const pb = new THREE.Vector3().fromBufferAttribute(d.mesh.geometry.getAttribute('position'), v).applyMatrix4(d.mesh.matrixWorld)
      const fb = this.fallback_bone(pb, b, d, r)
      if (fb >= 0) { let j = W.findIndex((_, jj) => jj !== k && W[jj] <= 1e-6); if (j < 0) j = (k + 1) % 4; I[j] = fb; W[j] = rest }
    }
    let sum = W.reduce((a, c) => a + c, 0); if (sum <= 1e-6) { W[k] = 1; sum = 1 }
    for (const m of d.members.get(r) ?? [r]) for (let j = 0; j < 4; j++) { d.idx.setComponent(m, j, W[j] > 1e-6 ? I[j] : 0); d.w.setComponent(m, j, W[j] / sum) }
    ;(this.edited.get(d) ?? this.edited.set(d, new Set()).get(d)!).add(r)
  }

  private dirty (): void {
    for (const d of this.data) { d.idx.needsUpdate = true; d.w.needsUpdate = true }
    this.recolor(); this.host.changed?.()
  }

  private state (): Array<{ d: MeshData, i: Float32Array, w: Float32Array }> {
    return this.data.map(d => ({ d, i: Float32Array.from(d.idx.array as ArrayLike<number>), w: Float32Array.from(d.w.array as ArrayLike<number>) }))
  }

  private snapshot (): void {
    this.undo.push(this.state())
    if (this.undo.length > 30) this.undo.shift()
    this.redo = [] // a new edit forgets what was undone
  }

  private restore (s: Array<{ d: MeshData, i: Float32Array, w: Float32Array }>): void {
    for (const { d, i, w } of s) { (d.idx.array as Uint16Array).set(i); (d.w.array as Float32Array).set(w) }
    this.used_cache = null
    this.dirty()
  }

  public undo_last (): void {
    const s = this.undo.pop(); if (s === undefined) return
    this.redo.push(this.state()); this.restore(s)
  }

  public redo_last (): void {
    const s = this.redo.pop(); if (s === undefined) return
    this.undo.push(this.state()); this.restore(s)
  }

  /* ---------------- colours ---------------- */
  public recolor (): void {
    const c = new THREE.Color(); const grey = new THREE.Color(0.55, 0.57, 0.6); const selc = new THREE.Color(1, 0.55, 0.1)
    const hues = this.bones.map((_, i) => new THREE.Color().setHSL((i * 0.618034) % 1, 0.75, 0.55))
    for (const d of this.data) {
      const a = d.color.array as Float32Array
      const n = d.color.count
      for (let v = 0; v < n; v++) {
        if (this.view === 'one') {
          const x = this.bone >= 0 ? this.get_w(d, v, this.bone) : 0
          if (x <= 0.001) c.copy(grey); else heat(0.08 + 0.92 * x, c)
        } else {
          c.setRGB(0, 0, 0)
          for (let k = 0; k < 4; k++) {
            const wk = d.w.getComponent(v, k); if (wk <= 0) continue
            const bi = d.idx.getComponent(v, k); const h = hues[bi] ?? grey
            const dim = this.bone < 0 || bi === this.bone ? 1 : 0.35
            c.r += h.r * wk * dim; c.g += h.g * wk * dim; c.b += h.b * wk * dim
          }
        }
        if (d.sel.has(d.rep[v])) c.lerp(selc, 0.55)
        a[v * 3] = c.r; a[v * 3 + 1] = c.g; a[v * 3 + 2] = c.b
      }
      d.color.needsUpdate = true
    }
    this.refresh_panel()
  }

  /* ---------------- picking ---------------- */
  private ndc (e: { clientX: number, clientY: number }): THREE.Vector2 {
    const r = this.host.dom.getBoundingClientRect()
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private hit (e: { clientX: number, clientY: number }): { d: MeshData, p: THREE.Vector3, face: THREE.Face, faceIndex: number } | null {
    this.pose()
    this.ray.setFromCamera(this.ndc(e), this.host.camera())
    const hits = this.ray.intersectObjects(this.data.map(d => d.mesh), false)
    const h = hits[0]
    if (h === undefined || h.face === undefined || h.face === null) return null
    const d = this.data.find(x => x.mesh === h.object)!
    return { d, p: h.point, face: h.face, faceIndex: h.faceIndex ?? 0 }
  }

  private refresh_world (): void {
    this.pose()
    const v = new THREE.Vector3()
    for (const d of this.data) {
      const n = d.mesh.geometry.getAttribute('position').count
      d.mesh.updateMatrixWorld()
      for (let i = 0; i < n; i++) {
        if (d.rep[i] !== i) continue
        d.mesh.getVertexPosition(i, v); v.applyMatrix4(d.mesh.matrixWorld)
        d.world[i * 3] = v.x; d.world[i * 3 + 1] = v.y; d.world[i * 3 + 2] = v.z
      }
      const nor = d.mesh.geometry.getAttribute('normal')
      if (nor !== undefined) {
        const nm = new THREE.Matrix3().getNormalMatrix(d.mesh.matrixWorld)
        for (let i = 0; i < n; i++) { if (d.rep[i] !== i) continue; v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); d.normal[i * 3] = v.x; d.normal[i * 3 + 1] = v.y; d.normal[i * 3 + 2] = v.z }
      }
    }
  }

  private world_per_px (p: THREE.Vector3): number {
    const cam = this.host.camera() as THREE.PerspectiveCamera & THREE.OrthographicCamera
    const h = this.host.dom.getBoundingClientRect().height
    if (cam.isOrthographicCamera === true) return (cam.top - cam.bottom) / cam.zoom / h
    const dist = cam.position.distanceTo(p)
    return 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / h
  }

  private facing (d: MeshData, r: number): boolean {
    if (!this.front_only) return true
    const cam = this.host.camera()
    const cp = cam.getWorldPosition(new THREE.Vector3())
    const dx = cp.x - d.world[r * 3]; const dy = cp.y - d.world[r * 3 + 1]; const dz = cp.z - d.world[r * 3 + 2]
    const ortho = (cam as THREE.OrthographicCamera).isOrthographicCamera === true
    if (ortho) { const f = cam.getWorldDirection(new THREE.Vector3()); return -(f.x * d.normal[r * 3] + f.y * d.normal[r * 3 + 1] + f.z * d.normal[r * 3 + 2]) > -0.05 }
    return dx * d.normal[r * 3] + dy * d.normal[r * 3 + 1] + dz * d.normal[r * 3 + 2] > -0.05 * Math.hypot(dx, dy, dz)
  }

  /** mirrored welded point (x flipped around the model centre), cached */
  private mirror_cache = new Map<MeshData, Int32Array>()
  private mirror_of (d: MeshData): Int32Array {
    let m = this.mirror_cache.get(d); if (m !== undefined) return m
    const pos = d.mesh.geometry.getAttribute('position')
    const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute)
    const cx = (box.min.x + box.max.x) / 2; const cell = box.getSize(new THREE.Vector3()).length() / 200
    const grid = new Map<string, number[]>()
    const k = (x: number, y: number, z: number): string => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`
    for (const r of d.members.keys()) { const kk = k(pos.getX(r), pos.getY(r), pos.getZ(r)); (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(r) }
    m = new Int32Array(pos.count).fill(-1)
    for (const r of d.members.keys()) {
      const x = 2 * cx - pos.getX(r); const y = pos.getY(r); const z = pos.getZ(r)
      let best = -1; let bd = (cell * 1.5) ** 2
      const gx = Math.round(x / cell); const gy = Math.round(y / cell); const gz = Math.round(z / cell)
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (const o of grid.get(`${gx + a},${gy + b},${gz + c}`) ?? []) { const dd = (pos.getX(o) - x) ** 2 + (pos.getY(o) - y) ** 2 + (pos.getZ(o) - z) ** 2; if (dd < bd) { bd = dd; best = o } }
      }
      m[r] = best
    }
    this.mirror_cache.set(d, m)
    return m
  }

  /* ---------------- brush ---------------- */
  private stroke (e: PointerEvent): void {
    const h = this.hit(e); if (h === null) return
    const R = this.radius_px * this.world_per_px(h.p)
    const R2 = R * R
    const b = this.bone; if (b < 0) return
    const mb = this.mirror ? this.mirror_bone(b) : -1
    for (const d of this.data) {
      const hits: Array<[number, number]> = []
      for (const r of d.members.keys()) {
        const dx = d.world[r * 3] - h.p.x; const dy = d.world[r * 3 + 1] - h.p.y; const dz = d.world[r * 3 + 2] - h.p.z
        const dd = dx * dx + dy * dy + dz * dz
        if (dd > R2) continue
        if (this.mask_selection && d.sel.size > 0 && !d.sel.has(r)) continue
        if (!this.facing(d, r)) continue
        const t = 1 - Math.sqrt(dd) / R
        hits.push([r, t * t * (3 - 2 * t)]) // smooth falloff
      }
      const mir = this.mirror ? this.mirror_of(d) : null
      const apply = (r: number, f: number, bone: number): void => {
        const cur = this.get_w(d, r, bone)
        const s = this.strength * f
        if (this.tool === 'brush') this.set_w(d, r, bone, cur + (1 - cur) * s)
        else if (this.tool === 'erase') this.set_w(d, r, bone, cur * (1 - Math.min(1, s * 1.6)))
        else if (this.tool === 'smooth') {
          const ns = d.nb.get(r); if (ns === undefined || ns.size === 0) return
          let avg = 0; ns.forEach(o => { avg += this.get_w(d, o, bone) }); avg /= ns.size
          this.set_w(d, r, bone, cur + (avg - cur) * s)
        }
      }
      for (const [r, f] of hits) {
        apply(r, f, b)
        if (mir !== null && mb >= 0) { const o = mir[r]; if (o >= 0 && o !== r) apply(o, f, mb) }
      }
    }
    this.dirty()
  }

  /* ---------------- selection ---------------- */
  private select_click (e: PointerEvent): void {
    const h = this.hit(e)
    const add = e.shiftKey; const remove = e.altKey
    if (!add && !remove) this.data.forEach(d => d.sel.clear())
    if (h === null) { this.recolor(); return }
    const { d, p, faceIndex } = h
    const t = [d.tri[faceIndex * 3], d.tri[faceIndex * 3 + 1], d.tri[faceIndex * 3 + 2]].map(i => d.rep[i])
    let pick: number[] = []
    const P = (r: number): THREE.Vector3 => new THREE.Vector3(d.world[r * 3], d.world[r * 3 + 1], d.world[r * 3 + 2])
    if (this.sel_mode === 'vertex') pick = [t.reduce((a, c) => P(c).distanceTo(p) < P(a).distanceTo(p) ? c : a)]
    else if (this.sel_mode === 'edge') {
      const edges: Array<[number, number]> = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]
      const ln = new THREE.Line3(); const q = new THREE.Vector3()
      const dist = (ed: [number, number]): number => { ln.set(P(ed[0]), P(ed[1])); ln.closestPointToPoint(p, true, q); return q.distanceTo(p) }
      pick = edges.reduce((a, c) => dist(c) < dist(a) ? c : a)
    } else if (this.sel_mode === 'face') pick = t
    else { const id = d.island[t[0]]; for (const r of d.members.keys()) if (d.island[r] === id) pick.push(r) }
    for (const r of pick) { if (remove) d.sel.delete(r); else d.sel.add(r) }
    this.recolor()
  }

  private select_box (a: { x: number, y: number }, e: PointerEvent): void {
    const add = e.shiftKey; const remove = e.altKey
    if (!add && !remove) this.data.forEach(d => d.sel.clear())
    const x0 = Math.min(a.x, e.clientX); const x1 = Math.max(a.x, e.clientX); const y0 = Math.min(a.y, e.clientY); const y1 = Math.max(a.y, e.clientY)
    const rect = this.host.dom.getBoundingClientRect(); const cam = this.host.camera(); const v = new THREE.Vector3()
    for (const d of this.data) {
      const hitIslands = new Set<number>()
      for (const r of d.members.keys()) {
        v.set(d.world[r * 3], d.world[r * 3 + 1], d.world[r * 3 + 2]).project(cam)
        const sx = rect.left + (v.x + 1) / 2 * rect.width; const sy = rect.top + (1 - v.y) / 2 * rect.height
        if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || v.z > 1) continue
        if (!this.facing(d, r)) continue
        if (this.sel_mode === 'island') hitIslands.add(d.island[r]); else if (remove) d.sel.delete(r); else d.sel.add(r)
      }
      if (hitIslands.size > 0) for (const r of d.members.keys()) if (hitIslands.has(d.island[r])) { if (remove) d.sel.delete(r); else d.sel.add(r) }
    }
    this.recolor()
  }

  public grow (): void {
    for (const d of this.data) { const add: number[] = []; d.sel.forEach(r => d.nb.get(r)?.forEach(o => add.push(o))); add.forEach(r => d.sel.add(r)) }
    this.recolor()
  }

  public select_all (on: boolean): void { for (const d of this.data) { d.sel.clear(); if (on) for (const r of d.members.keys()) d.sel.add(r) } this.recolor() }

  /** selection → this bone 100 % (assign) or 0 % (remove), or smooth */
  public apply_selection (op: 'assign' | 'remove' | 'smooth'): void {
    if (this.bone < 0) return
    this.snapshot(); this.refresh_world()
    const mb = this.mirror ? this.mirror_bone(this.bone) : -1
    for (const d of this.data) {
      const mir = this.mirror ? this.mirror_of(d) : null
      const run = (r: number, b: number): void => {
        if (op === 'assign') this.set_w(d, r, b, 1)
        else if (op === 'remove') this.set_w(d, r, b, 0)
        else { const ns = d.nb.get(r); if (ns === undefined || ns.size === 0) return; let avg = 0; ns.forEach(o => { avg += this.get_w(d, o, b) }); this.set_w(d, r, b, (this.get_w(d, r, b) + avg / ns.size) / 2) }
      }
      for (const r of d.sel) { run(r, this.bone); if (mir !== null && mb >= 0 && mir[r] >= 0) run(mir[r], mb) }
    }
    this.dirty()
  }

  /** "Clean": remove this bone from every point that is not connected (over the mesh) to its main area */
  public clean_islands (): void {
    if (this.bone < 0) return
    this.snapshot(); this.refresh_world()
    for (const d of this.data) {
      // flood fill over points where the bone has weight, starting from the strongest point
      let start = -1; let bw = 0
      for (const r of d.members.keys()) { const x = this.get_w(d, r, this.bone); if (x > bw) { bw = x; start = r } }
      if (start < 0) continue
      const keep = new Set<number>([start]); const st = [start]
      while (st.length > 0) { const x = st.pop()!; for (const y of d.nb.get(x) ?? []) if (!keep.has(y) && this.get_w(d, y, this.bone) > 0.001) { keep.add(y); st.push(y) } }
      for (const r of d.members.keys()) if (!keep.has(r) && this.get_w(d, r, this.bone) > 0) this.set_w(d, r, this.bone, 0)
    }
    this.dirty()
  }

  private pick_bone (e: PointerEvent): void {
    const h = this.hit(e); if (h === null) return
    const { d, p, faceIndex } = h
    const t = [d.tri[faceIndex * 3], d.tri[faceIndex * 3 + 1], d.tri[faceIndex * 3 + 2]]
    let best = t[0]; let bd = Infinity
    for (const i of t) { const r = d.rep[i]; const dd = (d.world[r * 3] - p.x) ** 2 + (d.world[r * 3 + 1] - p.y) ** 2 + (d.world[r * 3 + 2] - p.z) ** 2; if (dd < bd) { bd = dd; best = i } }
    let k = 0; for (let j = 1; j < 4; j++) if (d.w.getComponent(best, j) > d.w.getComponent(best, k)) k = j
    this.bone = d.idx.getComponent(best, k)
    this.recolor()
  }

  /* ---------------- input ---------------- */
  private on_canvas (e: Event): boolean { return e.target === this.host.dom }

  private down (e: PointerEvent): void {
    if (!this.active || !this.on_canvas(e) || e.button !== 0 || e.altKey && this.tool !== 'select') return
    this.refresh_world()
    const over = this.hit(e) !== null
    if (this.tool === 'pick' || (e.ctrlKey || e.metaKey) && this.tool !== 'select') {
      const bn = this.bone_near(e)
      if (bn >= 0) { this.bone = bn; this.recolor(); e.stopImmediatePropagation(); e.preventDefault(); return }
      if (over) { this.pick_bone(e); e.stopImmediatePropagation(); e.preventDefault() } return
    }
    if (this.tool === 'select') {
      e.stopImmediatePropagation(); e.preventDefault()
      this.box_start = { x: e.clientX, y: e.clientY }; this.moved = false
      return
    }
    if (!over) return // empty space: let the camera orbit
    e.stopImmediatePropagation(); e.preventDefault()
    this.snapshot(); this.painting = true; this.stroke(e)
  }

  private move (e: PointerEvent): void {
    if (!this.active) return
    const brush = this.tool === 'brush' || this.tool === 'erase' || this.tool === 'smooth'
    if (brush && this.on_canvas(e)) {
      const r = this.radius_px
      Object.assign(this.cursor.style, { display: 'block', left: `${e.clientX - r}px`, top: `${e.clientY - r}px`, width: `${r * 2}px`, height: `${r * 2}px`, borderColor: this.tool === 'erase' ? '#ff6b6b' : this.tool === 'smooth' ? '#7ad7ff' : '#fff' })
    } else this.cursor.style.display = 'none'
    if (this.painting) {
      e.stopImmediatePropagation()
      this.last_ev = e
      if (this.raf === 0) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.last_ev !== null) { this.refresh_world(); this.stroke(this.last_ev) } })
    } else if (this.box_start !== null) {
      e.stopImmediatePropagation()
      const a = this.box_start
      if (Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) > 5) this.moved = true
      if (this.moved) Object.assign(this.boxel.style, { display: 'block', left: `${Math.min(a.x, e.clientX)}px`, top: `${Math.min(a.y, e.clientY)}px`, width: `${Math.abs(e.clientX - a.x)}px`, height: `${Math.abs(e.clientY - a.y)}px` })
    }
  }

  private up (e: PointerEvent): void {
    if (!this.active) return
    if (this.painting) { this.painting = false; this.last_ev = null; e.stopImmediatePropagation(); return }
    if (this.box_start !== null) {
      e.stopImmediatePropagation()
      if (this.moved) this.select_box(this.box_start, e); else this.select_click(e)
      this.box_start = null; this.boxel.style.display = 'none'
    }
  }

  private key (e: KeyboardEvent): void {
    if (!this.active || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
    const k = e.key.toLowerCase()
    let used = true
    const ua = undo_action(e)
    if (ua === 'undo') this.undo_last()
    else if (ua === 'redo') this.redo_last()
    else if (e.ctrlKey || e.metaKey) used = false
    else if (k === '[') this.radius_px = Math.max(4, this.radius_px / 1.2)
    else if (k === ']') this.radius_px = Math.min(400, this.radius_px * 1.2)
    else if (k === 'b') this.tool = 'brush'
    else if (k === 'e') this.tool = 'erase'
    else if (k === 's' && !e.ctrlKey && !e.metaKey) this.tool = 'smooth'
    else if (k === 'q') this.tool = 'select'
    else if (k === 'i') this.tool = 'pick'
    else if (k === 'escape') this.stop()
    else used = false
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); this.refresh_panel() }
  }

  /* ---------------- panel ---------------- */
  private build_panel (): void {
    this.panel?.remove()
    const p = document.createElement('div')
    p.className = 'gb-wp'
    p.style.cssText = 'position:fixed;left:12px;top:96px;width:270px;max-height:calc(100vh - 90px);overflow:auto;z-index:40;background:#14181fef;color:#e8edf3;border:1px solid #2c3440;border-radius:10px;padding:10px;font:12px/1.35 system-ui,sans-serif;box-shadow:0 8px 30px #0008'
    const T = (en: string, vi: string, ko: string): string => M(en, vi, ko)
    const btn = (id: string, label: string, title = ''): string => `<button data-a="${id}" title="${title}" style="flex:1;min-width:0;padding:6px 4px;border-radius:6px;border:1px solid #39424f;background:#1f2630;color:inherit;cursor:pointer;font:inherit">${label}</button>`
    p.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><b style="flex:1">🖌 ${T('Paint skin weights', 'Paint skin weight', '스킨 웨이트 페인트')}</b><button data-a="close" style="background:none;border:0;color:#aaa;font-size:16px;cursor:pointer">✕</button></div>
      <div style="display:flex;gap:4px;margin-bottom:6px">${btn('t-pick', '👆', T('Pick bone (I) — click the skin', 'Chọn xương (I) — bấm lên da', '본 선택 (I)'))}${btn('t-brush', '🖌', T('Brush: add (B)', 'Cọ: thêm (B)', '브러시 (B)'))}${btn('t-erase', '🧽', T('Eraser: remove (E)', 'Gôm: xoá (E)', '지우개 (E)'))}${btn('t-smooth', '〰', T('Smooth (S)', 'Làm mịn (S)', '부드럽게 (S)'))}${btn('t-select', '⬚', T('Select (Q): Shift add, Alt remove, drag = box', 'Chọn (Q): Shift thêm, Alt bớt, kéo = khung', '선택 (Q)'))}</div>
      <div data-sel style="display:flex;gap:4px;margin-bottom:6px">${btn('m-vertex', T('Point', 'Điểm', '점'))}${btn('m-edge', T('Edge', 'Cạnh', '엣지'))}${btn('m-face', T('Face', 'Mặt', '면'))}${btn('m-island', T('Piece', 'Khối', '조각'))}</div>
      <label style="display:flex;gap:6px;align-items:center">${T('Radius', 'Bán kính', '반경')} <input data-k="radius" type="range" min="4" max="300" style="flex:1"></label>
      <label style="display:flex;gap:6px;align-items:center">${T('Strength', 'Lực', '강도')} <input data-k="strength" type="range" min="2" max="100" style="flex:1"></label>
      <div style="display:flex;flex-wrap:wrap;gap:4px 10px;margin:6px 0">
        <label><input data-k="mirror" type="checkbox"> ${T('Mirror L/R', 'Đối xứng T/P', '좌우 대칭')}</label>
        <label><input data-k="front" type="checkbox"> ${T('Front only', 'Chỉ mặt trước', '앞면만')}</label>
        <label><input data-k="mask" type="checkbox"> ${T('Only selected', 'Chỉ vùng chọn', '선택만')}</label>
        <label><input data-k="all" type="checkbox"> ${T('All bones colours', 'Màu mọi xương', '모든 본 색')}</label>
        <label title="${T('Draw the skeleton over the skin; the bone you paint is yellow. With 👆 (or Ctrl + click) click a bone to paint it.', 'Vẽ khung xương lên da; xương đang paint màu vàng. Dùng 👆 (hoặc Ctrl + bấm) bấm vào xương để chọn nó.', '스켈레톤 표시')}"><input data-k="bones" type="checkbox"> ${T('Show bones', 'Hiện xương', '본 표시')}</label>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:6px">${btn('assign', T('Selection = 100%', 'Vùng chọn = 100%', '선택=100%'))}${btn('remove', T('Selection = 0%', 'Vùng chọn = 0%', '선택=0%'))}</div>
      <div style="display:flex;gap:4px;margin-bottom:6px">${btn('grow', T('Grow', 'Nới', '확장'))}${btn('all', T('All', 'Tất cả', '전체'))}${btn('none', T('None', 'Bỏ chọn', '해제'))}${btn('clean', T('Clean strays', 'Dọn vùng lạc', '정리'), T('Remove this bone from patches not connected to its main area (e.g. arm colour on the thigh)', 'Xoá xương này khỏi các mảng không nối với vùng chính (vd. màu tay dính trên đùi)', '분리된 영역 제거'))}</div>
      <div style="border-top:1px solid #2c3440;padding-top:6px;margin-top:4px">
        <div style="display:flex;gap:6px;align-items:center">${T('Test bend', 'Thử gập', '굽힘 테스트')} <input data-k="bend" type="range" min="-120" max="120" value="0" style="flex:1"><span data-v="bend" style="width:34px;text-align:right"></span></div>
        <div style="display:flex;gap:4px;margin-top:4px">${btn('ax-0', 'X')}${btn('ax-1', 'Y')}${btn('ax-2', 'Z')}${btn('bend0', T('Reset', 'Về 0', '리셋'))}</div>
      </div>
      <div style="display:flex;gap:4px;margin:8px 0 6px">${btn('undo', '↶ ' + T('Undo', 'Hoàn tác', '실행 취소'), 'Ctrl+Z / Cmd+Z')}${btn('redo', '↷ ' + T('Redo', 'Làm lại', '다시 실행'), 'Ctrl+Shift+Z / Cmd+Shift+Z')}</div>
      <div style="display:flex;align-items:center;gap:6px;margin:4px 0"><div style="flex:1;height:8px;border-radius:4px;background:linear-gradient(90deg,#8c9199 0 6%,#30124a 6%,#4569f2,#1ac7d4,#59f26b,#d9eb33,#fa8c21,#cc1f0d)"></div><span style="opacity:.7">0 → 100%</span></div>
      <div data-ce style="border-top:1px solid #2c3440;padding-top:6px;margin-top:6px"></div>
      <input data-k="filter" placeholder="${T('Find bone…', 'Tìm xương…', '본 검색…')}" style="width:100%;box-sizing:border-box;padding:5px;border-radius:6px;border:1px solid #39424f;background:#0e1116;color:inherit;margin:4px 0">
      <div data-list style="max-height:240px;overflow:auto;border:1px solid #2c3440;border-radius:6px"></div>
      <p style="opacity:.65;margin:6px 0 0">${T('Tip: pick the arm, erase its colour on the thigh, then pick the leg and erase what is not the leg. Erased weight goes back to the bone that already owned that skin. Esc = exit.', 'Mẹo: chọn cánh tay, gôm màu dính trên đùi; rồi chọn chân, gôm phần không phải chân. Phần bị gôm tự trả về xương vốn sở hữu vùng da đó. Esc = thoát.', '팁: 팔을 선택하고 허벅지의 색을 지운 다음 다리를 선택하세요. Esc = 종료.')}</p>`
    p.addEventListener('click', (ev) => {
      const a = (ev.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a'); if (a == null) return
      if (a === 'close') { this.stop(); document.dispatchEvent(new CustomEvent('gb-weightpaint-closed')); return }
      if (a.startsWith('t-')) this.tool = a.slice(2) as PaintTool
      else if (a.startsWith('m-')) { this.sel_mode = a.slice(2) as SelMode; this.tool = 'select' } else if (a.startsWith('ax-')) this.bend_axis = Number(a.slice(3)) as 0 | 1 | 2
      else if (a === 'bend0') this.bend = 0
      else if (a === 'assign' || a === 'remove') this.apply_selection(a)
      else if (a === 'grow') this.grow()
      else if (a === 'all') this.select_all(true)
      else if (a === 'none') this.select_all(false)
      else if (a === 'clean') this.clean_islands()
      else if (a === 'undo') this.undo_last()
      else if (a === 'redo') this.redo_last()
      this.refresh_panel()
    })
    p.addEventListener('input', (ev) => {
      const el = ev.target as HTMLInputElement; const k = el.dataset.k
      if (k === 'radius') this.radius_px = Number(el.value)
      else if (k === 'strength') this.strength = Number(el.value) / 100
      else if (k === 'bend') this.bend = Number(el.value)
      else if (k === 'mirror') this.mirror = el.checked
      else if (k === 'front') this.front_only = el.checked
      else if (k === 'mask') this.mask_selection = el.checked
      else if (k === 'bones') { this.show_bones = el.checked; this.draw_bones() }
      else if (k === 'all') { this.view = el.checked ? 'all' : 'one'; this.recolor() } else if (k === 'filter') this.fill_list()
      this.refresh_panel(false)
    })
    document.body.append(p)
    this.panel = p
    this.refresh_panel()
  }

  private fill_list (): void {
    const list = this.panel?.querySelector('[data-list]'); if (list == null) return
    const f = (this.panel?.querySelector('[data-k="filter"]') as HTMLInputElement)?.value.toLowerCase() ?? ''
    const hues = this.bones.map((_, i) => new THREE.Color().setHSL((i * 0.618034) % 1, 0.75, 0.55).getHexString())
    list.innerHTML = this.bones.map((b, i) => (f !== '' && !b.name.toLowerCase().includes(f)) ? ''
      : `<div data-b="${i}" style="padding:3px 6px;cursor:pointer;display:flex;gap:6px;align-items:center;${i === this.bone ? 'background:#2f6fde;color:#fff' : ''}"><i style="width:9px;height:9px;border-radius:2px;background:#${hues[i]}"></i>${b.name}</div>`).join('')
    list.querySelectorAll<HTMLElement>('[data-b]').forEach(el => { el.onclick = () => { this.bone = Number(el.dataset.b); this.recolor() } })
    list.querySelector<HTMLElement>(`[data-b="${this.bone}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  private refresh_panel (list = true): void {
    const p = this.panel; if (p === null) return
    p.querySelectorAll<HTMLElement>('[data-a]').forEach(el => {
      const a = el.dataset.a ?? ''
      const on = a === `t-${this.tool}` || (a === `m-${this.sel_mode}` && this.tool === 'select') || a === `ax-${this.bend_axis}`
      el.style.background = on ? '#2f6fde' : '#1f2630'
    })
    const set = (k: string, v: string | boolean): void => { const el = p.querySelector<HTMLInputElement>(`[data-k="${k}"]`); if (el == null || el === document.activeElement) return; if (typeof v === 'boolean') el.checked = v; else el.value = v }
    set('radius', String(Math.round(this.radius_px))); set('strength', String(Math.round(this.strength * 100))); set('bend', String(this.bend))
    set('mirror', this.mirror); set('front', this.front_only); set('mask', this.mask_selection); set('all', this.view === 'all'); set('bones', this.show_bones)
    const bv = p.querySelector('[data-v="bend"]'); if (bv !== null) bv.textContent = `${this.bend}°`
    ;(p.querySelector('[data-sel]') as HTMLElement).style.opacity = this.tool === 'select' ? '1' : '0.6'
    if (list) this.fill_list()
    this.fill_components()
  }

  /* ---------------- component editor (Maya style): exact weights of the selected points ---------------- */
  public readonly held = new Set<number>()
  /** selected points (welded) of every mesh */
  private selected (): Array<{ d: MeshData, di: number, r: number }> {
    const out: Array<{ d: MeshData, di: number, r: number }> = []
    this.data.forEach((d, di) => d.sel.forEach(r => out.push({ d, di, r })))
    return out
  }

  /** bone -> [sum, min, max, count] over the selected points */
  public influences (): Map<number, number[]> {
    const pts = this.selected(); const m = new Map<number, number[]>()
    for (const { d, r } of pts) for (let k = 0; k < 4; k++) {
      const wk = d.w.getComponent(r, k); if (wk <= 1e-4) continue
      const bi = d.idx.getComponent(r, k); const a = m.get(bi) ?? [0, 1, 0, 0]
      a[0] += wk; a[1] = Math.min(a[1], wk); a[2] = Math.max(a[2], wk); a[3]++; m.set(bi, a)
    }
    // a bone missing on some points has min 0 there
    m.forEach(a => { if (a[3] < pts.length) a[1] = 0 })
    return m
  }

  /** set bone b to exactly x (0..1) on the selected points (or on one point), held bones untouched */
  public set_exact (b: number, x: number, only?: { d: MeshData, r: number }): void {
    if (b < 0 || b >= this.bones.length) return
    this.snapshot()
    const pts = only !== undefined ? [only] : this.selected()
    for (const { d, r } of pts) this.set_w(d, r, b, x, this.held)
    this.used_cache = null
    this.dirty()
  }

  /** drop influences below `min` on the selected points and renormalise */
  public prune (min = 0.02): void {
    this.snapshot()
    for (const { d, r } of this.selected()) {
      let sum = 0; for (let k = 0; k < 4; k++) { if (d.w.getComponent(r, k) < min) d.w.setComponent(r, k, 0); sum += d.w.getComponent(r, k) }
      if (sum <= 1e-6) continue
      for (const m of d.members.get(r) ?? [r]) for (let k = 0; k < 4; k++) { d.w.setComponent(m, k, d.w.getComponent(r, k) / sum); d.idx.setComponent(m, k, d.w.getComponent(r, k) > 0 ? d.idx.getComponent(r, k) : 0) }
    }
    this.dirty()
  }

  private fill_components (): void {
    const box = this.panel?.querySelector<HTMLElement>('[data-ce]'); if (box == null) return
    if (box.contains(document.activeElement)) return // don't rebuild under the cursor while typing
    const T = (en: string, vi: string, ko: string): string => M(en, vi, ko)
    const pts = this.selected()
    if (pts.length === 0) {
      box.innerHTML = `<b>📋 ${T('Point weights', 'Thông số từng điểm', '점 웨이트')}</b><div style="opacity:.65;margin-top:3px">${T('Select points (⬚ + Point, Q) to see which bones move them and type exact values, like Maya\'s Component Editor.', 'Chọn điểm (⬚ + Điểm, phím Q) để xem điểm đó bị những xương nào kéo và gõ số chính xác cho từng xương, giống Component Editor của Maya.', '점을 선택하면 영향을 주는 본과 정확한 값을 편집할 수 있습니다.')}</div>`
      return
    }
    const inf = [...this.influences().entries()].sort((a, b) => b[1][2] - a[1][2])
    const name = (i: number): string => this.bones[i]?.name ?? '#' + i
    const hue = (i: number): string => '#' + new THREE.Color().setHSL((i * 0.618034) % 1, 0.75, 0.55).getHexString()
    const pc = (v: number): string => (v * 100).toFixed(1)
    const cell = 'width:52px;padding:2px;border-radius:4px;border:1px solid #39424f;background:#0e1116;color:inherit;font:inherit;text-align:right'
    let html = `<div style="display:flex;align-items:center;gap:6px"><b style="flex:1">📋 ${T('Point weights', 'Thông số từng điểm', '점 웨이트')}</b><span style="opacity:.7">${pts.length} ${T('pts', 'điểm', '점')}</span></div>`
    html += `<div style="opacity:.65;margin:2px 0 4px">${T('Bones that move the selection. Type a % and press Enter: the other bones share the rest. 🔒 = hold (keeps its value).', 'Các xương đang kéo vùng chọn. Gõ % rồi Enter: phần còn lại chia cho các xương khác. 🔒 = giữ nguyên (Hold).', '선택을 움직이는 본. %를 입력하고 Enter. 🔒 = 고정.')}</div>`
    html += '<table style="width:100%;border-collapse:collapse">'
    html += `<tr style="opacity:.7"><td>${T('Bone', 'Xương', '본')}</td><td style="text-align:right">${pts.length > 1 ? T('min–max', 'thấp–cao', '최소–최대') : ''}</td><td style="text-align:right">%</td><td></td></tr>`
    for (const [bi, a] of inf) {
      const avg = a[0] / pts.length; const same = a[2] - a[1] < 0.0005
      html += `<tr${bi === this.bone ? ' style="background:#2f6fde33"' : ''}><td style="padding:2px 0;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" data-cb="${bi}" title="${name(bi)}"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${hue(bi)};margin-right:4px"></i>${name(bi)}</td>`
      html += `<td style="text-align:right;opacity:.7;font-size:11px">${pts.length > 1 ? (same ? '=' : pc(a[1]) + '–' + pc(a[2])) : ''}</td>`
      html += `<td style="text-align:right"><input data-ce-b="${bi}" type="number" min="0" max="100" step="1" value="${same ? pc(a[2]) : ''}" placeholder="${pc(avg)}" style="${cell}"></td>`
      html += `<td><button data-ce-h="${bi}" title="Hold" style="background:none;border:0;cursor:pointer;opacity:${this.held.has(bi) ? 1 : 0.35}">🔒</button></td></tr>`
    }
    html += '</table>'
    // per-point grid (rows = points, columns = bones), like Maya
    if (pts.length > 1 && pts.length <= 24) {
      const cols = inf.slice(0, 5).map(e => e[0])
      html += `<details style="margin-top:4px"><summary style="cursor:pointer;opacity:.85">${T('Per point', 'Từng điểm', '점별')} (${pts.length})</summary><div style="overflow:auto"><table style="border-collapse:collapse;font-size:11px"><tr><td></td>${cols.map(c => `<td style="max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px" title="${name(c)}">${name(c)}</td>`).join('')}</tr>`
      pts.forEach((p, i) => {
        html += `<tr><td style="opacity:.6;padding-right:3px">v${p.r}</td>${cols.map(c => `<td><input data-cp="${i}" data-cb2="${c}" type="number" min="0" max="100" step="1" value="${pc(this.get_w(p.d, p.r, c))}" style="${cell};width:44px"></td>`).join('')}</tr>`
      })
      html += '</table></div></details>'
    }
    const opts = this.bones.map((b, i) => inf.some(e => e[0] === i) ? '' : `<option value="${i}">${b.name}</option>`).join('')
    html += `<div style="display:flex;gap:4px;margin-top:6px"><select data-ce-add style="flex:1;min-width:0;background:#0e1116;color:inherit;border:1px solid #39424f;border-radius:6px"><option value="">＋ ${T('add a bone…', 'thêm xương…', '본 추가…')}</option>${opts}</select><input data-ce-addv type="number" min="0" max="100" value="50" style="${cell}"></div>`
    html += `<div style="display:flex;gap:4px;margin-top:4px"><button data-ce-prune style="flex:1;padding:4px;border-radius:6px;border:1px solid #39424f;background:#1f2630;color:inherit;cursor:pointer">${T('Prune < 2%', 'Bỏ ảnh hưởng < 2%', '2% 미만 제거')}</button></div>`
    box.innerHTML = html
    const commit = (el: HTMLInputElement, f: (v: number) => void): void => {
      const go = (): void => { if (el.value === '') return; f(Math.min(100, Math.max(0, Number(el.value))) / 100); el.blur(); this.fill_components() }
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go() } e.stopPropagation() })
      el.addEventListener('change', go)
    }
    box.querySelectorAll<HTMLInputElement>('[data-ce-b]').forEach(el => commit(el, v => this.set_exact(Number(el.dataset.ceB), v)))
    box.querySelectorAll<HTMLInputElement>('[data-cp]').forEach(el => commit(el, v => { const p = pts[Number(el.dataset.cp)]; this.set_exact(Number(el.dataset.cb2), v, p) }))
    box.querySelectorAll<HTMLElement>('[data-ce-h]').forEach(el => { el.onclick = () => { const b = Number(el.dataset.ceH); if (this.held.has(b)) this.held.delete(b); else this.held.add(b); this.fill_components() } })
    box.querySelectorAll<HTMLElement>('[data-cb]').forEach(el => { el.onclick = () => { this.bone = Number(el.dataset.cb); this.recolor() } })
    const add = box.querySelector<HTMLSelectElement>('[data-ce-add]'); const addv = box.querySelector<HTMLInputElement>('[data-ce-addv]')
    if (add != null && addv != null) add.onchange = () => { if (add.value === '') return; this.set_exact(Number(add.value), Math.min(100, Math.max(0, Number(addv.value))) / 100); add.blur(); this.fill_components() }
    box.querySelector<HTMLElement>('[data-ce-prune]')!.onclick = () => this.prune(0.02)
  }
}
