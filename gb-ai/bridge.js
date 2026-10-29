/* Greenbox MCP bridge (browser side). When Greenbox is opened through Mo-Greenbox (serve.py on localhost), the
   cockpit picks up tool calls that an MCP client (Claude Desktop / Cowork, via gb-ai/greenbox_mcp.py) sends to
   serve.py, runs them with window.__gbTools and posts the result back. Nothing happens on the GitHub Pages version. */
(function () {
  'use strict';
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !window.__gbTools) return;
  let alive = true; let fails = 0;
  async function loop () {
    while (alive) {
      try {
        const r = await fetch('/bridge/poll', { cache: 'no-store' });
        if (r.status === 404) return; // an old serve.py without the bridge
        if (r.status === 200) {
          const job = await r.json();
          let out;
          // let the chat panel show what the outside AI is doing in here
          dispatchEvent(new CustomEvent('gb-mcp-call', { detail: { tool: job.tool, args: job.args } }));
          try {
            if (job.tool === '__list') out = { ok: true, result: { tools: window.__gbTools.list } };
            else out = { ok: true, result: await window.__gbTools.call(job.tool, job.args) };
          } catch (e) { out = { ok: false, error: String((e && e.message) || e) }; }
          dispatchEvent(new CustomEvent('gb-mcp-done', { detail: { tool: job.tool, ok: out.ok, error: out.error, image: out.ok && out.result ? out.result.image : null } }));
          await fetch('/bridge/result', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(Object.assign({ id: job.id }, out)) });
        }
        fails = 0;
      } catch (e) { fails++; await new Promise(r => setTimeout(r, Math.min(10000, 500 * fails))); }
    }
  }
  loop();
  addEventListener('pagehide', () => { alive = false; });
})();
