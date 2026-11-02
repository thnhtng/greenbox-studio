/*
 * The exported playable: one HTML file, no server. The play test writes the map (GLB), the character (GLB with
 * its animations) and the 2D plan into window.__GB_PLAYABLE; this runtime (bundled with three.js into
 * playable-runtime.js and pasted into the same file) plays it:
 *   touch / mouse: press anywhere and drag = joystick (the usual playable control); WASD / arrows on a keyboard
 *   the game is Playable.ts (sources, machines, counters, $ pads, the guide arrow)
 *   CTA button -> mraid.open(url) inside an ad network, window.open(url) elsewhere
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { World } from './World.ts'
import { Playable } from './Playable.ts'
import { type Plan } from './PlanEditor.ts'
import { CharacterController, strip_root_motion, type Input } from './CharacterController.ts'
import { map_clips } from './ClipMap.ts'

interface Data { map: string, char: string | null, plan: Plan, cta?: string, cta_label?: string, cam?: { yaw: number, pitch: number, dist: number }, title?: string }
const b64 = (s: string): ArrayBuffer => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer }

async function main (): Promise<void> {
  const D = (window as any).__GB_PLAYABLE as Data
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true
  document.body.append(renderer.domElement); renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;touch-action:none'
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fc6e8); scene.fog = new THREE.Fog(0x9fc6e8, 30, 90)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7a5a, 1.4))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(6, 12, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024)
  const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.far = 60; scene.add(sun); scene.add(sun.target)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500)
  const view = document.createElement('div'); view.style.cssText = 'position:fixed;inset:0;pointer-events:none'; document.body.append(view)
  const world = new World(scene, camera, renderer.domElement)
  const loader = new GLTFLoader()
  // the map: solid / walkable for the player
  const map = await loader.parseAsync(b64(D.map), '')
  const root = map.scene.children.length === 1 ? map.scene.children[0] : map.scene
  for (const t of [...root.children]) world.props.add(t)
  // you walk on the bed of the water, not on its surface
  world.props.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.castShadow = true; m.receiveShadow = true; if (/^(Water|Pool)/.test(m.name)) m.raycast = () => {} } })
  world.refresh()
  const by_pid = new Map<string, THREE.Object3D>()
  world.props.traverse(o => { const pid = (o.userData?.map_extra as { pid?: string } | undefined)?.pid; if (pid !== undefined) by_pid.set(pid, o) })
  // the name tags over the blocks (sprites do not travel in a GLB: drawn again from the plan)
  for (const sh of D.plan.shapes) {
    if (sh.label === '' || sh.kind === 'player' || sh.kind === 'zone' || sh.kind === 'unlock') continue
    const c = document.createElement('canvas'); const g = c.getContext('2d')!; g.font = '700 44px system-ui,sans-serif'
    const w = Math.min(1024, Math.ceil(g.measureText(sh.label).width) + 40); c.width = w; c.height = 72
    g.fillStyle = 'rgba(15,20,30,.72)'; g.beginPath(); g.roundRect(0, 0, w, 72, 18); g.fill(); g.font = '700 44px system-ui,sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sh.label, w / 2, 38)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.renderOrder = 40; sp.scale.set(w / 72 * 0.55, 0.55, 1)
    const o = by_pid.get(sh.id); const top = o !== undefined ? new THREE.Box3().setFromObject(o).max.y : sh.height
    sp.position.set(sh.x, Math.max(top, 0.2) + 0.55, sh.z); scene.add(sp)
  }
  // the player: the character with its animations, or a capsule
  let ctrl: CharacterController | null = null; let pawn: THREE.Object3D | null = null
  if (D.char !== null) {
    const g = await loader.parseAsync(b64(D.char), '')
    const model = g.scene; model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.castShadow = true; m.frustumCulled = false } })
    strip_root_motion(g.animations, model)
    ctrl = new CharacterController(model, map_clips(g.animations))
    ctrl.ground_at = (x, z, y) => world.ground_at(x, z, y)
    ctrl.move_filter = (a, b) => { world.block(a, b) }
    scene.add(ctrl.root)
  } else {
    const p = new THREE.Group(); const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 16), new THREE.MeshLambertMaterial({ color: 0xf97316 })); body.position.y = 0.72; body.castShadow = true; p.add(body); scene.add(p); pawn = p
  }
  const player = (): THREE.Object3D | null => ctrl?.root ?? pawn
  const game = new Playable(D.plan, scene, (id) => by_pid.get(id) ?? null, player, view, () => {})
  view.querySelector<HTMLElement>('[data-exit]')?.remove()
  // CTA
  if ((D.cta ?? '') !== '') {
    const b = document.createElement('button'); b.textContent = D.cta_label ?? 'Play now'
    b.style.cssText = 'position:fixed;right:14px;bottom:18px;z-index:30;font:800 20px system-ui,sans-serif;padding:14px 26px;border:0;border-radius:40px;background:linear-gradient(#36d36a,#16a34a);color:#fff;box-shadow:0 6px 18px #0006;pointer-events:auto'
    b.onclick = () => { const m = (window as any).mraid; if (m?.open !== undefined) m.open(D.cta); else window.open(D.cta, '_blank') }
    document.body.append(b)
  }
  // controls: a floating joystick wherever the finger goes down; keyboard too
  const move = new THREE.Vector2(); const keys = new Set<string>(); let origin: { x: number, y: number } | null = null
  const knob = document.createElement('div'); knob.style.cssText = 'position:fixed;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;border:3px solid #fff8;background:#0002;display:none;z-index:25;pointer-events:none'
  const dot = document.createElement('div'); dot.style.cssText = 'position:absolute;left:35px;top:35px;width:40px;height:40px;border-radius:50%;background:#fffc'; knob.append(dot); document.body.append(knob)
  renderer.domElement.addEventListener('pointerdown', e => { origin = { x: e.clientX, y: e.clientY }; knob.style.display = 'block'; knob.style.left = `${e.clientX}px`; knob.style.top = `${e.clientY}px`; renderer.domElement.setPointerCapture(e.pointerId) })
  renderer.domElement.addEventListener('pointermove', e => {
    if (origin === null) return
    const dx = e.clientX - origin.x; const dy = e.clientY - origin.y; const L = Math.hypot(dx, dy); const k = Math.min(1, L / 50) / Math.max(1e-6, L)
    move.set(dx * k, -dy * k); dot.style.transform = `translate(${move.x * 35}px, ${-move.y * 35}px)`
  })
  const end = (): void => { origin = null; move.set(0, 0); knob.style.display = 'none'; dot.style.transform = '' }
  renderer.domElement.addEventListener('pointerup', end); renderer.domElement.addEventListener('pointercancel', end)
  addEventListener('keydown', e => keys.add(e.code)); addEventListener('keyup', e => keys.delete(e.code))
  const cam = D.cam ?? { yaw: 0, pitch: 0.75, dist: 10 }
  cam.pitch = Math.max(0.7, cam.pitch) // playables look down on the map
  const resize = (): void => { const w = innerWidth; const h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.fov = w < h ? 62 : 50; camera.updateProjectionMatrix() }
  addEventListener('resize', resize); resize()
  const timer = new THREE.Timer(); const Y = new THREE.Vector3(0, 1, 0)
  renderer.setAnimationLoop(() => {
    timer.update()
    const dt = Math.min(0.05, timer.getDelta())
    const mv = move.clone()
    if (keys.has('KeyW') || keys.has('ArrowUp')) mv.y += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) mv.y -= 1
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mv.x -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) mv.x += 1
    if (mv.lengthSq() > 1) mv.normalize()
    if (ctrl !== null) {
      const input: Input = { move: mv, sprint: mv.length() > 0.85, walk: false, jump: false, roll: false, attack: false, block: false, crouch_toggle: false, hit_test: false }
      ctrl.update(dt, input, cam.yaw)
    } else if (pawn !== null) {
      const want = new THREE.Vector3(mv.x, 0, -mv.y).applyAxisAngle(Y, cam.yaw)
      if (want.lengthSq() > 1e-4) { const b = pawn.position.clone().addScaledVector(want, 5 * dt); world.block(pawn.position, b); pawn.position.x = b.x; pawn.position.z = b.z; pawn.rotation.y = Math.atan2(want.x, want.z) }
      pawn.position.y = world.ground_at(pawn.position.x, pawn.position.z, pawn.position.y)
    }
    game.update(dt)
    const p = player(); const target = p !== null ? p.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : new THREE.Vector3()
    const off = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)).multiplyScalar(cam.dist)
    camera.position.lerp(target.clone().add(off), 1 - Math.exp(-8 * dt)); camera.lookAt(target)
    sun.position.copy(target).add(new THREE.Vector3(6, 12, 5)); sun.target.position.copy(target)
    renderer.render(scene, camera)
  })
}
void main()
