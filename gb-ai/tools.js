/* Greenbox AI tools — one list of actions used by BOTH the in-app AI chat (any model with an API key) and the
   MCP server (Claude Desktop / Cowork / any MCP client). They run in the cockpit and reach into the 3D tabs
   (same origin), so an AI can open tabs, look at the 3D view, rig, test and export.

   window.__gbTools = { list: [{name, description, input_schema}], call(name, args) -> Promise<{text, image?}> } */
(function () {
  'use strict';
  const PAGES = { create: 'create.html', rig: 'create.html', retarget: 'retarget/index.html', vehicle: 'vehicle.html', playtest: 'playtest.html', mocap: 'mocap.html', smash: 'smash.html', explore: 'index.html', drama: '../drama.html' };
  const FEAT = { '../drama.html': 'drama', 'create.html': 'rig', 'retarget/index.html': 'retarget', 'vehicle.html': 'vehicle', 'playtest.html': 'playtest', 'mocap.html': 'mocap', 'smash.html': 'smash' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function rig () { return window.__gbRig || null; }
  /* a Greenbox page opened on its own (not inside the cockpit): it can only show itself, so a tool that needs
     another page sends the browser there and asks the AI to call again (the chat panel survives the reload) */
  const ROOT = (() => { try { return new URL('..', document.currentScript.src).href; } catch (e) { return new URL('.', location.href).href; } })();
  const solo = () => !window.__gbRig && !window.__gbGo;
  function leave (url, what) { setTimeout(() => { location.href = url; }, 350); const e = new Error('moved'); e.gbMoved = what; throw e; }
  const COCKPIT_ONLY = { gb_hpbar: 1, gb_drive: 1, gb_sfx: 1 };
  /** the window of a 3D page (cockpit iframe), or this window when the page runs on its own */
  function pageWindow (page) {
    const r = rig();
    if (r && r.frame) { const f = r.frame(page ? (PAGES[page] || page) : undefined); return f ? f.contentWindow : null; }
    return window;
  }
  async function openPage (page) {
    const p = PAGES[page] || page;
    if (solo()) {
      const url = new URL('rig3d/' + p, ROOT).href;
      if (!PAGES[page] && !/\.html$/.test(p)) return window; // not a page name: stay here
      if (location.href.split(/[?#]/)[0] !== url) leave(url, page);
      for (let i = 0; i < 100 && !appOf(window); i++) await sleep(150);
      return window;
    }
    if (window.__gbGo && FEAT[p]) window.__gbGo(FEAT[p]); else if (rig()) rig().open(p);
    for (let i = 0; i < 100; i++) { // wait until the page's app object exists
      const w = pageWindow(p);
      if (w && w.document && w.document.readyState === 'complete' && appOf(w)) return w;
      await sleep(150);
    }
    return pageWindow(p);
  }
  function appOf (w) { return w && (w.__gb3d || w.__vehicle || w.__playtest || w.__mocap || w.__smash || w.__space || w.__gbDrama) || null; }

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
    if (solo()) { out.single_page = location.pathname.split('/').pop(); out.title = document.title; out.note = 'one tool page on its own: gb_open {page} sends the browser to another tool'; }
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

  /* ---------------- analysis, vehicles / any model, play-test map, HP-bar video ---------------- */
  tool('gb_analyze', 'Analyse the model loaded on a page: what it is (humanoid / quadruped / vehicle / object) and its anchor points — head, arms, legs and accessories (tail, wings, ears, horns, hair, cape, held items) with joint positions inside the mesh. On "vehicle" it can also create a bone chain on every branch (make_bones).',
    { page: { type: 'string', enum: ['create', 'vehicle'] }, make_bones: { type: 'boolean', description: 'vehicle page: create free bones along every branch (default true)' } }, ['page'],
    async a => { const w = await openPage(a.page); let an;
      if (a.page === 'vehicle') an = w.__vehicle.analyze_model(a.make_bones !== false);
      else { w.__gb3d.easy_rig.show_anchors(true); an = w.__gb3d.easy_rig.last_analysis; }
      if (!an) throw new Error('no model loaded');
      const r3 = v => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
      return { text: JSON.stringify({ type: an.type, size: r3(an.size), core: r3(an.core), notes: an.notes, branches: an.branches.map(b => ({ name: b.name, kind: b.kind, side: b.side, tip: r3(b.tip), joints: b.joints.map(r3) })) }), image: shot(w) }; });

  tool('gb_smash', 'SMASH DOWN blockout (a shooting ad: a wall of cans / boxes on a table, a gun in the middle). Actions: status (ammo, knocked, blocks, layout), preset {name: wall | pyramid | towers | checker | random}, reset (rebuild the stack), shoot {x, y} (0..1 of the 9:16 view), auto {on} (auto shoot), record (start recording the 9:16 view), stop (stop and save the blockout video), prompt (the Seedance video-to-video prompt for the chosen theme), base {name: table | pedestal | steps | float | spin (turntable) | slide (moves side to side), speed? 0–3, color? "#rrggbb"} (what the stack stands on), hit {mode: knock | break} (a hit knocks pieces over, or breaks them into bits), build_base {shape?: box | round, thick? m (0.02–0.8), width? ×(0.5–2.2), depth? ×(0.5–4), legs?: pole | two | four | solid | none} (your own base).',
    { action: { type: 'string', enum: ['status', 'preset', 'reset', 'shoot', 'auto', 'record', 'stop', 'prompt', 'base', 'hit', 'build_base'] }, name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, on: { type: 'boolean' }, speed: { type: 'number' }, color: { type: 'string' }, mode: { type: 'string', enum: ['knock', 'break'] }, shape: { type: 'string', enum: ['box', 'round'] }, thick: { type: 'number' }, width: { type: 'number' }, depth: { type: 'number' }, legs: { type: 'string', enum: ['pole', 'two', 'four', 'solid', 'none'] } }, ['action'],
    async a => { const w = await openPage('smash'); const S = w && w.__smash; if (!S) throw new Error('the SMASH DOWN page did not open');
      if (a.action === 'preset') S.preset(a.name || 'wall'); else if (a.action === 'reset') S.reset(); else if (a.action === 'shoot') S.shoot(a.x ?? 0.5, a.y ?? 0.45);
      else if (a.action === 'auto') S.auto(a.on !== false); else if (a.action === 'record') S.record(); else if (a.action === 'stop') S.stop();
      else if (a.action === 'prompt') return { text: w.document.getElementById('sm-prompt').value };
      else if (a.action === 'base') S.base(a.name || 'table', a.speed, a.color);
      else if (a.action === 'hit') S.hit(a.mode === 'break' ? 'break' : 'knock');
      else if (a.action === 'build_base') S.build_base({ shape: a.shape, thick: a.thick, width: a.width, depth: a.depth, legs: a.legs });
      await sleep(300); return { text: JSON.stringify(S.state()) }; });
  tool('gb_vehicle', 'Vehicles / any-model rig tab. Actions: auto_rig (one click: what was learned from 4–5 ★ rigs of the same shape + shape scan + bones + all keyframed animations), rate {score 1–5} (rate the rig on screen; 4–5 ★ rigs teach the next auto_rig), scan_wheels, find_tracks (caterpillar belts as bone chains), add_bone {name, at:[x,y,z], parent?, axis?} (a free bone with its joint at a point; parent chains it), assign_box {part, min:[x,y,z], max:[x,y,z]} (give every vertex inside a box to a part / bone), separate {part} (cut the part into its own mesh and fill the holes), set_type {type: car|truck|tracked|roller}, build (rig + animations), play {clip}, stop, list.',
    { action: { type: 'string', enum: ['list', 'scan_wheels', 'find_tracks', 'add_bone', 'assign_box', 'separate', 'set_type', 'build', 'play', 'stop', 'auto_rig', 'rate'] }, score: { type: 'number', description: 'rate: 1–5 stars' }, name: { type: 'string' }, part: { type: 'string', description: 'part / bone name' }, parent: { type: 'string' }, at: { type: 'array', items: { type: 'number' } }, min: { type: 'array', items: { type: 'number' } }, max: { type: 'array', items: { type: 'number' } }, axis: { type: 'string', enum: ['auto', 'x', 'y', 'z'] }, type: { type: 'string' }, clip: { type: 'string' } }, ['action'],
    async a => { const w = await openPage('vehicle'); const v = w.__vehicle; const D0 = 100;
      const code = n => { const j = v.mechs.findIndex(m => m.name === n); if (j >= 0) return D0 + j; const k = v.wheels.findIndex(x => x.name === n); if (k >= 0) return k; throw new Error('no part named ' + n); };
      const after = () => { v.clear_rig(); v.name_parts(); v.refresh_part_select(); v.refresh_colors(); };
      switch (a.action) {
        case 'scan_wheels': v.scan_wheels(); break;
        case 'auto_rig': v.auto_rig(); break;
        case 'rate': v.rate(Math.max(1, Math.min(5, Math.round(a.score || 0)))); break;
        case 'find_tracks': v.find_tracks(); break;
        case 'set_type': v.vtype = a.type; w.document.getElementById('vh-type').value = a.type; v.clear_rig(); break;
        case 'add_bone': { const nm = (a.name || 'bone_' + (v.mechs.length + 1)).replace(/\s+/g, '_'); v.mechs.push({ kind: 'bone', name: nm, hinge: 'auto', angle: 30, flip: false, axis: a.axis || 'auto', pivot: a.at, ...(a.parent ? { parent: a.parent } : {}) }); v.active = D0 + v.mechs.length - 1; after(); break; }
        case 'assign_box': { const c = code(a.part); let n = 0; v.parts.forEach(p => { const pos = p.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (x >= a.min[0] && x <= a.max[0] && y >= a.min[1] && y <= a.max[1] && z >= a.min[2] && z <= a.max[2]) { p.owner[i] = c; n++; } } }); after(); return { text: 'assigned ' + n + ' vertices to ' + a.part, image: shot(w) }; }
        case 'separate': v.active = code(a.part); v.separate_selected(); break;
        case 'build': v.build_rig(); break;
        case 'play': { if (!v.rig) v.build_rig(); const i = v.clips.findIndex(c => c.name === a.clip); if (i < 0) throw new Error('clips: ' + v.clips.map(c => c.name).join(', ')); v.play(i); break; }
        case 'stop': v.stop_anim && v.stop_anim(); break;
      }
      const box = v.box(); const r3 = x => +x.toFixed(3);
      return { text: JSON.stringify({ status: w.document.getElementById('vh-status').textContent, type: v.vtype, size: [box.min, box.max].map(p => [r3(p.x), r3(p.y), r3(p.z)]), wheels: v.wheels.map(x => x.name), parts: v.mechs.map(m => m.kind + ':' + m.name + (m.parent ? '<' + m.parent : '')), clips: (v.clips || []).map(c => c.name) }), image: shot(w) }; });

  tool('gb_map', 'Play-test map editor (terrain + objects, RTS-style). Actions: preset {preset: flat|hills|island|valley|mountains}, add {object: pine|tree|bush|rock|house|tower|wall|fence|hwall|door|window|crate|barrel|flag|roof|floor|stairs, x, z, rot?, scale?, level?} (level: storey 0..4, 2.8 m each; hwall / door / window: one 3 m house-wall piece centred at x, z, rot 0 = along X, pi/2 = along Z, ends on grid points every 1.5 m; roof: x, z = a point inside closed walls on that level, the roof fits the room; floor: x, z inside a closed room, level 0 = wooden floor, level 1+ = slab over the walls of level-1 with holes over stairs; stairs: 1.5 x 4.5 m from level to level+1, rot in 90 degree steps, rising towards +z when rot 0), sculpt {tool: raise|lower|flatten|smooth|paint, x, z, radius?, strength?, ground?: 0 grass 1 dirt 2 sand 3 rock 4 snow 5 road 6 water bed}, water {level}, export_blender (Python script that rebuilds the map in Blender), export_glb, get (map JSON summary). Also: dig {x, z, radius?, depth?} carves a flat-bottomed hole; pour {x, z, fill?: 0.3..1} fills the hole / channel at (x, z) with water up to its rim; sea {on: bool}; erase {x, z, radius?} removes props there; shot_add {mode?: fixed|look|follow, follow?: "player"|object name, t?, dur?, fov?} saves the current camera view as a shot; shots (list); shots_play; layout {image_b64, legend?: [{color:"#rrggbb", kind}]} builds the map from a top-down colour plan (kinds: background grass water sand road dirt mountain snow forest tree house tower wall fence rock flag); export_unity (C# script that plays the shots); export_playable {cta?: store / landing link, title?: game name on the loading screen + end card, limit?: seconds of play before the end card (0 = when every upgrade is bought)} = the playable ad as one HTML file (map + the Play test player + the 2D plan gameplay; build the plan first); plan {plan: {shapes: [{id, kind: zone|block|source|machine|stack|counter|unlock|player, form: rect|ellipse, x, z, w, d, r, label, color, height, gives?, takes?, time?, price?, model?}], wires: [{id, from, to, mode: carry|belt|unlock}]}, play?: bool} builds a 2D plan as a 3D playable (and plays it); clear (empty map).',
    { action: { type: 'string', enum: ['get', 'preset', 'add', 'sculpt', 'water', 'dig', 'pour', 'sea', 'erase', 'shot_add', 'shots', 'shots_play', 'layout', 'export_blender', 'export_glb', 'export_unity', 'export_playable', 'plan', 'clear'] }, plan: { type: 'object' }, play: { type: 'boolean' }, depth: { type: 'number' }, fill: { type: 'number' }, on: { type: 'boolean' }, mode: { type: 'string' }, follow: { type: 'string' }, t: { type: 'number' }, dur: { type: 'number' }, fov: { type: 'number' }, image_b64: { type: 'string' }, legend: { type: 'array', items: { type: 'object' } }, level: { type: 'number' }, cta: { type: 'string' }, title: { type: 'string' }, limit: { type: 'number' }, preset: { type: 'string' }, object: { type: 'string' }, x: { type: 'number' }, z: { type: 'number' }, rot: { type: 'number' }, scale: { type: 'number' }, tool: { type: 'string' }, radius: { type: 'number' }, strength: { type: 'number' }, ground: { type: 'number' }, level: { type: 'number' } }, ['action'],
    async a => { const w = await openPage('playtest'); const m = w.__playtest.map;
      if (a.action === 'preset') m.preset(a.preset || 'flat');
      else if (a.action === 'add' && a.object === 'roof') { if (!m.add_roof_at(a.x || 0, a.z || 0, a.level || 0)) return { text: 'No closed room at that x, z on that level: close the walls first.' }; }
      else if (a.action === 'add' && a.object === 'floor') { if (!m.add_floor_at(a.x || 0, a.z || 0, a.level || 0)) return { text: 'No closed room at that x, z: close the walls first.' }; }
      else if (a.action === 'add' && a.object === 'stairs') { const keep = m.rot; m.rot = a.rot || 0; m.add_stairs_at(a.x || 0, a.z || 0, a.level || 0); m.rot = keep; }
      else if (a.action === 'add' && a.level) { const o = m.add_object(a.object || 'tree', a.x || 0, a.z || 0, a.rot || 0, a.scale || 1, { lv: a.level }); }
      else if (a.action === 'add') m.add_object(a.object || 'tree', a.x || 0, a.z || 0, a.rot || 0, a.scale || 1);
      else if (a.action === 'sculpt') { const keep = [m.tool, m.radius, m.strength, m.ground]; m.tool = a.tool; if (a.radius) m.radius = a.radius; if (a.strength) m.strength = a.strength; if (a.ground !== undefined) m.ground = a.ground; m.sculpt_at(a.x || 0, a.z || 0); [m.tool, m.radius, m.strength, m.ground] = keep; }
      else if (a.action === 'water') { m.water = a.level; m.rebuild(); }
      else if (a.action === 'dig') { const keep = [m.tool, m.radius, m.dig_depth]; m.tool = 'dig'; if (a.radius) m.radius = a.radius; if (a.depth) m.dig_depth = a.depth; m.sculpt_at(a.x || 0, a.z || 0); [m.tool, m.radius, m.dig_depth] = keep; }
      else if (a.action === 'pour') { if (a.fill) m.pool_fill = a.fill; const p = m.pour(a.x || 0, a.z || 0); if (!p) throw new Error('no closed hole at that spot: dig first'); }
      else if (a.action === 'sea') { m.sea = a.on !== false; m.rebuild(); }
      else if (a.action === 'erase') { const W = w.__playtest.world; const R = a.radius || 2; for (const o of [...W.props.children]) { if (o.name === 'Terrain') continue; if (Math.hypot(o.position.x - (a.x || 0), o.position.z - (a.z || 0)) < R) { if (o.userData.map_kind !== undefined) { o.removeFromParent(); } else W.remove(o); } } W.refresh(); m.autosave_now(); }
      else if (a.action === 'shot_add') { const r = w.__playtest.rig; const s = r.add_shot(); if (a.mode) s.mode = a.mode; if (a.follow) s.follow = a.follow; if (a.t !== undefined) s.t = a.t; if (a.dur) s.dur = a.dur; if (a.fov) s.fov = a.fov; r.capture(s); r.on_change && r.on_change(); r.refresh_panel(); return { text: JSON.stringify(s), image: shot(w) }; }
      else if (a.action === 'shots') return { text: JSON.stringify(w.__playtest.rig.shots) };
      else if (a.action === 'shots_play') { w.__playtest.rig.play(); return { text: 'playing ' + w.__playtest.rig.shots.length + ' shots (' + w.__playtest.rig.total().toFixed(1) + ' s)' }; }
      else if (a.action === 'layout') {
        if (!a.image_b64) throw new Error('image_b64 required'); const img = new w.Image(); img.src = 'data:image/png;base64,' + a.image_b64.replace(/^data:[^,]+,/, ''); await img.decode();
        if (Array.isArray(a.legend) && a.legend.length) m.legend = a.legend; m.layout_img = img; m.generate_from_layout();
      }
      else if (a.action === 'clear') m.clear_all();
      else if (a.action === 'plan') { const P = w.__playtest; if (!a.plan || !Array.isArray(a.plan.shapes)) throw new Error('plan {shapes, wires} required'); const plan = { shapes: a.plan.shapes, wires: a.plan.wires || [] }; P.plan_ed.set_plan(plan); m.plan = JSON.parse(JSON.stringify(plan)); m.build_plan(plan); if (a.play) P.start_playable(); }
      else if (a.action === 'export_playable') { const P = w.__playtest; const r = await P.playable_html(String(a.cta || ''), { title: a.title ? String(a.title) : undefined, limit: a.limit != null ? Number(a.limit) : undefined }); const mb = r.size_mb.toFixed(2);
        return { text: `playable: ${r.name}, ${mb} MB, ${r.has_character ? 'with the rigged character' : 'NO character (load one first: gb_to_playtest)'}, ${r.shapes} plan shapes${r.size_mb > 5 ? ' — OVER 5 MB: most ad networks refuse it; remove decoration / shrink the map' : ''}`, file: { name: r.name, b64: await blobToB64(r.blob) } }; }
      else if (a.action === 'export_unity') return { text: 'Unity script: import greenbox-map.glb, then add GreenboxShots to any object', file: { name: 'GreenboxShots.cs', b64: btoa(unescape(encodeURIComponent(m.unity_script()))) } };
      else if (a.action === 'export_blender') return { text: 'Blender script (Scripting > Open > Run Script)', file: { name: 'greenbox-map.py', b64: btoa(unescape(encodeURIComponent(m.blender_script()))) } };
      else if (a.action === 'export_glb') { const got = captureDownload(w); await m.export_glb(); const f = await got; return { text: 'map GLB', file: { name: f.name, b64: await blobToB64(f.blob) } }; }
      const d = m.data(); const hs = d.heights;
      return { text: JSON.stringify({ size_m: d.n * d.cell, cells: d.n, water: d.water, height_range: [Math.min(...hs), Math.max(...hs)], objects: d.objects.length, by_kind: d.objects.reduce((o, x) => { o[x.kind] = (o[x.kind] || 0) + 1; return o; }, {}) }), image: shot(w) }; });

  const HP_JOB = { state: 'idle', mode: '', path: '', bytes: 0, error: '', t0: 0, sec: 0 };
  tool('gb_hpbar', 'HP-bar / HUD video layer (its own page, exported separately: green MP4 for Keylight or alpha .MOV). Actions: get, set {settings: partial state, e.g. {hero:{name,level}, hp:{max,start}, mp:{on,max}, dur, fps, size:"1080x1920", bg:"green"|"black"|"clear"}}, events {events:[{t: seconds, kind: dmg|heal|set|mana-|mana+, v: amount}]} (replaces the list: when the hero is hit), export_mov, export_mp4 (run in the background: then call export_status every ~5 s until state is "done"; it gives the saved file path under Greenbox/exports/hud), export_status. Boss bar: set {settings:{boss:{on:true, name, max, start, layers, w, h, x, y}}} and events with who:"boss". Hero bar size: hp:{w, h, round, drain, hold}, hud:{flip, on, x, y}. Countdown: page {page:"count"} then set {settings:{cd:{from, to, start, format: s|mmss|dec|dec2, size, x, y, color, stroke, sw, ring, end, endHold, warn}}} and export like the HP bar.',
    { action: { type: 'string', enum: ['get', 'set', 'events', 'page', 'export_mov', 'export_mp4', 'export_status'] }, page: { type: 'string', enum: ['hp', 'count'] }, settings: { type: 'object' }, events: { type: 'array', items: { type: 'object' } } }, ['action'],
    async a => { if (window.__gbGo) window.__gbGo(a.page === 'count' || (a.settings && a.settings.cd) ? 'countdown' : 'hpbar'); const fr = document.getElementById('hpFrame'); let hp = null;
      for (let i = 0; i < 80 && !hp; i++) { try { hp = fr && fr.contentWindow && fr.contentWindow.__gbHp; } catch (e) { hp = null; } if (!hp) await sleep(150); }
      if (!hp) throw new Error('HP bar page did not open');
      const S = hp.state(); const deep = (o, p) => { for (const k in p) { if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) && o[k] && typeof o[k] === 'object') deep(o[k], p[k]); else o[k] = p[k]; } };
      if (a.action === 'set') deep(S, a.settings || {});
      if (a.action === 'events') S.events = (a.events || []).map(e => Object.assign({ t: Number(e.t) || 0, kind: e.kind || 'dmg', v: Number(e.v) || 0 }, e.who === 'boss' ? { who: 'boss' } : {}));
      if (a.action === 'page') hp.set_page(a.page || 'hp');
      if (a.action === 'set' || a.action === 'events') hp.refresh();
      if (a.action === 'export_mov' || a.action === 'export_mp4') { // background job: an MCP call has ~60 s; the file is written by the local server (no base64 through the bridge)
        if (HP_JOB.state === 'running') return { text: 'an export is already running: call gb_hpbar {action:"export_status"}' };
        Object.assign(HP_JOB, { state: 'running', mode: a.action, path: '', bytes: 0, error: '', t0: Date.now(), sec: 0, blob: null });
        (async () => { try {
            const got = captureDownload(fr.contentWindow, 900000); await (a.action === 'export_mov' ? hp.export_mov() : hp.export_mp4()); const f = await got;
            const j = await saveLocal(f.blob, f.name, 'hud');
            if (j) Object.assign(HP_JOB, { state: 'done', path: j.path, bytes: j.bytes }); else Object.assign(HP_JOB, { state: 'done', path: '(web Greenbox: export_status returns the file)', bytes: f.blob.size, blob: f.blob, name: f.name });
          } catch (e) { Object.assign(HP_JOB, { state: 'error', error: String((e && e.message) || e) }); }
          HP_JOB.sec = Math.round((Date.now() - HP_JOB.t0) / 1000); })();
        return { text: a.action + ' started in the background. Call gb_hpbar {action:"export_status"} every ~5 s until state is "done" (it gives the saved file path).' }; }
      if (a.action === 'export_status') { const st = Object.assign({}, HP_JOB, { blob: undefined, sec: HP_JOB.state === 'running' ? Math.round((Date.now() - HP_JOB.t0) / 1000) : HP_JOB.sec });
        if (HP_JOB.state === 'running') { const m = fr.contentDocument && fr.contentDocument.getElementById('eMsg'); st.progress = m ? m.textContent.trim() : ''; }
        const out = { text: JSON.stringify(st) }; if (HP_JOB.state === 'done') { if (/^(\/|[A-Z]:\\)/.test(HP_JOB.path)) out.saved = HP_JOB.path; if (HP_JOB.blob) { out.file = { name: HP_JOB.name, b64: await blobToB64(HP_JOB.blob) }; HP_JOB.blob = null; } }
        return out; }
      return { text: JSON.stringify(S), image: hp.snapshot() }; });

  // big exports run in the background and are written to Greenbox/exports/drive by the local server: an MCP call has ~60 s
  // and a 30-200 MB file as base64 in the reply dropped the bridge. status reports progress and the saved path.
  const DRV_JOB = { state: 'idle', mode: '', path: '', bytes: 0, error: '', t0: 0, sec: 0 };
  async function saveLocal (blob, name, dir) {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    const r = await fetch('/bridge/save?dir=' + encodeURIComponent(dir || 'drive') + '&name=' + encodeURIComponent(name), { method: 'POST', headers: { 'X-Greenbox-UI': '1' }, body: blob });
    if (r.status === 404 || r.status === 405) return null; // a Greenbox server started before this endpoint existed: the file goes back through the bridge instead
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error('save failed: ' + (j.error || r.status)); return j;
  }
  tool('gb_drive', 'Driving overlay (Lái xe → Vô lăng & bàn đạp): steering wheel + 2 pedals, or the excavator kit: ONE joystick lever (slot lever: A/D tilts it, W pushes, S pulls) + a W A S D key cluster that lights up (slot keys) + a console picture (slot dash). Actions: layout (a picture of the layout + positions: SHOW IT TO THE USER and agree the changes first), set_layout {items, confirmed: true} (only after the user said OK; ids dash|pad|lever|keys|wheel|brake|gas|gear|speedo, hidden:true/false switches a part off/on), image {slot: dash|pad|lever|wheel|brake|gas, path | url} (a picture for that part, PNG with transparent background is best), status, load {path} (the video), auto (the AI reads the video: scenery sliding sideways = steering, how fast the picture changes = gas / brake; makes the take), export {mode: "mov" = transparent .MOV (RGB + alpha, PNG frames) of the overlay only, for After Effects / Premiere; "green" / "black" = keyed backgrounds; "video" = finished MP4 with the gameplay}. Export runs in the background: call status until state is "done" (it gives the saved file path) or "error".',
    { action: { type: 'string', enum: ['status', 'load', 'auto', 'export', 'layout', 'set_layout', 'image'] }, video_b64: { type: 'string' }, path: { type: 'string', description: 'load: the video file on this computer; image: the picture file' }, url: { type: 'string', description: 'image / load: a link to the picture or video (Higgsfield result…); it is downloaded on this computer' }, slot: { type: 'string', enum: ['dash', 'pad', 'lever', 'wheel', 'brake', 'gas'] }, name: { type: 'string' }, mode: { type: 'string', enum: ['mov', 'video', 'green', 'black'] }, items: { type: 'array', items: { type: 'object' }, description: 'set_layout: [{id: dash|pad|lever|keys|wheel|brake|gas|gear|speedo, x?, y?, size?, w?, rot?, hidden?}] in frame pixels' }, confirmed: { type: 'boolean', description: 'set_layout: true only after the user saw the layout picture and said OK to these changes' } }, ['action'],
    async a => { if (window.__gbGo) window.__gbGo('wheel'); await sleep(300); const d = window.__gbDrive; if (!d || !d.auto) throw new Error('driving page not ready');
      const fileFrom = async (fallbackType) => { if (a.file_url) { const r = await fetch(a.file_url, { cache: 'no-store' }); if (!r.ok) throw new Error('could not read ' + a.file_url + ' (' + r.status + ')'); const b = await r.blob(); return new File([b], a.name || 'file', { type: b.type || fallbackType }); }
        if (a.video_b64) { const bin = atob(a.video_b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], a.name || 'file', { type: fallbackType }); }
        throw new Error('path (or url) required'); };
      if (a.action === 'load') { await d.load(await fileFrom('video/mp4')); return { text: 'video loaded: ' + (a.name || '') + '. Next: auto (makes the take), then layout.' }; }
      if (a.action === 'image') { const f = await fileFrom('image/png'); const u = URL.createObjectURL(f); try { await d.set_image(a.slot, u); } finally { setTimeout(() => URL.revokeObjectURL(u), 5000); } return { text: 'picture set on ' + a.slot + ' (now shown)', image: d.preview() }; }
      if (a.action === 'auto') return { text: 'take made from the video: ' + (await d.auto()) + ' samples (steering, gas, brake)' };
      if (a.action === 'layout') return { text: 'Show this picture to the user and ask what to move / resize / turn before changing it (then set_layout with confirmed: true). Layout: ' + JSON.stringify(d.layout()), image: d.preview() };
      if (a.action === 'set_layout') { if (a.confirmed !== true) throw new Error('Ask the user first: call layout, show them the picture and your planned changes, and only call set_layout with confirmed: true after they agree.'); const r = d.set_layout(a.items || []); await sleep(200); return { text: 'layout changed: ' + JSON.stringify(r), image: d.preview() }; }
      if (a.action === 'export') {
        if (DRV_JOB.state === 'running') return { text: 'an export is already running: ' + JSON.stringify(DRV_JOB) };
        if (!d.samples()) throw new Error('no take yet: load the video, then auto');
        const mode = a.mode || 'video'; Object.assign(DRV_JOB, { state: 'running', mode, path: '', bytes: 0, error: '', t0: Date.now(), sec: 0 });
        (async () => { try {
            const r = mode === 'mov' ? await d.mov() : await d.export(mode); if (!r) throw new Error('export failed');
            const j = await saveLocal(r.blob, r.name, 'drive');
            if (j) Object.assign(DRV_JOB, { state: 'done', path: j.path, bytes: j.bytes });
            else { DRV_JOB.blob = r.blob; DRV_JOB.name = r.name; Object.assign(DRV_JOB, { state: 'done', path: '(web Greenbox: call status to receive the file)', bytes: r.blob.size }); }
          } catch (e) { Object.assign(DRV_JOB, { state: 'error', error: String((e && e.message) || e) }); }
          DRV_JOB.sec = Math.round((Date.now() - DRV_JOB.t0) / 1000); })();
        return { text: 'export "' + mode + '" started in the background (' + d.samples() + ' samples). Call gb_drive status every ~15 s until state is "done".' };
      }
      const st = { samples: d.samples(), busy: d.busy && d.busy(), export: Object.assign({}, DRV_JOB, { blob: undefined, sec: DRV_JOB.state === 'running' ? Math.round((Date.now() - DRV_JOB.t0) / 1000) : DRV_JOB.sec }) };
      if (DRV_JOB.state === 'running') { const m = document.getElementById(DRV_JOB.mode === 'mov' ? 'dr-movAll' : 'dr-exportBtn'); st.export.progress = m ? m.textContent.trim() : ''; }
      if (DRV_JOB.state === 'done' && DRV_JOB.path) { const out = { text: JSON.stringify(st), saved: DRV_JOB.path.startsWith('/') || /^[A-Z]:\\/.test(DRV_JOB.path) ? DRV_JOB.path : undefined };
        if (DRV_JOB.blob) { out.file = { name: DRV_JOB.name, b64: await blobToB64(DRV_JOB.blob) }; DRV_JOB.blob = null; }
        return out; }
      return { text: JSON.stringify(st) }; });

  tool('gb_sfx', 'SFX sync (Post → Gắn SFX): put sounds on the hits of a finished video. Actions: status (sounds in the library, cues found, clips placed), load {video_b64, name} (MCP: {path}), analyze (finds the hits / cue points), add_all {sound: name or part of it, e.g. "coin"} (that sound on EVERY cue, aligned by its loudest point; repeat with other sounds), export (renders the MP4 with sound). Built-in sounds: Impact boom, Rock crunch, Coin ding, Sparkle shimmer, Whoosh, Upgrade rise, Water splash; the user can add their own in the page.',
    { action: { type: 'string', enum: ['status', 'load', 'analyze', 'add_all', 'export'] }, sound: { type: 'string' }, video_b64: { type: 'string' }, name: { type: 'string' } }, ['action'],
    async a => { if (window.__gbGo) window.__gbGo('sfx'); const fr = document.getElementById('sfxFrame'); let sx = null;
      for (let i = 0; i < 80 && !sx; i++) { try { sx = fr && fr.contentWindow && fr.contentWindow.__sfx; } catch (e) { sx = null; } if (!sx) await sleep(150); }
      if (!sx) throw new Error('SFX page did not open');
      if (a.action === 'load') { if (!a.video_b64) throw new Error('video_b64 (or path from MCP) required'); await sx.load(a.name || 'video.mp4', a.video_b64); }
      if (a.action === 'analyze') await sx.analyze();
      if (a.action === 'add_all') { const n = sx.add_all(a.sound); return { text: 'placed ' + n + ' clips of "' + (a.sound || 'armed sound') + '" on ' + sx.cues().length + ' cues (total clips ' + sx.clips() + ')' }; }
      if (a.action === 'export') { const r = await sx.render(); return { text: 'exported ' + r.name, file: { name: r.name, b64: await blobToB64(r.blob) } }; }
      return { text: JSON.stringify({ sounds: sx.sounds(), cues: sx.cues(), clips: sx.clips() }) }; });

  /* ---------------- 🎮 one prompt → playable: hand the rigged character over, and the recipe ---------------- */
  tool('gb_to_playtest', 'Send the character rigged on "Use your model" (after gb_rig_finish) to Play test with its animations, like the "🎮 Play test this character" button. Waits until it is the player.', {}, [],
    async () => {
      const w = await openPage('create'); const b = w.document.getElementById('easy-playtest');
      if (!b) throw new Error('no rigged character on "Use your model" yet: gb_load_file + gb_rig_auto + gb_rig_finish first');
      b.click();
      for (let i = 0; i < 240; i++) { await sleep(250); const p = pageWindow('playtest.html'); const P = p && p.__playtest; if (P && (P.ctrl || P.car)) return { text: 'Play test player ready: ' + (P.ctrl ? P.ctrl.state() : 'vehicle'), image: shot(p) }; if (i === 8) await openPage('playtest'); }
      throw new Error('Play test did not get the character in 60 s');
    });
  const RECIPE = "Make a playable ad with Greenbox, from a 3D model to one HTML file. The user watches Greenbox: narrate each step in ONE short line with gb_say before you do it, and when a choice is theirs (joint placement looks off, game idea, map look) ask with gb_say and wait with gb_inbox {wait: 50}.\n1. gb_status. If Greenbox is not connected: gb_connect and give the user the pairing code.\n2. Character: gb_load_file {page: \"create\", path: MODEL}. Then gb_rig_auto (finds the body and places the joints) and gb_screenshot {page: \"create\"}: look at it; if a joint is outside the body, read them with gb_joints_get and fix with gb_joints_set. Then gb_rig_finish (skin + 178 animations). (Already rigged file: load it straight into Play test with gb_load_file {page: \"playtest\"} and skip to 4.)\n3. gb_to_playtest: the rigged character becomes the Play test player.\n4. Map: gb_map {action: \"preset\", preset: \"flat\"} (or hills / island\u2026), keep it small (about 40 x 40 m). Decorate lightly with gb_map add (trees, rocks, fences; a house = hwall pieces round a room + door + roof). Every object adds weight to the file.\n5. Gameplay = a 2D plan: gb_map {action: \"plan\", plan: {shapes, wires}, play: false}. Shapes (x, z = centre in metres, w, d = size, r = turn in rad, label, color, height): player (where the player starts), source (gives an item: gives = \"coin\" / \"wood\"\u2026, time = seconds per item), machine (takes \u2192 gives), stack / counter (counter sells items for $), unlock ($ pad, price = cost; what it unlocks is joined with an \"unlock\" wire), zone (floor), block (solid wall / box, model = a palette object such as \"house\" or \"pine\"), camera. Wires {id, from, to, mode}: carry (the player carries items from \u2192 to), belt (a conveyor), unlock (pad \u2192 what appears when paid). A classic loop: player \u2192 source (coins) carry\u2192 counter \u2192 unlock pad \u2192 new building.\n6. Test: gb_map {action: \"plan\", plan, play: true}, then gb_screenshot {page: \"playtest\"}. Fix what looks wrong.\n7. Export: gb_map {action: \"export_playable\", cta: STORE_LINK (or \"\")}; the MCP saves greenbox-playable.html (save_to = a folder or file to choose where). Tell the user the path and the size: ad networks usually want under 5 MB \u2014 if bigger, remove decoration / shrink the map and export again.";
  tool('gb_recipe', 'Step-by-step recipe to make a playable ad from a 3D model with the Greenbox tools (rig → Play test → map → 2D plan gameplay → test → HTML export). Read it before starting such a job.', {}, [], async () => ({ text: RECIPE }));

  /* ---------------- 🎬 AI Drama (its own Cockpit part, page drama.html): the user works on the page, Claude does the heavy parts ---------------- */
  const DRAMA_HOW = 'AI Drama in Greenbox (Cockpit group 🎬 AI Drama, page drama.html). The user works there; every button that needs you posts a request into the Greenbox chat: "[AI Drama #N] kind: …". Loop: gb_inbox {wait: 50} → for each [AI Drama #N] request: gb_drama {action: "get"} (settings, script, characters, open requests) → do it → gb_drama {action: "done", id: N}. The page updates live while you work (the user watches), so narrate with gb_drama {action: "say", text}.\n' +
    'Kinds: write_script = write the full script from settings.text in Vietnamese (or the story\'s language): gb_drama {action: "script", script: {title, logline, chars: [{name, role, look}], eps: [{title, summary, beats: [{scene, chars: [names], action, lines: [{who, text}], sec, prompt}]}]}}. Single film (settings.type "single") = ONE entry in eps whose beats are the film\'s beats; series = settings.eps_n episodes of about settings.ep_sec seconds each. LONG (settings.long, more than 5 min per film / episode, up to 1 hour): give each episode segs = settings.parts_per_episode parts [{title, summary, sec ≈ settings.part_sec}] and write beats (with seg: 0) ONLY for part 1 — never the whole hour at once. write_beats {ep, seg} = write that part\'s beats: gb_drama {action: "beats", ep, seg, beats: [...]} (about part_sec / clip beats). gen_segment {ep, seg} = make the clips of that part only (like gen_episode). Every beat lasts settings.clip seconds (5 / 10 / 15 = one Higgsfield clip); the beats\' sec must add up to the episode / film length. look = an English picture prompt in settings.style + settings.country; prompt = an English image-to-video prompt (camera, action, mood, style, aspect settings.ratio), naming the characters. rewrite_episode {ep} = rewrite that episode only (gb_drama {action: "script", ep, script: {summary, beats}}). ' +
    'char_image {name | names} = make the character picture(s) on Higgsfield (higgsfield.ai, in the browser; the user must be signed in — never sign in for them): portrait / character sheet from the character\'s look, settings.style, plain background; then gb_drama {action: "char", name, url} with the picture\'s link (the result image src or its download link — Greenbox downloads it on this computer; or path = a file already on this computer); you may also pass new_name / look. gen_episode {ep} / gen_beat {ep, beat} = image-to-video on Higgsfield, one clip per beat (the beat prompt + the pictures of the characters in it, duration = beat sec, aspect settings.ratio): before each batch ask the user to approve the credits with gb_say + gb_inbox (e.g. "8 clips × 10 s, OK?"); mark each beat with gb_drama {action: "beat", ep, beat, status: "gen"} while it renders, then gb_drama {action: "clip", ep, beat, url} (the video src / download link; or path). Only what was asked: one episode (series) or one beat (single film) at a time. name_hooks {eps} = gb_drama {action: "episode", ep, title, hook} for those episodes (hook = the first 3 seconds that make people stay). merge {ep} = gb_drama {action: "merge", ep} joins that episode\'s clips in order with ffmpeg on this computer and puts the MP4 back on the page. ' +
    'HIGGSFIELD: prefer the Higgsfield MCP tools (connector https://mcp.higgsfield.ai/mcp) — generate there and pass the result link with url; only without them use higgsfield.ai in the browser. settings.unlimited (default true) = use Higgsfield\'s Unlimited mode / unlimited models so no credits are spent; when it is false ask before spending credits. ' +
    'Per-beat buttons (Production): prompt_beat {ep, beat, idea} = from the beat (action, lines, characters\' looks, style) and the user\'s idea write an English picture prompt and an image-to-video prompt: gb_drama {action: "prompts", ep, beat, img_prompt, prompt}. gen_image {ep, beat} = make the scene picture from img_prompt (use the characters\' pictures as references when the tool takes them), aspect settings.ratio: gb_drama {action: "beat", ep, beat, status: "img"} while it renders, then gb_drama {action: "still", ep, beat, url}. gen_beat {ep, beat} = image-to-video from the beat\'s still (or the character pictures) + prompt, duration = beat sec: gb_drama {action: "clip", ep, beat, url}. ' +
    'STUDIO (DramaClaw-style parts): extract_assets {kind: scenes|props} = read the script and add every scene / prop: gb_drama {action: "asset", kind: "scene"|"prop", name, look} (look = English picture prompt). asset_image {kind, name | names} = make the picture on Higgsfield (wide 16:9 for scenes, plain background for props), then gb_drama {action: "asset", kind, name, url}. '+
    'voice_sample {name} ("__narrator" = narrator) = a short voice sample from the voice desc (Higgsfield / any TTS you have): gb_drama {action: "voice", name, url | path, desc?}. voice {ep, beat} / voice_episode {ep} = voice-over of the beat lines in each character\'s voice: gb_drama {action: "voice", ep, beat, url | path}. music {ep} = background music for the episode: gb_drama {action: "music", ep, url | path}. '+
    'storyboard {ep} = the first-frame picture of every beat of that episode (like gen_image for each). style_extract = look at the reference (gb_drama {action: "media_out", what: "style"} saves it as a file) and write the style: gb_drama {action: "style", name, prompt}. Always add settings/style.prompt to every picture / video prompt. '+
    'fix_qc {ep, issues} = the page\'s QC found problems in that episode (get → qc lists them: dialogue too long for the clip, total length off, missing prompt, unknown character): rewrite it so they are gone, same plot and beat count: gb_drama {action: "script", ep, script: {summary, beats}}. QUALITY for every script: each episode opens with a hook inside the first 3 seconds and ends on a cliffhanger; one beat = one shot = one place + one clear action; at most 3 spoken words per second of the beat; prompt order = shot size + camera move, who (name + 3-word look) does what, place, light, mood, style, aspect. Requests the user\'s own API key already answers (⚡ in the log) never reach you. '+
    'director {text} = Xia Director chat: answer the user (and edit the project with the other actions when they ask): gb_drama {action: "reply", text}. '+
    'Freezone (canvas): node_gen {id, type, inputs} = fill that node using the wired input nodes (get → freezone.nodes): script → gb_drama {action: "node", id, text}; ai_image / video / audio → make it on Higgsfield and gb_drama {action: "node", id, prompt?, url}. You may add nodes: gb_drama {action: "node", type, title, text, from: id}. node_compose {id, inputs} = gb_drama {action: \"node_compose\", id} (the MCP joins the wired video nodes with ffmpeg and puts the MP4 in the node). '+
    'merge mixes each beat\'s voice-over and the episode music when compose.voice / compose.music are on, and adds the subtitles (compose.subs) as a subtitle track + .srt file. media_out {what: style|char|scene|prop|still|clip|voice|music|node, name?, ep?, beat?, id?} saves any stored media as a file you can look at. ' +
    'If Higgsfield is not reachable, say so with gb_say and wait; the user can also upload pictures / clips on the page themselves.';
  /** a picture / clip link fetched in the page (works when the site allows it; over MCP the computer downloads it instead) */
  async function fetchB64 (url) {
    const r = await fetch(url); if (!r.ok) throw new Error('could not download ' + url + ' (' + r.status + ')');
    const b = await r.blob(); return { data_b64: await blobToB64(b), mime: b.type || undefined };
  }
  tool('gb_drama', 'AI Drama (script → characters → clips → episode). ' + DRAMA_HOW + ' Actions: open | get | script {script, ep?} | beats {ep, seg, beats} | prompts {ep, beat, img_prompt, prompt} | still {ep, beat, url | path} | char {name, new_name?, role?, look?, url | path} | beat {ep, beat, status} | clip {ep, beat, url | path, sec?} | episode {ep, title?, hook?, summary?} | merge {ep} | clip_out {ep, beat} | asset {kind, name, look?, new_name?, url | path} | voice {name | ep+beat, url | path, desc?} | music {ep, url | path} | style {name?, prompt?} | node {id? , type?, title?, text?, prompt?, from?, url | path} | reply {text} | media_out {what, name?, ep?, beat?, id?} | srt {ep} | say {text} | done {id, note?}. ep / beat are 0-based.',
    { action: { type: 'string', enum: ['open', 'get', 'script', 'beats', 'prompts', 'still', 'char', 'beat', 'clip', 'episode', 'merge', 'clip_out', 'merged', 'say', 'done', 'asset', 'voice', 'music', 'style', 'node', 'reply', 'media_out', 'srt', 'node_compose'] }, kind: { type: 'string' }, what: { type: 'string' }, desc: { type: 'string' }, type: { type: 'string' }, from: { type: 'string' }, names: { type: 'array', items: { type: 'string' } }, id: { type: ['number', 'string'] }, ep: { type: 'number' }, beat: { type: 'number' }, seg: { type: 'number' }, img_prompt: { type: 'string' }, prompt: { type: 'string' }, beats: { type: 'array', items: { type: 'object' } }, name: { type: 'string' }, new_name: { type: 'string' }, role: { type: 'string' }, look: { type: 'string' }, status: { type: 'string' }, sec: { type: 'number' }, title: { type: 'string' }, hook: { type: 'string' }, summary: { type: 'string' }, text: { type: 'string' }, note: { type: 'string' }, script: { type: 'object' }, data_b64: { type: 'string' }, mime: { type: 'string' }, source: { type: 'string' }, url: { type: 'string', description: 'char / clip: link to the picture / video (Higgsfield result src or download link)' } }, ['action'],
    async a => {
      const w = await openPage('drama'); const D = w && w.__gbDrama; if (!D) throw new Error('the AI Drama page did not open');
      D.ping();
      const ok = r => ({ text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) });
      switch (a.action) {
        case 'open': return ok('open');
        case 'get': return ok(D.get());
        case 'script': return ok(D.script(a.script || {}, a.ep));
        case 'beats': return ok(D.beats(a));
        case 'prompts': return ok(D.prompts(a));
        case 'still': if (a.url && !a.data_b64) Object.assign(a, await fetchB64(a.url)); if (!a.data_b64) throw new Error('still: pass url or path (MCP) or data_b64'); return ok(await D.still(a));
        case 'char': if (a.url && !a.data_b64) Object.assign(a, await fetchB64(a.url)); return ok(await D.char(a));
        case 'beat': return ok(D.beat(a));
        case 'clip': if (a.url && !a.data_b64) Object.assign(a, await fetchB64(a.url)); if (!a.data_b64) throw new Error('clip: pass path or url (MCP) or data_b64'); return ok(await D.clip(a));
        case 'episode': return ok(D.episode(a));
        case 'merged': return ok(await D.merged(a));
        case 'clip_out': { const f = await D.clip_out(a); return { text: 'clip ' + f.name, file: f }; }
        case 'merge': { // in the browser alone (no MCP): list what to join; the MCP server joins with ffmpeg
          const e = (D.get().script || { eps: [] }).eps[a.ep]; if (!e) throw new Error('no episode ' + a.ep);
          return ok({ clips: e.beats.map((b, j) => ({ beat: j, has_clip: !!b.clip })) });
        }
        case 'asset': case 'voice': case 'music': case 'node': if (a.url && !a.data_b64) Object.assign(a, await fetchB64(a.url)); return ok(await D[a.action](a));
        case 'node_compose': throw new Error('node_compose runs over MCP (ffmpeg on this computer)');
        case 'style': return ok(D.style(a));
        case 'reply': return ok(D.reply(a));
        case 'srt': return ok(D.srt(a));
        case 'media_out': { const f = await D.media_out(a); return { text: 'media ' + f.name, file: f }; }
        case 'say': return ok(D.say(a.text || ''));
        case 'done': return ok(D.done(a.id, a.note));
        default: throw new Error('unknown action ' + a.action);
      }
    });

  /* ---------------- 💬 talk with the user in Greenbox's side chat (outside AIs over MCP) ---------------- */
  // the user's messages typed in the chat while it is in "Claude / Codex (MCP)" mode wait here for gb_inbox
  const INBOX = window.__gbInbox = window.__gbInbox || { msgs: [], waiters: [], push (m) { this.msgs.push(m); const w = this.waiters.splice(0); w.forEach(f => f()); } };
  tool('gb_say', 'Post a message in the user\'s Greenbox side chat (the "🔌 Claude / Codex" panel next to the 3D view): say what you are doing, what you found, or ask a question. Use it for anything the user should read while looking at Greenbox; their answers come back through gb_inbox. Markdown is shown as plain text.',
    { text: { type: 'string', description: 'the message (short; a few lines)' } }, ['text'],
    async a => { dispatchEvent(new CustomEvent('gb-ai-say', { detail: { text: String(a.text || ''), from: window.__gbMcpFrom || 'AI' } })); return { text: 'shown in the Greenbox chat' }; });
  tool('gb_inbox', 'Read what the user typed to you in the Greenbox side chat since the last read (they are cleared once read). wait = seconds to wait for a new message when there is none yet (0-50, default 0). Returns "(no new messages)" when empty.',
    { wait: { type: 'number', description: 'seconds to wait for a message (0-50)' } }, [],
    async a => {
      const w = Math.max(0, Math.min(50, Number(a.wait) || 0));
      if (INBOX.msgs.length === 0 && w > 0) await new Promise(res => { const t = setTimeout(res, w * 1000); INBOX.waiters.push(() => { clearTimeout(t); res(); }); });
      const m = INBOX.msgs.splice(0);
      dispatchEvent(new CustomEvent('gb-inbox-read', { detail: { n: m.length, from: window.__gbMcpFrom || 'AI' } }));
      return { text: m.length === 0 ? '(no new messages)' : m.map(x => `[${new Date(x.t).toLocaleTimeString()}] user: ${x.text}`).join('\n') };
    });

  window.__gbTools = {
    list: T.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    async call (name, args) {
      const t = T.find(x => x.name === name); if (!t) throw new Error('unknown tool ' + name);
      try {
        if (solo() && COCKPIT_ONLY[name]) leave(new URL('Greenbox-Cockpit.html', ROOT).href, 'the cockpit');
        return await t.fn(args || {});
      } catch (e) {
        if (e && e.gbMoved) return { text: 'Greenbox is opening ' + e.gbMoved + ' now (the browser page reloads). Wait 4 seconds, then call this tool again.' };
        throw e;
      }
    },
    shot: (page) => shot(pageWindow(page))
  };
})();
