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
  function page(a) {
    try {
      var u = new URL(a.getAttribute('href'), location.href);
      if (u.origin !== location.origin || u.pathname.indexOf(ROOT) !== 0) return null;
      return u.pathname.slice(ROOT.length) || 'create.html';
    } catch (e) { return null; }
  }
  function setup() {
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
  var depth = 0;
  addEventListener('dragenter', function (e) { if (!input() || !allowed() || !e.dataTransfer || [].indexOf.call(e.dataTransfer.types, 'Files') < 0) return; depth++; show(true); });
  addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (depth === 0) show(false); });
  addEventListener('dragover', function (e) { if (input() && allowed()) e.preventDefault(); });
  addEventListener('drop', function (e) {
    depth = 0; show(false);
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
        ['#easy-rigify-kit', T('Blender Rigify (no Blender skills needed)', 'Blender Rigify (không cần biết Blender)', 'Blender Rigify (Blender 몰라도 됨)'), T('Downloads 2 files. In Blender: 1) top bar → <b>Scripting</b> tab, 2) in the middle panel press <b>Open</b> and pick <b>greenbox-rigify.py</b> from Downloads, 3) press <b>▶</b> (Run Script), 4) wait a few seconds: your character stands on a Rigify rig. Click the rig, press <b>Ctrl+Tab</b> (Pose mode), click a control and press <b>R</b> to turn it.', 'Tải về 2 file. Trong Blender: 1) thanh trên cùng → tab <b>Scripting</b>, 2) ở khung giữa bấm <b>Open</b>, chọn <b>greenbox-rigify.py</b> trong Downloads, 3) bấm nút <b>▶</b> (Run Script), 4) đợi vài giây: nhân vật đứng trên rig Rigify. Bấm vào rig, nhấn <b>Ctrl+Tab</b> (Pose mode), bấm 1 tay điều khiển rồi nhấn <b>R</b> để xoay.', '파일 2개 다운로드. Blender: 1) 상단 <b>Scripting</b> 탭, 2) 가운데 <b>Open</b> → <b>greenbox-rigify.py</b>, 3) <b>▶</b>(Run Script), 4) 몇 초 후 Rigify 리그 완성. 리그 클릭 → <b>Ctrl+Tab</b>(포즈 모드) → 컨트롤 클릭 후 <b>R</b>로 회전.')],
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
        ['#pt-load', T('Player', 'Nhân vật chơi', '플레이어'), T('A rigged character, an animal, or a vehicle rigged in Vehicles. Or press "Play test" after rigging.', 'Nhân vật đã gắn xương, thú, hoặc xe đã rig ở tab Xe cộ. Hoặc bấm "Chơi thử" sau khi gắn xương.', '리깅된 캐릭터, 동물, 또는 차량. 리깅 후 "플레이 테스트"도 가능.')],
        ['[data-scheme]', T('Controls', 'Điều khiển', '조작'), T('PC: WASD + mouse. Mobile: click the ground to run there. Push into a low wall (or jump) to climb it.', 'PC: WASD + chuột. Mobile: bấm xuống đất để chạy tới. Đẩy vào tường thấp (hoặc nhảy) để leo lên.', 'PC: WASD + 마우스. 모바일: 땅 클릭으로 이동. 낮은 벽에 밀거나 점프하면 오릅니다.')],
        ['#pt-add-prop', T('Your map', 'Map của bạn', '맵'), T('Drop a mountain, a house… then "Edit map": click it, drag the arrows (move), rings (turn) or boxes (scale). Esc = back to playing.', 'Thả núi, nhà… vào rồi "Sửa map": bấm vào vật, kéo mũi tên (di chuyển), vòng (xoay), ô vuông (phóng to). Esc = chơi tiếp.', '산, 집 등을 넣고 "맵 편집": 클릭 후 화살표(이동), 링(회전), 박스(크기). Esc = 플레이.')],
        ['#pt-rec', T('Footage', 'Quay footage', '녹화'), T('Records the view to a video file for the ad.', 'Quay khung hình thành file video làm quảng cáo.', '화면을 광고용 영상으로 녹화합니다.')]
      ];
      case 'mocap.html': return [
        ['#mc-vload', T('1. Video', '1. Video', '1. 영상'), T('One person, whole body in view, camera not moving.', 'Một người, thấy toàn thân, camera đứng yên.', '한 사람, 전신, 고정 카메라.')],
        ['#mc-mannequin', T('2. Character', '2. Nhân vật', '2. 캐릭터'), T('The mannequin, your rigged GLB / FBX, or press "Video mocap" after rigging.', 'Ma-nơ-canh, GLB / FBX đã gắn xương, hoặc bấm "Mocap video" sau khi gắn xương.', '마네킹, 리깅된 GLB/FBX, 또는 리깅 후 "영상 모캡".')],
        ['#mc-run', T('3. Analyse', '3. Phân tích', '3. 분석'), T('Turns the video into an animation, then export it.', 'Biến video thành animation, rồi xuất file.', '영상을 애니메이션으로 바꾼 뒤 내보냅니다.')]
      ];
    }
    return null;
  }

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
    try { localStorage.setItem('gb.tour.' + k, '1'); } catch (e) { /* private mode */ }
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
      var seen = false; try { seen = localStorage.getItem('gb.tour.' + k) === '1'; } catch (e) { seen = true; }
      if (navigator.webdriver) seen = true // automated tests: never block the page
      if (!seen) setTimeout(function () { if (key() === k && !ui) run(false); }, 900);
    }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  void embed;
})();
