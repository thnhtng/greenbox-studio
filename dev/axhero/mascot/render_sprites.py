"""Small transparent sprite frames of a GLB for the intro page (Blender, EEVEE):
  blender -b --python render_sprites.py -- <file.glb> <out_dir> <frames> <px> turn|<action name> [tilt_deg (turn) / yaw_deg (action)]
turn: the model spins once around its up axis; an action name: that animation, seen from the side, in place."""
import bpy, sys, math, mathutils, os
a = sys.argv[sys.argv.index('--') + 1:]
src, out, N, PX, mode = a[0], a[1], int(a[2]), int(a[3]), a[4]
tilt = math.radians(float(a[5])) if len(a) > 5 else 0.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == 'MESH']
if mode != 'turn':  # only the skinned body (exports can carry helper meshes)
    for o in [o for o in meshes if o.parent is None or o.parent.type != 'ARMATURE']: bpy.data.objects.remove(o)
    meshes = [o for o in sc.objects if o.type == 'MESH']
roots = [o for o in sc.objects if o.parent is None]
piv = bpy.data.objects.new('pivot', None); sc.collection.objects.link(piv)
for o in roots: o.parent = piv
if mode != 'turn':
    act = bpy.data.actions.get(mode)
    arm = next(o for o in sc.objects if o.type == 'ARMATURE')
    arm.animation_data_create(); arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_slot') and act.slots: arm.animation_data.action_slot = act.slots[0]
    f0, f1 = act.frame_range
def bounds():
    bpy.context.view_layer.update()
    mn = mathutils.Vector((1e9,) * 3); mx = -mn
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        e = o.evaluated_get(dg); m = e.to_mesh()
        for v in m.vertices:
            w = e.matrix_world @ v.co; mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
        e.to_mesh_clear()
    return mn, mx
# frame: union of the bounds over the turn / the animation
mn = mathutils.Vector((1e9,) * 3); mx = -mn
for i in range(0, N, max(1, N // 6)):
    if mode == 'turn': piv.rotation_euler = (tilt, 0, 2 * math.pi * i / N)
    else: piv.rotation_euler = (0, 0, tilt); sc.frame_set(int(f0 + (f1 - f0) * i / N))
    a0, a1 = bounds(); mn = mathutils.Vector(map(min, mn, a0)); mx = mathutils.Vector(map(max, mx, a1))
c = (mn + mx) / 2; ext = mx - mn
cam_d = bpy.data.cameras.new('cam'); cam_d.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam
side = mode != 'turn'
if side:  # glTF +Y up -> Blender +Z up; the character faces -Y: look from +X to see it run sideways
    cam.location = c + mathutils.Vector((10, 0, 0)); cam_d.ortho_scale = max(ext.y, ext.z) * 1.12
else:
    cam.location = c + mathutils.Vector((0, -10, 0)); cam_d.ortho_scale = max(ext.x, ext.z) * 1.12
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_d.clip_end = 100; cam_d.clip_start = 0.001
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[1].default_value = 1.2
for loc, e in [((4, -6, 8), 4.0), ((-6, -3, 2), 1.5), ((0, 6, 4), 2.0)]:
    l = bpy.data.lights.new('l', 'SUN'); l.energy = e; lo = bpy.data.objects.new('l', l); sc.collection.objects.link(lo)
    lo.rotation_euler = (mathutils.Vector((0, 0, 0)) - mathutils.Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'BLENDER_EEVEE'
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = PX
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
os.makedirs(out, exist_ok=True)
for i in range(N):
    if mode == 'turn': piv.rotation_euler = (tilt, 0, 2 * math.pi * i / N)
    else: piv.rotation_euler = (0, 0, tilt); sc.frame_set(int(round(f0 + (f1 - f0) * i / N)))
    sc.render.filepath = os.path.join(out, 'f%03d.png' % i); bpy.ops.render.render(write_still=True)
print('SPRITES', out, N)
