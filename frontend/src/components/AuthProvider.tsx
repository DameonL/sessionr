"use client";

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { InteractionRequiredAuthError, InteractionStatus, Logger, PublicClientApplication, stubbedPublicClientApplication, type IPublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { getCurrentUser, ApiError, UnauthenticatedError } from '../services/api'
import { loginRequest } from '../services/authConfig'
import { authStatus, currentUserId, currentUserProfile, getBearerToken, setTokenAcquisitionHelper, showToast } from '../state/appState'

interface AuthProviderProps {
  children: ReactNode
}

// MsalProvider must always receive a real instance (it calls instance.getLogger() synchronously
// on every render), but the real PublicClientApplication isn't constructed until /api/config and
// pca.initialize() resolve. Rendering under a Fragment until then and swapping to <MsalProvider>
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

// Fetches the runtime MSAL config with a hard timeout + one retry. A *hung*
// (as opposed to rejected) fetch would otherwise leave pcaInstance null forever
// and freeze the whole app on blank 'pending' screens.
async function fetchMsalConfig(): Promise<any> {
  const attempt = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch('/api/config', { signal: controller.signal })
      // Treat a non-2xx response as a failure so it falls through to the
      // cached-config fallback rather than being parsed into a bogus config.
      if (!res.ok) throw new Error(`/api/config responded ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    return await attempt()
  } catch {
    return await attempt()
  }
}

// The MSAL config is static, non-secret public-client data derived from the
// server's MSAL_* env vars. Caching the last good copy in localStorage (the same
// store MSAL uses for its own token cache) lets a later *offline* start reuse it
// to initialize MSAL locally instead of hard-failing on the /api/config fetch.
const MSAL_CONFIG_CACHE_KEY = 'sessionapp_msal_config'

function readCachedMsalConfig(): any | null {
  try {
    const raw = window.localStorage.getItem(MSAL_CONFIG_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function persistMsalConfig(config: any): void {
  try {
    window.localStorage.setItem(MSAL_CONFIG_CACHE_KEY, JSON.stringify(config))
  } catch {
    // Best-effort — storage full/blocked shouldn't break bootstrap.
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
  const [configError, setConfigError] = useState(false)
  const [syncingUser, setSyncingUser] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false;

    // Safety net: if the MSAL bootstrap never settles (hung config fetch, a
    // wedged interaction), don't leave the whole app frozen on blank 'pending'
    // screens — fall back to anonymous and invite a retry.
    const pendingSafetyTimer = setTimeout(() => {
      // Don't pre-empt an in-flight sync/retry: a cold backend can take longer
      // than this to answer GET /users/me, and the retry loop will settle the
      // status itself. Only rescue a genuinely wedged bootstrap.
      if (authStatus.value === 'pending' && !syncInProgress) {
        authStatus.value = 'anonymous';
        showToast('Sign-in is taking longer than expected. Please try again.', 'info');
      }
    }, 15000);

    const registerTokenHelper = (pca: PublicClientApplication) => {
      let redirectInProgress = false;

      setTokenAcquisitionHelper(async (forceRefresh = false) => {
        const accounts = pca.getAllAccounts();
        if (accounts.length === 0) {
          cachedToken = null;
          return null;
        }

        if (!forceRefresh && cachedToken && !isJwtExpired(cachedToken, 30)) {
          return cachedToken;
        }

        const activeAccount = pca.getActiveAccount() || accounts[0];

        // Try a silent refresh first. With a refresh token in the cache this is
        // a direct POST to the token endpoint (no iframe, no cookie, no popup);
        // the hidden-iframe fallback only kicks in once the refresh token is
        // gone. We race it against a short timeout so a blocked/stalled iframe
        // can never hang the UI — it just falls through to the interactive
        // redirect below. We return the freshly-refreshed id token to keep the
        // backend contract (oid/email/name/group claims) byte-for-byte identical.
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
            return result.idToken;
          }
        } catch (silentErr) {
          // InteractionRequiredAuthError, the timeout, or a blocked iframe all
          // land here — fall through to the interactive redirect below.
          if (!(silentErr instanceof InteractionRequiredAuthError)) {
            console.warn('Silent token acquisition failed, falling back to redirect:', silentErr);
          }
        }

        cachedToken = null;
        // Never launch an interactive redirect while offline: silent acquisition
        // always fails without a network, and a redirect to ciamlogin is a hard
        // navigation that hangs/breaks the offline session. Return null instead —
        // the fetch/sync layers already treat a null token as the offline path.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          return null;
        }
        if (!redirectInProgress) {
          const isInIframe = typeof window !== 'undefined' && window.parent !== window;
          if (!isInIframe) {
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
      });
    };

    const bootstrap = async () => {
      let config: any = null;
      // Whether /api/config actually answered (even with mock/empty config) vs.
      // the fetch throwing (offline / server unreachable). Only a real answer
      // distinguishes a genuine misconfiguration from a network failure.
      let serverResponded = false;
      try {
        config = await fetchMsalConfig();
        serverResponded = true;
      } catch (err) {
        console.warn('Failed to fetch MSAL config, falling back to cache:', err);
        config = readCachedMsalConfig();
      }

      if (cancelled) return;

      if (!config?.clientId || config.clientId === 'MOCK_CLIENT_ID') {
        authStatus.value = 'anonymous';
        // Show the blocking "Misconfigured" screen ONLY when the server actually
        // responded with mock/empty config. A thrown fetch (offline / server
        // down) with no cached fallback just renders the app anonymously so the
        // offline stack (SW cache, IndexedDB cache, offline banner) can run.
        if (serverResponded) setConfigError(true);
        return;
      }

      // Refresh the cache so a later offline start can reuse this config.
      // Harmless when `config` itself came from the cache.
      persistMsalConfig(config);

      const authority = config.tenantId
        ? `https://${config.tenantSubdomain}.ciamlogin.com/${config.tenantId}/`
        : `https://${config.tenantSubdomain}.ciamlogin.com/${config.tenantSubdomain}.onmicrosoft.com/`;

      const msalConfigObj = {
        auth: {
          clientId: config.clientId,
          authority,
          redirectUri: config.redirectUri || window.location.origin + "/",
          knownAuthorities: [`${config.tenantSubdomain}.ciamlogin.com`],
        },
        cache: {
          cacheLocation: "localStorage"
        }
      };

      const pca = new PublicClientApplication(msalConfigObj);
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
        } else if (!pca.getActiveAccount()) {
          const existing = pca.getAllAccounts()[0];
          if (existing) pca.setActiveAccount(existing);
        }
      } catch (err) {
        console.error('MSAL initialization failed:', err);
        if (cancelled) return;
        authStatus.value = 'anonymous';
        return;
      }

      if (cancelled) return;

      registerTokenHelper(pca);
      setPcaInstance(pca);
    };

    bootstrap();

    return () => {
      cancelled = true;
      clearTimeout(pendingSafetyTimer);
    };
  }, []);

  if (configError) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#090d16',
        color: '#fff',
        fontFamily: 'sans-serif',
        padding: '2rem'
      }}>
        <div style={{
          maxWidth: '500px',
          background: '#1e1e1e',
          border: '1px solid #dc2626',
          borderRadius: '8px',
          padding: '2rem',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
        }}>
          <h2 style={{ color: '#ef6461', marginTop: 0 }}>Authentication Misconfigured</h2>
          <p>MSAL could not be initialized because the required environment variables are missing.</p>
          <p style={{ color: '#9e9e9e', fontSize: '0.9rem' }}>
            Please ensure you have defined the following variables in your environment (e.g. in your hosting portal settings or locally in a gitignored <code>frontend/.env.local</code> file):
          </p>
          <ul style={{ color: '#4dd0a5', fontSize: '0.9rem' }}>
            <li><code>MSAL_CLIENT_ID</code></li>
            <li><code>MSAL_TENANT_SUBDOMAIN</code></li>
            <li><code>MSAL_TENANT_ID</code></li>
            <li><code>MSAL_REDIRECT_URI</code></li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <MsalProvider instance={pcaInstance ?? placeholderPca}>
      {pcaInstance && (
        <MsalBackgroundSync
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
  onSyncStart: (displayName: string) => void
  onSyncEnd: () => void
}

/** Keeps the shared signals in sync with the active MSAL account, notifying status to parent. */
function MsalBackgroundSync({ onSyncStart, onSyncEnd }: MsalBackgroundSyncProps) {
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
      // MSAL has no authenticated account — genuinely signed out.
      currentUserId.value = ''
      currentUserProfile.value = null
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

    const syncUser = async () => {
      onSyncStart(displayName)
      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
          try {
            const token = await getBearerToken(false)
            if (cancelled) return
            if (!token) {
              // Token temporarily unavailable (e.g. a stalled silent refresh).
              // Transient — back off and retry rather than dropping the session.
              await sleep(backoffMs(attempt))
              continue
            }

            const profile = await getCurrentUser()
            if (cancelled) return

            if (profile) {
              currentUserId.value = profile.userId
              currentUserProfile.value = profile
              authStatus.value = 'authenticated'
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
              setAnonymous()
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
          setAnonymous()
          showToast("Couldn't reach the server to finish signing you in. Please try again.", 'error')
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
  }, [isAuthenticated, accounts, inProgress])

  return null
}
