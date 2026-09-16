import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isStaleInteractionError,
  recoverFromInterruptedLogout,
  recoverFromStaleInteraction,
} from './msalRecovery'

/**
 * jsdom's location.reload is not configurable in place, so the whole accessor is
 * replaced with a spy for the duration of the suite.
 */
const reload = vi.fn()

beforeEach(() => {
  sessionStorage.clear()
  reload.mockClear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  })
})

/** The bfcache restore the back button produces. */
function pageShow(persisted: boolean) {
  const event = new Event('pageshow') as PageTransitionEvent
  Object.defineProperty(event, 'persisted', { value: persisted })
  window.dispatchEvent(event)
}

describe('isStaleInteractionError', () => {
  it('recognises MSAL refusing a concurrent interaction', () => {
    expect(isStaleInteractionError({ errorCode: 'interaction_in_progress' })).toBe(true)
  })

  it.each([
    { errorCode: 'user_cancelled' },
    new Error('network down'),
    null,
    undefined,
    'interaction_in_progress',
  ])('does not claim %s', (err) => {
    expect(isStaleInteractionError(err)).toBe(false)
  })
})

describe('recoverFromInterruptedLogout', () => {
  it('reloads when the user backs out of the sign-out page', () => {
    recoverFromInterruptedLogout()
    pageShow(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignores an ordinary load, which has already healed itself', () => {
    recoverFromInterruptedLogout()
    pageShow(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('stops listening after the first pageshow', () => {
    recoverFromInterruptedLogout()
    pageShow(false)
    pageShow(true)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('recoverFromStaleInteraction', () => {
  it('reloads on a stale interaction mark and reports it handled', () => {
    expect(recoverFromStaleInteraction({ errorCode: 'interaction_in_progress' })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('leaves unrelated failures to the caller', () => {
    expect(recoverFromStaleInteraction(new Error('network down'))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('refuses a second reload inside the guard window', () => {
    // A reload that did not fix the problem must not become a reload loop —
    // far worse than the stuck state it is clearing.
    expect(recoverFromStaleInteraction({ errorCode: 'interaction_in_progress' })).toBe(true)
    expect(recoverFromStaleInteraction({ errorCode: 'interaction_in_progress' })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('allows another reload once the guard window has passed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(recoverFromStaleInteraction({ errorCode: 'interaction_in_progress' })).toBe(true)
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 31_000)
    expect(recoverFromStaleInteraction({ errorCode: 'interaction_in_progress' })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('shares the guard with the logout path, so the two cannot double-reload', () => {
    recoverFromInterruptedLogout()
    pageShow(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(recoverFromStaleInteraction({ errorCode: 'interaction_in_progress' })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('refuses rather than risking a loop when the guard cannot be recorded', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(recoverFromStaleInteraction({ errorCode: 'interaction_in_progress' })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
