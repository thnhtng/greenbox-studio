/*
 * Greenbox -> Blender Rigify.
 * Writes a small Blender Python script that adds Rigify's Human meta-rig and moves every meta-rig bone onto the
 * joints placed in Greenbox. In Blender: Scripting tab -> Open -> Run Script, then Armature tab -> Generate Rig.
 * (Rigify itself is Blender's add-on; nothing of it is copied here.)
 */
import * as THREE from 'three'
import { type Bone } from 'three'
import { RIGIFY_DEF } from './BoneNames'

type P = [number, number, number]

/** glTF / three (Y up, model faces +Z) -> Blender (Z up, model faces -Y) */
const to_blender = (v: THREE.Vector3): P => [v.x, -v.z, v.y]

export interface RigifyOptions {
  /** start of the GLB file name to look for next to the script / in Downloads; '' = meta-rig only */
  glb?: string
  /** joints turned off for hyper-casual: their meta-rig fingers are removed too */
  off?: string[]
}

export function rigify_metarig_script (bones: Bone[], model_name = 'Greenbox character', opt: RigifyOptions = {}): string {
  if (bones.length > 0) { let top: THREE.Object3D = bones[0]; while (top.parent !== null) top = top.parent; top.updateMatrixWorld(true) }
  const J: Record<string, P> = {}
  bones.forEach(b => { J[b.name] = to_blender(new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)) })
  const js = JSON.stringify(J)
  return `# Greenbox 3D -> Blender Rigify for "${model_name.replace(/"/g, '')}"
# Blender 4.x / 5.x: Scripting tab -> Open this file -> Run Script. That's all:
#  1. adds Rigify's Human meta-rig and moves its bones onto the joints placed in Greenbox
#  2. if the Greenbox GLB is next to this script (or in Downloads): imports it, generates the Rigify rig
#     and puts the character on it (same skin weights, renamed to Rigify's DEF- bones)
# Without the GLB you get the placed meta-rig: Armature properties -> Rigify -> Generate Rig.
import bpy, addon_utils
from mathutils import Vector

J = ${js}

def v(n):
    return Vector(J[n]) if n in J else None

def mid(a, b, t=0.5):
    return a.lerp(b, t)

try:
    addon_utils.enable("rigify", default_set=True)
except Exception:
    pass
for mod in ("bl_ext.blender_org.rigify", ):
    try:
        addon_utils.enable(mod, default_set=True)
    except Exception:
        pass

import os
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
# opened straight from Greenbox ("Open in Blender"): start from an empty scene (no default cube / camera / light)
if os.environ.get("GREENBOX_GLB"):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.armature_human_metarig_add()
rig = bpy.context.active_object
rig.name = "metarig"

# make the default meta-rig the same height as the character first, so bones we do not place
# (heels, breasts, pelvis wings) land in sensible spots
eb_src = rig.data.bones
h_meta = (eb_src["spine.006"].tail_local - eb_src["foot.L"].tail_local).z
h_char = (v("head_leaf") or v("head")).z - min(v("ball_leaf_l").z if v("ball_leaf_l") else 0, v("foot_l").z)
if h_meta > 1e-6 and h_char > 1e-6:
    s = h_char / h_meta
    rig.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

OFF = set(${JSON.stringify(opt.off ?? [])})
GLB_NAME = ${JSON.stringify(opt.glb ?? '')}
MAP = ${JSON.stringify(RIGIFY_DEF)}

bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones

# fingers turned off in Greenbox: no finger controls either
for s, S in (("l", "L"), ("r", "R")):
    for f, mf in (("index", "f_index"), ("middle", "f_middle"), ("ring", "f_ring"), ("pinky", "f_pinky"), ("thumb", "thumb")):
        if f + "_01_" + s in OFF:
            for k in ("01", "02", "03"):
                b = eb.get(mf + "." + k + "." + S)
                if b is not None:
                    eb.remove(b)

# the full Human meta-rig has a face rig: game characters rarely need it
face = eb.get("face")
if face is not None:
    for b in [face] + list(face.children_recursive):
        eb.remove(b)

def put(name, head, tail):
    b = eb.get(name)
    if b is None or head is None or tail is None:
        return
    if (tail - head).length < 1e-5:
        tail = head + Vector((0, 0, 0.01))
    b.head = head
    b.tail = tail

# spine (pelvis -> head top)
neck_mid = mid(v("neck_01"), v("head")) if v("neck_01") and v("head") else None
put("spine", v("pelvis"), v("spine_01"))
put("spine.001", v("spine_01"), v("spine_02"))
put("spine.002", v("spine_02"), v("spine_03"))
put("spine.003", v("spine_03"), v("neck_01"))
put("spine.004", v("neck_01"), neck_mid)
put("spine.005", neck_mid, v("head"))
put("spine.006", v("head"), v("head_leaf"))

def bend(a, b, c, push):
    # Rigify's IK needs every arm/leg slightly bent (a dead-straight limb has no knee/elbow direction).
    # Push the middle joint a little along "push" when the three joints are almost in a line.
    if a is None or b is None or c is None:
        return b
    ab, bc = (b - a), (c - b)
    if ab.length < 1e-6 or bc.length < 1e-6:
        return b
    if ab.angle(bc) < 0.06:  # < ~3.5 degrees
        return b + push * ((ab.length + bc.length) * 0.035)
    return b

for s in ("l", "r"):
    # elbows point back (+Y in Blender), knees point forward (-Y)
    for a, b, c, push in (("upperarm", "lowerarm", "hand", Vector((0, 1, 0))), ("thigh", "calf", "foot", Vector((0, -1, 0)))):
        A, B, C = v(a + "_" + s), v(b + "_" + s), v(c + "_" + s)
        if B is not None:
            J[b + "_" + s] = tuple(bend(A, B, C, push))

for s, S in (("l", "L"), ("r", "R")):
    g = lambda n: v(n + "_" + s)
    put("shoulder." + S, g("clavicle"), g("upperarm"))
    put("upper_arm." + S, g("upperarm"), g("lowerarm"))
    put("forearm." + S, g("lowerarm"), g("hand"))
    put("hand." + S, g("hand"), g("middle_01") or (g("hand") + (g("hand") - g("lowerarm")) * 0.35 if g("hand") else None))
    for f, mf in (("index", "f_index"), ("middle", "f_middle"), ("ring", "f_ring"), ("pinky", "f_pinky"), ("thumb", "thumb")):
        p1, p2, p3, p4 = g(f + "_01"), g(f + "_02"), g(f + "_03"), g(f + "_04_leaf")
        put(mf + ".01." + S, p1, p2)
        put(mf + ".02." + S, p2, p3)
        put(mf + ".03." + S, p3, p4)
    put("palm.01." + S, g("hand"), g("index_01"))
    put("palm.02." + S, g("hand"), g("middle_01"))
    put("palm.03." + S, g("hand"), g("ring_01"))
    put("palm.04." + S, g("hand"), g("pinky_01"))
    put("thigh." + S, g("thigh"), g("calf"))
    put("shin." + S, g("calf"), g("foot"))
    put("foot." + S, g("foot"), g("ball"))
    put("toe." + S, g("ball"), g("ball_leaf"))
    ft, ba = g("foot"), g("ball")
    hb = eb.get("heel.02." + S)
    if hb is not None and ft is not None and ba is not None:
        L = (ba - ft).length
        back = Vector((ft.x, ft.y + L * 0.35, 0.0))
        w = Vector((L * 0.18, 0, 0))
        hb.head = back - w
        hb.tail = back + w

bpy.ops.object.mode_set(mode='OBJECT')

# one deform bone per arm / leg part, so Greenbox's skin weights map 1:1 onto Rigify's DEF- bones
for n in ("upper_arm.L", "upper_arm.R", "thigh.L", "thigh.R"):
    pb = rig.pose.bones.get(n)
    try:
        pb.rigify_parameters.segments = 1
    except Exception:
        pass
print("Greenbox: meta-rig placed.")

# ---------------- the character on a generated Rigify rig ----------------
import os, glob

def find_glb():
    env = os.environ.get("GREENBOX_GLB")
    if env and os.path.exists(env):
        return env
    if not GLB_NAME:
        return None
    dirs = []
    try:
        sd = bpy.context.space_data
        if sd is not None and getattr(sd, "text", None) is not None and sd.text.filepath:
            dirs.append(os.path.dirname(bpy.path.abspath(sd.text.filepath)))
    except Exception:
        pass
    try:
        if os.path.exists(__file__):
            dirs.append(os.path.dirname(os.path.abspath(__file__)))
    except NameError:
        pass
    if bpy.data.filepath:
        dirs.append(os.path.dirname(bpy.data.filepath))
    dirs.append(os.path.join(os.path.expanduser("~"), "Downloads"))
    for d in dirs:
        hits = sorted(glob.glob(os.path.join(d, GLB_NAME + "*.glb")), key=os.path.getmtime, reverse=True)
        if hits:
            return hits[0]
    return None

path = find_glb()
if path is None:
    if GLB_NAME:
        print("Greenbox: %s*.glb not found next to the script or in Downloads. Armature properties -> Rigify -> Generate Rig." % GLB_NAME)
else:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    src = next((o for o in new if o.type == 'ARMATURE'), None)
    meshes = [o for o in new if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.pose.rigify_generate()
    gen = getattr(rig.data, "rigify_target_rig", None) or bpy.context.view_layer.objects.active
    for m in meshes:
        for vg in m.vertex_groups:
            if vg.name in MAP:
                vg.name = MAP[vg.name]
        for md in m.modifiers:
            if md.type == 'ARMATURE':
                md.object = gen
        mw = m.matrix_world.copy()
        m.parent = gen
        m.matrix_world = mw
    if src is not None:
        src.name = "Greenbox animations (original skeleton)"
        src.hide_set(True)
    rig.hide_set(True)
    print("Greenbox: Rigify rig '%s' generated, %d mesh(es) bound. File: %s" % (gen.name, len(meshes), path))
    # ready to pose: the new rig selected, in Pose mode
    try:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = gen
        gen.select_set(True)
        bpy.ops.object.mode_set(mode='POSE')
    except Exception:
        pass
`
}

export function download_text (text: string, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/x-python' }))
  a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
