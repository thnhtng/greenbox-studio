# Greenbox 3D modules (on top of Mesh2Motion, MIT)

Everything Greenbox adds lives here; Mesh2Motion files only get small hooks.

| folder | what |
|---|---|
| `rig/` | Easy mode: BodyScan (joints from the mesh), EasyRig (box select, drag, labels, fingers, cage UI, Blender keys G/X/Y/Z, 1/3/7, F, A), ModelAnalyzer (anchors of any model: geodesic + persistence, accessories) |
| `skin/` | Skin weights: CageWeights (anatomy cage + geodesic labels, human rig only), WeightPaint (brush / eraser / smooth, point-edge-face-piece selection, give-back normalisation) |
| `export/` | Rigify DEF- bone names, Blender Rigify meta-rig script |
| `vehicle/` | VehicleApp (wheels, box select, export, free bones, separate + fill) + Mechanics (door, turret, barrel, blade, boom, hook, cable, track, bone; parenting; clips) + Tracks (caterpillar belts as bone chains) |
| `playtest/` | Play test tab: CharacterController (state machine, feet on the ground), ClipMap (action → clip), PlaytestApp (world, input, camera, record), MapEditor (terrain + objects, JSON / GLB / Blender .py) |
| `mocap/` | Video mocap: PoseTracker (MediaPipe Pose), Retarget (landmarks → clip for any humanoid rig), MocapApp |
| `common/` | lang (VI/EN/KO), Handoff (pass files between tabs), SendCharacter, Mannequin, AnyLoader (every format + clear errors), WireView (mesh view), MeshSplit (cut + fill holes), ViewButtons |

Hooks in Mesh2Motion: `Mesh2MotionEngine.ts` (creates EasyRig, `window.__gb3d`), `lib/solvers/SkinningAlgorithm.ts`
(cage + AI weights), `lib/UI.ts` (friendly bone names), `lib/EventListeners.ts` (EasyRig gets pointer/keys first),
`lib/processes/export-to-file/*` (Rigify naming option). Pages: `create.html`, `vehicle.html`, `playtest.html`, `mocap.html`.
