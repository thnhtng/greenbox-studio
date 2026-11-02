import bpy, sys, os, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
for path in argv:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
    c = sum(pts, mathutils.Vector()) / len(pts); r = max((p - c).length for p in pts)
    scn = bpy.context.scene
    cam_d = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_d); scn.collection.objects.link(cam)
    cam.location = c + mathutils.Vector((r * 2.2, -r * 2.2, r * 1.2)); cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler(); scn.camera = cam
    scn.render.engine = 'BLENDER_WORKBENCH'; scn.render.resolution_x = scn.render.resolution_y = 160; scn.render.film_transparent = True
    scn.display.shading.color_type = 'MATERIAL'
    scn.render.filepath = os.path.join(os.path.dirname(path), 'preview', os.path.basename(path).replace('.glb', '.png')); bpy.ops.render.render(write_still=True)
    print('PREVIEW', scn.render.filepath, 'dims', [round(x, 2) for x in (max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))])
