/*
 * 2D layout picture -> 3D map. Draw (or generate) a top-down plan where colours mean things, drop it in:
 *
 *   1. every pixel is matched to the nearest legend colour (a colour far from all of them = background);
 *   2. ground: each terrain grid point takes the class under it -> ground type; mountains rise with the
 *      distance from their edge (a distance transform), water sinks below the water level the same way;
 *   3. things: connected blobs of an object colour are measured — area, centre, main direction (principal
 *      axes of the blob's pixels), length / width — and become objects at that place, turned along the
 *      blob and sized from its area: a red rectangle = a house of that size and direction, a long dark
 *      line = a run of wall segments that follows the line (cut into 4 m pieces, each turned along its
 *      own part of the line), a dark-green patch = a forest filled with trees, a dot = one tree / rock…
 */
export type LayoutKind = 'background' | 'grass' | 'water' | 'sand' | 'road' | 'dirt' | 'mountain' | 'snow' | 'forest' | 'tree' | 'house' | 'tower' | 'wall' | 'fence' | 'rock' | 'flag'
export interface LegendItem { color: string, kind: LayoutKind }
export interface LayoutObject { kind: string, x: number, z: number, r: number, s: number }
export interface LayoutResult { heights: Float32Array, types: Uint8Array, objects: LayoutObject[], note: string, counts: Record<string, number> }

export const DEFAULT_LEGEND: LegendItem[] = [
  { color: '#ffffff', kind: 'background' },
  { color: '#22c55e', kind: 'grass' },
  { color: '#3b82f6', kind: 'water' },
  { color: '#eab308', kind: 'sand' },
  { color: '#9ca3af', kind: 'road' },
  { color: '#92400e', kind: 'mountain' },
  { color: '#166534', kind: 'forest' },
  { color: '#ef4444', kind: 'house' },
  { color: '#a855f7', kind: 'tower' },
  { color: '#111827', kind: 'wall' },
  { color: '#f472b6', kind: 'flag' }
]
export const KIND_LABEL: Record<LayoutKind, [string, string]> = {
  background: ['Background (grass)', 'Nền (cỏ)'], grass: ['Grass', 'Cỏ'], water: ['Water / lake / river', 'Nước / hồ / sông'], sand: ['Sand / beach', 'Cát / bãi biển'],
  road: ['Road', 'Đường'], dirt: ['Dirt', 'Đất'], mountain: ['Mountain / hill', 'Núi / đồi'], snow: ['Snow peak', 'Đỉnh tuyết'], forest: ['Forest (fills with trees)', 'Rừng (tự trồng cây)'],
  tree: ['One tree per dot', 'Mỗi chấm 1 cây'], house: ['House (size + direction from the shape)', 'Nhà (cỡ + hướng theo hình)'], tower: ['Tower', 'Tháp'], wall: ['Wall (follows the line)', 'Tường (chạy theo nét)'],
  fence: ['Fence (follows the line)', 'Hàng rào (theo nét)'], rock: ['Rock', 'Đá'], flag: ['Flag / spawn', 'Cờ / điểm xuất phát']
}
// ground type index in MapEditor.GROUND: grass, dirt, sand, rock, snow, road, mud (water bed)
const GROUND_OF: Partial<Record<LayoutKind, number>> = { background: 0, grass: 0, forest: 0, tree: 0, house: 0, tower: 0, wall: 0, fence: 0, rock: 0, flag: 0, dirt: 1, sand: 2, mountain: 3, snow: 4, road: 5, water: 6 }
const OBJECT_KINDS = new Set<LayoutKind>(['forest', 'tree', 'house', 'tower', 'wall', 'fence', 'rock', 'flag'])

function hex (c: string): [number, number, number] { const n = parseInt(c.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
/** perceptual-ish colour distance (red-mean weighted RGB) */
function cdist (a: [number, number, number], r: number, g: number, b: number): number {
  const rm = (a[0] + r) / 2; const dr = a[0] - r; const dg = a[1] - g; const db = a[2] - b
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

/** class index per pixel (-1 = nothing close) */
export function classify (data: Uint8ClampedArray, legend: LegendItem[], tol: number): Int16Array {
  const cols = legend.map(l => hex(l.color)); const n = data.length / 4; const out = new Int16Array(n)
  for (let p = 0; p < n; p++) {
    const r = data[p * 4]; const g = data[p * 4 + 1]; const b = data[p * 4 + 2]; const a = data[p * 4 + 3]
    if (a < 40) { out[p] = -1; continue }
    let best = -1; let bd = Infinity
    for (let k = 0; k < cols.length; k++) { const d = cdist(cols[k], r, g, b); if (d < bd) { bd = d; best = k } }
    out[p] = bd <= tol ? best : -1
  }
  return out
}

/** majority filter: removes anti-aliasing fringes and JPEG speckles */
export function majority (cls: Int16Array, w: number, h: number): Int16Array {
  const out = new Int16Array(cls.length); const cnt = new Map<number, number>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cnt.clear()
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i; const yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const c = cls[yy * w + xx]; cnt.set(c, (cnt.get(c) ?? 0) + 1) }
      let best = cls[y * w + x]; let bc = 0; cnt.forEach((v, k) => { if (v > bc) { bc = v; best = k } })
      out[y * w + x] = bc >= 5 ? best : cls[y * w + x]
    }
  }
  return out
}

/** distance (in pixels, 8-neighbour chamfer) from the edge of the mask */
function edge_distance (mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9; const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] !== 0 ? INF : 0
  const D = 1.4142
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (d[i] === 0) continue; let m = d[i]; if (x > 0) m = Math.min(m, d[i - 1] + 1); if (y > 0) m = Math.min(m, d[i - w] + 1); if (x > 0 && y > 0) m = Math.min(m, d[i - w - 1] + D); if (x < w - 1 && y > 0) m = Math.min(m, d[i - w + 1] + D); if (x === 0 || y === 0 || x === w - 1 || y === h - 1) m = Math.min(m, 1); d[i] = m }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (d[i] === 0) continue; let m = d[i]; if (x < w - 1) m = Math.min(m, d[i + 1] + 1); if (y < h - 1) m = Math.min(m, d[i + w] + 1); if (x < w - 1 && y < h - 1) m = Math.min(m, d[i + w + 1] + D); if (x > 0 && y < h - 1) m = Math.min(m, d[i + w - 1] + D); d[i] = m }
  return d
}

export interface Blob { px: number[], cx: number, cy: number, area: number, angle: number, major: number, minor: number }
/** connected pixels of one class, measured: centre, area, principal direction and extents */
export function blobs (cls: Int16Array, w: number, h: number, k: number, min_area: number): Blob[] {
  const seen = new Uint8Array(w * h); const out: Blob[] = []
  for (let s = 0; s < w * h; s++) {
    if (seen[s] !== 0 || cls[s] !== k) continue
    const px: number[] = [s]; seen[s] = 1
    for (let q = 0; q < px.length; q++) {
      const p = px[q]; const x = p % w; const y = (p - x) / w
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx; const yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const o = yy * w + xx; if (seen[o] === 0 && cls[o] === k) { seen[o] = 1; px.push(o) } }
    }
    if (px.length < min_area) continue
    out.push(measure(px, w))
  }
  return out
}
export function measure (px: number[], w: number): Blob {
  let cx = 0; let cy = 0; for (const p of px) { cx += p % w; cy += Math.floor(p / w) } cx /= px.length; cy /= px.length
  let sxx = 0; let syy = 0; let sxy = 0
  for (const p of px) { const dx = p % w - cx; const dy = Math.floor(p / w) - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy }
  sxx /= px.length; syy /= px.length; sxy /= px.length
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy) // direction of the long side, in image space
  const tr = (sxx + syy) / 2; const det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy))
  // a uniform rectangle of length L has variance L²/12 along it
  const major = Math.sqrt(12 * (tr + det)); const minor = Math.sqrt(12 * Math.max(0, tr - det))
  return { px, cx, cy, area: px.length, angle, major, minor }
}

/**
 * @param img the layout picture
 * @param n terrain grid cells per side (MapEditor.n), cell = metres per cell, water = water level
 */
export function layout_to_map (img: CanvasImageSource & { width: number, height: number }, legend: LegendItem[], n: number, cell: number, water: number, o: { tol?: number, mountain?: number } = {}): LayoutResult {
  const tol = o.tol ?? 140; const peak = o.mountain ?? 9
  // working picture: square, up to 256 px (the map is square; a wide picture is fitted inside)
  const S = 256; const c = document.createElement('canvas'); c.width = S; c.height = S
  const g = c.getContext('2d', { willReadFrequently: true })!
  const bg = legend.find(l => l.kind === 'background')?.color ?? '#ffffff'
  g.fillStyle = bg; g.fillRect(0, 0, S, S)
  const k = Math.min(S / img.width, S / img.height); const dw = img.width * k; const dh = img.height * k
  g.imageSmoothingEnabled = true; g.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh)
  let cls = classify(g.getImageData(0, 0, S, S).data, legend, tol)
  cls = majority(cls, S, S)
  const kind_of = (ci: number): LayoutKind => ci < 0 ? 'background' : legend[ci].kind
  const mpp = n * cell / S // metres per pixel
  const half = n * cell / 2
  const X = (px: number): number => px * mpp - half // image x -> world x
  const Z = (py: number): number => py * mpp - half // image y (down) -> world z (towards the viewer)
  // ---- ground ----
  const N1 = n + 1; const heights = new Float32Array(N1 * N1); const types = new Uint8Array(N1 * N1)
  const mask = (want: LayoutKind[]): Uint8Array => { const m = new Uint8Array(S * S); for (let i = 0; i < S * S; i++) if (want.includes(kind_of(cls[i]))) m[i] = 1; return m }
  const dm = edge_distance(mask(['mountain', 'snow']), S, S); const dw2 = edge_distance(mask(['water']), S, S)
  let dmax = 1; for (let i = 0; i < S * S; i++) if (dm[i] < 1e8) dmax = Math.max(dmax, dm[i])
  const at = (i: number, j: number): number => { const px = Math.min(S - 1, Math.round(i / n * (S - 1))); const py = Math.min(S - 1, Math.round(j / n * (S - 1))); return py * S + px }
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const p = at(i, j); const kd = kind_of(cls[p]); const q = j * N1 + i
      let h = 0
      if (kd === 'mountain' || kd === 'snow') h = peak * Math.sqrt(Math.min(1, dm[p] / Math.max(6, dmax * 0.8))) + (kd === 'snow' ? peak * 0.25 : 0)
      else if (kd === 'water') h = water - 0.5 - Math.min(2.5, dw2[p] * mpp * 0.25)
      else if (kd === 'road') h = -0.02
      heights[q] = h
      types[q] = GROUND_OF[kd] ?? 0
      if (kd === 'mountain' && h > peak * 0.85) types[q] = 4 // snow caps
    }
  }
  // soften the slopes a little (not the water edges: rivers keep their banks)
  for (let pass = 0; pass < 2; pass++) {
    const old = Float32Array.from(heights)
    for (let j = 1; j < n; j++) for (let i = 1; i < n; i++) { const q = j * N1 + i; if (types[q] === 6) continue; heights[q] = (old[q] * 4 + old[q - 1] + old[q + 1] + old[q - N1] + old[q + N1]) / 8 }
  }
  // ---- objects ----
  const objects: LayoutObject[] = []; const counts: Record<string, number> = {}
  const put = (kind: string, x: number, z: number, r: number, s: number): void => { objects.push({ kind, x, z, r, s }); counts[kind] = (counts[kind] ?? 0) + 1 }
  // image angle (y down) -> rotation about +Y in the world (x right, z towards the viewer = image down)
  const yaw = (a: number): number => -a
  let seed = 7; const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  legend.forEach((l, li) => {
    if (!OBJECT_KINDS.has(l.kind)) return
    const min_area = l.kind === 'tree' || l.kind === 'rock' || l.kind === 'flag' ? 3 : 6
    for (const b of blobs(cls, S, S, li, min_area)) {
      const L = b.major * mpp; const Wd = Math.max(mpp, b.minor * mpp); const A = b.area * mpp * mpp
      if (l.kind === 'house') {
        // a long thin red shape is a row of houses
        if (L > Wd * 3.2 && L > 10) { const nh = Math.max(2, Math.round(L / 6)); for (let q = 0; q < nh; q++) { const f = (q + 0.5) / nh - 0.5; put('house', X(b.cx + Math.cos(b.angle) * f * b.major), Z(b.cy + Math.sin(b.angle) * f * b.major), yaw(b.angle), Math.max(0.6, Math.min(2.5, Wd / 3.4))) } }
        else put('house', X(b.cx), Z(b.cy), yaw(b.angle), Math.max(0.5, Math.min(4, Math.sqrt(A / (4 * 3.4)))))
      } else if (l.kind === 'tower') put('tower', X(b.cx), Z(b.cy), 0, Math.max(0.5, Math.min(3, Math.sqrt(A) / 3.4)))
      else if (l.kind === 'flag') put('flag', X(b.cx), Z(b.cy), 0, 1)
      else if (l.kind === 'rock') put('rock', X(b.cx), Z(b.cy), rnd() * 6.28, Math.max(0.5, Math.min(4, Math.sqrt(A) / 1.8)))
      else if (l.kind === 'tree') put(rnd() < 0.5 ? 'tree' : 'pine', X(b.cx), Z(b.cy), rnd() * 6.28, Math.max(0.6, Math.min(2.5, Math.sqrt(A) / 2.5)))
      else if (l.kind === 'forest') {
        // fill the patch: one tree every ~3.2 m, jittered
        const step = Math.max(1, Math.round(3.2 / mpp)); const inside = new Set(b.px)
        let minx = S; let miny = S; let maxx = 0; let maxy = 0; for (const p of b.px) { const x = p % S; const y = (p - x) / S; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y) }
        for (let y = miny; y <= maxy; y += step) for (let x = minx; x <= maxx; x += step) {
          const jx = Math.round(x + (rnd() - 0.5) * step * 0.8); const jy = Math.round(y + (rnd() - 0.5) * step * 0.8)
          if (!inside.has(jy * S + jx)) continue
          put(rnd() < 0.55 ? 'pine' : 'tree', X(jx), Z(jy), rnd() * 6.28, 0.75 + rnd() * 0.5)
        }
        if (b.area < step * step) put('tree', X(b.cx), Z(b.cy), rnd() * 6.28, 1)
      } else if (l.kind === 'wall' || l.kind === 'fence') {
        // walk the line in 4 m tiles: each tile with enough line pixels gets one segment, turned along the
        // pixels inside it (so an L or a curve is followed piece by piece)
        const seg = l.kind === 'wall' ? 4 : 3.4; const tile = Math.max(2, Math.round(seg / mpp)); const cells = new Map<string, number[]>()
        for (const p of b.px) { const x = p % S; const y = (p - x) / S; const key = `${Math.floor(x / tile)},${Math.floor(y / tile)}`; (cells.get(key) ?? cells.set(key, []).get(key)!).push(p) }
        cells.forEach(px => {
          if (px.length < Math.max(2, tile * 0.5)) return
          const m = measure(px, S)
          const len = Math.max(m.major * mpp, seg * 0.5)
          put(l.kind, X(m.cx), Z(m.cy), yaw(m.angle), Math.max(0.4, Math.min(1.6, len / seg)))
        })
      }
    }
  })
  const note = Object.entries(counts).map(([kk, v]) => `${v} ${kk}`).join(', ') || 'no objects'
  return { heights, types, objects, note, counts }
}

/** colours that cover the most pixels of a picture (to fill the legend from a picture you drew) */
export function main_colours (img: CanvasImageSource & { width: number, height: number }, count = 10): string[] {
  const S = 96; const c = document.createElement('canvas'); c.width = S; c.height = S
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, S, S)
  const d = g.getImageData(0, 0, S, S).data; const bins = new Map<number, [number, number, number, number]>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue
    const key = (d[i] >> 5) << 6 | (d[i + 1] >> 5) << 3 | (d[i + 2] >> 5)
    const b = bins.get(key) ?? [0, 0, 0, 0]; b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; bins.set(key, b)
  }
  return [...bins.values()].sort((a, b) => b[3] - a[3]).slice(0, count).map(b => '#' + [b[0], b[1], b[2]].map(v => Math.round(v / b[3]).toString(16).padStart(2, '0')).join(''))
}
