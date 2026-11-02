# Greenbox controls for a Rigify rig (Blender 4.x / 5.x).
# Sidebar (N) > "Greenbox": IK / FK for each arm and leg. Switching keeps the pose (the new controls are snapped
# onto where the limb is now), so you can block a pose in IK and polish it in FK, like in Greenbox.
# Saved inside the .blend as a text block that registers itself when the file opens (allow "Auto Run Scripts").
import bpy

GB_LIMBS = {
    "arm.L": {"label": "Left arm", "prop": "upper_arm_parent.L",
              "fk": [("upper_arm_fk.L", "ORG-upper_arm.L"), ("forearm_fk.L", "ORG-forearm.L"), ("hand_fk.L", "ORG-hand.L")],
              "ik": [("upper_arm_ik.L", "ORG-upper_arm.L"), ("hand_ik.L", "ORG-hand.L")]},
    "arm.R": {"label": "Right arm", "prop": "upper_arm_parent.R",
              "fk": [("upper_arm_fk.R", "ORG-upper_arm.R"), ("forearm_fk.R", "ORG-forearm.R"), ("hand_fk.R", "ORG-hand.R")],
              "ik": [("upper_arm_ik.R", "ORG-upper_arm.R"), ("hand_ik.R", "ORG-hand.R")]},
    "leg.L": {"label": "Left leg", "prop": "thigh_parent.L",
              "fk": [("thigh_fk.L", "ORG-thigh.L"), ("shin_fk.L", "ORG-shin.L"), ("foot_fk.L", "ORG-foot.L"), ("toe_fk.L", "ORG-toe.L")],
              "ik": [("thigh_ik.L", "ORG-thigh.L"), ("foot_ik.L", "ORG-foot.L"), ("toe_ik.L", "ORG-toe.L")]},
    "leg.R": {"label": "Right leg", "prop": "thigh_parent.R",
              "fk": [("thigh_fk.R", "ORG-thigh.R"), ("shin_fk.R", "ORG-shin.R"), ("foot_fk.R", "ORG-foot.R"), ("toe_fk.R", "ORG-toe.R")],
              "ik": [("thigh_ik.R", "ORG-thigh.R"), ("foot_ik.R", "ORG-foot.R"), ("toe_ik.R", "ORG-toe.R")]},
}
GB_ORDER = ["arm.L", "arm.R", "leg.L", "leg.R"]


def gb_rig(context):
    o = context.object
    if o is not None and o.type == 'ARMATURE' and o.pose is not None and "upper_arm_parent.L" in o.pose.bones:
        return o
    for o in context.scene.objects:
        if o.type == 'ARMATURE' and o.pose is not None and "upper_arm_parent.L" in o.pose.bones:
            return o
    return None


def gb_mode(rig, limb):
    pb = rig.pose.bones.get(GB_LIMBS[limb]["prop"])
    return 'FK' if pb is not None and pb.get("IK_FK", 0.0) > 0.5 else 'IK'


def gb_match(rig, ctrl, target):
    """put control `ctrl` where `target` is now, keeping their rest-pose relation (works for any bone roll)"""
    c = rig.pose.bones.get(ctrl); t = rig.pose.bones.get(target)
    if c is None or t is None:
        return
    c.matrix = t.matrix @ t.bone.matrix_local.inverted() @ c.bone.matrix_local
    bpy.context.view_layer.update()


def gb_set_mode(rig, limb, mode, key=False):
    L = GB_LIMBS[limb]
    for ctrl, org in L["fk" if mode == 'FK' else "ik"]:
        gb_match(rig, ctrl, org)
    pb = rig.pose.bones.get(L["prop"])
    if pb is not None:
        pb["IK_FK"] = 1.0 if mode == 'FK' else 0.0
        if key:
            pb.keyframe_insert('["IK_FK"]')
            for ctrl, _org in L["fk" if mode == 'FK' else "ik"]:
                c = rig.pose.bones.get(ctrl)
                if c is not None:
                    c.keyframe_insert("location"); c.keyframe_insert("rotation_quaternion" if c.rotation_mode == 'QUATERNION' else "rotation_euler")
    rig.update_tag(); bpy.context.view_layer.update()


class GREENBOX_OT_limb_mode(bpy.types.Operator):
    """Switch this limb between IK and FK, keeping the pose"""
    bl_idname = "greenbox.limb_mode"
    bl_label = "IK / FK"
    bl_options = {'REGISTER', 'UNDO'}
    limb: bpy.props.StringProperty()
    mode: bpy.props.StringProperty()

    def execute(self, context):
        rig = gb_rig(context)
        if rig is None:
            self.report({'WARNING'}, "No Rigify rig in this scene")
            return {'CANCELLED'}
        limbs = GB_ORDER if self.limb == "ALL" else [self.limb]
        for l in limbs:
            gb_set_mode(rig, l, self.mode, context.scene.tool_settings.use_keyframe_insert_auto)
        return {'FINISHED'}


class GREENBOX_PT_controls(bpy.types.Panel):
    bl_label = "Greenbox IK / FK"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Greenbox"

    def draw(self, context):
        lay = self.layout
        rig = gb_rig(context)
        if rig is None:
            lay.label(text="Select the Rigify rig")
            return
        for limb in GB_ORDER:
            m = gb_mode(rig, limb)
            row = lay.row(align=True)
            row.label(text=GB_LIMBS[limb]["label"])
            a = row.operator("greenbox.limb_mode", text="IK", depress=(m == 'IK')); a.limb = limb; a.mode = 'IK'
            b = row.operator("greenbox.limb_mode", text="FK", depress=(m == 'FK')); b.limb = limb; b.mode = 'FK'
        row = lay.row(align=True)
        a = row.operator("greenbox.limb_mode", text="All IK"); a.limb = "ALL"; a.mode = 'IK'
        b = row.operator("greenbox.limb_mode", text="All FK"); b.limb = "ALL"; b.mode = 'FK'
        lay.label(text="Pose mode: click a control, R turn, G move", icon='INFO')


GB_CLASSES = (GREENBOX_OT_limb_mode, GREENBOX_PT_controls)


def register():
    for c in GB_CLASSES:
        try:
            bpy.utils.unregister_class(getattr(bpy.types, c.__name__))
        except Exception:
            pass
        bpy.utils.register_class(c)


register()
