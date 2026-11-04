/*
 * 🧍 T-pose: next to "Expand / Contract Arms", one click puts the character in a T-pose — the "Rest Pose" clip plays
 * and the arm amount is searched until the upper arms are level (on the rig page and on Use Your Rigged Model alike).
 * Export the Rest Pose clip afterwards to get a T-pose file.
 */
import * as THREE from 'three'
import { M } from '../common/lang.ts'

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** the left upper arm and the bone after it, in the model on screen */
function arm_bones (): [THREE.Bone, THREE.Bone] | null {
  const sc: THREE.Scene | undefined = (window as any).__gb3d?.scene; if (sc === undefined) return null
  let up: THREE.Bone | null = null
  const re = [/upperarm_l$/i, /leftarm$/i, /left_?upper_?arm$/i, /l_?upper_?arm$/i, /upper_?arm[._]l$/i, /(^|[^a-z])arm[._]l$/i] // Mesh2Motion, Mixamo (mixamorigLeftArm), Rigify / others
  for (const r of re) { if (up !== null) break; sc.traverse(o => { if (up === null && (o as THREE.Bone).isBone === true && r.test(o.name) && o.parent?.name !== 'Source Skeleton Scene (Mesh2Motion)') { let sk = false; let p: THREE.Object3D | null = o; while (p !== null) { if (/Mesh2Motion/.test(p.name)) { sk = true; break } p = p.parent } if (!sk) up = o as THREE.Bone } }) }
  if (up === null) return null
  const low = (up as THREE.Bone).children.find(c => (c as THREE.Bone).isBone === true) as THREE.Bone | undefined
  return low === undefined ? null : [up, low]
}

/** how far the upper arm points above (+) or below (-) level, in radians */
function arm_tilt (b: [THREE.Bone, THREE.Bone]): number {
  b[0].updateWorldMatrix(true, true)
  const a = b[0].getWorldPosition(new THREE.Vector3()); const d = b[1].getWorldPosition(new THREE.Vector3()).sub(a)
  return Math.atan2(d.y, Math.hypot(d.x, d.z))
}

function play_rest_pose (): boolean {
  const L = (window as any).__gb3d?.animations_listing_step
  if (L?.animation_clips !== undefined && document.getElementById('animations-items') === null) {
    const i = (L.animation_clips() as THREE.AnimationClip[]).findIndex(c => /rest ?pose|t-?pose/i.test(c.name)); if (i >= 0) { L.play_animation(i); return true }
  }
  // Use Your Rigged Model: the list's own play buttons
  const item = [...document.querySelectorAll<HTMLElement>('#animations-items *')].find(e => e.children.length === 0 && /^(rest ?pose|t-?pose)$/i.test(e.textContent?.trim() ?? ''))
  let c: HTMLElement | null = item ?? null; for (let k = 0; k < 6 && c !== null && c.querySelector('.play') === null; k++) c = c.parentElement
  const pb = c?.querySelector<HTMLElement>('.play'); if (pb != null) { pb.click(); return true }
  return false
}

export async function to_tpose (): Promise<string> {
  const num = document.getElementById('extend-arm-numeric-input') as HTMLInputElement | null; if (num === null) return M('Open the animation list first.', 'Mở danh sách animation trước.', '애니메이션 목록을 먼저 여세요.')
  if (!play_rest_pose()) return M('No "Rest Pose" clip in this list.', 'Danh sách này không có clip "Rest Pose".', 'Rest Pose 없음')
  await wait(400)
  const b = arm_bones(); if (b === null) return M('Could not find the upper arm bone.', 'Không tìm thấy xương cánh tay trên.', '위팔 본 없음')
  const set = async (v: number): Promise<number> => { num.value = String(Math.round(v)); num.dispatchEvent(new Event('input', { bubbles: true })); await wait(140); return arm_tilt(b) }
  // the arm angle moves one way as the amount goes up: halve the range until it is level
  let lo = -200; let hi = 120; let tlo = await set(lo); const thi = await set(hi)
  if (Math.sign(tlo) === Math.sign(thi)) { const v = Math.abs(tlo) < Math.abs(thi) ? lo : hi; await set(v); return M(`Closest to a T-pose at ${v}%.`, `Gần T-pose nhất ở ${v}%.`, `${v}%`) }
  for (let k = 0; k < 9; k++) { const mid = (lo + hi) / 2; const t = await set(mid); if (Math.sign(t) === Math.sign(tlo)) { lo = mid; tlo = t } else hi = mid }
  const v = Math.round((lo + hi) / 2); await set(v)
  return M(`🧍 T-pose: arms level (${v}%). Export "Rest Pose" to keep it.`, `🧍 T-pose: tay đã ngang (${v}%). Xuất clip "Rest Pose" để lưu tư thế này.`, `🧍 T-포즈 (${v}%)`)
}

/** the 🧍 T-pose button beside the arm reset button (waits for the animation step to draw it) */
export function mount_tpose (): void {
  setInterval(() => {
    const reset = document.getElementById('reset-arm-extension-button'); if (reset === null || document.getElementById('gb-tpose-btn') !== null) return
    const b = document.createElement('button'); b.id = 'gb-tpose-btn'; b.type = 'button'; b.className = 'secondary-button'
    b.textContent = '🧍 T-pose'; b.title = M('Put the character in a T-pose (arms level)', 'Đổi nhân vật sang T-pose (tay dang ngang)', 'T-포즈')
    const note = document.createElement('div'); note.id = 'gb-tpose-note'; note.style.cssText = 'font-size:12px;opacity:.8;margin-top:4px'
    b.onclick = async () => { b.disabled = true; note.textContent = '…'; note.textContent = await to_tpose(); b.disabled = false }
    reset.after(b); (reset.closest('div')?.parentElement ?? reset.parentElement)?.append(note)
  }, 700)
}
