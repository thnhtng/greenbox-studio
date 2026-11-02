// Play test: the Hero rigged on "Use your model" goes to Play test and is driven with the keyboard / mouse
import { english } from './common.mjs'
import { hero_to_playtest } from './rig_hero.mjs'
export default async ({ nav, ev, wait, until, start, down, up, key, click }) => {
  await english(nav, ev)
  await hero_to_playtest({ nav, ev, wait, until })
  await start(); await wait(1500)
  await click(640, 400)
  await down('KeyW'); await wait(2200); await down('KeyD'); await wait(1300); await up('KeyD'); await wait(800)
  await key('Space', 150); await wait(900); await down('KeyA'); await wait(1600); await up('KeyA'); await wait(600); await up('KeyW')
  await wait(500)
  for (let i = 0; i < 3; i++) { await click(640, 400); await wait(450) }
  await wait(1000)
  await down('KeyS'); await wait(1500); await up('KeyS')
  await key('Space', 150); await wait(1500)
}
