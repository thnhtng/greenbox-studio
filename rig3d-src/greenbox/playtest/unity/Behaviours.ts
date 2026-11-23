/*
 * Unity MonoBehaviours that ship in the .unitypackage (namespace Greenbox). The map editor lets you attach them to
 * map objects (a dropdown on the selected object); GreenboxMapBuilder (Editor) adds them in Unity with the options.
 * Keep the C# plain (Unity 2021.3+, no packages): Physics triggers, coroutines, built-in ParticleSystem.
 */
export interface BehaviourOption { key: string, en: string, vi: string, kind: 'enum' | 'number' | 'bool', values?: string[], def: string | number | boolean, min?: number, max?: number, step?: number }
export interface BehaviourDef { type: string, en: string, vi: string, hint_en: string, hint_vi: string, options: BehaviourOption[], file: string, needs?: string[] }

const PATH: BehaviourOption = { key: 'path', en: 'Flight', vi: 'Kiểu bay', kind: 'enum', values: ['Arc', 'Straight'], def: 'Arc' }
const INTERVAL: BehaviourOption = { key: 'interval', en: 'Seconds between items', vi: 'Giây giữa 2 món', kind: 'number', def: 0.08, min: 0.02, max: 1, step: 0.01 }

/* ---------------- shared helpers ---------------- */
const GBFLIGHT = `using System;
using System.Collections;
using UnityEngine;

namespace Greenbox
{
    public enum GBPath { Arc, Straight }

    /// <summary>Moves an item to a slot of a parent (or a world point): along an arc (a hop) or straight in.</summary>
    public static class GBFlight
    {
        public static IEnumerator Fly(Transform item, Transform parent, Vector3 localTarget, GBPath path, float duration, float arcHeight, Action done = null)
        {
            if (item == null) yield break;
            Vector3 start = item.position;
            Quaternion r0 = item.rotation;
            float t = 0f;
            while (t < 1f && item != null)
            {
                t = Mathf.Min(1f, t + Time.deltaTime / Mathf.Max(0.01f, duration));
                float ease = 1f - Mathf.Pow(1f - t, 3f);
                Vector3 end = parent != null ? parent.TransformPoint(localTarget) : localTarget;
                Vector3 p = Vector3.LerpUnclamped(start, end, path == GBPath.Arc ? t : ease);
                if (path == GBPath.Arc) p.y += Mathf.Sin(t * Mathf.PI) * arcHeight;
                item.position = p;
                item.rotation = Quaternion.Slerp(r0, parent != null ? parent.rotation : Quaternion.identity, ease);
                yield return null;
            }
            if (item != null && parent != null)
            {
                item.SetParent(parent, true);
                item.localPosition = localTarget;
                item.localRotation = Quaternion.identity;
            }
            done?.Invoke();
        }

        /// <summary>A trigger box around the object's visible size (zones, water, doors).</summary>
        public static BoxCollider EnsureTrigger(GameObject go, float pad = 0.2f, float minHeight = 1.5f)
        {
            var box = go.GetComponent<BoxCollider>();
            if (box == null)
            {
                box = go.AddComponent<BoxCollider>();
                var rs = go.GetComponentsInChildren<Renderer>();
                if (rs.Length > 0)
                {
                    Bounds b = rs[0].bounds;
                    foreach (var r in rs) b.Encapsulate(r.bounds);
                    Vector3 c = go.transform.InverseTransformPoint(b.center);
                    Vector3 s = go.transform.InverseTransformVector(b.size);
                    s = new Vector3(Mathf.Abs(s.x) + pad, Mathf.Max(Mathf.Abs(s.y), minHeight), Mathf.Abs(s.z) + pad);
                    box.center = new Vector3(c.x, Mathf.Max(c.y, s.y * 0.5f), c.z);
                    box.size = s;
                }
            }
            box.isTrigger = true;
            return box;
        }

        /// <summary>Something that can trigger zones: the player (tag Player), a CharacterController or a carrier.</summary>
        public static bool IsActor(Component c)
        {
            if (c == null) return false;
            return c.CompareTag("Player") || c.GetComponentInParent<CharacterController>() != null || c.GetComponentInParent<StackCarrier>() != null;
        }

        /// <summary>A simple stand-in item (a green bill) when no prefab is set.</summary>
        public static Transform MakeItem(GameObject prefab, Transform parent)
        {
            GameObject go;
            if (prefab != null) go = UnityEngine.Object.Instantiate(prefab, parent);
            else
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "Item";
                go.transform.SetParent(parent, false);
                go.transform.localScale = new Vector3(0.6f, 0.1f, 0.32f);
                var col = go.GetComponent<Collider>(); if (col != null) UnityEngine.Object.Destroy(col);
                var rend = go.GetComponent<Renderer>();
                if (rend != null) rend.material.color = new Color(0.25f, 0.75f, 0.35f);
            }
            return go.transform;
        }
    }
}
`

const GBSTACK = `using System.Collections.Generic;
using UnityEngine;

namespace Greenbox
{
    /// <summary>A stack of items in a grid (columns x rows per layer, then up). Base of carrier / pickup / drop zones.</summary>
    public class GBStack : MonoBehaviour
    {
        [Header("Stack layout")]
        public int columns = 1;
        public int rows = 1;
        public Vector3 spacing = new Vector3(0.65f, 0.12f, 0.4f);
        public Vector3 origin = new Vector3(0f, 0.1f, 0f);
        public int capacity = 60;

        [HideInInspector] public List<Transform> items = new List<Transform>();

        public bool Full => items.Count >= capacity;
        public int Count => items.Count;

        public Vector3 SlotLocal(int i)
        {
            int per = Mathf.Max(1, columns * rows);
            int layer = i / per, k = i % per;
            int cx = k % Mathf.Max(1, columns), cz = k / Mathf.Max(1, columns);
            return origin + new Vector3((cx - (columns - 1) * 0.5f) * spacing.x, layer * spacing.y, (cz - (rows - 1) * 0.5f) * spacing.z);
        }

        public Vector3 NextSlot => SlotLocal(items.Count);
        public void Reserve(Transform t) { items.Add(t); }

        public Transform Pop()
        {
            if (items.Count == 0) return null;
            var t = items[items.Count - 1];
            items.RemoveAt(items.Count - 1);
            return t;
        }
    }
}
`

/* ---------------- behaviours ---------------- */
export const BEHAVIOURS: BehaviourDef[] = [
  {
    type: 'StackCarrier', en: 'Stack carrier (player)', vi: 'Cõng chồng đồ (nhân vật)',
    hint_en: 'Put on the player: money / items stack on its back and sway when it runs.', hint_vi: 'Gắn vào nhân vật: tiền / đồ xếp chồng sau lưng, lắc nhẹ khi chạy.',
    options: [{ key: 'capacity', en: 'Max items', vi: 'Tối đa', kind: 'number', def: 40, min: 1, max: 200, step: 1 }],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>Items stack on the back of the player and lean a little with its movement.</summary>
    public class StackCarrier : GBStack
    {
        public float sway = 6f;
        Vector3 lastPos;
        Vector3 lean;

        [SerializeField, HideInInspector] bool configured;

        void Reset() { columns = 1; rows = 1; origin = new Vector3(0f, 1.1f, -0.45f); spacing = new Vector3(0f, 0.12f, 0f); configured = true; }

        void Awake() { if (!configured) Reset(); lastPos = transform.position; }

        void LateUpdate()
        {
            Vector3 v = (transform.position - lastPos) / Mathf.Max(Time.deltaTime, 0.0001f);
            lastPos = transform.position;
            Vector3 local = transform.InverseTransformDirection(v);
            lean = Vector3.Lerp(lean, new Vector3(-local.x, 0f, -local.z) * 0.01f * sway, Time.deltaTime * 8f);
            for (int i = 0; i < items.Count; i++)
            {
                if (items[i] == null || items[i].parent != transform) continue;
                float k = i / Mathf.Max(1f, items.Count - 1f);
                items[i].localPosition = SlotLocal(i) + lean * k * k;
            }
        }
    }
}
`
  },
  {
    type: 'StackPickupZone', en: 'Pickup pile (money on the ground)', vi: 'Đống tiền / đồ nhận',
    hint_en: 'A pile already stacked on the ground: when the carrier walks in, items pop out one by one and fly into its stack.', hint_vi: 'Đống xếp sẵn dưới đất: nhân vật đi vào thì từng cục bung lên rồi bay vào chồng sau lưng.',
    options: [{ key: 'startCount', en: 'Items at start', vi: 'Số món lúc đầu', kind: 'number', def: 12, min: 0, max: 200, step: 1 }, PATH, INTERVAL],
    file: `using System.Collections;
using UnityEngine;

namespace Greenbox
{
    /// <summary>A ready pile: the carrier walks in, each item pops up then flies into the carrier's stack.</summary>
    public class StackPickupZone : GBStack
    {
        public GameObject itemPrefab;
        public int startCount = 12;
        public GBPath path = GBPath.Arc;
        public float interval = 0.08f;
        public float flightTime = 0.35f;
        public float popHeight = 0.6f;
        float next;

        void Reset() { columns = 2; rows = 2; }

        void Start()
        {
            GBFlight.EnsureTrigger(gameObject);
            for (int i = 0; i < startCount; i++)
            {
                var t = GBFlight.MakeItem(itemPrefab, transform);
                t.localPosition = NextSlot;
                Reserve(t);
            }
        }

        void OnTriggerStay(Collider other)
        {
            if (Time.time < next || Count == 0) return;
            var carrier = other.GetComponentInParent<StackCarrier>();
            if (carrier == null || carrier.Full) return;
            next = Time.time + interval;
            var item = Pop();
            if (item == null) return;
            Vector3 slot = carrier.NextSlot;
            carrier.Reserve(item);
            StartCoroutine(PopThenFly(item, carrier.transform, slot));
        }

        IEnumerator PopThenFly(Transform item, Transform carrier, Vector3 slot)
        {
            item.SetParent(null, true);
            Vector3 a = item.position, b = a + Vector3.up * popHeight + Random.insideUnitSphere * 0.25f;
            for (float t = 0f; t < 1f; t += Time.deltaTime / 0.12f) { item.position = Vector3.Lerp(a, b, 1f - (1f - t) * (1f - t)); yield return null; }
            yield return GBFlight.Fly(item, carrier, slot, path, flightTime, 0.8f);
        }
    }
}
`
  },
  {
    type: 'StackDropZone', en: 'Drop node (dashed cell / table)', vi: 'Ô node nhận đồ (ô nét đứt / bàn)',
    hint_en: 'The carrier walks in: its items fly down onto this node (arc or straight) and stack here.', hint_vi: 'Nhân vật đi vào ô: đồ trên lưng bay xuống ô (vòng cung hoặc thẳng) rồi xếp chồng tại đây.',
    options: [PATH, INTERVAL, { key: 'columns', en: 'Columns', vi: 'Số cột', kind: 'number', def: 2, min: 1, max: 8, step: 1 }, { key: 'rows', en: 'Rows', vi: 'Số hàng', kind: 'number', def: 2, min: 1, max: 8, step: 1 }],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>The carrier gives its items to this node (ground cell, table…): they fly here and stack in a grid.</summary>
    public class StackDropZone : GBStack
    {
        public GBPath path = GBPath.Arc;
        public float interval = 0.08f;
        public float flightTime = 0.35f;
        public float arcHeight = 1.2f;
        float next;

        void Reset() { columns = 2; rows = 2; }

        void Start() { GBFlight.EnsureTrigger(gameObject); }

        void OnTriggerStay(Collider other)
        {
            if (Time.time < next || Full) return;
            var carrier = other.GetComponentInParent<StackCarrier>();
            if (carrier == null || carrier.Count == 0) return;
            next = Time.time + interval;
            var item = carrier.Pop();
            if (item == null) return;
            Vector3 slot = NextSlot;
            Reserve(item);
            item.SetParent(null, true);
            StartCoroutine(GBFlight.Fly(item, transform, slot, path, flightTime, path == GBPath.Arc ? arcHeight : 0f));
        }
    }
}
`
  },
  {
    type: 'OreDrill', en: '⛏ Ore: drill it, gems burst out', vi: '⛏ Quặng: khoan vào, ngọc văng ra',
    hint_en: 'Put on an ore rock. A carrier with DrillPower touches it: it shakes, a gem bursts out in an arc onto the carrier every interval; after N gems it crumbles and grows back.', hint_vi: 'Gắn vào cục quặng. Xe (có DrillPower) chạm vào: đá rung, mỗi nhịp một viên ngọc bắn vòng cung lên xe; đủ số ngọc thì đá vỡ rồi mọc lại.',
    options: [{ key: 'gems', en: 'Gems before it breaks', vi: 'Số ngọc rồi vỡ', kind: 'number', def: 6, min: 1, max: 50, step: 1 }, { key: 'interval', en: 'Seconds per gem', vi: 'Giây mỗi viên', kind: 'number', def: 0.45, min: 0.05, max: 5, step: 0.05 }, { key: 'respawn', en: 'Grows back after (s)', vi: 'Mọc lại sau (giây)', kind: 'number', def: 3.5, min: 0, max: 60, step: 0.5 }, { key: 'value', en: '$ per gem', vi: '$ mỗi viên', kind: 'number', def: 5, min: 0, max: 1000, step: 1 }],
    file: `using System.Collections;
using UnityEngine;

namespace Greenbox
{
    /// <summary>How fast this carrier digs (the evolved drill digs faster). Put it on the player vehicle.</summary>
    public class DrillPower : MonoBehaviour
    {
        public float speed = 1f;
        public int level;
    }

    /// <summary>The value of one gem when it is sold (SellNode reads it).</summary>
    public class GemValue : MonoBehaviour { public int value = 5; }

    /// <summary>An ore rock: a carrier with DrillPower touching it digs gems out of it; it crumbles after N gems and grows back.</summary>
    public class OreDrill : MonoBehaviour
    {
        public GameObject gemPrefab;            // empty = a small glowing octahedron-like cube in gemColor
        public Color gemColor = new Color(1f, 0.55f, 0.15f);
        public int gems = 6;
        public float interval = 0.45f;
        public float respawn = 3.5f;
        public int value = 5;
        public float burstHeight = 1.6f;
        public float shake = 0.06f;
        int left;
        float timer;
        bool gone;
        Vector3 baseScale;
        Quaternion baseRot;

        void Start() { GBFlight.EnsureTrigger(gameObject); left = gems; baseScale = transform.localScale; baseRot = transform.localRotation; }

        void OnTriggerStay(Collider other)
        {
            if (gone) return;
            var drill = other.GetComponentInParent<DrillPower>();
            var carrier = other.GetComponentInParent<StackCarrier>();
            if (drill == null || carrier == null || carrier.Full) return;
            transform.localRotation = baseRot * Quaternion.Euler(Random.Range(-1f, 1f) * shake * 57f, 0f, Random.Range(-1f, 1f) * shake * 57f);
            timer += Time.deltaTime * Mathf.Max(0.1f, drill.speed);
            if (timer < interval) return;
            timer = 0f;
            var gem = MakeGem();
            Vector3 slot = carrier.NextSlot;
            carrier.Reserve(gem);
            StartCoroutine(Burst(gem, carrier.transform, slot));
            if (--left <= 0) StartCoroutine(Crumble());
        }

        void OnTriggerExit(Collider other) { transform.localRotation = baseRot; }

        Transform MakeGem()
        {
            GameObject g = gemPrefab != null ? Instantiate(gemPrefab) : GameObject.CreatePrimitive(PrimitiveType.Cube);
            if (gemPrefab == null)
            {
                g.transform.localScale = Vector3.one * 0.3f; g.transform.rotation = Quaternion.Euler(45f, 0f, 45f);
                Destroy(g.GetComponent<Collider>());
                var r = g.GetComponent<Renderer>(); r.material.color = gemColor; r.material.EnableKeyword("_EMISSION"); r.material.SetColor("_EmissionColor", gemColor * 0.4f);
            }
            g.AddComponent<GemValue>().value = value;
            g.transform.position = transform.position + Vector3.up * 1.2f;
            return g.transform;
        }

        // up and out in an arc first, then onto the carrier's stack
        IEnumerator Burst(Transform gem, Transform carrier, Vector3 slotLocal)
        {
            Vector3 a = gem.position; Vector3 b = a + new Vector3(Random.Range(-1.2f, 1.2f), burstHeight, Random.Range(-1.2f, 1.2f));
            for (float t = 0f; t < 1f; t += Time.deltaTime / 0.25f) { gem.position = Vector3.Lerp(a, b, 1f - (1f - t) * (1f - t)); gem.Rotate(0f, 720f * Time.deltaTime, 0f); yield return null; }
            yield return GBFlight.Fly(gem, carrier, slotLocal, GBPath.Arc, 0.3f, 0.8f);
        }

        IEnumerator Crumble()
        {
            gone = true;
            for (float t = 0f; t < 1f; t += Time.deltaTime / 0.3f) { transform.localScale = baseScale * (1f - t); yield return null; }
            foreach (var r in GetComponentsInChildren<Renderer>()) r.enabled = false;
            yield return new WaitForSeconds(respawn);
            foreach (var r in GetComponentsInChildren<Renderer>()) r.enabled = true;
            for (float t = 0f; t < 1f; t += Time.deltaTime / 0.35f) { transform.localScale = baseScale * Mathf.SmoothStep(0f, 1f, t); yield return null; }
            transform.localScale = baseScale; transform.localRotation = baseRot; left = gems; gone = false;
        }
    }
}
`
  },
  {
    type: 'SellNode', en: '💵 Sell node: gems in, money out', vi: '💵 Ô bán: ngọc vào, tiền ra',
    hint_en: 'The carrier drives in: its gems fly into the node and are sold (GemValue each, else the price here); the money goes to GBWallet and bills pop up.', hint_vi: 'Xe chạy vào ô: ngọc trên xe bay vào ô và được bán (theo GemValue, không có thì theo giá ở đây); tiền cộng vào GBWallet, tờ tiền bật lên.',
    options: [INTERVAL, { key: 'price', en: '$ per item (no GemValue)', vi: '$ mỗi món (không có GemValue)', kind: 'number', def: 5, min: 0, max: 1000, step: 1 }],
    file: `using System.Collections;
using UnityEngine;

namespace Greenbox
{
    /// <summary>The player's money. UI can read GBWallet.Money and listen to OnChange.</summary>
    public static class GBWallet
    {
        public static int Money;
        public static System.Action<int> OnChange;
        public static void Add(int v) { Money += v; OnChange?.Invoke(Money); }
        public static bool Spend(int v) { if (Money < v) return false; Money -= v; OnChange?.Invoke(Money); return true; }
    }

    /// <summary>Sells what the carrier brings: each item flies in, is destroyed, and its value goes to the wallet.</summary>
    public class SellNode : MonoBehaviour
    {
        public float interval = 0.08f;
        public int price = 5;
        public GameObject billPrefab;   // optional: a bill that pops up for each sale
        float next;

        void Start() { GBFlight.EnsureTrigger(gameObject); }

        void OnTriggerStay(Collider other)
        {
            if (Time.time < next) return;
            var carrier = other.GetComponentInParent<StackCarrier>();
            if (carrier == null || carrier.Count == 0) return;
            next = Time.time + interval;
            var item = carrier.Pop(); if (item == null) return;
            item.SetParent(null, true);
            var gv = item.GetComponent<GemValue>();
            StartCoroutine(Sell(item, gv != null ? gv.value : price));
        }

        IEnumerator Sell(Transform item, int value)
        {
            yield return GBFlight.Fly(item, transform, Vector3.up * 0.4f, GBPath.Arc, 0.3f, 1f);
            Destroy(item.gameObject);
            GBWallet.Add(value);
            if (billPrefab != null) { var b = Instantiate(billPrefab, transform.position + Vector3.up, Quaternion.identity); Destroy(b, 0.8f); }
        }
    }
}
`
  },
  {
    type: 'DrillUpgrade', en: '⬆ Upgrade pad: evolve the drill', vi: '⬆ Ô nâng cấp: tiến hoá mũi khoan',
    hint_en: 'The player stands on it: money from GBWallet pays it bit by bit. When paid, the player becomes the evolved model (DrillPower ×2) and the objects listed in unlock appear.', hint_vi: 'Xe đứng trên ô: tiền trong GBWallet trả dần. Trả đủ thì xe biến thành model tiến hoá (DrillPower ×2) và các vật trong danh sách unlock hiện ra.',
    options: [{ key: 'price', en: '$ to pay', vi: '$ cần trả', kind: 'number', def: 60, min: 1, max: 100000, step: 1 }, { key: 'speedUp', en: 'Drill speed ×', vi: 'Tốc độ khoan ×', kind: 'number', def: 2, min: 1, max: 10, step: 0.5 }],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>A $ pad: pay it by standing on it, then the drill evolves and new areas open.</summary>
    public class DrillUpgrade : MonoBehaviour
    {
        public int price = 60;
        public float speedUp = 2f;
        public GameObject evolvedModel;     // the new look (prefab): placed under the player, its old renderers hidden
        public GameObject[] unlock;         // objects that appear when paid (new ores, …)
        public float payRate = 0.05f;
        int paid;
        float next;

        void Start()
        {
            GBFlight.EnsureTrigger(gameObject);
            foreach (var g in unlock) if (g != null) g.SetActive(false);
        }

        void OnTriggerStay(Collider other)
        {
            if (paid >= price || Time.time < next) return;
            var drill = other.GetComponentInParent<DrillPower>(); if (drill == null) return;
            next = Time.time + payRate;
            int step = Mathf.Max(1, Mathf.CeilToInt(price / 25f));
            step = Mathf.Min(step, price - paid);
            if (!GBWallet.Spend(step)) return;
            paid += step;
            if (paid >= price) Evolve(drill);
        }

        void Evolve(DrillPower drill)
        {
            drill.level++; drill.speed *= speedUp;
            if (evolvedModel != null)
            {
                foreach (var r in drill.GetComponentsInChildren<Renderer>()) r.enabled = false;
                var m = Instantiate(evolvedModel, drill.transform); m.transform.localPosition = Vector3.zero; m.transform.localRotation = Quaternion.identity;
            }
            foreach (var g in unlock) if (g != null) g.SetActive(true);
            gameObject.SetActive(false);
        }
    }
}
`
  },
  {
    type: 'AutoDoor', en: 'Door opens / closes', vi: 'Cửa tự mở / đóng',
    hint_en: 'Swings open when someone comes close, closes after they leave.', hint_vi: 'Có người lại gần thì cửa mở, đi xa thì tự đóng.',
    options: [{ key: 'openAngle', en: 'Open angle', vi: 'Góc mở', kind: 'number', def: 100, min: 30, max: 170, step: 5 }, { key: 'radius', en: 'Distance', vi: 'Khoảng cách', kind: 'number', def: 2.5, min: 0.5, max: 8, step: 0.5 }],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>Opens round its hinge when an actor is near, closes when it leaves. Leaf = the moving part.</summary>
    public class AutoDoor : MonoBehaviour
    {
        public Transform leaf;
        public float openAngle = 100f;
        public float radius = 2.5f;
        public float speed = 6f;
        Quaternion closed;
        bool open;
        float check;

        void Start()
        {
            if (leaf == null) leaf = transform.childCount > 0 ? transform.GetChild(transform.childCount - 1) : transform;
            closed = leaf.localRotation;
        }

        void Update()
        {
            if (Time.time >= check)
            {
                check = Time.time + 0.1f;
                open = false;
                foreach (var c in Physics.OverlapSphere(transform.position, radius))
                    if (GBFlight.IsActor(c)) { open = true; break; }
            }
            Quaternion want = open ? closed * Quaternion.Euler(0f, openAngle, 0f) : closed;
            leaf.localRotation = Quaternion.Slerp(leaf.localRotation, want, Time.deltaTime * speed);
        }
    }
}
`
  },
  {
    type: 'GrassBend', en: 'Grass bends away', vi: 'Cỏ dạt sang bên',
    hint_en: 'Blades lean away from feet walking through, then spring back.', hint_vi: 'Đi qua thì ngọn cỏ dạt ra hai bên, đi rồi thì bật lại.',
    options: [{ key: 'radius', en: 'Reach', vi: 'Bán kính', kind: 'number', def: 1.2, min: 0.3, max: 4, step: 0.1 }, { key: 'strength', en: 'Bend', vi: 'Độ dạt', kind: 'number', def: 60, min: 10, max: 85, step: 5 }],
    file: `using System.Collections.Generic;
using UnityEngine;

namespace Greenbox
{
    /// <summary>Every child blade leans away from actors within reach and springs back after.</summary>
    public class GrassBend : MonoBehaviour
    {
        public float radius = 1.2f;
        public float strength = 60f;
        public float spring = 8f;
        readonly List<Transform> blades = new List<Transform>();
        readonly List<Quaternion> rest = new List<Quaternion>();
        readonly List<Transform> actors = new List<Transform>();
        float scan;

        void Start()
        {
            foreach (Transform c in transform) { blades.Add(c); rest.Add(c.localRotation); }
            if (blades.Count == 0) { blades.Add(transform); rest.Add(transform.localRotation); }
        }

        void Update()
        {
            if (Time.time >= scan)
            {
                scan = Time.time + 0.2f;
                actors.Clear();
                foreach (var c in Physics.OverlapSphere(transform.position, radius + 3f))
                    if (GBFlight.IsActor(c)) actors.Add(c.transform);
            }
            for (int i = 0; i < blades.Count; i++)
            {
                Transform b = blades[i];
                Quaternion want = rest[i];
                foreach (var a in actors)
                {
                    Vector3 d = b.position - a.position; d.y = 0f;
                    float k = 1f - d.magnitude / radius;
                    if (k <= 0f) continue;
                    Vector3 axis = Vector3.Cross(Vector3.up, d.normalized);
                    want = Quaternion.AngleAxis(strength * k, b.parent != null ? b.parent.InverseTransformDirection(axis) : axis) * rest[i];
                }
                b.localRotation = Quaternion.Slerp(b.localRotation, want, Time.deltaTime * spring);
            }
        }
    }
}
`
  },
  {
    type: 'WaterSplash', en: 'Water splash', vi: 'Nước bắn lên',
    hint_en: 'Something walks or falls into the water: a splash of drops.', hint_vi: 'Nhân vật / vật rơi vào nước thì nước bắn tung lên.',
    options: [{ key: 'drops', en: 'Drops', vi: 'Số giọt', kind: 'number', def: 40, min: 5, max: 200, step: 5 }],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>On the water: anything entering it throws up a burst of drops (a ParticleSystem made at run time).</summary>
    public class WaterSplash : MonoBehaviour
    {
        public int drops = 40;
        public Color color = new Color(0.75f, 0.9f, 1f, 0.9f);
        public float cooldown = 0.25f;
        float next;

        void Start() { GBFlight.EnsureTrigger(gameObject, 0f, 0.6f); }

        void OnTriggerEnter(Collider other)
        {
            if (Time.time < next) return;
            next = Time.time + cooldown;
            Vector3 p = other.bounds.center; p.y = GetComponent<Collider>().bounds.max.y;
            Splash(p);
        }

        public void Splash(Vector3 at)
        {
            var go = new GameObject("Splash");
            go.transform.position = at;
            go.transform.rotation = Quaternion.Euler(-90f, 0f, 0f);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.duration = 0.5f; main.loop = false;
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.5f, 0.9f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(2.5f, 5f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.06f, 0.16f);
            main.startColor = color;
            main.gravityModifier = 1.2f;
            var emission = ps.emission; emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, (short)drops) });
            var shape = ps.shape; shape.shapeType = ParticleSystemShapeType.Cone; shape.angle = 28f; shape.radius = 0.25f;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.material = new Material(Shader.Find("Sprites/Default"));
            ps.Play();
            Destroy(go, 2f);
        }
    }
}
`
  },
  {
    type: 'WaterFlow', en: 'Water flows', vi: 'Nước chảy',
    hint_en: 'The water texture slides along and pushes what floats in it.', hint_vi: 'Mặt nước trôi theo một hướng và đẩy vật trong nước đi theo.',
    options: [{ key: 'speed', en: 'Speed', vi: 'Tốc độ', kind: 'number', def: 1.5, min: 0, max: 8, step: 0.1 }],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>Scrolls the water texture along the object's forward axis and pushes rigidbodies / characters inside.</summary>
    public class WaterFlow : MonoBehaviour
    {
        public float speed = 1.5f;
        public float push = 4f;
        Renderer rend;

        void Start() { rend = GetComponentInChildren<Renderer>(); GBFlight.EnsureTrigger(gameObject, 0f, 0.8f); }

        void Update()
        {
            if (rend != null && rend.material.mainTexture != null)
                rend.material.mainTextureOffset += new Vector2(0f, speed * 0.1f * Time.deltaTime);
        }

        void OnTriggerStay(Collider other)
        {
            Vector3 dir = transform.forward * speed;
            var rb = other.attachedRigidbody;
            if (rb != null && !rb.isKinematic) rb.AddForce(dir * push, ForceMode.Acceleration);
            var cc = other.GetComponentInParent<CharacterController>();
            if (cc != null) cc.Move(dir * 0.35f * Time.deltaTime);
        }
    }
}
`
  },
  {
    type: 'SawBlade', en: 'Saw (cuts things)', vi: 'Máy cưa (cắt đứt)',
    hint_en: 'Spins; anything with Cuttable that touches it is cut in two.', hint_vi: 'Lưỡi cưa quay; vật có gắn "Bị cưa đứt" chạm vào thì đứt làm đôi.',
    options: [{ key: 'spin', en: 'Spin speed', vi: 'Tốc độ quay', kind: 'number', def: 720, min: 0, max: 2000, step: 30 }],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>A spinning blade (the first child, or itself). Cuttable things touching it split in two.</summary>
    public class SawBlade : MonoBehaviour
    {
        public Transform blade;
        public float spin = 720f;
        public Vector3 axis = Vector3.forward;

        void Start()
        {
            if (blade == null) blade = FindBlade(transform) ?? transform;
            GBFlight.EnsureTrigger(gameObject, 0.1f, 0.5f);
        }

        void Update() { blade.Rotate(axis, spin * Time.deltaTime, Space.Self); }

        static Transform FindBlade(Transform t)
        {
            foreach (Transform c in t)
            {
                if (c.name.ToLowerInvariant().Contains("blade")) return c;
                var r = FindBlade(c);
                if (r != null) return r;
            }
            return null;
        }

        void OnTriggerEnter(Collider other)
        {
            var c = other.GetComponentInParent<Cuttable>();
            if (c != null) c.Cut(transform.position, transform.right);
        }
    }
}
`
  },
  {
    type: 'Cuttable', en: 'Cut by a saw', vi: 'Bị cưa đứt',
    hint_en: 'Splits into two falling halves when a saw touches it.', hint_vi: 'Chạm máy cưa thì tách làm hai nửa rơi xuống.',
    options: [],
    file: `using UnityEngine;

namespace Greenbox
{
    /// <summary>Splits into two halves (copies cut along its longest side) that fall apart.</summary>
    public class Cuttable : MonoBehaviour
    {
        public float push = 2.5f;
        bool done;

        public void Cut(Vector3 point, Vector3 normal)
        {
            if (done) return;
            done = true;
            var rs = GetComponentsInChildren<Renderer>();
            Bounds b = rs.Length > 0 ? rs[0].bounds : new Bounds(transform.position, Vector3.one);
            foreach (var r in rs) b.Encapsulate(r.bounds);
            Vector3 s = b.size;
            int ax = s.x >= s.y && s.x >= s.z ? 0 : (s.y >= s.z ? 1 : 2);
            for (int k = -1; k <= 1; k += 2)
            {
                var half = Instantiate(gameObject, transform.parent);
                Destroy(half.GetComponent<Cuttable>());
                Vector3 sc = half.transform.localScale; sc[ax] *= 0.5f; half.transform.localScale = sc;
                Vector3 off = Vector3.zero; off[ax] = s[ax] * 0.25f * k;
                half.transform.position = transform.position + off;
                foreach (var col in half.GetComponentsInChildren<Collider>()) col.isTrigger = false;
                if (half.GetComponentInChildren<Collider>() == null) half.AddComponent<BoxCollider>();
                var rb = half.GetComponent<Rigidbody>();
                if (rb == null) rb = half.AddComponent<Rigidbody>();
                rb.isKinematic = false;
                rb.AddForce((off.normalized + Vector3.up * 0.5f) * push, ForceMode.VelocityChange);
            }
            Destroy(gameObject);
        }
    }
}
`
  },
  {
    type: 'Spinner', en: 'Spins / bobs', vi: 'Xoay / nhấp nhô',
    hint_en: 'Turns slowly and bobs up and down (coins, pickups, signs).', hint_vi: 'Xoay chậm và nhấp nhô (đồng xu, vật nhặt, biển báo).',
    options: [{ key: 'turn', en: 'Turn (°/s)', vi: 'Xoay (°/giây)', kind: 'number', def: 90, min: 0, max: 720, step: 10 }, { key: 'bob', en: 'Bob height', vi: 'Độ nhấp nhô', kind: 'number', def: 0.15, min: 0, max: 1, step: 0.05 }],
    file: `using UnityEngine;

namespace Greenbox
{
    public class Spinner : MonoBehaviour
    {
        public float turn = 90f;
        public float bob = 0.15f;
        public float bobSpeed = 2f;
        Vector3 start;

        void Start() { start = transform.localPosition; }

        void Update()
        {
            transform.Rotate(0f, turn * Time.deltaTime, 0f, Space.World);
            transform.localPosition = start + Vector3.up * Mathf.Sin(Time.time * bobSpeed) * bob;
        }
    }
}
`
  }
]

/** shared files every package gets */
export const SHARED_FILES: Array<{ name: string, file: string }> = [{ name: 'GBFlight', file: GBFLIGHT }, { name: 'GBStack', file: GBSTACK }]

/** behaviours a map object gets by default (shown pre-picked, the user can remove them) */
export const DEFAULT_BEHAVIOURS: Record<string, string[]> = {
  'role:ore': ['OreDrill'], 'role:counter': ['SellNode'], 'role:unlock': ['DrillUpgrade'], 'role:player': ['StackCarrier'],
  node: ['StackDropZone'], money: ['StackPickupZone'], table: ['StackDropZone'], grass: ['GrassBend'], saw: ['SawBlade'], door: ['AutoDoor'], crate: ['Cuttable'], barrel: ['Cuttable']
}
