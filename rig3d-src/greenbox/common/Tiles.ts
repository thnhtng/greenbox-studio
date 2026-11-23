/*
 * Picture tiles: turns tool buttons into square cards with a generated picture on top and the name under it
 * (the pictures live in rig3d/images/ui/<id>.webp; a missing picture just leaves the name).
 */
const CSS = `.gb-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:8px;margin:6px 0}
.gb-tiles.wide{grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}
button.gb-tile{display:flex!important;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:8px 4px 7px!important;min-height:84px;border-radius:14px!important;line-height:1.15;text-align:center;font-size:11.5px!important;font-weight:600;white-space:normal}
button.gb-tile img{width:46px;height:46px;object-fit:contain;pointer-events:none;filter:drop-shadow(0 4px 10px rgba(47,233,139,.35));transition:transform 150ms cubic-bezier(0,0,.2,1)}
@media (hover:hover){button.gb-tile:hover img{transform:translateY(-2px) scale(1.06)}}
.gb-tiles.wide button.gb-tile{flex-direction:row;justify-content:flex-start;gap:8px;min-height:56px;padding:6px 10px!important;text-align:left;font-size:12.5px!important}
.gb-tiles.wide button.gb-tile img{width:38px;height:38px}`

let injected = false
function inject (): void {
  if (injected) return
  injected = true
  const s = document.createElement('style'); s.id = 'gb-tiles'; s.textContent = CSS; document.head.appendChild(s)
}

/** the label without the emoji / symbol in front of it */
export function plain_label (t: string): string { return t.replace(/^[^\p{L}\p{N}]+/u, '').trim() }

/** make one button a picture tile (keeps its data-* attributes, title and handlers) */
export function tile (b: HTMLElement, icon: string, label?: string): void {
  inject()
  const text = label ?? plain_label(b.textContent ?? '')
  // no picture for it yet: the emoji in front of the old text stands in
  const sym = (/^[^\p{L}\p{N}]+/u.exec(b.textContent ?? '')?.[0] ?? '').trim()
  b.classList.add('gb-tile'); b.removeAttribute('style')
  b.innerHTML = ''
  const img = document.createElement('img'); img.alt = ''; img.src = `./images/ui/${icon}.webp`
  img.onerror = () => { if (sym === '') { img.remove(); return } const e = document.createElement('i'); e.textContent = sym; e.style.cssText = 'font-style:normal;font-size:30px;line-height:1.2'; img.replaceWith(e) }
  const span = document.createElement('span'); span.textContent = text
  b.append(img, span)
}

/** move these buttons into one tile grid placed where the first one was; rows left empty are removed */
export function tile_grid (buttons: HTMLElement[], icon_of: (b: HTMLElement) => string, wide = false): HTMLDivElement {
  inject()
  const grid = document.createElement('div'); grid.className = 'gb-tiles' + (wide ? ' wide' : '')
  if (buttons.length === 0) return grid
  const first_row = buttons[0].parentElement
  first_row?.before(grid)
  for (const b of buttons) {
    const row = b.parentElement
    grid.append(b); tile(b, icon_of(b))
    if (row !== null && row !== grid && row.children.length === 0 && row.textContent?.trim() === '') row.remove()
  }
  return grid
}
