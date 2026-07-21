"use client";

import { useEffect, useState, type ReactNode } from 'react'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { loginOrRegisterUser } from '../services/api'
import { currentUserId, currentUserProfile, setTokenAcquisitionHelper } from '../state/appState'

interface AuthProviderProps {
  children: ReactNode
}

export default function AuthProvider({ children }: AuthProviderProps) {
  const [pcaInstance, setPcaInstance] = useState<PublicClientApplication | null>(null)
  const [loading, setLoading] = useState(true)
  const [configError, setConfigError] = useState(false)

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
              cacheLocation: "sessionStorage"
            }
          };

          const pca = new PublicClientApplication(msalConfigObj);
          pca.initialize().then(() => {
            setPcaInstance(pca);
            setTokenAcquisitionHelper(async () => {
              const accounts = pca.getAllAccounts();
              if (accounts.length === 0) return null;
              const activeAccount = pca.getActiveAccount() || accounts[0];
              try {
                const response = await pca.acquireTokenSilent({
                  scopes: ['openid', 'profile', config.clientId],
                  account: activeAccount,
                });
                return response.idToken || response.accessToken || null;
              } catch (error) {
                console.warn('acquireTokenSilent failed:', error);
                return null;
              }
            });
            setLoading(false);
          }).catch((err) => {
            console.error('MSAL initialization failed:', err);
            setLoading(false);
          });
        } else {
          setConfigError(true);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch MSAL config:', err);
        setConfigError(true);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <>{children}</>
  }

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

  if (!pcaInstance) {
    return <>{children}</>
  }

  return (
    <MsalProvider instance={pcaInstance}>
      <MsalBackgroundSync />
      {children}
    </MsalProvider>
  )
}

/** Keeps the shared signals in sync with the active MSAL account, with no UI of its own. */
function MsalBackgroundSync() {
  const { accounts } = useMsal()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (isAuthenticated && accounts.length > 0) {
      const activeAccount = accounts[0]
      const email = activeAccount.username || 
                    (activeAccount.idTokenClaims as any)?.email || 
                    (activeAccount.idTokenClaims as any)?.emails?.[0] || 
                    (activeAccount.idTokenClaims as any)?.preferred_username;
      
      const displayName = activeAccount.name || 
                          (activeAccount.idTokenClaims as any)?.name || 
                          (activeAccount.idTokenClaims as any)?.given_name || 
                          'Microsoft Musician';

      if (!email) {
        console.error('No email claim found in MSAL account:', activeAccount)
        return
      }

      loginOrRegisterUser(email, displayName)
        .then((profile) => {
          currentUserId.value = profile.userId
          currentUserProfile.value = { email: profile.email, displayName: profile.displayName }
        })
        .catch((err) => {
          console.error('Failed to sync user with DB:', err)
        })
    } else {
      currentUserId.value = ''
      currentUserProfile.value = null
    }
  }, [isAuthenticated, accounts])

  return null
}
