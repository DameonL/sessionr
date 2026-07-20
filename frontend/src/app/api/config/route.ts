import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    clientId: process.env.MSAL_CLIENT_ID || "MOCK_CLIENT_ID",
    tenantSubdomain: process.env.MSAL_TENANT_SUBDOMAIN || "sessionapp",
    tenantId: process.env.MSAL_TENANT_ID || "",
    redirectUri: process.env.MSAL_REDIRECT_URI || "",
  });
}
