import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vivaha/shared"],
  // @ts-ignore — dev-only: allow the ngrok demo origin
  allowedDevOrigins: ["noncapriciously-unelated-kalyn.ngrok-free.dev", "*.ngrok-free.dev", "*.ngrok-free.app"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:4100/api/:path*" }];
  },
};

export default nextConfig;
