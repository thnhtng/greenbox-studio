/* Cockpit guide: a step-by-step glass tour of the tool (first visit, then the ? button in the top bar).
   Each step points at a control; steps whose control is not on screen are skipped. */
(function () {
  var KEY = 'gb.tour.cockpit.v1';
  function lang () { try { return localStorage.getItem('gbc.lang') || 'vi'; } catch (e) { return 'vi'; } }
  function T (en, vi, ko) { var l = lang(); return l === 'vi' ? vi : l === 'ko' ? (ko || en) : en; }
  function steps () {
    return [
      [null, T('Welcome to Greenbox Studio', 'Chào mừng tới Greenbox Studio', 'Greenbox Studio에 오신 것을 환영합니다'),
        T('One tool for game-ad videos and playables: overlays (joystick, HP bar, gacha…), 3D rigging, vehicles, play tests and maps, SFX. This short tour shows where everything is.', 'Một công cụ cho video quảng cáo game và playable: overlay (joystick, thanh máu, gacha…), gắn xương 3D, xe cộ, chơi thử và dựng map, gắn SFX. Hướng dẫn ngắn này chỉ bạn mọi thứ nằm ở đâu.', '게임 광고 영상과 플레이어블을 위한 하나의 도구입니다.')],
      ['#gbc-dock .gbc-grp', T('1 · Pick a tool', '1 · Chọn công cụ', '1 · 도구 선택'),
        T('Every tool is in this list, grouped by job. Click one to open it on the right.', 'Mọi công cụ nằm trong danh sách này, chia theo nhóm việc. Bấm một mục để mở nó ở bên phải.', '목록에서 도구를 클릭하세요.')],
      ['#gbc-dock .gbc-gt', T('2 · Fold a group', '2 · Gập / mở nhóm', '2 · 그룹 접기'),
        T('Click a group title to fold it away and keep the list short.', 'Bấm tiêu đề nhóm để gập lại cho danh sách gọn.', '그룹 제목을 클릭해 접으세요.')],
      ['#gbc-dock .gbc-it', T('3 · What does it do?', '3 · Mục này làm gì?', '3 · 무엇을 하나요?'),
        T('Rest the mouse on a tool for a moment: a card explains what it does before you open it.', 'Rê chuột lên một mục một chút: thẻ giới thiệu hiện ra, nói rõ công cụ đó làm gì trước khi mở.', '마우스를 올리면 설명이 보입니다.')],
      ['.gbc-crumb', T('4 · Where you are', '4 · Bạn đang ở đâu', '4 · 현재 위치'),
        T('The group and the tool that is open now.', 'Nhóm và công cụ đang mở.', '현재 열린 도구.')],
      ['.gbc-lay', T('5 · Layout', '5 · Bố cục', '5 · 레이아웃'),
        T('Side list (Dock) or a bar across the top (Stack): pick what suits your screen.', 'Danh sách bên trái (Dock) hoặc thanh ngang phía trên (Stack): chọn kiểu hợp màn hình của bạn.', '사이드 또는 상단 막대.')],
      ['#gbc-jump', T('6 · Hyper Jump', '6 · Hyper Jump', '6 · 하이퍼 점프'),
        T('Turns the warp-speed background on / off. Just for looks.', 'Bật / tắt nền bay xuyên không gian. Chỉ để trang trí.', '배경 효과 켜기/끄기.')],
      ['#gbc-theme', T('7 · Theme', '7 · Giao diện', '7 · 테마'),
        T('Switches between the glass theme and the light / dark ones. The 3D pages follow.', 'Đổi giữa giao diện kính và giao diện sáng / tối. Các trang 3D đổi theo.', '테마 전환.')],
      ['.gbc-lang', T('8 · Language', '8 · Ngôn ngữ', '8 · 언어'),
        T('Vietnamese, English or Korean, for every page.', 'Tiếng Việt, tiếng Anh hoặc tiếng Hàn cho mọi trang.', '베트남어 / 영어 / 한국어.')],
      ['#gbai-fab', T('9 · AI assistant', '9 · Trợ lý AI', '9 · AI 도우미'),
        T('Ask the AI to do the clicks for you: paste an API key, or connect Claude / Codex through MCP (the panel shows how).', 'Nhờ AI làm thao tác giúp bạn: dán API key, hoặc kết nối Claude / Codex qua MCP (bảng AI có hướng dẫn).', 'AI가 대신 작업합니다.')],
      ['#appRig iframe, #appJoy .stagecol, #appGacha .stagecol, #appDrive .stagecol, main', T('10 · The work area', '10 · Khu làm việc', '10 · 작업 영역'),
        T('The open tool works here. The 3D pages have their own guide: the <b>?</b> button at the top of the page.', 'Công cụ đang mở hoạt động ở đây. Các trang 3D có hướng dẫn riêng: nút <b>?</b> ở đầu trang.', '3D 페이지에는 자체 가이드(?)가 있습니다.')],
      ['#gbc-tourbtn', T('Done', 'Xong', '완료'),
        T('Open this guide again any time with this button.', 'Muốn xem lại hướng dẫn thì bấm nút này.', '이 버튼으로 다시 볼 수 있습니다.')]
    ];
  }
  function visible (el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  function find (sel) { if (!sel) return null; var list = sel.split(','); for (var i = 0; i < list.length; i++) { var all = document.querySelectorAll(list[i].trim()); for (var j = 0; j < all.length; j++) if (visible(all[j])) return all[j]; } return null; }
  var ui = null, cur = null;
  function close () { if (ui) { ui.remove(); ui = null; } cur = null; removeEventListener('resize', place); }
  function place () {
    if (!cur || !ui) return;
    var st = cur.list[cur.i], el = find(st[0]), hole = ui.querySelector('.gbt-hole'), tip = ui.querySelector('.gbt-tip');
    var w = Math.min(360, innerWidth - 24); tip.style.width = w + 'px';
    if (el) {
      var r = el.getBoundingClientRect(), pad = 6;
      hole.style.cssText = 'left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px';
      var H = tip.offsetHeight || 170, x, y;
      if (r.right + 16 + w < innerWidth && r.height > 120) { x = r.right + 16; y = Math.min(Math.max(12, r.top), innerHeight - H - 12); }
      else if (r.bottom + 14 + H < innerHeight) { x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12); y = r.bottom + 14; }
      else { x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12); y = Math.max(12, r.top - H - 14); }
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    } else {
      hole.style.cssText = 'left:50%;top:50%;width:0;height:0';
      tip.style.left = (innerWidth / 2 - w / 2) + 'px'; tip.style.top = (innerHeight * 0.28) + 'px';
    }
  }
  function show () {
    var st = cur.list[cur.i];
    ui.querySelector('.gbt-n').textContent = (cur.i + 1) + ' / ' + cur.list.length;
    ui.querySelector('.gbt-h').textContent = st[1];
    ui.querySelector('.gbt-p').innerHTML = st[2];
    ui.querySelector('.gbt-bar i').style.width = ((cur.i + 1) / cur.list.length * 100) + '%';
    ui.querySelector('.gbt-prev').style.visibility = cur.i > 0 ? 'visible' : 'hidden';
    ui.querySelector('.gbt-next').textContent = cur.i < cur.list.length - 1 ? T('Next ›', 'Tiếp ›', '다음 ›') : T('Got it ✓', 'Đã hiểu ✓', '확인 ✓');
    var tip = ui.querySelector('.gbt-tip'); tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in');
    place(); setTimeout(place, 30);
  }
  function run () {
    var list = steps().filter(function (s) { return !s[0] || find(s[0]); });
    if (!list.length) return false;
    close();
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* private mode */ }
    cur = { list: list, i: 0 };
    ui = document.createElement('div'); ui.id = 'gbc-tour';
    ui.innerHTML = '<div class="gbt-hole"></div><div class="gbt-tip" role="dialog" aria-live="polite">' +
      '<div class="gbt-top"><b class="gbt-h"></b><span class="gbt-n"></span></div><div class="gbt-bar"><i></i></div><div class="gbt-p"></div>' +
      '<div class="gbt-btns"><button class="gbt-skip">' + T('Skip', 'Bỏ qua', '건너뛰기') + '</button><span></span><button class="gbt-prev">‹ ' + T('Back', 'Trước', '이전') + '</button><button class="gbt-next"></button></div></div>';
    ui.querySelector('.gbt-skip').onclick = close;
    ui.querySelector('.gbt-prev').onclick = function () { if (cur.i > 0) { cur.i--; show(); } };
    ui.querySelector('.gbt-next').onclick = function () { if (cur.i < cur.list.length - 1) { cur.i++; show(); } else close(); };
    ui.addEventListener('click', function (e) { if (e.target === ui) close(); });
    document.body.appendChild(ui); addEventListener('resize', place); show();
    ui.querySelector('.gbt-next').focus();
    return true;
  }
  window.__gbcTour = run;
  addEventListener('keydown', function (e) {
    if (!ui) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') ui.querySelector('.gbt-next').click();
    else if (e.key === 'ArrowLeft' && cur && cur.i > 0) ui.querySelector('.gbt-prev').click();
  });
  var st = document.createElement('style');
  st.textContent = '#gbc-tour{position:fixed;inset:0;z-index:100000}' +
    '#gbc-tour .gbt-hole{position:fixed;border-radius:14px;box-shadow:0 0 0 9999px rgba(2,6,5,.6),0 0 0 2px rgba(95,242,168,.9),0 0 26px 2px rgba(47,233,139,.5);pointer-events:none;transition:all 220ms cubic-bezier(.2,.7,.2,1)}' +
    '#gbc-tour .gbt-tip{position:fixed;box-sizing:border-box;padding:16px 18px 14px;border-radius:18px;color:#eef6f2;font:14px/1.55 inherit;' +
    'background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.03) 40%,rgba(47,233,139,.06)),rgba(12,20,17,.88);-webkit-backdrop-filter:blur(22px) saturate(160%);backdrop-filter:blur(22px) saturate(160%);' +
    'border:1px solid rgba(170,255,214,.24);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 0 34px -12px rgba(47,233,139,.55),0 24px 50px -20px rgba(0,0,0,.85);transition:left 220ms cubic-bezier(.2,.7,.2,1),top 220ms cubic-bezier(.2,.7,.2,1)}' +
    '#gbc-tour .gbt-tip.in{animation:gbt-in 220ms cubic-bezier(0,0,.2,1)}@keyframes gbt-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}' +
    '#gbc-tour .gbt-top{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}#gbc-tour .gbt-h{font-size:16px;letter-spacing:-.01em}#gbc-tour .gbt-n{margin-left:auto;font-size:12px;opacity:.55}' +
    '#gbc-tour .gbt-bar{height:3px;border-radius:3px;background:rgba(255,255,255,.1);margin-bottom:10px;overflow:hidden}#gbc-tour .gbt-bar i{display:block;height:100%;background:#2fe98b;transition:width 220ms}' +
    '#gbc-tour .gbt-p{color:rgba(236,244,240,.85)}#gbc-tour .gbt-btns{display:flex;gap:8px;margin-top:14px;align-items:center}#gbc-tour .gbt-btns span{flex:1}' +
    '#gbc-tour button{font:600 13px/1 inherit;padding:9px 14px;border-radius:12px;cursor:pointer;color:#eef6f2;border:1px solid rgba(255,255,255,.18);background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.04)),rgba(30,34,37,.5)}' +
    '#gbc-tour .gbt-next{color:#03140b;border-color:rgba(255,255,255,.7);background:linear-gradient(180deg,rgba(255,255,255,.6),rgba(255,255,255,.15) 45%,transparent 56%),rgba(47,233,139,.88)}' +
    '#gbc-tour button:focus-visible{outline:2px solid #2fe98b;outline-offset:2px}' +
    '@media (prefers-reduced-motion:reduce){#gbc-tour .gbt-hole,#gbc-tour .gbt-tip{transition:none}#gbc-tour .gbt-tip.in{animation:none}}' +
    '#gbc-tourbtn{width:34px;height:34px;padding:0!important;display:inline-flex;align-items:center;justify-content:center;font-weight:800}';
  document.head.appendChild(st);
  // the ? button in the top bar (next to the theme button); the top bar is re-rendered, so keep it there
  function button () {
    if (document.getElementById('gbc-tourbtn')) return;
    var anchor = document.getElementById('gbc-theme'); if (!anchor) return;
    var b = document.createElement('button'); b.id = 'gbc-tourbtn'; b.type = 'button'; b.className = 'gbc-b'; b.textContent = '?';
    b.title = T('Guide: a short tour of the tool', 'Giới thiệu: hướng dẫn nhanh cách dùng tool', '가이드');
    b.onclick = function () { run(); };
    anchor.parentNode.insertBefore(b, anchor);
  }
  new MutationObserver(button).observe(document.body, { childList: true, subtree: true });
  function start () { button(); var seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch (e) { /* private */ } if (!seen) setTimeout(run, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
