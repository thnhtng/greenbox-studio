/* Greenbox layouts for hpbar.html: ⬆ upgrade cards (pick 1 of 3), 🗺 minimap (draw / scan a map, WASD player dot),
   🎒 inventory (merge items into bigger levels, drag out to throw away, grow the bag).
   Every page is painted from the timeline time, so the preview, the alpha .MOV and the green MP4 show the same thing.
   window.GBLY.init(api) → { up, map, inv } page objects: paint / side / wire / down / move / up / key / tick / marks / len */
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const eo = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
  const eio = k => { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
  const back = k => { k = clamp(k, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  const backIn = k => { k = clamp(k, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return c3 * k * k * k - c1 * k * k; };
  function rr (c, X, Y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(X + r, Y); c.arcTo(X + w, Y, X + w, Y + h, r); c.arcTo(X + w, Y + h, X, Y + h, r); c.arcTo(X, Y + h, X, Y, r); c.arcTo(X, Y, X + w, Y, r); c.closePath(); }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /* ---------------- generated item / card art (vector, no files): the "self-generated" pictures ---------------- */
  const ICONS = ['sword', 'shield', 'potion', 'bow', 'helmet', 'gem', 'heart', 'bolt', 'coin', 'star', 'fire', 'boot'];
  const RAR = { common: ['#9aa4b2', '#5b6472'], rare: ['#4da6ff', '#1747c9'], epic: ['#c77dff', '#6a1fb8'], legend: ['#ffd34d', '#d97706'] };
  const LVLC = ['#cfd6e0', '#4da6ff', '#c77dff', '#ffd34d'];
  function icon (c, type, X, Y, s, col) {
    c.save(); c.translate(X, Y); c.scale(s / 100, s / 100); c.lineJoin = 'round'; c.lineCap = 'round';
    const fill = (f, st) => { c.fillStyle = f; c.fill(); if (st !== false) { c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.75)'; c.stroke(); } };
    const g = (a, b) => { const q = c.createLinearGradient(-40, -40, 40, 40); q.addColorStop(0, a); q.addColorStop(1, b); return q; };
    switch (type) {
      case 'sword':
        c.rotate(-Math.PI / 4);
        c.beginPath(); c.moveTo(-7, -46); c.lineTo(0, -58); c.lineTo(7, -46); c.lineTo(7, 18); c.lineTo(-7, 18); c.closePath(); fill(g('#ffffff', '#9fb3c8'));
        c.beginPath(); rr(c, -24, 16, 48, 10, 4); fill(col);
        c.beginPath(); rr(c, -5, 26, 10, 22, 3); fill('#7a4a22');
        c.beginPath(); c.arc(0, 52, 7, 0, 7); fill(col); break;
      case 'shield':
        c.beginPath(); c.moveTo(0, -48); c.quadraticCurveTo(30, -38, 42, -40); c.quadraticCurveTo(44, 20, 0, 50); c.quadraticCurveTo(-44, 20, -42, -40); c.quadraticCurveTo(-30, -38, 0, -48); c.closePath(); fill(g(col, '#2a2f3a'));
        c.beginPath(); c.moveTo(0, -30); c.lineTo(0, 34); c.moveTo(-26, -8); c.lineTo(26, -8); c.lineWidth = 7; c.strokeStyle = 'rgba(255,255,255,.75)'; c.stroke(); break;
      case 'potion':
        c.beginPath(); c.arc(0, 14, 34, 0, 7); fill(g('#ff6b8a', '#b3123b'));
        c.beginPath(); rr(c, -12, -44, 24, 30, 5); fill('#dfe7f1');
        c.beginPath(); rr(c, -15, -52, 30, 10, 4); fill('#8a5a2b');
        c.beginPath(); c.arc(-11, 4, 8, 0, 7); c.fillStyle = 'rgba(255,255,255,.6)'; c.fill(); break;
      case 'bow':
        c.beginPath(); c.arc(-20, 0, 50, -1.2, 1.2); c.lineWidth = 12; c.strokeStyle = '#000'; c.stroke(); c.lineWidth = 7; c.strokeStyle = col; c.stroke();
        c.beginPath(); c.moveTo(-2, -46); c.lineTo(-2, 46); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
        c.beginPath(); c.moveTo(-40, 0); c.lineTo(40, 0); c.lineWidth = 5; c.strokeStyle = '#000'; c.stroke(); c.lineWidth = 3; c.strokeStyle = '#e9d7b0'; c.stroke();
        c.beginPath(); c.moveTo(48, 0); c.lineTo(34, -9); c.lineTo(34, 9); c.closePath(); fill('#cfd6e0'); break;
      case 'helmet':
        c.beginPath(); c.moveTo(-42, 26); c.quadraticCurveTo(-46, -46, 0, -48); c.quadraticCurveTo(46, -46, 42, 26); c.lineTo(14, 26); c.lineTo(14, 0); c.lineTo(-14, 0); c.lineTo(-14, 26); c.closePath(); fill(g('#e8eef6', col));
        c.beginPath(); c.moveTo(0, -48); c.lineTo(0, -6); c.lineWidth = 6; c.strokeStyle = col; c.stroke(); break;
      case 'gem':
        c.beginPath(); c.moveTo(-40, -12); c.lineTo(-22, -38); c.lineTo(22, -38); c.lineTo(40, -12); c.lineTo(0, 44); c.closePath(); fill(g('#ffffff', col));
        c.beginPath(); c.moveTo(-40, -12); c.lineTo(40, -12); c.moveTo(-14, -38); c.lineTo(0, 44); c.lineTo(14, -38); c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.4)'; c.stroke(); break;
      case 'heart':
        c.beginPath(); c.moveTo(0, 40); c.bezierCurveTo(-60, 0, -36, -50, 0, -22); c.bezierCurveTo(36, -50, 60, 0, 0, 40); fill(g('#ff7a8a', '#d1123b')); break;
      case 'bolt':
        c.beginPath(); c.moveTo(8, -50); c.lineTo(-28, 6); c.lineTo(-2, 6); c.lineTo(-10, 50); c.lineTo(28, -8); c.lineTo(2, -8); c.closePath(); fill(g('#fff3a6', '#ffb020')); break;
      case 'coin':
        c.beginPath(); c.arc(0, 0, 42, 0, 7); fill(g('#ffe58a', '#d98a00'));
        c.beginPath(); c.arc(0, 0, 30, 0, 7); c.lineWidth = 5; c.strokeStyle = 'rgba(120,70,0,.6)'; c.stroke();
        c.font = '900 40px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#7a4a00'; c.fillText('$', 0, 2); break;
      case 'star':
        c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 20 : 48; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); fill(g('#fff3a6', '#ffb020')); break;
      case 'fire':
        c.beginPath(); c.moveTo(0, -50); c.bezierCurveTo(30, -20, 44, 10, 30, 32); c.bezierCurveTo(18, 50, -18, 50, -30, 32); c.bezierCurveTo(-42, 12, -24, -6, -12, -12); c.bezierCurveTo(-10, 2, -2, 6, 4, 0); c.bezierCurveTo(10, -14, 4, -32, 0, -50); fill(g('#ffe066', '#ff3d00'));
        c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(16, 12, 18, 30, 0, 38); c.bezierCurveTo(-18, 30, -14, 14, 0, 0); c.fillStyle = '#fff3a6'; c.fill(); break;
      case 'boot':
        c.beginPath(); c.moveTo(-26, -46); c.lineTo(10, -46); c.lineTo(10, 10); c.lineTo(42, 22); c.lineTo(42, 42); c.lineTo(-26, 42); c.closePath(); fill(g('#c9946a', '#6b3f1d'));
        c.beginPath(); c.moveTo(-26, 30); c.lineTo(42, 30); c.lineWidth = 5; c.strokeStyle = col; c.stroke(); break;
      default:
        c.beginPath(); c.arc(0, 0, 40, 0, 7); fill(col);
    }
    c.restore();
  }
  function pointer (c, X, Y, s, press) {
    c.save(); c.translate(X, Y); const k = s / 100 * (press ? 0.86 : 1); c.scale(k, k);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 74); c.lineTo(18, 58); c.lineTo(31, 86); c.lineTo(44, 80); c.lineTo(31, 52); c.lineTo(54, 52); c.closePath();
    c.lineJoin = 'round'; c.lineWidth = 9; c.strokeStyle = '#000'; c.stroke(); c.fillStyle = '#fff'; c.fill();
    if (press) { c.beginPath(); c.arc(0, 0, 34, 0, 7); c.lineWidth = 6; c.strokeStyle = 'rgba(255,255,255,.8)'; c.stroke(); }
    c.restore();
  }

  window.GBLY = {
    icon, ICONS,
    defaults () {
      return {
        up: { x: 0.5, y: 0.5, w: 0.92, t0: 0.4, tPick: 2.6, tOut: 3.6, pick: 1, dim: 0.45, pointer: true,
          frame: { title: 'CHỌN NÂNG CẤP', color: '#152033', edge: '#ffd34d', title_c: '#ffffff', radius: 48, img: false },
          cards: [
            { name: 'Kiếm lửa', desc: '+25% sát thương', icon: 'fire', rar: 'epic' },
            { name: 'Khiên thép', desc: '+40 giáp', icon: 'shield', rar: 'rare' },
            { name: 'Tia chớp', desc: 'Đánh nhanh x2', icon: 'bolt', rar: 'legend' }] },
        map: { mode: 'draw', tool: 'road', strokes: [], start: [0.5, 0.5], dot: '#ff2a2a', glow: 1, tOk: 0.6,
          mini: { x: 0.05, y: 0.04, size: 0.34, zoom: 2.4, ring: '#ffffff', ringW: 10, bg: '#1d2a22', road: '#e9e3c8', wall: '#6b7a8c', water: '#3f8fd6' },
          path: [], speed: 0.16, rec: false },
        inv: { cols: 6, rows: 4, x: 0.5, y: 0.55, cell: 132, gap: 10, title: 'KHO ĐỒ', panel: '#161c28', slot: '#283246', edge: '#ffd34d', pointer: true, grow: 'row',
          items: [
            { id: 1, type: 'sword', lvl: 1, c: 0, r: 0 }, { id: 2, type: 'sword', lvl: 1, c: 1, r: 0 }, { id: 3, type: 'shield', lvl: 1, c: 2, r: 0 },
            { id: 4, type: 'shield', lvl: 1, c: 3, r: 0 }, { id: 5, type: 'potion', lvl: 1, c: 4, r: 0 }, { id: 6, type: 'gem', lvl: 1, c: 5, r: 0 },
            { id: 7, type: 'sword', lvl: 1, c: 0, r: 2 }, { id: 8, type: 'helmet', lvl: 1, c: 5, r: 3 }],
          acts: [] }
      };
    },
    init (api) {
      const { T } = api;
      const S = () => api.S(); const W = () => api.W(); const H = () => api.H(); const U = () => Math.min(W(), H()) / 1080;

      /* ======================= ⬆ UPGRADE: a frame with 3 cards, the pointer picks one ======================= */
      const POOL = [['Kiếm lửa', '+25% sát thương', 'fire'], ['Khiên thép', '+40 giáp', 'shield'], ['Tia chớp', 'Đánh nhanh x2', 'bolt'], ['Hồi máu', '+30 HP mỗi giây', 'heart'],
        ['Mưa vàng', '+50% vàng', 'coin'], ['Ngôi sao', 'Bất tử 3 giây', 'star'], ['Cung thần', 'Bắn 3 tia', 'bow'], ['Mũ sắt', '-20% sát thương nhận', 'helmet'],
        ['Ngọc quý', '+1 kỹ năng', 'gem'], ['Giày gió', '+30% tốc độ', 'boot'], ['Bình độc', 'Gây độc 5 giây', 'potion'], ['Lưỡi sắc', 'Chí mạng +15%', 'sword']];
      const RARS = ['common', 'rare', 'epic', 'legend'];
      function up_geom () {
        const P = S().up, u = U(), fw = P.w * W(), pad = 34 * u, gap = 26 * u, cw = (fw - pad * 2 - gap * 2) / 3, ch = cw * 1.55, th = 130 * u, fh = th + ch + pad * 1.6;
        const fx = P.x * W() - fw / 2, fy = P.y * H() - fh / 2;
        return { u, fw, fh, fx, fy, pad, gap, cw, ch, th, card: i => ({ x: fx + pad + i * (cw + gap), y: fy + th, w: cw, h: ch }) };
      }
      function paint_card (c, card, b, glow, i) {
        const u = U(), R = RAR[card.rar] || RAR.common, img = api.IMG['upCard' + i];
        c.save();
        if (glow > 0) { c.shadowColor = R[0]; c.shadowBlur = 60 * u * glow; }
        rr(c, b.x, b.y, b.w, b.h, 26 * u); const g = c.createLinearGradient(0, b.y, 0, b.y + b.h); g.addColorStop(0, R[0]); g.addColorStop(1, R[1]); c.fillStyle = g; c.fill();
        c.shadowBlur = 0;
        rr(c, b.x + 8 * u, b.y + 8 * u, b.w - 16 * u, b.h - 16 * u, 20 * u); c.fillStyle = 'rgba(10,14,24,.82)'; c.fill();
        c.save(); rr(c, b.x + 8 * u, b.y + 8 * u, b.w - 16 * u, b.h - 16 * u, 20 * u); c.clip();
        const ir = { x: b.x + 8 * u, y: b.y + 8 * u, w: b.w - 16 * u, h: b.h * 0.55 };
        if (img) { const k = Math.max(ir.w / img.width, ir.h / img.height); c.drawImage(img, ir.x + (ir.w - img.width * k) / 2, ir.y + (ir.h - img.height * k) / 2, img.width * k, img.height * k); }
        else {
          const rg = c.createRadialGradient(b.x + b.w / 2, b.y + b.h * 0.3, 4, b.x + b.w / 2, b.y + b.h * 0.3, b.w * 0.6); rg.addColorStop(0, R[0] + 'aa'); rg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = rg; c.fillRect(ir.x, ir.y, ir.w, ir.h);
          icon(c, card.icon, b.x + b.w / 2, b.y + b.h * 0.3, b.w * 0.62, R[0]);
        }
        const sh = c.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h); sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(0.4, 'rgba(255,255,255,0)'); c.fillStyle = sh; c.fillRect(b.x, b.y, b.w, b.h);
        c.restore();
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `900 ${Math.round(b.w * 0.13)}px system-ui,sans-serif`; c.lineWidth = 7 * u; c.strokeStyle = '#000'; c.strokeText(card.name, b.x + b.w / 2, b.y + b.h * 0.66, b.w * 0.9); c.fillStyle = '#fff'; c.fillText(card.name, b.x + b.w / 2, b.y + b.h * 0.66, b.w * 0.9);
        c.font = `700 ${Math.round(b.w * 0.085)}px system-ui,sans-serif`; c.fillStyle = R[0]; c.fillText(card.desc, b.x + b.w / 2, b.y + b.h * 0.78, b.w * 0.9);
        const rl = { common: T('THƯỜNG', 'COMMON', '일반'), rare: T('HIẾM', 'RARE', '레어'), epic: T('SỬ THI', 'EPIC', '에픽'), legend: T('HUYỀN THOẠI', 'LEGEND', '전설') }[card.rar] || '';
        c.font = `800 ${Math.round(b.w * 0.07)}px system-ui,sans-serif`; c.fillStyle = 'rgba(255,255,255,.7)'; c.fillText(rl, b.x + b.w / 2, b.y + b.h * 0.9);
        c.restore();
      }
      const up = {
        label: () => '⬆ ' + T('Nâng cấp', 'Upgrade', '업그레이드'), fname: 'upgrade-cards_',
        len: () => +(S().up.tOut + 0.6).toFixed(2),
        marks: () => [[S().up.t0, '#4da6ff', 'show'], [S().up.tPick, '#ffd34d', 'pick'], [S().up.tOut, '#ff5d5d', 'out']],
        paint (c, tt) {
          const P = S().up; if (tt < P.t0) return;
          const G = up_geom(), u = G.u, a = tt - P.t0, outk = clamp((tt - P.tOut) / 0.35, 0, 1); if (outk >= 1) return;
          const sIn = back(a / 0.4), sOut = 1 - backIn(outk), sc = Math.max(0, sIn * sOut);
          if (P.dim > 0) { c.save(); c.globalAlpha = P.dim * clamp(a / 0.3, 0, 1) * (1 - outk); c.fillStyle = '#000'; c.fillRect(0, 0, W(), H()); c.restore(); }
          c.save(); const cx = G.fx + G.fw / 2, cy = G.fy + G.fh / 2; c.translate(cx, cy); c.scale(sc, sc); c.translate(-cx, -cy);
          // the frame (a picture, or a drawn glass panel)
          const fimg = api.IMG.upFrame;
          if (fimg) c.drawImage(fimg, G.fx, G.fy, G.fw, G.fh);
          else {
            c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 40 * u; rr(c, G.fx, G.fy, G.fw, G.fh, P.frame.radius * u); c.fillStyle = P.frame.color; c.fill(); c.restore();
            rr(c, G.fx, G.fy, G.fw, G.fh, P.frame.radius * u); c.lineWidth = 8 * u; c.strokeStyle = P.frame.edge; c.stroke();
            const gl = c.createLinearGradient(0, G.fy, 0, G.fy + G.fh * 0.4); gl.addColorStop(0, 'rgba(255,255,255,.16)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); rr(c, G.fx, G.fy, G.fw, G.fh, P.frame.radius * u); c.fillStyle = gl; c.fill();
          }
          c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `900 ${Math.round(64 * u)}px system-ui,sans-serif`; c.lineWidth = 10 * u; c.strokeStyle = 'rgba(0,0,0,.85)';
          c.strokeText(P.frame.title, cx, G.fy + G.th * 0.5, G.fw * 0.9); c.fillStyle = P.frame.title_c; c.fillText(P.frame.title, cx, G.fy + G.th * 0.5, G.fw * 0.9);
          // the cards pop in one after the other; at the pick the chosen one glows, the other two vanish
          const pk = clamp((tt - P.tPick) / 0.3, 0, 1);
          for (let i = 0; i < 3; i++) {
            const b = G.card(i), ak = back((a - 0.25 - i * 0.12) / 0.35); if (ak <= 0) continue;
            let s = ak, al = 1, glow = 0;
            if (tt >= P.tPick) { if (i === P.pick) { s = 1 + 0.08 * eo(pk) + 0.03 * Math.sin((tt - P.tPick) * 9) * (1 - outk); glow = 0.6 + 0.4 * Math.sin((tt - P.tPick) * 6); } else { s = 1 - eo(pk) * 0.6; al = 1 - pk; } }
            if (al <= 0) continue;
            c.save(); c.globalAlpha = al; const bx = b.x + b.w / 2, by = b.y + b.h / 2; c.translate(bx, by); c.scale(s, s); c.translate(-bx, -by);
            paint_card(c, P.cards[i], b, glow, i); c.restore();
          }
          c.restore();
          // the pointer comes in from below, goes to the chosen card and taps it
          if (P.pointer && outk <= 0) {
            const b = G.card(P.pick), tx = b.x + b.w * 0.62, ty = b.y + b.h * 0.55, t1 = P.tPick - 1.0;
            if (tt > t1) { const k = eio((tt - t1) / 0.85); const px = lerp(W() * 0.85, tx, k), py = lerp(H() * 1.02, ty, k); pointer(c, px, py, 90 * u, tt > P.tPick - 0.08 && tt < P.tPick + 0.18); }
          }
        },
        side () {
          const P = S().up;
          const cards = P.cards.map((cd, i) => `<div class="row" style="gap:4px;align-items:center;flex-wrap:nowrap"><b style="min-width:16px">${i + 1}</b>
            <input type="text" data-ly="up.cards.${i}.name" value="${esc(cd.name)}" style="flex:1;min-width:0"><input type="text" data-ly="up.cards.${i}.desc" value="${esc(cd.desc)}" style="flex:1.2;min-width:0"></div>
            <div class="row" style="gap:4px;margin-bottom:6px"><select data-ly="up.cards.${i}.icon">${ICONS.map(k => `<option${cd.icon === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
            <select data-ly="up.cards.${i}.rar">${RARS.map(k => `<option${cd.rar === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
            <button data-up="upCard${i}">🖼</button>${api.IMG['upCard' + i] ? `<button data-rm="upCard${i}">✕</button>` : ''}<button data-lyx="pick${i}"${P.pick === i ? ' class="pri"' : ''}>${T('Chọn', 'Pick', '선택')}</button></div>`).join('');
          return `<section><h3><b>2</b>⬆ ${T('Khung 3 thẻ', 'Frame of 3 cards', '카드 3장 프레임')}</h3>
            <div class="sm">${T('Khung hiện lên (scale), 3 thẻ bật ra lần lượt, con trỏ bay tới chọn 1 thẻ: thẻ đó sáng lên, 2 thẻ kia biến mất, rồi cả khung thu nhỏ biến mất. Bấm thẻ trên khung xem trước = chọn thẻ đó; kéo chỗ trống = dời khung; phím 1 2 3 = chọn.', 'The frame scales in, 3 cards pop one after another, the pointer flies to one: it glows, the other two vanish, then the whole frame scales away. Click a card on the preview = pick it; drag empty space = move the frame; keys 1 2 3 = pick.', '프레임 등장 → 카드 3장 → 포인터가 1장 선택 → 나머지 사라짐 → 축소. 1 2 3 키.')}</div>
            <div class="row"><button data-lyx="gen">🎲 ${T('Gen 3 thẻ mới', 'Generate 3 new cards', '카드 생성')}</button></div>
            ${cards}
            <label><span>${T('Tiêu đề', 'Title', '제목')}</span><input type="text" data-ly="up.frame.title" value="${esc(P.frame.title)}"><input type="color" data-ly="up.frame.title_c" value="${P.frame.title_c}"></label>
            <label><span>${T('Màu khung · viền', 'Frame · edge', '프레임 · 테두리')}</span><input type="color" data-ly="up.frame.color" value="${P.frame.color}"><input type="color" data-ly="up.frame.edge" value="${P.frame.edge}"></label>
            <label><span>${T('Bo góc', 'Corners', '모서리')}</span><input type="range" data-ly="up.frame.radius" min="0" max="120" value="${P.frame.radius}"></label>
            <label><span>${T('Rộng', 'Width', '너비')}</span><input type="range" data-ly="up.w" data-pct="1" min="40" max="100" value="${Math.round(P.w * 100)}"></label>
            <label><span>${T('Phủ tối nền', 'Dark veil', '어둡게')}</span><input type="range" data-ly="up.dim" data-pct="1" min="0" max="90" value="${Math.round(P.dim * 100)}"></label>
            <div class="row"><button data-up="upFrame">🖼 ${T('Ảnh khung riêng', 'Own frame picture', '프레임 이미지')}</button>${api.IMG.upFrame ? '<button data-rm="upFrame">✕</button>' : ''}</div>
            <label><input type="checkbox" data-ly="up.pointer"${P.pointer ? ' checked' : ''}> ${T('Con trỏ bay tới chọn', 'Pointer flies in and taps', '포인터')}</label>
            <label><span>${T('Hiện · chọn · biến mất (s)', 'Show · pick · out (s)', '등장 · 선택 · 퇴장')}</span><input type="number" step="0.1" min="0" data-ly="up.t0" value="${P.t0}"><input type="number" step="0.1" min="0" data-ly="up.tPick" value="${P.tPick}"><input type="number" step="0.1" min="0" data-ly="up.tOut" value="${P.tOut}"></label>
            <div class="row"><button data-lyx="fit">⏲ ${T('Độ dài video vừa khớp', 'Fit the video length', '길이 맞추기')} (${up.len()} s)</button></div>
          </section>`;
        },
        act (k) {
          const P = S().up;
          if (k === 'gen') { const pool = POOL.slice().sort(() => Math.random() - 0.5); P.cards = pool.slice(0, 3).map(([n, d, ic]) => ({ name: n, desc: d, icon: ic, rar: RARS[Math.floor(Math.random() * 4)] })); return true; }
          if (k === 'fit') { S().dur = up.len(); return true; }
          const m = /^pick(\d)$/.exec(k); if (m) { P.pick = +m[1]; return true; }
          return false;
        },
        down (X, Y) {
          const G = up_geom(); for (let i = 0; i < 3; i++) { const b = G.card(i); if (X > b.x && X < b.x + b.w && Y > b.y && Y < b.y + b.h) { S().up.pick = i; api.changed(true); return null; } }
          return { obj: S().up, ox: S().up.x, oy: S().up.y };
        },
        key (e) { if (/^[123]$/.test(e.key)) { S().up.pick = +e.key - 1; api.changed(true); return true; } return false; },
        hint: () => T('Bấm thẻ = chọn · kéo = dời khung · 1 2 3 chọn · Space phát', 'Click a card = pick · drag = move · 1 2 3 pick · Space play', '카드 클릭 · 1 2 3 · Space')
      };

      /* ======================= 🗺 MINIMAP: draw / scan a map, a start dot, then a corner circle that follows the dot (WASD) ======================= */
      const MAPN = 1024; let mapCv = null, mapVer = -1, mapBgRef = null;
      const map_key = () => JSON.stringify([S().map.strokes.length, S().map.strokes.reduce((a, s) => a + s.p.length, 0), S().map.strokes.map(s => s.kind).join(''), S().map.mini]);
      function map_canvas () {
        const k = map_key(); if (mapCv && mapVer === k && mapBgRef === api.IMG.mapBg) return mapCv;
        mapCv = mapCv || document.createElement('canvas'); mapCv.width = mapCv.height = MAPN; mapVer = k; mapBgRef = api.IMG.mapBg;
        const c = mapCv.getContext('2d'), M = S().map, m = M.mini;
        c.fillStyle = m.bg; c.fillRect(0, 0, MAPN, MAPN);
        if (api.IMG.mapBg) { const im = api.IMG.mapBg, s = Math.max(MAPN / im.width, MAPN / im.height); c.drawImage(im, (MAPN - im.width * s) / 2, (MAPN - im.height * s) / 2, im.width * s, im.height * s); }
        // faint grid like a game map
        c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 2; for (let i = 0; i <= MAPN; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, MAPN); c.moveTo(0, i); c.lineTo(MAPN, i); c.stroke(); }
        c.lineCap = 'round'; c.lineJoin = 'round';
        // round 57: all road outlines first (one opaque pass), then every fill — crossing roads no longer show a black seam
        const roads = M.strokes.filter(s => s.kind === 'road' && s.p.length);
        if (roads.length) {
          const ol = document.createElement('canvas'); ol.width = ol.height = MAPN; const oc = ol.getContext('2d'); oc.lineCap = 'round'; oc.lineJoin = 'round';
          for (const s of roads) { path(oc, s.p); oc.lineWidth = s.w * MAPN + 10; oc.strokeStyle = '#000'; oc.stroke(); }
          c.save(); c.globalAlpha = 0.45; c.drawImage(ol, 0, 0); c.restore();
        }
        for (const s of M.strokes) {
          if (s.p.length < 1) continue;
          const w = s.w * MAPN, col = s.kind === 'erase' ? m.bg : s.kind === 'wall' ? m.wall : s.kind === 'water' ? m.water : m.road;
          path(c, s.p); c.lineWidth = w; c.strokeStyle = col; c.stroke();
        }
        return mapCv;
      }
      function path (c, p) { c.beginPath(); c.moveTo(p[0][0] * MAPN, p[0][1] * MAPN); for (let i = 1; i < p.length; i++) c.lineTo(p[i][0] * MAPN, p[i][1] * MAPN); if (p.length === 1) c.lineTo(p[0][0] * MAPN + 0.1, p[0][1] * MAPN); }
      // the big map while drawing: a square in the middle of the frame
      const big = () => { const s = Math.min(W(), H()) * 0.92; return { x: (W() - s) / 2, y: (H() - s) / 2, s }; };
      let live = null; const keys = new Set(); let rec_from = null; let rec_last = 0;
      function pos_at (tt) {
        const M = S().map, P = M.path;
        if (live && !api.playing() && (keys.size || !P.length)) return live;
        if (!P.length || tt <= P[0][0]) return P.length ? [P[0][1], P[0][2]] : M.start;
        for (let i = 1; i < P.length; i++) if (P[i][0] >= tt) { const a = P[i - 1], b = P[i], k = (tt - a[0]) / Math.max(1e-6, b[0] - a[0]); return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
        const l = P[P.length - 1]; return [l[1], l[2]];
      }
      function head_at (tt) { const a = pos_at(Math.max(0, tt - 0.15)), b = pos_at(tt); const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return d > 1e-4 ? Math.atan2(b[1] - a[1], b[0] - a[0]) : null; }
      function dot (c, X, Y, r, col, glow, tt, ang) {
        c.save();
        const pul = 1 + 0.25 * Math.sin(tt * 6);
        if (glow > 0) { const g = c.createRadialGradient(X, Y, 0, X, Y, r * 3.2 * pul); g.addColorStop(0, col + 'cc'); g.addColorStop(1, col + '00'); c.fillStyle = g; c.beginPath(); c.arc(X, Y, r * 3.2 * pul, 0, 7); c.fill(); }
        if (ang !== null && ang !== undefined) { c.beginPath(); c.moveTo(X, Y); c.arc(X, Y, r * 4, ang - 0.45, ang + 0.45); c.closePath(); const g2 = c.createRadialGradient(X, Y, 0, X, Y, r * 4); g2.addColorStop(0, col + '88'); g2.addColorStop(1, col + '00'); c.fillStyle = g2; c.fill(); }
        c.beginPath(); c.arc(X, Y, r, 0, 7); c.fillStyle = col; c.fill(); c.lineWidth = r * 0.35; c.strokeStyle = '#fff'; c.stroke();
        c.restore();
      }
      const map = {
        label: () => '🗺 ' + T('Mini map', 'Minimap', '미니맵'), fname: 'minimap_',
        len: () => { const P = S().map.path; return +Math.max(S().map.tOk + 3, P.length ? P[P.length - 1][0] + 0.5 : 0).toFixed(2); },
        marks: () => [[S().map.tOk, '#4da6ff', 'OK']].concat(S().map.path.length ? [[S().map.path[0][0], '#ff2a2a', 'rec'], [S().map.path[S().map.path.length - 1][0], '#ff2a2a', 'end']] : []),
        paint (c, tt) {
          const M = S().map, u = U(), mc = map_canvas(), B = big();
          if (M.mode === 'draw') {
            c.save(); c.globalAlpha = 0.97; c.drawImage(mc, B.x, B.y, B.s, B.s); c.restore();
            c.lineWidth = 6 * u; c.strokeStyle = '#ffffff'; c.strokeRect(B.x, B.y, B.s, B.s);
            dot(c, B.x + M.start[0] * B.s, B.y + M.start[1] * B.s, 18 * u, M.dot, M.glow, tt, null);
            return;
          }
          // ✓ OK: the big map shrinks into the corner circle, then the circle follows the player
          const m = M.mini, R = m.size * Math.min(W(), H()) / 2, cx = m.x * W() + R, cy = m.y * H() + R;
          const k = eio((tt - M.tOk) / 0.7);
          const p = pos_at(tt);
          if (k < 1) {
            // full map (square) → circle in the corner: morph the box and the corner radius
            const bx = lerp(B.x, cx - R, k), by = lerp(B.y, cy - R, k), bs = lerp(B.s, R * 2, k);
            // the view slides from the whole map to the player's neighbourhood
            const z = lerp(1, m.zoom, k), vw = 1 / z; const ox = lerp(0, p[0] - vw / 2, k), oy = lerp(0, p[1] - vw / 2, k);
            c.save(); rr(c, bx, by, bs, bs, lerp(0, bs / 2, k)); c.clip(); c.fillStyle = m.bg; c.fillRect(bx, by, bs, bs);
            const sc = bs * z; c.drawImage(mc, bx - ox * sc, by - oy * sc, sc, sc);
            dot(c, bx + (p[0] - ox) * sc, by + (p[1] - oy) * sc, 16 * u, M.dot, M.glow, tt, null);
            c.restore();
            c.save(); rr(c, bx, by, bs, bs, lerp(0, bs / 2, k)); c.lineWidth = lerp(6 * u, m.ringW * u, k); c.strokeStyle = m.ring; c.stroke(); c.restore();
            return;
          }
          c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip(); c.fillStyle = m.bg; c.fillRect(cx - R, cy - R, R * 2, R * 2);
          const sc = R * 2 * m.zoom; c.drawImage(mc, cx - p[0] * sc, cy - p[1] * sc, sc, sc);
          const vg = c.createRadialGradient(cx, cy, R * 0.6, cx, cy, R); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = vg; c.fillRect(cx - R, cy - R, R * 2, R * 2);
          c.restore();
          const fimg = api.IMG.mapFrame;
          if (fimg) { const fs = R * 2 * 1.16; c.drawImage(fimg, cx - fs / 2, cy - fs / 2, fs, fs); }
          else { c.beginPath(); c.arc(cx, cy, R, 0, 7); c.lineWidth = m.ringW * u; c.strokeStyle = m.ring; c.stroke(); c.font = `900 ${Math.round(28 * u)}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 6 * u; c.strokeStyle = '#000'; c.strokeText('N', cx, cy - R + 26 * u); c.fillStyle = '#fff'; c.fillText('N', cx, cy - R + 26 * u); }
          dot(c, cx, cy, 15 * u, M.dot, M.glow, tt, head_at(tt));
        },
        tick (dt, tt) {
          const M = S().map; if (M.mode !== 'play' || !keys.size) return false;
          let vx = 0, vy = 0; if (keys.has('w')) vy--; if (keys.has('s')) vy++; if (keys.has('a')) vx--; if (keys.has('d')) vx++;
          if (!vx && !vy) return false;
          const n = Math.hypot(vx, vy); const base = live || pos_at(tt);
          live = [clamp(base[0] + vx / n * M.speed * dt, 0, 1), clamp(base[1] + vy / n * M.speed * dt, 0, 1)];
          if (M.rec && api.playing()) {
            if (rec_from === null) { rec_from = tt; M.path = M.path.filter(q => q[0] < tt); M.path.push([+tt.toFixed(3), base[0], base[1]]); }
            if (tt - rec_last > 1 / 15) { M.path.push([+tt.toFixed(3), live[0], live[1]]); rec_last = tt; }
          }
          return true;
        },
        side () {
          const M = S().map, m = M.mini;
          const tool = (k, l) => `<button data-lyx="tool:${k}"${M.tool === k ? ' class="pri"' : ''}>${l}</button>`;
          return `<section><h3><b>2</b>🗺 ${T('Vẽ / quét map', 'Draw / scan the map', '맵 그리기 / 스캔')}</h3>
            <div class="row">${M.mode === 'draw' ? `<button class="pri" data-lyx="ok">✓ OK ${T('(gom vào góc)', '(into the corner)', '(모서리로)')}</button>` : `<button data-lyx="edit">✏️ ${T('Sửa map', 'Edit the map', '맵 편집')}</button>`}</div>
            ${M.mode === 'draw' ? `<div class="sm">${T('Vẽ layout map bằng chuột trên khung xem trước. Công cụ 📍 = đặt chấm người chơi. Xong bấm OK: map thu thành vòng tròn nhỏ góc trái, dùng W A S D để di chuyển chấm.', 'Draw the map layout with the mouse on the preview. 📍 = place the player dot. Then OK: the map shrinks into a small circle top-left, move the dot with W A S D.', '마우스로 맵 그리기 · 📍 시작점 · OK 후 WASD')}</div>
            <div class="row">${tool('road', '🛣 ' + T('Đường', 'Road', '길'))}${tool('wall', '🧱 ' + T('Tường', 'Wall', '벽'))}${tool('water', '🌊 ' + T('Nước', 'Water', '물'))}${tool('erase', '🧽 ' + T('Tẩy', 'Erase', '지우개'))}${tool('start', '📍 ' + T('Điểm đầu', 'Start', '시작'))}</div>
            <label><span>${T('Cỡ nét', 'Brush', '브러시')}</span><input type="range" data-ly="map.brush" min="1" max="12" value="${M.brush || 4}"></label>
            <div class="row"><button data-lyx="undo1">↶ ${T('Bỏ nét cuối', 'Undo stroke', '되돌리기')}</button><button data-lyx="clear">🗑 ${T('Xoá hết', 'Clear', '지우기')}</button><button data-lyx="sample">🏙 ${T('Map mẫu', 'Sample map', '샘플')}</button></div>
            <div class="row"><button data-lyx="scan">🎞 ${T('Quét map từ video', 'Scan a map from a video', '영상에서 스캔')}</button><button data-up="mapBg">🖼 ${T('Ảnh map', 'Map picture', '맵 이미지')}</button>${api.IMG.mapBg ? '<button data-rm="mapBg">✕</button>' : ''}</div>
            <div id="lyScan"></div>` : `<div class="sm">${T('W A S D di chuyển chấm (xem thử). Bấm ⏺ Ghi rồi ▶ phát: đường đi được ghi theo timeline để xuất video.', 'W A S D moves the dot (try it). Press ⏺ Record then ▶ play: the path is recorded on the timeline for the video.', 'WASD 이동 · ⏺ 녹화 후 ▶')}</div>
            <div class="row"><button data-lyx="rec"${M.rec ? ' class="pri"' : ''}>⏺ ${M.rec ? T('Đang ghi (bấm để tắt)', 'Recording (click to stop)', '녹화 중') : T('Ghi đường đi', 'Record the path', '경로 녹화')}</button><button data-lyx="clearpath">🗑 ${T('Xoá đường', 'Clear path', '경로 삭제')} (${M.path.length})</button></div>
            <label><span>${T('Tốc độ', 'Speed', '속도')}</span><input type="range" data-ly="map.speed" data-pct="1" min="3" max="60" value="${Math.round(M.speed * 100)}"></label>`}
          </section>
          <section><h3><b>3</b>${T('Khung mini map', 'Minimap frame', '미니맵 프레임')}</h3>
            <label><span>${T('Chấm · phát sáng', 'Dot · glow', '점 · 발광')}</span><input type="color" data-ly="map.dot" value="${M.dot}"><input type="range" data-ly="map.glow" data-pct="1" min="0" max="100" value="${Math.round(M.glow * 100)}"></label>
            <label><span>${T('Cỡ · zoom', 'Size · zoom', '크기 · 줌')}</span><input type="range" data-ly="map.mini.size" data-pct="1" min="15" max="60" value="${Math.round(m.size * 100)}"><input type="range" data-ly="map.mini.zoom" data-pct="1" min="100" max="600" value="${Math.round(m.zoom * 100)}"></label>
            <label><span>${T('Viền', 'Ring', '테두리')}</span><input type="color" data-ly="map.mini.ring" value="${m.ring}"><input type="range" data-ly="map.mini.ringW" min="0" max="30" value="${m.ringW}"></label>
            <label><span>${T('Nền · đường', 'Ground · road', '바닥 · 길')}</span><input type="color" data-ly="map.mini.bg" value="${m.bg}"><input type="color" data-ly="map.mini.road" value="${m.road}"></label>
            <label><span>${T('Tường · nước', 'Wall · water', '벽 · 물')}</span><input type="color" data-ly="map.mini.wall" value="${m.wall}"><input type="color" data-ly="map.mini.water" value="${m.water}"></label>
            <label><span>${T('Vị trí góc', 'Corner position', '위치')}</span><input type="range" data-ly="map.mini.x" data-pct="1" min="0" max="70" value="${Math.round(m.x * 100)}"><input type="range" data-ly="map.mini.y" data-pct="1" min="0" max="80" value="${Math.round(m.y * 100)}"></label>
            <div class="row"><button data-up="mapFrame">🖼 ${T('Ảnh khung tròn', 'Round frame picture', '프레임 이미지')}</button>${api.IMG.mapFrame ? '<button data-rm="mapFrame">✕</button>' : ''}</div>
            <label><span>${T('Gom vào góc ở giây', 'Into the corner at', '모서리로 (s)')}</span><input type="number" step="0.1" min="0" data-ly="map.tOk" value="${M.tOk}"> s</label>
            <div class="row"><button data-lyx="fit">⏲ ${T('Độ dài video vừa khớp', 'Fit the video length', '길이 맞추기')} (${map.len()} s)</button></div>
          </section>`;
        },
        act (k) {
          const M = S().map;
          if (k.startsWith('tool:')) { M.tool = k.slice(5); return true; }
          if (k === 'ok') { M.mode = 'play'; live = null; api.set_t(Math.max(0, M.tOk + 0.8)); return true; } // jump past the shrink: the corner circle is on screen right away
          if (k === 'edit') { M.mode = 'draw'; live = null; return true; }
          if (k === 'undo1') { M.strokes.pop(); return true; }
          if (k === 'clear') { M.strokes = []; return true; }
          if (k === 'rec') { M.rec = !M.rec; rec_from = null; if (M.rec) { api.set_t(Math.max(0, M.tOk + 0.8)); api.play(true); } return true; }
          if (k === 'clearpath') { M.path = []; live = null; return true; }
          if (k === 'fit') { S().dur = map.len(); return true; }
          if (k === 'sample') { M.strokes = sample_map(); M.start = [0.5, 0.55]; return true; }
          if (k === 'scan') { scan_open(); return false; }
          return false;
        },
        down (X, Y, e) {
          const M = S().map;
          if (M.mode !== 'draw') { // 🗺 the corner circle: drag it anywhere (Shift = straight, like the other layouts)
            const m = M.mini, R = m.size * Math.min(W(), H()) / 2, cx = m.x * W() + R, cy = m.y * H() + R;
            return Math.hypot(X - cx, Y - cy) <= R * 1.08 ? { obj: m, ox: m.x, oy: m.y } : null;
          }
          const B = big(), mx = (X - B.x) / B.s, my = (Y - B.y) / B.s; if (mx < 0 || my < 0 || mx > 1 || my > 1) return null;
          if (M.tool === 'start') { M.start = [mx, my]; api.changed(true); return { draw: 'start' }; }
          M.strokes.push({ kind: M.tool, w: (M.brush || 4) / 100 * (M.tool === 'water' ? 2 : M.tool === 'wall' ? 0.6 : 1), p: [[+mx.toFixed(4), +my.toFixed(4)]] });
          api.changed(false); return { draw: 'stroke' };
        },
        move (X, Y, d) {
          const M = S().map, B = big(), mx = clamp((X - B.x) / B.s, 0, 1), my = clamp((Y - B.y) / B.s, 0, 1);
          if (d.draw === 'start') { M.start = [mx, my]; return; }
          const s = M.strokes[M.strokes.length - 1], l = s.p[s.p.length - 1]; if (Math.hypot(mx - l[0], my - l[1]) > 0.004) s.p.push([+mx.toFixed(4), +my.toFixed(4)]);
        },
        key (e, down) {
          const M = S().map, k = e.key.toLowerCase(); const m = { w: 'w', a: 'a', s: 's', d: 'd', arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' }[k];
          if (!m || M.mode !== 'play') return false;
          if (down) keys.add(m); else { keys.delete(m); if (!keys.size) { rec_from = null; } }
          return true;
        },
        hint: () => S().map.mode === 'draw' ? T('Vẽ bằng chuột · 📍 đặt chấm · OK để gom vào góc', 'Draw with the mouse · 📍 the dot · OK to shrink', '그리기 · 📍 · OK') : T('W A S D di chuyển chấm · kéo vòng tròn = dời minimap · ⏺ Ghi + ▶ để ghi đường đi · Space phát', 'W A S D move the dot · drag the circle = move the minimap · ⏺ Record + ▶ to record · Space play', 'WASD · ⏺ · Space')
      };
      function sample_map () {
        const R = (kind, w, p) => ({ kind, w, p });
        return [R('water', 0.09, [[0.05, 0.2], [0.25, 0.3], [0.3, 0.55], [0.2, 0.85], [0.1, 0.95]]),
          R('road', 0.04, [[0, 0.5], [1, 0.5]]), R('road', 0.04, [[0.5, 0], [0.5, 1]]), R('road', 0.03, [[0.5, 0.25], [0.85, 0.25], [0.85, 0.75], [0.5, 0.75]]),
          R('road', 0.025, [[0.62, 0.5], [0.62, 0.9], [0.95, 0.9]]), R('wall', 0.02, [[0.65, 0.32], [0.78, 0.32], [0.78, 0.44], [0.65, 0.44], [0.65, 0.32]]),
          R('wall', 0.02, [[0.35, 0.6], [0.44, 0.6], [0.44, 0.7], [0.35, 0.7], [0.35, 0.6]]), R('wall', 0.02, [[0.58, 0.58], [0.72, 0.58], [0.72, 0.68]])];
      }
      // 🎞 scan: pick a frame of an ad / gameplay video, the tool turns it into a map picture (edges = roads / walls)
      function scan_open () {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/*,image/*';
        inp.onchange = () => { const f = inp.files[0]; if (!f) return; if (f.type.startsWith('image/')) { const im = new Image(); im.onload = () => scan_frame(im, im.width, im.height); im.src = URL.createObjectURL(f); return; } scan_video(f); };
        inp.click();
      }
      function scan_video (f) {
        const box = document.getElementById('lyScan'); const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(f);
        v.style.cssText = 'width:100%;border-radius:8px;margin-top:6px';
        box.innerHTML = `<div class="sm">${T('Kéo tới cảnh có map rõ nhất (hoặc cảnh nhìn từ trên xuống), rồi bấm Quét.', 'Scrub to the frame where the map shows best (or a top-down shot), then press Scan.', '맵이 잘 보이는 장면에서 스캔')}</div>`;
        box.appendChild(v); const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = 1000; sl.value = 500; sl.style.width = '100%'; box.appendChild(sl);
        const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<button class="pri">🔍 ${T('Quét cảnh này', 'Scan this frame', '이 장면 스캔')}</button><label style="flex:1"><span>${T('Kiểu', 'Style', '스타일')}</span><select><option value="edges">${T('Nét đường (tự tách)', 'Lines (edges found)', '윤곽')}</option><option value="photo">${T('Giữ ảnh gốc (làm tối)', 'Keep the picture (darkened)', '원본')}</option></select></label>`; box.appendChild(row);
        v.onloadedmetadata = () => { v.currentTime = v.duration / 2; };
        sl.oninput = () => { if (isFinite(v.duration)) v.currentTime = sl.value / 1000 * v.duration; };
        row.querySelector('button').onclick = () => scan_frame(v, v.videoWidth, v.videoHeight, row.querySelector('select').value);
      }
      function scan_frame (src, w, h, style) {
        const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N; const c = cv.getContext('2d');
        const s = Math.max(N / w, N / h); c.drawImage(src, (N - w * s) / 2, (N - h * s) / 2, w * s, h * s);
        const id = c.getImageData(0, 0, N, N), d = id.data, g = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
        const m = S().map.mini, hex = q => [parseInt(q.slice(1, 3), 16), parseInt(q.slice(3, 5), 16), parseInt(q.slice(5, 7), 16)];
        const bg = hex(m.bg), rd = hex(m.road), wt = hex(m.water);
        if (style === 'photo') { for (let i = 0; i < N * N; i++) { d[i * 4] *= 0.55; d[i * 4 + 1] *= 0.6; d[i * 4 + 2] *= 0.55; } }
        else {
          // Sobel edges → road lines; blue-ish areas → water; the rest is the ground colour
          for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
            const i = y * N + x;
            const gx = -g[i - N - 1] - 2 * g[i - 1] - g[i + N - 1] + g[i - N + 1] + 2 * g[i + 1] + g[i + N + 1];
            const gy = -g[i - N - 1] - 2 * g[i - N] - g[i - N + 1] + g[i + N - 1] + 2 * g[i + N] + g[i + N + 1];
            const e = Math.hypot(gx, gy); const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
            const water = b > r * 1.25 && b > gg * 1.05 && b > 90;
            const col = e > 150 ? rd : water ? wt : bg; const k = e > 150 ? 1 : 0.85;
            d[i * 4] = col[0] * k; d[i * 4 + 1] = col[1] * k; d[i * 4 + 2] = col[2] * k; d[i * 4 + 3] = 255;
          }
        }
        c.putImageData(id, 0, 0);
        api.set_img('mapBg', cv);
      }

      /* ======================= 🎒 INVENTORY: a grid; level-1 items take 1 cell, merging 2 equal items makes a bigger next level ======================= */
      // [w, h] in cells for level 1, 2, 3 (sword 1 → 2 → 3 cells, shield 1 → 4 → 6 …)
      const SHAPE = { sword: [[1, 1], [1, 2], [1, 3]], shield: [[1, 1], [2, 2], [2, 3]], potion: [[1, 1], [1, 1], [1, 2]], bow: [[1, 1], [1, 2], [1, 3]],
        helmet: [[1, 1], [2, 1], [2, 2]], gem: [[1, 1], [1, 1], [2, 1]], boot: [[1, 1], [1, 2], [2, 2]], coin: [[1, 1], [1, 1], [1, 1]], heart: [[1, 1], [1, 1], [2, 1]], bolt: [[1, 1], [1, 2], [1, 3]] };
      const shp = it => (SHAPE[it.type] || SHAPE.coin)[clamp(it.lvl, 1, 3) - 1];
      function inv_state (tt) {
        // the bag at time tt: the starting items, then every recorded move / merge / throw / grow up to tt
        const I = S().inv; const st = { cols: I.cols, rows: I.rows, items: I.items.map(q => ({ ...q })), last: null };
        for (const a of I.acts) { if (a.t > tt) break; if (apply(st, a)) st.last = a; }
        return st;
      }
      const fits = (st, it, c0, r0, skip) => { const [w, h] = shp(it); if (c0 < 0 || r0 < 0 || c0 + w > st.cols || r0 + h > st.rows) return false; return !st.items.some(q => !skip.includes(q.id) && q.c < c0 + w && q.c + shp(q)[0] > c0 && q.r < r0 + h && q.r + shp(q)[1] > r0); };
      function first_fit (st, it, skip, pref) { if (pref && fits(st, it, pref[0], pref[1], skip)) return pref; for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) if (fits(st, it, c, r, skip)) return [c, r]; return null; }
      function apply (st, a) {
        const it = st.items.find(q => q.id === a.id);
        if (a.kind === 'grow') { if (a.dir === 'col') st.cols++; else st.rows++; return true; }
        if (a.kind === 'add') { const n = { id: a.id, type: a.type, lvl: a.lvl || 1, c: 0, r: 0 }; const p = first_fit(st, n, [], [a.c, a.r]); if (!p) return false; n.c = p[0]; n.r = p[1]; st.items.push(n); return true; }
        if (!it) return false;
        if (a.kind === 'drop') { st.items = st.items.filter(q => q !== it); a._it = { ...it }; return true; }
        if (a.kind === 'move') { if (!fits(st, it, a.c, a.r, [it.id])) return false; a._from = [it.c, it.r]; it.c = a.c; it.r = a.r; return true; }
        if (a.kind === 'merge') {
          const o = st.items.find(q => q.id === a.into); if (!o || o.type !== it.type || o.lvl !== it.lvl || it.lvl >= 3) return false;
          const n = { id: a.nid, type: it.type, lvl: it.lvl + 1, c: o.c, r: o.r };
          const p = first_fit(st, n, [it.id, o.id], [o.c, o.r]); if (!p) return false;
          a._from = [it.c, it.r]; st.items = st.items.filter(q => q !== it && q !== o); n.c = p[0]; n.r = p[1]; st.items.push(n); return true;
        }
        return false;
      }
      function inv_geom (st) {
        const I = S().inv, u = U(), cs = I.cell * u, gp = I.gap * u, th = 110 * u, pad = 30 * u;
        const gw = st.cols * cs + (st.cols - 1) * gp, gh = st.rows * cs + (st.rows - 1) * gp, pw = gw + pad * 2, ph = gh + pad * 2 + th;
        const px = I.x * W() - pw / 2, py = I.y * H() - ph / 2;
        return { u, cs, gp, th, pad, pw, ph, px, py, gx: px + pad, gy: py + th + pad * 0.6, cell: (c, r) => [px + pad + c * (cs + gp), py + th + pad * 0.6 + r * (cs + gp)] };
      }
      function paint_item (c, it, X, Y, G, al, flash) {
        const [w, h] = shp(it), bw = w * G.cs + (w - 1) * G.gp, bh = h * G.cs + (h - 1) * G.gp, col = LVLC[it.lvl] || LVLC[1];
        c.save(); c.globalAlpha = al;
        if (flash > 0) { c.shadowColor = col; c.shadowBlur = 50 * G.u * flash; }
        rr(c, X + 3 * G.u, Y + 3 * G.u, bw - 6 * G.u, bh - 6 * G.u, 16 * G.u); const g = c.createLinearGradient(0, Y, 0, Y + bh); g.addColorStop(0, col + '55'); g.addColorStop(1, col + '22'); c.fillStyle = g; c.fill();
        c.shadowBlur = 0; c.lineWidth = 4 * G.u; c.strokeStyle = col; c.stroke();
        const img = api.IMG['inv_' + it.type];
        const sz = Math.min(bw, bh) * 0.86;
        if (img) c.drawImage(img, X + bw / 2 - sz / 2, Y + bh / 2 - sz / 2, sz, sz);
        else { c.save(); c.translate(X + bw / 2, Y + bh / 2); if (h > w && it.type !== 'shield') { c.scale(1, bh / bw * 0.75); } icon(c, it.type, 0, 0, sz * (h > w ? 0.9 : 1), col); c.restore(); }
        c.font = `900 ${Math.round(26 * G.u)}px system-ui,sans-serif`; c.textAlign = 'left'; c.textBaseline = 'top'; c.lineWidth = 5 * G.u; c.strokeStyle = '#000'; c.strokeText('Lv' + it.lvl, X + 10 * G.u, Y + 8 * G.u); c.fillStyle = col; c.fillText('Lv' + it.lvl, X + 10 * G.u, Y + 8 * G.u);
        c.restore();
      }
      let idrag = null; // the item being dragged in the editor: {it, X, Y, ox, oy}
      const inv = {
        label: () => '🎒 ' + T('Kho đồ', 'Inventory', '인벤토리'), fname: 'inventory_',
        len: () => { const A = S().inv.acts; return +Math.max(3, A.length ? A[A.length - 1].t + 1.2 : 0).toFixed(2); },
        marks: () => S().inv.acts.map(a => [a.t, a.kind === 'merge' ? '#ffd34d' : a.kind === 'drop' ? '#ff5d5d' : a.kind === 'grow' ? '#5dff8a' : '#4da6ff', a.kind]),
        paint (c, tt) {
          const I = S().inv, st = inv_state(tt), G = inv_geom(st), u = G.u;
          // panel (or the user's frame picture)
          const fimg = api.IMG.invFrame;
          if (fimg) c.drawImage(fimg, G.px, G.py, G.pw, G.ph);
          else {
            c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 40 * u; rr(c, G.px, G.py, G.pw, G.ph, 36 * u); c.fillStyle = I.panel; c.fill(); c.restore();
            rr(c, G.px, G.py, G.pw, G.ph, 36 * u); c.lineWidth = 7 * u; c.strokeStyle = I.edge; c.stroke();
          }
          c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `900 ${Math.round(56 * u)}px system-ui,sans-serif`; c.lineWidth = 9 * u; c.strokeStyle = '#000';
          c.strokeText(I.title, G.px + G.pw / 2, G.py + G.th * 0.55); c.fillStyle = '#fff'; c.fillText(I.title, G.px + G.pw / 2, G.py + G.th * 0.55);
          // the grow animation: new cells pop
          const la = st.last, age = la && api.anim() ? tt - la.t : 9; // editing (timeline stopped): show the result at once; playing / exporting: animate
          for (let r = 0; r < st.rows; r++) for (let cc = 0; cc < st.cols; cc++) {
            const [X, Y] = G.cell(cc, r); let s = 1;
            if (la && la.kind === 'grow' && age < 0.4 && ((la.dir === 'col' && cc === st.cols - 1) || (la.dir !== 'col' && r === st.rows - 1))) s = back(age / 0.4);
            c.save(); c.translate(X + G.cs / 2, Y + G.cs / 2); c.scale(s, s); rr(c, -G.cs / 2, -G.cs / 2, G.cs, G.cs, 14 * u); c.fillStyle = I.slot; c.fill(); c.lineWidth = 2 * u; c.strokeStyle = 'rgba(255,255,255,.08)'; c.stroke(); c.restore();
          }
          // items; the item of the latest move / merge flies from where it was (the pointer carries it)
          const fly = la && (la.kind === 'move' || la.kind === 'merge') && age < 0.45 ? la : null;
          for (const it of st.items) {
            if (idrag && idrag.it.id === it.id) continue;
            let [X, Y] = G.cell(it.c, it.r); let flash = 0, al = 1;
            if (fly && (it.id === fly.id || it.id === fly.nid) && fly._from) { const k = eo(age / 0.3), [fx, fy] = G.cell(fly._from[0], fly._from[1]); if (fly.kind === 'move') { X = lerp(fx, X, k); Y = lerp(fy, Y, k); } else { flash = 1 - clamp(age / 0.45, 0, 1); } }
            if (la && la.kind === 'add' && it.id === la.id && age < 0.35) al = clamp(age / 0.35, 0, 1);
            if (fly && fly.kind === 'merge' && it.id === fly.nid && age < 0.25) { const k = back(age / 0.25); c.save(); const [w, h] = shp(it), bw = w * G.cs, bh = h * G.cs; c.translate(X + bw / 2, Y + bh / 2); c.scale(k, k); c.translate(-X - bw / 2, -Y - bh / 2); paint_item(c, it, X, Y, G, al, 1); c.restore(); continue; }
            paint_item(c, it, X, Y, G, al, flash);
          }
          // a thrown-away item falls off and fades
          if (la && la.kind === 'drop' && age < 0.8 && la._it) { const [X, Y] = G.cell(la._it.c, la._it.r); const k = age / 0.8; c.save(); c.translate(X + G.cs / 2 + k * 160 * u, Y + G.cs / 2 + k * k * 900 * u); c.rotate(k * 3); c.translate(-G.cs / 2, -G.cs / 2); paint_item(c, la._it, 0, 0, G, 1 - k, 0); c.restore(); }
          if (idrag) paint_item(c, idrag.it, idrag.X - idrag.ox, idrag.Y - idrag.oy, G, 0.92, 0.6);
          // the pointer in the video: it carries the item for each recorded move / merge / throw
          if (I.pointer && !idrag) {
            const A = I.acts.filter(a => a.kind !== 'grow' && a.kind !== 'add'); const nx = A.find(a => a.t >= tt - 0.3 && a.t - tt < 0.7);
            if (nx) {
              const pre = inv_state(nx.t - 1e-3), src = pre.items.find(q => q.id === nx.id); if (src) {
                const [sx, sy] = G.cell(src.c, src.r); let tx, ty; if (nx.kind === 'move') [tx, ty] = G.cell(nx.c, nx.r); else if (nx.kind === 'merge') { const o = pre.items.find(q => q.id === nx.into); [tx, ty] = o ? G.cell(o.c, o.r) : [sx, sy]; } else { tx = G.px + G.pw + 80 * u; ty = sy; }
                const k = eio((tt - (nx.t - 0.6)) / 0.6); const X = lerp(sx, tx, k) + G.cs * 0.55, Y = lerp(sy, ty, k) + G.cs * 0.55;
                if (tt < nx.t && k > 0) { paint_item(c, src, X - G.cs * 0.55, Y - G.cs * 0.55, G, 0.85, 0.4); }
                if (tt < nx.t + 0.3) pointer(c, X, Y, 80 * u, tt > nx.t - 0.62 && tt < nx.t);
              }
            }
          }
        },
        side () {
          const I = S().inv;
          const kinds = Object.keys(SHAPE);
          return `<section><h3><b>2</b>🎒 ${T('Kho đồ: gộp vật phẩm', 'Inventory: merge items', '인벤토리: 합성')}</h3>
            <div class="sm">${T('Kéo 1 vật phẩm thả lên vật phẩm GIỐNG HỆT (cùng loại, cùng cấp) = gộp lên cấp sau, chiếm nhiều ô hơn (kiếm Lv2 = 2 ô, Lv3 = 3 ô; khiên Lv2 = 4 ô, Lv3 = 6 ô). Kéo ra ngoài khung = vứt đi. Mỗi thao tác được ghi ở giây đang xem trên timeline để xuất video.', 'Drag an item onto an IDENTICAL one (same kind, same level) = merge into the next level, which takes more cells (sword Lv2 = 2 cells, Lv3 = 3; shield Lv2 = 4, Lv3 = 6). Drag it out of the bag = throw it away. Each action is recorded at the timeline second you are on, for the video.', '같은 아이템 위로 드래그 = 합성 · 밖으로 = 버리기')}</div>
            <div class="row"><select id="lyKind">${kinds.map(k => `<option>${k}</option>`).join('')}</select><button data-lyx="add">＋ ${T('Thêm vật phẩm Lv1', 'Add a Lv1 item', 'Lv1 추가')}</button></div>
            <div class="row"><button data-lyx="grow:row">⬇ ${T('Nâng cấp: +1 hàng', 'Upgrade: +1 row', '+1 행')}</button><button data-lyx="grow:col">➡ ${T('+1 cột', '+1 column', '+1 열')}</button></div>
            <div class="row"><button data-lyx="clearacts">🗑 ${T('Xoá các thao tác', 'Clear the actions', '동작 삭제')} (${I.acts.length})</button><button data-lyx="fit">⏲ ${T('Vừa khớp', 'Fit length', '길이')} (${inv.len()} s)</button></div>
          </section>
          <section><h3><b>3</b>${T('Khung kho đồ', 'Bag frame', '가방 프레임')}</h3>
            <label><span>${T('Tiêu đề', 'Title', '제목')}</span><input type="text" data-ly="inv.title" value="${esc(I.title)}"></label>
            <label><span>${T('Cột · hàng ban đầu', 'Columns · rows at start', '열 · 행')}</span><input type="number" min="1" max="12" data-ly="inv.cols" value="${I.cols}"><input type="number" min="1" max="12" data-ly="inv.rows" value="${I.rows}"></label>
            <label><span>${T('Cỡ ô · khe', 'Cell · gap', '칸 · 간격')}</span><input type="range" data-ly="inv.cell" min="60" max="220" value="${I.cell}"><input type="range" data-ly="inv.gap" min="0" max="30" value="${I.gap}"></label>
            <label><span>${T('Màu khung · ô · viền', 'Panel · cell · edge', '패널 · 칸 · 테두리')}</span><input type="color" data-ly="inv.panel" value="${I.panel}"><input type="color" data-ly="inv.slot" value="${I.slot}"><input type="color" data-ly="inv.edge" value="${I.edge}"></label>
            <div class="row"><button data-skin="inv" class="pri">🎨 ${T('Bộ skin mẫu (Higgsfield)', 'Ready-made skin (Higgsfield)', '기본 스킨')}</button></div>
            <div class="row"><button data-up="invFrame">🖼 ${T('Ảnh khung riêng', 'Own frame picture', '프레임 이미지')}</button>${api.IMG.invFrame ? '<button data-rm="invFrame">✕</button>' : ''}</div>
            <div class="row" style="flex-wrap:wrap">${kinds.map(k => `<button data-up="inv_${k}" title="${T('Ảnh riêng cho', 'Own picture for', '이미지')} ${k}">🖼 ${k}</button>`).join('')}</div>
            <label><input type="checkbox" data-ly="inv.pointer"${I.pointer ? ' checked' : ''}> ${T('Con trỏ cầm vật phẩm trong video', 'Pointer carries the items in the video', '포인터')}</label>
          </section>`;
        },
        act (k) {
          const I = S().inv, t = +api.t().toFixed(2), st = inv_state(t), nid = () => Math.max(0, ...I.items.map(q => q.id), ...I.acts.map(a => Math.max(a.id || 0, a.nid || 0))) + 1;
          if (k === 'add') { const type = (document.getElementById('lyKind') || {}).value || 'sword'; const a = { t, kind: 'add', id: nid(), type, lvl: 1, c: 0, r: 0 }; const p = first_fit(st, { type, lvl: 1 }, []); if (!p) { api.flash(T('Kho đã đầy: nâng cấp thêm hàng / cột.', 'The bag is full: upgrade it with a row / column.', '가방이 가득 참')); return false; } a.c = p[0]; a.r = p[1]; push(a); return true; }
          if (k.startsWith('grow:')) { push({ t, kind: 'grow', dir: k.slice(5) }); return true; }
          if (k === 'clearacts') { I.acts = []; return true; }
          if (k === 'fit') { S().dur = inv.len(); return true; }
          return false;
        },
        down (X, Y) {
          const st = inv_state(api.t()), G = inv_geom(st);
          for (const it of st.items) { const [x0, y0] = G.cell(it.c, it.r), [w, h] = shp(it), bw = w * G.cs + (w - 1) * G.gp, bh = h * G.cs + (h - 1) * G.gp; if (X >= x0 && X <= x0 + bw && Y >= y0 && Y <= y0 + bh) { idrag = { it: { ...it }, X, Y, ox: X - x0, oy: Y - y0 }; api.changed(false); return { inv: 1 }; } }
          if (X > G.px && X < G.px + G.pw && Y > G.py && Y < G.py + G.ph) return { obj: S().inv, ox: S().inv.x, oy: S().inv.y };
          return null;
        },
        move (X, Y, d) { if (d.inv && idrag) { idrag.X = X; idrag.Y = Y; } },
        up () {
          if (!idrag) return; const I = S().inv, t = +api.t().toFixed(2), st = inv_state(t), G = inv_geom(st), it = idrag.it;
          const X = idrag.X - idrag.ox + G.cs / 2, Y = idrag.Y - idrag.oy + G.cs / 2; idrag = null;
          const c0 = Math.floor((X - G.gx) / (G.cs + G.gp)), r0 = Math.floor((Y - G.gy) / (G.cs + G.gp));
          const inside = X > G.px && X < G.px + G.pw && Y > G.py && Y < G.py + G.ph;
          if (!inside) { push({ t, kind: 'drop', id: it.id }); api.changed(true); return; }
          // dropped on an identical item → merge
          const o = st.items.find(q => q.id !== it.id && c0 >= q.c && c0 < q.c + shp(q)[0] && r0 >= q.r && r0 < q.r + shp(q)[1]);
          if (o) {
            if (o.type === it.type && o.lvl === it.lvl && it.lvl < 3) {
              const a = { t, kind: 'merge', id: it.id, into: o.id, nid: Math.max(0, ...I.items.map(q => q.id), ...I.acts.map(q => Math.max(q.id || 0, q.nid || 0))) + 1 };
              const test = inv_state(t); if (!apply(test, { ...a })) { api.flash(T('Không đủ chỗ cho vật phẩm cấp sau: nâng cấp kho trước.', 'No room for the next level: upgrade the bag first.', '공간 부족')); api.changed(false); return; }
              push(a); api.changed(true); return;
            }
            api.flash(it.lvl >= 3 ? T('Đã cấp tối đa (Lv3).', 'Already max level (Lv3).', '최대 레벨') : T('Chỉ gộp được 2 vật phẩm cùng loại, cùng cấp.', 'Only two items of the same kind and level merge.', '같은 종류·레벨만 합성')); api.changed(false); return;
          }
          if (fits(st, it, c0, r0, [it.id])) { push({ t, kind: 'move', id: it.id, c: c0, r: r0 }); api.changed(true); return; }
          api.changed(false);
        },
        key () { return false; },
        state: tt => inv_state(tt), shape: it => shp(it), // for tests (dev/qc)
        hint: () => T('Kéo vật phẩm lên vật phẩm giống = gộp · kéo ra ngoài = vứt · kéo khung = dời', 'Drag onto an identical item = merge · drag out = throw away · drag the bag = move', '드래그 합성 · 밖으로 버리기')
      };
      function push (a) { const I = S().inv; I.acts.push(a); I.acts.sort((p, q) => p.t - q.t); I.acts.forEach(q => { delete q._from; delete q._it; }); }

      return { up, map, inv };
    }
  };
})();
