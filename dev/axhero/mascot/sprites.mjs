// node dev/axhero/mascot/sprites.mjs '<json opts>' <out_dir>   (serve.py on :8080) -> out_dir/f000.png …
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'
const [opts, out] = [JSON.parse(process.argv[2]), path.resolve(process.argv[3])]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbspr-')); const sleep = t => new Promise(r => setTimeout(r, t))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9336', '--use-angle=metal', '--user-data-dir=' + path.join(tmp, 'p'), 'about:blank'], { stdio: 'ignore' })
let ws = null
for (let i = 0; i < 60 && ws === null; i++) { await sleep(300); try { const l = await (await fetch('http://127.0.0.1:9336/json')).json(); const p = l.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl) } catch {} }
await new Promise(r => { ws.onopen = r })
let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable')
await send('Page.navigate', { url: 'http://localhost:8080/dev/axhero/mascot/sprite.html' })
for (let i = 0; i < 50; i++) { await sleep(300); const r = await send('Runtime.evaluate', { expression: 'window.ready === true', returnByValue: true }); if (r.result?.result?.value) break }
const r = await send('Runtime.evaluate', { expression: `window.frames_of(${JSON.stringify(opts)})`, awaitPromise: true, returnByValue: true })
if (r.result?.exceptionDetails) { console.error(r.result.exceptionDetails.exception?.description); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
r.result.result.value.forEach((d, i) => fs.writeFileSync(path.join(out, 'f' + String(i).padStart(3, '0') + '.png'), Buffer.from(d.split(',')[1], 'base64')))
console.log(out, r.result.result.value.length)
ws.close(); chrome.kill(); await sleep(400); try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
