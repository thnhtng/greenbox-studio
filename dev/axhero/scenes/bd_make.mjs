// Making the Bulldozer playable in Greenbox (Play test): models in → quarry ground → Polyfork props → the 2D plan
// (ore wall, sell skip, $ upgrade pad = evolve) → play test → one HTML file.
//   node dev/axhero/rec.mjs dev/axhero/scenes/bd_make.mjs dev/axhero/videos/bd_make.mp4
import { english } from './common.mjs'
const CAP = (t) => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border:0;border-radius:15px;padding:12px 16px;font:700 16px/1.4 Roboto,system-ui,sans-serif;max-width:680px'; document.body.appendChild(c); } c.textContent = ${JSON.stringify(t)}; return 1`
const PT = js => `const fr = [...document.querySelectorAll('iframe')].find(f => /playtest/.test(f.src)); const w = fr.contentWindow, d = w.document, P = w.__playtest; ${js}`
export default async ({ nav, ev, wait, start, down, up }) => {
  await english(nav, ev)
  await ev(`localStorage.setItem('gbc.lay', 'dock'); localStorage.setItem('gbc.ui', 'k'); localStorage.setItem('gbc.feat', 'playtest'); return 1`)
  await nav('Greenbox-Cockpit.html'); await wait(3000)
  await ev(`window.__gbGo('playtest'); return 1`); await wait(5000)
  await ev(PT(`d.querySelectorAll('button').forEach(b => { if (/^(Skip|Bỏ qua)$/.test(b.textContent.trim())) b.click() }); await new Promise(r => { const s = d.createElement('script'); s.src = '/dev/axhero/scenes/bd_build.js'; s.onload = r; d.head.append(s) }); P.map.preset('flat'); P.cam_dist = 26; P.cam_pitch = 0.95; P.cam_yaw = 0.35; return 1`))
  await start(); await wait(500)
  await ev(CAP('1 · Drop in the Bulldozer Master models: the roller crusher (player), the drill crusher, 3 ores, Polyfork props'))
  await ev(PT(`await w.__bdLoad(); return 1`)); await wait(1200)
  await ev(CAP('2 · The quarry: a dirt floor, roads to the sell skip and the upgrade pad'))
  await ev(PT(`w.__bdMap('ground'); return 1`)); await wait(1800)
  await ev(CAP('3 · Props from Polyfork (free low-poly kit): barriers, floodlights, crystals, a pallet'))
  await ev(PT(`w.__bdMap('decor'); return 1`)); await wait(1800)
  await ev(CAP('4 · The 2D plan: a wall of ores row by row (copper → amethyst → diamond), a sell skip, a $ pad that evolves the drill'))
  await ev(PT(`w.__bdMap('plan'); P.map.show_wires?.(false); return 1`)); await wait(600)
  for (let i = 1; i <= 12; i++) { await ev(PT(`P.cam_dist = ${26 - i * 0.8}; P.cam_yaw = ${(0.35 - i * 0.03).toFixed(3)}; return 1`)); await wait(80) }
  await wait(1200)
  await ev(CAP('5 · Play test: drill the ore, gems burst into the bin, sell them, the arrow shows what to do next'))
  await ev(PT(`P.cam_dist = 13; P.cam_pitch = 0.75; P.cam_yaw = 0; P.start_playable(); return 1`)); await wait(800)
  await down('KeyW'); await wait(3800); await up('KeyW'); await wait(2600)
  await down('KeyS'); await wait(1200); await up('KeyS'); await down('KeyA'); await wait(900); await up('KeyA'); await wait(500)
  await ev(CAP('6 · One click: the playable as ONE HTML file (4.5 MB) + a Unity package with the MonoBehaviours (OreDrill, SellNode, DrillUpgrade)'))
  await wait(2600)
}
