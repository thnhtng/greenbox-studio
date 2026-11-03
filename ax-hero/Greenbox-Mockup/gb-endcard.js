/* Greenbox end card layer, shared by the simple end card (hpbar.html) and the endcard carousel (cockpit Gacha).
   A column of parts — app icon, logo, game name, PLAY NOW button — that grows 0 → 100 % from `start` over `grow` s,
   then each part pops in (`stagger` s apart). Every part has its own:
     size (%), space above it (px at 1080), X / Y offset (px), anchor point (like After Effects: the point it grows from
     and the handle shown in the preview), on / off.
   GBEC.defaults(kind) · GBEC.paint(ctx, W, H, t, cfg, imgs, opt) · GBEC.hit(cfg, W, H, x, y, imgs) · GBEC.panel(el, cfg, api) */
(function () {
  if (window.GBEC) return
  const PARTS = ['icon', 'logo', 'title', 'cta']
  const NAME = { icon: ['App icon', 'App icon', '앱 아이콘'], logo: ['Logo', 'Logo', '로고'], title: ['Tên game', 'Game name', '게임 이름'], cta: ['Nút', 'Button', '버튼'] }
  const part = (gap, s) => ({ on: true, s: s || 100, gap: gap, dx: 0, dy: 0, ax: 50, ay: 50 })
  /** every look of the button (all editable): size, roundness, stroke, fill, gloss, shadow, text */
  const DEF_COL = '#3cc41a'
  const btnDefaults = () => ({ bw: 100, bh: 100, round: 100, strokeOn: true, strokeW: 8, strokeColor: '#1a0f0a', fill: 'grad', gradAuto: true, gradTop: '#9dff5c', gradBot: '#1f8a0c',
    gloss: true, glossA: 35, shadow: false, shadowColor: '#000000', shadowBlur: 24, shadowY: 10, op: 100, pulseAmt: 5, pulseSpd: 2.4,
    font: 'Roboto', weight: 900, italic: false, upper: false, ts: 54, tl: 0, tdy: 0, tstrokeOn: true, tstrokeColor: '#1a0f0a', tstrokeW: 20 })
  function defaults (kind) {
    const c = { start: 0.2, grow: 0.6, ease: 'back', stagger: 0.12, x: 0.5, y: 0.5, w: 0.86, title: 'XP HERO', titleColor: '#ffc21a', cta: 'PLAY NOW!', ctaColor: '#3cc41a', ctaText: '#ffffff', pulse: true, after: 'time', delay: 0.4, sel: 'icon', split: false, yTop: 0.13, yBot: 0.87,
      btn: btnDefaults(), el: { icon: part(0), logo: part(36), title: part(36), cta: part(36) } }
    if (kind === 'carousel') { Object.assign(c, { y: 0.84, w: 0.7, after: 'time', start: 0, grow: 0.5, split: true }); c.el.icon.s = 70; c.el.title.s = 70; c.el.cta.s = 80; c.el.logo.s = 70; c.el.icon.gap = 0; c.el.title.gap = 20; c.el.cta.gap = 24 }
    return c
  }
  /** fill the fields an older saved config does not have */
  function fix (c, kind) { const d = defaults(kind); for (const k in d) if (c[k] === undefined) c[k] = d[k]; for (const p of PARTS) c.el[p] = Object.assign(part(36), d.el[p], c.el[p] || {}); c.btn = Object.assign(btnDefaults(), c.btn || {}); return c }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const back = p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2) }
  function ease (c, p) { p = clamp(p, 0, 1); return c.ease === 'linear' ? p : c.ease === 'out' ? 1 - Math.pow(1 - p, 3) : back(p) }
  function rr (g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
  const ok = im => im && (im.naturalWidth || im.width) > 0

  /** boxes of the visible parts (canvas px, before the grow / pop scale), top to bottom, centred on the card's X / Y */
  function layout (c, W, H, imgs) {
    const k = Math.min(W, H) / 1080, cw = c.w * Math.min(W, H), list = []
    for (const p of PARTS) {
      const e = c.el[p]; if (!e.on) continue
      let w = 0, h = 0
      if (p === 'icon') { if (!ok(imgs.icon)) continue; w = h = cw * 0.3 }
      else if (p === 'logo') { if (!ok(imgs.logo)) continue; w = cw; h = w * (imgs.logo.naturalHeight || imgs.logo.height) / (imgs.logo.naturalWidth || imgs.logo.width) }
      else if (p === 'title') { if (!c.title || (ok(imgs.logo) && c.el.logo.on)) continue; w = cw; h = 170 * k }
      else { if (!c.cta && !(c.btn.fill === 'image' && ok(imgs.cta))) continue; w = cw * c.btn.bw / 100; h = 200 * k * c.btn.bh / 100 }
      const s = e.s / 100; list.push({ p, w: w * s, h: h * s, gap: list.length ? e.gap * k : 0, e })
    }
    // one column round the card's Y, or split: icon / logo / name at the top, the button at the bottom (carousel)
    const groups = c.split ? [[list.filter(b => b.p !== 'cta'), c.yTop], [list.filter(b => b.p === 'cta'), c.yBot]] : [[list, c.y]]
    let total = 0
    for (const [g, gy] of groups) {
      if (g.length) g[0].gap = 0
      const t = g.reduce((a, b) => a + b.gap + b.h, 0); total = Math.max(total, t); let y = gy * H - t / 2
      for (const b of g) { y += b.gap; b.x = c.x * W - b.w / 2 + b.e.dx * k; b.y = y + b.e.dy * k; b.cy = gy * H; y += b.h }
    }
    return { list, k, total }
  }
  /** when the layer starts (s): a set second, or after the carousel picked a card */
  function t0 (c, selT) { return c.after === 'select' ? (selT == null ? Infinity : selT + c.delay) : c.start }

  function textBig (g, txt, size, col) {
    g.font = `900 ${Math.round(size)}px Roboto,system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'
    g.lineWidth = size * 0.16; g.strokeStyle = '#1a0f0a'; g.strokeText(txt, 0, 0)
    const gr = g.createLinearGradient(0, -size / 2, 0, size / 2); gr.addColorStop(0, '#ffe066'); gr.addColorStop(0.5, col); gr.addColorStop(1, '#ff6a1a')
    g.fillStyle = gr; g.fillText(txt, 0, 0)
  }

  /* ---------- the button ---------- */
  const hex = h => { h = String(h || '#000').replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  function toHsl (r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60 }
    return [h, s * 100, l * 100] }
  const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)},${Math.round(clamp(s, 0, 100))}%,${Math.round(clamp(l, 0, 100))}%)`
  /** top / bottom shades of the button colour (the default green keeps its hand-picked pair) */
  function btnShades (c) {
    const B = c.btn; if (!B.gradAuto) return [B.gradTop, B.gradBot]
    if (String(c.ctaColor).toLowerCase() === DEF_COL) return ['#9dff5c', '#1f8a0c']
    const [h, s, l] = toHsl(...hex(c.ctaColor)); return [hsl(h - 8, s + 20, l + 24), hsl(h, s, l - 17)] }
  const fam = f => { f = String(f || '').replace(/["';\\{}<>]/g, '').trim(); return (f ? '"' + f + '",' : '') + 'Roboto,system-ui,sans-serif' }
  function drawCta (g, b, c, imgs, k, tt, tc) {
    const B = c.btn, w = b.w, h = b.h
    g.globalAlpha *= B.op / 100
    const pu = c.pulse && tt > tc + 0.35 ? 1 + (B.pulseAmt / 100) * Math.sin((tt - tc - 0.35) * Math.PI * B.pulseSpd) : 1; g.scale(pu, pu)
    const r = B.round / 100 * Math.min(w, h) / 2, lw = B.strokeOn ? h * B.strokeW / 100 : 0, img = B.fill === 'image' && ok(imgs.cta)
    const shadow = on => { if (B.shadow && on) { g.shadowColor = B.shadowColor; g.shadowBlur = B.shadowBlur * k; g.shadowOffsetY = B.shadowY * k } else { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0 } }
    if (img) { g.save(); shadow(true); g.drawImage(imgs.cta, -w / 2, -h / 2, w, h); g.restore() }
    if (lw > 0) { g.save(); shadow(!img); rr(g, -w / 2, -h / 2, w, h, r); g.lineWidth = lw; g.strokeStyle = B.strokeColor; g.stroke(); g.restore() }
    if (!img && B.fill !== 'none') {
      g.save(); shadow(lw <= 0); rr(g, -w / 2, -h / 2, w, h, r)
      if (B.fill === 'solid') g.fillStyle = c.ctaColor
      else { const [t, bt] = btnShades(c), gr = g.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, t); gr.addColorStop(0.45, c.ctaColor); gr.addColorStop(1, bt); g.fillStyle = gr }
      g.fill(); g.restore()
      if (B.gloss && B.fill === 'grad') { rr(g, -w / 2 + h * 0.13, -h / 2 + h * 0.07, w - h * 0.26, h * 0.34, Math.min(h * 0.17, r)); g.fillStyle = 'rgba(255,255,255,' + B.glossA / 100 + ')'; g.fill() }
    }
    let txt = String(c.cta || ''); if (!txt) return; if (B.upper) txt = txt.toUpperCase()
    const style = sz => (B.italic ? 'italic ' : '') + B.weight + ' ' + Math.round(sz) + 'px ' + fam(B.font), ls = 'letterSpacing' in g
    let size = h * B.ts / 100; g.font = style(size); if (ls) g.letterSpacing = size * B.tl / 100 + 'px'
    const tw = g.measureText(txt).width, room = Math.max(10, w - h * 0.45); if (tw > room) { size *= room / tw; g.font = style(size); if (ls) g.letterSpacing = size * B.tl / 100 + 'px' }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; const ty = h * 0.02 + h * B.tdy / 100
    if (B.tstrokeOn && B.tstrokeW > 0) { g.lineWidth = size * B.tstrokeW / 100; g.strokeStyle = B.tstrokeColor; g.strokeText(txt, 0, ty) }
    g.fillStyle = c.ctaText; g.fillText(txt, 0, ty); if (ls) g.letterSpacing = '0px'
  }
  function drawPart (g, b, c, imgs, k, tt, tc) {
    const w = b.w, h = b.h
    if (b.p === 'icon') { g.save(); rr(g, -w / 2, -h / 2, w, h, w * 0.22); g.lineWidth = 12 * k * b.e.s / 100; g.strokeStyle = '#1a0f0a'; g.stroke(); g.clip(); g.drawImage(imgs.icon, -w / 2, -h / 2, w, h); g.restore() }
    else if (b.p === 'logo') g.drawImage(imgs.logo, -w / 2, -h / 2, w, h)
    else if (b.p === 'title') { let size = h; g.font = `900 ${Math.round(size)}px Roboto,system-ui,sans-serif`; const tw = g.measureText(c.title).width; if (tw > w) size *= w / tw; textBig(g, c.title, size, c.titleColor) }
    else drawCta(g, b, c, imgs, k, tt, tc)
  }
  /** draw the layer at second tt. opt: { selT (carousel pick time), guides (preview: anchor + box of the selected part) } */
  function paint (g, W, H, tt, c, imgs, opt) {
    opt = opt || {}; const T0 = t0(c, opt.selT); if (!(tt >= T0)) return null
    const L = layout(c, W, H, imgs), s = ease(c, (tt - T0) / Math.max(0.01, c.grow)), X = c.x * W, Y = c.y * H
    g.save(); if (!c.split) { g.translate(X, Y); g.scale(s, s); g.translate(-X, -Y) }
    L.list.forEach((b, i) => {
      const tc = T0 + c.grow + c.stagger * i; let p = tt < tc ? 0 : ease(c, (tt - tc) / 0.35); if (c.split) p *= s; if (p <= 0) return
      const px = b.x + b.w * b.e.ax / 100, py = b.y + b.h * b.e.ay / 100 // anchor point: the part grows out of it
      g.save(); g.translate(px, py); g.scale(p, p); g.translate(b.x + b.w / 2 - px, b.y + b.h / 2 - py); drawPart(g, b, c, imgs, L.k, tt, tc); g.restore()
    })
    g.restore()
    if (opt.guides) {
      const b = L.list.find(q => q.p === c.sel)
      if (b) { const px = b.x + b.w * b.e.ax / 100, py = b.y + b.h * b.e.ay / 100, k = L.k
        g.save(); g.setLineDash([10 * k, 8 * k]); g.lineWidth = 3 * k; g.strokeStyle = '#4fed89'; g.strokeRect(b.x, b.y, b.w, b.h); g.setLineDash([])
        g.lineWidth = 4 * k; g.strokeStyle = '#fff'; g.beginPath(); g.arc(px, py, 14 * k, 0, 7); g.moveTo(px - 26 * k, py); g.lineTo(px + 26 * k, py); g.moveTo(px, py - 26 * k); g.lineTo(px, py + 26 * k); g.stroke()
        g.strokeStyle = '#4fed89'; g.lineWidth = 2 * k; g.stroke(); g.restore() }
      // centre line: shows when the column is centred
      if (Math.abs(c.x - 0.5) < 1e-3) { g.save(); g.strokeStyle = 'rgba(79,237,137,.5)'; g.setLineDash([12, 10]); g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke(); g.restore() }
    }
    return L
  }
  /** which part is under (x, y) (canvas px), or null */
  function hit (c, W, H, x, y, imgs) { const L = layout(c, W, H, imgs); const b = L.list.slice().reverse().find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); return b ? b.p : null }

  /* ready-made looks for the button: colours + shape; every value stays editable afterwards */
  const PRESETS = [
    ['green', ['Xanh lá', 'Green', '초록'], '#3cc41a', { c: { ctaColor: '#3cc41a', ctaText: '#ffffff' }, b: {} }],
    ['orange', ['Cam', 'Orange', '주황'], '#ff8a00', { c: { ctaColor: '#ff8a00', ctaText: '#ffffff' }, b: {} }],
    ['blue', ['Xanh dương', 'Blue', '파랑'], '#2a8cff', { c: { ctaColor: '#2a8cff', ctaText: '#ffffff' }, b: {} }],
    ['red', ['Đỏ', 'Red', '빨강'], '#ff3b30', { c: { ctaColor: '#ff3b30', ctaText: '#ffffff' }, b: {} }],
    ['purple', ['Tím', 'Purple', '보라'], '#8a4dff', { c: { ctaColor: '#8a4dff', ctaText: '#ffffff' }, b: {} }],
    ['yellow', ['Vàng', 'Yellow', '노랑'], '#ffc21a', { c: { ctaColor: '#ffc21a', ctaText: '#3a2200' }, b: { tstrokeOn: false } }],
    ['white', ['Trắng', 'White', '흰색'], '#ffffff', { c: { ctaColor: '#ffffff', ctaText: '#1b1b1b' }, b: { fill: 'solid', gloss: false, strokeColor: '#c9c9c9', tstrokeOn: false, shadow: true, shadowColor: '#000000' } }],
    ['flat', ['Phẳng bo góc', 'Flat rounded', '플랫'], '#2e7dff', { c: { ctaColor: '#2e7dff', ctaText: '#ffffff' }, b: { fill: 'solid', gloss: false, strokeOn: false, round: 40, tstrokeOn: false, shadow: true, shadowColor: '#0a2a66', shadowBlur: 18, shadowY: 12 } }],
    ['outline', ['Chỉ viền', 'Outline', '아웃라인'], 'transparent', { c: { ctaColor: '#ffffff', ctaText: '#ffffff' }, b: { fill: 'none', gloss: false, strokeW: 7, strokeColor: '#ffffff', tstrokeOn: false, round: 100 } }]
  ]
  /* ---------------- settings panel ---------------- */
  let cssDone = false
  function css () {
    if (cssDone) return; cssDone = true
    const st = document.createElement('style'); st.textContent = `
.gbec{display:flex;flex-direction:column;gap:8px;font:13px/1.5 Roboto,system-ui,sans-serif}
.gbec .tabs{display:flex;gap:4px;flex-wrap:wrap}.gbec .tabs button{flex:1;min-width:0}
.gbec button{cursor:pointer;border-radius:10px;padding:6px 8px;border:1px solid rgba(169,246,228,.3);background:rgba(255,255,255,.06);color:inherit;font:inherit}
.gbec button.on{background:linear-gradient(120deg,#37966a,#19df62);border-color:transparent;color:#fff;font-weight:700}
.gbec .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.gbec .row>span{min-width:96px;opacity:.75}
.gbec input[type=range]{flex:1;min-width:80px;accent-color:#19df62}.gbec input[type=number]{flex:0 0 72px!important;width:72px!important;min-width:0}
.gbec input[type=number],.gbec input[type=text],.gbec select{background:rgba(0,0,0,.35);color:inherit;border:1px solid rgba(169,246,228,.3);border-radius:8px;padding:4px 6px;font:inherit}
.gbec .anc{display:grid;grid-template-columns:repeat(3,26px);gap:3px}.gbec .anc button{padding:0;height:26px;border-radius:6px;font-size:11px}
.gbec .imgs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.gbec .imgs div{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border-radius:10px;border:1px dashed rgba(169,246,228,.35);font-size:12px;text-align:center}.gbec .imgs img{width:48px;height:48px;object-fit:contain;border-radius:8px;background:rgba(0,0,0,.3)}.gbec .imgs .row{justify-content:center}
.gbec .sm{font-size:12px;opacity:.75}.gbec output{min-width:44px;text-align:right;opacity:.85}`
    document.head.appendChild(st)
  }
  /** api: { lang(), change(), upload(part) (optional: icon / logo pickers), hasImg(part) } */
  function panel (root, c, api) {
    css(); const L = () => (api.lang && api.lang()) || 'vi'
    const T = (vi, en, ko) => L() === 'en' ? en : L() === 'ko' ? (ko || en) : vi
    const nm = p => NAME[p][L() === 'en' ? 1 : L() === 'ko' ? 2 : 0]
    const e = c.el[c.sel] || c.el.icon, q = v => String(v ?? '').replace(/"/g, '&quot;')
    const num = (k, v, min, max, step, unit) => `<div class="row"><span>${k}</span><input type="range" data-n="${v}" min="${min}" max="${max}" step="${step}" value="${e[v]}"><input type="number" data-n="${v}" min="${min}" max="${max}" step="${step}" value="${e[v]}">${unit || ''}</div>`
    const B = c.btn, hd = t => `<div class="sm" style="font-weight:700;opacity:1;margin-top:6px;border-top:1px solid rgba(169,246,228,.15);padding-top:6px">${t}</div>`
    const bn = (k, v, min, max, step, unit) => `<div class="row"><span>${k}</span><input type="range" data-b="${v}" min="${min}" max="${max}" step="${step}" value="${B[v]}"><input type="number" data-b="${v}" min="${min}" max="${max}" step="${step}" value="${B[v]}">${unit || ''}</div>`
    const bk = (k, v) => `<label><input type="checkbox" data-b="${v}" ${B[v] ? 'checked' : ''}> ${k}</label>`
    const bc = (k, v) => `<label>${k} <input type="color" data-b="${v}" value="${B[v]}"></label>`
    const sel = (v, opts) => `<select data-b="${v}">${opts.map(([val, lab]) => `<option value="${val}"${String(B[v]) === String(val) ? ' selected' : ''}>${lab}</option>`).join('')}</select>`
    function btnUI () {
      return `${hd(T('Kiểu nút', 'Button style', '버튼 스타일'))}
      <div class="row">${PRESETS.map(([id, n, col]) => `<button data-preset="${id}" title="${n[L() === 'en' ? 1 : L() === 'ko' ? 2 : 0]}" style="min-width:28px;height:28px;padding:0 6px;font-size:11px;${col === 'transparent' ? 'background:transparent;border:2px solid #fff' : 'background:' + col + ';border:2px solid #1a0f0a'};color:${col === '#ffffff' || col === '#ffc21a' ? '#222' : '#fff'}">${n[L() === 'en' ? 1 : L() === 'ko' ? 2 : 0]}</button>`).join('')}</div>
      ${hd(T('Kích thước · bo góc', 'Size · roundness', '크기 · 둥글기'))}
      ${bn(T('Rộng nút', 'Button width', '너비'), 'bw', 20, 200, 1, '%')}
      ${bn(T('Cao nút', 'Button height', '높이'), 'bh', 20, 250, 1, '%')}
      ${bn(T('Bo góc', 'Roundness', '둥글기'), 'round', 0, 100, 1, '%')}
      ${bn(T('Độ đậm cả nút', 'Opacity', '불투명도'), 'op', 10, 100, 1, '%')}
      ${hd(T('Màu nền', 'Fill', '채우기'))}
      <div class="row"><span>${T('Kiểu', 'Type', '종류')}</span>${sel('fill', [['grad', T('Chuyển màu + bóng', 'Gradient + gloss', '그라데이션')], ['solid', T('Một màu', 'Solid', '단색')], ['none', T('Không nền (chỉ viền)', 'None (outline)', '없음')], ['image', T('Ảnh của bạn', 'Your image', '이미지')]])}
        ${B.fill === 'image' && api.upload ? `<button data-upbtn>⬆ ${T('Chọn ảnh nút', 'Pick button image', '이미지')}</button>${api.hasImg && api.hasImg('cta') ? ' ✓' : ''}` : ''}</div>
      ${B.fill === 'grad' ? `<div class="row">${bk(T('Tự pha màu sáng / tối từ màu nút', 'Auto light / dark from the colour', '자동 음영'), 'gradAuto')}${B.gradAuto ? '' : bc(T('Trên', 'Top', '위'), 'gradTop') + bc(T('Dưới', 'Bottom', '아래'), 'gradBot')}</div>
        <div class="row">${bk(T('Vệt sáng', 'Gloss', '광택'), 'gloss')}</div>${B.gloss ? bn(T('Độ sáng vệt', 'Gloss strength', '광택 세기'), 'glossA', 0, 100, 1, '%') : ''}` : ''}
      ${hd(T('Viền', 'Stroke', '테두리'))}
      <div class="row">${bk(T('Có viền', 'Stroke', '테두리'), 'strokeOn')}${B.strokeOn ? bc(T('Màu viền', 'Colour', '색'), 'strokeColor') : ''}</div>
      ${B.strokeOn ? bn(T('Dày viền', 'Stroke width', '두께'), 'strokeW', 1, 30, 0.5, '%') : ''}
      ${hd(T('Đổ bóng', 'Shadow', '그림자'))}
      <div class="row">${bk(T('Đổ bóng / phát sáng', 'Shadow / glow', '그림자'), 'shadow')}${B.shadow ? bc(T('Màu', 'Colour', '색'), 'shadowColor') : ''}</div>
      ${B.shadow ? bn(T('Độ nhoè', 'Blur', '흐림'), 'shadowBlur', 0, 120, 1, 'px') + bn(T('Lệch xuống', 'Offset Y', '오프셋'), 'shadowY', -80, 120, 1, 'px') : ''}
      ${hd(T('Chữ trong nút', 'Button text', '버튼 글자'))}
      <div class="row"><span>${T('Font', 'Font', '폰트')}</span><input type="text" data-b="font" value="${q(B.font)}" list="gbec-font"><datalist id="gbec-font">${['Roboto', 'Lilita One', 'Chakra Petch', 'Impact', 'Arial Black', 'Arial', 'Verdana', 'Georgia', 'Trebuchet MS', 'Courier New', 'Comic Sans MS'].map(f => `<option>${f}</option>`).join('')}</datalist>
        ${sel('weight', [[400, T('Thường', 'Regular', '보통')], [700, T('Đậm', 'Bold', '굵게')], [900, T('Rất đậm', 'Black', '매우 굵게')]])}</div>
      <div class="row">${bk(T('Nghiêng', 'Italic', '기울임'), 'italic')}${bk(T('IN HOA', 'UPPERCASE', '대문자'), 'upper')}</div>
      ${bn(T('Cỡ chữ', 'Text size', '글자 크기'), 'ts', 10, 100, 1, '%')}
      ${bn(T('Giãn chữ', 'Letter spacing', '자간'), 'tl', -10, 60, 1, '%')}
      ${bn(T('Chữ lên / xuống', 'Text up / down', '글자 위치'), 'tdy', -40, 40, 1, '%')}
      <div class="row">${bk(T('Viền chữ', 'Text stroke', '글자 테두리'), 'tstrokeOn')}${B.tstrokeOn ? bc(T('Màu', 'Colour', '색'), 'tstrokeColor') : ''}</div>
      ${B.tstrokeOn ? bn(T('Dày viền chữ', 'Text stroke width', '글자 테두리 두께'), 'tstrokeW', 0, 50, 1, '%') : ''}
      ${c.pulse ? hd(T('Nhịp đập', 'Pulse', '펄스')) + bn(T('Biên độ', 'Amount', '크기'), 'pulseAmt', 0, 30, 0.5, '%') + bn(T('Tốc độ', 'Speed', '속도'), 'pulseSpd', 0.5, 8, 0.1, '') : ''}
      <div class="row"><button data-x="resetbtn">↺ ${T('Về kiểu nút mặc định', 'Reset button style', '버튼 초기화')}</button></div>`
    }
    const IM = [['icon', T('App icon', 'App icon', '앱 아이콘'), '1024×1024'], ['logo', T('Logo', 'Logo', '로고'), '1200×600 PNG'], ['cta', T('Nút PLAY (ảnh)', 'PLAY button (image)', 'PLAY 버튼'), '1000×260 PNG']]
    root.innerHTML = `<div class="gbec">
      ${api.upload ? `<div class="imgs">${IM.map(([k, nm, sz]) => { const src = api.imgSrc && api.imgSrc(k); return `<div><b>${nm}</b>${src ? `<img src="${src}" alt="">` : `<span class="sm">${sz}</span>`}<div class="row"><button data-upk="${k}">⬆</button>${src && api.clearImg ? `<button data-rmk="${k}">✕</button>` : ''}</div></div>` }).join('')}</div>
      <div class="sm">${T('Nút PLAY: để trống thì tool tự vẽ nút xanh lá; tải ảnh lên thì dùng ảnh của bạn.', 'PLAY button: empty = the tool draws the green button; upload one to use your own.', '비우면 기본 버튼')}</div>` : ''}
      <div class="tabs">${PARTS.map(p => `<button data-sel="${p}" class="${c.sel === p ? 'on' : ''}">${nm(p)}${c.el[p].on ? '' : ' ✕'}</button>`).join('')}</div>
      <div class="row"><label><input type="checkbox" data-on ${e.on ? 'checked' : ''}> ${T('Hiện', 'Show', '표시')} <b>${nm(c.sel)}</b></label>
        ${api.upload && (c.sel === 'icon' || c.sel === 'logo') ? `<button data-up>⬆ ${T('Chọn ảnh', 'Pick image', '이미지')}</button>${api.hasImg && api.hasImg(c.sel) ? ' ✓' : ''}` : ''}</div>
      ${c.sel === 'title' ? `<div class="row"><span>${T('Chữ', 'Text', '텍스트')}</span><input type="text" data-c="title" value="${q(c.title)}"><input type="color" data-c="titleColor" value="${c.titleColor}"></div><div class="sm">${T('Có logo thì tên game không hiện.', 'Hidden when a logo is shown.', '로고가 있으면 숨김')}</div>` : ''}
      ${c.sel === 'cta' ? `<div class="row"><span>${T('Chữ nút', 'Button text', '버튼 문구')}</span><input type="text" data-c="cta" value="${q(c.cta)}" list="gbec-cta"><datalist id="gbec-cta"><option>PLAY NOW!</option><option>DOWNLOAD NOW!</option><option>INSTALL</option></datalist></div>
        <div class="row"><span>${T('Màu nút · chữ', 'Colour · text', '색')}</span><input type="color" data-c="ctaColor" value="${c.ctaColor}"><input type="color" data-c="ctaText" value="${c.ctaText}"><label><input type="checkbox" data-c="pulse" ${c.pulse ? 'checked' : ''}> ${T('đập nhẹ', 'pulse', '펄스')}</label></div>${btnUI()}` : ''}
      ${num(T('Cỡ', 'Size', '크기'), 's', 20, 250, 1, '%')}
      ${num(T('Cách phần trên', 'Space above', '위 간격'), 'gap', -200, 400, 2, 'px')}
      ${num(T('Lệch X', 'Offset X', 'X'), 'dx', -540, 540, 2, 'px')}
      ${num(T('Lệch Y', 'Offset Y', 'Y'), 'dy', -960, 960, 2, 'px')}
      <div class="row"><span>${T('Điểm neo (anchor)', 'Anchor point', '앵커')}</span><div class="anc">${[[0, 0], [50, 0], [100, 0], [0, 50], [50, 50], [100, 50], [0, 100], [50, 100], [100, 100]].map(([x, y]) => `<button data-anc="${x},${y}" class="${e.ax === x && e.ay === y ? 'on' : ''}">•</button>`).join('')}</div>
        <input type="number" data-n="ax" min="-100" max="200" step="1" value="${e.ax}" title="X %"><input type="number" data-n="ay" min="-100" max="200" step="1" value="${e.ay}" title="Y %"></div>
      <div class="sm">${T('Như After Effects: phần tử phóng to ra từ điểm neo (dấu ✛ trên khung xem trước). Bấm phần tử trên khung để chọn + kéo; giữ Shift = chỉ ngang / dọc; mũi tên 1 px, Shift + mũi tên 10 px.', 'Like After Effects: the part grows out of its anchor (the ✛ on the preview). Click a part on the preview to pick + drag it; hold Shift = straight across / down; arrows 1 px, Shift + arrows 10 px.', '앵커에서 확대. 클릭·드래그, Shift = 한 축')}</div>
      <div class="row"><button data-x="cpart">⇔ ${T('Căn giữa phần này', 'Centre this part', '이 요소 가운데')}</button><button data-x="call">⊕ ${T('Căn giữa cả khối', 'Centre the whole card', '전체 가운데')}</button></div>
      <div class="row"><button data-x="gaps">↕ ${T('Khoảng cách đều', 'Even spacing', '간격 균등')}</button><input type="number" data-x2="gapall" value="${e.gap || 36}" step="2"> px<button data-x="reset">↺ ${T('Về mặc định', 'Reset', '초기화')}</button></div>
      <hr style="border:0;border-top:1px solid rgba(169,246,228,.2);width:100%">
      <div class="row"><span>${T('Hiện ra', 'Appears', '등장')}</span>${api.kind !== 'carousel' ? `${T('ở giây', 'at second', '초')} <input type="number" data-c="start" step="0.1" min="0" value="${c.start}"> s</div>` : `<select data-c="after"><option value="time"${c.after === 'time' ? ' selected' : ''}>${T('ở giây', 'at second', '초')}</option><option value="select"${c.after === 'select' ? ' selected' : ''}>${T('sau khi chọn thẻ', 'after the card pick', '카드 선택 후')}</option></select>
        <input type="number" data-c="${c.after === 'select' ? 'delay' : 'start'}" step="0.1" min="0" value="${c.after === 'select' ? c.delay : c.start}"> s</div>`}
      <div class="row"><span>${T('Phóng to trong', 'Grows over', '확대 시간')}</span><input type="number" data-c="grow" step="0.05" min="0.05" value="${c.grow}"> s <select data-c="ease"><option value="back"${c.ease === 'back' ? ' selected' : ''}>${T('nảy', 'bounce', '바운스')}</option><option value="out"${c.ease === 'out' ? ' selected' : ''}>${T('mượt', 'smooth', '부드럽게')}</option><option value="linear"${c.ease === 'linear' ? ' selected' : ''}>${T('đều', 'linear', '선형')}</option></select></div>
      <div class="row"><span>${T('Mỗi phần cách', 'Parts pop every', '요소 간격')}</span><input type="number" data-c="stagger" step="0.02" min="0" value="${c.stagger}"> s</div>
      <div class="row"><label><input type="checkbox" data-c="split" ${c.split ? 'checked' : ''}> ${T('Logo / icon ở trên, nút ở dưới', 'Logo / icon at the top, button at the bottom', '로고 위, 버튼 아래')}</label></div>
      ${c.split ? `<div class="row"><span>${T('Cao khối trên · nút', 'Top · button height', '위 · 버튼 높이')}</span><input type="number" data-c="yTop" data-pct step="0.5" value="${+(c.yTop * 100).toFixed(1)}"> % <input type="number" data-c="yBot" data-pct step="0.5" value="${+(c.yBot * 100).toFixed(1)}"> %</div>` : ''}
      <div class="row"><span>${T('Vị trí khối X · Y', 'Card X · Y', '위치 X · Y')}</span><input type="number" data-c="x" data-pct step="0.5" value="${+(c.x * 100).toFixed(1)}"> % <input type="number" data-c="y" data-pct step="0.5" value="${+(c.y * 100).toFixed(1)}"> %</div>
      <div class="row"><span>${T('Rộng khối', 'Card width', '너비')}</span><input type="range" data-c="w" data-pct min="30" max="100" value="${Math.round(c.w * 100)}"></div>
    </div>`
    const redo = () => panel(root, c, api), done = (re) => { api.change(); if (re) redo() }
    root.querySelectorAll('[data-sel]').forEach(b => { b.onclick = () => { c.sel = b.dataset.sel; done(true) } })
    root.querySelector('[data-on]').onchange = ev => { e.on = ev.target.checked; done(true) }
    const up = root.querySelector('[data-up]'); if (up) up.onclick = () => api.upload(c.sel)
    root.querySelectorAll('[data-upk]').forEach(b => { b.onclick = () => api.upload(b.dataset.upk) })
    root.querySelectorAll('[data-rmk]').forEach(b => { b.onclick = () => { api.clearImg(b.dataset.rmk); setTimeout(redo, 100) } })
    root.querySelectorAll('[data-n]').forEach(inp => { inp.oninput = () => { const v = Number(inp.value); if (!isFinite(v)) return; e[inp.dataset.n] = v; root.querySelectorAll(`[data-n="${inp.dataset.n}"]`).forEach(o => { if (o !== inp) o.value = v }); done(false) }; inp.onchange = () => done(true) })
    root.querySelectorAll('[data-b]').forEach(inp => {
      const key = inp.dataset.b, val = () => inp.type === 'checkbox' ? inp.checked : inp.type === 'number' || inp.type === 'range' ? Number(inp.value) : (key === 'weight' ? Number(inp.value) : inp.value)
      inp.oninput = () => { const v = val(); if (typeof v === 'number' && !isFinite(v)) return; B[key] = v; root.querySelectorAll(`[data-b="${key}"]`).forEach(o => { if (o !== inp && o.type !== 'checkbox') o.value = v }); done(false) }
      inp.onchange = () => { B[key] = val(); done(inp.tagName === 'SELECT' || inp.type === 'checkbox') } })
    root.querySelectorAll('[data-preset]').forEach(b => { b.onclick = () => { const pr = PRESETS.find(x => x[0] === b.dataset.preset)[3]; c.btn = Object.assign(btnDefaults(), pr.b); Object.assign(c, pr.c); done(true) } })
    const ub = root.querySelector('[data-upbtn]'); if (ub) ub.onclick = () => api.upload('cta')
    root.querySelectorAll('[data-anc]').forEach(b => { b.onclick = () => { const [x, y] = b.dataset.anc.split(',').map(Number); e.ax = x; e.ay = y; done(true) } })
    root.querySelectorAll('[data-c]').forEach(inp => { inp.oninput = inp.onchange = (ev) => { const k = inp.dataset.c; let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' || inp.type === 'range' ? Number(inp.value) : inp.value; if (inp.dataset.pct !== undefined) v = v / 100; c[k] = v; done(ev.type === 'change' && (inp.tagName === 'SELECT' || inp.type === 'checkbox')) } })
    root.querySelectorAll('[data-x]').forEach(b => { b.onclick = () => {
      const a = b.dataset.x
      if (a === 'cpart') e.dx = 0
      else if (a === 'call') { c.x = 0.5; c.y = 0.5; PARTS.forEach(p => { c.el[p].dx = 0 }) }
      else if (a === 'gaps') { const g = Number(root.querySelector('[data-x2="gapall"]').value) || 0; PARTS.forEach((p, i) => { if (i > 0) c.el[p].gap = g }) }
      else if (a === 'reset') { const d = defaults(api.kind); Object.assign(e, d.el[c.sel]); if (c.sel === 'cta') { c.btn = btnDefaults(); c.ctaColor = d.ctaColor; c.ctaText = d.ctaText } }
      else if (a === 'resetbtn') { const d = defaults(api.kind); c.btn = btnDefaults(); c.ctaColor = d.ctaColor; c.ctaText = d.ctaText }
      done(true) } })
  }
  window.GBEC = { PARTS, defaults, fix, layout, paint, hit, panel, t0 }
})()
