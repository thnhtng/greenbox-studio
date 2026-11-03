// Rig the chibi (white jacket) in headless Chrome and download "All animations · GLB" (input for render_sprites.py)
//   node dev/axhero/mascot/export_chibi.mjs <out_dir>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { UPLOAD, face_front } from '../scenes/common.mjs'
const out = path.resolve(process.argv[2] ?? '.')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbexp-'))
const sleep = t => new Promise(r => setTimeout(r, t))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9335', '--window-size=1280,720', '--user-data-dir=' + path.join(tmp, 'p'), 'about:blank'], { stdio: 'ignore' })
let ws = null
for (let i = 0; i < 60 && ws === null; i++) { await sleep(300); try { const l = await (await fetch('http://127.0.0.1:9335/json')).json(); const p = l.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl) } catch {} }
await new Promise(r => { ws.onopen = r })
let id = 0; const pend = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id !== undefined && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async js => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value }
const until = async (js, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(`return !!(${js})`)) return; await sleep(300) } throw new Error('timeout ' + js) }
await send('Page.enable'); await send('Runtime.enable')
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out })
await send('Page.navigate', { url: 'http://localhost:8080/rig3d/create.html' }); await sleep(1500)
await until('window.__gb3d', 20000); await sleep(800)
await ev(UPLOAD('#model-upload', [['/_tmp_shot/chibi.glb', 'chibi.glb']])); await sleep(4500)
await face_front(ev, sleep)
await ev(`const s = document.querySelector('#skeleton-selection'); s.value = 'human'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1`)
await sleep(2000); await ev(`document.querySelector('#load-skeleton-button').click(); return 1`)
await sleep(5000); await ev(`document.querySelector('#action_bind_pose').click(); return 1`)
await until(`window.__gb3d.process_step === 'animations-export'`, 60000); await sleep(1500)
const before = new Set(fs.readdirSync(out))
await ev(`document.querySelector('#easy-export-glb').click(); return 1`)
for (let i = 0; i < 120; i++) { await sleep(500); const n = fs.readdirSync(out).filter(f => !before.has(f) && f.endsWith('.glb')); if (n.length) { await sleep(1000); console.log(path.join(out, n[0])); break } }
ws.close(); chrome.kill(); fs.rmSync(tmp, { recursive: true, force: true })
