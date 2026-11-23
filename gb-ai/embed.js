/* Greenbox AI on every page: a tool page opened on its own (not inside the cockpit, which has the panel already)
   gets the same 🤖 AI chat + tools + MCP bridge. One line per page: <script src="…/gb-ai/embed.js" defer></script> */
(function () {
  'use strict';
  let framed = false; try { framed = window.top !== window; } catch (e) { framed = true; }
  if (framed || window.__gbTools || document.getElementById('gbai')) return;
  const base = new URL('.', document.currentScript.src).href; const V = '20261110g';
  const load = (f) => new Promise((res) => { const s = document.createElement('script'); s.src = base + f + '?v=' + V; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  const go = async () => { await load('tools.js'); await load('chat.js'); await load('bridge.js'); };
  if (document.body) go(); else addEventListener('DOMContentLoaded', go);
})();
