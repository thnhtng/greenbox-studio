// Video mocap: the rigged character copies a person from a video (the sample kickboxing clip that ships with Greenbox)
import { english } from './common.mjs'
import { hero_to } from './rig_hero.mjs'
export default async (api) => {
  const { nav, ev, wait, until, start } = api
  await english(nav, ev)
  await hero_to(api, 'mocap')
  await start(); await wait(1500)
  await ev(`document.getElementById('mc-vsample').style.outline = '3px solid #3cdc8c'; return 1`); await wait(800)
  await ev(`document.getElementById('mc-vsample').click(); return 1`); await wait(2500)
  await ev(`document.getElementById('mc-run').click(); return 1`)
  await until(`window.__mocap.frames.length > 0 && !window.__mocap.busy`, 240000); await wait(800)
  // play the video and the character side by side
  await ev(`const m = window.__mocap; m.video.currentTime = 0; m.video.muted = true; await m.video.play().catch(() => {}); return 1`)
  await wait(12500)
}
