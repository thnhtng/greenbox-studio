# Builds the Greenbox "Snake Clash" skeleton type from a Snake012 skin FBX (head with a jaw rig, body, tail):
#   rig-snakeclash.glb  (root -> head -> mouth_top / mouth_bottom, root -> body, root -> tail)
#   model-snakeclash.glb (head + body + tail, no bones), snakeclash-animations.glb (Idle, eat, eat_backup)
import bpy, sys, os, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
os.makedirs(out, exist_ok=True)
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False)
scn = bpy.context.scene
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
head = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_Head'))
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_Body'))
tail = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_Tail'))
prefix = rig.name[:-4]  # "Skin_00_Rainbow_0_"
MAP = {'00_Bone': 'head', '01_Mouse_top': 'mouth_top', '02_Mouse_bottom': 'mouth_bottom'}

def assign(obj, act):
    if obj.animation_data is None: obj.animation_data_create()
    obj.animation_data.action = act
    if act is not None and hasattr(obj.animation_data, 'action_slot') and len(act.slots) > 0: obj.animation_data.action_slot = act.slots[0]

def norm(m):
    loc, rot, _s = m.decompose(); return mathutils.Matrix.Translation(loc) @ rot.to_matrix().to_4x4()

clip_names = ['Idle', 'eat', 'eat_backup']
for o in (rig, body, tail): assign(o, None)
for pb in rig.pose.bones: pb.matrix_basis = mathutils.Matrix()
scn.frame_set(1); bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
def wbox(o):
    ev = o.evaluated_get(dg); vs = [ev.matrix_world @ v.co for v in ev.data.vertices]
    return mathutils.Vector([min(v[i] for v in vs) for i in range(3)]), mathutils.Vector([max(v[i] for v in vs) for i in range(3)])
bmin, bmax = wbox(body); tmin, tmax = wbox(tail)

ad = bpy.data.armatures.new('Armature'); new = bpy.data.objects.new('Armature', ad); scn.collection.objects.link(new)
bpy.context.view_layer.objects.active = new; new.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = ad.edit_bones
root = eb.new('root'); cy = (bmin.y + bmax.y) / 2; root.head = (0, cy, 0); root.tail = (0, cy, 0.3)
for old, nn in MAP.items():
    b = rig.data.bones[old]; e = eb.new(nn); e.head = (0, 0, 0); e.tail = (0, 0.1, 0)
    e.matrix = norm(rig.matrix_world @ b.matrix_local); e.length = max(0.1, b.length)
eb['head'].parent = root; eb['mouth_top'].parent = eb['head']; eb['mouth_bottom'].parent = eb['head']
zc = (bmin.z + bmax.z) / 2
bb = eb.new('body'); bb.head = (0, bmax.y, zc); bb.tail = (0, bmin.y, zc); bb.parent = root
tb = eb.new('tail'); tb.head = (0, tmax.y, (tmin.z + tmax.z) / 2); tb.tail = (0, tmin.y, (tmin.z + tmax.z) / 2); tb.parent = root
bpy.ops.object.mode_set(mode='POSE')
for old, nn in MAP.items():
    c = new.pose.bones[nn].constraints.new('COPY_TRANSFORMS'); c.target = rig; c.subtarget = old
bpy.ops.object.mode_set(mode='OBJECT')

new.animation_data_create()
for name in clip_names:
    a = bpy.data.actions.get(f'{rig.name}|{prefix}_{name}') or bpy.data.actions.get(f'{rig.name}|{prefix}{name}')
    if a is None:
        cand = [x for x in bpy.data.actions if x.name.startswith(rig.name + '|') and x.name.endswith('__' + name)]
        a = cand[0] if cand else None
    if a is None: print('MISSING', name); continue
    assign(rig, a); f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    for o in bpy.data.objects: o.select_set(o == new)
    bpy.context.view_layer.objects.active = new
    bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=f0, frame_end=max(f1, f0 + 1), only_selected=False, visual_keying=True, clear_constraints=False, use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    act = new.animation_data.action; act.name = name
    tr = new.animation_data.nla_tracks.new(); tr.name = name; tr.strips.new(name, f0, act); new.animation_data.action = None
    print('BAKED', name, f0, f1)
assign(rig, None)
for pb in new.pose.bones:
    for c in list(pb.constraints): pb.constraints.remove(c)
    pb.matrix_basis = mathutils.Matrix()
for pb in rig.pose.bones: pb.matrix_basis = mathutils.Matrix()
scn.frame_set(1); bpy.context.view_layer.update()

# one mesh: the head keeps its jaw weights (renamed), body and tail follow their bones
def bake_world(o):
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for m in list(o.modifiers): o.modifiers.remove(m)
    o.data = o.data.copy(); o.data.transform(mw); o.matrix_world = mathutils.Matrix()
for o in (head, body, tail): assign(o, None); bake_world(o)
for vg in head.vertex_groups:
    if vg.name in MAP: vg.name = MAP[vg.name]
for o, g in ((body, 'body'), (tail, 'tail')):
    o.vertex_groups.clear(); v = o.vertex_groups.new(name=g); v.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
for o in bpy.data.objects: o.select_set(o in (head, body, tail))
bpy.context.view_layer.objects.active = head; bpy.ops.object.join()
snake = head; snake.name = 'SnakeClash'
mod = snake.modifiers.new('Armature', 'ARMATURE'); mod.object = new; snake.parent = new

# textures: 512 px is plenty for a game snake (the source maps are 2–4k)
for img in bpy.data.images:
    if img.size[0] > 512: img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
def export(path, objs, anim):
    for t in new.animation_data.nla_tracks: t.mute = not anim
    if not anim:
        for pb in new.pose.bones: pb.matrix_basis = mathutils.Matrix()
    scn.frame_set(1); bpy.context.view_layer.update()
    for o in bpy.data.objects: o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_image_format='JPEG', export_image_quality=82)
    if anim: kw.update(export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True)
    else: kw.update(export_animations=False)
    bpy.ops.export_scene.gltf(**kw)

export(os.path.join(out, 'snakeclash-animations.glb'), [new, snake], True)
bpy.ops.mesh.primitive_ico_sphere_add(radius=0.05, location=new.data.bones['root'].head_local); ico = bpy.context.active_object; ico.name = 'Icosphere'
vg = ico.vertex_groups.new(name='root'); vg.add(list(range(len(ico.data.vertices))), 1.0, 'REPLACE')
m2 = ico.modifiers.new('Armature', 'ARMATURE'); m2.object = new
export(os.path.join(out, 'rig-snakeclash.glb'), [new, ico], False)
dup = snake.copy(); dup.data = snake.data.copy(); scn.collection.objects.link(dup); dup.parent = None
for m in list(dup.modifiers): dup.modifiers.remove(m)
dup.vertex_groups.clear(); dup.name = 'SnakeClashMesh'
export(os.path.join(out, 'model-snakeclash.glb'), [dup], False)
for o in bpy.data.objects: o.hide_render = o not in (new, snake)
cam_d = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_d); scn.collection.objects.link(cam)
cam.location = (9, -1.3, 4); cam.rotation_euler = (1.15, 0, 1.57); cam_d.lens = 35; scn.camera = cam
scn.render.engine = 'BLENDER_WORKBENCH'; scn.render.resolution_x = 500; scn.render.resolution_y = 350; scn.render.film_transparent = True
scn.display.shading.color_type = 'TEXTURE'
scn.render.filepath = os.path.join(out, 'snakeclash.png'); bpy.ops.render.render(write_still=True)
for n in ('root', 'head', 'mouth_top', 'mouth_bottom', 'body', 'tail'): print('BONE', n, [round(x, 2) for x in new.data.bones[n].head_local])
print('DONE')
