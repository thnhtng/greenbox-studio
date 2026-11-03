// SMASH DOWN variants: the same stack on all 6 bases (with colours), then shots on the turntable
import { english } from './common.mjs'
const CAP = t => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:312px;top:150px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border-radius:12px;padding:8px 12px;font:800 18px/1.3 Roboto,system-ui,sans-serif'; document.body.appendChild(c) } c.textContent = ${JSON.stringify(t)}; return 1`
export default async ({ nav, ev, wait, until, start }) => {
  await english(nav, ev)
  await nav('rig3d/smash.html'); await until('window.__smash', 20000); await wait(800)
  await ev(`window.__smash.preset('pyramid'); window.__smash.base('table', 0.7, '#ffffff'); return 1`); await wait(600)
  await start(); await wait(300)
  for (const [k, c, t] of [['table', '#ffffff', 'Table'], ['pedestal', '#e53935', 'Round pedestal'], ['steps', '#2457d6', 'Podium steps'], ['float', '#c08a52', 'Floating island'], ['slide', '#4fed89', '⇆ Slider'], ['spin', '#ffffff', '⟳ Turntable']]) {
    await ev(`window.__smash.base('${k}', 0.8, '${c}'); return 1`); await ev(CAP(t)); await wait(k === 'slide' ? 1800 : 1100)
  }
  await wait(900)
  for (const [x, y] of [[0.5, 0.45], [0.42, 0.52], [0.58, 0.4], [0.5, 0.55]]) { await ev(`window.__smash.shoot(${x}, ${y}); return 1`); await wait(900) }
  await wait(1200)
}
