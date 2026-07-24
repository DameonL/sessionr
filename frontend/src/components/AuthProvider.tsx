"use client";

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { InteractionStatus, Logger, PublicClientApplication, stubbedPublicClientApplication, type IPublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { getCurrentUser } from '../services/api'
import { authStatus, currentUserId, currentUserProfile, setTokenAcquisitionHelper, showToast } from '../state/appState'

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

let cachedToken: string | null = null

export default function AuthProvider({ children }: AuthProviderProps) {
  const [pcaInstance, setPcaInstance] = useState<PublicClientApplication | null>(null)
  const [configError, setConfigError] = useState(false)
  const [syncingUser, setSyncingUser] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((config) => {
        if (config.clientId && config.clientId !== 'MOCK_CLIENT_ID') {
          const authority = config.tenantId
            ? `https://${config.tenantSubdomain}.ciamlogin.com/${config.tenantId}/`
            : `https://${config.tenantSubdomain}.ciamlogin.com/${config.tenantSubdomain}.onmicrosoft.com/`;

          const msalConfigObj = {
            auth: {
              clientId: config.clientId,
              authority,
              redirectUri: config.redirectUri || window.location.origin + "/",
              knownAuthorities: [`${config.tenantSubdomain}.ciamlogin.com`]
            },
            cache: {
              cacheLocation: "localStorage"
            }
          };

          const pca = new PublicClientApplication(msalConfigObj);
          pca.initialize().then(() => {
            setPcaInstance(pca);
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
              try {
                const response = await pca.acquireTokenSilent({
                  scopes: ['openid', 'profile'],
                  account: activeAccount,
                  forceRefresh,
                });
                const token = response.idToken || response.accessToken || null;
                if (token && !isJwtExpired(token, 30)) {
                  cachedToken = token;
                  return token;
                }

                const fresh = await pca.acquireTokenSilent({
                  scopes: ['openid', 'profile'],
                  account: activeAccount,
                  forceRefresh: true,
                });
                const freshToken = fresh.idToken || fresh.accessToken || null;
                if (freshToken) {
                  cachedToken = freshToken;
                }
                return freshToken;
              } catch (error) {
                console.warn('acquireTokenSilent failed, trying forceRefresh:', error);
                try {
                  const fresh = await pca.acquireTokenSilent({
                    scopes: ['openid', 'profile'],
                    account: activeAccount,
                    forceRefresh: true,
                  });
                  const freshToken = fresh.idToken || fresh.accessToken || null;
                  if (freshToken) {
                    cachedToken = freshToken;
                  }
                  return freshToken;
                } catch (retryErr) {
                  console.warn('Token forceRefresh failed:', retryErr);
                  cachedToken = null;
                  return null;
                }
              }
            });
          }).catch((err) => {
            console.error('MSAL initialization failed:', err);
            authStatus.value = 'anonymous';
          });
        } else {
          authStatus.value = 'anonymous';
          setConfigError(true);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch MSAL config:', err);
        authStatus.value = 'anonymous';
        setConfigError(true);
      });
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

    if (isAuthenticated && accounts.length > 0) {
      const activeAccount = accounts[0]
      const displayName = activeAccount.name ||
                          (activeAccount.idTokenClaims as any)?.name ||
                          (activeAccount.idTokenClaims as any)?.given_name ||
                          'Microsoft Musician';

      onSyncStart(displayName)

      getCurrentUser()
        .then((profile) => {
          currentUserId.value = profile.userId
          currentUserProfile.value = profile
          authStatus.value = 'authenticated'
          if (!profile.username && pathname !== '/profile') {
            showToast('Please choose a username to continue.', 'info')
            router.replace('/profile')
          }
        })
        .catch((err) => {
          console.error('Failed to sync user with DB:', err)
          authStatus.value = 'anonymous'
        })
        .finally(() => {
          onSyncEnd()
        })
    } else {
      currentUserId.value = ''
      currentUserProfile.value = null
      authStatus.value = 'anonymous'
      onSyncEnd()
    }
  }, [isAuthenticated, accounts, inProgress])

  return null
}
