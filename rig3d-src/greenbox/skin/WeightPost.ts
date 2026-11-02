import * as THREE from 'three'

/**
 * After the automatic weights (Mesh2Motion's solver), before the fingers are re-skinned:
 *   smooth   a few rounds of neighbour averaging over the welded surface (seams of a UV-split mesh count as
 *            one point), keeping the 4 strongest bones per point. Removes the hard "stair steps" between two bones
 *            at elbows, knees, shoulders without moving where the bones meet.
 *   manual   weights you painted by hand, kept by bone name when the skin is computed again (after moving bones),
 *            so going back to fix a joint does not throw your painting away.
 */
export const WEIGHT_POST = {
  smooth: 2, // rounds (0 = off)
  strength: 0.5, // how much of the neighbours' average each round takes
  /** per mesh (in skinning order): vertex -> [bone name, weight][] painted by hand */
  manual: null as Array<Map<number, Array<[string, number]>>> | null
}

export function smooth_weights (geo: THREE.BufferGeometry, rounds = WEIGHT_POST.smooth, a = WEIGHT_POST.strength): void {
  const si = geo.getAttribute('skinIndex'); const sw = geo.getAttribute('skinWeight'); const pos = geo.getAttribute('position')
  if (si === undefined || sw === undefined || pos === undefined || rounds <= 0) return
  const n = pos.count
  // weld by position
  geo.computeBoundingBox(); const size = geo.boundingBox!.getSize(new THREE.Vector3()).length() || 1; const q = size * 1e-5
  const key = new Map<string, number>(); const rep = new Int32Array(n)
  for (let v = 0; v < n; v++) { const k = `${Math.round(pos.getX(v) / q)},${Math.round(pos.getY(v) / q)},${Math.round(pos.getZ(v) / q)}`; let r = key.get(k); if (r === undefined) { r = v; key.set(k, v) } rep[v] = r }
  const nb = new Map<number, Set<number>>()
  const link = (x: number, y: number): void => { if (x === y) return; (nb.get(x) ?? nb.set(x, new Set()).get(x)!).add(y); (nb.get(y) ?? nb.set(y, new Set()).get(y)!).add(x) }
  const idx = geo.getIndex(); const tc = idx !== null ? idx.count : n
  for (let t = 0; t + 2 < tc; t += 3) { const A = rep[idx !== null ? idx.getX(t) : t]; const B = rep[idx !== null ? idx.getX(t + 1) : t + 1]; const C = rep[idx !== null ? idx.getX(t + 2) : t + 2]; link(A, B); link(B, C); link(A, C) }
  // sparse weights per welded point
  let W = new Map<number, Map<number, number>>()
  for (let v = 0; v < n; v++) { if (rep[v] !== v) continue; const m = new Map<number, number>(); for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > 0) m.set(si.getComponent(v, k), (m.get(si.getComponent(v, k)) ?? 0) + w) } W.set(v, m) }
  for (let r = 0; r < rounds; r++) {
    const out = new Map<number, Map<number, number>>()
    W.forEach((m, v) => {
      const ns = nb.get(v); if (ns === undefined || ns.size === 0) { out.set(v, m); return }
      const avg = new Map<number, number>(); ns.forEach(o => W.get(o)?.forEach((w, b) => avg.set(b, (avg.get(b) ?? 0) + w / ns.size)))
      const res = new Map<number, number>(); m.forEach((w, b) => res.set(b, w * (1 - a))); avg.forEach((w, b) => res.set(b, (res.get(b) ?? 0) + w * a))
      out.set(v, res)
    })
    W = out
  }
  // back to 4 slots, normalised, on every copy of the point
  for (let v = 0; v < n; v++) {
    const m = W.get(rep[v]); if (m === undefined) continue
    const top = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).filter(e => e[1] > 1e-3); const s = top.reduce((x, e) => x + e[1], 0) || 1
    for (let k = 0; k < 4; k++) { si.setComponent(v, k, top[k]?.[0] ?? 0); sw.setComponent(v, k, (top[k]?.[1] ?? 0) / s) }
  }
  si.needsUpdate = true; sw.needsUpdate = true
}

/** put hand-painted weights back (by bone name) on mesh number `mi` */
export function apply_manual (geo: THREE.BufferGeometry, bones: THREE.Bone[], mi: number): number {
  const m = WEIGHT_POST.manual?.[mi]; if (m === undefined || m === null) return 0
  const si = geo.getAttribute('skinIndex'); const sw = geo.getAttribute('skinWeight'); if (si === undefined || sw === undefined) return 0
  const by = new Map(bones.map((b, i) => [b.name, i])); let n = 0
  m.forEach((list, v) => {
    if (v >= si.count) return
    const ok = list.filter(([b]) => by.has(b)); if (ok.length === 0) return
    const s = ok.reduce((x, e) => x + e[1], 0) || 1
    for (let k = 0; k < 4; k++) { si.setComponent(v, k, ok[k] !== undefined ? by.get(ok[k][0])! : 0); sw.setComponent(v, k, ok[k] !== undefined ? ok[k][1] / s : 0) }
    n++
  })
  si.needsUpdate = true; sw.needsUpdate = true
  return n
}
