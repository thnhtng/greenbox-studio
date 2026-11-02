import { type AnimationClip } from 'three'

/**
 * Animations that came inside the last loaded model file (a fish that already swims, a rigged character with
 * its own idle…). The "Use your rigged model" page lists them first, marked ★: they play and export as they
 * are, without retargeting, next to the library animations retargeted onto the same rig.
 */
export const OWN = { clips: [] as AnimationClip[] }
export const OWN_MARK = '★ '
export const is_own = (name: string): boolean => name.startsWith(OWN_MARK)
