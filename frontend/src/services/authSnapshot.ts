/**
 * Optimistic auth hydration.
 *
 * MSAL's bootstrap — new PublicClientApplication -> initialize() ->
 * handleRedirectPromise() -> acquireTokenSilent -> GET /users/me — is strictly
 * serial and routinely costs a second or more warm, far more against a cold
 * Functions backend. None of it is needed to *draw* the
 * signed-in shell; it's needed to *authorize data*. So every verified sync
 * persists a snapshot of who was signed in, and the next load reads it back
 * synchronously and paints the signed-in UI while that chain runs behind it.
 *
 * This is presentation-only optimism. It changes what is drawn before the first
 * response arrives, never what the browser is permitted to fetch: every request
 * still carries a real bearer token minted by MSAL from its own cache, and the
 * backend remains the sole authority on identity. AuthProvider's reconciliation
 * is what corrects the guess when it turns out to be wrong.
 */
import type { UserProfile } from './api'
import { msalConfigFingerprint } from './authConfig'
import { authSource, authStatus, currentUserId, currentUserProfile } from '../state/appState'

const SNAPSHOT_KEY = 'sessionapp_auth_snapshot'
// v2 added `cfg`. A v1 snapshot has no fingerprint to check, so it is discarded
// rather than read as `cfg: undefined`.
// v3 added `profile.isProfilePrivate`. readSnapshot only validates `profile.userId`,
// so a v2 snapshot would hydrate a profile whose privacy toggle reads `undefined`.
const SNAPSHOT_VERSION = 3

/**
 * Max age of a usable snapshot.
 *
 * The snapshot never authorizes anything, so the risk it carries is bounded by
 * "showed a stale display name for a few hundred milliseconds". The bounds that
 * do matter: too short and the feature stops firing for exactly the people it
 * exists for; too long and it can outlive the MSAL cache it is corroborated
 * against (msal-browser defaults cache.cacheRetentionDays to 5), so the odds of
 * painting a session that is actually dead start to rise. 7 days sits just past
 * that retention floor, and `savedAt` is refreshed on every verified sync — so
 * an actively-used session never ages out.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface AuthSnapshot {
  v: number
  homeAccountId: string
  profile: UserProfile
  savedAt: number
  /**
   * The msalConfigFingerprint this snapshot was written under. A snapshot from
   * a different clientId/tenant must not be acted on: MSAL's account-key index
   * is not clientId-scoped, so corroborateSnapshot would still answer 'ok' off
   * an account left behind by the old config — and we'd paint a session whose
   * tokens can never be minted.
   */
  cfg: string
}

// ---------------------------------------------------------------- read/write

export function readSnapshot(): AuthSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const snap = JSON.parse(raw) as AuthSnapshot
    if (snap?.v !== SNAPSHOT_VERSION) return null
    if (snap.cfg !== msalConfigFingerprint) return null
    if (typeof snap.homeAccountId !== 'string' || !snap.homeAccountId) return null
    if (typeof snap.savedAt !== 'number' || Date.now() - snap.savedAt > MAX_AGE_MS) return null
    if (!snap.profile || typeof snap.profile.userId !== 'string' || !snap.profile.userId) return null
    return snap
  } catch {
    return null
  }
}

export function writeSnapshot(homeAccountId: string, profile: UserProfile): void {
  if (typeof window === 'undefined' || !homeAccountId || !profile?.userId) return
  try {
    const snap: AuthSnapshot = {
      v: SNAPSHOT_VERSION,
      homeAccountId,
      profile,
      savedAt: Date.now(),
      cfg: msalConfigFingerprint,
    }
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
  } catch {
    // Best-effort — storage full/blocked must never break a successful sync.
  }
}

export function clearSnapshot(): void {
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    // Best-effort.
  }
}

/** True for the localStorage keys whose changes can invalidate a hydrated session. */
export function isAuthStorageKey(key: string): boolean {
  return key === SNAPSHOT_KEY || ACCOUNT_KEYS_RE.test(key)
}

// --------------------------------------------------------------- corroborate

/**
 * Matches both the current account-key index (`msal.3.account.keys`) and the
 * legacy schema-0 one (`msal.account.keys`). Verified against
 * @azure/msal-browser 5.17.3, getAccountKeysCacheKey().
 *
 * A regex rather than a hardcoded name so an MSAL bump to schema 4 keeps
 * working; and if MSAL ever renames the index outright we degrade to "never
 * corroborates" — i.e. exactly today's 'pending' behaviour — never to a false
 * positive.
 */
const ACCOUNT_KEYS_RE = /^msal\.(\d+\.)?account\.keys$/
const ENCRYPTION_COOKIE = 'msal.cache.encryption'

/** MSAL's account-key index, read straight from localStorage before any PCA exists. */
function readMsalAccountKeys(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const storageKey = window.localStorage.key(i)
      if (!storageKey || !ACCOUNT_KEYS_RE.test(storageKey)) continue
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) continue
      for (const entry of parsed) {
        if (typeof entry === 'string' && entry) keys.push(entry)
      }
    }
  } catch {
    return []
  }
  return keys
}

/**
 * msal-browser v5 derives its localStorage encryption key from a *session*
 * cookie (LocalStorage.initialize — it is written with a lifetime of 0 days, so
 * it dies with the browser process). The cookie value is
 * encodeURIComponent(JSON.stringify({ id, key })); we only need the id.
 */
function readEncryptionCookieId(): string | null {
  try {
    const prefix = `${encodeURIComponent(ENCRYPTION_COOKIE)}=`
    for (const part of document.cookie.split(';')) {
      const cookie = part.trim()
      if (!cookie.startsWith(prefix)) continue
      const parsed = JSON.parse(decodeURIComponent(cookie.slice(prefix.length)))
      return typeof parsed?.id === 'string' ? parsed.id : null
    }
  } catch {
    // Unparseable cookie — treat as absent.
  }
  return null
}

/**
 * A key listed in account.keys is not proof MSAL will surface an account.
 * Account *entities* are stored encrypted unless the id token carried a KMSI
 * ("keep me signed in") claim, and the next initialize() deletes any entity
 * whose ciphertext no longer decrypts while the plaintext index still lists it.
 * Hydrating on such a dangling key produces the worst possible outcome — a
 * flash of signed-in UI torn down a moment later — so check the entity too.
 *
 * This is the browser-restart case: without KMSI, the encryption cookie is gone
 * and the user is genuinely signed out, however intact the index looks.
 */
function accountEntryIsUsable(accountKey: string): boolean {
  try {
    const raw = window.localStorage.getItem(accountKey)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return false
    // msal-browser's own isEncrypted() shape check.
    const encrypted = 'id' in parsed && 'nonce' in parsed && 'data' in parsed
    if (!encrypted) return typeof parsed.homeAccountId === 'string' // KMSI: stored plaintext
    const cookieId = readEncryptionCookieId()
    return !!cookieId && parsed.id === cookieId
  } catch {
    return false
  }
}

export type Corroboration =
  | 'ok' /** MSAL holds a usable account for this snapshot. */
  | 'no-account' /** MSAL holds no account for it at all — the snapshot is dead. */
  | 'unreadable' /** Key present, but the entity can't be decrypted this session. */
  | 'ambiguous' /** More than one account cached — refuse to guess which is active. */

export function corroborateSnapshot(snapshot: AuthSnapshot): Corroboration {
  const needle = snapshot.homeAccountId.toLowerCase()
  const keys = readMsalAccountKeys()
  if (keys.length === 0) return 'no-account'

  // Refuse to guess on a multi-account browser. The snapshot says "the last
  // verified user was X", but MSAL picks its own active account after
  // initialize() and it might not be X — that mismatch is the only path by
  // which one person's name could be painted over another's session on a shared
  // machine. Cheap to detect, so just fall back to today's 'pending'.
  // Entries are `msal.3|<homeAccountId>|<environment>|<tenantId>`, lowercased.
  const distinct = new Set(keys.map((k) => k.split('|')[1] ?? k.toLowerCase()))
  if (distinct.size > 1) return 'ambiguous'

  // Substring match on homeAccountId mirrors MSAL's own key filter and
  // tolerates both the v3 key shape and legacy ones.
  const match = keys.find((k) => k.toLowerCase().includes(needle))
  if (!match) return 'no-account'
  return accountEntryIsUsable(match) ? 'ok' : 'unreadable'
}

// ----------------------------------------------------------------- hydration

/**
 * Reads the snapshot, corroborates it against MSAL's own cache, and — only if
 * everything lines up — populates the shared signals so the very first paint is
 * already the signed-in UI. Any failure leaves authStatus at 'pending', i.e.
 * byte-for-byte today's behaviour.
 *
 * Must be called at module scope, NOT from an effect: an effect (even
 * useLayoutEffect) runs after the first render commits, which is precisely the
 * blank frame this exists to remove. useSignal seeds its useState from
 * sig.value, so setting the signals before React renders costs no extra render.
 */
export function hydrateAuthFromSnapshot(): AuthSnapshot | null {
  const snap = readSnapshot()
  if (!snap) return null

  const verdict = corroborateSnapshot(snap)
  if (verdict !== 'ok') {
    // 'no-account' is a real sign-out — MSAL emptied its own index — so drop the
    // snapshot before it can produce a false hydration later. 'unreadable' and
    // 'ambiguous' are environmental (browser restart, second account); keep the
    // snapshot on disk and simply don't act on it this load.
    if (verdict === 'no-account') clearSnapshot()
    return null
  }

  currentUserId.value = snap.profile.userId
  currentUserProfile.value = snap.profile
  authSource.value = 'snapshot'
  authStatus.value = 'authenticated' // last: subscribers read the others
  return snap
}

/** Single teardown shared by sign-out and reconciliation's definitive-failure path. */
export function clearAuthSession(): void {
  clearSnapshot()
  currentUserId.value = ''
  currentUserProfile.value = null
  authSource.value = 'none'
}
