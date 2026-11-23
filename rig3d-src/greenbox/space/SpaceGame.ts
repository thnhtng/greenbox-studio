/*
 * SPACE FIGHTER: a fighter jet in space with a chase camera (the camera sits behind the jet and follows it).
 * One class for the Greenbox page (space.html, live preview) and for the exported playable (PlayableRuntime.ts
 * starts it when window.__GB_PLAYABLE.game === 'space').
 *   drag anywhere (or WASD / arrows) = steer; the guns fire on their own, with a little aim help
 *   shoot down `kills` enemy fighters, dodge their bolts and the asteroids; HP 0 = lost
 * The jet stays at z = 0; the world (stars, enemies, rocks) moves towards +z, so numbers never grow.
 * Everything is drawn in code (jet, enemies, rocks, nebula, planet): no asset, the playable stays ~1 MB.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface SpaceOpts {
  title?: string, lang?: string, cta?: string, cta_label?: string
  /** enemy fighters to shoot down to win */ kills?: number
  /** seconds; 0 = no limit */ limit?: number
  /** 0.6 easy … 1.6 hard: enemy fire rate and speed */ hard?: number
  /** jet accent colour */ color?: string
  /** nebula hue 0..360 */ hue?: number
  /** asteroids on / off */ rocks?: boolean
  /** own jet model: GLB as base64 (nose towards +z, as most models are) */ ship?: string | null
  /** plays by itself (demo / recording) */ auto?: boolean
  /** the CTA: default opens the store link */ on_cta?: (url: string) => void
}
interface Foe { o: THREE.Object3D, hp: number, t: number, seed: number, fire: number, hold: number, leave: number, ax: number, ay: number, alive: boolean }
interface Rock { o: THREE.Mesh, hp: number, r: number, v: THREE.Vector3, spin: THREE.Vector3, alive: boolean }
interface Bolt { o: THREE.Mesh, v: THREE.Vector3, alive: boolean, life: number }
interface Boom { o: THREE.Sprite, t: number, d: number, s: number }

const rnd = (a: number, b: number): number => a + Math.random() * (b - a)
const b64 = (s: string): ArrayBuffer => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer }

/** a soft round glow, used for engines, explosions, the sun */
function glow_tex (inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}

/** the sky: nebula clouds and far stars painted on one texture, wrapped round the camera */
function sky_tex (hue: number): THREE.CanvasTexture {
  const W = 2048; const H = 1024; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!
  g.fillStyle = '#03040b'; g.fillRect(0, 0, W, H)
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * W; const y = H * (0.18 + Math.random() * 0.64); const r = rnd(90, 330)
    const h = (hue + rnd(-45, 70) + 360) % 360; const a = rnd(0.05, 0.16)
    for (const dx of [-W, 0, W]) { // the left edge meets the right edge
      const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r)
      gr.addColorStop(0, `hsla(${h},85%,${rnd(45, 62)}%,${a})`); gr.addColorStop(0.5, `hsla(${h},80%,35%,${a * 0.45})`); gr.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = gr; g.beginPath(); g.ellipse(x + dx, y, r * rnd(1, 1.7), r, rnd(0, 3), 0, 7); g.fill()
    }
  }
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * W; const y = Math.random() * H; const b = Math.random(); const s = b > 0.985 ? 2.2 : b > 0.9 ? 1.4 : 0.8
    g.fillStyle = `hsla(${b > 0.5 ? 210 : 40},${b > 0.8 ? 70 : 15}%,${70 + b * 30}%,${0.35 + b * 0.65})`; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill()
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}

function planet_tex (hue: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d')!
  for (let y = 0; y < 256; y += 2) { const n = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.031 + 2) * 0.5; g.fillStyle = `hsl(${hue + n * 24},${52 + n * 18}%,${46 + n * 14}%)`; g.fillRect(0, y, 512, 2) }
  g.globalAlpha = 0.25
  for (let i = 0; i < 70; i++) { g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 256, rnd(10, 60), rnd(2, 7), 0, 0, 7); g.fill() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}

/** a low-poly fighter, nose towards -z. kind 0 = the player's jet, 1 = enemy (swept-forward wings, darker) */
export function make_fighter (accent: number, kind: 0 | 1): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.MeshStandardMaterial({ color: kind === 0 ? 0xd9e2ee : 0x3a3f4d, metalness: 0.55, roughness: 0.38, flatShading: true })
  const acc = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.4, roughness: 0.4, flatShading: true, emissive: accent, emissiveIntensity: kind === 0 ? 0.12 : 0.35 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2130, metalness: 0.6, roughness: 0.5, flatShading: true })
  const glass = new THREE.MeshStandardMaterial({ color: 0x57c8ff, metalness: 0.9, roughness: 0.08, emissive: 0x1a6fa8, emissiveIntensity: 0.5 })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m }
  // fuselage: nose cone + body + tail
  const nose = new THREE.ConeGeometry(0.34, 1.5, 8); nose.scale(1, 1, 0.72); add(nose, body, 0, 0, -1.55, -Math.PI / 2)
  const mid = new THREE.CylinderGeometry(0.34, 0.42, 1.7, 8); mid.scale(1, 1, 0.72); add(mid, body, 0, 0, 0.05, -Math.PI / 2)
  const tail = new THREE.CylinderGeometry(0.42, 0.3, 0.7, 8); tail.scale(1, 1, 0.72); add(tail, dark, 0, 0, 1.2, -Math.PI / 2)
  const can = new THREE.SphereGeometry(0.26, 10, 8); can.scale(0.85, 0.7, 2.1); add(can, glass, 0, 0.2, -0.65)
  // wings: a flat triangle each side
  const wing = (side: number): void => {
    const s = new THREE.Shape()
    if (kind === 0) { s.moveTo(0.25, -0.5); s.lineTo(2.1, 0.75); s.lineTo(2.1, 1.05); s.lineTo(0.25, 0.95) } else { s.moveTo(0.25, 0.1); s.lineTo(1.9, -0.9); s.lineTo(2.05, -0.5); s.lineTo(0.25, 1.0) }
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false }); geo.rotateX(Math.PI / 2); geo.scale(side, 1, 1)
    add(geo, body, 0, -0.02, 0)
    add(new THREE.BoxGeometry(0.1, 0.1, 0.9), acc, side * 2.08, -0.05, kind === 0 ? 0.85 : -0.7) // wing-tip stripe / pod
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), dark, side * 1.1, -0.12, kind === 0 ? 0.1 : -0.1, Math.PI / 2) // gun
    const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(0.75, 0); fin.lineTo(0.95, 0.75); fin.lineTo(0.7, 0.75)
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false }); fg.rotateY(-Math.PI / 2)
    add(fg, acc, side * 0.28, 0.12, 0.55, 0, 0, -side * 0.38)
    const eng = new THREE.CylinderGeometry(0.17, 0.2, 0.5, 10); add(eng, dark, side * 0.24, -0.02, 1.5, -Math.PI / 2)
  }
  wing(1); wing(-1)
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true && m.geometry.index === null && side_fix(m)) { /* mirrored wing: faces turned */ } })
  return g
}
/** a geometry mirrored with scale(-1) has its faces inside out: draw both sides */
function side_fix (m: THREE.Mesh): boolean { (m.material as THREE.Material).side = THREE.DoubleSide; return true }

export class SpaceGame {
  public hp = 100; public kills = 0; public score = 0; public time = 0
  public ended = false; public won = false; public started = false
  public auto: boolean
  public readonly renderer: THREE.WebGLRenderer
  public readonly scene = new THREE.Scene()
  public readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200)
  public readonly ship = new THREE.Group()
  /** called once when the round ends */ public on_end: ((won: boolean) => void) | null = null
  private readonly root: HTMLElement
  private readonly ui: HTMLElement
  private readonly target = new THREE.Vector2()
  private readonly vel = new THREE.Vector2()
  private readonly bound = new THREE.Vector2(5, 6)
  private readonly keys = new Set<string>()
  private drag: { x: number, y: number } | null = null
  private readonly foes: Foe[] = []; private readonly rocks: Rock[] = []
  private readonly shots: Bolt[] = []; private readonly eshots: Bolt[] = []; private readonly booms: Boom[] = []
  private readonly sky = new THREE.Group()
  private stars!: THREE.Points; private dust!: THREE.Points
  private readonly flames: THREE.Sprite[] = []
  private readonly reticle: THREE.Sprite
  private readonly tex_fire = glow_tex('rgba(255,255,255,1)', 'rgba(255,170,60,.85)')
  private readonly tex_dot = glow_tex('rgba(255,255,255,1)', 'rgba(255,255,255,.55)')
  private readonly tex_blue = glow_tex('rgba(255,255,255,1)', 'rgba(70,170,255,.85)')
  private readonly shot_geo = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6).rotateX(Math.PI / 2)
  private readonly shot_mat = new THREE.MeshBasicMaterial({ color: 0x7df9ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
  private readonly eshot_geo = new THREE.SphereGeometry(0.22, 8, 6)
  private readonly eshot_mat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
  private readonly rock_mat = new THREE.MeshStandardMaterial({ color: 0x7c7268, roughness: 0.95, metalness: 0.05, flatShading: true })
  private foe_proto: THREE.Group
  private fire_t = 0; private gun = 1; private spawn_t = 1.2; private rock_t = 3; private shake = 0; private hurt = 0; private bank = 0
  private speed = 46; private raf = 0; private last = 0; private readonly ro: ResizeObserver
  private ac: AudioContext | null = null
  private readonly goal: number; private readonly limit: number; private readonly hard: number
  private readonly L: number
  private disposed = false

  constructor (private readonly host: HTMLElement, private readonly opts: SpaceOpts = {}) {
    this.goal = Math.max(1, Math.round(opts.kills ?? 12)); this.limit = Math.max(0, opts.limit ?? 0); this.hard = opts.hard ?? 1; this.auto = opts.auto === true
    const l = (opts.lang ?? document.documentElement.lang ?? navigator.language ?? 'en').slice(0, 2); this.L = l === 'vi' ? 1 : l === 'ko' ? 2 : 0
    this.root = document.createElement('div'); this.root.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#03040b;touch-action:none;user-select:none;-webkit-user-select:none'
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    host.append(this.root)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: opts.auto === true }); this.renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'
    this.root.append(this.renderer.domElement)
    this.ui = document.createElement('div'); this.ui.style.cssText = 'position:absolute;inset:0;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff'
    this.root.append(this.ui)

    const hue = opts.hue ?? 265
    // light: a warm sun from the upper right, a cold fill from the nebula
    this.scene.add(new THREE.HemisphereLight(0x9db8ff, 0x2a1840, 1.1))
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(6, 8, -4); this.scene.add(sun)
    const rim = new THREE.DirectionalLight(new THREE.Color().setHSL(hue / 360, 0.8, 0.6), 1.2); rim.position.set(-6, -2, 6); this.scene.add(rim)
    // sky dome + planet + sun: they follow the camera, so they look infinitely far
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), new THREE.MeshBasicMaterial({ map: sky_tex(hue), side: THREE.BackSide, depthWrite: false, fog: false })); dome.rotation.y = 1.2; this.sky.add(dome)
    const planet = new THREE.Mesh(new THREE.SphereGeometry(120, 40, 28), new THREE.MeshStandardMaterial({ map: planet_tex((hue + 150) % 360), roughness: 1, metalness: 0 })); planet.position.set(-250, -110, -560); planet.rotation.z = 0.4; this.sky.add(planet)
    const ring = new THREE.Mesh(new THREE.RingGeometry(160, 230, 64), new THREE.MeshBasicMaterial({ color: 0xcdb8ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })); ring.position.copy(planet.position); ring.rotation.set(1.25, 0.25, 0); this.sky.add(ring)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex_blue, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.35, depthWrite: false })); halo.position.copy(planet.position); halo.scale.setScalar(420); this.sky.add(halo)
    const sunsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex_fire, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); sunsp.position.set(330, 300, -620); sunsp.scale.setScalar(300); this.sky.add(sunsp)
    const moon = new THREE.Mesh(new THREE.SphereGeometry(22, 24, 16), new THREE.MeshStandardMaterial({ color: 0xb9b2c9, roughness: 1 })); moon.position.set(210, 60, -480); this.sky.add(moon)
    this.scene.add(this.sky)
    // near stars and dust: they stream past, which is what makes the speed readable
    this.stars = this.points(900, 90, 260, 0.7, 0xffffff); this.dust = this.points(260, 22, 90, 0.22, 0x9fd8ff)
    // the jet
    const accent = new THREE.Color(opts.color ?? '#ff5a2a').getHex()
    const model = make_fighter(accent, 0); this.ship.add(model)
    for (const s of [1, -1]) { const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex_blue, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); f.position.set(s * 0.24, -0.02, 2.0); f.scale.set(0.9, 0.9, 1); this.ship.add(f); this.flames.push(f) }
    this.scene.add(this.ship)
    if (opts.ship != null && opts.ship !== '') {
      void new GLTFLoader().parseAsync(b64(opts.ship), '').then(g => {
        const m = g.scene; const box = new THREE.Box3().setFromObject(m); const sz = box.getSize(new THREE.Vector3()); const k = 4.2 / Math.max(1e-3, Math.max(sz.x, sz.z))
        const hold = new THREE.Group(); m.position.sub(box.getCenter(new THREE.Vector3())); hold.add(m); hold.scale.setScalar(k); hold.rotation.y = Math.PI
        this.ship.remove(model); this.ship.add(hold)
      }).catch(() => { /* keeps the built-in jet */ })
    }
    this.foe_proto = make_fighter(0xff2d3c, 1); this.foe_proto.rotation.y = Math.PI
    const rt = document.createElement('canvas'); rt.width = rt.height = 96; { const g = rt.getContext('2d')!; g.strokeStyle = '#7df9ff'; g.lineWidth = 5; g.beginPath(); g.arc(48, 48, 30, 0, 7); g.stroke(); for (const a of [0, 1, 2, 3]) { g.beginPath(); g.moveTo(48 + Math.cos(a * 1.5708) * 36, 48 + Math.sin(a * 1.5708) * 36); g.lineTo(48 + Math.cos(a * 1.5708) * 46, 48 + Math.sin(a * 1.5708) * 46); g.stroke() } }
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(rt), transparent: true, opacity: 0.75, depthTest: false, depthWrite: false })); this.reticle.scale.setScalar(2.6); this.reticle.renderOrder = 30; this.scene.add(this.reticle)

    this.build_ui()
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', e => { this.begin(); this.drag = { x: e.clientX, y: e.clientY }; try { el.setPointerCapture(e.pointerId) } catch { /* synthetic */ } })
    el.addEventListener('pointermove', e => {
      if (this.drag === null) return
      const k = (this.bound.y * 2.4) / Math.max(1, this.root.clientHeight) // a drag across ~40 % of the screen crosses the whole field
      this.target.x += (e.clientX - this.drag.x) * k; this.target.y -= (e.clientY - this.drag.y) * k; this.drag = { x: e.clientX, y: e.clientY }
    })
    const up = (): void => { this.drag = null }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    addEventListener('keydown', this.kd); addEventListener('keyup', this.ku)
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.root); this.resize()
    this.camera.position.set(0, 2.4, 9.5)
    this.last = performance.now(); this.raf = requestAnimationFrame(this.frame)
  }

  private readonly kd = (e: KeyboardEvent): void => { if (/^(Key[WASD]|Arrow)/.test(e.code)) { this.keys.add(e.code); this.begin() } }
  private readonly ku = (e: KeyboardEvent): void => { this.keys.delete(e.code) }
  private m (en: string, vi: string, ko: string): string { return [en, vi, ko][this.L] }

  private points (n: number, spread: number, depth: number, size: number, color: number): THREE.Points {
    const p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { p[i * 3] = rnd(-spread, spread); p[i * 3 + 1] = rnd(-spread, spread); p[i * 3 + 2] = rnd(-depth, 20) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const o = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: this.tex_dot, alphaTest: 0.02, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }))
    o.frustumCulled = false; o.userData = { spread, depth }; this.scene.add(o); return o
  }

  private resize (): void {
    const w = Math.max(1, this.root.clientWidth); const h = Math.max(1, this.root.clientHeight)
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.fov = w < h ? 68 : 56; this.camera.updateProjectionMatrix()
    const hh = Math.tan(this.camera.fov * Math.PI / 360) * 9.5
    this.bound.set(Math.max(3, hh * this.camera.aspect * 1.45), Math.max(2.6, hh * 1.05))
  }

  /* ---------- HUD ---------- */
  private hp_el!: HTMLElement; private kill_el!: HTMLElement; private time_el!: HTMLElement; private tut_el!: HTMLElement; private red_el!: HTMLElement; private msg_el!: HTMLElement
  private build_ui (): void {
    const top = document.createElement('div'); top.style.cssText = 'position:absolute;left:0;right:0;top:0;padding:calc(10px + env(safe-area-inset-top)) 12px 0;display:flex;gap:10px;align-items:center;font:800 14px system-ui,sans-serif;text-shadow:0 1px 3px #000'
    top.innerHTML = '<div style="flex:1;max-width:46%"><div style="height:13px;border-radius:8px;background:#0008;border:1.5px solid #ffffff55;overflow:hidden"><i data-hp style="display:block;height:100%;width:100%;border-radius:6px;background:linear-gradient(90deg,#27e08a,#b6ff6a);transition:width .18s"></i></div></div><div data-time style="flex:1;text-align:center;font-variant-numeric:tabular-nums"></div><div data-kill style="padding:3px 10px;border-radius:999px;background:#0008;border:1.5px solid #ffffff55;white-space:nowrap"></div>'
    this.ui.append(top); this.hp_el = top.querySelector('[data-hp]')!; this.kill_el = top.querySelector('[data-kill]')!; this.time_el = top.querySelector('[data-time]')!
    this.red_el = document.createElement('div'); this.red_el.style.cssText = 'position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(255,30,30,.6));transition:opacity .12s'; this.ui.append(this.red_el)
    this.msg_el = document.createElement('div'); this.msg_el.style.cssText = 'position:absolute;left:0;right:0;top:17%;text-align:center;font:900 22px system-ui,sans-serif;letter-spacing:.5px;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .3s'; this.ui.append(this.msg_el)
    this.tut_el = document.createElement('div'); this.tut_el.style.cssText = 'position:absolute;left:0;right:0;bottom:16%;text-align:center;font:800 17px system-ui,sans-serif;text-shadow:0 2px 6px #000;transition:opacity .3s'
    this.tut_el.innerHTML = `<div style="font-size:44px;animation:gbsp-h 1.4s ease-in-out infinite">👆</div><div>${this.m('Drag to fly · guns fire on their own', 'Kéo để lái · súng tự bắn', '드래그로 조종 · 자동 사격')}</div><div style="font-weight:600;font-size:13px;opacity:.85;margin-top:4px">${this.m(`Shoot down ${this.goal} enemy fighters`, `Bắn hạ ${this.goal} máy bay địch`, `적기 ${this.goal}대 격추`)}</div><style>@keyframes gbsp-h{0%,100%{transform:translateX(-46px)}50%{transform:translateX(46px)}}@keyframes gbsp-p{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}</style>`
    if (this.auto) this.tut_el.style.display = 'none'
    this.ui.append(this.tut_el); this.hud()
  }

  private hud (): void {
    this.hp_el.style.width = `${Math.max(0, this.hp)}%`; this.hp_el.style.background = this.hp > 35 ? 'linear-gradient(90deg,#27e08a,#b6ff6a)' : 'linear-gradient(90deg,#ff3b3b,#ff9a3b)'
    this.kill_el.textContent = `✈ ${this.kills}/${this.goal}`
    this.time_el.textContent = this.limit > 0 ? `${Math.max(0, Math.ceil(this.limit - this.time))}s` : `${this.score}`
  }

  private say (t: string): void { this.msg_el.textContent = t; this.msg_el.style.opacity = '1'; setTimeout(() => { this.msg_el.style.opacity = '0' }, 1300) }

  /** the first touch: the round starts, sound is allowed */
  public begin (): void {
    if (this.started || this.ended) return
    this.started = true; this.tut_el.style.opacity = '0'
    try { this.ac = new (window.AudioContext ?? (window as any).webkitAudioContext)() } catch { this.ac = null }
  }

  /* ---------- sound: a few oscillators, no file ---------- */
  private tone (f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
    const a = this.ac; if (a === null || a.state !== 'running') return
    const o = a.createOscillator(); const g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f0, a.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), a.currentTime + dur)
    g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur)
  }

  private noise (dur: number, vol: number, cut: number): void {
    const a = this.ac; if (a === null || a.state !== 'running') return
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const s = a.createBufferSource(); s.buffer = buf; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; const g = a.createGain(); g.gain.value = vol; s.connect(f).connect(g).connect(a.destination); s.start()
  }

  /* ---------- spawning ---------- */
  private bolt (pool: Bolt[], geo: THREE.BufferGeometry, mat: THREE.Material): Bolt {
    let b = pool.find(x => !x.alive)
    if (b === undefined) { b = { o: new THREE.Mesh(geo, mat), v: new THREE.Vector3(), alive: false, life: 0 }; b.o.frustumCulled = false; this.scene.add(b.o); pool.push(b) }
    b.alive = true; b.life = 0; b.o.visible = true; return b
  }

  private spawn_foe (): void {
    const o = this.foe_proto.clone(true); const s = 1.15; o.scale.setScalar(s)
    const f: Foe = { o, hp: 3, t: 0, seed: Math.random() * 10, fire: rnd(1.2, 2.4) / this.hard, hold: rnd(34, 58), leave: rnd(9, 13), ax: rnd(-0.85, 0.85) * this.bound.x, ay: rnd(-0.8, 0.8) * this.bound.y, alive: true }
    o.position.set(f.ax + rnd(-8, 8), f.ay + rnd(-5, 5), -230); this.scene.add(o); this.foes.push(f)
  }

  private spawn_rock (): void {
    const r = rnd(0.9, 2.2); const geo = new THREE.IcosahedronGeometry(r, 1); const p = geo.getAttribute('position')
    for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const k = 1 + (Math.sin(v.x * 3.1 + r) * Math.cos(v.y * 2.7) * Math.sin(v.z * 3.7 + 1)) * 0.28; p.setXYZ(i, v.x * k, v.y * k, v.z * k) }
    geo.computeVertexNormals()
    const o = new THREE.Mesh(geo, this.rock_mat)
    // most rocks drift past; one in three is aimed at the jet, so the player has to move
    const aimed = Math.random() < 0.34
    o.position.set(aimed ? this.ship.position.x + rnd(-1, 1) : rnd(-1.4, 1.4) * this.bound.x, aimed ? this.ship.position.y + rnd(-1, 1) : rnd(-1.3, 1.3) * this.bound.y, -240)
    this.scene.add(o); this.rocks.push({ o, hp: r > 1.6 ? 3 : 2, r: r * 1.05, v: new THREE.Vector3(rnd(-0.6, 0.6), rnd(-0.6, 0.6), this.speed + rnd(4, 18)), spin: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)), alive: true })
  }

  private boom (at: THREE.Vector3, size: number, blue = false): void {
    for (let i = 0; i < (size > 2 ? 5 : 2); i++) {
      const o = new THREE.Sprite(new THREE.SpriteMaterial({ map: blue ? this.tex_blue : this.tex_fire, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }))
      o.position.copy(at).add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(size * 0.3)); this.scene.add(o)
      this.booms.push({ o, t: -i * 0.05, d: rnd(0.35, 0.6), s: size * rnd(0.8, 1.5) })
    }
  }

  private damage (n: number): void {
    if (this.ended) return
    this.hp -= n; this.hurt = 1; this.shake = Math.max(this.shake, 0.55); this.noise(0.25, 0.35, 900); this.tone(180, 60, 0.25, 'sawtooth', 0.12)
    try { if ((navigator as any).userActivation?.hasBeenActive === true) navigator.vibrate?.(40) } catch { /* not allowed */ }
    if (this.hp <= 0) { this.hp = 0; this.boom(this.ship.position, 5); this.ship.visible = false; this.finish(false) }
    this.hud()
  }

  private kill (f: Foe): void {
    f.alive = false; this.boom(f.o.position, 4.5); this.scene.remove(f.o); this.kills++; this.score += 100; this.shake = Math.max(this.shake, 0.3)
    this.noise(0.45, 0.4, 1400); this.tone(140, 40, 0.4, 'triangle', 0.18)
    if (this.kills >= this.goal) this.finish(true)
    else if (this.kills === Math.ceil(this.goal / 2)) this.say(this.m('Halfway there!', 'Được nửa đường rồi!', '절반 완료!'))
    this.hud()
  }

  /* ---------- end card ---------- */
  private finish (won: boolean): void {
    if (this.ended) return
    this.ended = true; this.won = won; this.on_end?.(won)
    if (won) { for (const [i, f] of [523, 659, 784, 1047].entries()) setTimeout(() => this.tone(f, f, 0.22, 'triangle', 0.16), i * 110) } else this.tone(300, 50, 0.9, 'sawtooth', 0.15)
    setTimeout(() => { if (!this.disposed) this.end_card() }, won ? 900 : 1300)
  }

  private end_card (): void {
    const stars = this.won ? (this.hp > 66 ? 3 : this.hp > 33 ? 2 : 1) : 0
    const cta = this.opts.cta ?? ''; const label = (this.opts.cta_label ?? '') !== '' ? this.opts.cta_label! : this.m('PLAY NOW', 'CHƠI NGAY', '지금 플레이')
    const card = document.createElement('div'); card.dataset.end = '1'
    card.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,rgba(30,20,70,.55),rgba(2,3,10,.88));pointer-events:auto;animation:gbsp-p .35s ease-out'
    card.innerHTML = `<div style="text-align:center;padding:0 22px;max-width:420px"><div style="font:900 15px system-ui;letter-spacing:3px;opacity:.8">${this.esc(this.opts.title ?? 'SPACE FIGHTER')}</div>` +
      `<div style="font:900 40px/1.1 system-ui;margin:8px 0 6px;text-shadow:0 4px 0 #0008;color:${this.won ? '#ffe45c' : '#ff6b5c'}">${this.won ? this.m('VICTORY!', 'CHIẾN THẮNG!', '승리!') : this.m('SHOT DOWN', 'BỊ BẮN HẠ', '격추됨')}</div>` +
      `<div style="font-size:36px;letter-spacing:6px;height:44px">${'★'.repeat(stars)}<span style="opacity:.25">${'★'.repeat(3 - stars)}</span></div>` +
      `<div style="font:700 15px system-ui;opacity:.9;margin:6px 0 18px">✈ ${this.kills}/${this.goal} · ${this.score} ${this.m('pts', 'điểm', '점')}</div>` +
      `<button data-cta style="display:block;width:100%;border:0;border-radius:16px;padding:15px 20px;font:900 20px system-ui;color:#1b1200;background:linear-gradient(#ffe45c,#ffab1f);box-shadow:0 6px 0 #b86a00,0 10px 24px #0008;cursor:pointer;animation:gbsp-b 1.1s ease-in-out infinite">${this.esc(label)}</button>` +
      `<button data-again style="margin-top:14px;border:1.5px solid #ffffff66;border-radius:12px;background:#ffffff14;color:#fff;font:700 14px system-ui;padding:9px 18px;cursor:pointer">↻ ${this.m('Play again', 'Chơi lại', '다시 하기')}</button></div><style>@keyframes gbsp-b{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}</style>`
    card.querySelector<HTMLElement>('[data-cta]')!.onclick = () => { if (this.opts.on_cta !== undefined) this.opts.on_cta(cta); else if (cta !== '') { const mr = (window as any).mraid; if (mr?.open !== undefined) mr.open(cta); else window.open(cta, '_blank') } else this.restart() }
    card.querySelector<HTMLElement>('[data-again]')!.onclick = () => this.restart()
    this.ui.append(card)
  }

  private esc (s: string): string { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)) }

  public restart (): void {
    this.ui.querySelector('[data-end]')?.remove()
    for (const f of this.foes) this.scene.remove(f.o); for (const r of this.rocks) { this.scene.remove(r.o); r.o.geometry.dispose() }
    for (const b of [...this.shots, ...this.eshots]) { b.alive = false; b.o.visible = false }
    this.foes.length = 0; this.rocks.length = 0
    this.hp = 100; this.kills = 0; this.score = 0; this.time = 0; this.ended = false; this.won = false; this.started = true; this.ship.visible = true
    this.target.set(0, 0); this.ship.position.set(0, 0, 0); this.spawn_t = 1; this.rock_t = 3; this.hud()
  }

  /* ---------- the loop ---------- */
  private readonly frame = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now
    this.update(dt); this.renderer.render(this.scene, this.camera)
  }

  /** one step of the game (public: tests drive it without waiting for frames) */
  public update (dt: number): void {
    const live = (this.started || this.auto) && !this.ended
    const ship = this.ship.position; const B = this.bound
    if (live) this.time += dt
    // ---- steering
    if (this.auto && !this.ended) this.autopilot(dt)
    const kx = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)
    const ky = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
    this.target.x += kx * 15 * dt; this.target.y += ky * 13 * dt
    this.target.x = THREE.MathUtils.clamp(this.target.x, -B.x, B.x); this.target.y = THREE.MathUtils.clamp(this.target.y, -B.y, B.y)
    const px = ship.x; const py = ship.y; const k = 1 - Math.exp(-9 * dt)
    if (!this.ended || this.won) { ship.x += (this.target.x - ship.x) * k; ship.y += (this.target.y - ship.y) * k }
    this.vel.set((ship.x - px) / Math.max(dt, 1e-4), (ship.y - py) / Math.max(dt, 1e-4))
    this.bank += (THREE.MathUtils.clamp(-this.vel.x * 0.075, -0.95, 0.95) - this.bank) * (1 - Math.exp(-10 * dt))
    this.ship.rotation.set(THREE.MathUtils.clamp(this.vel.y * 0.035, -0.45, 0.45), THREE.MathUtils.clamp(-this.vel.x * 0.018, -0.25, 0.25), this.bank)
    if (!live && !this.ended) { ship.y = Math.sin(performance.now() / 700) * 0.25 } // waiting for the first touch: the jet idles
    if (this.won) { ship.z -= dt * 60; this.ship.rotation.z += dt * 5 } // victory: the jet rolls away ahead
    for (const [i, f] of this.flames.entries()) { const s = 0.75 + Math.random() * 0.35 + Math.abs(this.vel.x + this.vel.y) * 0.01; f.scale.set(s, s, 1); f.position.z = 1.9 + s * 0.25; f.material.opacity = 0.8 + (i === 0 ? 0.1 : 0) }
    this.reticle.position.set(ship.x, ship.y, -42); this.reticle.visible = live

    // ---- the world streams past
    const stream = (o: THREE.Points, sp: number): void => {
      const p = o.geometry.getAttribute('position') as THREE.BufferAttribute; const { spread, depth } = o.userData as { spread: number, depth: number }
      for (let i = 0; i < p.count; i++) { let z = p.getZ(i) + sp * dt; if (z > 20) { z -= depth + 20; p.setX(i, rnd(-spread, spread) + ship.x * 0.3); p.setY(i, rnd(-spread, spread) + ship.y * 0.3) } p.setZ(i, z) }
      p.needsUpdate = true
    }
    stream(this.stars, this.speed * 1.1); stream(this.dust, this.speed * 2.2)

    if (live) {
      // ---- guns: the nearest enemy roughly ahead pulls the bolt a little
      this.fire_t -= dt
      if (this.fire_t <= 0) {
        this.fire_t = 0.13; this.gun = -this.gun
        const b = this.bolt(this.shots, this.shot_geo, this.shot_mat); b.o.position.set(ship.x + this.gun * 1.1, ship.y - 0.12, -1.2); b.v.set(0, 0, -150)
        let best: THREE.Object3D | null = null; let bd = 4.2
        for (const f of this.foes) { if (!f.alive || f.o.position.z > -6 || f.o.position.z < -120) continue; const d = Math.hypot(f.o.position.x - ship.x, f.o.position.y - ship.y); if (d < bd) { bd = d; best = f.o } }
        if (best === null) for (const r of this.rocks) { if (!r.alive || r.o.position.z > -8 || r.o.position.z < -100) continue; const d = Math.hypot(r.o.position.x - ship.x, r.o.position.y - ship.y); if (d < Math.min(bd, 2.6)) { bd = d; best = r.o } }
        if (best !== null) { const tt = Math.max(0.05, (b.o.position.z - best.position.z) / 150); b.v.x = (best.position.x - b.o.position.x) / tt; b.v.y = (best.position.y - b.o.position.y) / tt }
        b.o.lookAt(b.o.position.clone().add(b.v)); this.tone(1500, 500, 0.07, 'square', 0.025)
      }
      // ---- enemies arrive in waves that grow with the score
      this.spawn_t -= dt
      const want = Math.min(4, 1 + Math.floor(this.kills / 3)); const alive = this.foes.filter(f => f.alive).length
      if (this.spawn_t <= 0 && alive < want && this.kills + alive < this.goal) { this.spawn_foe(); this.spawn_t = rnd(0.7, 1.6) / this.hard }
      if (this.opts.rocks !== false) { this.rock_t -= dt; if (this.rock_t <= 0) { this.spawn_rock(); this.rock_t = rnd(1.1, 2.4) / this.hard } }
      if (this.limit > 0 && this.time >= this.limit) this.finish(this.kills >= this.goal)
      if (this.limit > 0) this.hud()
    }

    // ---- enemy fighters: fly in, weave at gun range, shoot, then dive past
    for (const f of this.foes) {
      if (!f.alive) continue
      f.t += dt; const o = f.o.position
      const leaving = f.t > f.leave
      const tz = leaving ? 40 : -f.hold
      o.z += (leaving ? 55 : Math.min(120, Math.max(8, (tz - o.z) * 1.6))) * dt * (o.z < tz || leaving ? 1 : -0.4)
      const wx = f.ax + Math.sin(f.t * 0.9 + f.seed) * B.x * 0.45; const wy = f.ay + Math.cos(f.t * 1.2 + f.seed * 2) * B.y * 0.35
      const ox = o.x; o.x += (THREE.MathUtils.clamp(wx, -B.x, B.x) - o.x) * (1 - Math.exp(-1.6 * dt)); o.y += (THREE.MathUtils.clamp(wy, -B.y, B.y) - o.y) * (1 - Math.exp(-1.6 * dt))
      f.o.rotation.z = THREE.MathUtils.clamp((o.x - ox) / Math.max(dt, 1e-4) * 0.09, -0.9, 0.9)
      if (live && !leaving && o.z > -90) {
        f.fire -= dt
        if (f.fire <= 0) {
          f.fire = rnd(1.5, 2.8) / this.hard
          const b = this.bolt(this.eshots, this.eshot_geo, this.eshot_mat); b.o.position.copy(o); b.o.position.z += 2
          // aimed where the jet is now: keep moving and it misses
          const dir = new THREE.Vector3(ship.x + rnd(-0.6, 0.6) - o.x, ship.y + rnd(-0.6, 0.6) - o.y, -o.z).normalize(); b.v.copy(dir.multiplyScalar(34 * Math.sqrt(this.hard))); this.tone(300, 180, 0.12, 'sawtooth', 0.03)
        }
      }
      if (o.z > 25) { f.alive = false; this.scene.remove(f.o) }
      else if (live && Math.abs(o.z) < 2.2 && Math.hypot(o.x - ship.x, o.y - ship.y) < 2.4) { this.damage(25); this.kill(f) }
    }
    for (const r of this.rocks) {
      if (!r.alive) continue
      r.o.position.addScaledVector(r.v, dt); r.o.rotation.x += r.spin.x * dt; r.o.rotation.y += r.spin.y * dt
      if (r.o.position.z > 25) { r.alive = false; this.scene.remove(r.o); r.o.geometry.dispose() }
      else if (live && Math.abs(r.o.position.z) < r.r + 1 && Math.hypot(r.o.position.x - ship.x, r.o.position.y - ship.y) < r.r + 0.9) { r.alive = false; this.boom(r.o.position, r.r * 2); this.scene.remove(r.o); r.o.geometry.dispose(); this.damage(18) }
    }
    // ---- bolts
    for (const b of this.shots) {
      if (!b.alive) continue
      const z0 = b.o.position.z; b.o.position.addScaledVector(b.v, dt); b.life += dt
      let hit = false
      for (const f of this.foes) { if (!f.alive) continue; const p = f.o.position; if (p.z <= z0 + 1.5 && p.z >= b.o.position.z - 1.5 && Math.hypot(p.x - b.o.position.x, p.y - b.o.position.y) < 2.0) { hit = true; f.hp--; this.boom(b.o.position, 1.1, true); this.score += 10; if (f.hp <= 0) this.kill(f); else this.tone(900, 700, 0.05, 'square', 0.04); break } }
      if (!hit) for (const r of this.rocks) { if (!r.alive) continue; const p = r.o.position; if (p.z <= z0 + r.r && p.z >= b.o.position.z - r.r && Math.hypot(p.x - b.o.position.x, p.y - b.o.position.y) < r.r + 0.3) { hit = true; r.hp--; this.boom(b.o.position, 1.1, true); if (r.hp <= 0) { r.alive = false; this.boom(p, r.r * 2.2); this.scene.remove(r.o); r.o.geometry.dispose(); this.score += 25; this.noise(0.3, 0.25, 700); this.hud() } break } }
      if (hit || b.life > 1.6) { b.alive = false; b.o.visible = false }
    }
    for (const b of this.eshots) {
      if (!b.alive) continue
      b.o.position.addScaledVector(b.v, dt); b.life += dt; const s = 1 + Math.sin(b.life * 30) * 0.2; b.o.scale.setScalar(s)
      if (live && Math.abs(b.o.position.z) < 1.3 && Math.hypot(b.o.position.x - ship.x, b.o.position.y - ship.y) < 1.05) { b.alive = false; b.o.visible = false; this.damage(12) }
      else if (b.o.position.z > 14 || b.life > 8) { b.alive = false; b.o.visible = false }
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const x = this.booms[i]; x.t += dt
      if (x.t < 0) { x.o.visible = false; continue }
      const u = x.t / x.d; x.o.visible = true; x.o.scale.setScalar(x.s * (0.4 + u * 1.6)); x.o.material.opacity = 1 - u; x.o.position.z += this.speed * 0.4 * dt
      if (u >= 1) { this.scene.remove(x.o); x.o.material.dispose(); this.booms.splice(i, 1) }
    }

    // ---- chase camera: behind and above the jet, it follows with a little lag and leans with the turn
    this.shake = Math.max(0, this.shake - dt * 1.8); this.hurt = Math.max(0, this.hurt - dt * 2.2); this.red_el.style.opacity = String(this.hurt * 0.9)
    const sx = this.ended && !this.won ? this.target.x : ship.x; const sy = this.ended && !this.won ? this.target.y : ship.y
    const want = new THREE.Vector3(sx * 0.72, sy * 0.72 + 2.3, 9.5 + Math.abs(this.vel.x) * 0.02)
    this.camera.position.lerp(want, 1 - Math.exp(-5 * dt))
    const roll = this.bank * 0.22; this.camera.up.set(Math.sin(roll), Math.cos(roll), 0)
    const look = new THREE.Vector3(sx * 0.9, sy * 0.9 + 0.5, -26)
    this.camera.lookAt(look)
    if (this.shake > 0) { this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5 }
    this.sky.position.copy(this.camera.position); this.sky.rotation.y += dt * 0.004; this.sky.rotation.x = -sy * 0.004
  }

  /** demo pilot: lines up on the nearest enemy, slides away from bolts and rocks that are about to hit */
  private autopilot (dt: number): void {
    const ship = this.ship.position; let tx = this.target.x; let ty = this.target.y
    let best: Foe | null = null; let bz = -1e9
    for (const f of this.foes) if (f.alive && f.o.position.z < -8 && f.o.position.z > bz) { bz = f.o.position.z; best = f }
    if (best !== null) { tx = best.o.position.x; ty = best.o.position.y } else { tx = Math.sin(this.time * 0.8) * this.bound.x * 0.5; ty = Math.cos(this.time * 0.6) * this.bound.y * 0.4 }
    const dodge = (p: THREE.Vector3, v: THREE.Vector3, r: number): void => {
      if (v.z <= 0 || p.z > 0) return; const t = -p.z / v.z; if (t > 0.9) return
      const dx = p.x + v.x * t - ship.x; const dy = p.y + v.y * t - ship.y; const d = Math.hypot(dx, dy)
      if (d < r + 1.6) { const k = (r + 3.2) / Math.max(0.2, d); tx = ship.x - dx * k; ty = ship.y - dy * k }
    }
    for (const b of this.eshots) if (b.alive) dodge(b.o.position, b.v, 0.4)
    for (const r of this.rocks) if (r.alive) dodge(r.o.position, r.v, r.r)
    const k = 1 - Math.exp(-6 * dt); this.target.x += (tx - this.target.x) * k; this.target.y += (ty - this.target.y) * k
  }

  public dispose (): void {
    this.disposed = true; cancelAnimationFrame(this.raf); this.ro.disconnect(); removeEventListener('keydown', this.kd); removeEventListener('keyup', this.ku)
    try { void this.ac?.close() } catch { /* already closed */ }
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry !== undefined) m.geometry.dispose() })
    this.renderer.dispose(); this.root.remove()
  }
}
