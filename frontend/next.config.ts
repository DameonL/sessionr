import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Public API (anonymous-friendly reads + community contributions) — more
      // specific, so it must be listed before the catch-all below. The "public/"
      // segment is stripped: the Public Functions app's own routes don't have it.
      {
        source: "/api/public/:path*",
        destination: "http://localhost:7071/api/:path*",
      },
      // Private API (personal data, mutations) — everything else.
      {
        source: "/api/:path*",
        destination: "http://localhost:7072/api/:path*",
      },
    ];
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
