// The 2D layout (Room 3 / end card left out) read as a Greenbox plan: what an AI writes from the picture.
// Boxes are in picture pixels (1842 × 1542); the plan editor fits the picture in the 96 m map.
const W = 1842; const H = 1542; const K = 96 / Math.max(W, H)
const box = (id, kind, [x0, y0, x1, y1], label, color, height, extra = {}) =>
  ({ id, kind, form: extra.form ?? 'rect', x: ((x0 + x1) / 2 - W / 2) * K, z: ((y0 + y1) / 2 - H / 2) * K, w: (x1 - x0) * K, d: (y1 - y0) * K, r: 0, label, color, height, ...extra })
export const PLAN = {
  shapes: [
    box('road1', 'zone', [30, 30, 215, 1350], 'Drive thru', '#b9bec5', 0.05),
    box('road2', 'zone', [30, 1350, 1822, 1520], 'Drive thru', '#b9bec5', 0.05),
    box('field', 'zone', [215, 30, 1018, 690], 'Field', '#f6d37a', 0.05),
    box('room1', 'zone', [215, 690, 1018, 1350], 'Room 1', '#e6eaee', 0.05),
    box('room2', 'zone', [1018, 690, 1822, 1350], 'Room 2', '#f2cfd2', 0.05),
    box('volcano', 'source', [450, 97, 933, 303], 'Big cheese volcano', '#22e5f0', 2.4, { gives: 'cheese', time: 0.5 }),
    box('pizza', 'machine', [215, 690, 403, 1060], 'Pizza maker', '#f0c030', 1.6, { takes: 'cheese', gives: 'pizza', time: 1.2 }),
    box('put1', 'stack', [412, 810, 525, 923], 'Put cheese', '#93c47d', 0.1, { takes: 'cheese' }),
    box('spizza', 'stack', [252, 1068, 366, 1182], 'Stack pizza', '#ffffff', 0.1, { takes: 'pizza' }),
    box('counter1', 'counter', [475, 1225, 760, 1350], 'Counter', '#22e5f0', 1.1, { takes: 'pizza', price: 5, time: 1 }),
    box('money1', 'stack', [768, 1232, 880, 1343], 'Stack money', '#ffffff', 0.1),
    box('u_rail', 'unlock', [680, 697, 795, 810], 'Hire worker · upgrade rail', '#d9ead3', 0.05, { price: 50 }),
    box('u_w1', 'unlock', [562, 1062, 675, 1175], 'Hire worker', '#d9ead3', 0.05, { price: 30 }),
    box('u_room2', 'unlock', [880, 930, 993, 1103], '2nd room', '#d9ead3', 0.05, { price: 100 }),
    box('player', 'player', [695, 838, 798, 940], 'Player', '#ff9900', 0.1, { form: 'ellipse' }),
    box('burger', 'machine', [1018, 690, 1262, 828], 'Burger maker', '#f4b06a', 1.6, { takes: 'cheese', gives: 'burger', time: 1.2 }),
    box('sburger', 'stack', [1268, 703, 1383, 817], 'Stack burger', '#ffffff', 0.1, { takes: 'burger' }),
    box('put2', 'stack', [1025, 833, 1140, 946], 'Put cheese', '#93c47d', 0.1, { takes: 'cheese' }),
    box('u_w2', 'unlock', [1212, 927, 1326, 1041], 'Hire worker', '#d9ead3', 0.05, { price: 40 }),
    box('counter2', 'counter', [1385, 867, 1510, 1152], 'Counter', '#22e5f0', 1.1, { takes: 'burger', price: 8, time: 1 }),
    box('money2', 'stack', [1390, 1160, 1505, 1273], 'Stack money', '#ffffff', 0.1),
    box('c1', 'block', [1585, 975, 1645, 1035], 'Customer', '#ffffff', 1.7, { form: 'ellipse' }),
    box('c2', 'block', [1673, 975, 1733, 1035], 'Customer', '#ffffff', 1.7, { form: 'ellipse' }),
    box('c3', 'block', [1760, 975, 1820, 1035], 'Customer', '#ffffff', 1.7, { form: 'ellipse' })
  ],
  wires: [
    { id: 'w1', from: 'volcano', to: 'put1', mode: 'belt' }, { id: 'w2', from: 'volcano', to: 'put2', mode: 'belt' },
    { id: 'w3', from: 'put1', to: 'pizza', mode: 'belt' }, { id: 'w4', from: 'pizza', to: 'spizza', mode: 'belt' }, { id: 'w5', from: 'spizza', to: 'counter1', mode: 'carry' },
    { id: 'w6', from: 'put2', to: 'burger', mode: 'belt' }, { id: 'w7', from: 'burger', to: 'sburger', mode: 'belt' }, { id: 'w8', from: 'sburger', to: 'counter2', mode: 'carry' }
  ]
}
