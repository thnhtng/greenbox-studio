/*
 * Greenbox -> Blender Rigify.
 * Writes a small Blender Python script that adds Rigify's Human meta-rig and moves every meta-rig bone onto the
 * joints placed in Greenbox. In Blender: Scripting tab -> Open -> Run Script, then Armature tab -> Generate Rig.
 * (Rigify itself is Blender's add-on; nothing of it is copied here.)
 */
import * as THREE from 'three'
import { type Bone } from 'three'
import { RIGIFY_DEF } from './BoneNames'
import CONTROLS_PY from './greenbox_controls.py?raw'

type P = [number, number, number]

/** glTF / three (Y up, model faces +Z) -> Blender (Z up, model faces -Y) */
const to_blender = (v: THREE.Vector3): P => [v.x, -v.z, v.y]

export interface RigifyOptions {
  /** start of the GLB file name to look for next to the script / in Downloads; '' = meta-rig only */
  glb?: string
  /** joints turned off for hyper-casual: their meta-rig fingers are removed too */
  off?: string[]
  /** IK or FK per limb (arm.L, arm.R, leg.L, leg.R), as set in Greenbox's pose controls */
  modes?: Record<string, 'IK' | 'FK'>
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
MODES = ${JSON.stringify(opt.modes ?? {})}
CONTROLS = ${JSON.stringify(CONTROLS_PY)}

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

# P2M-style limbs: every arm / leg part is cut in 4 twist segments (DEF-upper_arm.L, .001, .002, .003 ...);
# Greenbox's weight of each part is spread along its segments after the rig is generated (see below)
SEGMENTS = 4
for n in ("upper_arm.L", "upper_arm.R", "thigh.L", "thigh.R"):
    pb = rig.pose.bones.get(n)
    try:
        pb.rigify_parameters.segments = SEGMENTS
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
        # the forearm twist bone of the GLB goes back into the forearm (Rigify's segments do the twist)
        for s_ in ("l", "r"):
            tw = m.vertex_groups.get("lowerarm_twist_01_" + s_); fo = m.vertex_groups.get("lowerarm_" + s_)
            if tw is not None and fo is not None:
                for v in m.data.vertices:
                    w = next((g.weight for g in v.groups if g.group == tw.index), 0.0)
                    if w > 0:
                        w0 = next((g.weight for g in v.groups if g.group == fo.index), 0.0)
                        fo.add([v.index], min(1.0, w0 + w), 'REPLACE')
                m.vertex_groups.remove(tw)
        for vg in m.vertex_groups:
            if vg.name in MAP:
                vg.name = MAP[vg.name]
        for md in m.modifiers:
            if md.type == 'ARMATURE':
                md.object = gen
        mw = m.matrix_world.copy()
        m.parent = gen
        m.matrix_world = mw
    # ---- P2M-style deformation ----
    # 1. each limb part's weight spread along its twist segments (soft overlap, like P2M's DEF chains)
    def spread(m, base):
        segs = [b for b in [gen.data.bones.get(base)] + [gen.data.bones.get("%s.%03d" % (base, i)) for i in range(1, SEGMENTS)] if b is not None]
        g0 = m.vertex_groups.get(base)
        if g0 is None or len(segs) < 2:
            return
        A = gen.matrix_world @ segs[0].head_local; B = gen.matrix_world @ segs[-1].tail_local; L = (B - A).length or 1.0
        groups = [m.vertex_groups.get(b.name) or m.vertex_groups.new(name=b.name) for b in segs]
        n = len(segs); mw = m.matrix_world
        for v in m.data.vertices:
            w = next((g.weight for g in v.groups if g.group == g0.index), 0.0)
            if w <= 0:
                continue
            t = max(0.0, min(1.0, ((mw @ v.co) - A).dot(B - A) / (L * L))) * n - 0.5
            for i, gr in enumerate(groups):
                share = max(0.0, 1.0 - abs(t - i)) if 0 < i < n - 1 else (max(0.0, min(1.0, 1.0 - (t - i))) if i == 0 else max(0.0, min(1.0, 1.0 + (t - i))))
                gr.add([v.index], w * share, 'REPLACE') if share > 0 else gr.remove([v.index])
    # 2. a SMOOTH group on the joints + Corrective Smooth (P2M: factor 0.3, 5 rounds, simple, rest = original)
    joints = []
    for nm in ("DEF-upper_arm.L", "DEF-upper_arm.R", "DEF-forearm.L", "DEF-forearm.R", "DEF-hand.L", "DEF-hand.R", "DEF-thigh.L", "DEF-thigh.R", "DEF-shin.L", "DEF-shin.R", "DEF-foot.L", "DEF-foot.R", "DEF-spine.004"):
        b = gen.data.bones.get(nm)
        if b is not None:
            joints.append((gen.matrix_world @ b.head_local, max(0.02, b.length * 0.6)))
    for m in meshes:
        for S_ in ("L", "R"):
            for base in ("DEF-upper_arm", "DEF-forearm", "DEF-thigh", "DEF-shin"):
                spread(m, base + "." + S_)
        sm = m.vertex_groups.get("SMOOTH") or m.vertex_groups.new(name="SMOOTH")
        mw = m.matrix_world
        for v in m.data.vertices:
            p = mw @ v.co; w = 0.0
            for c, r in joints:
                w = max(w, 1.0 - (p - c).length / r)
            if w > 0:
                sm.add([v.index], min(1.0, w * 1.5), 'REPLACE')
        if not any(md.type == 'CORRECTIVE_SMOOTH' for md in m.modifiers):
            cs = m.modifiers.new("CorrectiveSmooth", 'CORRECTIVE_SMOOTH')
            cs.factor = 0.3; cs.iterations = 5; cs.smooth_type = 'SIMPLE'; cs.rest_source = 'ORCO'; cs.vertex_group = "SMOOTH"
    for nm in [b.name for b in gen.data.bones if b.name.startswith("DEF-")]:
        try:
            gen.data.bones[nm].bbone_segments = max(gen.data.bones[nm].bbone_segments, 10 if any(k in nm for k in ("upper_arm", "forearm", "thigh", "shin", "spine")) else 1)
        except Exception:
            pass
    print("Greenbox: P2M-style deformation (4 twist segments per limb part, SMOOTH group + Corrective Smooth, B-bones)")
    if src is not None:
        src.name = "Greenbox animations (original skeleton)"
        src.hide_set(True)
    rig.hide_set(True)
    print("Greenbox: Rigify rig '%s' generated, %d mesh(es) bound. File: %s" % (gen.name, len(meshes), path))
    # the pose made in Greenbox (clip "Greenbox_Pose") goes onto the Rigify controls, IK and FK alike
    GB_POSE_MAP = [("torso", "pelvis"), ("chest", "spine_03"), ("neck", "neck_01"), ("head", "head")]
    for s_, S_ in (("l", "L"), ("r", "R")):
        GB_POSE_MAP += [("upper_arm_fk." + S_, "upperarm_" + s_), ("forearm_fk." + S_, "lowerarm_" + s_), ("hand_fk." + S_, "hand_" + s_),
                        ("upper_arm_ik." + S_, "upperarm_" + s_), ("hand_ik." + S_, "hand_" + s_),
                        ("thigh_fk." + S_, "thigh_" + s_), ("shin_fk." + S_, "calf_" + s_), ("foot_fk." + S_, "foot_" + s_), ("toe_fk." + S_, "ball_" + s_),
                        ("thigh_ik." + S_, "thigh_" + s_), ("foot_ik." + S_, "foot_" + s_), ("toe_ik." + S_, "ball_" + s_)]
        for f, mf in (("index", "f_index"), ("middle", "f_middle"), ("ring", "f_ring"), ("pinky", "f_pinky"), ("thumb", "thumb")):
            for k in ("01", "02", "03"):
                GB_POSE_MAP.append((mf + "." + k + "." + S_, f + "_" + k + "_" + s_))
    act = next((a for a in bpy.data.actions if a.name.startswith("Greenbox_Pose")), None)
    if src is not None and act is not None:
        try:
            src.animation_data_create()
            src.animation_data.action = act
            try:
                if len(act.slots) > 0 and src.animation_data.action_slot is None:
                    src.animation_data.action_slot = act.slots[0]
            except Exception:
                pass
            bpy.context.scene.frame_set(int(act.frame_range[0]))
            bpy.context.view_layer.update()
            for ctrl, sb in GB_POSE_MAP:
                c = gen.pose.bones.get(ctrl)
                b = src.pose.bones.get(sb) or src.pose.bones.get(MAP.get(sb, ""))
                if c is None or b is None:
                    continue
                S1 = src.matrix_world @ b.matrix
                S0 = src.matrix_world @ b.bone.matrix_local
                C0 = gen.matrix_world @ c.bone.matrix_local
                c.matrix = gen.matrix_world.inverted() @ (S1 @ S0.inverted() @ C0)
                bpy.context.view_layer.update()
            print("Greenbox: pose from Greenbox applied")
        except Exception as e:
            print("Greenbox: could not apply the pose:", e)
    for limb, mode in MODES.items():
        prop = {"arm.L": "upper_arm_parent.L", "arm.R": "upper_arm_parent.R", "leg.L": "thigh_parent.L", "leg.R": "thigh_parent.R"}.get(limb)
        pb = gen.pose.bones.get(prop) if prop else None
        if pb is not None:
            pb["IK_FK"] = 1.0 if mode == "FK" else 0.0
    gen.update_tag(); bpy.context.view_layer.update()

    # the Greenbox IK / FK panel (sidebar N > Greenbox), saved inside the .blend so it is there next time too
    txt = bpy.data.texts.get("greenbox_controls.py") or bpy.data.texts.new("greenbox_controls.py")
    txt.clear(); txt.write(CONTROLS); txt.use_module = True
    exec(compile(CONTROLS, "greenbox_controls.py", "exec"), {"__name__": "greenbox_controls"})

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
