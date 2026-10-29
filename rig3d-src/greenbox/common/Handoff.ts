/*
 * Hand a file from one Greenbox 3D page to another (same origin) without downloading it:
 * kept in IndexedDB, read once by the next page.
 */
const DB = 'greenbox3d'
const STORE = 'handoff'

function open_db (): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface HandoffItem { name: string, data: ArrayBuffer, at: number }

export async function handoff_put (key: string, item: HandoffItem): Promise<void> {
  const db = await open_db()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item, key)
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** read and delete */
export async function handoff_take (key: string): Promise<HandoffItem | null> {
  try {
    const db = await open_db()
    const item = await new Promise<HandoffItem | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const st = tx.objectStore(STORE)
      const g = st.get(key)
      g.onsuccess = () => { const v = (g.result as HandoffItem | undefined) ?? null; if (v !== null) st.delete(key); resolve(v) }
      g.onerror = () => reject(g.error)
    })
    db.close()
    return item
  } catch { return null }
}

/** switch to another Greenbox 3D page: inside the cockpit the page stays alive in its own tab */
export function go_to_page (page: string): void {
  if (window.self !== window.top) window.parent.postMessage({ gbNav: page }, '*')
  else location.href = new URL(page, location.href.replace(/[^/]*$/, '')).href
}

/* pages stay alive in the cockpit, so a page that is already open is told about a new hand-off */
const CHANNEL = 'greenbox3d-handoff'
export function handoff_notify (key: string): void {
  try { const c = new BroadcastChannel(CHANNEL); c.postMessage({ key }); c.close() } catch { /* old browser: next page load picks it up */ }
}
export function on_handoff (key: string, cb: () => void): void {
  try { const c = new BroadcastChannel(CHANNEL); c.onmessage = (e) => { if (e.data?.key === key) cb() } } catch { /* ignore */ }
}
