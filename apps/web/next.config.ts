import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Geolocation is needed by the passenger and driver apps on our own origin only.
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // E2E builds go to a separate folder (NEXT_DIST_DIR=.next-e2e) so a running local server is never disturbed.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@liberia-ride/shared", "@liberia-ride/geospatial"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
