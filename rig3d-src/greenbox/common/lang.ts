/*
 * Greenbox UI language for messages built in code (static labels are translated by gb-i18n.js).
 * The cockpit can switch language at any time; `on_lang_change` re-runs a renderer when it does.
 */
export type Lang = 0 | 1 | 2 // en, vi, ko

export function lang (): Lang {
  // same rule as gb-i18n.js (?lang=… → cockpit setting when embedded → English): code can run before gb-i18n
  // has set <html lang>, e.g. a status line written while the page is still loading
  const q = (location.search.match(/[?&]lang=(vi|en|ko)/) ?? [])[1]
  let l = q ?? ''
  if (l === '' && window.self !== window.top) { try { l = localStorage.getItem('gbc.lang') ?? 'vi' } catch { l = 'vi' } }
  if (l === '') l = (document.documentElement.lang || 'en').slice(0, 2)
  return l === 'vi' ? 1 : l === 'ko' ? 2 : 0
}

/** pick the text for the current language */
export function M (en: string, vi: string, ko: string): string { return [en, vi, ko][lang()] }

export function on_lang_change (cb: () => void): void {
  new MutationObserver(() => cb()).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
}
