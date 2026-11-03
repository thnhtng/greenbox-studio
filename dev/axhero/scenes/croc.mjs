// Animals: 🧬 Clone rig — a rigged crocodile's skeleton + animations copied onto a plain (un-rigged) crocodile
import { SKIP_TOUR, english } from './common.mjs'
// the rigged crocodile: SRC=good → Downloads/crocodile_rigged.glb (same body, well rigged), else croc_Base_rigged.glb
const SRC = process.env.SRC === 'good' ? ['croc_good.glb', 'crocodile_rigged.glb'] : ['croc_rigged.glb', 'croc_Base_rigged.glb']
const UP = (sel, url, name) => `const b = await (await fetch('${url}')).blob(); const dt = new DataTransfer(); dt.items.add(new File([b], '${name}', { type: 'model/gltf-binary' })); const i = document.querySelector('${sel}'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return 1`
const PLAY = name => `const L = window.__gb3d.animations_listing_step; L.play_animation(L.animation_clips().findIndex(c => c.name === '${name}')); return 1`
// camera round the crocodile (the rig page's narrow lens: far away), yaw 90 = from the side
const CAM = (yaw, dist, h) => `const g = window.__gb3d, V = g.camera.position.constructor, c = new V(0, 0.6, -1.6), r = ${yaw} * Math.PI / 180; g.camera.position.set(c.x + Math.sin(r) * ${dist}, c.y + ${h}, c.z + Math.cos(r) * ${dist}); g.camera.lookAt(c); const oc = g.scene_environment?.orbit_controls?.(); if (oc) { oc.target.copy(c); oc.update() } return 1`
export default async ({ nav, ev, wait, until, start }) => {
  await english(nav, ev)
  await nav('rig3d/create.html?clone=1'); await until('window.__gb3d && document.querySelector(\'[data-f="1"]\')', 20000); await wait(1000); await ev(SKIP_TOUR)
  await start(); await wait(800)
  // 1: the rigged crocodile (its skeleton + 6 animations play beside it)
  await ev(UP('[data-f="1"]', '/_tmp_shot/' + SRC[0], SRC[1])); await wait(2600)
  // 2: the plain crocodile (Clone rig turns it to face the same way by itself)
  await ev(UP('[data-f="2"]', '/_tmp_shot/crocodile.glb', 'crocodile.glb')); await wait(2800)
  await wait(2400) // turned to face the rig file, both shown side by side
  await until('document.querySelector(\'[data-a="apply"]\')', 5000); await wait(600)
  // 3: apply — the skeleton is bent into this body and skinned
  await ev(`[...document.querySelectorAll('button')].find(b => /Apply the rig to my model|Áp dụng rig vào model/.test(b.textContent)).click(); return 1`)
  await until(`window.__gb3d.process_step === 'animations-export'`, 60000); await wait(500)
  await ev(SKIP_TOUR); await ev(`document.querySelectorAll('[data-a="close"]').forEach(b => b.click()); return 1`)
  await ev(CAM(35, 30, 7)); await ev(PLAY('walk')); await wait(2800)
  await ev(CAM(90, 29, 4)); await ev(PLAY('attack')); await wait(2200)
  await ev(CAM(60, 30, 6)); await ev(PLAY('idle')); await wait(1800)
}
