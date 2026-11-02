/*
 * Shapes of the 2D plan (beyond rectangle / ellipse) and the pictures of pads.
 * Every outline lives in the unit square (-0.5 … 0.5 on both axes; v = plan Z, down on screen), so it is
 * stretched by the shape's width / depth like the rectangle is. The 3D map extrudes the same outline.
 *
 * Pads ($ unlock / upgrade pad, item stack) are drawn as a picture instead of a dashed box: the built-in one
 * (coin, crates) or a picture you give them.
 */
export type PlanForm = 'rect' | 'ellipse' | 'rounded' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'cross' | 'arrow'

/** [form, toolbar icon, English, Vietnamese] */
export const FORMS: Array<[PlanForm, string, string, string]> = [
  ['rect', '▭', 'Rectangle', 'Chữ nhật'], ['ellipse', '◯', 'Circle / ellipse', 'Tròn / elip'], ['rounded', '▢', 'Rounded rectangle', 'Chữ nhật bo góc'],
  ['triangle', '△', 'Triangle', 'Tam giác'], ['diamond', '◇', 'Diamond', 'Hình thoi'], ['pentagon', '⬠', 'Pentagon', 'Ngũ giác'],
  ['hexagon', '⬡', 'Hexagon', 'Lục giác'], ['octagon', '⯃', 'Octagon', 'Bát giác'], ['star', '★', 'Star', 'Ngôi sao'],
  ['cross', '✚', 'Cross / plus', 'Chữ thập'], ['arrow', '➜', 'Arrow', 'Mũi tên']
]

/** quick fill colours for shapes */
export const SWATCHES = ['#e5e7eb', '#9ca3af', '#374151', '#ef4444', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e', '#14b8a6', '#22d3ee', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#a16207', '#ffffff', '#111827']

const cache = new Map<string, Array<[number, number]> | null>()

/** the outline in the unit square, or null for the plain rectangle / ellipse */
export function form_outline (f: string): Array<[number, number]> | null {
  if (cache.has(f)) return cache.get(f)!
  let p: Array<[number, number]> | null = null
  const ngon = (n: number, off: number): Array<[number, number]> => Array.from({ length: n }, (_, k) => [Math.sin(off + k * 2 * Math.PI / n) * 0.5, -Math.cos(off + k * 2 * Math.PI / n) * 0.5] as [number, number])
  switch (f) {
    case 'triangle': p = ngon(3, 0); break
    case 'diamond': p = ngon(4, 0); break
    case 'pentagon': p = ngon(5, 0); break
    case 'hexagon': p = ngon(6, Math.PI / 6); break
    case 'octagon': p = ngon(8, Math.PI / 8); break
    case 'star': p = Array.from({ length: 10 }, (_, k) => { const r = k % 2 === 0 ? 0.5 : 0.21; const a = k * Math.PI / 5; return [Math.sin(a) * r, -Math.cos(a) * r] as [number, number] }); break
    case 'cross': { const t = 0.17; p = [[-t, -0.5], [t, -0.5], [t, -t], [0.5, -t], [0.5, t], [t, t], [t, 0.5], [-t, 0.5], [-t, t], [-0.5, t], [-0.5, -t], [-t, -t]]; break }
    case 'arrow': p = [[-0.5, -0.17], [0.1, -0.17], [0.1, -0.42], [0.5, 0], [0.1, 0.42], [0.1, 0.17], [-0.5, 0.17]]; break
    case 'rounded': {
      const r = 0.16; p = []
      for (const [cx, cy, a0] of [[0.5 - r, -0.5 + r, -Math.PI / 2], [0.5 - r, 0.5 - r, 0], [-0.5 + r, 0.5 - r, Math.PI / 2], [-0.5 + r, -0.5 + r, Math.PI]] as Array<[number, number, number]>) {
        for (let i = 0; i <= 6; i++) { const a = a0 + i / 6 * Math.PI / 2; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]) }
      }
      break
    }
  }
  if (p !== null && f !== 'rounded' && f !== 'cross' && f !== 'arrow') {
    // stretch to fill the square, like the rectangle the user dragged
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity
    for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    p = p.map(([x, y]) => [(x - (x0 + x1) / 2) / (x1 - x0), (y - (y0 + y1) / 2) / (y1 - y0)])
  }
  cache.set(f, p)
  return p
}

/** point (u, v in the unit square) inside the outline */
export function in_outline (pts: Array<[number, number]>, u: number, v: number): boolean {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j]
    if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) c = !c
  }
  return c
}

/** the shape's path at the origin (canvas units, w × h) */
export function trace_form (g: CanvasRenderingContext2D, form: string, w: number, h: number): void {
  g.beginPath()
  const o = form_outline(form)
  if (form === 'ellipse') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (o === null) g.rect(-w / 2, -h / 2, w, h)
  else { o.forEach(([u, v], i) => { if (i === 0) g.moveTo(u * w, v * h); else g.lineTo(u * w, v * h) }); g.closePath() }
}

const images = new Map<string, HTMLImageElement>()
/** a picture given by the user (data URL), loaded once; null while it loads */
export function user_image (src: string, onload?: () => void): HTMLImageElement | null {
  let im = images.get(src)
  if (im === undefined) { im = new Image(); im.onload = () => onload?.(); im.src = src; images.set(src, im) }
  return im.complete && im.naturalWidth > 0 ? im : null
}

/** the built-in pad picture: a coin with $ (unlock / upgrade pad) or crates (stack) on a tinted tile */
export function pad_picture (kind: string, color: string, price?: number): HTMLCanvasElement {
  const S = 256; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!
  const rr = (x: number, y: number, w: number, h: number, r: number): void => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
  rr(8, 8, S - 16, S - 16, 34); g.fillStyle = color; g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1
  g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke()
  if (kind === 'unlock') {
    g.beginPath(); g.arc(S / 2, S * 0.44, S * 0.24, 0, Math.PI * 2); g.fillStyle = '#facc15'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#a16207'; g.stroke()
    g.fillStyle = '#854d0e'; g.font = `900 ${S * 0.3}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', S / 2, S * 0.45)
    if (price !== undefined) { g.fillStyle = '#fff'; g.font = `800 ${S * 0.13}px system-ui,sans-serif`; g.fillText(String(price), S / 2, S * 0.83) }
  } else {
    // three crates
    const box = (x: number, y: number, s: number): void => { g.fillStyle = '#c08a4a'; g.fillRect(x, y, s, s); g.strokeStyle = '#7c4a1c'; g.lineWidth = 6; g.strokeRect(x, y, s, s); g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s); g.moveTo(x + s, y); g.lineTo(x, y + s); g.stroke() }
    box(S * 0.2, S * 0.5, S * 0.28); box(S * 0.52, S * 0.5, S * 0.28); box(S * 0.36, S * 0.22, S * 0.28)
  }
  return c
}
