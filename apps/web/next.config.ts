import type { NextConfig } from "next";

// Everything under /api is proxied to the Express API so the browser only ever
// talks to one origin — which keeps the refresh cookie first-party. Next reads
// rewrites at build time, so API_PROXY_TARGET must be set before the build, not
// at runtime; the fallbacks below mean a deploy still works if it is missing.
const API_TARGET =
  process.env.API_PROXY_TARGET ??
  (process.env.VERCEL ? "https://vivaha-api.98.70.37.83.nip.io" : "http://127.0.0.1:4100");

const nextConfig: NextConfig = {
  transpilePackages: ["@vivaha/shared"],
  // Dev-only: lets the ngrok demo origin through the dev server. (NextConfig
  // types this now, so the suppression this line used to carry is gone.)
  allowedDevOrigins: ["noncapriciously-unelated-kalyn.ngrok-free.dev", "*.ngrok-free.dev", "*.ngrok-free.app"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
