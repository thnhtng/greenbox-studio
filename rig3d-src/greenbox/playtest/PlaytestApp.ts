/*
 * Greenbox 3D — Play test. Drop in a rigged character (or send one from "Use Your Model") and play it like a game:
 *   PC     : WASD move · Shift sprint · Alt walk · Space jump · Shift+Space roll · left click attack (combo)
 *            · right click (hold) block · C crouch · H hit reaction · wheel zoom · middle-drag / Q E turn camera
 *   Mobile : click / tap the ground to run there (double click = sprint) · buttons for attack, jump, roll, block
 * Camera presets for ad shots: third person, top-down, side view. ⏺ records the canvas to a video file.
 */
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

type Scheme = 'pc' | 'mobile'
const NO_INPUT: Input = { move: new THREE.Vector2(), sprint: false, walk: false, jump: false, roll: false, attack: false, block: false, crouch_toggle: false, hit_test: false }
type CamMode = 'third' | 'top' | 'side'

class PlaytestApp {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500)
  private readonly clock = new THREE.Clock()
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
  private recorder: MediaRecorder | null = null

  constructor () {
    const view = $('pt-view')
    view.appendChild(this.renderer.domElement)
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio)) // retina at 2x costs 4x the pixels: 1.5 looks the same while working
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
    this.make_props()
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
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 30); tex.colorSpace = THREE.SRGBColorSpace
    const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ map: tex }))
    m.rotation.x = -Math.PI / 2; m.receiveShadow = true
    return m
  }

  private make_props (): void {
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z)
    this.world.add_box(V(5, 0, -4), V(2, 1, 2), 0xd9a35c, 'Crate (climb me)')
    this.world.add_box(V(-6, 0, -6), V(3, 2, 1.2), 0xc7c7c7, 'Wall 2 m')
    this.world.add_box(V(-4, 0, 6), V(1.2, 0.4, 1.2), 0xe07a5f, 'Step')
    this.world.add_box(V(8, 0, 6), V(1, 3, 6), 0x8e9aaf, 'Tall wall')
    this.world.add_box(V(0, 0, -12), V(10, 0.6, 1), 0xb5838d, 'Ledge')
    // a ramp to walk up
    const ramp = this.world.add_box(V(-9, 0, 2), V(2.5, 0.25, 6), 0x9c8f6b, 'Ramp')
    ramp.rotation.x = -0.28; ramp.position.y = 3 * Math.sin(0.28); this.world.refresh()
    // training dummy: something to hit
    const d = new THREE.Group()
    const mat = new THREE.MeshLambertMaterial({ color: 0xc8a165 })
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6), new THREE.MeshLambertMaterial({ color: 0x6b4f2a })); post.position.y = 0.3
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.9, 16), mat); body.position.y = 1.05
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat); head.position.y = 1.7
    const top = new THREE.Group(); top.add(body, head)
    ;[post, body, head].forEach(o => { o.castShadow = true })
    d.add(post, top); d.position.set(0, 0, -3); d.userData.top = top
    this.scene.add(d); this.dummy = d
  }

  /* ---------------- loading ---------------- */
  private async boot (): Promise<void> {
    on_handoff('playtest', () => { void handoff_take('playtest').then(h => { if (h !== null) void this.load_buffer(h.data, h.name) }) })
    const h = await handoff_take('playtest')
    if (h !== null) { await this.load_buffer(h.data, h.name); return }
    this.status(M('Drop a rigged character (GLB/FBX with animations), or press "Play test" after rigging in Use Your Model.', 'Thả nhân vật đã gắn xương (GLB/FBX có animation), hoặc bấm "Chơi thử" sau khi gắn xương ở Dùng model của bạn.', '리깅된 캐릭터(애니메이션 포함 GLB/FBX)를 넣거나, Use Your Model에서 리깅 후 "플레이 테스트"를 누르세요.'), true)
  }

  private async load_buffer (buf: ArrayBuffer, name: string): Promise<void> {
    try {
      let root: THREE.Object3D; let clips: THREE.AnimationClip[]
      if (/\.fbx$/i.test(name)) { const f = new FBXLoader().parse(buf, ''); root = f; clips = f.animations }
      else { const g = await new GLTFLoader().parseAsync(buf, ''); root = g.scene; clips = g.animations }
      this.set_character(root, clips, name)
    } catch (e) {
      this.status(M('Could not read the file: ', 'Không đọc được file: ', '파일을 읽을 수 없습니다: ') + String(e), true)
    }
  }

  private set_character (model: THREE.Object3D, clips: THREE.AnimationClip[], name: string): void {
    if (this.ctrl !== null) { this.scene.remove(this.ctrl.root); this.ctrl = null }
    if (this.car !== null) { this.scene.remove(this.car.root); this.car = null }
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
    const b2 = new THREE.Box3().setFromObject(model)
    model.position.x -= (b2.min.x + b2.max.x) / 2; model.position.z -= (b2.min.z + b2.max.z) / 2; model.position.y -= b2.min.y
    strip_root_motion(clips, model)
    const table = map_clips(clips)
    if (table.climb_up !== undefined) strip_vertical_motion(table.climb_up, model)
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

  /* ---------------- map editor ---------------- */
  private set_editing (on: boolean): void {
    this.editing = on
    this.world.set_editing(on)
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
    const r = this.ctrl?.root ?? this.car?.root
    if (r === undefined) return new THREE.Vector3(0, 0, 4)
    const yaw = this.ctrl?.yaw ?? this.car?.yaw ?? 0
    return r.position.clone().add(new THREE.Vector3(Math.sin(yaw) * 5, 0, Math.cos(yaw) * 5)).setY(0)
  }

  /** a dropped / loaded file: animated -> character or vehicle, still -> prop */
  private async load_any (buf: ArrayBuffer, name: string, as_prop = false): Promise<void> {
    if (!as_prop) {
      let animated = false
      try {
        if (/\.fbx$/i.test(name)) { const f = new FBXLoader().parse(buf.slice(0), ''); animated = f.animations.length > 0 } else { const g = await new GLTFLoader().parseAsync(buf.slice(0), ''); animated = g.animations.length > 0 }
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
    document.querySelectorAll<HTMLButtonElement>('[data-tmode]').forEach(b => { b.onclick = () => this.set_edit_mode(b.dataset.tmode as EditMode) })
    $('pt-dup').onclick = () => { if (this.world.selected !== null) this.world.select(this.world.duplicate(this.world.selected)) }
    $('pt-del').onclick = () => { if (this.world.selected !== null) this.world.remove(this.world.selected) }
    ;($('pt-snap') as HTMLInputElement).onchange = (e) => { this.world.snap = (e.target as HTMLInputElement).checked }
    document.querySelectorAll<HTMLButtonElement>('[data-scheme]').forEach(b => { b.onclick = () => this.set_scheme(b.dataset.scheme as Scheme) })
    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => { b.onclick = () => this.set_cam(b.dataset.cam as CamMode) })
    $('pt-rec').onclick = () => this.toggle_record()
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
        if (e.button === 2 || e.button === 1) { this.orbit_drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); return }
        if (e.button === 0 && !this.world.dragging()) {
          const r = el.getBoundingClientRect()
          const hit = this.world.pick(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.camera)
          // a click on empty space keeps the selection when it lands on the gizmo
          if (hit !== null || !(this.world as any).gizmo?.axis) this.world.select(hit)
        }
        return
      }
      if (e.button === 1 || (this.scheme === 'mobile' && e.button === 2)) { this.orbit_drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); return }
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
    el.addEventListener('wheel', e => { e.preventDefault(); this.cam_dist = Math.min(30, Math.max(1.5, this.cam_dist * (1 + Math.sign(e.deltaY) * 0.1))) }, { passive: false })
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
    const dt = Math.min(0.05, this.clock.getDelta())
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
    if (this.dummy !== null) {
      const top = this.dummy.userData.top as THREE.Group
      const dir = (this.dummy.userData.dir as THREE.Vector3 | undefined) ?? new THREE.Vector3(0, 0, 1)
      this.dummy_wobble *= Math.exp(-dt * 3)
      const a = Math.sin(performance.now() * 0.018) * this.dummy_wobble * 0.5
      top.rotation.set(dir.z * a, 0, -dir.x * a)
    }
    this.update_camera(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private update_camera (dt: number): void {
    const who = this.ctrl?.root ?? this.car?.root
    const target = who !== undefined ? who.position.clone().add(new THREE.Vector3(0, this.car !== null ? 1.4 : 1.2, 0)) : new THREE.Vector3(0, 1, 0)
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
