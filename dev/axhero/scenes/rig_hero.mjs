// set-up (not filmed): rig the Hero and send him to Play test
import { UPLOAD, CHAR, face_front } from './common.mjs'
export async function hero_to_playtest (api) { return hero_to(api, 'playtest') }

// set-up (not filmed): rig the character and send it to Play test or Video mocap
export async function hero_to ({ nav, ev, wait, until }, where) {
  await nav('rig3d/create.html'); await until('window.__gb3d', 20000); await wait(800)
  await ev(UPLOAD('#model-upload', CHAR))
  await wait(4500)
  await face_front(ev, wait)
  await ev(`const s = document.querySelector('#skeleton-selection'); s.value = 'human'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1`)
  await wait(2000); await ev(`document.querySelector('#load-skeleton-button').click(); return 1`)
  await wait(5000); await ev(`document.querySelector('#action_bind_pose').click(); return 1`)
  await until(`window.__gb3d.process_step === 'animations-export'`, 60000); await wait(1500)
  if (where === 'mocap') {
    await ev(`document.querySelector('#easy-mocap').click(); return 1`)
    await until(`location.pathname.endsWith('mocap.html') && window.__mocap && window.__mocap.rig`, 60000); await wait(2500); return
  }
  await ev(`document.querySelector('#easy-playtest').click(); return 1`)
  await until(`location.pathname.endsWith('playtest.html') && window.__playtest && window.__playtest.ctrl`, 60000); await wait(2500)
}
