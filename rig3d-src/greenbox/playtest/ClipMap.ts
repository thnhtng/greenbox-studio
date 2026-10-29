/*
 * Which animation plays for which game action. Works with the Greenbox/Mesh2Motion library names and with common
 * names from Mixamo / other packs (first match wins). In-place clips are preferred over root-motion (_RM) ones,
 * because the controller moves the character itself.
 */
import { type AnimationClip } from 'three'

export type Action =
  'idle' | 'walk' | 'run' | 'sprint' | 'jump_start' | 'jump_air' | 'jump_land' | 'jump' |
  'roll' | 'attack1' | 'attack2' | 'attack3' | 'block' | 'crouch_idle' | 'crouch_walk' | 'hit' | 'strafe_l' | 'strafe_r' | 'walk_back' |
  'climb_wall' | 'climb_up'

const WANT: Record<Action, RegExp[]> = {
  idle: [/^idle_a$/i, /^idle$/i, /idle_subtle/i, /fighting idle/i, /\bidle\b/i],
  // animals: horses trot, sharks swim, snakes side-wind, birds and dragons walk on the ground
  walk: [/^walk$/i, /^walking$/i, /walk(?!.*(back|carry|stealth|zombie|crouch|rm))/i, /swim horizontal/i, /side ?winding/i, /^swim$/i],
  run: [/^jog$/i, /^run$/i, /^running$/i, /run(?!.*(jump|stealth))/i, /^trot$/i, /fly flap/i, /^flap$/i, /swim horizontal/i],
  sprint: [/^sprint$/i, /run_anime/i, /fast run/i, /sprint/i],
  jump_start: [/^jump_start$/i, /jump.?start/i, /ninjajump_start/i],
  jump_air: [/^jump_air$/i, /jump.?(idle|loop|air|fall)/i, /falling/i],
  jump_land: [/^jump_land$/i, /jump.?land/i, /landing/i],
  jump: [/^jump_2$/i, /^jump$/i, /run jump/i, /jump/i, /^rear$/i],
  roll: [/^roll$/i, /dodge_back$/i, /roll(?!.*_rm)/i, /dodge/i],
  attack1: [/^sword_regular_a$/i, /^punch_jab$/i, /fighting left jab/i, /sword_attack$/i, /attack|punch|slash/i, /^bite$/i, /^kick$/i, /head_?butt?/i],
  attack2: [/^sword_regular_b$/i, /^punch_cross$/i, /fighting right jab/i, /tail attack/i, /^bark$/i, /^roar$/i],
  attack3: [/^sword_regular_c$/i, /^kick_breach$/i, /melee_hook$/i, /kick/i],
  block: [/^sword_block$/i, /^defend$/i, /idle_shield$/i, /block/i, /shield/i],
  crouch_idle: [/^crouch_idle$/i, /crouch.*idle/i],
  crouch_walk: [/^crouch_walk$/i, /crouch.*walk/i, /sneak/i],
  hit: [/^hit_chest$/i, /^hit_head$/i, /\bhit\b/i, /impact/i],
  strafe_l: [/^strafe_left$/i, /strafe.?left/i],
  strafe_r: [/^strafe_right$/i, /strafe.?right/i],
  walk_back: [/^walk_backwards$/i, /walk.?back/i],
  climb_wall: [/^climb wall$/i, /climb.?wall/i, /climb ladder/i, /climb/i],
  climb_up: [/^climbup_1m/i, /climb.?up/i, /ledge.?climb/i]
}

export type ClipTable = Partial<Record<Action, AnimationClip>>

export function map_clips (clips: AnimationClip[]): ClipTable {
  const inplace = clips.filter(c => !/(_rm|root ?motion)$/i.test(c.name))
  const pool = [...inplace, ...clips.filter(c => !inplace.includes(c))]
  const out: ClipTable = {}
  ;(Object.keys(WANT) as Action[]).forEach(a => {
    for (const re of WANT[a]) {
      const c = pool.find(x => re.test(x.name.trim()))
      if (c !== undefined) { out[a] = c; break }
    }
  })
  return out
}
