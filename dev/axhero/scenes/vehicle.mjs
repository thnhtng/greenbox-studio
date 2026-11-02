// Rig the bulldozer: load the FBX + textures → 🪄 Auto cut (wheels, tracks, blade) → drive / turn / blade animations
import { english } from './common.mjs'
const TEX = ['Bulldozer_AO', 'Bulldozer_D', 'Bulldozer_M', 'Bulldozer_N', 'Bulldozer_R', 'Glass_D', 'Glass_M', 'Glass_OP', 'Glass_R', 'Track_D', 'Track_M', 'Track_N', 'Track_OP', 'Track_R', 'track_Mixed_AO']
export default async ({ nav, ev, wait, until, start }) => {
  await english(nav, ev)
  await nav('rig3d/vehicle.html'); await until('window.__vehicle', 20000); await wait(1000)
  await start(); await wait(1500)
  await ev(`const files = [];
    for (const [u, n] of ${JSON.stringify([['/_tmp_shot/dozer.fbx', 'Bulldozer.fbx'], ...TEX.map(t => ['/_tmp_shot/' + t + '.png', t + '.png'])])}) files.push(new File([await (await fetch(u)).blob()], n));
    await window.__vehicle.load_file(files); return 1`)
  await wait(3500)
  await ev(`document.getElementById('vh-autocut').scrollIntoView({ block: 'center' }); document.getElementById('vh-autocut').style.outline = '3px solid #3cdc8c'; return 1`)
  await wait(1200)
  await ev(`document.getElementById('vh-autocut').click(); return 1`)
  await wait(3500)
  // the coloured parts were the cut; now the real model, a bit closer
  await ev(`const r = document.getElementById('vh-regions'); r.checked = false; r.dispatchEvent(new Event('change', { bubbles: true }));
    const V = window.__vehicle; V.camera.position.lerp(V.controls.target, 0.25); V.controls.update(); V.markers.visible = false; return 1`)
  for (const name of ['04_Drive', 'T_Pivot_Turn_Left', 'M_Blade_Raise', 'M_Blade_Push', 'T_Turn_Right']) {
    await ev(`const V = window.__vehicle; const i = V.clips.findIndex(c => c.name === '${name}'); if (i >= 0) V.play(i); return i`)
    await wait(3200)
  }
}
