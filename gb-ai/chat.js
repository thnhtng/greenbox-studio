/* Greenbox AI chat — talk to any model with your own API key, attach images / video frames / the current 3D
   view, and let it drive Greenbox through the same tools as the MCP server (window.__gbTools).
   Providers: Anthropic (Messages API) and anything OpenAI-compatible (OpenAI, Gemini, OpenRouter, Groq,
   Ollama / LM Studio on this computer). The key stays in this browser (localStorage) and is sent only to the
   provider you choose. */
(function () {
  'use strict';
  const LS = 'gb.ai.cfg';
  const PRESETS = {
    anthropic: { label: 'Anthropic (Claude)', base: 'https://api.anthropic.com', kind: 'anthropic' },
    openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', kind: 'openai' },
    gemini: { label: 'Google Gemini (OpenAI-compatible)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai' },
    openrouter: { label: 'OpenRouter (many models)', base: 'https://openrouter.ai/api/v1', kind: 'openai' },
    ollama: { label: 'Ollama on this computer', base: 'http://localhost:11434/v1', kind: 'openai' },
    custom: { label: 'Other OpenAI-compatible URL', base: '', kind: 'openai' }
  };
  const SYSTEM = 'You are the assistant inside Greenbox 3D, a browser tool for rigging characters, animating vehicles, play-testing and video mocap for hyper-casual mobile game ads (low-poly, mechanical motion). ' +
    'Use the gb_* tools to look (gb_status, gb_screenshot) and act. Check your work with a screenshot. Keep answers short. Answer in the language the user writes in.';

  const cfg = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { /* private mode */ } };
  const lang = () => { try { return localStorage.getItem('gbc.lang') || 'vi'; } catch (e) { return 'vi'; } };
  const L = (vi, en, ko) => ({ vi, en, ko })[lang()] || en;

  /* ---------------- UI ---------------- */
  const css = `
  #gbai-fab{position:fixed;right:18px;bottom:18px;z-index:9999;height:46px;padding:0 16px 0 12px;border-radius:23px;border:1px solid #2f5b9a;background:#4772b3;color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:8px}
  #gbai-fab i{width:9px;height:9px;border-radius:50%;background:#8a8f99;display:inline-block}
  #gbai-fab i.on{background:#3cdc8c;box-shadow:0 0 8px #3cdc8c}
  #gbai.dock{right:0;bottom:0;top:0;height:100vh;width:min(420px,100vw);border-radius:0}
  #gbai .m.mcp{align-self:flex-start;background:#2c3b2f;color:#bfe8c9;font-size:12px}
  #gbai .mcpbox{display:flex;flex-direction:column;gap:6px}
  #gbai .mcpbox .row{display:flex;gap:6px;flex-wrap:wrap}
  #gbai{position:fixed;right:18px;bottom:80px;z-index:9999;width:min(440px,calc(100vw - 36px));height:min(640px,calc(100vh - 110px));display:none;flex-direction:column;background:#26292e;color:#e6e6e6;border:1px solid #3d4250;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:13px/1.45 system-ui,-apple-system,sans-serif;overflow:hidden}
  #gbai.on{display:flex}
  #gbai header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1d1f23;border-bottom:1px solid #3d4250;font-weight:700}
  #gbai header button{margin-left:auto}
  #gbai button,#gbai select,#gbai input,#gbai textarea{font:inherit;color:#e6e6e6;background:#3a3f48;border:1px solid #1f2126;border-radius:6px;padding:5px 8px}
  #gbai button{cursor:pointer}#gbai button.pri{background:#4772b3;border-color:#2f5b9a}
  #gbai .cfg{display:none;flex-direction:column;gap:6px;padding:10px 12px;border-bottom:1px solid #3d4250;background:#22252a}
  #gbai .cfg.on{display:flex}
  #gbai .cfg label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#b4b8c2}
  #gbai .log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  #gbai .m{padding:8px 10px;border-radius:10px;max-width:92%;white-space:pre-wrap;word-break:break-word}
  #gbai .m.u{align-self:flex-end;background:#33507e}#gbai .m.a{align-self:flex-start;background:#353a43}
  #gbai .m.t{align-self:flex-start;background:transparent;color:#9aa3b2;font-size:12px;padding:0 4px}
  #gbai .m img{display:block;max-width:100%;border-radius:6px;margin-top:6px}
  #gbai .att{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px}
  #gbai .att span{background:#3a3f48;border-radius:6px;padding:2px 6px;font-size:11px}
  #gbai footer{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-top:1px solid #3d4250}
  #gbai footer .row{display:flex;gap:6px;align-items:center}
  #gbai textarea{flex:1;min-height:44px;max-height:120px;resize:vertical}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const fab = document.createElement('button'); fab.id = 'gbai-fab'; fab.title = 'Greenbox AI'; fab.innerHTML = '🤖 AI <i id="gbai-dot"></i>'; document.body.appendChild(fab);
  const box = document.createElement('div'); box.id = 'gbai'; document.body.appendChild(box);
  box.innerHTML = `
    <header>🤖 Greenbox AI <span class="sub" style="font-weight:400;color:#9aa3b2;font-size:12px"></span><button id="gbai-gear" title="Settings">⚙</button><button id="gbai-dock" title="Dock to the side">⇥</button><button id="gbai-x">✕</button></header>
    <div class="cfg" id="gbai-cfg">
      <label>Provider<select id="gbai-prov"></select></label>
      <label>API URL<input id="gbai-base" placeholder="https://…"></label>
      <label>Model<input id="gbai-model" placeholder="model name, as your provider writes it"></label>
      <label>API key<input id="gbai-key" type="password" autocomplete="off" placeholder="sk-…"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="gbai-tools" checked> Let the AI use Greenbox tools</label>
      <div style="font-size:11px;color:#9aa3b2" id="gbai-note"></div>
      <div class="mcpbox" style="font-size:12px;color:#b4b8c2;border-top:1px solid #3d4250;padding-top:8px">
        <b style="color:#e6e6e6">Claude Desktop / Cowork (MCP)</b>
        <div id="gbai-mcp"></div>
        <div class="row"><button id="gbai-mcp-install" class="pri">🔌 Connect Claude Desktop</button><button id="gbai-mcp-copy">📋 Copy config</button></div>
        <div id="gbai-mcp-status" style="font-size:11px;color:#9aa3b2"></div>
      </div>
    </div>
    <div class="log" id="gbai-log"></div>
    <div class="att" id="gbai-att"></div>
    <footer>
      <div class="row"><button id="gbai-shot" title="Attach the current 3D view">📸</button><button id="gbai-file" title="Attach image / video">📎</button><input type="file" id="gbai-in" accept="image/*,video/*" multiple hidden><button id="gbai-clear" title="New chat">🧹</button></div>
      <div class="row"><textarea id="gbai-msg"></textarea><button class="pri" id="gbai-send">➤</button></div>
    </footer>`;
  const $ = id => box.querySelector('#' + id);
  const prov = $('gbai-prov');
  Object.entries(PRESETS).forEach(([k, p]) => { const o = document.createElement('option'); o.value = k; o.textContent = p.label; prov.appendChild(o); });
  prov.value = cfg.prov || 'anthropic'; $('gbai-base').value = cfg.base || PRESETS[prov.value].base; $('gbai-model').value = cfg.model || ''; $('gbai-key').value = cfg.key || ''; $('gbai-tools').checked = cfg.tools !== false;
  const sync = () => { cfg.prov = prov.value; cfg.base = $('gbai-base').value.trim(); cfg.model = $('gbai-model').value.trim(); cfg.key = $('gbai-key').value.trim(); cfg.tools = $('gbai-tools').checked; save(); box.querySelector('.sub').textContent = cfg.model || ''; };
  prov.onchange = () => { $('gbai-base').value = PRESETS[prov.value].base; sync(); };
  ['gbai-base', 'gbai-model', 'gbai-key', 'gbai-tools'].forEach(id => { $(id).onchange = sync; });
  sync();
  const texts = () => {
    $('gbai-msg').placeholder = L('Nhắn cho AI… (Enter gửi, Shift+Enter xuống dòng)', 'Message the AI… (Enter to send, Shift+Enter new line)', 'AI에게 메시지… (Enter 전송)');
    $('gbai-note').textContent = L('Key chỉ lưu trong trình duyệt này và chỉ gửi tới nhà cung cấp bạn chọn.', 'The key stays in this browser and is only sent to the provider you pick.', '키는 이 브라우저에만 저장되고 선택한 제공자에게만 전송됩니다.');
    $('gbai-mcp').innerHTML = L('Không cần API key: Claude Desktop / Cowork điều khiển Greenbox qua MCP. Bấm nút dưới 1 lần, mở lại Claude Desktop, rồi chat với Claude ở đó; mọi thao tác hiện ở đây.', 'No API key needed: Claude Desktop / Cowork drives Greenbox through MCP. Press the button once, reopen Claude Desktop, then chat with Claude there; everything it does shows up here.', 'API 키 불필요: Claude Desktop / Cowork가 MCP로 Greenbox를 조작합니다. 버튼을 한 번 누르고 Claude Desktop을 다시 연 뒤 거기서 대화하세요. 작업 내역이 여기에 표시됩니다.');
  };
  texts(); addEventListener('storage', e => { if (e.key === 'gbc.lang') texts(); });

  /* ---------------- Claude Desktop / Cowork via MCP: one-click setup + live activity ---------------- */
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  let mcp = null;
  async function mcp_status () {
    if (!local) { $('gbai-mcp-status').textContent = L('Mở Greenbox bằng Mo-Greenbox để dùng MCP.', 'Open Greenbox with Mo-Greenbox to use MCP.', 'MCP를 쓰려면 Mo-Greenbox로 여세요.'); return; }
    try { const r = await fetch('/bridge/status', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); mcp = await r.json(); } catch (e) { mcp = null; }
    const st = $('gbai-mcp-status'); const dot = document.getElementById('gbai-dot');
    if (mcp === null) { st.textContent = L('Máy chủ Greenbox cũ: chạy lại Mo-Greenbox.', 'Old Greenbox server: restart Mo-Greenbox.', '이전 서버: Mo-Greenbox를 다시 실행하세요.'); return; }
    const c = mcp.claude; const live = mcp.last_call_ago !== null && mcp.last_call_ago < 120;
    if (dot) dot.classList.toggle('on', live);
    st.innerHTML = (c.installed ? '✅ ' + L('Đã gắn vào Claude Desktop', 'Set up in Claude Desktop', 'Claude Desktop에 설정됨') : (c.app_found ? '⚪ ' + L('Chưa gắn', 'Not set up yet', '아직 설정 안 됨') : '⚪ ' + L('Không thấy Claude Desktop trên máy này (vẫn có thể copy config)', 'Claude Desktop not found on this computer (you can still copy the config)', '이 컴퓨터에 Claude Desktop 없음 (설정 복사는 가능)'))) +
      (live ? ' · 🟢 ' + L(`AI vừa dùng Greenbox ${Math.round(mcp.last_call_ago)}s trước`, `AI used Greenbox ${Math.round(mcp.last_call_ago)}s ago`, `${Math.round(mcp.last_call_ago)}초 전 AI 사용`) : '');
    $('gbai-mcp-install').textContent = c.installed ? '🔁 ' + L('Gắn lại', 'Set up again', '다시 설정') : '🔌 ' + L('Gắn vào Claude Desktop', 'Connect Claude Desktop', 'Claude Desktop 연결');
  }
  $('gbai-mcp-install').onclick = async () => {
    try {
      const r = await fetch('/bridge/install-claude', { method: 'POST', headers: { 'X-Greenbox-UI': '1' } });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || r.status);
      show('mcp', L(`Đã thêm Greenbox vào ${j.config} (file cũ được sao lưu). Tắt hẳn Claude Desktop rồi mở lại, sau đó nhắn cho Claude kiểu: "dùng Greenbox, auto-rig model đang mở rồi xuất GLB".`, `Added Greenbox to ${j.config} (old file backed up). Quit Claude Desktop completely and open it again, then ask Claude e.g. "use Greenbox: auto-rig the open model and export a GLB".`, `${j.config}에 Greenbox 추가 (기존 파일 백업). Claude Desktop을 완전히 종료 후 다시 열고 "Greenbox로 열린 모델을 자동 리깅하고 GLB로 내보내줘" 처럼 요청하세요.`));
    } catch (e) { show('t', '⚠ ' + (e.message || e)); }
    mcp_status();
  };
  $('gbai-mcp-copy').onclick = async () => {
    const entry = mcp && mcp.claude ? mcp.claude.entry : { command: 'python3', args: ['<Greenbox folder>/gb-ai/greenbox_mcp.py'] };
    const txt = JSON.stringify({ mcpServers: { greenbox: entry } }, null, 2);
    try { await navigator.clipboard.writeText(txt); show('mcp', L('Đã copy. Dán vào claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config).', 'Copied. Paste into claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config).', '복사됨. claude_desktop_config.json에 붙여넣으세요.') + '\n' + txt); } catch (e) { show('mcp', txt); }
  };
  // what an outside AI (Claude Desktop / Cowork) does in Greenbox shows up in this chat, like an add-on log
  addEventListener('gb-mcp-call', e => { show('mcp', '🔌 Claude → ' + e.detail.tool + ' ' + JSON.stringify(e.detail.args || {}).replace(/"data_b64":"[^"]{40,}"/, '"data_b64":"…"').slice(0, 140)); const d = document.getElementById('gbai-dot'); if (d) d.classList.add('on'); });
  addEventListener('gb-mcp-done', e => { if (!e.detail.ok) show('t', '⚠ ' + e.detail.tool + ': ' + e.detail.error); else if (e.detail.image) show('t', '', e.detail.image); });
  mcp_status(); setInterval(() => { if (box.classList.contains('on')) mcp_status(); }, 8000);
  $('gbai-dock').onclick = () => { box.classList.toggle('dock'); try { localStorage.setItem('gb.ai.dock', box.classList.contains('dock') ? '1' : '0'); } catch (e) { /* ignore */ } };
  try { if (localStorage.getItem('gb.ai.dock') === '1') box.classList.add('dock'); } catch (e) { /* ignore */ }
  fab.onclick = () => { box.classList.toggle('on'); if (!cfg.model || (!cfg.key && prov.value !== 'ollama')) $('gbai-cfg').classList.add('on'); };
  $('gbai-x').onclick = () => box.classList.remove('on');
  $('gbai-gear').onclick = () => $('gbai-cfg').classList.toggle('on');

  /* ---------------- conversation (provider-neutral) ---------------- */
  // history item: {role:'user'|'assistant', parts:[{type:'text',text}|{type:'image',url}|{type:'tool_call',id,name,args}|{type:'tool_result',id,text,image}]}
  let history = []; let pending = []; let busy = false;
  const log = $('gbai-log');
  const show = (cls, text, img) => { const d = document.createElement('div'); d.className = 'm ' + cls; d.textContent = text || ''; if (img) { const i = document.createElement('img'); i.src = img; d.appendChild(i); } log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  const renderAtt = () => { $('gbai-att').innerHTML = pending.map((p, i) => `<span>🖼 ${i + 1}</span>`).join(''); };
  $('gbai-clear').onclick = () => { history = []; pending = []; log.innerHTML = ''; renderAtt(); };
  $('gbai-shot').onclick = () => { try { pending.push(window.__gbTools.shot()); renderAtt(); } catch (e) { show('t', String(e)); } };
  $('gbai-file').onclick = () => $('gbai-in').click();
  $('gbai-in').onchange = async () => {
    for (const f of $('gbai-in').files) {
      if (f.type.startsWith('image/')) pending.push(await readURL(f));
      else if (f.type.startsWith('video/')) (await videoFrames(f, 6)).forEach(u => pending.push(u));
    }
    $('gbai-in').value = ''; renderAtt();
  };
  const readURL = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
  /** a video becomes N still frames (models read images, not video files) */
  async function videoFrames (f, n) {
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(f);
    await new Promise(r => { v.onloadedmetadata = r; });
    const out = []; const c = document.createElement('canvas'); const s = Math.min(1, 768 / v.videoWidth); c.width = v.videoWidth * s; c.height = v.videoHeight * s;
    for (let i = 0; i < n; i++) { v.currentTime = (i + 0.5) * v.duration / n; await new Promise(r => { v.onseeked = r; }); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); out.push(c.toDataURL('image/jpeg', 0.8)); }
    URL.revokeObjectURL(v.src); return out;
  }
  $('gbai-msg').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('gbai-send').onclick = () => send();

  async function send () {
    if (busy) return;
    const text = $('gbai-msg').value.trim(); if (!text && pending.length === 0) return;
    if (!cfg.model) { $('gbai-cfg').classList.add('on'); show('t', L('Nhập tên model trước.', 'Enter a model name first.', '모델 이름을 먼저 입력하세요.')); return; }
    const parts = []; if (text) parts.push({ type: 'text', text }); pending.forEach(u => parts.push({ type: 'image', url: u }));
    show('u', text, pending[0]); pending = []; renderAtt(); $('gbai-msg').value = '';
    history.push({ role: 'user', parts });
    busy = true; $('gbai-send').disabled = true;
    try {
      for (let turn = 0; turn < 12; turn++) {
        const thinking = show('t', '…');
        const reply = PRESETS[cfg.prov].kind === 'anthropic' ? await anthropic() : await openai();
        thinking.remove();
        history.push({ role: 'assistant', parts: reply });
        reply.filter(p => p.type === 'text' && p.text.trim()).forEach(p => show('a', p.text));
        const calls = reply.filter(p => p.type === 'tool_call');
        if (calls.length === 0) break;
        const results = [];
        for (const c of calls) {
          show('t', '🔧 ' + c.name + ' ' + JSON.stringify(c.args).slice(0, 120));
          try { const r = await window.__gbTools.call(c.name, c.args); results.push({ type: 'tool_result', id: c.id, text: (r.text || 'ok').slice(0, 8000), image: r.image }); if (r.image) show('t', '', r.image); }
          catch (e) { results.push({ type: 'tool_result', id: c.id, text: 'ERROR: ' + (e.message || e), error: true }); show('t', '⚠ ' + (e.message || e)); }
        }
        history.push({ role: 'user', parts: results });
      }
    } catch (e) { show('t', '⚠ ' + (e.message || e)); }
    busy = false; $('gbai-send').disabled = false;
  }

  const tools = () => cfg.tools ? window.__gbTools.list : [];
  const b64 = url => { const m = /^data:([^;]+);base64,(.*)$/.exec(url); return m ? { media_type: m[1], data: m[2] } : null; };

  async function anthropic () {
    const msgs = history.map(h => ({
      role: h.role,
      content: h.parts.map(p => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        if (p.type === 'image') { const x = b64(p.url); return { type: 'image', source: { type: 'base64', media_type: x.media_type, data: x.data } }; }
        if (p.type === 'tool_call') return { type: 'tool_use', id: p.id, name: p.name, input: p.args };
        if (p.type === 'tool_result') { const c = [{ type: 'text', text: p.text }]; if (p.image) { const x = b64(p.image); c.push({ type: 'image', source: { type: 'base64', media_type: x.media_type, data: x.data } }); } return { type: 'tool_result', tool_use_id: p.id, content: c, is_error: !!p.error }; }
        return null;
      }).filter(Boolean)
    }));
    const body = { model: cfg.model, max_tokens: 4096, system: SYSTEM, messages: msgs };
    if (tools().length) body.tools = tools().map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const r = await fetch(cfg.base.replace(/\/$/, '') + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || r.statusText);
    return j.content.map(c => c.type === 'text' ? { type: 'text', text: c.text } : c.type === 'tool_use' ? { type: 'tool_call', id: c.id, name: c.name, args: c.input } : null).filter(Boolean);
  }

  async function openai () {
    const msgs = [{ role: 'system', content: SYSTEM }];
    history.forEach(h => {
      if (h.role === 'assistant') {
        const text = h.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
        const calls = h.parts.filter(p => p.type === 'tool_call').map(p => ({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.args) } }));
        msgs.push(calls.length ? { role: 'assistant', content: text || null, tool_calls: calls } : { role: 'assistant', content: text });
        return;
      }
      const results = h.parts.filter(p => p.type === 'tool_result');
      if (results.length) {
        results.forEach(p => msgs.push({ role: 'tool', tool_call_id: p.id, content: p.text }));
        const imgs = results.filter(p => p.image); // tool messages are text-only here: send pictures right after
        if (imgs.length) msgs.push({ role: 'user', content: [{ type: 'text', text: 'Screenshot(s) from the tool calls above.' }, ...imgs.map(p => ({ type: 'image_url', image_url: { url: p.image } }))] });
        return;
      }
      msgs.push({ role: 'user', content: h.parts.map(p => p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: p.url } }) });
    });
    const body = { model: cfg.model, messages: msgs };
    if (tools().length) body.tools = tools().map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const headers = { 'content-type': 'application/json' }; if (cfg.key) headers.authorization = 'Bearer ' + cfg.key;
    const r = await fetch(cfg.base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || r.statusText);
    const m = j.choices[0].message; const out = [];
    if (m.content) out.push({ type: 'text', text: typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('') });
    (m.tool_calls || []).forEach(c => { let a = {}; try { a = JSON.parse(c.function.arguments || '{}'); } catch (e) { /* keep {} */ } out.push({ type: 'tool_call', id: c.id, name: c.function.name, args: a }); });
    return out;
  }
})();
