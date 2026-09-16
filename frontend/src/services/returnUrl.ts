/**
 * The page a user was on when a sign-in redirect took them away.
 *
 * MSAL's redirectUri is pinned to the origin root and handleRedirectPromise is
 * called with navigateToLoginRequestUrl: false (see AuthProvider), so the return
 * leg of every interactive sign-in lands on "/" no matter where it started.
 * Without this, signing in from a tune page — or being bounced out by an
 * automatic re-auth mid-browse — silently dumps the user on the Dashboard.
 *
 * So the app owns the return URL itself: recorded immediately before the
 * navigation away, consumed once on the way back, and restored as a client-side
 * route change rather than a second full page load.
 *
 * sessionStorage rather than localStorage: the intent belongs to this tab and
 * this round trip. It must not leak into a new visit, and it must not make some
 * other tab jump. Everything here is best-effort — sessionStorage throws in some
 * privacy modes, and a failure just means the user lands on "/" as before.
 */
const STORAGE_KEY = 'sessionr.returnUrl'

/**
 * The page most recently handed back to the router, and when.
 *
 * Restoring a page can re-create the very condition that caused the redirect —
 * the automatic re-auth records the page whose token acquisition just failed, so
 * rebuilding it invites the same failure and another redirect. One restore per
 * round trip is all this feature ever needed; a second identical restore seconds
 * later is a loop, not a user, and is refused.
 */
const LEDGER_KEY = 'sessionr.returnUrl.last'

/** How long an identical restore is treated as a loop rather than intent. */
const LOOP_WINDOW_MS = 60_000

/**
 * How long a recorded page stays worth returning to. An IdP round trip — consent
 * screens and MFA included — is minutes at most. The bound matters because the
 * recording happens on a click that may never reach a redirect at all (the user
 * lands on /login and wanders off instead), and a forgotten entry resurfacing on
 * an unrelated sign-in half an hour later would read as the app teleporting.
 */
const MAX_AGE_MS = 10 * 60 * 1000

interface StoredReturn {
  url: string
  at: number
}

/** Paths that are never worth returning to — they are where sign-in starts. */
const SKIP_PATHS = new Set(['/', '/login'])

/**
 * A stored value is attacker-reachable (anything that can run script in this
 * origin can write it), so it is treated as untrusted on the way out. Only a
 * same-document relative path is allowed: a leading "/" but not "//" or "/\",
 * both of which browsers resolve as protocol-relative URLs to another host.
 */
function isSafeReturnUrl(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
}

/** Whether this exact page was already restored moments ago. */
function wasJustRestored(url: string): boolean {
  const raw = sessionStorage.getItem(LEDGER_KEY)
  if (!raw) return false
  const parsed = JSON.parse(raw) as unknown
  if (typeof parsed !== 'object' || parsed === null) return false
  const last = parsed as StoredReturn
  if (typeof last.url !== 'string' || typeof last.at !== 'number') return false
  return last.url === url && Date.now() - last.at < LOOP_WINDOW_MS
}

function recordRestore(url: string): void {
  const entry: StoredReturn = { url, at: Date.now() }
  sessionStorage.setItem(LEDGER_KEY, JSON.stringify(entry))
}

/**
 * Records the current page as the place to come back to.
 *
 * Call this immediately before loginRedirect/acquireTokenRedirect, never after —
 * the redirect navigates away, so anything recorded afterwards never runs.
 */
export function rememberReturnUrl(): void {
  try {
    const { pathname, search, hash } = window.location
    if (SKIP_PATHS.has(pathname)) {
      // Returning here is what happens by default, and a stale entry from an
      // earlier attempt would be worse than none.
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    const entry: StoredReturn = { url: `${pathname}${search}${hash}`, at: Date.now() }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // Best effort; the user lands on "/".
  }
}

/**
 * Returns the remembered page and forgets it.
 *
 * Anything unreadable, expired, or not a plain same-origin path yields null and
 * the caller leaves the user where MSAL landed them.
 *
 * Single-consumption on purpose: once restored, a later ordinary reload of "/"
 * must not bounce the user somewhere else.
 */
export function consumeReturnUrl(): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const { url, at } = parsed as StoredReturn
    if (typeof url !== 'string' || typeof at !== 'number') return null
    if (Date.now() - at > MAX_AGE_MS) return null
    if (!isSafeReturnUrl(url)) return null
    if (wasJustRestored(url)) {
      // Second identical restore inside the window: the page we sent the user to
      // bounced them straight back out. Leave them where MSAL landed them and let
      // the signed-out / session-expired UI take over, rather than going round again.
      sessionStorage.removeItem(LEDGER_KEY)
      return null
    }
    recordRestore(url)
    return url
  } catch {
    // Unreadable, or not JSON at all — treat it as nothing remembered.
    return null
  }
}
