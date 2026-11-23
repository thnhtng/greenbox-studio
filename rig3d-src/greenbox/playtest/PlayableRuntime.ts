/*
 * The exported playable: one HTML file, no server. The play test writes the map (GLB), the character (GLB with
 * its animations) and the 2D plan into window.__GB_PLAYABLE; this runtime (bundled with three.js into
 * playable-runtime.js and pasted into the same file) plays it:
 *   touch / mouse: press anywhere and drag = joystick (the usual playable control); WASD / arrows on a keyboard
 *   the game is Playable.ts (sources, machines, counters, $ pads, the guide arrow)
 *   CTA button -> mraid.open(url) inside an ad network, window.open(url) elsewhere
 *   PlayableFx.ts: loading screen, drag tutorial, objective line, sound, floating text, end card
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { World } from './World.ts'
import { Playable } from './Playable.ts'
import { type Plan } from './PlanEditor.ts'
import { CharacterController, strip_root_motion, type Input } from './CharacterController.ts'
import { map_clips } from './ClipMap.ts'
import { PlayableFx } from './PlayableFx.ts'
import { M } from '../common/lang.ts'
import { SpaceGame, type SpaceOpts } from '../space/SpaceGame.ts'

interface Data { map: string, char: string | null, plan: Plan, items?: Record<string, string>, cta?: string, cta_label?: string, cam?: { yaw: number, pitch: number, dist: number }, title?: string, lang?: string, limit?: number, game?: string, space?: SpaceOpts }
const b64 = (s: string): ArrayBuffer => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer }

async function main (): Promise<void> {
  const D = (window as any).__GB_PLAYABLE as Data
  // language: the one it was exported in, else the phone's
  if (document.documentElement.lang === '') document.documentElement.lang = (D.lang ?? navigator.language ?? 'en').slice(0, 2)
  const title = D.title ?? (document.title !== '' ? document.title : 'Playable')
  // 🚀 a space fighter playable: no map, the whole game is SpaceGame.ts
  if (D.game === 'space') { const g = new SpaceGame(document.body, { ...(D.space ?? {}), title, lang: document.documentElement.lang, cta: D.cta ?? '', cta_label: D.cta_label, limit: D.limit ?? D.space?.limit ?? 0 }); (window as any).__gbPlayable = { game: g }; return }
  // loading screen (the map and the character are unpacked from the file itself: a second or two on a phone)
  const splash = document.createElement('div')
  splash.style.cssText = 'position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:radial-gradient(circle at 50% 38%,#2b3b58,#0e1522);color:#fff;font-family:system-ui,-apple-system,sans-serif;transition:opacity .45s'
  splash.innerHTML = '<div style="text-align:center;padding:0 24px"><div data-t style="font:900 30px/1.15 system-ui,sans-serif;letter-spacing:.3px;text-shadow:0 3px 0 #0006"></div><div style="width:190px;height:10px;margin:22px auto 12px;border-radius:10px;background:#ffffff1f;border:1.5px solid #ffffff33;overflow:hidden"><i data-b style="display:block;height:100%;width:8%;border-radius:10px;background:linear-gradient(90deg,#3ddc6f,#b6f36a);transition:width .35s ease-out"></i></div><div data-s style="font:700 14px system-ui,sans-serif;color:#aebbd0"></div></div>'
  splash.querySelector<HTMLElement>('[data-t]')!.textContent = title; splash.querySelector<HTMLElement>('[data-s]')!.textContent = M('Loading…', 'Đang tải…', '로딩 중…')
  document.body.append(splash)
  const step = async (k: number): Promise<void> => { splash.querySelector<HTMLElement>('[data-b]')!.style.width = `${k}%`; await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))) }
  await step(15)
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
  await step(60)
  const root = map.scene.children.length === 1 ? map.scene.children[0] : map.scene
  for (const t of [...root.children]) world.props.add(t)
  // you walk on the bed of the water, not on its surface
  world.props.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.castShadow = true; m.receiveShadow = true; if (/^(Water|Pool)/.test(m.name)) m.raycast = () => {} } })
  world.refresh()
  // the ground itself (no props): a vehicle drives on it and never on top of blocks
  let terrain: THREE.Object3D | null = null; world.props.traverse(o => { if (terrain === null && /^Terrain/.test(o.name)) terrain = o })
  const tray = new THREE.Raycaster(); const DOWN = new THREE.Vector3(0, -1, 0)
  const terrain_y = (x: number, z: number): number => { if (terrain === null) return 0; tray.set(new THREE.Vector3(x, 200, z), DOWN); const h = tray.intersectObject(terrain, true)[0]; return h !== undefined ? h.point.y : 0 }
  const by_pid = new Map<string, THREE.Object3D>()
  world.props.traverse(o => { const pid = (o.userData?.map_extra as { pid?: string } | undefined)?.pid; if (pid !== undefined) by_pid.set(pid, o) })
  // the plan's 'player start' mark is for the editor only
  for (const sh of D.plan.shapes) if (sh.kind === 'player') { const o = by_pid.get(sh.id); if (o !== undefined) o.visible = false }
  // the name tags over the blocks (sprites do not travel in a GLB: drawn again from the plan)
  for (const sh of D.plan.shapes) {
    if (sh.label === '' || sh.kind === 'player' || sh.kind === 'zone' || sh.kind === 'unlock' || sh.kind === 'camera') continue
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
  let vmix: THREE.AnimationMixer | null = null // 🚜 a vehicle as the player (no skeleton): its own clips run while it drives / digs
  let skinned = false
  const gchar = D.char !== null ? await loader.parseAsync(b64(D.char), '') : null
  gchar?.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh === true) skinned = true })
  if (gchar !== null && !skinned) {
    const model = gchar.scene; model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.castShadow = true; m.frustumCulled = false } })
    const box = new THREE.Box3().setFromObject(model); const sz = box.getSize(new THREE.Vector3()); const big = Math.max(sz.x, sz.z)
    const k = big > 0 ? 2.6 / big : 1; model.scale.multiplyScalar(k); model.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(model); model.position.y -= b2.min.y
    const p = new THREE.Group(); p.add(model); p.position.set(0, 0, 0); scene.add(p); pawn = p
    const start = D.plan.shapes.find(s => s.kind === 'player'); if (start !== undefined) p.position.set(start.x, 0, start.z)
    if (gchar.animations.length > 0) { vmix = new THREE.AnimationMixer(model); for (const c of gchar.animations) vmix.clipAction(c).play() }
  } else if (D.char !== null) {
    const g = gchar!
    const model = g.scene; model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh === true) { m.castShadow = true; m.frustumCulled = false } })
    strip_root_motion(g.animations, model)
    ctrl = new CharacterController(model, map_clips(g.animations))
    ctrl.ground_at = (x, z, y) => world.ground_at(x, z, y)
    ctrl.move_filter = (a, b) => { world.block(a, b) }
    scene.add(ctrl.root)
  } else {
    const p = new THREE.Group(); const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 16), new THREE.MeshLambertMaterial({ color: 0xf97316 })); body.position.y = 0.72; body.castShadow = true; p.add(body); scene.add(p); pawn = p
  }
  await step(85)
  const player = (): THREE.Object3D | null => ctrl?.root ?? pawn
  const game = new Playable(D.plan, scene, (id) => by_pid.get(id) ?? null, player, view, () => {})
  view.querySelector<HTMLElement>('[data-exit]')?.remove()
  ;(window as any).__gbPlayable = { game, player } // for tests / recordings
  game.on_world = () => { world.refresh() }; world.refresh() // hidden / crumbled blocks are not solid
  for (const [name, glb] of Object.entries(D.items ?? {})) { try { game.item_models.set(name, (await loader.parseAsync(b64(glb), '')).scene) } catch { /* a box instead */ } }
  const fx = new PlayableFx(game, camera, view, { title, cta: D.cta ?? '', cta_label: D.cta_label, limit: D.limit ?? 0, tutorial: true, end: true })
  ;(window as any).__gbPlayable.fx = fx
  // controls: a floating joystick wherever the finger goes down; keyboard too
  const move = new THREE.Vector2(); const keys = new Set<string>(); let origin: { x: number, y: number } | null = null
  const knob = document.createElement('div'); knob.style.cssText = 'position:fixed;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;border:3px solid #fff8;background:#0002;display:none;z-index:25;pointer-events:none'
  const dot = document.createElement('div'); dot.style.cssText = 'position:absolute;left:35px;top:35px;width:40px;height:40px;border-radius:50%;background:#fffc'; knob.append(dot); document.body.append(knob)
  renderer.domElement.addEventListener('pointerdown', e => { fx.input(); origin = { x: e.clientX, y: e.clientY }; knob.style.display = 'block'; knob.style.left = `${e.clientX}px`; knob.style.top = `${e.clientY}px`; renderer.domElement.setPointerCapture(e.pointerId) })
  renderer.domElement.addEventListener('pointermove', e => {
    if (origin === null) return
    const dx = e.clientX - origin.x; const dy = e.clientY - origin.y; const L = Math.hypot(dx, dy); const k = Math.min(1, L / 50) / Math.max(1e-6, L)
    move.set(dx * k, -dy * k); dot.style.transform = `translate(${move.x * 35}px, ${-move.y * 35}px)`
  })
  const end = (): void => { origin = null; move.set(0, 0); knob.style.display = 'none'; dot.style.transform = '' }
  renderer.domElement.addEventListener('pointerup', end); renderer.domElement.addEventListener('pointercancel', end)
  addEventListener('keydown', e => { keys.add(e.code); fx.input() }); addEventListener('keyup', e => keys.delete(e.code))
  const cam = D.cam ?? { yaw: 0, pitch: 0.75, dist: 10 }
  cam.pitch = Math.max(0.7, cam.pitch) // playables look down on the map
  const resize = (): void => { const w = innerWidth; const h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.fov = w < h ? 62 : 50; camera.updateProjectionMatrix() }
  addEventListener('resize', resize); resize()
  const clock = new THREE.Timer(); const Y = new THREE.Vector3(0, 1, 0); let frames = 0
  addEventListener('blur', () => { keys.clear(); end() })
  renderer.setAnimationLoop(() => {
    clock.update()
    const dt = Math.min(0.05, clock.getDelta())
    const mv = move.clone()
    if (keys.has('KeyW') || keys.has('ArrowUp')) mv.y += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) mv.y -= 1
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mv.x -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) mv.x += 1
    if (mv.lengthSq() > 1) mv.normalize()
    if (fx.ended) mv.set(0, 0) // the end card is up
    if (ctrl !== null) {
      const input: Input = { move: mv, sprint: mv.length() > 0.85, walk: false, jump: false, roll: false, attack: false, block: false, crouch_toggle: false, hit_test: false }
      ctrl.update(dt, input, cam.yaw)
    } else if (pawn !== null) {
      const want = new THREE.Vector3(mv.x, 0, -mv.y).applyAxisAngle(Y, cam.yaw)
      if (vmix !== null) vmix.update(dt * (want.lengthSq() > 1e-4 || game.drilling ? 1 : 0.15))
      if (want.lengthSq() > 1e-4) {
        const sp = (vmix !== null ? 4.2 : 5) * dt
        // 🚜 a vehicle does not climb: what is ahead of its nose (an ore block, a rock, a counter) stops it; it can always back out
        const go = (vx: number, vz: number): boolean => {
          const b = pawn!.position.clone(); b.x += vx; b.z += vz; world.block(pawn!.position, b)
          if (Math.hypot(b.x - pawn!.position.x, b.z - pawn!.position.z) < 1e-5) return false
          if (vmix !== null) {
            const l = Math.hypot(vx, vz); const dx = vx / l; const dz = vz / l; const ty = terrain_y(b.x, b.z)
            const high = (x: number, z: number): number => world.ground_at(x, z, ty + 3) - terrain_y(x, z)
            // three feelers across the nose: a single one slips through the seam between two blocks
            const nose = Math.max(high(b.x + dx * 1.1, b.z + dz * 1.1), high(b.x + dx * 1.1 - dz * 0.6, b.z + dz * 1.1 + dx * 0.6), high(b.x + dx * 1.1 + dz * 0.6, b.z + dz * 1.1 - dx * 0.6)); const here = high(pawn!.position.x, pawn!.position.z); const there = high(b.x, b.z)
            if (!((nose < 0.35 && there < 0.35) || there < here - 0.01)) return false
          }
          pawn!.position.x = b.x; pawn!.position.z = b.z; return true
        }
        // blocked head-on: slide along the wall on the axis that is free (never a dead stop on a diagonal)
        if (!go(want.x * sp, want.z * sp)) { const ax = Math.abs(want.x) > 0.25 && go(want.x * sp, 0); if (!ax && Math.abs(want.z) > 0.25) go(0, want.z * sp) }
        { const ta = Math.atan2(want.x, want.z); let d = ta - pawn.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); pawn.rotation.y += d * Math.min(1, dt * (vmix !== null ? 6 : 20)) }
      }
      pawn.position.y = vmix !== null ? terrain_y(pawn.position.x, pawn.position.z) : world.ground_at(pawn.position.x, pawn.position.z, pawn.position.y)
      if (vmix !== null) { // the body: a small bounce on the road, it shakes while the drill bites, leans into turns
        const body = pawn.children.find(c => (c as any).__evolved === true && c.visible) ?? pawn.children[0]
        const tt = clock.elapsedTime; const moving = want.lengthSq() > 1e-4
        const by = (body as any).__by ?? ((body as any).__by = body.position.y)
        body.position.y = by + (moving ? Math.abs(Math.sin(tt * 14)) * 0.04 : 0) + (game.drilling ? (Math.random() - 0.5) * 0.05 : 0)
        body.rotation.x = game.drilling ? Math.sin(tt * 40) * 0.025 : moving ? -0.03 : 0
        body.rotation.z = game.drilling ? Math.sin(tt * 33) * 0.02 : 0
      }
    }
    game.update(dt); fx.update(dt, mv.lengthSq() > 1e-4)
    const p = player(); const target = p !== null ? p.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : new THREE.Vector3()
    const off = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)).multiplyScalar(cam.dist)
    // the first frame starts on the player (no fly-in from the map's corner)
    if (frames === 0) camera.position.copy(target).add(off); else camera.position.lerp(target.clone().add(off), 1 - Math.exp(-8 * dt))
    camera.lookAt(target); camera.position.add(fx.shake)
    if (++frames === 2) { splash.style.opacity = '0'; splash.style.pointerEvents = 'none'; setTimeout(() => splash.remove(), 500) }
    sun.position.copy(target).add(new THREE.Vector3(6, 12, 5)); sun.target.position.copy(target)
    renderer.render(scene, camera)
  })
}
void main()
