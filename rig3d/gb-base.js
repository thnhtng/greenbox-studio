/* Greenbox: a 3D tab that is open in the cockpit but not on screen keeps its work, but should not keep drawing
   60 frames a second (several hidden WebGL tabs = a laggy computer). While the tab's frame is hidden, animation
   frames come 4 times a second instead; the moment the tab is shown again they are back to full speed. */
(function () {
  if (window.self === window.top || !window.requestAnimationFrame) return;
  var raf = window.requestAnimationFrame.bind(window); var caf = window.cancelAnimationFrame.bind(window);
  var OFF = 1e9;
  function hidden () {
    try { var f = window.frameElement; return !!f && (f.hidden || f.getClientRects().length === 0); } catch (e) { return false; }
  }
  window.requestAnimationFrame = function (cb) {
    if (hidden()) return OFF + setTimeout(function () { cb(performance.now()); }, 250);
    return raf(cb);
  };
  window.cancelAnimationFrame = function (id) { if (id >= OFF) clearTimeout(id - OFF); else caf(id); };
})();

/* Greenbox: Mesh2Motion expects to live at the site root (it asks for /rigs/…, ../animations/…, /images/…).
   Inside Greenbox it lives in a sub-folder (…/rig3d/), so every same-origin request for one of its asset
   folders is redirected here before it leaves the page: fetch, XHR, <img>/<video>/<source> src, data-src. */
(function () {
  var m = location.pathname.match(/^(.*\/rig3d\/)/);
  if (!m) return;
  var BASE = m[1];
  var DIRS = /\/(rigs|animations|models-variation|models|images|animpreviews|props|survey|test-files)\/.*$/;
  function fix(u) {
    if (u == null || typeof u !== 'string' && !(u instanceof URL)) return u;
    var s = String(u);
    if (/^(data|blob):/i.test(s)) return u;
    var url;
    try { url = new URL(s, document.baseURI); } catch (e) { return u; }
    if (url.origin !== location.origin) return u;
    var p = url.pathname, rest;
    if (p.indexOf(BASE) === 0) {
      rest = p.slice(BASE.length);
      if (!/^(retarget\/)+/.test(rest)) return u;          // already right
      var r2 = rest.replace(/^(retarget\/)+/, '');
      if (!DIRS.test('/' + r2)) return u;                   // a real retarget/ file
      p = BASE + r2;
    } else {
      var hit = p.match(DIRS);
      if (!hit) return u;
      p = BASE + hit[0].slice(1);
    }
    return url.origin + p + url.search + url.hash;
  }
  window.__gbFixUrl = fix;

  var of = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' || input instanceof URL) input = fix(input);
    else if (input && input.url) { var f = fix(input.url); if (f !== input.url) input = new Request(f, input); }
    return of.call(this, input, init);
  };
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var a = Array.prototype.slice.call(arguments); a[1] = fix(url); return oo.apply(this, a);
  };
  [HTMLImageElement, HTMLVideoElement, HTMLSourceElement].forEach(function (C) {
    var d = Object.getOwnPropertyDescriptor(C.prototype, 'src');
    if (d && d.set) Object.defineProperty(C.prototype, 'src', { configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, fix(v)); } });
  });
  var osa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    if ((n === 'src' || n === 'data-src') && /^(IMG|VIDEO|SOURCE)$/.test(this.nodeName)) v = fix(v);
    return osa.call(this, n, v);
  };
  /* Some Mesh2Motion controls build image markup through innerHTML. Rewrite those URLs before parsing so
     the browser never sends a stray request to the site root (notably for navigation and mirror icons). */
  var dih = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (dih && dih.set) Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true, enumerable: dih.enumerable, get: dih.get,
    set: function (v) {
      if (typeof v === 'string' && v.indexOf('images/') !== -1) {
        v = v.replace(/(["'])(\.{0,2}\/|\/)?images\/[^"'<>\s]+\1/g, function (all, q) {
          return q + fix(all.slice(1, -1)) + q;
        });
      }
      dih.set.call(this, v);
    }
  });
  function scan(el) {
    if (el.nodeType !== 1) return;
    var list = /^(IMG|VIDEO|SOURCE)$/.test(el.nodeName) ? [el] : el.querySelectorAll ? el.querySelectorAll('img,video,source') : [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      ['src', 'data-src'].forEach(function (a) { var v = n.getAttribute(a); if (v) { var f = fix(v); if (f !== v) osa.call(n, a, f); } });
    }
  }
  new MutationObserver(function (ms) { ms.forEach(function (x) { if (x.type === 'attributes') scan(x.target); else x.addedNodes.forEach(scan); }); })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-src'] });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', function () { scan(document.documentElement); });
  else scan(document.documentElement);
})();

/* Greenbox: a "←" back button in the top bar, and (inside the Greenbox cockpit) top-bar links switch tabs
   instead of reloading the page, so work in progress (a model, a running AI job) is still there when you come back. */
(function () {
  var embed = window.self !== window.top;
  var m = location.pathname.match(/^(.*\/rig3d\/)/);
  var ROOT = m ? m[1] : '/';
  /* Mesh2Motion's links are absolute ("/" = Explore, "/create.html"…). Under …/rig3d/ they would leave the 3D
     app: "/" opened the site root, which redirects to the cockpit, so the cockpit opened inside its own 3D tab,
     again and again. Point them into rig3d/. */
  function local(href) {
    if (!href || ROOT === '/' || href.charAt(0) !== '/' || href.charAt(1) === '/') return null;
    if (href.indexOf(ROOT) === 0) return null;
    return ROOT + href.slice(1);
  }
  function fix_links(root) {
    (root || document).querySelectorAll('a[href^="/"]').forEach(function (a) { var h = local(a.getAttribute('href')); if (h) a.setAttribute('href', h); });
  }
  function page(a) {
    try {
      var h = a.getAttribute('href'); var u = new URL(local(h) || h, location.href);
      if (u.origin !== location.origin || u.pathname.indexOf(ROOT) !== 0) return null;
      return u.pathname.slice(ROOT.length) || 'index.html';
    } catch (e) { return null; }
  }
  // links added later (Explore cards, menus) are fixed at click time
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="/"]'); if (!a) return;
    var h = local(a.getAttribute('href')); if (h) a.setAttribute('href', h);
  }, true);
  function setup() {
    fix_links(document)
    var nav = document.querySelector('nav'); if (!nav || document.getElementById('gb-back')) return;
    var back = document.createElement('a');
    back.id = 'gb-back'; back.href = '#'; back.textContent = '←';
    back.setAttribute('aria-label', 'Back');
    back.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:36px;padding:0 10px;font:600 18px/1 system-ui,sans-serif;color:#e6e6e6;text-decoration:none;cursor:pointer';
    back.onclick = function (e) { e.preventDefault(); if (embed) parent.postMessage({ gbNav: 'back' }, '*'); else history.back(); };
    nav.insertBefore(back, nav.firstChild);
    if (embed) nav.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      // our own top-bar buttons (← ⟳ ?) are not page links: let their own click handlers run
      if (!a || a === back || /^gb-/.test(a.id) || a.getAttribute('href') === '#') return;
      var p = page(a); if (!p) return;
      e.preventDefault(); e.stopPropagation();
      parent.postMessage({ gbNav: p }, '*');
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();

/* Greenbox: drag a file anywhere onto the page instead of pressing the upload button
   (create page: while choosing the model; retarget page: the rig upload). Pages that handle drops themselves
   (vehicle, play test, mocap) are left alone. */
(function () {
  var TARGETS = ['#model-upload', '#upload-file'];
  function input () {
    for (var i = 0; i < TARGETS.length; i++) { var el = document.querySelector(TARGETS[i]); if (el) return el; }
    return null;
  }
  function allowed () {
    var e = window.__gb3d; // create page: only on the "load model" step
    return !e || e.process_step === 'load-model';
  }
  var veil = null;
  function show (on) {
    if (!veil) {
      veil = document.createElement('div');
      veil.style.cssText = 'position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(60,220,140,.12);border:3px dashed #3cdc8c;color:#e8fff3;font:700 22px system-ui,sans-serif;pointer-events:none';
      veil.textContent = '⬇ GLB / FBX / OBJ';
      document.body.appendChild(veil);
    }
    veil.style.display = on ? 'flex' : 'none';
  }
  var depth = 0, last = 0, timer = 0;
  // the veil goes away even when a panel takes the drop itself and stops it (capture phase runs first),
  // when the file is dragged out of the window, or when no drag is seen for a moment
  function off () { depth = 0; show(false); clearInterval(timer); timer = 0; }
  addEventListener('dragenter', function (e) { if (!input() || !allowed() || !e.dataTransfer || [].indexOf.call(e.dataTransfer.types, 'Files') < 0) return; depth++; last = Date.now(); show(true); if (!timer) timer = setInterval(function () { if (Date.now() - last > 600) off(); }, 250); });
  addEventListener('dragleave', function (e) { depth = Math.max(0, depth - 1); if (depth === 0 || !e.relatedTarget) off(); });
  addEventListener('dragover', function (e) { last = Date.now(); if (input() && allowed()) e.preventDefault(); });
  addEventListener('drop', off, true); addEventListener('dragend', off, true); addEventListener('blur', off);
  addEventListener('drop', function (e) {
    off();
    var el = input(); if (!el || e.defaultPrevented || !allowed()) return;
    var f = e.dataTransfer && e.dataTransfer.files; if (!f || !f.length) return;
    e.preventDefault();
    try { el.files = f; } catch (x) { var dt = new DataTransfer(); dt.items.add(f[0]); el.files = dt.files; }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
})();

/* Greenbox: ⟳ refresh + ? guided tour in the top bar of every 3D page.
   The tour points at each control in order and says what it does, in the cockpit language. It runs by itself the
   first time a page (or, on "Use Your Model", each step of it) is opened; "?" replays it. */
(function () {
  var embed = window.self !== window.top;
  function lang () { var l = (document.documentElement.lang || 'en').slice(0, 2); return l === 'vi' || l === 'ko' ? l : 'en'; }
  function T (en, vi, ko) { var l = lang(); return l === 'vi' ? vi : l === 'ko' ? ko : en; }
  function page () { var m = location.pathname.match(/rig3d\/(.*)$/); return m ? (m[1] || 'index.html') : ''; }
  var MOUSE = function () { return T('Mouse in the 3D view: <b>right-drag</b> = turn around · <b>middle-drag</b> (or Shift + right-drag) = slide · <b>wheel</b> = zoom. The 4 buttons Front / Side / Top / 3D jump to a view.', 'Chuột trong khung 3D: <b>giữ chuột phải kéo</b> = xoay quanh · <b>giữ chuột giữa</b> (hoặc Shift + chuột phải) = dời khung · <b>lăn chuột</b> = phóng to/thu nhỏ. 4 nút Trước / Ngang / Trên / 3D để nhảy nhanh tới góc nhìn.', '3D 화면 마우스: <b>오른쪽 드래그</b> = 회전 · <b>가운데 드래그</b>(또는 Shift + 오른쪽) = 이동 · <b>휠</b> = 줌. 정면/측면/위/3D 버튼으로 시점 이동.'); };

  // each step: [selector(s) to point at (null = middle of the screen), title, text]
  function steps (key) {
    switch (key) {
      case 'create:load-model': return [
        [null, T('Make a character move', 'Làm nhân vật cử động', '캐릭터 움직이기'), T('4 steps: load the model → pick a skeleton → put the joints on the model → Finish = rig + animations. This guide walks you through each one; press "?" in the top bar to see it again.', '4 bước: nạp model → chọn bộ xương → đặt khớp vào model → Hoàn tất = có xương + animation. Hướng dẫn này chỉ từng chỗ; bấm "?" trên thanh trên cùng để xem lại.', '4단계: 모델 불러오기 → 스켈레톤 선택 → 관절 배치 → 완료 = 리그 + 애니메이션. 상단 "?"로 다시 볼 수 있습니다.')],
        ['label[for="model-upload"], #model-upload', T('1. Your model', '1. Model của bạn', '1. 내 모델'), T('Press here and choose a GLB / FBX / OBJ, or simply drag the file onto the page.', 'Bấm vào đây chọn file GLB / FBX / OBJ, hoặc kéo thả file thẳng vào trang.', 'GLB / FBX / OBJ를 고르거나 파일을 페이지로 끌어다 놓으세요.')],
        ['#model-selection', T('…or a sample', '…hoặc model mẫu', '…또는 샘플'), T('Pick a sample model and press Load to try the tool first.', 'Chọn model mẫu rồi bấm Load để thử trước.', '샘플을 고르고 Load를 누르세요.')]
      ];
      case 'create:load-skeleton': return [
        ['#skeleton-selection', T('2. Skeleton type', '2. Loại bộ xương', '2. 스켈레톤 종류'), T('Human for people (chibi, dwarf, zombie…). Animals: fox, horse, bird, dragon, shark, snake, spider, kaiju. Each comes with its own animations.', 'Human cho người (chibi, lùn, zombie…). Thú: cáo, ngựa, chim, rồng, cá mập, rắn, nhện, kaiju. Mỗi loại có bộ animation riêng.', '사람은 Human (치비, 드워프, 좀비…). 동물: 여우, 말, 새, 용, 상어, 뱀, 거미, 카이주.')],
        ['#hand-skeleton-selection', T('Fingers', 'Ngón tay', '손가락'), T('Fewer finger bones = lighter for hyper-casual. You can also cut bones later in "Bone count".', 'Ít xương ngón = nhẹ hơn cho hyper-casual. Sau này vẫn giảm xương được ở mục "Số lượng xương".', '손가락 뼈가 적을수록 가볍습니다. 나중에 "뼈 개수"에서도 줄일 수 있어요.')],
        ['#load-skeleton-button', T('Next', 'Tiếp', '다음'), T('Puts the skeleton into your model so you can place the joints.', 'Đưa bộ xương vào model để đặt khớp.', '스켈레톤을 모델에 넣어 관절을 배치합니다.')]
      ];
      case 'create:edit-skeleton': return [
        [null, T('3. Joints on the model', '3. Đặt khớp vào model', '3. 관절 배치'), MOUSE()],
        ['#easy-rig-fit', T('One click', 'Một cú bấm', '원클릭'), T('Scans the body and moves every joint to where it should be. Start here, then fix what looks off.', 'Quét thân hình và tự đưa mọi khớp vào đúng chỗ. Bắt đầu từ nút này, chỗ nào lệch thì sửa sau.', '몸을 스캔해 관절을 자동 배치합니다. 먼저 누르고 어긋난 곳만 고치세요.')],
        ['.gb-views', T('Check from every side', 'Kiểm tra mọi phía', '모든 방향 확인'), T('Look from the Side and the Top too: joints must sit in the MIDDLE of the arm / leg, not on its skin.', 'Xem cả góc Ngang và Trên: khớp phải nằm GIỮA tay / chân, không nằm trên da.', '측면과 위에서도 보세요: 관절은 팔/다리 한가운데에 있어야 합니다.')],
        ['#easy-rig-quick', T('Move joints', 'Di chuyển khớp', '관절 이동'), T('Left-drag on empty space draws a box: joints inside turn orange. Drag an orange joint to move the whole group. These buttons select arm / leg / body in one click. Esc = deselect, Ctrl+Z = undo.', 'Giữ chuột trái kéo vào chỗ trống để quét khung: khớp trong khung hoá cam. Kéo 1 khớp cam = kéo cả nhóm. Các nút này chọn nhanh tay / chân / thân. Esc = bỏ chọn, Ctrl+Z = hoàn tác.', '빈 곳을 왼쪽 드래그하면 박스 선택(주황). 주황 관절을 드래그하면 그룹 이동. 이 버튼으로 팔/다리/몸 빠른 선택. Esc 해제, Ctrl+Z 취소.')],
        ['#easy-rig-cage-box', T('Skin (optional)', 'Da (không bắt buộc)', '스킨 (선택)'), T('"Show skin regions" paints the model by the bone that will move each part. If the arm takes chest skin, make the arm thinner under "Body part sizes".', 'Bật "Hiện vùng da" để thấy xương nào kéo phần nào. Nếu tay ăn da ngực, giảm độ dày Bắp tay trong "Kích thước từng bộ phận".', '"스킨 영역 표시"로 어느 뼈가 어디를 움직이는지 봅니다. 팔이 가슴을 끌면 "부위별 크기"에서 팔을 얇게.')],
        ['#easy-rig-bones', T('Fewer bones (optional)', 'Ít xương hơn (không bắt buộc)', '뼈 줄이기 (선택)'), T('For hyper-casual: 1-bone spine, no fingers, no toes… Animations still play: the removed joints\' motion goes to their parent.', 'Cho hyper-casual: sống lưng 1 xương, bỏ ngón tay, ngón chân… Animation vẫn chạy: chuyển động của khớp bị tắt dồn sang khớp cha.', '하이퍼캐주얼용: 척추 1개, 손가락/발가락 없음… 애니메이션은 그대로 재생됩니다.')],
        ['#action_bind_pose', T('4. Finish', '4. Hoàn tất', '4. 완료'), T('Skins the model and loads all animations. You can come back with Back if something looks wrong.', 'Gắn da và nạp toàn bộ animation. Thấy sai thì bấm Quay lại để sửa.', '스킨을 입히고 모든 애니메이션을 불러옵니다. 이상하면 뒤로 가서 수정하세요.')]
      ];
      case 'create:animations-export': return [
        ['#animations-items, #animations-listing', T('Try the animations', 'Thử animation', '애니메이션 미리보기'), T('Click any animation to play it on your character. Torn skin? Go Back and fix the joints or the skin sizes.', 'Bấm animation bất kỳ để xem trên nhân vật. Da bị rách thì Quay lại sửa khớp hoặc độ dày da.', '아무 애니메이션이나 클릭해 재생. 찢어지면 뒤로 가서 수정.')],
        ['#easy-export-glb', T('Save', 'Lưu file', '저장'), T('GLB for Blender / web, FBX for Unity / Unreal. All animations go in one file.', 'GLB cho Blender / web, FBX cho Unity / Unreal. Tất cả animation trong 1 file.', 'GLB는 Blender/웹, FBX는 Unity/Unreal. 모든 애니메이션이 한 파일에.')],
        ['#easy-pose-on, #easy-pose-ui', T('Pose by hand: IK / FK', 'Tạo dáng bằng tay: IK / FK', '직접 포즈: IK / FK'), T('Each arm / leg has an IK / FK switch. <b>FK</b>: click a ring at the shoulder / elbow / wrist and turn it. <b>IK</b>: drag the box at the hand / foot, the elbow / knee follows; the yellow ball says where it points. Switching never moves the limb. The same panel is in Blender: press <b>N</b> → tab <b>Greenbox</b>.', 'Mỗi tay / chân có công tắc IK / FK. <b>FK</b>: bấm vòng ở vai / khuỷu / cổ tay rồi xoay. <b>IK</b>: kéo hộp ở bàn tay / bàn chân, khuỷu / gối tự gập theo; bóng vàng quyết định khuỷu / gối chĩa hướng nào. Đổi chế độ không làm tay chân nhảy. Trong Blender có y hệt bảng này: nhấn <b>N</b> → tab <b>Greenbox</b>.', '팔/다리마다 IK/FK 스위치. <b>FK</b>: 어깨/팔꿈치/손목 링을 클릭해 회전. <b>IK</b>: 손/발 박스를 끌면 팔꿈치/무릎이 따라옴, 노란 공이 방향. 전환해도 자세 유지. Blender에도 같은 패널: <b>N</b> → <b>Greenbox</b> 탭.')],
        ['#easy-rigify-open, #easy-rigify-kit', T('Blender Rigify (no Blender skills needed)', 'Blender Rigify (không cần biết Blender)', 'Blender Rigify (Blender 몰라도 됨)'), T('Downloads 2 files. In Blender: 1) top bar → <b>Scripting</b> tab, 2) in the middle panel press <b>Open</b> and pick <b>greenbox-rigify.py</b> from Downloads, 3) press <b>▶</b> (Run Script), 4) wait a few seconds: your character stands on a Rigify rig. Click the rig, press <b>Ctrl+Tab</b> (Pose mode), click a control and press <b>R</b> to turn it.', 'Tải về 2 file. Trong Blender: 1) thanh trên cùng → tab <b>Scripting</b>, 2) ở khung giữa bấm <b>Open</b>, chọn <b>greenbox-rigify.py</b> trong Downloads, 3) bấm nút <b>▶</b> (Run Script), 4) đợi vài giây: nhân vật đứng trên rig Rigify. Bấm vào rig, nhấn <b>Ctrl+Tab</b> (Pose mode), bấm 1 tay điều khiển rồi nhấn <b>R</b> để xoay.', '파일 2개 다운로드. Blender: 1) 상단 <b>Scripting</b> 탭, 2) 가운데 <b>Open</b> → <b>greenbox-rigify.py</b>, 3) <b>▶</b>(Run Script), 4) 몇 초 후 Rigify 리그 완성. 리그 클릭 → <b>Ctrl+Tab</b>(포즈 모드) → 컨트롤 클릭 후 <b>R</b>로 회전.')],
        ['#easy-playtest', T('Play it', 'Chơi thử', '플레이'), T('Sends the character to Play test (WASD, jump, attack, climb) or Video mocap.', 'Gửi nhân vật sang Chơi thử (WASD, nhảy, đánh, leo) hoặc Mocap từ video.', '플레이 테스트(WASD, 점프, 공격, 오르기) 또는 영상 모캡으로 보냅니다.')]
      ];
      case 'vehicle.html': return [
        [null, T('Rig a vehicle', 'Gắn xương cho xe', '차량 리깅'), T('Load → check the arrow → wheels → parts (doors, turret, crane…) → Build → export. ', 'Nạp xe → kiểm tra mũi tên → bánh → bộ phận (cửa, tháp pháo, cần cẩu…) → Gắn xương → xuất file. ', '불러오기 → 화살표 확인 → 바퀴 → 부품 → 리그 생성 → 내보내기. ') + MOUSE()],
        ['#vh-upload', T('1. Load', '1. Nạp xe', '1. 불러오기'), T('GLB / FBX, or drop the file on the page. Ground, lamps and other scenery in the file are left out automatically.', 'GLB / FBX, hoặc kéo thả vào trang. Mặt đất, cột đèn… trong file tự được bỏ ra.', 'GLB / FBX 또는 끌어다 놓기. 바닥, 가로등 등은 자동 제외.')],
        ['#vh-rotate', T('The green arrow = the front', 'Mũi tên xanh = đầu xe', '초록 화살표 = 앞쪽'), T('If the arrow points to the back, press "Front / back". Turn 90° if the vehicle lies sideways.', 'Nếu mũi tên chỉ về đuôi xe, bấm "Đổi đầu / đuôi". Xe nằm ngang thì bấm "Xoay 90°".', '화살표가 뒤를 가리키면 "앞/뒤"를, 옆으로 누우면 "90° 회전"을 누르세요.')],
        ['#vh-type', T('Vehicle type', 'Loại xe', '차량 종류'), T('Decides the animation set: a road roller crawls and vibrates, a bulldozer turns on the spot, only cars drift.', 'Quyết định bộ animation: xe lu bò chậm và rung, xe ủi quay tại chỗ, chỉ xe hơi mới drift.', '애니메이션 세트를 결정: 롤러는 느리게 진동, 불도저는 제자리 회전, 자동차만 드리프트.')],
        ['#vh-scan', T('2. Wheels', '2. Bánh xe', '2. 바퀴'), T('Finds the wheels and rolls them as a preview. Coloured ring = one wheel. A yellow area = skin that would tear: fix it with the tools below.', 'Tìm bánh và cho bánh lăn thử. Mỗi vòng màu = 1 bánh. Vùng vàng = chỗ sẽ rách: sửa bằng công cụ bên dưới.', '바퀴를 찾아 굴려 보여줍니다. 색 링 = 바퀴 하나. 노란 곳 = 찢어질 부분.')],
        ['#vh-presets-box', T('3. Moving parts', '3. Bộ phận chuyển động', '3. 움직이는 부품'), T('Pick a ready-made part (door, turret, digger arm, propeller…). Then select its area on the model with a tool below.', 'Chọn 1 khung có sẵn (cửa, tháp pháo, tay máy xúc, chân vịt…). Rồi chọn vùng của nó trên model bằng công cụ bên dưới.', '기본 부품(문, 포탑, 굴착기 암, 프로펠러…)을 고른 뒤 아래 도구로 영역을 선택.')],
        ['.tools', T('Selecting', 'Cách chọn vùng', '선택 도구'), T('<b>Piece</b>: click a separate piece. <b>Box</b>: drag a rectangle. <b>Lasso</b>: draw around it. <b>Pen</b>: click corners, click the first point to close. ＋ adds to the part, － gives it back to the body. Esc = stop the tool.', '<b>Mảnh</b>: bấm 1 miếng rời. <b>Khung</b>: kéo hình chữ nhật. <b>Lasso</b>: khoanh tay. <b>Pen</b>: bấm từng góc, bấm lại điểm đầu để đóng. ＋ thêm vào bộ phận, － trả về thân xe. Esc = tắt công cụ.', '<b>조각</b>: 클릭. <b>박스</b>: 사각형 드래그. <b>올가미</b>: 둘러 그리기. <b>펜</b>: 꼭짓점 클릭, 첫 점 클릭으로 닫기. ＋ 추가, － 차체로. Esc 종료.')],
        ['#vh-build', T('4. Build', '4. Gắn xương', '4. 리그 생성'), T('Makes the bones and all animations. Click a name to preview, then export GLB / FBX.', 'Tạo xương và toàn bộ animation. Bấm tên animation để xem, rồi xuất GLB / FBX.', '뼈와 애니메이션 생성. 이름 클릭으로 미리보기 후 GLB/FBX 내보내기.')]
      ];
      case 'playtest.html': return [
        [null, T('Welcome to Play test', 'Chào mừng tới Chơi thử', '플레이 테스트에 오신 것을 환영합니다'), T('Try your character in a 3D map, build the level, then record footage or export it. The panel on the right goes top to bottom: <b>1 Character → 2 Controls → 3 Map → Map editor → 4 Camera & record</b>. This guide shows every tool; <b>Next</b> / <b>Back</b> to move, <b>Esc</b> to close, the round <b>?</b> in the top bar to see it again.', 'Thử nhân vật trong map 3D, dựng màn chơi, rồi quay footage hoặc xuất file. Bảng bên phải đi từ trên xuống: <b>1 Nhân vật → 2 Điều khiển → 3 Map → Trình sửa map → 4 Camera & quay</b>. Hướng dẫn này giới thiệu từng công cụ; bấm <b>Tiếp</b> / <b>Trước</b> để chuyển, <b>Esc</b> để đóng, nút tròn <b>?</b> trên thanh trên cùng để xem lại.', '3D 맵에서 캐릭터를 테스트하고 레벨을 만든 뒤 녹화하거나 내보냅니다. 오른쪽 패널: 1 캐릭터 → 2 조작 → 3 맵 → 맵 편집기 → 4 카메라 & 녹화. Esc = 닫기, ? = 다시 보기.')],
        ['#pt-load', T('1. Player', '1. Nhân vật chơi', '1. 플레이어'), T('Load a rigged character (GLB / FBX with animations), an animal, or a vehicle rigged in Vehicles. You can also press "Play test" after rigging in Use Your Model. A file without animations becomes a simple pawn.', 'Nạp nhân vật đã gắn xương (GLB / FBX có animation), thú, hoặc xe đã rig ở tab Xe cộ. Cũng có thể bấm "Chơi thử" sau khi gắn xương ở tab Dùng model của bạn. File không có animation sẽ thành một hình nộm đơn giản.', '리깅된 캐릭터(애니메이션 포함 GLB/FBX), 동물, 또는 차량을 불러옵니다.')],
        ['#pt-size', T('📏 Size', '📏 Kích thước', '📏 크기'), T('Make the character bigger or smaller (0.1× – 5×, 1× = a 1.8 m person). Feet stay on the ground; speed, jump, climbing and the camera follow the size. Keys <b>[</b> and <b>]</b>, double click = 1×.', 'Cho nhân vật to / nhỏ (0.1× – 5×, 1× = người cao 1.8 m). Chân vẫn chạm đất; tốc độ, nhảy, leo và camera tự theo kích thước. Phím <b>[</b> và <b>]</b>, bấm đúp = 1×.', '캐릭터 크기 (0.1×–5×). [ ] 키, 더블 클릭 = 1×.')],
        ['#pt-ground-lock', T('Fix the look', 'Chỉnh dáng', '보정'), T('<b>Show mesh</b> (W): see the wireframe. <b>Feet on ground</b>: keeps the lowest foot on the floor in every animation. <b>Face +90°</b>: if W walks an animal sideways or backwards, turn it until W goes forward.', '<b>Hiện lưới</b> (W): xem khung dây. <b>Chân chạm đất</b>: giữ bàn chân thấp nhất trên sàn ở mọi animation. <b>Xoay +90°</b>: nếu W làm con thú đi ngang / đi lùi, bấm tới khi W đi thẳng.', '메시 보기, 발 고정, 방향 +90°.')],
        ['[data-scheme]', T('2. Controls', '2. Điều khiển', '2. 조작'), T('<b>PC</b>: WASD move · Shift sprint · Space jump · Shift+Space roll · left click attack · hold right click block · C crouch · Q/E turn the camera · wheel zoom. <b>Mobile</b>: click the ground to run there, buttons for attack / jump / roll / block. Push into a low wall (or jump) to climb it.', '<b>PC</b>: WASD đi · Shift chạy nhanh · Space nhảy · Shift+Space lộn · chuột trái đánh · giữ chuột phải đỡ · C ngồi · Q/E xoay camera · lăn chuột zoom. <b>Mobile</b>: bấm xuống đất để chạy tới, có nút đánh / nhảy / lộn / đỡ. Đẩy vào tường thấp (hoặc nhảy) để leo lên.', 'PC: WASD + 마우스. 모바일: 땅 클릭으로 이동.')],
        ['#pt-undo', T('Undo / Redo', 'Hoàn tác / Làm lại', '실행 취소 / 다시 실행'), T('Every change to the map can be taken back: Ctrl+Z (Cmd+Z) and Ctrl+Shift+Z.', 'Mọi thay đổi trên map đều lấy lại được: Ctrl+Z (Cmd+Z) và Ctrl+Shift+Z.', 'Ctrl+Z / Ctrl+Shift+Z.')],
        ['#pt-add-prop', T('3. Your own props', '3. Thả vật của bạn', '3. 내 소품'), T('Drop a mountain, a house, a bridge… (GLB / FBX / OBJ), or a plain <b>Box</b>. The character walks on them, bumps into walls and climbs ledges up to ~2.5 m.', 'Thả núi, nhà, cầu… (GLB / FBX / OBJ), hoặc một <b>Khối hộp</b>. Nhân vật đi lên được, va vào tường và leo gờ cao tới ~2.5 m.', '산, 집, 다리 등을 넣거나 박스를 추가합니다.')],
        ['#pt-edit', T('Edit map', 'Sửa map', '맵 편집'), T('Click an object, then drag the arrows (move, G), rings (turn, R) or boxes (scale, S). <b>📏 Size</b> scales it evenly, Shift+D copies, Delete removes, Z turns 15°. Esc = back to playing.', 'Bấm vào một vật rồi kéo mũi tên (di chuyển, G), vòng tròn (xoay, R) hoặc ô vuông (co giãn, S). <b>📏 Kích thước</b> phóng to / thu nhỏ đều, Shift+D nhân bản, Delete xoá, Z xoay 15°. Esc = chơi tiếp.', '오브젝트 클릭 후 화살표/링/박스 드래그. Esc = 플레이.')],
        ['[data-k="preset"]', T('Map editor: a new map', 'Trình sửa map: map mới', '맵 편집기: 새 맵'), T('Start from a preset (flat, hills, island, valley, mountains) and set the map size. The map is saved by itself in this browser.', 'Bắt đầu từ map mẫu (phẳng, đồi, đảo, thung lũng, núi) và chọn cỡ map. Map tự lưu trong trình duyệt này.', '프리셋과 맵 크기를 고릅니다. 자동 저장됩니다.')],
        ['[data-mt="select"]', T('Play / Select / Eraser', 'Chơi / Chọn / Tẩy', '플레이 / 선택 / 지우개'), T('<b>Play</b>: no tool, the mouse plays. <b>Select / move</b>: click any object for its handles. <b>Eraser</b>: drag over objects to remove them (click poured water to drain it).', '<b>Chơi</b>: tắt công cụ, chuột dùng để chơi. <b>Chọn / di chuyển</b>: bấm vật để hiện tay cầm. <b>Tẩy</b>: kéo qua vật để xoá (bấm vào nước đã đổ để rút nước).', '플레이 / 선택 / 지우개.')],
        ['[data-mt="raise"]', T('Shape the ground', 'Nặn địa hình', '지형 만들기'), T('<b>Raise</b>, <b>Lower</b>, <b>Flatten</b>, <b>Smooth</b>: drag on the ground. The brush size and strength sliders are just below.', '<b>Nâng</b>, <b>Hạ</b>, <b>San phẳng</b>, <b>Làm mịn</b>: kéo trên mặt đất. Thanh cỡ cọ và độ mạnh nằm ngay bên dưới.', '올리기/내리기/평탄화/부드럽게: 드래그.')],
        ['[data-mt="paint"]', T('Paint the ground', 'Tô màu đất', '지면 칠하기'), T('Pick a colour square (grass, dirt, sand, rock, snow, road…) and drag to paint.', 'Chọn một ô màu (cỏ, đất, cát, đá, tuyết, đường…) rồi kéo để tô.', '색을 고르고 드래그해서 칠합니다.')],
        ['[data-mt="dig"]', T('Holes, rivers and water', 'Hố, sông và nước', '구덩이, 강, 물'), T('<b>Dig</b> carves a flat-bottomed hole (drag = a channel / river bed). <b>Pour water</b>: click inside it to fill it to the rim. The sea level slider sets the water around the map.', '<b>Khoét</b> đào hố đáy phẳng (kéo = rãnh / lòng sông). <b>Đổ nước</b>: bấm vào trong hố để đổ đầy tới miệng. Thanh mực nước biển chỉnh nước bao quanh map.', '파기: 구덩이/수로. 물 붓기: 클릭.')],
        ['[data-objs]', T('Objects', 'Vật thể', '오브젝트'), T('Pick one, then click the ground to place it (as many as you like). Trees and rocks get a random turn and size; houses, walls and fences snap to the grid. Z / X turn it before placing (Alt = 90°).', 'Chọn một vật rồi bấm xuống đất để đặt (bao nhiêu cái cũng được). Cây, đá tự xoay / đổi cỡ ngẫu nhiên; nhà, tường, rào tự khớp lưới. Z / X xoay trước khi đặt (giữ Alt = 90°).', '선택 후 땅을 클릭해 배치. Z/X 회전.')],
        ['[data-ob="hwall"]', T('Build a house', 'Xây nhà', '집 짓기'), T('<b>House wall</b>: press a grid point and drag a straight run (3 m pieces); start the next run from a corner post. <b>Door</b> / <b>Window</b>: click a wall piece to swap it. <b>Roof</b>: click inside a closed room, it fits the room. Inside the house the roof and the walls in the way turn see-through. <b>Fence</b> works like the wall.', '<b>Tường nhà</b>: nhấn vào điểm lưới rồi kéo thành dãy thẳng (mỗi tấm 3 m); kéo dãy tiếp theo từ cột ở góc. <b>Cửa</b> / <b>Cửa sổ</b>: bấm lên một tấm tường để thay. <b>Mái</b>: bấm vào trong phòng đã khép kín, mái tự khớp. Khi vào trong nhà, mái và tường chắn tầm nhìn tự mờ đi. <b>Hàng rào</b> kéo giống tường.', '벽: 드래그. 문/창문: 벽 클릭. 지붕: 닫힌 방 안 클릭.')],
        ['[data-levels]', T('🏢 Many floors', '🏢 Nhà nhiều tầng', '🏢 여러 층'), T('Quickest: with House wall picked, hover an existing wall: it switches to the floor above, press and drag along it (floor 2, 3, 4…). Or pick the floor you build on (1 – 5, 2.8 m each). On floor 2: drag walls on top of the walls below, put a <b>Floor</b> (click inside the room) and, back on floor 1, <b>Stairs</b> (Z turns them 90°; the hole in the floor is cut by itself). The character walks up the stairs. Floors above the one you build on turn see-through; so do the floors above the character when it is inside.', 'Nhanh nhất: đang chọn Tường nhà, rê chuột lên một bức tường có sẵn là tự lên tầng kế, nhấn và kéo dọc theo nó (tầng 2, 3, 4…). Hoặc chọn tầng đang xây (1 – 5, mỗi tầng 2.8 m). Ở tầng 2: kéo tường lên trên tường tầng dưới, đặt <b>Sàn</b> (bấm vào trong phòng), rồi quay lại tầng 1 đặt <b>Cầu thang</b> (Z xoay 90°; lỗ trên sàn tự khoét). Nhân vật đi bộ lên cầu thang được. Các tầng phía trên tầng đang xây tự mờ đi; khi nhân vật ở trong nhà, các tầng phía trên nó cũng mờ đi.', '짓는 층을 고릅니다(1–5). 2층: 벽, 바닥; 1층: 계단(Z로 90°).')],
        ['[data-x="addfile"]', T('Your 3D files in the palette', 'File 3D của bạn vào bảng vật thể', '내 3D 파일'), T('Add a GLB / FBX / OBJ to the object palette, then click to place copies of it like a tree.', 'Đưa GLB / FBX / OBJ vào bảng vật thể, rồi bấm để đặt nhiều bản như đặt cây.', '팔레트에 추가 후 클릭해 배치.')],
        ['[data-x="save"]', T('Save / Open / Clear', 'Lưu / Mở / Xoá hết', '저장 / 열기 / 지우기'), T('Save the map as a .json file and open it later or on another machine. Clear everything = an empty flat map (Ctrl+Z brings it back).', 'Lưu map thành file .json để mở lại sau hoặc trên máy khác. Xoá hết = map phẳng trống (Ctrl+Z lấy lại).', '.json으로 저장 / 열기.')],
        ['[data-x="glb"]', T('Export', 'Xuất file', '내보내기'), T('<b>GLB</b>: map + camera shots for Unity, Godot, Blender. <b>Blender (.py)</b>: a script that rebuilds the map in Blender (Scripting › Open › Run Script). <b>Unity (.cs)</b>: plays the camera shots in Unity.', '<b>GLB</b>: map + các góc camera cho Unity, Godot, Blender. <b>Blender (.py)</b>: script dựng lại map trong Blender (Scripting › Open › Run Script). <b>Unity (.cs)</b>: chạy các góc camera trong Unity.', 'GLB / Blender / Unity로 내보내기.')],
        ['#pt-mapedit summary', T('A picture becomes a map', 'Ảnh thành map', '그림 → 맵'), T('Open this to load a top-down colour plan (green = grass, blue = water, grey = road…): it builds the terrain and objects for you.', 'Mở mục này để nạp một ảnh vẽ từ trên xuống (xanh lá = cỏ, xanh dương = nước, xám = đường…): map và vật thể được dựng tự động.', '색상 평면도를 불러와 맵을 만듭니다.')],
        ['[data-plan="open"]', T('2D plan → playable', 'Bản vẽ 2D → playable', '2D 플랜 → 플레이어블'), T('Draw shapes, name them and connect them with flow wires, then build a playable 3D level. <b>Playable (.html)</b> saves it as one HTML file (playable ad).', 'Vẽ các hình, đặt tên, nối bằng dây luồng, rồi dựng thành màn chơi 3D. <b>Playable (.html)</b> lưu thành một file HTML (quảng cáo playable).', '도형을 그리고 연결해 플레이어블을 만듭니다.')],
        ['[data-cam]', T('4. Camera', '4. Camera', '4. 카메라'), T('<b>3rd person</b> behind the player, <b>Top-down</b>, or <b>Side</b> (side-scroller). Q / E or right-drag turn it, the wheel zooms.', '<b>Ngôi thứ 3</b> sau lưng nhân vật, <b>Từ trên xuống</b>, hoặc <b>Ngang</b> (kiểu màn cuộn ngang). Q / E hoặc kéo chuột phải để xoay, lăn chuột để zoom.', '3인칭 / 탑다운 / 측면.')],
        ['#pt-follow', T('🎯 Who the camera follows', '🎯 Camera bám theo ai', '🎯 카메라 추적'), T('The player, or another character / model on the map: the camera follows it while you play.', 'Nhân vật chính, hoặc một nhân vật / model khác trên map: camera sẽ bám theo nó khi chơi.', '플레이어 또는 맵의 다른 캐릭터.')],
        ['[data-a="free"]', T('Free camera and shots', 'Camera tự do và các shot', '자유 카메라와 샷'), T('Middle-drag = free camera (Shift = slide), F = back to the player. <b>Save this view as a shot</b>, then <b>▶ Play shots</b> for a camera move; a shot can follow an object.', 'Kéo chuột giữa = camera tự do (giữ Shift = dời), F = về lại nhân vật. <b>Lưu góc đang nhìn thành shot</b>, rồi <b>▶ Chạy các shot</b> để có chuyển động camera; shot có thể bám theo một vật.', '가운데 드래그 = 자유 카메라. 샷 저장 후 재생.')],
        ['#pt-vgiz', T('View panel', 'Bảng góc nhìn', '뷰 패널'), T('Like Blender: click a coloured ball to look along that axis, drag to orbit. Below: zoom, pan, look through your placed cameras, perspective / orthographic.', 'Giống Blender: bấm một bi màu để nhìn theo trục đó, kéo để xoay. Bên dưới: zoom, dời khung, nhìn qua các camera đã đặt, phối cảnh / vuông góc.', 'Blender처럼 축 공을 클릭해 시점 전환.')],
        ['#pt-rec', T('Record footage', 'Quay footage', '녹화'), T('<b>Record</b> saves the view as a video file (MP4 / WEBM) for ads. <b>Record the shots</b> plays your camera shots and records them.', '<b>Quay</b> lưu khung hình thành file video (MP4 / WEBM) làm quảng cáo. <b>Quay các shot</b> chạy các góc camera đã lưu và quay lại.', '화면을 영상으로 녹화합니다.')],
        [null, T('You are ready', 'Bạn đã sẵn sàng', '준비 완료'), T('Quick start: load a character → pick a map preset → place objects or build a house → choose the camera → Record. The status line at the top of the panel always says what the tool you picked does. Press <b>?</b> any time to see this guide again.', 'Bắt đầu nhanh: nạp nhân vật → chọn map mẫu → đặt vật thể hoặc xây nhà → chọn camera → Quay. Dòng trạng thái trên cùng bảng bên phải luôn nói công cụ đang chọn làm gì. Bấm <b>?</b> bất cứ lúc nào để xem lại hướng dẫn.', '캐릭터 → 맵 → 오브젝트/집 → 카메라 → 녹화. ?로 다시 보기.')]
      ];
      case 'mocap.html': return [
        ['#mc-vload', T('1. Video', '1. Video', '1. 영상'), T('One person, whole body in view, camera not moving.', 'Một người, thấy toàn thân, camera đứng yên.', '한 사람, 전신, 고정 카메라.')],
        ['#mc-mannequin', T('2. Character', '2. Nhân vật', '2. 캐릭터'), T('The mannequin, your rigged GLB / FBX, or press "Video mocap" after rigging.', 'Ma-nơ-canh, GLB / FBX đã gắn xương, hoặc bấm "Mocap video" sau khi gắn xương.', '마네킹, 리깅된 GLB/FBX, 또는 리깅 후 "영상 모캡".')],
        ['#mc-run', T('3. Analyse', '3. Phân tích', '3. 분석'), T('Turns the video into an animation, then export it.', 'Biến video thành animation, rồi xuất file.', '영상을 애니메이션으로 바꾼 뒤 내보냅니다.')]
      ];
    }
    return null;
  }

  // a page whose guide grew: a new number shows it once more to people who saw the old one
  var VER = { 'playtest.html': 4 };
  function seen_key (k) { return 'gb.tour.' + k + (VER[k] ? '.v' + VER[k] : ''); }
  function key () {
    var p = page();
    if (p === 'create.html') { var e = window.__gb3d; return 'create:' + (e && e.process_step ? e.process_step : 'load-model'); }
    return p;
  }
  function visible (el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; }
  function find (sel) {
    if (!sel) return null;
    var list = sel.split(',');
    for (var i = 0; i < list.length; i++) { var all = document.querySelectorAll(list[i].trim()); for (var j = 0; j < all.length; j++) if (visible(all[j])) return all[j]; }
    return null;
  }

  var ui = null; var cur = null;
  function close () { if (ui) { ui.remove(); ui = null; } cur = null; removeEventListener('resize', place); }
  function place () {
    if (!cur || !ui) return;
    var st = cur.list[cur.i]; var el = find(st[0]);
    var hole = ui.querySelector('.gbt-hole'); var tip = ui.querySelector('.gbt-tip');
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      var r = el.getBoundingClientRect(); var pad = 6;
      hole.style.cssText = 'position:fixed;left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.58);border:2px solid #3cdc8c;pointer-events:none;transition:all .2s';
      var w = Math.min(340, innerWidth - 24); tip.style.width = w + 'px';
      var left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
      var below = r.bottom + 14 + 190 < innerHeight;
      tip.style.left = left + 'px';
      if (below) { tip.style.top = (r.bottom + 14) + 'px'; tip.style.bottom = ''; } else { tip.style.top = ''; tip.style.bottom = (innerHeight - r.top + 14) + 'px'; }
      // a tall panel on the right: put the bubble to its left instead
      if (r.height > innerHeight * 0.5 || (!below && r.top < 200)) { tip.style.top = Math.max(12, Math.min(r.top, innerHeight - 260)) + 'px'; tip.style.bottom = ''; tip.style.left = Math.max(12, r.left - w - 16) + 'px'; }
    } else {
      hole.style.cssText = 'position:fixed;left:50%;top:50%;width:0;height:0;box-shadow:0 0 0 9999px rgba(0,0,0,.58);pointer-events:none';
      var w2 = Math.min(420, innerWidth - 24); tip.style.width = w2 + 'px';
      tip.style.left = (innerWidth / 2 - w2 / 2) + 'px'; tip.style.top = (innerHeight * 0.3) + 'px'; tip.style.bottom = '';
    }
  }
  function show () {
    var st = cur.list[cur.i];
    ui.querySelector('.gbt-n').textContent = (cur.i + 1) + ' / ' + cur.list.length;
    ui.querySelector('.gbt-h').textContent = st[1];
    ui.querySelector('.gbt-p').innerHTML = st[2];
    ui.querySelector('.gbt-prev').style.visibility = cur.i > 0 ? 'visible' : 'hidden';
    ui.querySelector('.gbt-next').textContent = cur.i < cur.list.length - 1 ? T('Next ›', 'Tiếp ›', '다음 ›') : T('Got it ✓', 'Đã hiểu ✓', '확인 ✓');
    place();
  }
  function run (force) {
    var k = key(); var all = steps(k); if (!all) return false;
    // steps whose control is not on screen are skipped (except the intro / middle-of-screen ones)
    var list = all.filter(function (s) { return !s[0] || find(s[0]); });
    if (!list.length) return false;
    close();
    try { localStorage.setItem(seen_key(k), '1'); } catch (e) { /* private mode */ }
    cur = { list: list, i: 0 };
    ui = document.createElement('div'); ui.id = 'gb-tour';
    ui.innerHTML = '<div class="gbt-hole"></div><div class="gbt-tip" style="box-sizing:border-box;position:fixed;z-index:100001;background:#26292e;color:#e6e6e6;border:1px solid #3cdc8c;border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:13px/1.5 system-ui,sans-serif">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b class="gbt-h" style="font-size:15px"></b><span class="gbt-n" style="margin-left:auto;font-size:11px;color:#9aa3b2"></span></div>' +
      '<div class="gbt-p"></div>' +
      '<div style="display:flex;gap:6px;margin-top:10px"><button class="gbt-skip">' + T('Skip', 'Bỏ qua', '건너뛰기') + '</button><span style="flex:1"></span><button class="gbt-prev">‹ ' + T('Back', 'Trước', '이전') + '</button><button class="gbt-next" style="background:#3cdc8c;color:#0d1f14;border-color:#2aa86a;font-weight:700"></button></div></div>';
    ui.style.cssText = 'position:fixed;inset:0;z-index:100000';
    ui.querySelectorAll('button').forEach(function (b) { b.style.cssText += ';font:inherit;padding:5px 10px;border-radius:6px;border:1px solid #1f2126;background:#3a3f48;color:#e6e6e6;cursor:pointer'; });
    ui.querySelector('.gbt-next').style.cssText += ';background:#3cdc8c;color:#0d1f14;font-weight:700';
    ui.querySelector('.gbt-skip').onclick = close;
    ui.querySelector('.gbt-prev').onclick = function () { if (cur.i > 0) { cur.i--; show(); } };
    ui.querySelector('.gbt-next').onclick = function () { if (cur.i < cur.list.length - 1) { cur.i++; show(); } else close(); };
    ui.addEventListener('click', function (e) { if (e.target === ui) close(); });
    document.body.appendChild(ui);
    addEventListener('resize', place);
    show();
    return true;
  }
  window.__gbTour = run;
  addEventListener('keydown', function (e) { if (ui && e.key === 'Escape') close(); });

  function setup () {
    var nav = document.querySelector('nav'); if (!nav || document.getElementById('gb-help')) return;
    var mk = function (id, txt, title, fn) {
      var a = document.createElement('a'); a.id = id; a.href = '#'; a.textContent = txt; a.title = title;
      a.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:26px;padding:0 4px;font:700 16px/1 system-ui,sans-serif;color:#e6e6e6;text-decoration:none;cursor:pointer';
      a.onclick = function (e) { e.preventDefault(); e.stopPropagation(); fn(); };
      return a;
    };
    var back = document.getElementById('gb-back');
    var after = back ? back.nextSibling : nav.firstChild;
    var refresh = mk('gb-refresh', '⟳', T('Reload this tab (unsaved work here is lost)', 'Tải lại tab này (việc chưa lưu ở tab này sẽ mất)', '이 탭 새로고침 (저장 안 한 작업은 사라짐)'), function () { location.reload(); });
    var help = mk('gb-help', '?', T('Step-by-step guide', 'Hướng dẫn từng bước', '단계별 안내'), function () { if (!run(true)) alert(T('No guide for this screen yet.', 'Màn hình này chưa có hướng dẫn.', '이 화면에는 안내가 없습니다.')); });
    help.style.cssText += ';margin:0 4px;width:24px;height:24px;min-width:24px;padding:0;border-radius:50%;background:#3cdc8c;color:#0d1f14;align-self:center;font-size:14px';
    nav.insertBefore(refresh, after); nav.insertBefore(help, refresh.nextSibling);
    // first visit of a page / of a step on "Use Your Model": run the guide once by itself
    var last = '';
    setInterval(function () {
      var k = key(); if (k === last || ui) return;
      if (!visible(document.querySelector('nav'))) return; // a hidden cockpit tab: wait until it is shown
      last = k;
      var seen = false; try { seen = localStorage.getItem(seen_key(k)) === '1'; } catch (e) { seen = true; }
      if (navigator.webdriver) seen = true // automated tests: never block the page
      if (!seen) setTimeout(function () { if (key() === k && !ui) run(false); }, 900);
    }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  void embed;
})();

/* Greenbox: hide / show the big side panel (tool panel, Explore list, vehicle / play test / mocap settings) with a
   tab on its edge, so the 3D view can use the whole width. Remembered per page. */
(function () {
  function lang () { var l = (document.documentElement.lang || 'en').slice(0, 2); return l; }
  function T (en, vi, ko) { var l = lang(); return l === 'vi' ? vi : l === 'ko' ? ko : en; }
  function setup () {
    var P = document.querySelector('#tool-panel') || document.querySelector('main > aside');
    if (!P || document.getElementById('gb-panel-toggle')) return;
    var main = P.parentElement && P.parentElement.tagName === 'MAIN' ? P.parentElement : null;
    var KEY = 'gb.panel.hidden.' + location.pathname.replace(/^.*rig3d\//, '');
    var b = document.createElement('button'); b.id = 'gb-panel-toggle'; b.type = 'button';
    b.style.cssText = 'position:fixed;top:50%;z-index:60;transform:translateY(-50%);width:20px;height:64px;padding:0;border:1px solid #1f1f1f;border-right:0;border-radius:8px 0 0 8px;background:#4a4a4a;color:#eee;font:700 13px system-ui,sans-serif;cursor:pointer;box-shadow:-2px 0 6px rgba(0,0,0,.35)';
    document.body.appendChild(b);
    var cols = main ? getComputedStyle(main).gridTemplateColumns : '';
    function place () {
      var hidden = P.style.display === 'none';
      b.style.right = hidden ? '0px' : (P.getBoundingClientRect().width || 0) + 'px';
      b.textContent = hidden ? '‹' : '›';
      b.title = hidden ? T('Show the panel', 'Hiện bảng điều khiển', '패널 표시') : T('Hide the panel (more room for the 3D view)', 'Ẩn bảng điều khiển (rộng chỗ cho khung 3D)', '패널 숨기기 (3D 화면 넓게)');
    }
    function set (hide) {
      P.style.display = hide ? 'none' : '';
      if (main) main.style.gridTemplateColumns = hide ? 'minmax(0,1fr)' : '';
      try { localStorage.setItem(KEY, hide ? '1' : '0'); } catch (e) { /* ignore */ }
      place();
      setTimeout(function () { dispatchEvent(new Event('resize')); }, 30); // 3D views re-measure
    }
    b.onclick = function () { set(P.style.display !== 'none'); };
    try { if (localStorage.getItem(KEY) === '1') set(true); } catch (e) { /* ignore */ }
    if (window.ResizeObserver) new ResizeObserver(place).observe(P);
    addEventListener('resize', place); place();
    void cols;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(setup, 300); }); else setTimeout(setup, 300);
})();
