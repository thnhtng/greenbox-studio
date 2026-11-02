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
  function defaults (kind) {
    const c = { start: 0.2, grow: 0.6, ease: 'back', stagger: 0.12, x: 0.5, y: 0.5, w: 0.86, title: 'XP HERO', titleColor: '#ffc21a', cta: 'PLAY NOW!', ctaColor: '#3cc41a', ctaText: '#ffffff', pulse: true, after: 'time', delay: 0.4, sel: 'icon', split: false, yTop: 0.13, yBot: 0.87,
      el: { icon: part(0), logo: part(36), title: part(36), cta: part(36) } }
    if (kind === 'carousel') { Object.assign(c, { y: 0.84, w: 0.7, after: 'time', start: 0, grow: 0.5, split: true }); c.el.icon.s = 70; c.el.title.s = 70; c.el.cta.s = 80; c.el.logo.s = 70; c.el.icon.gap = 0; c.el.title.gap = 20; c.el.cta.gap = 24 }
    return c
  }
  /** fill the fields an older saved config does not have */
  function fix (c, kind) { const d = defaults(kind); for (const k in d) if (c[k] === undefined) c[k] = d[k]; for (const p of PARTS) c.el[p] = Object.assign(part(36), d.el[p], c.el[p] || {}); return c }
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
      else { if (!c.cta) continue; w = cw; h = 200 * k }
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
  function drawPart (g, b, c, imgs, k, tt, tc) {
    const w = b.w, h = b.h
    if (b.p === 'icon') { g.save(); rr(g, -w / 2, -h / 2, w, h, w * 0.22); g.lineWidth = 12 * k * b.e.s / 100; g.strokeStyle = '#1a0f0a'; g.stroke(); g.clip(); g.drawImage(imgs.icon, -w / 2, -h / 2, w, h); g.restore() }
    else if (b.p === 'logo') g.drawImage(imgs.logo, -w / 2, -h / 2, w, h)
    else if (b.p === 'title') { let size = h; g.font = `900 ${Math.round(size)}px Roboto,system-ui,sans-serif`; const tw = g.measureText(c.title).width; if (tw > w) size *= w / tw; textBig(g, c.title, size, c.titleColor) }
    else {
      const pu = c.pulse && tt > tc + 0.35 ? 1 + 0.05 * Math.sin((tt - tc - 0.35) * Math.PI * 2.4) : 1; g.scale(pu, pu)
      const r = h / 2, lw = h * 0.08
      rr(g, -w / 2, -h / 2, w, h, r); g.lineWidth = lw; g.strokeStyle = '#1a0f0a'; g.stroke()
      const gr = g.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, '#9dff5c'); gr.addColorStop(0.45, c.ctaColor); gr.addColorStop(1, '#1f8a0c')
      rr(g, -w / 2, -h / 2, w, h, r); g.fillStyle = gr; g.fill()
      rr(g, -w / 2 + h * 0.13, -h / 2 + h * 0.07, w - h * 0.26, h * 0.34, h * 0.17); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill()
      let size = h * 0.54; g.font = `900 ${Math.round(size)}px Roboto,system-ui,sans-serif`; const tw = g.measureText(c.cta).width; if (tw > w - h * 0.45) size *= (w - h * 0.45) / tw
      g.font = `900 ${Math.round(size)}px Roboto,system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'
      g.lineWidth = size * 0.2; g.strokeStyle = '#1a0f0a'; g.strokeText(c.cta, 0, h * 0.02); g.fillStyle = c.ctaText; g.fillText(c.cta, 0, h * 0.02)
    }
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
    root.innerHTML = `<div class="gbec">
      <div class="tabs">${PARTS.map(p => `<button data-sel="${p}" class="${c.sel === p ? 'on' : ''}">${nm(p)}${c.el[p].on ? '' : ' ✕'}</button>`).join('')}</div>
      <div class="row"><label><input type="checkbox" data-on ${e.on ? 'checked' : ''}> ${T('Hiện', 'Show', '표시')} <b>${nm(c.sel)}</b></label>
        ${api.upload && (c.sel === 'icon' || c.sel === 'logo') ? `<button data-up>⬆ ${T('Chọn ảnh', 'Pick image', '이미지')}</button>${api.hasImg && api.hasImg(c.sel) ? ' ✓' : ''}` : ''}</div>
      ${c.sel === 'title' ? `<div class="row"><span>${T('Chữ', 'Text', '텍스트')}</span><input type="text" data-c="title" value="${q(c.title)}"><input type="color" data-c="titleColor" value="${c.titleColor}"></div><div class="sm">${T('Có logo thì tên game không hiện.', 'Hidden when a logo is shown.', '로고가 있으면 숨김')}</div>` : ''}
      ${c.sel === 'cta' ? `<div class="row"><span>${T('Chữ nút', 'Button text', '버튼 문구')}</span><input type="text" data-c="cta" value="${q(c.cta)}" list="gbec-cta"><datalist id="gbec-cta"><option>PLAY NOW!</option><option>DOWNLOAD NOW!</option><option>INSTALL</option></datalist></div>
        <div class="row"><span>${T('Màu nút · chữ', 'Colour · text', '색')}</span><input type="color" data-c="ctaColor" value="${c.ctaColor}"><input type="color" data-c="ctaText" value="${c.ctaText}"><label><input type="checkbox" data-c="pulse" ${c.pulse ? 'checked' : ''}> ${T('đập nhẹ', 'pulse', '펄스')}</label></div>` : ''}
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
    root.querySelectorAll('[data-n]').forEach(inp => { inp.oninput = () => { const v = Number(inp.value); if (!isFinite(v)) return; e[inp.dataset.n] = v; root.querySelectorAll(`[data-n="${inp.dataset.n}"]`).forEach(o => { if (o !== inp) o.value = v }); done(false) }; inp.onchange = () => done(true) })
    root.querySelectorAll('[data-anc]').forEach(b => { b.onclick = () => { const [x, y] = b.dataset.anc.split(',').map(Number); e.ax = x; e.ay = y; done(true) } })
    root.querySelectorAll('[data-c]').forEach(inp => { inp.oninput = inp.onchange = (ev) => { const k = inp.dataset.c; let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' || inp.type === 'range' ? Number(inp.value) : inp.value; if (inp.dataset.pct !== undefined) v = v / 100; c[k] = v; done(ev.type === 'change' && (inp.tagName === 'SELECT' || inp.type === 'checkbox')) } })
    root.querySelectorAll('[data-x]').forEach(b => { b.onclick = () => {
      const a = b.dataset.x
      if (a === 'cpart') e.dx = 0
      else if (a === 'call') { c.x = 0.5; c.y = 0.5; PARTS.forEach(p => { c.el[p].dx = 0 }) }
      else if (a === 'gaps') { const g = Number(root.querySelector('[data-x2="gapall"]').value) || 0; PARTS.forEach((p, i) => { if (i > 0) c.el[p].gap = g }) }
      else if (a === 'reset') { const d = defaults(api.kind); Object.assign(e, d.el[c.sel]) }
      done(true) } })
  }
  window.GBEC = { PARTS, defaults, fix, layout, paint, hit, panel, t0 }
})()
