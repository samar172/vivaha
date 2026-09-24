import type { NextConfig } from "next";

// Everything under /api is proxied to the Express API so the browser only ever
// talks to one origin — which keeps the refresh cookie first-party. Next reads
// rewrites at build time, so API_PROXY_TARGET must be set before the build, not
// at runtime; the fallbacks below mean a deploy still works if it is missing.
const API_TARGET =
  process.env.API_PROXY_TARGET ??
  (process.env.VERCEL ? "https://vivaha-api.98.70.37.83.nip.io" : "http://127.0.0.1:4100");

// A single-page app does not re-fetch its own JavaScript when you click around
// inside it. A tab left open since this morning keeps running this morning's
// build for as long as it stays open — which is how a fix that is deployed and
// working still looks broken to the person who asked for it.
//
// So every build carries an id the running app can compare itself against. See
// app/build-id/route.ts and components/FreshBuild.tsx.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? String(Date.now());

const nextConfig: NextConfig = {
  transpilePackages: ["@vivaha/shared"],
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Dev-only: lets the ngrok demo origin through the dev server. (NextConfig
  // types this now, so the suppression this line used to carry is gone.)
  allowedDevOrigins: ["noncapriciously-unelated-kalyn.ngrok-free.dev", "*.ngrok-free.dev", "*.ngrok-free.app"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
