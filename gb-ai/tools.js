/* Greenbox AI tools — one list of actions used by BOTH the in-app AI chat (any model with an API key) and the
   MCP server (Claude Desktop / Cowork / any MCP client). They run in the cockpit and reach into the 3D tabs
   (same origin), so an AI can open tabs, look at the 3D view, rig, test and export.

   window.__gbTools = { list: [{name, description, input_schema}], call(name, args) -> Promise<{text, image?}> } */
(function () {
  'use strict';
  const PAGES = { create: 'create.html', rig: 'create.html', retarget: 'retarget/index.html', vehicle: 'vehicle.html', playtest: 'playtest.html', mocap: 'mocap.html', smash: 'smash.html', explore: 'index.html' };
  const FEAT = { 'create.html': 'rig', 'retarget/index.html': 'retarget', 'vehicle.html': 'vehicle', 'playtest.html': 'playtest', 'mocap.html': 'mocap', 'smash.html': 'smash' };
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
  function appOf (w) { return w && (w.__gb3d || w.__vehicle || w.__playtest || w.__mocap || w.__smash) || null; }

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

  /* ---------------- analysis, vehicles / any model, play-test map, HP-bar video ---------------- */
  tool('gb_analyze', 'Analyse the model loaded on a page: what it is (humanoid / quadruped / vehicle / object) and its anchor points — head, arms, legs and accessories (tail, wings, ears, horns, hair, cape, held items) with joint positions inside the mesh. On "vehicle" it can also create a bone chain on every branch (make_bones).',
    { page: { type: 'string', enum: ['create', 'vehicle'] }, make_bones: { type: 'boolean', description: 'vehicle page: create free bones along every branch (default true)' } }, ['page'],
    async a => { const w = await openPage(a.page); let an;
      if (a.page === 'vehicle') an = w.__vehicle.analyze_model(a.make_bones !== false);
      else { w.__gb3d.easy_rig.show_anchors(true); an = w.__gb3d.easy_rig.last_analysis; }
      if (!an) throw new Error('no model loaded');
      const r3 = v => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
      return { text: JSON.stringify({ type: an.type, size: r3(an.size), core: r3(an.core), notes: an.notes, branches: an.branches.map(b => ({ name: b.name, kind: b.kind, side: b.side, tip: r3(b.tip), joints: b.joints.map(r3) })) }), image: shot(w) }; });

  tool('gb_smash', 'Target smash blockout (a shooting ad: a wall of cans / boxes on a table, a gun in the middle). Actions: status (ammo, knocked, blocks, layout), preset {name: wall | pyramid | towers | checker | random}, reset (rebuild the stack), shoot {x, y} (0..1 of the 9:16 view), auto {on} (auto shoot), record (start / stop a 9:16 blockout video download), prompt (the Seedance video-to-video prompt for the chosen theme).',
    { action: { type: 'string', enum: ['status', 'preset', 'reset', 'shoot', 'auto', 'record', 'prompt'] }, name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, on: { type: 'boolean' } }, ['action'],
    async a => { const w = await openPage('smash'); const S = w && w.__smash; if (!S) throw new Error('the Target smash page did not open');
      if (a.action === 'preset') S.preset(a.name || 'wall'); else if (a.action === 'reset') S.reset(); else if (a.action === 'shoot') S.shoot(a.x ?? 0.5, a.y ?? 0.45);
      else if (a.action === 'auto') S.auto(a.on !== false); else if (a.action === 'record') S.record();
      else if (a.action === 'prompt') return { text: w.document.getElementById('sm-prompt').value };
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

  tool('gb_map', 'Play-test map editor (terrain + objects, RTS-style). Actions: preset {preset: flat|hills|island|valley|mountains}, add {object: pine|tree|bush|rock|house|tower|wall|fence|crate|barrel|flag, x, z, rot?, scale?}, sculpt {tool: raise|lower|flatten|smooth|paint, x, z, radius?, strength?, ground?: 0 grass 1 dirt 2 sand 3 rock 4 snow 5 road 6 water bed}, water {level}, export_blender (Python script that rebuilds the map in Blender), export_glb, get (map JSON summary). Also: dig {x, z, radius?, depth?} carves a flat-bottomed hole; pour {x, z, fill?: 0.3..1} fills the hole / channel at (x, z) with water up to its rim; sea {on: bool}; erase {x, z, radius?} removes props there; shot_add {mode?: fixed|look|follow, follow?: "player"|object name, t?, dur?, fov?} saves the current camera view as a shot; shots (list); shots_play; layout {image_b64, legend?: [{color:"#rrggbb", kind}]} builds the map from a top-down colour plan (kinds: background grass water sand road dirt mountain snow forest tree house tower wall fence rock flag); export_unity (C# script that plays the shots); plan {plan: {shapes: [{id, kind: zone|block|source|machine|stack|counter|unlock|player, form: rect|ellipse, x, z, w, d, r, label, color, height, gives?, takes?, time?, price?, model?}], wires: [{id, from, to, mode: carry|belt|unlock}]}, play?: bool} builds a 2D plan as a 3D playable (and plays it); clear (empty map).',
    { action: { type: 'string', enum: ['get', 'preset', 'add', 'sculpt', 'water', 'dig', 'pour', 'sea', 'erase', 'shot_add', 'shots', 'shots_play', 'layout', 'export_blender', 'export_glb', 'export_unity', 'plan', 'clear'] }, plan: { type: 'object' }, play: { type: 'boolean' }, depth: { type: 'number' }, fill: { type: 'number' }, on: { type: 'boolean' }, mode: { type: 'string' }, follow: { type: 'string' }, t: { type: 'number' }, dur: { type: 'number' }, fov: { type: 'number' }, image_b64: { type: 'string' }, legend: { type: 'array', items: { type: 'object' } }, preset: { type: 'string' }, object: { type: 'string' }, x: { type: 'number' }, z: { type: 'number' }, rot: { type: 'number' }, scale: { type: 'number' }, tool: { type: 'string' }, radius: { type: 'number' }, strength: { type: 'number' }, ground: { type: 'number' }, level: { type: 'number' } }, ['action'],
    async a => { const w = await openPage('playtest'); const m = w.__playtest.map;
      if (a.action === 'preset') m.preset(a.preset || 'flat');
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
      else if (a.action === 'export_unity') return { text: 'Unity script: import greenbox-map.glb, then add GreenboxShots to any object', file: { name: 'GreenboxShots.cs', b64: btoa(unescape(encodeURIComponent(m.unity_script()))) } };
      else if (a.action === 'export_blender') return { text: 'Blender script (Scripting > Open > Run Script)', file: { name: 'greenbox-map.py', b64: btoa(unescape(encodeURIComponent(m.blender_script()))) } };
      else if (a.action === 'export_glb') { const got = captureDownload(w); await m.export_glb(); const f = await got; return { text: 'map GLB', file: { name: f.name, b64: await blobToB64(f.blob) } }; }
      const d = m.data(); const hs = d.heights;
      return { text: JSON.stringify({ size_m: d.n * d.cell, cells: d.n, water: d.water, height_range: [Math.min(...hs), Math.max(...hs)], objects: d.objects.length, by_kind: d.objects.reduce((o, x) => { o[x.kind] = (o[x.kind] || 0) + 1; return o; }, {}) }), image: shot(w) }; });

  tool('gb_hpbar', 'HP-bar / HUD video layer (its own page, exported separately: green MP4 for Keylight or alpha .MOV). Actions: get, set {settings: partial state, e.g. {hero:{name,level}, hp:{max,start}, mp:{on,max}, dur, fps, size:"1080x1920", bg:"green"|"black"|"clear"}}, events {events:[{t: seconds, kind: dmg|heal|set|mana-|mana+, v: amount}]} (replaces the list: when the hero is hit), export_mov, export_mp4. Boss bar: set {settings:{boss:{on:true, name, max, start, layers, w, h, x, y}}} and events with who:"boss". Hero bar size: hp:{w, h, round, drain, hold}, hud:{flip, on, x, y}. Countdown: page {page:"count"} then set {settings:{cd:{from, to, start, format: s|mmss|dec|dec2, size, x, y, color, stroke, sw, ring, end, endHold, warn}}} and export like the HP bar.',
    { action: { type: 'string', enum: ['get', 'set', 'events', 'page', 'export_mov', 'export_mp4'] }, page: { type: 'string', enum: ['hp', 'count'] }, settings: { type: 'object' }, events: { type: 'array', items: { type: 'object' } } }, ['action'],
    async a => { if (window.__gbGo) window.__gbGo(a.page === 'count' || (a.settings && a.settings.cd) ? 'countdown' : 'hpbar'); const fr = document.getElementById('hpFrame'); let hp = null;
      for (let i = 0; i < 80 && !hp; i++) { try { hp = fr && fr.contentWindow && fr.contentWindow.__gbHp; } catch (e) { hp = null; } if (!hp) await sleep(150); }
      if (!hp) throw new Error('HP bar page did not open');
      const S = hp.state(); const deep = (o, p) => { for (const k in p) { if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) && o[k] && typeof o[k] === 'object') deep(o[k], p[k]); else o[k] = p[k]; } };
      if (a.action === 'set') deep(S, a.settings || {});
      if (a.action === 'events') S.events = (a.events || []).map(e => Object.assign({ t: Number(e.t) || 0, kind: e.kind || 'dmg', v: Number(e.v) || 0 }, e.who === 'boss' ? { who: 'boss' } : {}));
      if (a.action === 'page') hp.set_page(a.page || 'hp');
      if (a.action === 'set' || a.action === 'events') hp.refresh();
      if (a.action === 'export_mov' || a.action === 'export_mp4') { const got = captureDownload(fr.contentWindow); await (a.action === 'export_mov' ? hp.export_mov() : hp.export_mp4()); const f = await got; return { text: 'exported ' + f.name, file: { name: f.name, b64: await blobToB64(f.blob) } }; }
      return { text: JSON.stringify(S), image: hp.snapshot() }; });

  tool('gb_drive', 'Driving overlay (Lái xe → Vô lăng & bàn đạp): a steering wheel + 2 pedals that follow a driving video, no hands. Actions: status, load {video_b64, name} (MCP: {path}), auto (the AI reads the video: the scenery sliding sideways = steering, how fast the picture changes = gas / brake; makes the take), export {mode: "video" = the gameplay video with the wheel + pedals on it (finished MP4), "green" = green screen, "black"}.',
    { action: { type: 'string', enum: ['status', 'load', 'auto', 'export'] }, video_b64: { type: 'string' }, name: { type: 'string' }, mode: { type: 'string', enum: ['video', 'green', 'black'] } }, ['action'],
    async a => { if (window.__gbGo) window.__gbGo('wheel'); await sleep(300); const d = window.__gbDrive; if (!d || !d.auto) throw new Error('driving page not ready');
      if (a.action === 'load') { if (!a.video_b64) throw new Error('video_b64 (or path from MCP) required'); const bin = atob(a.video_b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await d.load(new File([u], a.name || 'drive.mp4', { type: 'video/mp4' })); }
      if (a.action === 'auto') return { text: 'take made from the video: ' + (await d.auto()) + ' samples (steering, gas, brake)' };
      if (a.action === 'export') { const r = await d.export(a.mode || 'video'); if (!r) throw new Error('export failed'); return { text: 'exported ' + r.name, file: { name: r.name, b64: await blobToB64(r.blob) } }; }
      return { text: JSON.stringify({ samples: d.samples(), busy: d.busy && d.busy() }) }; });

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

  window.__gbTools = {
    list: T.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    async call (name, args) {
      const t = T.find(x => x.name === name); if (!t) throw new Error('unknown tool ' + name);
      return await t.fn(args || {});
    },
    shot: (page) => shot(pageWindow(page))
  };
})();
