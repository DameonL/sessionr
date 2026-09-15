import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeReturnUrl, rememberReturnUrl } from './returnUrl'

const KEY = 'sessionr.returnUrl'

/** Stand in for the page the user is on when a sign-in redirect fires. */
function at(url: string) {
  window.history.replaceState({}, '', url)
}

describe('returnUrl', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
    at('/')
  })

  it('round-trips the page the user was on', () => {
    at('/tunes/42')
    rememberReturnUrl()
    expect(consumeReturnUrl()).toBe('/tunes/42')
  })

  it('keeps the query string and hash', () => {
    at('/tunes?q=reel&page=2#results')
    rememberReturnUrl()
    expect(consumeReturnUrl()).toBe('/tunes?q=reel&page=2#results')
  })

  it('persists across the redirect boundary', () => {
    at('/practice/queue')
    rememberReturnUrl()
    // The redirect navigates away and every module is re-evaluated on return;
    // only sessionStorage carries the intent across that boundary.
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ url: '/practice/queue' })
  })

  it('forgets a page recorded too long ago to still be a sign-in round trip', () => {
    at('/repertoire')
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    rememberReturnUrl()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 11 * 60 * 1000)
    expect(consumeReturnUrl()).toBeNull()
  })

  it('still returns a page recorded just within the window', () => {
    at('/repertoire')
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    rememberReturnUrl()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 9 * 60 * 1000)
    expect(consumeReturnUrl()).toBe('/repertoire')
  })

  it('treats corrupt stored state as nothing remembered', () => {
    sessionStorage.setItem(KEY, 'not json{')
    expect(consumeReturnUrl()).toBeNull()
    sessionStorage.setItem(KEY, JSON.stringify({ url: 42, at: Date.now() }))
    expect(consumeReturnUrl()).toBeNull()
  })

  it('consumes once, so a later plain reload does not bounce the user', () => {
    at('/repertoire')
    rememberReturnUrl()
    expect(consumeReturnUrl()).toBe('/repertoire')
    expect(consumeReturnUrl()).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('returns null when nothing was remembered', () => {
    expect(consumeReturnUrl()).toBeNull()
  })

  it.each(['/', '/login'])('does not remember %s, where sign-in starts', (path) => {
    at(path)
    rememberReturnUrl()
    expect(consumeReturnUrl()).toBeNull()
  })

  it('clears a stale entry when sign-in restarts from /login', () => {
    at('/repertoire')
    rememberReturnUrl()
    at('/login')
    rememberReturnUrl()
    expect(consumeReturnUrl()).toBeNull()
  })

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)'])(
    'rejects %s rather than handing it to the router',
    (value) => {
      // Anything that can run script in this origin can write the key; the value
      // is untrusted on the way out.
      sessionStorage.setItem(KEY, JSON.stringify({ url: value, at: Date.now() }))
      expect(consumeReturnUrl()).toBeNull()
      expect(sessionStorage.getItem(KEY)).toBeNull()
    },
  )

  it('survives a sessionStorage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    at('/tunes/42')
    expect(() => rememberReturnUrl()).not.toThrow()
    expect(consumeReturnUrl()).toBeNull()
  })
})
