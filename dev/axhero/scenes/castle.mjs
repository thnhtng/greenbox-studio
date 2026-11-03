// Map building by hand: map size → mountains (raise brush) → river (dig + pour water) → a citadel with the character inside
// (CHAR='[["/_tmp_shot/chibi.glb","chibi.glb"]]' = the white chibi)
import { english } from './common.mjs'
import { hero_to_playtest } from './rig_hero.mjs'
const CAPTION = (t) => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border:0;border-radius:15px;padding:12px 16px;font:700 16px/1.4 Roboto,system-ui,sans-serif;max-width:640px'; document.body.appendChild(c); } c.textContent = ${JSON.stringify(t)}; return 1`
// world (x, z) on the ground → page pixel
const SCR = `window.__scr = (x, z) => { const P = window.__playtest; const v = P.camera.position.clone().set(x, P.map.height_at(x, z), z).project(P.camera); const r = P.renderer.domElement.getBoundingClientRect(); return [Math.round(r.left + (v.x + 1) / 2 * r.width), Math.round(r.top + (1 - v.y) / 2 * r.height)] }; return 1`
const TOOL = t => `document.querySelector('#pt-mapedit [data-mt="${t}"]').click(); return 1`
const SIZE = m => `const s = document.querySelector('#pt-mapedit [data-k="msize"]'); s.value = '${m}'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return 1`
// a stroke through world points, many small mouse steps (the brush works once per move)
const line = (pts, steps) => { const out = []; for (let s = 0; s < pts.length - 1; s++) for (let i = 0; i < steps; i++) { const t = i / steps; out.push([pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t]) } out.push(pts.at(-1)); return out }
export default async (api) => {
  const { nav, ev, wait, start, down, up, drag, click } = api
  await english(nav, ev)
  await hero_to_playtest(api)
  await ev(`document.querySelectorAll('button').forEach(b => { if (/^(Skip|Bỏ qua)$/.test(b.textContent.trim())) b.click() }); const P = window.__playtest; P.map.preset('flat'); for (const o of [...P.world.props.children]) if (o.userData.map_kind === undefined && o.name !== 'Terrain' && o.name !== 'Map objects') o.removeFromParent(); P.world.refresh(); P.map.resize(90); P.map.radius = 6; P.map.strength = 3; P.map.dig_depth = 2.2; P.cam_dist = 105; P.cam_pitch = 1.05; document.getElementById('pt-mapedit').scrollIntoView(); return 1`)
  await ev(SCR); await wait(1200)
  const stroke = async (pts, steps = 10, ms = 22) => { const px = await ev(`return ${JSON.stringify(line(pts, steps))}.map(p => window.__scr(p[0], p[1]))`); await drag(px, ms) }
  await start(); await wait(400)
  // 1 · the whole ground square
  await ev(CAPTION('1 · Map size: the whole ground square, any size'))
  for (const m of [102, 114, 126]) { await ev(SIZE(m)); await wait(450) }
  await wait(500)
  // 2 · mountains behind the castle
  await ev(CAPTION('2 · Raise brush: a mountain range'))
  await ev(TOOL('raise')); await wait(200)
  // peaks of different heights (small circles over one spot = a cone), then rock on the slopes and snow on the tops
  await ev(`window.__playtest.map.radius = 7; window.__playtest.map.strength = 2; return 1`)
  const ring = (x, z, r, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push([x + Math.cos(a) * r, z + Math.sin(a) * r]) } return o }
  const peaks = [[-38, -38, 3], [-20, -46, 4], [0, -40, 5], [20, -47, 4], [38, -39, 3]]
  for (const [x, z, k] of peaks) await stroke(ring(x, z, 2.5, 6 * k), 1, 14)
  await ev(`document.querySelector('#pt-mapedit [data-gr="3"]').click(); window.__playtest.map.radius = 8; return 1`); await wait(150)
  await stroke([[-44, -40], [-22, -46], [0, -42], [22, -47], [44, -40]], 10, 12)
  await ev(`document.querySelector('#pt-mapedit [data-gr="4"]').click(); window.__playtest.map.radius = 3; return 1`); await wait(150)
  for (const [x, z, k] of peaks) if (k >= 4) await stroke(ring(x, z, 1.5, 8), 1, 12)
  await ev(`window.__playtest.map.radius = 6; window.__playtest.map.strength = 3; return 1`)
  // 3 · a river in front of it
  await ev(CAPTION('3 · Dig a river bed, pour water in'))
  await ev(TOOL('dig')); await wait(200)
  const river = [[-46, 30], [-24, 22], [0, 28], [24, 22], [46, 30]] // inside the edges, or the water runs out
  await stroke(river, 10, 14); await stroke([...river].reverse(), 10, 14)
  await ev(`window.__playtest.map.strength = 1; return 1`); await ev(TOOL('pour')); await wait(200)
  { const [x, y] = await ev(`return window.__scr(0, 28)`); await click(x, y) }
  await wait(900)
  // 4 · the citadel: walls with a gate, corner towers, the keep, a flag
  await ev(CAPTION('4 · A citadel: walls, gate, towers, keep'))
  await ev(TOOL('none'))
  const pieces = []
  // walls snap to the 1.5 m grid: 4 m pieces every 3 m overlap a little, no gaps
  for (let i = 0; i < 8; i++) { const a = -10.5 + i * 3; pieces.push(['wall', a, -12, 0]); pieces.push(['wall', -12, a, Math.PI / 2]); pieces.push(['wall', 12, a, Math.PI / 2]); if (i !== 3 && i !== 4) pieces.push(['wall', a, 12, 0]) }
  pieces.push(['tower', -12, -12, 0], ['tower', 12, -12, 0], ['tower', -12, 12, 0], ['tower', 12, 12, 0], ['tower', -4.5, 13.5, 0], ['tower', 4.5, 13.5, 0])
  pieces.push(['house', -6, -6, 0], ['house', 6, -6, 0], ['tower', 0, -7, 0], ['flag', 0, 4, 0], ['tree', -8, 5, 0], ['tree', 8, 5, 0])
  for (let i = 0; i < pieces.length; i += 3) { await ev(`const P = window.__playtest; for (const [k, x, z, r] of ${JSON.stringify(pieces.slice(i, i + 3))}) P.map.add_object(k, x, z, r, 1); return 1`); await wait(110) }
  await ev(`window.__playtest.map.autosave_now(); return 1`); await wait(900)
  // 5 · down to the Hero standing inside
  await ev(CAPTION('5 · Your character inside — playable right away'))
  await ev(`const P = window.__playtest; if (P.dummy) P.dummy.visible = false; return 1`)
  for (let i = 1; i <= 16; i++) { await ev(`const P = window.__playtest; P.cam_dist = ${(105 - i * 6.0).toFixed(1)}; P.cam_pitch = ${(1.05 - i * 0.045).toFixed(3)}; return 1`); await wait(70) }
  await ev(`const P = window.__playtest; P.cam_dist = 7; P.cam_pitch = 0.32; return 1`); await wait(300)
  await down('KeyW'); await wait(1600); await down('KeyA'); await wait(700); await up('KeyA'); await wait(600); await up('KeyW'); await wait(500)
  // pull back: the citadel, the river in front, the mountains behind
  for (let i = 1; i <= 14; i++) { await ev(`const P = window.__playtest; P.cam_dist = ${7 + i * 3.4}; P.cam_pitch = ${(0.32 + i * 0.012).toFixed(3)}; return 1`); await wait(70) }
  await wait(1600)
}
