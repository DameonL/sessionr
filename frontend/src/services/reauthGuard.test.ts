import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canAttemptReauth, claimReauthAttempt, clearReauthAttempts } from './reauthGuard'

const KEY = 'sessionr.reauth'

describe('reauthGuard', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('permits the first attempt and refuses the second', () => {
    expect(claimReauthAttempt()).toBe(true)
    expect(claimReauthAttempt()).toBe(false)
    expect(claimReauthAttempt()).toBe(false)
  })

  it('reports availability without consuming the budget', () => {
    expect(canAttemptReauth()).toBe(true)
    expect(canAttemptReauth()).toBe(true)
    expect(claimReauthAttempt()).toBe(true)
    expect(canAttemptReauth()).toBe(false)
  })

  it('restores the full budget once cleared after a healthy sign-in', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(claimReauthAttempt()).toBe(true)
    expect(claimReauthAttempt()).toBe(false)
    // Well past the cooldown: the session has demonstrably held up.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 61_000)
    clearReauthAttempts()
    expect(canAttemptReauth()).toBe(true)
    expect(claimReauthAttempt()).toBe(true)
  })

  it('ignores a success that arrives on the redirect it is meant to cap', () => {
    // The clear sites fire on the return leg, seconds after the attempt. Honouring
    // them there hands the allowance straight back, so a page that fails again
    // immediately can redirect forever — the sign-in loop this cooldown exists for.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(claimReauthAttempt()).toBe(true)
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 2_000)
    clearReauthAttempts()
    expect(canAttemptReauth()).toBe(false)
    expect(claimReauthAttempt()).toBe(false)
  })

  it('is a no-op when there is nothing to clear', () => {
    clearReauthAttempts()
    expect(canAttemptReauth()).toBe(true)
  })

  it('persists the attempt so a post-redirect page load sees it', () => {
    claimReauthAttempt()
    // The redirect navigates away and the module is re-evaluated on return;
    // only sessionStorage carries the budget across that boundary.
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ attempts: 1 })
    expect(canAttemptReauth()).toBe(false)
  })

  it('treats corrupt stored state as no attempts rather than throwing', () => {
    sessionStorage.setItem(KEY, 'not json{')
    expect(canAttemptReauth()).toBe(true)
    expect(claimReauthAttempt()).toBe(true)
  })

  it('treats structurally wrong stored state as no attempts', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ attempts: 'lots' }))
    expect(claimReauthAttempt()).toBe(true)
  })

  it('refuses when the attempt cannot be persisted, rather than risking a loop', () => {
    // Some privacy modes throw on write. An unrecordable attempt is an
    // uncappable one, so the guard must fail closed.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(claimReauthAttempt()).toBe(false)
  })
})
