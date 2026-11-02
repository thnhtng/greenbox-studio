# Blender scripts that build Greenbox rig types (run with Blender 5.x)

```
B=/Applications/Blender.app/Contents/MacOS/Blender
# XP Hero player rig (Unity "Player_Model_Skin_Basic_AllAnimations.fbx"): rig, model, 44 clips, 3 weapons, reference png
$B -b -P build_xphero.py -- <Player_Model_Skin_Basic_AllAnimations.fbx> <out folder>
# Snake Clash (Snake012 skin FBX, e.g. FBX/Snakes/Skin_00_Rainbow_0.fbx): rig, model, Idle / eat / eat_backup
$B -b -P build_snakeclash.py -- <Skin_XX.fbx> <out folder>
# weapon props: handle along +Y, head up; then 160 px previews
$B -b -P upright_props.py -- weapon_xp_axe.glb weapon_xp_pickaxe.glb weapon_xp_sword.glb
$B -b -P preview_props.py -- weapon_xp_*.glb
# list objects / bones / actions of any FBX or GLB
$B -b -P inspect.py -- <file>
```

Then copy the outputs into `~/gb-build/mesh2motion-app/static/`:
- `rigs/rig-*.glb`, `rigs/reference/*.png`
- `models/model-*.glb`, `animations/*-animations.glb`
- `props/weapon_xp_*.glb`, `props/preview/*.png`

The rig types are declared in `src/lib/RigConfig.ts` and `src/lib/enums/SkeletonType.ts`; weapons in `PropType.ts` / `PropCatalog.ts`.

Points that matter (each was a bug once):
- The armature's FIRST child must be the root bone. Keep the dummy sphere out of the armature (no parent).
- After `nla.bake` the bones keep the last frame's pose: reset `matrix_basis` before any static export.
- The rest pose is taken standing ("Idle 3" frame 1 for the objects, every bone at rest).
- The Unity weapon sockets' own keys are in other units: the sockets are parented to the hands instead.
