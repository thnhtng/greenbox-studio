/*
 * A model that already has a skeleton: no rigging, straight to its animations.
 *   "Use Your Model" -> 🎬 Animate it now: the file is handed to "Use Your Rigged Model" (retarget page), which loads it,
 *   picks the skeleton family (human / four legs / wings / snake), maps the bones and opens the animation list.
 */
import * as THREE from 'three'
import { handoff_put, handoff_take } from '../common/Handoff.ts'
import { load_any_files } from '../common/AnyLoader.ts'
import { M } from '../common/lang.ts'
import { facing_from_bones } from './AutoFace.ts'

export async function send_to_retarget (file: File): Promise<void> {
  await handoff_put('retarget', { name: file.name, data: await file.arrayBuffer(), at: Date.now() })
  const lang = new URLSearchParams(location.search).get('lang') // same language on the next page
  location.href = 'retarget/index.html?auto=1' + (lang !== null ? '&lang=' + lang : '')
}

/** the Mesh2Motion skeleton family that fits these bone names best */
export function guess_family (names: string[]): string {
  const has = (re: RegExp): number => names.filter(n => re.test(n)).length
  const legs = has(/leg|thigh|knee|calf|foot|ankle|hip_/i); const arms = has(/arm|hand|elbow|wrist|shoulder|clavicle/i)
  const tail = has(/tail/i); const wing = has(/wing/i); const head = has(/head|neck/i)
  if (wing > 0 && tail > 0 && legs > 0) return 'dragon'
  if (wing > 0) return 'bird'
  if (legs === 0 && arms === 0 && (tail > 0 || has(/spine|body|seg/i) > 4)) return 'snake'
  if (tail > 0 && legs > 0) return 'fox' // four legs and a tail: crocodile, dog, horse-like
  if (arms > 0 && legs > 0 && head > 0) return 'human'
  return 'human'
}

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
function note (t: string): void {
  let el = document.getElementById('gb-retarget-note')
  if (el === null) { el = document.createElement('div'); el.id = 'gb-retarget-note'; el.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:70;padding:10px 14px;border-radius:12px;background:var(--gbp-panel,#10151dF2);color:var(--gbp-ink,#e8edf3);border:2px solid var(--gbp-accent,#4fed89);font:13px/1.4 system-ui,sans-serif;max-width:92vw;box-shadow:0 10px 30px #000a'; document.body.append(el) }
  el.textContent = t; clearTimeout((el as any).__t); (el as any).__t = setTimeout(() => el?.remove(), 9000)
}

/** on the retarget page: a file handed over from "Use Your Model" is loaded, mapped and opened on its animations */
export async function mount_retarget_auto (): Promise<void> {
  const h = await handoff_take('retarget'); if (h === null) return
  const file = new File([h.data], h.name)
  let family = 'human'
  try { const r = await load_any_files([file]); const n: string[] = []; r.scene.traverse(o => { if ((o as THREE.Bone).isBone === true) n.push(o.name) }); family = guess_family(n) } catch { /* the page reads it */ }
  const sel = document.getElementById('skeleton-type-select') as HTMLSelectElement | null
  if (sel !== null && [...sel.options].some(o => o.value === family)) { sel.value = family; sel.dispatchEvent(new Event('change', { bubbles: true })) }
  note(M(`🦴 ${h.name}: already rigged — loading it, matching its bones to the ${family} animations…`, `🦴 ${h.name}: đã có xương — đang nạp và ghép xương với bộ animation ${family}…`, `🦴 ${h.name}: 이미 리깅됨 — 본 매핑 중…`))
  await wait(600)
  const input = document.getElementById('upload-file') as HTMLInputElement | null; if (input === null) return
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  const count = (): number => Number(document.getElementById('target-bone-count')?.textContent ?? '0')
  for (let i = 0; i < 100 && count() === 0; i++) await wait(200)
  if (count() === 0) { note(M('Could not read the skeleton of this file.', 'Không đọc được bộ xương của file này.', '스켈레톤을 읽을 수 없습니다.')); return }
  face_target()
  await wait(400)
  ;(document.getElementById('auto-map-button') as HTMLButtonElement | null)?.click()
  await wait(900)
  const go = document.getElementById('continue-to-listing-button') as HTMLButtonElement | null
  if (go !== null && !go.disabled) { go.click(); note(M('✅ Ready: pick animations from the list and export — no rigging needed.', '✅ Xong: chọn animation trong danh sách rồi xuất — không cần gắn xương lại.', '✅ 애니메이션을 고르고 내보내세요.')) }
  else note(M('Some bones could not be matched by themselves: drag them on the left onto your bones, then Continue.', 'Vài xương chưa tự ghép được: kéo xương bên trái thả vào xương của bạn, rồi bấm Continue.', '일부 본은 수동 매핑이 필요합니다.'))
}

/** "several root bones": keep the skeleton with most of the bones (a few stray finger bones are the usual reason) */
export function mount_root_autopick (): void {
  new MutationObserver(() => {
    const m = document.querySelector('.root-bone-selection-modal'); if (m === null || (m as any).__gbPicked === true) return
    const opts = [...m.querySelectorAll('button')].map(b => ({ b, n: Number(/\((\d+) bones?\)/.exec(b.textContent ?? '')?.[1] ?? '0') })).filter(o => o.n > 0)
    const total = opts.reduce((s, o) => s + o.n, 0); const best = opts.sort((a, b) => b.n - a.n)[0]
    if (best === undefined || best.n < total * 0.8) return // no clear main skeleton: let the person choose
    ;(m as any).__gbPicked = true; best.b.click()
    note(M(`Kept the main skeleton (${best.n} of ${total} bones); ${opts.length - 1} stray bone group(s) left out.`, `Đã giữ bộ xương chính (${best.n}/${total} xương), bỏ ${opts.length - 1} nhóm xương lạc.`, `주 스켈레톤 유지 (${best.n}/${total})`))
  }).observe(document.body, { childList: true, subtree: true })
}

/** 🧭 the loaded rigged model turned to the blue arrow (+Z), from its left / right bones (once per model) */
export function face_target (): boolean {
  const g = (window as any).__gb3d; const sc: THREE.Scene | undefined = g?.scene; if (sc === undefined) return false
  let root: THREE.Object3D | null = null
  for (const c of sc.children) { let sk = false; c.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh === true) sk = true }); if (sk && !/Mesh2Motion|Setup/i.test(c.name)) { root = c; break } }
  if (root === null || (root as any).__gbFaced === true) return false
  const r = root as THREE.Object3D; (r as any).__gbFaced = true
  const f = facing_from_bones(r); if (f === null || f.z > 0.5) return false
  r.rotateY(-Math.atan2(f.x, f.z)); r.updateMatrixWorld(true)
  note(M('🧭 Turned to face the blue arrow.', '🧭 Đã xoay cho nhìn theo mũi tên xanh.', '🧭 화살표 방향으로 회전'))
  return true
}
/** a model loaded by hand on this page is turned too, as soon as its bones are listed */
export function mount_face_target (): void {
  const c = document.getElementById('target-bone-count'); if (c === null) return
  new MutationObserver(() => { if (Number(c.textContent ?? '0') > 0) face_target() }).observe(c, { childList: true, characterData: true, subtree: true })
}
