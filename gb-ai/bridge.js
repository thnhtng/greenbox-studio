/* Greenbox MCP bridge (browser side). Tool calls from an MCP client (Claude Desktop / Claude Code / Codex / Cowork,
   via gb-ai/greenbox_mcp.py) reach this tab in one of two ways, and run with window.__gbTools:
     local  opened through Mo-Greenbox (serve.py): poll /bridge/poll on the same server (no setup);
     web    any other host (GitHub Pages…): greenbox_mcp.py opens a relay on 127.0.0.1; after the user types the
            pairing code once (🤖 AI → ⚙), this tab long-polls http://127.0.0.1:<port>/poll with that code.
   window.__gbBridge = { pair(port, code), unpair(), state() } is used by the chat panel. */
(function () {
  'use strict';
  if (!window.__gbTools) return;
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const KEY = 'gb.mcp.pair';
  const state = { local: false, relay: 'off', port: 0, last: 0, error: '' };
  const emit = () => dispatchEvent(new CustomEvent('gb-mcp-state', { detail: Object.assign({}, state) }));

  async function run (job) {
    dispatchEvent(new CustomEvent('gb-mcp-call', { detail: { tool: job.tool, args: job.args } }));
    let out;
    try {
      if (job.tool === '__list') out = { ok: true, result: { tools: window.__gbTools.list } };
      else out = { ok: true, result: await window.__gbTools.call(job.tool, job.args) };
    } catch (e) { out = { ok: false, error: String((e && e.message) || e) }; }
    dispatchEvent(new CustomEvent('gb-mcp-done', { detail: { tool: job.tool, ok: out.ok, error: out.error, image: out.ok && out.result ? out.result.image : null } }));
    state.last = Date.now(); emit()
    return Object.assign({ id: job.id }, out);
  }

  /* ---- local: serve.py on the same origin ---- */
  async function local_loop () {
    let fails = 0
    for (;;) {
      try {
        const r = await fetch('/bridge/poll', { cache: 'no-store' });
        if (r.status === 404) return; // an old serve.py without the bridge
        if (!state.local) { state.local = true; emit() }
        if (r.status === 200) {
          const res = await run(await r.json());
          await fetch('/bridge/result', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(res) });
        }
        fails = 0;
      } catch (e) { fails++; if (state.local) { state.local = false; emit() } await new Promise(r => setTimeout(r, Math.min(10000, 500 * fails))); }
    }
  }
  if (local) local_loop();

  /* ---- web: relay opened by greenbox_mcp.py on this computer ---- */
  let gen = 0;
  function saved () { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  async function relay_loop (port, code, my) {
    const base = 'http://127.0.0.1:' + port;
    let fails = 0;
    state.port = port; state.relay = 'connecting'; emit();
    while (my === gen) {
      try {
        const r = await fetch(base + '/poll', { cache: 'no-store', headers: { 'X-Greenbox-Pair': code } });
        if (r.status === 401) { state.relay = 'bad-code'; state.error = 'wrong code'; emit(); return; }
        if (state.relay !== 'on') { state.relay = 'on'; state.error = ''; emit(); }
        if (r.status === 200) {
          const res = await run(await r.json());
          await fetch(base + '/result', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Greenbox-Pair': code }, body: JSON.stringify(res) });
        }
        fails = 0;
      } catch (e) {
        // relay not running (AI app closed) or the browser blocked localhost: keep trying quietly
        fails++; if (state.relay !== 'waiting') { state.relay = 'waiting'; state.error = String((e && e.message) || e); emit(); }
        await new Promise(r => setTimeout(r, Math.min(15000, 1000 * fails)));
      }
    }
  }
  window.__gbBridge = {
    pair (port, code) {
      port = Number(port) || 47827; code = String(code || '').replace(/\D/g, '');
      try { localStorage.setItem(KEY, JSON.stringify({ port, code })); } catch (e) { /* private mode: this session only */ }
      gen++; relay_loop(port, code, gen);
    },
    unpair () { gen++; try { localStorage.removeItem(KEY); } catch (e) {} state.relay = 'off'; emit(); },
    /** is a relay listening on this port? (no code needed) */
    async probe (port) { try { const r = await fetch('http://127.0.0.1:' + (Number(port) || 47827) + '/hello', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } },
    state: () => Object.assign({}, state)
  };
  const s = saved(); if (s && s.code) window.__gbBridge.pair(s.port, s.code);
  addEventListener('pagehide', () => { gen++; });
})();
