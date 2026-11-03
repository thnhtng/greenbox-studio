// Two more hand-built maps (MAP=island | village), the white chibi inside (CHAR='[["/_tmp_shot/chibi.glb","chibi.glb"]]')
//   island:  the sea rises, an island is raised out of it, sand beach, a volcano, a beach village
//   village: a road painted across, a river dug and filled, a bridge, houses and fences along the road, forest hills
import { english } from './common.mjs'
import { hero_to_playtest } from './rig_hero.mjs'
const KIND = process.env.MAP || 'island'
const CAPTION = (t) => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border:0;border-radius:15px;padding:12px 16px;font:700 16px/1.4 Roboto,system-ui,sans-serif;max-width:640px'; document.body.appendChild(c); } c.textContent = ${JSON.stringify(t)}; return 1`
const SCR = `window.__scr = (x, z) => { const P = window.__playtest; const v = P.camera.position.clone().set(x, P.map.height_at(x, z), z).project(P.camera); const r = P.renderer.domElement.getBoundingClientRect(); return [Math.round(r.left + (v.x + 1) / 2 * r.width), Math.round(r.top + (1 - v.y) / 2 * r.height)] }; return 1`
const TOOL = t => `document.querySelector('#pt-mapedit [data-mt="${t}"]').click(); return 1`
const GROUND = (i, radius) => `document.querySelector('#pt-mapedit [data-gr="${i}"]').click(); window.__playtest.map.radius = ${radius}; return 1`
const SET = js => `const M = window.__playtest.map; ${js}; return 1`
const line = (pts, steps) => { const out = []; for (let s = 0; s < pts.length - 1; s++) for (let i = 0; i < steps; i++) { const t = i / steps; out.push([pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t]) } out.push(pts.at(-1)); return out }
const ring = (x, z, r, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push([x + Math.cos(a) * r, z + Math.sin(a) * r]) } return o }
export default async (api) => {
  const { nav, ev, wait, start, down, up, drag } = api
  await english(nav, ev)
  await hero_to_playtest(api)
  await ev(`document.querySelectorAll('button').forEach(b => { if (/^(Skip|Bỏ qua)$/.test(b.textContent.trim())) b.click() }); const P = window.__playtest; P.map.preset('flat'); for (const o of [...P.world.props.children]) if (o.userData.map_kind === undefined && o.name !== 'Terrain' && o.name !== 'Map objects') o.removeFromParent(); P.world.refresh(); if (P.dummy) P.dummy.visible = false; P.map.resize(84); P.cam_dist = 95; P.cam_pitch = 1.05; document.getElementById('pt-mapedit').scrollIntoView(); return 1`)
  await ev(SCR); await wait(1200)
  const stroke = async (pts, steps = 10, ms = 16) => { const px = await ev(`return ${JSON.stringify(line(pts, steps))}.map(p => window.__scr(p[0], p[1]))`); await drag(px, ms) }
  const place = async (list) => { for (let i = 0; i < list.length; i += 3) { await ev(`const P = window.__playtest; for (const [k, x, z, r] of ${JSON.stringify(list.slice(i, i + 3))}) P.map.add_object(k, x, z, r || 0, 1); return 1`); await wait(110) } await ev(`window.__playtest.map.autosave_now(); return 1`) }
  await start(); await wait(400)
  if (KIND === 'island') {
    await ev(CAPTION('1 · Sea level up: the whole map is ocean'))
    await ev(SET('M.sea = true; M.water = 0.9; M.rebuild()')); await wait(900)
    await ev(CAPTION('2 · Raise brush: an island comes out of the sea'))
    await ev(TOOL('raise')); await ev(SET('M.radius = 9; M.strength = 0.8')); await wait(150)
    for (const r of [12, 6]) await stroke(ring(0, 0, r, 14), 2, 14)
    await ev(CAPTION('3 · Sand beach all round, a volcano on one side'))
    await ev(GROUND(2, 3)); await stroke(ring(0, 0, 17, 26), 2, 12)
    await ev(TOOL('raise')); await ev(SET('M.radius = 5; M.strength = 1')); for (let k = 0; k < 2; k++) await stroke(ring(11, -10, 1.6, 8), 1, 12)
    await ev(GROUND(3, 4)); await stroke(ring(11, -10, 2.5, 12), 1, 12)
    await ev(GROUND(1, 2)); await stroke(ring(11, -10, 0.8, 8), 1, 12)
    await ev(CAPTION('4 · A beach village: huts, palms, crates, a flag'))
    await ev(TOOL('none'))
    await place([['house', -6, 4, 0.4], ['house', 0, 9, -0.2], ['house', -10, -3, 1.2], ['tree', -13, 6], ['tree', 6, 12], ['tree', -3, 13], ['tree', 12, 4], ['bush', 3, 5], ['bush', -8, 9], ['crate', 4, -2], ['crate', 5, -1], ['barrel', 3, -3], ['flag', 0, 3], ['fence', -3, -6, 0], ['fence', 1, -6, 0], ['rock', 14, -4], ['rock', -14, -8]])
  } else {
    await ev(CAPTION('1 · Paint a road across the map'))
    await ev(GROUND(5, 2)); await stroke([[-40, 2], [-20, 0], [0, 2], [20, -1], [40, 1]], 12, 12)
    await ev(CAPTION('2 · Dig a river and pour water in'))
    await ev(TOOL('dig')); await ev(SET('M.radius = 4; M.strength = 3; M.dig_depth = 2')); await wait(150)
    const river = [[8, -30], [12, -16], [9, 0], [12, 16], [8, 30]] // inside the edges, or the water runs out
    await stroke(river, 10, 12); await stroke([...river].reverse(), 10, 12)
    await ev(TOOL('pour')); await wait(150)
    { const [x, y] = await ev(`return window.__scr(10, -12)`); await api.click(x, y) } await wait(500)
    { const [x, y] = await ev(`return window.__scr(10, 14)`); await api.click(x, y) } await wait(500)
    await ev(CAPTION('3 · Forest hills on both sides'))
    await ev(TOOL('raise')); await ev(SET('M.radius = 7; M.strength = 1.6')); await wait(150)
    for (const [x, z] of [[-26, -22], [-14, -26], [26, 22], [30, -20]]) await stroke(ring(x, z, 2.5, 18), 1, 12)
    await ev(CAPTION('4 · A bridge, houses and fences along the road'))
    await ev(TOOL('none'))
    // the bridge: a wooden deck over the water (a plan block lifted to the road), fences as rails
    await ev(`const P = window.__playtest, M = P.map; const d = M.add_object('block', 10, 1, 0, 1, { size: [12, 0.35, 4.2], color: '#8b5a2b' }); d.position.y = 0.05; for (const z of [-1.2, 3.2]) for (const x of [6, 10, 14]) { const f = M.add_object('fence', x, z, 0, 1); f.position.y = 0.22 } M.autosave_now(); return 1`); await wait(300)
    await place([['house', -15, 9, 0], ['house', -24, -8, Math.PI], ['house', 24, 9, 0], ['house', 30, -7, Math.PI],
      ['fence', -12, 6, 0], ['fence', -18, 6, 0], ['fence', 21, 6, 0], ['fence', 27, 6, 0],
      ['pine', -26, -22], ['pine', -14, -26], ['pine', -22, -30], ['pine', 26, 22], ['pine', 30, -20], ['pine', 34, 18], ['tree', -6, -12], ['tree', 20, 16],
      ['barrel', -10, 4], ['crate', 18, 4], ['flag', -2, 5]])
  }
  await wait(800)
  await ev(CAPTION(KIND === 'island' ? '5 · Your character on the beach — playable right away' : '5 · Your character on the road — playable right away'))
  for (let i = 1; i <= 16; i++) { await ev(`const P = window.__playtest; P.cam_dist = ${(95 - i * 5.4).toFixed(1)}; P.cam_pitch = ${(1.05 - i * 0.045).toFixed(3)}; return 1`); await wait(70) }
  await ev(`const P = window.__playtest; P.cam_dist = 7; P.cam_pitch = 0.32; return 1`); await wait(300)
  await down('KeyW'); await wait(1600); await down('KeyD'); await wait(600); await up('KeyD'); await wait(500); await up('KeyW'); await wait(400)
  for (let i = 1; i <= 14; i++) { await ev(`const P = window.__playtest; P.cam_dist = ${7 + i * 3.2}; P.cam_pitch = ${(0.32 + i * 0.014).toFixed(3)}; return 1`); await wait(70) }
  await wait(1600)
}
