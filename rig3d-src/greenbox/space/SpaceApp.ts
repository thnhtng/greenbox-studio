/**
 * SPACE FIGHTER page: the game runs live in a phone-shaped view; the panel sets the mission
 * (kills to win, time, difficulty, colours, your own jet GLB) and exports it as ONE playable .html
 * (the same playable-runtime.js as the play test: it starts SpaceGame when __GB_PLAYABLE.game === 'space').
 */
import { M } from '../common/lang.ts'
import { SpaceGame, type SpaceOpts } from './SpaceGame.ts'

interface Cfg { title: string, kills: number, limit: number, hard: number, color: string, hue: number, rocks: boolean, cta: string, wide: boolean }
const KEY = 'gb.space.v1'
const DEF: Cfg = { title: 'Space Fighter', kills: 12, limit: 0, hard: 1, color: '#ff5a2a', hue: 265, rocks: true, cta: '', wide: false }
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

class SpaceApp {
  cfg: Cfg = { ...DEF }
  game: SpaceGame | null = null
  ship: string | null = null // own jet (GLB, base64); not kept between visits
  ship_name = ''
  auto = false
  private timer = 0

  constructor () {
    try { this.cfg = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { /* defaults */ }
    this.panel(); this.rebuild()
  }

  opts (): SpaceOpts { const c = this.cfg; return { kills: c.kills, limit: c.limit, hard: c.hard, color: c.color, hue: c.hue, rocks: c.rocks, ship: this.ship } }

  status (t: string, warn = false): void { const s = $('sp-status'); s.textContent = t; s.classList.toggle('warn', warn) }

  /** a fresh round with the panel's settings */
  rebuild (): void {
    this.game?.dispose()
    const view = $('sp-view'); view.classList.toggle('wide', this.cfg.wide)
    this.game = new SpaceGame(view, { ...this.opts(), title: this.cfg.title, lang: M('en', 'vi', 'ko'), auto: this.auto, cta: this.cfg.cta, on_cta: () => { this.status(M('The CTA opens your store link in the exported file.', 'Nút CTA sẽ mở link store trong file xuất ra.', 'CTA는 내보낸 파일에서 스토어 링크를 엽니다.')); this.game?.restart() } })
    this.game.on_end = (won) => { this.status(won ? M('Mission complete. The end card with the CTA is what the player sees.', 'Hoàn thành nhiệm vụ. End card có nút CTA là thứ người chơi thấy.', '미션 완료.') : M('Shot down. Lower the difficulty if it is too hard for an ad.', 'Bị bắn hạ. Giảm độ khó nếu quá khó cho quảng cáo.', '격추됨.'), !won) }
  }

  private save (): void { try { localStorage.setItem(KEY, JSON.stringify(this.cfg)) } catch { /* private window */ } }

  private panel (): void {
    const c = this.cfg; const side = $('sp-side')
    const range = (k: keyof Cfg, label: string, min: number, max: number, step: number, fmt: (v: number) => string): string => `<label>${label}<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${c[k] as number}"><output data-o="${k}">${fmt(c[k] as number)}</output></label>`
    side.innerHTML =
      `<div id="sp-status">${M('Drag in the view (or WASD) to fly. The guns fire on their own.', 'Kéo trong khung (hoặc WASD) để lái. Súng tự bắn.', '드래그 또는 WASD로 조종. 자동 사격.')}</div>` +
      `<section><h3><b>1</b>${M('Play', 'Chơi thử', '플레이')}</h3><div class="row"><button class="pri" data-a="restart">↻ ${M('New round', 'Ván mới', '새 게임')}</button><button data-a="auto">🤖 ${M('Auto play', 'Tự chơi', '자동')}</button><button data-a="wide">📱 9:16</button></div></section>` +
      `<section><h3><b>2</b>${M('Mission', 'Nhiệm vụ', '미션')}</h3>` +
      `<label>${M('Game name', 'Tên game', '게임 이름')}<input type="text" data-k="title" maxlength="40" value=""></label>` +
      range('kills', M('Enemies to win', 'Số địch cần hạ', '격추 목표'), 3, 40, 1, v => String(v)) +
      range('limit', M('Time limit', 'Giới hạn giờ', '제한 시간'), 0, 90, 5, v => v === 0 ? '∞' : `${v}s`) +
      range('hard', M('Difficulty', 'Độ khó', '난이도'), 0.6, 1.6, 0.1, v => v.toFixed(1)) +
      `<label class="chk"><input type="checkbox" data-k="rocks"${c.rocks ? ' checked' : ''}> ${M('Asteroids', 'Thiên thạch', '소행성')}</label></section>` +
      `<section><h3><b>3</b>${M('Look', 'Hình ảnh', '모양')}</h3>` +
      `<label>${M('Jet colour', 'Màu máy bay', '기체 색')}<input type="color" data-k="color" value="${c.color}"></label>` +
      range('hue', M('Nebula colour', 'Màu tinh vân', '성운 색'), 0, 360, 5, v => `${v}°`) +
      `<div class="row"><button data-a="ship">✈ ${M('Your jet (.glb)', 'Máy bay của bạn (.glb)', '내 기체 (.glb)')}</button><button data-a="noship" style="flex:0 0 auto" title="${M('Back to the built-in jet', 'Về máy bay có sẵn', '기본 기체')}">✕</button></div><div class="sm" id="sp-ship">${M('Built-in jet. A GLB from Rig / Vehicles also works (nose forward).', 'Đang dùng máy bay có sẵn. GLB từ Rig / Xe cũng dùng được (mũi hướng tới).', '기본 기체 사용 중.')}</div></section>` +
      `<section><h3><b>4</b>${M('Export', 'Xuất', '내보내기')}</h3>` +
      `<label>${M('Store link', 'Link store', '스토어 링크')}<input type="url" data-k="cta" placeholder="https://…" value=""></label>` +
      `<div class="row"><button class="pri" data-a="export">⬇ ${M('Playable (.html)', 'File playable (.html)', '플레이어블 (.html)')}</button></div><div class="sm">${M('One file, about 1 MB: fits every ad network (limit 5 MB). Opens offline.', 'Một file, khoảng 1 MB: vừa mọi mạng quảng cáo (giới hạn 5 MB). Mở offline được.', '파일 하나, 약 1 MB.')}</div></section>`
    side.querySelector<HTMLInputElement>('[data-k="title"]')!.value = c.title; side.querySelector<HTMLInputElement>('[data-k="cta"]')!.value = c.cta
    const FMT: Record<string, (v: number) => string> = { kills: v => String(v), limit: v => v === 0 ? '∞' : `${v}s`, hard: v => v.toFixed(1), hue: v => `${v}°` }
    side.addEventListener('input', e => {
      const el = e.target as HTMLInputElement; const k = el.dataset.k as keyof Cfg | undefined; if (k === undefined) return
      ;(this.cfg as any)[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value
      const o = side.querySelector<HTMLElement>(`[data-o="${k}"]`); if (o !== null) o.textContent = FMT[k](Number(el.value))
      this.save()
      if (k !== 'title' && k !== 'cta') { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.rebuild(), 250) } // a new round with the new look / rules
    })
    const pick = document.createElement('input'); pick.type = 'file'; pick.accept = '.glb'
    pick.onchange = () => {
      const f = pick.files?.[0]; if (f === undefined) return
      void f.arrayBuffer().then(buf => { this.ship = this.b64(buf); this.ship_name = f.name; $('sp-ship').textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`; this.rebuild(); pick.value = '' })
    }
    side.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a
      if (a === 'restart') { this.auto = false; this.sync(); this.rebuild() }
      else if (a === 'auto') { this.auto = !this.auto; this.sync(); this.rebuild() }
      else if (a === 'wide') { this.cfg.wide = !this.cfg.wide; this.save(); this.sync(); this.rebuild() }
      else if (a === 'ship') pick.click()
      else if (a === 'noship') { this.ship = null; this.ship_name = ''; $('sp-ship').textContent = M('Built-in jet.', 'Đang dùng máy bay có sẵn.', '기본 기체.'); this.rebuild() }
      else if (a === 'export') void this.export_playable()
    })
    this.sync()
  }

  private sync (): void {
    const side = $('sp-side')
    side.querySelector('[data-a="auto"]')!.classList.toggle('on', this.auto)
    side.querySelector('[data-a="wide"]')!.textContent = this.cfg.wide ? '🖥 16:9' : '📱 9:16'
  }

  private b64 (buf: ArrayBuffer): string { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }

  /** the single-file playable: data + runtime in one HTML */
  async playable_html (): Promise<{ blob: Blob, name: string, size_mb: number }> {
    const c = this.cfg
    const runtime = await (await fetch('playable-runtime.js', { cache: 'no-store' })).text()
    const title = c.title.trim() !== '' ? c.title.trim() : 'Space Fighter'; const lang = M('en', 'vi', 'ko')
    const data = { game: 'space', space: this.opts(), cta: c.cta.trim(), cta_label: M('Play now', 'Chơi ngay', '지금 플레이'), title, lang, limit: c.limit }
    const safe = (t: string): string => t.replace(/<\/script/gi, '<\\/script')
    const esc = (t: string): string => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="ad.size" content="width=320,height=480"><title>${esc(title)}</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#03040b;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}</style></head><body><script>window.__GB_PLAYABLE=${safe(JSON.stringify(data))}</script><script>${safe(runtime)}</script></body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return { blob, name: (slug !== '' ? slug : 'space-fighter') + '-playable.html', size_mb: blob.size / 1048576 }
  }

  async export_playable (): Promise<void> {
    try {
      const { blob, name, size_mb } = await this.playable_html()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      const big = size_mb > 5
      this.status(M(`Playable saved: ${name} (${size_mb.toFixed(1)} MB${big ? ', over 5 MB: use a lighter jet model' : ''}).`, `Đã lưu playable: ${name} (${size_mb.toFixed(1)} MB${big ? ', vượt 5 MB: dùng model máy bay nhẹ hơn' : ''}).`, `저장됨: ${name} (${size_mb.toFixed(1)} MB)`), big)
    } catch (err) { this.status(String((err as Error).message ?? err), true) }
  }
}

;(window as any).__space = new SpaceApp()
