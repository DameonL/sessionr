import { Configuration, PopupRequest } from "@azure/msal-browser";

const tenantSubdomain = process.env.MSAL_TENANT_SUBDOMAIN || "sessionapp";
const tenantId = process.env.MSAL_TENANT_ID;

const authority = tenantId
  ? `https://${tenantSubdomain}.ciamlogin.com/${tenantId}/`
  : `https://${tenantSubdomain}.ciamlogin.com/${tenantSubdomain}.onmicrosoft.com/`;

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.MSAL_CLIENT_ID || "MOCK_CLIENT_ID",
    authority,
    redirectUri: typeof window !== "undefined"
      ? (process.env.MSAL_REDIRECT_URI || window.location.origin + "/")
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
  scopes: ["openid", "profile", "User.Read", "api://94e2edf0-d97b-4d48-b7c3-c66ec38fee3e/access_as_user"]
};
