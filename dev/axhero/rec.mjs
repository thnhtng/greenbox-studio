// Screen recordings for the AX Hero intro page: headless Chrome runs a scenario on the local Greenbox (served by
// serve.py) while its screen is captured (DevTools screencast), then ffmpeg makes a small H.264 MP4.
//
//   node dev/axhero/rec.mjs <scenario.mjs> <out.mp4> [width height]
//
// A scenario exports `default async ({ nav, ev, wait, key, down, up, click, until, start })`:
//   nav(url)            open a page (relative to http://localhost:8080/)
//   ev(js)              run JS in the page (awaits promises, returns the value)
//   wait(ms)            let it run while being recorded
//   key(code, ms)       hold a key (KeyW, Space…) for ms
//   down / up(code)     press / release a key (to hold several at once)
//   click(x, y)         mouse click at a point of the page
//   until(js, ms)       wait until a JS expression is true (max ms)
//   drag(pts, ms)       mouse drag along [[x, y], …]
//   start()             start recording (everything before it is set-up, not filmed)
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const [scenarioPath, out, W = '1280', H = '720'] = process.argv.slice(2)
const BASE = 'http://localhost:8080/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbrec-'))
const sleep = t => new Promise(r => setTimeout(r, t))

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9334', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  `--window-size=${W},${H}`, '--user-data-dir=' + path.join(tmp, 'profile'), 'about:blank'], { stdio: 'ignore' })
let ws = null
for (let i = 0; i < 60 && ws === null; i++) {
  await sleep(300)
  try { const list = await (await fetch('http://127.0.0.1:9334/json')).json(); const p = list.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl) } catch {}
}
await new Promise(r => { ws.onopen = r })
let id = 0
const pending = new Map()
const frames = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Page.screencastFrame') {
    const f = path.join(tmp, `f${String(frames.length).padStart(5, '0')}.jpg`)
    fs.writeFileSync(f, Buffer.from(m.params.data, 'base64'))
    frames.push({ f, t: m.params.metadata.timestamp })
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
  }
}
function send (method, params = {}) { return new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) }) }

const api = {
  async nav (url) { await send('Page.navigate', { url: new URL(url, BASE).href }); await sleep(1500) },
  async ev (js) {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error')
    return r.result?.result?.value
  },
  wait: sleep,
  async key (code, ms = 500) {
    const k = code.replace(/^Key/, '').toLowerCase()
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) })
    await sleep(ms)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) })
  },
  async down (code) { const k = code.replace(/^Key/, '').toLowerCase(); await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code === 'Space' ? ' ' : k, windowsVirtualKeyCode: code === 'Space' ? 32 : k.toUpperCase().charCodeAt(0) }) },
  async up (code) { const k = code.replace(/^Key/, '').toLowerCase(); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code === 'Space' ? ' ' : k, windowsVirtualKeyCode: code === 'Space' ? 32 : k.toUpperCase().charCodeAt(0) }) },
  async click (x, y, button = 'left') { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 }) },
  // drag with the mouse along points [[x, y], …] (joystick, carousel…), ms per step
  async drag (pts, ms = 30) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 }); for (const [x, y] of pts.slice(1)) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(ms) } const l = pts[pts.length - 1]; await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', clickCount: 1 }) },
  async until (js, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await api.ev(`return !!(${js})`)) return true; await sleep(300) } return false }
}

await send('Page.enable'); await send('Runtime.enable')
// no step-by-step guide pop-ups or the one-time Mac trackpad tip in a recording
await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'webdriver', { get: () => true }); try { localStorage.setItem('gb.mactip.' + location.pathname, '1') } catch (e) {}" })
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: false })
const scenario = (await import(path.resolve(scenarioPath))).default
await scenario({ ...api, start: () => send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: +W, maxHeight: +H, everyNthFrame: 1 }) })
await send('Page.stopScreencast')
ws.close(); chrome.kill()

// frames come when the screen changes: each one lasts until the next
const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${Math.max(0.02, ((frames[i + 1]?.t ?? fr.t + 0.5) - fr.t)).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).f}'\n`
fs.writeFileSync(path.join(tmp, 'list.txt'), list)
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-vf', 'fps=24,scale=960:-2', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
console.log(`${out}: ${frames.length} frames, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
fs.rmSync(tmp, { recursive: true, force: true })
