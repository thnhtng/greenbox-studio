// Bulldozer Master playable, built with the Greenbox Play test tools (used by the pane and by the recording):
//   a mine face = a wall of ore blocks dug one at a time, row by row: copper (the first bulldozer digs it), then
//   amethyst and diamond (need the evolved drill). Gems burst out onto the vehicle, a skip sells them, a $ pad evolves
//   the yellow RollerCrusher into the red DrillCrusher. Decoration from Polyfork (polyfork.dev, free low-poly models).
// window.__bdLoad() loads the models, window.__bdMap(step) builds ('ground' | 'mine' | 'decor' | 'plan'; nothing = all).
window.__bdLoad = async function () {
  const P = window.__playtest; const get = async f => await (await fetch('/_tmp_shot/bd/' + f)).arrayBuffer()
  const buf = await get('RollerCrusher_dig.glb'); const dt = new DataTransfer(); dt.items.add(new File([buf], 'RollerCrusher.glb'))
  const inp = document.getElementById('pt-file'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 2500))
  for (const f of ['ore_copper.glb', 'ore_amethyst.glb', 'ore_crystal.glb', 'gem_copper.glb', 'gem_amethyst.glb', 'gem_crystal.glb', 'DrillCrusher_dig.glb']) await P.map.add_custom_file(f, await get(f))
  for (const f of window.__bdPF) await P.map.add_custom_file(f + '.glb', await get('pf/' + f + '.glb'))
  return 1
}
window.__bdPF = ['crystal-cluster-624138', 'floodlight-mast-45d1a3', 'builder-s-skip-191d35', 'material-pallet-6af263', 'crash-barrier-run-b47d1d']
window.__bdShapes = function () {
  const S = (id, kind, x, z, w, d, extra = {}) => ({ id, kind, form: extra.form || 'rect', x, z, w, d, r: 0, label: extra.label || '', color: extra.color || '#9ca3af', height: extra.height ?? 1, ...extra })
  const ROWS = [['copper', 'ore_copper.glb', '#f97316', 5, 4, 0, 'gem_copper.glb'], ['copper', 'ore_copper.glb', '#f97316', 5, 4, 0, 'gem_copper.glb'],
    ['amethyst', 'ore_amethyst.glb', '#a855f7', 15, 5, 1, 'gem_amethyst.glb'], ['amethyst', 'ore_amethyst.glb', '#a855f7', 15, 5, 1, 'gem_amethyst.glb'], ['diamond', 'ore_crystal.glb', '#38bdf8', 25, 6, 1, 'gem_crystal.glb']]
  const C = 2.2; const shapes = []
  ROWS.forEach(([gives, file, color, price, hp, need, item], r) => {
    for (let c = 0; c < 6; c++) shapes.push(S(`ore${r}${c}`, 'ore', (c - 2.5) * C, -1 - r * C, C, C, { model: 'file:' + file, item: 'file:' + item, gives, color, price, hp, need, time: 0.38, respawn: 0, height: 2 }))
  })
  shapes.push(
    S('player', 'player', 0, 9, 1.5, 1.5, { color: '#f97316', height: 0.05 }),
    S('sell', 'counter', -5, 6.5, 3, 2.2, { label: 'Bán ngọc', color: '#22d3ee', height: 1.2, time: 0.18, price: 5, model: 'file:builder-s-skip-191d35.glb' }),
    S('up1', 'unlock', 5, 6.5, 2.6, 2.6, { label: 'Nâng cấp mũi khoan', color: '#bbf7d0', height: 0.05, price: 60 }),
    S('drill', 'block', 5, 6.5, 2.6, 2.6, { model: 'file:DrillCrusher_dig.glb', evolve: true, height: 1 }))
  return { shapes, wires: [{ id: 'w1', from: 'up1', to: 'drill', mode: 'unlock' }] }
}
window.__bdMap = function (step) {
  const P = window.__playtest; const m = P.map
  const paint = (x, z, r, g) => { const keep = [m.tool, m.radius, m.strength, m.ground]; m.tool = 'paint'; m.radius = r; m.ground = g; m.sculpt_at(x, z); [m.tool, m.radius, m.strength, m.ground] = keep }
  if (step === 'ground' || step === undefined) {
    m.clear_all?.(); m.preset('flat'); m.resize(40) // an empty map first (the editor keeps the last one)
    // a dirt quarry floor round the mine, a road to the skip and the pad
    for (let x = -10; x <= 10; x += 3) for (let z = -14; z <= 3; z += 3) paint(x, z, 3, 1)
    for (let x = -8; x <= 8; x += 2) paint(x, 6.5, 2.2, 5)
    for (let z = 3; z <= 10; z += 2) paint(0, z, 2, 5)
  }
  if (step === 'decor' || step === undefined) {
    const add = (k, x, z, r = 0, s = 1) => m.add_object('file:' + k + '.glb', x, z, r, s)
    for (const z of [-2, -6, -10]) { add('crash-barrier-run-b47d1d', -8.6, z, Math.PI / 2, 1); add('crash-barrier-run-b47d1d', 8.6, z, Math.PI / 2, 1) }
    add('floodlight-mast-45d1a3', -9.5, -13, 0.6, 1); add('floodlight-mast-45d1a3', 9.5, -13, -0.6, 1); add('floodlight-mast-45d1a3', -9.5, 2.5, 2.4, 1)
    add('material-pallet-6af263', 9.5, 2, 0.3, 1);
    for (const [x, z, r] of [[-7, -13.8, 0.4], [7.5, -14, 2.1], [0, -14.6, 1.3], [-10.5, -8, 0.9], [10.5, -6, 2.6]]) add('crystal-cluster-624138', x, z, r, 1)
    for (const [x, z] of [[-15, -15], [-16, 0], [-14, 13], [15, -14], [16, 1], [14, 14], [-6, 16], [7, 16]]) m.add_object('pine', x, z, Math.random() * 6, 1.1)
    for (const [x, z] of [[-12, -4], [12, 9], [-12, 12], [12, -10]]) m.add_object('rock', x, z, Math.random() * 6, 1.2)
  }
  if (step === 'plan' || step === undefined) { const plan = window.__bdShapes(); P.plan_ed.set_plan(plan); m.plan = JSON.parse(JSON.stringify(plan)); m.build_plan(plan) }
  if (step === undefined) m.show_wires?.(false)
  return 1
}
