// Rig the Hero (T-pose FBX): upload → human skeleton fitted by itself → skin → animations
import { UPLOAD, SKIP_TOUR, english, CHAR, face_front } from './common.mjs'
export default async ({ nav, ev, wait, until, start }) => {
  await english(nav, ev)
  await nav('rig3d/create.html'); await until('window.__gb3d', 20000); await wait(800); await ev(SKIP_TOUR)
  await start(); await wait(1200)
  await ev(UPLOAD('#model-upload', CHAR))
  await wait(4500)
  await face_front(ev, wait); await ev(SKIP_TOUR)
  await ev(`const s = document.querySelector('#skeleton-selection'); s.value = 'human'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1`)
  await wait(2000)
  await ev(`document.querySelector('#load-skeleton-button').click(); return 1`)
  await wait(5000); await ev(SKIP_TOUR)
  await ev(`document.querySelector('#action_bind_pose').click(); return 1`)
  await until(`window.__gb3d.process_step === 'animations-export'`, 60000); await wait(1500); await ev(SKIP_TOUR)
  for (const name of ['Walk', 'Sword_Regular_Combo', 'Dance_Simple', 'Backflip']) {
    await ev(`const L = window.__gb3d.animations_listing_step; const i = L.animation_clips().findIndex(c => c.name === '${name}'); if (i >= 0) L.play_animation(i); return i`)
    await wait(3500)
  }
}
