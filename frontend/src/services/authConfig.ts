import { Configuration, PopupRequest } from "@azure/msal-browser";

/**
 * MSAL public-client configuration.
 *
 * These four values used to be served at runtime from /api/config (a Next.js
 * route handler, removed in the Vite migration). They are non-secret
 * identifiers that ship in the bundle either way — serving them over the wire
 * protected nothing and put a network round trip in front of every cold start,
 * so they live here instead. Changing any of them requires a rebuild, and
 * invalidates every cached MSAL session (see msalConfigFingerprint below).
 */
const clientId = "94e2edf0-d97b-4d48-b7c3-c66ec38fee3e";
// The CIAM login domain prefix. NOT the app name — it must match the tenant
// below, or discovery fails with AADSTS500210 ("Domain name does not match
// with the tenant identifier").
const tenantSubdomain = "sessionr";
// Left empty, the authority falls back to the {subdomain}.onmicrosoft.com form.
const tenantId = "e81c8bac-33ef-463d-9ff5-8a6920b1ccbc";

const authority = tenantId
  ? `https://${tenantSubdomain}.ciamlogin.com/${tenantId}/`
  : `https://${tenantSubdomain}.ciamlogin.com/${tenantSubdomain}.onmicrosoft.com/`;

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority,
    // Derived rather than hardcoded so dev (localhost:5173) and prod
    // (sessionr.org) both work off one value.
    redirectUri: window.location.origin + "/",
    knownAuthorities: [
      `${tenantSubdomain}.ciamlogin.com`
    ]
    // NB: navigateToLoginRequestUrl is no longer an `auth` config option in
    // msal-browser v5 — it moved onto handleRedirectPromise({ navigateToLoginRequestUrl })
    // (see AuthProvider.tsx). Don't re-add it here; it would be silently ignored.
  },
  cache: {
    cacheLocation: "localStorage"
  }
};

/**
 * Identifies the config this bundle was built with.
 *
 * Changing clientId or the tenant makes MSAL's entire localStorage token cache
 * worthless, and with it the auth snapshot that is corroborated against that
 * cache — MSAL's account-key index is not clientId-scoped, so a stale account
 * left by the old clientId still corroborates, and the snapshot would paint a
 * session whose tokens can never be minted. authSnapshot.ts stamps this into
 * every snapshot and refuses to read one that doesn't match.
 */
export const msalConfigFingerprint = `${clientId}|${tenantSubdomain}|${tenantId}`;

export const loginRequest: PopupRequest = {
  scopes: ["openid", "profile", "User.Read", "api://94e2edf0-d97b-4d48-b7c3-c66ec38fee3e/access_as_user"]
};
