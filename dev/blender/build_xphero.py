# Builds the Greenbox "XP Hero" skeleton type from Player_Model_Skin_Basic_AllAnimations.fbx:
#   rig-xphero.glb (skeleton: a real Hips root bone + the 29 bones + Weapon / Weapon_AltHand sockets)
#   model-xphero.glb (the character mesh, no bones), xphero-animations.glb (all clips on that skeleton)
#   props: weapon_axe.glb, weapon_pickaxe.glb, weapon_sword.glb, reference png
import bpy, sys, os, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
os.makedirs(out, exist_ok=True)
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False, ignore_leaf_bones=True)
scn = bpy.context.scene
old = bpy.data.objects['Hips']
sockets = [bpy.data.objects[n] for n in ('Weapon', 'Weapon_AltHand')]
holders = {o.name: o for o in bpy.data.objects}

def norm(m):
    loc, rot, _s = m.decompose()
    return mathutils.Matrix.Translation(loc) @ rot.to_matrix().to_4x4()

def assign(obj, act):
    if obj.animation_data is None: obj.animation_data_create()
    obj.animation_data.action = act
    if act is not None and hasattr(obj.animation_data, 'action_slot') and len(act.slots) > 0:
        obj.animation_data.action_slot = act.slots[0]

# clips = names of the main skeletal actions
clips = sorted({a.name.split('|')[1] for a in bpy.data.actions if a.name.startswith('Hips|')})
print('CLIPS', len(clips))
# rest pose: standing (the objects where "Idle 3" puts them at its first frame), every bone at its rest
for o in bpy.data.objects:
    if o.animation_data: o.animation_data.action = None
for o in ('Hips', 'Armature', 'Weapon', 'Weapon_AltHand'):
    assign(bpy.data.objects[o], bpy.data.actions.get(f'{o}|Idle 3|Animation Base Layer'))
scn.frame_set(1)
for o in bpy.data.objects:
    if o.animation_data: o.animation_data.action = None
for pb in old.pose.bones: pb.matrix_basis = mathutils.Matrix()
bpy.context.view_layer.update()
mesh_rest = bpy.data.objects['002_Player'].matrix_world.copy()

# new armature at world origin, bones copied in world space
ad = bpy.data.armatures.new('Armature'); new = bpy.data.objects.new('Armature', ad); scn.collection.objects.link(new)
bpy.context.view_layer.objects.active = new; new.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = ad.edit_bones
hip = eb.new('Hips'); hip.head = (0, 0, 0); hip.tail = (0, 0.1, 0); hip.matrix = norm(old.matrix_world); hip.length = 0.1
for b in old.data.bones:
    e = eb.new(b.name); e.head = (0, 0, 0); e.tail = (0, 0.1, 0)
    e.matrix = norm(old.matrix_world @ b.matrix_local); e.length = max(0.02, b.length * old.matrix_world.to_scale()[0])
for b in old.data.bones:
    eb[b.name].parent = eb[b.parent.name] if b.parent else hip
# weapon sockets ride on the hands (their own Unity keys are in other units and fly off)
for s, hand in zip(sockets, ('RightHand', 'LeftHand')):
    e = eb.new(s.name); e.head = (0, 0, 0); e.tail = (0, 0.1, 0); e.matrix = norm(s.matrix_world); e.length = 0.12; e.parent = eb[hand]
bpy.ops.object.mode_set(mode='POSE')
# follow the old rig exactly (world space)
for pb in new.pose.bones:
    c = pb.constraints.new('COPY_TRANSFORMS')
    if pb.name == 'Hips': c.target = old
    elif pb.name in ('Weapon', 'Weapon_AltHand'): pb.constraints.remove(c); continue
    else: c.target = old; c.subtarget = pb.name
bpy.ops.object.mode_set(mode='OBJECT')

new.animation_data_create()
for name in clips:
    acts = {o: bpy.data.actions.get(f'{o}|{name}|Animation Base Layer') for o in ('Hips', 'Armature', 'Weapon', 'Weapon_AltHand')}
    for o in ('Hips', 'Armature', 'Weapon', 'Weapon_AltHand'):
        ob = bpy.data.objects[o]; assign(ob, acts[o])
        if acts[o] is None and o != 'Hips': ob.matrix_basis = ob.matrix_basis  # keep its rest transform
    a = acts['Hips']; f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    for o in ('Armature', 'Weapon', 'Weapon_AltHand'):
        x = acts[o]
        if x is not None: f1 = max(f1, int(x.frame_range[1]))
    bpy.context.view_layer.objects.active = new
    for o in bpy.data.objects: o.select_set(o == new)
    bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=False, visual_keying=True, clear_constraints=False, use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    act = new.animation_data.action; act.name = name
    tr = new.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, f0, act); new.animation_data.action = None
    print('BAKED', name, f0, f1)

for o in ('Hips', 'Armature', 'Weapon', 'Weapon_AltHand'): assign(bpy.data.objects[o], None)
for pb in new.pose.bones:
    for c in list(pb.constraints): pb.constraints.remove(c)
    pb.matrix_basis = mathutils.Matrix()  # back to rest (the bake leaves the last frame's pose)
scn.frame_set(0); bpy.context.view_layer.update()

# the character mesh on the new rig
me = bpy.data.objects['002_Player']
me.parent = None; me.matrix_world = mesh_rest
for m in me.modifiers:
    if m.type == 'ARMATURE': m.object = new
me.parent = new; me.matrix_parent_inverse = new.matrix_world.inverted()
me.name = 'XPHero'

def export(path, objs, anim):
    for o in bpy.data.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False)
    for t in new.animation_data.nla_tracks: t.mute = not anim
    if not anim:
        for pb in new.pose.bones: pb.matrix_basis = mathutils.Matrix()
    if anim: kw.update(export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True)
    else: kw.update(export_animations=False)
    scn.frame_set(0); bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(**kw)

# 1) animations: rig + skinned mesh + every clip
export(os.path.join(out, 'xphero-animations.glb'), [new, me], True)
# 2) rig: skeleton + a tiny dummy mesh on the hips (like the other Greenbox rigs)
bpy.ops.mesh.primitive_ico_sphere_add(radius=0.02, location=new.matrix_world @ new.data.bones['Hips'].head_local); ico = bpy.context.active_object; ico.name = 'Icosphere'
vg = ico.vertex_groups.new(name='Hips'); vg.add(list(range(len(ico.data.vertices))), 1.0, 'REPLACE')
mod = ico.modifiers.new('Armature', 'ARMATURE'); mod.object = new
export(os.path.join(out, 'rig-xphero.glb'), [new, ico], False)
# 3) model: the mesh in rest pose, no bones
bpy.ops.object.select_all(action='DESELECT')
dup = me.copy(); dup.data = me.data.copy(); scn.collection.objects.link(dup)
mw = dup.matrix_world.copy(); dup.parent = None; dup.matrix_world = mw
for m in list(dup.modifiers): dup.modifiers.remove(m)
dup.vertex_groups.clear(); dup.name = 'XPHeroMesh'
export(os.path.join(out, 'model-xphero.glb'), [dup], False)
# 4) weapons as props (at the origin, standing up)
for wname, fname in (('Axe', 'weapon_axe'), ('Pickaxe', 'weapon_pickaxe'), ('Sword_Step1', 'weapon_sword')):
    w = bpy.data.objects.get(wname)
    if w is None: continue
    c = w.copy(); c.data = w.data.copy(); scn.collection.objects.link(c)
    c.parent = None; c.matrix_world = mathutils.Matrix.Diagonal((*w.matrix_world.to_scale(), 1))
    export(os.path.join(out, fname + '.glb'), [c], False)
# 5) reference picture (workbench, front): rest pose, only the character
for t in new.animation_data.nla_tracks: t.mute = True
for pb in new.pose.bones: pb.matrix_basis = mathutils.Matrix()
for o in bpy.data.objects: o.hide_render = o not in (new, me)
scn.frame_set(0); bpy.context.view_layer.update()
# 5) reference picture (workbench, front)
cam_d = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_d); scn.collection.objects.link(cam)
cam.location = (0, -4.2, 0.75); cam.rotation_euler = (1.5708, 0, 0); cam_d.lens = 50; scn.camera = cam
scn.render.engine = 'BLENDER_WORKBENCH'; scn.render.resolution_x = 400; scn.render.resolution_y = 500; scn.render.film_transparent = True
new.show_in_front = True; new.data.display_type = 'STICK'
scn.render.filepath = os.path.join(out, 'xphero.png'); bpy.ops.render.render(write_still=True)
for n in ('Hips', 'Spine', 'Head', 'LeftFoot', 'LeftHand', 'RightHand', 'Weapon'):
    bn = new.data.bones.get(n); print('BONE', n, [round(x, 3) for x in (new.matrix_world @ bn.head_local)] if bn else None)
dg = bpy.context.evaluated_depsgraph_get(); ev = me.evaluated_get(dg); vs = [ev.matrix_world @ v.co for v in ev.data.vertices]
print('MESH', [round(min(v[i] for v in vs), 2) for i in range(3)], [round(max(v[i] for v in vs), 2) for i in range(3)], 'rest', [round(x, 2) for x in mesh_rest.translation], [round(x, 2) for x in mesh_rest.to_euler()], [round(x, 3) for x in mesh_rest.to_scale()])
print('DONE')
