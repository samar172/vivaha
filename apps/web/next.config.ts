import type { NextConfig } from "next";

// Everything under /api is proxied to the Express API so the browser only ever
// talks to one origin — which keeps the refresh cookie first-party. Point
// API_PROXY_TARGET at the deployed API (Vercel env var); it defaults to the
// local API for `npm run dev`.
const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4100";

const nextConfig: NextConfig = {
  transpilePackages: ["@vivaha/shared"],
  // @ts-ignore — dev-only: allow the ngrok demo origin
  allowedDevOrigins: ["noncapriciously-unelated-kalyn.ngrok-free.dev", "*.ngrok-free.dev", "*.ngrok-free.app"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
