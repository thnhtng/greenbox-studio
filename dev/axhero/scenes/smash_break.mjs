// SMASH DOWN: build your own base (thick, thin, 2 thin pillars, round…), then shots that BREAK the pieces
import { english } from './common.mjs'
const CAP = t => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:312px;top:150px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border-radius:12px;padding:8px 12px;font:800 18px/1.3 Roboto,system-ui,sans-serif'; document.body.appendChild(c) } c.textContent = ${JSON.stringify(t)}; return 1`
export default async ({ nav, ev, wait, until, start }) => {
  await english(nav, ev)
  await nav('rig3d/smash.html'); await until('window.__smash', 20000); await wait(800)
  await ev(`const S = window.__smash; S.preset('pyramid'); S.hit('knock'); S.build_base({ shape: 'box', thick: 0.5, width: 1, depth: 1.2, legs: 'solid' }); return 1`); await wait(500)
  await start(); await wait(300)
  for (const [o, t] of [[{ shape: 'box', thick: 0.5, width: 1, depth: 1.2, legs: 'solid' }, 'Thick block'], [{ shape: 'box', thick: 0.04, width: 1.1, depth: 1, legs: 'two' }, 'Thin + 2 pillars'], [{ shape: 'round', thick: 0.16, width: 1.2, depth: 1, legs: 'pole' }, 'Round + 1 pole'], [{ shape: 'box', thick: 0.1, width: 1.4, depth: 2.2, legs: 'four' }, 'Wide + 4 legs']]) {
    await ev(`window.__smash.build_base(${JSON.stringify(o)}); return 1`); await ev(CAP('🛠 ' + t)); await wait(1200)
  }
  await ev(`window.__smash.hit('break'); return 1`); await ev(CAP('💥 Break mode')); await wait(500)
  for (const [x, y] of [[0.5, 0.42], [0.42, 0.5], [0.58, 0.38], [0.5, 0.55]]) { await ev(`window.__smash.shoot(${x}, ${y}); return 1`); await wait(900) }
  await wait(1500)
}
