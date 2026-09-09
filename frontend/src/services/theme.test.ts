import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  initTheme,
  loadThemePreference,
  resolveTheme,
  setThemePreference,
  themePreference,
  THEME_KEY,
} from './theme'

function mockPrefersDark(dark: boolean) {
  const listeners: (() => void)[] = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? dark : !dark,
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => {},
    }))
  )
  return { fire: () => listeners.forEach((cb) => cb()) }
}

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.head.innerHTML = '<meta name="theme-color" content="#000000">'
    themePreference.value = 'system'
    mockPrefersDark(true)
  })

  it('defaults to system when nothing is stored', () => {
    expect(loadThemePreference()).toBe('system')
  })

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse')
    expect(loadThemePreference()).toBe('system')
  })

  it('round-trips an explicit choice through storage', () => {
    setThemePreference('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(loadThemePreference()).toBe('light')
  })

  // 'system' must leave the attribute off, or the prefers-color-scheme block in
  // index.css is bypassed and the page stops tracking the OS.
  it('writes data-theme only for an explicit choice', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('resolves system against the OS preference', () => {
    mockPrefersDark(true)
    expect(resolveTheme('system')).toBe('dark')
    mockPrefersDark(false)
    expect(resolveTheme('system')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('retints the theme-color meta to match the resolved palette', () => {
    const meta = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content')
    applyTheme('light')
    expect(meta()).toBe('#f5f4f2')
    applyTheme('dark')
    expect(meta()).toBe('#121212')
  })

  it('follows a live OS change while on system, but not once overridden', () => {
    const { fire } = mockPrefersDark(false)
    initTheme()
    fire()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)

    setThemePreference('dark')
    fire()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
