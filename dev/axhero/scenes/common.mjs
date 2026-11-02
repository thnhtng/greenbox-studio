// shared steps for the recordings
export const UPLOAD = (sel, files) => `
  const dt = new DataTransfer();
  for (const [url, name] of ${JSON.stringify(files)}) { const b = await (await fetch(url)).blob(); dt.items.add(new File([b], name, { type: b.type })); }
  const input = document.querySelector('${sel}'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  return dt.files.length;`
export const SKIP_TOUR = `document.querySelectorAll('button').forEach(b => { if (/^(Skip|Bỏ qua)$/.test(b.textContent.trim())) b.click(); }); return true;`
export async function english (nav, ev) {
  await nav('Greenbox-Cockpit.html')
  await ev(`localStorage.setItem('gbc.lang', 'en'); return true`)
}
// the character to rig: CHAR='[["/_tmp_shot/x.glb","x.glb"]]' picks another file (default: the Hero FBX + its texture)
export const CHAR = process.env.CHAR ? JSON.parse(process.env.CHAR) : [['/_tmp_shot/hero.fbx', 'Hero1.fbx'], ['/_tmp_shot/Hero1.png', 'Hero1.png']]
// after loading: turn the model to face the front (ROTY = how many 90° turns around Y) and stand it on the floor
export async function face_front (ev, wait) {
  const n = Number(process.env.ROTY ?? 0)
  for (let i = 0; i < n; i++) { await ev(`document.querySelector('#rotate-model-y-button').click(); return 1`); await wait(700) }
  if (n > 0) { await ev(`document.querySelector('#auto-align-model-button').click(); return 1`); await wait(900) }
}
