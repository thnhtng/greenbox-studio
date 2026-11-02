# prop GLBs: the handle along +Y (glTF) = Blender +Z, as the prop picker expects; origin kept at the grip
import bpy, sys, math, mathutils
for path in sys.argv[sys.argv.index('--') + 1:]:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.parent is None:
            o.matrix_world = mathutils.Matrix.Rotation(math.pi, 4, "X") @ o.matrix_world
            bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True)
    ms = [o for o in bpy.data.objects if o.type == 'MESH']; pts = [o.matrix_world @ mathutils.Vector(c) for o in ms for c in o.bound_box]
    print('UPRIGHT', path.split('/')[-1], 'z range', round(min(p.z for p in pts), 2), round(max(p.z for p in pts), 2))
