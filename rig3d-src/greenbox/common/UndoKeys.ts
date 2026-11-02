/*
 * Undo / redo for every Greenbox page.
 *   keys     Ctrl+Z (Windows) / Cmd+Z (Mac) = undo, Ctrl+Shift+Z / Cmd+Shift+Z = redo (Ctrl+Y also redoes).
 *            Read from e.code (the physical key), so it works with Shift (e.key is then "Z"), Caps Lock and
 *            Vietnamese / Korean input methods.
 *   History  snapshots of a page's state: begin() before an edit, commit() after it; a commit that changed
 *            nothing is dropped. watch(panel) / watch_canvas(canvas) turn every click, change and drag there
 *            into one undo step, so pages do not have to call it from each button.
 */
export type UndoAction = 'undo' | 'redo' | null

export function undo_action (e: KeyboardEvent): UndoAction {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const k = e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : e.key.toLowerCase()
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (k === 'y' && !e.shiftKey) return 'redo'
  return null
}

/** a text field has the keys (let the browser undo the typing there) */
export function typing (e: Event): boolean {
  const t = e.target as HTMLElement | null
  if (t === null) return false
  if (t.isContentEditable) return true
  if (t.tagName === 'TEXTAREA') return true
  return t.tagName === 'INPUT' && /^(text|number|search|email|url|password|)$/.test((t as HTMLInputElement).type)
}

export class History<T> {
  private readonly undos: T[] = []
  private readonly redos: T[] = []
  private pending: T | null = null
  private timer = 0
  public on_change: (() => void) | null = null

  constructor (
    private readonly take: () => T,
    private readonly apply: (s: T) => void,
    private readonly same: (a: T, b: T) => boolean = (a, b) => a === b,
    private readonly max = 60
  ) {}

  /** the state before an edit (kept until commit; a second begin keeps the first) */
  public begin (): void { if (this.pending === null) this.pending = this.take() }

  /** after the edit: one undo step if something changed */
  public commit (): void {
    clearTimeout(this.timer)
    if (this.pending === null) return
    const before = this.pending; this.pending = null
    if (this.same(before, this.take())) return
    this.undos.push(before); if (this.undos.length > this.max) this.undos.shift()
    this.redos.length = 0
    this.on_change?.()
  }

  /** commit a little later (async buttons, the end of a drag) */
  public commit_soon (ms = 60): void { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.commit(), ms) }

  public undo (): boolean {
    this.commit()
    const s = this.undos.pop(); if (s === undefined) return false
    this.redos.push(this.take()); this.apply(s); this.on_change?.()
    return true
  }

  public redo (): boolean {
    this.commit()
    const s = this.redos.pop(); if (s === undefined) return false
    this.undos.push(this.take()); this.apply(s); this.on_change?.()
    return true
  }

  public can_undo (): boolean { return this.undos.length > 0 || this.pending !== null }
  public can_redo (): boolean { return this.redos.length > 0 }
  public clear (): void { this.undos.length = 0; this.redos.length = 0; this.pending = null }

  /** every click / change / typed value inside a panel is an undo step */
  public watch (el: HTMLElement): void {
    el.addEventListener('pointerdown', () => this.begin(), true)
    el.addEventListener('focusin', () => this.begin(), true)
    el.addEventListener('change', () => this.commit_soon(), true)
    el.addEventListener('click', () => this.commit_soon(), true)
    el.addEventListener('focusout', () => this.commit_soon(), true)
  }

  /** drags / clicks on the 3D view (when `when()` says the view is being edited) are undo steps */
  public watch_canvas (el: HTMLElement, when: () => boolean = () => true): void {
    el.addEventListener('pointerdown', (e) => { if (e.button === 0 && when()) { this.commit(); this.begin() } }, true) // each click / stroke is its own step
    addEventListener('pointerup', () => { if (this.pending !== null) this.commit_soon(30) })
  }

  /** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z on this window (skipped while typing in a text field) */
  public bind_keys (enabled: () => boolean = () => true): void {
    addEventListener('keydown', (e) => {
      const a = undo_action(e); if (a === null || typing(e) || !enabled()) return
      e.preventDefault(); e.stopImmediatePropagation()
      if (a === 'undo') this.undo(); else this.redo()
    }, true)
  }
}
