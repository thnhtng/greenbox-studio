import { mount_tpose } from './TPose.ts'
import { mount_auto_face } from './AutoFace.ts'
import { mount_rig_keys } from './RigKeys.ts'
import { mount_clone_rig } from './CloneRigWizard'
import { TWIST } from './Twist'
import { CUSTOM_RIG } from './CustomRig'
/*
 * EasyRig (Greenbox): beginner-friendly skeleton placement for the Edit Skeleton step.
 *  - Auto-fit: the freshly loaded skeleton is stretched into the imported model's bounding box,
 *    using the rig's reference model as the "this is where joints sit" template.
 *  - Box select: left-drag on empty space draws a rectangle, joints inside light up (orange).
 *  - Group drag: drag any lit joint and the whole selection moves together. When the cursor is over
 *    the model, the grabbed joint lands in the middle of the mesh (depth-correct), like Mesh volume mode.
 *  - Quick select buttons (arm / leg / body / head / all).
 *  - Camera: right-drag rotates, middle-drag or Shift+right-drag pans, wheel zooms
 *    (left button is reserved for selecting while this step is open).
 */
import { M } from '../common/lang'
import { mount_view_buttons } from '../common/ViewButtons'
import { PoseControls, LIMBS, type Limb } from './PoseControls'
import { ExportFormat } from '../../lib/processes/export-to-file/DownloadSettings.ts'
import { BONES_OFF, can_turn_off, human_preset, type SpineCount, type FingerMode } from './BoneReduce'
import { find_fingers, palm_fit, fingers_ok, hand_reach, FINGER_WEIGHTS, type FingerName } from './FingerFinder'
import { WEIGHT_POST } from '../skin/WeightPost'
import { CAGE_REGIONS, region_bones, region_diameter, build_region_preview, dispose_group } from '../skin/CageRegions'
import * as THREE from 'three'
import { type Bone, type Skeleton } from 'three'
import { type Mesh2MotionEngine } from '../../Mesh2MotionEngine.ts'
import { Utility } from '../../lib/Utilities.ts'
import { SkeletonType } from '../../lib/enums/SkeletonType.ts'
import { scan_humanoid, type BodyLandmarks } from './BodyScan.ts'
import { rigify_metarig_script, download_text } from '../export/RigifyMetarig.ts'
import { send_to_playtest, send_character } from '../common/SendCharacter.ts'
import { WeightPaint } from '../skin/WeightPaint.ts'
import { analyze, draw_analysis, model_geometries, type Analysis, type Branch, type AnchorKind } from './ModelAnalyzer.ts'
import { sample_points, CAGE, build_capsules, estimate_radii, apply_settings, type Capsule } from '../skin/CageWeights.ts'

type Mode = 'idle' | 'marquee' | 'drag' | 'keygrab'
type Keymap = 'greenbox' | 'blender'

const GROUPS: Array<{ id: string, label: string, re: RegExp }> = [
  { id: 'arm', label: 'Arm + hand', re: /(clavicle|shoulder|upper_?arm|arm|elbow|fore_?arm|hand|wrist|finger|thumb|index|middle|ring|pinky|wing)/i },
  { id: 'leg', label: 'Leg + foot', re: /(thigh|up_?leg|leg|calf|shin|knee|foot|toe|ball|ankle|paw)/i },
  { id: 'body', label: 'Body', re: /(pelvis|hips|spine|chest|torso|belly|tail)/i },
  { id: 'head', label: 'Head', re: /(neck|head|jaw|eye|ear|mouth|beak)/i }
]

const FINGER_RE = /(thumb|index|middle|ring|pinky|little|finger)/i

const PARTS: Array<[RegExp, [string, string, string]]> = [
  [/thumb/i, ['Thumb', 'Ngón cái', '엄지']], [/index/i, ['Index finger', 'Ngón trỏ', '검지']],
  [/middle/i, ['Middle finger', 'Ngón giữa', '중지']], [/ring/i, ['Ring finger', 'Ngón áp út', '약지']],
  [/pinky|little/i, ['Pinky', 'Ngón út', '새끼손가락']],
  [/clavicle|shoulder/i, ['Shoulder', 'Vai', '어깨']], [/upper_?arm/i, ['Upper arm', 'Cánh tay', '위팔']],
  [/lower_?arm|fore_?arm|elbow/i, ['Elbow', 'Khuỷu tay', '팔꿈치']], [/hand|wrist/i, ['Hand', 'Bàn tay', '손']],
  [/thigh|up_?leg/i, ['Thigh', 'Đùi', '허벅지']], [/calf|shin|knee/i, ['Knee', 'Đầu gối', '무릎']],
  [/ball|toe/i, ['Toes', 'Ngón chân', '발가락']], [/foot|ankle/i, ['Ankle', 'Cổ chân', '발목']],
  [/pelvis|hips/i, ['Hips', 'Hông', '골반']], [/spine|chest/i, ['Spine', 'Cột sống', '척추']],
  [/neck/i, ['Neck', 'Cổ', '목']], [/head/i, ['Head', 'Đầu', '머리']], [/jaw/i, ['Jaw', 'Hàm', '턱']],
  [/tail/i, ['Tail', 'Đuôi', '꼬리']], [/wing/i, ['Wing', 'Cánh', '날개']], [/ear/i, ['Ear', 'Tai', '귀']],
  [/leg/i, ['Leg', 'Chân', '다리']], [/arm/i, ['Arm', 'Tay', '팔']], [/root/i, ['Root', 'Gốc', '루트']]
]

function ui_lang (): 'en' | 'vi' | 'ko' {
  const l = (document.documentElement.lang || 'en').slice(0, 2)
  return l === 'vi' || l === 'ko' ? l : 'en'
}

/** "upperarm_l" -> "Cánh tay (trái)" / "Left upper arm" / "왼쪽 위팔" */
export function friendly_bone_name (raw: string): string {
  const lang = ui_lang(); const i = lang === 'vi' ? 1 : lang === 'ko' ? 2 : 0
  const n = raw.toLowerCase()
  const part = PARTS.find(([re]) => re.test(n))
  const left = /(^l_|_l$|\.l$|left|_l_|-l$)/.test(n); const right = /(^r_|_r$|\.r$|right|_r_|-r$)/.test(n)
  const seg = (n.match(/(\d+)/) ?? [])[1]
  const num = seg !== undefined ? ' ' + String(parseInt(seg, 10)) : ''
  const tip = /(leaf|_end|tip|top)/.test(n)
  const base = (part !== undefined ? part[1][i] : raw) + (tip ? [' tip', ' (đỉnh)', ' 끝'][i] : '')
  if (lang === 'vi') return base + num + (left ? ' (trái)' : right ? ' (phải)' : '')
  if (lang === 'ko') return (left ? '왼쪽 ' : right ? '오른쪽 ' : '') + base + num
  return (left ? 'Left ' : right ? 'Right ' : '') + (left || right ? base.toLowerCase() : base) + num
}

export class EasyRig {
  private mode: Mode = 'idle'
  private active = false
  private readonly selected = new Set<Bone>()
  private marquee_el: HTMLDivElement | null = null
  private panel_el: HTMLElement | null = null
  private start_x = 0
  private start_y = 0
  private additive = false
  private highlight: THREE.Points | null = null
  private raf = 0
  private saved_buttons: any = null
  // Blender-style controls
  private keymap: Keymap = ((): Keymap => { try { return localStorage.getItem('gb3d.keymap') === 'blender' ? 'blender' : 'greenbox' } catch { return 'greenbox' } })()
  private last_mouse: { clientX: number, clientY: number } | null = null
  private kg_hit = new THREE.Vector3()
  private kg_axis: 'x' | 'y' | 'z' | null = null
  // drag state
  private grabbed: Bone | null = null
  private grab_start = new THREE.Vector3()
  private start_world = new Map<Bone, THREE.Vector3>()
  private moving = new Set<Bone>()
  private drag_plane = new THREE.Plane()
  // labels + hover
  private hovered: Bone | null = null
  private label_layer: HTMLDivElement | null = null
  private show_all_labels = false
  // fingers
  private finger_lock = false
  private finger_template = new Map<Bone, { hand: Bone, d0: THREE.Vector3, offset: THREE.Vector3 }>()
  private finger_spread = 1
  private finger_length = 1
  private finger_size = 1
  // the skeleton exactly as loaded (before any fitting) so "auto-fit" can be pressed again without compounding
  private pristine_for: Skeleton | null = null
  private pristine = new Map<Bone, THREE.Vector3>()
  // anatomical cage (only lives while rigging)
  private cage_group = new THREE.Group()
  private cage_visible = false
  private cage_listen = false
  private cage_timer = 0
  // skin-region preview (model painted by owning bone)
  private show_regions = false
  private region_group = new THREE.Group()
  private region_timer = 0
  private hidden_for_regions: THREE.Object3D | null = null

  private pose: PoseControls | null = null
  constructor (private readonly engine: Mesh2MotionEngine) {
    CUSTOM_RIG.final_bones = () => this.engine.weight_skin_step.skeleton()?.bones ?? []
    TWIST.skeleton = () => this.engine.weight_skin_step.skeleton() ?? null
    mount_clone_rig(this.engine) // 🧬 the guided "rig file -> my model" panel
    mount_rig_keys(this.engine) // Ctrl/Cmd+Z: joints, the applied rig, model turns
    mount_auto_face(this.engine) // 🧭 the model turns to the blue forward arrow by itself
    mount_tpose() // 🧍 T-pose button beside Expand / Contract Arms
  }

  /* ---------------- lifecycle ---------------- */
  public on_enter (): void {
    this.active = true
    this.mount_views()
    this.build_panel()
    this.simplify_panel()
    this.remap_orbit(true)
    this.swap_mouse_hints(true)
    this.ensure_highlight()
    this.frame_model()
    this.capture_finger_template(false)
    if (!this.cage_listen) {
      document.addEventListener('keyup', (ev) => this.handle_key_up(ev))
      window.addEventListener('blur', () => { const c = this.orbit(); if (this.keymap === 'blender' && c != null && this.active) c.mouseButtons.LEFT = null })
      this.cage_listen = true
      this.engine.edit_skeleton_step.addEventListener('skeletonTransformed', () => { if (this.active) this.schedule_cage() })
    }
    this.cage_group.name = 'Greenbox cage'
    if (this.cage_group.parent === null) this.engine.scene.add(this.cage_group)
    this.schedule_cage()
    const loop = (): void => { this.update_highlight(); this.update_labels(); if (this.active) this.raf = requestAnimationFrame(loop) }
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(loop)
  }

  public on_exit (): void {
    if (!this.active) return
    this.active = false
    this.mode = 'idle'
    this.selected.clear()
    cancelAnimationFrame(this.raf)
    this.remap_orbit(false)
    this.swap_mouse_hints(false)
    if (this.highlight !== null) { this.engine.scene.remove(this.highlight); this.highlight.geometry.dispose(); this.highlight = null }
    if (this.marquee_el !== null) this.marquee_el.style.display = 'none'
    if (this.label_layer !== null) this.label_layer.innerHTML = ''
    this.engine.scene.remove(this.cage_group)
    clearTimeout(this.region_timer); this.draw_regions() // inactive -> removes the preview, shows the model again
    this.hovered = null
  }

  /** point the camera at the imported model so small or offset models are easy to work on */
  public frame_model (objects?: THREE.Object3D[]): void {
    const c = this.orbit()
    if (c === undefined || c === null) return
    const list = objects ?? [this.engine.load_model_step.model_meshes()]
    const box = new THREE.Box3()
    if (objects !== undefined && this.last_model_box !== null) box.copy(this.last_model_box) // skinned meshes report odd boxes
    else list.forEach(o => { o.updateMatrixWorld(true); box.expandByObject(o) })
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z) * 0.5
    const cam = this.engine.camera
    const fov = THREE.MathUtils.degToRad(cam.fov)
    const dist = radius / Math.sin(Math.min(fov, fov * cam.aspect) / 2) * 1.15
    const dir = cam.position.clone().sub(c.target)
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1)
    dir.normalize()
    c.minDistance = Math.min(c.minDistance, dist * 0.1)
    c.target.copy(center)
    cam.position.copy(center).add(dir.multiplyScalar(dist))
    // the tool panel covers the right side of the canvas: slide the view so the model sits in the visible part
    const panel = document.getElementById('tool-panel')
    const canvas = this.engine.renderer.domElement
    if (panel !== null && canvas.clientWidth > 0) {
      const covered = Math.max(0, canvas.getBoundingClientRect().right - panel.getBoundingClientRect().left)
      if (covered > 0 && covered < canvas.clientWidth * 0.6) {
        const world_per_px = 2 * dist * Math.tan(fov / 2) / Math.max(1, canvas.clientHeight)
        const right = new THREE.Vector3().subVectors(cam.position, c.target).cross(new THREE.Vector3(0, 1, 0)).normalize().negate()
        const shift = right.multiplyScalar(covered / 2 * world_per_px)
        c.target.add(shift); cam.position.add(shift)
      }
    }
    cam.near = Math.min(cam.near, Math.max(0.001, dist / 1000)); cam.updateProjectionMatrix()
    c.update()
  }

  private saved_hints: string | null = null
  private swap_mouse_hints (edit: boolean): void {
    const h = document.getElementById('header-ui')
    if (h === null) return
    if (edit) {
      if (this.saved_hints === null) this.saved_hints = h.innerHTML
      const row = (icon: string, text: string): string => `<div><img class="nav-icon" src="images/${icon}" style="vertical-align: middle" /> ${text}</div>`
      h.innerHTML = this.keymap === 'blender'
        ? row('mouse-left.svg', 'Box select / drag joints · G move · X/Y/Z lock') + row('mouse-middle.svg', 'Orbit · Shift: pan · Alt + left: orbit') + row('mouse-right.svg', 'Cancel move · 1/3/7 views · F frame')
        : row('mouse-left.svg', 'Box select / drag joints') + row('mouse-right.svg', 'Rotate view') + row('mouse-middle.svg', 'Pan · wheel: zoom')
    } else if (this.saved_hints !== null) {
      h.innerHTML = this.saved_hints
      this.saved_hints = null
    }
  }

  private orbit (): any { return (this.engine as any).scene_environment?.orbit_controls?.() }

  private remap_orbit (edit: boolean): void {
    const c = this.orbit()
    if (c === undefined || c === null) return
    if (edit) {
      if (this.saved_buttons === null) this.saved_buttons = { ...c.mouseButtons }
      c.mouseButtons = this.keymap === 'blender'
        ? { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null } // Blender: MMB orbit, Shift+MMB pan, Alt+LMB orbit
        : { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    } else if (this.saved_buttons !== null) {
      c.mouseButtons = this.saved_buttons
      this.saved_buttons = null
    }
  }

  private skeleton (): Skeleton { return this.engine.edit_skeleton_step.skeleton() }

  /**
   * The joint under the mouse, measured in SCREEN pixels so it works the same for tiny and huge models.
   * Joints that are locked (fingers while "lock fingers" is on) are skipped, so the hand under them is picked.
   */
  private pick_joint (e: PointerEvent): Bone | null {
    const skel = this.skeleton(); if (skel === undefined) return null
    const r = this.engine.renderer.domElement.getBoundingClientRect()
    const mx = e.clientX - r.left; const my = e.clientY - r.top
    const R = 14 * 14
    let best: Bone | null = null; let bd = R
    // a finger joint clicked right on is picked even while the fingers are locked to the hand
    let finger: Bone | null = null; let fd = 8 * 8
    for (const b of skel.bones) {
      const lockedFinger = this.finger_lock && FINGER_RE.test(b.name)
      if (!lockedFinger && !this.selectable(b)) continue
      const p = Utility.world_position_from_object(b).project(this.engine.camera)
      if (p.z > 1 || p.z < -1) continue
      const dx = (p.x + 1) / 2 * r.width - mx; const dy = (1 - p.y) / 2 * r.height - my
      const d = dx * dx + dy * dy
      if (lockedFinger) { if (d < fd) { fd = d; finger = b } continue }
      if (d < bd) { bd = d; best = b }
    }
    if (finger !== null && (best === null || fd < bd * 0.6)) return finger
    return best
  }

  private selectable (b: Bone): boolean {
    if (b.name === 'root') return false
    if (this.finger_lock && FINGER_RE.test(b.name)) return false
    return this.engine.edit_skeleton_step.is_bone_selectable(b)
  }

  /* ---------------- auto fit ---------------- */
  /** Stretch the skeleton into the model's bounding box. Returns false when there is nothing to fit to. */
  public fit_to_model (): boolean {
    if (CUSTOM_RIG.active) return true // a rig from a file is already fitted onto the model (its own body box)
    const skel = this.skeleton()
    if (skel === undefined || skel.bones.length === 0) return false
    const model = this.engine.load_model_step.model_meshes()
    model.updateMatrixWorld(true)
    const mb = new THREE.Box3().setFromObject(model)
    if (mb.isEmpty()) return false
    this.last_model_box = mb.clone()

    this.engine.edit_skeleton_step.store_bone_state_for_undo()
    // start from the loaded template every time (pressing the button twice must give the same result)
    if (this.pristine_for !== skel) {
      this.pristine_for = skel
      this.pristine.clear()
      skel.bones.forEach(b => this.pristine.set(b, b.position.clone()))
    } else {
      this.pristine.forEach((p, b) => b.position.copy(p))
      skel.bones.forEach(b => b.updateMatrixWorld(true))
    }

    // humanoid rigs: read the model's real shape and place every joint from it
    if (this.scan_fit(model)) {
      this.capture_finger_template(true)
      this.fit_fingers_to_hand()
      this.detect_fingers()
      this.auto_weight_fixes()
      this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
      return true
    }

    // where the joints are expected to sit: the rig's reference model box at the current skeleton scale
    let rb: THREE.Box3 | null = this.engine.load_skeleton_step.reference_box_scaled()
    if (rb === null || rb.isEmpty()) {
      // fallback: the joints' own box, padded a little
      rb = new THREE.Box3()
      skel.bones.forEach(b => rb!.expandByPoint(Utility.world_position_from_object(b)))
      if (rb.isEmpty()) return false
    }
    const ms = mb.getSize(new THREE.Vector3())
    const rs = rb.getSize(new THREE.Vector3())
    const f = new THREE.Vector3(
      rs.x > 1e-6 ? ms.x / rs.x : 1,
      rs.y > 1e-6 ? ms.y / rs.y : 1,
      rs.z > 1e-6 ? ms.z / rs.z : 1)
    const mc = mb.getCenter(new THREE.Vector3())
    const rc = rb.getCenter(new THREE.Vector3())

    const targets = new Map<Bone, THREE.Vector3>()
    skel.bones.forEach(b => {
      const w = Utility.world_position_from_object(b)
      targets.set(b, new THREE.Vector3(mc.x + (w.x - rc.x) * f.x, mc.y + (w.y - rc.y) * f.y, mc.z + (w.z - rc.z) * f.z))
    })
    this.apply_world_targets(targets)
    this.capture_finger_template(true)
    this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
    return true
  }

  public last_scan_note = ''
  public last_arm_drop = 0
  private last_model_box: THREE.Box3 | null = null
  private last_neck_y = 0
  private last_head_share = 0

  /** humanoid only: landmarks from the mesh -> named joints; everything else follows its nearest placed parent */
  private scan_fit (model: THREE.Object3D): boolean {
    const skel = this.skeleton()
    // Mixamo / Unity style names (LeftArm, LeftUpLeg, Spine1… as in the XP Hero rig) read as the Greenbox ones
    const has_plain_spine = skel.bones.some(b => /^(mixamorig:?)?spine$/i.test(b.name))
    const canon = (raw: string): string => {
      let n = raw.toLowerCase().replace(/^mixamorig:?/, '')
      const side = n.startsWith('left') ? 'l' : n.startsWith('right') ? 'r' : ''
      if (side !== '') {
        const rest = n.replace(/^(left|right)/, '')
        const M2: Record<string, string> = { shoulder: 'clavicle', arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', upleg: 'thigh', leg: 'calf', foot: 'foot', toebase: 'ball', toe_end: 'ball_leaf' }
        if (M2[rest] !== undefined) return `${M2[rest]}_${side}`
      }
      if (n === 'hips') return 'pelvis'
      if (has_plain_spine) { if (n === 'spine') return 'spine_01'; if (n === 'spine1') return 'spine_02'; if (n === 'spine2') return 'spine_03' }
      if (n === 'neck') return 'neck_01'
      if (n === 'headtop_end') return 'head_leaf'
      return n
    }
    const names = skel.bones.map(b => canon(b.name))
    if (!names.some(n => n.includes('upperarm')) || !names.some(n => n.includes('thigh'))) return false
    let L: BodyLandmarks | null = null
    try { L = scan_humanoid(model) } catch (e) { console.warn('body scan failed', e) }
    if (L === null) return false
    this.last_scan_note = L.debug
    this.last_arm_drop = L.arm_drop
    this.last_neck_y = L.neck_y
    this.last_head_share = L.head_share
    const W = new Map<Bone, THREE.Vector3>()
    skel.bones.forEach(b => W.set(b, Utility.world_position_from_object(b)))
    const byName = (re: RegExp): Bone | undefined => skel.bones.find(b => re.test(canon(b.name)))
    const ua = byName(/upperarm_l$/); const pel = byName(/^pelvis$|hips/)
    const l_is_plus = ua !== undefined && pel !== undefined ? W.get(ua)!.x >= W.get(pel)!.x : true
    const sideOf = (suffix: 'l' | 'r') => (suffix === 'l') === l_is_plus ? L!.left : L!.right
    const T = new Map<Bone, THREE.Vector3>()
    const put = (re: RegExp, v: THREE.Vector3): void => { const b = byName(re); if (b !== undefined) T.set(b, v.clone()) }
    put(/^pelvis$|^hips$/, L.pelvis); put(/^spine_?0?1$/, L.spine1); put(/^spine_?0?2$/, L.spine2); put(/^spine_?0?3$/, L.spine3)
    put(/^neck(_0?1)?$/, L.neck); put(/^head$/, L.head); put(/^head_(leaf|end|top)$/, L.head_top)
    for (const sfx of ['l', 'r'] as const) {
      const S = sideOf(sfx)
      put(new RegExp(`^clavicle_${sfx}$`), S.clavicle); put(new RegExp(`^upperarm_${sfx}$`), S.shoulder)
      put(new RegExp(`^lowerarm_${sfx}$`), S.elbow); put(new RegExp(`^hand_${sfx}$`), S.wrist)
      put(new RegExp(`^thigh_${sfx}$`), S.thigh); put(new RegExp(`^calf_${sfx}$`), S.knee)
      put(new RegExp(`^foot_${sfx}$`), S.ankle); put(new RegExp(`^ball_${sfx}$`), S.ball); put(new RegExp(`^ball_leaf_${sfx}$`), S.toe)
    }
    if (T.size < 10) return false
    // unplaced bones (fingers, extra leafs): keep their offset from the nearest placed ancestor,
    // turned and stretched like that ancestor's own segment
    const targets = new Map<Bone, THREE.Vector3>(T)
    skel.bones.forEach(b => {
      if (T.has(b)) return
      let a: THREE.Object3D | null = b.parent
      while (a !== null && !(a instanceof THREE.Bone && T.has(a))) a = a.parent
      if (a === null) { targets.set(b, W.get(b)!.clone()); return }
      const A = a as Bone
      const ap = A.parent instanceof THREE.Bone && W.has(A.parent) ? A.parent : null
      let q = new THREE.Quaternion(); let k = 1
      if (ap !== null) {
        const d0 = W.get(A)!.clone().sub(W.get(ap)!); const p1 = targets.get(ap) ?? W.get(ap)!
        const d1 = T.get(A)!.clone().sub(p1)
        if (d0.length() > 1e-6 && d1.length() > 1e-6) {
          q = new THREE.Quaternion().setFromUnitVectors(d0.clone().normalize(), d1.clone().normalize())
          k = Math.min(5, Math.max(0.2, d1.length() / d0.length()))
        }
      }
      const off = W.get(b)!.clone().sub(W.get(A)!).applyQuaternion(q).multiplyScalar(k)
      targets.set(b, T.get(A)!.clone().add(off))
    })
    this.apply_world_targets(targets)
    return true
  }

  /**
   * A-pose: arm bones run along the ribs, so the arms steal chest/hip vertices (torn texture when arms lift)
   *   -> switch on the arm-plane divider at the shoulders.
   * Big heads (chibi): the arms reach into the head volume -> head divider at the neck.
   */
  private auto_weight_fixes (): void {
    const set_check = (id: string, on: boolean): void => {
      const cb = document.getElementById(id) as HTMLInputElement | null
      if (cb === null || cb.checked === on) return
      cb.checked = on; cb.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const notes: string[] = []
    const apose = this.last_arm_drop > 0.26 // more than ~15 degrees below horizontal
    // the anatomy cage already keeps arm and chest skin apart; the old dividers are only for the classic solver
    set_check('arm-plane-checkbox', apose && !CAGE.enabled)
    if (apose && CAGE.enabled) notes.push(`A-pose detected (arms ~${Math.round(this.last_arm_drop * 180 / Math.PI)}° down): the anatomy cage keeps arm and chest skin apart`)
    if (apose && !CAGE.enabled) notes.push(`A-pose detected (arms ~${Math.round(this.last_arm_drop * 180 / Math.PI)}° down): torso/arm weight divider ON`)
    const bighead = this.last_head_share > 0.28 && !CAGE.enabled
    set_check('preview-plane-checkbox', bighead)
    if (bighead) {
      const h = document.getElementById('preview-plane-height-input') as HTMLInputElement | null
      if (h !== null) {
        if (Number(h.min) > this.last_neck_y) h.min = String(Math.max(0, this.last_neck_y * 0.5))
        if (Number(h.max) < this.last_neck_y) h.max = String(this.last_neck_y * 2)
        h.step = '0.001'
        h.value = String(this.last_neck_y)
        h.dispatchEvent(new Event('input', { bubbles: true }))
      }
      notes.push('Big head detected: head weight divider placed at the neck')
    }
    const el = document.getElementById('easy-rig-auto-notes')
    if (el !== null) { el.style.display = notes.length > 0 ? 'block' : 'none'; el.innerHTML = notes.map(n => `• ${n}`).join('<br>') }
  }

  /** Set bone world positions top-down (parents first) so children land where asked. */
  private apply_world_targets (targets: Map<Bone, THREE.Vector3>): void {
    const skel = this.skeleton()
    const roots = skel.bones.filter(b => !(b.parent instanceof THREE.Bone) || !skel.bones.includes(b.parent as Bone))
    const visit = (b: THREE.Object3D): void => {
      if (b instanceof THREE.Bone && targets.has(b) && b.parent !== null) {
        b.parent.updateMatrixWorld(true)
        const local = b.parent.worldToLocal(targets.get(b)!.clone())
        b.position.copy(local)
        b.updateMatrixWorld(true)
      }
      b.children.forEach(visit)
    }
    roots.forEach(visit)
  }

  /* ---------------- pointer handling (called from EventListeners) ---------------- */
  public handle_down (e: PointerEvent): boolean {
    if (!this.active) return false
    if (this.mode === 'keygrab') { // G move: left = confirm, right = cancel (like Blender)
      if (e.button === 2) this.cancel_key_grab(); else this.confirm_key_grab()
      e.preventDefault(); return true
    }
    if (e.button !== 0) return false
    if (this.keymap === 'blender' && e.altKey) return true // Alt + left drag = orbit (OrbitControls handles it)
    const skel = this.skeleton()
    if (skel === undefined) return false
    const bone = this.pick_joint(e)
    const near = bone !== null

    if (near && this.selected.has(bone)) { // grab the selection
      this.start_group_drag(bone, e)
      return true
    }
    if (near) { // click a joint: it becomes the selection (Shift adds) and can be dragged right away
      if (!e.shiftKey) this.selected.clear()
      this.selected.add(bone)
      this.update_status()
      this.start_group_drag(bone, e)
      return true
    }
    // empty space: start a box selection
    this.mode = 'marquee'
    this.additive = e.shiftKey
    this.start_x = e.clientX; this.start_y = e.clientY
    this.show_marquee(e.clientX, e.clientY, e.clientX, e.clientY)
    try { this.engine.renderer.domElement.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    e.preventDefault()
    return true
  }

  public handle_move (e: PointerEvent): boolean {
    if (!this.active) return false
    if (this.mode === 'marquee') {
      this.show_marquee(this.start_x, this.start_y, e.clientX, e.clientY)
      e.preventDefault(); return true
    }
    this.last_mouse = { clientX: e.clientX, clientY: e.clientY }
    if (this.mode === 'drag') { this.move_group(e); e.preventDefault(); return true }
    if (this.mode === 'keygrab') { this.move_key_grab(e); e.preventDefault(); return true }
    // idle: remember the joint under the cursor so its name can be shown
    const skel = this.skeleton()
    if (skel !== undefined) {
      this.hovered = this.pick_joint(e)
      // the hand cursor now means exactly "a click here grabs this joint" (same test as the click itself)
      this.engine.renderer.domElement.style.cursor = this.hovered !== null ? 'grab' : ''
    }
    return true
  }

  public handle_up (e: PointerEvent): boolean {
    if (!this.active) return false
    if (this.mode === 'marquee') {
      this.mode = 'idle'
      if (this.marquee_el !== null) this.marquee_el.style.display = 'none'
      const x0 = Math.min(this.start_x, e.clientX); const x1 = Math.max(this.start_x, e.clientX)
      const y0 = Math.min(this.start_y, e.clientY); const y1 = Math.max(this.start_y, e.clientY)
      if (!this.additive) this.selected.clear()
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        const r = this.engine.renderer.domElement.getBoundingClientRect()
        this.skeleton().bones.forEach(b => {
          if (!this.selectable(b)) return
          const p = Utility.world_position_from_object(b).project(this.engine.camera)
          if (p.z > 1) return
          const sx = r.left + (p.x + 1) / 2 * r.width; const sy = r.top + (1 - p.y) / 2 * r.height
          if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) this.selected.add(b)
        })
      }
      this.update_status()
      return true
    }
    if (this.mode === 'drag') {
      this.mode = 'idle'
      this.orbit_enabled(true)
      this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
      return true
    }
    return false
  }

  public handle_key (e: KeyboardEvent): void {
    if (!this.active) return
    this.alt_orbit(e)
    const t = e.target as HTMLElement | null
    if (t !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
    const k = e.key.toLowerCase()
    if (this.mode === 'keygrab') {
      if ((k === 'x' || k === 'y' || k === 'z') && !e.ctrlKey && !e.metaKey) { this.kg_axis = this.kg_axis === k ? null : k; if (this.last_mouse !== null) this.move_key_grab(this.last_mouse); this.update_status() }
      else if (e.key === 'Enter') this.confirm_key_grab()
      else if (e.key === 'Escape') this.cancel_key_grab()
      e.preventDefault(); return
    }
    if (e.key === 'Escape') { this.selected.clear(); this.update_status(); return }
    if (k === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.quick_select('all'); return }
    if (e.ctrlKey || e.metaKey) return // leave Ctrl+Z etc. to the app
    if (k === 'a') { e.preventDefault(); this.quick_select(e.altKey ? 'none' : 'all'); return }
    if (k === 'g') { e.preventDefault(); this.start_key_grab(); return }
    if (k === 'f' || e.code === 'NumpadDecimal') { e.preventDefault(); this.frame_selection(); return }
    const view = ({ Digit1: 'front', Numpad1: 'front', Digit3: 'right', Numpad3: 'right', Digit7: 'top', Numpad7: 'top' } as Record<string, string>)[e.code]
    if (view !== undefined) { e.preventDefault(); this.view_axis(view, e.altKey || e.shiftKey) }
  }

  public handle_key_up (e: KeyboardEvent): void {
    if (this.keymap !== 'blender') return
    const c = this.orbit(); if (c === undefined || c === null || !this.active) return
    if (e.key === 'Alt') c.mouseButtons.LEFT = null
  }

  private alt_orbit (e: KeyboardEvent): void {
    if (this.keymap !== 'blender' || !this.active || e.key !== 'Alt') return
    const c = this.orbit(); if (c !== undefined && c !== null) c.mouseButtons.LEFT = THREE.MOUSE.ROTATE
  }

  /* ---------------- Blender-style G move ---------------- */
  private compute_moving (): void {
    const skel = this.skeleton()
    const independent = this.engine.edit_skeleton_step.independent_bone_movement.is_enabled()
    this.moving.clear()
    const has_selected_ancestor = (b: THREE.Object3D): boolean => {
      let p = b.parent
      while (p !== null) { if (p instanceof THREE.Bone && this.selected.has(p)) return true; p = p.parent }
      return false
    }
    skel.bones.forEach(b => { if (this.selected.has(b) || (!independent && has_selected_ancestor(b))) this.moving.add(b) })
    if (this.finger_lock) {
      skel.bones.forEach(b => {
        if (!FINGER_RE.test(b.name)) return
        const t = this.finger_template.get(b)
        if (t !== undefined && this.moving.has(t.hand)) this.moving.add(b)
      })
    }
  }

  private ray_from (e: { clientX: number, clientY: number }): THREE.Ray {
    const r = this.engine.renderer.domElement.getBoundingClientRect()
    const rc = new THREE.Raycaster()
    rc.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.engine.camera)
    return rc.ray
  }

  private start_key_grab (): void {
    if (this.selected.size === 0 || this.last_mouse === null) return
    const skel = this.skeleton()
    this.engine.edit_skeleton_step.store_bone_state_for_undo()
    this.start_world.clear()
    skel.bones.forEach(b => this.start_world.set(b, Utility.world_position_from_object(b)))
    const c = new THREE.Vector3(); this.selected.forEach(b => c.add(this.start_world.get(b)!)); c.multiplyScalar(1 / this.selected.size)
    this.drag_plane.setFromNormalAndCoplanarPoint(this.engine.camera.getWorldDirection(new THREE.Vector3()), c)
    const hit = this.ray_from(this.last_mouse).intersectPlane(this.drag_plane, new THREE.Vector3())
    if (hit === null) return
    this.kg_hit.copy(hit); this.kg_axis = null
    this.compute_moving()
    this.mode = 'keygrab'
    this.orbit_enabled(false)
    this.update_status()
  }

  private move_key_grab (e: { clientX: number, clientY: number }): void {
    const hit = this.ray_from(e).intersectPlane(this.drag_plane, new THREE.Vector3()); if (hit === null) return
    const d = hit.sub(this.kg_hit)
    if (this.kg_axis !== null) { const keep = d[this.kg_axis]; d.set(0, 0, 0); d[this.kg_axis] = keep }
    const targets = new Map<Bone, THREE.Vector3>()
    this.skeleton().bones.forEach(b => { const s0 = this.start_world.get(b)!; targets.set(b, this.moving.has(b) ? s0.clone().add(d) : s0.clone()) })
    this.apply_world_targets(targets)
    if (this.engine.edit_skeleton_step.is_mirror_mode_enabled()) {
      const done = new Set<Bone>()
      this.moving.forEach(b => {
        const m = this.engine.edit_skeleton_step.find_mirror_bone(b)
        if (m !== undefined && !done.has(m) && !this.moving.has(m)) { this.engine.edit_skeleton_step.apply_mirror_mode(b, 'translate'); done.add(m) }
      })
    }
  }

  private confirm_key_grab (): void {
    this.mode = 'idle'; this.kg_axis = null; this.orbit_enabled(true)
    this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
    this.update_status()
  }

  private cancel_key_grab (): void {
    const targets = new Map<Bone, THREE.Vector3>()
    this.start_world.forEach((v, b) => targets.set(b, v.clone()))
    this.apply_world_targets(targets)
    this.confirm_key_grab()
  }

  /** Front / Side / Top / 3D buttons over the viewport (stay for the whole page) */
  public mount_views (): void {
    // the canvas lives in <body> under the top nav bar: pin the buttons just below it
    // Explore has its skeleton list in the top-left corner: sit to the right of it there
    const left = /create\.html$/.test(location.pathname) ? 12 : 110
    mount_view_buttons(document.body, { camera: () => this.engine.camera, controls: () => this.orbit() ?? null, model: () => this.model_objects(), extra: [{ label: '🔎 Anchors', title: 'Analyze the model: head, arms, legs and accessories (tail, wings, ears, cape…)', toggle: (on) => this.show_anchors(on) }] }, `position:fixed;left:${left}px;top:52px`)
  }

  /** what is on screen as "the model" right now: skinned meshes after skinning, the loaded meshes before */
  public model_objects (): THREE.Object3D[] {
    try { const a = this.engine.animations_listing_step.active_skinned_meshes(); if (a.length > 0) return a } catch { /* not there yet */ }
    try { const s = this.engine.weight_skin_step.final_skinned_meshes(); if (s.length > 0) return s } catch { /* not there yet */ }
    const out: THREE.Object3D[] = []
    this.engine.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh === true && m.geometry?.getAttribute('position')?.count > 64 && !/grid|floor|ground|helper|joint/i.test(m.name) && (m.material as THREE.Material)?.type !== 'ShadowMaterial') out.push(m) })
    return out
  }

  private anchors_view: THREE.Group | null = null
  public last_analysis: ReturnType<typeof analyze> | null = null
  public show_anchors (on: boolean): void {
    if (this.anchors_view !== null) { this.engine.scene.remove(this.anchors_view); this.anchors_view = null }
    document.getElementById('gb-anchor-card')?.remove()
    const mixer = (() => { try { return this.engine.animations_listing_step.mixer() } catch { return null } })()
    if (!on) { this.anchor_geos = null; if (mixer !== null && this.anchor_paused) { mixer.timeScale = 1; this.anchor_paused = false } return }
    // a still pose while the anchors are on screen (they are measured on this pose)
    if (mixer !== null && mixer.timeScale !== 0) { mixer.timeScale = 0; this.anchor_paused = true }
    const objs = this.model_objects(); if (objs.length === 0) return
    const geos = model_geometries(objs)
    const a = analyze(geos); this.last_analysis = a; this.anchor_geos = geos; this.anchor_focus = -1
    const snapped = this.snap_anchors_to_skeleton(a, geos, objs)
    this.redraw_anchors()
    this.bind_anchor_drag()
    const card = document.createElement('div'); card.id = 'gb-anchor-card'
    card.style.cssText = 'position:fixed;left:12px;bottom:56px;z-index:30;max-width:340px;background:var(--gbp-panel,#14181fee);color:var(--gbp-ink,#e8edf3);border:1px solid var(--gbp-line,#2c3440);border-radius:10px;padding:8px 10px;font:12px/1.45 system-ui,sans-serif'
    const T: Record<string, string> = { humanoid: M('person', 'người', '사람'), quadruped: M('4-legged animal', 'thú 4 chân', '네발 동물'), vehicle: M('vehicle', 'xe', '차량'), object: M('object / creature', 'vật thể / sinh vật', '오브젝트') }
    const extra = a.branches.filter(b => ['tail', 'wing', 'ear', 'horn', 'hair', 'cape', 'item'].includes(b.kind))
    card.innerHTML = `<b>🔎 ${M('Analysis', 'Phân tích', '분석')}: ${T[a.type]}</b><br>${a.branches.map(b => b.name).join(' · ')}` +
      (extra.length > 0 ? `<br><span style="color:#ffd34d">${M('Accessories found', 'Phụ kiện tìm thấy', '액세서리')}: ${extra.map(b => b.name).join(', ')}</span><br><span style="opacity:.75">${M('The human skeleton rigs the body; to give accessories their own bones, open the model in the Vehicles / any model tab → 🔎 Analyze.', 'Khung người gắn cho thân; muốn phụ kiện có xương riêng, mở model ở tab Xe cộ / model bất kỳ → 🔎 Phân tích.', '액세서리 본은 차량/모든 모델 탭에서 분석하세요.')}</span>` : '') +
      (a.type === 'vehicle' ? `<br><span style="color:#7ad7ff">${M('This looks like a vehicle: use the Vehicles tab.', 'Đây giống xe: dùng tab Xe cộ.', '차량 탭을 사용하세요.')}</span>` : '')
    card.innerHTML += `<br><span style="opacity:.8">${snapped > 0 ? M(`Head, arms, legs follow the ${snapped} joints of the human skeleton. `, `Đầu, tay, chân bám theo ${snapped} khớp của bộ xương người. `, '사람 스켈레톤에 맞춤. ') : ''}${M('Drag a dot to move it (on the joints step it moves the bone too). Click a dot: only the skin of that branch stays bright.', 'Kéo một điểm để chỉnh (ở bước sửa khớp thì xương đi theo). Bấm một điểm: chỉ vùng da của nhánh đó sáng lên.', '점을 드래그해 이동, 클릭하면 그 부위 피부 강조.')}</span>`
    document.body.append(card)
  }

  private anchor_geos: THREE.BufferGeometry[] | null = null
  private anchor_paused = false
  private anchor_focus = -1
  private anchor_drag_bound = false

  private redraw_anchors (): void {
    if (this.last_analysis === null) return
    if (this.anchors_view !== null) this.engine.scene.remove(this.anchors_view)
    this.anchors_view = draw_analysis(this.last_analysis, this.anchor_geos ?? undefined, this.anchor_focus); this.engine.scene.add(this.anchors_view)
  }

  /** the human skeleton to compare with: the posed one after skinning, the edited one before */
  private anchor_bones (): Map<string, Bone> | null {
    let bones: Bone[] = []
    try { const a = this.engine.animations_listing_step.active_skinned_meshes(); if (a.length > 0) bones = a[0].skeleton.bones } catch { /* not skinned yet */ }
    if (bones.length === 0 && this.engine.process_step === 'edit-skeleton') bones = this.skeleton().bones
    if (!bones.some(b => /^upperarm_l$/i.test(b.name))) return null
    return new Map(bones.map(b => [b.name.toLowerCase(), b]))
  }

  /**
   * A person with a human skeleton: the body anchors ARE the skeleton — head (neck → head top), both arms
   * (clavicle → finger tip), both legs (thigh → toes), always all five, at the joints' current place. The skin of
   * each one is the skin its bones really move (the strongest bone of each point); before skinning, the points
   * nearest to the chain. The mesh analysis only adds accessories (tail, wings, ears, cape, held item…) that are
   * not one of those limbs. Returns how many joints were used.
   */
  private snap_anchors_to_skeleton (a: Analysis, geos: THREE.BufferGeometry[], objs: THREE.Object3D[]): number {
    const by = this.anchor_bones(); if (by === null) return 0
    const W = (n: string): THREE.Vector3 | null => { const b = by.get(n); return b === undefined ? null : Utility.world_position_from_object(b) }
    const CH: Array<[string, AnchorKind, string[]]> = [
      ['head', 'head', ['neck_01', 'head', 'head_leaf']],
      ['arm_L', 'arm', ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'middle_04_leaf_l']], ['arm_R', 'arm', ['clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'middle_04_leaf_r']],
      ['leg_L', 'leg', ['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'ball_leaf_l']], ['leg_R', 'leg', ['thigh_r', 'calf_r', 'foot_r', 'ball_r', 'ball_leaf_r']]
    ]
    const pel = W('pelvis'); if (pel !== null) a.core.copy(pel)
    const body: Branch[] = []; const chain_of = new Map<string, number>(); let n = 0
    for (const [name, kind, list] of CH) {
      const names = list.filter(x => by.has(x)); if (names.length === 0) continue
      const pts = names.map(x => W(x)!)
      const br: Branch = { name, kind, side: name.endsWith('_L') ? 1 : name.endsWith('_R') ? -1 : 0, tip: pts[pts.length - 1].clone(), joints: pts, nodes: 0, length: 0 }; (br as any).bones = names
      body.push(br); n += pts.length
      // every bone below the chain's first joint belongs to it (fingers to the arm, toes to the leg)
      const root = by.get(names[0])!; root.traverse(o => { if ((o as THREE.Bone).isBone === true) chain_of.set(o.name.toLowerCase(), body.length - 1) })
    }
    // accessories the mesh analysis found, unless they are really a limb
    const lim = a.size.length() * 0.09
    const acc = a.branches.map((b, i) => ({ b, i })).filter(({ b }) => ['tail', 'wing', 'ear', 'horn', 'hair', 'cape', 'item'].includes(b.kind) && body.every(c => c.joints.every(j => j.distanceTo(b.tip) > lim)))
    const remap = new Map(acc.map(({ i }, k) => [i, body.length + k]))
    a.branches = [...body, ...acc.map(({ b }) => b)]
    // skin of each branch
    const meshes: THREE.Mesh[] = []
    for (const r of objs) r.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true && m.userData.__gb_wire !== true && m.geometry?.getAttribute('position') !== undefined) meshes.push(m) })
    a.labels = geos.map((geo, gi) => {
      const old = a.labels[gi]; const m = meshes[gi] as THREE.SkinnedMesh | undefined; const pa = geo.getAttribute('position'); const out = new Int32Array(pa.count).fill(-1)
      const si = m?.geometry.getAttribute('skinIndex'); const sw = m?.geometry.getAttribute('skinWeight')
      const p = new THREE.Vector3(); const line = new THREE.Line3(); const q = new THREE.Vector3()
      for (let v = 0; v < pa.count; v++) {
        const o = old?.[v] ?? -1; if (remap.has(o)) { out[v] = remap.get(o)!; continue }
        if (m?.isSkinnedMesh === true && si !== undefined && sw !== undefined) {
          let k = 0; for (let j = 1; j < 4; j++) if (sw.getComponent(v, j) > sw.getComponent(v, k)) k = j
          const bn = m.skeleton.bones[si.getComponent(v, k)]?.name.toLowerCase(); out[v] = bn !== undefined ? (chain_of.get(bn) ?? -1) : -1
        } else {
          p.fromBufferAttribute(pa, v); let best = -1; let bd = lim * lim * 4
          body.forEach((c, ci) => { for (let j = 0; j + 1 < c.joints.length; j++) { line.set(c.joints[j], c.joints[j + 1]); line.closestPointToPoint(p, true, q); const d = q.distanceToSquared(p); if (d < bd) { bd = d; best = ci } } })
          out[v] = best
        }
      }
      return out
    })
    return n
  }

  /** drag the anchor dots; a click (no drag) shows only that branch's skin */
  private bind_anchor_drag (): void {
    if (this.anchor_drag_bound) return
    this.anchor_drag_bound = true
    const dom = this.engine.renderer.domElement; const ray = new THREE.Raycaster(); const plane = new THREE.Plane()
    let drag: { bi: number, ji: number, moved: boolean, x: number, y: number } | null = null; let raf = 0
    const ndc = (e: PointerEvent): THREE.Vector2 => { const r = dom.getBoundingClientRect(); return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1) }
    dom.addEventListener('pointerdown', (e) => {
      if (this.anchors_view === null || this.last_analysis === null || e.button !== 0) return
      ray.setFromCamera(ndc(e), this.engine.camera)
      const hit = ray.intersectObjects(this.anchors_view.children.filter(o => o.userData.branch !== undefined), false)[0]
      if (hit === undefined) return
      e.stopImmediatePropagation(); e.preventDefault()
      const ud = hit.object.userData
      plane.setFromNormalAndCoplanarPoint(this.engine.camera.getWorldDirection(new THREE.Vector3()), hit.object.position)
      drag = { bi: ud.branch, ji: ud.joint, moved: false, x: e.clientX, y: e.clientY }
      dom.setPointerCapture(e.pointerId)
    }, true)
    dom.addEventListener('pointermove', (e) => {
      if (drag === null || this.last_analysis === null) return
      e.stopImmediatePropagation()
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true
      if (!drag.moved) return
      ray.setFromCamera(ndc(e), this.engine.camera); const p = ray.ray.intersectPlane(plane, new THREE.Vector3()); if (p === null) return
      const b = this.last_analysis.branches[drag.bi]; b.joints[drag.ji].copy(p); if (drag.ji === b.joints.length - 1) b.tip.copy(p)
      // on the joints step the anchor IS the bone: move it
      const bn = (b as any).bones?.[drag.ji] as string | undefined
      if (bn !== undefined && this.engine.process_step === 'edit-skeleton') {
        const bone = this.skeleton().bones.find(x => x.name.toLowerCase() === bn)
        if (bone !== undefined) { this.apply_world_targets(new Map([[bone, p.clone()]])); this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed')) }
      }
      if (raf === 0) raf = requestAnimationFrame(() => { raf = 0; this.redraw_anchors() })
    }, true)
    addEventListener('pointerup', () => {
      if (drag === null) return
      if (!drag.moved) { this.anchor_focus = this.anchor_focus === drag.bi ? -1 : drag.bi; this.redraw_anchors() }
      else if ((this.last_analysis?.branches[drag.bi] as any)?.bones !== undefined && this.engine.process_step === 'edit-skeleton') this.engine.edit_skeleton_step.store_bone_state_for_undo()
      drag = null
    }, true)
  }

  private weight_paint: WeightPaint | null = null
  public paint_weights (on: boolean): boolean {
    if (this.weight_paint === null) {
      this.weight_paint = new WeightPaint({
        camera: () => this.engine.camera,
        dom: this.engine.renderer.domElement,
        scene: this.engine.scene,
        meshes: () => this.engine.animations_listing_step.active_skinned_meshes(),
        pause: (on) => { const m = this.engine.animations_listing_step.mixer(); m.timeScale = on ? 0 : 1 }
      })
    }
    if (!on) { this.weight_paint.stop(); return false }
    return this.weight_paint.start()
  }

  /* ---------------- views (numpad 1 / 3 / 7, Ctrl or Alt = opposite side) ---------------- */
  private view_axis (name: string, opposite: boolean): void {
    const c = this.orbit(); if (c === undefined || c === null) return
    const dir = name === 'front' ? new THREE.Vector3(0, 0, 1) : name === 'right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0.0001)
    if (opposite) dir.negate()
    const dist = this.engine.camera.position.distanceTo(c.target)
    this.engine.camera.position.copy(c.target).add(dir.normalize().multiplyScalar(dist))
    this.engine.camera.lookAt(c.target)
    c.update()
  }

  private frame_selection (): void {
    if (this.selected.size === 0) { this.frame_model(); return }
    const c = this.orbit(); if (c === undefined || c === null) return
    const box = new THREE.Box3(); this.selected.forEach(b => box.expandByPoint(Utility.world_position_from_object(b)))
    const center = box.getCenter(new THREE.Vector3())
    const model = new THREE.Box3().expandByObject(this.engine.load_model_step.model_meshes())
    const r = Math.max(box.getSize(new THREE.Vector3()).length(), model.getSize(new THREE.Vector3()).length() * 0.12)
    const dir = this.engine.camera.position.clone().sub(c.target).normalize()
    c.target.copy(center); this.engine.camera.position.copy(center).add(dir.multiplyScalar(r * 2.2))
    c.update()
  }

  private orbit_enabled (on: boolean): void { this.engine.enable_orbit_controls(on) }

  /* ---------------- group drag ---------------- */
  private start_group_drag (bone: Bone, e: PointerEvent): void {
    this.mode = 'drag'
    this.grabbed = bone
    this.engine.edit_skeleton_step.store_bone_state_for_undo()
    this.orbit_enabled(false)
    const skel = this.skeleton()
    this.start_world.clear()
    skel.bones.forEach(b => this.start_world.set(b, Utility.world_position_from_object(b)))
    this.grab_start.copy(this.start_world.get(bone)!)
    const n = this.engine.camera.getWorldDirection(new THREE.Vector3())
    this.drag_plane.setFromNormalAndCoplanarPoint(n, this.grab_start)

    // which bones move: every selected bone, plus children of selected bones unless "move children" is off
    const independent = this.engine.edit_skeleton_step.independent_bone_movement.is_enabled()
    this.moving.clear()
    const has_selected_ancestor = (b: THREE.Object3D): boolean => {
      let p = b.parent
      while (p !== null) { if (p instanceof THREE.Bone && this.selected.has(p)) return true; p = p.parent }
      return false
    }
    skel.bones.forEach(b => {
      if (this.selected.has(b) || (!independent && has_selected_ancestor(b))) this.moving.add(b)
    })
    if (this.finger_lock) {
      skel.bones.forEach(b => {
        if (!FINGER_RE.test(b.name)) return
        const t = this.finger_template.get(b)
        if (t !== undefined && this.moving.has(t.hand)) this.moving.add(b)
      })
    }
    // mirror mode: the right-hand counterparts follow (mirrored in X)
    try { this.engine.renderer.domElement.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    e.preventDefault()
  }

  private target_for_grab (e: PointerEvent): THREE.Vector3 | null {
    const ray = new THREE.Raycaster()
    ray.setFromCamera(Utility.normalized_mouse_position(e), this.engine.camera)
    // over the model: drop into the middle of the mesh under the cursor
    const model = this.engine.load_model_step.model_meshes()
    const targets: THREE.Object3D[] = []
    if (model.visible) targets.push(model)
    const wp = this.engine.weight_skin_step.weight_painted_mesh_group()
    if (wp !== null && wp.visible) targets.push(wp)
    if (targets.length > 0) {
      const hits = ray.intersectObjects(targets, true)
      if (hits.length > 0) {
        const first = hits[0].point.clone()
        const box = new THREE.Box3(); targets.forEach(t => box.expandByObject(t))
        const far = Math.max(1, box.getSize(new THREE.Vector3()).length() * 2)
        const back = new THREE.Raycaster(first.clone().add(ray.ray.direction.clone().multiplyScalar(far)), ray.ray.direction.clone().negate())
        const bh = back.intersectObjects(targets, true)
        const last = bh.length > 0 ? bh[0].point : first
        return first.add(last).multiplyScalar(0.5)
      }
    }
    return ray.ray.intersectPlane(this.drag_plane, new THREE.Vector3())
  }

  private move_group (e: PointerEvent): void {
    const target = this.target_for_grab(e)
    if (target === null) return
    const delta = target.sub(this.grab_start)
    const targets = new Map<Bone, THREE.Vector3>()
    this.skeleton().bones.forEach(b => {
      const s = this.start_world.get(b)!
      targets.set(b, this.moving.has(b) ? s.clone().add(delta) : s.clone())
    })
    this.apply_world_targets(targets)
    if (this.engine.edit_skeleton_step.is_mirror_mode_enabled()) {
      const done = new Set<Bone>()
      this.moving.forEach(b => {
        const m = this.engine.edit_skeleton_step.find_mirror_bone(b)
        if (m !== undefined && !done.has(m) && !this.moving.has(m)) { this.engine.edit_skeleton_step.apply_mirror_mode(b, 'translate'); done.add(m) }
      })
    }
  }

  /* ---------------- selection helpers ---------------- */
  public quick_select (id: string): void {
    this.selected.clear()
    if (id !== 'none') {
      const g = GROUPS.find(x => x.id === id)
      this.skeleton().bones.forEach(b => {
        if (!this.selectable(b)) return
        if (id === 'all' || (g !== undefined && g.re.test(b.name))) this.selected.add(b)
      })
      // an arm/leg group should not also grab spine bones whose names only look similar
      if (id === 'arm') this.skeleton().bones.forEach(b => { if (/spine|chest|neck/i.test(b.name)) this.selected.delete(b) })
    }
    this.update_status()
  }

  private ensure_highlight (): void {
    if (this.highlight !== null) return
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 256), 3))
    g.setDrawRange(0, 0)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64
    const cx = cv.getContext('2d')!
    cx.fillStyle = '#ff8a1f'; cx.beginPath(); cx.arc(32, 32, 26, 0, Math.PI * 2); cx.fill()
    cx.lineWidth = 6; cx.strokeStyle = '#ffffff'; cx.stroke()
    const m = new THREE.PointsMaterial({ size: 18, sizeAttenuation: false, depthTest: false, transparent: true, map: new THREE.CanvasTexture(cv), alphaTest: 0.1 })
    this.highlight = new THREE.Points(g, m)
    this.highlight.renderOrder = 300
    this.highlight.frustumCulled = false
    this.highlight.name = 'EasyRig selection'
    this.engine.scene.add(this.highlight)
  }

  private update_highlight (): void {
    if (this.highlight === null) return
    const attr = this.highlight.geometry.getAttribute('position') as THREE.BufferAttribute
    let i = 0
    this.selected.forEach(b => {
      if (i >= 256) return
      const p = Utility.world_position_from_object(b)
      attr.setXYZ(i++, p.x, p.y, p.z)
    })
    attr.needsUpdate = true
    this.highlight.geometry.setDrawRange(0, i)
  }

  private show_marquee (x0: number, y0: number, x1: number, y1: number): void {
    if (this.marquee_el === null) {
      this.marquee_el = document.createElement('div')
      this.marquee_el.style.cssText = 'position:fixed;z-index:50;pointer-events:none;border:1.5px dashed var(--gbp-accent,#ffb020);background:rgba(255,160,40,.12);border-radius:3px'
      document.body.appendChild(this.marquee_el)
    }
    const s = this.marquee_el.style
    s.display = 'block'
    s.left = Math.min(x0, x1) + 'px'; s.top = Math.min(y0, y1) + 'px'
    s.width = Math.abs(x1 - x0) + 'px'; s.height = Math.abs(y1 - y0) + 'px'
  }

  /* ---------------- animations step: one-click export of everything ---------------- */
  public show_quick_export (): void {
    try { this.frame_model(this.engine.weight_skin_step.final_skinned_meshes()) } catch { /* keep camera */ }
    // animations are authored for a T-pose; an A-pose rig would play every clip with the arms
    // lowered by the same angle. Raise them back by exactly the scanned angle.
    if (this.last_arm_drop > 0.26) {
      const v = Math.max(-120, Math.min(20, -Math.round(this.last_arm_drop * 100)))
      try { this.engine.animations_listing_step.apply_model_variation_arm_extension(v) } catch { /* ignore */ }
    }
    const host = document.getElementById('animations-listing') ?? document.getElementById('skinned-step-animation-export-options')
    const old_rb = document.getElementById('easy-rigify-box'); if (old_rb !== null) old_rb.style.display = this.is_human() ? 'flex' : 'none'
    if (host === null || document.getElementById('easy-export') !== null) return
    const box = document.createElement('div')
    box.id = 'easy-export'
    box.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px 12px;margin:0 0 10px;border:1px solid #ffb02088;border-radius:10px;background:rgba(255,176,32,.08);flex:none;align-self:stretch;box-sizing:border-box;max-width:420px'
    box.innerHTML = `
      <div style="font-weight:700">Quick export</div>
      <div style="font-size:12px;opacity:.85">Rigged model + every animation in the list, in one file.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" id="easy-export-glb">⬇ All animations · GLB</button>
        <button type="button" class="secondary-button" id="easy-export-fbx">⬇ All animations · FBX</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" id="easy-playtest">🎮 Play test this character</button>
        <button type="button" class="secondary-button" id="easy-mocap">🎥 Video mocap on it</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" id="easy-wpaint">🖌 Paint skin weights (brush / eraser)</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="secondary-button" id="easy-rejoints" title="Go back to the joints to move them; Finish skins again with the new joints">🦴 Move the bones again → re-skin</button>
        <button type="button" class="secondary-button" id="easy-reskin" title="Compute the skin weights again now (after changing the smoothness)">↻ Re-skin now</button>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:12px">Weight smoothness <input type="range" id="easy-smooth" min="0" max="8" step="1" style="flex:1"><span id="easy-smooth-v"></span></label>
      <label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="easy-keep-paint" checked> Keep what I painted by hand when re-skinning</label>
      <div style="font-size:11px;opacity:.8;line-height:1.45">Arm pulls the thigh? Pick the arm, erase its colour on the thigh: that skin goes back to the leg. Test bend shows the result live.</div>
      <div style="font-size:12px;opacity:.75">Only want some? Tick them in the list below, then use Download.</div>
      <div id="easy-pose-box" style="display:flex;flex-direction:column;gap:6px;border-top:1px solid rgba(255,255,255,.15);padding-top:7px">
        <div style="font-weight:700">Pose controls (IK / FK)</div>
        <button type="button" id="easy-pose-on">✋ Pose the character</button>
        <div id="easy-pose-ui" style="display:none;flex-direction:column;gap:5px">
          <div id="easy-pose-rows" style="display:grid;grid-template-columns:1fr auto;gap:4px 8px;align-items:center;font-size:12px"></div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button type="button" class="secondary-button" data-all="IK" style="padding:3px 9px;font-size:12px">All IK</button>
            <button type="button" class="secondary-button" data-all="FK" style="padding:3px 9px;font-size:12px">All FK</button>
            <button type="button" class="secondary-button" id="easy-pose-turn" style="padding:3px 9px;font-size:12px">⟳ IK box: turn</button>
            <button type="button" class="secondary-button" id="easy-pose-reset" style="padding:3px 9px;font-size:12px">↺ T-pose</button>
          </div>
          <div style="font-size:11px;opacity:.8;line-height:1.45">FK: click a ring, drag the coloured circles to turn. IK: drag the box at the hand / foot, the yellow ball sets where the elbow / knee points. Switching keeps the pose. The same IK / FK panel is in Blender (sidebar N › Greenbox).</div>
          <button type="button" class="secondary-button" id="easy-pose-off" style="padding:4px 10px;font-size:12px">▶ Back to the animations</button>
        </div>
      </div>
      <div id="easy-rigify-box" style="display:flex;flex-direction:column;gap:5px;border-top:1px solid rgba(255,255,255,.15);padding-top:7px">
        <div style="font-weight:700">Blender Rigify</div>
        <button type="button" id="easy-rigify-open" style="display:none">🚀 Open in Blender with Rigify (one click)</button>
        <div id="easy-rigify-msg" style="display:none;font-size:12px;line-height:1.45;padding:6px 8px;border-radius:6px;background:rgba(60,220,140,.15)"></div>
        <button type="button" class="secondary-button" id="easy-rigify-kit">🦴 Rigify kit for Blender (GLB + script)</button>
        <div style="font-size:11px;opacity:.8;line-height:1.45">Leave both files in Downloads (or put them in one folder) → Blender → Scripting → Open the .py → Run Script. Your character comes out on a generated Rigify rig (IK / FK controls), with these skin weights.</div>
      </div>
      <div id="easy-export-apose" style="display:none;font-size:12px;line-height:1.5;padding:6px 8px;border-radius:6px;background:rgba(71,114,179,.25)">A-pose model: arm angle compensated automatically. Fine-tune with the arm spread slider below if needed.</div>`
    host.prepend(box)
    ;(box.querySelector('#easy-export-apose') as HTMLElement).style.display = this.last_arm_drop > 0.26 ? 'block' : 'none'
    ;(box.querySelector('#easy-export-glb') as HTMLButtonElement).onclick = () => { this.engine.quick_export_all('glb') }
    ;(box.querySelector('#easy-export-fbx') as HTMLButtonElement).onclick = () => { this.engine.quick_export_all('fbx') }
    ;(box.querySelector('#easy-rigify-box') as HTMLElement).style.display = this.is_human() ? 'flex' : 'none'
    this.wire_pose(box)
    ;(box.querySelector('#easy-rigify-kit') as HTMLButtonElement).onclick = () => { this.download_rigify_kit() }
    // served by Mo-Greenbox on this computer: Greenbox can start Blender itself, no download / Scripting steps
    const op = box.querySelector('#easy-rigify-open') as HTMLButtonElement
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) op.style.display = ''
    op.onclick = async () => { op.disabled = true; try { await this.open_in_blender() } finally { op.disabled = false } }
    const mc = box.querySelector('#easy-mocap') as HTMLButtonElement
    mc.onclick = async () => {
      mc.disabled = true
      try { await send_character(this.engine.animations_listing_step.active_skinned_meshes(), [], 'mocap', 'mocap.html') } catch (e) { console.error(e); alert(String(e)) } finally { mc.disabled = false }
    }
    const keep = box.querySelector('#easy-keep-paint') as HTMLInputElement
    ;(box.querySelector('#easy-rejoints') as HTMLButtonElement).onclick = () => this.back_to_joints(keep.checked)
    ;(box.querySelector('#easy-reskin') as HTMLButtonElement).onclick = () => this.reskin(keep.checked)
    const sm = box.querySelector('#easy-smooth') as HTMLInputElement; const smv = box.querySelector('#easy-smooth-v') as HTMLElement
    sm.value = String(WEIGHT_POST.smooth); smv.textContent = String(WEIGHT_POST.smooth)
    sm.oninput = () => { WEIGHT_POST.smooth = Number(sm.value); smv.textContent = sm.value }
    const wp = box.querySelector('#easy-wpaint') as HTMLButtonElement
    let painting = false
    const wp_label = wp.textContent ?? ''
    const set_wp = (on: boolean): void => {
      painting = on && this.paint_weights(true)
      if (!on) this.paint_weights(false)
      wp.textContent = painting ? M('✓ Done painting', '✓ Xong paint', '✓ 페인트 완료') : wp_label
    }
    wp.onclick = () => set_wp(!painting)
    document.addEventListener('gb-weightpaint-closed', () => { painting = false; wp.textContent = wp_label })
    const pt = box.querySelector('#easy-playtest') as HTMLButtonElement
    pt.onclick = async () => {
      pt.disabled = true; const t = pt.textContent; pt.textContent = '⏳ …'
      try { await send_to_playtest(this.engine.animations_listing_step.active_skinned_meshes(), this.engine.animations_listing_step.animation_clips()) } catch (e) { console.error(e); alert(String(e)) } finally { pt.disabled = false; pt.textContent = t }
    }
  }

  /* ---------------- pose controls (IK / FK) ---------------- */
  private wire_pose (box: HTMLElement): void {
    const LBL: Record<Limb, string> = { 'arm.L': M('Left arm', 'Tay trái', '왼팔'), 'arm.R': M('Right arm', 'Tay phải', '오른팔'), 'leg.L': M('Left leg', 'Chân trái', '왼다리'), 'leg.R': M('Right leg', 'Chân phải', '오른다리') }
    const ui = box.querySelector('#easy-pose-ui') as HTMLElement; const on = box.querySelector('#easy-pose-on') as HTMLButtonElement
    const rows = box.querySelector('#easy-pose-rows') as HTMLElement
    const draw = (): void => {
      const P = this.pose; if (P === null) return
      rows.innerHTML = ''
      LIMBS.forEach(l => {
        const name = document.createElement('span'); name.textContent = LBL[l]
        const seg = document.createElement('span'); seg.style.cssText = 'display:inline-flex;gap:2px'
        ;(['IK', 'FK'] as const).forEach(m => {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = m
          const onm = P.modes[l] === m
          b.style.cssText = `padding:2px 12px;font-size:12px;border-radius:5px;border:1px solid #1f1f1f;cursor:pointer;${onm ? 'background:#3cdc8c;color:#0d1f14;font-weight:700' : 'background:#4a4a4a;color:#ddd'}`
          b.onclick = () => { P.set_mode(l, m); draw() }
          seg.appendChild(b)
        })
        rows.append(name, seg)
      })
    }
    on.onclick = () => {
      if (this.pose === null) { this.pose = new PoseControls(this.engine); this.pose.on_change = () => draw() }
      if (!this.pose.available()) { on.textContent = M('Pose controls need the human skeleton', 'Điều khiển tư thế cần bộ xương người', '사람 스켈레톤이 필요합니다'); return }
      this.pose.enter(); ui.style.display = 'flex'; on.style.display = 'none'; draw()
    }
    ;(box.querySelector('#easy-pose-off') as HTMLButtonElement).onclick = () => { this.pose?.exit(); ui.style.display = 'none'; on.style.display = '' }
    box.querySelectorAll<HTMLButtonElement>('[data-all]').forEach(b => { b.onclick = () => { LIMBS.forEach(l => this.pose?.set_mode(l, b.dataset.all as 'IK' | 'FK')); draw() } })
    const turn = box.querySelector('#easy-pose-turn') as HTMLButtonElement
    let rot = false
    turn.onclick = () => { rot = !rot; this.pose?.set_handle_mode(rot ? 'rotate' : 'translate'); turn.textContent = rot ? M('↔ IK box: move', '↔ Hộp IK: kéo', '↔ IK 박스: 이동') : M('⟳ IK box: turn', '⟳ Hộp IK: xoay', '⟳ IK 박스: 회전') }
    ;(box.querySelector('#easy-pose-reset') as HTMLButtonElement).onclick = () => this.pose?.reset()
    ;(box.querySelector('#easy-pose-box') as HTMLElement).style.display = this.is_human() ? 'flex' : 'none'
  }

  /**
   * Export for Blender: every animation, plus the hand-made pose as clip "Greenbox_Pose" (Blender puts it on the
   * Rigify controls). The skeleton is exported in its rest pose, then the pose is put back.
   */
  private async export_for_blender (name: string, quiet: boolean): Promise<void> {
    const ls = this.engine.animations_listing_step
    const clips = [...ls.animation_clips()]
    if (this.pose !== null && this.pose.touched) clips.push(this.pose.pose_clip())
    const meshes = ls.active_skinned_meshes()
    const saved = new Map<THREE.Bone, [THREE.Vector3, THREE.Quaternion, THREE.Vector3]>()
    meshes.forEach(m => m.skeleton.bones.forEach(b => saved.set(b, [b.position.clone(), b.quaternion.clone(), b.scale.clone()])))
    const hold = ls.pose_hold; ls.pose_hold = true
    meshes.forEach(m => m.skeleton.pose())
    try {
      this.engine.download_settings.set_export_format(ExportFormat.GLB)
      this.engine.file_export_step.set_animation_clips_to_export(clips, clips.map((_c, i) => ({ animation_index: i, mirror_export_mode: 'none' })) as any)
      await this.engine.file_export_step.export(meshes, name, this.engine.download_settings)
    } finally {
      saved.forEach(([p, q, sc], b) => { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc) })
      ls.pose_hold = hold
    }
    void quiet
  }

  private limb_modes (): Record<string, 'IK' | 'FK'> { return this.pose !== null ? { ...this.pose.modes } : {} }

  /** export the rig, hand it to the local Greenbox server, which opens Blender running the Rigify script */
  private async open_in_blender (): Promise<void> {
    const msg = document.getElementById('easy-rigify-msg') as HTMLElement
    const say = (t: string, warn = false): void => { msg.style.display = 'block'; msg.style.background = warn ? 'rgba(245,166,35,.22)' : 'rgba(60,220,140,.15)'; msg.textContent = t }
    const skel = this.skeleton(); if (skel === undefined) return
    const name = 'greenbox-rigify'
    say(M('Exporting…', 'Đang xuất file…', '내보내는 중…'))
    // catch the GLB the exporter would download
    const A = HTMLAnchorElement.prototype; const orig = A.click
    const got = new Promise<Blob>((resolve, reject) => {
      const t = window.setTimeout(() => { A.click = orig; reject(new Error('export timed out')) }, 180000)
      A.click = function (this: HTMLAnchorElement) {
        if (this.download !== '' && this.href.startsWith('blob:')) { A.click = orig; clearTimeout(t); void fetch(this.href).then(async r => await r.blob()).then(resolve, reject); return }
        orig.call(this)
      }
    })
    try {
      void this.export_for_blender(name, true)
      const blob = await got
      const u8 = new Uint8Array(await blob.arrayBuffer()); let bin = ''
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000))
      const script = rigify_metarig_script(skel.bones, 'Greenbox character', { glb: name, off: [...BONES_OFF], modes: this.limb_modes() })
      say(M('Opening Blender…', 'Đang mở Blender…', 'Blender 여는 중…'))
      const r = await fetch('/bridge/blender', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Greenbox-UI': '1' }, body: JSON.stringify({ name, glb_b64: btoa(bin), script }) })
      const j = await r.json()
      if (j.ok !== true) throw new Error(j.error ?? String(r.status))
      if (j.launched === true) say(M(`Blender is starting (10-30 s). It builds the Rigify rig and puts your character on it, already in Pose mode: click a control, press R to turn it, G to move it. Files: ${j.folder}`, `Blender đang mở (10-30 giây). Nó tự dựng rig Rigify và gắn nhân vật, vào sẵn Pose mode: bấm 1 tay điều khiển, nhấn R để xoay, G để kéo. File lưu ở: ${j.folder}`, `Blender 실행 중 (10~30초). Rigify 리그를 만들고 캐릭터를 붙여 포즈 모드로 엽니다: 컨트롤 클릭 후 R 회전, G 이동. 파일: ${j.folder}`))
      else say(M(`Blender was not found on this computer. The kit is saved in ${j.folder}: open the .py there in Blender (Scripting → Open → ▶).`, `Không tìm thấy Blender trên máy. Bộ file đã lưu ở ${j.folder}: mở file .py trong Blender (Scripting → Open → ▶).`, `Blender를 찾지 못했습니다. ${j.folder}에 저장됨: Blender에서 .py 실행 (Scripting → Open → ▶).`), true)
    } catch (e) {
      A.click = orig
      say(M('Could not open Blender: ', 'Không mở được Blender: ', 'Blender를 열 수 없음: ') + String(e) + M(' (start Greenbox with Mo-Greenbox)', ' (hãy mở Greenbox bằng Mo-Greenbox)', ' (Mo-Greenbox로 실행하세요)'), true)
    }
  }

  /** GLB (default bone names) + a Blender script that builds Rigify on it */
  private download_rigify_kit (): void {
    const name = 'greenbox-rigify'
    const skel = this.skeleton(); if (skel === undefined) return
    download_text(rigify_metarig_script(skel.bones, 'Greenbox character', { glb: name, off: [...BONES_OFF], modes: this.limb_modes() }), `${name}.py`)
    void this.export_for_blender(name, false)
  }

  /* ---------------- joint name labels ---------------- */
  private update_labels (): void {
    if (this.label_layer === null) {
      this.label_layer = document.createElement('div')
      this.label_layer.setAttribute('data-no-translate', '1')
      this.label_layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:40;pointer-events:none'
      document.body.appendChild(this.label_layer)
    }
    const skel = this.skeleton()
    if (skel === undefined) return
    const show = new Set<Bone>(this.selected)
    if (this.hovered !== null) show.add(this.hovered)
    if (this.show_all_labels) skel.bones.forEach(b => { if (this.selectable(b)) show.add(b) })
    const r = this.engine.renderer.domElement.getBoundingClientRect()
    const many = show.size > 12
    let html = ''
    show.forEach(b => {
      const p = Utility.world_position_from_object(b).project(this.engine.camera)
      if (p.z > 1) return
      const x = r.left + (p.x + 1) / 2 * r.width; const y = r.top + (1 - p.y) / 2 * r.height
      const hot = b === this.hovered || this.selected.has(b)
      html += `<div style="position:fixed;left:${x + 12}px;top:${y - 10}px;white-space:nowrap;font:600 ${many && !hot ? 10 : 12}px system-ui,sans-serif;` +
        `padding:2px 7px;border-radius:999px;background:${hot ? '#ff8a1f' : 'rgba(10,20,40,.78)'};color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${friendly_bone_name(b.name)}</div>`
    })
    skel.bones.forEach(b => {
      if (!BONES_OFF.has(b.name) || !can_turn_off(b)) return
      const p = Utility.world_position_from_object(b).project(this.engine.camera)
      if (p.z > 1) return
      const x = r.left + (p.x + 1) / 2 * r.width; const y = r.top + (1 - p.y) / 2 * r.height
      html += `<div style="position:fixed;left:${x - 7}px;top:${y - 7}px;width:14px;height:14px;line-height:14px;text-align:center;font:700 11px system-ui;border-radius:50%;background:#e0413a;color:#fff">✕</div>`
    })
    if (this.label_layer.innerHTML !== html) this.label_layer.innerHTML = html
  }

  /* ---------------- bone count (hyper-casual) ---------------- */
  private readonly preset_names = /^(spine_0[23]|neck|clavicle|ball|toe|thumb_|index_|middle_|ring_|pinky_)/i

  private wire_bone_reduce (p: HTMLElement): void {
    const names = this.skeleton().bones.map(b => b.name)
    // a different skeleton than last time: forget the old choices
    if ([...BONES_OFF].some(n => !names.includes(n))) BONES_OFF.clear()
    const human = this.is_human() && names.includes('spine_01')
    ;(p.querySelector('#easy-rig-human-reduce') as HTMLElement).style.display = human ? 'flex' : 'none'
    const sp = p.querySelector('#eb-spine') as HTMLSelectElement
    const fg = p.querySelector('#eb-fingers') as HTMLSelectElement
    const nk = p.querySelector('#eb-neck') as HTMLInputElement
    const sh = p.querySelector('#eb-shoulders') as HTMLInputElement
    const to = p.querySelector('#eb-toes') as HTMLInputElement
    // show the current state
    sp.value = BONES_OFF.has('spine_03') ? '1' : BONES_OFF.has('spine_02') ? '2' : '3'
    nk.checked = !names.some(n => /^neck/i.test(n) && BONES_OFF.has(n))
    sh.checked = !names.some(n => /^clavicle/i.test(n) && BONES_OFF.has(n))
    to.checked = !names.some(n => /^(ball|toe)/i.test(n) && BONES_OFF.has(n))
    fg.value = BONES_OFF.has('thumb_01_l') ? 'none' : BONES_OFF.has('index_01_l') ? 'mitten' : BONES_OFF.has('ring_01_l') ? 'three' : 'all'
    const apply = (): void => {
      names.filter(n => this.preset_names.test(n)).forEach(n => BONES_OFF.delete(n))
      human_preset(names, { spine: Number(sp.value) as SpineCount, neck: nk.checked, shoulders: sh.checked, toes: to.checked, fingers: fg.value as FingerMode })
        .forEach(n => BONES_OFF.add(n))
      this.bones_changed()
    }
    ;[sp, fg].forEach(e => { e.onchange = apply })
    ;[nk, sh, to].forEach(e => { e.onchange = apply })
    const pick = (): Bone[] => {
      const out = new Set<Bone>(this.selected)
      if (this.engine.edit_skeleton_step.is_mirror_mode_enabled()) this.selected.forEach(b => { const m = this.engine.edit_skeleton_step.find_mirror_bone(b); if (m !== undefined) out.add(m) })
      return [...out]
    }
    ;(p.querySelector('#eb-off') as HTMLButtonElement).onclick = () => {
      const bs = pick().filter(can_turn_off)
      if (bs.length === 0) { this.toast_bones('Select joints first (the root / hips always stay)'); return }
      bs.forEach(b => BONES_OFF.add(b.name)); this.bones_changed()
    }
    ;(p.querySelector('#eb-on') as HTMLButtonElement).onclick = () => { pick().forEach(b => BONES_OFF.delete(b.name)); this.bones_changed() }
    ;(p.querySelector('#eb-all-on') as HTMLButtonElement).onclick = () => { BONES_OFF.clear(); this.wire_bone_reduce(p); this.bones_changed() }
    window.setTimeout(() => this.update_bone_count(), 0) // the panel is in the page after this returns
  }

  private toast_bones (msg: string): void {
    const el = document.getElementById('easy-rig-bone-count'); if (el === null) return
    el.textContent = msg; el.style.color = 'var(--gbp-accent,#ffb020)'
    window.setTimeout(() => { el.style.color = ''; this.update_bone_count() }, 2200)
  }

  private bones_changed (): void {
    this.update_bone_count()
    this.refresh_regions()
  }

  private update_bone_count (): void {
    const el = document.getElementById('easy-rig-bone-count'); if (el === null) return
    const bones = this.skeleton()?.bones ?? []
    const off = bones.filter(b => BONES_OFF.has(b.name) && can_turn_off(b)).length
    el.textContent = off === 0 ? `${bones.length} bones` : `${bones.length} → ${bones.length - off} bones (${off} off)`
  }

  /* ---------------- fingers ---------------- */
  private hand_of (b: Bone): Bone | null {
    let p = b.parent
    while (p !== null) { if (p instanceof THREE.Bone && /hand|wrist/i.test(p.name) && !FINGER_RE.test(p.name)) return p; p = p.parent }
    return null
  }

  private hand_dir (hand: Bone): THREE.Vector3 {
    const h = Utility.world_position_from_object(hand)
    // the forearm joint (not a twist helper, which can sit anywhere along the forearm)
    let pb: THREE.Object3D | null = hand.parent
    while (pb instanceof THREE.Bone && (/twist/i.test(pb.name) || Utility.world_position_from_object(pb).distanceTo(h) < 1e-4)) pb = pb.parent
    const par = pb instanceof THREE.Bone ? Utility.world_position_from_object(pb) : h.clone().add(new THREE.Vector3(-Math.sign(h.x || 1), 0, 0))
    const d = h.sub(par); if (d.lengthSq() < 1e-12) d.set(Math.sign(h.x || 1), 0, 0)
    return d.normalize()
  }

  /** remember the template finger layout around each hand (re-captured after auto-fit) */
  private capture_finger_template (force: boolean): void {
    if (!force && this.finger_template.size > 0 && [...this.finger_template.keys()].every(b => this.skeleton().bones.includes(b))) return
    this.finger_template.clear()
    this.skeleton().bones.forEach(b => {
      if (!FINGER_RE.test(b.name)) return
      const hand = this.hand_of(b); if (hand === null) return
      const off = Utility.world_position_from_object(b).sub(Utility.world_position_from_object(hand))
      this.finger_template.set(b, { hand, d0: this.hand_dir(hand), offset: off })
    })
    this.finger_spread = 1; this.finger_length = 1; this.finger_size = 1
    const sl = document.getElementById('easy-rig-finger-size') as HTMLInputElement | null
    if (sl !== null) sl.value = '100'
  }

  private apply_fingers (): void {
    if (this.finger_template.size === 0) return
    this.engine.edit_skeleton_step.store_bone_state_for_undo()
    const targets = new Map<Bone, THREE.Vector3>()
    this.finger_template.forEach((t, b) => {
      const d = this.hand_dir(t.hand)
      const q = new THREE.Quaternion().setFromUnitVectors(t.d0, d)
      const o = t.offset.clone().applyQuaternion(q)
      const along = d.clone().multiplyScalar(o.dot(d))
      const lat = o.clone().sub(along)
      const v = along.multiplyScalar(this.finger_length).add(lat.multiplyScalar(this.finger_spread)).multiplyScalar(this.finger_size)
      targets.set(b, Utility.world_position_from_object(t.hand).add(v))
    })
    this.apply_world_targets(targets)
    this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
  }

  public last_finger_note = ''
  /** read the real fingers from the mesh around each wrist and put the finger joints on them (FingerFinder) */
  public detect_fingers (): string {
    if (this.finger_template.size === 0) this.capture_finger_template(true)
    if (this.finger_template.size === 0) return ''
    const model = this.engine.load_model_step.model_meshes(); model.updateMatrixWorld(true)
    const geos = model_geometries(model)
    const hands = new Set<Bone>(); this.finger_template.forEach(t => hands.add(t.hand))
    const targets = new Map<Bone, THREE.Vector3>(); const notes: string[] = []
    const by = new Map<string, Bone>(); this.skeleton().bones.forEach(b => by.set(b.name.toLowerCase(), b))
    hands.forEach(hand => {
      const side = /_l$|\.l$|left/i.test(hand.name) ? 'l' : 'r'
      const wrist = Utility.world_position_from_object(hand); const dir = this.hand_dir(hand)
      // radius: the fitted template's longest reach, with room for longer fingers
      let reach = 0; this.finger_template.forEach((t, b) => { if (t.hand === hand) reach = Math.max(reach, Utility.world_position_from_object(b).distanceTo(wrist)) })
      if (reach <= 0) return
      const tpl: Partial<Record<FingerName, THREE.Vector3>> = {}
      for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky'] as FingerName[]) { const b = by.get(`${f}_01_${side}`); if (b !== undefined) tpl[f] = Utility.world_position_from_object(b) }
      // the region that holds the whole hand (chibi hands are far bigger than the template's)
      const mb = new THREE.Box3().setFromObject(model); const cap = Math.max(reach * 1.45, (mb.max.y - mb.min.y) * 0.3)
      const RR = hand_reach(geos, wrist, dir, reach * 1.45, cap)
      let scan = find_fingers(geos, wrist, dir, RR, tpl)
      // fingers that do not stick out (fist, mitten, glued, chibi): measure the hand and lay them on it
      const pf = palm_fit(geos, wrist, dir, RR, tpl)
      // fewer than 4 separate fingers found, but the hand clearly shows 4 ridges: trust the measured hand
      const few = scan.fingers.filter(f => f.name !== 'thumb').length < 4 && (pf.ridges ?? 0) >= 4
      if ((few || !fingers_ok(scan, pf.width, wrist, pf.length)) && pf.fingers.length === 5) scan = pf
      notes.push(`${side === 'l' ? 'L' : 'R'}: ${scan.note}`); (this as any).last_finger_debug = { ...(this as any).last_finger_debug, [side]: scan.debug, ['R' + side]: [reach, RR, cap, wrist.toArray(), dir.toArray(), pf.width, pf.length] }
      if (scan.fingers.length < 3) return
      for (const f of scan.fingers) {
        ['01', '02', '03', '04_leaf'].forEach((k, i) => { const b = by.get(`${f.name}_${k}_${side}`); if (b !== undefined) targets.set(b, f.joints[i].clone()) })
      }
      // a 4-finger cartoon hand: the pinky follows the ring finger
      if (!scan.fingers.some(f => f.name === 'pinky')) {
        const ring = scan.fingers.find(f => f.name === 'ring')
        if (ring !== undefined) ['01', '02', '03', '04_leaf'].forEach((k, i) => { const b = by.get(`pinky_${k}_${side}`); if (b !== undefined) targets.set(b, ring.joints[i].clone()) })
      }
    })
    if (targets.size > 0) {
      this.engine.edit_skeleton_step.store_bone_state_for_undo()
      this.apply_world_targets(targets)
      this.capture_finger_template(true)
      this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
    }
    this.last_finger_note = notes.join(' · ')
    const el = document.getElementById('easy-rig-finger-note'); if (el !== null) el.textContent = this.last_finger_note
    return this.last_finger_note
  }

  /** side of a joint from its name: 1 left, -1 right, 0 middle */
  private side_of (b: Bone): number { const n = b.name; return /(_l|\.l|_left)$|^left|left_|^l_/i.test(n) ? 1 : /(_r|\.r|_right)$|^right|right_|^r_/i.test(n) ? -1 : 0 }

  /** the middle plane of the skeleton: where its centre joints are (pelvis, spine, head), else the model's middle */
  private mid_x (): number {
    const mids = this.skeleton().bones.filter(b => this.side_of(b) === 0 && this.engine.edit_skeleton_step.find_mirror_bone(b) === undefined && !/root/i.test(b.name))
    if (mids.length > 0) return mids.reduce((a, b) => a + Utility.world_position_from_object(b).x, 0) / mids.length
    const box = new THREE.Box3().setFromObject(this.engine.load_model_step.model_meshes()); return box.isEmpty() ? 0 : box.getCenter(new THREE.Vector3()).x
  }

  /** l: left joints -> right (mirrored), r: right -> left, c: middle joints onto the middle line */
  public make_symmetric (from: 'l' | 'r' | 'c'): number {
    const c = this.mid_x(); const targets = new Map<Bone, THREE.Vector3>()
    for (const b of this.skeleton().bones) {
      const p = Utility.world_position_from_object(b)
      if (from === 'c') { if (this.side_of(b) === 0 && this.engine.edit_skeleton_step.find_mirror_bone(b) === undefined) targets.set(b, p.setX(c)); continue }
      if (this.side_of(b) !== (from === 'l' ? 1 : -1)) continue
      const m = this.engine.edit_skeleton_step.find_mirror_bone(b); if (m === undefined || m === b) continue
      targets.set(m, new THREE.Vector3(2 * c - p.x, p.y, p.z))
    }
    if (targets.size === 0) return 0
    this.engine.edit_skeleton_step.store_bone_state_for_undo()
    this.apply_world_targets(targets)
    this.capture_finger_template(true)
    this.engine.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
    return targets.size
  }

  /**
   * After skinning: back to the joints, keeping what was painted by hand (by bone name) for the next skin.
   * Pressing "Finish" again computes the weights for the new joints, smooths them, re-skins the fingers and
   * puts the hand-painted points back.
   */
  public back_to_joints (keep_paint: boolean): void {
    const wp = this.weight_paint
    if (wp !== null && wp.has_manual() && keep_paint) WEIGHT_POST.manual = wp.export_manual()
    if (!keep_paint) WEIGHT_POST.manual = null
    if (wp !== null) { wp.stop(); document.dispatchEvent(new CustomEvent('gb-weightpaint-closed')) }
    ;(document.getElementById('action_back_to_edit_skeleton') as HTMLButtonElement | null)?.click()
  }

  /** compute the skin again right away (e.g. after changing the smoothness) */
  public reskin (keep_paint: boolean): void {
    this.back_to_joints(keep_paint)
    setTimeout(() => (document.getElementById('action_bind_pose') as HTMLButtonElement | null)?.click(), 700)
  }

  public finger_preset (id: 'spread' | 'closed' | 'mitten' | 'reset'): void {
    if (id === 'spread') { this.finger_spread = 1.35; this.finger_length = 1 }
    if (id === 'closed') { this.finger_spread = 0.55; this.finger_length = 1 }
    if (id === 'mitten') { this.finger_spread = 0.3; this.finger_length = 0.65 }
    if (id === 'reset') { this.finger_spread = 1; this.finger_length = 1; this.finger_size = 1 }
    this.apply_fingers()
  }

  /** stretch the fingers so the longest one ends just inside the model's hand */
  public fit_fingers_to_hand (): boolean {
    if (this.finger_template.size === 0) return false
    const model = this.engine.load_model_step.model_meshes()
    model.updateMatrixWorld(true)
    const hands = new Set<Bone>(); this.finger_template.forEach(t => hands.add(t.hand))
    const ratios: number[] = []
    hands.forEach(hand => {
      const d = this.hand_dir(hand)
      let reach = 0
      this.finger_template.forEach((t, b) => {
        if (t.hand !== hand) return
        const q = new THREE.Quaternion().setFromUnitVectors(t.d0, d)
        reach = Math.max(reach, t.offset.clone().applyQuaternion(q).dot(d))
      })
      if (reach <= 1e-6) return
      const h = Utility.world_position_from_object(hand)
      const far = h.clone().add(d.clone().multiplyScalar(reach * 4))
      const hits = new THREE.Raycaster(far, d.clone().negate()).intersectObject(model, true)
      const hit = hits.find(x => x.point.clone().sub(h).dot(d) > 0)
      if (hit === undefined) return
      const l = hit.point.clone().sub(h).dot(d)
      ratios.push((l * 0.9) / reach)
    })
    if (ratios.length === 0) return false
    this.finger_length = Math.min(3, Math.max(0.2, ratios.reduce((a, b) => a + b, 0) / ratios.length))
    this.finger_size = 1
    const sl = document.getElementById('easy-rig-finger-size') as HTMLInputElement | null
    if (sl !== null) sl.value = '100'
    this.apply_fingers()
    return true
  }

  /* ---------------- anatomical cage ---------------- */
  private is_human (): boolean { return this.engine.load_skeleton_step.skeleton_type() === SkeletonType.Human }

  private schedule_cage (): void { if (!this.is_human()) { this.cage_group.visible = false; return } clearTimeout(this.cage_timer); this.cage_timer = window.setTimeout(() => this.measure_cage(), 120) }

  /** measure every capsule from the model surface and redraw the translucent cage */
  public measure_cage (): void {
    const skel = this.skeleton(); if (skel === undefined) return
    const caps = build_capsules(skel.bones)
    const model = this.engine.load_model_step.model_meshes()
    model.updateMatrixWorld(true)
    const pts: THREE.Vector3[] = []; const nrs: THREE.Vector3[] = []
    const meshes: THREE.Mesh[] = []
    model.traverse(o => { const m = o as THREE.Mesh; if ((m.isMesh ?? false) && m.geometry !== undefined) meshes.push(m) })
    for (const m of meshes) {
      const [p, n] = sample_points(m.geometry, Math.max(4000, Math.floor(40000 / meshes.length)), m.matrixWorld)
      for (let i = 0; i < p.length; i++) { pts.push(p[i]); nrs.push(n[i]) }
    }
    if (pts.length > 0) estimate_radii(caps, pts, nrs)
    CAGE.radii.clear()
    caps.forEach(c => CAGE.radii.set(c.bone.name, [c.r0, c.r1]))
    this.draw_cage(caps)
  }

  private draw_cage (caps?: Capsule[]): void {
    const skel = this.skeleton(); if (skel === undefined) return
    const list = caps ?? build_capsules(skel.bones)
    apply_settings(list)
    this.cage_group.clear()
    this.cage_group.visible = this.cage_visible && CAGE.enabled && this.is_human()
    const sel = new Set([...this.selected].map(b => b.name))
    for (const c of list) {
      const len = c.a.distanceTo(c.b)
      const hot = sel.has(c.bone.name)
      const mat = new THREE.MeshBasicMaterial({ color: hot ? 0xff9a2e : 0x8fd3ff, transparent: true, opacity: hot ? 0.28 : 0.1, depthWrite: false, side: THREE.DoubleSide })
      const g = new THREE.Group()
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(c.r1, c.r0, len, 18, 1, true), mat)
      tube.position.y = len / 2; g.add(tube)
      const s0 = new THREE.Mesh(new THREE.SphereGeometry(c.r0, 14, 8), mat); g.add(s0)
      const s1 = new THREE.Mesh(new THREE.SphereGeometry(c.r1, 14, 8), mat); s1.position.y = len; g.add(s1)
      g.position.copy(c.a)
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.b.clone().sub(c.a).normalize())
      g.renderOrder = 5
      this.cage_group.add(g)
    }
    this.update_cage_rows()
    this.refresh_regions()
  }

  /** per body part thickness sliders + measured width */
  private update_cage_rows (): void {
    const host = document.getElementById('easy-rig-cage-rows'); if (host === null) return
    const bones = this.skeleton()?.bones ?? []
    const present = CAGE_REGIONS.filter(r => bones.some(b => r.re.test(b.name)))
    if (host.childElementCount !== present.length) {
      host.innerHTML = ''
      present.forEach(r => {
        const row = document.createElement('label')
        row.style.cssText = 'display:grid;grid-template-columns:10px 78px minmax(0,1fr) 62px;gap:6px;align-items:center;font-size:12px'
        row.innerHTML = `<span style="width:10px;height:10px;border-radius:2px;background:#${r.color.toString(16).padStart(6, '0')}"></span><span>${r.label}</span><input type="range" min="40" max="200" value="100" data-region="${r.id}" style="width:100%;min-width:0"><span data-ro="${r.id}" style="font-size:11px;opacity:.8;text-align:right"></span>`
        const inp = row.querySelector('input') as HTMLInputElement
        inp.oninput = () => {
          region_bones(this.skeleton().bones, r.id).forEach(b => CAGE.scale.set(b.name, Number(inp.value) / 100))
          this.draw_cage()
        }
        host.appendChild(row)
      })
    }
    present.forEach(r => {
      const rb = region_bones(bones, r.id)
      const pct = Math.round((CAGE.scale.get(rb[0]?.name ?? '') ?? 1) * 100)
      const inp = host.querySelector(`input[data-region="${r.id}"]`) as HTMLInputElement | null
      if (inp !== null && document.activeElement !== inp) inp.value = String(pct)
      const ro = host.querySelector(`[data-ro="${r.id}"]`)
      const d = region_diameter(bones, r.id)
      if (ro !== null) ro.textContent = `${pct}%${Number.isFinite(d) ? ` · Ø${(d * pct / 100).toPrecision(2)}` : ''}`
    })
  }

  /** repaint the model by owning bone (debounced: weights take a moment on big meshes) */
  private refresh_regions (delay = 250): void {
    clearTimeout(this.region_timer)
    this.region_timer = window.setTimeout(() => this.draw_regions(), delay)
  }

  private draw_regions (): void {
    dispose_group(this.region_group)
    this.region_group.removeFromParent()
    const model = this.engine.load_model_step.model_meshes()
    const on = this.show_regions && this.active && CAGE.enabled && this.is_human()
    if (!on) {
      if (this.hidden_for_regions !== null) { this.hidden_for_regions.visible = true; this.hidden_for_regions = null }
      return
    }
    model.updateMatrixWorld(true)
    const meshes: THREE.Mesh[] = []
    model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true && m.geometry !== undefined) meshes.push(m) })
    const g = build_region_preview(this.skeleton().bones, meshes)
    this.region_group = g
    this.engine.scene.add(g)
    model.visible = false; this.hidden_for_regions = model
  }

  private set_cage_thickness (pct: number): void {
    const skel = this.skeleton(); if (skel === undefined) return
    const targets = this.selected.size > 0 ? [...this.selected] : skel.bones
    const names = new Set<string>()
    targets.forEach(b => {
      names.add(b.name)
      if (this.engine.edit_skeleton_step.is_mirror_mode_enabled()) { const m = this.engine.edit_skeleton_step.find_mirror_bone(b); if (m !== undefined) names.add(m.name) }
    })
    // the capsule that ends at a selected joint is the one the user is looking at too
    targets.forEach(b => { if (b.parent instanceof THREE.Bone) names.add(b.parent.name) })
    names.forEach(n => CAGE.scale.set(n, pct / 100))
    this.draw_cage()
  }

  private update_status (): void {
    const el = document.getElementById('easy-rig-status')
    if (el !== null) {
      el.textContent = this.mode === 'keygrab'
        ? `G: moving ${this.selected.size} joints${this.kg_axis !== null ? ` (${this.kg_axis.toUpperCase()} only)` : ''} · click / Enter = OK · right-click / Esc = cancel`
        : this.selected.size === 0 ? 'No joints selected' : `${this.selected.size} joints selected`
    }
    const th = document.getElementById('easy-rig-cage-size') as HTMLInputElement | null
    if (th !== null) { const first = [...this.selected][0]; th.value = String(Math.round((first !== undefined ? (CAGE.scale.get(first.parent?.name ?? '') ?? CAGE.scale.get(first.name) ?? 1) : 1) * 100)) }
    if (this.active) this.draw_cage()
  }

  /* ---------------- panel ---------------- */
  private build_panel (): void {
    if (this.panel_el !== null) { this.panel_el.remove(); this.panel_el = null }
    const host = this.engine.ui.dom_skeleton_edit_tools
    if (host === null) return
    const names = this.skeleton().bones.map(b => b.name).join(' ')
    const groups = GROUPS.filter(g => g.re.test(names))
    const p = document.createElement('div')
    p.id = 'easy-rig-panel'
    p.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;margin:0 0 10px;border:1px solid #ffb02088;border-radius:10px;background:rgba(255,176,32,.08);width:100%;max-width:100%;box-sizing:border-box'
    p.innerHTML = `
      <div style="font-weight:700;font-size:15px">Easy mode</div>
      <details><summary style="font-size:12px;cursor:pointer;opacity:.85">❓ How to move joints</summary>
      <ol style="margin:4px 0 0;padding-left:18px;font-size:12px;line-height:1.5">
        <li>Left-drag on empty space to box-select joints (they turn orange).</li>
        <li>Drag any orange joint to move the whole group onto the model.</li>
        <li>Right-drag: rotate view · Wheel: zoom · Middle-drag or Shift + right-drag: pan · Esc: deselect.</li>
        <li>Finger joints: click one (or box-select) and drag it, like any joint.</li>
      </ol></details>
      <button id="easy-rig-fit" type="button">🔍 Scan model &amp; place joints</button>
      <div style="font-size:12px;opacity:.8">Quick select</div>
      <div id="easy-rig-quick" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <div id="easy-rig-auto-notes" style="display:none;font-size:12px;line-height:1.5;padding:6px 8px;border-radius:6px;background:rgba(71,114,179,.25)"></div>
      <div id="easy-rig-status" style="font-size:12px;opacity:.85">No joints selected</div>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="easy-rig-labels"> Show all joint names</label>
<details style="border-top:1px solid rgba(255,255,255,.15);padding-top:6px"><summary style="font-weight:700;cursor:pointer">⌨ Mouse, keys, Rigify</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">Mouse &amp; keys
        <select id="easy-rig-keymap" style="font-size:12px;padding:3px">
          <option value="greenbox">Greenbox (right-drag rotates)</option>
          <option value="blender">Blender (middle-drag / Alt+left rotates, G move)</option>
        </select></label>
      <div style="font-size:11px;opacity:.75;line-height:1.45">G move (X/Y/Z lock, click OK, right-click cancel) · A all · Alt+A none · F frame · 1 / 3 / 7 front / side / top (Alt: opposite) · Ctrl+Z undo</div>
      <button type="button" class="secondary-button" id="easy-rig-rigify" style="padding:4px 10px;font-size:12px">🦴 Rigify meta-rig only (.py) · full kit after Finish</button></div></details>
      <div id="easy-rig-cage-box" style="display:flex;flex-direction:column;gap:6px"><details style="border-top:1px solid rgba(255,255,255,.15);padding-top:6px"><summary style="font-weight:700;cursor:pointer">🧩 Anatomy cage <span style="font-weight:400;opacity:.7;font-size:12px">(skin weights · advanced)</span></summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        <div style="font-size:12px;opacity:.8">Invisible tubes around each body part decide which bone moves which skin. Only used while rigging, not exported.</div>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="easy-rig-cage-on" checked> Use the anatomy cage for skin weights</label>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="easy-rig-cage-show"> Show the cage</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:12px">Thickness (selected joints) <input type="range" id="easy-rig-cage-size" min="40" max="200" value="100" style="flex:1"></label>
        <button type="button" class="secondary-button" id="easy-rig-cage-measure" style="padding:4px 10px;font-size:12px">↺ Re-measure cage</button>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="easy-rig-regions"> Show skin regions (colour = which bone moves it)</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:12px">Joint softness <input type="range" id="easy-rig-cage-soft" min="40" max="220" value="100" style="flex:1"></label>
        <details id="easy-rig-cage-parts"><summary style="cursor:pointer;font-size:13px;font-weight:600">Body part sizes</summary>
          <div style="font-size:11px;opacity:.75;margin:4px 0">% = tube thickness · Ø = measured width in model units. Thinner = takes less skin.</div>
          <div id="easy-rig-cage-rows" style="display:flex;flex-direction:column;gap:3px"></div>
        </details>
      </div></details></div>
      <div id="easy-rig-sym" style="display:flex;flex-direction:column;gap:6px"><details style="border-top:1px solid rgba(255,255,255,.15);padding-top:6px"><summary style="font-weight:700;cursor:pointer">🪞 Symmetry</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <button type="button" class="secondary-button" data-sym="l" style="padding:4px 10px;font-size:12px" title="Copy the left joints to the right, mirrored across the middle">🪞 Left → right</button>
          <button type="button" class="secondary-button" data-sym="r" style="padding:4px 10px;font-size:12px" title="Copy the right joints to the left">🪞 Right → left</button>
          <button type="button" class="secondary-button" data-sym="c" style="padding:4px 10px;font-size:12px" title="Put the spine, neck and head on the middle line">⇥ Centre the spine</button>
        </div>
        <div style="font-size:11px;opacity:.75">While dragging, "Mirror Left/Right Joints" keeps both sides together.</div>
      </div></details></div>
      <div id="easy-rig-fingers" style="display:none;flex-direction:column;gap:6px"><details style="border-top:1px solid rgba(255,255,255,.15);padding-top:6px" open><summary style="font-weight:700;cursor:pointer">🖐 Fingers</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="easy-rig-finger-lock"> Lock fingers to the hand (move the hand only)</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <button type="button" class="secondary-button" data-fp="detect" style="padding:4px 10px;font-size:12px" title="Find every finger on the mesh (tips, knuckles) and put the finger joints on them">🖐 Find fingers in the mesh</button>
          <button type="button" class="secondary-button" data-fp="fit" style="padding:4px 10px;font-size:12px">📏 Fit fingers into the hand</button>
          <button type="button" class="secondary-button" data-fp="spread" style="padding:4px 10px;font-size:12px">✋ Spread</button>
          <button type="button" class="secondary-button" data-fp="closed" style="padding:4px 10px;font-size:12px">🤚 Together</button>
          <button type="button" class="secondary-button" data-fp="mitten" style="padding:4px 10px;font-size:12px">🧤 Mitten (chibi)</button>
          <button type="button" class="secondary-button" data-fp="reset" style="padding:4px 10px;font-size:12px">↺ Template</button>
        </div>
        <label style="display:flex;gap:8px;align-items:center;font-size:12px">Finger size <input type="range" id="easy-rig-finger-size" min="40" max="180" value="100" style="flex:1"></label>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="easy-rig-finger-weights" checked> Finger weights: palm / each finger / each knuckle (fingers bend alone)</label>
        <div id="easy-rig-finger-note" style="font-size:11px;opacity:.75"></div>
      </div></details></div>
      <div id="easy-rig-bones" style="display:flex;flex-direction:column;gap:6px"><details style="border-top:1px solid rgba(255,255,255,.15);padding-top:6px"><summary style="font-weight:700;cursor:pointer">🔢 Bone count <span style="font-weight:400;opacity:.7;font-size:12px">(hyper-casual)</span></summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        <div id="easy-rig-bone-count" style="font-size:12px"></div>
        <div id="easy-rig-human-reduce" style="display:none;flex-direction:column;gap:5px;font-size:12px">
          <label style="display:flex;gap:6px;align-items:center;justify-content:space-between">Spine <select id="eb-spine" style="font-size:12px;padding:2px"><option value="3">3 bones</option><option value="2">2 bones</option><option value="1">1 bone</option></select></label>
          <label style="display:flex;gap:6px;align-items:center;justify-content:space-between">Fingers <select id="eb-fingers" style="font-size:12px;padding:2px"><option value="all">5 fingers</option><option value="three">3 fingers (thumb, index, middle)</option><option value="mitten">Mitten (thumb + 1)</option><option value="none">None (hand only)</option></select></label>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            <label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="eb-neck" checked> Neck</label>
            <label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="eb-shoulders" checked> Shoulders</label>
            <label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="eb-toes" checked> Toes</label>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <button type="button" class="secondary-button" id="eb-off" style="padding:4px 10px;font-size:12px">✕ Turn off selected joints</button>
          <button type="button" class="secondary-button" id="eb-on" style="padding:4px 10px;font-size:12px">✓ Turn selected back on</button>
          <button type="button" class="secondary-button" id="eb-all-on" style="padding:4px 10px;font-size:12px">↺ All joints on</button>
        </div>
        <div style="font-size:11px;opacity:.75;line-height:1.45">Joints marked with a red ✕ are merged into their parent when you press Finish: their skin and their animation go to the parent. Nothing is deleted here, turn them back on any time.</div>
      </div></details></div>`
    const q = p.querySelector('#easy-rig-quick') as HTMLElement
    const mk = (id: string, label: string): void => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary-button'; b.textContent = label
      b.style.cssText = 'padding:4px 10px;font-size:12px'
      b.onclick = () => this.quick_select(id); q.appendChild(b)
    }
    groups.forEach(g => mk(g.id, g.label))
    mk('all', 'All'); mk('none', 'Deselect')
    ;(p.querySelector('#easy-rig-fit') as HTMLButtonElement).onclick = () => { this.fit_to_model() }
    const con = p.querySelector('#easy-rig-cage-on') as HTMLInputElement
    con.checked = CAGE.enabled
    con.onchange = () => { CAGE.enabled = con.checked; this.draw_cage() }
    const csh = p.querySelector('#easy-rig-cage-show') as HTMLInputElement
    csh.checked = this.cage_visible
    csh.onchange = () => { this.cage_visible = csh.checked; this.draw_cage() }
    const csz = p.querySelector('#easy-rig-cage-size') as HTMLInputElement
    csz.oninput = () => this.set_cage_thickness(Number(csz.value))
    ;(p.querySelector('#easy-rig-cage-measure') as HTMLButtonElement).onclick = () => { CAGE.scale.clear(); CAGE.blend = 1; csz.value = '100'; this.measure_cage() }
    const soft = p.querySelector('#easy-rig-cage-soft') as HTMLInputElement
    soft.value = String(Math.round(CAGE.blend * 100))
    soft.oninput = () => { CAGE.blend = Number(soft.value) / 100; this.refresh_regions() }
    const reg = p.querySelector('#easy-rig-regions') as HTMLInputElement
    reg.checked = this.show_regions
    reg.onchange = () => { this.show_regions = reg.checked; this.refresh_regions(0) }
    const km = p.querySelector('#easy-rig-keymap') as HTMLSelectElement
    km.value = this.keymap
    km.onchange = () => {
      this.keymap = km.value === 'blender' ? 'blender' : 'greenbox'
      try { localStorage.setItem('gb3d.keymap', this.keymap) } catch { /* private mode */ }
      this.remap_orbit(false); this.remap_orbit(true); this.swap_mouse_hints(false); this.swap_mouse_hints(true)
    }
    ;(p.querySelector('#easy-rig-rigify') as HTMLButtonElement).style.display = this.is_human() ? '' : 'none'
    ;(p.querySelector('#easy-rig-rigify') as HTMLButtonElement).onclick = () => {
      download_text(rigify_metarig_script(this.skeleton().bones, 'Greenbox character', { off: [...BONES_OFF] }), 'greenbox_rigify_metarig.py')
    }
    this.wire_bone_reduce(p)
    const lab = p.querySelector('#easy-rig-labels') as HTMLInputElement
    lab.checked = this.show_all_labels
    lab.onchange = () => { this.show_all_labels = lab.checked }
    p.querySelectorAll<HTMLButtonElement>('[data-sym]').forEach(b => { b.onclick = () => this.make_symmetric(b.dataset.sym as 'l' | 'r' | 'c') })
    if (this.skeleton().bones.some(b => FINGER_RE.test(b.name))) {
      (p.querySelector('#easy-rig-fingers') as HTMLElement).style.display = 'flex'
      const lock = p.querySelector('#easy-rig-finger-lock') as HTMLInputElement
      lock.checked = this.finger_lock
      lock.onchange = () => {
        this.finger_lock = lock.checked
        if (this.finger_lock) this.skeleton().bones.forEach(b => { if (FINGER_RE.test(b.name)) this.selected.delete(b) })
        this.update_status()
      }
      p.querySelectorAll('[data-fp]').forEach(el => {
        (el as HTMLButtonElement).onclick = () => {
          const id = (el as HTMLElement).dataset.fp as string
          if (id === 'detect') this.detect_fingers(); else if (id === 'fit') this.fit_fingers_to_hand(); else this.finger_preset(id as any)
        }
      })
      const fw = p.querySelector('#easy-rig-finger-weights') as HTMLInputElement
      fw.checked = FINGER_WEIGHTS.enabled; fw.onchange = () => { FINGER_WEIGHTS.enabled = fw.checked }
      const fn = p.querySelector('#easy-rig-finger-note'); if (fn !== null) fn.textContent = this.last_finger_note
      const size = p.querySelector('#easy-rig-finger-size') as HTMLInputElement
      size.value = String(Math.round(this.finger_size * 100))
      size.onchange = () => { this.finger_size = Number(size.value) / 100; this.apply_fingers() }
    }
    // after the template preview image, before the options
    const tpl = host.querySelector('#skeleton-template-image')
    if (tpl !== null && tpl.nextSibling !== null) host.insertBefore(p, tpl.nextSibling)
    else host.prepend(p)
    this.panel_el = p
  }

  /** Fold the expert options away so the step reads as: look at template → box select → drag → Finish. */
  private simplify_panel (): void {
    const host = this.engine.ui.dom_skeleton_edit_tools
    if (host === null || host.querySelector('#easy-rig-advanced') !== null) return
    const pick: Array<Element | null> = [
      document.getElementById('mesh-drag-placement')?.closest('.pill-switch-group')?.parentElement ?? null,
      document.getElementById('independent-bone-movement-group')?.closest('.pill-switch-group') ?? null,
      document.getElementById('mesh-preview-group')?.closest('.pill-switch-group') ?? null,
      document.getElementById('use-head-weight-correction-container'),
      document.getElementById('use-arm-plane-container')
    ]
    const d = document.createElement('details')
    d.id = 'easy-rig-advanced'
    d.style.cssText = 'margin:4px 0 12px;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 10px'
    const s = document.createElement('summary'); s.textContent = 'Advanced options'; s.style.cursor = 'pointer'
    d.appendChild(s)
    const anchor = pick.find(x => x !== null)
    if (anchor === undefined || anchor === null) return
    host.insertBefore(d, anchor)
    pick.forEach(x => { if (x !== null) d.appendChild(x) })
  }
}
