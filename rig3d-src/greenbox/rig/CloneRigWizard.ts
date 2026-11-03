/*
 * 🧬 Clone rig — a guided, 4-step panel on the rig page:
 *   1. drop the file that HAS a rig (+ animations): it shows up at once — model, skeleton, its animations playing
 *   2. drop your model WITHOUT bones: it appears next to the rig file
 *   3. "Apply rig": the rig file's skeleton goes into your model (CustomRig: fitted by the bodies' boxes), your model
 *      is skinned to it and gets the rig file's animations (optionally stop at the joints to adjust them first)
 *   4. export: your base model, rigged, with the animations (GLB / FBX), or play-test it
 * The rig file is remembered (my rigs), so the next model is two clicks.
 */
import * as THREE from 'three'
import { SAMPLES } from '../vehicle/Samples.ts'
import { RigConfig } from '../../lib/RigConfig.ts'
import { type Mesh2MotionEngine } from '../../Mesh2MotionEngine.ts'
import { load_any_files } from '../common/AnyLoader.ts'
import { M } from '../common/lang.ts'
import { list_rig_files, get_rig_file, save_rig_file, CLONE_FIT, facing_yaw, learn_from, learned_for } from './CustomRig.ts'

interface Source { files: File[], name: string, scene: THREE.Object3D, clips: THREE.AnimationClip[], bones: number }

export class CloneRigWizard {
  private root: HTMLDivElement | null = null
  private src: Source | null = null
  private preview: THREE.Group | null = null
  private mixer: THREE.AnimationMixer | null = null
  private raf = 0
  private timer = new THREE.Timer()
  private busy = false
  private done = false
  private model_name = ''
  private adjust = false
  private long_z = false // your model is longer along Z than along X

  constructor (private readonly engine: Mesh2MotionEngine) {}

  /** a ready rig (template type or saved file) picked for a model dropped first */
  private picked = ''
  private step (): number {
    if (this.done) return 4
    if (this.busy && this.picked !== '') return 3
    if (this.src === null) return 1
    if (this.engine.process_step === 'load-model') return 2
    return 3
  }

  public open (): void {
    if (this.root === null) this.build()
    this.root!.style.display = 'flex'; this.render()
    if (this.raf === 0) this.loop()
  }

  private mini = false
  public close (): void { if (this.root !== null) this.root.style.display = 'none'; this.drop_preview(); (this.engine as any).scene_environment?.set_fog_enabled?.(true) }

  /* ---------------- panel ---------------- */
  private build (): void {
    const d = document.createElement('div'); this.root = d
    d.style.cssText = 'position:fixed;left:14px;top:96px;max-height:calc(100vh - 110px);max-height:calc(100dvh - 110px);width:300px;z-index:60;display:flex;flex-direction:column;gap:8px;overflow:auto;padding:10px;border-radius:14px;background:var(--gbp-panel,#10151dF2);color:var(--gbp-ink,#e8edf3);font:13px/1.45 system-ui,sans-serif;border:2px solid var(--gbp-accent,#ffb020);box-shadow:var(--gbp-shadow,0 0 0 4px #ffb02033,0 12px 40px #000a)'
    document.body.append(d)
    d.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation() })
    d.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation()
      const fs = Array.from(e.dataTransfer?.files ?? []); if (fs.length === 0) return
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card
      if (card === '2' || (card === undefined && this.step() === 2)) this.load_model(fs); else void this.load_source(fs)
    })
    d.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]'); if (b === null) return
      const a = b.dataset.a
      if (a === 'close') this.close()
      if (a === 'learn' && this.src !== null) { const n = learn_from(this.src.scene, this.src.name); alert(M(`Learned ${n} joints from ${this.src.name} (10/10). Clones with this skeleton now place them the same way.`, `Đã học ${n} khớp từ ${this.src.name} (10/10). Các lần clone với bộ xương này sẽ đặt khớp y như vậy.`, `${n}개 관절 학습`)); void this.render() }
      else if (a === 'min') { this.mini = !this.mini; void this.render() }
      else if (a === 'vsample') {
        // vehicles are cloned on the vehicle page: the sample's rig + animations go onto the car you upload there
        const id = (d.querySelector('[data-k2="vsample"]') as HTMLSelectElement).value
        try { const go = (window.parent as any).__gbGo; if (window.parent !== window && typeof go === 'function') { (window.parent as any).__gbVehicleClone = id; go('vehicle'); return } } catch { /* not in the cockpit */ }
        location.href = `vehicle.html#clone=${id}`
      }
      else if (a === 'pick1') (d.querySelector('[data-f="1"]') as HTMLInputElement).click()
      else if (a === 'pick2') (d.querySelector('[data-f="2"]') as HTMLInputElement).click()
      else if (a === 'apply') void this.apply()
      else if (a === 'clip') this.play(Number(b.dataset.i))
      else if (a === 'saved') void (async () => { const buf = await get_rig_file(b.dataset.n!); if (buf === null) return; await this.load_source([new File([buf], b.dataset.n!)]); if (this.src !== null && this.engine.process_step !== 'load-model') { this.picked = b.dataset.n!; await this.apply() } })()
      else if (a === 'tpl') void this.apply_template(b.dataset.t!)
      else if (a === 'glb' || a === 'fbx') this.engine.quick_export_all(a, (this.model_name !== '' ? this.model_name : 'model') + '_rigged')
      else if (a === 'playtest') (document.getElementById('easy-playtest') as HTMLButtonElement | null)?.click()
      else if (a === 'again') { this.done = false; this.src = null; this.picked = ''; location.search = '?clone=1' }
    })
    d.addEventListener('change', e => {
      const el = e.target as HTMLInputElement
      if (el.dataset.f === '1') { const fs = Array.from(el.files ?? []); el.value = ''; if (fs.length > 0) void this.load_source(fs) }
      if (el.dataset.f === '2') { const fs = Array.from(el.files ?? []); el.value = ''; if (fs.length > 0) this.load_model(fs) }
      if (el.dataset.k === 'adjust') this.adjust = el.checked
      if (el.dataset.k === 'warp') CLONE_FIT.warp = el.checked
      if (el.dataset.k === 'flip') CLONE_FIT.flip = el.checked
      if (el.dataset.k === 'jaw') CLONE_FIT.jaw_still = el.checked
      if (el.dataset.k === 'head') CLONE_FIT.head_still = el.checked
    })
  }

  private async render (): Promise<void> {
    const d = this.root; if (d === null) return
    const s = this.step(); const T = (en: string, vi: string): string => M(en, vi, en)
    const card = (n: number, title: string, body: string): string => {
      const on = n === s; const ok = n < s
      return `<div data-card="${n}" style="border-radius:12px;padding:${on ? 10 : 6}px 10px;border:${on ? '2px solid var(--gbp-accent,#ffb020)' : '1px solid var(--gbp-line,#2c3440)'};background:${on ? 'var(--gbp-on,#2a2412)' : 'var(--gbp-card,#161c25)'};${!on && !ok ? 'opacity:.55' : ''}${on ? ';box-shadow:var(--gbp-shadow,0 0 18px #ffb02055)' : ''}">
        <div style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:14px"><span style="display:inline-flex;width:24px;height:24px;border-radius:50%;align-items:center;justify-content:center;background:${ok ? '#16a34a' : on ? 'var(--gbp-accent,#ffb020)' : 'var(--gbp-line,#39424f)'};color:${on ? 'var(--gbp-accent-ink,#111)' : '#fff'}">${ok ? '✓' : n}</span>${title}</div>
        ${on || (ok && n === 1) ? `<div style="margin-top:6px">${body}</div>` : ''}</div>`
    }
    const btn = (a: string, label: string, pri = false, extra = ''): string => `<button data-a="${a}" ${extra} style="padding:8px 12px;border-radius:9px;border:1px solid ${pri ? 'var(--gbp-accent,#ffb020)' : 'var(--gbp-line,#39424f)'};background:${pri ? 'var(--gbp-accent,#ffb020)' : 'var(--gbp-btn,#1f2630)'};color:${pri ? 'var(--gbp-accent-ink,#111)' : 'inherit'};font-weight:${pri ? 700 : 500};cursor:pointer">${label}</button>`
    const drop = (n: number, text: string): string => `<div data-a="pick${n}" style="border:2px dashed var(--gbp-accent,#ffb02099);border-radius:10px;padding:14px;text-align:center;cursor:pointer">⬇ ${text}<div style="opacity:.7;font-size:12px">${T('drop here or click · GLB / FBX / GLTF / ZIP', 'thả vào đây hoặc bấm · GLB / FBX / GLTF / ZIP')}</div></div>`
    const saved = await list_rig_files()
    const src = this.src
    const has_model = this.engine.process_step !== 'load-model'
    const VI: Record<string, string> = { human: 'Người', fox: 'Cáo', bird: 'Chim', dragon: 'Rồng', kaiju: 'Quái vật', spider: 'Nhện', snake: 'Rắn', fish: 'Cá', horse: 'Ngựa', xphero: 'XP Hero', snakeclash: 'Snake Clash' }
    const ready = has_model && src === null && !this.busy && !this.done && this.picked === ''
      ? `<div style="font-weight:700;margin:2px 0 6px">${T('Ready rigs: click one, it goes onto your model', 'Rig có sẵn: bấm một cái là gắn luôn vào model')}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${RigConfig.all.map(r => `<button data-a="tpl" data-t="${r.skeleton_type}" title="${r.rig_display_name}" style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 4px;border-radius:9px;border:1px solid var(--gbp-line,#39424f);background:var(--gbp-btn,#1f2630);color:inherit;cursor:pointer;font-size:11.5px"><img src="${r.skeleton_template_image_url}" alt="" style="width:100%;height:54px;object-fit:contain;pointer-events:none" onerror="this.style.display='none'"><span style="pointer-events:none">${T(r.rig_display_name, VI[r.skeleton_type] ?? r.rig_display_name)}</span></button>`).join('')}</div>
        ${saved.length > 0 ? `<div style="margin-top:8px;opacity:.85">${T('Rigs you used before (with their animations):', 'Rig đã dùng (kèm animation):')}</div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${saved.map(n => btn('saved', '🦴 ' + n, false, `data-n="${n.replace(/"/g, '&quot;')}" title="${n.replace(/"/g, '&quot;')}" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 9px;border-radius:9px;border:1px solid var(--gbp-line,#39424f);background:var(--gbp-btn,#1f2630);color:inherit;cursor:pointer"`)).join('')}</div>` : ''}
        <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" data-k="adjust"${this.adjust ? ' checked' : ''}> ${T('Stop at the joints to adjust them first', 'Dừng ở bước khớp để chỉnh trước')}</label>
        <div style="opacity:.7;margin-top:6px">${T('…or drop a rigged file here to copy its skeleton + animations.', '…hoặc thả file có rig vào đây để lấy xương + animation của nó.')}</div>`
      : ''
    const one = ready !== '' ? ready : this.picked !== '' && src === null ? `<b>${this.picked}</b> ✓` : src === null
      ? drop(1, T('Your NEW model (no bones) — or a file WITH a rig', 'Model MỚI (chưa xương) — hoặc file CÓ xương')) + `<div style="margin-top:8px;padding:8px;border-radius:10px;border:1px solid var(--gbp-line,#39424f)">🚗 ${T('A vehicle? Use a ready rigged sample (wheels, doors, tracks… + animations):', 'Là xe? Dùng xe mẫu đã rig sẵn (bánh, cửa, xích… + animation):')}<div style="display:flex;gap:4px;margin-top:6px"><select data-k2="vsample" style="flex:1;min-width:0;padding:6px;border-radius:8px;background:var(--gbp-input,#0e1116);color:inherit;border:1px solid var(--gbp-line,#39424f)">${SAMPLES.map(x => `<option value="${x.id}">${T(x.label, x.vi)}</option>`).join('')}</select>${btn('vsample', '→', true)}</div></div>` + (saved.length > 0 ? `<div style="margin-top:6px;opacity:.8">${T('or a rig you used before:', 'hoặc rig đã dùng trước đây:')}</div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${saved.map(n => btn('saved', '🦴 ' + n, false, `data-n="${n.replace(/"/g, '&quot;')}" title="${n.replace(/"/g, '&quot;')}" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 9px;border-radius:9px;border:1px solid var(--gbp-line,#39424f);background:var(--gbp-btn,#1f2630);color:inherit;cursor:pointer"`)).join('')}</div>` : '')
      : `<b>${src.name}</b> · ${src.bones} ${T('bones', 'xương')} · ${src.clips.length} ${T('animations', 'animation')}<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${src.clips.map((c, i) => btn('clip', '▶ ' + (c.name !== '' ? c.name : '#' + (i + 1)), false, `data-i="${i}"`)).join('')}</div><div style="opacity:.75;margin-top:4px">${T('Shown on the right: its model, its skeleton (lines) and its moves.', 'Đang hiện bên phải: model, khung xương (đường kẻ) và animation của file.')}</div><div style="margin-top:6px">${this.learned_note()}${btn('learn', '⭐ ' + T('10/10: learn its joints from this file', 'Chuẩn 10/10: học vị trí xương từ file này'), false, `title="${T('A well rigged file: its main joints (hips, spine, shoulders, neck, head) are remembered as places in its body. Every later clone with these bones puts them there.', 'File đã rig chuẩn: vị trí các khớp chính (hông, cột sống, vai, cổ, đầu) trong thân được ghi nhớ. Lần clone sau với bộ xương này sẽ đặt khớp theo đúng bài đã học.')}"`)}</div>`
    const two = has_model && src === null ? `<b>${this.model_name !== '' ? this.model_name : T('your model', 'model của bạn')}</b> ✓` : s < 2 ? T('Then your model without bones.', 'Sau đó là model chưa có xương của bạn.') : s === 2 ? drop(2, T('Your model WITHOUT bones', 'Model CHƯA có xương của bạn')) : `<b>${this.model_name !== '' ? this.model_name : T('your model', 'model của bạn')}</b> ✓`
    const three = this.picked !== '' && s === 3 ? `⏳ ${T('Fitting', 'Đang gắn')} ${this.picked}…` : s < 3 ? T('Its skeleton goes into your model, your model is skinned to it and gets its animations.', 'Bộ xương được đặt vào model của bạn, model được skin theo nó và nhận các animation.')
      : s === 3 ? `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="warp"${CLONE_FIT.warp ? ' checked' : ''}> ${T('Advanced: bend the skeleton to a differently shaped body (off = copy the skeleton as it is)', 'Nâng cao: uốn xương theo thân khác dáng (tắt = copy nguyên bộ xương)')}</label>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="flip"${CLONE_FIT.flip ? ' checked' : ''}> ${T('Head and tail are swapped (turn it around)', 'Đầu / đuôi bị ngược (quay lại)')}</label>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="jaw"${CLONE_FIT.jaw_still ? ' checked' : ''}> ${T('One-piece mouth: keep the jaw still (no torn snout)', 'Miệng liền một khối: giữ hàm đứng yên (không rách mõm)')}</label>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="head"${CLONE_FIT.head_still ? ' checked' : ''}> ${T('Stiff head (it rides on the body: no bent face)', 'Giữ đầu cứng (đầu đi theo thân, mặt không bị méo)')}</label>
        <label style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><input type="checkbox" data-k="adjust"${this.adjust ? ' checked' : ''}> ${T('Stop at the joints to adjust them first', 'Dừng ở bước khớp để chỉnh trước')}</label>${btn('apply', this.busy ? '⏳ …' : '🧬 ' + T('Apply the rig to my model', 'Áp dụng rig vào model'), true)}`
        : T('Done: your model has the rig.', 'Xong: model của bạn đã có rig.')
    const four = s < 4 ? T('Export your base model with the rig and the animations.', 'Xuất model base đã có rig và animation.')
      : `<div style="display:flex;gap:6px;flex-wrap:wrap">${btn('glb', '⬇ GLB', true)}${btn('fbx', '⬇ FBX')}${btn('playtest', '🎮 ' + T('Play test', 'Chơi thử'))}</div><div style="opacity:.75;margin-top:6px">${T('Pick an animation in the list to watch it. Paint skin weights there too if a spot needs it.', 'Chọn animation trong danh sách để xem. Có thể paint skin weight ở đó nếu cần sửa chỗ nào.')}</div>${btn('again', '↺ ' + T('Clone onto another model', 'Gắn cho model khác'))}`
    const head = `<div style="display:flex;align-items:center;gap:6px"><b style="flex:1;font-size:15px;color:var(--gbp-accent,#ffb020)">🧬 ${T('Clone rig', 'Clone rig (copy xương)')} <span style="opacity:.7;font-weight:500;font-size:12px">${s}/4</span></b>${btn('min', this.mini ? '▢' : '—', false, `title="${T('Fold / unfold', 'Thu gọn / mở rộng')}"`)}${btn('close', '✕')}</div>`
    if (this.mini) {
      // folded: only the step you are on
      const bodies = [one, two, three, four]; const titles = [T('Rig file', 'File có rig'), T('Model without bones', 'Model chưa có xương'), T('Apply the rig', 'Áp dụng rig'), T('Base model with the rig', 'File base có rig')]
      d.innerHTML = head + card(s, titles[s - 1], bodies[s - 1]) + '<input type="file" data-f="1" accept=".glb,.gltf,.fbx,.zip,.bin" multiple hidden><input type="file" data-f="2" accept=".glb,.gltf,.fbx,.obj,.mtl,.dae,.stl,.ply,.3mf,.zip,.bin,.png,.jpg,.jpeg,.tga,.webp" multiple hidden>'
      return
    }
    d.innerHTML = `${head}
      <div style="opacity:.8;${s > 1 ? 'display:none' : ''}">${T('Take the skeleton and animations of a rigged file and put them on your model without bones.', 'Lấy bộ xương và animation của một file đã rig, gắn sang model chưa có xương của bạn.')}</div>
      ${card(1, T('Rig file', 'File có rig'), one)}${card(2, T('Model without bones', 'Model chưa có xương'), two)}${card(3, T('Apply the rig', 'Áp dụng rig'), three)}${card(4, T('Base model with the rig', 'File base có rig'), four)}
      <input type="file" data-f="1" accept=".glb,.gltf,.fbx,.zip,.bin" multiple hidden><input type="file" data-f="2" accept=".glb,.gltf,.fbx,.obj,.mtl,.dae,.stl,.ply,.3mf,.zip,.bin,.png,.jpg,.jpeg,.tga,.webp" multiple hidden>`
    d.querySelector<HTMLElement>(`[data-card="${s}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  /* ---------------- 1: the rig file, shown at once ---------------- */
  private async load_source (files: File[]): Promise<void> {
    try {
      const r = await load_any_files(files)
      let bones = 0; r.scene.traverse(o => { if ((o as THREE.Bone).isBone === true) bones++ })
      if (bones === 0) {
        // no bones: this is the NEW model. Load it, then the ready rigs show up: one click rigs it
        if (this.engine.process_step === 'load-model') { this.load_model(files); setTimeout(() => { void this.render() }, 600); return }
        alert(M('This file has no skeleton. Step 1 needs a rigged file.', 'File này không có xương. Bước 1 cần file đã rig.', '스켈레톤이 없습니다.')); return
      }
      // a car / tank: its bones are axles and hinges, not a body to bend -> the vehicle clone does it right
      let wheels = 0; let limbs = 0
      r.scene.traverse(o => { const n = o.name.toLowerCase(); if (/wheel|tire|tyre|(^|[^a-z])rims?([^a-z]|$)|track|tread/.test(n)) wheels++; if (/leg|spine|neck|head|hip|pelvis|tail|thigh|arm|hand|foot|paw/.test(n)) limbs++ })
      if (wheels >= 2 && limbs < 3) {
        // straight to the vehicle clone: the file is kept (same browser store) and becomes its source
        const main = files.find(f => /\.(glb|fbx|zip|gltf)$/i.test(f.name)) ?? files[0]
        await save_rig_file(main.name, await main.arrayBuffer())
        try { const go = (window.parent as any).__gbGo; if (window.parent !== window && typeof go === 'function') { (window.parent as any).__gbVehicleCloneRig = main.name; go('vehicle'); return } } catch { /* not in the cockpit */ }
        location.href = 'vehicle.html#cloneRig=' + encodeURIComponent(main.name); return
      }
      this.src = { files, name: r.name, scene: r.scene, clips: r.clips, bones }
      this.show_preview()
      this.render()
    } catch (e) { alert((e as Error).message) }
  }

  private show_preview (): void {
    this.drop_preview()
    const s = this.src; if (s === null) return
    const g = new THREE.Group(); g.name = 'Clone rig preview'
    g.add(s.scene)
    s.scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(s.scene); const size = box.getSize(new THREE.Vector3())
    // as big as your model (or 2 units long), standing on the floor, beside it
    const target = this.model_box()
    const want = target !== null ? target.getSize(new THREE.Vector3()) : new THREE.Vector3(2, 2, 2)
    const k = Math.max(want.x, want.y, want.z) / Math.max(1e-6, size.x, size.y, size.z)
    const kk = Number.isFinite(k) && k > 0 ? k : 1
    g.scale.setScalar(kk)
    const c = box.getCenter(new THREE.Vector3())
    // in a row with your model, along its long side, so a side view shows both and they never overlap
    const ts = target !== null ? target.getSize(new THREE.Vector3()) : null; this.long_z = ts !== null && ts.z > ts.x
    const tcn = target !== null ? target.getCenter(new THREE.Vector3()) : new THREE.Vector3()
    if (target === null) g.position.set(-c.x * kk, -box.min.y * kk, -c.z * kk)
    else if (!this.long_z) g.position.set(-c.x * kk + target.max.x + (size.x * kk) * 0.6 + 0.3, -box.min.y * kk, -c.z * kk + tcn.z)
    else g.position.set(-c.x * kk + tcn.x, -box.min.y * kk, -c.z * kk + target.max.z + (size.z * kk) * 0.6 + 0.3)
    const helper = new THREE.SkeletonHelper(s.scene); (helper.material as THREE.LineBasicMaterial).depthTest = false; helper.renderOrder = 50
    this.engine.scene.add(g); this.engine.scene.add(helper); helper.name = 'Clone rig preview skeleton'
    g.userData.helper = helper
    this.preview = g
    this.mixer = new THREE.AnimationMixer(s.scene)
    if (s.clips.length > 0) this.play(Math.max(0, s.clips.findIndex(c2 => /idle/i.test(c2.name))))
    this.frame(); for (const t of [700, 1600]) setTimeout(() => this.frame(), t) // the rig page re-frames on its own after a turn / floor align
  }

  /** your model is turned (90° steps) so its head points where the rig file's head points: no manual turning */
  private async auto_face (): Promise<void> {
    const s = this.src; if (s === null || this.engine.process_step === 'load-model') return
    for (let i = 0; i < 4; i++) {
      const y = facing_yaw(s.scene, this.engine.load_model_step.model_meshes()); if (y === null) return
      const d = Math.abs(((y * 180 / Math.PI) % 360 + 540) % 360 - 180); if (d < 45) break
      ;(document.getElementById('rotate-model-y-button') as HTMLButtonElement | null)?.click()
      await new Promise(r => setTimeout(r, 250))
    }
    ;(document.getElementById('auto-align-model-button') as HTMLButtonElement | null)?.click()
    await new Promise(r => setTimeout(r, 150))
  }

  private learned_note (): string {
    const l = this.src !== null ? learned_for(this.src.scene) : null
    return l !== null ? `<div style="color:var(--gbp-accent,#4fed89);font-weight:700;margin-bottom:4px">⭐ ${M('Learned joints in use', 'Đang dùng vị trí khớp đã học', '학습한 관절 사용 중')}: ${l.name}</div>` : ''
  }

  private play (i: number): void {
    const s = this.src; if (s === null || this.mixer === null || s.clips[i] === undefined) return
    this.mixer.stopAllAction(); this.mixer.clipAction(s.clips[i]).reset().play()
  }

  private drop_preview (): void {
    if (this.preview === null) return
    this.mixer?.stopAllAction(); this.mixer = null
    const h = this.preview.userData.helper as THREE.Object3D | undefined; h?.removeFromParent()
    this.preview.removeFromParent(); this.preview = null
  }

  private model_box (): THREE.Box3 | null {
    if (this.engine.process_step === 'load-model') return null
    const m = this.engine.load_model_step.model_meshes(); m.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(m)
    return b.isEmpty() ? null : b
  }

  /** look at what is on screen (the rig file, and your model when it is there) */
  private frame (): void {
    const box = new THREE.Box3(); if (this.preview !== null) { this.preview.updateMatrixWorld(true); box.union(new THREE.Box3().setFromObject(this.preview, true)) } // precise: a skinned box from the bind data can be far too small; const mb = this.model_box(); if (mb !== null) box.union(mb)
    if (box.isEmpty()) return
    const c = box.getCenter(new THREE.Vector3()); const r = box.getSize(new THREE.Vector3()).length()
    // far enough for the camera's field of view (the rig page uses a narrow 15° lens)
    const cam = this.engine.camera; const fov = THREE.MathUtils.degToRad(cam.fov)
    const dist = (r * 0.5) / Math.tan(fov / 2) * 1.05
    ;(this.engine as any).scene_environment?.set_fog_enabled?.(false) // the rig file and a long model side by side sit past the fog
    // from the side of the row (a long body seen end-on fills the screen)
    cam.position.copy(c).add((this.long_z ? new THREE.Vector3(1, 0.45, 0.3) : new THREE.Vector3(0.3, 0.45, 1)).normalize().multiplyScalar(dist)); cam.lookAt(c)
    const oc = (this.engine as any).scene_environment?.orbit_controls?.(); if (oc != null) { oc.maxDistance = Math.max(oc.maxDistance, dist * 1.5); oc.target.copy(c); oc.update() } // the orbit's 30-unit limit cut long models
  }

  private loop (): void {
    this.raf = requestAnimationFrame(() => this.loop())
    this.timer.update()
    const dt = this.timer.getDelta()
    if (this.mixer !== null) this.mixer.update(dt)
    // step 2 → 3 happens inside the rig page: keep the cards in sync
    // the ready rigs appear as soon as a dropped model is in, whatever step number
    const s = this.step() + (this.engine.process_step !== 'load-model' ? 10 : 0); if (s !== (this.root as any)?.__s) { (this.root as any).__s = s; if (this.root?.style.display !== 'none') { void this.render(); if (s % 10 === 3 && this.picked === '') { setTimeout(() => { void this.auto_face().then(() => this.show_preview()) }, 300) } } }
  }

  /* ---------------- 2: your model ---------------- */
  private load_model (files: File[]): void {
    if (this.engine.process_step !== 'load-model') { alert(M('A model is loaded already: press "↺ Clone onto another model" to start again.', 'Đã có model: bấm "↺ Gắn cho model khác" để làm lại.', '이미 모델이 있습니다.')); return }
    this.model_name = (files.find(f => /\.(glb|gltf|fbx|obj|dae|stl|ply|3mf|zip)$/i.test(f.name))?.name ?? files[0].name).replace(/\.[^.]+$/, '')
    const input = document.getElementById('model-upload') as HTMLInputElement | null; if (input === null) return
    const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /** one click: a ready skeleton type fitted into the loaded model, skinned, with its animations */
  private async apply_template (type: string): Promise<void> {
    if (this.busy) return
    const r = RigConfig.by_key(type); this.picked = r?.rig_display_name ?? type
    this.busy = true; void this.render()
    ;(document.getElementById('auto-align-model-button') as HTMLButtonElement | null)?.click()
    await new Promise(res => setTimeout(res, 200))
    const sel = document.getElementById('skeleton-selection') as HTMLSelectElement | null
    if (sel !== null) { sel.value = type; sel.dispatchEvent(new Event('change', { bubbles: true })) }
    for (let i = 0; i < 40 && (document.getElementById('load-skeleton-button') as HTMLButtonElement | null)?.disabled === true; i++) await new Promise(res => setTimeout(res, 150))
    await new Promise(res => setTimeout(res, 700))
    ;(document.getElementById('load-skeleton-button') as HTMLButtonElement | null)?.click()
    for (let i = 0; i < 40 && this.engine.process_step !== 'edit-skeleton'; i++) await new Promise(res => setTimeout(res, 200))
    if (!this.adjust) {
      await new Promise(res => setTimeout(res, 1200)) // the joints are measured into the model
      ;(document.getElementById('action_bind_pose') as HTMLButtonElement | null)?.click()
      for (let i = 0; i < 80 && this.engine.process_step !== 'animations-export'; i++) await new Promise(res => setTimeout(res, 250))
      this.done = this.engine.process_step === 'animations-export'
    } else {
      const wait = async (): Promise<void> => { for (;;) { await new Promise(res => setTimeout(res, 500)); if (this.engine.process_step === 'animations-export') { this.done = true; void this.render(); return } } }
      void wait()
    }
    this.busy = false; void this.render()
  }

  /* ---------------- 3: apply ---------------- */
  private async apply (): Promise<void> {
    const s = this.src; if (s === null || this.busy) return
    this.busy = true; void this.render()
    this.drop_preview()
    // your model standing on the floor before the skeleton is measured into it
    ;(document.getElementById('auto-align-model-button') as HTMLButtonElement | null)?.click()
    await new Promise(r => setTimeout(r, 150))
    const ok = await this.engine.load_skeleton_step.load_custom_rig(s.files)
    if (!ok) { this.busy = false; void this.render(); return }
    if (!this.adjust) {
      await new Promise(r => setTimeout(r, 900))
      ;(document.getElementById('action_bind_pose') as HTMLButtonElement | null)?.click()
      for (let i = 0; i < 80 && this.engine.process_step !== 'animations-export'; i++) await new Promise(r => setTimeout(r, 250))
      this.done = this.engine.process_step === 'animations-export'
    } else {
      // after the joints step, the skin step finishes the job (step 4 lights up then)
      const wait = async (): Promise<void> => { for (;;) { await new Promise(r => setTimeout(r, 500)); if (this.engine.process_step === 'animations-export') { this.done = true; void this.render(); return } } }
      void wait()
    }
    this.busy = false; void this.render()
  }
}

/** a highlighted "🧬 Clone rig" button on the first step of the rig page; ?clone=1 opens the wizard at once */
export function mount_clone_rig (engine: Mesh2MotionEngine): CloneRigWizard {
  const w = new CloneRigWizard(engine)
  const add = (): void => {
    const host = document.getElementById('load-model-tools'); if (host === null || document.getElementById('gb-clone-rig-open') !== null) return
    const b = document.createElement('button'); b.id = 'gb-clone-rig-open'; b.type = 'button'
    b.innerHTML = '🧬 ' + M('Clone rig: rig file → my model', 'Clone rig: lấy xương file khác → model của tôi', '리그 복제')
    b.style.cssText = 'width:100%;margin:0 0 12px;padding:12px;border-radius:10px;border:2px solid var(--gbp-accent,#ffb020);background:var(--gbp-on,#2a2412);color:var(--gbp-accent,#ffd27a);font-weight:700;cursor:pointer;box-shadow:var(--gbp-shadow,0 0 14px #ffb02066)'
    b.onclick = () => w.open()
    host.prepend(b)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add()
  if (/[?&]clone=1/.test(location.search)) setTimeout(() => w.open(), 300)
  ;(window as any).__gbCloneRig = w; (window as any).__gbCloneFit = CLONE_FIT
  // the cockpit asks by message when it cannot reach into this frame (pages opened from file://)
  addEventListener('message', (e) => { if ((e.data as any)?.gbCloneOpen === 1) w.open() })
  return w
}
