// The exported Bulldozer playable, played (9:16): dig copper → sell at the skip → pay the $ pad (the bulldozer evolves
// into the drill) → dig amethyst and diamond.
//   node dev/axhero/rec.mjs dev/axhero/scenes/bd_play.mjs dev/axhero/videos/bd_play.mp4 540 960
export default async ({ nav, ev, wait, start, down, up }) => {
  await nav('_tmp_shot/bd/playable.html'); await wait(5000)
  const pos = async () => await ev('const p = window.__gbPlayable.player(); return [p.position.x, p.position.z]')
  const held = new Set()
  const set = async (want) => { for (const k of [...held]) if (!want.includes(k)) { await up(k); held.delete(k) } for (const k of want) if (!held.has(k)) { await down(k); held.add(k) } }
  // drive to (x, z) with the arrow keys (camera looks along -z: W = -z, S = +z, A = -x, D = +x)
  const go = async (x, z, ms = 9000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const [px, pz] = await pos(); const dx = x - px; const dz = z - pz
      if (Math.hypot(dx, dz) < 0.45) break
      const k = []; if (dz < -0.25) k.push('KeyW'); if (dz > 0.25) k.push('KeyS'); if (dx < -0.25) k.push('KeyA'); if (dx > 0.25) k.push('KeyD')
      await set(k); await wait(70)
    }
    await set([])
  }
  const push = async (key, ms) => { await set([key]); await wait(ms); await set([]) }
  await start(); await wait(600)
  // 1 · into the copper face, column by column
  await go(-1.1, 1.6); await push('KeyW', 4200)
  await go(-1.1, 2.2, 3000); await go(1.1, 1.6); await push('KeyW', 3500)
  // 2 · sell at the skip
  await go(1.1, 3); await go(-5, 8.6); await wait(3200)
  // 3 · the $ pad: the drill evolves
  await go(5, 6.5); await wait(3800)
  // 4 · back into the tunnel: amethyst, then diamond
  await go(1.1, 3); await go(-1.1, 0.5); await push('KeyW', 5200)
  await go(-1.1, 1.5, 3000); await go(1.1, 0.5); await push('KeyW', 4500)
  await wait(800)
}
