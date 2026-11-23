// Vehicle rig (round 37): drop the rigged bulldozer → its own skeleton shows → wheels + tracks drive →
// 🔩 bolt the loader arm to the body (click the pin) → the arm lifts round the bolt, the camera turns round it
import { english } from './common.mjs'
const TEX = ['Bulldozer_AO', 'Bulldozer_D', 'Bulldozer_M', 'Bulldozer_N', 'Bulldozer_R', 'Glass_D', 'Glass_M', 'Glass_OP', 'Glass_R', 'Track_D', 'Track_M', 'Track_N', 'Track_OP', 'Track_R', 'track_Mixed_AO']
const CAPTION = (t) => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:16px;bottom:44px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border:0;border-radius:15px;padding:12px 16px;font:700 16px/1.4 Roboto,system-ui,sans-serif;max-width:560px'; document.body.appendChild(c); } c.textContent = ${JSON.stringify(t)}; return 1`
const PLAY = name => `const V = window.__vehicle; const i = V.clips.findIndex(c => c.name === '${name}'); if (i >= 0) V.play(i); return i`
// camera round the vehicle: yaw from the front (0) to the left side (90), distance in vehicle lengths
const CAM = (yaw, dist, h) => `const V = window.__vehicle, c = V.controls.target, L = V.size.z, r = ${yaw} * Math.PI / 180; V.camera.position.set(c.x + Math.sin(r) * L * ${dist}, c.y + L * ${h}, c.z + Math.cos(r) * L * ${dist}); V.controls.update(); return 1`
export default async ({ nav, ev, wait, until, start, click }) => {
  await english(nav, ev)
  await nav('rig3d/vehicle.html'); await until('window.__vehicle', 20000); await wait(1000)
  await ev(`const files = [];
    for (const [u, n] of ${JSON.stringify([['/_tmp_shot/dozer.fbx', 'Bulldozer.fbx'], ...TEX.map(t => ['/_tmp_shot/' + t + '.png', t + '.png'])])}) files.push(new File([await (await fetch(u)).blob()], n));
    window.__files = files; return 1`)
  await start(); await wait(600)
  // 1 · drop it: the file's own skeleton shows at once
  await ev(CAPTION('1 · Drop a vehicle: its skeleton shows at once'))
  await ev(`await window.__vehicle.load_file(window.__files); window.__vehicle.markers.visible = false; const st = document.createElement('style'); st.textContent = '#vh-axle{display:none!important}'; document.head.append(st); return 1`)
  await ev(CAM(55, 1.5, 0.55)); await wait(2600)
  // 2 · drive: wheels turn, both tracks run round them
  await ev(CAPTION('2 · Drive: the wheels turn, the tracks run round them'))
  await ev(CAM(90, 1.35, 0.25)); await ev(PLAY('04_Drive')); await wait(3400)
  // 3 · bolt the loader arm to the body: select it, 🔩, click its pin
  await ev(CAPTION('3 · 🔩 Bolt the loader arm to the body: click its pin'))
  await ev(`const V = window.__vehicle; V.stop_anim(); V.select(100 + V.mechs.findIndex(m => m.name === 'Ladle1')); V.clear_rig(); return 1`)
  await ev(CAM(60, 1.45, 0.5)); await wait(700)
  await ev(`const b = document.getElementById('vh-anchor'); b.scrollIntoView({ block: 'center' }); b.style.outline = '3px solid #ffb020'; b.click(); return 1`); await wait(900)
  const [x, y] = await ev(`const V = window.__vehicle, j = V.mechs.findIndex(m => m.name === 'Ladle1'); let best = null;
    V.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (p.owner[i] === 100 + j && pos.getX(i) > 100) { const z = pos.getZ(i); if (!best || z < best[2]) best = [pos.getX(i), pos.getY(i), z] } });
    const v = new V.camera.position.constructor(...best).project(V.camera); const r = V.renderer.domElement.getBoundingClientRect();
    return [Math.round(r.left + (v.x + 1) / 2 * r.width), Math.round(r.top + (1 - v.y) / 2 * r.height)]`)
  await click(x, y + 2); await wait(1200)
  // 3b · the bucket is bolted to the arm's tip (click on the arm): it rides along
  await ev(CAPTION('🔩 …and the bucket to the tip of the arm'))
  await ev(`const V = window.__vehicle; V.stop_anim(); const m = V.mechs.find(m => m.name === 'Ladle2'); m.angle = 20; V.select(100 + V.mechs.indexOf(m)); V.clear_rig(); document.getElementById('vh-anchor').click(); return 1`); await wait(700)
  const [x2, y2] = await ev(`const V = window.__vehicle, j = V.mechs.findIndex(m => m.name === 'Ladle1'); let best = null;
    V.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) if (p.owner[i] === 100 + j && pos.getX(i) > 100) { const z = pos.getZ(i); if (!best || z > best[2]) best = [pos.getX(i), pos.getY(i), z] } });
    const v = new V.camera.position.constructor(...best).project(V.camera); const r = V.renderer.domElement.getBoundingClientRect();
    return [Math.round(r.left + (v.x + 1) / 2 * r.width), Math.round(r.top + (1 - v.y) / 2 * r.height)]`)
  await click(x2, y2); await wait(900)
  await ev(`document.getElementById('vh-anchor').style.outline = ''; return 1`)
  // 4 · lift: the arm turns round the bolt (it does not fly up), the camera goes round it
  await ev(CAPTION('4 · Lift: the arm turns round the bolt, the rest stays bolted'))
  await ev(`window.__vehicle.hinge_marker.visible = false; return 1`) // the rest-pose hinge line would stay behind while the arm lifts
  await ev(PLAY('M_Blade_Raise'))
  for (let i = 0; i <= 40; i++) { await ev(CAM(60 + i * 1.2, 1.6 + i * 0.015, 0.5 - i * 0.002)); await wait(90) }
  await ev(CAPTION('5 · Every move is a clip: drive, turn, lift — export GLB / FBX'))
  await ev(PLAY('T_Pivot_Turn_Left')); await ev(CAM(30, 1.6, 0.6)); await wait(2600)
}
