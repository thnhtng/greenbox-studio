/*
 * The "feel" of a playable, on top of the game in Playable.ts (which only knows stations, items and money):
 *   objective line   what the guide points at, in words, with a progress bar while a $ pad is being paid
 *   floating text    +$5 where the money lands, a banner when something unlocks / the player evolves
 *   sound            synthesised with WebAudio (no files: a playable is one HTML file), muted when the page is hidden
 *   camera shake     a small kick when an ore crumbles, a bigger one on an evolution
 *   tutorial         a hand that drags a joystick until the first touch, back again after a few idle seconds
 *   end card         when every $ pad is paid (or the time limit is over): stars, the money earned, the store button
 * Used by the exported runtime (everything on) and by the play test (sound + objective + floating text only).
 */
import * as THREE from 'three'
import { type Playable } from './Playable.ts'
import { M } from '../common/lang.ts'

export interface FxOpts { title?: string, cta?: string, cta_label?: string, limit?: number, tutorial?: boolean, end?: boolean, top?: number }

/** the store / landing link, the way each ad network wants it opened */
export function open_store (url: string): void {
  const w = window as any; w.__gbCtaClicks = (w.__gbCtaClicks ?? 0) + 1
  try {
    if (typeof w.mraid?.open === 'function') { w.mraid.open(url); return }
    if (typeof w.FbPlayableAd?.onCTAClick === 'function') { w.FbPlayableAd.onCTAClick(); return }
    if (typeof w.ExitApi?.exit === 'function') { w.ExitApi.exit(); return }
    if (typeof w.dapi?.openStoreUrl === 'function') { w.dapi.openStoreUrl(); return }
    if (typeof w.openAppStore === 'function') { w.openAppStore(); return }
  } catch { /* fall through to a plain link */ }
  if (url !== '') window.open(url, '_blank')
}

const CSS = `
.gbfx{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;-webkit-user-select:none;user-select:none}
.gbfx-goal{position:absolute;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px;transition:opacity .25s}
.gbfx-goal>b{display:flex;align-items:center;gap:8px;height:36px;padding:0 16px 0 12px;border-radius:999px;font:800 16px/1 system-ui,sans-serif;white-space:nowrap;background:linear-gradient(#ffd95ef2,#ffb81cf2);color:#3b2600;border:1.5px solid #fff6;box-shadow:0 4px 14px #0006,inset 0 1px 0 #fff8}
.gbfx-goal>b>i{font-style:normal;font-size:18px}
.gbfx-bar{width:150px;height:9px;border-radius:9px;background:#0f1622cc;border:1.5px solid #ffffff40;overflow:hidden;display:none}
.gbfx-bar>i{display:block;height:100%;width:0;border-radius:9px;background:linear-gradient(90deg,#3ddc6f,#b6f36a);transition:width .12s linear}
.gbfx-pop{animation:gbfx-pop .28s cubic-bezier(.3,1.6,.5,1)}
@keyframes gbfx-pop{0%{transform:scale(.7)}100%{transform:scale(1)}}
.gbfx-float{position:absolute;font:900 22px/1 system-ui,sans-serif;white-space:nowrap;text-shadow:0 2px 0 #0008,0 0 8px #0006;animation:gbfx-rise .9s ease-out forwards;transform:translate(-50%,-50%)}
@keyframes gbfx-rise{0%{opacity:0;margin-top:8px;scale:.6}15%{opacity:1;scale:1.15}30%{scale:1}100%{opacity:0;margin-top:-64px}}
.gbfx-banner{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);font:900 34px/1.1 system-ui,sans-serif;text-align:center;white-space:nowrap;color:#ffe45e;-webkit-text-stroke:1.5px #7a3c00;text-shadow:0 4px 0 #7a3c00,0 8px 22px #000a;animation:gbfx-banner 1.7s cubic-bezier(.2,1.5,.4,1) forwards}
@keyframes gbfx-banner{0%{opacity:0;scale:.3;rotate:-6deg}18%{opacity:1;scale:1.12;rotate:2deg}30%{scale:1;rotate:0deg}80%{opacity:1;scale:1}100%{opacity:0;scale:1.25}}
.gbfx-tut{position:absolute;left:50%;bottom:17%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;transition:opacity .3s}
.gbfx-tut>div{position:relative;width:132px;height:132px;border-radius:50%;border:3px solid #ffffffb0;background:radial-gradient(#ffffff26,#ffffff0d);box-shadow:0 6px 20px #0004}
.gbfx-tut>div>i{position:absolute;left:44px;top:44px;width:44px;height:44px;border-radius:50%;background:#fff;box-shadow:0 3px 10px #0006;animation:gbfx-stick 2.4s ease-in-out infinite}
.gbfx-tut>div>svg{position:absolute;left:58px;top:60px;width:64px;height:64px;filter:drop-shadow(0 4px 6px #0008);animation:gbfx-stick 2.4s ease-in-out infinite}
@keyframes gbfx-stick{0%,100%{translate:0 0}20%{translate:0 -34px}45%{translate:32px -10px}70%{translate:-30px -14px}}
.gbfx-tut>b{font:800 18px/1 system-ui,sans-serif;padding:9px 16px;border-radius:999px;background:#111824d9;border:1.5px solid #ffffff30;text-shadow:0 1px 2px #000}
.gbfx-cta{position:absolute;right:max(14px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));pointer-events:auto;cursor:pointer;border:0;font:900 19px/1 system-ui,sans-serif;color:#fff;padding:15px 26px;border-radius:999px;background:linear-gradient(#4be07f,#17a34a);box-shadow:0 5px 0 #0c7a34,0 10px 22px #0007,inset 0 1px 0 #fff6;text-shadow:0 1px 2px #0006;animation:gbfx-pulse 1.3s ease-in-out infinite}
.gbfx-cta:active{translate:0 3px;box-shadow:0 2px 0 #0c7a34,0 6px 14px #0007}
@keyframes gbfx-pulse{0%,100%{scale:1}50%{scale:1.07}}
.gbfx-end{position:absolute;inset:0;pointer-events:auto;display:grid;place-items:center;background:radial-gradient(#0b1220a6,#060a12e6);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);animation:gbfx-fade .35s ease-out}
@keyframes gbfx-fade{0%{opacity:0}100%{opacity:1}}
.gbfx-card{width:min(86vw,360px);padding:26px 22px 22px;border-radius:28px;text-align:center;background:linear-gradient(#263247,#141c2b);border:2px solid #ffffff2e;box-shadow:0 24px 60px #000c,inset 0 1px 0 #ffffff30;animation:gbfx-card .5s cubic-bezier(.2,1.4,.4,1)}
@keyframes gbfx-card{0%{scale:.6;opacity:0}100%{scale:1;opacity:1}}
.gbfx-card h1{margin:0 0 4px;font:900 27px/1.15 system-ui,sans-serif;letter-spacing:.2px}
.gbfx-card p{margin:0;font:600 15px/1.3 system-ui,sans-serif;color:#b9c4d6}
.gbfx-stars{display:flex;justify-content:center;gap:8px;margin:14px 0 12px}
.gbfx-stars svg{width:58px;height:58px;opacity:0;animation:gbfx-star .5s cubic-bezier(.2,1.8,.4,1) forwards;filter:drop-shadow(0 4px 0 #a85d00) drop-shadow(0 8px 10px #0008)}
.gbfx-stars svg:nth-child(2){width:72px;height:72px;margin-top:-10px;animation-delay:.18s}.gbfx-stars svg:nth-child(3){animation-delay:.36s}
@keyframes gbfx-star{0%{opacity:0;scale:2.2;rotate:-40deg}100%{opacity:1;scale:1;rotate:0deg}}
.gbfx-earn{display:inline-flex;align-items:center;gap:8px;margin:2px 0 18px;padding:8px 18px;border-radius:999px;background:#0b111cb3;border:1.5px solid #ffffff26;font:900 24px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
.gbfx-earn i{width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe98a,#f5b400 60%,#c98a00);display:grid;place-items:center;font:900 15px system-ui;font-style:normal;color:#7a4a00}
.gbfx-card .gbfx-cta{position:static;display:block;width:100%;font-size:23px;padding:19px 10px}
.gbfx-more{margin-top:14px;pointer-events:auto;cursor:pointer;background:none;border:0;color:#9fb0c8;font:700 15px system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px}
.gbfx-conf{position:absolute;top:-20px;width:10px;height:16px;border-radius:2px;animation:gbfx-conf linear forwards}
@keyframes gbfx-conf{0%{translate:0 0;rotate:0deg}100%{translate:var(--dx) 110vh;rotate:var(--r)}}
@media (orientation:landscape) and (max-height:480px){.gbfx-tut{bottom:8%}.gbfx-tut>div{width:104px;height:104px}.gbfx-tut>div>i{left:30px;top:30px}.gbfx-tut>div>svg{left:44px;top:46px}.gbfx-card{padding:16px 22px}.gbfx-stars svg{width:44px;height:44px}.gbfx-stars svg:nth-child(2){width:54px;height:54px}.gbfx-earn{margin-bottom:10px}.gbfx-card .gbfx-cta{padding:13px 10px}.gbfx-banner{font-size:28px}}
`
const STAR = '<svg viewBox="0 0 24 24"><path fill="#ffc928" stroke="#fff3b0" stroke-width=".8" stroke-linejoin="round" d="M12 1.8l3.1 6.5 7.1.9-5.2 4.9 1.4 7-6.4-3.5-6.4 3.5 1.4-7L1.8 9.200l7.1-.9z"/></svg>'
const HAND = '<svg viewBox="0 0 64 64"><path fill="#fff" stroke="#1b2433" stroke-width="2.5" stroke-linejoin="round" d="M22 6c3 0 5 2.300 5 5.200V27l2.500.4c1-1.800 4.600-2 6 .5 1.600-1.500 5-1.300 6 1.300 2-1 5.500.2 5.500 3.800v11c0 8.500-5.500 15-14 15h-4.500c-5.500 0-8.500-2.500-11.500-7.500L10 40.500c-2-3.500 2-6.500 5-3.500l2 2.500V11.200C17 8.300 19 6 22 6z"/></svg>'

export class PlayableFx {
  /** add this to the camera position each frame */
  public readonly shake = new THREE.Vector3()
  /** the end card is up: the game should stop taking input */
  public ended = false
  private readonly root: HTMLDivElement
  private readonly goal_el: HTMLDivElement
  private readonly goal_txt: HTMLElement
  private readonly bar: HTMLElement
  private tut: HTMLElement | null = null
  private goal_key = ''
  private amp = 0
  private idle = 0
  private played = 0 // seconds since the first input
  private touched = false
  private end_t = -1
  private end_shown = 0
  private readonly v = new THREE.Vector3()
  // sound
  private ac: AudioContext | null = null
  private master: GainNode | null = null
  private drill: GainNode | null = null
  private last_snd = new Map<string, number>()
  private readonly on_vis = (): void => { if (this.ac === null) return; if (document.hidden) void this.ac.suspend(); else void this.ac.resume() }

  constructor (private readonly game: Playable, private readonly camera: THREE.Camera, host: HTMLElement, private readonly opts: FxOpts = {}) {
    if (document.getElementById('gbfx-css') === null) { const st = document.createElement('style'); st.id = 'gbfx-css'; st.textContent = CSS; document.head.append(st) }
    this.root = document.createElement('div'); this.root.className = 'gbfx'; this.root.style.zIndex = '28'; host.append(this.root)
    this.goal_el = document.createElement('div'); this.goal_el.className = 'gbfx-goal'; this.goal_el.style.top = `max(${opts.top ?? 60}px, calc(env(safe-area-inset-top) + ${(opts.top ?? 60) - 12}px))`
    this.goal_el.innerHTML = '<b><i></i><span></span></b><div class="gbfx-bar"><i></i></div>'; this.goal_el.style.opacity = '0'
    this.goal_txt = this.goal_el.querySelector('b')!; this.bar = this.goal_el.querySelector('.gbfx-bar')!
    this.root.append(this.goal_el)
    if ((opts.cta ?? '') !== '') { const b = document.createElement('button'); b.className = 'gbfx-cta'; b.dataset.cta = 'hud'; b.textContent = opts.cta_label ?? M('Play now', 'Chơi ngay', '지금 플레이'); b.onclick = () => open_store(opts.cta!); this.root.append(b) }
    if (opts.tutorial === true) this.show_tut(true)
    game.on_fx = (kind, at, n) => { this.event(kind, at, n) }
    document.addEventListener('visibilitychange', this.on_vis)
  }

  /** the player touched / pressed a key: the tutorial goes, the sound may start (browsers want a gesture first) */
  public input (): void {
    this.idle = 0; this.touched = true
    if (this.tut !== null) this.show_tut(false)
    if (this.ac === null) this.audio_start(); else if (this.ac.state === 'suspended' && !document.hidden) void this.ac.resume()
  }

  public update (dt: number, moving: boolean): void {
    // objective line
    const g = this.game.goal; const c = this.game.carried()
    let icon = ''; let text = ''
    if (g !== null) {
      if (g.kind === 'dig') { icon = '⛏'; text = c.n > 0 ? M(`Fill the load ${c.n}/${c.cap}`, `Đào đầy thùng ${c.n}/${c.cap}`, `가득 채우기 ${c.n}/${c.cap}`) : M('Dig the ore', 'Đào quặng', '광석을 캐세요') }
      else if (g.kind === 'take') { icon = '📦'; text = g.label !== '' ? M(`Get: ${g.label}`, `Lấy: ${g.label}`, `받기: ${g.label}`) : M('Collect items', 'Lấy hàng', '아이템 받기') }
      else if (g.kind === 'sell') { icon = '💰'; text = g.label !== '' ? g.label : M('Sell your load', 'Mang đi bán', '판매하세요') }
      else if (g.kind === 'deliver') { icon = '➡️'; text = g.label !== '' ? M(`Bring to: ${g.label}`, `Mang đến: ${g.label}`, `가져가기: ${g.label}`) : M('Deliver the items', 'Giao hàng', '배달하세요') }
      else if (g.kind === 'money') { icon = '💵'; text = M('Grab the cash', 'Nhặt tiền', '돈을 주우세요') }
      else if (g.kind === 'collect') { icon = '📦'; text = M('Pick up the items', 'Nhặt hàng', '아이템 줍기') }
      else if (g.kind === 'pay') { icon = '⬆️'; text = M(`Upgrade: $${g.left}`, `Nâng cấp: $${g.left}`, `업그레이드: $${g.left}`) }
    } else if (!this.game.done && c.n >= c.cap) { icon = '💰'; text = M('Load is full', 'Thùng đã đầy', '가득 찼습니다') }
    const show = text !== '' && !this.ended
    this.goal_el.style.opacity = show ? '1' : '0'
    if (show) {
      ;(this.goal_txt.children[0] as HTMLElement).textContent = icon; (this.goal_txt.children[1] as HTMLElement).textContent = text
      const key = g?.kind ?? 'full'
      if (key !== this.goal_key) { this.goal_key = key; this.goal_txt.classList.remove('gbfx-pop'); void this.goal_txt.offsetWidth; this.goal_txt.classList.add('gbfx-pop') }
      const pay = g !== null && g.kind === 'pay'
      this.bar.style.display = pay ? 'block' : 'none'
      if (pay) (this.bar.firstElementChild as HTMLElement).style.width = `${Math.round(100 * (g.price - g.left) / Math.max(1, g.price))}%`
    }
    // camera shake
    this.amp = Math.max(0, this.amp - dt * 1.6)
    const a = this.amp * this.amp; this.shake.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a)
    // the drill hum follows the digging
    if (this.drill !== null && this.ac !== null) this.drill.gain.setTargetAtTime(this.game.drilling ? 0.05 : 0, this.ac.currentTime, 0.05)
    // tutorial: back after a few idle seconds
    if (moving) this.idle = 0; else this.idle += dt
    if (this.opts.tutorial === true && !this.ended && this.tut === null && this.idle > 6) this.show_tut(true)
    // end card
    if (this.touched) this.played += dt
    if (this.opts.end === true && !this.ended) {
      if (this.game.done && this.end_t < 0) this.end_t = this.played + 6
      const limit = this.opts.limit ?? 0
      const over = (this.end_t >= 0 && this.played >= this.end_t) || (limit > 0 && this.played >= limit && this.end_shown === 0)
      if (over) this.end()
    }
  }

  /* ---------------- events from the game ---------------- */
  private event (kind: string, at: THREE.Vector3, n: number): void {
    if (kind === 'money') { this.float(`+$${n}`, at, '#7dff9a'); this.snd('money') }
    else if (kind === 'hit') { this.snd('hit', n); this.amp = Math.max(this.amp, 0.22); this.buzz(8) }
    else if (kind === 'crumble') { this.snd('crumble'); this.amp = Math.max(this.amp, 0.5); this.buzz(25) }
    else if (kind === 'pickup') this.snd('pickup', n)
    else if (kind === 'drop') this.snd('drop', n)
    else if (kind === 'sell') { this.snd('sell'); this.float(`$${n}`, at, '#ffe45e') }
    else if (kind === 'pay') this.snd('pay', n)
    else if (kind === 'locked') { this.snd('locked'); this.amp = Math.max(this.amp, 0.25) }
    else if (kind === 'unlock') { this.snd('unlock'); this.banner(M('UNLOCKED!', 'MỞ KHÓA!', '잠금 해제!')) }
    else if (kind === 'evolve') { this.snd('evolve'); this.amp = 0.8; this.buzz(60); this.banner(M(`⚡ DRILL LV.${n + 1}`, `⚡ MŨI KHOAN LV.${n + 1}`, `⚡ 드릴 LV.${n + 1}`)); this.confetti(26) }
  }

  private buzz (ms: number): void { if ((navigator as any).userActivation?.hasBeenActive !== true) return; try { (navigator as any).vibrate?.(ms) } catch { /* not allowed here */ } }

  private float (text: string, at: THREE.Vector3, color: string): void {
    this.v.copy(at).project(this.camera); if (this.v.z > 1) return
    const el = document.createElement('div'); el.className = 'gbfx-float'; el.textContent = text; el.style.color = color
    el.style.left = `${(this.v.x * 0.5 + 0.5) * 100 + (Math.random() - 0.5) * 4}%`; el.style.top = `${(-this.v.y * 0.5 + 0.5) * 100}%`
    this.root.append(el); el.addEventListener('animationend', () => el.remove()); setTimeout(() => el.remove(), 1200)
  }

  private banner (text: string): void {
    this.root.querySelectorAll('.gbfx-banner').forEach(e => e.remove()) // an evolution says it better than "unlocked"
    const el = document.createElement('div'); el.className = 'gbfx-banner'; el.textContent = text; this.root.append(el); setTimeout(() => el.remove(), 1800)
  }

  private confetti (n: number, into: HTMLElement = this.root): void {
    const cols = ['#ffd23f', '#3ddc6f', '#4cc3ff', '#ff6b8b', '#b78bff', '#ffffff']
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i'); c.className = 'gbfx-conf'; c.style.left = `${Math.random() * 100}%`; c.style.background = cols[i % cols.length]
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`); c.style.setProperty('--r', `${(Math.random() - 0.5) * 1400}deg`)
      c.style.animationDuration = `${1.6 + Math.random() * 1.6}s`; c.style.animationDelay = `${Math.random() * 0.5}s`
      into.append(c); setTimeout(() => c.remove(), 4000)
    }
  }

  private show_tut (on: boolean): void {
    if (!on) { const t = this.tut; this.tut = null; if (t !== null) { t.style.opacity = '0'; setTimeout(() => t.remove(), 320) } return }
    if (this.tut !== null) return
    const t = document.createElement('div'); t.className = 'gbfx-tut'; t.style.opacity = '0'
    t.innerHTML = `<div><i></i>${HAND}</div><b>${M('Drag to move', 'Kéo để di chuyển', '드래그해서 이동')}</b>`
    this.root.append(t); this.tut = t; requestAnimationFrame(() => { t.style.opacity = '1' })
  }

  /** the end card: stars, what was earned, the store button; "keep playing" closes it (it comes back once, later) */
  public end (): void {
    if (this.ended) return
    this.ended = true; this.end_shown++; this.end_t = -1; this.show_tut(false); this.snd('win')
    const cta = this.opts.cta ?? ''
    const el = document.createElement('div'); el.className = 'gbfx-end'
    el.innerHTML = `<div class="gbfx-card"><h1></h1><p>${this.game.done ? M('Upgrade complete!', 'Đã nâng cấp xong!', '업그레이드 완료!') : M('Nice digging!', 'Đào quá đỉnh!', '멋져요!')}</p><div class="gbfx-stars">${STAR}${STAR}${STAR}</div><div class="gbfx-earn"><i>$</i><span>0</span></div><button class="gbfx-cta" data-cta="end"></button><button class="gbfx-more"></button></div>`
    el.querySelector('h1')!.textContent = this.opts.title ?? 'Greenbox'
    const main = el.querySelector<HTMLButtonElement>('.gbfx-cta')!; const more = el.querySelector<HTMLButtonElement>('.gbfx-more')!
    const close = (): void => { el.remove(); this.ended = false; if (this.end_shown < 2 && (this.opts.limit ?? 0) > 0) this.end_t = this.played + Math.max(15, (this.opts.limit ?? 0) / 2) }
    if (cta !== '') { main.textContent = this.opts.cta_label ?? M('Play now', 'Chơi ngay', '지금 플레이'); main.onclick = () => open_store(cta); more.textContent = M('Keep playing', 'Chơi tiếp', '계속 플레이'); more.onclick = close }
    else { main.textContent = M('Keep playing', 'Chơi tiếp', '계속 플레이'); main.onclick = close; more.textContent = M('Play again', 'Chơi lại từ đầu', '다시 하기'); more.onclick = () => location.reload() }
    this.root.append(el); this.confetti(40, el)
    // the money counts up
    const out = el.querySelector('.gbfx-earn span')!; const total = this.game.earned; const t0 = performance.now()
    const step = (): void => { const k = Math.min(1, (performance.now() - t0) / 900); out.textContent = String(Math.round(total * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.isConnected) requestAnimationFrame(step) }
    setTimeout(step, 500)
  }

  /* ---------------- sound (synthesised) ---------------- */
  private audio_start (): void {
    try {
      const AC = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined; if (AC === undefined) return
      const ac = new AC(); this.ac = ac
      const comp = ac.createDynamicsCompressor(); comp.connect(ac.destination)
      this.master = ac.createGain(); this.master.gain.value = 0.55; this.master.connect(comp)
      // the drill: a low saw through a low-pass, wobbling; silent until the game digs
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 62
      const lfo = ac.createOscillator(); lfo.frequency.value = 23; const lg = ac.createGain(); lg.gain.value = 14; lfo.connect(lg); lg.connect(o.frequency)
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420
      this.drill = ac.createGain(); this.drill.gain.value = 0; o.connect(f); f.connect(this.drill); this.drill.connect(this.master); o.start(); lfo.start()
      if (document.hidden) void ac.suspend()
    } catch { this.ac = null }
  }

  private tone (f0: number, f1: number, dur: number, type: OscillatorType, vol: number, at = 0): void {
    const ac = this.ac; if (ac === null || this.master === null) return
    const t = ac.currentTime + at; const o = ac.createOscillator(); const g = ac.createGain()
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02)
  }

  private noise (dur: number, vol: number, cut: number, at = 0): void {
    const ac = this.ac; if (ac === null || this.master === null) return
    const n = Math.floor(ac.sampleRate * dur); const buf = ac.createBuffer(1, n, ac.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const s = ac.createBufferSource(); s.buffer = buf; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; const g = ac.createGain(); g.gain.value = vol
    s.connect(f); f.connect(g); g.connect(this.master); s.start(ac.currentTime + at)
  }

  private snd (kind: string, n = 0): void {
    if (this.ac === null || this.ac.state !== 'running') return
    const now = performance.now(); if (now - (this.last_snd.get(kind) ?? 0) < 45) return; this.last_snd.set(kind, now)
    const semi = (k: number): number => Math.pow(2, k / 12)
    if (kind === 'hit') { this.noise(0.12, 0.5, 1400); this.tone(150, 55, 0.14, 'sine', 0.5); this.tone(880 * semi(Math.min(12, n)), 1320 * semi(Math.min(12, n)), 0.09, 'triangle', 0.16, 0.05) }
    else if (kind === 'crumble') { this.noise(0.45, 0.6, 700); this.tone(110, 40, 0.4, 'sine', 0.5) }
    else if (kind === 'pickup') this.tone(520 * semi(Math.min(14, n)), 700 * semi(Math.min(14, n)), 0.08, 'triangle', 0.22)
    else if (kind === 'drop') this.tone(420, 260, 0.09, 'sine', 0.25)
    else if (kind === 'sell') { this.tone(1319, 1319, 0.07, 'square', 0.07); this.tone(1976, 1976, 0.16, 'square', 0.07, 0.07) }
    else if (kind === 'money') { this.tone(988, 988, 0.06, 'square', 0.07); this.tone(1319, 1319, 0.14, 'square', 0.07, 0.06) }
    else if (kind === 'pay') this.tone(660, 990, 0.06, 'triangle', 0.16)
    else if (kind === 'locked') { this.tone(170, 150, 0.16, 'square', 0.12); this.tone(150, 130, 0.18, 'square', 0.12, 0.17) }
    else if (kind === 'unlock') [523, 659, 784, 1047].forEach((f, i) => { this.tone(f, f, 0.16, 'triangle', 0.24, i * 0.08) })
    else if (kind === 'evolve') { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => { this.tone(f, f, 0.2, 'triangle', 0.24, i * 0.07) }); this.noise(0.6, 0.25, 3000); this.tone(80, 320, 0.5, 'sawtooth', 0.12) }
    else if (kind === 'win') [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => { this.tone(f, f, 0.22, 'triangle', 0.24, i * 0.11) })
  }

  public dispose (): void {
    this.game.on_fx = null; this.root.remove(); document.removeEventListener('visibilitychange', this.on_vis)
    try { void this.ac?.close() } catch { /* already closed */ }
  }
}
