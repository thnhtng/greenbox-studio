/*
 * .unitypackage writer: a gzip'd tar where every asset is a folder named by its GUID holding
 *   asset       the file itself
 *   asset.meta  Unity's meta (the same GUID)
 *   pathname    where it goes, e.g. Assets/Supercent/PizzaReady/053/Scripts/Greenbox/StackCarrier.cs
 * Made in the browser (CompressionStream gzip), no server.
 */
import { BEHAVIOURS, SHARED_FILES } from './Behaviours.ts'

export interface PackageLayout { root: string, scripts: string, behaviours: string, models: string, data: string, all: boolean }
export const DEFAULT_LAYOUT: PackageLayout = { root: 'Greenbox/Map', scripts: 'Scripts', behaviours: 'Greenbox', models: 'Models', data: 'Data', all: false }

const enc = new TextEncoder()
const clean = (p: string): string => p.split(/[\\/]+/).map(s => s.trim().replace(/[<>:"|?*]/g, '')).filter(s => s !== '' && s !== '.' && s !== '..').join('/')

/** the folders of the package, ready to show as a tree and to use as Unity paths */
export function package_paths (L: PackageLayout): { root: string, scripts: string, behaviours: string, editor: string, models: string, data: string } {
  const root = 'Assets/' + (clean(L.root) || 'Greenbox')
  const scripts = root + '/' + (clean(L.scripts) || 'Scripts')
  return { root, scripts, behaviours: scripts + '/' + (clean(L.behaviours) || 'Greenbox'), editor: scripts + '/Editor', models: root + '/' + (clean(L.models) || 'Models'), data: root + '/' + (clean(L.data) || 'Data') }
}

function guid (): string { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join('') }

function meta (g: string, kind: 'script' | 'model' | 'text' | 'folder' | 'texture'): string {
  const head = `fileFormatVersion: 2\nguid: ${g}\n`
  if (kind === 'texture') return head + 'TextureImporter:\n  serializedVersion: 12\n  mipmaps:\n    enableMipMap: 1\n    sRGBTexture: 1\n  isReadable: 0\n  textureType: 0\n  textureShape: 1\n  maxTextureSize: 2048\n  textureSettings:\n    filterMode: 1\n    wrapU: 1\n    wrapV: 1\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n'
  if (kind === 'folder') return head + 'folderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n'
  if (kind === 'script') return head + 'MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n'
  if (kind === 'text') return head + 'TextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n'
  return head + 'ModelImporter:\n  serializedVersion: 22200\n  externalObjects: {}\n  materials:\n    materialImportMode: 2\n  animations:\n    importAnimation: 0\n  meshes:\n    globalScale: 1\n    addColliders: 1\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n'
}

/* ---------------- tar (ustar) ---------------- */
function tar_header (name: string, size: number, dir = false): Uint8Array {
  const h = new Uint8Array(512)
  const put = (s: string, off: number, len: number): void => { const b = enc.encode(s); h.set(b.subarray(0, len), off) }
  const oct = (n: number, len: number): string => n.toString(8).padStart(len - 1, '0') + '\0'
  put(name, 0, 100); put(oct(dir ? 0o755 : 0o644, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8)
  put(oct(size, 12), 124, 12); put(oct(Math.floor(Date.now() / 1000), 12), 136, 12)
  put('        ', 148, 8); h[156] = dir ? 53 : 48 // '5' dir, '0' file
  put('ustar\0', 257, 6); put('00', 263, 2)
  let sum = 0; for (let i = 0; i < 512; i++) sum += h[i]
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

function tar (files: Array<{ name: string, data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = []
  const dirs = new Set<string>()
  for (const f of files) {
    const d = f.name.split('/')[0] + '/'
    if (!dirs.has(d)) { dirs.add(d); parts.push(tar_header(d, 0, true)) }
    parts.push(tar_header(f.name, f.data.length), f.data)
    const pad = (512 - (f.data.length % 512)) % 512; if (pad > 0) parts.push(new Uint8Array(pad))
  }
  parts.push(new Uint8Array(1024))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

async function gzip (data: Uint8Array): Promise<Blob> {
  const cs = new CompressionStream('gzip')
  return await new Response(new Blob([data as unknown as BlobPart]).stream().pipeThrough(cs)).blob()
}

/* ---------------- the Editor script that sets the map up in a scene ---------------- */
function builder_script (model: string, data: string, terrain: string, matdir: string): string {
  return `#if UNITY_EDITOR
using System;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>Greenbox ▸ Build map in scene: puts the exported map in the open scene and adds the MonoBehaviours picked in Greenbox.</summary>
public static class GreenboxMapBuilder
{
    const string MODEL = "${model}";
    const string DATA = "${data}";
    const string TERRAIN = "${terrain}";
    const string MATS = "${matdir}";

    [MenuItem("Greenbox/Build map in scene")]
    public static void Build()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(MODEL);
        if (prefab == null) { EditorUtility.DisplayDialog("Greenbox", "Map model not found:\\n" + MODEL, "OK"); return; }
        var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        root.name = "Greenbox Map";
        Undo.RegisterCreatedObjectUndo(root, "Greenbox map");
        var text = AssetDatabase.LoadAssetAtPath<TextAsset>(DATA);
        int added = 0, missing = 0;
        if (text != null)
        {
            var map = JsonUtility.FromJson<GBMapData>(text.text);
            foreach (var o in map.objects)
            {
                var t = FindDeep(root.transform, o.name);
                if (t == null) { missing++; continue; }
                foreach (var b in o.behaviours)
                {
                    var type = Type.GetType("Greenbox." + b.type + ", Assembly-CSharp");
                    if (type == null) continue;
                    var c = t.gameObject.GetComponent(type);
                    if (c == null) c = Undo.AddComponent(t.gameObject, type);
                    foreach (var kv in b.options) SetField(c, kv.key, kv.value);
                    added++;
                }
            }
        }
        // solid walls / props: mesh colliders on everything that has none
        foreach (var mf in root.GetComponentsInChildren<MeshFilter>())
            if (mf.GetComponent<Collider>() == null) mf.gameObject.AddComponent<MeshCollider>();
        int coloured = FixColours(root);
        var player = AddPlayer(root);
        Selection.activeGameObject = root;
        EditorUtility.DisplayDialog("Greenbox", "Map placed. Behaviours added: " + added + (missing > 0 ? "\\nObjects not found by name: " + missing : "") + "\\nColoured materials: " + coloured + "\\nPlayer: " + (player != null ? player.name + " (WASD, Shift, Space, Q/E or right-drag)" : "none") + "\\n\\nPress Play.", "OK");
    }

    /* ---------------- colours ---------------- */
    // Greenbox names every material after its colour: GB_rrggbb, GB_rrggbb_aa (aa = alpha %), GB_Water_rrggbb_aa,
    // GB_Terrain (the ground: a picture of its colours, Data/greenbox-terrain.png, on its uv).
    [MenuItem("Greenbox/Fix map colours")]
    public static void FixColoursMenu()
    {
        var root = Selection.activeGameObject != null ? Selection.activeGameObject : GameObject.Find("Greenbox Map");
        if (root == null) { EditorUtility.DisplayDialog("Greenbox", "Select the map (or name it Greenbox Map) first.", "OK"); return; }
        EditorUtility.DisplayDialog("Greenbox", "Coloured materials: " + FixColours(root), "OK");
    }

    static Shader LitShader()
    {
        var rp = GraphicsSettings.currentRenderPipeline;
        Shader s = null;
        if (rp != null) s = rp.GetType().Name.Contains("HD") ? Shader.Find("HDRP/Lit") : Shader.Find("Universal Render Pipeline/Lit");
        return s != null ? s : Shader.Find("Standard");
    }

    static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path)) return;
        var parent = System.IO.Path.GetDirectoryName(path).Replace("\\\\", "/");
        EnsureFolder(parent);
        AssetDatabase.CreateFolder(parent, System.IO.Path.GetFileName(path));
    }

    static Material MakeMat(string name, Color c, Texture tex, float smooth)
    {
        EnsureFolder(MATS);
        var path = MATS + "/" + name + ".mat";
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        var sh = LitShader();
        if (m == null) { m = new Material(sh); AssetDatabase.CreateAsset(m, path); } else m.shader = sh;
        m.SetColor("_BaseColor", c); m.SetColor("_Color", c);
        if (tex != null) { m.SetTexture("_BaseMap", tex); m.SetTexture("_MainTex", tex); m.SetTexture("_BaseColorMap", tex); }
        m.SetFloat("_Metallic", 0f); m.SetFloat("_Smoothness", smooth); m.SetFloat("_Glossiness", smooth);
        if (c.a < 0.99f)
        {
            if (sh.name == "Standard")
            {
                m.SetFloat("_Mode", 3); m.SetInt("_SrcBlend", (int)BlendMode.One); m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha); m.SetInt("_ZWrite", 0);
                m.DisableKeyword("_ALPHATEST_ON"); m.DisableKeyword("_ALPHABLEND_ON"); m.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            }
            else
            {
                m.SetFloat("_Surface", 1); m.SetFloat("_Blend", 0); m.SetFloat("_SurfaceType", 1);
                m.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha); m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha); m.SetInt("_ZWrite", 0);
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); m.SetOverrideTag("RenderType", "Transparent");
            }
            m.renderQueue = (int)RenderQueue.Transparent;
        }
        EditorUtility.SetDirty(m);
        return m;
    }

    static readonly Regex GB = new Regex(@"GB_(Water_)?([0-9a-fA-F]{6})(?:_(\\d+))?");

    public static int FixColours(GameObject root)
    {
        int n = 0;
        var ground = AssetDatabase.LoadAssetAtPath<Texture2D>(TERRAIN);
        foreach (var r in root.GetComponentsInChildren<Renderer>(true))
        {
            var mats = r.sharedMaterials; bool changed = false;
            for (int i = 0; i < mats.Length; i++)
            {
                if (mats[i] == null) continue;
                var name = mats[i].name;
                if (name.StartsWith("GB_Terrain"))
                {
                    var mf = r.GetComponent<MeshFilter>();
                    bool uv = mf != null && mf.sharedMesh != null && mf.sharedMesh.uv != null && mf.sharedMesh.uv.Length > 0;
                    mats[i] = MakeMat("GB_Terrain", uv && ground != null ? Color.white : new Color(0.37f, 0.62f, 0.27f), uv ? ground : null, 0.05f);
                    changed = true; n++; continue;
                }
                var g = GB.Match(name);
                if (!g.Success) continue;
                Color c; ColorUtility.TryParseHtmlString("#" + g.Groups[2].Value, out c);
                c.a = g.Groups[3].Success ? int.Parse(g.Groups[3].Value) / 100f : 1f;
                mats[i] = MakeMat(g.Value, c, null, g.Groups[1].Success ? 0.85f : 0.15f);
                changed = true; n++;
            }
            if (changed) { Undo.RecordObject(r, "Greenbox colours"); r.sharedMaterials = mats; }
        }
        AssetDatabase.SaveAssets();
        return n;
    }

    /* ---------------- player ---------------- */
    [MenuItem("Greenbox/Add player")]
    public static void AddPlayerMenu()
    {
        var p = AddPlayer(GameObject.Find("Greenbox Map"));
        if (p != null) Selection.activeGameObject = p;
    }

    static Transform FindPrefix(Transform t, string prefix)
    {
        if (t.name.StartsWith(prefix)) return t;
        foreach (Transform c in t) { var r = FindPrefix(c, prefix); if (r != null) return r; }
        return null;
    }

    /// <summary>A capsule player (tag Player) with GreenboxPlayer (WASD + follow camera), next to the 🚩 flag or in the middle of the map, on the ground. Kept when one is already tagged Player.</summary>
    public static GameObject AddPlayer(GameObject root)
    {
        GameObject old = null;
        try { old = GameObject.FindWithTag("Player"); } catch (Exception) { }
        if (old != null) return old;
        var spawn = Vector3.zero;
        if (root != null)
        {
            var flag = FindPrefix(root.transform, "flag");
            if (flag != null) spawn = flag.position + new Vector3(1.5f, 0, 0);
            else { var rs = root.GetComponentsInChildren<Renderer>(); if (rs.Length > 0) { var b = rs[0].bounds; foreach (var r in rs) b.Encapsulate(r.bounds); spawn = b.center; } }
        }
        Physics.SyncTransforms();
        RaycastHit hit;
        if (Physics.Raycast(new Vector3(spawn.x, spawn.y + 300f, spawn.z), Vector3.down, out hit, 1000f)) spawn = hit.point;
        var p = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        p.name = "Player";
        try { p.tag = "Player"; } catch (Exception) { }
        UnityEngine.Object.DestroyImmediate(p.GetComponent<CapsuleCollider>());
        p.transform.position = spawn + Vector3.up * 1.05f;
        var cc = p.AddComponent<CharacterController>(); cc.height = 2f; cc.radius = 0.4f; cc.center = Vector3.zero; cc.stepOffset = 0.45f;
        var nose = GameObject.CreatePrimitive(PrimitiveType.Cube); nose.name = "Front";
        UnityEngine.Object.DestroyImmediate(nose.GetComponent<BoxCollider>());
        nose.transform.SetParent(p.transform, false); nose.transform.localPosition = new Vector3(0, 0.45f, 0.42f); nose.transform.localScale = new Vector3(0.35f, 0.15f, 0.25f);
        p.GetComponent<Renderer>().sharedMaterial = MakeMat("GB_Player", new Color(0.18f, 0.44f, 0.87f), null, 0.3f);
        nose.GetComponent<Renderer>().sharedMaterial = MakeMat("GB_PlayerFront", new Color(1f, 0.82f, 0.2f), null, 0.3f);
        var t = Type.GetType("Greenbox.GreenboxPlayer, Assembly-CSharp"); if (t != null) p.AddComponent(t);
        var carrier = Type.GetType("Greenbox.StackCarrier, Assembly-CSharp"); if (carrier != null) p.AddComponent(carrier);
        if (Camera.main == null) { var cam = new GameObject("Main Camera"); cam.tag = "MainCamera"; cam.AddComponent<Camera>(); cam.AddComponent<AudioListener>(); Undo.RegisterCreatedObjectUndo(cam, "Greenbox camera"); }
        Undo.RegisterCreatedObjectUndo(p, "Greenbox player");
        return p;
    }

    static Transform FindDeep(Transform t, string name)
    {
        if (t.name == name) return t;
        foreach (Transform c in t) { var r = FindDeep(c, name); if (r != null) return r; }
        return null;
    }

    static void SetField(Component c, string key, string value)
    {
        var f = c.GetType().GetField(key);
        if (f == null) return;
        try
        {
            object v;
            if (f.FieldType == typeof(int)) v = (int)Math.Round(double.Parse(value, System.Globalization.CultureInfo.InvariantCulture));
            else if (f.FieldType == typeof(float)) v = float.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
            else if (f.FieldType == typeof(bool)) v = value == "true" || value == "1";
            else if (f.FieldType.IsEnum) v = Enum.Parse(f.FieldType, value);
            else v = value;
            f.SetValue(c, v);
        }
        catch (Exception) { }
    }

    [Serializable] public class GBMapData { public GBObj[] objects = new GBObj[0]; }
    [Serializable] public class GBObj { public string name; public GBBeh[] behaviours = new GBBeh[0]; }
    [Serializable] public class GBBeh { public string type; public GBKV[] options = new GBKV[0]; }
    [Serializable] public class GBKV { public string key; public string value; }
}
#endif
`
}

/** the player the builder adds: WASD / arrows, Shift sprint, Space jump, Q / E or right-drag turn, wheel zoom; old or new Input System */
const PLAYER_SCRIPT = `using UnityEngine;
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
using UnityEngine.InputSystem;
#endif

namespace Greenbox
{
    /// <summary>Greenbox player: walk / run / jump with a CharacterController and a third-person camera behind it.</summary>
    [RequireComponent(typeof(CharacterController))]
    public class GreenboxPlayer : MonoBehaviour
    {
        public float walkSpeed = 4.5f, sprintSpeed = 7.5f, jumpHeight = 1.2f, gravity = -20f;
        public bool controlCamera = true;
        public float camDistance = 7f, camPitch = 22f, turnSpeed = 140f;
        CharacterController cc; Vector3 vel; float yaw;

        void Start() { cc = GetComponent<CharacterController>(); yaw = transform.eulerAngles.y; }

#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
        static bool K(Key k) { var kb = Keyboard.current; return kb != null && kb[k].isPressed; }
        Vector2 Move() { return new Vector2((K(Key.D) || K(Key.RightArrow) ? 1 : 0) - (K(Key.A) || K(Key.LeftArrow) ? 1 : 0), (K(Key.W) || K(Key.UpArrow) ? 1 : 0) - (K(Key.S) || K(Key.DownArrow) ? 1 : 0)); }
        bool Sprint() { return K(Key.LeftShift); }
        bool Jump() { var kb = Keyboard.current; return kb != null && kb.spaceKey.wasPressedThisFrame; }
        float Turn() { float t = (K(Key.E) ? 1 : 0) - (K(Key.Q) ? 1 : 0); var m = Mouse.current; if (m != null && m.rightButton.isPressed) t += m.delta.ReadValue().x * 0.15f; return t; }
        float Zoom() { var m = Mouse.current; return m != null ? m.scroll.ReadValue().y / 120f : 0f; }
#else
        Vector2 Move() { return new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical")); }
        bool Sprint() { return Input.GetKey(KeyCode.LeftShift); }
        bool Jump() { return Input.GetKeyDown(KeyCode.Space); }
        float Turn() { float t = (Input.GetKey(KeyCode.E) ? 1 : 0) - (Input.GetKey(KeyCode.Q) ? 1 : 0); if (Input.GetMouseButton(1)) t += Input.GetAxis("Mouse X") * 3f; return t; }
        float Zoom() { return Input.mouseScrollDelta.y; }
#endif

        void Update()
        {
            yaw += Turn() * turnSpeed * Time.deltaTime;
            camDistance = Mathf.Clamp(camDistance - Zoom(), 2.5f, 25f);
            var mv = Move();
            var rot = Quaternion.Euler(0, yaw, 0);
            var dir = rot * new Vector3(mv.x, 0, mv.y);
            if (dir.sqrMagnitude > 1f) dir.Normalize();
            if (dir.sqrMagnitude > 0.001f) transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir), 12f * Time.deltaTime);
            if (cc.isGrounded && vel.y < 0) vel.y = -2f;
            if (cc.isGrounded && Jump()) vel.y = Mathf.Sqrt(jumpHeight * -2f * gravity);
            vel.y += gravity * Time.deltaTime;
            cc.Move((dir * (Sprint() ? sprintSpeed : walkSpeed) + Vector3.up * vel.y) * Time.deltaTime);
        }

        void LateUpdate()
        {
            if (!controlCamera) return;
            var cam = Camera.main; if (cam == null) return;
            var target = transform.position + Vector3.up * 0.9f;
            cam.transform.position = target - Quaternion.Euler(camPitch, yaw, 0) * Vector3.forward * camDistance;
            cam.transform.LookAt(target);
        }
    }
}
`

export interface PackObject { name: string, behaviours: Array<{ type: string, options: Record<string, string | number | boolean> }> }

/** the whole package: map model (FBX), the behaviours (used ones or all), the builder, the map data */
export async function build_unitypackage (L: PackageLayout, fbx: Uint8Array, map_json: string, objects: PackObject[], terrain_png?: Uint8Array): Promise<{ blob: Blob, files: string[] }> {
  const P = package_paths(L)
  const used = new Set(objects.flatMap(o => o.behaviours.map(b => b.type)))
  if (used.has('SawBlade')) used.add('Cuttable')
  if (used.has('StackDropZone') || used.has('StackPickupZone')) used.add('StackCarrier') // the player needs it for the zones to work
  const assets: Array<{ path: string, data: Uint8Array, kind: 'script' | 'model' | 'text' | 'folder' | 'texture' }> = []
  for (const f of SHARED_FILES) assets.push({ path: `${P.behaviours}/${f.name}.cs`, data: enc.encode(f.file), kind: 'script' })
  for (const b of BEHAVIOURS) if (L.all || used.has(b.type)) assets.push({ path: `${P.behaviours}/${b.type}.cs`, data: enc.encode(b.file), kind: 'script' })
  const model = `${P.models}/GreenboxMap.fbx`; const data = `${P.data}/greenbox-behaviours.json`
  const terrain = `${P.data}/greenbox-terrain.png`
  assets.push({ path: `${P.editor}/GreenboxMapBuilder.cs`, data: enc.encode(builder_script(model, data, terrain, `${P.data}/Materials`)), kind: 'script' })
  assets.push({ path: `${P.behaviours}/GreenboxPlayer.cs`, data: enc.encode(PLAYER_SCRIPT), kind: 'script' })
  if (terrain_png !== undefined) assets.push({ path: terrain, data: terrain_png, kind: 'texture' })
  assets.push({ path: model, data: fbx, kind: 'model' })
  const beh = { objects: objects.filter(o => o.behaviours.length > 0).map(o => ({ name: o.name, behaviours: o.behaviours.map(b => ({ type: b.type, options: Object.entries(b.options).map(([key, value]) => ({ key, value: String(value) })) })) })) }
  assets.push({ path: data, data: enc.encode(JSON.stringify(beh, null, 2)), kind: 'text' })
  assets.push({ path: `${P.data}/greenbox-map.json`, data: enc.encode(map_json), kind: 'text' })
  assets.push({ path: `${P.root}/README.txt`, data: enc.encode(readme(P)), kind: 'text' })
  // the folders too, so Unity shows them even when empty of the user's own files
  const folders = new Set<string>()
  for (const a of assets) { const parts = a.path.split('/'); for (let i = 2; i < parts.length; i++) folders.add(parts.slice(0, i).join('/')) }
  const files: Array<{ name: string, data: Uint8Array }> = []
  for (const f of [...folders].sort()) { const g = guid(); files.push({ name: `${g}/asset.meta`, data: enc.encode(meta(g, 'folder')) }, { name: `${g}/pathname`, data: enc.encode(f) }) }
  for (const a of assets) {
    const g = guid()
    files.push({ name: `${g}/asset`, data: a.data }, { name: `${g}/asset.meta`, data: enc.encode(meta(g, a.kind)) }, { name: `${g}/pathname`, data: enc.encode(a.path) })
  }
  return { blob: await gzip(tar(files)), files: assets.map(a => a.path) }
}

function readme (P: ReturnType<typeof package_paths>): string {
  return `GREENBOX MAP FOR UNITY

1. Assets > Import Package > Custom Package… > this .unitypackage
2. Menu Greenbox > Build map in scene: the map is placed, every object gets the behaviours picked in Greenbox,
   the colours are rebuilt (URP / HDRP / Built-in), the water is see-through, and a Player is added
   (capsule tagged Player, GreenboxPlayer: WASD / arrows, Shift run, Space jump, Q/E or right-drag turn, wheel zoom).
   Press Play.
3. Your own character instead: delete the capsule, tag yours "Player", add a CharacterController + Greenbox.GreenboxPlayer
   (+ Greenbox.StackCarrier for the stacking zones).
4. Colours white again (re-imported)? Select the map, menu Greenbox > Fix map colours. No player? Greenbox > Add player.

Folders
  ${P.models}   the map (FBX)
  ${P.behaviours}   the MonoBehaviours (namespace Greenbox)
  ${P.editor}   the builder (Editor only)
  ${P.data}   greenbox-behaviours.json (which object gets what), greenbox-map.json (the whole map)

Behaviours
${BEHAVIOURS.map(b => `  ${b.type.padEnd(16)} ${b.hint_en}`).join('\n')}
`
}
