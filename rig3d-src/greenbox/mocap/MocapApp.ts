/*
 * Greenbox 3D — Video mocap. A video of one person -> an animation clip on your rigged character.
 * 1. load a video (one person, whole body visible, camera still)   2. pick the character (mannequin, a rigged
 * GLB/FBX, or the one you just rigged)   3. Analyse (MediaPipe Pose, in the browser)   4. tune smoothing / in place
 * 5. export GLB / FBX with the clip.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import { PoseTracker, type PoseFrame, BONES_2D } from './PoseTracker.ts'
import { find_rig, landmarks_to_clip, type Rig } from './Retarget.ts'
import { build_mannequin } from '../common/Mannequin.ts'
import { handoff_take, on_handoff } from '../common/Handoff.ts'
import { M } from '../common/lang.ts'

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

class MocapApp {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200)
  private readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly video = document.createElement('video')
  private readonly overlay = document.createElement('canvas')
  private character: THREE.Object3D | null = null
  private rig: Rig | null = null
  private mixer: THREE.AnimationMixer | null = null
  private clip: THREE.AnimationClip | null = null
  private frames: PoseFrame[] = []
  private fps = 30
  private tracker: PoseTracker | null = null
  private cancel = false
  private busy = false

  constructor () {
    const v3 = $('mc-3d')
    v3.appendChild(this.renderer.domElement)
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio)) // retina at 2x costs 4x the pixels: 1.5 looks the same while working
    this.scene.background = new THREE.Color(0x393939)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(3, 6, 4); this.scene.add(sun)
    this.scene.add(new THREE.GridHelper(10, 20, 0x5a5a5a, 0x474747))
    this.camera.position.set(1.8, 1.4, 3.4)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.9, 0)
    const vb = $('mc-video')
    this.video.muted = true; this.video.playsInline = true; this.video.controls = true; this.video.preload = 'auto'
    vb.appendChild(this.video); vb.appendChild(this.overlay)
    this.video.addEventListener('timeupdate', () => this.draw_overlay())
    this.video.addEventListener('seeked', () => this.draw_overlay())
    addEventListener('resize', () => this.resize()); this.resize()
    this.bind()
    this.renderer.setAnimationLoop(() => {
      this.mixer?.update(this.clock.getDelta())
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    })
    void this.boot()
  }

  private async boot (): Promise<void> {
    on_handoff('mocap', () => { void handoff_take('mocap').then(h => { if (h !== null) void this.load_character(h.data, h.name) }) })
    const h = await handoff_take('mocap')
    if (h !== null) await this.load_character(h.data, h.name)
    else await this.use_mannequin()
    this.status(M('1) Load a video of one person (whole body in view, camera not moving). 2) Analyse.', '1) Nạp video có 1 người (thấy toàn thân, camera đứng yên). 2) Bấm Phân tích.', '1) 한 사람이 나오는 영상을 넣으세요 (전신, 카메라 고정). 2) 분석.'))
  }

  /* ---------------- UI ---------------- */
  private bind (): void {
    const vf = $('mc-vfile') as HTMLInputElement; const cf = $('mc-cfile') as HTMLInputElement
    $('mc-vload').onclick = () => vf.click(); $('mc-cload').onclick = () => cf.click()
    vf.onchange = () => { const f = vf.files?.[0]; if (f !== undefined) this.load_video(f); vf.value = '' }
    cf.onchange = async () => { const f = cf.files?.[0]; if (f !== undefined) await this.load_character(await f.arrayBuffer(), f.name); cf.value = '' }
    $('mc-mannequin').onclick = () => { void this.use_mannequin() }
    $('mc-run').onclick = () => { void this.analyse() }
    $('mc-cancel').onclick = () => { this.cancel = true }
    ;($('mc-smooth') as HTMLInputElement).oninput = () => { $('mc-smooth-v').textContent = ($('mc-smooth') as HTMLInputElement).value; this.rebuild() }
    ;($('mc-inplace') as HTMLInputElement).onchange = () => this.rebuild()
    ;($('mc-back') as HTMLInputElement).onchange = () => this.rebuild()
    $('mc-glb').onclick = () => { void this.export('glb') }
    $('mc-fbx').onclick = () => { void this.export('fbx') }
    addEventListener('dragover', e => e.preventDefault())
    addEventListener('drop', async e => {
      e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f === undefined) return
      if (/\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(f.name) || f.type.startsWith('video/')) this.load_video(f)
      else await this.load_character(await f.arrayBuffer(), f.name)
    })
  }

  private load_video (f: File): void {
    this.video.src = URL.createObjectURL(f)
    this.video.onloadedmetadata = () => {
      ($('mc-t0') as HTMLInputElement).value = '0'
      ;($('mc-t1') as HTMLInputElement).value = this.video.duration.toFixed(2)
      this.resize()
      this.status(M(`Video: ${f.name}, ${this.video.duration.toFixed(1)} s. Press Analyse.`, `Video: ${f.name}, ${this.video.duration.toFixed(1)} giây. Bấm Phân tích.`, `영상: ${f.name}, ${this.video.duration.toFixed(1)}초. 분석을 누르세요.`))
    }
  }

  private async use_mannequin (): Promise<void> {
    try { this.set_character(await build_mannequin(), 'Mannequin') } catch (e) { this.status(String(e), true) }
  }

  private async load_character (buf: ArrayBuffer, name: string): Promise<void> {
    try {
      const root = /\.fbx$/i.test(name) ? new FBXLoader().parse(buf, '') : (await new GLTFLoader().parseAsync(buf, '')).scene
      this.set_character(root, name)
    } catch (e) { this.status(M('Could not read the character: ', 'Không đọc được nhân vật: ', '캐릭터를 읽을 수 없습니다: ') + String(e), true) }
  }

  private set_character (root: THREE.Object3D, name: string): void {
    if (this.character !== null) this.scene.remove(this.character)
    this.mixer?.stopAllAction()
    root.traverse(o => { (o as THREE.Mesh).frustumCulled = false })
    this.character = root; this.scene.add(root)
    const rig = find_rig(root)
    const need = ['hips', 'chest', 'head', 'upperarm_l', 'forearm_l', 'thigh_l', 'calf_l', 'upperarm_r', 'thigh_r']
    const miss = need.filter(s => !(s in rig.slot))
    this.rig = rig
    $('mc-char').textContent = `${name} · ${rig.bones.length} ${M('bones', 'xương', '본')}` + (miss.length > 0 ? ` · ${M('not found', 'không thấy', '없음')}: ${miss.join(', ')}` : ' · ✓')
    // frame it
    const box = new THREE.Box3().setFromObject(root); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length()
    this.controls.target.copy(c); this.camera.position.copy(c).add(new THREE.Vector3(0.5, 0.25, 1).normalize().multiplyScalar(s * 1.4)); this.camera.near = s / 200; this.camera.updateProjectionMatrix()
    this.mixer = new THREE.AnimationMixer(root)
    if (this.frames.length > 0) this.rebuild()
  }

  /* ---------------- analyse ---------------- */
  private async analyse (): Promise<void> {
    if (this.busy) return
    if (!this.video.src) { this.status(M('Load a video first.', 'Nạp video trước đã.', '먼저 영상을 넣으세요.'), true); return }
    this.busy = true; this.cancel = false
    $('mc-run').setAttribute('disabled', ''); $('mc-cancel').style.display = ''
    try {
      if (this.tracker === null) {
        this.status(M('Loading the pose model…', 'Đang tải model nhận dáng người…', '포즈 모델 로딩 중…'))
        this.tracker = new PoseTracker()
        await this.tracker.init(($('mc-quality') as HTMLSelectElement).value === 'lite' ? 0 : 1)
      }
      this.fps = Number(($('mc-fps') as HTMLSelectElement).value)
      const t0 = Number(($('mc-t0') as HTMLInputElement).value) || 0
      const t1 = Math.min(this.video.duration, Number(($('mc-t1') as HTMLInputElement).value) || this.video.duration)
      this.video.pause()
      const started = performance.now()
      let found = 0
      this.frames = await this.tracker.track(this.video, this.fps, t0, t1, (p, f) => {
        if (f.world !== null) found++
        ;($('mc-bar') as HTMLElement).style.width = `${Math.round(p * 100)}%`
        this.status(M(`Analysing… ${Math.round(p * 100)}%`, `Đang phân tích… ${Math.round(p * 100)}%`, `분석 중… ${Math.round(p * 100)}%`))
        this.draw_frame(f)
      }, () => this.cancel)
      const secs = ((performance.now() - started) / 1000).toFixed(1)
      if (found === 0) { this.status(M('No person found in this video.', 'Không tìm thấy người trong video.', '영상에서 사람을 찾지 못했습니다.'), true); return }
      this.rebuild()
      this.status(M(`Done: ${this.frames.length} frames (${found} with a person) in ${secs} s. Check the 3D view, then export.`, `Xong: ${this.frames.length} khung hình (${found} có người) trong ${secs} giây. Xem khung 3D rồi xuất file.`, `완료: ${this.frames.length}프레임 (사람 ${found}) ${secs}초. 3D를 확인하고 내보내세요.`))
    } catch (e) {
      this.status(M('Analyse failed: ', 'Phân tích lỗi: ', '분석 실패: ') + String(e), true)
    } finally {
      this.busy = false; $('mc-run').removeAttribute('disabled'); $('mc-cancel').style.display = 'none'
    }
  }

  private rebuild (): void {
    if (this.rig === null || this.mixer === null || this.frames.length === 0) return
    this.mixer.stopAllAction()
    // retarget from the rest pose
    this.rig.bones.forEach(b => { (b as any).__gbRest ??= { q: b.quaternion.clone(), p: b.position.clone() }; b.quaternion.copy((b as any).__gbRest.q); b.position.copy((b as any).__gbRest.p) })
    const aspect = this.video.videoWidth > 0 ? this.video.videoWidth / this.video.videoHeight : 16 / 9
    this.clip = landmarks_to_clip(this.frames, this.rig, { fps: this.fps, smooth: Number(($('mc-smooth') as HTMLInputElement).value), in_place: ($('mc-inplace') as HTMLInputElement).checked, back_view: ($('mc-back') as HTMLInputElement).checked, image_aspect: aspect })
    this.mixer.clipAction(this.clip).reset().play()
    $('mc-export').classList.remove('disabled')
  }

  /* ---------------- overlay ---------------- */
  private draw_frame (f: PoseFrame): void {
    const c = this.overlay; const g = c.getContext('2d'); if (g === null) return
    g.clearRect(0, 0, c.width, c.height)
    if (f.img === null) return
    const r = this.video_rect()
    g.lineWidth = 3; g.strokeStyle = '#3cdc8c'; g.fillStyle = '#f5a623'
    BONES_2D.forEach(([a, b]) => {
      g.beginPath(); g.moveTo(r.x + f.img![a * 2] * r.w, r.y + f.img![a * 2 + 1] * r.h); g.lineTo(r.x + f.img![b * 2] * r.w, r.y + f.img![b * 2 + 1] * r.h); g.stroke()
    })
    for (let k = 11; k < 33; k++) { g.beginPath(); g.arc(r.x + f.img[k * 2] * r.w, r.y + f.img[k * 2 + 1] * r.h, 3, 0, Math.PI * 2); g.fill() }
  }

  private draw_overlay (): void {
    if (this.frames.length === 0) return
    const t0 = Number(($('mc-t0') as HTMLInputElement).value) || 0
    const i = Math.round((this.video.currentTime - t0) * this.fps)
    const f = this.frames[Math.min(this.frames.length - 1, Math.max(0, i))]
    if (f !== undefined) this.draw_frame(f)
  }

  /** where the picture actually sits inside the <video> box (letterboxing) */
  private video_rect (): { x: number, y: number, w: number, h: number } {
    const W = this.overlay.width; const H = this.overlay.height
    const a = this.video.videoWidth > 0 ? this.video.videoWidth / this.video.videoHeight : W / Math.max(1, H)
    let w = W; let h = W / a; if (h > H) { h = H; w = H * a }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h }
  }

  private resize (): void {
    const v = $('mc-3d'); this.renderer.setSize(v.clientWidth, v.clientHeight)
    this.camera.aspect = v.clientWidth / Math.max(1, v.clientHeight); this.camera.updateProjectionMatrix()
    const vb = $('mc-video'); this.overlay.width = vb.clientWidth; this.overlay.height = Math.max(1, vb.clientHeight - 40)
  }

  /* ---------------- export ---------------- */
  private async export (fmt: 'glb' | 'fbx'): Promise<void> {
    if (this.character === null || this.clip === null) return
    this.mixer?.stopAllAction()
    this.rig?.bones.forEach(b => { const r = (b as any).__gbRest; if (r !== undefined) { b.quaternion.copy(r.q); b.position.copy(r.p) } })
    const clip = this.clip.clone(); clip.name = ($('mc-name') as HTMLInputElement).value.trim().replace(/\s+/g, '_') || 'Video_Mocap'
    const scene = new THREE.Scene(); const parent = this.character.parent
    scene.add(this.character)
    try {
      let blob: Blob
      if (fmt === 'glb') {
        const buf = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [clip], onlyVisible: false }) as ArrayBuffer
        blob = new Blob([buf], { type: 'model/gltf-binary' })
      } else {
        scene.animations = [clip]
        const u8 = await new FBXExporter().parseAsync(scene, { preset: 'unity' as any, includeAnimations: true, animations: [clip], onlyVisible: false, embedTextures: true } as any)
        blob = new Blob([u8 as any], { type: 'application/octet-stream' })
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${clip.name}.${fmt}`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      this.status(M(`Saved ${clip.name}.${fmt}.`, `Đã lưu ${clip.name}.${fmt}.`, `${clip.name}.${fmt} 저장됨.`))
    } catch (e) { this.status(M('Export failed: ', 'Xuất lỗi: ', '내보내기 실패: ') + String(e), true) } finally {
      if (parent !== null) parent.add(this.character)
      if (this.mixer !== null && this.clip !== null) this.mixer.clipAction(this.clip).reset().play()
    }
  }

  private status (t: string, warn = false): void { const s = $('mc-status'); s.textContent = t; s.className = warn ? 'warn' : '' }
}

;(window as any).__mocap = new MocapApp()
