// 2D layout picture → plan (written by the AI) → 3D playable map → play it with the Hero
import { english } from './common.mjs'
import { hero_to_playtest } from './rig_hero.mjs'
import { PLAN } from './plan_from_map.mjs'
const CAPTION = (t) => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:linear-gradient(120deg,#8A3796,#F50359);color:#fff;border:0;border-radius:15px;padding:12px 16px;font:700 16px/1.4 Roboto,system-ui,sans-serif;max-width:640px'; document.body.appendChild(c); } c.textContent = ${JSON.stringify(t)}; return 1`
export default async (api) => {
  const { nav, ev, wait, start, down, up, key, click } = api
  await english(nav, ev)
  await hero_to_playtest(api)
  await ev(`const img = new Image(); img.src = '/_tmp_shot/map_noend.png'; await img.decode(); window.__mapimg = img; return 1`)
  await start()
  await ev(`const P = window.__playtest; P.plan_ed.open(); P.plan_ed.set_background(window.__mapimg); P.plan_ed.set_plan({ shapes: [], wires: [] }); return 1`)
  await ev(CAPTION('1 · The 2D layout of the game (end-card room left out)')); await wait(3000)
  await ev(`window.__playtest.plan_ed.set_plan(${JSON.stringify(PLAN)}); return 1`)
  await ev(CAPTION('2 · Claude (MCP gb_map plan) reads it: rooms, cheese volcano, makers, counters, $ pads, belts')); await wait(4500)
  await ev(`const P = window.__playtest; const plan = ${JSON.stringify(PLAN)}; P.plan_ed.close(); P.map.plan = JSON.parse(JSON.stringify(plan)); P.map.build_plan(plan); P.start_playable(); return 1`)
  // a look at the whole map from high up, then down behind the Hero
  await ev(`const P = window.__playtest; P.cam_dist = 70; P.cam_pitch = 1.0; return 1`)
  await ev(CAPTION('3 · Built in 3D: the whole map')); await wait(2500)
  for (let i = 1; i <= 12; i++) { await ev(`const P = window.__playtest; P.cam_dist = ${70 - i * 4.5}; P.cam_pitch = ${1.0 - i * 0.02}; return 1`); await wait(90) }
  await ev(CAPTION('4 · Playable with the rigged Hero')); await wait(800)
  await click(640, 380)
  await down('KeyW'); await wait(2500); await down('KeyA'); await wait(900); await up('KeyA'); await wait(1500); await up('KeyW')
  await down('KeyD'); await wait(1800); await up('KeyD'); await down('KeyS'); await wait(2200); await up('KeyS')
  await down('KeyD'); await down('KeyW'); await wait(1500); await up('KeyW'); await up('KeyD'); await wait(1500)
}
