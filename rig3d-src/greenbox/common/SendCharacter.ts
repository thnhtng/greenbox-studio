/*
 * "🎮 Play test" / "🎥 Video mocap" from the animation step: packs the rigged model (+ animations) as a GLB in
 * memory and opens that tab with it (no download, no file dialog).
 */
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { Scene, type Object3D, type SkinnedMesh, type AnimationClip } from 'three'
import { ExportHierarchyService } from '../../lib/processes/export-to-file/ExportHierarchyService.ts'
import { ExportAnimationCleanupService } from '../../lib/processes/export-to-file/ExportAnimationCleanupService.ts'
import { handoff_put, handoff_notify, go_to_page } from './Handoff.ts'

/** pack the rigged character and open another Greenbox 3D page with it (play test, video mocap) */
export async function send_character (skinned: SkinnedMesh[], clips: AnimationClip[], key: 'playtest' | 'mocap', page: string, name = 'character.glb'): Promise<void> {
  // export from the bind pose, not from whatever frame of an animation is showing
  skinned.forEach(m => { m.skeleton.pose() })
  const export_clips = clips.map(c => { const k = c.clone(); k.name = k.name.trim(); return k })
  const objects: Object3D[] = ExportHierarchyService.collect_objects_to_export(skinned, false)
  ExportAnimationCleanupService.clean_clips_for_export(export_clips, objects)
  const parents = new Map<Object3D, Object3D | null>()
  const scene = new Scene()
  objects.forEach(o => { parents.set(o, o.parent); scene.add(o) })
  try {
    const buf = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, animations: export_clips }) as ArrayBuffer
    await handoff_put(key, { name, data: buf, at: Date.now() })
  } finally {
    objects.forEach(o => { const p = parents.get(o); if (p != null) p.add(o); else scene.remove(o) })
  }
  handoff_notify(key)
  go_to_page(page)
}

export async function send_to_playtest (skinned: SkinnedMesh[], clips: AnimationClip[]): Promise<void> {
  await send_character(skinned, clips, 'playtest', 'playtest.html')
}
