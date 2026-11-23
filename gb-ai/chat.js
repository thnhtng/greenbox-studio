/* Greenbox AI chat — talk to any model with your own API key, attach images / video frames / the current 3D
   view, and let it drive Greenbox through the same tools as the MCP server (window.__gbTools).
   Providers: Anthropic (Messages API) and anything OpenAI-compatible (OpenAI, Gemini, OpenRouter, Groq,
   Ollama / LM Studio on this computer). The key stays in this browser (localStorage) and is sent only to the
   provider you choose. */
(function () {
  'use strict';
  const LS = 'gb.ai.cfg';
  const BASE = (() => { try { return new URL('.', document.currentScript.src).href; } catch (e) { return './gb-ai/'; } })();
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
  #gbai .m.say{align-self:flex-start;background:#2b3442;border:1px solid #3e5a86}
  #gbai .m .who{display:block;font-size:11px;font-weight:700;color:#7ad7ff;margin-bottom:2px}
  #gbai #gbai-mode{margin-left:auto}#gbai #gbai-mode.on{background:#2c6b46;border-color:#3cdc8c}
  #gbai.mcpmode #gbai-shot,#gbai.mcpmode #gbai-file,#gbai.mcpmode .att{display:none}
  body.gbai-docked{padding-right:min(420px,100vw)!important;box-sizing:border-box}
  body.gbai-docked>*:not(#gbai):not(#gbai-fab):not(canvas):not(video):not(script):not(style){right:min(420px,100vw)!important;max-width:calc(100vw - min(420px,100vw))}
  #gbai .mcpbox{display:flex;flex-direction:column;gap:6px}
  #gbai .mcpbox .row{display:flex;gap:6px;flex-wrap:wrap}
  #gbai{position:fixed;right:18px;bottom:80px;z-index:9999;width:min(440px,calc(100vw - 36px));height:min(640px,calc(100vh - 110px));display:none;flex-direction:column;background:#26292e;color:#e6e6e6;border:1px solid #3d4250;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:13px/1.45 system-ui,-apple-system,sans-serif;overflow:hidden}
  #gbai.on{display:flex}
  #gbai header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1d1f23;border-bottom:1px solid #3d4250;font-weight:700}
  #gbai header button#gbai-gear{margin-left:0}
  #gbai button,#gbai select,#gbai input,#gbai textarea{font:inherit;color:#e6e6e6;background:#3a3f48;border:1px solid #1f2126;border-radius:6px;padding:5px 8px}
  #gbai button{cursor:pointer}#gbai button.pri{background:#4772b3;border-color:#2f5b9a}
  #gbai .cfg{display:none;flex-direction:column;gap:6px;padding:10px 12px;border-bottom:1px solid #3d4250;background:#22252a}
  #gbai .cfg.on{display:flex}
  #gbai .cfg{max-height:62%;overflow:auto}
  #gbai #gbai-back{position:sticky;top:-10px;z-index:2;align-self:flex-start;margin:-2px 0 4px}
  #gbai .cfg label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#b4b8c2}
  #gbai .log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  #gbai .m{padding:8px 10px;border-radius:10px;max-width:92%;white-space:pre-wrap;word-break:break-word}
  #gbai .m.u{align-self:flex-end;background:#33507e}#gbai .m.a{align-self:flex-start;background:#353a43}
  #gbai .m.t{align-self:flex-start;background:transparent;color:#9aa3b2;font-size:12px;padding:0 4px}
  #gbai .m.err{align-self:flex-start;background:rgba(229,57,53,.16);border:1px solid rgba(255,120,110,.45);color:#ffd2cc;font-size:13px;padding:8px 10px;border-radius:10px}
  #gbai .m.setup{align-self:stretch;max-width:100%;display:flex;flex-direction:column;gap:8px}
  #gbai .m.setup b{font-size:14px}#gbai .m.setup .row{display:flex;gap:6px}#gbai .m.setup input{flex:1;min-width:0}
  #gbai .m.setup .opt{opacity:.85;font-size:12.5px;line-height:1.5}
  #gbai #gbai-mode{display:none!important}
  #gbai .m img{display:block;max-width:100%;border-radius:6px;margin-top:6px}
  #gbai .att{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px}
  #gbai .att span{background:#3a3f48;border-radius:6px;padding:2px 6px;font-size:11px}
  #gbai footer{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-top:1px solid #3d4250}
  #gbai footer .row{display:flex;gap:6px;align-items:center}
  #gbai #gbai-eng{max-width:132px;padding:4px 4px}#gbai #gbai-edit.on{background:#7a5a1e;border-color:#e0a83c}#gbai #gbai-stop{background:#8a2f2b;border-color:#c0504a}
  #gbai textarea{flex:1;min-height:44px;max-height:120px;resize:vertical}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const fab = document.createElement('button'); fab.id = 'gbai-fab'; fab.title = 'Greenbox AI'; fab.innerHTML = '🤖 AI <i id="gbai-dot"></i>'; document.body.appendChild(fab);
  const box = document.createElement('div'); box.id = 'gbai'; document.body.appendChild(box);
  box.innerHTML = `
    <header>🤖 Greenbox AI <span class="sub" style="font-weight:400;color:#9aa3b2;font-size:12px"></span><button id="gbai-mode" title="Chat with Claude / Codex (MCP) here">🔌</button><button id="gbai-gear" title="Settings">⚙</button><button id="gbai-dock" title="Dock to the side">⇥</button><button id="gbai-x">✕</button></header>
    <div class="cfg" id="gbai-cfg">
      <button id="gbai-back" class="pri" type="button"></button>
      <label>Provider<select id="gbai-prov"></select></label>
      <label>API URL<input id="gbai-base" placeholder="https://…"></label>
      <label>Model<input id="gbai-model" placeholder="model name, as your provider writes it"></label>
      <label>API key<input id="gbai-key" type="password" autocomplete="off" placeholder="sk-…"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="gbai-tools" checked> Let the AI use Greenbox tools</label>
      <div style="font-size:11px;color:#9aa3b2" id="gbai-note"></div>
      <div class="mcpbox" style="font-size:12px;color:#b4b8c2;border-top:1px solid #3d4250;padding-top:8px">
        <b style="color:#e6e6e6">Claude / Codex (MCP)</b>
        <div id="gbai-mcp"></div>
        <div class="row" id="gbai-mcp-localrow"><button id="gbai-mcp-install" class="pri">🔌 Claude Desktop</button><button id="gbai-mcp-codex" class="pri">🔌 Codex</button><button id="gbai-mcp-cc" class="pri">🔌 Claude Code</button><button id="gbai-mcp-copy">📋 Copy config</button></div>
        <div id="gbai-mcp-status" style="font-size:11px;color:#9aa3b2"></div>
        <div id="gbai-easy"></div>
        <div class="row" style="align-items:center"><span id="gbai-pair-lbl" style="font-size:11px"></span><input id="gbai-pair-code" inputmode="numeric" maxlength="6" placeholder="123456" style="width:80px"><input id="gbai-pair-port" value="47827" style="width:62px" title="port"><button id="gbai-pair-go" class="pri">🔗</button><button id="gbai-pair-off" title="Disconnect">✕</button></div>
        <div id="gbai-pair-state" style="font-size:11px;color:#9aa3b2"></div>
        <details id="gbai-manual" style="font-size:11px"><summary id="gbai-manual-sum" style="cursor:pointer;color:#9aa3b2"></summary>
        <div class="row"><button data-snip="desktop">📋 Claude Desktop</button><button data-snip="code">📋 Claude Code</button><button data-snip="codex">📋 Codex</button></div>
        <div style="font-size:11px"><a id="gbai-dl-py" href="./gb-ai/greenbox_mcp.py" download="greenbox_mcp.py" style="color:#7ad7ff">⬇ greenbox_mcp.py</a> · <a id="gbai-dl-json" href="./gb-ai/tools.json" download="tools.json" style="color:#7ad7ff">⬇ tools.json</a> <span id="gbai-dl-note"></span></div></details>
      </div>
    </div>
    <div class="log" id="gbai-log"></div>
    <div class="att" id="gbai-att"></div>
    <footer>
      <div class="row"><button id="gbai-shot" title="Attach the current 3D view">📸</button><button id="gbai-file" title="Attach image / video">📎</button><input type="file" id="gbai-in" accept="image/*,video/*" multiple hidden><button id="gbai-clear" title="New chat">🧹</button><select id="gbai-eng" title="AI"></select><button id="gbai-edit" title="">✏️</button><button id="gbai-stop" hidden>⏹</button></div>
      <div class="row"><textarea id="gbai-msg"></textarea><button class="pri" id="gbai-send">➤</button></div>
    </footer>`;
  const $ = id => box.querySelector('#' + id);
  $('gbai-dl-py').href = BASE + 'greenbox_mcp.py'; $('gbai-dl-json').href = BASE + 'tools.json';
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
    $('gbai-pair-lbl').textContent = L('Mã ghép nối', 'Pairing code', '페어링 코드');
    $('gbai-back').textContent = '← ' + L('Quay lại chat', 'Back to chat', '채팅으로');
    $('gbai-mcp').innerHTML = L('Không cần API key: Claude (Desktop / Code / Cowork) hoặc Codex điều khiển Greenbox qua MCP. Cài 1 lần (bên dưới), mở lại app AI, rồi chat ở đó; mọi thao tác hiện ở đây.', 'No API key needed: Claude (Desktop / Code / Cowork) or Codex drives Greenbox through MCP. Set it up once (below), reopen the AI app, then chat there; everything it does shows up here.', 'API 키 불필요: Claude Desktop / Cowork가 MCP로 Greenbox를 조작합니다. 버튼을 한 번 누르고 Claude Desktop을 다시 연 뒤 거기서 대화하세요. 작업 내역이 여기에 표시됩니다.');
  };
  texts(); addEventListener('storage', e => { if (e.key === 'gbc.lang') texts(); });

  /* ---------------- Claude Desktop / Cowork via MCP: one-click setup + live activity ---------------- */
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  let mcp = null;
  /* the web version: one command installs the MCP server for every AI app on the computer (gb-ai/install.sh / .ps1) */
  function easy () {
    const site = new URL('.', location.href).href.replace(/\/$/, '')
    const mac = `curl -fsSL ${site}/gb-ai/install.sh | sh -s -- ${site}`
    const win = `$env:GREENBOX_SITE='${site}'; irm ${site}/gb-ai/install.ps1 | iex`
    const box = $('gbai-easy'); const code = 'display:block;white-space:pre-wrap;word-break:break-all;background:#0b1a14;border:1px solid #2c5a45;border-radius:8px;padding:6px 8px;margin:4px 0;font:11px/1.45 ui-monospace,Menlo,monospace;color:#c8f7dc'
    box.innerHTML = `<div style="font-size:12px;color:#e6e6e6;margin:6px 0 4px"><b>${L('Kết nối 1 lần, 3 bước:', 'Connect once, 3 steps:', '한 번만 연결 (3단계):')}</b></div>
      <div style="font-size:12px">1. ${L('Copy lệnh cho máy bạn, dán vào Terminal (Mac) / PowerShell (Windows), bấm Enter:', 'Copy the command for your computer, paste it in Terminal (Mac) / PowerShell (Windows), press Enter:', '명령을 복사해 터미널에 붙여넣고 Enter:')}</div>
      <div class="row" style="margin-top:4px"><button data-cp="mac" class="pri">📋 Mac / Linux</button><button data-cp="win" class="pri">📋 Windows</button></div>
      <code id="gbai-cmd" style="${code}">${mac.replace(/</g, '&lt;')}</code>
      <div style="font-size:12px">2. ${L('Tắt hẳn rồi mở lại Claude Desktop / Codex / Claude Code (lệnh tự gắn cho app nào có trên máy).', 'Quit and reopen Claude Desktop / Codex / Claude Code (the command sets up whichever is installed).', '앱을 완전히 종료 후 다시 열기.')}</div>
      <div style="font-size:12px">3. ${L('Nhắn cho AI: "kết nối Greenbox" → nó đưa mã 6 số → nhập vào ô Mã ghép nối bên dưới, bấm 🔗.', 'Ask the AI: "connect to Greenbox" → it gives a 6-digit code → type it in the pairing box below, press 🔗.', 'AI에게 "Greenbox 연결" → 6자리 코드 입력.')}</div>
      <div style="font-size:11px;color:#9aa3b2;margin-top:4px">${L('Cần Python 3 (Mac thường có sẵn). Mọi thứ chạy trên máy bạn: trình duyệt chỉ nói chuyện với 127.0.0.1.', 'Needs Python 3 (usually already on a Mac). Everything stays on your computer: the browser only talks to 127.0.0.1.', 'Python 3 필요. 모든 것이 내 컴퓨터에서 실행.')}</div>`
    box.querySelectorAll('[data-cp]').forEach(b => { b.onclick = async () => { const t = b.dataset.cp === 'win' ? win : mac; $('gbai-cmd').textContent = t; try { await navigator.clipboard.writeText(t); b.textContent = '✅ ' + L('Đã copy', 'Copied', '복사됨'); setTimeout(() => easy(), 1600) } catch (e) { /* the command is shown, select it by hand */ } } })
  }
  async function mcp_status () {
    $('gbai-manual-sum').textContent = L('Cách thủ công (sửa file cấu hình)', 'Manual setup (edit the config file)', '수동 설정');
    if (!local) { easy(); $('gbai-mcp-localrow').style.display = 'none'; $('gbai-mcp-status').textContent = ''; return; }
    try { const r = await fetch('/bridge/status', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); mcp = await r.json(); } catch (e) { mcp = null; }
    const st = $('gbai-mcp-status'); const dot = document.getElementById('gbai-dot');
    if (mcp === null) { st.textContent = L('Máy chủ Greenbox cũ: chạy lại Mo-Greenbox.', 'Old Greenbox server: restart Mo-Greenbox.', '이전 서버: Mo-Greenbox를 다시 실행하세요.'); return; }
    const c = mcp.claude; const live = mcp.last_call_ago !== null && mcp.last_call_ago < 120;
    if (dot) dot.classList.toggle('on', live);
    // one line per app: set up or not (Claude Desktop, Codex, Claude Code)
    const APPS = [['claude', 'Claude Desktop', 'gbai-mcp-install'], ['codex', 'Codex', 'gbai-mcp-codex'], ['claude_code', 'Claude Code', 'gbai-mcp-cc']];
    st.innerHTML = APPS.map(([k, nm]) => { const a = mcp[k] || {}; return (a.installed ? '✅ ' + L(`Đã gắn vào ${nm}`, `Set up in ${nm}`, `${nm} 설정됨`) : (a.app_found ? '⚪ ' + L(`${nm}: chưa gắn`, `${nm}: not set up`, `${nm}: 설정 안 됨`) : '⚪ ' + L(`Không thấy ${nm} trên máy này`, `${nm} not found on this computer`, `${nm} 없음`))); }).join('<br>') +
      (live ? '<br>🟢 ' + L(`AI vừa dùng Greenbox ${Math.round(mcp.last_call_ago)}s trước`, `AI used Greenbox ${Math.round(mcp.last_call_ago)}s ago`, `${Math.round(mcp.last_call_ago)}초 전 AI 사용`) : '');
    for (const [k, nm, id] of APPS) { const a = mcp[k] || {}; $(id).textContent = (a.installed ? '🔁 ' : '🔌 ') + (a.installed ? L(`Gắn lại ${nm}`, `Redo ${nm}`, `${nm} 다시`) : L(`Gắn ${nm}`, `Connect ${nm}`, `${nm} 연결`)); }
  }
  /* one click: Greenbox goes into that app's MCP config (the old file is backed up) */
  async function install (route, nm, hint) {
    try {
      const r = await fetch('/bridge/' + route, { method: 'POST', headers: { 'X-Greenbox-UI': '1' } });
      const j = await r.json().catch(() => ({ ok: false, error: r.status === 404 ? L('Máy chủ Greenbox cũ: chạy lại Mo-Greenbox.', 'Old Greenbox server: restart Mo-Greenbox.', '서버를 다시 실행하세요.') : r.status }));
      if (!j.ok) throw new Error(j.error || r.status);
      show('mcp', L(`Đã thêm Greenbox vào ${j.config} (file cũ được sao lưu). ${hint.vi}`, `Added Greenbox to ${j.config} (old file backed up). ${hint.en}`, `${j.config}에 Greenbox 추가. ${hint.en}`));
    } catch (e) { show('t', '⚠ ' + (e.message || e)); }
    mcp_status();
  }
  $('gbai-mcp-install').onclick = () => install('install-claude', 'Claude Desktop', { vi: 'Tắt hẳn Claude Desktop rồi mở lại, sau đó nhắn: "dùng Greenbox, auto-rig model đang mở rồi xuất GLB".', en: 'Quit Claude Desktop completely and reopen it, then ask: "use Greenbox: auto-rig the open model and export a GLB".' });
  $('gbai-mcp-codex').onclick = () => install('install-codex', 'Codex', { vi: 'Mở lại Codex (app hoặc `codex` trong Terminal), gõ /mcp để thấy greenbox, rồi nhắn: "dùng Greenbox, gắn vô lăng vào video đang mở".', en: 'Restart Codex (the app or `codex` in a terminal), type /mcp to see greenbox, then ask: "use Greenbox: put a steering wheel on the open video".' });
  $('gbai-mcp-cc').onclick = () => install('install-claude-code', 'Claude Code', { vi: 'Mở phiên Claude Code mới, gõ /mcp để thấy greenbox.', en: 'Start a new Claude Code session and type /mcp to see greenbox.' });
  /* ---------------- any MCP app (Claude Desktop / Claude Code / Codex), also from the web version: pairing code ---------------- */
  const py_path = () => (mcp && mcp.claude && mcp.claude.entry && mcp.claude.entry.args[0]) || L('/ĐƯỜNG/DẪN/greenbox_mcp.py', '/PATH/TO/greenbox_mcp.py', '/경로/greenbox_mcp.py');
  const py_cmd = () => (mcp && mcp.claude && mcp.claude.entry && mcp.claude.entry.command) || 'python3';
  const SNIP = {
    desktop: () => JSON.stringify({ mcpServers: { greenbox: { command: py_cmd(), args: [py_path()] } } }, null, 2),
    code: () => `claude mcp add greenbox -- ${py_cmd()} "${py_path()}"`,
    codex: () => `[mcp_servers.greenbox]\ncommand = "${py_cmd()}"\nargs = ["${py_path()}"]`
  };
  box.querySelectorAll('[data-snip]').forEach(b => {
    b.onclick = async () => {
      const k = b.dataset.snip; const txt = SNIP[k]()
      try { await navigator.clipboard.writeText(txt); } catch (e) { /* show it anyway */ }
      const where = { desktop: L('Claude Desktop → Settings → Developer → Edit Config, dán vào claude_desktop_config.json, mở lại Claude Desktop.', 'Claude Desktop → Settings → Developer → Edit Config, paste into claude_desktop_config.json, restart Claude Desktop.', 'Claude Desktop 설정에 붙여넣기.'),
        code: L('Dán lệnh này vào Terminal (Claude Code).', 'Paste this command in a terminal (Claude Code).', '터미널에 붙여넣기.'),
        codex: L('Dán vào ~/.codex/config.toml rồi mở lại Codex.', 'Paste into ~/.codex/config.toml, then restart Codex.', '~/.codex/config.toml에 붙여넣기.') }[k]
      show('mcp', '📋 ' + where + '\n' + txt + (local ? '' : '\n' + L('Tải greenbox_mcp.py + tools.json về cùng 1 thư mục, sửa đường dẫn ở trên cho đúng.', 'Download greenbox_mcp.py + tools.json into one folder and fix the path above.', '두 파일을 한 폴더에 받으세요.')))
    }
  })
  const pair_text = (st) => {
    const el = $('gbai-pair-state'); const dot = document.getElementById('gbai-dot')
    const m = { off: local ? L('Greenbox đang chạy trên máy: Claude Desktop / Codex tự nối, KHÔNG cần mã. Mã 6 số chỉ dành cho bản web.', 'Greenbox runs on this computer: Claude Desktop / Codex connect by themselves, NO code needed. The 6-digit code is only for the web version.', '로컬: 코드 불필요.') : L('Chưa kết nối. Hỏi Claude / Codex: "kết nối Greenbox" → nó đưa mã 6 số → nhập vào ô trên.', 'Not connected. Ask Claude / Codex "connect to Greenbox" → it gives a 6-digit code → type it above.', '연결 안 됨. AI에게 코드를 받아 입력하세요.'),
      connecting: L('Đang kết nối…', 'Connecting…', '연결 중…'),
      on: '🟢 ' + L(`Đã kết nối AI (cổng ${st.port}). Chat với Claude / Codex ở app của nó; thao tác hiện ở đây.`, `AI connected (port ${st.port}). Chat with Claude / Codex in its own app; what it does shows here.`, `AI 연결됨 (포트 ${st.port}).`),
      waiting: '🟡 ' + L('Chưa thấy greenbox_mcp.py chạy trên máy (mở app AI có cấu hình Greenbox). Safari: dùng Chrome / Edge cho bản web.', 'greenbox_mcp.py is not running on this computer yet (open the AI app with Greenbox configured). On Safari use Chrome / Edge for the web version.', 'greenbox_mcp.py가 실행되지 않음.'),
      'bad-code': '🔴 ' + L('Sai mã ghép nối: hỏi lại AI mã mới (gb_connect).', 'Wrong pairing code: ask the AI again (gb_connect).', '코드가 틀렸습니다.') }
    el.textContent = m[st.relay] || ''
    if (dot && st.relay === 'on') dot.classList.add('on')
  }
  addEventListener('gb-mcp-state', e => pair_text(e.detail))
  $('gbai-pair-go').onclick = () => { const c = $('gbai-pair-code').value.replace(/\D/g, ''); if (c.length !== 6 || !window.__gbBridge) { show('t', '⚠ ' + L('Mã gồm 6 số.', 'The code has 6 digits.', '코드는 6자리입니다.')); return; } window.__gbBridge.pair($('gbai-pair-port').value, c) }
  $('gbai-pair-off').onclick = () => { if (window.__gbBridge) window.__gbBridge.unpair() }
  try { const sp = JSON.parse(localStorage.getItem('gb.mcp.pair') || 'null'); if (sp) { $('gbai-pair-code').value = sp.code; $('gbai-pair-port').value = sp.port } } catch (e) { /* ignore */ }
  setTimeout(() => { if (window.__gbBridge) pair_text(window.__gbBridge.state()) }, 300)
  $('gbai-mcp-copy').onclick = async () => {
    const entry = mcp && mcp.claude ? mcp.claude.entry : { command: 'python3', args: ['<Greenbox folder>/gb-ai/greenbox_mcp.py'] };
    const txt = JSON.stringify({ mcpServers: { greenbox: entry } }, null, 2);
    try { await navigator.clipboard.writeText(txt); show('mcp', L('Đã copy. Dán vào claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config).', 'Copied. Paste into claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config).', '복사됨. claude_desktop_config.json에 붙여넣으세요.') + '\n' + txt); } catch (e) { show('mcp', txt); }
  };
  // what an outside AI (Claude Desktop / Cowork) does in Greenbox shows up in this chat, like an add-on log
  addEventListener('gb-mcp-call', e => {
    const who = e.detail.from || 'Claude'; const d = document.getElementById('gbai-dot'); if (d) d.classList.add('on');
    if (e.detail.tool === 'gb_say') return // its text arrives as a bubble (gb-ai-say)
    if (e.detail.tool === 'gb_inbox') { if (Number((e.detail.args || {}).wait) > 0) show('mcp', '⏳ ' + L(`${who} đang chờ bạn trả lời…`, `${who} is waiting for your answer…`, `${who}가 답을 기다리는 중…`)); return }
    show('mcp', '🔌 ' + who + ' → ' + e.detail.tool + ' ' + JSON.stringify(e.detail.args || {}).replace(/"data_b64":"[^"]{40,}"/, '"data_b64":"…"').slice(0, 140));
  });
  // 💬 an outside AI (Claude Code, Codex… over MCP) talks to the user here, like a browser extension's side panel
  const say = (who, text) => { const d = show('a say', ''); const b = document.createElement('span'); b.className = 'who'; b.textContent = who; d.append(b, document.createTextNode(text)); return d; };
  addEventListener('gb-ai-say', e => {
    if (!box.classList.contains('on')) box.classList.add('on');
    if (mode !== 'mcp') set_mode('mcp');
    say('🔌 ' + (e.detail.from || 'AI'), e.detail.text);
  });
  addEventListener('gb-inbox-read', e => { if (e.detail.n > 0) show('mcp', '👀 ' + L(`${e.detail.from} đã đọc ${e.detail.n} tin`, `${e.detail.from} read ${e.detail.n} message(s)`, `${e.detail.from} 읽음 ${e.detail.n}`)); });
  addEventListener('gb-mcp-done', e => { if (!e.detail.ok) show('err', '⚠ ' + e.detail.tool + ': ' + e.detail.error); else if (e.detail.image) show('t', '', e.detail.image); });
  mcp_status(); setInterval(() => { if (box.classList.contains('on')) mcp_status(); }, 8000);
  // docked = a side column like a browser extension's side panel: the page makes room for it
  const dock_room = () => {
    const on = box.classList.contains('dock') && box.classList.contains('on')
    if (document.body.classList.contains('gbai-docked') === on) return
    document.body.classList.toggle('gbai-docked', on); setTimeout(() => dispatchEvent(new Event('resize')), 30) // 3D views fit the new width
  };
  $('gbai-dock').onclick = () => { box.classList.toggle('dock'); dock_room(); try { localStorage.setItem('gb.ai.dock', box.classList.contains('dock') ? '1' : '0'); } catch (e) { /* ignore */ } };
  try { if (localStorage.getItem('gb.ai.dock') === '1') box.classList.add('dock'); } catch (e) { /* ignore */ }
  new MutationObserver(dock_room).observe(box, { attributes: true, attributeFilter: ['class'] });
  fab.onclick = () => { box.classList.toggle('on'); if (box.classList.contains('on')) setTimeout(() => $('gbai-msg').focus(), 50); };
  $('gbai-x').onclick = () => box.classList.remove('on');
  $('gbai-gear').onclick = () => $('gbai-cfg').classList.toggle('on');
  const close_cfg = () => { $('gbai-cfg').classList.remove('on'); setTimeout(() => $('gbai-msg').focus(), 30) };
  $('gbai-back').onclick = close_cfg;
  // typing here must not reach the page behind (games and 3D views listen for W A S D, Space, E…)
  ;['keydown', 'keyup', 'keypress'].forEach(t => box.addEventListener(t, e => { if (!(t === 'keydown' && e.key === 'Escape')) e.stopPropagation(); }));
  box.addEventListener('keydown', e => { if (e.key === 'Escape' && $('gbai-cfg').classList.contains('on')) { e.stopPropagation(); close_cfg() } });

  /* ---------------- mode: 🤖 API chat (your key) or 🔌 Claude / Codex over MCP (they talk with gb_say / gb_inbox) ---------------- */
  let mode = (() => { try { return localStorage.getItem('gb.ai.mode') === 'mcp' ? 'mcp' : 'api'; } catch (e) { return 'api'; } })();
  function set_mode (m) {
    mode = m; try { localStorage.setItem('gb.ai.mode', m); } catch (e) { /* ignore */ }
    box.classList.toggle('mcpmode', m === 'mcp'); $('gbai-mode').classList.toggle('on', m === 'mcp');
    box.querySelector('.sub').textContent = m === 'mcp' ? '🔌 Claude / Codex (MCP)' : (cfg.model || '');
    $('gbai-msg').placeholder = L('Nhắn cho AI… (Enter gửi, Shift+Enter xuống dòng)', 'Message the AI… (Enter to send, Shift+Enter new line)', 'AI에게 메시지… (Enter 전송)');
    if (cli_ui) eng_apply();
  }
  set_mode(mode); addEventListener('storage', e => { if (e.key === 'gbc.lang') set_mode(mode); });
  $('gbai-mode').onclick = () => {
    set_mode(mode === 'mcp' ? 'api' : 'mcp')
    if (mode === 'mcp') show('mcp', L('Chế độ Claude / Codex: chat ở đây với AI đang điều khiển Greenbox qua MCP. Lời AI hiện ở đây (gb_say); tin bạn gõ được AI đọc bằng gb_inbox. Nhắn AI trong app của nó một lần: "trả lời tôi trong khung chat Greenbox".', 'Claude / Codex mode: chat here with the AI that drives Greenbox over MCP. Its messages show here (gb_say); what you type is read with gb_inbox. Tell the AI once in its own app: "answer me in the Greenbox chat".', 'Claude / Codex 모드: MCP로 Greenbox를 조작하는 AI와 여기서 대화합니다.'))
  };

  /* ---------------- conversation (provider-neutral) ---------------- */
  // history item: {role:'user'|'assistant', parts:[{type:'text',text}|{type:'image',url}|{type:'tool_call',id,name,args}|{type:'tool_result',id,text,image}]}
  let history = []; let pending = []; let busy = false;
  const store = (S) => (k, v) => { try { if (v === undefined) return S().getItem(k); if (v === null) S().removeItem(k); else S().setItem(k, v); } catch (e) { /* private mode */ } return null; };
  const ls = store(() => localStorage); const ss = store(() => sessionStorage);
  /* the chat survives a page change in the same tab (an AI tool may send the browser to another Greenbox page) */
  let keep_t = 0;
  const keep = () => { clearTimeout(keep_t); keep_t = setTimeout(() => {
    const rows = [...log.children].filter(d => !d.classList.contains('setup') && d.textContent && d.textContent !== '…').slice(-40).map(d => [d.className.replace(/^m /, ''), d.querySelector('.who') ? d.querySelector('.who').textContent : '', d.querySelector('.who') ? d.textContent.slice(d.querySelector('.who').textContent.length) : d.textContent]);
    ss('gb.ai.log', JSON.stringify(rows)); ss('gb.ai.open', box.classList.contains('on') ? '1' : '0');
  }, 200); };
  const log = $('gbai-log');
  const show = (cls, text, img) => { const d = document.createElement('div'); d.className = 'm ' + cls; d.textContent = text || ''; if (img) { const i = document.createElement('img'); i.src = img; d.appendChild(i); } log.appendChild(d); log.scrollTop = log.scrollHeight; keep(); return d; };
  const renderAtt = () => { $('gbai-att').innerHTML = pending.map((p, i) => `<span>🖼 ${i + 1}</span>`).join(''); };
  $('gbai-clear').onclick = () => { history = []; pending = []; log.innerHTML = ''; renderAtt(); ls('gb.ai.sid.claude', null); ls('gb.ai.sid.codex', null); keep(); };
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

  /* ---------------- one chat: the message goes to whatever AI is ready ---------------- */
  const api_ready = () => !!cfg.model && (!!cfg.key || cfg.prov === 'ollama');
  const mcp_live = () => { try { if (window.__gbBridge && window.__gbBridge.state().relay === 'on') return true; } catch (e) { /* ignore */ } return !!(mcp && mcp.last_call_ago !== null && mcp.last_call_ago < 300); };
  /** an error as a red line in the chat, in plain words */
  function friendly (e) {
    const m = String((e && e.message) || e || ''); const st = e && e.status;
    if (st === 401 || /api[_ -]?key|x-api-key|unauthori[sz]ed|authentication/i.test(m)) return L('API key sai hoặc đã hết hạn. Bấm ⚙ để dán key khác.', 'The API key is wrong or expired. Press ⚙ to paste another one.', 'API 키가 잘못되었거나 만료되었습니다.');
    if (st === 402 || /credit|billing|balance|quota/i.test(m)) return L('Tài khoản API hết tiền / hết hạn mức. Nạp thêm ở trang của nhà cung cấp.', 'The API account is out of credit / quota. Top it up on the provider\'s site.', 'API 크레딧이 부족합니다.');
    if (st === 429) return L('Gửi quá nhanh / quá nhiều: đợi một chút rồi gửi lại.', 'Too many requests: wait a moment and send again.', '요청이 너무 많습니다. 잠시 후 다시.');
    if (st === 404 || /model/i.test(m) && /not.?found|does not exist|invalid/i.test(m)) return L(`Không có model "${cfg.model}". Bấm ⚙ và nhập đúng tên model.`, `There is no model "${cfg.model}". Press ⚙ and type the right model name.`, '모델 이름이 틀렸습니다.');
    if (st === 529 || st === 503 || /overloaded/i.test(m)) return L('Máy chủ AI đang quá tải: gửi lại sau ít phút.', 'The AI service is overloaded: try again in a few minutes.', 'AI 서버 과부하.');
    if (/failed to fetch|networkerror|load failed/i.test(m)) return L('Không gọi được AI: kiểm tra mạng (hoặc nhà cung cấp chặn gọi từ trình duyệt).', 'Could not reach the AI: check the network (or the provider blocks browser calls).', '네트워크를 확인하세요.');
    return m;
  }
  const show_err = (e) => show('err', '⚠ ' + friendly(e));
  /** no AI ready: say why in the chat, with a box to paste a key right here */
  let last_text = '';
  function setup_card () {
    const d = show('a setup', '');
    d.innerHTML = `<b>${L('Chưa có AI nào được nối với Greenbox', 'No AI is connected to Greenbox yet', '연결된 AI가 없습니다')}</b>
      <div class="opt">${L('Greenbox là trang web, bản thân nó không có AI. Chọn 1 trong 2 (chỉ làm 1 lần):', 'Greenbox is a web page with no AI of its own. Pick one (only once):', '둘 중 하나를 고르세요 (한 번만):')}</div>
      <div class="opt">① ${L('Dán API key (Anthropic <code>sk-ant-…</code>, hoặc OpenAI / Gemini / OpenRouter): chat ngay ở đây.', 'Paste an API key (Anthropic <code>sk-ant-…</code>, or OpenAI / Gemini / OpenRouter): chat right here.', 'API 키를 붙여넣기: 바로 채팅.')}</div>
      <div class="row"><input type="password" data-k="key" placeholder="sk-ant-…" autocomplete="off"><button type="button" class="pri" data-k="save">${L('Lưu & gửi', 'Save & send', '저장·전송')}</button></div>
      <div class="row" data-k="mrow" style="display:none"><input data-k="model" placeholder="${L('tên model (vd. gpt-4o-mini)', 'model name (e.g. gpt-4o-mini)', '모델 이름')}"></div>
      <div class="opt">② ${L('Dùng Claude Desktop / Claude Code / Codex của bạn (không cần key):', 'Use your Claude Desktop / Claude Code / Codex (no key):', 'Claude Desktop / Codex 사용 (키 불필요):')}<br>
        1. ${L('Tắt hẳn Claude Desktop (Cmd+Q) rồi mở lại (Greenbox đã được gắn vào nó; nếu chưa, bấm ⚙ → “Claude Desktop”).', 'Quit Claude Desktop completely (Cmd+Q) and reopen it (Greenbox is already set up in it; if not, press ⚙ → “Claude Desktop”).', 'Claude Desktop 재시작.')}<br>
        2. ${L('Trong Claude Desktop, mở chat mới, gõ: “kết nối Greenbox và trả lời tôi trong khung chat Greenbox”.', 'In Claude Desktop, start a new chat and type: “connect to Greenbox and answer me in the Greenbox chat”.', '새 채팅: “Greenbox 연결”.')}<br>
        3. ${local ? L('Xong: không cần mã. Quay lại đây nhắn tiếp, AI đọc tin của bạn và trả lời trong khung này.', 'Done: no code needed. Come back here and keep typing; the AI reads it and answers in this box.', '완료: 코드 불필요.') : L('Nó đưa mã 6 số → bấm ⚙, nhập vào ô Mã ghép nối, bấm 🔗.', 'It gives a 6-digit code → press ⚙, type it in the pairing box, press 🔗.', '6자리 코드 입력.')}</div>`;
    const k = d.querySelector('[data-k=key]'); const mrow = d.querySelector('[data-k=mrow]'); const mi = d.querySelector('[data-k=model]');
    k.addEventListener('input', () => { const v = k.value.trim(); mrow.style.display = v && !/^sk-ant-/.test(v) ? '' : 'none'; });
    const save_key = () => {
      const v = k.value.trim(); if (!v) return;
      let p = 'openai'; if (/^sk-ant-/.test(v)) p = 'anthropic'; else if (/^sk-or-/.test(v)) p = 'openrouter'; else if (/^AIza/.test(v)) p = 'gemini';
      const model = p === 'anthropic' ? (cfg.prov === 'anthropic' && cfg.model ? cfg.model : 'claude-sonnet-5-5') : mi.value.trim();
      if (!model) { mrow.style.display = ''; mi.focus(); show_err(L('Nhập tên model cho key này.', 'Type the model name for this key.', '모델 이름을 입력하세요.')); return; }
      prov.value = p; $('gbai-base').value = PRESETS[p].base; $('gbai-key').value = v; $('gbai-model').value = model; sync();
      d.remove(); show('t', '✓ ' + L(`Đã lưu key (${PRESETS[p].label}, ${model}). Key chỉ nằm trong trình duyệt này.`, `Key saved (${PRESETS[p].label}, ${model}). It stays in this browser.`, '키 저장됨'));
      if (last_text) { $('gbai-msg').value = last_text; send(); }
    };
    d.querySelector('[data-k=save]').onclick = save_key;
    k.addEventListener('keydown', e => { if (e.key === 'Enter') save_key(); });
    setTimeout(() => k.focus(), 30);
  }

  /* ---------------- 💻 the AI command-line apps on this computer (Claude Code / Codex): no API key, the user's own login.
     The local server runs the CLI with the Greenbox MCP attached (gb-ai/cli_agent.py) and this panel shows what it says. ---------------- */
  const UIH = { 'X-Greenbox-UI': '1' };
  let cli = null; let cli_job = null;
  const eng_sel = $('gbai-eng'); const ENG = { claude: 'Claude Code', codex: 'Codex' };
  const eng = () => eng_sel.value; const eng_cli = () => eng() === 'claude' || eng() === 'codex';
  function eng_apply () {
    box.classList.toggle('mcpmode', eng_cli() || mode === 'mcp');
    if (eng_cli()) box.querySelector('.sub').textContent = '💻 ' + ENG[eng()] + (cli && cli[eng()] && cli[eng()].version ? ' ' + (/\d+\.\d+\.\d+/.exec(cli[eng()].version) || [''])[0] : '');
    $('gbai-edit').style.display = eng_cli() ? '' : 'none'; $('gbai-edit').classList.toggle('on', ls('gb.ai.edit') === '1');
    $('gbai-edit').title = L('Cho AI sửa file của Greenbox (tắt = chỉ điều khiển tool)', 'Let the AI edit Greenbox files (off = it only drives the tools)', 'AI가 Greenbox 파일 수정 허용');
    eng_sel.title = L('AI trả lời: Claude / Codex cài trên máy (không cần key) hoặc API key', 'Who answers: Claude / Codex installed on this computer (no key) or an API key', '응답할 AI');
  }
  function eng_fill () {
    const cur = ls('gb.ai.eng'); eng_sel.innerHTML = '';
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; eng_sel.appendChild(o); };
    if (cli && cli.claude) add('claude', '💻 Claude'); if (cli && cli.codex) add('codex', '💻 Codex');
    add('api', '🔑 API / MCP');
    eng_sel.value = [...eng_sel.options].some(o => o.value === cur) ? cur : eng_sel.options[0].value;
    eng_apply(); if (!eng_cli()) set_mode(mode);
  }
  var cli_ui = true;
  eng_sel.onchange = () => { ls('gb.ai.eng', eng()); if (eng_cli()) eng_apply(); else { box.classList.remove('mcpmode'); set_mode(mode === 'mcp' ? 'mcp' : 'api'); } };
  $('gbai-edit').onclick = () => { const on = ls('gb.ai.edit') !== '1'; ls('gb.ai.edit', on ? '1' : '0'); eng_apply(); show('t', on ? '✏️ ' + L('AI được sửa file trong thư mục Greenbox (tin kế tiếp).', 'The AI may edit files in the Greenbox folder (from the next message).', '파일 수정 허용') : L('AI chỉ điều khiển tool, không sửa file.', 'The AI only drives the tools, no file edits.', '도구만 사용')); };
  $('gbai-stop').onclick = () => { if (cli_job) fetch('/bridge/cli/stop', { method: 'POST', headers: UIH, body: JSON.stringify({ job: cli_job.id }) }).catch(() => {}); };
  async function cli_status () {
    if (local) { try { const r = await fetch('/bridge/cli/status', { cache: 'no-store', headers: UIH }); cli = r.ok ? await r.json() : null; } catch (e) { cli = null; } }
    eng_fill();
  }
  const page_info = () => location.pathname.split('/').slice(-2).join('/') + (window.__gbRig || window.__gbGo ? ' (the cockpit: every tool is a tab here)' : ' (a single tool page; gb_open {page} sends the browser to another one)');
  function cli_err (m, e) {
    if (/log ?in|logged|auth|credential|401|api key/i.test(m)) return L(`${ENG[e]} chưa đăng nhập: mở Terminal, chạy "${e}" một lần để đăng nhập rồi nhắn lại.`, `${ENG[e]} is not signed in: open a terminal, run "${e}" once to sign in, then send again.`, `${ENG[e]} 로그인 필요`);
    if (/limit|quota|usage/i.test(m)) return L(`${ENG[e]} hết hạn mức lúc này: đổi sang AI khác ở ô chọn bên dưới, hoặc đợi.`, `${ENG[e]} hit its usage limit: pick the other AI below, or wait.`, '사용 한도') + '\n' + m;
    return m;
  }
  async function cli_follow () {
    const wait = show('t', '…'); let fails = 0; const e = cli_job.eng;
    $('gbai-stop').hidden = false; busy = true; $('gbai-send').disabled = true;
    while (cli_job) {
      let p;
      try { const r = await fetch(`/bridge/cli/poll?job=${cli_job.id}&from=${cli_job.next}`, { cache: 'no-store', headers: UIH }); if (!r.ok) throw new Error(r.status); p = await r.json(); fails = 0; }
      catch (x) { if (++fails > 20) { show_err(L('Mất kết nối với máy chủ Greenbox.', 'Lost the Greenbox server.', '서버 연결 끊김')); break; } await new Promise(r => setTimeout(r, 1500)); continue; }
      for (const ev of p.events) {
        if (ev.k === 'text') say('💻 ' + ENG[e], ev.text);
        else if (ev.k === 'tool') { if (!/greenbox/.test(ev.name)) show('t', '🔧 ' + ev.name + ' ' + String(ev.args || '').slice(0, 140)); }
        else if (ev.k === 'tool_end' && !ev.ok) show('t', '⚠ ' + ev.text);
        else if (ev.k === 'done') {
          if (ev.sid) ls('gb.ai.sid.' + e, ev.sid);
          if (ev.stopped) show('t', '⏹ ' + L('đã dừng', 'stopped', '중지됨'));
          else if (ev.error === 'gone') show('t', L('(máy chủ đã khởi động lại: gửi lại tin)', '(the server restarted: send again)', '(다시 보내세요)'));
          else if (ev.error) { if (cli_job.sid && /session|conversation|thread|resume/i.test(ev.error)) { ls('gb.ai.sid.' + e, null); show('t', L('(phiên cũ đã hết: gửi lại tin để mở phiên mới)', '(the old session is gone: send again to start a new one)', '(새 세션으로 다시 보내세요)')); } else show_err(cli_err(ev.error, e)); }
        }
      }
      cli_job.next = p.next; log.appendChild(wait); log.scrollTop = log.scrollHeight;
      if (p.done) cli_job = null;
      ss('gb.ai.job', cli_job ? JSON.stringify(cli_job) : null);
    }
    cli_job = null; ss('gb.ai.job', null); wait.remove();
    $('gbai-stop').hidden = true; busy = false; $('gbai-send').disabled = false;
  }
  async function cli_send (text) {
    const e = eng(); show('u', text); $('gbai-msg').value = '';
    busy = true; $('gbai-send').disabled = true;
    try {
      const sid = ls('gb.ai.sid.' + e) || '';
      const r = await fetch('/bridge/cli/send', { method: 'POST', headers: Object.assign({ 'X-Greenbox-Client': window.__gbClient || '-' }, UIH), body: JSON.stringify({ engine: e, text, sid, page: page_info(), lang: lang(), edit: ls('gb.ai.edit') === '1' }) });
      if (r.status === 404) throw new Error(L('Máy chủ Greenbox cũ: tắt rồi chạy lại Mo-Greenbox để có chat Claude / Codex.', 'Old Greenbox server: restart Mo-Greenbox to get the Claude / Codex chat.', '서버를 다시 실행하세요.'));
      const j = await r.json();
      if (!j.ok && !(j.error === 'busy' && j.job)) throw new Error(j.error === 'not-found' ? L(`Không thấy ${ENG[e]} trên máy này.`, `${ENG[e]} was not found on this computer.`, `${ENG[e]} 없음`) : (j.error || r.status));
      if (!j.ok) show('t', L('(AI đang làm việc trước đó, xem tiếp…)', '(the AI is still on the previous message…)', '(이전 작업 진행 중…)'));
      cli_job = { id: j.job, next: 0, eng: e, sid };
      await cli_follow();
    } catch (x) { show_err(x); }
    busy = false; $('gbai-send').disabled = false;
  }
  // back after a page change: the old bubbles, and the AI's running job if there is one
  try {
    JSON.parse(ss('gb.ai.log') || '[]').forEach(([c, who, text]) => { if (who) { const d = say(who, text); d.className = 'm ' + c; } else show(c, text); });
    if (ss('gb.ai.open') === '1') box.classList.add('on');
    const j = JSON.parse(ss('gb.ai.job') || 'null'); if (j && j.id) { cli_job = j; box.classList.add('on'); cli_follow(); }
  } catch (e) { /* start clean */ }
  new MutationObserver(keep).observe(box, { attributes: true, attributeFilter: ['class'] });
  cli_status();

  async function send () {
    if (busy) return;
    const text = $('gbai-msg').value.trim(); if (!text && pending.length === 0) return;
    last_text = text; $('gbai-cfg').classList.remove('on');
    if (eng_cli()) { if (text) cli_send(text); return; }
    // the message goes to whatever AI is ready: your API key first, else Claude / Codex over MCP, else a card that says how
    if (!api_ready()) {
      if (!text) return;
      show('u', text); $('gbai-msg').value = '';
      (window.__gbInbox || { push () {} }).push({ text, t: Date.now() }); // an AI that connects later still reads it
      if (mcp_live()) { set_mode('mcp'); show('t', '→ ' + L('đã chuyển cho Claude / Codex', 'sent to Claude / Codex', 'Claude / Codex에 전달됨')); }
      else setup_card();
      return;
    }
    if (false) { // (old MCP-only path kept below for reference)
      if (!text) return
      show('u', text); $('gbai-msg').value = '';
      (window.__gbInbox || { push () {} }).push({ text, t: Date.now() });
      return;
    }
    set_mode('api')
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
          catch (e) { results.push({ type: 'tool_result', id: c.id, text: 'ERROR: ' + (e.message || e), error: true }); show_err(e); }
        }
        history.push({ role: 'user', parts: results });
      }
    } catch (e) { document.querySelectorAll('#gbai .m.t').forEach(x => { if (x.textContent === '…') x.remove(); }); show_err(e); }
    busy = false; $('gbai-send').disabled = false;
  }

  const tools = () => cfg.tools ? window.__gbTools.list.filter(t => t.name !== 'gb_say' && t.name !== 'gb_inbox') : [];
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
    const j = await r.json().catch(() => ({})); if (!r.ok) { const er = new Error((j.error && j.error.message) || r.statusText || String(r.status)); er.status = r.status; throw er; }
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
    const j = await r.json().catch(() => ({})); if (!r.ok) { const er = new Error((j.error && (j.error.message || j.error)) || r.statusText || String(r.status)); er.status = r.status; throw er; }
    const m = j.choices[0].message; const out = [];
    if (m.content) out.push({ type: 'text', text: typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('') });
    (m.tool_calls || []).forEach(c => { let a = {}; try { a = JSON.parse(c.function.arguments || '{}'); } catch (e) { /* keep {} */ } out.push({ type: 'tool_call', id: c.id, name: c.function.name, args: a }); });
    return out;
  }
})();
