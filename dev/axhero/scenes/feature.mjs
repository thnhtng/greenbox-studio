// One cockpit feature in action (FEAT = its id): sample inputs loaded, played ~7 s. Used for the "every feature" clips.
import { english, UPLOAD } from './common.mjs'
const F = process.env.FEAT, GO = F === 'gcarstack' ? 'gcar' : F === 'mapdraw' ? 'playtest' : F
const HP = js => `const w = document.getElementById('hpFrame').contentWindow, d = w.document; ${js}`
const HPUP = (slot, url, name) => HP(`const b = await (await fetch('${url}')).blob(); d.querySelector('[data-up="${slot}"]').click(); const dt = new DataTransfer(); dt.items.add(new File([b], '${name}', { type: b.type })); const f = d.getElementById('fImg'); f.files = dt.files; f.dispatchEvent(new Event('change')); return 1`)
const HPVID = (url) => HP(`const b = await (await fetch('${url}')).blob(); const dt = new DataTransfer(); dt.items.add(new File([b], 'gameplay.mp4', { type: 'video/mp4' })); const f = d.getElementById('fVid'); f.files = dt.files; f.dispatchEvent(new Event('change')); return 1`)
const HPSEEK = (t) => HP(`const s = d.getElementById('seek'); s.value = String(Math.round(${t} / w.__gbHp.state().dur * 1000)); s.dispatchEvent(new Event('input')); return 1`)
export default async ({ nav, ev, wait, start, key, down, up, click, drag }) => {
  await english(nav, ev)
  await ev(`localStorage.setItem('gbc.lay', 'dock'); localStorage.setItem('gbc.ui', 'k'); localStorage.setItem('gbc.feat', ${JSON.stringify(GO)}); return 1`)
  await nav('Greenbox-Cockpit.html'); await wait(2500)
  await ev(`window.__gbGo(${JSON.stringify(GO)}); return 1`); await wait(1800)
  const joy = ['joy', 'evo', 'stone', 'money', 'fuel']
  if (joy.includes(F)) {
    await ev(UPLOAD('#vidFile', [['/_tmp_shot/demo.mp4', 'gameplay.mp4']])); await wait(3000)
    const on = { evo: 'pbOn', money: 'mnOn' }[F]; if (on) { await ev(`const c = document.getElementById('${on}'); if (!c.checked) c.click(); return 1`); await wait(500) }
    const btn = { money: 'mnPlay', fuel: 'flPlay' }[F] || 'playBtn'
    await start(); await wait(400); await ev(`document.getElementById('${btn}').click(); return 1`)
    if (F === 'joy') { for (let i = 0; i < 3; i++) { await drag([[475, 432], [440, 400], [420, 380], [470, 360], [520, 390], [530, 440], [490, 470], [475, 432]], 60); await key('KeyQ', 120); await wait(300); await key('KeyE', 120) } }
    else if (F === 'stone') { for (let i = 0; i < 8; i++) { await key('Enter', 80); await wait(700) } }
    else await wait(7000)
    return
  }
  if (F === 'wheel') {
    await ev(`const b = new Uint8Array(await (await fetch('/_tmp_shot/truck.mp4')).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); await window.__gbTools.call('gb_drive', { action: 'load', video_b64: btoa(s), name: 'TruckCliff.mp4' }); await window.__gbTools.call('gb_drive', { action: 'auto' }); return 1`)
    await wait(1500); await start(); await ev(`document.getElementById('dr-playBtn').click(); return 1`); await wait(7500); return
  }
  if (['hpbar', 'countdown', 'vfx', 'endcard'].includes(F)) {
    await wait(1500)
    if (F === 'vfx') {
      await ev(HPVID('/_tmp_shot/demo.mp4')); await wait(2500)
      await ev(HP(`d.querySelector('[data-fxadd="blur"]').click(); return 1`)); await wait(400)
      for (const [t, k] of [[1.6, 'whip'], [3.4, 'flash'], [5.2, 'zoom']]) { await ev(HPSEEK(t)); await ev(HP(`d.querySelector('[data-tradd="${k}"]').click(); return 1`)); await wait(200) }
      await ev(HP(`const st = w.__gbHp.state(); st.fx.vig.on = true; st.fx.vig.hits = [2.4, 4.6]; w.__gbHp.refresh(); return 1`))
    }
    if (F === 'endcard') { await ev(HPUP('ecIcon', '/_tmp_shot/icon.png', 'icon.png')); await wait(500); await ev(HPUP('ecBg', '/_tmp_shot/bg.jpg', 'bg.jpg')); await wait(800) }
    await ev(HPSEEK(0)); await start(); await wait(300)
    await ev(HP(`d.getElementById('play').click(); return 1`)); await wait(F === 'endcard' ? 4000 : 7500); return
  }
  if (['gseq', 'gpick', 'gbag', 'gchest', 'gcar', 'gcarstack'].includes(F)) {
    if (F === 'gcarstack') {
      await ev(`const s = document.getElementById('gc-cstyle'); s.value = 'stack'; s.dispatchEvent(new Event('change')); return 1`)
      await ev(`const b = await (await fetch('/_tmp_shot/demo.mp4')).blob(); const dt = new DataTransfer(); dt.items.add(new File([b], 'bg.mp4', { type: 'video/mp4' })); const v = document.getElementById('gc-vid'); v.files = dt.files; v.dispatchEvent(new Event('change', { bubbles: true })); return 1`); await wait(2500)
    }
    if (F === 'gcar' || F === 'gcarstack') {
      await ev(`const b = await (await fetch('/_tmp_shot/icon.png')).blob(); document.querySelector('#gc-ec [data-up]').click(); const dt = new DataTransfer(); dt.items.add(new File([b], 'icon.png', { type: 'image/png' })); const f = document.getElementById('gc-ecFile'); f.files = dt.files; f.dispatchEvent(new Event('change')); return 1`); await wait(800)
      await ev(`document.getElementById('gc-aGo').click(); return 1`); await wait(800)
    }
    await start(); await wait(300); await ev(`document.getElementById('gc-play').click(); return 1`)
    if (F === 'gpick') { await drag([[420, 300], [520, 330], [640, 360], [760, 380], [700, 400], [640, 420]], 120) }
    await wait(7000); return
  }
  if (F === 'sfx') {
    await ev(`const b = new Uint8Array(await (await fetch('/_tmp_shot/demo.mp4')).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); const T = window.__gbTools; await T.call('gb_sfx', { action: 'load', video_b64: btoa(s), name: 'Bulldozer_City.mp4' }); return 1`)
    await start(); await wait(600)
    await ev(`await window.__gbTools.call('gb_sfx', { action: 'analyze' }); return 1`); await wait(1200)
    await ev(`await window.__gbTools.call('gb_sfx', { action: 'add_all', sound: 'impact' }); await window.__gbTools.call('gb_sfx', { action: 'add_all', sound: 'coin' }); return 1`); await wait(1500)
    await ev(`const f = [...document.querySelectorAll('#appSfx iframe')][0]; f.contentDocument.getElementById('bPlay').click(); return 1`); await wait(5000); return
  }
  // 3D pages inside the cockpit: their own window
  const RIG = (page, js) => `const f = window.__gbRig.frame('${page}'); for (let i = 0; i < 60 && !(f && f.contentWindow && f.contentWindow.document.readyState === 'complete'); i++) await new Promise(r => setTimeout(r, 200)); const w = f.contentWindow; ${js}`
  if (F === 'smash') {
    await wait(5000); await ev(RIG('smash.html', `for (let i = 0; i < 40 && !w.__smash; i++) await new Promise(r => setTimeout(r, 200)); w.__smash.preset('pyramid'); return 1`)); await wait(1500)
    await start(); await wait(800); await ev(RIG('smash.html', `w.__smash.auto(true); return 1`)); await wait(7500); return
  }
  if (F === 'mapdraw') {
    const { PLAN } = await import('./plan_from_map.mjs')
    await wait(6000); await ev(RIG('playtest.html', `for (let i = 0; i < 40 && !w.__playtest; i++) await new Promise(r => setTimeout(r, 200)); const P = w.__playtest; P.plan_ed.open(); P.plan_ed.set_plan({ shapes: [], wires: [] }); return 1`)); await wait(800)
    await start(); await wait(500)
    for (let n = 2; n <= PLAN.shapes.length; n += 2) { await ev(RIG('playtest.html', `w.__playtest.plan_ed.set_plan(${JSON.stringify({ shapes: PLAN.shapes.slice(0, 0), wires: [] })}); return 1`).replace(JSON.stringify({ shapes: PLAN.shapes.slice(0, 0), wires: [] }), JSON.stringify({ shapes: PLAN.shapes.slice(0, n), wires: [] }))); await wait(230) }
    await ev(RIG('playtest.html', `w.__playtest.plan_ed.set_plan(${JSON.stringify(PLAN)}); return 1`)); await wait(1500)
    await ev(RIG('playtest.html', `const P = w.__playtest; const plan = ${JSON.stringify(PLAN)}; P.plan_ed.close(); P.map.plan = JSON.parse(JSON.stringify(plan)); P.map.build_plan(plan); P.cam_dist = 60; P.cam_pitch = 1.0; return 1`)); await wait(3500); return
  }
  await start(); await wait(6000)
}
