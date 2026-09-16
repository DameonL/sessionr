/**
 * Budget for automatic re-authentication redirects.
 *
 * When a silent token refresh fails because the session genuinely expired, the
 * app sends the user through acquireTokenRedirect. With a live IdP session
 * cookie that is invisible — a bounce out to ciamlogin and straight back. But
 * if the redirect comes back *still* without a usable token (IdP misconfigured,
 * consent revoked, cookies blocked outright), repeating it is an infinite
 * redirect loop that makes the app unusable and hammers the IdP.
 *
 * So: at most one automatic redirect per browser session. sessionStorage rather
 * than localStorage is the point — the budget dies with the tab, so a genuinely
 * new visit always gets a fresh attempt, while a loop within one tab is capped.
 *
 * Everything here is best-effort: sessionStorage throws in some privacy modes,
 * and a guard that can't record an attempt must refuse rather than risk looping.
 */
const STORAGE_KEY = 'sessionr.reauth'
const MAX_ATTEMPTS = 1

/**
 * How long an attempt must stand before a success is allowed to forgive it.
 *
 * Without this the budget cannot bind across round trips at all. Its clear sites
 * are "a token was acquired" and "/users/me answered" — both of which fire on the
 * return leg of the very redirect being capped, seconds after it was spent. A
 * success that soon proves only that the redirect happened, not that the session
 * is stable, so the allowance was handed straight back and the next failure could
 * redirect again, forever.
 *
 * A loop iteration is one IdP round trip, a second or two. Requiring a full
 * minute of unbroken health before the budget refills is therefore many cycles
 * wide, while still being far shorter than any session worth re-authenticating.
 */
const CLEAR_COOLDOWN_MS = 60_000

interface ReauthState {
  attempts: number
  firstAttemptAt: number
}

function read(): ReauthState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof (parsed as ReauthState).attempts !== 'number' ||
      typeof (parsed as ReauthState).firstAttemptAt !== 'number'
    ) {
      return null
    }
    return parsed as ReauthState
  } catch {
    return null
  }
}

/**
 * Records an attempt and reports whether the redirect may proceed.
 *
 * Call this immediately before acquireTokenRedirect, never after — the redirect
 * navigates away, so anything recorded afterwards never runs.
 */
export function claimReauthAttempt(): boolean {
  let state: ReauthState
  try {
    const existing = read()
    if (existing && existing.attempts >= MAX_ATTEMPTS) return false
    state = existing
      ? { attempts: existing.attempts + 1, firstAttemptAt: existing.firstAttemptAt }
      : { attempts: 1, firstAttemptAt: Date.now() }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Couldn't persist the attempt, so we couldn't stop ourselves doing it
    // again. Refusing costs the user one manual sign-in click; allowing it
    // risks an unbreakable redirect loop.
    return false
  }
  return true
}

/**
 * Clears the budget. Call whenever a token is successfully acquired or a
 * /users/me verifies — the session is healthy, so a future expiry deserves its
 * own full allowance.
 *
 * "Healthy" means healthy for a while: a success within CLEAR_COOLDOWN_MS of the
 * last attempt is ignored, because that is the redirect's own return leg
 * reporting its own arrival. Clearing there is what let a failing page redirect,
 * come back, refill the budget, fail again and redirect forever.
 */
export function clearReauthAttempts(): void {
  try {
    const existing = read()
    if (!existing) return
    if (Date.now() - existing.firstAttemptAt < CLEAR_COOLDOWN_MS) return
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Best effort.
  }
}

/** Whether an automatic redirect is still permitted, without consuming it. */
export function canAttemptReauth(): boolean {
  const state = read()
  return !state || state.attempts < MAX_ATTEMPTS
}
