/*
 * 🛒 Model shop: the Polyfork catalogue (polyfork.dev, 2 791 free low-poly models, commercial use OK, no attribution;
 * do not resell the files) as a small shop next to the map. Filter by type / kit, search, tick the models you want,
 * "Add to the map": each GLB is fetched from the Polyfork CDN and becomes a palette object (file:<id>.glb), placed
 * in a row in front of the camera when "place them" is on. The index is static/polyfork/catalog.json (made from
 * github.com/lucas-martinic/polyfork-catalog); the models themselves come from the internet when added.
 */
import { M } from '../common/lang.ts'

interface Cat { src: string, licence: string, kits: Record<string, string>, a: Array<[string, string, string, string, number]> }
export interface ShopHost {
  add_file: (name: string, buf: ArrayBuffer) => Promise<string> // → palette kind
  place: (kind: string, i: number, n: number) => void
  status: (t: string, warn?: boolean) => void
}

const TYPES: Array<[string, string, string]> = [['', 'All', 'Tất cả'], ['prop', 'Props', 'Đồ vật'], ['building', 'Buildings', 'Nhà'], ['vehicle', 'Vehicles', 'Xe'],
  ['character', 'Characters', 'Nhân vật'], ['animal', 'Animals', 'Con vật'], ['terrain', 'Terrain', 'Địa hình'], ['ultra', 'Ultra', 'Ultra']]

export function mount_polyfork_shop (button: HTMLElement, host: ShopHost): void {
  let cat: Cat | null = null; let box: HTMLDivElement | null = null
  const picked = new Set<string>(); let type = ''; let kit = ''; let q = ''; let shown = 60
  const thumb = (id: string): string => `https://polyfork.dev/files/${id}/renders/hero.png`
  const css = `#gb-shop{position:fixed;inset:4vh 4vw;z-index:80;display:flex;flex-direction:column;background:rgba(16,22,20,.96);border:1px solid #2c5a45;border-radius:18px;box-shadow:0 20px 60px #0009;color:#e8efe9;font:13px/1.4 system-ui,sans-serif;overflow:hidden}
  #gb-shop header{display:flex;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid #26332d;flex-wrap:wrap}
  #gb-shop header b{font-size:16px}#gb-shop .sp{flex:1}
  #gb-shop input,#gb-shop select{background:#1d2723;border:1px solid #2f4038;color:#e8efe9;border-radius:9px;padding:6px 10px;font:inherit}
  #gb-shop .chips{display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid #26332d}
  #gb-shop .chips button{background:#1d2723;border:1px solid #2f4038;color:#cfe;border-radius:999px;padding:4px 12px;cursor:pointer}
  #gb-shop .chips button.on{background:#16a34a;border-color:#16a34a;color:#fff}
  #gb-shop .grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:14px 16px}
  #gb-shop .card{background:#18211d;border:2px solid #26332d;border-radius:14px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;transition:border-color .15s,transform .15s}
  #gb-shop .card:hover{border-color:#3ddc84;transform:translateY(-2px)}#gb-shop .card.on{border-color:#3ddc84;box-shadow:0 0 0 3px #3ddc8444}
  #gb-shop .card img{width:100%;aspect-ratio:1;object-fit:cover;background:#e9edf3}
  #gb-shop .card div{padding:6px 8px}#gb-shop .card small{color:#93a39a}
  #gb-shop .card .tick{position:absolute;margin:6px;width:22px;height:22px;border-radius:50%;background:#3ddc84;color:#04120a;display:none;align-items:center;justify-content:center;font-weight:900}
  #gb-shop .card.on .tick{display:flex}
  #gb-shop footer{display:flex;gap:10px;align-items:center;padding:10px 16px;border-top:1px solid #26332d;flex-wrap:wrap}
  #gb-shop footer button{border:0;border-radius:10px;padding:9px 16px;font:700 14px system-ui;cursor:pointer}
  #gb-shop .buy{background:linear-gradient(#36d36a,#16a34a);color:#fff}#gb-shop .ghost{background:#1d2723;color:#e8efe9;border:1px solid #2f4038!important}`
  const open = async (): Promise<void> => {
    if (box !== null) { box.style.display = 'flex'; return }
    if (document.getElementById('gb-shop-css') === null) { const st = document.createElement('style'); st.id = 'gb-shop-css'; st.textContent = css; document.head.append(st) }
    box = document.createElement('div'); box.id = 'gb-shop'; document.body.append(box)
    box.innerHTML = `<header><b>🛒 ${M('Model shop', 'Cửa hàng model', '모델 상점')}</b><span style="color:#93a39a">Polyfork · ${M('free low-poly models, commercial use OK', 'model low-poly miễn phí, dùng thương mại được', '무료 로우폴리')}</span><span class="sp"></span>
      <input data-q placeholder="${M('Search: crate, tree, truck…', 'Tìm: thùng, cây, xe tải…', '검색')}" style="min-width:200px"><select data-kit><option value="">${M('All kits', 'Mọi bộ kit', '모든 키트')}</option></select><button data-x class="ghost" style="border-radius:9px;padding:6px 10px;cursor:pointer">✕</button></header>
      <div class="chips">${TYPES.map(([k, en, vi]) => `<button data-t="${k}"${k === '' ? ' class="on"' : ''}>${M(en, vi, en)}</button>`).join('')}</div>
      <div class="grid"><div style="grid-column:1/-1;color:#93a39a">${M('Loading the catalogue…', 'Đang tải danh mục…', '불러오는 중…')}</div></div>
      <footer><span data-n></span><span class="sp"></span><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-place checked> ${M('place them on the map', 'đặt luôn lên map', '맵에 배치')}</label><button class="ghost" data-clear>${M('Clear', 'Bỏ chọn', '선택 해제')}</button><button class="buy" data-buy>＋ ${M('Add to the map', 'Thêm vào map', '맵에 추가')}</button></footer>`
    const $ = (s: string): HTMLElement => box!.querySelector(s)!
    $('[data-x]').onclick = () => { box!.style.display = 'none' }
    try { cat = await (await fetch('polyfork/catalog.json')).json() } catch { $('.grid').innerHTML = `<div style="grid-column:1/-1">⚠ ${M('The catalogue is not in this build (full tool only).', 'Bản này chưa có danh mục (chỉ có trong bản đầy đủ).', '카탈로그 없음')}</div>`; return }
    const ks = $('[data-kit]') as HTMLSelectElement
    ks.innerHTML += Object.entries(cat!.kits).sort((a, b) => a[1].localeCompare(b[1])).map(([id, t]) => `<option value="${id}">${t}</option>`).join('')
    ks.onchange = () => { kit = ks.value; shown = 60; draw() }
    ;($('[data-q]') as HTMLInputElement).oninput = (e) => { q = (e.target as HTMLInputElement).value.toLowerCase(); shown = 60; draw() }
    box.querySelectorAll<HTMLButtonElement>('[data-t]').forEach(b => { b.onclick = () => { type = b.dataset.t!; box!.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); shown = 60; draw() } })
    $('[data-clear]').onclick = () => { picked.clear(); draw() }
    $('[data-buy]').onclick = () => { void buy(($('[data-place]') as HTMLInputElement).checked) }
    $('.grid').addEventListener('scroll', (e) => { const g = e.target as HTMLElement; if (g.scrollTop + g.clientHeight > g.scrollHeight - 300) { shown += 60; draw() } })
    draw()
  }
  const list = (): Cat['a'] => cat === null ? [] : cat.a.filter(([, t, ty, k]) => (type === '' || ty === type) && (kit === '' || k === kit) && (q === '' || t.toLowerCase().includes(q)))
  const draw = (): void => {
    if (box === null || cat === null) return
    const L = list(); const g = box.querySelector('.grid') as HTMLElement
    g.innerHTML = L.slice(0, shown).map(([id, t, ty, , tri]) => `<div class="card${picked.has(id) ? ' on' : ''}" data-id="${id}"><span class="tick">✓</span><img loading="lazy" src="${thumb(id)}" alt=""><div><b>${t}</b><br><small>${ty} · ${tri} △</small></div></div>`).join('') || `<div style="grid-column:1/-1;color:#93a39a">${M('Nothing found.', 'Không tìm thấy.', '없음')}</div>`
    g.querySelectorAll<HTMLElement>('.card').forEach(c => { c.onclick = () => { const id = c.dataset.id!; if (picked.has(id)) picked.delete(id); else picked.add(id); c.classList.toggle('on', picked.has(id)); count() } })
    count()
  }
  const count = (): void => { const n = box?.querySelector('[data-n]'); if (n) n.textContent = `${list().length} ${M('models', 'model', '모델')} · ${M('picked', 'đã chọn', '선택')} ${picked.size}` }
  const buy = async (place: boolean): Promise<void> => {
    const ids = [...picked]; if (ids.length === 0) { host.status(M('Pick models first (click the cards).', 'Chọn model trước (bấm vào thẻ).', '먼저 고르세요'), true); return }
    let i = 0
    for (const id of ids) {
      host.status(M(`Downloading ${id}… (${i + 1}/${ids.length})`, `Đang tải ${id}… (${i + 1}/${ids.length})`, `다운로드 ${i + 1}/${ids.length}`))
      try {
        const buf = await (await fetch(`https://polyfork.dev/cdn/${id}.glb`)).arrayBuffer()
        const kind = await host.add_file(id + '.glb', buf); if (place) host.place(kind, i, ids.length)
      } catch (e) { host.status(M(`Could not download ${id} (offline?)`, `Không tải được ${id} (mất mạng?)`, '다운로드 실패'), true) }
      i++
    }
    picked.clear(); draw(); if (box !== null) box.style.display = 'none'
    host.status(M(`🛒 ${ids.length} model(s) added to the object palette${place ? ' and placed on the map' : ''}.`, `🛒 Đã thêm ${ids.length} model vào bảng vật thể${place ? ' và đặt lên map' : ''}.`, `🛒 ${ids.length}개 추가`))
  }
  button.onclick = () => { void open() }
}
