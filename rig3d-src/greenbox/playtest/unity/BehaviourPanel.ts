/*
 * Unity behaviours on the selected map object: a dropdown to add one, its options, ✕ to remove.
 * Stored in the object's map_extra.mb ([{ t: type, o: { option: value } }]) so save / load / undo keep it.
 * Also the export dialog that asks where the .unitypackage files go (with a live folder tree).
 */
import type * as THREE from 'three'
import { M } from '../../common/lang.ts'
import { BEHAVIOURS, type BehaviourDef } from './Behaviours.ts'
import { DEFAULT_LAYOUT, package_paths, type PackageLayout } from './UnityPackage.ts'

export interface MB { t: string, o?: Record<string, string | number | boolean> }
const vi = (): boolean => M('en', 'vi', 'ko') === 'vi'
const L = (d: { en: string, vi: string }): string => vi() ? d.vi : d.en
const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

export function mb_of (o: THREE.Object3D): MB[] | null {
  const ex = o.userData.map_extra as { mb?: MB[] } | undefined
  if (o.userData.map_kind === undefined) return null // dropped files / boxes are not part of the exported map
  return ex?.mb ?? []
}

export class BehaviourPanel {
  private readonly el: HTMLDivElement
  private obj: THREE.Object3D | null = null

  constructor (parent: HTMLElement, private readonly changed: () => void) {
    this.el = document.createElement('div'); this.el.id = 'pt-mb'; this.el.className = 'gb-mb'
    parent.appendChild(this.el)
    this.style()
    this.el.addEventListener('change', e => this.on_change(e))
    this.el.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('[data-mbx]') as HTMLElement | null
      if (b === null || this.obj === null) return
      const list = mb_of(this.obj); if (list === null) return
      list.splice(Number(b.dataset.mbx), 1); this.store(list); this.render()
    })
    this.render()
  }

  public show (o: THREE.Object3D | null): void { this.obj = o; this.render() }

  private store (list: MB[]): void {
    if (this.obj === null) return
    this.obj.userData.map_extra = { ...(this.obj.userData.map_extra ?? {}), mb: list }
    this.changed()
  }

  private on_change (e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement
    if (this.obj === null) return
    const list = mb_of(this.obj); if (list === null) return
    if (t.dataset.mbadd !== undefined) {
      const def = BEHAVIOURS.find(b => b.type === t.value); t.value = ''
      if (def === undefined || list.some(m => m.t === def.type)) return
      list.push({ t: def.type, o: Object.fromEntries(def.options.map(op => [op.key, op.def])) }); this.store(list); this.render(); return
    }
    if (t.dataset.mbi !== undefined) {
      const m = list[Number(t.dataset.mbi)]; const def = BEHAVIOURS.find(b => b.type === m?.t); const op = def?.options.find(q => q.key === t.dataset.mbk)
      if (m === undefined || op === undefined) return
      m.o = m.o ?? {}
      m.o[op.key] = op.kind === 'number' ? Number(t.value) : op.kind === 'bool' ? (t as HTMLInputElement).checked : t.value
      this.store(list)
    }
  }

  private render (): void {
    const o = this.obj
    const head = `<div class="gb-grouptitle">🧩 ${M('Unity behaviours', 'Hành vi Unity (MonoBehaviour)', 'Unity 동작')}</div>`
    if (o === null) { this.el.innerHTML = head + `<div class="sm">${M('Select an object on the map to give it behaviours (stacking, door, grass, saw…). They go into the Unity package.', 'Chọn một vật trên map để gắn hành vi (xếp chồng, cửa, cỏ, máy cưa…). Chúng đi theo gói Unity.', '오브젝트를 선택하세요.')}</div>`; return }
    const list = mb_of(o)
    if (list === null) { this.el.innerHTML = head + `<div class="sm">${M('Dropped files / boxes are not in the exported map: place it from the object palette to give it behaviours.', 'File / hộp thả vào không nằm trong map xuất: đặt vật từ bảng vật thể để gắn hành vi.', '팔레트에서 배치한 오브젝트만 가능합니다.')}</div>`; return }
    const opt = (def: BehaviourDef, m: MB, i: number): string => def.options.map(op => {
      const v = m.o?.[op.key] ?? op.def; const name = esc(L(op))
      if (op.kind === 'enum') return `<label class="sm">${name}<select data-mbi="${i}" data-mbk="${op.key}">${(op.values ?? []).map(x => `<option value="${x}"${x === v ? ' selected' : ''}>${x === 'Arc' ? M('Arc (hop)', 'Vòng cung', '포물선') : x === 'Straight' ? M('Straight', 'Bay thẳng', '직선') : x}</option>`).join('')}</select></label>`
      if (op.kind === 'bool') return `<label class="sm"><input type="checkbox" data-mbi="${i}" data-mbk="${op.key}"${v === true ? ' checked' : ''}> ${name}</label>`
      return `<label class="sm">${name}<input type="number" data-mbi="${i}" data-mbk="${op.key}" value="${v}" min="${op.min ?? ''}" max="${op.max ?? ''}" step="${op.step ?? 'any'}"></label>`
    }).join('')
    const items = list.map((m, i) => {
      const def = BEHAVIOURS.find(b => b.type === m.t); if (def === undefined) return ''
      return `<div class="gb-mb-item"><div class="gb-mb-top"><b>${esc(L(def))}</b><code>${def.type}</code><button data-mbx="${i}" title="${M('Remove', 'Gỡ', '제거')}">✕</button></div><div class="sm gb-mb-hint">${esc(vi() ? def.hint_vi : def.hint_en)}</div>${def.options.length > 0 ? `<div class="gb-mb-opts">${opt(def, m, i)}</div>` : ''}</div>`
    }).join('')
    const free = BEHAVIOURS.filter(b => !list.some(m => m.t === b.type))
    this.el.innerHTML = head + `<div class="sm gb-mb-on">${M('On', 'Đang chọn', '대상')}: <b>${esc(o.name)}</b></div>` + items +
      `<select data-mbadd><option value="">＋ ${M('Add a behaviour…', 'Thêm hành vi…', '동작 추가…')}</option>${free.map(b => `<option value="${b.type}">${esc(L(b))}</option>`).join('')}</select>`
  }

  private style (): void {
    if (document.getElementById('gb-mb-css') !== null) return
    const s = document.createElement('style'); s.id = 'gb-mb-css'
    s.textContent = `.gb-mb{display:flex;flex-direction:column;gap:8px;margin-top:6px}
.gb-mb-item{border-radius:14px;padding:10px 12px;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.02));border:1px solid rgba(170,255,214,.16);display:flex;flex-direction:column;gap:6px}
.gb-mb-top{display:flex;align-items:center;gap:8px}.gb-mb-top b{flex:1;font-size:13px}.gb-mb-top code{font-size:10.5px;opacity:.55}
.gb-mb-top button{width:28px;height:28px;padding:0!important;display:inline-flex;align-items:center;justify-content:center;border-radius:9px!important}
.gb-mb-hint{opacity:.7;line-height:1.45}
.gb-mb-opts{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
.gb-mb-opts label{display:flex!important;flex-direction:column;align-items:stretch!important;gap:3px!important}
.gb-mb-opts input[type=number],.gb-mb-opts select,.gb-mb select[data-mbadd]{width:100%;box-sizing:border-box}
.gb-mb-on{opacity:.8}`
    document.head.appendChild(s)
  }
}

/* ---------------- export dialog ---------------- */
const KEY = 'gb.unity.layout'
export function ask_layout (): Promise<PackageLayout | null> {
  let L0: PackageLayout = { ...DEFAULT_LAYOUT }
  try { L0 = { ...L0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { /* fresh */ }
  return new Promise(resolve => {
    const bg = document.createElement('div'); bg.className = 'gb-ux-bg'
    bg.innerHTML = `<div class="gb-ux" role="dialog" aria-modal="true">
      <h3>📦 ${M('Export a Unity package', 'Xuất gói Unity (.unitypackage)', 'Unity 패키지 내보내기')}</h3>
      <p class="sm">${M('Where should the files go in the Unity project? Type the folders the way your team sorts them.', 'File sẽ nằm ở đâu trong project Unity? Gõ đường dẫn theo cách team bạn sắp xếp.', 'Unity 프로젝트 안의 폴더를 정하세요.')}</p>
      <label>${M('Root folder (under Assets/)', 'Thư mục gốc (trong Assets/)', '루트 폴더')}<input data-k="root" value="${esc(L0.root)}" placeholder="Supercent/PizzaReady/053"></label>
      <div class="gb-ux-grid">
        <label>${M('Scripts folder', 'Thư mục scripts', '스크립트')}<input data-k="scripts" value="${esc(L0.scripts)}"></label>
        <label>${M('Behaviours folder (inside scripts)', 'Thư mục MonoBehaviour (trong scripts)', '동작 폴더')}<input data-k="behaviours" value="${esc(L0.behaviours)}"></label>
        <label>${M('Models folder', 'Thư mục model', '모델')}<input data-k="models" value="${esc(L0.models)}"></label>
        <label>${M('Data folder', 'Thư mục data', '데이터')}<input data-k="data" value="${esc(L0.data)}"></label>
      </div>
      <label class="gb-ux-chk"><input type="checkbox" data-k="all"${L0.all ? ' checked' : ''}> ${M('Include every behaviour (not only the ones used on this map)', 'Kèm tất cả MonoBehaviour (không chỉ những cái map này dùng)', '모든 동작 포함')}</label>
      <div class="gb-ux-tree" aria-label="preview"></div>
      <div class="gb-ux-btns"><button data-x="cancel">${M('Cancel', 'Huỷ', '취소')}</button><button data-x="ok" class="pri">📦 ${M('Export', 'Xuất gói', '내보내기')}</button></div>
    </div>`
    document.body.appendChild(bg)
    const read = (): PackageLayout => {
      const v = (k: string): string => (bg.querySelector(`[data-k="${k}"]`) as HTMLInputElement).value
      return { root: v('root'), scripts: v('scripts'), behaviours: v('behaviours'), models: v('models'), data: v('data'), all: (bg.querySelector('[data-k="all"]') as HTMLInputElement).checked }
    }
    const tree = (): void => {
      const P = package_paths(read())
      const rel = (p: string): string => p.slice(P.root.length + 1)
      ;(bg.querySelector('.gb-ux-tree') as HTMLElement).innerHTML = `<div><b>${esc(P.root)}/</b></div>` +
        [[rel(P.behaviours), 'StackCarrier.cs, StackDropZone.cs, AutoDoor.cs…'], [rel(P.editor), 'GreenboxMapBuilder.cs'], [rel(P.models), 'GreenboxMap.fbx'], [rel(P.data), 'greenbox-behaviours.json, greenbox-map.json'], ['', 'README.txt']]
          .map(([d, f]) => `<div class="t">${d !== '' ? `├─ <b>${esc(d)}/</b>  ` : '└─ '}<span>${esc(f)}</span></div>`).join('')
    }
    bg.addEventListener('input', tree); bg.addEventListener('change', tree); tree()
    const done = (v: PackageLayout | null): void => { bg.remove(); if (v !== null) { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode */ } } resolve(v) }
    bg.addEventListener('click', e => {
      const x = (e.target as HTMLElement).closest('[data-x]') as HTMLElement | null
      if (e.target === bg || x?.dataset.x === 'cancel') done(null); else if (x?.dataset.x === 'ok') done(read())
    })
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') done(read()) })
    ;(bg.querySelector('[data-k="root"]') as HTMLInputElement).focus()
    if (document.getElementById('gb-ux-css') === null) {
      const st = document.createElement('style'); st.id = 'gb-ux-css'
      st.textContent = `.gb-ux-bg{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,6,5,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.gb-ux{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:22px;color:#eef6f2;font:14px/1.5 system-ui,sans-serif;
  background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,.02) 40%,rgba(47,233,139,.05)),rgba(12,20,17,.86);border:1px solid rgba(170,255,214,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 0 40px -14px rgba(47,233,139,.5),0 30px 60px -20px rgba(0,0,0,.8)}
.gb-ux h3{margin:0;font-size:18px}.gb-ux .sm{margin:0;opacity:.75;font-size:13px}
.gb-ux label{display:flex;flex-direction:column;gap:4px;font-size:12px;opacity:.95}
.gb-ux input:not([type=checkbox]){padding:9px 11px;border-radius:10px;border:1px solid rgba(170,255,214,.2);background:rgba(0,0,0,.3);color:#eef6f2;font:inherit}
.gb-ux input:focus{outline:none;border-color:rgba(47,233,139,.6);box-shadow:0 0 0 3px rgba(47,233,139,.15)}
.gb-ux-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gb-ux .gb-ux-chk{flex-direction:row;align-items:center;gap:8px}
.gb-ux-tree{font:12px/1.7 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.3);border:1px solid rgba(170,255,214,.12);border-radius:12px;padding:10px 12px;white-space:pre-wrap;word-break:break-all}
.gb-ux-tree span{opacity:.6}.gb-ux-tree b{color:#7dffbf;font-weight:600}
.gb-ux-btns{display:flex;justify-content:flex-end;gap:8px}
@media (max-width:520px){.gb-ux-grid{grid-template-columns:1fr}}`
      document.head.appendChild(st)
    }
  })
}
