import { Configuration, PopupRequest } from "@azure/msal-browser";

const tenantSubdomain = process.env.NEXT_PUBLIC_MSAL_TENANT_SUBDOMAIN || "sessionapp";
const tenantId = process.env.NEXT_PUBLIC_MSAL_TENANT_ID;

const authority = tenantId
  ? `https://${tenantSubdomain}.ciamlogin.com/${tenantId}/`
  : `https://${tenantSubdomain}.ciamlogin.com/${tenantSubdomain}.onmicrosoft.com/`;

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_MSAL_CLIENT_ID || "MOCK_CLIENT_ID",
    authority,
    redirectUri: typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_MSAL_REDIRECT_URI || window.location.origin + "/")
      : "http://localhost:5173/",
    knownAuthorities: [
      `${tenantSubdomain}.ciamlogin.com`
    ]
  },
  cache: {
    cacheLocation: "sessionStorage"
  }
};

export const loginRequest: PopupRequest = {
  scopes: ["openid", "profile"]
};

export const isMsalEnabled =
  typeof window !== "undefined" &&
  !!process.env.NEXT_PUBLIC_MSAL_CLIENT_ID &&
  process.env.NEXT_PUBLIC_MSAL_CLIENT_ID !== "MOCK_CLIENT_ID";
