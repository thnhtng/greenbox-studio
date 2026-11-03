// SMASH DOWN on a turntable: the stack turns whole; only what the shots hit falls
import { english } from './common.mjs'
export default async ({ nav, ev, wait, until, start }) => {
  await english(nav, ev)
  await nav('rig3d/smash.html'); await until('window.__smash', 20000); await wait(800)
  await ev(`const S = window.__smash; S.preset('towers'); S.base('spin', 0.7, '#ffffff'); return 1`); await wait(600)
  await start(); await wait(2600)
  for (const [x, y] of [[0.5, 0.42], [0.42, 0.5], [0.58, 0.36], [0.5, 0.55], [0.45, 0.3]]) { await ev(`window.__smash.shoot(${x}, ${y}); return 1`); await wait(1100) }
  await wait(1500)
}
