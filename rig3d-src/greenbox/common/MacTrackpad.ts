/*
 * Mac trackpad gestures for every 3D view (all OrbitControls of the app):
 *   two-finger swipe        = rotate the view (no right or middle button needed)
 *   Shift + two-finger swipe = pan
 *   pinch                   = zoom (the browser sends it as wheel + ctrlKey; OrbitControls already zooms with it)
 * A real mouse wheel still zooms as before. Imported for its side effect: it patches OrbitControls.connect, so
 * it must be imported before any OrbitControls is made.
 */
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent)

/** a trackpad swipe (fine, two-axis deltas), not the notches of a mouse wheel */
export function is_trackpad (e: WheelEvent): boolean {
  if (e.deltaMode !== 0 || e.ctrlKey) return false
  const w = (e as any).wheelDeltaY as number | undefined
  if (typeof w === 'number' && w !== 0) return w === -3 * e.deltaY || Math.abs(w) % 120 !== 0
  return e.deltaX !== 0 || !Number.isInteger(e.deltaY)
}

/** pinch strength as a zoom factor (> 1 = in) */
export function pinch_factor (e: WheelEvent): number { return Math.exp(-e.deltaY * 0.01) }

const proto = OrbitControls.prototype as any
if (proto.__gb_mac !== true) {
  proto.__gb_mac = true
  const connect = proto.connect
  proto.connect = function (el: HTMLElement): void {
    connect.call(this, el)
    if ((el as any).__gb_trackpad === true) return
    ;(el as any).__gb_trackpad = true
    el.addEventListener('wheel', (e: WheelEvent) => {
      if (this.enabled === false || !is_trackpad(e)) return
      e.preventDefault(); e.stopImmediatePropagation()
      if (e.shiftKey || e.altKey) { if (this.enablePan !== false) this._pan(-e.deltaX, -e.deltaY) } else if (this.enableRotate !== false) {
        const h = Math.max(1, el.clientHeight); const k = 2 * Math.PI / h * (this.rotateSpeed ?? 1) * 0.6
        this._rotateLeft(e.deltaX * k); this._rotateUp(e.deltaY * k)
      }
      this.update()
    }, { capture: true, passive: false })
    show_mac_tip(el)
  }
}

/** once per page: a short note on the trackpad gestures (Mac only) */
function show_mac_tip (el: HTMLElement): void {
  if (!IS_MAC || document.getElementById('gb-mac-tip') !== null) return
  const key = 'gb.mactip.' + location.pathname
  try { if (localStorage.getItem(key) === '1') return; localStorage.setItem(key, '1') } catch { /* private mode */ }
  const vi = (document.documentElement.lang || '').startsWith('vi') || /vi/.test(localStorage.getItem('gbc.lang') ?? '')
  const tip = document.createElement('div'); tip.id = 'gb-mac-tip'
  tip.textContent = vi ? 'Trackpad: vuốt 2 ngón = xoay · Shift + vuốt 2 ngón = dời · chụm 2 ngón = zoom' : 'Trackpad: two-finger swipe = rotate · Shift + swipe = pan · pinch = zoom'
  tip.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:90;padding:8px 14px;border-radius:10px;background:rgba(20,24,32,.88);color:#e8edf3;font:13px system-ui,sans-serif;pointer-events:none;transition:opacity .6s'
  ;(el.ownerDocument ?? document).body.appendChild(tip)
  setTimeout(() => { tip.style.opacity = '0' }, 7000); setTimeout(() => tip.remove(), 7800)
}
