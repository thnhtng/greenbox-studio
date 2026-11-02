import bpy, sys, json
p = sys.argv[sys.argv.index('--') + 1]
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
if p.lower().endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=p)
else: bpy.ops.import_scene.gltf(filepath=p)
out = {'objects': [], 'actions': []}
for o in bpy.data.objects:
    e = {'name': o.name, 'type': o.type, 'parent': o.parent.name if o.parent else None, 'dims': [round(x, 2) for x in o.dimensions]}
    if o.type == 'MESH': e['verts'] = len(o.data.vertices); e['groups'] = [g.name for g in o.vertex_groups][:40]; e['loc'] = [round(x, 2) for x in o.matrix_world.translation]
    if o.type == 'ARMATURE': e['bones'] = [(b.name, b.parent.name if b.parent else None) for b in o.data.bones]
    if o.animation_data and o.animation_data.action: e['action'] = o.animation_data.action.name
    out['objects'].append(e)
for a in bpy.data.actions:
    fr = a.frame_range
    out['actions'].append([a.name, round(fr[1] - fr[0], 1)])
print('JSON' + json.dumps(out))
