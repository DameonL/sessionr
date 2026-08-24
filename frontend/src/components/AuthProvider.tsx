"use client";

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from '@/utils/routerCompat'
import { BrowserAuthError, BrowserAuthErrorCodes, InteractionRequiredAuthError, InteractionStatus, Logger, PublicClientApplication, stubbedPublicClientApplication, type IPublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { getCurrentUser, ApiError, UnauthenticatedError } from '../services/api'
import { loginRequest, msalConfig } from '../services/authConfig'
import {
  clearAuthSession,
  clearSnapshot,
  corroborateSnapshot,
  hydrateAuthFromSnapshot,
  isAuthStorageKey,
  readSnapshot,
  writeSnapshot,
} from '../services/authSnapshot'
import { clearOfflineHttpCache } from '../services/offlineDb'
import { queryClient } from '../services/queryClient'
import { claimReauthAttempt, clearReauthAttempts } from '../services/reauthGuard'
import { abandonTokenAcquisition, authSource, authStatus, currentUserId, currentUserProfile, getBearerToken, sessionExpired, setTokenAcquisitionHelper, showToast } from '../state/appState'

interface AuthProviderProps {
  children: ReactNode
}

// MsalProvider must always receive a real instance (it calls instance.getLogger() synchronously
// on every render), but the real PublicClientApplication isn't usable until pca.initialize()
// resolves. Rendering under a Fragment until then and swapping to <MsalProvider>
// once ready changes the wrapper's element type, which makes React unmount and remount the whole
// children tree (NavBar + the active page) partway through every page load — silently doubling
// every userId-keyed data fetch that happens to be in flight at that moment. Using this
// placeholder (msal-react's own stub, patched so getLogger doesn't throw) keeps <MsalProvider>
// as a constant wrapper across the whole lifecycle, so only its `instance` prop ever changes.
const placeholderPca: IPublicClientApplication = {
  ...stubbedPublicClientApplication,
  getLogger: () => new Logger({}),
}

function isJwtExpired(token: string, bufferSeconds = 30): boolean {
  if (!token || token.split('.').length !== 3) return true
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (!payload.exp) return false
    return (Date.now() / 1000) >= (payload.exp - bufferSeconds)
  } catch {
    return true
  }
}

// Paint the signed-in UI on the very first frame for a user whose credentials
// are already cached, instead of waiting out the serial initialize() ->
// handleRedirectPromise() -> acquireTokenSilent -> /users/me chain below.
// Runs at module evaluation — before React renders — because
// useSignal seeds its useState from sig.value, so the first render already sees
// the signed-in state with no extra render. A useEffect (or even a
// useLayoutEffect) would be one paint too late, which is exactly the blank
// frame this removes. Everything below reconciles the guess against the server.
if (typeof window !== 'undefined') {
  void hydrateAuthFromSnapshot()
}

/**
 * Tears down an optimistically-hydrated *display* without erasing the snapshot.
 *
 * Used on the bootstrap paths where MSAL can't mint tokens at all this load: a
 * name and avatar over a UI where nothing can load is worse than showing signed
 * out. But a local/config failure is not a sign-out, so the snapshot stays on
 * disk and a later healthy load can hydrate from it again.
 */
function abandonOptimisticSession(): void {
  if (authSource.value === 'snapshot') {
    currentUserId.value = ''
    currentUserProfile.value = null
    authSource.value = 'none'
  }
}

let cachedToken: string | null = null

// True while MsalBackgroundSync is actively acquiring a token + syncing the user
// profile (including its cold-start retry loop). The pending-safety timer checks
// this so it never flips a still-working sign-in to 'anonymous' mid-retry — the
// retry loop owns the terminal state in that case.
let syncInProgress = false

export default function AuthProvider({ children }: AuthProviderProps) {
  const [pcaInstance, setPcaInstance] = useState<PublicClientApplication | null>(null)
  const [syncingUser, setSyncingUser] = useState<string | null>(null)
  const [freshInteractiveSignIn, setFreshInteractiveSignIn] = useState(false)

  useEffect(() => {
    let cancelled = false;

    // Safety net: if the MSAL bootstrap never settles (a wedged initialize(),
    // a wedged interaction), don't leave the whole app frozen on blank
    // 'pending' screens — fall back to anonymous and invite a retry.
    const pendingSafetyTimer = setTimeout(() => {
      if (!helperRegistered) {
        // MSAL never came up, so nothing will ever mint a token this load.
        // Release anyone waiting on the token gate instead of making them sit
        // out its full ceiling on top of doFetch's own timeout.
        abandonTokenAcquisition();
      }
      // Don't pre-empt an in-flight sync/retry: a cold backend can take longer
      // than this to answer GET /users/me, and the retry loop will settle the
      // status itself. Only rescue a genuinely wedged bootstrap.
      if (syncInProgress) return;

      if (authStatus.value === 'pending') {
        authStatus.value = 'anonymous';
        showToast('Sign-in is taking longer than expected. Please try again.', 'info');
      } else if (authSource.value === 'snapshot' && !helperRegistered) {
        // Optimistically hydrated, but the bootstrap wedged before it could
        // register a token helper — a name and avatar over a UI where nothing
        // can ever load. Show signed out instead. Gating on helperRegistered
        // matters: a healthy *offline* load also settles at 'snapshot' without
        // reaching 'verified', and that session must survive.
        abandonOptimisticSession();
        authStatus.value = 'anonymous';
      }
    }, 15000);

    const registerTokenHelper = (pca: PublicClientApplication) => {
      let redirectInProgress = false;

      // Optimistic hydration means a dozen userId-keyed queries can reach this
      // at once on the first paint, with cachedToken still cold. MSAL dedupes
      // the underlying network call, but the 4s race below is per-caller —
      // unshared, a single slow silent refresh would lose a dozen independent
      // races and hand every caller null. forceRefresh deliberately opts out so
      // doFetch's 401 retry can never be answered by a stale in-flight result.
      let inFlight: Promise<string | null> | null = null;

      const acquire = async (forceRefresh: boolean): Promise<string | null> => {
        const activeAccount = pca.getActiveAccount() || pca.getAllAccounts()[0];
        if (!activeAccount) {
          cachedToken = null;
          return null;
        }
        // Set only when the session is definitively unrecoverable without the
        // user — which, together with being online, is the sole condition that
        // permits a redirect. See the catch block for exactly which failures
        // qualify and which deliberately do not.
        let interactionRequired = false;

        // Try a silent refresh first. With a refresh token in the cache this is
        // a direct POST to the token endpoint (no iframe, no cookie, no popup);
        // the hidden-iframe fallback only kicks in once the refresh token is
        // gone. We race it against a short timeout so a blocked/stalled iframe
        // can never hang the UI — it just falls through to the interactive
        // redirect below. We return the freshly-refreshed id token to keep the
        // backend contract (oid/email/name/group claims) byte-for-byte identical.
        //
        // The race only stays a backstop because msalConfig pins
        // system.iframeBridgeTimeout (2500ms) below SILENT_TIMEOUT_MS. Raise one
        // without the other and MSAL's verdict is lost to our generic timeout
        // again, which is exactly the bug that wedged expired sessions.
        try {
          const SILENT_TIMEOUT_MS = 4000;
          const result = await Promise.race([
            pca.acquireTokenSilent({
              scopes: loginRequest.scopes,
              account: activeAccount,
              forceRefresh,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('acquireTokenSilent timed out')), SILENT_TIMEOUT_MS)
            ),
          ]);

          if (result?.idToken && !isJwtExpired(result.idToken, 30)) {
            cachedToken = result.idToken;
            sessionExpired.value = false;
            clearReauthAttempts();
            return result.idToken;
          }
          // Resolved, but with an id token that's already expired. MSAL believes
          // it succeeded, so no error is thrown and this used to fall silently
          // through to `return null`. There is nothing left to try silently.
          interactionRequired = true;
        } catch (silentErr) {
          // Three failures mean the IdP must be asked interactively, and are the
          // only ones permitted to redirect:
          //  - InteractionRequiredAuthError: the IdP said so explicitly.
          //  - BrowserAuthError 'timed_out': MSAL's own silent-iframe budget
          //    expired. In practice this is third-party cookies being blocked
          //    (Safari, Firefox, hardened Chrome), where the iframe can never
          //    complete no matter how long we wait.
          //  - An expired id token from an apparently-successful call, above.
          const msalTimedOut =
            silentErr instanceof BrowserAuthError &&
            silentErr.errorCode === BrowserAuthErrorCodes.timedOut;

          if (silentErr instanceof InteractionRequiredAuthError || msalTimedOut) {
            interactionRequired = true;
          } else {
            // Our own outer-race timeout and any network/offline failure land
            // here. These say nothing about the session's validity, so they must
            // never bounce the user to ciamlogin — the offline paths in api.ts
            // handle them.
            console.warn('Silent token acquisition failed (no interactive redirect):', silentErr);
          }
        }

        cachedToken = null;
        // Launch the interactive redirect ONLY when the IdP explicitly demands
        // interaction AND we're online. Offline (or online-but-unreachable, where
        // the silent call fails with a network error rather than
        // InteractionRequired), return null and let the fetch/sync layers use
        // their offline path (cached data, anonymous UI, "Sign In" affordances).
        const online = typeof navigator === 'undefined' || navigator.onLine;
        if (!interactionRequired || !online) {
          return null;
        }

        // Past this point the session is definitively over. Whether or not the
        // redirect below happens, callers must not keep treating a null token as
        // a transient hiccup — see the sessionExpired doc comment in appState.
        sessionExpired.value = true;

        if (!redirectInProgress) {
          const isInIframe = typeof window !== 'undefined' && window.parent !== window;
          // claimReauthAttempt() both checks and consumes the budget, and must be
          // called before the navigation — nothing after acquireTokenRedirect runs.
          // Spending it here is deliberate: if the redirect doesn't fix things we
          // fall back to the explicit signed-out UI rather than looping.
          if (!isInIframe && claimReauthAttempt()) {
            redirectInProgress = true;
            try {
              await pca.acquireTokenRedirect({
                ...loginRequest,
                account: activeAccount,
              });
            } catch (redirectErr) {
              console.error('acquireTokenRedirect failed:', redirectErr);
              redirectInProgress = false;
            }
          }
        }
        return null;
      };

      setTokenAcquisitionHelper(async (forceRefresh = false) => {
        const accounts = pca.getAllAccounts();
        if (accounts.length === 0) {
          cachedToken = null;
          return null;
        }

        if (!forceRefresh && cachedToken && !isJwtExpired(cachedToken, 30)) {
          return cachedToken;
        }

        if (forceRefresh) return acquire(true);

        if (!inFlight) {
          const run = acquire(false);
          inFlight = run;
          const release = () => { if (inFlight === run) inFlight = null; };
          // then(release, release) rather than finally() so a rejection is
          // observed here too and can't surface as an unhandled rejection —
          // callers still see the original promise, rejection and all.
          run.then(release, release);
        }
        return inFlight;
      });
    };

    // True only on the return leg of an interactive sign-in redirect — the one
    // case where the blocking "Completing sign-in" modal is the right UI,
    // because there is nothing else on screen yet.
    let cameFromRedirect = false;
    // Whether the bootstrap got far enough to hand a working token helper to
    // the rest of the app. Read by the safety timer above.
    let helperRegistered = false;

    const bootstrap = async () => {
      // The config is bundled (services/authConfig.ts), so MSAL can be
      // constructed on the spot — nothing to fetch, nothing to cache, and no
      // network round trip in front of the serial chain below.
      const pca = new PublicClientApplication(msalConfig);
      try {
        await pca.initialize();
        // Consume any pending redirect response BEFORE rendering MSAL-aware UI,
        // so the account is in the cache and MsalBackgroundSync never briefly
        // reads "no accounts" and flips to anonymous — the "sign in twice" /
        // "forgot my session" symptom.
        //
        // navigateToLoginRequestUrl: false — the sign-in button lives on /login
        // but redirectUri is "/", so the default (true) makes MSAL do a *second*
        // full navigation back to /login on every return. In msal-browser v5 this
        // option moved out of the `auth` config and onto handleRedirectPromise
        // (see the v4→v5 migration guide), which is why it belongs here.
        const redirectResult = await pca.handleRedirectPromise({ navigateToLoginRequestUrl: false });
        if (redirectResult?.account) {
          pca.setActiveAccount(redirectResult.account);
          cameFromRedirect = true;
        } else if (!pca.getActiveAccount()) {
          const existing = pca.getAllAccounts()[0];
          if (existing) pca.setActiveAccount(existing);
        }
      } catch (err) {
        console.error('MSAL initialization failed:', err);
        if (cancelled) return;
        abandonTokenAcquisition();
        abandonOptimisticSession();
        authStatus.value = 'anonymous';
        return;
      }

      if (cancelled) return;

      registerTokenHelper(pca);
      helperRegistered = true;
      // Latch, never unset: StrictMode runs this effect twice in dev, and
      // handleRedirectPromise is single-consumption, so the second pass sees
      // null and would otherwise silently flip the modal decision back off.
      if (cameFromRedirect) setFreshInteractiveSignIn(true);
      setPcaInstance(pca);
    };

    // A sign-out in another tab empties MSAL's account index and clears our
    // snapshot. msal-react *may* pick that up via MSAL's own BroadcastChannel
    // and re-render accounts, but that's an implementation detail we shouldn't
    // depend on for a shared-browser safety property. The storage event is the
    // direct signal and it's free.
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !isAuthStorageKey(e.key)) return;
      if (authStatus.value !== 'authenticated') return;
      const snap = readSnapshot();
      if (snap && corroborateSnapshot(snap) !== 'no-account') return;
      cachedToken = null;
      clearAuthSession();
      authStatus.value = 'anonymous';
      queryClient.clear();
      void clearOfflineHttpCache();
    };
    window.addEventListener('storage', onStorage);

    bootstrap();

    return () => {
      cancelled = true;
      clearTimeout(pendingSafetyTimer);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <MsalProvider instance={pcaInstance ?? placeholderPca}>
      {pcaInstance && (
        <MsalBackgroundSync
          showBlockingModal={freshInteractiveSignIn}
          onSyncStart={(name) => setSyncingUser(name)}
          onSyncEnd={() => setSyncingUser(null)}
        />
      )}
      {children}
      {syncingUser && (
        <div className="signin-modal-overlay">
          <div className="signin-modal-card">
            <div className="signin-loader-wrapper">
              <div className="signin-loader-ring" />
              <div className="signin-loader-pulse" />
            </div>
            <h2 className="signin-greeting">Hello, {syncingUser}!</h2>
            <p className="signin-status">Completing sign-in & syncing your tune library…</p>
            <p className="signin-subtext">Please wait a moment</p>
          </div>
        </div>
      )}
    </MsalProvider>
  )
}

interface MsalBackgroundSyncProps {
  /**
   * Whether this load is the return leg of an interactive sign-in, and so
   * whether the blocking "Completing sign-in" overlay applies. A reload —
   * optimistically hydrated or not — must never be covered by it.
   */
  showBlockingModal: boolean
  onSyncStart: (displayName: string) => void
  onSyncEnd: () => void
}

/** Keeps the shared signals in sync with the active MSAL account, notifying status to parent. */
function MsalBackgroundSync({ showBlockingModal, onSyncStart, onSyncEnd }: MsalBackgroundSyncProps) {
  const { accounts, inProgress } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Right after returning from Microsoft's login redirect, MSAL needs a
    // moment to process the response and restore the account into its cache
    // — until inProgress settles back to None, accounts/isAuthenticated can
    // still read as empty/false even though the user IS signed in. Bailing
    // out here (leaving authStatus at its 'pending' default) is what stops
    // the UI from flashing "signed out" before the real state resolves.
    if (inProgress !== InteractionStatus.None) {
      return
    }

    if (!isAuthenticated || accounts.length === 0) {
      // A fully-initialized MSAL reporting no account is authoritative, and it
      // beats an optimistic guess: initialize() is what prunes cache entries
      // that no longer decrypt and what absorbs a sign-out performed in another
      // tab. So erase the snapshot too, or the next load would guess wrong
      // again. This runs as soon as inProgress settles — no network — so the
      // window in which a stale identity is on screen is the local MSAL init.
      if (authSource.value === 'snapshot') clearSnapshot()
      currentUserId.value = ''
      currentUserProfile.value = null
      authSource.value = 'none'
      authStatus.value = 'anonymous'
      onSyncEnd()
      return
    }

    // MSAL says we're authenticated. The signed-in UI still needs the backend
    // user profile (GET /users/me) to populate currentUserId, but that first
    // call can transiently fail — most often an Azure Functions cold start on
    // the first request after login or a reload. Treating that one failure as
    // "signed out" is what used to bounce a valid session back to the sign-in
    // screen ("sign in twice" / "lost my session"). So retry transient failures
    // with backoff across a cold-start window, and only fall to 'anonymous' for
    // a definitive not-signed-in signal.
    let cancelled = false
    syncInProgress = true

    const setAnonymous = () => {
      currentUserId.value = ''
      currentUserProfile.value = null
      authSource.value = 'none'
      authStatus.value = 'anonymous'
    }

    // A hard "you are not signed in" signal — no amount of retrying will help.
    // A 401 has already survived doFetch's own forceRefresh retry by this point.
    const isDefinitiveAuthFailure = (err: unknown) =>
      err instanceof UnauthenticatedError ||
      (err instanceof ApiError && err.status === 401)

    const activeAccount = accounts[0]
    const displayName = activeAccount.name ||
                        (activeAccount.idTokenClaims as any)?.name ||
                        (activeAccount.idTokenClaims as any)?.given_name ||
                        'Microsoft Musician';

    // ~6 attempts with capped backoff (~0.5s → 5s, ~18s total) to ride out a
    // cold backend before giving up.
    const MAX_ATTEMPTS = 6
    const backoffMs = (attempt: number) => Math.min(500 * 2 ** attempt, 5000)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const offline = typeof navigator !== 'undefined' && !navigator.onLine

    const syncUser = async () => {
      // Offline: MSAL can't mint a fresh token and the backend is unreachable,
      // so don't show the blocking "signing in & syncing" modal or spin through
      // retries. Restore identity straight from the cached /users/me response
      // (served by the offline layer in api.ts) so personal pages render from
      // cache; fall back to anonymous only when there's nothing cached to restore.
      if (offline) {
        try {
          const cached = await getCurrentUser()
          if (cancelled) return
          if (cached) {
            currentUserId.value = cached.userId
            currentUserProfile.value = cached
            // Deliberately 'snapshot', not 'verified', and deliberately no
            // writeSnapshot(): a cached response is not verification, and
            // re-stamping savedAt would let a snapshot stay young forever
            // without ever reaching the server.
            authSource.value = 'snapshot'
            authStatus.value = 'authenticated'
          } else if (authSource.value === 'snapshot') {
            // Nothing cached, but a plausible profile is already on screen and
            // MSAL still holds the account. Keeping it beats blanking the UI
            // while offline.
          } else {
            setAnonymous()
          }
        } catch {
          // getCurrentUser throws offline when nothing is cached for it yet.
          // Same rule as the branch above: keep an already-painted session
          // rather than blanking the UI over a connectivity failure.
          if (!cancelled && authSource.value !== 'snapshot') setAnonymous()
        } finally {
          if (!cancelled) syncInProgress = false
        }
        return
      }

      // Only a genuine interactive sign-in gets the blocking overlay. On a
      // reload the hydrated UI is already usable, and an un-hydrated reload has
      // the existing 'pending' placeholders plus this loop's own failure toast.
      if (showBlockingModal) onSyncStart(displayName)
      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
          try {
            const token = await getBearerToken(false)
            if (cancelled) return
            if (!token) {
              if (sessionExpired.value) {
                // Not transient: acquire() got a definitive verdict from the IdP
                // and either already spent its one redirect or couldn't redirect
                // at all. Retrying cannot help, and looping here is what used to
                // leave the app stranded on an optimistically-hydrated signed-in
                // UI whose every request failed with "can't reach the API".
                // Hand it to the definitive-failure branch below.
                throw new UnauthenticatedError('Your session has expired.')
              }
              // Token temporarily unavailable (e.g. a stalled silent refresh, or
              // MSAL still bootstrapping). Transient — back off and retry rather
              // than dropping the session.
              await sleep(backoffMs(attempt))
              continue
            }

            const profile = await getCurrentUser()
            if (cancelled) return

            if (profile) {
              const optimisticUserId = authSource.value === 'snapshot' ? currentUserId.value : null

              currentUserId.value = profile.userId
              currentUserProfile.value = profile
              authSource.value = 'verified'
              authStatus.value = 'authenticated'
              // The session is demonstrably healthy, so a future expiry gets a
              // full automatic-redirect allowance of its own.
              sessionExpired.value = false
              clearReauthAttempts()
              writeSnapshot(activeAccount.homeAccountId, profile)

              if (optimisticUserId && optimisticUserId !== profile.userId) {
                // We painted the wrong user. Every userId-keyed query key
                // changes with currentUserId so react-query refetches under the
                // new key by itself — but the previous user's responses are
                // still sitting in both the query cache and the URL-keyed
                // IndexedDB HTTP cache, which has no user scoping at all.
                queryClient.clear()
                void clearOfflineHttpCache()
              }

              if (!profile.username && pathname !== '/profile') {
                showToast('Please choose a username to continue.', 'info')
                router.replace('/profile')
              }
              return
            }
            // A null profile (backend unreachable with no cache) is transient.
            await sleep(backoffMs(attempt))
          } catch (err) {
            if (cancelled) return
            if (isDefinitiveAuthFailure(err)) {
              const wasOptimistic = authSource.value === 'snapshot'
              clearAuthSession()
              authStatus.value = 'anonymous'
              // The session is gone and the UI now says so; the flag has done
              // its job and must not linger into the anonymous state.
              sessionExpired.value = false
              if (wasOptimistic) {
                // The user was looking at a signed-in UI a moment ago; a silent
                // swap to "Sign In" reads as a bug. Name what happened.
                showToast('Your session has expired. Please sign in again.', 'info')
              }
              return
            }
            // Transient (network/timeout/5xx/cold start) — retry with backoff.
            console.warn(`User sync attempt ${attempt + 1} failed, retrying:`, err)
            await sleep(backoffMs(attempt))
          }
        }

        if (!cancelled) {
          // Exhausted retries against an unreachable backend. Surface it as a
          // connectivity problem, not a logout, so the user doesn't think their
          // session vanished.
          console.error('Failed to sync user with DB after retries; backend unreachable.')
          if (authSource.value === 'snapshot') {
            // Same reasoning as the offline branch above: an unreachable
            // backend is a connectivity failure, not a sign-out. MSAL still
            // holds the account and still mints tokens, so leave the optimistic
            // session standing — each query surfaces its own error or falls
            // back to its own cache — rather than yanking a signed-in user to a
            // signed-out UI over a cold start. authSource stays 'snapshot', so
            // a later successful sync can still promote it and nothing
            // downstream mistakes this for verification.
            showToast("Couldn't reach the server. Showing your last known profile.", 'info')
          } else {
            setAnonymous()
            showToast("Couldn't reach the server to finish signing you in. Please try again.", 'error')
          }
        }
      } finally {
        if (!cancelled) {
          syncInProgress = false
          onSyncEnd()
        }
      }
    }

    void syncUser()

    return () => {
      cancelled = true
      syncInProgress = false
      onSyncEnd()
    }
  }, [isAuthenticated, accounts, inProgress, showBlockingModal])

  return null
}
