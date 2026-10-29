/*
 * Four camera buttons over a 3D view: front, side, top and a 3/4 view, like Blender's numpad views.
 * Works with any camera + OrbitControls-like object ({ target, update() }).
 */
import * as THREE from 'three'

export type ViewName = 'front' | 'side' | 'top' | 'persp'

export interface ViewHost {
  camera: () => THREE.PerspectiveCamera
  controls: () => { target: THREE.Vector3, update: () => void } | null
}

const DIRS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0.0001),
  persp: new THREE.Vector3(0.75, 0.45, 0.9)
}

export function set_view (host: ViewHost, view: ViewName, opposite = false): void {
  const c = host.controls(); if (c === null) return
  const cam = host.camera()
  const dir = DIRS[view].clone().normalize(); if (opposite) dir.negate()
  const dist = cam.position.distanceTo(c.target)
  cam.position.copy(c.target).add(dir.multiplyScalar(dist))
  cam.up.set(0, 1, 0)
  cam.lookAt(c.target)
  c.update()
}

/** buttons in the top-left corner of `parent` (which must be position:relative/absolute) */
export function mount_view_buttons (parent: HTMLElement, host: ViewHost, pos = 'position:absolute;left:10px;top:10px'): HTMLElement {
  const old = parent.querySelector(':scope > .gb-views'); if (old !== null) return old as HTMLElement
  const box = document.createElement('div')
  box.className = 'gb-views'
  box.style.cssText = pos + ';z-index:6;display:flex;gap:4px;background:rgba(0,0,0,.35);padding:4px;border-radius:8px'
  const views: Array<[ViewName, string, string]> = [['front', 'Front', '1'], ['side', 'Side', '3'], ['top', 'Top', '7'], ['persp', '3D', '0']]
  views.forEach(([v, label, key]) => {
    const b = document.createElement('button')
    b.type = 'button'; b.textContent = label; b.title = `${label} (${key}) · Alt-click: opposite side`
    b.style.cssText = 'font:600 12px system-ui,sans-serif;padding:4px 9px;border-radius:5px;border:1px solid #1f1f1f;background:#4a4a4a;color:#eee;cursor:pointer'
    b.onclick = (e) => set_view(host, v, e.altKey)
    box.appendChild(b)
  })
  parent.appendChild(box)
  return box
}
