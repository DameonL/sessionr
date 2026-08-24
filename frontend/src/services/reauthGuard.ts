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
 */
export function clearReauthAttempts(): void {
  try {
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
