/* 🎬 Greenbox Drama Studio: the DramaClaw-like parts on top of the AI Drama pipeline (drama.template.html loads this
   after its own script). Own code, same workflow as DramaClaw (Freezone canvas · Phim bộ: Nguồn truyện → Thư viện
   asset → Kịch bản → Phác thảo → Âm thanh → Video → Dựng phim → Phong cách · Xia Director chat · Trung tâm tác vụ).
   Model calls go to Claude (gb_inbox → gb_drama) or to any API key the user saved (⚡ engine below); pictures / videos / voices from Higgsfield. */
'use strict'
;(function () {
  /* ---------------- state additions ---------------- */
  function ext (p) {
    p.scenes = p.scenes || []; p.props = p.props || []; p.chat = p.chat || []
    p.style = p.style || { name: '', prompt: '', ref: null }
    p.canvas = p.canvas || { nodes: [], edges: [], view: { x: 0, y: 0, z: 1 }, seq: 0 }
    p.compose = p.compose || { voice: true, music: true, subs: false }
    p.mode = p.mode || 'series'; p.atab = p.atab || 'chars'; p.narrator = p.narrator || { desc: '', sample: null }
    for (const c of p.chars) c.voice = c.voice || { desc: '', sample: null }
    return p
  }
  for (const p of Object.values(S.projects)) ext(p)
  if (S.unlock === undefined) S.unlock = true // test mode: every step and button open (master asked to check everything)
  const XP = () => ext(P())

  /* ---------------- the steps (DramaClaw's Phim bộ menu) ---------------- */
  W.steps = [['src', 'Nguồn truyện', 'Story', 'd_story'], ['chars', 'Thư viện asset', 'Assets', 'd_chars'], ['script', 'Kịch bản', 'Script', 'd_script'],
    ['board', 'Phác thảo', 'Storyboard', 'brush'], ['audio', 'Âm thanh', 'Audio', ''], ['prod', 'Video', 'Video', 'd_prod'], ['edit', 'Dựng phim', 'Compose', 'd_edit'], ['style', 'Phong cách', 'Style', 'weather']]
  const _can = can
  window.can = can = function (tab) { if (S.unlock) return true; if (tab === 'board' || tab === 'audio') return !!P().script; if (tab === 'style') return true; return _can(tab) }

  /* ---------------- extra CSS ---------------- */
  const css = document.createElement('style'); css.textContent = `
  .mode{display:flex;gap:2px;background:var(--p1);border:1px solid var(--ln);border-radius:10px;padding:3px}
  .mode button{white-space:nowrap;background:none;border:0;border-radius:8px;padding:5px 12px;color:var(--mu);font-size:13px;font-weight:600}
  .mode button.on{background:#16a34a;color:#fff}
  .unl{font-size:12px;color:var(--mu);display:flex;gap:5px;align-items:center;white-space:nowrap;cursor:pointer}
  .xdir{border:1px solid #1f6b45;background:#0f2a1d;color:#bff7d6;border-radius:999px;padding:4px 12px;font-size:12.5px;font-weight:600;white-space:nowrap}
  .subt{display:flex;gap:6px;margin:0 0 14px;flex-wrap:wrap}.subt button{border:1px solid var(--ln);background:var(--p1);border-radius:9px;padding:5px 14px;color:var(--mu)}.subt button.on{border-color:var(--ac);color:var(--tx);background:var(--acbg)}
  .pic.wide{aspect-ratio:16/9}
  .board{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
  .sb{background:var(--p1);border:1px solid var(--ln);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  .sb .vid{border-radius:0}.sb .bd{padding:8px 10px;display:grid;gap:6px;font-size:12.5px}
  .aud{display:grid;grid-template-columns:1fr 280px;gap:10px;align-items:center}
  .aud audio{width:100%;height:34px}
  @media (max-width:820px){.aud{grid-template-columns:1fr}}
  /* Xia Director */
  .dir{position:fixed;right:0;top:52px;bottom:34px;width:min(380px,100vw);background:var(--p1);border-left:1px solid var(--ln2);display:none;flex-direction:column;z-index:6;box-shadow:-18px 0 40px #0008}
  .dir.open{display:flex}
  .dir .hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--ln)}
  .dir .ms{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
  .dir .m{max-width:88%;padding:8px 11px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap}
  .dir .m.u{align-self:flex-end;background:#16a34a;color:#fff}.dir .m.c{align-self:flex-start;background:var(--p3)}
  .dir .in{display:flex;gap:6px;padding:10px;border-top:1px solid var(--ln)}.dir .in textarea{min-height:44px;flex:1}
  /* Freezone */
  .fz{position:relative;height:calc(100vh - 52px - 34px - 58px);margin:0 -16px;overflow:hidden;background:radial-gradient(circle,#ffffff14 1px,transparent 1.2px) 0 0/22px 22px,var(--bg);cursor:grab}
  .fz.pan{cursor:grabbing}
  .fzw{position:absolute;left:0;top:0;transform-origin:0 0}
  .fzw svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
  .fzw svg path{fill:none;stroke:#2fe98b;stroke-width:2.5;opacity:.75;pointer-events:stroke;cursor:pointer}
  .nd{position:absolute;width:250px;background:var(--p1);border:1px solid var(--ln2);border-radius:14px;box-shadow:0 10px 30px #0007;display:flex;flex-direction:column;cursor:default}
  .nd.sel{border-color:var(--ac);box-shadow:0 0 0 2px #2fe98b55,0 10px 30px #0007}
  .nd .nh{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--ln);cursor:move;font-size:12.5px;font-weight:600}
  .nd .nh input{background:none;border:0;padding:0;font-weight:600;flex:1;min-width:0}
  .nd .nb{padding:8px 10px;display:grid;gap:6px}
  .nd .nb textarea{min-height:58px;font-size:12.5px}
  .nd .nm{aspect-ratio:16/10;background:var(--p2);border-radius:8px;display:grid;place-items:center;color:var(--mu2);font-size:11.5px;overflow:hidden}
  .nd .nm img,.nd .nm video{width:100%;height:100%;object-fit:contain}
  .nd .nm audio{width:95%}
  .port{position:absolute;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:var(--p3);border:2px solid var(--ac);cursor:crosshair}
  .port.i{left:-8px}.port.o{right:-8px}
  .fzbar{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;background:var(--p1);border:1px solid var(--ln2);border-radius:14px;padding:6px;z-index:2;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 24px)}
  .fzbar button{font-size:12px;padding:5px 9px}
  .fzhint{position:absolute;left:14px;top:12px;font-size:12px;color:var(--mu);z-index:2;background:#000a;border-radius:8px;padding:4px 8px}
  `; document.head.append(css)

  /* ---------------- top bar: Freezone | Phim bộ, test mode, Xia Director ---------------- */
  const top = document.querySelector('.top')
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:10px;align-items:center'
  bar.innerHTML = `<div class="mode" id="mode"><button data-mode2="free">Freezone</button><button data-mode2="series">${'Phim bộ'}</button></div><label class="unl" id="unl"><input type="checkbox" id="unlck"> <span id="unlt"></span></label><button class="xdir" id="xdir">🎬 Xia Director</button>`
  top.insertBefore(bar, document.getElementById('cl'))
  const dir = document.createElement('div'); dir.className = 'dir'; dir.id = 'dir'; document.body.append(dir)
  bar.querySelectorAll('[data-mode2]').forEach(b => { b.onclick = () => { XP().mode = b.dataset.mode2; save(); render() } })
  document.getElementById('unlck').onchange = e => { S.unlock = e.target.checked; save(); render() }
  document.getElementById('xdir').onclick = () => { dir.classList.toggle('open'); drawDir() }

  const _drawTop = drawTop
  window.drawTop = drawTop = function () {
    _drawTop()
    const p = XP(); const done = { src: !!p.script, script: p.approved.script, chars: p.approved.chars, prod: eps().length > 0 && eps().every(epDone), edit: eps().length > 0 && eps().every(e => e.merged), board: allBeats().length > 0 && allBeats().every(x => x.b.still), audio: allBeats().some(x => x.b.voice), style: !!(p.style.prompt || p.style.ref) }
    $('pills').innerHTML = p.mode === 'free' ? `<span class="mut small" style="padding:6px 10px">${t('Freezone: canvas tự do — kéo nối các node, Claude tạo nội dung cho từng node', 'Freezone: a free canvas — wire nodes, Claude fills each one')}</span>`
      : W.steps.map(s => `<button data-tab="${s[0]}" class="${p.tab === s[0] ? 'on' : ''}"${can(s[0]) ? '' : ' disabled'}>${s[3] ? `<img class="pi" src="ui/tools/${s[3]}.webp" alt="" onerror="this.remove()">` : (s[0] === 'audio' ? '🎙 ' : '')}${t(s[1], s[2])}${done[s[0]] ? ' <b>✓</b>' : ''}</button>`).join('')
    document.querySelectorAll('[data-mode2]').forEach(b => b.classList.toggle('on', b.dataset.mode2 === p.mode))
    document.getElementById('unlck').checked = !!S.unlock
    document.getElementById('unlt').textContent = S.unlock ? t('🔓 Mở hết (kiểm tra)', '🔓 All open (test)') : t('🔒 Theo bước', '🔒 Step by step')
    document.getElementById('xdir').textContent = '🎬 Xia Director' + (pending('director').length ? ' ·…' : '')
  }

  /* ---------------- render: the new pages + Freezone ---------------- */
  window.render = render = function () {
    const p = XP(); if (!can(p.tab)) p.tab = 'src'
    drawTop(); drawFoot(); drawLog(); drawDir()
    if (p.mode === 'free') { $('page').innerHTML = pFree(); wireFree(); fillMedia(); return }
    const f = { src: pSrc, script: pScript, chars: pAssets, prod: pProd, edit: pEdit2, board: pBoard, audio: pAudio, style: pStyle }[p.tab] || pSrc
    $('page').innerHTML = f(); wire(); wire2(); fillMedia(); fillAudio()
  }
  async function fillAudio () { for (const el of document.querySelectorAll('[data-aud]')) { const k = el.dataset.aud; if (!k) continue; const u = await url(k); if (u) el.innerHTML = `<audio controls src="${u}"></audio>` } }

  /* Thư viện asset: characters (the old page) · scenes · props · voices */
  function pAssets () {
    const p = XP(); const sub = p.atab
    const tabs = `<div class="subt">${[['chars', 'Nhân vật', 'Characters'], ['scenes', 'Bối cảnh', 'Scenes'], ['props', 'Đạo cụ', 'Props'], ['voices', 'Giọng thuyết minh', 'Voices']].map(([k, vi, en]) => `<button data-atab="${k}" class="${sub === k ? 'on' : ''}">${t(vi, en)} <span class="mut small">${k === 'chars' ? p.chars.length : k === 'voices' ? p.chars.length + 1 : p[k].length}</span></button>`).join('')}</div>`
    if (sub === 'chars') return pChars().replace('</p></div></div>', '</p></div></div>' + tabs)
    if (sub === 'voices') return head('🎙', t('Giọng thuyết minh', 'Voices'), t('Mỗi nhân vật một giọng (mô tả + giọng mẫu) và giọng người dẫn. Claude lồng tiếng theo giọng này.', 'One voice per character (description + sample) and a narrator. Claude voices the lines with them.')) + tabs + waitBox(['voice_sample']) +
      [{ name: '__narrator', label: t('Người dẫn chuyện', 'Narrator'), v: p.narrator }].concat(p.chars.map(c => ({ name: c.name, label: c.name, v: c.voice }))).map(x => `<div class="panel aud" style="margin-bottom:10px"><div><b>${h(x.label)}</b><input type="text" data-vdesc="${h(x.name)}" value="${h(x.v.desc || '')}" placeholder="${t('Giọng: nam trầm, ấm, nói chậm…', 'Voice: low warm male, slow…')}" style="margin-top:6px"></div>
        <div><div data-aud="${x.v.sample || ''}" class="mut small">${x.v.sample ? '' : t('Chưa có giọng mẫu', 'No sample yet')}</div><div class="row" style="margin-top:6px"><button class="btn sm" data-vgen="${h(x.name)}">🎙 ${t('Claude tạo giọng mẫu', 'Claude makes a sample')}</button><button class="btn sm" data-vup="${h(x.name)}">⬆ ${t('Tải giọng', 'Upload')}</button></div></div></div>`).join('')
    const kind = sub; const one = kind === 'scenes' ? t('bối cảnh', 'scene') : t('đạo cụ', 'prop')
    return head(kind === 'scenes' ? '🏞' : '🧰', kind === 'scenes' ? t('Bối cảnh', 'Scenes') : t('Đạo cụ', 'Props'), t(`Ảnh ${one} giữ cho mọi cảnh trông giống nhau. Claude lấy từ kịch bản hoặc bạn tự thêm; ảnh tạo trên Higgsfield hoặc tải lên.`, `${one} pictures keep every shot consistent. Claude lists them from the script or add your own; pictures from Higgsfield or uploads.`)) + tabs + waitBox(['extract_assets', 'asset_image']) +
      `<div class="row" style="margin-bottom:12px;justify-content:flex-end"><button class="btn" data-extract="${kind}">✨ ${t(`Claude lấy ${one} từ kịch bản`, `Claude lists the ${one}s from the script`)}</button><button class="btn" data-addasset="${kind}">＋ ${t('Thêm', 'Add')}</button><button class="btn" data-allimg="${kind}">🎨 ${t('Tạo ảnh tất cả (Higgsfield)', 'Make all pictures')}</button></div>` +
      (p[kind].length ? `<div class="chars">${p[kind].map((a, i) => `<div class="char"><div class="pic${kind === 'scenes' ? ' wide' : ''}" data-img="${a.img || ''}">${a.img ? '' : t('Chưa có ảnh', 'No picture yet')}</div>
        <div class="bd"><input type="text" class="nm" data-aname="${kind}:${i}" value="${h(a.name)}"><textarea data-alook="${kind}:${i}" placeholder="${t('Mô tả / prompt ảnh', 'Description / picture prompt')}">${h(a.look || '')}</textarea>
        <div class="row"><button class="btn sm" data-agen="${kind}:${i}">🎨 Higgsfield</button><button class="btn sm" data-aup="${kind}:${i}">⬆ ${t('Tải ảnh', 'Upload')}</button><button class="btn sm" data-adel="${kind}:${i}">✕</button></div></div></div>`).join('')}</div>` : `<div class="empty">${t(`Chưa có ${one}.`, `No ${one}s yet.`)}</div>`)
  }

  /* Phác thảo: the storyboard grid — first frames per beat, Previz from Greenbox Play test */
  function pBoard () {
    const p = XP(); const L = eps(); if (!L.length) return head('🖌', t('Phác thảo', 'Storyboard'), '') + `<div class="empty">${t('Chưa có kịch bản.', 'No script yet.')}</div>`
    const e = L[p.ep] || L[0]; const ei = L.indexOf(e)
    return head('🖌', t('Phác thảo (storyboard)', 'Storyboard'), t('Khung hình đầu của từng nhịp. Tạo trên Higgsfield, tải lên, hoặc dựng cảnh 3D trong Play test của Greenbox rồi chụp (Previz).', 'The first frame of every beat: Higgsfield, upload, or block the shot in Greenbox Play test and grab it (previz).')) + waitBox(['storyboard', 'gen_image']) +
      `<div class="epbar">${L.map((x, i) => `<button data-ep="${i}" class="${i === ei ? 'on' : ''}">${p.src.type === 'single' ? t('Phim', 'Film') : t('Tập', 'Ep.') + ' ' + (i + 1)}</button>`).join('')}</div>
      <div class="row" style="margin-bottom:12px;justify-content:flex-end"><button class="btn" id="openpt">🎥 ${t('Mở Play test (dựng cảnh 3D)', 'Open Play test (3D blocking)')}</button><button class="btn pri" data-sball="${ei}">🖼 ${t('Claude vẽ storyboard cả tập', 'Claude draws the whole episode')}</button></div>
      <div class="board">${(e.beats || []).map((b, j) => `<div class="sb" data-bj="${j}"><div class="vid${p.src.ratio === '16:9' ? ' wide' : ''}" data-img2="${b.still || ''}">${b.still ? '' : (j + 1)}</div><div class="bd"><div><b>${t('Nhịp', 'Beat')} ${j + 1}</b> <span class="mut">${b.sec || p.src.clip}s${b.scene ? ' · ' + h(b.scene) : ''}</span></div><div class="mut">${h((b.action || '').slice(0, 90))}</div>
        <div class="row"><button class="btn sm" data-gi="${j}" title="Higgsfield">🖼</button><button class="btn sm" data-ui="${j}" title="${t('Tải ảnh', 'Upload')}">⬆</button><button class="btn sm" data-prev="${j}" title="${t('Chụp khung hình đang thấy trong Play test', 'Grab the Play test view')}">📸 Previz</button></div></div></div>`).join('')}</div>`
  }

  /* Âm thanh: voice-over per beat, music per episode, subtitles */
  function pAudio () {
    const p = XP(); const L = eps(); if (!L.length) return head('🎙', t('Âm thanh', 'Audio'), '') + `<div class="empty">${t('Chưa có kịch bản.', 'No script yet.')}</div>`
    const e = L[p.ep] || L[0]; const ei = L.indexOf(e)
    return head('🎙', t('Âm thanh', 'Audio'), t('Lồng tiếng từng nhịp theo giọng của nhân vật, nhạc nền cho cả tập, phụ đề .SRT tự lấy từ lời thoại.', 'Voice each beat with the characters\' voices, music for the episode, .SRT subtitles from the lines.')) + waitBox(['voice', 'voice_episode', 'music']) +
      `<div class="epbar">${L.map((x, i) => `<button data-ep="${i}" class="${i === ei ? 'on' : ''}">${p.src.type === 'single' ? t('Phim', 'Film') : t('Tập', 'Ep.') + ' ' + (i + 1)}</button>`).join('')}</div>
      <div class="panel aud" style="margin-bottom:12px"><div><b>🎵 ${t('Nhạc nền', 'Music')}</b><div class="mut small">${t('Cho cả tập; khi dựng sẽ trộn nhỏ dưới lời thoại.', 'For the whole episode, mixed under the voices.')}</div></div><div><div data-aud="${e.music || ''}" class="mut small">${e.music ? '' : t('Chưa có nhạc', 'No music yet')}</div><div class="row" style="margin-top:6px"><button class="btn sm" data-music="${ei}">🎵 ${t('Claude tạo nhạc', 'Claude makes music')}</button><button class="btn sm" data-mup="${ei}">⬆ ${t('Tải nhạc', 'Upload')}</button></div></div></div>
      <div class="row" style="margin-bottom:12px;justify-content:flex-end"><button class="btn" data-srt="${ei}">⬇ ${t('Phụ đề .SRT', 'Subtitles .SRT')}</button><button class="btn pri" data-vall="${ei}">🎙 ${t('Claude lồng tiếng cả tập', 'Claude voices the episode')}</button></div>
      ${(e.beats || []).map((b, j) => `<div class="panel aud" style="margin-bottom:8px" data-bj="${j}"><div><b>${t('Nhịp', 'Beat')} ${j + 1}</b> <span class="mut small">${b.sec || p.src.clip}s</span><div class="small" style="margin-top:4px">${(b.lines || []).length ? b.lines.map(l => `<b>${h(l.who)}</b>: ${h(l.text)}`).join('<br>') : `<span class="mut">${t('(không thoại)', '(no lines)')}</span>`}</div></div>
        <div><div data-aud="${b.voice || ''}" class="mut small">${b.voice ? '' : t('Chưa lồng tiếng', 'Not voiced yet')}</div><div class="row" style="margin-top:6px"><button class="btn sm" data-vb="${j}"${(b.lines || []).length ? '' : ' disabled'}>🎙 ${t('Lồng tiếng', 'Voice')}</button><button class="btn sm" data-vbu="${j}">⬆</button></div></div></div>`).join('')}`
  }

  /* Dựng phim: the old page + mix options */
  function pEdit2 () {
    const p = XP(); const c = p.compose
    return pEdit().replace('</p></div></div>', '</p></div></div>' + `<div class="panel" style="margin-bottom:12px"><div class="row" style="gap:18px"><b>${t('Khi Claude ghép:', 'When Claude joins:')}</b>
      <label class="row" style="gap:6px"><input type="checkbox" data-cmp="voice"${c.voice ? ' checked' : ''}> ${t('Lồng tiếng', 'Voice-over')}</label>
      <label class="row" style="gap:6px"><input type="checkbox" data-cmp="music"${c.music ? ' checked' : ''}> ${t('Nhạc nền', 'Music')}</label>
      <label class="row" style="gap:6px"><input type="checkbox" data-cmp="subs"${c.subs ? ' checked' : ''}> ${t('Đốt phụ đề vào video', 'Burn subtitles in')}</label></div></div>`)
  }

  /* Phong cách hình ảnh */
  function pStyle () {
    const p = XP(); const s = p.style
    return head('🎨', t('Phong cách hình ảnh', 'Visual style'), t('Một phong cách cho cả dự án: ảnh mẫu + mô tả. Claude thêm vào mọi prompt ảnh / video.', 'One style for the whole project: a reference picture + a description. Claude adds it to every picture / video prompt.')) + waitBox(['style_extract']) +
      `<div class="split" style="grid-template-columns:320px 1fr"><div class="panel"><div class="pic" data-img="${s.ref || ''}" style="border-radius:10px">${s.ref ? '' : t('Chưa có ảnh mẫu', 'No reference yet')}</div><div class="row" style="margin-top:10px"><button class="btn sm" id="stup">⬆ ${t('Tải ảnh mẫu', 'Upload a reference')}</button><button class="btn sm pri" id="stex"${s.ref ? '' : ' disabled'}>✨ ${t('Claude rút phong cách', 'Claude reads the style')}</button></div></div>
      <div class="panel"><div class="field"><label>${t('Tên phong cách', 'Style name')}</label><input type="text" id="stname" value="${h(s.name)}" placeholder="${t('vd. Điện ảnh Hàn Quốc ấm', 'e.g. Warm Korean cinema')}"></div>
      <div class="field" style="margin-top:10px"><label>${t('Mô tả phong cách (thêm vào mọi prompt)', 'Style description (added to every prompt)')}</label><textarea id="stprompt" style="min-height:120px">${h(s.prompt)}</textarea></div>
      <div class="mut small" style="margin:10px 0 6px">${t('Mẫu nhanh:', 'Quick presets:')}</div><div class="row">${W.styles.map(x => `<button class="btn sm" data-stp="${x[0]}">${t(x[1], x[2])}</button>`).join('')}</div></div></div>`
  }
  const PRESET = { realistic: 'modern realistic live-action drama, natural skin, cinematic lighting, shallow depth of field, 35mm film look', chinesePeriodDrama: 'Chinese period costume drama, silk hanfu, palace architecture, warm lanterns, painterly cinematic light', guoman3d: 'Chinese guoman 3D animation, xianxia fantasy, glowing qi effects, ethereal mountains', anime: 'Japanese anime style, clean line art, cel shading, vivid colours', republican: 'Republican-era 1930s Shanghai drama, qipao and suits, sepia warm tones, art deco', postApocalyptic: 'post-apocalyptic survival drama, ruined city, dust and haze, desaturated teal-orange grade', pixar3d: 'stylised 3D animated film, soft global illumination, expressive characters' }

  /* ---------------- events for the new pages ---------------- */
  function wire2 () {
    const p = XP(); const pg = $('page')
    pg.querySelectorAll('[data-atab]').forEach(b => { b.onclick = () => { p.atab = b.dataset.atab; save(); render() } })
    const A = s => { const [k, i] = s.split(':'); return p[k][+i] }
    pg.querySelectorAll('[data-aname]').forEach(el => { el.onchange = () => { A(el.dataset.aname).name = el.value.trim() || A(el.dataset.aname).name; save() } })
    pg.querySelectorAll('[data-alook]').forEach(el => { el.oninput = () => { A(el.dataset.alook).look = el.value; save() } })
    pg.querySelectorAll('[data-adel]').forEach(b => { b.onclick = () => { const [k, i] = b.dataset.adel.split(':'); p[k].splice(+i, 1); save(); render() } })
    pg.querySelectorAll('[data-addasset]').forEach(b => { b.onclick = () => { const k = b.dataset.addasset; p[k].push({ name: (k === 'scenes' ? t('Bối cảnh ', 'Scene ') : t('Đạo cụ ', 'Prop ')) + (p[k].length + 1), look: '', img: null }); save(); render() } })
    pg.querySelectorAll('[data-extract]').forEach(b => { b.onclick = () => ask('extract_assets', { kind: b.dataset.extract }, b.dataset.extract === 'scenes' ? t('Lấy danh sách bối cảnh từ kịch bản', 'List the scenes from the script') : t('Lấy danh sách đạo cụ từ kịch bản', 'List the props from the script')) })
    pg.querySelectorAll('[data-agen]').forEach(b => { b.onclick = () => { const a = A(b.dataset.agen); ask('asset_image', { kind: b.dataset.agen.split(':')[0], name: a.name }, t(`Tạo ảnh ${a.name} trên Higgsfield`, `Make ${a.name}'s picture on Higgsfield`)) } })
    pg.querySelectorAll('[data-allimg]').forEach(b => { b.onclick = () => { const k = b.dataset.allimg; const miss = p[k].filter(a => !a.img).map(a => a.name); if (miss.length) ask('asset_image', { kind: k, names: miss }, t(`Tạo ảnh ${miss.length} ${k === 'scenes' ? 'bối cảnh' : 'đạo cụ'}`, `Make ${miss.length} pictures`)) } })
    pg.querySelectorAll('[data-aup]').forEach(b => { b.onclick = () => { upX = { kind: 'asset', key: b.dataset.aup }; $('fimg2').click() } })
    // voices
    const V = n => n === '__narrator' ? p.narrator : charByName(n).voice
    pg.querySelectorAll('[data-vdesc]').forEach(el => { el.oninput = () => { V(el.dataset.vdesc).desc = el.value; save() } })
    pg.querySelectorAll('[data-vgen]').forEach(b => { b.onclick = () => { const n = b.dataset.vgen; ask('voice_sample', { name: n }, t(`Tạo giọng mẫu ${n === '__narrator' ? 'người dẫn' : n}`, `Make a voice sample for ${n === '__narrator' ? 'the narrator' : n}`)) } })
    pg.querySelectorAll('[data-vup]').forEach(b => { b.onclick = () => { upX = { kind: 'vsample', name: b.dataset.vup }; $('faud').click() } })
    // storyboard
    const op = $('openpt'); if (op) op.onclick = () => { try { parent.__gbGo('playtest') } catch { alert(t('Mở trang này trong Greenbox Cockpit để dùng Play test.', 'Open this page inside the Greenbox Cockpit to use Play test.')) } }
    pg.querySelectorAll('[data-sball]').forEach(b => { b.onclick = () => ask('storyboard', { ep: +b.dataset.sball }, t(`Vẽ storyboard tập ${+b.dataset.sball + 1} trên Higgsfield`, `Draw the storyboard of ep. ${+b.dataset.sball + 1}`)) })
    pg.querySelectorAll('[data-prev]').forEach(b => { b.onclick = () => previz(p.ep, +b.dataset.prev) })
    // audio
    pg.querySelectorAll('[data-vb]').forEach(b => { b.onclick = () => { const j = +b.dataset.vb; ask('voice', { ep: p.ep, beat: j }, t(`Lồng tiếng nhịp ${j + 1}`, `Voice beat ${j + 1}`)) } })
    pg.querySelectorAll('[data-vbu]').forEach(b => { b.onclick = () => { upX = { kind: 'bvoice', ep: p.ep, beat: +b.dataset.vbu }; $('faud').click() } })
    pg.querySelectorAll('[data-vall]').forEach(b => { b.onclick = () => ask('voice_episode', { ep: +b.dataset.vall }, t(`Lồng tiếng cả tập ${+b.dataset.vall + 1}`, `Voice the whole ep. ${+b.dataset.vall + 1}`)) })
    pg.querySelectorAll('[data-music]').forEach(b => { b.onclick = () => ask('music', { ep: +b.dataset.music }, t(`Nhạc nền tập ${+b.dataset.music + 1}`, `Music for ep. ${+b.dataset.music + 1}`)) })
    pg.querySelectorAll('[data-mup]').forEach(b => { b.onclick = () => { upX = { kind: 'music', ep: +b.dataset.mup }; $('faud').click() } })
    pg.querySelectorAll('[data-srt]').forEach(b => { b.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([srt(+b.dataset.srt)], { type: 'text/plain' })); a.download = `${(p.script?.title || 'drama').replace(/[^\p{L}\p{N}]+/gu, '-')}-${+b.dataset.srt + 1}.srt`; a.click() } })
    // compose options
    pg.querySelectorAll('[data-cmp]').forEach(el => { el.onchange = () => { p.compose[el.dataset.cmp] = el.checked; save() } })
    // style
    const su = $('stup'); if (su) su.onclick = () => { upX = { kind: 'style' }; $('fimg2').click() }
    const sx = $('stex'); if (sx) sx.onclick = () => ask('style_extract', {}, t('Rút phong cách từ ảnh mẫu', 'Read the style of the reference'))
    const sn = $('stname'); if (sn) sn.oninput = () => { p.style.name = sn.value; save() }
    const sp = $('stprompt'); if (sp) sp.oninput = () => { p.style.prompt = sp.value; save() }
    pg.querySelectorAll('[data-stp]').forEach(b => { b.onclick = () => { const x = W.styles.find(s => s[0] === b.dataset.stp); p.style.name = t(x[1], x[2]); p.style.prompt = PRESET[x[0]] || ''; p.src.style = x[0]; save(); render() } })
  }

  /* subtitles: each beat's lines share its seconds */
  function srt (ei) {
    const e = eps()[ei]; let t0 = 0; let n = 0; const out = []
    const ts = s => { const ms = Math.round(s * 1000); const hh = Math.floor(ms / 3600000), mm = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` }
    for (const b of e.beats || []) { const sec = +b.sec || P().src.clip; const L = b.lines || []; L.forEach((l, i) => { const a = t0 + sec * i / L.length, z = t0 + sec * (i + 1) / L.length - 0.05; out.push(`${++n}\n${ts(a)} --> ${ts(z)}\n${l.who ? l.who + ': ' : ''}${l.text}\n`) }); t0 += sec }
    return out.join('\n')
  }

  /* 📸 Previz: grab the Play test view of the Greenbox Cockpit as the beat's first frame */
  async function previz (ei, j) {
    try {
      const fr = [...parent.document.querySelectorAll('iframe')].find(f => /playtest\.html/.test(f.src)); const pt = fr && fr.contentWindow.__playtest
      if (!pt) { alert(t('Mở Play test trong Greenbox (nút 🎥), dựng cảnh, đặt camera, rồi bấm 📸 lại.', 'Open Play test in Greenbox (🎥 button), block the shot, set the camera, then press 📸 again.')); return }
      pt.renderer.render(pt.scene, pt.camera); const blob = await new Promise(r => pt.renderer.domElement.toBlob(r, 'image/jpeg', 0.9))
      const b = eps()[ei].beats[j]; b.still = await putMedia(`${P().id}/still/${ei}/${j}/${Date.now()}`, blob)
      log('user', t(`Previz: chụp Play test cho nhịp ${j + 1}`, `Previz: Play test grab for beat ${j + 1}`)); save(); render()
    } catch (e) { alert(t('Không chụp được Play test (mở trang này trong Greenbox Cockpit).', 'Could not grab Play test (open this page inside the Greenbox Cockpit).')) }
  }

  /* extra uploads: asset pictures, voices, music, the style reference */
  let upX = null
  const fi2 = document.createElement('input'); fi2.type = 'file'; fi2.accept = 'image/*'; fi2.hidden = true; fi2.id = 'fimg2'; document.body.append(fi2)
  const fa = document.createElement('input'); fa.type = 'file'; fa.accept = 'audio/*'; fa.hidden = true; fa.id = 'faud'; document.body.append(fa)
  fi2.onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !upX) return; const p = XP()
    if (upX.kind === 'asset') { const [k, i] = upX.key.split(':'); p[k][+i].img = await putMedia(`${p.id}/${k}/${Date.now()}`, f) }
    if (upX.kind === 'style') p.style.ref = await putMedia(`${p.id}/style/${Date.now()}`, f)
    if (upX.kind === 'node') { const n = p.canvas.nodes.find(x => x.id === upX.id); if (n) n.media = await putMedia(`${p.id}/node/${n.id}/${Date.now()}`, f) }
    save(); render()
  }
  fa.onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !upX) return; const p = XP()
    if (upX.kind === 'vsample') { const v = upX.name === '__narrator' ? p.narrator : charByName(upX.name).voice; v.sample = await putMedia(`${p.id}/voice/${Date.now()}`, f) }
    if (upX.kind === 'bvoice') eps()[upX.ep].beats[upX.beat].voice = await putMedia(`${p.id}/bvoice/${upX.ep}/${upX.beat}/${Date.now()}`, f)
    if (upX.kind === 'music') eps()[upX.ep].music = await putMedia(`${p.id}/music/${upX.ep}/${Date.now()}`, f)
    if (upX.kind === 'node') { const n = p.canvas.nodes.find(x => x.id === upX.id); if (n) n.media = await putMedia(`${p.id}/node/${n.id}/${Date.now()}`, f) }
    save(); render()
  }

  /* ---------------- 🎬 Xia Director: chat with Claude about the project ---------------- */
  function drawDir () {
    const p = XP(); if (!dir.classList.contains('open')) return
    const w = pending('director').length
    dir.innerHTML = `<div class="hd"><b>🎬 Xia Director</b><span class="mut small" style="flex:1">${t('Claude · đạo diễn của dự án', 'Claude · the project\'s director')}</span><button class="btn sm" id="dirx">✕</button></div>
      <div class="ms" id="dirms">${p.chat.length ? '' : `<div class="mut small">${t('Hỏi gì cũng được: “viết lại cảnh 3 cho kịch tính hơn”, “thêm một nhân vật phản diện”, “gợi ý hook cho tập 2”… Claude đọc cả dự án và sửa trực tiếp.', 'Ask anything: “make scene 3 more dramatic”, “add a villain”, “hook ideas for ep. 2”… Claude reads the whole project and edits it.')}</div>`}${p.chat.map(m => `<div class="m ${m.who === 'user' ? 'u' : 'c'}">${h(m.text)}</div>`).join('')}${w ? `<div class="m c"><span class="spin" style="display:inline-block;vertical-align:-3px"></span> ${t('Claude đang nghĩ…', 'Claude is thinking…')}</div>` : ''}</div>
      <div class="in"><textarea id="dirin" placeholder="${t('Nhắn cho Xia Director…', 'Message Xia Director…')}"></textarea><button class="btn pri" id="dirsend">➤</button></div>`
    const ms = $('dirms'); ms.scrollTop = ms.scrollHeight
    $('dirx').onclick = () => dir.classList.remove('open')
    const send = () => { const v = $('dirin').value.trim(); if (!v) return; p.chat.push({ who: 'user', text: v, t: Date.now() }); save(); ask('director', { text: v }, t('Xia Director: ', 'Xia Director: ') + v.slice(0, 60)); drawDir() }
    $('dirsend').onclick = send; $('dirin').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
  }

  /* ---------------- 🧩 Freezone: a node canvas ---------------- */
  const NT = { text: ['📝', 'Văn bản', 'Text'], image: ['🖼', 'Ảnh', 'Image'], ai_image: ['✨', 'Ảnh AI', 'AI image'], video: ['🎬', 'Video AI', 'AI video'], audio: ['🎙', 'Âm thanh', 'Audio'], script: ['📜', 'Kịch bản', 'Script'], compose: ['🎞', 'Dựng video', 'Video compose'], previz: ['🎥', 'Previz 3D', '3D previz'] }
  let selNode = null
  function pFree () {
    const p = XP(); const c = p.canvas; const v = c.view
    const node = n => { const T = NT[n.type]; const media = ['image', 'ai_image', 'video', 'audio', 'compose', 'previz'].includes(n.type)
      return `<div class="nd${selNode === n.id ? ' sel' : ''}" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px"><span class="port i" data-pin="${n.id}"></span><span class="port o" data-pout="${n.id}"></span>
        <div class="nh" data-drag="${n.id}">${T[0]} <input value="${h(n.title || t(T[1], T[2]))}" data-ntitle="${n.id}"><button class="btn sm" data-ndel="${n.id}" style="padding:1px 6px">✕</button></div>
        <div class="nb">${n.type === 'text' || n.type === 'script' ? `<textarea data-ntext="${n.id}" placeholder="${n.type === 'script' ? t('Ý tưởng / đoạn truyện — Claude viết thành kịch bản', 'An idea — Claude turns it into a script') : t('Ghi chú, ý tưởng…', 'Notes, ideas…')}">${h(n.text || '')}</textarea>` : ''}
        ${['ai_image', 'video', 'audio'].includes(n.type) ? `<textarea data-nprompt="${n.id}" placeholder="${t('Prompt (Claude viết lại cho Higgsfield, dùng cả node nối vào)', 'Prompt (Claude rewrites it for Higgsfield using the wired nodes)')}">${h(n.prompt || '')}</textarea>` : ''}
        ${media ? `<div class="nm" data-nmedia="${n.media || ''}" data-ntype="${n.type}">${n.media ? '' : n.type === 'compose' ? t('Nối các node video vào đây', 'Wire video nodes in here') : n.type === 'previz' ? t('Chụp từ Play test', 'Grab from Play test') : t('Trống', 'Empty')}</div>` : ''}
        <div class="row">${['ai_image', 'video', 'audio', 'script'].includes(n.type) ? `<button class="btn sm pri" data-ngen="${n.id}"${pending('node_gen').some(q => q.data.id === n.id) ? ' disabled' : ''}>✨ ${t('Claude tạo', 'Claude makes')}</button>` : ''}
        ${n.type === 'compose' ? `<button class="btn sm pri" data-ncomp="${n.id}">🎞 ${t('Claude ghép', 'Claude joins')}</button>` : ''}${n.type === 'previz' ? `<button class="btn sm pri" data-nprev="${n.id}">📸 ${t('Chụp Play test', 'Grab Play test')}</button>` : ''}
        ${['image', 'audio', 'video'].includes(n.type) ? `<button class="btn sm" data-nup="${n.id}">⬆ ${t('Tải lên', 'Upload')}</button>` : ''}</div></div></div>` }
    return `<div class="fz" id="fz"><div class="fzhint">${t('Kéo nền = di chuyển · lăn chuột = zoom · bấm đúp = thêm node · kéo chấm xanh bên phải sang node khác = nối', 'Drag the background = pan · wheel = zoom · double-click = add · drag the right dot to another node = wire')}</div>
      <div class="fzw" id="fzw" style="transform:translate(${v.x}px,${v.y}px) scale(${v.z})"><svg id="fzs" width="1" height="1"></svg>${c.nodes.map(node).join('')}</div>
      <div class="fzbar">${Object.entries(NT).map(([k, T]) => `<button class="btn" data-nadd="${k}">${T[0]} ${t(T[1], T[2])}</button>`).join('')}<button class="btn" id="fzfit">⤢</button></div></div>` + waitBox(['node_gen', 'node_compose'])
  }
  function edgePath (a, b) {
    const ea = document.querySelector(`[data-node="${a}"]`), eb = document.querySelector(`[data-node="${b}"]`); if (!ea || !eb) return ''
    const x1 = ea.offsetLeft + ea.offsetWidth, y1 = ea.offsetTop + ea.offsetHeight / 2, x2 = eb.offsetLeft, y2 = eb.offsetTop + eb.offsetHeight / 2, d = Math.max(40, Math.abs(x2 - x1) / 2)
    return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`
  }
  function drawEdges () { const c = XP().canvas; const s = $('fzs'); if (!s) return; s.innerHTML = c.edges.map((e, i) => `<path d="${edgePath(e.a, e.b)}" data-edge="${i}"/>`).join('') + '<path id="fztmp" style="stroke-dasharray:6 5"/>'; s.querySelectorAll('[data-edge]').forEach(p => { p.onclick = () => { c.edges.splice(+p.dataset.edge, 1); save(); drawEdges() } }) }
  function addNode (type, x, y) { const c = XP().canvas; const id = 'n' + (++c.seq); c.nodes.push({ id, type, x: Math.round(x), y: Math.round(y), title: '', text: '', prompt: '', media: null }); selNode = id; save(); render() }
  function inputsOf (id) { const c = XP().canvas; return c.edges.filter(e => e.b === id).map(e => c.nodes.find(n => n.id === e.a)).filter(Boolean) }
  function wireFree () {
    const p = XP(); const c = p.canvas; const fz = $('fz'), w = $('fzw'); if (!fz) return
    const apply = () => { w.style.transform = `translate(${c.view.x}px,${c.view.y}px) scale(${c.view.z})` }
    const toWorld = (cx, cy) => { const r = fz.getBoundingClientRect(); return [(cx - r.left - c.view.x) / c.view.z, (cy - r.top - c.view.y) / c.view.z] }
    drawEdges()
    let pan = null
    fz.onpointerdown = e => { if (e.target !== fz && e.target !== w) return; selNode = null; document.querySelectorAll('.nd.sel').forEach(n => n.classList.remove('sel')); pan = { x: e.clientX - c.view.x, y: e.clientY - c.view.y }; fz.classList.add('pan'); fz.setPointerCapture(e.pointerId) }
    fz.onpointermove = e => { if (pan) { c.view.x = e.clientX - pan.x; c.view.y = e.clientY - pan.y; apply() } }
    fz.onpointerup = () => { if (pan) { pan = null; fz.classList.remove('pan'); save() } }
    fz.onwheel = e => { e.preventDefault(); const r = fz.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const z = Math.min(2.5, Math.max(0.25, c.view.z * (e.deltaY < 0 ? 1.1 : 0.9))); c.view.x = mx - (mx - c.view.x) * z / c.view.z; c.view.y = my - (my - c.view.y) * z / c.view.z; c.view.z = z; apply(); save() }
    fz.ondblclick = e => { if (e.target !== fz && e.target !== w) return; const [x, y] = toWorld(e.clientX, e.clientY); addNode('text', x - 125, y - 40) }
    document.querySelectorAll('[data-nadd]').forEach(b => { b.onclick = () => { const r = fz.getBoundingClientRect(); const [x, y] = toWorld(r.left + r.width / 2 + (Math.random() - 0.5) * 160, r.top + r.height / 2 + (Math.random() - 0.5) * 120); addNode(b.dataset.nadd, x - 125, y - 60) } })
    $('fzfit').onclick = () => { if (!c.nodes.length) return; const xs = c.nodes.map(n => n.x), ys = c.nodes.map(n => n.y); const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 260, y1 = Math.max(...ys) + 320; const r = fz.getBoundingClientRect(); const z = Math.min(1.2, Math.max(0.25, Math.min(r.width / (x1 - x0 + 80), (r.height - 90) / (y1 - y0 + 140)))); c.view = { x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: (r.height - (y1 - y0) * z) / 2 - y0 * z + 20, z }; apply(); save() }
    // node drag
    document.querySelectorAll('[data-drag]').forEach(hd => { hd.onpointerdown = e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; const n = c.nodes.find(x => x.id === hd.dataset.drag); const el = hd.parentElement; selNode = n.id; document.querySelectorAll('.nd.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y; hd.setPointerCapture(e.pointerId); hd.onpointermove = ev => { n.x = Math.round(ox + (ev.clientX - sx) / c.view.z); n.y = Math.round(oy + (ev.clientY - sy) / c.view.z); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; drawEdges() }; hd.onpointerup = () => { hd.onpointermove = null; save() } } })
    // wiring
    document.querySelectorAll('[data-pout]').forEach(po => { po.onpointerdown = e => { e.stopPropagation(); const a = po.dataset.pout; const tmp = $('fztmp'); const ea = po.parentElement; const x1 = ea.offsetLeft + ea.offsetWidth, y1 = ea.offsetTop + ea.offsetHeight / 2; po.setPointerCapture(e.pointerId)
      po.onpointermove = ev => { const [x, y] = toWorld(ev.clientX, ev.clientY); tmp.setAttribute('d', `M${x1},${y1} C${x1 + 60},${y1} ${x - 60},${y} ${x},${y}`) }
      po.onpointerup = ev => { po.onpointermove = null; tmp.setAttribute('d', ''); const tgt = document.elementsFromPoint(ev.clientX, ev.clientY).map(el => el.closest && el.closest('[data-node]')).find(Boolean); const b = tgt && tgt.dataset.node; if (b && b !== a && !c.edges.some(x => x.a === a && x.b === b)) { c.edges.push({ a, b }); save() } drawEdges() } } })
    // node fields
    document.querySelectorAll('[data-ntitle]').forEach(el => { el.oninput = () => { c.nodes.find(n => n.id === el.dataset.ntitle).title = el.value; save() } })
    document.querySelectorAll('[data-ntext]').forEach(el => { el.oninput = () => { c.nodes.find(n => n.id === el.dataset.ntext).text = el.value; save() } })
    document.querySelectorAll('[data-nprompt]').forEach(el => { el.oninput = () => { c.nodes.find(n => n.id === el.dataset.nprompt).prompt = el.value; save() } })
    document.querySelectorAll('[data-ndel]').forEach(b => { b.onclick = () => { const id = b.dataset.ndel; c.nodes = c.nodes.filter(n => n.id !== id); c.edges = c.edges.filter(e => e.a !== id && e.b !== id); save(); render() } })
    document.querySelectorAll('[data-nup]').forEach(b => { b.onclick = () => { const n = c.nodes.find(x => x.id === b.dataset.nup); upX = { kind: 'node', id: n.id }; (n.type === 'audio' ? $('faud') : n.type === 'video' ? $('fvid') : $('fimg2')).click() } })
    document.querySelectorAll('[data-ngen]').forEach(b => { b.onclick = () => { const n = c.nodes.find(x => x.id === b.dataset.ngen); ask('node_gen', { id: n.id, type: n.type, inputs: inputsOf(n.id).map(x => x.id) }, t(`Freezone: tạo ${t(NT[n.type][1], NT[n.type][2])} "${n.title || n.id}"`, `Freezone: make ${NT[n.type][2]} "${n.title || n.id}"`)) } })
    document.querySelectorAll('[data-ncomp]').forEach(b => { b.onclick = () => { const id = b.dataset.ncomp; ask('node_compose', { id, inputs: inputsOf(id).map(x => x.id) }, t('Freezone: ghép các video nối vào', 'Freezone: join the wired videos')) } })
    document.querySelectorAll('[data-nprev]').forEach(b => { b.onclick = async () => { try { const fr = [...parent.document.querySelectorAll('iframe')].find(f => /playtest\.html/.test(f.src)); const pt = fr && fr.contentWindow.__playtest; if (!pt) { parent.__gbGo && parent.__gbGo('playtest'); alert(t('Đã mở Play test: dựng cảnh, đặt camera, quay lại đây bấm 📸.', 'Play test opened: block the shot, come back and press 📸.')); return } pt.renderer.render(pt.scene, pt.camera); const blob = await new Promise(r => pt.renderer.domElement.toBlob(r, 'image/jpeg', 0.9)); const n = c.nodes.find(x => x.id === b.dataset.nprev); n.media = await putMedia(`${p.id}/node/${n.id}/${Date.now()}`, blob); save(); render() } catch { alert(t('Mở trang này trong Greenbox Cockpit.', 'Open this page inside the Greenbox Cockpit.')) } } })
    // node media
    ;(async () => { for (const el of document.querySelectorAll('[data-nmedia]')) { const k = el.dataset.nmedia; if (!k) continue; const u = await url(k); if (!u) continue; const b = await idb.get(k); const ty = b && b.type || ''; el.innerHTML = /^video/.test(ty) ? `<video src="${u}" controls muted></video>` : /^audio/.test(ty) ? `<audio src="${u}" controls></audio>` : `<img src="${u}" alt="">` } drawEdges() })()
  }
  // the old video upload input also serves video nodes
  const fv = $('fvid'); const fvOld = fv.onchange
  fv.onchange = async e => { if (upX && upX.kind === 'node') { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const p = XP(); const n = p.canvas.nodes.find(x => x.id === upX.id); if (n) n.media = await putMedia(`${p.id}/node/${n.id}/${Date.now()}`, f); upX = null; save(); render(); return } return fvOld(e) }

  /* ---------------- the API Claude uses: new actions ---------------- */
  const D = window.__gbDrama; const getOld = D.get
  D.get = function () {
    const p = XP(); const g = getOld()
    return { ...g, style: { name: p.style.name, prompt: p.style.prompt, has_reference: !!p.style.ref }, scenes: p.scenes.map(a => ({ name: a.name, look: a.look, has_picture: !!a.img })), props: p.props.map(a => ({ name: a.name, look: a.look, has_picture: !!a.img })),
      voices: [{ name: '__narrator', desc: p.narrator.desc, has_sample: !!p.narrator.sample }].concat(p.chars.map(c => ({ name: c.name, desc: c.voice.desc, has_sample: !!c.voice.sample }))),
      compose: p.compose, chat: p.chat.slice(-12), freezone: { nodes: p.canvas.nodes.map(n => ({ id: n.id, type: n.type, title: n.title, text: n.text, prompt: n.prompt, has_media: !!n.media })), edges: p.canvas.edges },
      audio: allBeats().map(x => ({ ep: x.i, beat: x.j, has_voice: !!x.b.voice })), music: eps().map((e, i) => ({ ep: i, has_music: !!e.music })) }
  }
  /** a scene / prop / character: {kind: 'scene'|'prop'|'char', name, look?, new_name?, data_b64?, mime?} (creates scenes / props when new) */
  D.asset = async function (a) {
    const p = XP(); const k = a.kind === 'scene' || a.kind === 'scenes' ? 'scenes' : a.kind === 'prop' || a.kind === 'props' ? 'props' : 'chars'
    if (k === 'chars') return await D.char(a)
    let x = p[k].find(v => v.name.toLowerCase() === String(a.name).toLowerCase()); if (!x) { x = { name: a.name, look: '', img: null }; p[k].push(x) }
    if (a.new_name) x.name = a.new_name; if (a.look !== undefined) x.look = a.look
    if (a.data_b64) x.img = await putMedia(`${p.id}/${k}/${Date.now()}`, b64blob(a.data_b64, a.mime || 'image/png'))
    p.mode = 'series'; p.tab = 'chars'; p.atab = k; log('claude', t(`${k === 'scenes' ? 'Bối cảnh' : 'Đạo cụ'}: ${x.name}${a.data_b64 ? ' (ảnh)' : ''}`, `${k === 'scenes' ? 'Scene' : 'Prop'}: ${x.name}${a.data_b64 ? ' (picture)' : ''}`)); save(); render(); return 'ok'
  }
  /** voice: {ep, beat, data_b64} = a beat's voice-over · {name, data_b64, desc?} = a character's (or '__narrator') sample */
  D.voice = async function (a) {
    const p = XP()
    if (a.name !== undefined) { const v = a.name === '__narrator' ? p.narrator : (charByName(a.name) || {}).voice; if (!v) throw new Error('no character ' + a.name); if (a.desc !== undefined) v.desc = a.desc; if (a.data_b64) v.sample = await putMedia(`${p.id}/voice/${Date.now()}`, b64blob(a.data_b64, a.mime || 'audio/mpeg')); p.tab = 'chars'; p.atab = 'voices' } else {
      const b = eps()[a.ep]?.beats?.[a.beat]; if (!b) throw new Error('no beat'); b.voice = await putMedia(`${p.id}/bvoice/${a.ep}/${a.beat}/${Date.now()}`, b64blob(a.data_b64, a.mime || 'audio/mpeg')); p.tab = 'audio'; p.ep = a.ep }
    p.mode = 'series'; log('claude', t('Giọng: ', 'Voice: ') + (a.name ?? `${t('nhịp', 'beat')} ${a.beat + 1}`)); save(); render(); return 'ok'
  }
  /** music for an episode: {ep, data_b64} */
  D.music = async function (a) { const p = XP(); const e = eps()[a.ep]; if (!e) throw new Error('no episode'); e.music = await putMedia(`${p.id}/music/${a.ep}/${Date.now()}`, b64blob(a.data_b64, a.mime || 'audio/mpeg')); p.mode = 'series'; p.tab = 'audio'; p.ep = a.ep; log('claude', t(`Nhạc nền tập ${a.ep + 1}`, `Music for ep. ${a.ep + 1}`)); save(); render(); return 'ok' }
  /** the project style: {name?, prompt?} */
  D.style = function (a) { const p = XP(); if (a.name !== undefined) p.style.name = a.name; if (a.prompt !== undefined) p.style.prompt = a.prompt; p.mode = 'series'; p.tab = 'style'; log('claude', t('Phong cách: ', 'Style: ') + (p.style.name || p.style.prompt.slice(0, 40))); save(); render(); return 'ok' }
  /** a Freezone node: {id, title?, text?, prompt?, data_b64?, mime?} — or {type, title, text, x, y} with no id to add one */
  D.node = async function (a) {
    const p = XP(); const c = p.canvas; let n = a.id && c.nodes.find(x => x.id === a.id)
    if (!n) { n = { id: 'n' + (++c.seq), type: a.type || 'text', x: a.x ?? (a.from && c.nodes.find(q => q.id === a.from) ? c.nodes.find(q => q.id === a.from).x + 330 : 60 + (c.nodes.length % 4) * 330), y: a.y ?? (a.from && c.nodes.find(q => q.id === a.from) ? c.nodes.find(q => q.id === a.from).y : 70 + Math.floor(c.nodes.length / 4) * 330), title: '', text: '', prompt: '', media: null }; c.nodes.push(n) }
    for (const k of ['title', 'text', 'prompt']) if (a[k] !== undefined) n[k] = a[k]
    if (a.data_b64) n.media = await putMedia(`${p.id}/node/${n.id}/${Date.now()}`, b64blob(a.data_b64, a.mime || 'image/png'))
    if (a.from) c.edges.push({ a: a.from, b: n.id })
    p.mode = 'free'; selNode = n.id; log('claude', 'Freezone: ' + (n.title || n.id)); save(); render(); return n.id
  }
  /** Xia Director answer */
  D.reply = function (a) { const p = XP(); p.chat.push({ who: 'claude', text: String(a.text || ''), t: Date.now() }); dir.classList.add('open'); lastClaude = Date.now(); save(); render(); return 'ok' }
  /** a stored picture / clip / voice as a file (the MCP saves it so Claude can look at it): {what: 'style'|'char'|'scene'|'prop'|'still'|'clip'|'voice'|'music'|'node', name?, ep?, beat?, id?} */
  D.media_out = async function (a) {
    const p = XP(); let k = null
    if (a.what === 'style') k = p.style.ref
    if (a.what === 'char') k = (charByName(a.name) || {}).img
    if (a.what === 'scene' || a.what === 'prop') k = (p[a.what + 's'].find(x => x.name === a.name) || {}).img
    if (['still', 'clip', 'voice'].includes(a.what)) k = eps()[a.ep]?.beats?.[a.beat]?.[a.what]
    if (a.what === 'music') k = eps()[a.ep]?.music
    if (a.what === 'node') k = (p.canvas.nodes.find(n => n.id === a.id) || {}).media
    if (!k) throw new Error('nothing stored for ' + JSON.stringify(a))
    const b = await idb.get(k); const ext = (b.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('mpeg', 'mp3').replace('quicktime', 'mov')
    return { name: `${a.what}${a.name ? '_' + a.name : ''}${a.ep !== undefined ? '_ep' + (a.ep + 1) : ''}${a.beat !== undefined ? '_b' + (a.beat + 1) : ''}${a.id ? '_' + a.id : ''}.${ext}`, b64: await blobB64(b) }
  }
  /** srt text of an episode (the MCP burns it in when compose.subs) */
  D.srt = function (a) { return srt(a.ep) }


  /* ---------------- ⚡ any API: the page answers its own text requests with the key the user saved (shared with the Cockpit's 🤖 AI chat:
     localStorage gb.ai.cfg = {prov, base, model, key, imodel}). Anthropic, OpenAI, Gemini, OpenRouter, Ollama or any OpenAI-compatible URL.
     Mode (gb.drama.engine): auto = Claude over MCP when it is listening, else the API key · api = always the key · claude = always Claude.
     Text kinds are answered here; pictures too when an image model is set (OpenAI-compatible /images/generations); video / voice / music
     stay with Claude + Higgsfield or the upload buttons. ---------------- */
  const PRE = {
    anthropic: { label: 'Anthropic (Claude)', base: 'https://api.anthropic.com', kind: 'anthropic', model: 'claude-sonnet-5-5' },
    openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', kind: 'openai', model: 'gpt-4o-mini' },
    gemini: { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai', model: 'gemini-2.0-flash' },
    openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', kind: 'openai', model: 'openai/gpt-4o-mini' },
    ollama: { label: 'Ollama (máy này · free)', base: 'http://localhost:11434/v1', kind: 'openai', model: 'llama3.1' },
    custom: { label: 'OpenAI-compatible URL', base: '', kind: 'openai', model: '' }
  }
  const LS = 'gb.ai.cfg'
  const cfg = () => { let c = {}; try { c = JSON.parse(localStorage.getItem(LS) || '{}') } catch {} const pr = PRE[c.prov] ? c.prov : 'anthropic'; return { ...c, prov: pr, base: (c.base || PRE[pr].base || '').replace(/\/$/, ''), model: c.model || PRE[pr].model } }
  const mode = () => { try { return localStorage.getItem('gb.drama.engine') || 'auto' } catch { return 'auto' } }
  const ready = () => { const c = cfg(); return !!(c.base && c.model && (c.key || c.prov === 'ollama' || c.prov === 'custom')) }
  async function llm (system, user, max) {
    const c = cfg(); let r, j
    if (PRE[c.prov].kind === 'anthropic') {
      r = await fetch(c.base + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: c.model, max_tokens: max || 8000, system, messages: [{ role: 'user', content: user }] }) })
      j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && j.error.message) || r.statusText || 'HTTP ' + r.status)
      if (j.stop_reason === 'refusal') throw new Error(t('Model từ chối nội dung này.', 'The model declined this content.'))
      return { text: (j.content || []).filter(x => x.type === 'text').map(x => x.text).join(''), cut: j.stop_reason === 'max_tokens' }
    }
    const hd = { 'content-type': 'application/json' }; if (c.key) hd.authorization = 'Bearer ' + c.key
    r = await fetch(c.base + '/chat/completions', { method: 'POST', headers: hd, body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
    j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || r.statusText || 'HTTP ' + r.status)
    const m = j.choices && j.choices[0] && j.choices[0].message; const ct = m ? m.content : ''
    return { text: Array.isArray(ct) ? ct.map(x => x.text || '').join('') : String(ct || ''), cut: j.choices && j.choices[0] && j.choices[0].finish_reason === 'length' }
  }
  async function llmJson (user, max) {
    const SYS = 'You are the head writer and director of a vertical micro-drama studio (TikTok / Reels / Shorts). Write story text in the language of the story (Vietnamese when the story is Vietnamese); picture and video prompts are always English. Answer with ONE JSON value only: no markdown fences, no comments, no text before or after.'
    for (let k = 0; k < 2; k++) {
      const o = await llm(SYS, user + (k ? '\nYour last answer was not valid JSON. Answer again, JSON only, shorter text if needed.' : ''), max)
      let x = o.text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, ''); const a = x.search(/[{[]/), b = Math.max(x.lastIndexOf('}'), x.lastIndexOf(']'))
      try { return JSON.parse(x.slice(a, b + 1)) } catch (e) { if (k) throw new Error(o.cut ? t('Câu trả lời bị cắt (quá dài cho model này): giảm số tập / thời lượng hoặc đổi model.', 'The answer was cut (too long for this model): fewer episodes / shorter, or another model.') : t('Model không trả JSON hợp lệ: thử lại hoặc đổi model.', 'The model did not return valid JSON: try again or another model.')) }
    }
  }
  async function llmImage (prompt, ratio) {
    const c = cfg(); const hd = { 'content-type': 'application/json' }; if (c.key) hd.authorization = 'Bearer ' + c.key
    const size = ratio === '16:9' ? '1536x1024' : ratio === '1:1' ? '1024x1024' : '1024x1536'
    const r = await fetch(c.base + '/images/generations', { method: 'POST', headers: hd, body: JSON.stringify({ model: c.imodel, prompt, size, n: 1 }) })
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || r.statusText || 'HTTP ' + r.status)
    const d = j.data && j.data[0]; if (!d) throw new Error('no image in the answer')
    if (d.b64_json) return { data_b64: d.b64_json, mime: 'image/png' }
    const b = await (await fetch(d.url)).blob(); return { data_b64: await blobB64(b), mime: b.type || 'image/png' }
  }
  const canImage = () => { const c = cfg(); return ready() && !!c.imodel && PRE[c.prov].kind === 'openai' }
  const J = x => JSON.stringify(x)
  /** what makes a micro-drama work: the same rules go to Claude in gb_drama's description (gb-ai/tools.js DRAMA_HOW) */
  const rules = s => `\nQUALITY RULES: made for a phone screen. Each episode opens with a hook inside the first 3 seconds (a conflict, a shock or a question) and ends on a cliffhanger; the last one pays everything off. One beat = one shot = one place + one clear action that a ${s.clip}-second clip can show. Lines are spoken aloud: at most ${Math.floor(s.clip * 3)} words in a beat, everyday speech, no narration unless who is "Narrator". "chars" holds only names from the chars list. "look" = English picture prompt: age, face, hair, outfit, one signature item, ${s.style} style, ${s.country}; the same person in every shot. "prompt" = English image-to-video prompt in this order: shot size + camera move, who (name + 3-word look) does what, place, light, mood, style, aspect ${s.ratio}; no text on screen. Genre: ${s.genre}.`
  const BEAT = '{"scene","chars":["names"],"action","lines":[{"who","text"}],"sec","prompt"}'
  const outline = g => J({ title: g.script.title, logline: g.script.logline, chars: g.chars.map(c => ({ name: c.name, role: c.role, look: c.look })), eps: g.script.eps.map((e, i) => ({ ep: i, title: e.title, hook: e.hook, summary: e.summary, segs: e.segs })) })
  const epJson = (g, i) => J({ summary: g.script.eps[i].summary, beats: (g.script.eps[i].beats || []).map(b => ({ seg: b.seg, scene: b.scene, chars: b.chars, action: b.action, lines: b.lines, sec: b.sec, prompt: b.prompt })) })
  const nBeats = s => Math.max(1, Math.round(Math.min(lenOf(s), SEG_SEC) / s.clip))
  const KIND = {
    async write_script (q, g) {
      const s = g.settings; const single = s.type === 'single'; const n = single ? 1 : +s.eps_n; const set = { ...s }; delete set.text
      const o = await llmJson(`Plan the drama from the STORY: title, logline, the characters and ${single ? 'ONE film (eps has exactly 1 entry) of about ' + lenOf(s) + ' s' : n + ' episodes of about ' + lenOf(s) + ' s each'}.` + (s.long ? ` LONG form: every episode has "segs" = ${s.parts_per_episode} parts [{"title","summary","sec"}] of about ${SEG_SEC} s.` : '') + `\nSETTINGS ${J(set)}${g.style.prompt ? '\nSTYLE ' + g.style.prompt : ''}${rules(s)}\nJSON: {"title","logline","chars":[{"name","role","look"}],"eps":[{"title","hook","summary"${s.long ? ',"segs":[{"title","summary","sec"}]' : ''}}]}\nSTORY:\n${s.text}`, 6000)
      o.eps = (o.eps || []).slice(0, n).map(e => ({ ...e, beats: [] })); if (!o.eps.length) throw new Error('no episodes in the answer')
      D.script(o); let prev = ''
      for (let i = 0; i < o.eps.length; i++) {
        D.say(t(`Đang viết ${single ? 'phim' : 'tập ' + (i + 1) + '/' + o.eps.length}…`, `Writing ${single ? 'the film' : 'ep. ' + (i + 1) + '/' + o.eps.length}…`))
        const g2 = D.get(); const b = await llmJson(`Write the beats of ${single ? 'the film' : 'episode ' + (i + 1)}${s.long ? ', part 1 only' : ''}: about ${nBeats(s)} beats, each "sec": ${s.clip}${s.long ? '' : ', so they add up to ' + lenOf(s) + ' s'}.\nPLAN ${outline(g2)}${prev ? '\nPREVIOUS EPISODE ENDED WITH ' + prev : ''}${rules(s)}\nJSON: {"beats":[${BEAT}]}`, 8000)
        const beats = (Array.isArray(b) ? b : b.beats || []).map(x => ({ ...x, seg: 0 })); prev = J(beats.slice(-2).map(x => ({ action: x.action, lines: x.lines })))
        if (s.long) D.beats({ ep: i, seg: 0, beats }); else D.script({ beats }, i)
      }
      const p = XP(); p.ep = 0; p.tab = 'script'; save(); render()
    },
    async rewrite_episode (q, g) { await KIND.fix_qc(q, g) },
    async fix_qc (q, g) {
      const s = g.settings; const i = q.data.ep
      const o = await llmJson(`Rewrite ${s.type === 'single' ? 'the film' : 'episode ' + (i + 1)} so it is stronger${q.data.issues ? ' and fix exactly these problems: ' + J(q.data.issues) : ' (sharper hook, tighter lines, clearer action, a real cliffhanger)'}. Keep the plot, the characters and the number of beats (each "sec": ${s.clip})${s.long ? '; keep every beat\'s "seg"' : ''}.\nPLAN ${outline(g)}\nNOW ${epJson(g, i)}${rules(s)}\nJSON: {"summary","beats":[${s.long ? BEAT.replace('{', '{"seg",') : BEAT}]}`, 8000)
      D.script({ summary: o.summary || g.script.eps[i].summary, beats: o.beats || [] }, i)
    },
    async write_beats (q, g) {
      const s = g.settings; const { ep, seg } = q.data; const e = g.script.eps[ep]; const before = (e.beats || []).filter(b => (b.seg || 0) === seg - 1).slice(-3)
      const o = await llmJson(`Write the beats of part ${seg + 1} of ${s.type === 'single' ? 'the film' : 'episode ' + (ep + 1)}: about ${Math.round((+e.segs[seg].sec || SEG_SEC) / s.clip)} beats, each "sec": ${s.clip}. This part: ${J(e.segs[seg])}.\nPLAN ${outline(g)}${before.length ? '\nTHE PART BEFORE ENDED WITH ' + J(before.map(b => ({ action: b.action, lines: b.lines }))) : ''}${rules(s)}\nJSON: {"beats":[${BEAT}]}`, 8000)
      D.beats({ ep, seg, beats: Array.isArray(o) ? o : o.beats || [] })
    },
    async prompt_beat (q, g) {
      const s = g.settings; const { ep, beat, idea } = q.data; const b = g.script.eps[ep].beats[beat]
      const o = await llmJson(`Write two English prompts for this beat. "img_prompt" = the first frame as a picture (who, pose, place, light, lens, ${s.style}, aspect ${s.ratio}). "prompt" = image-to-video for ${b.sec} s (shot size + camera move, action, mood).${idea ? ' The user wants: ' + idea + '.' : ''}\nBEAT ${J({ scene: b.scene, chars: b.chars, action: b.action, lines: b.lines })}\nCHARACTERS ${J(g.chars.filter(c => (b.chars || []).includes(c.name)).map(c => ({ name: c.name, look: c.look })))}${g.style.prompt ? '\nSTYLE ' + g.style.prompt : ''}\nJSON: {"img_prompt","prompt"}`, 1500)
      D.prompts({ ep, beat, img_prompt: o.img_prompt, prompt: o.prompt })
    },
    async name_hooks (q, g) {
      const o = await llmJson(`Give each of these episodes a short title (2–5 words) and a hook = what the viewer sees / hears in the first 3 seconds that makes them stay. Episodes: ${J(q.data.eps)}.\nPLAN ${outline(g)}\nJSON: [{"ep","title","hook"}]`, 3000)
      for (const x of (Array.isArray(o) ? o : o.eps || [])) if (g.script.eps[+x.ep]) D.episode({ ep: +x.ep, title: x.title, hook: x.hook })
    },
    async extract_assets (q, g) {
      const sc = q.data.kind === 'scenes'
      const o = await llmJson(`List every ${sc ? 'place (scene / location)' : 'important prop (object the story needs to show)'} of this drama, each once. "look" = English picture prompt (${sc ? 'wide establishing shot, no people, time of day, light' : 'the object alone on a plain background'}, ${g.settings.style} style).\nSCRIPT ${J(g.script.eps.map(e => (e.beats || []).map(b => ({ scene: b.scene, action: b.action }))))}\nJSON: [{"name","look"}]`, 3000)
      for (const x of (Array.isArray(o) ? o : o.items || []).slice(0, 24)) if (x && x.name) await D.asset({ kind: sc ? 'scene' : 'prop', name: String(x.name), look: x.look || '' })
    },
    async director (q, g) {
      const o = await llm('You are Xia Director, the showrunner of this micro-drama. Give short, concrete notes (what to change, in which episode / beat, and why it keeps viewers). Answer in the user\'s language, plain text, at most 8 lines.', `PROJECT ${g.script ? outline(g) : J({ story: String(g.settings.text || '').slice(0, 4000) })}\nUSER: ${q.data.text}`, 1500)
      D.reply({ text: o.text.trim() })
    },
    async char_image (q, g) { for (const n of q.data.names || [q.data.name]) { const c = g.chars.find(x => x.name === n); if (!c) continue; await D.char({ name: n, source: cfg().imodel, ...(await llmImage(`Character portrait, waist up, plain light background. ${c.look}. ${g.style.prompt || g.settings.style + ' style'}`, '2:3')) }) } },
    async asset_image (q, g) { const k = q.data.kind; for (const n of q.data.names || [q.data.name]) { const a = (g[k] || []).find(x => x.name === n); if (!a) continue; await D.asset({ kind: k, name: n, ...(await llmImage(`${a.look}. ${g.style.prompt || g.settings.style + ' style'}`, k === 'scenes' ? '16:9' : '1:1')) }) } },
    async gen_image (q, g) { const { ep, beat } = q.data; const b = g.script.eps[ep].beats[beat]; D.beat({ ep, beat, status: 'img' }); try { await D.still({ ep, beat, ...(await llmImage(`${b.img_prompt || b.prompt || b.action}. ${g.style.prompt || g.settings.style + ' style'}`, g.settings.ratio)) }) } catch (e) { D.beat({ ep, beat, status: 'todo' }); throw e } }
  }
  const IMG = ['char_image', 'asset_image', 'gen_image']
  const takes = kind => mode() !== 'claude' && !!KIND[kind] && (IMG.includes(kind) ? canImage() : ready()) && (mode() === 'api' || busy > 0 || !claudeState().live)
  let chain = Promise.resolve(); let busy = 0
  function run (q) {
    chain = chain.then(async () => {
      const pid = S.cur; const lc = lastClaude // the log lines below must not look like Claude listening over MCP
      try { await KIND[q.kind](q, D.get()); if (S.cur === pid) D.done(q.id, '⚡ ' + q.eng); else q.status = 'done' } catch (e) {
        q.status = 'fail'; const m = String(e && e.message || e)
        log('claude', `#${q.id} ✗ ${q.label} — ⚡ ${q.eng}: ${/Failed to fetch|NetworkError|Load failed/.test(m) ? t('không gọi được API (mạng, URL hoặc nhà cung cấp chặn gọi từ trình duyệt). Mở 🔌 để kiểm tra.', 'the API could not be reached (network, URL, or the provider blocks browser calls). Open 🔌 to check.') : m}`); save(); render()
      }
      busy--; lastClaude = lc; drawClaude()
    })
  }
  const _ask = ask
  ask = function (kind, data, label) { // eslint-disable-line no-global-assign
    if (!takes(kind)) return _ask(kind, data, label)
    const p = P(); const q = { id: ++p.seq, kind, data: data || {}, label, t: Date.now(), status: 'wait', eng: cfg().model }
    p.queue.push(q); busy++; log('user', label + ' → ⚡ ' + q.eng); render(); run(q)
  }
  const _waitBox = waitBox
  waitBox = function (kinds) { // eslint-disable-line no-global-assign
    const w = P().queue.filter(q => q.status === 'wait' && kinds.includes(q.kind)); if (!w.some(q => q.eng)) return _waitBox(kinds)
    return w.map(q => `<div class="wait"><div class="spin"></div><div><b>#${q.id}</b> ${h(q.label)}<br><span class="small">${q.eng ? '⚡ ' + h(q.eng) + t(' đang làm bằng API key của bạn, kết quả hiện ở đây ngay khi xong.', ' is working with your API key; the result shows here as soon as it is ready.') : t('Claude đang làm qua MCP, kết quả hiện ở đây ngay khi xong.', 'Claude is working over MCP; the result shows here as soon as it is ready.')}</span></div></div>`).join('')
  }
  // a request the API was answering when the page closed can never finish: free its button
  Object.values(S.projects).forEach(p => (p.queue || []).forEach(q => { if (q.eng && q.status === 'wait') q.status = 'fail' }))
  const _drawClaude = drawClaude
  drawClaude = function () { // eslint-disable-line no-global-assign
    _drawClaude(); const c = claudeState(); if (c.live && mode() !== 'api') return; if (mode() === 'claude' || !ready()) return
    const w = pending().filter(q => q.eng).length
    $('cl').className = 'claude on' + (w ? ' work' : ''); $('clt').textContent = '⚡ ' + cfg().model + (w ? t(` · đang làm ${w} việc`, ` · working ${w}`) : t(' · sẵn sàng', ' · ready'))
  }
  const _drawHow = drawHow
  drawHow = function () { // eslint-disable-line no-global-assign
    const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest('#engbox'); if (keep) return // do not redraw under the user's typing
    _drawHow(); const c = cfg(); const m = mode(); const box = document.createElement('div'); box.id = 'engbox'; box.className = 'panel'; box.style.cssText = 'margin:8px 0 12px;padding:12px 14px'
    box.innerHTML = `<b>⚡ ${t('Dùng API nào cũng được', 'Use any API')}</b>
      <div class="mut small" style="margin:2px 0 8px">${t('Có key là chạy, không cần Claude: viết kịch bản, viết nhịp, prompt, hook, bối cảnh / đạo cụ, QC, Xia Director. Ảnh: điền thêm model ảnh. Video / giọng / nhạc: Claude + Higgsfield hoặc nút ⬆ tải lên.', 'A key is enough, no Claude needed: script, beats, prompts, hooks, scenes / props, QC, Xia Director. Pictures: also fill the image model. Video / voice / music: Claude + Higgsfield or the ⬆ upload buttons.')}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${[['auto', t('Tự động', 'Auto')], ['api', 'API key'], ['claude', 'Claude MCP']].map(x => `<button class="btn sm${m === x[0] ? ' pri' : ''}" data-eng="${x[0]}">${x[1]}</button>`).join('')}<span class="mut small">${m === 'auto' ? t('Claude đang nghe thì Claude làm, không thì API key.', 'Claude when it is listening, else the API key.') : m === 'api' ? t('Luôn dùng API key.', 'Always the API key.') : t('Luôn gửi cho Claude qua MCP.', 'Always Claude over MCP.')}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <select id="engprov">${Object.entries(PRE).map(([k, v]) => `<option value="${k}"${c.prov === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
        <input id="engmodel" placeholder="model" value="${h(c.model)}">
        <input id="engbase" placeholder="https://…/v1" value="${h(c.base)}" style="grid-column:1/3">
        <input id="engkey" type="password" autocomplete="off" placeholder="API key (${t('chỉ lưu trong trình duyệt này', 'stays in this browser')})" value="${h(c.key || '')}" style="grid-column:1/3">
        <input id="engimg" placeholder="${t('model ảnh, vd. gpt-image-1 (không bắt buộc)', 'image model, e.g. gpt-image-1 (optional)')}" value="${h(c.imodel || '')}" style="grid-column:1/3">
      </div>
      <div class="row" style="gap:6px;margin-top:8px"><button class="btn sm pri" id="engsave">${t('Lưu', 'Save')}</button><button class="btn sm" id="engtest">${t('Thử kết nối', 'Test')}</button><span class="small" id="engmsg">${ready() ? '✓ ' + h(c.model) : t('Chưa có key.', 'No key yet.')}</span></div>`
    box.querySelectorAll('input,select').forEach(el => { el.style.cssText += ';background:rgba(0,0,0,.35);color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 9px;font:inherit;min-width:0;box-sizing:border-box;width:100%' })
    const hb = $('howbox'); hb.insertBefore(box, hb.children[1] || null)
    const put = () => { let o = {}; try { o = JSON.parse(localStorage.getItem(LS) || '{}') } catch {} o.prov = $('engprov').value; o.model = $('engmodel').value.trim() || PRE[o.prov].model; o.base = $('engbase').value.trim() || PRE[o.prov].base; o.key = $('engkey').value.trim(); o.imodel = $('engimg').value.trim(); try { localStorage.setItem(LS, J(o)) } catch {} drawClaude() }
    box.querySelectorAll('[data-eng]').forEach(b => { b.onclick = () => { put(); try { localStorage.setItem('gb.drama.engine', b.dataset.eng) } catch {} document.activeElement.blur(); drawHow() } })
    $('engprov').onchange = () => { const k = $('engprov').value; $('engbase').value = PRE[k].base; $('engmodel').value = PRE[k].model }
    $('engsave').onclick = () => { put(); $('engmsg').textContent = ready() ? '✓ ' + t('Đã lưu. Các nút AI trên trang giờ chạy bằng ', 'Saved. The AI buttons now run on ') + cfg().model : t('Thiếu key hoặc model.', 'Key or model missing.') }
    $('engtest').onclick = async () => { put(); const el = $('engmsg'); el.textContent = '…'; try { const o = await llm('Answer with the single word OK.', 'ping', 16); el.textContent = '✓ ' + cfg().model + ': ' + o.text.trim().slice(0, 40) } catch (e) { el.textContent = '✗ ' + String(e.message || e).slice(0, 160) } }
  }
  /* ---------------- QC: what a reviewer checks before spending render credits (no AI needed) ---------------- */
  function qc (i) {
    const p = XP(); const e = eps()[i]; const out = []; if (!e) return out
    const B = e.beats || []; const target = lenOf(p.src); const names = new Set(p.chars.map(c => c.name.toLowerCase())); const sum = B.reduce((a, b) => a + (+b.sec || 0), 0)
    if (!(e.segs && e.segs.length) && B.length && Math.abs(sum - target) > Math.max(5, target * 0.15)) out.push(t(`Tổng thời lượng ${fmtS(sum)}, mục tiêu ${fmtS(target)}`, `Total ${fmtS(sum)}, target ${fmtS(target)}`))
    if (!B.length) out.push(t('Chưa có nhịp nào', 'No beats yet'))
    B.forEach((b, j) => {
      const n = (b.lines || []).reduce((a, l) => a + String(l.text || '').trim().split(/\s+/).filter(Boolean).length, 0); const cap = Math.floor((+b.sec || p.src.clip) * 3.5); const tag = t(`Nhịp ${j + 1}: `, `Beat ${j + 1}: `)
      if (n > cap) out.push(tag + t(`thoại ${n} tiếng, quá dài cho ${b.sec}s (nên ≤ ${cap})`, `${n} words of dialogue is too long for ${b.sec}s (keep ≤ ${cap})`))
      if (!b.action && !n) out.push(tag + t('trống (không có hành động, không có thoại)', 'empty (no action, no lines)'))
      if (!b.prompt) out.push(tag + t('thiếu prompt video', 'no video prompt'))
      const un = (b.chars || []).filter(x => !names.has(String(x).toLowerCase())); if (un.length) out.push(tag + t('nhân vật chưa có trong danh sách: ', 'characters not in the list: ') + un.join(', '))
    })
    return out
  }
  function qcBox () {
    const p = XP(); const L = qc(p.ep); const busy = pending('fix_qc').some(q => q.data.ep === p.ep)
    if (!L.length) return `<div class="panel" style="margin-bottom:10px;padding:8px 12px"><span class="tag ok">✓ QC</span> <span class="mut small">${t('Thời lượng, độ dài thoại, prompt và nhân vật đều ổn. Duyệt được rồi.', 'Length, dialogue, prompts and characters all check out. Ready to approve.')}</span></div>`
    return `<div class="panel" style="margin-bottom:10px;padding:10px 12px"><div class="row" style="justify-content:space-between;gap:8px"><b>🔎 QC · ${L.length} ${t('điểm cần sửa', 'to fix')}</b><button class="btn sm pri" data-qcfix="${p.ep}"${busy ? ' disabled' : ''}>🛠 ${t('AI sửa giúp', 'AI fixes them')}</button></div><div class="mut small" style="margin-top:4px">${L.slice(0, 6).map(h).join('<br>')}${L.length > 6 ? `<br>… +${L.length - 6}` : ''}</div></div>`
  }
  const _pScript = pScript
  pScript = function () { const s = _pScript(); return P().script ? s.replace('<div class="split">', qcBox() + '<div class="split">') : s } // eslint-disable-line no-global-assign
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-qcfix]'); if (!b) return; const i = +b.dataset.qcfix; ask('fix_qc', { ep: i, issues: qc(i) }, t(`Sửa ${qc(i).length} lỗi QC${P().src.type === 'single' ? '' : ' tập ' + (i + 1)}`, `Fix ${qc(i).length} QC issues${P().src.type === 'single' ? '' : ', ep. ' + (i + 1)}`)) })
  const get2 = D.get; D.get = function () { const g = get2(); g.qc = eps().map((_, i) => ({ ep: i, issues: qc(i) })).filter(x => x.issues.length); return g }
  window.__gbDramaEngine = { cfg: () => { const c = cfg(); return { prov: c.prov, model: c.model, base: c.base, image_model: c.imodel || '', has_key: !!c.key } }, mode, ready, takes, qc }

  // Claude's "say" also shows in the Director chat while it is open
  const sayOld = D.say; D.say = function (text) { if (dir.classList.contains('open')) { XP().chat.push({ who: 'claude', text: String(text), t: Date.now() }); drawDir() } return sayOld(text) }
  render()
})()
