// Editing the Bulldozer gameplay with the Money layout (Cockpit → Money counter): the gameplay video in, money keys
// where the gems are sold (+60) and where the upgrade is paid (-60), "Record & export", save. The saved MP4 lands in DL.
//   DL=<folder> node dev/axhero/rec.mjs dev/axhero/scenes/bd_money.mjs dev/axhero/videos/bd_money_edit.mp4
import fs from 'node:fs'
import { english, UPLOAD } from './common.mjs'
const CAP = (t) => `let c = document.getElementById('rec-cap'); if (!c) { c = document.createElement('div'); c.id = 'rec-cap'; c.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:linear-gradient(120deg,#16a34a,#065f46);color:#fff;border:0;border-radius:15px;padding:12px 16px;font:700 16px/1.4 Roboto,system-ui,sans-serif;max-width:640px'; document.body.appendChild(c); } c.textContent = ${JSON.stringify(t)}; return 1`
export default async ({ nav, ev, wait, start }) => {
  await english(nav, ev)
  await ev(`localStorage.setItem('gbc.lay', 'dock'); localStorage.setItem('gbc.ui', 'k'); localStorage.setItem('gbc.feat', 'money'); return 1`)
  await nav('Greenbox-Cockpit.html'); await wait(2500)
  await ev(`window.__gbGo('money'); return 1`); await wait(1500)
  await start(); await wait(400)
  await ev(CAP('Edit with the Money layout: the gameplay video in'))
  await ev(UPLOAD('#vidFile', [['/_tmp_shot/bd/bd_play.mp4', 'bulldozer-gameplay.mp4']])); await wait(3000)
  await ev(`const on = document.getElementById('mnOn'); if (!on.checked) on.click(); document.getElementById('mnKeys').scrollIntoView({ block: 'center' }); return 1`); await wait(700)
  await ev(CAP('Money keys on the video timeline: +$60 when the gems are sold, -$60 when the drill upgrade is paid'))
  await ev(`const box = document.getElementById('mnKeys'); let g = 0; while (box.querySelector('.mnrow button') && g++ < 40) box.querySelector('.mnrow button').click(); return 1`)
  for (const k of [[17, 19.6, 60], [23, 26, -60], [36, 36.5, 0]]) {
    await ev(`document.getElementById('mnAdd').click(); const rows = document.querySelectorAll('#mnKeys .mnrow'); const ins = rows[rows.length - 1].querySelectorAll('input'); ${JSON.stringify(k)}.forEach((v, i) => { ins[i].value = v; ins[i].dispatchEvent(new Event('input')) }); ins[0].dispatchEvent(new Event('blur')); return 1`)
    await wait(600)
  }
  await ev(CAP('Record & export: the gameplay with the money counter burned in'))
  await ev(`document.getElementById('mnRec').click(); return 1`)
  await ev(`await new Promise(r => { const t = setInterval(() => { if (!document.getElementById('result').hidden) { clearInterval(t); r(1) } }, 500) }); return 1`)
  await wait(800)
  const before = new Set(fs.readdirSync(process.env.DL))
  await ev(`document.getElementById('saveBtn').click(); return 1`)
  for (let i = 0; i < 60; i++) { await wait(500); const now = fs.readdirSync(process.env.DL).filter(f => !before.has(f) && !f.endsWith('.crdownload')); if (now.length > 0) break }
  await wait(600)
}
