/*
 * Greenbox export naming.
 * Mesh2Motion's human skeleton already uses Unreal (UE5 Manny-style) names: pelvis, spine_01, upperarm_l, ...
 * Unity's Humanoid importer maps those automatically. For Blender users we add Rigify's deform names (DEF-*),
 * so an exported rig drops straight into a Rigify-based pipeline.
 */

const SIDE = (b: string, l: string): Record<string, string> => ({ [`${b}_l`]: `${l}.L`, [`${b}_r`]: `${l}.R` })

/** Mesh2Motion human bone -> Rigify deform bone */
export const RIGIFY_DEF: Record<string, string> = Object.fromEntries(Object.entries({
  pelvis: 'spine',
  spine_01: 'spine.001',
  spine_02: 'spine.002',
  spine_03: 'spine.003',
  neck_01: 'spine.004',
  head: 'spine.006',
  ...SIDE('clavicle', 'shoulder'),
  ...SIDE('upperarm', 'upper_arm'),
  ...SIDE('lowerarm', 'forearm'),
  ...SIDE('hand', 'hand'),
  ...SIDE('thigh', 'thigh'),
  ...SIDE('calf', 'shin'),
  ...SIDE('foot', 'foot'),
  ...SIDE('ball', 'toe'),
  ...SIDE('thumb_01', 'thumb.01'), ...SIDE('thumb_02', 'thumb.02'), ...SIDE('thumb_03', 'thumb.03'),
  ...SIDE('index_01', 'f_index.01'), ...SIDE('index_02', 'f_index.02'), ...SIDE('index_03', 'f_index.03'),
  ...SIDE('middle_01', 'f_middle.01'), ...SIDE('middle_02', 'f_middle.02'), ...SIDE('middle_03', 'f_middle.03'),
  ...SIDE('ring_01', 'f_ring.01'), ...SIDE('ring_02', 'f_ring.02'), ...SIDE('ring_03', 'f_ring.03'),
  ...SIDE('pinky_01', 'f_pinky.01'), ...SIDE('pinky_02', 'f_pinky.02'), ...SIDE('pinky_03', 'f_pinky.03')
}).map(([k, v]) => [k, `DEF-${v}`]))

export function rigify_name (m2m: string): string | undefined { return RIGIFY_DEF[m2m] }
