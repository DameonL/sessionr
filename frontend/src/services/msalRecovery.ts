/**
 * Recovery from a half-finished MSAL redirect interaction.
 *
 * MSAL marks an interaction in progress in its own cache before navigating to the
 * IdP, and refuses to start another while that mark stands — `loginRedirect`
 * throws BrowserAuthError/interaction_in_progress, and the redirect flow accepts
 * no override for it. The mark is cleared on the return leg, so the normal path
 * is self-healing.
 *
 * The back button is the hole. For its *sign-in* redirect MSAL registers a
 * `pageshow` listener that resets the request cache and emits
 * RESTORE_FROM_BFCACHE, which msal-react maps back to InteractionStatus.None
 * (RedirectClient.acquireToken). Its *logout* redirect registers nothing of the
 * kind (RedirectClient.logout), so backing out of the sign-out page leaves two
 * things stuck at once:
 *
 *   - MSAL's cached interaction status, still SIGNOUT, blocking every later
 *     sign-in attempt;
 *   - msal-react's `inProgress`, frozen at Logout in the restored React state —
 *     LOGOUT_END never fires, so nothing moves it back to None.
 *
 * Both are private to MSAL and neither has a public API to clear. A full page
 * load does clear them: AuthProvider's bootstrap calls handleRedirectPromise,
 * which on finding a SIGNOUT interaction clears it and returns null
 * (StandardController.handleRedirectPromiseInternal), and React starts over at
 * Startup → None. So reloading is the recovery, and it is the whole of this
 * module.
 */
const GUARD_KEY = 'sessionr.msalRecovery'

/**
 * Two reloads in quick succession would mean the reload did not fix the thing it
 * was meant to fix, and a reload loop is far worse than the stuck state it is
 * trying to clear. One per window, then we leave it alone.
 */
const GUARD_WINDOW_MS = 30_000

function mayReload(): boolean {
  try {
    const raw = sessionStorage.getItem(GUARD_KEY)
    const last = raw ? Number(raw) : NaN
    if (Number.isFinite(last) && Date.now() - last < GUARD_WINDOW_MS) return false
    sessionStorage.setItem(GUARD_KEY, String(Date.now()))
    return true
  } catch {
    // Can't record the attempt, so can't stop ourselves repeating it. Refusing
    // costs the user a manual refresh; allowing it risks a reload loop.
    return false
  }
}

/**
 * Watches for the user backing out of the IdP's sign-out page.
 *
 * Call immediately before `logoutRedirect()`. The listener is registered on the
 * page that is about to be navigated away from, which is exactly the page the
 * back button restores — bfcache freezes and restores the JS heap, listeners
 * included, which is what makes this work at all (and is how MSAL's own
 * equivalent for the sign-in flow works).
 *
 * `event.persisted` distinguishes a bfcache restore, where nothing re-ran and
 * the stale state is still in place, from an ordinary load, which has already
 * healed itself.
 */
export function recoverFromInterruptedLogout(): void {
  const onPageShow = (event: PageTransitionEvent) => {
    window.removeEventListener('pageshow', onPageShow)
    if (!event.persisted) return
    if (!mayReload()) return
    window.location.reload()
  }
  window.addEventListener('pageshow', onPageShow)
}

/**
 * Whether an error is MSAL refusing to start an interaction because it believes
 * one is already running.
 *
 * Kept as a string comparison rather than an `instanceof BrowserAuthError` check
 * so it stays true for an error that crossed a serialization boundary.
 */
export function isStaleInteractionError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { errorCode?: unknown }).errorCode === 'interaction_in_progress'
  )
}

/**
 * Last-ditch recovery for a sign-in blocked by a stale interaction mark.
 *
 * Returns whether a reload was started, so callers can tell "handled" from "this
 * error needs reporting". A refused reload (guard window, unusable storage)
 * reports false and the caller surfaces the failure normally.
 */
export function recoverFromStaleInteraction(err: unknown): boolean {
  if (!isStaleInteractionError(err)) return false
  if (!mayReload()) return false
  window.location.reload()
  return true
}
