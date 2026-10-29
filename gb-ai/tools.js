/* Greenbox AI tools — one list of actions used by BOTH the in-app AI chat (any model with an API key) and the
   MCP server (Claude Desktop / Cowork / any MCP client). They run in the cockpit and reach into the 3D tabs
   (same origin), so an AI can open tabs, look at the 3D view, rig, test and export.

   window.__gbTools = { list: [{name, description, input_schema}], call(name, args) -> Promise<{text, image?}> } */
(function () {
  'use strict';
  const PAGES = { create: 'create.html', rig: 'create.html', retarget: 'retarget/index.html', vehicle: 'vehicle.html', playtest: 'playtest.html', mocap: 'mocap.html', explore: 'index.html' };
  const FEAT = { 'create.html': 'rig', 'retarget/index.html': 'retarget', 'vehicle.html': 'vehicle', 'playtest.html': 'playtest', 'mocap.html': 'mocap' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function rig () { return window.__gbRig || null; }
  /** the window of a 3D page (cockpit iframe), or this window when the page runs on its own */
  function pageWindow (page) {
    const r = rig();
    if (r && r.frame) { const f = r.frame(page ? (PAGES[page] || page) : undefined); return f ? f.contentWindow : null; }
    return window;
  }
  async function openPage (page) {
    const p = PAGES[page] || page;
    if (window.__gbGo && FEAT[p]) window.__gbGo(FEAT[p]); else if (rig()) rig().open(p);
    for (let i = 0; i < 100; i++) { // wait until the page's app object exists
      const w = pageWindow(p);
      if (w && w.document && w.document.readyState === 'complete' && appOf(w)) return w;
      await sleep(150);
    }
    return pageWindow(p);
  }
  function appOf (w) { return w && (w.__gb3d || w.__vehicle || w.__playtest || w.__mocap) || null; }

  /** render the page's 3D view now and grab it as PNG (works without preserveDrawingBuffer) */
  function shot (w, maxW) {
    const a = appOf(w); if (!a) throw new Error('no 3D view on this page');
    const r = a.renderer, sc = a.scene, cam = a.camera;
    r.render(sc, cam);
    const src = r.domElement;
    const scale = Math.min(1, (maxW || 1280) / src.width);
    const c = document.createElement('canvas'); c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function status () {
    const r = rig(); const cur = r && r.current ? r.current() : null;
    const out = { cockpit_feature: document.body.dataset.feat || null, open_3d_page: cur, pages_alive: r && r.pages ? r.pages() : [] };
    const info = {};
    (out.pages_alive.length ? out.pages_alive : [null]).forEach(p => {
      const w = pageWindow(p); if (!w) return; const k = p || 'this';
      try {
        if (w.__gb3d) { const e = w.__gb3d; let meshes = 0; try { e.load_model_step.model_meshes().traverse(o => { if (o.isMesh) meshes++; }); } catch (x) {}
          const sk = (() => { try { return e.edit_skeleton_step.skeleton(); } catch (x) { return null; } })();
          info[k] = { step: e.process_step, model_meshes: meshes, joints: sk ? sk.bones.length : 0, animations: (() => { try { return e.animations_listing_step.animation_clips().length; } catch (x) { return 0; } })() }; }
        else if (w.__vehicle) { const v = w.__vehicle; info[k] = { wheels: v.wheels.map(x => x.name), parts: v.mechs.map(m => m.kind + ':' + m.name), rigged: !!v.rig, clips: (v.clips || []).length }; }
        else if (w.__playtest) { const pt = w.__playtest; info[k] = { character: !!pt.ctrl, state: pt.ctrl ? pt.ctrl.state() : null }; }
        else if (w.__mocap) { const m = w.__mocap; info[k] = { frames: m.frames.length, clip: m.clip ? m.clip.name : null }; }
      } catch (x) { info[k] = { error: String(x) }; }
    });
    out.pages = info;
    return out;
  }

  /* catch the next file the page "downloads" (export buttons) and hand back its bytes */
  function captureDownload (w, timeoutMs) {
    return new Promise((resolve, reject) => {
      const A = w.HTMLAnchorElement.prototype; const orig = A.click;
      const t = setTimeout(() => { A.click = orig; reject(new Error('no file was produced')); }, timeoutMs || 180000);
      A.click = function () {
        if (this.download && /^blob:/.test(this.href)) {
          A.click = orig; clearTimeout(t);
          const name = this.download;
          w.fetch(this.href).then(r => r.blob()).then(b => resolve({ name, blob: b })).catch(reject);
          return;
        }
        return orig.apply(this, arguments);
      };
    });
  }
  async function blobToB64 (b) { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }

  const clipsOf = w => { try { return w.__gb3d.animations_listing_step.animation_clips().length; } catch (x) { return 0; } };
  /** the animation library loads after skinning: wait for it (export needs it) */
  async function waitClips (w) { for (let i = 0; i < 400; i++) { if (w.document.querySelector('#easy-export') && clipsOf(w) > 0) return; await sleep(250); } throw new Error('animations did not load: finish the rig first (gb_rig_finish)'); }

  const T = [];
  const tool = (name, description, props, required, fn) => T.push({ name, description, input_schema: { type: 'object', properties: props || {}, required: required || [] }, fn });

  tool('gb_status', 'What Greenbox is showing now: open 3D tab, loaded model, rig step, joints, vehicle parts, play test / mocap state.', {}, [], async () => ({ text: JSON.stringify(status(), null, 1) }));

  tool('gb_screenshot', 'Picture of the 3D view of a Greenbox page (default: the open one). Use it to check your work.',
    { page: { type: 'string', description: 'create | vehicle | playtest | mocap | retarget (default: current)' } }, [],
    async a => { const w = a.page ? await openPage(a.page) : pageWindow(); return { text: 'screenshot', image: shot(w) }; });

  tool('gb_open', 'Open a Greenbox 3D tab. Tabs stay alive, so work in other tabs is kept.',
    { page: { type: 'string', enum: Object.keys(PAGES) } }, ['page'],
    async a => { await openPage(a.page); return { text: 'opened ' + a.page }; });

  tool('gb_click', 'Click a button/element in a Greenbox page (CSS selector, or visible text with "text=...").',
    { selector: { type: 'string' }, page: { type: 'string' } }, ['selector'],
    async a => {
      const w = a.page ? await openPage(a.page) : pageWindow(); const d = w.document;
      let el = null;
      if (a.selector.startsWith('text=')) { const t = a.selector.slice(5).trim().toLowerCase(); el = [...d.querySelectorAll('button,a,label,summary,[role=button]')].find(e => e.offsetParent !== null && (e.textContent || '').trim().toLowerCase().includes(t)); }
      else el = d.querySelector(a.selector);
      if (!el) throw new Error('not found: ' + a.selector);
      el.click(); await sleep(400); return { text: 'clicked ' + (el.id ? '#' + el.id : el.textContent.trim().slice(0, 40)) };
    });

  tool('gb_set_value', 'Set an input/select value in a Greenbox page and fire its change event.',
    { selector: { type: 'string' }, value: { type: 'string' }, page: { type: 'string' } }, ['selector', 'value'],
    async a => { const w = a.page ? await openPage(a.page) : pageWindow(); const el = w.document.querySelector(a.selector); if (!el) throw new Error('not found: ' + a.selector);
      if (el.type === 'checkbox') el.checked = /^(1|true|on|yes)$/i.test(a.value); else el.value = a.value;
      el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(300); return { text: 'set' }; });

  tool('gb_run_js', 'Run JavaScript inside a Greenbox page (async function body; `return` a JSON value). Globals: create page `__gb3d` (Mesh2Motion engine: load_model_step, edit_skeleton_step, easy_rig, weight_skin_step, animations_listing_step, quick_export_all(fmt)), vehicle `__vehicle` (wheels, mechs, new_mech(kind), build_rig(), clips, play(i)), playtest `__playtest` (ctrl), mocap `__mocap`. THREE objects are live.',
    { code: { type: 'string' }, page: { type: 'string' } }, ['code'],
    async a => { const w = a.page ? await openPage(a.page) : pageWindow(); const F = w.Function('return (async () => {' + a.code + '\n})()'); const r = await F(); let txt; try { txt = JSON.stringify(r, null, 1); } catch (x) { txt = String(r); } return { text: txt === undefined ? 'ok' : txt.slice(0, 20000) }; });

  tool('gb_rig_auto', 'On the "Use your model" tab: scan the loaded model and place every joint of the human skeleton (load the human skeleton first if needed).', {}, [],
    async () => { const w = await openPage('create'); const e = w.__gb3d; const d = w.document;
      if (e.process_step !== 'edit-skeleton') { const sel = d.querySelector('#skeleton-selection'); if (sel) { sel.value = 'human'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(1500); } const b = d.querySelector('#load-skeleton-button'); if (b) { b.click(); await sleep(2500); } }
      const ok = e.easy_rig.fit_to_model(); await sleep(600); return { text: 'joints placed: ' + ok, image: shot(w) }; });

  tool('gb_joints_get', 'World positions of every joint on the "Use your model" tab (editing step).', {}, [],
    async () => { const w = await openPage('create'); const sk = w.__gb3d.edit_skeleton_step.skeleton(); const o = {}; sk.bones.forEach(b => { const v = b.getWorldPosition(b.position.clone()); o[b.name] = [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; }); return { text: JSON.stringify(o) }; });

  tool('gb_joints_set', 'Move joints to world positions {name: [x,y,z]} on the "Use your model" tab (children follow unless listed).',
    { joints: { type: 'object', additionalProperties: { type: 'array', items: { type: 'number' } } } }, ['joints'],
    async a => { const w = await openPage('create'); const e = w.__gb3d; const sk = e.edit_skeleton_step.skeleton(); e.edit_skeleton_step.store_bone_state_for_undo();
      const THREE_V = sk.bones[0].position.constructor; let n = 0;
      Object.entries(a.joints).forEach(([name, p]) => { const b = sk.bones.find(x => x.name === name); if (!b) return; const t = new THREE_V(p[0], p[1], p[2]); b.parent.updateMatrixWorld(true); b.parent.worldToLocal(t); b.position.copy(t); b.updateMatrixWorld(true); n++; });
      e.edit_skeleton_step.dispatchEvent(new w.CustomEvent('skeletonTransformed')); return { text: 'moved ' + n + ' joints', image: shot(w) }; });

  tool('gb_rig_finish', 'On "Use your model": compute skin weights and go to the animation list (178 animations).', {}, [],
    async () => { const w = await openPage('create'); const b = w.document.querySelector('#action_bind_pose'); if (!b) throw new Error('not in the joint editing step'); b.click();
      await waitClips(w); return { text: 'skinned, ' + clipsOf(w) + ' animations ready', image: shot(w) }; });

  tool('gb_export', 'Export from a Greenbox page: create = rigged model + all animations, vehicle = vehicle rig, mocap = clip. Returns the file (base64) to the caller, which can save it.',
    { page: { type: 'string', enum: ['create', 'vehicle', 'mocap'] }, format: { type: 'string', enum: ['glb', 'fbx'] } }, ['page', 'format'],
    async a => { const w = await openPage(a.page); const got = captureDownload(w);
      if (a.page === 'create') { await waitClips(w); w.__gb3d.quick_export_all(a.format); }
      else if (a.page === 'vehicle') w.document.querySelector(a.format === 'fbx' ? '#vh-export-fbx' : '#vh-export-glb').click();
      else w.document.querySelector(a.format === 'fbx' ? '#mc-fbx' : '#mc-glb').click();
      const f = await got; return { text: 'file ' + f.name + ' (' + f.blob.size + ' bytes)', file: { name: f.name, b64: await blobToB64(f.blob) } }; });

  tool('gb_load_file', 'Load a 3D model / video file into a Greenbox page. `data_b64` is the file content (the MCP server fills it from a path on disk).',
    { page: { type: 'string', enum: ['create', 'vehicle', 'playtest', 'mocap'] }, name: { type: 'string' }, data_b64: { type: 'string' } }, ['page', 'name', 'data_b64'],
    async a => { const w = await openPage(a.page); const bin = atob(a.data_b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new w.File([u8], a.name);
      const id = { create: '#model-upload', vehicle: '#vh-file', playtest: '#pt-file', mocap: /\.(mp4|mov|webm|m4v|avi)$/i.test(a.name) ? '#mc-vfile' : '#mc-cfile' }[a.page];
      const input = w.document.querySelector(id); const dt = new w.DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new w.Event('change', { bubbles: true }));
      await sleep(3000); return { text: 'loaded ' + a.name, image: (() => { try { return shot(w); } catch (x) { return undefined; } })() }; });

  window.__gbTools = {
    list: T.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    async call (name, args) {
      const t = T.find(x => x.name === name); if (!t) throw new Error('unknown tool ' + name);
      return await t.fn(args || {});
    },
    shot: (page) => shot(pageWindow(page))
  };
})();
