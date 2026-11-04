/*
 * Ctrl+Z / Cmd+Z (undo) and Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y (redo) on the rig page, for the human rig and 🧬 Clone rig:
 *   placing joints        -> the joint moves (the page's own undo list)
 *   rigged / skinned      -> back to the joints (the apply is undone, the joints are kept)
 *   just turned the model -> turned back (90° buttons pressed three more times)
 */
import type { Mesh2MotionEngine } from '../../Mesh2MotionEngine.ts'

export function mount_rig_keys (engine: Mesh2MotionEngine): void {
  // the model turns you made with the X / Y / Z buttons (programmatic clicks, e.g. Clone rig's auto turn, are not counted)
  const turns: string[] = []
  for (const id of ['rotate-model-x-button', 'rotate-model-y-button', 'rotate-model-z-button']) {
    document.getElementById(id)?.addEventListener('click', e => { if (e.isTrusted) turns.push(id) }, true)
  }
  const click = (id: string): boolean => { const b = document.getElementById(id) as HTMLButtonElement | null; if (b === null || b.disabled) return false; b.click(); return true }
  addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const t = e.target as HTMLElement | null; if (t !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
    const z = e.code === 'KeyZ'; const y = e.code === 'KeyY'; if (!z && !y) return
    const redo = y || e.shiftKey
    const step = String(engine.process_step)
    let done = false
    if (step === 'edit-skeleton') done = redo ? engine.edit_skeleton_step.redo_bone_transformation() : engine.edit_skeleton_step.undo_bone_transformation()
    else if (redo) return
    else if (step === 'animations-export' || step === 'BindPose' || step === 'weight-skin') done = click('action_back_to_edit_skeleton')
    else if (step === 'load-skeleton' && turns.length > 0) { const id = turns.pop()!; for (let i = 0; i < 3; i++) (document.getElementById(id) as HTMLButtonElement | null)?.click(); done = true }
    if (done) { e.preventDefault(); e.stopPropagation() }
  }, true)
}
