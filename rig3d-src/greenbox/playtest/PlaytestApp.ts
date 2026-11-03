/*
 * Greenbox 3D — Play test. Drop in a rigged character (or send one from "Use Your Model") and play it like a game:
 *   PC     : WASD move · Shift sprint · Alt walk · Space jump · Shift+Space roll · left click attack (combo)
 *            · right click (hold) block · C crouch · H hit reaction · wheel zoom · middle-drag / Q E turn camera
 *   Mobile : click / tap the ground to run there (double click = sprint) · buttons for attack, jump, roll, block
 * Camera presets for ad shots: third person, top-down, side view. ⏺ records the canvas to a video file.
 */
import { is_trackpad, pinch_factor } from '../common/MacTrackpad.ts'
import { load_any_buffer } from '../common/AnyLoader.ts'
import { MapEditor, OBJECTS, CUSTOM } from './MapEditor.ts'
import { PlanEditor, type Plan } from './PlanEditor.ts'
import { Playable } from './Playable.ts'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { CameraRig } from './CameraRig.ts'
import { History } from '../common/UndoKeys.ts'
import { set_wire, has_wire } from '../common/WireView.ts'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { CharacterController, strip_root_motion, strip_vertical_motion, type Input } from './CharacterController.ts'
import { World, type EditMode } from './World.ts'
import { VehicleDriver, is_vehicle } from './VehicleDriver.ts'
import { map_clips } from './ClipMap.ts'
import { handoff_take, on_handoff } from '../common/Handoff.ts'
import { on_lang_change, M } from '../common/lang.ts'

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

/** turn a model around Y (about its own place) */
function turn_model (model: THREE.Object3D, a: number): void {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a)
  model.quaternion.premultiply(q); model.position.applyQuaternion(q); model.updateMatrixWorld(true)
}

/**
 * Which way a creature faces (angle from +Z, around Y), or null when it cannot tell:
 *   1. its head bone, seen from the middle of the body (a crocodile, a horse, a dog…);
 *   2. else the way its walk / run animation travels (root motion, before it is removed).
 */
function facing (model: THREE.Object3D, clips: THREE.AnimationClip[]): number | null {
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model); const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3())
  let head: THREE.Object3D | null = null
  for (const re of [/^head(?!.*(leaf|end|top))/i, /head(?!.*(leaf|end|top))/i, /jaw/i, /neck/i]) { if (head !== null) break; model.traverse(o => { if (head === null && (o as THREE.Bone).isBone === true && re.test(o.name)) head = o }) }
  if (head !== null) {
    const d = (head as THREE.Object3D).getWorldPosition(new THREE.Vector3()).sub(c); d.y = 0
    if (d.length() > Math.max(sz.x, sz.z) * 0.12) return Math.atan2(d.x, d.z)
  }
  const walk = clips.find(k => /walk|run|jog|move|trot|gallop/i.test(k.name))
  let root: THREE.Object3D | null = null; model.traverse(o => { if (root === null && (o as THREE.Bone).isBone === true) root = o })
  if (walk !== undefined && root !== null) {
    const r = root as THREE.Object3D; const tr = walk.tracks.find(t => t.name === `${r.name}.position`)
    if (tr !== undefined && tr.values.length >= 6) {
      const v = tr.values; const n = v.length
      const d = new THREE.Vector3(v[n - 3] - v[0], v[n - 2] - v[1], v[n - 1] - v[2])
      if (r.parent !== null) d.transformDirection(r.parent.matrixWorld)
      d.y = 0; if (d.length() > 1e-4) return Math.atan2(d.x, d.z)
    }
  }
  return null
}

type Scheme = 'pc' | 'mobile'
const NO_INPUT: Input = { move: new THREE.Vector2(), sprint: false, walk: false, jump: false, roll: false, attack: false, block: false, crouch_toggle: false, hit_test: false }
type CamMode = 'third' | 'top' | 'side'
/** one undo step of the map: the map file (terrain, water, objects, shots) + the dropped files / boxes */
interface MapState { json: string, props: Array<{ o: THREE.Object3D, t: number[] }> }

class PlaytestApp {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500)
  private readonly timer = new THREE.Timer()
  private ctrl: CharacterController | null = null
  private car: VehicleDriver | null = null
  private world!: World
  private editing = false
  private push_t = 0
  private ledge: THREE.Vector3 | null = null
  private last_dt = 0.016
  private scheme: Scheme = 'pc'
  private cam_mode: CamMode = 'third'
  private cam_yaw = 0
  private cam_pitch = 0.32
  private cam_dist = 4.2
  private readonly keys = new Set<string>()
  private pressed = new Set<string>()
  private mouse_attack = false
  private mouse_block = false
  private orbit_drag: { x: number, y: number } | null = null
  private move_target: THREE.Vector3 | null = null
  private sprint_to_target = false
  private readonly marker: THREE.Mesh
  private dummy: THREE.Group | null = null
  private dummy_wobble = 0
  private readonly ground: THREE.Mesh
  public map!: MapEditor
  public rig!: CameraRig
  public history!: History<MapState>
  private recorder: MediaRecorder | null = null
  private rec_shots = false

  constructor () {
    const view = $('pt-view')
    view.appendChild(this.renderer.domElement)
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio)) // retina at 2x costs 4x the pixels: 1.5 looks the same while working
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.scene.background = new THREE.Color(0x9fc6e8)
    this.scene.fog = new THREE.Fog(0x9fc6e8, 25, 70)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7a5a, 1.4))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(6, 12, 5); sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -15; sc.right = 15; sc.top = 15; sc.bottom = -15; sc.far = 50
    this.scene.add(sun); this.scene.add(sun.target)
    this.ground = this.make_ground(); this.scene.add(this.ground)
    this.world = new World(this.scene, this.camera, this.renderer.domElement)
    addEventListener('pointerdown', e => { if (e.button === 0 && e.target === this.renderer.domElement) this.note_click(e) }, { capture: true }) // 📝 block notes (window capture: before the game's own handlers)
    this.make_props()
    this.map = new MapEditor(this.world, this.scene, () => this.camera, this.renderer.domElement)
    const aside = document.querySelector('aside'); const sec3 = $('pt-edit').closest('section')
    if (aside !== null) { const holder = document.createElement('div'); this.map.mount(holder); if (sec3 !== null) sec3.after(holder.firstElementChild!); else aside.append(holder.firstElementChild!) }
    document.addEventListener('gb-map-tool', (e) => {
      const t = (e as CustomEvent).detail
      if (t === 'select') { if (!this.editing) this.set_editing(true) } else if (t !== 'none' && this.editing) this.set_editing(false)
    })
    // camera: free camera on the middle mouse, saved shots
    this.rig = new CameraRig(this.camera, this.renderer.domElement,
      (n) => n === 'player' ? (this.ctrl?.root ?? this.car?.root ?? this.pawn) : (this.world.props.getObjectByName(n) ?? null),
      () => this.world.props.children.filter(o => o.name !== '' && o.name !== 'Terrain').map(o => o.name),
      () => this.follow_target())
    this.map.rig = this.rig; this.map.status = (t, w) => this.status(t, w)
    this.map.riders = () => [this.ctrl?.root, this.car?.root, this.pawn].filter((o): o is THREE.Object3D => o != null)
    let ground_size = 0
    this.map.on_rebuild = (size) => { if (size !== ground_size) { ground_size = size; this.ground.geometry.dispose(); this.ground.geometry = this.ground_geometry(size) } }
    this.map.on_rebuild(this.map.n * this.map.cell)
    this.rig.on_change = () => this.map.autosave_now()
    this.rig.on_done = () => { if (this.rec_shots && this.recorder !== null) this.recorder.stop(); this.rec_shots = false }
    this.rig.set(this.map.pending_shots)
    this.make_history()
    this.make_plan()
    const camsec = $('pt-rec').closest('section'); if (camsec !== null) { const holder = document.createElement('div'); camsec.querySelector('.row')?.after(holder); this.rig.mount(holder) }
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.scene.add(this.marker)
    addEventListener('resize', () => this.resize()); this.resize()
    this.bind()
    this.renderer.setAnimationLoop(() => this.tick())
    void this.boot()
  }

  /* ---------------- world ---------------- */
  private make_ground (): THREE.Mesh {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = '#7fae5a'; g.fillRect(0, 0, 256, 256)
    g.fillStyle = '#76a352'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128)
    g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(0.25, 0.25); tex.colorSpace = THREE.SRGBColorSpace
    const m = new THREE.Mesh(this.ground_geometry(96), new THREE.MeshLambertMaterial({ map: tex }))
    m.rotation.x = -Math.PI / 2; m.receiveShadow = true
    m.position.y = -0.05 // around the map terrain (no flicker where they meet)
    return m
  }

  /** the ground around the map: a big square with a hole where the terrain is, so holes / rivers dug below 0 show */
  private ground_geometry (inner: number): THREE.BufferGeometry {
    const O = Math.max(240, inner * 3) / 2; const I = inner / 2 - 0.01
    const sh = new THREE.Shape([new THREE.Vector2(-O, -O), new THREE.Vector2(O, -O), new THREE.Vector2(O, O), new THREE.Vector2(-O, O)])
    sh.holes.push(new THREE.Path([new THREE.Vector2(-I, -I), new THREE.Vector2(-I, I), new THREE.Vector2(I, I), new THREE.Vector2(I, -I)]))
    return new THREE.ShapeGeometry(sh)
  }

  /** the play test starts on an empty, flat ground (no sample boxes, ramp or training dummy): you build your own map */
  private make_props (): void {}

  /* ---------------- loading ---------------- */
  private async boot (): Promise<void> {
    on_handoff('playtest', () => { void handoff_take('playtest').then(h => { if (h !== null) void this.load_buffer(h.data, h.name) }) })
    const h = await handoff_take('playtest')
    if (h !== null) { await this.load_buffer(h.data, h.name); return }
    this.status(M('Drop a rigged character (GLB/FBX with animations), or press "Play test" after rigging in Use Your Model.', 'Thả nhân vật đã gắn xương (GLB/FBX có animation), hoặc bấm "Chơi thử" sau khi gắn xương ở Dùng model của bạn.', '리깅된 캐릭터(애니메이션 포함 GLB/FBX)를 넣거나, Use Your Model에서 리깅 후 "플레이 테스트"를 누르세요.'), true)
  }

  private async load_buffer (buf: ArrayBuffer, name: string): Promise<void> {
    try {
      const r = await load_any_buffer(name, buf)
      this.set_character(r.scene, r.clips, name)
    } catch (e) {
      this.status((e as Error).message ?? String(e), true)
    }
  }

  private set_character (model: THREE.Object3D, clips: THREE.AnimationClip[], name: string): void {
    if (this.ctrl !== null) { this.scene.remove(this.ctrl.root); this.ctrl = null }
    if (this.car !== null) { this.scene.remove(this.car.root); this.car = null }
    if (this.pawn !== null) { this.scene.remove(this.pawn); this.pawn = null }
    if (is_vehicle(model, clips)) { this.set_vehicle(model, clips, name); return }
    model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false } })
    // normalise: 1.8 m tall, feet on the ground, centred
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const h = Math.max(1e-4, box.max.y - box.min.y)
    // people are made 1.8 m tall; animals (a long shark, a flat snake) by their longest side
    let human = false
    model.traverse(o => { if (/upperarm|thigh|upleg|leftarm|arm_l|forearm/i.test(o.name)) human = true })
    const sz = box.getSize(new THREE.Vector3())
    const s = human ? 1.8 / h : 2.2 / Math.max(1e-4, sz.x, sz.y, sz.z)
    model.scale.multiplyScalar(s)
    model.updateMatrixWorld(true)
    // animals / creatures: turn the model so its head looks where W goes (people already face +Z)
    if (!human) { const a = facing(model, clips); if (a !== null) turn_model(model, -a) }
    const b2 = new THREE.Box3().setFromObject(model)
    model.position.x -= (b2.min.x + b2.max.x) / 2; model.position.z -= (b2.min.z + b2.max.z) / 2; model.position.y -= b2.min.y
    strip_root_motion(clips, model)
    const table = map_clips(clips)
    if (table.climb_up !== undefined) strip_vertical_motion(table.climb_up, model)
    // a playable only needs the moves the controller uses (idle, run, jump…), not the whole library
    this.char_model = model; this.char_clips = [...new Set(Object.values(table).filter((c): c is THREE.AnimationClip => c !== undefined))]
    this.ctrl = new CharacterController(model, table)
    this.ctrl.on_hit_frame = (reach) => this.try_hit(reach)
    this.ctrl.ground_at = (x, z, y) => this.world.ground_at(x, z, y)
    this.ctrl.move_filter = (a, b) => {
      const ledge = this.ctrl !== null && this.ctrl.is_on_ground() ? this.world.block(a, b) : (this.world.block(a, b), null)
      if (ledge !== null) { this.push_t += this.last_dt; this.ledge = ledge } else { this.push_t = 0; this.ledge = null }
    }
    this.scene.add(this.ctrl.root)
    const have = (Object.keys(table)).length
    const miss = ['idle', 'run', 'jump', 'roll', 'attack1', 'block'].filter(a => !(a in table))
    $('pt-clips').textContent = `${clips.length} ${M('clips', 'animation', '클립')} · ${have} ${M('actions mapped', 'hành động đã gán', '동작 매핑')}` + (miss.length > 0 ? ` · ${M('missing', 'thiếu', '없음')}: ${miss.join(', ')}` : '')
    this.status(M(`Playing ${name}. Click the view, then use the controls.`, `Đang chơi ${name}. Bấm vào khung hình rồi điều khiển.`, `${name} 플레이 중. 화면을 클릭한 뒤 조작하세요.`))
    this.renderer.domElement.focus()
  }

  private set_vehicle (model: THREE.Object3D, clips: THREE.AnimationClip[], name: string): void {
    model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false } })
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model); const sz = box.getSize(new THREE.Vector3())
    const s = 4.2 / Math.max(1e-4, sz.z, sz.x) // a car is about 4 m long
    model.scale.multiplyScalar(s); model.updateMatrixWorld(true)
    // the front of the car (front wheels, seen from the back wheels) where W drives
    const fw = new THREE.Vector3(); const bw = new THREE.Vector3(); let nf = 0; let nb = 0
    model.traverse(o => { const m = /^wheel_([FBR])/i.exec(o.name); if (m === null) return; const p = o.getWorldPosition(new THREE.Vector3()); if (m[1].toUpperCase() === 'F') { fw.add(p); nf++ } else { bw.add(p); nb++ } })
    if (nf > 0 && nb > 0) { const d = fw.divideScalar(nf).sub(bw.divideScalar(nb)); d.y = 0; if (d.length() > 1e-4) turn_model(model, -Math.atan2(d.x, d.z)) }
    const b2 = new THREE.Box3().setFromObject(model)
    model.position.x -= (b2.min.x + b2.max.x) / 2; model.position.z -= (b2.min.z + b2.max.z) / 2; model.position.y -= b2.min.y
    this.car = new VehicleDriver(model, clips, 4.2)
    this.car.ground_at = (x, z, y) => this.world.ground_at(x, z, y)
    this.car.move_filter = (a, b) => { this.world.block(a, b, 1.2) }
    this.scene.add(this.car.root)
    $('pt-clips').textContent = `${clips.length} ${M('clips', 'animation', '클립')} · ${M('vehicle', 'xe', '차량')}`
    this.status(M(`Driving ${name}: W/S throttle, A/D steer, Space handbrake.`, `Đang lái ${name}: W/S ga, A/D lái, Space phanh tay.`, `${name} 운전 중: W/S 가속, A/D 조향, Space 핸드브레이크.`))
    this.cam_dist = Math.max(this.cam_dist, 8)
    $('pt-help').innerHTML = M('<b>W / S</b> throttle · brake / reverse · <b>A / D</b> steer · <b>Space</b> handbrake · <b>Q/E</b> or middle-drag: camera · wheel: zoom', '<b>W / S</b> ga · phanh / lùi · <b>A / D</b> lái · <b>Space</b> phanh tay · <b>Q/E</b> hoặc kéo chuột giữa: camera · lăn: zoom', '<b>W / S</b> 가속 · 브레이크 / 후진 · <b>A / D</b> 조향 · <b>Space</b> 핸드브레이크 · <b>Q/E</b> 또는 가운데 드래그: 카메라 · 휠: 줌')
    this.renderer.domElement.focus()
  }

  /* ---------------- 2D plan -> 3D playable ---------------- */
  public plan_ed!: PlanEditor
  public playable: Playable | null = null
  /** a stand-in player (a capsule you drive with WASD) when no character is loaded */
  private pawn: THREE.Object3D | null = null
  private char_model: THREE.Object3D | null = null
  private char_clips: THREE.AnimationClip[] = []

  /**
   * One HTML file that plays the map as a playable ad (no server, no other file): the map GLB, the character GLB
   * with its animations, the plan and the runtime (three.js included) all inside. Touch-drag joystick, CTA button
   * (mraid.open in ad networks).
   */
  public async export_playable (): Promise<void> {
    const plan = this.map.plan
    if (plan === null || plan.shapes.length === 0) { this.status(M('Draw a 2D plan first (📐).', 'Vẽ sơ đồ 2D trước (📐).', '먼저 2D 평면도를 그리세요.'), true); return }
    const KEY = 'gb.playable.cta'; const last = (() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })()
    const cta = prompt(M('Store / landing link for the button (empty = no button):', 'Link cửa hàng / landing cho nút bấm (để trống = không có nút):', '버튼 링크 (비우면 없음):'), last)
    if (cta === null) return
    try { localStorage.setItem(KEY, cta) } catch { /* ignore */ }
    this.status(M('Making the playable…', 'Đang tạo file playable…', '플레이어블 생성 중…'))
    try {
      if (!plan.shapes.some(s => this.map.plan_object(s.id) !== null)) this.map.build_plan(plan)
      const b64 = (buf: ArrayBuffer): string => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
      const runtime = await (await fetch('playable-runtime.js', { cache: 'no-store' })).text()
      const map = b64(await this.map.glb_buffer(false))
      let char: string | null = null
      if (this.char_model !== null && this.ctrl !== null) char = b64(await new GLTFExporter().parseAsync(this.char_model, { binary: true, animations: this.char_clips }) as ArrayBuffer)
      const data = { map, char, plan, cta, cta_label: M('Play now', 'Chơi ngay', '지금 플레이'), cam: { yaw: this.cam_yaw, pitch: Math.max(0.45, this.cam_pitch), dist: Math.max(8, this.cam_dist) } }
      const safe = (t: string): string => t.replace(/<\/script/gi, '<\\/script')
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Greenbox playable</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#9fc6e8;touch-action:none;-webkit-user-select:none;user-select:none}</style></head><body><script>window.__GB_PLAYABLE=${safe(JSON.stringify(data))}</script><script>${safe(runtime)}</script></body></html>`
      const blob = new Blob([html], { type: 'text/html' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'greenbox-playable.html'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      this.status(M(`Playable saved: greenbox-playable.html (${(blob.size / 1048576).toFixed(1)} MB). Open it in a browser or upload it to the ad network.`, `Đã lưu playable: greenbox-playable.html (${(blob.size / 1048576).toFixed(1)} MB). Mở bằng trình duyệt hoặc tải lên mạng quảng cáo.`, `저장됨 (${(blob.size / 1048576).toFixed(1)} MB)`))
    } catch (e) { this.status(String((e as Error).message ?? e), true) }
  }

  private make_plan (): void {
    const ed = new PlanEditor(() => this.map.n * this.map.cell)
    this.plan_ed = ed
    ed.set_plan(this.map.plan !== null ? JSON.parse(JSON.stringify(this.map.plan)) : undefined)
    this.map.on_plan = (p) => { ed.set_plan(p !== null ? JSON.parse(JSON.stringify(p)) : undefined) }
    ed.on_change = (p) => { this.map.plan = JSON.parse(JSON.stringify(p)); this.map.autosave_now() }
    ed.on_build = (p) => { this.history.commit(); this.history.begin(); this.stop_playable(); this.map.build_plan(p); this.history.commit(); this.status(M('Built the plan in 3D. ▶ Play playable to try it.', 'Đã dựng sơ đồ thành 3D. Bấm ▶ Chơi playable để thử.', '3D로 생성했습니다.')) }
    ed.on_play = (p) => { ed.on_build!(p); this.start_playable() }
    this.map.on_cleared = () => { this.stop_playable(); this.map.plan = null; ed.set_plan(undefined) }
    ;(window as any).__gbPlanModels = (): Array<[string, string]> => [...OBJECTS.map(o => [o.id, `${o.icon} ${M(o.en, o.vi, o.en)}`] as [string, string]), ...[...CUSTOM.keys()].map(k => [k, '📦 ' + k.slice(5)] as [string, string])]
    // buttons in the map editor
    const sec = document.getElementById('pt-mapedit')
    if (sec !== null) {
      const row = document.createElement('div'); row.className = 'row'
      const row2 = document.createElement('div'); row2.className = 'row'
      row2.innerHTML = `<button data-plan="wires" title="${M('Flow wires on the ground: show them while designing, hide them for the game and the export', 'Dây flow trên mặt đất: hiện khi thiết kế, ẩn khi chơi và khi xuất', '흐름 선 표시/숨김')}"></button><button data-plan="export" title="${M('One HTML file that plays this map as a playable ad', 'Một file HTML chơi được map này như playable ad', '플레이어블 HTML')}">⬇ ${M('Playable (.html)', 'File playable (.html)', '플레이어블 (.html)')}</button>`
      const wb = (): void => { (row2.querySelector('[data-plan="wires"]') as HTMLElement).textContent = (this.map.wires_visible ? '🔗 ' : '⛓️‍💥 ') + (this.map.wires_visible ? M('Wires: shown', 'Dây: đang hiện', '선: 표시') : M('Wires: hidden', 'Dây: đang ẩn', '선: 숨김')) }
      row2.querySelector<HTMLButtonElement>('[data-plan="wires"]')!.onclick = () => { this.map.show_wires(!this.map.wires_visible); wb() }
      row2.querySelector<HTMLButtonElement>('[data-plan="export"]')!.onclick = () => { void this.export_playable() }
      wb()
      row.innerHTML = `<button data-plan="open" class="pri" title="${M('Draw shapes, name them, connect them with flow wires, then build a playable 3D map', 'Vẽ khối, ghi tên, nối dây flow rồi dựng map 3D chơi được', '2D 평면도')}">📐 ${M('2D plan → playable', 'Sơ đồ 2D → playable', '2D 평면도')}</button><button data-plan="play">▶ ${M('Play playable', 'Chơi playable', '플레이어블')}</button>`
      sec.querySelector('h3')?.after(row); row.after(row2)
      row.querySelector<HTMLButtonElement>('[data-plan="open"]')!.onclick = () => { if (this.editing) this.set_editing(false); this.map.set_tool('none'); ed.open() }
      row.querySelector<HTMLButtonElement>('[data-plan="play"]')!.onclick = () => { if (this.playable !== null) this.stop_playable(); else this.start_playable() }
    }
  }

  public start_playable (): void {
    const plan: Plan | null = this.map.plan
    if (plan === null || plan.shapes.length === 0) { this.status(M('Draw a 2D plan first (📐).', 'Vẽ sơ đồ 2D trước (📐).', '먼저 2D 평면도를 그리세요.'), true); return }
    if (!plan.shapes.some(s => this.map.plan_object(s.id) !== null)) this.map.build_plan(plan)
    this.stop_playable()
    if (this.editing) this.set_editing(false); this.map.set_tool('none'); this.rig.stop(); this.rig.exit_free()
    if (this.ctrl === null && this.car === null) this.make_pawn()
    this.playable = new Playable(plan, this.scene, (id) => this.map.plan_object(id), () => this.ctrl?.root ?? this.car?.root ?? this.pawn, $('pt-view'), () => this.stop_playable())
    this.cam_mode = 'third'; this.cam_pitch = 0.75; this.cam_dist = Math.max(this.cam_dist, 9)
    this.status(M('Playable: walk to the yellow arrow. Items stack on your back, machines work, counters pay.', 'Playable: đi theo mũi tên vàng. Đồ chồng lên lưng, máy chạy, quầy trả tiền.', '플레이어블: 노란 화살표를 따라가세요.'))
    this.renderer.domElement.focus()
  }

  public stop_playable (): void { if (this.playable !== null) { this.playable.dispose(); this.playable = null } }

  private make_pawn (): void {
    if (this.pawn !== null) return
    const g = new THREE.Group(); g.name = 'Player'
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 16), new THREE.MeshLambertMaterial({ color: 0xf97316 })); body.position.y = 0.72; body.castShadow = true
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshLambertMaterial({ color: 0xffffff })); nose.position.set(0, 1.05, 0.3)
    g.add(body, nose); this.scene.add(g); this.pawn = g
  }

  private move_pawn (dt: number, input: Input): void {
    const p = this.pawn; if (p === null || this.ctrl !== null || this.car !== null) return
    const want = new THREE.Vector3(input.move.x, 0, -input.move.y).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cam_yaw)
    if (want.lengthSq() > 1e-4) {
      const b = p.position.clone().addScaledVector(want, (input.sprint ? 7 : 4.5) * dt)
      this.world.block(p.position, b)
      p.position.x = b.x; p.position.z = b.z
      const yaw = Math.atan2(want.x, want.z); let d = yaw - p.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); p.rotation.y += d * Math.min(1, dt * 14)
    }
    p.position.y = this.world.ground_at(p.position.x, p.position.z, p.position.y)
  }

  /* ---------------- undo / redo (Ctrl+Z / Cmd+Z, Ctrl+Shift+Z / Cmd+Shift+Z) ---------------- */
  private make_history (): void {
    const extra = (): THREE.Object3D[] => this.world.props.children.filter(o => o.userData.map_kind === undefined && o.name !== 'Terrain')
    const take = (): MapState => ({
      json: JSON.stringify(this.map.data()),
      props: extra().map(o => ({ o, t: [...o.position.toArray(), o.rotation.x, o.rotation.y, o.rotation.z, ...o.scale.toArray()] }))
    })
    const same = (a: MapState, b: MapState): boolean => a.json === b.json && a.props.length === b.props.length && a.props.every((p, i) => p.o === b.props[i].o && p.t.every((v, k) => Math.abs(v - b.props[i].t[k]) < 1e-6))
    const apply = (st: MapState): void => {
      const sel = this.world.selected; this.world.select(null)
      this.map.load(JSON.parse(st.json))
      // dropped files / boxes: put back the ones that were there, remove the others, restore their place
      const keep = new Set(st.props.map(p => p.o))
      for (const o of extra()) if (!keep.has(o)) o.removeFromParent()
      for (const { o, t } of st.props) { if (o.parent !== this.world.props) this.world.props.add(o); o.position.fromArray(t, 0); o.rotation.set(t[3], t[4], t[5]); o.scale.fromArray(t, 6) }
      this.world.refresh(); this.map.autosave_now()
      if (sel !== null && sel.parent === this.world.props && this.editing) this.world.select(sel)
      this.status(M('Undo / redo: Ctrl+Z / Cmd+Z, Ctrl+Shift+Z / Cmd+Shift+Z.', 'Hoàn tác / làm lại: Ctrl+Z / Cmd+Z, Ctrl+Shift+Z / Cmd+Shift+Z.', '실행 취소 / 다시 실행: Ctrl+Z / Ctrl+Shift+Z'))
    }
    const h = new History<MapState>(take, apply, same, 40)
    this.history = h
    const aside = document.querySelector('aside'); if (aside !== null) h.watch(aside as HTMLElement)
    // drags on the view: brushes, placing, the gizmo, the eraser (not while just playing)
    h.watch_canvas(this.renderer.domElement, () => this.editing || this.map.tool !== 'none')
    this.map.on_edit_start = () => { h.commit(); h.begin() } // the map editor takes its clicks before the canvas sees them
    // keys that edit: Delete, Z (turn), Shift+D (copy)
    addEventListener('keydown', e => { if (!e.ctrlKey && !e.metaKey && (e.code === 'Delete' || e.code === 'Backspace' || ((e.code === 'KeyZ' || e.code === 'KeyX') && (this.editing || this.map.tool === 'place')) || (e.code === 'KeyD' && e.shiftKey))) h.begin() }, true)
    addEventListener('keyup', () => h.commit_soon())
    // a new file / AI tool call: everything else that changes the map goes through autosave
    h.bind_keys(() => !(this.plan_ed?.is_open() ?? false)) // the 2D plan editor has its own undo while it is open
    $('pt-undo').onclick = () => h.undo(); $('pt-redo').onclick = () => h.redo()
    const upd = (): void => { ($('pt-undo') as HTMLButtonElement).disabled = !h.can_undo(); ($('pt-redo') as HTMLButtonElement).disabled = !h.can_redo() }
    h.on_change = upd; upd()
  }

  /* ---------------- map editor ---------------- */
  private set_editing (on: boolean): void {
    this.editing = on
    this.world.set_editing(on)
    if (!on && this.map.tool === 'select') this.map.set_tool('none')
    $('pt-edit').classList.toggle('on', on)
    $('pt-edit-tools').style.display = on ? 'flex' : 'none'
    this.status(on
      ? M('Editing the map: click a prop to select it, drag the arrows / rings. Right-drag turns the camera. Esc: done.', 'Đang sửa map: bấm vào vật để chọn, kéo mũi tên / vòng xoay. Kéo chuột phải để xoay camera. Esc: xong.', '맵 편집 중: 소품을 클릭해 선택하고 화살표/링을 드래그하세요. 오른쪽 드래그로 카메라 회전. Esc: 완료.')
      : M('Playing.', 'Đang chơi.', '플레이 중.'))
  }

  private set_edit_mode (m: EditMode): void {
    this.world.set_mode(m)
    document.querySelectorAll<HTMLButtonElement>('[data-tmode]').forEach(b => b.classList.toggle('on', b.dataset.tmode === m))
  }

  /** where to drop a new prop: a few metres in front of the player */
  private spawn_point (): THREE.Vector3 {
    const r = this.ctrl?.root ?? this.car?.root ?? this.pawn ?? undefined
    if (r === undefined) return new THREE.Vector3(0, 0, 4)
    const yaw = this.ctrl?.yaw ?? this.car?.yaw ?? 0
    return r.position.clone().add(new THREE.Vector3(Math.sin(yaw) * 5, 0, Math.cos(yaw) * 5)).setY(0)
  }

  /** a dropped / loaded file: animated -> character or vehicle, still -> prop */
  private async load_any (buf: ArrayBuffer, name: string, as_prop = false): Promise<void> {
    if (!as_prop) {
      let animated = false
      try {
        animated = (await load_any_buffer(name, buf.slice(0))).clips.length > 0
      } catch { /* let load_buffer report it */ }
      if (animated) { await this.load_buffer(buf, name); return }
    }
    try {
      const o = await this.world.add_file(buf, name, this.spawn_point())
      if (!this.editing) this.set_editing(true)
      this.world.select(o); this.world.drop_to_ground(o)
      this.status(M(`Added ${o.name} to the map. Move / turn / scale it, then press Play.`, `Đã thêm ${o.name} vào map. Di chuyển / xoay / phóng to rồi bấm Chơi.`, `${o.name}을(를) 맵에 추가했습니다. 이동/회전/크기 조절 후 플레이를 누르세요.`))
    } catch (e) { this.status(M('Could not read the file: ', 'Không đọc được file: ', '파일을 읽을 수 없습니다: ') + String(e), true) }
  }

  /* ---------------- input ---------------- */
  private bind (): void {
    const el = this.renderer.domElement
    el.tabIndex = 0
    const file = $('pt-file') as HTMLInputElement
    $('pt-load').onclick = () => file.click()
    file.onchange = async () => { const f = file.files?.[0]; if (f !== undefined) await this.load_any(await f.arrayBuffer(), f.name); file.value = '' }
    addEventListener('dragover', e => e.preventDefault())
    addEventListener('drop', async e => { e.preventDefault(); for (const f of Array.from(e.dataTransfer?.files ?? [])) await this.load_any(await f.arrayBuffer(), f.name) })
    // map editor
    const pfile = $('pt-prop-file') as HTMLInputElement
    $('pt-add-prop').onclick = () => pfile.click()
    pfile.onchange = async () => { for (const f of Array.from(pfile.files ?? [])) await this.load_any(await f.arrayBuffer(), f.name, true); pfile.value = '' }
    $('pt-add-box').onclick = () => { const o = this.world.add_box(this.spawn_point(), new THREE.Vector3(2, 1, 2), 0xb7b7a4, 'Box'); if (!this.editing) this.set_editing(true); this.world.select(o) }
    $('pt-edit').onclick = () => this.set_editing(!this.editing)
    $('pt-wire').onclick = () => {
      const m = this.ctrl?.root ?? this.car?.root; if (m === undefined) return
      const on = !has_wire(m); set_wire(m, on); $('pt-wire').classList.toggle('on', on)
    }
    $('pt-face').onclick = () => {
      const r = this.ctrl?.root ?? this.car?.root; const m = r?.children[0]; if (m === undefined) return
      turn_model(m, Math.PI / 2); this.status(M('The model turned 90°: W should now go where its head looks.', 'Đã xoay model 90°: W giờ đi theo hướng đầu.', '모델 90° 회전'))
    }
    $('pt-ground-lock').onclick = () => {
      if (this.ctrl === null) return
      this.ctrl.ground_lock = !this.ctrl.ground_lock; $('pt-ground-lock').classList.toggle('on', this.ctrl.ground_lock)
    }
    document.querySelectorAll<HTMLButtonElement>('[data-tmode]').forEach(b => { b.onclick = () => this.set_edit_mode(b.dataset.tmode as EditMode) })
    $('pt-dup').onclick = () => { if (this.world.selected !== null) this.world.select(this.world.duplicate(this.world.selected)) }
    $('pt-del').onclick = () => { if (this.world.selected !== null) this.world.remove(this.world.selected) }
    ;($('pt-snap') as HTMLInputElement).onchange = (e) => { this.world.snap = (e.target as HTMLInputElement).checked }
    document.querySelectorAll<HTMLButtonElement>('[data-scheme]').forEach(b => { b.onclick = () => this.set_scheme(b.dataset.scheme as Scheme) })
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => { b.onclick = () => this.set_cam(b.dataset.cam as CamMode) })
    $('pt-rec').onclick = () => this.toggle_record()
    $('pt-rec-shots').onclick = () => {
      if (this.rig.shots.length === 0) { this.status(M('Save a few camera shots first (📌).', 'Lưu vài shot camera trước (📌).', '먼저 카메라 샷을 저장하세요.'), true); return }
      if (this.recorder !== null) return
      this.rec_shots = true; this.toggle_record(); this.rig.play()
    }
    // on-screen buttons (mobile scheme)
    const hold = (id: string, key: string): void => {
      const b = $(id)
      b.onpointerdown = (e) => { e.preventDefault(); this.keys.add(key); this.pressed.add(key) }
      b.onpointerup = b.onpointerleave = () => { this.keys.delete(key) }
    }
    hold('pt-b-attack', 'mouse_attack'); hold('pt-b-jump', 'space'); hold('pt-b-roll', 'roll'); hold('pt-b-block', 'mouse_block')

    addEventListener('keydown', e => {
      const t = e.target as HTMLElement; if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      const k = e.code
      // Z / X: turn what you are working on (Z one way, X the other) — the object about to be placed, the selected prop, else the player
      if ((k === 'KeyZ' || k === 'KeyX') && !e.ctrlKey && !e.metaKey && (k === 'KeyZ' || this.editing || this.map.tool === 'place' || this.ctrl !== null || this.car !== null)) {
        const step = (e.altKey ? Math.PI / 2 : Math.PI / 12) * (e.shiftKey ? -1 : 1) * (k === 'KeyX' ? -1 : 1)
        e.preventDefault()
        if (this.map.tool === 'place') { this.map.turn_next(step); return }
        if (this.editing && this.world.selected !== null) { this.world.selected.rotation.y += step; this.world.refresh(); this.map.autosave_now(); return }
        if (this.ctrl !== null) { this.ctrl.yaw += step * 3; this.ctrl.root.rotation.y = this.ctrl.yaw; return }
        if (this.car !== null) { this.car.yaw += step * 3; this.car.root.rotation.y = this.car.yaw; return }
        return
      }
      if (k === 'KeyF' && !e.ctrlKey && !e.metaKey) {
        if (this.editing && this.world.selected !== null) { const b = new THREE.Box3().setFromObject(this.world.selected); this.rig.focus(b.getCenter(new THREE.Vector3()), b.getSize(new THREE.Vector3()).length()); return }
        if (this.rig.free || this.rig.playing()) { this.rig.stop(); this.rig.exit_free(); return }
      }
      if (this.editing) {
        if (k === 'Escape') this.set_editing(false)
        if (k === 'KeyG' || k === 'KeyW') this.set_edit_mode('translate')
        if (k === 'KeyR' || k === 'KeyE') this.set_edit_mode('rotate')
        if (k === 'KeyS') this.set_edit_mode('scale')
        if ((k === 'Delete' || k === 'Backspace') && this.world.selected !== null) { e.preventDefault(); this.world.remove(this.world.selected) }
        if (k === 'KeyD' && e.shiftKey && this.world.selected !== null) this.world.select(this.world.duplicate(this.world.selected))
        return
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(k)) e.preventDefault()
      if (!this.keys.has(k)) this.pressed.add(k)
      this.keys.add(k)
    })
    addEventListener('keyup', e => { this.keys.delete(e.code) })
    addEventListener('blur', () => { this.keys.clear(); this.mouse_block = false })
    el.addEventListener('contextmenu', e => e.preventDefault())
    let last_click = 0
    el.addEventListener('pointerdown', e => {
      el.focus()
      if (this.editing) {
        if (e.button === 2) { this.orbit_drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); return }
        if (e.button === 1) return // the free camera
        if (e.button === 0 && !this.world.dragging()) {
          const r = el.getBoundingClientRect()
          const hit = this.world.pick(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.camera)
          // a click on empty space keeps the selection when it lands on the gizmo
          if (hit !== null || !(this.world as any).gizmo?.axis) this.world.select(hit)
        }
        return
      }
      if (e.button === 1) return // the free camera (CameraRig)
      if (this.scheme === 'mobile' && e.button === 2) { this.orbit_drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); return }
      if (this.scheme === 'pc') {
        if (e.button === 0) this.mouse_attack = true
        if (e.button === 2) this.mouse_block = true
      } else if (e.button === 0) {
        const p = this.ground_point(e); if (p === null) return
        const now = performance.now(); this.sprint_to_target = now - last_click < 320; last_click = now
        this.move_target = p; this.marker.position.set(p.x, 0.02, p.z); this.marker.visible = true
      }
    })
    el.addEventListener('pointermove', e => {
      if (this.orbit_drag === null) return
      this.cam_yaw -= (e.clientX - this.orbit_drag.x) * 0.008
      this.cam_pitch = Math.min(1.3, Math.max(0.05, this.cam_pitch + (e.clientY - this.orbit_drag.y) * 0.005))
      this.orbit_drag = { x: e.clientX, y: e.clientY }
    })
    addEventListener('pointerup', e => { if (e.button === 2) this.mouse_block = false; this.orbit_drag = null })
    el.addEventListener('wheel', e => {
      e.preventDefault()
      // Mac trackpad: two-finger swipe turns the camera, pinch zooms smoothly (a mouse wheel zooms in steps)
      if (is_trackpad(e) && !this.rig.free) { this.cam_yaw -= e.deltaX * 0.006; this.cam_pitch = Math.min(1.45, Math.max(-0.2, this.cam_pitch + e.deltaY * 0.004)); return }
      if (e.ctrlKey) { const f = pinch_factor(e); if (this.rig.free) { this.rig.dolly(f > 1 ? -1 : 1); return } this.cam_dist = Math.min(60, Math.max(1.5, this.cam_dist / f)); return }
      if (this.rig.free) { this.rig.dolly(Math.sign(e.deltaY)); return }
      this.cam_dist = Math.min(60, Math.max(1.5, this.cam_dist * (1 + Math.sign(e.deltaY) * 0.1)))
    }, { passive: false })
    this.set_scheme('pc')
    on_lang_change(() => this.set_scheme(this.scheme))
  }

  private set_scheme (s: Scheme): void {
    this.scheme = s
    document.querySelectorAll<HTMLButtonElement>('[data-scheme]').forEach(b => b.classList.toggle('on', b.dataset.scheme === s))
    $('pt-pad').style.display = s === 'mobile' ? 'flex' : 'none'
    $('pt-help').innerHTML = s === 'pc'
      ? M('<b>WASD</b> move · <b>Shift</b> sprint · <b>Alt</b> walk · <b>Space</b> jump · <b>Shift+Space</b> roll · <b>Left click</b> attack (click again = combo) · <b>Right click</b> hold = block · <b>C</b> crouch · <b>H</b> get hit · <b>Q/E</b> or middle-drag: camera · wheel: zoom',
        '<b>WASD</b> di chuyển · <b>Shift</b> chạy nhanh · <b>Alt</b> đi bộ · <b>Space</b> nhảy · <b>Shift+Space</b> lộn · <b>Chuột trái</b> tấn công (bấm tiếp = combo) · <b>Giữ chuột phải</b> đỡ đòn · <b>C</b> cúi · <b>H</b> bị đánh · <b>Q/E</b> hoặc kéo chuột giữa: xoay camera · lăn: zoom',
        '<b>WASD</b> 이동 · <b>Shift</b> 질주 · <b>Alt</b> 걷기 · <b>Space</b> 점프 · <b>Shift+Space</b> 구르기 · <b>왼쪽 클릭</b> 공격 (연타 = 콤보) · <b>오른쪽 클릭 유지</b> 방어 · <b>C</b> 앉기 · <b>H</b> 피격 · <b>Q/E</b> 또는 가운데 드래그: 카메라 · 휠: 줌')
      : M('<b>Click the ground</b> to run there · <b>double click</b> = sprint · buttons: attack / jump / roll / block · right-drag: camera',
        '<b>Bấm xuống đất</b> để chạy tới đó · <b>bấm đúp</b> = chạy nhanh · nút: tấn công / nhảy / lộn / đỡ · kéo chuột phải: xoay camera',
        '<b>땅을 클릭</b>하면 그곳으로 달림 · <b>더블 클릭</b> = 질주 · 버튼: 공격 / 점프 / 구르기 / 방어 · 오른쪽 드래그: 카메라')
  }

  private set_cam (m: CamMode): void {
    this.rig.stop(); this.rig.exit_free()
    this.cam_mode = m
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === m))
    if (m === 'top') { this.cam_pitch = 1.25; this.cam_dist = 9 } else if (m === 'side') { this.cam_pitch = 0.12; this.cam_dist = 6 } else { this.cam_pitch = 0.32; this.cam_dist = 4.2 }
  }

  private ground_point (e: PointerEvent): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    const rc = new THREE.Raycaster()
    rc.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.camera)
    return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
  }

  private read_input (): Input {
    const k = (c: string): boolean => this.keys.has(c)
    const p = (c: string): boolean => this.pressed.has(c)
    const move = new THREE.Vector2()
    let sprint = k('ShiftLeft') || k('ShiftRight')
    if (this.scheme === 'pc') {
      if (k('KeyW') || k('ArrowUp')) move.y += 1
      if (k('KeyS') || k('ArrowDown')) move.y -= 1
      if (k('KeyA') || k('ArrowLeft')) move.x -= 1
      if (k('KeyD') || k('ArrowRight')) move.x += 1
    } else if (this.move_target !== null && this.ctrl !== null) {
      const d = this.move_target.clone().sub(this.ctrl.root.position); d.y = 0
      if (d.length() < 0.25) { this.move_target = null; this.marker.visible = false } else {
        d.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.cam_yaw)
        move.set(d.x, -d.z); sprint = this.sprint_to_target
      }
    }
    if (k('KeyQ')) this.cam_yaw += 0.03
    if (k('KeyE')) this.cam_yaw -= 0.03
    const shift = k('ShiftLeft') || k('ShiftRight')
    const jump_key = p('Space') || p('Backspace') || p('space')
    const input: Input = {
      move: move.lengthSq() > 1 ? move.normalize() : move,
      sprint: sprint && !(jump_key && shift),
      walk: k('AltLeft') || k('AltRight'),
      jump: jump_key && !shift,
      roll: (jump_key && shift) || p('roll'),
      attack: this.mouse_attack || p('mouse_attack') || p('KeyJ'),
      block: this.mouse_block || k('mouse_block') || k('KeyK'),
      crouch_toggle: p('KeyC') || p('ControlLeft'),
      hit_test: p('KeyH')
    }
    this.pressed.clear(); this.mouse_attack = false
    return input
  }

  /* ---------------- gameplay bits ---------------- */
  private try_hit (reach: number): void {
    if (this.dummy === null || this.ctrl === null) return
    const to = this.dummy.position.clone().sub(this.ctrl.root.position); to.y = 0
    const fwd = new THREE.Vector3(Math.sin(this.ctrl.yaw), 0, Math.cos(this.ctrl.yaw))
    if (to.length() < reach + 0.3 && to.normalize().dot(fwd) > 0.3) {
      this.dummy_wobble = 1
      this.dummy.userData.dir = fwd
      this.float_text('HIT!')
    }
  }

  private float_text (t: string): void {
    const d = document.createElement('div'); d.className = 'pt-float'; d.textContent = t
    const v = this.dummy!.position.clone().add(new THREE.Vector3(0, 2.1, 0)).project(this.camera)
    const r = this.renderer.domElement.getBoundingClientRect()
    d.style.left = `${(v.x + 1) / 2 * r.width}px`; d.style.top = `${(1 - v.y) / 2 * r.height}px`
    $('pt-view').appendChild(d); setTimeout(() => d.remove(), 700)
  }

  private collide (): void {
    if (this.ctrl === null) return
    const p = this.ctrl.root.position
    // the training dummy is solid (props are handled by the map's walls / floors)
    if (this.dummy !== null) {
      const dx = p.x - this.dummy.position.x; const dz = p.z - this.dummy.position.z; const d = Math.hypot(dx, dz)
      if (d < 0.55 && d > 1e-5) { p.x = this.dummy.position.x + dx / d * 0.55; p.z = this.dummy.position.z + dz / d * 0.55 }
    }
  }

  /* ---------------- loop ---------------- */
  private tick (): void {
    this.timer.update()
    const dt = Math.min(0.05, this.timer.getDelta())
    this.last_dt = dt
    const input = this.editing ? NO_INPUT : this.read_input()
    if (this.ctrl !== null) {
      this.ctrl.update(dt, input, this.cam_yaw)
      // pushing into a low wall for a moment (or jumping at it) climbs it
      if (this.ledge !== null && !this.ctrl.is_climbing() && (this.push_t > 0.25 || input.jump)) { this.ctrl.start_climb(this.ledge); this.ledge = null; this.push_t = 0 }
      this.collide()
      $('pt-state').textContent = this.ctrl.state()
    }
    if (this.car !== null) {
      const k = (c: string): boolean => this.keys.has(c) && !this.editing
      this.car.update(dt, {
        throttle: (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
        steer: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
        brake: k('Space')
      })
      this.pressed.clear()
      $('pt-state').textContent = this.car.state()
    }
    this.move_pawn(dt, input)
    this.playable?.update(dt)
    if (this.dummy !== null) {
      const top = this.dummy.userData.top as THREE.Group
      const dir = (this.dummy.userData.dir as THREE.Vector3 | undefined) ?? new THREE.Vector3(0, 0, 1)
      this.dummy_wobble *= Math.exp(-dt * 3)
      const a = Math.sin(performance.now() * 0.018) * this.dummy_wobble * 0.5
      top.rotation.set(dir.z * a, 0, -dir.x * a)
    }
    this.update_camera(dt)
    this.renderer.render(this.scene, this.camera)
    this.place_notes()
  }

  /* ---------------- 📝 notes: click a map block that has a note → a bubble over it (Roboto: Vietnamese / Korean) ---------------- */
  private readonly notes = new Map<THREE.Object3D, HTMLDivElement>()
  private note_click (e: PointerEvent): void {
    const el = this.renderer.domElement, r = el.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.camera)
    for (const h of ray.intersectObjects(this.world.props.children, true)) {
      let o: THREE.Object3D | null = h.object; while (o !== null && o.userData.map_extra === undefined) o = o.parent
      const note = (o?.userData.map_extra as { note?: string } | undefined)?.note; if (o === null) continue
      if (note === undefined || note.trim() === '') return
      const old = this.notes.get(o); if (old !== undefined) { old.remove(); this.notes.delete(o); return } // a second click hides it
      const d = document.createElement('div'); d.className = 'pt-note'; d.textContent = note
      d.onclick = () => { d.remove(); this.notes.delete(o as THREE.Object3D) }
      $('pt-view').appendChild(d); this.notes.set(o, d); return
    }
  }
  private place_notes (): void {
    if (this.notes.size === 0) return
    const el = this.renderer.domElement, v = new THREE.Vector3()
    this.notes.forEach((d, o) => {
      if (o.parent === null) { d.remove(); this.notes.delete(o); return }
      const b = new THREE.Box3().setFromObject(o); v.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(this.camera)
      d.style.display = v.z > 1 ? 'none' : ''; d.style.left = ((v.x + 1) / 2 * el.clientWidth) + 'px'; d.style.top = ((1 - v.y) / 2 * el.clientHeight) + 'px'
    })
  }

  private follow_target (): THREE.Vector3 {
    const who = this.ctrl?.root ?? this.car?.root ?? this.pawn ?? undefined
    return who !== undefined ? who.position.clone().add(new THREE.Vector3(0, this.car !== null ? 1.4 : 1.2, 0)) : new THREE.Vector3(0, 1, 0)
  }

  private update_camera (dt: number): void {
    // fog starts behind what you look at: a far free camera / a wide shot still sees the whole map
    const fog = this.scene.fog as THREE.Fog; const vd = this.rig.free || this.rig.playing() ? this.rig.view_dist() : this.cam_dist
    fog.near = Math.max(25, vd * 1.3); fog.far = Math.max(70, vd * 3.2)
    if (this.rig.update(dt)) return
    const target = this.follow_target()
    let yaw = this.cam_yaw
    // driving: the camera follows behind the vehicle unless the user turns it
    if (this.car !== null && this.cam_mode === 'third' && this.orbit_drag === null && !this.editing) this.cam_yaw += (Math.atan2(Math.sin(this.car.yaw + Math.PI - this.cam_yaw), Math.cos(this.car.yaw + Math.PI - this.cam_yaw))) * (1 - Math.exp(-2 * dt))
    if (this.cam_mode === 'side') yaw = Math.PI / 2
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.cam_pitch), Math.sin(this.cam_pitch), Math.cos(yaw) * Math.cos(this.cam_pitch)).multiplyScalar(this.cam_dist)
    const want = target.clone().add(off)
    this.camera.position.lerp(want, 1 - Math.exp(-8 * dt))
    this.camera.lookAt(target)
  }

  private resize (): void {
    const v = $('pt-view'); const w = v.clientWidth; const h = v.clientHeight
    this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix()
  }

  /* ---------------- record the view (for ad footage) ---------------- */
  private toggle_record (): void {
    const b = $('pt-rec')
    if (this.recorder !== null) { this.recorder.stop(); return }
    const stream = this.renderer.domElement.captureStream(60)
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) ?? ''
    const rec = new MediaRecorder(stream, type !== '' ? { mimeType: type, videoBitsPerSecond: 12_000_000 } : undefined)
    const parts: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size > 0) parts.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `greenbox-playtest.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      this.recorder = null; b.classList.remove('on'); b.textContent = '⏺ ' + M('Record', 'Quay', '녹화')
    }
    rec.start(); this.recorder = rec
    b.classList.add('on'); b.textContent = '⏹ ' + M('Stop', 'Dừng', '정지')
    this.renderer.domElement.focus()
  }

  private status (t: string, warn = false): void { const s = $('pt-status'); s.textContent = t; s.className = warn ? 'warn' : '' }
}

;(window as any).__playtest = new PlaytestApp()
