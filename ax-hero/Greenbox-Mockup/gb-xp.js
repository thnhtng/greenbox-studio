/* Greenbox XP: using the web earns experience, spent in the Arena (🏀 / ⚽) on skills.
     +2  every active minute (a click / key / scroll in the last minute; counted once across all open pages)
     +5  the first time a feature is opened each day (cockpit)
     +15 an export / download click (at most every 8 s)
   Stored in localStorage `gb.xp` = { xp, spent: { skill: level }, best: { sport: score } }.
   Every page that loads this file earns; window.gbXP has load / save / add / level. */
(function () {
  if (window.gbXP) return
  var K = 'gb.xp'
  function load () { try { var d = JSON.parse(localStorage.getItem(K) || 'null'); if (d && typeof d.xp === 'number') { d.spent = d.spent || {}; d.best = d.best || {}; return d } } catch (e) {} return { xp: 0, spent: {}, best: {} } }
  function save (d) { try { localStorage.setItem(K, JSON.stringify(d)) } catch (e) {} }
  /** level from XP: level L needs 40·(L−1)² XP in total */
  function level (xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1 }
  function need (L) { return 40 * (L - 1) * (L - 1) }
  function add (n, why) {
    var d = load(); d.xp += n; save(d)
    try { window.dispatchEvent(new CustomEvent('gb-xp', { detail: { n: n, why: why, xp: d.xp } })) } catch (e) {}
    try { if (window.parent !== window) window.parent.postMessage({ gbXp: n, why: why }, '*') } catch (e) {}
    return d.xp
  }
  function num (k) { try { return Number(localStorage.getItem(k)) || 0 } catch (e) { return 0 } }
  function put (k, v) { try { localStorage.setItem(k, String(v)) } catch (e) {} }
  var act = 0
  ;['pointerdown', 'keydown', 'wheel'].forEach(function (ev) { addEventListener(ev, function () { act = Date.now() }, { passive: true, capture: true }) })
  setInterval(function () {
    if (document.hidden || Date.now() - act > 60000) return
    var now = Date.now(); if (now - num('gb.xp.min') < 55000) return
    put('gb.xp.min', now); add(2, 'minute')
  }, 15000)
  addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button,a,label') : null; if (!b) return
    var t = (b.textContent || '') + ' ' + (b.id || '')
    if (!/xuất|export|⬇|\.mov|mp4|glb|fbx|download|내보내기/i.test(t)) return
    var now = Date.now(); if (now - num('gb.xp.ex') < 8000) return
    put('gb.xp.ex', now); add(15, 'export')
  }, true)
  window.gbXP = { load: load, save: save, add: add, level: level, need: need }
})()
