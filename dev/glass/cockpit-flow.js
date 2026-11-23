/* Cockpit workflow: links the tools into pipelines.
   Each tool declares typed ports (what it takes, what it gives). From that one table:
     next(id)  = tools that take something this tool gives      (forward links)
     prev(id)  = tools that give something this tool takes      (back links)
     route(a, b) = shortest chain of tools from a to b          (breadth-first search over the port graph)
   A goal ("playable from a 3D model"…) is a list of tools; every hop is checked against the ports, and a goal
   whose hop does not connect is repaired with route(). The strip at the bottom shows the steps of the goal,
   what to do, what to export, and Back / Next. Without a goal it shows where the open tool can link to. */
(function () {
  var SEEN = 'gb.flow.seen.v1', GOAL = 'gb.flow.goal', STEP = 'gb.flow.step', HIDE = 'gb.flow.hide';
  function ls (k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private */ } return null; }
  function lang () { return ls('gbc.lang') || 'vi'; }
  function T (en, vi, ko) { var l = lang(); return l === 'vi' ? vi : l === 'ko' ? (ko || en) : en; }
  function esc (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---- ports ----
     model: a 3D file without bones · rigged: character with bones + clips · car: vehicle ready to drive
     motion: an animation clip · footage: a gameplay / film video · overlay: alpha .MOV / green MP4 layer
     playable: one-file HTML game · final: video with sound, ready to post */
  var OV = { i: ['footage'], o: ['overlay'] };
  var PORT = {
    rig: { i: ['model', 'motion'], o: ['rigged'] }, clonerig: { i: ['model', 'rigged'], o: ['rigged'] },
    retarget: { i: ['model', 'motion'], o: ['rigged'] }, mocap: { i: [], o: ['motion'] },
    vehicle: { i: ['model'], o: ['car'] }, playtest: { i: ['rigged', 'car'], o: ['playable', 'footage'] },
    smash: { i: [], o: ['playable', 'footage'] }, space: { i: ['rigged', 'car'], o: ['playable'] }, arena: { i: [], o: ['playable', 'footage'] },
    drama: { i: [], o: ['footage'] }, vfx: { i: ['footage'], o: ['footage', 'overlay'] },
    sfx: { i: ['footage', 'overlay'], o: ['final'] },
    joy: OV, evo: OV, stone: OV, money: OV, fuel: OV, hpbar: OV, countdown: OV, flash: OV, wheel: OV,
    gseq: OV, gpick: OV, gbag: OV, gchest: OV, endcard: OV, upgrade: OV, minimap: OV, inventory: OV, gcar: OV
  };
  function all () { return (window.__gbcF && window.__gbcF.all) || []; }
  function feat (id) { return all().find(function (f) { return f.id === id; }); }
  function name (id) { var f = feat(id); return f ? (f.ic ? f.ic + ' ' : '') + window.__gbcF.tr(f.name) : id; }
  function ids () { return all().map(function (f) { return f.id; }).filter(function (id) { return PORT[id]; }); }
  function hit (a, b) { return a.some(function (t) { return b.indexOf(t) >= 0; }); }
  function next (id) { var p = PORT[id]; return p ? ids().filter(function (x) { return x !== id && hit(p.o, PORT[x].i); }) : []; }
  function prev (id) { var p = PORT[id]; return p ? ids().filter(function (x) { return x !== id && hit(PORT[x].o, p.i); }) : []; }
  function route (a, b) {
    if (a === b) return [a];
    var from = {}, q = [a]; from[a] = null;
    while (q.length) {
      var c = q.shift(), n = next(c);
      for (var i = 0; i < n.length; i++) {
        if (n[i] in from) continue; from[n[i]] = c;
        if (n[i] === b) { var out = [b]; while (from[out[0]] !== null) out.unshift(from[out[0]]); return out; }
        q.push(n[i]);
      }
    }
    return null;
  }
  /* a goal's chain, with any hop that does not connect replaced by the shortest route between the two */
  function chain (list) {
    var have = list.filter(function (id) { return PORT[id] && feat(id); }), out = [];
    have.forEach(function (id, i) {
      if (!i) { out.push(id); return; }
      var a = out[out.length - 1];
      if (next(a).indexOf(id) >= 0) out.push(id); else { var r = route(a, id); if (r) out = out.concat(r.slice(1)); else out.push(id); }
    });
    return out;
  }

  /* ---- what to do / what to export in each tool ---- */
  function todo (id) {
    var m = {
      rig: [T('Drop a GLB / FBX model, let Auto place the bones, pick animations.', 'Thả model GLB / FBX vào, để Auto đặt xương, chọn animation.', '모델을 넣고 자동 리깅, 애니메이션 선택.'), T('Send to Play test, or save the rigged GLB.', 'Gửi sang Chơi thử, hoặc lưu GLB đã có xương.', '플레이 테스트로 보내기 또는 GLB 저장.')],
      clonerig: [T('Open the model that has bones, then the new one: the skeleton is copied over.', 'Mở model đã có xương rồi model mới: bộ xương được chép sang.', '뼈대를 복사합니다.'), T('Save the rigged GLB or send to Play test.', 'Lưu GLB đã có xương hoặc gửi sang Chơi thử.', 'GLB 저장.')],
      retarget: [T('Drop a model that already has bones (Mixamo…), map the bones, pick clips.', 'Thả model đã có xương (Mixamo…), khớp xương, chọn clip.', '본 매핑 후 클립 선택.'), T('Send to Play test, or save the GLB with clips.', 'Gửi sang Chơi thử, hoặc lưu GLB kèm clip.', 'GLB 저장.')],
      mocap: [T('Drop a video of a person moving: the motion becomes an animation.', 'Thả video người chuyển động: động tác thành animation.', '영상에서 모션 추출.'), T('Save the clip, then use it in Rig / Retarget.', 'Lưu clip, rồi dùng ở Gắn xương / Retarget.', '클립 저장.')],
      vehicle: [T('Drop a car model, mark the wheels, tune drift and suspension.', 'Thả model xe, đánh dấu bánh, chỉnh drift và giảm xóc.', '바퀴 지정, 드리프트 조정.'), T('Send to Play test to drive it on a map.', 'Gửi sang Chơi thử để lái trên map.', '플레이 테스트로 보내기.')],
      playtest: [T('Build the map, set the goal and items, play it once.', 'Dựng map, đặt mục tiêu và vật phẩm, chơi thử một lượt.', '맵 제작 후 테스트.'), T('Export the playable (.html, one file) or record the gameplay video.', 'Xuất playable (.html, một file) hoặc quay video gameplay.', '플레이어블 .html 내보내기.')],
      space: [T('Fly a round, set enemies, difficulty and colours (or load your own jet GLB).', 'Bay thử một ván, chỉnh số địch, độ khó, màu (hoặc nạp GLB máy bay của bạn).', '플레이 후 설정.'), T('Press ⬇ Playable (.html): one ~1 MB file.', 'Bấm ⬇ File playable (.html): một file ~1 MB.', '⬇ 플레이어블 (.html).')],
      smash: [T('Pick a level, tune blocks and balls, play.', 'Chọn màn, chỉnh khối và bóng, chơi.', '레벨 선택 후 플레이.'), T('Export the playable or record a video.', 'Xuất playable hoặc quay video.', '내보내기.')],
      arena: [T('Pick the sport, tune the round, play.', 'Chọn môn, chỉnh hiệp đấu, chơi.', '종목 선택.'), T('Export the playable or record a video.', 'Xuất playable hoặc quay video.', '내보내기.')],
      drama: [T('Write the idea → script → characters → shots. Any API key or Claude does the writing.', 'Viết ý tưởng → kịch bản → nhân vật → cảnh quay. API nào cũng được, hoặc Claude viết giúp.', '아이디어 → 대본 → 장면.'), T('Export the episode video (and the script / prompts).', 'Xuất video tập phim (và kịch bản / prompt).', '영상 내보내기.')],
      vfx: [T('Drop the video, add blur, masks or transitions.', 'Thả video vào, thêm blur, mask hoặc chuyển cảnh.', '블러 · 마스크 · 전환.'), T('Export the MP4.', 'Xuất MP4.', 'MP4 내보내기.')],
      sfx: [T('Drop the video, place sounds on the timeline.', 'Thả video vào, đặt âm thanh lên timeline.', '타임라인에 사운드 배치.'), T('Export the video with sound: this is the file you post.', 'Xuất video có tiếng: đây là file đem đăng.', '사운드 포함 영상 내보내기.')]
    };
    return m[id] || [T('Set the look, press Record / Preview to check the motion.', 'Chỉnh kiểu dáng, bấm Quay / Xem thử để kiểm tra chuyển động.', '스타일 설정 후 미리보기.'), T('Export alpha .MOV (lay it over the gameplay) or green MP4.', 'Xuất alpha .MOV (đặt lên gameplay) hoặc MP4 nền xanh.', '알파 .MOV 내보내기.')];
  }
  var GOALS = [
    { id: 'play3d', ic: '🎮', n: ['Playable from a 3D character', 'Playable từ nhân vật 3D', '3D 캐릭터 플레이어블'], d: ['Model → bones → map → one .html', 'Model → xương → map → 1 file .html', '모델 → 리깅 → 맵 → .html'], steps: ['rig', 'playtest'] },
    { id: 'car', ic: '🚗', n: ['Driving playable', 'Playable lái xe', '드라이빙 플레이어블'], d: ['Car model → wheels → map → .html', 'Model xe → bánh → map → .html', '차량 → 바퀴 → 맵'], steps: ['vehicle', 'playtest'] },
    { id: 'ad', ic: '🎬', n: ['Game-ad video with HUD', 'Video quảng cáo có HUD', 'HUD 광고 영상'], d: ['Gameplay → HUD layer → sound', 'Gameplay → lớp HUD → âm thanh', '게임플레이 → HUD → 사운드'], steps: ['playtest', 'hpbar', 'sfx'] },
    { id: 'hud', ic: '❤️', n: ['Just an overlay (.MOV alpha)', 'Chỉ cần overlay (.MOV alpha)', '오버레이만'], d: ['Joystick / HP bar → alpha .MOV → sound', 'Joystick / thanh máu → .MOV alpha → tiếng', '오버레이 → .MOV'], steps: ['hpbar', 'sfx'] },
    { id: 'film', ic: '🎞', n: ['AI Drama film', 'Phim AI Drama', 'AI 드라마'], d: ['Idea → script → shots → FX → sound', 'Ý tưởng → kịch bản → cảnh → FX → tiếng', '아이디어 → 영상 → 사운드'], steps: ['drama', 'vfx', 'sfx'] },
    { id: 'mocap', ic: '🎥', n: ['My own move in the game', 'Đưa động tác của mình vào game', '내 동작을 게임에'], d: ['Video → motion → character → playable', 'Video → động tác → nhân vật → playable', '영상 → 모션 → 플레이어블'], steps: ['mocap', 'retarget', 'playtest'] }
  ];
  function goal () { var id = ls(GOAL); return GOALS.find(function (g) { return g.id === id; }) || null; }
  function cur () { return document.body.dataset.feat || ''; }
  function go (id) { if (window.__gbGo) window.__gbGo(id); }

  var st = document.createElement('style'); st.textContent =
    '#gbflow{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:60;max-width:min(880px,calc(100vw - 150px));display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:12px;font:500 12px/1.35 system-ui,sans-serif;color:#e9f1ee;background:rgba(16,20,24,.82);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(47,233,139,.35);box-shadow:0 8px 26px -10px rgba(0,0,0,.7)}' +
    '#gbflow[hidden]{display:none}#gbflow b{color:#2fe98b;font-weight:700;white-space:nowrap}' +
    '#gbflow .fs{display:flex;gap:4px;align-items:center;flex-wrap:nowrap;min-width:0}' +
    '#gbflow .fc{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:3px 9px;font:inherit;cursor:pointer;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis}' +
    '#gbflow .fc:hover{border-color:#2fe98b}#gbflow .fc.on{background:#2fe98b;color:#06150d;border-color:#2fe98b;font-weight:700}#gbflow .fc.done{opacity:.6}' +
    '#gbflow .ft{min-width:0;flex:1 1 220px;overflow:hidden}#gbflow .ft i{font-style:normal;opacity:.7}#gbflow .ft div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#gbflow .fx{border:0;background:none;color:inherit;opacity:.6;cursor:pointer;font:inherit;padding:2px 4px}#gbflow .fx:hover{opacity:1}' +
    '#gbflow .fn{border:0;border-radius:8px;background:#2fe98b;color:#06150d;font:700 12px system-ui;padding:5px 10px;cursor:pointer;white-space:nowrap}#gbflow .fn.g{background:rgba(255,255,255,.12);color:inherit}' +
    '#gbflow-pick{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(4,8,10,.6);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '#gbflow-pick .bx{width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:18px;border-radius:16px;background:rgba(18,22,26,.96);border:1px solid rgba(47,233,139,.4);color:#e9f1ee;font:500 13px/1.45 system-ui,sans-serif}' +
    '#gbflow-pick h3{margin:0 0 4px;font:700 17px system-ui}#gbflow-pick p{margin:0 0 12px;opacity:.75}' +
    '#gbflow-pick .gr{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}' +
    '#gbflow-pick .gc{text-align:left;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:inherit;border-radius:12px;padding:10px;cursor:pointer;font:inherit}' +
    '#gbflow-pick .gc:hover,#gbflow-pick .gc:focus-visible{border-color:#2fe98b;outline:0}#gbflow-pick .gc b{display:block;font-size:13px}#gbflow-pick .gc span{display:block;opacity:.7;font-size:11.5px;margin-top:2px}#gbflow-pick .gc em{display:block;font-style:normal;color:#2fe98b;font-size:11px;margin-top:5px}' +
    '#gbflow-pick .ft{display:flex;justify-content:flex-end;margin-top:12px}#gbflow-pick .sk{border:0;background:none;color:inherit;opacity:.7;cursor:pointer;font:inherit}' +
    '#gbc-flowbtn{height:34px;padding:0 10px!important;display:inline-flex;align-items:center;gap:5px;font-weight:700;white-space:nowrap}' +
    '@media (max-width:760px){#gbflow{left:8px;right:8px;transform:none;max-width:none;flex-wrap:wrap}}';
  document.head.appendChild(st);

  var bar = document.createElement('div'); bar.id = 'gbflow'; bar.hidden = true; document.body.appendChild(bar);
  function chip (id, cls, n) { return '<button type="button" class="fc ' + (cls || '') + '" data-go="' + id + '" title="' + esc(name(id)) + '">' + (n ? n + ' · ' : '') + esc(name(id)) + '</button>'; }
  function draw () {
    if (!all().length) return;
    var g = goal(), c = cur(), h = '';
    if (ls(HIDE) === '1' && !g) { bar.hidden = true; return; }
    if (g) {
      var ch = chain(g.steps), i = ch.indexOf(c); if (i < 0) i = Math.min(+(ls(STEP) || 0), ch.length - 1); else ls(STEP, String(i));
      var here = ch[i] === c, td = todo(ch[i]);
      h = '<b>🧭 ' + esc(T.apply(null, g.n)) + '</b><div class="fs">' + ch.map(function (id, k) { return chip(id, k === i ? 'on' : k < i ? 'done' : '', k + 1); }).join('<span>›</span>') + '</div>' +
        '<div class="ft"><div title="' + esc(td[0]) + '">' + esc(td[0]) + '</div><div title="' + esc(td[1]) + '"><i>⤓</i> ' + esc(td[1]) + '</div></div>' +
        (here ? '' : '<button type="button" class="fn" data-go="' + ch[i] + '">' + T('Open step', 'Mở bước này', '열기') + '</button>') +
        (i > 0 ? '<button type="button" class="fn g" data-go="' + ch[i - 1] + '">‹</button>' : '') +
        (i < ch.length - 1 ? '<button type="button" class="fn" data-go="' + ch[i + 1] + '">' + T('Next', 'Tiếp', '다음') + ' ›</button>' : '<button type="button" class="fn" data-end="1">✓ ' + T('Done', 'Xong', '완료') + '</button>') +
        '<button type="button" class="fx" data-end="1" title="' + T('Leave this workflow', 'Thoát quy trình', '종료') + '">✕</button>';
    } else {
      if (!PORT[c]) { bar.hidden = true; return; }
      var p = prev(c).slice(0, 3), n = next(c).slice(0, 4), td2 = todo(c);
      h = '<b>🧭</b>' + (p.length ? '<div class="fs"><span>' + T('From', 'Từ', '이전') + '</span>' + p.map(function (id) { return chip(id); }).join('') + '</div>' : '') +
        '<div class="ft"><div title="' + esc(td2[1]) + '"><i>⤓</i> ' + esc(td2[1]) + '</div></div>' +
        (n.length ? '<div class="fs"><span>' + T('Then', 'Rồi sang', '다음') + '</span>' + n.map(function (id) { return chip(id); }).join('') + '</div>' : '') +
        '<button type="button" class="fn g" data-pick="1">' + T('Workflows', 'Quy trình', '워크플로') + '</button><button type="button" class="fx" data-hide="1" title="' + T('Hide', 'Ẩn', '숨기기') + '">✕</button>';
    }
    if (bar.dataset.h !== h) { bar.innerHTML = h; bar.dataset.h = h; }
    bar.hidden = false;
  }
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) go(b.dataset.go);
    else if (b.dataset.end) { ls(GOAL, null); ls(STEP, null); }
    else if (b.dataset.hide) ls(HIDE, '1');
    else if (b.dataset.pick) pick();
    draw();
  });
  function start (g) { ls(GOAL, g.id); ls(STEP, '0'); ls(HIDE, null); var ch = chain(g.steps); if (ch[0]) go(ch[0]); draw(); }
  function pick () {
    if (document.getElementById('gbflow-pick')) return;
    ls(SEEN, '1');
    var w = document.createElement('div'); w.id = 'gbflow-pick'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = '<div class="bx"><h3>🧭 ' + T('What do you want to make?', 'Bạn muốn làm gì?', '무엇을 만들까요?') + '</h3><p>' +
      T('Pick a goal: Greenbox opens the tools in order, tells you what to do in each one and what to export, and links one tool to the next.', 'Chọn một mục tiêu: Greenbox mở lần lượt từng công cụ, chỉ việc cần làm và file cần xuất ở mỗi bước, rồi nối sang công cụ kế tiếp.', '목표를 고르면 도구를 순서대로 안내합니다.') + '</p><div class="gr">' +
      GOALS.map(function (g) { var ch = chain(g.steps); return '<button type="button" class="gc" data-g="' + g.id + '"><b>' + g.ic + ' ' + esc(T.apply(null, g.n)) + '</b><span>' + esc(T.apply(null, g.d)) + '</span><em>' + ch.length + ' ' + T('steps', 'bước', '단계') + ' · ' + esc(ch.map(function (id) { return window.__gbcF.tr(feat(id).name); }).join(' › ')) + '</em></button>'; }).join('') +
      '</div><div class="ft"><button type="button" class="sk">' + T('Not now, I will look around', 'Để sau, tôi tự xem', '나중에') + '</button></div></div>';
    document.body.appendChild(w);
    function close () { w.remove(); document.removeEventListener('keydown', key); }
    function key (e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', key);
    w.addEventListener('click', function (e) {
      var b = e.target.closest('.gc'); if (b) { close(); start(GOALS.find(function (g) { return g.id === b.dataset.g; })); return; }
      if (e.target === w || e.target.closest('.sk')) close();
    });
    var f = w.querySelector('.gc'); if (f) f.focus();
  }
  function button () {
    if (document.getElementById('gbc-flowbtn')) return;
    var anchor = document.getElementById('gbc-tourbtn') || document.getElementById('gbc-theme'); if (!anchor) return;
    var b = document.createElement('button'); b.id = 'gbc-flowbtn'; b.type = 'button'; b.className = 'gbc-b';
    b.textContent = '🧭 ' + T('Workflow', 'Quy trình', '워크플로'); b.title = T('Guided workflows: from the first tool to the exported file', 'Quy trình có hướng dẫn: từ công cụ đầu tiên tới file xuất ra', '가이드 워크플로');
    b.onclick = pick; anchor.parentNode.insertBefore(b, anchor);
  }
  var t = 0; function later () { clearTimeout(t); t = setTimeout(function () { button(); draw(); }, 80); }
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-feat'] });
  /* first visit: after the tour is closed, ask what the user wants to make */
  function first () {
    if (ls(SEEN) === '1') return;
    var n = 0, iv = setInterval(function () {
      n++; if (n > 600) clearInterval(iv);
      if (ls('gb.tour.cockpit.v1') !== '1' || document.getElementById('gbc-tour')) return;
      clearInterval(iv); pick();
    }, 1000);
  }
  function boot () { button(); draw(); first(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.__gbFlow = { next: next, prev: prev, route: route, chain: chain, goals: GOALS, start: function (id) { var g = GOALS.find(function (x) { return x.id === id; }); if (g) start(g); return !!g; }, pick: pick, ports: PORT };
})();
