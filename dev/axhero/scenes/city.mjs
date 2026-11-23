// A small high-rise city built with the house tools: roads painted as a crossroads, 8 buildings rising floor by floor
// (house walls with windows, a door on the street, a floor slab per storey, a roof on top), trees along the streets,
// then the character walks down the street and the camera pulls up over the city.
//   node dev/axhero/rec.mjs dev/axhero/scenes/city.mjs dev/axhero/videos/city_s.mp4
import { english } from './common.mjs'
import { hero_to_playtest } from './rig_hero.mjs'
const CAPTION = (t) => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border:0;border-radius:15px;padding:12px 16px;font:700 16px/1.4 Roboto,system-ui,sans-serif;max-width:640px'; document.body.appendChild(c); } c.textContent = ${JSON.stringify(t)}; return 1`
const SCR = `window.__scr = (x, z) => { const P = window.__playtest; const v = P.camera.position.clone().set(x, P.map.height_at(x, z), z).project(P.camera); const r = P.renderer.domElement.getBoundingClientRect(); return [Math.round(r.left + (v.x + 1) / 2 * r.width), Math.round(r.top + (1 - v.y) / 2 * r.height)] }; return 1`
const line = (pts, steps) => { const out = []; for (let s = 0; s < pts.length - 1; s++) for (let i = 0; i < steps; i++) { const t = i / steps; out.push([pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t]) } out.push(pts.at(-1)); return out }
// [centre x, centre z, pieces along x, pieces along z, storeys, door side (+1 = +z, -1 = -z)]
const BUILDINGS = [[-13.5, -13.5, 3, 3, 6, 1], [13.5, -13.5, 4, 3, 5, 1], [-13.5, 13.5, 3, 4, 4, -1], [13.5, 13.5, 3, 3, 6, -1],
  [-30, -13.5, 3, 3, 3, 1], [30, 13.5, 3, 3, 4, -1], [-13.5, -30, 3, 3, 2, 1], [13.5, 30, 4, 3, 3, -1]]
/** the wall pieces of one storey: hwall / window, a door in the middle of the street side on the ground floor */
function storey ([cx, cz, nx, nz, , door], lv) {
  const out = []; const W = nx * 3; const D = nz * 3
  for (let i = 0; i < nx; i++) {
    const x = cx - W / 2 + 1.5 + i * 3
    for (const s of [-1, 1]) {
      const mid = i === Math.floor(nx / 2)
      const kind = lv === 0 && s === door && mid ? 'door' : (lv > 0 || !mid) && i % 2 === (lv % 2) ? 'window' : 'hwall'
      out.push([kind, x, cz + s * D / 2, 0, lv])
    }
  }
  for (let i = 0; i < nz; i++) { const z = cz - D / 2 + 1.5 + i * 3; for (const s of [-1, 1]) out.push([lv > 0 && i % 2 === 1 ? 'window' : 'hwall', cx + s * W / 2, z, Math.PI / 2, lv]) }
  return out
}
export default async (api) => {
  const { ev, wait, start, drag, down, up } = api
  await english(api.nav, ev)
  await hero_to_playtest(api)
  await ev(`document.querySelectorAll('button').forEach(b => { if (/^(Skip|Bỏ qua)$/.test(b.textContent.trim())) b.click() }); const P = window.__playtest; P.map.preset('flat'); for (const o of [...P.world.props.children]) if (o.userData.map_kind === undefined && o.name !== 'Terrain' && o.name !== 'Map objects') o.removeFromParent(); P.world.refresh(); P.map.resize(90); P.map.radius = 3.2; P.map.strength = 3; P.cam_dist = 95; P.cam_pitch = 1.0; P.cam_yaw = 0.5; document.getElementById('pt-mapedit').scrollIntoView(); if (P.dummy) P.dummy.visible = false; return 1`)
  await ev(SCR); await wait(1200)
  const stroke = async (pts, steps = 12, ms = 14) => { const px = await ev(`return ${JSON.stringify(line(pts, steps))}.map(p => window.__scr(p[0], p[1]))`); await drag(px, ms) }
  await start(); await wait(400)
  // 1 · streets
  await ev(CAPTION('1 · Paint the streets: a crossroads'))
  await ev(`document.querySelector('#pt-mapedit [data-mt="paint"]').click(); document.querySelector('#pt-mapedit [data-gr="5"]').click(); window.__playtest.map.radius = 3.2; return 1`); await wait(200)
  await stroke([[-44, 0], [44, 0]], 30); await stroke([[0, -44], [0, 44]], 30)
  await stroke([[-44, 22], [-6, 22]], 14); await stroke([[6, -22], [44, -22]], 14)
  await ev(`document.querySelector('#pt-mapedit [data-mt="none"]').click(); return 1`); await wait(300)
  // 2 · the towers go up, one storey at a time (every building gets its next floor in turn)
  await ev(CAPTION('2 · House walls, windows, doors — floor by floor'))
  const top = Math.max(...BUILDINGS.map(b => b[4]))
  for (let lv = 0; lv < top; lv++) {
    if (lv === 2) await ev(CAPTION('3 · Each storey: a floor slab, walls, windows — up to 6 floors'))
    const list = []; BUILDINGS.forEach(b => { if (lv < b[4]) list.push(...storey(b, lv)) })
    if (lv > 0) await ev(`const P = window.__playtest; for (const b of ${JSON.stringify(BUILDINGS.filter(b => lv < b[4]))}) P.map.add_floor_at(b[0], b[1], ${lv}); return 1`)
    for (let i = 0; i < list.length; i += 14) { await ev(`const P = window.__playtest; for (const [k, x, z, r, lv] of ${JSON.stringify(list.slice(i, i + 14))}) P.map.add_object(k, x, z, r, 1, { lv }); return 1`); await wait(60) }
    await ev(`const P = window.__playtest; P.cam_yaw += 0.12; P.cam_dist = ${95 - lv * 3}; return 1`); await wait(350)
  }
  await ev(CAPTION('4 · A roof on each top floor'))
  for (const b of BUILDINGS) { await ev(`window.__playtest.map.add_roof_at(${b[0]}, ${b[1]}, ${b[4] - 1}); return 1`); await wait(120) }
  // 5 · trees along the streets
  await ev(CAPTION('5 · Trees along the streets'))
  const trees = []; for (const t of [-40, -33, -24, -6, 6, 24, 33, 40]) { trees.push(['tree', t, 4.5], ['tree', t, -4.5], ['tree', 4.5, t], ['tree', -4.5, t]) }
  for (let i = 0; i < trees.length; i += 8) { await ev(`const P = window.__playtest; for (const [k, x, z] of ${JSON.stringify(trees.slice(i, i + 8))}) P.map.add_object(k, x, z, Math.random() * 6, 0.9 + Math.random() * 0.3); return 1`); await wait(90) }
  await ev(`window.__playtest.map.autosave_now(); return 1`); await wait(700)
  // 6 · down to the street: the character walks between the towers
  await ev(CAPTION('6 · Walk your character through the city'))
  await ev(`const P = window.__playtest; if (P.ctrl) { P.ctrl.root.position.set(1.5, 0, 30); P.ctrl.yaw = Math.PI; P.ctrl.root.rotation.y = Math.PI } return 1`)
  for (let i = 1; i <= 16; i++) { await ev(`const P = window.__playtest; P.cam_dist = ${(83 - i * 4.6).toFixed(1)}; P.cam_pitch = ${(1.0 - i * 0.04).toFixed(3)}; P.cam_yaw = ${(1.46 - i * 0.09).toFixed(3)}; return 1`); await wait(70) }
  await ev(`const P = window.__playtest; P.cam_dist = 9; P.cam_pitch = 0.3; P.cam_yaw = 0; return 1`); await wait(300)
  await down('KeyW'); await wait(3600); await up('KeyW'); await wait(400)
  // pull up over the whole city
  await ev(CAPTION('Greenbox: a playable city, built in minutes'))
  for (let i = 1; i <= 22; i++) { await ev(`const P = window.__playtest; P.cam_dist = ${9 + i * 3.6}; P.cam_pitch = ${(0.3 + i * 0.03).toFixed(3)}; P.cam_yaw = ${(i * 0.05).toFixed(3)}; return 1`); await wait(70) }
  await wait(1800)
}
