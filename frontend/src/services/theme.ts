import { Signal } from '../state/appState'

/**
 * 'system' follows the OS. The other two are an explicit override.
 *
 * The override is expressed as `data-theme` on <html>; 'system' *removes* the
 * attribute rather than writing a resolved value, so the
 * `prefers-color-scheme` block in index.css keeps working and the page tracks
 * the OS live — including a change made while the tab is open.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_KEY = 'sessionapp.theme'

const DEFAULT_THEME: ThemePreference = 'system'

/** Kept in sync with the --bg token for each palette in index.css. */
const THEME_COLOR: Record<'light' | 'dark', string> = {
  dark: '#121212',
  light: '#f5f4f2',
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (isThemePreference(raw)) return raw
  } catch {
    // Private mode / storage disabled — fall through to the OS preference.
  }
  return DEFAULT_THEME
}

export function saveThemePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Non-fatal: the choice just won't survive a reload.
  }
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true
}

/** What the user will actually see, with 'system' collapsed to a real palette. */
export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (prefersDark() ? 'dark' : 'light') : pref
}

/**
 * Address bar / status bar tint. The static tag in index.html is dark-only, so
 * without this the light theme keeps a near-black browser chrome on mobile.
 */
function applyThemeColor(resolved: 'light' | 'dark') {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved])
}

export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
  applyThemeColor(resolveTheme(pref))
}

export const themePreference = new Signal<ThemePreference>(DEFAULT_THEME)

export function setThemePreference(pref: ThemePreference) {
  themePreference.value = pref
  saveThemePreference(pref)
  applyTheme(pref)
}

/**
 * Called once at startup, before React mounts, so the first paint is already in
 * the right palette. Also keeps the theme-color tag correct when the OS flips
 * while we are on 'system'.
 */
export function initTheme() {
  const pref = loadThemePreference()
  themePreference.value = pref
  applyTheme(pref)

  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themePreference.value === 'system') applyTheme('system')
    })
  }
}
